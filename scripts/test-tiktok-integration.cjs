const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { tiktokSignature } = require('../lib/tiktok-client');
const { createTikTokCredentials } = require('../lib/tiktok-credentials');
const {
  creatorAuthorizationUrl,
  exchangeAuthorizationCode,
  exchangeCreatorAuthorizationCode,
  isTikTokAuthorizationCallbackUrl,
  recoverTikTokAuthorizationState,
  sellerAuthorizationUrl,
  tiktokAuthorizationEnvironmentForAppKey
} = require('../lib/tiktok-oauth');
const { componentRows, mapTikTokOrder, mapTikTokReturn } = require('../lib/tiktok-mappers');
const { productCategoryContext, recommendedCategory } = require('../lib/tiktok-marketplace');
const { EVENT_TOPICS, reconcileOperation, verifyTikTokShopWebhook, webhookEntity, webhookIdentity, webhookTopic } = require('../lib/tiktok-webhooks');
const {
  applyTikTokLiveAttribution,
  normalizeTikTokLiveAttribution,
  normalizeTikTokLiveProduct,
  normalizeTikTokLiveSession,
  summarizeTikTokLiveSessions
} = require('../lib/tiktok-live');

async function main() {
  const toolCategory = recommendedCategory({ data: {
    leaf_category_id: '604579123',
    categories: [
      { id: '604579', name: 'Tools & Hardware', level: 1, is_leaf: false, permission_statuses: ['AVAILABLE'] },
      { id: '604579123', name: 'Hand Tools', level: 2, is_leaf: true, permission_statuses: ['AVAILABLE'] }
    ]
  } }, 'Tools & Hardware');
  assert.equal(toolCategory.categoryId, '604579123');
  assert.equal(toolCategory.familyMatched, true);
  assert.equal(toolCategory.available, true);
  assert.deepEqual(toolCategory.categoryPath, ['Tools & Hardware', 'Hand Tools']);
  assert.equal(recommendedCategory({ data: { leaf_category_id: '824328123', categories: [
    { id: '824328', name: 'Menswear', level: 1 },
    { id: '824328123', name: 'Gloves', level: 2, is_leaf: true }
  ] } }, 'Tools & Hardware').familyMatched, false);
  assert.deepEqual(productCategoryContext({ productType: 'Power Tools', mainCategory: 'Tools' }), {
    productType: 'Power Tools',
    key: 'power tools',
    source: 'product_type'
  });
  assert.deepEqual(productCategoryContext({ mainCategory: 'Tool Organizers' }), {
    productType: 'Tool Organizers',
    key: 'tool organizers',
    source: 'main_category'
  });
  const marketplaceSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'tiktok-marketplace.js'), 'utf8');
  const clientSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'tiktok-client.js'), 'utf8');
  assert.match(marketplaceSource, /sort_field: 'update_time', sort_order: 'DESC'/, 'TikTok order intake should prioritize current updates');
  assert.match(clientSource, /options\.retryable !== false/, 'TikTok callers must be able to disable retries for optional enrichment reads');
  assert.match(marketplaceSource, /if \(payload\.historicalBackfill !== true\) windows\.reverse\(\)/, 'Operational TikTok imports should process the newest date window first');
  assert.match(marketplaceSource, /queuePriority: operation === 'orders'.*130/, 'Operational TikTok imports should outrank reconciliation work');
  assert.match(marketplaceSource, /order-identity-repair/, 'TikTok must expose a bounded repair job for saved order identities');
  assert.match(marketplaceSource, /repairOrderIdentities/, 'TikTok identity repair must delegate to the shared catalog matcher');

  const signature = tiktokSignature('/order/202309/orders/search', {
    timestamp: '1700000000',
    app_key: 'app-key',
    shop_cipher: 'shop-cipher',
    sign: 'ignored'
  }, '{"page_size":10}', 'app-secret');
  assert.equal(signature, '4023fdd397c99ee51950d7287dc195e2835f56a3ea6f7c8ea3bff1b65435231f');

  const webhookBody = Buffer.from(JSON.stringify({ event_id: 'event-1', event_type: 'ORDER_STATUS_CHANGE', data: { order_id: '576000001' } }));
  const webhookAuthorization = require('node:crypto').createHmac('sha256', 'app-secret').update(Buffer.concat([Buffer.from('app-key'), webhookBody])).digest('hex');
  assert.equal(verifyTikTokShopWebhook(webhookBody, webhookAuthorization, 'app-key', 'app-secret'), true);
  assert.equal(verifyTikTokShopWebhook(webhookBody, `sha256=${webhookAuthorization}`, 'app-key', 'app-secret'), true);
  assert.equal(verifyTikTokShopWebhook(webhookBody, `${webhookAuthorization}bad`, 'app-key', 'app-secret'), false);
  assert.equal(webhookIdentity(JSON.parse(webhookBody), webhookBody), 'event-1');
  assert.equal(webhookTopic(JSON.parse(webhookBody)), 'ORDER_STATUS_CHANGE');
  assert.equal(webhookEntity(JSON.parse(webhookBody)).orderId, '576000001');
  assert.equal(reconcileOperation('RETURN_STATUS_CHANGE'), 'returns');
  assert.equal(reconcileOperation('NEW_MESSAGE'), 'messages');
  assert.equal(webhookTopic({ type: 71, data: { product_id: 'product-1', sku_id: 'sku-1' } }), 'INVENTORY_CHANGED_BY_SHOP');
  assert.equal(EVENT_TOPICS.includes('NEW_MESSAGE'), true);

  const directory = fs.mkdtempSync(path.join(process.env.DATAPLUS_TEST_TMP_DIR || os.tmpdir(), 'dataplus-tiktok-'));
  try {
    const env = { DATAPLUS_CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') };
    const credentials = createTikTokCredentials({ directory, env });
    credentials.save('development', {
      appKey: 'development-app-key', appSecret: 'development-app-secret'
    });
    assert.equal(credentials.status('development').appSecretConfigured, true);
    assert.equal(credentials.status('development').appConfigured, false);
    assert.throws(() => credentials.beginAuthorization('development'), /Service ID/);
    credentials.save('production', {
      appKey: 'app-key', appSecret: 'app-secret', serviceId: 'service-id'
    });
    const savedText = fs.readFileSync(path.join(directory, 'tiktok-runtime-credentials.json'), 'utf8');
    assert.equal(savedText.includes('app-secret'), false);
    assert.equal(savedText.includes('access-token'), false);
    assert.equal(credentials.status('production').appConfigured, true);
    assert.equal(credentials.status('production').configured, false);
    const sessionToken = 'signed-in-dataplus-session';
    const authorization = credentials.beginAuthorization('production', { actorId: 'user-1', actorName: 'Luis', returnTo: '/channels?channel=TikTok%20Shop', sessionToken });
    const parallelAuthorization = credentials.beginAuthorization('production', { actorId: 'user-1', actorName: 'Luis', returnTo: '/channels?channel=TikTok%20Shop&tab=sync', sessionToken });
    assert.match(authorization.state, /^production\.v2\./);
    assert.ok(authorization.state.length < 512);
    assert.equal(credentials.status('production').authorizationPending, true);
    assert.throws(() => credentials.consumeAuthorization('production.invalid', { sessionToken }), /invalid or expired/);
    assert.throws(() => credentials.consumeAuthorization(authorization.state, { sessionToken: 'another-session' }), /did not match this DataPlus session/);
    const consumed = credentials.consumeAuthorization(authorization.state, { sessionToken });
    assert.equal(consumed.environment, 'production');
    assert.equal(consumed.actorId, 'user-1');
    assert.equal(consumed.actorName, 'Luis');
    assert.throws(() => credentials.consumeAuthorization(authorization.state, { sessionToken }), /invalid or expired/);
    assert.equal(credentials.consumeAuthorization(parallelAuthorization.state, { sessionToken }).returnTo, '/channels?channel=TikTok%20Shop&tab=sync');
    const creatorAuthorization = credentials.beginCreatorAuthorization('production', {
      actorId: 'user-1', actorName: 'Luis', returnTo: '/channels?channel=TikTok%20Shop', sessionToken
    });
    assert.match(creatorAuthorization.state, /^creator\.production\.v2\./);
    assert.throws(() => credentials.consumeCreatorAuthorization(creatorAuthorization.state, { sessionToken: 'another-session' }), /did not match this DataPlus session/);
    const consumedCreator = credentials.consumeCreatorAuthorization(creatorAuthorization.state, { sessionToken });
    assert.equal(consumedCreator.environment, 'production');
    assert.equal(consumedCreator.actorId, 'user-1');
    assert.throws(() => credentials.consumeCreatorAuthorization(creatorAuthorization.state, { sessionToken }), /invalid or expired/);
    credentials.updateTokens('production', { access_token: 'next-access', refresh_token: 'refresh-token', expires_in: 3600, user_type: 0 });
    assert.equal(credentials.get('production').accessToken, 'next-access');
    assert.equal(credentials.get('production').refreshToken, 'refresh-token');
    assert.equal(credentials.status('production').configured, true);
    assert.equal(credentials.fingerprint('production'), credentials.fingerprint('production'));
    credentials.updateTokens('production', { open_id: 'seller-a', access_token: 'seller-a-access', refresh_token: 'seller-a-refresh', expires_in: 3600 });
    credentials.selectShop('production', { id: 'shop-a', name: 'Dealsclick', code: 'DEALSCLICK-US', cipher: 'cipher-a', region: 'US' }, 'seller-a');
    credentials.updateTokens('production', { open_id: 'seller-b', access_token: 'seller-b-access', refresh_token: 'seller-b-refresh', expires_in: 3600 });
    credentials.selectShop('production', { id: 'shop-b', name: 'Island Supply', cipher: 'cipher-b', region: 'US' }, 'seller-b');
    assert.deepEqual(credentials.accounts('production').map(account => account.id).filter(id => id.startsWith('seller-')).sort(), ['seller-a', 'seller-b']);
    assert.equal(credentials.get('production', 'seller-a').shopName, 'Dealsclick');
    assert.equal(credentials.get('production', 'seller-a').shopCode, 'DEALSCLICK-US');
    assert.equal(credentials.get('production', 'seller-b').shopName, 'Island Supply');
    credentials.setActiveAccount('production', 'seller-a');
    assert.equal(credentials.status('production').activeAccountId, 'seller-a');
    const reconnectAuthorization = credentials.beginAuthorization('production', { accountId: 'seller-a', actorId: 'user-1', actorName: 'Luis', returnTo: '/channels?channel=TikTok%20Shop', sessionToken });
    assert.equal(credentials.consumeAuthorization(reconnectAuthorization.state, { sessionToken }).accountId, 'seller-a');
    credentials.updateTokens('production', { open_id: 'seller-a', access_token: 'seller-a-renewed', refresh_token: 'seller-a-refresh-renewed', expires_in: 3600 }, 'seller-a');
    assert.equal(credentials.get('production', 'seller-a').accessToken, 'seller-a-renewed');
    assert.equal(credentials.get('production', 'seller-b').accessToken, 'seller-b-access');
    assert.throws(
      () => credentials.updateTokens('production', { open_id: 'seller-b', access_token: 'wrong-account-token' }, 'seller-a'),
      /different seller account/i
    );
    assert.equal(credentials.get('production', 'seller-a').accessToken, 'seller-a-renewed');
    const removed = credentials.removeAccount('production', 'seller-b');
    assert.equal(removed.account.shopName, 'Island Supply');
    assert.equal(credentials.accounts('production').some(account => account.id === 'seller-b'), false);
    assert.equal(credentials.status('production').activeAccountId, 'seller-a');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }

  const sellerUrl = new URL(sellerAuthorizationUrl({ serviceId: 'service-id', state: 'production.state', region: 'US' }));
  assert.equal(sellerUrl.origin, 'https://services.us.tiktokshop.com');
  assert.equal(sellerUrl.pathname, '/open/authorize');
  assert.equal(sellerUrl.searchParams.get('service_id'), 'service-id');
  assert.equal(sellerUrl.searchParams.get('state'), 'production.state');
  assert.equal(isTikTokAuthorizationCallbackUrl('/auth/tiktok/callback?code=auth-code&state=production.state'), true);
  assert.equal(isTikTokAuthorizationCallbackUrl('/?code=creator-code&state=creator.production.v2.payload.signature&app_key=app-key'), true);
  assert.equal(isTikTokAuthorizationCallbackUrl('/?auth_code=auth-code&state=production.v2.payload.signature'), true);
  assert.equal(isTikTokAuthorizationCallbackUrl('/?error=access_denied&state=development.v2.payload.signature'), true);
  assert.equal(isTikTokAuthorizationCallbackUrl('/?auth_code=auth-code&state=production.legacy-state'), true);
  assert.equal(isTikTokAuthorizationCallbackUrl('/?app_key=app-key&code=auth-code&locale=en&shop_region=US'), true);
  assert.equal(isTikTokAuthorizationCallbackUrl('/?app_key=app-key&code=auth-code'), false);
  assert.equal(isTikTokAuthorizationCallbackUrl('/?code=auth-code&state=ebay-state'), false);
  assert.equal(isTikTokAuthorizationCallbackUrl('/auth/ebay/callback?code=auth-code&state=production.state'), false);
  assert.equal(tiktokAuthorizationEnvironmentForAppKey('production-key', { productionAppKey: 'production-key', developmentAppKey: 'development-key' }), 'production');
  assert.equal(tiktokAuthorizationEnvironmentForAppKey('development-key', { productionAppKey: 'production-key', developmentAppKey: 'development-key' }), 'development');
  assert.equal(tiktokAuthorizationEnvironmentForAppKey('unknown-key', { productionAppKey: 'production-key', developmentAppKey: 'development-key' }), '');
  assert.equal(tiktokAuthorizationEnvironmentForAppKey('shared-key', { productionAppKey: 'shared-key', developmentAppKey: 'shared-key' }), 'production');
  const configuredAppKeys = { productionAppKey: 'production-key', developmentAppKey: 'development-key' };
  const signedRecoveryState = 'production.v2.payload.signature';
  assert.equal(recoverTikTokAuthorizationState({ state: signedRecoveryState, recoveryState: '', appKey: '', configured: configuredAppKeys }), signedRecoveryState);
  assert.equal(recoverTikTokAuthorizationState({ state: '', recoveryState: signedRecoveryState, appKey: 'production-key', configured: configuredAppKeys }), signedRecoveryState);
  assert.equal(recoverTikTokAuthorizationState({ state: '', recoveryState: signedRecoveryState, appKey: 'development-key', configured: configuredAppKeys }), '');
  assert.equal(recoverTikTokAuthorizationState({ state: '', recoveryState: 'development.v2.payload.signature', appKey: 'shared-key', configured: { productionAppKey: 'shared-key', developmentAppKey: 'shared-key' } }), 'development.v2.payload.signature');
  assert.equal(recoverTikTokAuthorizationState({ state: '', recoveryState: 'production', appKey: 'production-key', configured: configuredAppKeys }), '');
  assert.equal(recoverTikTokAuthorizationState({ state: '', recoveryState: 'production.legacy-state', appKey: 'production-key', configured: configuredAppKeys }), '');
  const tiktokChannelSource = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'components', 'tiktok-channel.tsx'), 'utf8');
  assert.equal(tiktokChannelSource.includes('onSave(channel.id, { settings:'), false, 'TikTok channel settings must use the flat PATCH /api/channels/:id contract.');
  assert.equal(tiktokChannelSource.includes('Add another TikTok account'), true, 'TikTok settings must expose a clear multi-account authorization action.');
  assert.equal(tiktokChannelSource.includes('Use account'), true, 'TikTok settings must expose explicit seller-account selection.');
  assert.equal(tiktokChannelSource.includes('accounts/remove'), true, 'TikTok settings must allow a seller account to be disconnected.');
  assert.equal(tiktokChannelSource.includes('Shop ID'), true, 'TikTok settings must display the selected shop ID.');
  assert.equal(tiktokChannelSource.includes('Official TikTok LIVE account'), true, 'TikTok settings must explain that the creator API identity is the shop official LIVE account.');
  assert.equal(tiktokChannelSource.includes('not a separate influencer account'), true, 'TikTok settings must not imply that a separate influencer account is required.');
  assert.equal(tiktokChannelSource.includes('/auth/tiktok/creator/start'), true, 'TikTok settings must start the creator authorization flow.');
  assert.equal(tiktokChannelSource.includes('updateFeature'), true, 'TikTok feature switches must persist immediately instead of relying on an easy-to-miss draft banner.');
  assert.equal(tiktokChannelSource.includes('status/jobs'), true, 'TikTok job history must load separately from the connection status.');
  assert.equal(tiktokChannelSource.includes('TikTok order intake health'), true, 'TikTok settings must show order, webhook, worker, and identity health.');
  assert.equal(tiktokChannelSource.includes('Repair saved order SKUs'), true, 'TikTok settings must expose a reviewed historical identity repair action.');
  const liveSessionsSource = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'components', 'live-sessions-route.tsx'), 'utf8');
  assert.equal(liveSessionsSource.includes('Sync products to TikTok LIVE'), true, 'TikTok Live Sessions must expose creator product sync.');
  assert.equal(liveSessionsSource.includes('Streamer showcase'), true, 'TikTok Live Session creation must select the official streamer showcase.');
  assert.equal(liveSessionsSource.includes('tiktokCreatorId'), true, 'TikTok Live Sessions must persist the selected official account.');
  assert.equal(liveSessionsSource.includes('TikTok CSV reconciliation'), true, 'TikTok Live Sessions must crossmatch manually uploaded session CSV files.');
  assert.equal(liveSessionsSource.includes('Download loaded products'), true, 'TikTok Live Sessions must export the product tray with resolved DataPlus SKUs.');
  assert.equal(liveSessionsSource.includes('Session orders'), true, 'Attributed TikTok LIVE orders must remain visible outside the collapsible Studio panel.');
  assert.equal(liveSessionsSource.includes('Product tray status'), true, 'TikTok session products must expose their tray status and protected removal workflow.');
  assert.equal(liveSessionsSource.includes('Not in uploaded CSV'), true, 'A session CSV must provide a safe tray-status fallback when TikTok does not expose the product tray.');
  assert.equal(liveSessionsSource.includes('Tray access unavailable'), true, 'TikTok tray permission problems must be distinct from an unchecked tray.');
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const activeJobDatabaseSource = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
  const activeJobWorkerSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'dataplus-worker.js'), 'utf8');
  assert.match(serverSource, /readActiveOperationJobByTask/, 'TikTok queue deduplication must query every active job instead of a recent page');
  assert.match(activeJobDatabaseSource, /async function compactQueuedTikTokOrderJobs/, 'The database layer must consolidate duplicate queued TikTok order imports');
  assert.match(activeJobDatabaseSource, /tiktok-orders', 'tiktok-returns', 'tiktok-webhook/, 'TikTok queue compaction must cover orders, returns, and webhook reconciliation');
  assert.match(activeJobDatabaseSource, /operations_jobs_tiktok_active_singleton_v2_idx/, 'PostgreSQL must enforce one active TikTok operational sync per account and task');
  assert.match(activeJobDatabaseSource, /async function recoverStalledTikTokOperationJobs/, 'Stalled TikTok intake must request an automatic retry');
  assert.match(activeJobDatabaseSource, /tiktok-order-identity-repair/, 'TikTok identity repair must retain restart and stall recovery safeguards.');
  assert.match(activeJobDatabaseSource, /channelAccountId/, 'TikTok repair queries must support seller-account isolation.');
  assert.match(activeJobDatabaseSource, /historicalBackfill = null/, 'Historical TikTok backfills must not block live operational imports');
  assert.match(activeJobWorkerSource, /compactQueuedTikTokOrderJobs/, 'The TikTok worker must compact recovered jobs before claiming work');
  assert.match(serverSource, /!historicalBackfill && \(!existing \|\| titleIdentityNeedsRepair\)\) await ensureProductsForImportedOrders/, 'Existing TikTok refreshes must preserve catalog mapping except for the explicit title-identity repair path');
  assert.match(serverSource, /createMissingOrderSkus: false/, 'Historical TikTok identity repair must not create draft catalog SKUs.');
  assert.match(serverSource, /orderIsReportingOnly\(order\)/, 'Historical reporting orders must not be queued for operational routing by identity repair.');
  assert.equal(serverSource.includes('parts[3] === "tiktok-live" && parts[4] === "sync"'), true, 'The server must expose a TikTok Live Session sync route.');
  assert.equal(serverSource.includes('parts[3] === "tiktok-csv" && parts[4] === "reconcile"'), true, 'The server must expose TikTok session CSV reconciliation.');
  assert.equal(serverSource.includes('parts[4] === "products.csv"'), true, 'The server must export TikTok LIVE tray products with local SKU matches.');
  assert.equal(tiktokChannelSource.includes('Shop code'), true, 'TikTok settings must display the selected shop code.');
  assert.equal(tiktokChannelSource.includes('Shared TikTok app credentials'), true, 'TikTok settings must distinguish app credentials from seller accounts.');
  assert.equal(tiktokChannelSource.includes('Saved securely'), true, 'TikTok settings must explain that saved app secrets are not displayed.');
  assert.equal(tiktokChannelSource.includes('Finish setup for'), true, 'A verified TikTok shop must expose the initial setup workflow.');
  assert.equal(tiktokChannelSource.includes('Historical sales'), true, 'TikTok setup must separate reporting history from operational orders.');
  assert.equal(tiktokChannelSource.includes('Operational orders begin'), true, 'TikTok setup must collect an explicit operational start date.');
  assert.equal(tiktokChannelSource.includes('setup/initial'), true, 'TikTok setup must persist and queue the selected per-shop plan.');
  assert.equal(tiktokChannelSource.includes('Shop setup submitted'), true, 'TikTok setup must display the submitted steps and job evidence.');
  assert.equal(tiktokChannelSource.includes('Setup running'), true, 'TikTok setup must make active setup work visible and prevent an ambiguous duplicate submission.');
  const tiktokMarketplaceSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'tiktok-marketplace.js'), 'utf8');
  assert.match(tiktokMarketplaceSource, /data->>'state' = 'pending'[\s\S]*limit 500/, 'Webhook reconciliation must read pending events directly in bounded database batches.');
  assert.match(tiktokMarketplaceSource, /queue\('webhook', \{ accountId, actor:/, 'Webhook receipt must queue one account-level catch-up job instead of one job per event.');
  assert.equal(tiktokMarketplaceSource.includes('launchOverrides:'), true, 'TikTok launch jobs must retain live-session merchant SKU and quantity overrides.');
  assert.equal(tiktokMarketplaceSource.includes('liveAuctionExportContext'), true, 'TikTok must resolve the selected shop warehouse for LIVE auction CSV exports.');
  assert.equal(tiktokMarketplaceSource.includes('deps.reconcileLiveSessions'), true, 'TikTok order, webhook, and LIVE workers must reconcile imported orders to sessions.');
  assert.equal(serverSource.includes('parts[3] === "tiktok-auction" && parts[4] === "export"'), true, 'Live Sessions must expose a TikTok auction upload export route.');
  assert.equal(liveSessionsSource.includes('Auction upload CSV'), true, 'TikTok Live Sessions must expose the manual auction upload fallback.');
  assert.equal(serverSource.includes('url.pathname === "/api/live-sessions/detect-active"'), true, 'The Live Sessions workspace must detect active TikTok broadcasts without opening each session.');
  assert.equal(liveSessionsSource.includes('Check live'), true, 'The Live Sessions workspace must expose an explicit TikTok broadcast refresh.');
  assert.equal(liveSessionsSource.includes('Live now'), true, 'Active TikTok broadcasts must be visible in the Live Sessions workspace.');
  assert.equal(tiktokMarketplaceSource.includes("'/product/202309/images/upload'"), true, 'TikTok live-session photo overrides must upload to the TikTok product image API.');
  assert.equal(tiktokMarketplaceSource.includes('title: launchTitle'), true, 'TikTok live-session launches must use the reviewed session title.');
  assert.equal(tiktokMarketplaceSource.includes('seller_sku: merchantSku'), true, 'TikTok live-session launches must use the reviewed manufacturer SKU as seller SKU.');
  assert.equal(tiktokMarketplaceSource.includes('sourceLiveSessionId'), true, 'TikTok launch evidence must remain linked to the source live session.');
  assert.equal(tiktokMarketplaceSource.includes('tiktok_product_type_recommendation'), true, 'TikTok launch must retain product-type category recommendation evidence.');
  assert.equal(tiktokMarketplaceSource.includes("'/seller/202407/shop_creators'"), true, 'TikTok verification must detect the official account bound to the selected shop.');
  assert.equal(tiktokMarketplaceSource.includes("action === 'status/jobs'"), true, 'TikTok connection status must not block on job history.');
  assert.equal(tiktokMarketplaceSource.includes("orderCheckpointKey"), true, 'TikTok scheduled order sync must keep a per-shop checkpoint.');
  assert.equal(tiktokMarketplaceSource.includes("checkpointTime - 3_600_000"), true, 'TikTok scheduled order sync must retain a safety overlap.');
  assert.equal(tiktokMarketplaceSource.includes("const canAdvance = failed === 0"), true, 'TikTok order checkpoints must not advance past failed order rows.');
  assert.equal(tiktokMarketplaceSource.includes("'/order/202507/orders'"), true, 'TikTok order imports must hydrate current full order details.');
  assert.equal(tiktokMarketplaceSource.includes('/fulfillment/202309/packages/'), true, 'TikTok combined orders must hydrate package membership from Get Package Detail.');
  assert.match(tiktokMarketplaceSource, /retryable: false,\s+timeoutMs: 10_000/, 'Optional combined-package evidence must not stall order intake behind upstream retries');
  assert.match(tiktokMarketplaceSource, /mapOrderWithLiveEvidence\(raw\)[\s\S]*deps\.saveOrder\(mapped[\s\S]*loadTikTokPackageGroups\(savedDetails/, 'Orders must be saved before optional package enrichment');
  assert.match(tiktokMarketplaceSource, /tiktokOrderReconciliationMinutes, 10, 60, 10/, 'Operational TikTok order reconciliation must default to ten minutes');
  assert.equal(tiktokMarketplaceSource.includes("'/fulfillment/202309/combinable_packages/search'"), true, 'TikTok label creation must discover the platform-approved combined order group.');
  assert.equal(tiktokMarketplaceSource.includes("shipType === '3'"), true, 'TikTok label preview must validate combined multi-order packages.');
  assert.equal(tiktokMarketplaceSource.includes('order_list_ids'), true, 'TikTok combined label creation must submit every member order ID.');
  assert.equal(tiktokMarketplaceSource.includes('split_and_combine_tag'), true, 'TikTok package evidence must retain the platform split/combine status.');
  assert.equal(tiktokMarketplaceSource.includes('index += 50'), true, 'TikTok order detail hydration must respect the 50-order API limit.');
  assert.equal(tiktokMarketplaceSource.includes('document_type: documentType'), true, 'TikTok document retrieval must send the reviewed shipping document type.');
  assert.equal(tiktokMarketplaceSource.includes("'SHIPPING_LABEL_AND_PACKING_SLIP'"), true, 'TikTok package retrieval must support the combined label and packing-slip packet.');
  assert.equal(tiktokMarketplaceSource.includes("'PACKING_SLIP'"), true, 'TikTok package retrieval must support the platform packing slip.');
  assert.equal(tiktokMarketplaceSource.includes("'SHIPPING_LABEL_PICTURE'"), true, 'TikTok package retrieval must support PNG shipping labels.');
  assert.equal(tiktokMarketplaceSource.includes("'HAZMAT_LABEL'"), true, 'TikTok package retrieval must support fixed-size hazmat labels.');
  assert.equal(tiktokMarketplaceSource.includes('fulfillmentOrder, fulfillmentServices, previewPackage, createPackage, shippingDocument'), true, 'TikTok fulfillment must expose the complete order-to-label workflow.');
  assert.equal(tiktokMarketplaceSource.includes("status: Number(match?.matched || 0) > 0 ? 'linked' : 'needs_mapping'"), true, 'TikTok catalog reconciliation must expose unmatched seller SKUs for review.');
  assert.equal(tiktokMarketplaceSource.includes("action === 'setup/initial'"), true, 'TikTok must expose the initial setup endpoint.');
  assert.equal(tiktokMarketplaceSource.includes("status: result.duplicate ? 'already_running' : 'queued'"), true, 'TikTok setup must report when an existing active job was retained instead of claiming a new run.');
  const workerSource = fs.readFileSync(path.join(__dirname, 'dataplus-worker.js'), 'utf8');
  assert.equal(workerSource.includes('recoverInterruptedTikTokOrderJobs({ workerId: WORKER_ID, workerTasks })'), true, 'Replacement TikTok workers must requeue their orphaned intake jobs after deployment.');
  const supervisorSource = fs.readFileSync(path.join(__dirname, 'dataplus-worker-supervisor.js'), 'utf8');
  assert.equal(supervisorSource.includes('"product-dump-import", "ebay-order-import", "tiktok-orders"'), true, 'The worker supervisor must automatically retry interrupted TikTok order intake.');
  assert.equal(supervisorSource.includes('reason: stopping ? "deployment_shutdown"'), true, 'A normal deployment shutdown must be recorded as a resumable TikTok interruption.');
  const databaseSource = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
  assert.equal(databaseSource.includes('async function recoverInterruptedTikTokOrderJobs'), true, 'PostgreSQL must provide durable TikTok restart recovery.');
  assert.equal(databaseSource.includes("coalesce(raw ->> 'workerTask', '') = any($3::text[])"), true, 'Restart recovery must be limited to the TikTok tasks owned by the replacement worker.');
  const composeSource = fs.readFileSync(path.join(__dirname, '..', 'docker-compose.yml'), 'utf8');
  assert.match(composeSource, /worker:\s*[\s\S]*?restart: unless-stopped\s*stop_grace_period: 65s/, 'Worker containers need enough deployment grace to persist retry state.');
  const tiktokLabelDialogSource = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'components', 'tiktok-shipping-label-dialog.tsx'), 'utf8');
  assert.equal(tiktokLabelDialogSource.includes('TikTok Shipping label'), true, 'Order detail must expose TikTok label generation.');
  assert.equal(tiktokLabelDialogSource.includes('/api/tiktok/fulfillment/services'), true, 'TikTok label generation must quote eligible services dynamically.');
  assert.equal(tiktokLabelDialogSource.includes('/api/tiktok/fulfillment/packages/preview'), true, 'TikTok label generation must require a preview before purchase.');
  assert.equal(tiktokLabelDialogSource.includes('/api/tiktok/fulfillment/packages/apply'), true, 'TikTok label generation must use the reviewed package purchase endpoint.');
  assert.equal(tiktokLabelDialogSource.includes('Open and print document'), true, 'TikTok package documents must be printable from the order workflow.');
  assert.equal(tiktokLabelDialogSource.includes('TIKTOK_DEFAULT_PACKAGE = { weight: "3", length: "5", width: "5", height: "10" }'), true, 'TikTok labels must start with the approved temporary package defaults.');
  assert.equal(tiktokLabelDialogSource.includes('/api/inventory/${encodeURIComponent(sku)}'), true, 'TikTok labels must load package measurements from the detected catalog SKU.');
  assert.equal(tiktokLabelDialogSource.includes('Catalog SKU ${match.sku}'), true, 'TikTok labels must show when catalog measurements supplied the package defaults.');
  assert.equal(tiktokLabelDialogSource.includes('TikTok package documents'), true, 'Existing TikTok packages must expose every supported document type.');
  assert.equal(tiktokLabelDialogSource.includes('Shipping label + packing slip'), true, 'TikTok package documents must default to a warehouse-ready combined packet.');
  assert.equal(tiktokLabelDialogSource.includes('Combined TikTok shipment'), true, 'TikTok label generation must identify a platform-approved combined shipment.');
  assert.equal(tiktokLabelDialogSource.includes('Arrange and purchase shared label'), true, 'Combined TikTok orders must use one explicit shared-label action.');
  const orderDetailSource = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'components', 'order-detail-route.tsx'), 'utf8');
  assert.equal(orderDetailSource.includes('TikTokShippingLabelDialog'), true, 'TikTok orders must open the TikTok shipping label workflow.');
  assert.equal(orderDetailSource.includes('onClick={openShippingLabelWorkflow}'), true, 'The primary order label button must use the TikTok-aware shipping workflow.');
  assert.equal(orderDetailSource.includes('usesTikTokShipping ? "Print TikTok label" : "Print shipping label"'), true, 'TikTok Shipping orders must label the primary action clearly.');
  assert.equal(orderDetailSource.includes('TikTok order'), true, 'TikTok order detail must label the marketplace order number clearly.');
  const orderWorkspacesSource = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'components', 'order-workspaces.tsx'), 'utf8');
  assert.equal(orderWorkspacesSource.includes('label: isTikTok ? "Print TikTok label" : "Print shipping label"'), true, 'The order Actions menu must identify TikTok-owned labels.');
  assert.equal(orderWorkspacesSource.includes('seller-us.tiktok.com/order/detail?order_no='), true, 'TikTok marketplace order numbers must link to Seller Center.');
  assert.equal(orderWorkspacesSource.includes('TikTok masked these recipient details in the API.'), true, 'TikTok masked recipient addresses must be explained to operators.');
  assert.equal(orderWorkspacesSource.includes('TikTok combined package'), true, 'Imported TikTok package groups must identify the orders that shipped together.');
  const ordersRouteSource = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'components', 'orders-route.tsx'), 'utf8');
  assert.equal(ordersRouteSource.includes('TikTok {tiktokOrderNumber}'), true, 'The main order list must display the TikTok order number.');
  assert.equal(ordersRouteSource.includes('channelOrderUrlFor(row, tiktokOrderNumber)'), true, 'The main order list must link TikTok order numbers to Seller Center.');
  const fulfillmentSource = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'components', 'fulfillment-route.tsx'), 'utf8');
  assert.equal(fulfillmentSource.includes('TikTok LIVE'), true, 'Fulfillment must visibly distinguish TikTok LIVE orders.');
  assert.equal(fulfillmentSource.includes('channelOrderNumber'), true, 'Fulfillment must display marketplace order numbers.');
  assert.equal(serverSource.includes('setTikTokOAuthRecoveryCookie(req, res, authorization.state)'), true, 'TikTok authorization must preserve its signed one-time state in the browser before redirecting to TikTok.');
  assert.equal(serverSource.includes('saveTikTokProductCategoryMapping'), true, 'TikTok product-type mappings must be persisted to the shared category workspace.');
  assert.equal(serverSource.includes('Restarted ${environment} seller authorization with DataPlus security state.'), false, 'A missing TikTok state must be recovered from the original signed attempt instead of starting a loop.');
  const exchanged = await exchangeAuthorizationCode({
    appKey: 'app-key', appSecret: 'app-secret', authCode: 'auth-code',
    fetchImpl: async url => {
      const requestUrl = new URL(url);
      assert.equal(requestUrl.searchParams.get('grant_type'), 'authorized_code');
      assert.equal(requestUrl.searchParams.get('auth_code'), 'auth-code');
      return { ok: true, status: 200, json: async () => ({ code: 0, data: { access_token: 'generated-access', refresh_token: 'generated-refresh', user_type: 0, granted_scopes: 'seller.order,seller.product' } }) };
    }
  });
  assert.equal(exchanged.access_token, 'generated-access');
  assert.deepEqual(exchanged.granted_scopes, ['seller.order', 'seller.product']);
  const creatorUrl = new URL(creatorAuthorizationUrl({ appKey: 'app-key', state: 'creator.production.v2.payload.signature' }));
  assert.equal(creatorUrl.origin, 'https://shop.tiktok.com');
  assert.equal(creatorUrl.pathname, '/alliance/creator/auth');
  assert.equal(creatorUrl.searchParams.get('app_key'), 'app-key');
  assert.equal(creatorUrl.searchParams.get('state'), 'creator.production.v2.payload.signature');
  const creatorExchange = await exchangeCreatorAuthorizationCode({
    appKey: 'app-key', appSecret: 'app-secret', authCode: 'creator-code',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ code: 0, data: { access_token: 'creator-access', refresh_token: 'creator-refresh', user_type: 1, granted_scopes: 'creator.showcase.read,creator.showcase.write' } }) })
  });
  assert.equal(creatorExchange.access_token, 'creator-access');
  assert.deepEqual(creatorExchange.granted_scopes, ['creator.showcase.read', 'creator.showcase.write']);
  await assert.rejects(exchangeAuthorizationCode({
    appKey: 'app-key', appSecret: 'app-secret', authCode: 'creator-code',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ code: 0, data: { access_token: 'creator-access', refresh_token: 'creator-refresh', user_type: 1 } }) })
  }), /non-seller token/);

  const rawOrder = {
    id: '576000001', status: 'AWAITING_SHIPMENT', shipping_type: 'TIKTOK', fulfillment_type: 'FULFILLMENT_BY_SELLER', buyer_nickname: 'Live buyer', create_time: 1700000000, update_time: 1700000100,
    recipient_address: { name: 'Customer', address_line1: '1 Main St', post_town: 'Seattle', postal_code: '98101', region_code: 'US', district_info: [{ address_level_name: 'State', address_name: 'WA' }] },
    payment: { total_amount: '30.00', sub_total: '28.00', shipping_fee: '2.00', currency: 'USD' },
    line_items: [
      { id: 'line-1', seller_sku: 'SKU-1', product_name: 'First', quantity: 2, sale_price: '5.00', room_id: 'live-room-1', combined_listing_skus: [{ seller_sku: 'COMPONENT-1', sku_count: 4 }] },
      { id: 'line-2', seller_sku: 'SKU-2', product_name: 'Second', sale_price: '18.00' }
    ]
  };
  const order = mapTikTokOrder(rawOrder);
  assert.equal(order.items.length, 2);
  assert.equal(order.marketplaceOrderId, '576000001');
  assert.equal(order.marketplaceOrderNumber, '576000001');
  assert.equal(order.source, 'TikTok Shop');
  assert.equal(order.buyerNickname, 'Live buyer');
  assert.equal(order.isTikTokLive, true);
  assert.equal(order.salesOrigin, 'tiktok_live');
  assert.deepEqual(order.tiktokLive.contentIds, ['live-room-1']);
  assert.equal(order.items[0].tiktokLiveContentId, 'live-room-1');
  assert.equal(order.external.shippingType, 'TIKTOK');
  assert.equal(order.address.postalCode, '98101');
  assert.equal(order.items[0].qty, 2);
  assert.equal(order.items[0].price, 5);
  assert.equal(order.items[0].bundleComponents[0].quantity, 4);

  const combinedOrder = mapTikTokOrder({
    ...rawOrder,
    status: 'IN_TRANSIT',
    split_or_combine_tag: 'combined',
    line_items: rawOrder.line_items.map((line) => ({ ...line, package_id: 'package-1', tracking_number: 'TRACK-1', shipping_provider: 'USPS' }))
  }, {
    packageGroups: new Map([['package-1', {
      packageId: 'package-1',
      orderIds: ['576000001', '576000002'],
      packageStatus: 'SHIPPED',
      splitOrCombineTag: 'COMBINE',
      trackingNumber: 'TRACK-1'
    }]])
  });
  assert.equal(combinedOrder.shipmentGroupId, 'tiktok-package:package-1');
  assert.deepEqual(combinedOrder.shipmentGroupOrderIds, ['tiktok-576000001', 'tiktok-576000002']);
  assert.equal(combinedOrder.shipmentGroupMatchSource, 'tiktok_package_id');
  assert.equal(combinedOrder.shipmentGroupPackage.packageId, 'package-1');
  assert.equal(combinedOrder.shipments[0].sharedLabel, true);
  assert.equal(combinedOrder.shipments[0].sharedLabelMaster, true);
  assert.equal(combinedOrder.shipments[0].packageId, 'package-1');

  const returnRecord = mapTikTokReturn({
    return_id: 'return-1', order_id: '576000001', return_status: 'RETURNED', create_time: 1700000200,
    return_line_items: [{ return_line_item_id: 'return-line-1', order_line_item_id: 'line-2', seller_sku: 'SKU-2', return_quantity: 2, refund_amount: { amount: '18.00' } }]
  }, order);
  assert.equal(returnRecord.orderId, order.id);
  assert.equal(returnRecord.items[0].sku, 'SKU-2');
  assert.equal(returnRecord.items[0].qty, 2);
  assert.equal(returnRecord.status, 'completed');
  assert.equal(returnRecord.returnNumber, '');
  assert.equal(returnRecord.channelReturnReference, 'return-1');

  const successfulRequest = mapTikTokReturn({
    return_id: 'return-2', order_id: '576000001', return_status: 'RETURN_OR_REFUND_REQUEST_SUCCESS',
    return_line_items: [{ return_line_item_id: 'return-line-2', order_line_item_id: 'line-1', seller_sku: 'SKU-1' }]
  }, order);
  assert.equal(successfulRequest.status, 'completed');

  const rejectedRequest = mapTikTokReturn({
    return_id: 'return-3', order_id: '576000001', return_status: 'REFUND_OR_RETURN_REQUEST_REJECT',
    return_line_items: [{ return_line_item_id: 'return-line-3', order_line_item_id: 'line-1', seller_sku: 'SKU-1' }]
  }, order);
  assert.equal(rejectedRequest.status, 'canceled');

  const fees = componentRows({
    id: 'txn-1', order_id: '576000001', currency: 'USD',
    fee_tax_breakdown: { fee: { platform_commission: '-2.50' } },
    shipping_cost_breakdown: { shipping_fee: '-7.25' }
  }, 'statement-1');
  assert.equal(fees.length, 2);
  assert.deepEqual(fees.map(row => row.feeAmount).sort((a, b) => a - b), [-7.25, -2.5]);
  assert.equal(fees.every(row => row.netAmount === 0), true);

  const revenueEvidence = componentRows({
    id: 'txn-2', order_id: '576000001', currency: 'USD', type: 'ORDER',
    revenue_amount: '28.00', settlement_amount: '28.00'
  }, 'statement-1');
  assert.equal(revenueEvidence.length, 1);
  assert.equal(revenueEvidence[0].feeType, 'PAYOUT_EVIDENCE');
  assert.equal(revenueEvidence[0].feeAmount, 0);
  assert.equal(revenueEvidence[0].grossAmount, 28);
  assert.equal(revenueEvidence[0].netAmount, 28);

  const adjustment = componentRows({
    id: 'txn-3', adjustment_order_id: '576000001', currency: 'USD', type: 'ADJUSTMENT',
    adjustment_amount: '-4.25', settlement_amount: '-4.25'
  }, 'statement-1');
  assert.equal(adjustment.length, 1);
  assert.equal(adjustment[0].feeType, 'adjustment_amount');
  assert.equal(adjustment[0].feeAmount, -4.25);

  const liveSession = normalizeTikTokLiveSession({
    id: 'live-1', title: 'Weekend hardware show', username: 'creator-one', start_time: 1700000000,
    sales: { gmv: { amount: '125.50', currency: 'USD' }, attributed_sku_orders: 4, attributed_items_sold: 6 },
    traffic: { views: 900, product_clicks: 80 }
  }, 'AFFILIATE_ACCOUNTS');
  assert.equal(liveSession.liveId, 'live-1');
  assert.equal(liveSession.gmv, 125.5);
  assert.equal(liveSession.skuOrders, 4);
  assert.equal(liveSession.views, 900);

  const currentLiveSession = normalizeTikTokLiveSession({
    live_id: 'live-202609', account_type: 'OFFICIAL_ACCOUNTS',
    sales_performance: {
      live_attributed_gmv: { amount: '88.20', currency: 'USD' },
      live_attributed_sku_orders: 3,
      live_attributed_items_sold: 5,
      products_sold: 2
    },
    traffic: { products_added: 7 }
  });
  assert.equal(currentLiveSession.gmv, 88.2);
  assert.equal(currentLiveSession.skuOrders, 3);
  assert.equal(currentLiveSession.itemsSold, 5);
  assert.equal(currentLiveSession.productsAdded, 7);
  assert.equal(currentLiveSession.differentProductsSold, 2);

  const liveProduct = normalizeTikTokLiveProduct({
    product_id: 'product-1', product_name: 'Live product',
    sales: { gmv: { amount: '40.00', currency: 'USD' }, sku_orders: 2 },
    traffic: { product_impressions: 100, product_clicks: 15 }
  });
  assert.equal(liveProduct.productId, 'product-1');
  assert.equal(liveProduct.productClicks, 15);

  const attribution = normalizeTikTokLiveAttribution({
    id: '576000001', status: 'COMPLETED', create_time: 1700000000,
    skus: [
      { product_id: 'product-1', content_type: 'LIVE', content_id: 'live-1', creator_username: 'creator-one', quantity: 2 },
      { product_id: 'product-2', content_type: 'VIDEO', content_id: 'video-1', creator_username: 'creator-two', quantity: 1 }
    ]
  });
  assert.equal(attribution.isLive, true);
  assert.deepEqual(attribution.contentIds, ['live-1']);
  assert.equal(attribution.lines.length, 1);

  const attributedOrder = applyTikTokLiveAttribution({
    ...order,
    items: [{ ...order.items[0], productId: 'product-1' }, { ...order.items[1], productId: 'product-2' }]
  }, attribution);
  assert.equal(attributedOrder.salesOrigin, 'tiktok_live');
  assert.equal(attributedOrder.isTikTokLive, true);
  assert.deepEqual(attributedOrder.tiktokLive.creators, ['creator-one']);
  assert.equal(attributedOrder.items[0].isTikTokLive, true);
  assert.equal(attributedOrder.items[1].isTikTokLive, undefined);

  const liveSummary = summarizeTikTokLiveSessions([liveSession, { ...liveSession, liveId: 'live-2', gmv: 10, skuOrders: 1 }]);
  assert.equal(liveSummary.sessionCount, 2);
  assert.equal(liveSummary.gmv, 135.5);
  assert.equal(liveSummary.skuOrders, 5);

  console.log('TikTok Shop integration tests passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
