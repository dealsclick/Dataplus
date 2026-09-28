const LANES = ['manual', 'orders-shopify', 'orders-ebay', 'orders-temu', 'background', 'walmart'];
const WORKER_NAMES = {manual: 'Manual jobs', 'orders-shopify': 'Shopify orders', 'orders-ebay': 'eBay orders', 'orders-temu': 'Temu orders', background: 'Background jobs', walmart: 'Walmart Worker'};
const SHOPIFY_ORDER_TASKS = ['shopify-order-import', 'shopify-return-import'];
const EBAY_ORDER_TASKS = ['ebay-order-import', 'ebay-return-import'];
const TEMU_ORDER_TASKS = ['temu-order-import', 'temu-order-status', 'temu-order-enrichment', 'temu-return-import'];
const ORDER_TASKS = [...SHOPIFY_ORDER_TASKS, ...EBAY_ORDER_TASKS, ...TEMU_ORDER_TASKS];
const WALMART_TASKS = ['walmart-orders', 'walmart-pricing', 'walmart-bulk-launch', 'walmart-existing-launch', 'walmart-reconcile', 'walmart-match', 'walmart-taxonomy', 'walmart-launch', 'walmart-feed', 'walmart-preview', 'walmart-update', 'walmart-retire', 'walmart-inventory-sync'];
function validateLane(lane = 'all') {
  if (!['all', ...LANES].includes(lane)) throw new Error(`Unknown worker lane: ${lane}`);
  return lane;
}
const scheduledSql = `(lower(coalesce(raw->>'scheduled','false'))='true' or lower(coalesce(raw->'workerPayload'->>'scheduled','false'))='true' or lower(coalesce(name,'')) like 'scheduled %')`;
const backgroundSql = `(lower(coalesce(raw->>'background','false'))='true' or lower(coalesce(raw->'workerPayload'->>'background','false'))='true' or ${scheduledSql})`;
// Task ownership is evaluated when claiming, including jobs queued before deployment.
const laneSql = `case when coalesce(raw->>'workerTask','') = any($4::text[]) then 'orders-shopify' when coalesce(raw->>'workerTask','') = any($5::text[]) then 'orders-ebay' when coalesce(raw->>'workerTask','') = any($6::text[]) then 'orders-temu' when coalesce(raw->>'workerTask','') = any($7::text[]) then 'walmart' when ${backgroundSql} then 'background' else 'manual' end`;
function supportsTask(lane, task) {
  if (lane === 'all') return true;
  if (lane === 'orders-shopify') return SHOPIFY_ORDER_TASKS.includes(task);
  if (lane === 'orders-ebay') return EBAY_ORDER_TASKS.includes(task);
  if (lane === 'orders-temu') return TEMU_ORDER_TASKS.includes(task);
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
module.exports = {LANES, ORDER_TASKS, SHOPIFY_ORDER_TASKS, EBAY_ORDER_TASKS, TEMU_ORDER_TASKS, WALMART_TASKS, validateLane, laneSql, supportsTask, summarizeWorkers, jobWorkerStatus};
