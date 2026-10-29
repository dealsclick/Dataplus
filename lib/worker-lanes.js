const LANES = ['manual', 'orders-shopify', 'orders-ebay', 'orders-temu', 'orders-tiktok', 'background', 'walmart'];
const WORKER_NAMES = {manual: 'Manual jobs', 'orders-shopify': 'Shopify orders', 'orders-ebay': 'eBay orders', 'orders-temu': 'Temu orders', 'orders-tiktok': 'TikTok Shop orders', background: 'Background jobs', walmart: 'Walmart Worker'};
const SHOPIFY_ORDER_TASKS = ['shopify-order-import', 'shopify-return-import'];
const EBAY_ORDER_TASKS = ['ebay-order-import', 'ebay-return-import'];
const TEMU_ORDER_TASKS = ['temu-order-import', 'temu-order-status', 'temu-order-enrichment', 'temu-return-import'];
const TIKTOK_ORDER_TASKS = ['tiktok-orders', 'tiktok-returns'];
const TIKTOK_TASKS = [
  ...TIKTOK_ORDER_TASKS,
  'tiktok-settlements', 'tiktok-products', 'tiktok-messages', 'tiktok-live',
  'tiktok-analytics', 'tiktok-affiliate', 'tiktok-promotions', 'tiktok-engagement', 'tiktok-commerce',
  'tiktok-launch', 'tiktok-inventory', 'tiktok-price', 'tiktok-webhook', 'tiktok-webhook-setup'
];
const ORDER_TASKS = [...SHOPIFY_ORDER_TASKS, ...EBAY_ORDER_TASKS, ...TEMU_ORDER_TASKS, ...TIKTOK_ORDER_TASKS];
const WALMART_TASKS = ['walmart-orders', 'walmart-returns', 'walmart-webhook', 'walmart-pricing', 'walmart-bulk-launch', 'walmart-launch-reconcile', 'walmart-existing-launch', 'walmart-reconcile', 'walmart-match', 'walmart-taxonomy', 'walmart-launch', 'walmart-feed', 'walmart-preview', 'walmart-update', 'walmart-retire', 'walmart-inventory-sync', 'walmart-settlements'];
const HEAVY_RESOURCE_TASKS = [
  'product-dump-import', 'vendor-feed-import', 'source-catalog-import', 'mapped-product-import',
  'source-facets-refresh', 'data-quality-scan', 'source-search-index', 'source-performance-indexes',
  'postgres-backup', 'shipping-report-export', 'order-export', 'walmart-bulk-launch', 'walmart-existing-launch', 'walmart-feed',
  'ebay-catalog-sync', 'ebay-taxonomy-sync', 'ebay-return-import', 'shopify-order-import', 'shopify-return-import', 'shopify-status-import', 'category-mapping-bulk-refresh'
];
const CATALOG_WORKLOAD_TASKS = [
  'product-dump-import', 'vendor-feed-import', 'source-catalog-import', 'mapped-product-import',
  'vendor-catalog-refresh', 'source-facets-refresh', 'source-search-index', 'source-performance-indexes',
  'data-quality-scan', 'supplier-coverage-refresh', 'datawarehouse-inventory-reclassification',
  'category-mapping-refresh', 'category-mapping-bulk-refresh', 'ai-category-review'
];
const MARKETPLACE_WORKLOAD_TASKS = [
  ...WALMART_TASKS,
  ...SHOPIFY_ORDER_TASKS,
  'shopify-settlement-sync', 'shopify-inventory-update', 'shopify-sku-map-sync', 'shopify-status-sync',
  'shopify-status-import', 'shopify-shipping-eligibility-sync', 'shopify-variant-price-push',
  'shopify-product-create', 'shopify-product-publication-update', 'shopify-product-status-update',
  'shopify-existing-variant-link', 'shopify-product-type-collections-sync', 'shopify-taxonomy-push',
  ...EBAY_ORDER_TASKS,
  'ebay-settlement-sync', 'ebay-price-inventory-sync', 'ebay-catalog-sync', 'ebay-taxonomy-sync',
  'ebay-category-auto-map', 'ebay-account-settings-sync', 'ebay-location-sync', 'ebay-listing-launch',
  ...TEMU_ORDER_TASKS,
  ...TIKTOK_TASKS,
  'status-inventory', 'inactive-inventory-temu', 'inactive-inventory-whatnot', 'inactive-inventory-tiktok',
  'fulfillment-tracking-refresh'
];
const WORKLOAD_LIMITS = Object.freeze({
  ...Object.fromEntries(CATALOG_WORKLOAD_TASKS.map((task) => [task, { lane: 'catalog-import', limit: 1 }])),
  ...Object.fromEntries(MARKETPLACE_WORKLOAD_TASKS.map((task) => [task, { lane: 'marketplace-sync', limit: 2 }])),
  ...Object.fromEntries(TIKTOK_ORDER_TASKS.map((task) => [task, { lane: 'tiktok-order-sync', limit: 1 }])),
  'fulfillment-rate-refresh': { lane: 'carrier-rates', limit: 1 },
  'shipping-dispute-quotes': { lane: 'carrier-rates', limit: 1 },
  'fulfillment-label-purchase': { lane: 'label-purchase', limit: 1 },
  'shipping-report-export': { lane: 'report-export', limit: 1 },
  'order-export': { lane: 'report-export', limit: 1 },
  'temu-settlement-report-import': { lane: 'settlement-import', limit: 1 },
  'fulfillment-projection-rebuild': { lane: 'fulfillment-rebuild', limit: 1 }
});
function validateLane(lane = 'all') {
  if (!['all', ...LANES].includes(lane)) throw new Error(`Unknown worker lane: ${lane}`);
  return lane;
}
const scheduledSql = `(lower(coalesce(raw->>'scheduled','false'))='true' or lower(coalesce(raw->'workerPayload'->>'scheduled','false'))='true' or lower(coalesce(name,'')) like 'scheduled %')`;
const backgroundSql = `(lower(coalesce(raw->>'background','false'))='true' or lower(coalesce(raw->'workerPayload'->>'background','false'))='true' or ${scheduledSql})`;
// Task ownership is evaluated when claiming, including jobs queued before deployment.
const laneSql = `case when coalesce(raw->>'workerTask','') = any($4::text[]) then 'orders-shopify' when coalesce(raw->>'workerTask','') = any($5::text[]) then 'orders-ebay' when coalesce(raw->>'workerTask','') = any($6::text[]) then 'orders-temu' when coalesce(raw->>'workerTask','') = any($7::text[]) then 'orders-tiktok' when coalesce(raw->>'workerTask','') = any($8::text[]) then 'walmart' when ${backgroundSql} then 'background' else 'manual' end`;
function supportsTask(lane, task) {
  if (lane === 'all') return true;
  if (lane === 'orders-shopify') return SHOPIFY_ORDER_TASKS.includes(task);
  if (lane === 'orders-ebay') return EBAY_ORDER_TASKS.includes(task);
  if (lane === 'orders-temu') return TEMU_ORDER_TASKS.includes(task);
  if (lane === 'orders-tiktok') return TIKTOK_ORDER_TASKS.includes(task);
  if (lane === 'walmart') return WALMART_TASKS.includes(task);
  return !ORDER_TASKS.includes(task) && !WALMART_TASKS.includes(task);
}
function heartbeatStatus(heartbeat = {}, configured = true, now = Date.now()) {
  const ageSeconds = heartbeat.lastSeenAt ? Math.max(0, (now - Date.parse(heartbeat.lastSeenAt)) / 1000) : null;
  const staleAfterSeconds = Math.max(30, Math.ceil(Number(heartbeat.heartbeatMs || heartbeat.pollMs || 5000) * 3 / 1000));
  const online = configured && ageSeconds !== null && ageSeconds <= staleAfterSeconds && !['stopped', 'failed', 'exited'].includes(heartbeat.status);
  return {...heartbeat, name: WORKER_NAMES[heartbeat.lane] || heartbeat.workerId || 'Legacy worker', configured, online, stale: configured && !online, ageSeconds, staleAfterSeconds};
}
function summarizeWorkers(heartbeats, configured) {
  let workers = heartbeats.filter(Boolean).map(h => heartbeatStatus(h, configured));
  if (workers.some(w => LANES.includes(w.lane))) workers = workers.filter(w => LANES.includes(w.lane) || w.online);
  const online = workers.filter(w => w.online);
  return {...(online[0] || workers[0] || heartbeatStatus({}, configured)), configured,
    online: online.length > 0, stale: configured && !online.length, workers,
    workerId: online.map(w => w.workerId).join(', '),
    currentTask: workers.map(w => `${w.name} (${w.lane || 'legacy'}): ${w.online ? w.currentTask || 'idle' : 'offline'}`).join(' · '),
    supportedTasks: [...new Set(online.flatMap(w => w.supportedTasks || []))]};
}
function jobWorkerStatus(job, status) {
  if (!status.workers) return status;
  // Never infer replacement from a different lane or a missing heartbeat.
  return status.workers.find(w => w.workerId === job.workerId)
    || status.workers.find(w => job.workerLane && w.lane === job.workerLane)
    || {online: false};
}
module.exports = {LANES, ORDER_TASKS, SHOPIFY_ORDER_TASKS, EBAY_ORDER_TASKS, TEMU_ORDER_TASKS, TIKTOK_ORDER_TASKS, TIKTOK_TASKS, WALMART_TASKS, HEAVY_RESOURCE_TASKS, CATALOG_WORKLOAD_TASKS, MARKETPLACE_WORKLOAD_TASKS, WORKLOAD_LIMITS, validateLane, laneSql, supportsTask, summarizeWorkers, jobWorkerStatus};
