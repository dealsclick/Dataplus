const { createHash } = require('node:crypto');
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
function fingerprint(listOrder) {
  return createHash('sha256').update(JSON.stringify(stable(listOrder))).digest('hex');
}
function canSkip(existing, listOrder, { force = false, now = Date.now() } = {}) {
  const saved = existing?.external?.temuListRefresh;
  // Legacy/incomplete imports and targeted events always receive full details.
  if (force || !saved || existing.external?.importWarnings?.length) return false;
  const age = now - Date.parse(saved.completedAt);
  return age >= 0 && age < 6 * 60 * 60 * 1000 && saved.fingerprint === fingerprint(listOrder);
}
async function parallelReads(tasks, concurrency = 2) {
  let index = 0;
  const results = new Array(tasks.length);
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    for (;;) { const i = index++; if (i >= tasks.length) break; results[i] = await tasks[i](); }
  }));
  return results;
}
module.exports = { fingerprint, canSkip, parallelReads };
