const LANES = ['manual', 'orders', 'background', 'walmart'];
const WORKER_NAMES = {manual: 'Joe Biden', orders: 'Donald Trump', background: 'Steve Jobs', walmart: 'Walmart Worker'};
const ORDER_TASKS = ['walmart-orders', 'shopify-order-import', 'ebay-order-import', 'temu-order-import', 'temu-order-status', 'temu-order-enrichment', 'ebay-return-import', 'shopify-return-import', 'temu-return-import'];
const WALMART_TASKS = ['walmart-pricing', 'walmart-bulk-launch', 'walmart-existing-launch', 'walmart-reconcile', 'walmart-match', 'walmart-taxonomy', 'walmart-launch', 'walmart-feed', 'walmart-preview', 'walmart-update', 'walmart-inventory-sync'];
function validateLane(lane = 'all') {
  if (!['all', ...LANES].includes(lane)) throw new Error(`Unknown worker lane: ${lane}`);
  return lane;
}
const scheduledSql = `(lower(coalesce(raw->>'scheduled','false'))='true' or lower(coalesce(raw->'workerPayload'->>'scheduled','false'))='true' or lower(coalesce(name,'')) like 'scheduled %')`;
const backgroundSql = `(lower(coalesce(raw->>'background','false'))='true' or lower(coalesce(raw->'workerPayload'->>'background','false'))='true' or ${scheduledSql})`;
// Task ownership is evaluated when claiming, including jobs queued before deployment.
const laneSql = `case when coalesce(raw->>'workerTask','') = any($4::text[]) then 'orders' when coalesce(raw->>'workerTask','') = any($5::text[]) then 'walmart' when ${backgroundSql} then 'background' else 'manual' end`;
function supportsTask(lane, task) {
  if (lane === 'all') return true;
  if (lane === 'orders') return ORDER_TASKS.includes(task);
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
module.exports = {LANES, ORDER_TASKS, WALMART_TASKS, validateLane, laneSql, supportsTask, summarizeWorkers, jobWorkerStatus};
