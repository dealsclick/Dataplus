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
const normalizedCategoryName = value => text(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function productCategoryContext(product = {}) {
  const productType = text(
    product.productType
    || product.mainCategory
    || product.category
    || product.attributes?.productType
    || product.productManagerFields?.productType
    || product.sourceCategory
    || product.vendorCategory
  );
  return {
    productType,
    key: normalizedCategoryName(productType),
    source: product.productType ? 'product_type' : (product.mainCategory || product.category) ? 'main_category' : product.sourceCategory || product.vendorCategory ? 'source_category' : ''
  };
}

function recommendedCategory(response = {}, requiredFamily = '') {
  const categories = array(response.data?.categories).map(category => ({
    id: text(category?.id),
    name: text(category?.name),
    level: Number(category?.level || 0),
    isLeaf: category?.is_leaf === true,
    permissionStatuses: array(category?.permission_statuses).map(text).filter(Boolean)
  })).filter(category => category.id);
  const categoryId = text(response.data?.leaf_category_id);
  const leaf = categories.find(category => category.id === categoryId) || categories.find(category => category.isLeaf) || null;
  const categoryPath = categories
    .slice()
    .sort((left, right) => left.level - right.level)
    .map(category => category.name)
    .filter(Boolean);
  const family = normalizedCategoryName(requiredFamily);
  const familyMatched = !family || categoryPath.some(name => normalizedCategoryName(name) === family);
  const permissionStatuses = [...new Set((leaf?.permissionStatuses || []).map(text).filter(Boolean))];
  const available = !permissionStatuses.length || permissionStatuses.includes('AVAILABLE');
  return {
    categoryId: text(leaf?.id || categoryId),
    categoryName: text(leaf?.name),
    categoryPath,
    familyMatched,
    available,
    permissionStatuses
  };
}
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
  { key: 'liveProducts', label: 'LIVE product pinning and ordering', state: 'foundation', api: 'Seller shop creators 202407 / Affiliate LIVE products 202309', note: 'DataPlus detects the shop official account with the seller token. Automated LIVE product controls require that same official TikTok account to grant separate creator-side authorization.' },
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
  const studioCache = new Map();

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
  const creatorClient = createTikTokClient({
    channel,
    credentials: {
      get: (environment, accountId) => credentials.getCreator(environment, accountId),
      updateTokens: (environment, token, accountId) => credentials.updateCreatorTokens(environment, token, accountId),
      fingerprint: (environment, accountId) => credentials.creatorFingerprint(environment, accountId)
    },
    log
  });
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
  const accountSuffix = accountId => crypto.createHash('sha256').update(text(accountId)).digest('hex').slice(0, 20);
  const connectionKey = accountId => `tiktok.connection.${accountSuffix(accountId)}`;
  const accountDocumentKey = (accountId, name) => `tiktok.account.${accountSuffix(accountId)}.${name}`;
  const scheduleDocumentKey = (accountId, operation) => accountDocumentKey(accountId, `schedule.${operation}`);
  const orderCheckpointKey = accountId => accountDocumentKey(accountId, 'orders.checkpoint');
  const initialSetupKey = accountId => accountDocumentKey(accountId, 'initial-setup');
  const conversationKey = (accountId, conversationId) => accountDocumentKey(accountId, `conversation.${text(conversationId)}`);
  const conversationPrefix = accountId => `${accountDocumentKey(accountId, 'conversation')}.`;

  async function accountIdentity(accountId = '') {
    const current = await enabled();
    const environment = current.settings?.tiktokEnvironment === 'development' ? 'development' : 'production';
    const saved = credentials.get(environment, accountId);
    if (!saved.accountId) throw fail('Connect or select a TikTok Shop seller account first.', 409);
    return { current, environment, accountId: saved.accountId, accountName: saved.shopName || saved.label || saved.openId || saved.accountId, credentialKey: credentials.fingerprint(environment, saved.accountId) };
  }

  async function verifyConnection(accountId = '') {
    const identity = await accountIdentity(accountId);
    const { current, environment } = identity;
    await write(connectionKey(identity.accountId), {
      verified: false,
      channelId: current.id,
      environment,
      accountId: identity.accountId,
      credentialKey: credentials.fingerprint(environment, identity.accountId),
      verificationStartedAt: stamp(),
      message: 'TikTok Shop verification is in progress.'
    });
    let shopResponse;
    try {
      shopResponse = await client.request('/authorization/202309/shops', { accountId: identity.accountId, shopScoped: false, operation: 'Verify TikTok authorized shops' });
    } catch (error) {
      const missingShopScope = Number(error.upstreamCode || 0) === 105005
        || /not been granted any access scope|required access scope/i.test(text(error.message));
      const message = missingShopScope
        ? 'TikTok app permission required: enable Shop Authorized Information (seller.authorization.info) in Partner Center > App & Service > Manage API, then reconnect this seller account to issue a new token.'
        : error.message;
      await write(connectionKey(identity.accountId), {
        verified: false,
        channelId: current.id,
        environment,
        accountId: identity.accountId,
        credentialKey: credentials.fingerprint(environment, identity.accountId),
        verificationFailedAt: stamp(),
        missingScope: missingShopScope ? 'seller.authorization.info' : '',
        message
      });
      throw fail(message, error.statusCode || 502, {
        upstreamStatus: error.upstreamStatus,
        upstreamCode: error.upstreamCode,
        requestId: error.requestId || ''
      });
    }
    const shops = array(shopResponse.data?.shops);
    if (!shops.length) throw fail('TikTok returned no authorized shops for this seller token.', 409);
    const saved = credentials.get(environment, identity.accountId);
    const selected = shops.find(shop => text(shop.cipher) === text(saved.shopCipher)) || (shops.length === 1 ? shops[0] : null);
    if (selected) credentials.selectShop(environment, selected, identity.accountId);
    const credentialKey = credentials.fingerprint(environment, identity.accountId);
    const permissionResponse = await client.request('/seller/202309/permissions', { accountId: identity.accountId, shopScoped: false, operation: 'Read TikTok seller permissions' });
    const permissionSignals = array(permissionResponse.data?.permissions);
    let webhooks = null;
    try {
      webhooks = await client.request('/event/202309/webhooks', { accountId: identity.accountId, method: 'GET', operation: 'Read TikTok webhook subscriptions' });
    } catch (error) {
      webhooks = { warning: error.message };
    }
    let shopCreators = [];
    let shopCreatorsWarning = '';
    if (selected?.cipher || saved.shopCipher) {
      try {
        const creatorResponse = await client.request('/seller/202407/shop_creators', {
          accountId: identity.accountId,
          operation: 'Detect TikTok Shop official LIVE account'
        });
        shopCreators = array(creatorResponse.data?.shop_creators).map(creator => ({
          type: text(creator.type),
          bindingStatus: text(creator.binding_status)
        }));
      } catch (error) {
        shopCreatorsWarning = error.message;
      }
    }
    const result = {
      verified: true,
      verifiedAt: stamp(),
      channelId: current.id,
      environment,
      accountId: identity.accountId,
      accountName: text(selected?.name || saved.shopName || identity.accountName),
      credentialKey: credentials.fingerprint(environment, identity.accountId),
      priorCredentialKey: credentialKey,
      shops: shops.map(shop => ({ id: text(shop.id), name: text(shop.name), code: text(shop.code), cipher: text(shop.cipher), region: text(shop.region), sellerType: text(shop.seller_type) })),
      selectedShopCipher: text(selected?.cipher || saved.shopCipher),
      selectedShopId: text(selected?.id || saved.shopId),
      sellerPermissionSignals: permissionSignals,
      grantedScopes: credentials.status(environment, identity.accountId).grantedScopes,
      webhookSubscriptions: webhooks?.data || null,
      webhookWarning: webhooks?.warning || '',
      shopCreators,
      shopCreatorsWarning,
      message: selected ? `Connected to ${selected.name || selected.code || 'TikTok Shop'}.` : 'Credentials are valid. Select one authorized shop before running shop operations.'
    };
    await write(connectionKey(identity.accountId), result);
    return result;
  }

  async function requireVerified(accountId = '') {
    const identity = await accountIdentity(accountId);
    const connection = await read(connectionKey(identity.accountId));
    if (!connection?.verified || connection.channelId !== identity.current.id || connection.environment !== identity.environment || connection.credentialKey !== identity.credentialKey) {
      throw fail('Verify the TikTok Shop connection after the latest credential or shop change.', 409);
    }
    if (!credentials.get(identity.environment, identity.accountId).shopCipher) throw fail('Select an authorized TikTok Shop.', 409);
    return { ...identity, connection };
  }

  async function publicRecentJobs() {
    const jobs = await postgres.getPool().query(`select job_id,job_number,status,name,coalesce(ended_at,updated_at,started_at,created_at) as at,raw->>'workerTask' as task,
      raw->'workerPayload'->>'accountId' as account_id,raw->'workerPayload'->>'accountName' as account_name,
      raw->'workerPayload'->>'historicalBackfill' as historical_backfill,
      raw->'workerPayload'->>'startDate' as start_date,raw->'workerPayload'->>'endDate' as end_date
      from operations_jobs where coalesce(raw->>'workerTask','') like 'tiktok-%' order by coalesce(ended_at,updated_at,started_at,created_at) desc limit 20`);
    return {
      recentJobs: jobs.rows.map(row => ({
        id: row.job_id,
        jobNumber: row.job_number,
        status: row.status,
        operation: row.name,
        task: row.task,
        accountId: row.account_id,
        accountName: row.account_name,
        historicalBackfill: row.historical_backfill === 'true',
        startDate: row.start_date || '',
        endDate: row.end_date || '',
        at: row.at
      }))
    };
  }

  async function publicOrderHealth(accountId = '') {
    if (typeof deps.readOrderHealth !== 'function') throw fail('TikTok order health is not configured.', 501);
    const identity = await accountIdentity(accountId).catch(() => null);
    return deps.readOrderHealth({
      accountId: identity?.accountId || text(accountId),
      accountName: identity?.accountName || ''
    });
  }

  async function publicStatus() {
    const current = await channel();
    const environment = current?.settings?.tiktokEnvironment === 'development' ? 'development' : 'production';
    const credentialStatus = credentials.status(environment);
    const connection = credentialStatus.activeAccountId ? await read(connectionKey(credentialStatus.activeAccountId)) : null;
    const fingerprint = credentialStatus.configured ? credentials.fingerprint(environment, credentialStatus.activeAccountId) : '';
    const verified = Boolean(current?.settings?.channelEnabled && connection?.verified && connection.channelId === current.id && connection.environment === environment && connection.credentialKey === fingerprint);
    const accounts = await Promise.all(array(credentialStatus.accounts).map(async account => {
      const [savedConnection, onboarding, orderCheckpoint] = await Promise.all([
        read(connectionKey(account.id)),
        read(initialSetupKey(account.id)),
        read(orderCheckpointKey(account.id))
      ]);
      const accountFingerprint = account.configured ? credentials.fingerprint(environment, account.id) : '';
      return {
        ...account,
        active: account.id === credentialStatus.activeAccountId,
        verified: Boolean(current?.settings?.channelEnabled && savedConnection?.verified && savedConnection.channelId === current.id && savedConnection.environment === environment && savedConnection.credentialKey === accountFingerprint),
        verificationMessage: savedConnection?.message || '',
        onboarding: onboarding || null,
        orderCheckpoint: orderCheckpoint || null,
        shopCreators: array(savedConnection?.shopCreators),
        shopCreatorsWarning: text(savedConnection?.shopCreatorsWarning),
        shops: array(savedConnection?.shops).map(shop => ({
          id: text(shop.id),
          name: text(shop.name),
          code: text(shop.code),
          cipher: text(shop.cipher),
          region: text(shop.region),
          sellerType: text(shop.sellerType || shop.seller_type)
        }))
      };
    }));
    const activeAccount = accounts.find(account => account.id === credentialStatus.activeAccountId) || null;
    return {
      channel: { id: current?.id || '', enabled: current?.settings?.channelEnabled === true },
      environment,
      ...credentialStatus,
      accounts,
      creatorAccounts: credentials.creators(environment),
      onboarding: activeAccount?.onboarding || null,
      orderCheckpoint: activeAccount?.orderCheckpoint || null,
      connection: { ...(connection || {}), verified },
      capabilities: CAPABILITIES,
      recentJobs: []
    };
  }

  async function verifyCreator(creatorId = '') {
    const current = await channel();
    if (!current) throw fail('TikTok Shop is not configured in Channels.', 409);
    const environment = current.settings?.tiktokEnvironment === 'development' ? 'development' : 'production';
    const creator = credentials.getCreator(environment, creatorId);
    if (!creator.accountId || !creator.accessToken) throw fail('Authorize the official TikTok account that hosts this shop\'s LIVE sessions first.', 409);
    const response = await creatorClient.request('/affiliate_creator/202508/profiles', {
      accountId: creator.accountId,
      shopScoped: false,
      operation: 'Verify official TikTok LIVE account'
    });
    const saved = credentials.updateCreatorProfile(environment, creator.accountId, response.data || {});
    return {
      id: saved.accountId,
      label: saved.username || saved.label || saved.accountId,
      username: saved.username || '',
      creatorUserOpenId: saved.creatorUserOpenId || '',
      userType: saved.userType || '',
      permissions: saved.permissions || [],
      registerRegion: saved.registerRegion || '',
      selectionRegion: saved.selectionRegion || '',
      grantedScopes: saved.grantedScopes || [],
      verified: true,
      verifiedAt: stamp(),
      message: `Official TikTok LIVE account @${saved.username || saved.label || saved.accountId} verified.`
    };
  }

  function creatorScopeSet(creator = {}) {
    return new Set(array(creator.grantedScopes).map(scope => text(scope)).filter(Boolean));
  }

  function creatorTrayAccess(creator = {}) {
    const scopes = creatorScopeSet(creator);
    return {
      productTrayRead: scopes.has('creator.showcase.read'),
      productTrayWrite: scopes.has('creator.showcase.write'),
      state: scopes.has('creator.showcase.read') ? 'token_ready' : 'reauthorization_required'
    };
  }

  function creatorTrayAccessMessage(access = {}, error = null) {
    if (!access.productTrayRead) {
      return 'TikTok LIVE product tray is unavailable because this creator token does not include Read Showcase Products (creator.showcase.read). Reauthorize the official LIVE account after enabling that scope.';
    }
    const statusCode = Number(error?.statusCode || error?.status || 0);
    const denied = statusCode === 401 || /\b401\b|access denied|access scope/i.test(text(error?.message));
    if (denied) {
      return 'TikTok LIVE product tray is unavailable because TikTok has not granted this app access to GET /affiliate/202309/live_rooms/products. The creator token already includes Read Showcase Products, so reconnecting alone will not fix it. In Partner Center > App & Service > Manage API, open TikTok\'s endpoint details, enable and obtain approval for every required scope, then reauthorize the official LIVE account.';
    }
    return `TikTok LIVE product tray could not be loaded: ${text(error?.message) || 'Unknown TikTok error.'}`;
  }

  async function syncCreatorLiveProducts(options = {}) {
    const current = await enabled();
    const environment = current.settings?.tiktokEnvironment === 'development' ? 'development' : 'production';
    const creator = credentials.getCreator(environment, options.creatorId);
    if (!creator.accountId || !creator.accessToken) throw fail('Authorize and select the official TikTok account that hosts this shop\'s LIVE sessions before syncing products.', 409);
    const scopes = creatorScopeSet(creator);
    if (!scopes.has('creator.showcase.read') || !scopes.has('creator.showcase.write')) {
      throw fail('Reconnect this creator and grant Read Showcase Products and Manage Showcase Products.', 409);
    }
    const productIds = [...new Set(array(options.productIds).map(text).filter(Boolean))];
    if (!productIds.length) throw fail('Publish the session products to TikTok Shop before syncing them to LIVE.', 409);
    const additionErrors = [];
    for (let index = 0; index < productIds.length; index += 20) {
      const response = await creatorClient.request('/affiliate_creator/202405/showcases/products/add', {
        accountId: creator.accountId,
        method: 'POST',
        shopScoped: false,
        body: { add_type: 'PRODUCT_ID', product_ids: productIds.slice(index, index + 20) },
        operation: 'Add TikTok creator showcase products'
      });
      additionErrors.push(...array(response.data?.errors));
    }

    let liveAssignmentWarning = '';
    try {
      for (let index = 0; index < productIds.length; index += 20) {
        await creatorClient.request('/affiliate/202309/live_rooms/products', {
          accountId: creator.accountId,
          method: 'POST',
          shopScoped: false,
          body: { product_ids: productIds.slice(index, index + 20) },
          operation: 'Add products to TikTok LIVE preparation'
        });
      }
    } catch (error) {
      liveAssignmentWarning = error.message;
    }

    const products = [];
    let pageToken = '';
    const seenTokens = new Set();
    do {
      if (pageToken && seenTokens.has(pageToken)) throw fail('TikTok repeated a creator product page token while verifying LIVE sync.', 502);
      if (pageToken) seenTokens.add(pageToken);
      const response = await creatorClient.request('/affiliate_creator/202405/showcases/products', {
        accountId: creator.accountId,
        shopScoped: false,
        query: { page_size: 20, page_token: pageToken, origin: 'LIVE' },
        operation: 'Verify TikTok LIVE products'
      });
      products.push(...array(response.data?.products));
      pageToken = text(response.data?.next_page_token);
    } while (pageToken && products.length < 2000);

    const byId = new Map(products.map(product => [text(product.id), product]));
    const errorById = new Map(additionErrors.map(error => [text(error.detail?.product_id), error]));
    const results = productIds.map(productId => {
      const product = byId.get(productId);
      const addedStatus = text(product?.status?.added_status || product?.added_status).toUpperCase();
      const additionError = errorById.get(productId);
      const synced = addedStatus === 'ADDED';
      return {
        productId,
        status: synced ? 'synced' : additionError ? 'failed' : 'not_verified',
        addedStatus: addedStatus || '',
        title: text(product?.title),
        error: text(additionError?.message || (!synced ? liveAssignmentWarning || 'TikTok did not return this product as added to the LIVE or pre-LIVE product list.' : ''))
      };
    });
    const syncedCount = results.filter(result => result.status === 'synced').length;
    return {
      creatorId: creator.accountId,
      creatorName: creator.username || creator.label || creator.accountId,
      syncedAt: stamp(),
      requestedCount: productIds.length,
      syncedCount,
      failedCount: productIds.length - syncedCount,
      warning: syncedCount < productIds.length ? liveAssignmentWarning : '',
      results,
      message: syncedCount === productIds.length
        ? `${syncedCount} product${syncedCount === 1 ? '' : 's'} verified in TikTok LIVE preparation.`
        : `${syncedCount} of ${productIds.length} products were verified in TikTok LIVE preparation. Review the remaining product results.`
    };
  }

  function studioCacheKey(accountId, creatorId) {
    return `${text(accountId)}:${text(creatorId)}`;
  }

  function studioRoom(raw = {}) {
    const liveId = text(raw.id || raw.live_id || raw.live_room_id || raw.room_id);
    const status = text(raw.status || raw.live_status || raw.room_status).toUpperCase();
    const timestamp = value => {
      if (!value) return '';
      const numeric = Number(value);
      const parsed = Number.isFinite(numeric) && numeric > 0 ? numeric * 1000 : Date.parse(value);
      return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
    };
    return {
      liveId,
      title: text(raw.title || raw.live_title || raw.room_title),
      status: status || 'UNKNOWN',
      startTime: timestamp(raw.start_time || raw.start_time_iso),
      endTime: timestamp(raw.end_time || raw.end_time_iso)
    };
  }

  async function studioStatus(options = {}) {
    const identity = await accountIdentity(options.accountId);
    const current = await enabled();
    const environment = current.settings?.tiktokEnvironment === 'development' ? 'development' : 'production';
    const creator = credentials.getCreator(environment, options.creatorId);
    if (!creator.accountId || !creator.accessToken) throw fail('Authorize and select the official TikTok account that hosts this shop\'s LIVE sessions.', 409);
    const cacheKey = studioCacheKey(identity.accountId, creator.accountId);
    const cached = studioCache.get(cacheKey);
    if (options.refresh !== true && cached && cached.expiresAt > Date.now()) return { ...cached.value, cached: true };

    const warnings = [];
    const capabilities = creatorTrayAccess(creator);
    const roomsResponse = await creatorClient.request('/affiliate/202309/live_rooms', {
      accountId: creator.accountId,
      shopScoped: false,
      timeoutMs: 12_000,
      operation: 'Read TikTok LIVE rooms'
    });
    const rooms = [
      ...(roomsResponse.data?.id ? [roomsResponse.data] : []),
      ...array(roomsResponse.data?.live_rooms),
      ...array(roomsResponse.data?.rooms),
      ...array(roomsResponse.data?.live_room ? [roomsResponse.data.live_room] : [])
    ].map(studioRoom).filter(room => room.liveId);
    const requestedLiveId = text(options.liveId);
    const requestedRoom = rooms.find(room => requestedLiveId && room.liveId === requestedLiveId) || null;
    const activeRoom = rooms.find(room => ['LIVE', 'ONGOING', 'STARTED'].includes(room.status)) || null;
    // Never substitute a different historical room after DataPlus has started
    // tracking a specific broadcast. An explicit room association must stay exact.
    const liveRoom = requestedLiveId ? requestedRoom : activeRoom || rooms[0] || null;

    let trayProducts = [];
    let analytics = null;
    let productPerformance = [];
    if (liveRoom) {
      const roomDate = Date.parse(liveRoom.startTime || '');
      const rangeStart = Number.isFinite(roomDate) ? new Date(roomDate) : new Date();
      const rangeEnd = new Date(rangeStart.getTime() + 86_400_000);
      const today = rangeStart.toISOString().slice(0, 10);
      const tomorrow = rangeEnd.toISOString().slice(0, 10);
      const trayRequest = capabilities.productTrayRead
        ? creatorClient.request('/affiliate/202309/live_rooms/products', {
            accountId: creator.accountId,
            shopScoped: false,
            timeoutMs: 12_000,
            operation: 'Read TikTok LIVE product tray'
          })
        : Promise.reject(Object.assign(new Error(creatorTrayAccessMessage(capabilities)), { statusCode: 409 }));
      const [trayResult, analyticsResult, productsResult] = await Promise.allSettled([
        trayRequest,
        client.request('/analytics/202609/shop_lives/performance', {
          accountId: identity.accountId,
          gate: 'tiktokLiveAnalyticsEnabled',
          timeoutMs: 12_000,
          query: { start_date_ge: today, end_date_lt: tomorrow, page_size: 100, sort_field: 'live_attributed_gmv', sort_order: 'DESC', currency: 'LOCAL', account_type: 'OFFICIAL_ACCOUNTS' },
          operation: 'Read DataPlus Studio LIVE performance'
        }),
        client.request(`/analytics/202512/shop/${encodeURIComponent(liveRoom.liveId)}/products_performance`, {
          accountId: identity.accountId,
          gate: 'tiktokLiveAnalyticsEnabled',
          timeoutMs: 12_000,
          query: { sort_field: 'gmv', sort_order: 'DESC', currency: 'LOCAL' },
          operation: 'Read DataPlus Studio product performance'
        })
      ]);
      if (trayResult.status === 'fulfilled') {
        const pinnedProductId = text(trayResult.value.data?.pinned_product_id);
        trayProducts = [
          ...array(trayResult.value.data?.products),
          ...array(trayResult.value.data?.live_products)
        ].slice(0, 200).map(product => ({
          productId: text(product.id || product.product_id),
          title: text(product.title || product.name),
          image: text(array(product.main_images)[0]?.url || product.image?.url || product.image_url),
          status: text(product.status?.added_status || product.status?.inventory_status || product.status?.review_status || product.product_status),
          statusDetail: product.status && typeof product.status === 'object' ? product.status : {},
          pinned: text(product.id || product.product_id) === pinnedProductId,
          order: Number(product.order || product.position || 0)
        }));
      } else {
        const trayWarning = creatorTrayAccessMessage(capabilities, trayResult.reason);
        capabilities.productTrayRead = false;
        capabilities.productTrayWrite = false;
        capabilities.state = capabilities.state === 'reauthorization_required' ? capabilities.state : 'app_permission_required';
        warnings.push(trayWarning);
      }
      if (analyticsResult.status === 'fulfilled') {
        const rows = [
          ...array(analyticsResult.value.data?.live_stream_sessions),
          ...array(analyticsResult.value.data?.live_sessions),
          ...array(analyticsResult.value.data?.lives)
        ];
        const match = rows.find(row => text(row.id || row.live_id || row.live_room_id) === liveRoom.liveId);
        if (match) analytics = normalizeTikTokLiveSession(match, 'OFFICIAL_ACCOUNTS');
      } else warnings.push(`LIVE analytics: ${analyticsResult.reason.message}`);
      if (productsResult.status === 'fulfilled') {
        productPerformance = array(productsResult.value.data?.products).slice(0, 200).map(normalizeTikTokLiveProduct);
      } else warnings.push(`Product analytics: ${productsResult.reason.message}`);
    }

    const fetchedAt = stamp();
    const value = {
      fetchedAt,
      nextPollSeconds: 30,
      creator: { id: creator.accountId, username: creator.username || creator.label || creator.accountId },
      room: liveRoom,
      rooms: rooms.slice(0, 20),
      metrics: analytics,
      products: trayProducts,
      productPerformance,
      capabilities,
      warnings,
      openUrl: creator.username ? `https://www.tiktok.com/@${encodeURIComponent(creator.username)}/live` : '',
      message: liveRoom ? `TikTok LIVE room ${liveRoom.status.toLowerCase()} was detected.` : 'No TikTok LIVE room is currently available for this account.'
    };
    studioCache.set(cacheKey, { expiresAt: Date.now() + 20_000, value });
    while (studioCache.size > 20) studioCache.delete(studioCache.keys().next().value);
    return { ...value, cached: false };
  }

  async function studioProductAction(options = {}) {
    const identity = await accountIdentity(options.accountId);
    const current = await enabled();
    const environment = current.settings?.tiktokEnvironment === 'development' ? 'development' : 'production';
    const creator = credentials.getCreator(environment, options.creatorId);
    if (!creator.accountId || !creator.accessToken) throw fail('Authorize and select the official TikTok LIVE account first.', 409);
    const capabilities = creatorTrayAccess(creator);
    if (!capabilities.productTrayWrite) {
      throw fail('TikTok LIVE product controls require Manage Showcase Products (creator.showcase.write). Enable that scope and reauthorize the official LIVE account.', 409);
    }
    const action = text(options.action).toLowerCase();
    const productId = text(options.productId);
    const liveId = text(options.liveId);
    if (!['pin', 'unpin', 'top', 'remove'].includes(action) || !productId) throw fail('Choose a LIVE product and supported Studio action.', 400);
    const path = action === 'top'
      ? '/affiliate/202309/live_rooms/products/top'
      : action === 'remove'
        ? '/affiliate/202309/live_rooms/products'
        : `/affiliate/202309/live_rooms/products/${encodeURIComponent(productId)}/${action}`;
    const body = ['top', 'remove'].includes(action) ? { product_ids: [productId] } : undefined;
    try {
      await creatorClient.request(path, {
        accountId: creator.accountId,
        method: action === 'remove' ? 'DELETE' : 'POST',
        shopScoped: false,
        timeoutMs: 12_000,
        ...(body ? { body } : {}),
        operation: `${action} TikTok LIVE product`
      });
    } catch (error) {
      const message = creatorTrayAccessMessage(capabilities, error);
      if (message.includes('has not granted this app access')) throw fail(message, 409);
      throw error;
    }
    studioCache.delete(studioCacheKey(identity.accountId, creator.accountId));
    return { action, productId, liveId, updatedAt: stamp(), message: `TikTok LIVE product ${action} request accepted.` };
  }

  async function publicLiveStatus() {
    const identity = await accountIdentity().catch(() => null);
    const summary = identity ? await read(accountDocumentKey(identity.accountId, 'live.summary')) : null;
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
    const identity = await accountIdentity().catch(() => null);
    if (!identity) return { analytics: null, commerce: [], affiliate: [], promotions: [], engagement: [], webhooks: await webhookStatus(false) };
    const prefix = name => accountDocumentKey(identity.accountId, name);
    const [analytics, commerce, affiliate, promotions, engagement, webhooks] = await Promise.all([
      read(prefix('analytics.summary')),
      readMany(`${prefix('commerce')}.`, 25),
      readMany(`${prefix('affiliate')}.`, 25),
      readMany(`${prefix('promotions')}.`, 25),
      readMany(`${prefix('engagement')}.`, 25),
      webhookStatus(false)
    ]);
    return { analytics: analytics || null, commerce, affiliate, promotions, engagement, webhooks };
  }

  async function webhookStatus(refresh = true, req = null, accountId = '') {
    const identity = await accountIdentity(accountId).catch(() => null);
    const callbackUrl = text(deps.webhookAddress?.(req));
    const recentEvents = (await readMany('tiktok.webhook.event.', 100)).filter(event => !identity || text(event.accountId) === identity.accountId).slice(0, 25);
    const statusKey = identity ? accountDocumentKey(identity.accountId, 'webhooks.status') : '';
    let subscriptions = statusKey ? array((await read(statusKey))?.subscriptions) : [];
    let warning = '';
    if (refresh) {
      const verifiedIdentity = await requireVerified(accountId);
      try {
        const response = await client.request('/event/202309/webhooks', { accountId: verifiedIdentity.accountId, method: 'GET', gate: 'tiktokWebhooksEnabled', operation: 'Read TikTok webhook subscriptions' });
        subscriptions = array(response.data?.webhooks);
        await write(accountDocumentKey(verifiedIdentity.accountId, 'webhooks.status'), { accountId: verifiedIdentity.accountId, subscriptions, callbackUrl, checkedAt: stamp(), requestId: response.request_id || '' });
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

  async function setupWebhooks(req = null, accountId = '') {
    const identity = await requireVerified(accountId);
    await enabled('tiktokWebhooksEnabled');
    const address = text(deps.webhookAddress?.(req));
    if (!/^https:\/\/[^\s]+$/i.test(address)) throw fail('Configure a public HTTPS application URL before enabling TikTok webhooks.', 409);
    return queue('webhook-setup', { accountId: identity.accountId, callbackUrl: address, actor: 'user:tiktok-webhook-setup' });
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
    const remoteShopId = text(payload?.shop_id || payload?.shopId || payload?.data?.shop_id || payload?.data?.shopId || payload?.data?.shop_cipher || payload?.data?.shopCipher);
    const matchedAccount = credentials.accounts(environment).find(account => {
      const accountCredential = credentials.get(environment, account.id);
      return remoteShopId && [accountCredential.shopId, accountCredential.shopCipher].map(text).includes(remoteShopId);
    });
    const accountId = matchedAccount?.id || credentials.status(environment).activeAccountId;
    const event = { eventId, topic, entity, payload, receivedAt: stamp(), state: 'pending', environment, channelId: current.id, accountId };
    const inserted = await postgres.getPool().query(
      `insert into tiktok_documents(doc_key,data,updated_at) values($1,$2::jsonb,now()) on conflict(doc_key) do nothing returning doc_key`,
      [`tiktok.webhook.event.${eventId}`, JSON.stringify(event)]
    );
    if (!inserted.rowCount) return { accepted: true, duplicate: true, eventId };
    setTimeout(() => queue('webhook', { accountId, actor: 'system:tiktok-webhook' }).catch(error => {
      log({ channel: 'TikTok Shop', transport: 'Webhook', method: 'QUEUE', path: topic, operation: 'Queue TikTok event reconciliation', statusCode: error.statusCode || 500, ok: false, message: error.message });
    }), 0);
    return { accepted: true, duplicate: false, eventId, topic };
  }

  async function listConversations(input = {}) {
    await enabled('tiktokMessagesEnabled');
    const identity = await accountIdentity(input.accountId);
    const query = text(input.q).toLowerCase();
    const unreadOnly = input.unreadOnly === true;
    const limit = Math.max(1, Math.min(200, Number(input.limit || 100)));
    const prefix = conversationPrefix(identity.accountId);
    const rows = await readMany(prefix, 1000);
    const conversations = rows
      .map(row => ({ ...row, conversationId: text(row.conversationId || row.id || row.key?.replace(prefix, '')) }))
      .filter(row => !unreadOnly || Number(row.unread_count ?? row.unreadCount ?? 0) > 0)
      .filter(row => !query || JSON.stringify(row).toLowerCase().includes(query))
      .slice(0, limit);
    return { source: 'TikTok Shop', conversations, total: conversations.length };
  }

  async function conversationDetail(conversationId, refresh = true, accountId = '') {
    const identity = await requireVerified(accountId);
    await enabled('tiktokMessagesEnabled');
    const id = text(conversationId);
    if (!id) throw fail('Conversation ID is required.', 400);
    const key = conversationKey(identity.accountId, id);
    let conversation = await read(key);
    let messages = array(conversation?.messages);
    if (refresh) {
      const [detailResponse, messageResponse] = await Promise.all([
        client.request(`/customer_service/202601/conversations/${encodeURIComponent(id)}`, { accountId: identity.accountId, gate: 'tiktokMessagesEnabled', operation: `Read TikTok conversation ${id}` }),
        client.request(`/customer_service/202309/conversations/${encodeURIComponent(id)}/messages`, { accountId: identity.accountId, gate: 'tiktokMessagesEnabled', operation: `Read TikTok messages ${id}`, query: { page_size: 100, sort_order: 'DESC', sort_field: 'create_time', need_data: true } })
      ]);
      messages = array(messageResponse.data?.messages).reverse();
      conversation = { ...(conversation || {}), ...(detailResponse.data?.conversation || {}), conversationId: id, messages, unsupportedMessageTips: messageResponse.data?.unsupported_msg_tips || '', syncedAt: stamp() };
      await write(key, conversation);
    }
    return { source: 'TikTok Shop', conversation: { ...(conversation || {}), conversationId: id }, messages };
  }

  async function markConversationRead(conversationId, accountId = '') {
    const id = text(conversationId);
    if (!id) throw fail('Conversation ID is required.', 400);
    const identity = await requireVerified(accountId);
    await enabled('tiktokMessagesEnabled');
    const response = await client.request(`/customer_service/202309/conversations/${encodeURIComponent(id)}/messages/read`, { accountId: identity.accountId, method: 'POST', gate: 'tiktokMessagesEnabled', operation: `Mark TikTok conversation ${id} read`, body: {} });
    const key = conversationKey(identity.accountId, id);
    const existing = await read(key);
    await write(key, { ...(existing || {}), accountId: identity.accountId, conversationId: id, unread_count: 0, unreadCount: 0, readAt: stamp() });
    return { ...response, message: 'TikTok conversation marked read.' };
  }

  async function sendConversationMessage(conversationId, input = {}) {
    const id = text(conversationId);
    const content = text(input.content);
    if (!id) throw fail('Conversation ID is required.', 400);
    if (!content || content.length > 2000) throw fail('Enter a reply between 1 and 2,000 characters.', 400);
    const identity = await requireVerified(input.accountId);
    await enabled('tiktokMessagesEnabled');
    const key = conversationKey(identity.accountId, id);
    const existing = await read(key);
    if (existing?.can_send_message === false || existing?.canSendMessage === false) throw fail('TikTok has closed replies for this conversation.', 409);
    const response = await client.request(`/customer_service/202606/conversations/${encodeURIComponent(id)}/messages`, {
      accountId: identity.accountId, method: 'POST', gate: 'tiktokMessagesEnabled', operation: `Reply to TikTok conversation ${id}`,
      body: { sender_role: 'CUSTOMER_SERVICE', type: 'TEXT', content: JSON.stringify({ content }) }
    });
    const localMessage = { id: text(response.data?.message_id || crypto.randomUUID()), type: 'TEXT', content, sender_role: 'CUSTOMER_SERVICE', create_time: Math.floor(Date.now() / 1000), local: true };
    await write(key, { ...(existing || {}), accountId: identity.accountId, conversationId: id, messages: [...array(existing?.messages), localMessage], latest_message: localMessage, repliedAt: stamp() });
    return { ...response, message: 'Reply sent through TikTok Shop.' };
  }

  const gateFor = operation => ({
    orders: 'tiktokOrdersEnabled',
    'order-identity-repair': 'tiktokOrdersEnabled',
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
    if (!['orders', 'order-identity-repair', 'returns', 'settlements', 'products', 'messages', 'live', 'analytics', 'affiliate', 'promotions', 'engagement', 'commerce', 'launch', 'inventory', 'price', 'webhook', 'webhook-setup'].includes(operation)) throw fail('Unsupported TikTok job.', 400);
    await enabled(gateFor(operation));
    const identity = await requireVerified(input.accountId);
    const workerTask = `tiktok-${operation}`;
    const existing = await deps.findActive(workerTask, identity.accountId, ['orders', 'returns'].includes(operation)
      ? { historicalBackfill: input.historicalBackfill === true }
      : {});
    if (existing) return { duplicate: true, job: existing, message: `${existing.operation || operation} is already ${existing.status}.` };
    const now = new Date();
    const orderCheckpoint = operation === 'orders' && input.scheduled === true && input.historicalBackfill !== true
      ? await read(orderCheckpointKey(identity.accountId))
      : null;
    const checkpointTime = Date.parse(orderCheckpoint?.completedThrough || '');
    const checkpointFallback = Number.isFinite(checkpointTime)
      ? Math.max(0, checkpointTime - 3_600_000)
      : null;
    const days = clamp(input.lookbackDays, 1, operation === 'orders' ? 365 : 180, operation === 'settlements' ? 45 : 30);
    const startDate = importBoundary(input.startDate, checkpointFallback ?? now.getTime() - days * 86_400_000);
    const endDate = importBoundary(input.endDate, now, true);
    if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime()) || startDate >= endDate) throw fail('Choose a valid TikTok import date range.', 400);
    const job = await deps.createJob({
      section: operation === 'settlements' ? 'Accounting' : ['products', 'launch', 'inventory', 'price', 'commerce'].includes(operation) ? 'Products' : 'Channels',
      category: 'TikTok Shop',
      operation: operation === 'live' ? `TikTok Shop LIVE synchronization - ${identity.accountName}` : operation === 'webhook' ? `TikTok Shop event reconciliation - ${identity.accountName}` : `TikTok Shop ${operation === 'products' ? 'catalog reconciliation' : operation} - ${identity.accountName}`,
      direction: 'sync',
      status: 'queued',
      phase: 'queued',
      fileName: `tiktok-${operation}.ndjson`,
      totalRows: 0,
      processedRows: 0,
      progressPercent: 0,
      scheduled: input.scheduled === true,
      queuePriority: operation === 'orders' && input.historicalBackfill !== true ? 130 : undefined,
      workerTask,
      workerPayload: {
        operation,
        channelId: identity.current.id,
        environment: identity.environment,
        accountId: identity.accountId,
        accountName: identity.accountName,
        credentialKey: identity.credentialKey,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        historicalBackfill: input.historicalBackfill === true,
        reconcileExisting: input.reconcileExisting !== false,
        orderIds: array(input.orderIds).map(text).filter(Boolean).slice(0, 5000),
        skus: array(input.skus).map(text).filter(Boolean).slice(0, 5000),
        launchOverrides: array(input.launchOverrides).slice(0, 5000).map((entry) => ({
          productKey: text(entry?.productKey || entry?.productId || entry?.parentSku),
          merchantSku: text(entry?.merchantSku),
          quantity: Math.max(0, Math.floor(Number(entry?.quantity || 0))),
          price: Math.max(0.01, Number(entry?.salePrice ?? entry?.price ?? 1) || 1),
          title: text(entry?.title).slice(0, 255),
          imageDataUrl: text(entry?.imageDataUrl),
          itemIds: array(entry?.itemIds).map(text).filter(Boolean).slice(0, 100)
        })).filter((entry) => entry.productKey && entry.merchantSku),
        sourceLiveSessionId: text(input.sourceLiveSessionId),
        sourceLiveSessionNumber: text(input.sourceLiveSessionNumber),
        eventIds: array(input.eventIds).map(text).filter(Boolean).slice(0, 500),
        callbackUrl: /^https:\/\/[^\s]+$/i.test(text(input.callbackUrl)) ? text(input.callbackUrl) : '',
        limit: Math.max(1, Math.min(5000, Number(input.limit || 5000))),
        scheduled: input.scheduled === true,
        actor: text(input.actor || '')
      },
      message: `TikTok Shop ${operation} queued for ${identity.accountName}. Progress and results will appear in Jobs.`
    });
    if (job?.reusedActiveJob === true) return { duplicate: true, job, message: `${job.operation || operation} is already ${job.status}.` };
    log({ channel: 'TikTok Shop', transport: 'Job', method: 'QUEUE', path: operation, operation: job.operation, statusCode: 202, ok: true, jobId: job.id, message: job.message });
    return { duplicate: false, job, message: job.message };
  }

  async function initialSetup(input = {}, req = null) {
    const identity = await requireVerified(input.accountId);
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const operationalStart = importBoundary(input.operationalStartDate, today);
    const historicalStart = input.importHistory === true ? importBoundary(input.historyStartDate, today.getTime() - 30 * 86_400_000) : null;
    if (!Number.isFinite(operationalStart.getTime()) || operationalStart > now) throw fail('Choose an operational start date no later than today.', 400);
    if (historicalStart && (!Number.isFinite(historicalStart.getTime()) || historicalStart >= operationalStart)) {
      throw fail('Historical sales must start before the operational order date.', 400);
    }

    const existingCheckpoint = await read(orderCheckpointKey(identity.accountId));
    const existingThrough = Date.parse(existingCheckpoint?.completedThrough || '');
    const selectedThrough = operationalStart.toISOString();
    const completedThrough = Number.isFinite(existingThrough) && existingThrough > operationalStart.getTime()
      ? new Date(existingThrough).toISOString()
      : selectedThrough;
    await write(orderCheckpointKey(identity.accountId), {
      ...(existingCheckpoint || {}),
      accountId: identity.accountId,
      accountName: identity.accountName,
      completedThrough,
      initializedAt: existingCheckpoint?.initializedAt || stamp(),
      initializedBy: text(input.actor),
      source: 'initial-setup'
    });

    const jobs = [];
    const warnings = [];
    const steps = [];
    const queueStep = async (label, action) => {
      try {
        const result = await action();
        if (result?.job) {
          jobs.push(result.job);
          steps.push({
            label,
            status: result.duplicate ? 'already_running' : 'queued',
            jobId: result.job.id,
            jobNumber: result.job.jobNumber,
            message: result.message || ''
          });
        }
        if (result?.duplicate) warnings.push(`${label}: job #${result.job?.jobNumber || result.job?.id || ''} is already ${result.job?.status || 'running'}. Wait for it to finish, then run setup again to apply a wider date range.`);
        return result;
      } catch (error) {
        warnings.push(`${label}: ${error.message}`);
        steps.push({ label, status: 'failed', message: error.message });
        return null;
      }
    };

    if (input.reconcileCatalog !== false) {
      await queueStep('Catalog reconciliation', () => queue('products', { accountId: identity.accountId, actor: text(input.actor) }));
    }
    if (historicalStart) {
      await queueStep('Historical sales import', () => queue('orders', {
        accountId: identity.accountId,
        startDate: historicalStart.toISOString(),
        endDate: operationalStart.toISOString(),
        historicalBackfill: true,
        reconcileExisting: true,
        actor: text(input.actor)
      }));
    } else if (input.enableOperationalSync !== false) {
      await queueStep('Operational order import', () => queue('orders', {
        accountId: identity.accountId,
        startDate: operationalStart.toISOString(),
        endDate: now.toISOString(),
        historicalBackfill: false,
        reconcileExisting: true,
        actor: text(input.actor)
      }));
    }
    if (input.configureWebhooks === true) {
      await queueStep('Webhook setup', () => setupWebhooks(req, identity.accountId));
    }

    const onboarding = await write(initialSetupKey(identity.accountId), {
      accountId: identity.accountId,
      accountName: identity.accountName,
      shopId: text(identity.connection?.selectedShopId),
      shopName: text(identity.connection?.accountName || identity.accountName),
      importHistory: Boolean(historicalStart),
      historyStartDate: historicalStart?.toISOString() || '',
      historyEndDate: historicalStart ? operationalStart.toISOString() : '',
      operationalStartDate: operationalStart.toISOString(),
      reconcileCatalog: input.reconcileCatalog !== false,
      enableOperationalSync: input.enableOperationalSync !== false,
      configureWebhooks: input.configureWebhooks === true,
      startedAt: stamp(),
      startedBy: text(input.actor),
      jobIds: jobs.map(job => job.id),
      warnings
    });
    const message = warnings.length
      ? `Initial setup started for ${identity.accountName}. ${warnings.length} step${warnings.length === 1 ? '' : 's'} need attention.`
      : `Initial setup started for ${identity.accountName}. Catalog, history, and ongoing order work will remain separated.`;
    return { onboarding, jobs, steps, job: jobs.find(job => job.workerTask === 'tiktok-orders') || jobs[0] || null, warnings, message };
  }

  async function saveReturn(raw, account = {}) {
    const orderId = text(raw.order_id);
    const order = orderId ? await postgres.readChannelOrderForReturn('TikTok Shop', { orderId }) : null;
    const record = { ...mapTikTokReturn(raw, order), channelAccountId: text(account.accountId), channelAccountName: text(account.accountName) };
    const saved = await postgres.upsertImportedReturn(record);
    if (order) {
      reconcileOrderReturns(order, [saved]);
      await postgres.saveOrder(order);
    }
    return { saved, order };
  }

  function productListing(product = {}, channelSettings = {}, launchOverride = {}) {
    const accountListings = product.tiktokListings && typeof product.tiktokListings === 'object' ? product.tiktokListings : {};
    const accountListing = launchOverride.accountId && accountListings[launchOverride.accountId] && typeof accountListings[launchOverride.accountId] === 'object'
      ? accountListings[launchOverride.accountId]
      : null;
    const legacyListing = product.tiktokListing && typeof product.tiktokListing === 'object' ? product.tiktokListing : {};
    const listing = accountListing || (text(legacyListing.accountId) === text(launchOverride.accountId) || !launchOverride.accountId ? legacyListing : {});
    const category = product.tiktokCategory && typeof product.tiktokCategory === 'object' ? product.tiktokCategory : {};
    const dimensions = {
      length: Number(product.packageLength || product.package_length || 0),
      width: Number(product.packageWidth || product.package_width || 0),
      height: Number(product.packageHeight || product.package_height || 0)
    };
    const weight = Number(product.packageWeight || product.package_weight || 0);
    const price = Math.max(0.01, Number(launchOverride.price || product.tiktokPrice || product.websitePrice || product.price || 0));
    const overrideQuantity = Number(launchOverride.quantity);
    const available = Number.isFinite(overrideQuantity)
      ? Math.max(0, Math.floor(overrideQuantity))
      : Math.max(0, Math.floor(Number(product.available ?? product.qty ?? product.stockQty ?? 0) - Number(product.reserved || 0) - Number(channelSettings.tiktokInventorySafetyQty || 0)));
    const categoryId = text(launchOverride.categoryId || product.tiktokCategoryId || category.categoryId || listing.categoryId);
    const warehouseId = text(product.tiktokWarehouseId || listing.warehouseId || channelSettings.tiktokWarehouseId);
    const imageUris = [
      text(launchOverride.imageUri),
      ...array(product.tiktokImageUris || listing.imageUris || listing.mainImageUris).map(uri => text(uri?.uri || uri))
    ].filter(Boolean);
    const launchTitle = text(launchOverride.title || product.marketplaceTitle || product.title).slice(0, 255);
    const description = text(product.longDescription || product.description || product.shortDescription || launchTitle).slice(0, 10_000);
    const identifier = text(product.barcode || product.upc || product.gtin);
    const productStatus = text(product.status || product.productStatus || product.lifecycleStatus).toLowerCase();
    const shippingClass = text(product.shippingClass || product.shippingClassification || product.shippingType).toLowerCase();
    const issues = [];
    if (product.active === false || product.toBeDiscontinued === true || ['inactive', 'discontinued', 'retired', 'deleted'].includes(productStatus)) issues.push('Catalog selling status blocks marketplace launch.');
    if (shippingClass.includes('ltl') || shippingClass.includes('freight')) issues.push('Freight products are not eligible for TikTok parcel launch.');
    const merchantSku = text(launchOverride.merchantSku || product.sku);
    if (!merchantSku) issues.push('Manufacturer SKU is required as the TikTok seller SKU.');
    if (!launchTitle) issues.push('Title is missing.');
    if (!categoryId) issues.push('TikTok category mapping is missing.');
    if (!imageUris.length) issues.push('TikTok-hosted product image URI is missing.');
    if (!warehouseId) issues.push('TikTok warehouse mapping is missing.');
    if (!(price > 0)) issues.push('TikTok price is missing.');
    if (!(weight > 0)) issues.push('Package weight is missing.');
    if (!Object.values(dimensions).every(value => value > 0)) issues.push('Complete package dimensions are required.');
    const sku = {
      seller_sku: merchantSku,
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
        idempotency_key: text(launchOverride.idempotencyKey || `${launchOverride.accountId || 'default'}:${merchantSku || product.id || product.sku}`),
        external_product_id: text(product.id || product.sku),
        title: launchTitle,
        description,
        category_id: categoryId,
        category_version: text(channelSettings.tiktokCategoryVersion || 'v2') || 'v2',
        main_images: imageUris.slice(0, 9).map(uri => ({ uri })),
        package_dimensions: { length: String(Math.ceil(dimensions.length)), width: String(Math.ceil(dimensions.width)), height: String(Math.ceil(dimensions.height)), unit: 'INCH' },
        package_weight: { value: String(weight), unit: 'POUND' },
        ...(text(channelSettings.tiktokShippingTemplateId) ? { shipping_template_id: text(channelSettings.tiktokShippingTemplateId) } : {}),
        skus: [sku]
      },
      computed: {
        price,
        available,
        categoryId,
        categoryName: text(launchOverride.categoryName || category.categoryName || category.name || listing.categoryName),
        categoryPath: array(launchOverride.categoryPath || category.categoryPath || listing.categoryPath).map(text).filter(Boolean),
        categorySource: text(launchOverride.categorySource || category.categorySource || listing.categorySource || (categoryId ? 'product_mapping' : '')),
        warehouseId,
        dimensions,
        weight,
        imageCount: imageUris.length,
        merchantSku
      }
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
    const products = explicit.length
      ? await deps.readProducts(explicit)
      : await deps.listTikTokProducts({ linkedOnly, limit: Math.max(1, Math.min(5000, Number(payload.limit || 1000))) });
    return typeof deps.enrichProductCategoryMappings === 'function'
      ? deps.enrichProductCategoryMappings(products)
      : products;
  }

  async function saveSnapshot(key, data, accountId = '') {
    return write(accountDocumentKey(accountId, key.replace(/^tiktok\./, '')), { ...data, accountId, syncedAt: stamp() });
  }

  async function getOrderDetails(orderIds = [], accountId = '', options = {}) {
    const ids = [...new Set(array(orderIds).map(text).filter(Boolean))];
    const orders = [];
    for (let index = 0; index < ids.length; index += 50) {
      const chunk = ids.slice(index, index + 50);
      const response = await client.request('/order/202507/orders', {
        accountId,
        gate: 'tiktokOrdersEnabled',
        retryable: true,
        jobId: options.jobId,
        operation: options.operation || 'Read TikTok order details',
        query: { ids: chunk.join(',') }
      });
      orders.push(...array(response.data?.orders));
    }
    return orders;
  }

  async function loadTikTokPackageGroups(rawOrders = [], accountId = '', options = {}) {
    const localMembers = new Map();
    const combinedPackages = new Set();
    for (const raw of array(rawOrders)) {
      const orderId = text(raw.id);
      const packageIds = [...new Set(array(raw.line_items).map(line => text(line.package_id)).filter(Boolean))];
      for (const packageId of packageIds) {
        if (!localMembers.has(packageId)) localMembers.set(packageId, new Set());
        if (orderId) localMembers.get(packageId).add(orderId);
        if (/combin/i.test(text(raw.split_or_combine_tag))) combinedPackages.add(packageId);
      }
    }
    for (const [packageId, members] of localMembers) if (members.size > 1) combinedPackages.add(packageId);
    const groups = new Map();
    const warnings = [];
    for (const packageId of combinedPackages) {
      await options.onProgress?.(`Checking TikTok combined package ${packageId}.`);
      let detail = null;
      try {
        const response = await client.request(`/fulfillment/202309/packages/${encodeURIComponent(packageId)}`, {
          accountId,
          gate: 'tiktokOrdersEnabled',
          retryable: false,
          timeoutMs: 10_000,
          jobId: options.jobId,
          operation: `Read TikTok combined package ${packageId}`
        });
        detail = response.data?.package || response.data || null;
      } catch (error) {
        warnings.push(`TikTok package ${packageId}: ${error.message}`);
      }
      const orderIds = [...new Set([
        ...array(detail?.orders).map(order => text(order.id)),
        ...array(detail?.order_ids).map(text),
        ...[...(localMembers.get(packageId) || [])].map(text)
      ].filter(Boolean))];
      if (orderIds.length < 2) continue;
      groups.set(packageId, {
        packageId,
        orderIds,
        packageStatus: text(detail?.package_status),
        splitOrCombineTag: text(detail?.split_and_combine_tag || 'COMBINE'),
        trackingNumber: text(detail?.tracking_number),
        checkedAt: stamp()
      });
      await options.onProgress?.(`TikTok combined package ${packageId} checked.`);
    }
    return { groups, warnings };
  }

  async function mapOrderWithLiveEvidence(raw = {}, options = {}) {
    const mapped = mapTikTokOrder(raw, options);
    const attribution = await read(`tiktok.live.order.${mapped.marketplaceOrderId}`);
    return attribution?.isLive ? applyTikTokLiveAttribution(mapped, attribution) : mapped;
  }

  async function run(job) {
    const payload = job.workerPayload || {};
    const operation = text(payload.operation || job.workerTask?.replace('tiktok-', ''));
    const jobRequest = (apiPath, options = {}) => client.request(apiPath, { ...options, accountId: payload.accountId });
    const report = path.join(artifactsDir, `${job.id}-tiktok-${operation}.ndjson`);
    fs.mkdirSync(artifactsDir, { recursive: true });
    let current = await persistJob(job, { status: 'running', phase: `fetching_${operation}`, startedAt: job.startedAt || stamp(), originalFilePath: report, originalFileName: `tiktok-${operation}.ndjson` });
    let processed = 0, changed = 0, failed = 0, unmatched = 0;
    const observedOrderIds = new Set();
    const persistedOrderIds = new Set();
    const warnings = [];
    const liveSessionLaunchResults = [];
    const record = row => {
      fs.appendFileSync(report, `${JSON.stringify({ ...row, at: stamp() })}\n`);
      if (operation === 'launch' && payload.sourceLiveSessionId && liveSessionLaunchResults.length < 500) liveSessionLaunchResults.push(row);
      processed += 1;
      if (row.error) failed += 1;
    };
    const check = async () => {
      const latest = await postgres.readOperationJob(job.id);
      if (['stopping', 'stopped', 'canceled', 'cancelled'].includes(text(latest?.status).toLowerCase())) throw fail('Job stopped.', 499);
      await enabled(gateFor(operation));
      const identity = await requireVerified(payload.accountId);
      if (identity.current.id !== payload.channelId || identity.environment !== payload.environment || identity.accountId !== payload.accountId || identity.credentialKey !== payload.credentialKey) throw fail('TikTok account, environment, or selected shop changed after this job was queued.', 409);
    };
    const progress = async message => { current = await persistJob(current, { processedRows: processed, changed, missingCount: failed + unmatched, message }); };

    try {
      await check();
      if (operation === 'order-identity-repair') {
        if (typeof deps.repairOrderIdentities !== 'function') throw fail('TikTok order identity repair is not configured.', 501);
        const repair = await deps.repairOrderIdentities({
          jobId: job.id,
          accountId: payload.accountId,
          startDate: payload.startDate,
          endDate: payload.endDate,
          orderIds: payload.orderIds,
          check,
          onProgress: async state => {
            processed = Number(state.scannedLines || 0);
            changed = Number(state.repairedLines || 0);
            unmatched = Number(state.unresolvedLines || 0);
            current = await persistJob(current, {
              phase: 'repairing_order_identities',
              processedRows: processed,
              changed,
              missingCount: unmatched,
              message: `${Number(state.scannedOrders || 0)} TikTok orders checked; ${changed} line identities repaired; ${unmatched} unresolved.`
            });
          }
        });
        processed = Number(repair.scannedLines || 0);
        changed = Number(repair.repairedLines || 0);
        unmatched = Number(repair.unresolvedLines || 0);
        fs.appendFileSync(report, `${JSON.stringify({ type: 'summary', ...repair, at: stamp() })}\n`);
      } else if (operation === 'orders') {
        const windows = dateWindows(payload.startDate, payload.endDate);
        if (payload.historicalBackfill !== true) windows.reverse();
        for (let windowIndex = 0; windowIndex < windows.length; windowIndex += 1) {
          let pageToken = '';
          const seen = new Set();
          do {
            await check();
            if (pageToken && seen.has(pageToken)) throw fail('TikTok repeated an order page token; import stopped to avoid a loop.', 502);
            if (pageToken) seen.add(pageToken);
            const response = await jobRequest('/order/202309/orders/search', {
              method: 'POST', gate: 'tiktokOrdersEnabled', retryable: true, jobId: job.id, operation: 'Import TikTok orders',
              // Recovery windows may contain thousands of existing orders.
              // Process current sales before older reconciliation work.
              query: { page_size: 100, sort_field: 'update_time', sort_order: 'DESC', page_token: pageToken },
              body: { update_time_ge: dateSeconds(windows[windowIndex].start), update_time_lt: dateSeconds(windows[windowIndex].end) }
            });
            const summaries = array(response.data?.orders);
            for (const summary of summaries) if (text(summary.id)) observedOrderIds.add(text(summary.id));
            const details = await getOrderDetails(summaries.map(raw => raw.id), payload.accountId, {
              jobId: job.id,
              operation: 'Hydrate TikTok order import details'
            });
            const detailById = new Map(details.map(raw => [text(raw.id), raw]));
            const savedDetails = [];
            for (const summary of summaries) {
              await check();
              try {
                const raw = detailById.get(text(summary.id));
                if (!raw) throw fail(`TikTok order ${text(summary.id) || 'without an ID'} was not returned by Get Order Detail.`, 502);
                const mapped = { ...(await mapOrderWithLiveEvidence(raw)), channelAccountId: payload.accountId, channelAccountName: payload.accountName };
                const exists = await postgres.readChannelOrderForReturn('TikTok Shop', { orderId: mapped.marketplaceOrderId, existsOnly: true });
                const saved = await deps.saveOrder(mapped, { existingRefresh: Boolean(exists), historicalBackfill: payload.historicalBackfill === true, jobId: job.id });
                const action = saved?.action || (exists ? 'updated' : 'imported');
                if (saved?.order || exists) persistedOrderIds.add(mapped.marketplaceOrderId);
                if (action !== 'skipped') changed += 1;
                record({ orderId: mapped.marketplaceOrderId, localOrderId: saved?.order?.id || mapped.id, status: action });
                savedDetails.push(raw);
                if (processed % 10 === 0) await progress(`Range ${windowIndex + 1}/${windows.length}: ${processed} TikTok orders saved; optional package details are pending.`);
              } catch (error) { record({ orderId: summary.id, error: error.message }); }
            }
            const packageEvidence = await loadTikTokPackageGroups(savedDetails, payload.accountId, {
              jobId: job.id,
              onProgress: message => progress(`Range ${windowIndex + 1}/${windows.length}: ${processed} TikTok orders saved. ${message}`)
            });
            warnings.push(...packageEvidence.warnings);
            if (packageEvidence.groups.size) {
              for (const raw of savedDetails) {
                const packageIds = array(raw.line_items).map(line => text(line.package_id)).filter(Boolean);
                if (!packageIds.some(packageId => packageEvidence.groups.has(packageId))) continue;
                try {
                  const enriched = { ...(await mapOrderWithLiveEvidence(raw, { packageGroups: packageEvidence.groups })), channelAccountId: payload.accountId, channelAccountName: payload.accountName };
                  await deps.saveOrder(enriched, { existingRefresh: true, historicalBackfill: payload.historicalBackfill === true, jobId: job.id });
                } catch (error) {
                  warnings.push(`TikTok order ${text(raw.id)} package enrichment: ${error.message}`);
                }
              }
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
            const response = await jobRequest('/return_refund/202602/returns/search', {
              method: 'POST', gate: 'tiktokReturnsEnabled', retryable: true, jobId: job.id, operation: 'Import TikTok returns',
              query: { page_size: 50, sort_field: 'update_time', sort_order: 'ASC', page_token: pageToken },
              body: { update_time_ge: dateSeconds(windows[windowIndex].start), update_time_lt: dateSeconds(windows[windowIndex].end) }
            });
            const rows = array(response.data?.return_orders || response.data?.returns);
            for (const raw of rows) {
              await check();
              try {
                const result = await saveReturn(raw, payload);
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
          const response = await jobRequest('/product/202502/products/search', {
            method: 'POST', gate: 'tiktokCatalogEnabled', retryable: true, jobId: job.id, operation: 'Reconcile TikTok products',
            query: { page_size: 100, page_token: pageToken }, body: {}
          });
          for (const raw of array(response.data?.products)) {
            const productId = text(raw.id);
            const sellerSkus = array(raw.skus).map(sku => text(sku.seller_sku)).filter(Boolean);
            await write(`tiktok.product.${productId}`, { productId, sellerSkus, status: text(raw.status), checkedAt: stamp(), raw });
            const match = deps.saveProductSnapshot ? await deps.saveProductSnapshot(raw) : { matched: 0 };
            if (Number(match?.matched || 0) > 0) changed += 1;
            else unmatched += 1;
            record({
              productId,
              sellerSkus,
              status: Number(match?.matched || 0) > 0 ? 'linked' : 'needs_mapping',
              listingStatus: text(raw.status),
              matchedCatalogProducts: Number(match?.matched || 0)
            });
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
            const response = await jobRequest(apiPath, { gate: 'tiktokCatalogEnabled', jobId: job.id, operation: `Sync TikTok ${name}`, query });
            await saveSnapshot(`tiktok.commerce.${name}`, { data: response.data || null, requestId: response.request_id || '' }, payload.accountId);
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
              const response = await jobRequest(apiPath, { gate: 'tiktokAnalyticsEnabled', jobId: job.id, operation: `Sync TikTok ${name} analytics`, query });
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
        await saveSnapshot('tiktok.analytics.summary', { range: { startDate: payload.startDate, endDate: payload.endDate }, snapshots }, payload.accountId);
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
            const response = await jobRequest(apiPath, { method, gate: 'tiktokAffiliateEnabled', jobId: job.id, operation: `Sync TikTok ${name}`, query, ...(body === undefined ? {} : { body }) });
            await saveSnapshot(`tiktok.affiliate.${name}`, { data: response.data || null, requestId: response.request_id || '' }, payload.accountId);
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
            const response = await jobRequest(apiPath, { method: body === undefined ? 'GET' : 'POST', gate: 'tiktokPromotionsEnabled', jobId: job.id, operation: `Sync TikTok ${name}`, query, ...(body === undefined ? {} : { body }) });
            await saveSnapshot(`tiktok.promotions.${name}`, { data: response.data || null, requestId: response.request_id || '' }, payload.accountId);
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
            const response = await jobRequest(apiPath, { gate: 'tiktokCustomerEngagementEnabled', jobId: job.id, operation: `Sync TikTok customer engagement ${name}`, query });
            await saveSnapshot(`tiktok.engagement.${name}`, { data: response.data || null, requestId: response.request_id || '' }, payload.accountId);
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
          const productKeys = [product.id, product.productId, product.sku]
            .map(value => text(value).toLowerCase())
            .filter(Boolean);
          const launchOverride = array(payload.launchOverrides).find((entry) => [entry.productKey, entry.productId, entry.parentSku]
            .map(value => text(value).toLowerCase())
            .filter(Boolean)
            .some(key => productKeys.includes(key))) || {};
          const merchantSku = text(launchOverride.merchantSku || product.sku);
          const mappedCategoryId = text(
            launchOverride.categoryId
            || product.tiktokCategoryId
            || product.tiktokCategory?.categoryId
            || product.tiktokListings?.[payload.accountId]?.categoryId
            || product.tiktokListing?.categoryId
          );
          let categoryOverride = {};
          let categoryIssue = '';
          const automaticCategoryFamily = text(channelSettings.tiktokAutoCategoryFamily);
          const categoryContext = productCategoryContext(product);
          if (!mappedCategoryId && automaticCategoryFamily) {
            try {
              const productTitle = text(launchOverride.title || product.marketplaceTitle || product.title).slice(0, 255);
              const description = text(product.longDescription || product.description || product.shortDescription || productTitle).slice(0, 10_000);
              const categoryQuery = [automaticCategoryFamily, categoryContext.productType, productTitle].filter(Boolean).join(' > ').slice(0, 255);
              const response = await jobRequest('/product/202309/categories/recommend', {
                method: 'POST',
                gate: 'tiktokLaunchEnabled',
                jobId: job.id,
                operation: `Map TikTok category ${product.sku}`,
                body: {
                  category_version: text(channelSettings.tiktokCategoryVersion || 'v2') || 'v2',
                  product_title: categoryQuery,
                  ...(description ? { description } : {})
                }
              });
              const recommendation = recommendedCategory(response, automaticCategoryFamily);
              if (!recommendation.categoryId) categoryIssue = `TikTok did not recommend a leaf category under ${automaticCategoryFamily}.`;
              else if (!recommendation.familyMatched) categoryIssue = `TikTok recommended ${recommendation.categoryPath.join(' > ') || recommendation.categoryName}, not ${automaticCategoryFamily}.`;
              else if (!recommendation.available) categoryIssue = `TikTok category ${recommendation.categoryPath.join(' > ') || recommendation.categoryName} is not available to this shop (${recommendation.permissionStatuses.join(', ') || 'permission required'}).`;
              else {
                categoryOverride = {
                  categoryId: recommendation.categoryId,
                  categoryName: recommendation.categoryName,
                  categoryPath: recommendation.categoryPath,
                  categorySource: 'tiktok_product_type_recommendation',
                  sourceProductType: categoryContext.productType,
                  sourceProductTypeKind: categoryContext.source,
                  categoryMatchQuery: categoryQuery
                };
                if (typeof deps.saveProductCategoryMapping === 'function' && categoryContext.productType) {
                  const savedMapping = await deps.saveProductCategoryMapping(product, categoryOverride);
                  if (savedMapping?.blocked) {
                    categoryIssue = text(savedMapping.reason) || `TikTok category mapping for ${categoryContext.productType} is blocked.`;
                    categoryOverride = {};
                  } else if (savedMapping?.categoryId) {
                    categoryOverride = {
                      ...categoryOverride,
                      categoryId: text(savedMapping.categoryId),
                      categoryName: text(savedMapping.categoryName || recommendation.categoryName),
                      categoryPath: array(savedMapping.categoryPath).length ? savedMapping.categoryPath : recommendation.categoryPath,
                      categorySource: text(savedMapping.categorySource || categoryOverride.categorySource)
                    };
                  }
                }
                if (!categoryIssue) {
                  await deps.saveProductListing(product, {
                    ...(product.tiktokListings?.[payload.accountId] || product.tiktokListing || {}),
                    accountId: payload.accountId,
                    accountName: payload.accountName,
                    ...categoryOverride,
                    categoryMappedAt: stamp()
                  });
                }
              }
            } catch (error) {
              categoryIssue = `TikTok category recommendation failed: ${error.message}`;
            }
          }
          let imageUri = '';
          const imageMatch = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=\s]+)$/i.exec(text(launchOverride.imageDataUrl));
          if (imageMatch) {
            const imageBytes = Buffer.from(imageMatch[2], 'base64');
            if (!imageBytes.length || imageBytes.length > 5 * 1024 * 1024) throw fail('The live-session product photo must be 5 MB or smaller.', 400);
            const upload = await jobRequest('/product/202309/images/upload', {
              method: 'POST', gate: 'tiktokLaunchEnabled', jobId: job.id,
              operation: `Upload TikTok image ${product.sku}`,
              multipartFile: {
                fieldName: 'data',
                filename: `${merchantSku || product.sku || 'live-item'}.${imageMatch[1].toLowerCase() === 'image/png' ? 'png' : 'jpg'}`,
                contentType: imageMatch[1].toLowerCase(),
                buffer: imageBytes
              }
            });
            imageUri = text(upload.data?.uri);
            if (!imageUri) throw fail('TikTok accepted the product photo but did not return an image URI.', 502);
          }
          const review = productListing(product, channelSettings, {
            ...launchOverride,
            ...categoryOverride,
            imageUri,
            accountId: payload.accountId,
            idempotencyKey: payload.sourceLiveSessionId ? `${payload.accountId}:${payload.sourceLiveSessionId}:${merchantSku}` : ''
          });
          if (categoryIssue) review.issues.push(categoryIssue);
          if (review.issues.length) {
            unmatched += 1;
            record({ sku: product.sku, merchantSku, category: review.computed.categoryPath.join(' > ') || review.computed.categoryName, categorySource: review.computed.categorySource, status: 'not_ready', issues: review.issues, reason: review.issues.join('; ') });
            continue;
          }
          try {
            const existingProductId = text(review.listing.productId || review.listing.id);
            if (existingProductId) {
              record({ sku: product.sku, merchantSku, productId: existingProductId, status: 'already_linked' });
              continue;
            }
            const { save_mode: _saveMode, idempotency_key: _idempotencyKey, category_version: _categoryVersion, ...checkPayload } = review.payload;
            await jobRequest('/product/202309/products/listing_check', { method: 'POST', gate: 'tiktokLaunchEnabled', jobId: job.id, operation: `Check TikTok listing ${product.sku}`, body: checkPayload });
            const response = await jobRequest('/product/202309/products', { method: 'POST', gate: 'tiktokLaunchEnabled', jobId: job.id, operation: `Create TikTok product ${product.sku}`, body: review.payload });
            const remote = response.data || {};
            await deps.saveProductListing(product, {
              ...review.listing,
              accountId: payload.accountId,
              accountName: payload.accountName,
              merchantSku,
              categoryId: review.computed.categoryId,
              categoryName: review.computed.categoryName,
              categoryPath: review.computed.categoryPath,
              categorySource: review.computed.categorySource,
              productId: text(remote.product_id || remote.id || existingProductId),
              skus: array(remote.skus).length ? remote.skus : review.listing.skus,
              status: text(remote.status || 'PENDING'),
              lastSubmissionAt: stamp(),
              lastRequestId: text(response.request_id),
              lastSubmission: 'create'
            });
            changed += 1;
            record({ sku: product.sku, merchantSku, category: review.computed.categoryPath.join(' > ') || review.computed.categoryName, categorySource: review.computed.categorySource, productId: remote.product_id || remote.id, status: 'submitted', requestId: response.request_id || '' });
          } catch (error) {
            record({ sku: product.sku, merchantSku, status: 'failed', error: error.message, requestId: error.requestId || '' });
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
            const response = await jobRequest(endpoint, { method: 'POST', gate: operation === 'inventory' ? 'tiktokInventoryEnabled' : 'tiktokPriceEnabled', jobId: job.id, operation: `Update TikTok ${operation} ${product.sku}`, body });
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
            const response = await jobRequest('/event/202309/webhooks', {
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
          const response = await jobRequest('/event/202309/webhooks', { method: 'GET', gate: 'tiktokWebhooksEnabled', jobId: job.id, operation: 'Confirm TikTok webhook subscriptions' });
          await write(accountDocumentKey(payload.accountId, 'webhooks.status'), { accountId: payload.accountId, subscriptions: array(response.data?.webhooks), callbackUrl: address, checkedAt: stamp(), requestId: response.request_id || '', results });
        } catch (error) {
          warnings.push(`Subscription verification: ${error.message}`);
        }
      } else if (operation === 'webhook') {
        const eventSettings = await settings();
        const followups = new Set();
        const explicitEventIds = array(payload.eventIds).map(text).filter(Boolean);
        let events = explicitEventIds.length
          ? await Promise.all(explicitEventIds.map(eventId => read(`tiktok.webhook.event.${eventId}`)))
          : [];
        do {
          if (!explicitEventIds.length) {
            const pending = await postgres.getPool().query(`
              select data
              from tiktok_documents
              where doc_key like 'tiktok.webhook.event.%'
                and data->>'state' = 'pending'
                and data->>'accountId' = $1
              order by updated_at, doc_key
              limit 500
            `, [payload.accountId]);
            events = pending.rows.map(row => row.data).filter(Boolean);
          }
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
              const raw = (await getOrderDetails([entity.orderId], payload.accountId, { jobId: job.id, operation: `Reconcile TikTok order event ${entity.orderId}` }))[0];
              if (!raw) throw fail(`TikTok order ${entity.orderId} was not returned for its webhook event.`, 502);
              const mapped = { ...(await mapOrderWithLiveEvidence(raw)), channelAccountId: payload.accountId, channelAccountName: payload.accountName };
              const exists = await postgres.readChannelOrderForReturn('TikTok Shop', { orderId: mapped.marketplaceOrderId, existsOnly: true });
              await deps.saveOrder(mapped, { existingRefresh: Boolean(exists), historicalBackfill: false, jobId: job.id });
              await progress(`${processed}/${events.length} TikTok events reconciled; order ${entity.orderId} is saved and package enrichment is pending.`);
              const packageEvidence = await loadTikTokPackageGroups([raw], payload.accountId, {
                jobId: job.id,
                onProgress: message => progress(`${processed}/${events.length} TikTok events reconciled. ${message}`)
              });
              warnings.push(...packageEvidence.warnings);
              if (packageEvidence.groups.size) {
                const enriched = { ...(await mapOrderWithLiveEvidence(raw, { packageGroups: packageEvidence.groups })), channelAccountId: payload.accountId, channelAccountName: payload.accountName };
                await deps.saveOrder(enriched, { existingRefresh: true, historicalBackfill: false, jobId: job.id });
              }
            } else if (/PRODUCT|INVENTORY/.test(topic) && entity.productId) {
              const response = await jobRequest(`/product/202309/products/${encodeURIComponent(entity.productId)}`, { gate: 'tiktokCatalogEnabled', jobId: job.id, operation: `Reconcile TikTok product event ${entity.productId}` });
              if (response.data?.product && deps.saveProductSnapshot) await deps.saveProductSnapshot(response.data.product);
            } else if (/NEW_(CONVERSATION|MESSAGE)/.test(topic) && entity.conversationId) {
              await conversationDetail(entity.conversationId, true, payload.accountId);
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
            await progress(`${processed} TikTok events reconciled in this run.`);
          }
        } while (!explicitEventIds.length && events.length === 500);
        for (const next of followups) {
          try { await queue(next, { accountId: payload.accountId, lookbackDays: 2, actor: 'system:tiktok-webhook' }); }
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
            const response = await jobRequest('/analytics/202609/shop_lives/overview_performance', {
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
                const response = await jobRequest('/analytics/202609/shop_lives/performance', {
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
              await write(accountDocumentKey(payload.accountId, `live.session.${session.liveId}`), { ...saved, accountId: payload.accountId });
              changed += 1;
              record({ liveId: session.liveId, accountType: session.accountType, title: session.title, products: 0, status: 'session_saved_affiliate_product_detail_unavailable' });
              if ((index + 1) % 10 === 0 || index === sessions.length - 1) await progress(`${index + 1}/${sessions.length} TikTok LIVE sessions saved with product performance.`);
              continue;
            }
            const response = await jobRequest(`/analytics/202512/shop/${encodeURIComponent(session.liveId)}/products_performance`, {
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
          await write(accountDocumentKey(payload.accountId, `live.session.${session.liveId}`), { ...saved, accountId: payload.accountId });
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
                const response = await jobRequest('/affiliate_seller/202410/orders/search', {
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
        await write(accountDocumentKey(payload.accountId, 'live.summary'), {
          accountId: payload.accountId,
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
          const response = await jobRequest('/customer_service/202309/conversations', {
            gate: 'tiktokMessagesEnabled', jobId: job.id, operation: 'Sync TikTok conversations', query: { page_size: 50, page_token: pageToken }
          });
          for (const conversation of array(response.data?.conversations)) {
            await write(conversationKey(payload.accountId, text(conversation.id)), { ...conversation, accountId: payload.accountId, syncedAt: stamp() });
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
          const response = await jobRequest('/finance/202309/statements', {
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
            const response = await jobRequest(`/finance/202501/statements/${encodeURIComponent(statementId)}/statement_transactions`, {
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

      let outboundReconciliation = null;
      if (operation === 'orders' && typeof deps.reconcileOutboundAudits === 'function') {
        try {
          outboundReconciliation = await deps.reconcileOutboundAudits({ sourceJobId: job.id, fullSweep: true });
        } catch (error) {
          warnings.push(`Outbound audit reconciliation needs review: ${error.message || error}`);
        }
      }
      const warning = failed || unmatched || warnings.length;
      const finalStatus = warning ? 'warning' : 'success';
      const outboundMessage = operation === 'orders' && outboundReconciliation
        ? `; ${Number(outboundReconciliation.linked || 0)} previous outbound scan${Number(outboundReconciliation.linked || 0) === 1 ? '' : 's'} linked`
        : '';
      const finalMessage = `${processed} TikTok ${operation} records checked; ${changed} saved; ${unmatched} unmatched; ${failed} failed${outboundMessage}${warnings.length ? `; ${warnings.length} scope or API warning${warnings.length === 1 ? '' : 's'}` : ''}.`;
      const observedButNotPersisted = operation === 'orders'
        ? [...observedOrderIds].filter((orderId) => !persistedOrderIds.has(orderId))
        : [];
      if (observedButNotPersisted.length && typeof deps.notify === 'function') {
        await deps.notify({
          tenantId: settlementScope?.tenantId || '',
          companyId: settlementScope?.companyId || '',
          severity: 'error',
          category: 'channel',
          title: 'TikTok orders were observed but not saved',
          message: `${observedButNotPersisted.length} TikTok order(s) returned by the API were not confirmed in DataPlus. The retained date range will retry automatically.`,
          source: 'tiktok-order-import',
          entityType: 'job',
          entityId: job.id,
          actionUrl: '/jobs',
          dedupeKey: `tiktok-order-persistence-gap:${job.id}`,
          raw: { jobId: job.id, accountId: payload.accountId, orderIds: observedButNotPersisted.slice(0, 100) }
        });
      }
      await persistJob(current, {
        status: finalStatus, phase: 'complete', finishedAt: stamp(), progressPercent: 100,
        processedRows: processed, totalRows: processed, changed, missingCount: failed + unmatched + warnings.length,
        message: finalMessage, errors: warnings,
        sourceLiveSessionId: text(payload.sourceLiveSessionId), sourceLiveSessionNumber: text(payload.sourceLiveSessionNumber), liveSessionLaunchResults,
        artifacts: [{ name: 'TikTok API evidence', fileName: path.basename(report), filePath: report, contentType: 'application/x-ndjson' }]
      });
      if (operation === 'orders' && payload.historicalBackfill !== true) {
        const key = orderCheckpointKey(payload.accountId);
        const previous = await read(key);
        const previousTime = Date.parse(previous?.completedThrough || '');
        const completedTime = Date.parse(payload.endDate || '');
        const canAdvance = failed === 0 && Number.isFinite(completedTime);
        await write(key, {
          ...(previous || {}),
          accountId: payload.accountId,
          accountName: payload.accountName,
          completedThrough: canAdvance
            ? Number.isFinite(previousTime) && previousTime > completedTime ? new Date(previousTime).toISOString() : payload.endDate
            : previous?.completedThrough || '',
          lastCompletedAt: stamp(),
          lastJobId: job.id,
          lastStatus: finalStatus,
          lastMessage: finalMessage,
          lastError: canAdvance ? '' : `${failed} order${failed === 1 ? '' : 's'} failed and must be retried before this checkpoint can advance.`
        });
      }
      if (operation === 'settlements') {
        const key = scheduleDocumentKey(payload.accountId, 'settlements');
        const previous = await read(key);
        await write(key, { ...(previous || {}), accountId: payload.accountId, lastCompletedAt: stamp(), lastJobId: job.id, lastStatus: finalStatus, lastMessage: finalMessage, lastError: '' });
      }
      if (operation === 'live') {
        const key = scheduleDocumentKey(payload.accountId, 'live');
        const previous = await read(key);
        await write(key, { ...(previous || {}), accountId: payload.accountId, lastCompletedAt: stamp(), lastJobId: job.id, lastStatus: finalStatus, lastMessage: finalMessage, lastError: warnings.join(' ') });
      }
    } catch (error) {
      await persistJob(current, { status: error.statusCode === 499 ? 'stopped' : 'failed', phase: error.statusCode === 499 ? 'stopped' : 'failed', finishedAt: stamp(), processedRows: processed, changed, missingCount: failed + unmatched + 1, errors: [error.message], message: error.message, sourceLiveSessionId: text(payload.sourceLiveSessionId), sourceLiveSessionNumber: text(payload.sourceLiveSessionNumber), liveSessionLaunchResults });
      if (operation === 'settlements') {
        const key = scheduleDocumentKey(payload.accountId, 'settlements');
        const previous = await read(key).catch(() => null);
        await write(key, { ...(previous || {}), accountId: payload.accountId, lastCompletedAt: stamp(), lastJobId: job.id, lastStatus: error.statusCode === 499 ? 'stopped' : 'failed', lastMessage: error.message, lastError: error.message }).catch(() => {});
      }
      if (operation === 'live') {
        const key = scheduleDocumentKey(payload.accountId, 'live');
        const previous = await read(key).catch(() => null);
        await write(key, { ...(previous || {}), accountId: payload.accountId, lastCompletedAt: stamp(), lastJobId: job.id, lastStatus: error.statusCode === 499 ? 'stopped' : 'failed', lastMessage: error.message, lastError: error.message }).catch(() => {});
      }
    }
  }

  function isoFromSeconds(value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return new Date(numeric * 1000).toISOString();
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }

  async function findCombinablePackage(orderId = '', accountId = '') {
    const requestedOrderId = text(orderId);
    if (!requestedOrderId) return null;
    let pageToken = '';
    for (let page = 0; page < 10; page += 1) {
      const response = await client.request('/fulfillment/202309/combinable_packages/search', {
        accountId,
        gate: 'tiktokLabelPurchaseEnabled',
        operation: 'Search TikTok combinable packages',
        query: { page_size: 50, ...(pageToken ? { page_token: pageToken } : {}) }
      });
      const packages = array(response.data?.combinable_packages).map(row => ({
        id: text(row.id),
        orderIds: [...new Set(array(row.order_ids).map(text).filter(Boolean))]
      }));
      const match = packages.find(row => row.orderIds.includes(requestedOrderId) && row.orderIds.length > 1);
      if (match) return match;
      const nextPageToken = text(response.data?.next_page_token);
      if (!nextPageToken || nextPageToken === pageToken) break;
      pageToken = nextPageToken;
    }
    return null;
  }

  async function fulfillmentOrder(orderId = '', accountId = '') {
    const requestedAccountId = text(accountId);
    if (!requestedAccountId) throw fail('This order is missing its connected TikTok seller account. Refresh the order before creating a label.', 409);
    const identity = await requireVerified(requestedAccountId);
    await enabled('tiktokOrdersEnabled');
    const requestedOrderId = text(orderId);
    if (!requestedOrderId) throw fail('TikTok order ID is required.', 400);
    const raw = (await getOrderDetails([requestedOrderId], identity.accountId, { operation: `Read TikTok fulfillment order ${requestedOrderId}` }))[0];
    if (!raw) throw fail(`TikTok order ${requestedOrderId} was not returned by Get Order Detail.`, 404);
    const packageIds = [...new Set([
      ...array(raw.packages).map(row => text(row.id)),
      ...array(raw.line_items).map(row => text(row.package_id))
    ].filter(Boolean))];
    const storedPackages = (await readMany('tiktok.package.', 1000)).filter(row => (
      text(row.accountId) === identity.accountId && (
        text(row.orderId || row.payload?.order_id) === requestedOrderId
        || array(row.orderIds || row.payload?.order_list_ids).map(text).includes(requestedOrderId)
      )
    ));
    for (const row of storedPackages) if (text(row.packageId)) packageIds.push(text(row.packageId));
    const uniquePackageIds = [...new Set(packageIds)];
    const combinablePackage = uniquePackageIds.length || text(raw.shipping_type).toUpperCase() !== 'TIKTOK'
      ? null
      : await findCombinablePackage(requestedOrderId, identity.accountId);
    return {
      accountId: identity.accountId,
      accountName: identity.accountName,
      orderId: requestedOrderId,
      status: text(raw.status),
      shippingType: text(raw.shipping_type).toUpperCase(),
      fulfillmentType: text(raw.fulfillment_type),
      warehouseId: text(raw.warehouse_id),
      lineItemIds: array(raw.line_items).map(row => text(row.id)).filter(Boolean),
      packageIds: uniquePackageIds,
      packages: storedPackages,
      combinablePackage,
      labelEligible: text(raw.shipping_type).toUpperCase() === 'TIKTOK' && text(raw.fulfillment_type).toUpperCase() !== 'FULFILLMENT_BY_TIKTOK',
      raw
    };
  }

  async function fulfillmentServices(body = {}) {
    const order = await fulfillmentOrder(body.orderId, body.accountId);
    const identity = await requireVerified(order.accountId);
    await enabled('tiktokFulfillmentEnabled');
    await enabled('tiktokLabelPurchaseEnabled');
    if (!order.labelEligible) throw fail(`TikTok order ${order.orderId} uses ${order.shippingType || 'an unsupported'} shipping. Use the seller-shipping label workflow for this order.`, 409);
    const requestBody = body.package && typeof body.package === 'object' ? { ...body.package } : {};
    if (!array(requestBody.order_line_item_ids).length && order.lineItemIds.length) requestBody.order_line_item_ids = order.lineItemIds;
    if (!text(requestBody.warehouse_id) && order.warehouseId) requestBody.warehouse_id = order.warehouseId;
    return client.request(`/fulfillment/202309/orders/${encodeURIComponent(order.orderId)}/shipping_services/query`, {
      accountId: identity.accountId, method: 'POST', gate: 'tiktokLabelPurchaseEnabled', body: requestBody, operation: 'Quote TikTok shipping services'
    });
  }

  async function previewPackage(body = {}, actor = '') {
    const payload = body.package && typeof body.package === 'object' ? body.package : null;
    const shipType = text(payload?.ship_type || '1');
    const combinedOrderIds = [...new Set(array(payload?.order_list_ids).map(text).filter(Boolean))];
    const requestedOrderId = shipType === '3' ? combinedOrderIds[0] : text(payload?.order_id);
    const order = await fulfillmentOrder(requestedOrderId, body.accountId);
    const identity = await requireVerified(order.accountId);
    await enabled('tiktokFulfillmentEnabled');
    await enabled('tiktokLabelPurchaseEnabled');
    if (!['1', '3'].includes(shipType)) throw fail('This workflow supports one complete order or one TikTok-approved combined order group.', 400);
    if (!requestedOrderId || !payload?.shipping_service_id || !payload?.weight || !payload?.dimension) throw fail('Order, shipping service, weight, and dimensions are required.', 400);
    if (shipType === '3') {
      if (combinedOrderIds.length < 2) throw fail('A combined TikTok shipment requires at least two order IDs.', 400);
      const eligibleOrderIds = array(order.combinablePackage?.orderIds).map(text).filter(Boolean);
      const submitted = [...combinedOrderIds].sort();
      const eligible = [...eligibleOrderIds].sort();
      if (!order.combinablePackage || JSON.stringify(submitted) !== JSON.stringify(eligible)) {
        throw fail('TikTok no longer considers these exact orders eligible for one combined shipment. Refresh before purchasing a label.', 409);
      }
    }
    if (!order.labelEligible) throw fail(`TikTok order ${order.orderId} is not eligible for a TikTok Shipping label.`, 409);
    if (!['AWAITING_SHIPMENT', 'PARTIALLY_SHIPPING'].includes(order.status)) throw fail(`TikTok order ${order.orderId} is ${order.status || 'not ready'} and cannot purchase a new label.`, 409);
    if (order.packageIds.length) throw fail(`TikTok order ${order.orderId} already has package ${order.packageIds[0]}. Retrieve its existing label instead of buying another one.`, 409);
    const token = crypto.randomUUID();
    const preview = { token, actor, state: 'preview', payload, channelId: identity.current.id, environment: identity.environment, accountId: identity.accountId, credentialKey: identity.credentialKey, createdAt: stamp(), expiresAt: Date.now() + 15 * 60_000 };
    await write(`tiktok.package-preview.${token}`, preview);
    return { token, payload, expiresAt: preview.expiresAt, message: shipType === '3'
      ? `One TikTok package for ${combinedOrderIds.length} combined orders is ready for final confirmation. No label has been purchased yet.`
      : 'TikTok label package is ready for final confirmation. No label has been purchased yet.' };
  }

  async function createPackage(token, actor = '') {
    const key = `tiktok.package-preview.${text(token)}`;
    const preview = await read(key);
    if (!preview || preview.actor !== actor || preview.state !== 'preview' || Number(preview.expiresAt) < Date.now()) throw fail('A valid package preview owned by your user is required.', 409);
    const identity = await requireVerified(preview.accountId);
    if (preview.channelId !== identity.current.id || preview.environment !== identity.environment || preview.accountId !== identity.accountId || preview.credentialKey !== identity.credentialKey) throw fail('TikTok account or shop changed after preview. Review the package again.', 409);
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
    const previewOrderIds = [...new Set([
      ...array(claimedPreview.payload?.order_list_ids).map(text),
      text(claimedPreview.payload?.order_id)
    ].filter(Boolean))];
    const packageLockKey = `tiktok-package:${identity.accountId}:${[...previewOrderIds].sort().join(',')}`;
    const lockClient = await postgres.getPool().connect();
    try {
      await lockClient.query('select pg_advisory_lock(hashtext($1))', [packageLockKey]);
      const currentOrder = await fulfillmentOrder(previewOrderIds[0], identity.accountId);
      if (currentOrder.packageIds.length) {
        await write(key, { ...claimedPreview, state: 'superseded', failedAt: stamp(), error: `Package ${currentOrder.packageIds[0]} already exists.` });
        throw fail(`TikTok order ${previewOrderIds[0]} already has package ${currentOrder.packageIds[0]}. Retrieve its existing shared label instead of buying another one.`, 409);
      }
      if (previewOrderIds.length > 1) {
        const currentEligible = array(currentOrder.combinablePackage?.orderIds).map(text).filter(Boolean).sort();
        if (JSON.stringify(currentEligible) !== JSON.stringify([...previewOrderIds].sort())) {
          await write(key, { ...claimedPreview, state: 'superseded', failedAt: stamp(), error: 'TikTok combined-shipment membership changed.' });
          throw fail('TikTok changed this combined shipment after preview. Refresh the order before purchasing a label.', 409);
        }
      }
      try {
        const result = await client.request('/fulfillment/202512/packages', { accountId: identity.accountId, method: 'POST', gate: 'tiktokLabelPurchaseEnabled', body: claimedPreview.payload, operation: 'Purchase TikTok shipping label' });
        const applied = { ...claimedPreview, state: 'applied', appliedAt: stamp(), result };
        await write(key, applied);
        const packageId = text(result.data?.package_id || result.data?.id);
        if (packageId) await write(`tiktok.package.${packageId}`, {
          packageId,
          orderId: text(claimedPreview.payload?.order_id || claimedPreview.payload?.order_list_ids?.[0]),
          orderIds: array(claimedPreview.payload?.order_list_ids).map(text).filter(Boolean),
          accountId: identity.accountId,
          previewToken: text(token),
          actor,
          createdAt: applied.appliedAt,
          payload: claimedPreview.payload,
          result
        });
        const combinedCount = array(claimedPreview.payload?.order_list_ids).length;
        return { ...result, message: combinedCount > 1
          ? `TikTok combined ${combinedCount} orders into one package. Download the shared shipping document before printing.`
          : 'TikTok package created. Download the shipping document before printing.' };
      } catch (error) {
        await write(key, { ...claimedPreview, state: 'reconciliation_required', failedAt: stamp(), error: error.message });
        throw fail(`${error.message} The preview was locked to prevent a duplicate label; reconcile the order in TikTok Shop before trying again.`, error.statusCode || 502, { requestId: error.requestId || '' });
      }
    } finally {
      await lockClient.query('select pg_advisory_unlock(hashtext($1))', [packageLockKey]).catch(() => {});
      lockClient.release();
    }
  }

  async function shippingDocument(packageId, accountId = '', options = {}) {
    const requestedAccountId = text(accountId);
    if (!requestedAccountId) throw fail('The connected TikTok seller account is required to retrieve this label.', 409);
    const identity = await requireVerified(requestedAccountId);
    await enabled('tiktokFulfillmentEnabled');
    await enabled('tiktokLabelPurchaseEnabled');
    if (!text(packageId)) throw fail('Package ID is required.', 400);
    const documentType = text(options.documentType || 'SHIPPING_LABEL_AND_PACKING_SLIP').toUpperCase();
    const supportedDocumentTypes = new Set([
      'SHIPPING_LABEL',
      'PACKING_SLIP',
      'SHIPPING_LABEL_AND_PACKING_SLIP',
      'SHIPPING_LABEL_PICTURE',
      'HAZMAT_LABEL'
    ]);
    if (!supportedDocumentTypes.has(documentType)) throw fail('Choose a supported TikTok shipping document type.', 400);
    const documentSize = text(options.documentSize || 'A6').toUpperCase();
    if (!['A5', 'A6'].includes(documentSize)) throw fail('TikTok PDF package documents support A5 or A6 size.', 400);
    const sizeApplies = !['SHIPPING_LABEL_PICTURE', 'HAZMAT_LABEL'].includes(documentType);
    const formatApplies = documentType !== 'SHIPPING_LABEL_PICTURE';
    const documentKey = `${documentType}:${sizeApplies ? documentSize : documentType === 'HAZMAT_LABEL' ? 'A4' : 'PNG'}`;
    const result = await client.request(`/fulfillment/202309/packages/${encodeURIComponent(packageId)}/shipping_documents`, {
      accountId: identity.accountId,
      gate: 'tiktokLabelPurchaseEnabled',
      operation: `Download TikTok ${documentType.toLowerCase().replaceAll('_', ' ')}`,
      query: {
        document_type: documentType,
        ...(sizeApplies ? { document_size: documentSize } : {}),
        ...(formatApplies ? { document_format: 'PDF' } : {})
      }
    });
    const key = `tiktok.package.${text(packageId)}`;
    const current = await read(key);
    await write(key, {
      ...(current || {}),
      packageId: text(packageId),
      accountId: identity.accountId,
      document: result.data || null,
      documents: {
        ...(current?.documents || {}),
        [documentKey]: {
          ...(result.data || {}),
          documentType,
          documentSize: sizeApplies ? documentSize : documentType === 'HAZMAT_LABEL' ? 'A4' : '',
          documentFormat: formatApplies ? 'PDF' : 'PNG',
          retrievedAt: stamp()
        }
      },
      documentType,
      documentSize: sizeApplies ? documentSize : documentType === 'HAZMAT_LABEL' ? 'A4' : '',
      documentFormat: formatApplies ? 'PDF' : 'PNG',
      documentRetrievedAt: stamp()
    });
    return {
      ...result,
      documentType,
      documentSize: sizeApplies ? documentSize : documentType === 'HAZMAT_LABEL' ? 'A4' : '',
      documentFormat: formatApplies ? 'PDF' : 'PNG'
    };
  }

  async function handle(req, res, url, actor, sendJson, parseBody) {
    const actorId = typeof actor === 'string' ? actor : text(actor?.id);
    const action = url.pathname.replace(/^\/api\/tiktok\/?/, '').replace(/\/+$/, '');
    try {
      let result;
      if (req.method === 'GET' && action === 'status') result = await publicStatus();
      else if (req.method === 'GET' && action === 'status/jobs') result = await publicRecentJobs();
      else if (req.method === 'GET' && action === 'health/orders') result = await publicOrderHealth(url.searchParams.get('accountId'));
      else if (req.method === 'GET' && action === 'live') result = await publicLiveStatus();
      else if (req.method === 'GET' && action === 'workspace') result = await publicWorkspace();
      else if (req.method === 'GET' && action === 'capabilities') result = { capabilities: CAPABILITIES };
      else if (req.method === 'GET' && action === 'webhooks/status') result = await webhookStatus(true, req, url.searchParams.get('accountId'));
      else if (req.method === 'POST' && action === 'webhooks/setup') result = await setupWebhooks(req, (await parseBody(req)).accountId);
      else if (req.method === 'GET' && action === 'messages') result = await listConversations({ accountId: url.searchParams.get('accountId'), q: url.searchParams.get('q'), unreadOnly: url.searchParams.get('unread') === 'true', limit: url.searchParams.get('limit') });
      else if (req.method === 'GET' && /^messages\/[^/]+$/.test(action)) result = await conversationDetail(decodeURIComponent(action.split('/')[1]), url.searchParams.get('refresh') !== 'false', url.searchParams.get('accountId'));
      else if (req.method === 'POST' && /^messages\/[^/]+\/read$/.test(action)) {
        const body = await parseBody(req);
        result = await markConversationRead(decodeURIComponent(action.split('/')[1]), body.accountId);
      }
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
      } else if (req.method === 'POST' && action === 'accounts/select') {
        if (!deps.canManageCredentials(actor)) throw fail('Channel credential permission is required.', 403);
        const body = await parseBody(req);
        const current = await enabled();
        const environment = current.settings?.tiktokEnvironment === 'development' ? 'development' : 'production';
        result = { ...credentials.setActiveAccount(environment, body.accountId), message: 'TikTok seller account selected.' };
      } else if (req.method === 'POST' && action === 'accounts/remove') {
        if (!deps.canManageCredentials(actor)) throw fail('Channel credential permission is required.', 403);
        const body = await parseBody(req);
        const current = await enabled();
        const environment = current.settings?.tiktokEnvironment === 'development' ? 'development' : 'production';
        const removed = credentials.removeAccount(environment, body.accountId);
        await postgres.getPool().query('delete from tiktok_documents where doc_key=$1', [connectionKey(removed.account.id)]);
        result = {
          ...removed.status,
          disconnectedAccountId: removed.account.id,
          message: `${removed.account.shopName || removed.account.label || 'TikTok seller account'} disconnected from DataPlus. Historical orders and job evidence were preserved.`
        };
        log({ channel: 'TikTok Shop', transport: 'Settings', method: 'DELETE', path: 'accounts/remove', operation: 'Disconnect TikTok seller account', statusCode: 200, ok: true, message: result.message });
      } else if (req.method === 'POST' && action === 'connection/verify') {
        const body = await parseBody(req);
        result = await verifyConnection(body.accountId);
      }
      else if (req.method === 'POST' && action === 'creators/verify') {
        if (!deps.canManageCredentials(actor)) throw fail('Channel credential permission is required.', 403);
        result = await verifyCreator((await parseBody(req)).creatorId);
      }
      else if (req.method === 'POST' && action === 'creators/remove') {
        if (!deps.canManageCredentials(actor)) throw fail('Channel credential permission is required.', 403);
        const body = await parseBody(req);
        const current = await enabled();
        const environment = current.settings?.tiktokEnvironment === 'development' ? 'development' : 'production';
        const removed = credentials.removeCreator(environment, body.creatorId);
        result = { ...removed, message: `${removed.label || 'Official TikTok LIVE account'} disconnected. Historical session evidence was preserved.` };
      }
      else if (req.method === 'POST' && action === 'setup/initial') {
        const body = await parseBody(req);
        result = await initialSetup({ ...body, actor: actorId }, req);
      }
      else if (req.method === 'POST' && action === 'shops/select') {
        const body = await parseBody(req);
        const current = await enabled();
        const environment = current.settings?.tiktokEnvironment === 'development' ? 'development' : 'production';
        const selectedAccount = credentials.get(environment, body.accountId);
        if (!selectedAccount.accountId) throw fail('Choose a connected TikTok seller account.', 409);
        const connection = await read(connectionKey(selectedAccount.accountId));
        const shop = array(connection?.shops).find(row => text(row.cipher) === text(body.shopCipher));
        if (!shop) throw fail('Choose a shop returned by the latest connection verification.', 409);
        result = { ...credentials.selectShop(environment, shop, selectedAccount.accountId), message: `${shop.name || 'TikTok Shop'} selected. Verify the connection again before running jobs.` };
        log({ channel: 'TikTok Shop', transport: 'Settings', method: 'UPDATE', path: 'shops/select', operation: 'Select TikTok Shop', statusCode: 200, ok: true, message: `Selected ${shop.name || shop.code || shop.id || 'authorized shop'}.` });
      } else if (req.method === 'POST' && action.startsWith('jobs/')) {
        const body = await parseBody(req);
        result = await queue(action.slice(5), { ...body, actor: actorId });
      } else if (req.method === 'POST' && action === 'fulfillment/services') result = await fulfillmentServices(await parseBody(req));
      else if (req.method === 'GET' && /^fulfillment\/orders\/[^/]+$/.test(action)) {
        result = await fulfillmentOrder(decodeURIComponent(action.split('/')[2] || ''), url.searchParams.get('accountId'));
      }
      else if (req.method === 'POST' && action === 'fulfillment/packages/preview') result = await previewPackage(await parseBody(req), actorId);
      else if (req.method === 'POST' && action === 'fulfillment/packages/apply') result = await createPackage((await parseBody(req)).token, actorId);
      else if (req.method === 'GET' && action.startsWith('fulfillment/packages/') && action.endsWith('/document')) {
        const packageId = decodeURIComponent(action.split('/')[2] || '');
        result = await shippingDocument(packageId, url.searchParams.get('accountId'), {
          documentType: url.searchParams.get('documentType'),
          documentSize: url.searchParams.get('documentSize')
        });
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
    const environment = s.tiktokEnvironment === 'development' ? 'development' : 'production';
    const accounts = credentials.accounts(environment).filter(account => account.configured && account.shopSelected);
    if (!accounts.length) return;
    const scheduleOperation = async (accountId, operation, enabledKey, scheduleKey, hoursKey, daysKey, fallbackHours, fallbackDays) => {
      if (s[enabledKey] !== true || (operation !== 'orders' && s[scheduleKey] !== true)) return;
      const key = scheduleDocumentKey(accountId, operation);
      const previous = await read(key);
      const hours = clamp(s[hoursKey], 1, 24, fallbackHours);
      const intervalMinutes = operation === 'orders'
        ? clamp(s.tiktokOrderReconciliationMinutes, 10, 60, 10)
        : hours * 60;
      if (previous?.queuedAt && Date.now() - Date.parse(previous.queuedAt) < intervalMinutes * 60_000) return;
      try {
        const result = await queue(operation, { accountId, scheduled: true, actor: `system:tiktok-${operation}`, lookbackDays: clamp(s[daysKey], 1, operation === 'orders' ? 365 : 180, fallbackDays) });
        if (!result.duplicate) await write(key, { accountId, queuedAt: stamp(), jobId: result.job.id, intervalHours: hours, intervalMinutes });
      } catch (error) {
        log({ channel: 'TikTok Shop', transport: 'Schedule', method: 'QUEUE', path: operation, operation: `Schedule TikTok ${operation}`, statusCode: error.statusCode || 500, ok: false, message: `${accountId}: ${error.message}` });
      }
    };
    for (const account of accounts) {
      await scheduleOperation(account.id, 'orders', 'tiktokOrdersEnabled', 'tiktokOrderScheduleEnabled', 'tiktokOrderScheduleHours', 'tiktokOrderLookbackDays', 1, 30);
      await scheduleOperation(account.id, 'returns', 'tiktokReturnsEnabled', 'tiktokReturnScheduleEnabled', 'tiktokReturnScheduleHours', 'tiktokReturnLookbackDays', 2, 30);
      await scheduleOperation(account.id, 'settlements', 'tiktokSettlementImportEnabled', 'tiktokSettlementScheduleEnabled', 'tiktokSettlementScheduleHours', 'tiktokSettlementLookbackDays', 24, 45);
      await scheduleOperation(account.id, 'live', 'tiktokLiveAnalyticsEnabled', 'tiktokLiveScheduleEnabled', 'tiktokLiveScheduleHours', 'tiktokLiveLookbackDays', 24, 30);
      await scheduleOperation(account.id, 'messages', 'tiktokMessagesEnabled', 'tiktokMessageScheduleEnabled', 'tiktokMessageScheduleHours', 'tiktokOrderLookbackDays', 1, 7);
      await scheduleOperation(account.id, 'analytics', 'tiktokAnalyticsEnabled', 'tiktokAnalyticsScheduleEnabled', 'tiktokAnalyticsScheduleHours', 'tiktokAnalyticsLookbackDays', 24, 30);
    }
    if (s.tiktokWebhooksEnabled === true) {
      for (const account of accounts) {
        const pending = await postgres.getPool().query(`select 1 from tiktok_documents where doc_key like 'tiktok.webhook.event.%' and data->>'state'='pending' and data->>'accountId'=$1 limit 1`, [account.id]);
        if (pending.rowCount) await queue('webhook', { accountId: account.id, scheduled: true, actor: 'system:tiktok-webhook-recovery', lookbackDays: 1 });
      }
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
    handle, publicStatus, publicLiveStatus, publicWorkspace, queue, run, schedule, verifyConnection, initialSetup,
    webhookStatus, setupWebhooks, receiveWebhook,
    listConversations, conversationDetail, markConversationRead, sendConversationMessage,
    fulfillmentOrder, fulfillmentServices, previewPackage, createPackage, shippingDocument,
    verifyCreator, syncCreatorLiveProducts, studioStatus, studioProductAction
  };
}

module.exports = { CAPABILITIES, createTikTokMarketplace, productCategoryContext, recommendedCategory };
