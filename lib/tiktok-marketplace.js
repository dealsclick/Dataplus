const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createTikTokClient, fail } = require('./tiktok-client');
const { componentRows, mapTikTokOrder, mapTikTokReturn } = require('./tiktok-mappers');
const {
  applyTikTokLiveAttribution,
  normalizeTikTokLiveAttribution,
  normalizeTikTokLiveProduct,
  normalizeTikTokLiveSession,
  summarizeTikTokLiveSessions
} = require('./tiktok-live');
const {
  EVENT_TOPICS,
  reconcileOperation,
  verifyTikTokShopWebhook,
  webhookEntity,
  webhookIdentity,
  webhookTopic
} = require('./tiktok-webhooks');
const { reconcileOrderReturns } = require('./return-workflow');

const stamp = () => new Date().toISOString();
const text = value => String(value ?? '').trim();
const array = value => Array.isArray(value) ? value : [];
const clamp = (value, minimum, maximum, fallback) => Math.max(minimum, Math.min(maximum, Number(value || fallback) || fallback));
const dateSeconds = value => Math.floor(new Date(value).getTime() / 1000);
function importBoundary(value, fallback, inclusiveEnd = false) {
  const raw = text(value);
  const parsed = raw ? new Date(raw) : new Date(fallback);
  if (inclusiveEnd && /^\d{4}-\d{2}-\d{2}$/.test(raw)) parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed;
}
function dateWindows(startValue, endValue, maximumDays = 29) {
  const start = new Date(startValue).getTime();
  const end = new Date(endValue).getTime();
  const span = Math.max(1, Number(maximumDays || 29)) * 86_400_000;
  const windows = [];
  for (let cursor = start; cursor < end; cursor += span) {
    windows.push({ start: new Date(cursor).toISOString(), end: new Date(Math.min(end, cursor + span)).toISOString() });
  }
  return windows;
}

const CAPABILITIES = Object.freeze([
  { key: 'connection', label: 'Seller authorization and shops', state: 'ready', api: 'Authorization 202309 / Seller 202309' },
  { key: 'orders', label: 'Orders and cancellation indicators', state: 'ready', api: 'Order search 202309 / detail 202507' },
  { key: 'returns', label: 'Returns, refunds, and reverse logistics', state: 'ready', api: 'Returns search 202602' },
  { key: 'finance', label: 'Statements and settlement transactions', state: 'ready', api: 'Finance 202309 / 202501' },
  { key: 'catalog', label: 'Catalog and listing reconciliation', state: 'ready', api: 'Product search 202502' },
  { key: 'liveAnalytics', label: 'LIVE sessions and performance', state: 'ready', api: 'Analytics 202609 / products 202512', note: 'Requires the TikTok Shop Analytics scope.' },
  { key: 'liveOrders', label: 'LIVE order attribution', state: 'ready', api: 'Affiliate Seller orders 202410', note: 'Requires TikTok approval and the Read Seller Affiliate Collaboration scope. Missing approval is reported without blocking ordinary order imports.' },
  { key: 'liveProducts', label: 'LIVE product pinning and ordering', state: 'foundation', api: 'Affiliate LIVE products 202309', note: 'Requires separate creator authorization. DataPlus does not reuse the seller token as a creator token.' },
  { key: 'launch', label: 'Product launch and maintenance', state: 'ready', api: 'Create/listing check 202309', note: 'Every SKU is revalidated before submission; incomplete products remain in the job review artifact.' },
  { key: 'inventory', label: 'Inventory and price updates', state: 'ready', api: 'Inventory update 202309 / price update 202309', note: 'Only changed linked SKUs are submitted; positive inventory requires a TikTok warehouse mapping.' },
  { key: 'labels', label: 'TikTok Shipping services and labels', state: 'ready', api: 'Shipping services 202309 / create package 202512 / documents 202309', note: 'Package creation remains a two-step, user-confirmed write.' },
  { key: 'analytics', label: 'Shop, product, video, and LIVE analytics', state: 'ready', api: 'Analytics 202509 / LIVE 202609', note: 'Optional scopes fail independently and remain visible as warnings.' },
  { key: 'affiliate', label: 'Affiliate and creator collaboration data', state: 'ready', api: 'Affiliate Seller 202508 / orders 202410', note: 'TikTok approval may be required for affiliate scopes.' },
  { key: 'promotions', label: 'Promotions and coupons', state: 'ready', api: 'Promotion 202309 / coupons 202406' },
  { key: 'engagement', label: 'Customer engagement configuration', state: 'ready', api: 'Customer Engagement 202412 / 202502', note: 'Reads permissions, visibility, and approved templates without sending a campaign.' },
  { key: 'reviewImport', label: 'External review import', state: 'foundation', api: 'Reviews 202508', note: 'TikTok exposes a write-only import API. DataPlus will not manufacture or submit reviews without an approved external review source and row-level evidence.' },
  { key: 'messages', label: 'Buyer conversations', state: 'ready', api: 'Customer service conversations 202601 / send message 202606', note: 'TikTok is the first source in the shared DataPlus Messages workspace.' },
  { key: 'webhooks', label: 'Order, return, product, inventory, and message webhooks', state: 'ready', api: 'Event webhooks 202309 / inventory event type 71', note: 'Raw-body HMAC verification, PostgreSQL deduplication, and targeted source reconciliation are enabled.' }
]);

function createTikTokMarketplace(deps) {
  const { postgres, credentials, artifactsDir, log, persistJob, feeStore, settlementScope } = deps;

  async function channel() {
    const connections = await deps.readConnections();
    return array(connections).find(row => text(row.name).toLowerCase() === 'tiktok shop') || null;
  }

  async function enabled(gate) {
    const current = await channel();
    if (!current || current.settings?.channelEnabled !== true) throw fail('Enable TikTok Shop in Channels first.', 409);
    if (gate && current.settings?.[gate] !== true) throw fail(`Enable ${gate.replace(/^tiktok/, 'TikTok ')} in channel Features first.`, 409);
    return current;
  }

  async function settings() {
    return (await channel())?.settings || {};
  }

  const client = createTikTokClient({ channel, credentials, log });
  const read = async key => (await postgres.getPool().query('select data from tiktok_documents where doc_key=$1', [key])).rows[0]?.data || null;
  const readMany = async (prefix, limit = 250) => (await postgres.getPool().query(
    `select doc_key,data,updated_at from tiktok_documents where doc_key like $1 order by updated_at desc limit $2`,
    [`${prefix}%`, Math.max(1, Math.min(2000, Number(limit || 250)))])
  ).rows.map(row => ({ key: row.doc_key, updatedAt: row.updated_at?.toISOString?.() || row.updated_at, ...(row.data || {}) }));
  const write = async (key, value) => {
    await postgres.getPool().query(`insert into tiktok_documents(doc_key,data,updated_at) values($1,$2::jsonb,now())
      on conflict(doc_key) do update set data=excluded.data,updated_at=now()`, [key, JSON.stringify(value)]);
    return value;
  };

  async function accountIdentity() {
    const current = await enabled();
    const environment = current.settings?.tiktokEnvironment === 'development' ? 'development' : 'production';
    return { current, environment, credentialKey: credentials.fingerprint(environment) };
  }

  async function verifyConnection() {
    const { current, environment } = await accountIdentity();
    await write('tiktok.connection', {
      verified: false,
      channelId: current.id,
      environment,
      credentialKey: credentials.fingerprint(environment),
      verificationStartedAt: stamp(),
      message: 'TikTok Shop verification is in progress.'
    });
    const shopResponse = await client.request('/authorization/202309/shops', { shopScoped: false, operation: 'Verify TikTok authorized shops' });
    const shops = array(shopResponse.data?.shops);
    if (!shops.length) throw fail('TikTok returned no authorized shops for this seller token.', 409);
    const saved = credentials.get(environment);
    const selected = shops.find(shop => text(shop.cipher) === text(saved.shopCipher)) || (shops.length === 1 ? shops[0] : null);
    if (selected) credentials.selectShop(environment, selected);
    const credentialKey = credentials.fingerprint(environment);
    const permissionResponse = await client.request('/seller/202309/permissions', { shopScoped: false, operation: 'Read TikTok seller permissions' });
    const permissionSignals = array(permissionResponse.data?.permissions);
    let webhooks = null;
    try {
      webhooks = await client.request('/event/202309/webhooks', { method: 'GET', operation: 'Read TikTok webhook subscriptions' });
    } catch (error) {
      webhooks = { warning: error.message };
    }
    const result = {
      verified: true,
      verifiedAt: stamp(),
      channelId: current.id,
      environment,
      credentialKey: credentials.fingerprint(environment),
      priorCredentialKey: credentialKey,
      shops: shops.map(shop => ({ id: text(shop.id), name: text(shop.name), code: text(shop.code), cipher: text(shop.cipher), region: text(shop.region), sellerType: text(shop.seller_type) })),
      selectedShopCipher: text(selected?.cipher || saved.shopCipher),
      selectedShopId: text(selected?.id || saved.shopId),
      sellerPermissionSignals: permissionSignals,
      grantedScopes: credentials.status(environment).grantedScopes,
      webhookSubscriptions: webhooks?.data || null,
      webhookWarning: webhooks?.warning || '',
      message: selected ? `Connected to ${selected.name || selected.code || 'TikTok Shop'}.` : 'Credentials are valid. Select one authorized shop before running shop operations.'
    };
    await write('tiktok.connection', result);
    return result;
  }

  async function requireVerified() {
    const identity = await accountIdentity();
    const connection = await read('tiktok.connection');
    if (!connection?.verified || connection.channelId !== identity.current.id || connection.environment !== identity.environment || connection.credentialKey !== identity.credentialKey) {
      throw fail('Verify the TikTok Shop connection after the latest credential or shop change.', 409);
    }
    if (!credentials.get(identity.environment).shopCipher) throw fail('Select an authorized TikTok Shop.', 409);
    return { ...identity, connection };
  }

  async function publicStatus() {
    const current = await channel();
    const environment = current?.settings?.tiktokEnvironment === 'development' ? 'development' : 'production';
    const credentialStatus = credentials.status(environment);
    const connection = await read('tiktok.connection');
    const fingerprint = credentialStatus.configured ? credentials.fingerprint(environment) : '';
    const verified = Boolean(current?.settings?.channelEnabled && connection?.verified && connection.channelId === current.id && connection.environment === environment && connection.credentialKey === fingerprint);
    const jobs = await postgres.getPool().query(`select job_id,job_number,status,name,coalesce(ended_at,updated_at,started_at,created_at) as at,raw->>'workerTask' as task
      from operations_jobs where coalesce(raw->>'workerTask','') like 'tiktok-%' order by coalesce(ended_at,updated_at,started_at,created_at) desc limit 12`);
    return {
      channel: { id: current?.id || '', enabled: current?.settings?.channelEnabled === true },
      environment,
      ...credentialStatus,
      connection: { ...(connection || {}), verified },
      capabilities: CAPABILITIES,
      recentJobs: jobs.rows.map(row => ({ id: row.job_id, jobNumber: row.job_number, status: row.status, operation: row.name, task: row.task, at: row.at }))
    };
  }

  async function publicLiveStatus() {
    const summary = await read('tiktok.live.summary');
    return summary || {
      syncedAt: '',
      range: null,
      metrics: summarizeTikTokLiveSessions([]),
      sessions: [],
      analytics: { available: null, warning: '' },
      attribution: { enabled: false, available: null, checked: 0, liveOrders: 0, matched: 0, unmatched: 0, warning: '' }
    };
  }

  async function publicWorkspace() {
    const [analytics, commerce, affiliate, promotions, engagement, webhooks] = await Promise.all([
      read('tiktok.analytics.summary'),
      readMany('tiktok.commerce.', 25),
      readMany('tiktok.affiliate.', 25),
      readMany('tiktok.promotions.', 25),
      readMany('tiktok.engagement.', 25),
      webhookStatus(false)
    ]);
    return { analytics: analytics || null, commerce, affiliate, promotions, engagement, webhooks };
  }

  async function webhookStatus(refresh = true, req = null) {
    const callbackUrl = text(deps.webhookAddress?.(req));
    const recentEvents = await readMany('tiktok.webhook.event.', 25);
    let subscriptions = array((await read('tiktok.webhooks.status'))?.subscriptions);
    let warning = '';
    if (refresh) {
      await requireVerified();
      try {
        const response = await client.request('/event/202309/webhooks', { method: 'GET', gate: 'tiktokWebhooksEnabled', operation: 'Read TikTok webhook subscriptions' });
        subscriptions = array(response.data?.webhooks);
        await write('tiktok.webhooks.status', { subscriptions, callbackUrl, checkedAt: stamp(), requestId: response.request_id || '' });
      } catch (error) {
        warning = error.message;
      }
    }
    const subscribed = new Set(subscriptions.map(row => text(row.event_type || row.eventType).toUpperCase()));
    return {
      callbackUrl,
      subscriptions,
      configuredTopics: EVENT_TOPICS.filter(topic => subscribed.has(topic)),
      missingTopics: EVENT_TOPICS.filter(topic => !subscribed.has(topic)),
      recentEvents: recentEvents.map(event => ({ eventId: event.eventId, topic: event.topic, state: event.state, receivedAt: event.receivedAt, processedAt: event.processedAt, error: event.error || '', entity: event.entity || {} })),
      warning
    };
  }

  async function setupWebhooks(req = null) {
    await requireVerified();
    await enabled('tiktokWebhooksEnabled');
    const address = text(deps.webhookAddress?.(req));
    if (!/^https:\/\/[^\s]+$/i.test(address)) throw fail('Configure a public HTTPS application URL before enabling TikTok webhooks.', 409);
    return queue('webhook-setup', { callbackUrl: address, actor: 'user:tiktok-webhook-setup' });
  }

  async function receiveWebhook(rawBody, payload, authorization) {
    const current = await channel();
    if (!current) throw fail('TikTok Shop channel is not configured.', 404);
    const environment = current.settings?.tiktokEnvironment === 'development' ? 'development' : 'production';
    const saved = credentials.get(environment);
    if (!verifyTikTokShopWebhook(rawBody, authorization, saved.appKey, saved.appSecret)) throw fail('TikTok webhook signature is invalid.', 401);
    if (current.settings?.channelEnabled !== true || current.settings?.tiktokWebhooksEnabled !== true) {
      return { accepted: false, disabled: true };
    }
    const eventId = webhookIdentity(payload, rawBody);
    const topic = webhookTopic(payload);
    const entity = webhookEntity(payload);
    const event = { eventId, topic, entity, payload, receivedAt: stamp(), state: 'pending', environment, channelId: current.id };
    const inserted = await postgres.getPool().query(
      `insert into tiktok_documents(doc_key,data,updated_at) values($1,$2::jsonb,now()) on conflict(doc_key) do nothing returning doc_key`,
      [`tiktok.webhook.event.${eventId}`, JSON.stringify(event)]
    );
    if (!inserted.rowCount) return { accepted: true, duplicate: true, eventId };
    setTimeout(() => queue('webhook', { eventIds: [eventId], actor: 'system:tiktok-webhook' }).catch(error => {
      log({ channel: 'TikTok Shop', transport: 'Webhook', method: 'QUEUE', path: topic, operation: 'Queue TikTok event reconciliation', statusCode: error.statusCode || 500, ok: false, message: error.message });
    }), 0);
    return { accepted: true, duplicate: false, eventId, topic };
  }

  async function listConversations(input = {}) {
    await enabled('tiktokMessagesEnabled');
    const query = text(input.q).toLowerCase();
    const unreadOnly = input.unreadOnly === true;
    const limit = Math.max(1, Math.min(200, Number(input.limit || 100)));
    const rows = await readMany('tiktok.conversation.', 1000);
    const conversations = rows
      .map(row => ({ ...row, conversationId: text(row.conversationId || row.id || row.key?.replace('tiktok.conversation.', '')) }))
      .filter(row => !unreadOnly || Number(row.unread_count ?? row.unreadCount ?? 0) > 0)
      .filter(row => !query || JSON.stringify(row).toLowerCase().includes(query))
      .slice(0, limit);
    return { source: 'TikTok Shop', conversations, total: conversations.length };
  }

  async function conversationDetail(conversationId, refresh = true) {
    await requireVerified();
    await enabled('tiktokMessagesEnabled');
    const id = text(conversationId);
    if (!id) throw fail('Conversation ID is required.', 400);
    const key = `tiktok.conversation.${id}`;
    let conversation = await read(key);
    let messages = array(conversation?.messages);
    if (refresh) {
      const [detailResponse, messageResponse] = await Promise.all([
        client.request(`/customer_service/202601/conversations/${encodeURIComponent(id)}`, { gate: 'tiktokMessagesEnabled', operation: `Read TikTok conversation ${id}` }),
        client.request(`/customer_service/202309/conversations/${encodeURIComponent(id)}/messages`, { gate: 'tiktokMessagesEnabled', operation: `Read TikTok messages ${id}`, query: { page_size: 100, sort_order: 'DESC', sort_field: 'create_time', need_data: true } })
      ]);
      messages = array(messageResponse.data?.messages).reverse();
      conversation = { ...(conversation || {}), ...(detailResponse.data?.conversation || {}), conversationId: id, messages, unsupportedMessageTips: messageResponse.data?.unsupported_msg_tips || '', syncedAt: stamp() };
      await write(key, conversation);
    }
    return { source: 'TikTok Shop', conversation: { ...(conversation || {}), conversationId: id }, messages };
  }

  async function markConversationRead(conversationId) {
    const id = text(conversationId);
    if (!id) throw fail('Conversation ID is required.', 400);
    await requireVerified();
    await enabled('tiktokMessagesEnabled');
    const response = await client.request(`/customer_service/202309/conversations/${encodeURIComponent(id)}/messages/read`, { method: 'POST', gate: 'tiktokMessagesEnabled', operation: `Mark TikTok conversation ${id} read`, body: {} });
    const existing = await read(`tiktok.conversation.${id}`);
    await write(`tiktok.conversation.${id}`, { ...(existing || {}), conversationId: id, unread_count: 0, unreadCount: 0, readAt: stamp() });
    return { ...response, message: 'TikTok conversation marked read.' };
  }

  async function sendConversationMessage(conversationId, input = {}) {
    const id = text(conversationId);
    const content = text(input.content);
    if (!id) throw fail('Conversation ID is required.', 400);
    if (!content || content.length > 2000) throw fail('Enter a reply between 1 and 2,000 characters.', 400);
    await requireVerified();
    await enabled('tiktokMessagesEnabled');
    const existing = await read(`tiktok.conversation.${id}`);
    if (existing?.can_send_message === false || existing?.canSendMessage === false) throw fail('TikTok has closed replies for this conversation.', 409);
    const response = await client.request(`/customer_service/202606/conversations/${encodeURIComponent(id)}/messages`, {
      method: 'POST', gate: 'tiktokMessagesEnabled', operation: `Reply to TikTok conversation ${id}`,
      body: { sender_role: 'CUSTOMER_SERVICE', type: 'TEXT', content: JSON.stringify({ content }) }
    });
    const localMessage = { id: text(response.data?.message_id || crypto.randomUUID()), type: 'TEXT', content, sender_role: 'CUSTOMER_SERVICE', create_time: Math.floor(Date.now() / 1000), local: true };
    await write(`tiktok.conversation.${id}`, { ...(existing || {}), conversationId: id, messages: [...array(existing?.messages), localMessage], latest_message: localMessage, repliedAt: stamp() });
    return { ...response, message: 'Reply sent through TikTok Shop.' };
  }

  const gateFor = operation => ({
    orders: 'tiktokOrdersEnabled',
    returns: 'tiktokReturnsEnabled',
    settlements: 'tiktokSettlementImportEnabled',
    products: 'tiktokCatalogEnabled',
    messages: 'tiktokMessagesEnabled',
    live: 'tiktokLiveAnalyticsEnabled',
    analytics: 'tiktokAnalyticsEnabled',
    affiliate: 'tiktokAffiliateEnabled',
    promotions: 'tiktokPromotionsEnabled',
    engagement: 'tiktokCustomerEngagementEnabled',
    commerce: 'tiktokCatalogEnabled',
    launch: 'tiktokLaunchEnabled',
    inventory: 'tiktokInventoryEnabled',
    price: 'tiktokPriceEnabled',
    webhook: 'tiktokWebhooksEnabled',
    'webhook-setup': 'tiktokWebhooksEnabled'
  })[operation];

  async function queue(operation, input = {}) {
    if (!['orders', 'returns', 'settlements', 'products', 'messages', 'live', 'analytics', 'affiliate', 'promotions', 'engagement', 'commerce', 'launch', 'inventory', 'price', 'webhook', 'webhook-setup'].includes(operation)) throw fail('Unsupported TikTok job.', 400);
    await enabled(gateFor(operation));
    const identity = await requireVerified();
    const workerTask = `tiktok-${operation}`;
    const existing = await deps.findActive(workerTask);
    if (existing) return { duplicate: true, job: existing, message: `${existing.operation || operation} is already ${existing.status}.` };
    const now = new Date();
    const days = clamp(input.lookbackDays, 1, operation === 'orders' ? 365 : 180, operation === 'settlements' ? 45 : 30);
    const startDate = importBoundary(input.startDate, now.getTime() - days * 86_400_000);
    const endDate = importBoundary(input.endDate, now, true);
    if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime()) || startDate >= endDate) throw fail('Choose a valid TikTok import date range.', 400);
    const job = await deps.createJob({
      section: operation === 'settlements' ? 'Accounting' : ['products', 'launch', 'inventory', 'price', 'commerce'].includes(operation) ? 'Products' : 'Channels',
      category: 'TikTok Shop',
      operation: operation === 'live' ? 'TikTok Shop LIVE synchronization' : operation === 'webhook' ? 'TikTok Shop event reconciliation' : `TikTok Shop ${operation === 'products' ? 'catalog reconciliation' : operation}`,
      direction: 'sync',
      status: 'queued',
      phase: 'queued',
      fileName: `tiktok-${operation}.ndjson`,
      totalRows: 0,
      processedRows: 0,
      progressPercent: 0,
      scheduled: input.scheduled === true,
      workerTask,
      workerPayload: {
        operation,
        channelId: identity.current.id,
        environment: identity.environment,
        credentialKey: identity.credentialKey,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        historicalBackfill: input.historicalBackfill === true,
        reconcileExisting: input.reconcileExisting !== false,
        skus: array(input.skus).map(text).filter(Boolean).slice(0, 5000),
        eventIds: array(input.eventIds).map(text).filter(Boolean).slice(0, 500),
        callbackUrl: /^https:\/\/[^\s]+$/i.test(text(input.callbackUrl)) ? text(input.callbackUrl) : '',
        limit: Math.max(1, Math.min(5000, Number(input.limit || 5000))),
        scheduled: input.scheduled === true,
        actor: text(input.actor || '')
      },
      message: `TikTok Shop ${operation} queued. Progress and results will appear in Jobs.`
    });
    log({ channel: 'TikTok Shop', transport: 'Job', method: 'QUEUE', path: operation, operation: job.operation, statusCode: 202, ok: true, jobId: job.id, message: job.message });
    return { duplicate: false, job, message: job.message };
  }

  async function saveReturn(raw) {
    const orderId = text(raw.order_id);
    const order = orderId ? await postgres.readChannelOrderForReturn('TikTok Shop', { orderId }) : null;
    const record = mapTikTokReturn(raw, order);
    const saved = await postgres.upsertImportedReturn(record);
    if (order) {
      reconcileOrderReturns(order, [saved]);
      await postgres.saveOrder(order);
    }
    return { saved, order };
  }

  function productListing(product = {}, channelSettings = {}) {
    const listing = product.tiktokListing && typeof product.tiktokListing === 'object' ? product.tiktokListing : {};
    const category = product.tiktokCategory && typeof product.tiktokCategory === 'object' ? product.tiktokCategory : {};
    const dimensions = {
      length: Number(product.packageLength || product.package_length || 0),
      width: Number(product.packageWidth || product.package_width || 0),
      height: Number(product.packageHeight || product.package_height || 0)
    };
    const weight = Number(product.packageWeight || product.package_weight || 0);
    const price = Number(product.tiktokPrice || product.websitePrice || product.price || 0);
    const available = Math.max(0, Math.floor(Number(product.available ?? product.qty ?? product.stockQty ?? 0) - Number(product.reserved || 0) - Number(channelSettings.tiktokInventorySafetyQty || 0)));
    const categoryId = text(product.tiktokCategoryId || category.categoryId || listing.categoryId);
    const warehouseId = text(product.tiktokWarehouseId || listing.warehouseId || channelSettings.tiktokWarehouseId);
    const imageUris = array(product.tiktokImageUris || listing.imageUris || listing.mainImageUris).map(uri => text(uri?.uri || uri)).filter(Boolean);
    const description = text(product.longDescription || product.description || product.shortDescription || product.title).slice(0, 10_000);
    const identifier = text(product.barcode || product.upc || product.gtin);
    const productStatus = text(product.status || product.productStatus || product.lifecycleStatus).toLowerCase();
    const shippingClass = text(product.shippingClass || product.shippingClassification || product.shippingType).toLowerCase();
    const issues = [];
    if (product.active === false || product.toBeDiscontinued === true || ['inactive', 'discontinued', 'retired', 'deleted'].includes(productStatus)) issues.push('Catalog selling status blocks marketplace launch.');
    if (shippingClass.includes('ltl') || shippingClass.includes('freight')) issues.push('Freight products are not eligible for TikTok parcel launch.');
    if (!text(product.sku)) issues.push('SKU is missing.');
    if (!text(product.marketplaceTitle || product.title)) issues.push('Title is missing.');
    if (!categoryId) issues.push('TikTok category mapping is missing.');
    if (!imageUris.length) issues.push('TikTok-hosted product image URI is missing.');
    if (!warehouseId) issues.push('TikTok warehouse mapping is missing.');
    if (!(price > 0)) issues.push('TikTok price is missing.');
    if (!(weight > 0)) issues.push('Package weight is missing.');
    if (!Object.values(dimensions).every(value => value > 0)) issues.push('Complete package dimensions are required.');
    const sku = {
      seller_sku: text(product.sku),
      external_sku_id: text(product.id || product.sku),
      price: { amount: price.toFixed(2), currency: text(channelSettings.tiktokCurrency || 'USD') || 'USD' },
      inventory: [{ warehouse_id: warehouseId, quantity: Math.min(99_999, available) }]
    };
    if (identifier) sku.identifier_code = { code: identifier, type: identifier.length === 12 ? 'UPC' : identifier.length === 13 ? 'EAN' : 'GTIN' };
    return {
      issues,
      listing,
      payload: {
        save_mode: 'LISTING',
        idempotency_key: text(product.id || product.sku),
        external_product_id: text(product.id || product.sku),
        title: text(product.marketplaceTitle || product.title).slice(0, 255),
        description,
        category_id: categoryId,
        category_version: text(channelSettings.tiktokCategoryVersion || 'v2') || 'v2',
        main_images: imageUris.slice(0, 9).map(uri => ({ uri })),
        package_dimensions: { length: String(Math.ceil(dimensions.length)), width: String(Math.ceil(dimensions.width)), height: String(Math.ceil(dimensions.height)), unit: 'INCH' },
        package_weight: { value: String(weight), unit: 'POUND' },
        ...(text(channelSettings.tiktokShippingTemplateId) ? { shipping_template_id: text(channelSettings.tiktokShippingTemplateId) } : {}),
        skus: [sku]
      },
      computed: { price, available, categoryId, warehouseId, dimensions, weight, imageCount: imageUris.length }
    };
  }

  function linkedSku(product = {}) {
    const listing = product.tiktokListing && typeof product.tiktokListing === 'object' ? product.tiktokListing : {};
    const remoteSkus = array(listing.skus || listing.raw?.skus);
    const remote = remoteSkus.find(row => text(row.seller_sku || row.sellerSku) === text(product.sku)) || (remoteSkus.length === 1 ? remoteSkus[0] : {});
    return {
      productId: text(listing.productId || listing.id),
      skuId: text(remote.id || remote.sku_id || remote.skuId || listing.skuId),
      warehouseId: text(product.tiktokWarehouseId || remote.inventory?.[0]?.warehouse_id || remote.inventory?.[0]?.warehouseId || listing.warehouseId)
    };
  }

  async function selectedProducts(payload = {}, linkedOnly = false) {
    const explicit = array(payload.skus).map(text).filter(Boolean);
    if (explicit.length) return deps.readProducts(explicit);
    return deps.listTikTokProducts({ linkedOnly, limit: Math.max(1, Math.min(5000, Number(payload.limit || 1000))) });
  }

  async function saveSnapshot(key, data) {
    return write(key, { ...data, syncedAt: stamp() });
  }

  async function run(job) {
    const payload = job.workerPayload || {};
    const operation = text(payload.operation || job.workerTask?.replace('tiktok-', ''));
    const report = path.join(artifactsDir, `${job.id}-tiktok-${operation}.ndjson`);
    fs.mkdirSync(artifactsDir, { recursive: true });
    let current = await persistJob(job, { status: 'running', phase: `fetching_${operation}`, startedAt: job.startedAt || stamp(), originalFilePath: report, originalFileName: `tiktok-${operation}.ndjson` });
    let processed = 0, changed = 0, failed = 0, unmatched = 0;
    const warnings = [];
    const record = row => { fs.appendFileSync(report, `${JSON.stringify({ ...row, at: stamp() })}\n`); processed += 1; if (row.error) failed += 1; };
    const check = async () => {
      const latest = await postgres.readOperationJob(job.id);
      if (['stopping', 'stopped', 'canceled', 'cancelled'].includes(text(latest?.status).toLowerCase())) throw fail('Job stopped.', 499);
      await enabled(gateFor(operation));
      const identity = await requireVerified();
      if (identity.current.id !== payload.channelId || identity.environment !== payload.environment || identity.credentialKey !== payload.credentialKey) throw fail('TikTok account, environment, or selected shop changed after this job was queued.', 409);
    };
    const progress = async message => { current = await persistJob(current, { processedRows: processed, changed, missingCount: failed + unmatched, message }); };

    try {
      await check();
      if (operation === 'orders') {
        const windows = dateWindows(payload.startDate, payload.endDate);
        for (let windowIndex = 0; windowIndex < windows.length; windowIndex += 1) {
          let pageToken = '';
          const seen = new Set();
          do {
            await check();
            if (pageToken && seen.has(pageToken)) throw fail('TikTok repeated an order page token; import stopped to avoid a loop.', 502);
            if (pageToken) seen.add(pageToken);
            const response = await client.request('/order/202309/orders/search', {
              method: 'POST', gate: 'tiktokOrdersEnabled', retryable: true, jobId: job.id, operation: 'Import TikTok orders',
              query: { page_size: 100, sort_field: 'update_time', sort_order: 'ASC', page_token: pageToken },
              body: { update_time_ge: dateSeconds(windows[windowIndex].start), update_time_lt: dateSeconds(windows[windowIndex].end) }
            });
            for (const raw of array(response.data?.orders)) {
              await check();
              try {
                const mapped = mapTikTokOrder(raw);
                const exists = await postgres.readChannelOrderForReturn('TikTok Shop', { orderId: mapped.marketplaceOrderId, existsOnly: true });
                const saved = await deps.saveOrder(mapped, { existingRefresh: Boolean(exists), historicalBackfill: payload.historicalBackfill === true, jobId: job.id });
                const action = saved?.action || (exists ? 'updated' : 'imported');
                if (action !== 'skipped') changed += 1;
                record({ orderId: mapped.marketplaceOrderId, localOrderId: saved?.order?.id || mapped.id, status: action });
              } catch (error) { record({ orderId: raw.id, error: error.message }); }
            }
            pageToken = text(response.data?.next_page_token);
            await progress(`Range ${windowIndex + 1}/${windows.length}: ${processed} TikTok orders checked; ${changed} imported or refreshed; ${failed} failed.`);
          } while (pageToken);
        }
      } else if (operation === 'returns') {
        const windows = dateWindows(payload.startDate, payload.endDate);
        for (let windowIndex = 0; windowIndex < windows.length; windowIndex += 1) {
          let pageToken = '';
          const seen = new Set();
          do {
            await check();
            if (pageToken && seen.has(pageToken)) throw fail('TikTok repeated a return page token; import stopped to avoid a loop.', 502);
            if (pageToken) seen.add(pageToken);
            const response = await client.request('/return_refund/202602/returns/search', {
              method: 'POST', gate: 'tiktokReturnsEnabled', retryable: true, jobId: job.id, operation: 'Import TikTok returns',
              query: { page_size: 50, sort_field: 'update_time', sort_order: 'ASC', page_token: pageToken },
              body: { update_time_ge: dateSeconds(windows[windowIndex].start), update_time_lt: dateSeconds(windows[windowIndex].end) }
            });
            const rows = array(response.data?.return_orders || response.data?.returns);
            for (const raw of rows) {
              await check();
              try {
                const result = await saveReturn(raw);
                if (result.order) changed += 1; else unmatched += 1;
                record({ returnId: raw.return_id, orderId: raw.order_id, localOrderId: result.order?.id || '', status: result.order ? 'matched' : 'unmatched' });
              } catch (error) { record({ returnId: raw.return_id, orderId: raw.order_id, error: error.message }); }
            }
            pageToken = text(response.data?.next_page_token);
            await progress(`Range ${windowIndex + 1}/${windows.length}: ${processed} TikTok returns checked; ${changed} matched; ${unmatched} unmatched; ${failed} failed.`);
          } while (pageToken);
        }
      } else if (operation === 'products') {
        let pageToken = '';
        const seen = new Set();
        do {
          await check();
          if (pageToken && seen.has(pageToken)) throw fail('TikTok repeated a product page token; reconciliation stopped.', 502);
          if (pageToken) seen.add(pageToken);
          const response = await client.request('/product/202502/products/search', {
            method: 'POST', gate: 'tiktokCatalogEnabled', retryable: true, jobId: job.id, operation: 'Reconcile TikTok products',
            query: { page_size: 100, page_token: pageToken }, body: {}
          });
          for (const raw of array(response.data?.products)) {
            const productId = text(raw.id);
            const sellerSkus = array(raw.skus).map(sku => text(sku.seller_sku)).filter(Boolean);
            await write(`tiktok.product.${productId}`, { productId, sellerSkus, status: text(raw.status), checkedAt: stamp(), raw });
            if (deps.saveProductSnapshot) await deps.saveProductSnapshot(raw);
            changed += 1;
            record({ productId, sellerSkus, status: text(raw.status) });
          }
          pageToken = text(response.data?.next_page_token);
          await progress(`${processed} TikTok products reconciled.`);
        } while (pageToken);
      } else if (operation === 'commerce') {
        const sources = [
          ['warehouses', '/logistics/202309/warehouses', {}],
          ['shipping-templates', '/logistics/202510/seller_templates', {}],
          ['categories', '/product/202309/categories', { category_version: 'v2', locale: 'en-US' }],
          ['customer-engagement-permissions', '/customer_engagement/202502/permissions', {}],
          ['customer-service-agent-settings', '/customer_service/202309/agents/settings', {}]
        ];
        for (const [name, apiPath, query] of sources) {
          await check();
          try {
            const response = await client.request(apiPath, { gate: 'tiktokCatalogEnabled', jobId: job.id, operation: `Sync TikTok ${name}`, query });
            await saveSnapshot(`tiktok.commerce.${name}`, { data: response.data || null, requestId: response.request_id || '' });
            changed += 1;
            record({ source: name, status: 'saved' });
          } catch (error) {
            warnings.push(`${name}: ${error.message}`);
            record({ source: name, error: error.message });
          }
          await progress(`${processed}/${sources.length} TikTok commerce sources checked.`);
        }
      } else if (operation === 'analytics') {
        const windows = dateWindows(payload.startDate, payload.endDate);
        const snapshots = [];
        for (let index = 0; index < windows.length; index += 1) {
          const range = { start_date_ge: windows[index].start.slice(0, 10), end_date_lt: windows[index].end.slice(0, 10), currency: 'LOCAL' };
          const sources = [
            ['shop', '/analytics/202509/shop/performance', { ...range, granularity: 'ALL' }],
            ['products', '/analytics/202509/shop_products/performance', { ...range, page_size: 100 }],
            ['skus', '/analytics/202509/shop_skus/performance', { ...range, page_size: 100 }],
            ['videos', '/analytics/202509/shop_videos/overview_performance', { ...range, granularity: 'ALL', account_type: 'ALL' }]
          ];
          for (const [name, apiPath, query] of sources) {
            await check();
            try {
              const response = await client.request(apiPath, { gate: 'tiktokAnalyticsEnabled', jobId: job.id, operation: `Sync TikTok ${name} analytics`, query });
              snapshots.push({ name, range, data: response.data || null, requestId: response.request_id || '' });
              changed += 1;
              record({ source: name, range: index + 1, status: 'saved' });
            } catch (error) {
              warnings.push(`${name} analytics: ${error.message}`);
              record({ source: name, range: index + 1, error: error.message });
            }
          }
          await progress(`Analytics range ${index + 1}/${windows.length}: ${processed} source responses checked.`);
        }
        await saveSnapshot('tiktok.analytics.summary', { range: { startDate: payload.startDate, endDate: payload.endDate }, snapshots });
      } else if (operation === 'affiliate') {
        const sources = [
          ['open-collaboration-settings', 'GET', '/affiliate_seller/202409/open_collaboration_settings', {}, undefined],
          ['open-collaborations', 'POST', '/affiliate_seller/202412/open_collaborations/search', { page_size: 50 }, {}],
          ['target-collaborations', 'POST', '/affiliate_seller/202508/target_collaborations/search', { page_size: 50 }, {}],
          ['creator-conversations', 'GET', '/affiliate_seller/202505/conversations', { page_size: 50 }, undefined]
        ];
        for (const [name, method, apiPath, query, body] of sources) {
          await check();
          try {
            const response = await client.request(apiPath, { method, gate: 'tiktokAffiliateEnabled', jobId: job.id, operation: `Sync TikTok ${name}`, query, ...(body === undefined ? {} : { body }) });
            await saveSnapshot(`tiktok.affiliate.${name}`, { data: response.data || null, requestId: response.request_id || '' });
            changed += 1;
            record({ source: name, status: 'saved' });
          } catch (error) {
            warnings.push(`${name}: ${error.message}`);
            record({ source: name, error: error.message });
          }
          await progress(`${processed}/${sources.length} TikTok affiliate sources checked.`);
        }
      } else if (operation === 'promotions') {
        const sources = [
          ['activities', '/promotion/202309/activities/search', {}, { page_size: 50 }],
          ['coupons', '/promotion/202406/coupons/search', { page_size: 50 }, {}]
        ];
        for (const [name, apiPath, query, body] of sources) {
          await check();
          try {
            const response = await client.request(apiPath, { method: body === undefined ? 'GET' : 'POST', gate: 'tiktokPromotionsEnabled', jobId: job.id, operation: `Sync TikTok ${name}`, query, ...(body === undefined ? {} : { body }) });
            await saveSnapshot(`tiktok.promotions.${name}`, { data: response.data || null, requestId: response.request_id || '' });
            changed += 1;
            record({ source: name, status: 'saved' });
          } catch (error) {
            warnings.push(`${name}: ${error.message}`);
            record({ source: name, error: error.message });
          }
          await progress(`${processed}/${sources.length} TikTok promotion sources checked.`);
        }
      } else if (operation === 'engagement') {
        const sources = [
          ['permissions', '/customer_engagement/202502/permissions', {}],
          ['customer-tab-visibility', '/customer_engagement/202501/customer_tab/visibility', {}],
          ['message-templates', '/customer_engagement/202412/message_templates', { locale: 'en-US' }]
        ];
        for (const [name, apiPath, query] of sources) {
          await check();
          try {
            const response = await client.request(apiPath, { gate: 'tiktokCustomerEngagementEnabled', jobId: job.id, operation: `Sync TikTok customer engagement ${name}`, query });
            await saveSnapshot(`tiktok.engagement.${name}`, { data: response.data || null, requestId: response.request_id || '' });
            changed += 1;
            record({ source: name, status: 'saved' });
          } catch (error) {
            warnings.push(`${name}: ${error.message}`);
            record({ source: name, error: error.message });
          }
          await progress(`${processed}/${sources.length} TikTok customer engagement sources checked.`);
        }
      } else if (operation === 'launch') {
        const products = await selectedProducts(payload, false);
        current = await persistJob(current, { totalRows: products.length, message: `${products.length} TikTok launch candidates loaded.` });
        const channelSettings = await settings();
        for (const product of products) {
          await check();
          const review = productListing(product, channelSettings);
          if (review.issues.length) {
            unmatched += 1;
            record({ sku: product.sku, status: 'not_ready', issues: review.issues });
            continue;
          }
          try {
            const existingProductId = text(review.listing.productId || review.listing.id);
            if (existingProductId) {
              record({ sku: product.sku, productId: existingProductId, status: 'already_linked' });
              continue;
            }
            const { save_mode: _saveMode, idempotency_key: _idempotencyKey, category_version: _categoryVersion, ...checkPayload } = review.payload;
            await client.request('/product/202309/products/listing_check', { method: 'POST', gate: 'tiktokLaunchEnabled', jobId: job.id, operation: `Check TikTok listing ${product.sku}`, body: checkPayload });
            const response = await client.request('/product/202309/products', { method: 'POST', gate: 'tiktokLaunchEnabled', jobId: job.id, operation: `Create TikTok product ${product.sku}`, body: review.payload });
            const remote = response.data || {};
            await deps.saveProductListing(product, {
              ...review.listing,
              productId: text(remote.product_id || remote.id || existingProductId),
              skus: array(remote.skus).length ? remote.skus : review.listing.skus,
              status: text(remote.status || 'PENDING'),
              lastSubmissionAt: stamp(),
              lastRequestId: text(response.request_id),
              lastSubmission: 'create'
            });
            changed += 1;
            record({ sku: product.sku, productId: remote.product_id || remote.id, status: 'submitted' });
          } catch (error) {
            record({ sku: product.sku, error: error.message, requestId: error.requestId || '' });
          }
          await progress(`${processed}/${products.length} TikTok launch candidates checked; ${changed} submitted; ${unmatched} not ready; ${failed} failed.`);
        }
      } else if (operation === 'inventory' || operation === 'price') {
        const products = await selectedProducts(payload, true);
        current = await persistJob(current, { totalRows: products.length, message: `${products.length} linked TikTok products loaded.` });
        const channelSettings = await settings();
        for (const product of products) {
          await check();
          const remote = linkedSku(product);
          if (!remote.productId || !remote.skuId) {
            unmatched += 1;
            record({ sku: product.sku, status: 'needs_relink' });
            continue;
          }
          const productStatus = text(product.status || product.productStatus || product.lifecycleStatus).toLowerCase();
          const sellingBlocked = product.active === false || product.toBeDiscontinued === true || ['inactive', 'discontinued', 'retired', 'deleted'].includes(productStatus);
          if (operation === 'price' && sellingBlocked) {
            record({ sku: product.sku, productId: remote.productId, status: 'skipped_inactive' });
            continue;
          }
          const available = sellingBlocked ? 0 : Math.max(0, Math.min(99_999, Math.floor(Number(product.available ?? product.qty ?? product.stockQty ?? 0) - Number(product.reserved || 0) - Number(channelSettings.tiktokInventorySafetyQty || 0))));
          const amount = Number(product.tiktokPrice || product.websitePrice || product.price || 0).toFixed(2);
          const body = operation === 'inventory'
            ? { skus: [{ id: remote.skuId, inventory: [{ ...(text(remote.warehouseId || channelSettings.tiktokWarehouseId) ? { warehouse_id: text(remote.warehouseId || channelSettings.tiktokWarehouseId) } : {}), quantity: available }] }] }
            : { skus: [{ id: remote.skuId, price: { amount, currency: text(channelSettings.tiktokCurrency || 'USD') || 'USD' } }] };
          const signature = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
          const stateKey = `tiktok.sync.${operation}.${remote.productId}`;
          const previous = await read(stateKey);
          if (previous?.signature === signature) {
            record({ sku: product.sku, productId: remote.productId, status: 'unchanged' });
            continue;
          }
          try {
            const endpoint = `/product/202309/products/${encodeURIComponent(remote.productId)}/${operation === 'inventory' ? 'inventory' : 'prices'}/update`;
            const response = await client.request(endpoint, { method: 'POST', gate: operation === 'inventory' ? 'tiktokInventoryEnabled' : 'tiktokPriceEnabled', jobId: job.id, operation: `Update TikTok ${operation} ${product.sku}`, body });
            await write(stateKey, { signature, sku: product.sku, productId: remote.productId, skuId: remote.skuId, submittedAt: stamp(), requestId: response.request_id || '', body });
            changed += 1;
            record({ sku: product.sku, productId: remote.productId, status: 'updated', value: operation === 'inventory' ? available : amount });
          } catch (error) {
            record({ sku: product.sku, productId: remote.productId, error: error.message, requestId: error.requestId || '' });
          }
          await progress(`${processed}/${products.length} TikTok ${operation} rows checked; ${changed} changed; ${unmatched} need relinking; ${failed} failed.`);
        }
      } else if (operation === 'webhook-setup') {
        const address = text(payload.callbackUrl);
        if (!/^https:\/\/[^\s]+$/i.test(address)) throw fail('A public HTTPS TikTok callback URL is required.', 409);
        current = await persistJob(current, { totalRows: EVENT_TOPICS.length, message: `${EVENT_TOPICS.length} TikTok webhook topics ready to configure.` });
        const results = [];
        for (const eventType of EVENT_TOPICS) {
          await check();
          try {
            const response = await client.request('/event/202309/webhooks', {
              method: 'PUT', gate: 'tiktokWebhooksEnabled', jobId: job.id, operation: `Subscribe TikTok ${eventType} webhook`, body: { event_type: eventType, address }
            });
            results.push({ eventType, status: 'subscribed', requestId: response.request_id || '' });
            changed += 1;
            record(results.at(-1));
          } catch (error) {
            results.push({ eventType, status: 'failed', error: error.message, requestId: error.requestId || '' });
            record({ ...results.at(-1), error: error.message });
          }
          await progress(`${processed}/${EVENT_TOPICS.length} TikTok webhook topics checked; ${changed} subscribed; ${failed} failed.`);
        }
        try {
          const response = await client.request('/event/202309/webhooks', { method: 'GET', gate: 'tiktokWebhooksEnabled', jobId: job.id, operation: 'Confirm TikTok webhook subscriptions' });
          await write('tiktok.webhooks.status', { subscriptions: array(response.data?.webhooks), callbackUrl: address, checkedAt: stamp(), requestId: response.request_id || '', results });
        } catch (error) {
          warnings.push(`Subscription verification: ${error.message}`);
        }
      } else if (operation === 'webhook') {
        const events = payload.eventIds?.length
          ? await Promise.all(payload.eventIds.map(eventId => read(`tiktok.webhook.event.${eventId}`)))
          : (await readMany('tiktok.webhook.event.', 500)).filter(event => event.state === 'pending');
        const eventSettings = await settings();
        const followups = new Set();
        for (const event of events.filter(Boolean)) {
          await check();
          const topic = text(event.topic);
          const entity = event.entity || {};
          try {
            const disabledGate = /ORDER|ADDRESS|PACKAGE|CANCELLATION/.test(topic) && eventSettings.tiktokOrdersEnabled !== true
              ? 'orders'
              : /RETURN|REVERSE/.test(topic) && eventSettings.tiktokReturnsEnabled !== true
                ? 'returns'
                : /PRODUCT|INVENTORY/.test(topic) && eventSettings.tiktokCatalogEnabled !== true
                  ? 'catalog'
                  : /NEW_(CONVERSATION|MESSAGE)/.test(topic) && eventSettings.tiktokMessagesEnabled !== true
                    ? 'messages'
                    : '';
            if (disabledGate) {
              await write(`tiktok.webhook.event.${event.eventId}`, { ...event, state: 'processed', processedAt: stamp(), skipped: `${disabledGate}_disabled` });
              record({ eventId: event.eventId, topic, entity, status: `skipped_${disabledGate}_disabled` });
              await progress(`${processed}/${events.length} TikTok events reconciled.`);
              continue;
            }
            if (/ORDER|ADDRESS|PACKAGE|CANCELLATION/.test(topic) && entity.orderId) {
              const response = await client.request('/order/202507/orders', { gate: 'tiktokOrdersEnabled', jobId: job.id, operation: `Reconcile TikTok order event ${entity.orderId}`, query: { ids: entity.orderId } });
              const raw = array(response.data?.orders)[0];
              if (!raw) throw fail(`TikTok order ${entity.orderId} was not returned for its webhook event.`, 502);
              const mapped = mapTikTokOrder(raw);
              const exists = await postgres.readChannelOrderForReturn('TikTok Shop', { orderId: mapped.marketplaceOrderId, existsOnly: true });
              await deps.saveOrder(mapped, { existingRefresh: Boolean(exists), historicalBackfill: false, jobId: job.id });
            } else if (/PRODUCT|INVENTORY/.test(topic) && entity.productId) {
              const response = await client.request(`/product/202309/products/${encodeURIComponent(entity.productId)}`, { gate: 'tiktokCatalogEnabled', jobId: job.id, operation: `Reconcile TikTok product event ${entity.productId}` });
              if (response.data?.product && deps.saveProductSnapshot) await deps.saveProductSnapshot(response.data.product);
            } else if (/NEW_(CONVERSATION|MESSAGE)/.test(topic) && entity.conversationId) {
              await conversationDetail(entity.conversationId, true);
            } else {
              const next = reconcileOperation(topic);
              if (next) followups.add(next);
            }
            if (topic === 'INVENTORY_CHANGED_BY_SHOP') await write(`tiktok.inventory-event.${event.eventId}`, { eventId: event.eventId, entity, data: event.payload?.data || {}, receivedAt: event.receivedAt, note: 'Channel inventory snapshot retained as evidence; DataPlus inventory remains the source of truth.' });
            await write(`tiktok.webhook.event.${event.eventId}`, { ...event, state: 'processed', processedAt: stamp() });
            changed += 1;
            record({ eventId: event.eventId, topic, entity, status: 'processed' });
          } catch (error) {
            await write(`tiktok.webhook.event.${event.eventId}`, { ...event, state: 'failed', failedAt: stamp(), error: error.message });
            record({ eventId: event.eventId, topic, error: error.message });
          }
          await progress(`${processed}/${events.length} TikTok events reconciled.`);
        }
        for (const next of followups) {
          try { await queue(next, { lookbackDays: 2, actor: 'system:tiktok-webhook' }); }
          catch (error) { warnings.push(`${next} follow-up: ${error.message}`); }
        }
      } else if (operation === 'live') {
        const windows = dateWindows(payload.startDate, payload.endDate);
        const accountTypes = ['OFFICIAL_ACCOUNTS', 'MARKETING_ACCOUNTS', 'AFFILIATE_ACCOUNTS'];
        const sessionsById = new Map();
        const overview = [];
        let analyticsSucceeded = false;

        for (let windowIndex = 0; windowIndex < windows.length; windowIndex += 1) {
          const window = windows[windowIndex];
          try {
            const response = await client.request('/analytics/202609/shop_lives/overview_performance', {
              gate: 'tiktokLiveAnalyticsEnabled', jobId: job.id, operation: 'Read TikTok LIVE overview',
              query: { start_date_ge: window.start.slice(0, 10), end_date_lt: window.end.slice(0, 10), granularity: 'ALL', currency: 'LOCAL', account_type: 'ALL' }
            });
            overview.push({ startDate: window.start.slice(0, 10), endDate: window.end.slice(0, 10), data: response.data || null });
            analyticsSucceeded = true;
          } catch (error) {
            warnings.push(`LIVE overview ${windowIndex + 1}/${windows.length}: ${error.message}`);
          }

          for (const accountType of accountTypes) {
            let pageToken = '';
            const seenTokens = new Set();
            try {
              do {
                await check();
                if (pageToken && seenTokens.has(pageToken)) throw fail('TikTok repeated a LIVE analytics page token; synchronization stopped for this account type.', 502);
                if (pageToken) seenTokens.add(pageToken);
                const response = await client.request('/analytics/202609/shop_lives/performance', {
                  gate: 'tiktokLiveAnalyticsEnabled', jobId: job.id, operation: `Read TikTok LIVE sessions (${accountType})`,
                  query: {
                    start_date_ge: window.start.slice(0, 10), end_date_lt: window.end.slice(0, 10),
                    page_size: 100, page_token: pageToken, sort_field: 'gmv', sort_order: 'DESC', currency: 'LOCAL', account_type: accountType
                  }
                });
                const rows = [
                  ...array(response.data?.live_stream_sessions),
                  ...array(response.data?.live_sessions),
                  ...array(response.data?.lives)
                ];
                for (const raw of rows) {
                  const session = normalizeTikTokLiveSession(raw, accountType);
                  if (!session.liveId) {
                    warnings.push(`TikTok returned a LIVE session without an ID for ${accountType}.`);
                    continue;
                  }
                  sessionsById.set(session.liveId, session);
                }
                analyticsSucceeded = true;
                pageToken = text(response.data?.next_page_token);
              } while (pageToken);
            } catch (error) {
              warnings.push(`${accountType.replaceAll('_', ' ')} LIVE list: ${error.message}`);
            }
          }
          await progress(`LIVE range ${windowIndex + 1}/${windows.length}: ${sessionsById.size} sessions discovered.`);
        }

        const sessions = [...sessionsById.values()].sort((left, right) => String(right.startTime).localeCompare(String(left.startTime)));
        for (let index = 0; index < sessions.length; index += 1) {
          await check();
          const session = sessions[index];
          let products = [];
          let productWarning = '';
          const affiliateHosted = session.accountType === 'AFFILIATE_ACCOUNTS';
          try {
            if (affiliateHosted) {
              const saved = { ...session, products, productUnavailableReason: 'TikTok exposes this product-performance endpoint only for official and marketing-account LIVE sessions.', syncedAt: stamp() };
              sessionsById.set(session.liveId, saved);
              await write(`tiktok.live.session.${session.liveId}`, saved);
              changed += 1;
              record({ liveId: session.liveId, accountType: session.accountType, title: session.title, products: 0, status: 'session_saved_affiliate_product_detail_unavailable' });
              if ((index + 1) % 10 === 0 || index === sessions.length - 1) await progress(`${index + 1}/${sessions.length} TikTok LIVE sessions saved with product performance.`);
              continue;
            }
            const response = await client.request(`/analytics/202512/shop/${encodeURIComponent(session.liveId)}/products_performance`, {
              gate: 'tiktokLiveAnalyticsEnabled', jobId: job.id, operation: `Read TikTok LIVE ${session.liveId} products`,
              query: { sort_field: 'gmv', sort_order: 'DESC', currency: 'LOCAL' }
            });
            products = array(response.data?.products).map(normalizeTikTokLiveProduct);
          } catch (error) {
            productWarning = error.message;
            warnings.push(`LIVE ${session.liveId} product performance: ${error.message}`);
          }
          const saved = { ...session, products, productWarning, syncedAt: stamp() };
          sessionsById.set(session.liveId, saved);
          await write(`tiktok.live.session.${session.liveId}`, saved);
          changed += 1;
          record({ liveId: session.liveId, accountType: session.accountType, title: session.title, products: products.length, status: productWarning ? 'session_saved_product_scope_warning' : 'session_saved' });
          if ((index + 1) % 10 === 0 || index === sessions.length - 1) await progress(`${index + 1}/${sessions.length} TikTok LIVE sessions saved with product performance.`);
        }

        const liveSettings = await settings();
        let attributionAvailable = null;
        let attributionChecked = 0;
        let attributedLiveOrders = 0;
        let attributedMatched = 0;
        let attributedUnmatched = 0;
        let attributionWarning = '';
        if (liveSettings.tiktokLiveOrderAttributionEnabled === true) {
          attributionAvailable = false;
          try {
            for (let windowIndex = 0; windowIndex < windows.length; windowIndex += 1) {
              let pageToken = '';
              const seenTokens = new Set();
              do {
                await check();
                if (pageToken && seenTokens.has(pageToken)) throw fail('TikTok repeated an affiliate-order page token; LIVE attribution stopped.', 502);
                if (pageToken) seenTokens.add(pageToken);
                const response = await client.request('/affiliate_seller/202410/orders/search', {
                  method: 'POST', gate: 'tiktokLiveAnalyticsEnabled', retryable: true, jobId: job.id, operation: 'Read TikTok LIVE order attribution',
                  query: { page_size: 100, page_token: pageToken },
                  body: { create_time_ge: dateSeconds(windows[windowIndex].start), create_time_lt: dateSeconds(windows[windowIndex].end) }
                });
                attributionAvailable = true;
                for (const raw of array(response.data?.orders)) {
                  attributionChecked += 1;
                  const attribution = normalizeTikTokLiveAttribution(raw);
                  if (!attribution.isLive || !attribution.orderId) continue;
                  attributedLiveOrders += 1;
                  await write(`tiktok.live.order.${attribution.orderId}`, { ...attribution, syncedAt: stamp() });
                  const order = await postgres.readChannelOrderForReturn('TikTok Shop', { orderId: attribution.orderId });
                  if (!order) {
                    attributedUnmatched += 1;
                    unmatched += 1;
                    record({ orderId: attribution.orderId, contentIds: attribution.contentIds, status: 'live_order_not_imported' });
                    continue;
                  }
                  await postgres.saveOrder(applyTikTokLiveAttribution(order, attribution));
                  attributedMatched += 1;
                  changed += 1;
                  record({ orderId: attribution.orderId, localOrderId: order.id, contentTypes: attribution.contentTypes, contentIds: attribution.contentIds, creators: attribution.creators, status: 'live_attribution_saved' });
                }
                pageToken = text(response.data?.next_page_token);
                await progress(`${attributionChecked} affiliate orders checked; ${attributedMatched} TikTok LIVE orders enriched; ${attributedUnmatched} not imported.`);
              } while (pageToken);
            }
          } catch (error) {
            attributionWarning = error.message;
            warnings.push(`LIVE order attribution: ${error.message}`);
          }
        }

        const savedSessions = [...sessionsById.values()].sort((left, right) => String(right.startTime).localeCompare(String(left.startTime)));
        await write('tiktok.live.summary', {
          syncedAt: stamp(),
          range: { startDate: payload.startDate, endDate: payload.endDate },
          metrics: summarizeTikTokLiveSessions(savedSessions),
          sessions: savedSessions.slice(0, 500),
          overview,
          analytics: { available: analyticsSucceeded, warning: warnings.filter(message => /LIVE (overview|list|session)|ACCOUNTS LIVE list|product performance/i.test(message)).join(' ') },
          attribution: {
            enabled: liveSettings.tiktokLiveOrderAttributionEnabled === true,
            available: attributionAvailable,
            checked: attributionChecked,
            liveOrders: attributedLiveOrders,
            matched: attributedMatched,
            unmatched: attributedUnmatched,
            warning: attributionWarning
          }
        });
      } else if (operation === 'messages') {
        let pageToken = '';
        const seen = new Set();
        do {
          await check();
          if (pageToken && seen.has(pageToken)) throw fail('TikTok repeated a conversation page token; sync stopped.', 502);
          if (pageToken) seen.add(pageToken);
          const response = await client.request('/customer_service/202309/conversations', {
            gate: 'tiktokMessagesEnabled', jobId: job.id, operation: 'Sync TikTok conversations', query: { page_size: 50, page_token: pageToken }
          });
          for (const conversation of array(response.data?.conversations)) {
            await write(`tiktok.conversation.${text(conversation.id)}`, { ...conversation, syncedAt: stamp() });
            changed += 1;
            record({ conversationId: conversation.id, unreadCount: conversation.unread_count, canSendMessage: conversation.can_send_message });
          }
          pageToken = text(response.data?.next_page_token);
          await progress(`${processed} TikTok conversations synchronized.`);
        } while (pageToken);
      } else if (operation === 'settlements') {
        if (!feeStore || !settlementScope) throw fail('TikTok settlement storage is unavailable.', 503);
        let pageToken = '';
        const seenStatementTokens = new Set();
        const statements = [];
        do {
          await check();
          if (pageToken && seenStatementTokens.has(pageToken)) throw fail('TikTok repeated a statement page token; import stopped to avoid a loop.', 502);
          if (pageToken) seenStatementTokens.add(pageToken);
          const response = await client.request('/finance/202309/statements', {
            gate: 'tiktokSettlementImportEnabled', jobId: job.id, operation: 'Discover TikTok statements',
            query: { page_size: 50, page_token: pageToken, sort_field: 'statement_time', sort_order: 'ASC', statement_time_ge: dateSeconds(payload.startDate), statement_time_lt: dateSeconds(payload.endDate) }
          });
          statements.push(...array(response.data?.statements));
          pageToken = text(response.data?.next_page_token);
        } while (pageToken);
        current = await persistJob(current, { phase: 'importing_statements', totalRows: statements.length, message: `${statements.length} TikTok statements found.` });
        for (const statement of statements) {
          await check();
          const statementId = text(statement.id);
          if (!statementId) { record({ error: 'Statement is missing its ID.' }); continue; }
          let transactionToken = '';
          const seenTransactionTokens = new Set();
          const transactions = [];
          do {
            await check();
            if (transactionToken && seenTransactionTokens.has(transactionToken)) throw fail(`TikTok repeated a transaction page token for statement ${statementId}; import stopped to avoid a loop.`, 502);
            if (transactionToken) seenTransactionTokens.add(transactionToken);
            const response = await client.request(`/finance/202501/statements/${encodeURIComponent(statementId)}/statement_transactions`, {
              gate: 'tiktokSettlementImportEnabled', jobId: job.id, operation: `Import TikTok statement ${statementId}`,
              query: { page_size: 50, page_token: transactionToken, sort_field: 'order_create_time', sort_order: 'ASC' }
            });
            transactions.push(...array(response.data?.transactions));
            transactionToken = text(response.data?.next_page_token);
          } while (transactionToken);
          const rows = transactions.flatMap(transaction => componentRows({ ...transaction, currency: transaction.currency || statement.currency }, statementId));
          const result = await feeStore.importApiSettlement(settlementScope, {
            channel: 'TikTok Shop',
            externalSettlementId: statementId,
            currency: text(statement.currency || 'USD'),
            payoutAmount: statement.settlement_amount,
            payoutDate: isoFromSeconds(statement.payment_time || statement.statement_time),
            payoutStatus: text(statement.payment_status),
            transactionCount: transactions.length,
            periodStart: payload.startDate.slice(0, 10),
            periodEnd: payload.endDate.slice(0, 10),
            sourceApiReference: `/finance/202501/statements/${statementId}/statement_transactions`,
            fileName: `tiktok-statement-${statementId}.json`,
            rows,
            raw: { statement, transactionCount: transactions.length, settlementLineCount: rows.length }
          });
          changed += result.duplicate ? 0 : 1;
          unmatched += Number(result.unmatched || 0);
          record({ statementId, transactions: transactions.length, feeLines: rows.length, matched: result.matched, unmatched: result.unmatched, duplicate: result.duplicate });
          await progress(`${processed}/${statements.length} TikTok statements checked; ${changed} imported; ${unmatched} lines need review.`);
        }
      } else throw fail('Unsupported TikTok worker operation.', 400);

      const warning = failed || unmatched || warnings.length;
      const finalStatus = warning ? 'warning' : 'success';
      const finalMessage = `${processed} TikTok ${operation} records checked; ${changed} saved; ${unmatched} unmatched; ${failed} failed${warnings.length ? `; ${warnings.length} scope or API warning${warnings.length === 1 ? '' : 's'}` : ''}.`;
      await persistJob(current, {
        status: finalStatus, phase: 'complete', finishedAt: stamp(), progressPercent: 100,
        processedRows: processed, totalRows: processed, changed, missingCount: failed + unmatched + warnings.length,
        message: finalMessage, errors: warnings,
        artifacts: [{ name: 'TikTok API evidence', fileName: path.basename(report), filePath: report, contentType: 'application/x-ndjson' }]
      });
      if (operation === 'settlements') {
        const previous = await read('tiktok.schedule.settlements');
        await write('tiktok.schedule.settlements', { ...(previous || {}), lastCompletedAt: stamp(), lastJobId: job.id, lastStatus: finalStatus, lastMessage: finalMessage, lastError: '' });
      }
      if (operation === 'live') {
        const previous = await read('tiktok.schedule.live');
        await write('tiktok.schedule.live', { ...(previous || {}), lastCompletedAt: stamp(), lastJobId: job.id, lastStatus: finalStatus, lastMessage: finalMessage, lastError: warnings.join(' ') });
      }
    } catch (error) {
      await persistJob(current, { status: error.statusCode === 499 ? 'stopped' : 'failed', phase: error.statusCode === 499 ? 'stopped' : 'failed', finishedAt: stamp(), processedRows: processed, changed, missingCount: failed + unmatched + 1, errors: [error.message], message: error.message });
      if (operation === 'settlements') {
        const previous = await read('tiktok.schedule.settlements').catch(() => null);
        await write('tiktok.schedule.settlements', { ...(previous || {}), lastCompletedAt: stamp(), lastJobId: job.id, lastStatus: error.statusCode === 499 ? 'stopped' : 'failed', lastMessage: error.message, lastError: error.message }).catch(() => {});
      }
      if (operation === 'live') {
        const previous = await read('tiktok.schedule.live').catch(() => null);
        await write('tiktok.schedule.live', { ...(previous || {}), lastCompletedAt: stamp(), lastJobId: job.id, lastStatus: error.statusCode === 499 ? 'stopped' : 'failed', lastMessage: error.message, lastError: error.message }).catch(() => {});
      }
    }
  }

  function isoFromSeconds(value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return new Date(numeric * 1000).toISOString();
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }

  async function fulfillmentServices(body = {}) {
    await requireVerified();
    await enabled('tiktokFulfillmentEnabled');
    await enabled('tiktokLabelPurchaseEnabled');
    const orderId = text(body.orderId);
    if (!orderId) throw fail('Choose a TikTok Shop order.', 400);
    const requestBody = body.package && typeof body.package === 'object' ? body.package : {};
    return client.request(`/fulfillment/202309/orders/${encodeURIComponent(orderId)}/shipping_services/query`, {
      method: 'POST', gate: 'tiktokLabelPurchaseEnabled', body: requestBody, operation: 'Quote TikTok shipping services'
    });
  }

  async function previewPackage(body = {}, actor = '') {
    const identity = await requireVerified();
    await enabled('tiktokFulfillmentEnabled');
    await enabled('tiktokLabelPurchaseEnabled');
    const payload = body.package && typeof body.package === 'object' ? body.package : null;
    if (!payload?.order_id || !payload?.shipping_service_id || !payload?.weight || !payload?.dimension) throw fail('Order, shipping service, weight, and dimensions are required.', 400);
    const token = crypto.randomUUID();
    const preview = { token, actor, state: 'preview', payload, channelId: identity.current.id, environment: identity.environment, credentialKey: identity.credentialKey, createdAt: stamp(), expiresAt: Date.now() + 15 * 60_000 };
    await write(`tiktok.package-preview.${token}`, preview);
    return { token, payload, expiresAt: preview.expiresAt, message: 'TikTok label package is ready for final confirmation. No label has been purchased yet.' };
  }

  async function createPackage(token, actor = '') {
    const key = `tiktok.package-preview.${text(token)}`;
    const preview = await read(key);
    if (!preview || preview.actor !== actor || preview.state !== 'preview' || Number(preview.expiresAt) < Date.now()) throw fail('A valid package preview owned by your user is required.', 409);
    const identity = await requireVerified();
    if (preview.channelId !== identity.current.id || preview.environment !== identity.environment || preview.credentialKey !== identity.credentialKey) throw fail('TikTok account or shop changed after preview. Review the package again.', 409);
    await enabled('tiktokFulfillmentEnabled');
    await enabled('tiktokLabelPurchaseEnabled');
    const applyingAt = stamp();
    const claimed = await postgres.getPool().query(`update tiktok_documents
      set data=data||$2::jsonb,updated_at=now()
      where doc_key=$1 and data->>'state'='preview' and data->>'actor'=$3
        and (data->>'expiresAt')::bigint >= $4
      returning data`, [key, JSON.stringify({ state: 'applying', applyingAt }), actor, Date.now()]);
    if (!claimed.rowCount) throw fail('This TikTok package preview was already used, expired, or is being processed.', 409);
    const claimedPreview = claimed.rows[0].data;
    try {
      const result = await client.request('/fulfillment/202512/packages', { method: 'POST', gate: 'tiktokLabelPurchaseEnabled', body: claimedPreview.payload, operation: 'Purchase TikTok shipping label' });
      const applied = { ...claimedPreview, state: 'applied', appliedAt: stamp(), result };
      await write(key, applied);
      const packageId = text(result.data?.package_id || result.data?.id);
      if (packageId) await write(`tiktok.package.${packageId}`, { packageId, previewToken: text(token), actor, createdAt: applied.appliedAt, payload: claimedPreview.payload, result });
      return { ...result, message: 'TikTok package created. Download the shipping document before printing.' };
    } catch (error) {
      await write(key, { ...claimedPreview, state: 'reconciliation_required', failedAt: stamp(), error: error.message });
      throw fail(`${error.message} The preview was locked to prevent a duplicate label; reconcile the order in TikTok Shop before trying again.`, error.statusCode || 502, { requestId: error.requestId || '' });
    }
  }

  async function shippingDocument(packageId) {
    await requireVerified();
    await enabled('tiktokFulfillmentEnabled');
    await enabled('tiktokLabelPurchaseEnabled');
    if (!text(packageId)) throw fail('Package ID is required.', 400);
    return client.request(`/fulfillment/202309/packages/${encodeURIComponent(packageId)}/shipping_documents`, { gate: 'tiktokLabelPurchaseEnabled', operation: 'Download TikTok shipping document' });
  }

  async function handle(req, res, url, actor, sendJson, parseBody) {
    const actorId = typeof actor === 'string' ? actor : text(actor?.id);
    const action = url.pathname.replace(/^\/api\/tiktok\/?/, '').replace(/\/+$/, '');
    try {
      let result;
      if (req.method === 'GET' && action === 'status') result = await publicStatus();
      else if (req.method === 'GET' && action === 'live') result = await publicLiveStatus();
      else if (req.method === 'GET' && action === 'workspace') result = await publicWorkspace();
      else if (req.method === 'GET' && action === 'capabilities') result = { capabilities: CAPABILITIES };
      else if (req.method === 'GET' && action === 'webhooks/status') result = await webhookStatus(true, req);
      else if (req.method === 'POST' && action === 'webhooks/setup') result = await setupWebhooks(req);
      else if (req.method === 'GET' && action === 'messages') result = await listConversations({ q: url.searchParams.get('q'), unreadOnly: url.searchParams.get('unread') === 'true', limit: url.searchParams.get('limit') });
      else if (req.method === 'GET' && /^messages\/[^/]+$/.test(action)) result = await conversationDetail(decodeURIComponent(action.split('/')[1]), url.searchParams.get('refresh') !== 'false');
      else if (req.method === 'POST' && /^messages\/[^/]+\/read$/.test(action)) result = await markConversationRead(decodeURIComponent(action.split('/')[1]));
      else if (req.method === 'POST' && /^messages\/[^/]+\/send$/.test(action)) result = await sendConversationMessage(decodeURIComponent(action.split('/')[1]), await parseBody(req));
      else if (req.method === 'POST' && action === 'credentials') {
        const body = await parseBody(req);
        if (!deps.canManageCredentials(actor)) throw fail('Channel credential permission is required.', 403);
        const saved = credentials.save(body.environment || 'production', body);
        result = {
          ...saved,
          message: saved.appConfigured
            ? 'TikTok Shop app credentials saved. Continue with seller authorization to generate the access and refresh tokens.'
            : 'TikTok Shop app key and secret saved. Add the Service ID when you are ready to connect the seller account.'
        };
        log({ channel: 'TikTok Shop', transport: 'Settings', method: 'UPDATE', path: 'credentials', operation: 'Save TikTok Shop credentials', statusCode: 200, ok: true, message: `Updated ${result.environment} credentials; secrets remain masked.` });
      } else if (req.method === 'POST' && action === 'connection/verify') result = await verifyConnection();
      else if (req.method === 'POST' && action === 'shops/select') {
        const body = await parseBody(req);
        const current = await enabled();
        const environment = current.settings?.tiktokEnvironment === 'development' ? 'development' : 'production';
        const connection = await read('tiktok.connection');
        const shop = array(connection?.shops).find(row => text(row.cipher) === text(body.shopCipher));
        if (!shop) throw fail('Choose a shop returned by the latest connection verification.', 409);
        result = { ...credentials.selectShop(environment, shop), message: `${shop.name || 'TikTok Shop'} selected. Verify the connection again before running jobs.` };
        log({ channel: 'TikTok Shop', transport: 'Settings', method: 'UPDATE', path: 'shops/select', operation: 'Select TikTok Shop', statusCode: 200, ok: true, message: `Selected ${shop.name || shop.code || shop.id || 'authorized shop'}.` });
      } else if (req.method === 'POST' && action.startsWith('jobs/')) {
        const body = await parseBody(req);
        result = await queue(action.slice(5), { ...body, actor: actorId });
      } else if (req.method === 'POST' && action === 'fulfillment/services') result = await fulfillmentServices(await parseBody(req));
      else if (req.method === 'POST' && action === 'fulfillment/packages/preview') result = await previewPackage(await parseBody(req), actorId);
      else if (req.method === 'POST' && action === 'fulfillment/packages/apply') result = await createPackage((await parseBody(req)).token, actorId);
      else if (req.method === 'GET' && action.startsWith('fulfillment/packages/') && action.endsWith('/document')) {
        const packageId = decodeURIComponent(action.split('/')[2] || '');
        result = await shippingDocument(packageId);
      } else throw fail('TikTok Shop route not found.', 404);
      sendJson(res, result?.job ? 202 : 200, result);
    } catch (error) {
      sendJson(res, error.statusCode || 500, { error: error.message, requestId: error.requestId || '' });
    }
    return true;
  }

  let lastScheduleCheck = 0;
  async function schedule() {
    if (Date.now() - lastScheduleCheck < 60_000) return;
    lastScheduleCheck = Date.now();
    const current = await channel();
    const s = current?.settings || {};
    if (s.channelEnabled !== true) return;
    const scheduleOperation = async (operation, enabledKey, scheduleKey, hoursKey, daysKey, fallbackHours, fallbackDays) => {
      if (s[enabledKey] !== true || s[scheduleKey] !== true) return;
      const key = `tiktok.schedule.${operation}`;
      const previous = await read(key);
      const hours = clamp(s[hoursKey], 1, 24, fallbackHours);
      if (previous?.queuedAt && Date.now() - Date.parse(previous.queuedAt) < hours * 3_600_000) return;
      const result = await queue(operation, { scheduled: true, actor: `system:tiktok-${operation}`, lookbackDays: clamp(s[daysKey], 1, operation === 'orders' ? 365 : 180, fallbackDays) });
      if (!result.duplicate) await write(key, { queuedAt: stamp(), jobId: result.job.id, intervalHours: hours });
    };
    await scheduleOperation('orders', 'tiktokOrdersEnabled', 'tiktokOrderScheduleEnabled', 'tiktokOrderScheduleHours', 'tiktokOrderLookbackDays', 1, 30);
    await scheduleOperation('returns', 'tiktokReturnsEnabled', 'tiktokReturnScheduleEnabled', 'tiktokReturnScheduleHours', 'tiktokReturnLookbackDays', 2, 30);
    await scheduleOperation('settlements', 'tiktokSettlementImportEnabled', 'tiktokSettlementScheduleEnabled', 'tiktokSettlementScheduleHours', 'tiktokSettlementLookbackDays', 24, 45);
    await scheduleOperation('live', 'tiktokLiveAnalyticsEnabled', 'tiktokLiveScheduleEnabled', 'tiktokLiveScheduleHours', 'tiktokLiveLookbackDays', 24, 30);
    await scheduleOperation('messages', 'tiktokMessagesEnabled', 'tiktokMessageScheduleEnabled', 'tiktokMessageScheduleHours', 'tiktokOrderLookbackDays', 1, 7);
    await scheduleOperation('analytics', 'tiktokAnalyticsEnabled', 'tiktokAnalyticsScheduleEnabled', 'tiktokAnalyticsScheduleHours', 'tiktokAnalyticsLookbackDays', 24, 30);
    if (s.tiktokWebhooksEnabled === true) {
      const pending = await postgres.getPool().query(`select 1 from tiktok_documents where doc_key like 'tiktok.webhook.event.%' and data->>'state'='pending' limit 1`);
      if (pending.rowCount) await queue('webhook', { scheduled: true, actor: 'system:tiktok-webhook-recovery', lookbackDays: 1 });
    }
    const retention = await read('tiktok.retention');
    if (!retention?.checkedAt || Date.now() - Date.parse(retention.checkedAt) >= 86_400_000) {
      const removed = await postgres.getPool().query(`
        delete from tiktok_documents
        where (doc_key like 'tiktok.webhook.event.%' and updated_at < now() - interval '365 days')
           or (doc_key like 'tiktok.package-preview.%' and updated_at < now() - interval '7 days')
      `);
      await write('tiktok.retention', { checkedAt: stamp(), removed: removed.rowCount });
    }
  }

  return {
    handle, publicStatus, publicLiveStatus, publicWorkspace, queue, run, schedule, verifyConnection,
    webhookStatus, setupWebhooks, receiveWebhook,
    listConversations, conversationDetail, markConversationRead, sendConversationMessage,
    fulfillmentServices, previewPackage, createPackage, shippingDocument
  };
}

module.exports = { CAPABILITIES, createTikTokMarketplace };
