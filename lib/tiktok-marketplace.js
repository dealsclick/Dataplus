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
  { key: 'launch', label: 'Product launch', state: 'foundation', api: 'Create product 202309 / listing check 202309', note: 'Requires category, attribute, media-upload, and reviewed publish mapping before live use.' },
  { key: 'inventory', label: 'Inventory and price updates', state: 'foundation', api: 'Inventory update 202309 / price update 202309', note: 'Existing inactive-SKU zeroing remains available; positive inventory requires warehouse mapping.' },
  { key: 'labels', label: 'TikTok Shipping services and labels', state: 'foundation', api: 'Shipping services 202309 / create package 202512 / documents 202309', note: 'Signed service, preview, package-create, and document endpoints are ready; order fulfillment UI wiring remains disabled.' },
  { key: 'messages', label: 'Buyer conversations', state: 'foundation', api: 'Customer service conversations 202309 / send message 202606', note: 'Conversation synchronization is available; the support inbox and reviewed send-message action remain disabled.' },
  { key: 'webhooks', label: 'Order, return, product, and message webhooks', state: 'foundation', api: 'Event webhooks 202309', note: 'Subscription discovery is available; inbound signature verification must be configured before event processing is enabled.' }
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

  const gateFor = operation => ({
    orders: 'tiktokOrdersEnabled',
    returns: 'tiktokReturnsEnabled',
    settlements: 'tiktokSettlementImportEnabled',
    products: 'tiktokCatalogEnabled',
    messages: 'tiktokMessagesEnabled',
    live: 'tiktokLiveAnalyticsEnabled'
  })[operation];

  async function queue(operation, input = {}) {
    if (!['orders', 'returns', 'settlements', 'products', 'messages', 'live'].includes(operation)) throw fail('Unsupported TikTok job.', 400);
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
      section: operation === 'settlements' ? 'Accounting' : operation === 'products' ? 'Products' : 'Channels',
      category: 'TikTok Shop',
      operation: operation === 'live' ? 'TikTok Shop LIVE synchronization' : `TikTok Shop ${operation === 'products' ? 'catalog reconciliation' : operation.slice(0, -1) + ' import'}`,
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
      else if (req.method === 'GET' && action === 'capabilities') result = { capabilities: CAPABILITIES };
      else if (req.method === 'POST' && action === 'credentials') {
        const body = await parseBody(req);
        if (!deps.canManageCredentials(actor)) throw fail('Channel credential permission is required.', 403);
        result = { ...credentials.save(body.environment || 'production', body), message: 'TikTok Shop credentials saved with encryption at rest.' };
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
  }

  return { handle, publicStatus, publicLiveStatus, queue, run, schedule, verifyConnection, fulfillmentServices, previewPackage, createPackage, shippingDocument };
}

module.exports = { CAPABILITIES, createTikTokMarketplace };
