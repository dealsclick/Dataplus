const crypto = require('crypto');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Public projection only: never return payloads, credentials, or submission tokens.
async function jobChannelFeeds(job, pool) {
  const payload = job.workerPayload || job.raw?.workerPayload || {};
  const walmart = String(job.workerTask || job.raw?.workerTask || '').startsWith('walmart-');
  const channel = walmart ? 'Walmart' : String(job.channel || job.raw?.channel || 'Channel');
  const rows = new Map();
  function add(value) {
    const id = value?.feedId;
    if (typeof id !== 'string' || !id.trim() || id.length > 512) return;
    rows.set(id, { ...rows.get(id), channel, feedId: id, ...(value.submittedAt || value.at ? { submittedAt: value.submittedAt || value.at } : {}) });
  }
  for (const source of [job.raw || {}, job, payload]) {
    add(source);
    for (const id of Array.isArray(source.feedIds) ? source.feedIds : []) add(typeof id === 'string' ? { feedId: id } : id);
  }
  if (walmart) {
    if (payload.bulkRunId) {
      // Prefix is generated from the saved job, never supplied by the browser.
      const prefix = `walmart.bulk.${payload.bulkRunId}.feed.`;
      const result = await pool.query("select data->>'feedId' as \"feedId\", data->>'submittedAt' as \"submittedAt\" from walmart_documents where starts_with(doc_key,$1) and data->>'jobId'=$2 order by doc_key", [prefix, job.id]);
      result.rows.forEach(add);
    }
    const tokens = [...new Set([payload.token, ...(Array.isArray(payload.tokens) ? payload.tokens : [])].filter(x => typeof x === 'string'))];
    if (tokens.length) {
      const result = await pool.query("select data->>'feedId' as \"feedId\", data->>'at' as at from walmart_documents where doc_key=any($1::text[]) and data->>'jobId'=$2", [tokens.map(x => `walmart.preview.${x}`), job.id]);
      result.rows.forEach(add);
    }
    if (rows.size) {
      const keys = [...rows.keys()].map(id => `walmart.feed.${payload.environment || 'production'}.${hash(id)}`);
      const result = await pool.query("select data->>'feedId' as \"feedId\", data->>'feedStatus' as status, data->>'itemsSucceeded' as succeeded, data->>'itemsFailed' as failed, data->>'itemsProcessing' as processing, data->>'checkedAt' as \"checkedAt\" from walmart_documents where doc_key=any($1::text[])", [keys]);
      for (const row of result.rows) if (rows.has(row.feedId)) rows.set(row.feedId, { ...rows.get(row.feedId), ...row });
    }
  }
  return [...rows.values()];
}
module.exports = { jobChannelFeeds };
