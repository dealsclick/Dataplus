const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pause = (message, until = Date.now() + 60000) => Object.assign(new Error(message), { bulkPause: true, until });
const BATCH_SIZE = 1000, CHUNK_SIZE = 100, MAX_BYTES = 24 * 1024 * 1024;

// Persisted pacing is shared by bulk runs for the same account, including worker restarts.
function createBulkRequester({ client, read, write, lock, account, check, jobId, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  return async (path, options = {}) => {
    const bucket = path.includes('/feeds?') ? 'feeds' : path.includes('/walmart/search?') ? 'search' : 'seller';
    const spacing = { feeds: 240000, search: 500, seller: 1500 }[bucket];
    const key = `walmart.bulk.rate.${hash(account)}.${bucket}`;
    await check();
    await lock(key, async () => {
      const saved = await read(key);
      if (saved?.nextAt > now()) {
        const delay = saved.nextAt - now();
        if (bucket === 'feeds' || delay > 1500) throw pause(`Waiting for Walmart ${bucket} allowance.`, saved.nextAt);
        await sleep(delay); await check();
      }
      await write(key, { nextAt: now() + spacing });
    });
    try {
      if (options.beforeSend) await options.beforeSend();
      return await client.request(path, { ...options, jobId, retryReads: false, onResponse: async response => {
        const remaining = response.headers.get('x-current-token-count');
        if (response.status !== 429 && (remaining === null || Number(remaining) > 0)) return;
        const retry = response.headers.get('retry-after');
        const replenishment = response.headers.get('x-next-replenishment-time');
        const parseTime = value => {
          if (!value) return 0;
          const numeric = Number(value);
          return Number.isFinite(numeric) && numeric > 0 ? (numeric < 1e12 ? numeric * 1000 : numeric) : Date.parse(value) || 0;
        };
        const retryAt = retry ? (Number.isFinite(Number(retry)) ? now() + Number(retry) * 1000 : Date.parse(retry) || 0) : 0;
        const nextAt = Math.max(now() + spacing, parseTime(replenishment), retryAt, response.status === 429 ? now() + 60000 : 0);
        await lock(key, async () => { const saved = await read(key); await write(key, { nextAt: Math.max(saved?.nextAt || 0, nextAt) }); });
      } });
    } catch (error) {
      if (error.upstreamStatus === 429) {
        const saved = await read(key);
        throw Object.assign(pause('Walmart rate limit reached; progress saved for automatic resume.', Math.max(saved?.nextAt || 0, now() + 60000)), { rejected: true });
      }
      if ([401,403].includes(error.upstreamStatus)) throw Object.assign(error, { bulkFatal: true });
      if ((!options.method || options.method === 'GET') && error.statusCode === 502 && (!error.upstreamStatus || error.upstreamStatus >= 500)) throw pause(`Walmart read unavailable; automatic retry: ${error.message}`, now() + 60000);
      throw error;
    }
  };
}

async function runBulkLaunch(d) {
  const { job, read, write, check, persist, record, selectionPage, request, prepare, submit, identity, now = Date.now } = d;
  const runId = job.workerPayload.bulkRunId || job.id;
  const prefix = `walmart.bulk.${runId}`, stateKey = `${prefix}.state`;
  let state = await read(stateKey) || { identity, selectionPage: 0, selectionTotal: 0, selectionComplete: false, sellerPage: 0, sellerCursor: '*', sellerComplete: false, cursor: 0, batchStart: 0, outcomes: {}, complete: false };
  if (state.identity !== identity) throw new Error('Bulk run account or selection changed. Start a new selection.');
  const itemKey = index => `${prefix}.item.${index}`;
  const checkpoint = async () => { await write(stateKey, state); };
  const summary = async () => {
    await write(`walmart.match.${job.id}`, { actor: job.workerPayload.actor, runId, total: state.selectionTotal, processed: Object.values(state.outcomes).reduce((a,b) => a+b,0), outcomes: state.outcomes, complete: state.complete, updatedAt: new Date(now()).toISOString() });
  };
  const finishRow = async (index, row) => {
    const previous = await read(itemKey(index));
    if (previous?.final) return;
    await write(itemKey(index), { ...previous, ...row, index, final: true });
    record(row);
  };
  const yieldJob = async (phase, message, until = now() + 1000) => {
    await checkpoint(); await summary();
    await persist({ status: 'queued', phase, scheduledFor: new Date(until).toISOString(), queuePriority: 30, finishedAt: '', totalRows: state.selectionTotal, processedRows: Object.values(state.outcomes).reduce((a,b)=>a+b,0), message });
  };
  const completeJob = async () => {
      const attention = Object.entries(state.outcomes).filter(([key]) => !['submitted','skipped'].includes(key)).reduce((n,[,v])=>n+v,0);
      await persist({ status: attention ? 'warning' : 'success', phase: 'complete', finishedAt: new Date(now()).toISOString(), processedRows: state.selectionTotal, totalRows: state.selectionTotal, missingCount: attention, progressPercent: 100, message: `${state.outcomes.submitted || 0} offers submitted in bulk; ${state.outcomes.skipped || 0} skipped; ${attention} need attention. Publication is verified separately.` });
  };
  try {
    await check();
    if (state.complete) { await summary(); await completeJob(); return state; }
    // Selection is materialized before submitting any feed. Retry resumes the same staged selection.
    if (!state.selectionComplete) {
      const page = await selectionPage(state.selectionPage);
      if (page.hasMore && page.keys.length !== 500) throw new Error('Selection paging must use complete 500-record pages.');
      if (page.keys.length) {
        await write(`${prefix}.selection.${state.selectionPage}`, { keys: page.keys });
        state.selectionPage++; state.selectionTotal += page.keys.length;
      }
      state.selectionComplete = !page.hasMore;
      await yieldJob('stage-selection', `${state.selectionTotal} products staged for bulk Walmart launch.`); return;
    }
    if (!state.sellerComplete && state.selectionTotal <= 100) state.sellerComplete = true;
    const sellerExists = async sku => {
      const key = `${prefix}.seller.${hash(sku)}`, saved = await read(key);
      if (saved) return saved.exists !== false;
      if (state.selectionTotal > 100 && state.sellerLookup !== 'exact') return false;
      let data;
      try { data = await request(`/v3/items/${encodeURIComponent(sku)}?productIdType=SKU`); }
      catch (error) { if (error.upstreamStatus !== 404) throw error; data = { ItemResponse: [] }; }
      const rows = data.ItemResponse || data.itemResponse;
      if (!Array.isArray(rows) || rows.some(row => row.sku !== sku)) throw new Error('Invalid exact seller SKU lookup.');
      const exists = rows.length > 0; await write(key, { sku, exists }); return exists;
    };
    // Walmart cursors can remain constant between pages and expire after two minutes.
    // Keep a short scan; after an expired cursor use exact checks for uncached selected SKUs.
    if (!state.sellerComplete) {
      state.sellerStartedAt ||= now();
      let data;
      try {
        if (now() - state.sellerStartedAt >= 90000) throw Object.assign(new Error('Seller cursor expired'), {upstreamStatus:400});
        data = await request(`/v3/items?${new URLSearchParams({ nextCursor: state.sellerCursor, limit: '1000' })}`);
      } catch (error) {
        if (![400,404].includes(error.upstreamStatus)) throw error;
        state.sellerLookup = 'exact'; state.sellerComplete = true;
        await yieldJob('check-selected-listings', 'Walmart seller scan expired; continuing with exact checks for selected SKUs.'); return;
      }
      const items = data.ItemResponse || data.itemResponse;
      if (!Array.isArray(items) || items.some(item => !item.sku)) throw new Error('Invalid Walmart seller-catalog page. No offers submitted.');
      const pageKey = `${prefix}.seller-page.${hash(items.map(item => item.sku))}`;
      if (items.length && await read(pageKey)) {
        state.sellerLookup = 'exact'; state.sellerComplete = true;
        await yieldJob('check-selected-listings', 'Walmart repeated a seller page; continuing with exact checks for selected SKUs.'); return;
      }
      const next = data.nextCursor || '';
      for (const item of items) await write(`${prefix}.seller.${hash(item.sku)}`, { sku: item.sku });
      state.sellerCount = (state.sellerCount || 0) + items.length;
      const reported = Number(data.totalItems ?? data.totalCount);
      const complete = Number.isFinite(reported) && state.sellerCount >= reported;
      if ((!next || !items.length) && !complete) state.sellerLookup = 'exact';
      state.sellerCursor = next; state.sellerPage++; state.sellerComplete = complete || !next || !items.length;
      await checkpoint();
      if (items.length) await write(pageKey, {seen:true});
      await yieldJob('download-listings', `${state.sellerCount} existing Walmart listings indexed.`); return;
    }
    const end = Math.min(state.batchStart + BATCH_SIZE, state.selectionTotal);
    let handled = 0;
    while (state.cursor < end && handled++ < CHUNK_SIZE) {
      await check();
      const index = state.cursor, saved = await read(itemKey(index));
      if (!saved) {
        const page = await read(`${prefix}.selection.${Math.floor(index / 500)}`);
        const key = page?.keys[index % 500];
        if (!key) throw new Error('Staged selection is incomplete; refusing to change the launch selection.');
        try {
          const row = await prepare(key, sellerExists, request);
          if (row.status === 'prepared') {
            const canonicalKey = `${prefix}.product.${hash(row.productId)}`;
            const existing = await read(canonicalKey);
            const skuKey = `${prefix}.sku.${hash(row.sku)}`, skuOwner = await read(skuKey);
            if (existing && existing.index !== index) await finishRow(index, { sku: row.sku, status: 'skipped', message: 'Duplicate product in selection.' });
            else if (skuOwner && skuOwner.productId !== row.productId) await finishRow(index, { sku: row.sku, status: 'blocked', error: 'Multiple products share this seller SKU.' });
            else { await write(canonicalKey, { index }); await write(skuKey, { productId: row.productId }); await write(itemKey(index), { ...row, index }); }
          }
          else await finishRow(index, row);
        } catch (error) {
          if (error.bulkFatal || error.bulkPause || error.statusCode === 499 || error.statusCode === 409) throw error;
          await finishRow(index, { sku: error.sku || key, status: error.statusCode === 502 ? 'error' : 'blocked', error: error.message });
        }
      }
      state.cursor++;
    }
    if (state.cursor < end) { await yieldJob('match-and-prepare', `${state.cursor}/${state.selectionTotal} catalog checks staged; feeds contain up to ${BATCH_SIZE} offers.`); return; }
    const pending = [];
    for (let index = state.batchStart; index < end; index++) { const row = await read(itemKey(index)); if (row?.token) pending.push(row); }
    // Feed grouping is deterministic across retries; each group has its own durable submission intent.
    const groups = [];
    for (const row of pending) {
      const signature = hash([row.version, row.header]);
      let group = groups.at(-1);
      const bytes = Buffer.byteLength(JSON.stringify(row.item));
      if (bytes > MAX_BYTES - 4096) { await finishRow(row.index, { sku: row.sku, status: 'blocked', error: 'One offer exceeds the feed size limit.' }); continue; }
      if (!group || group.signature !== signature || group.bytes + bytes > MAX_BYTES - 4096) { group = { signature, rows: [], bytes: 0 }; groups.push(group); }
      group.rows.push(row); group.bytes += bytes;
    }
    for (const group of groups) {
      await check();
      if (group.rows.every(row => row.final)) continue;
      const batchKey = `${prefix}.feed.${hash(group.rows.map(row => row.index))}`;
      const results = await submit(batchKey, group.rows, request);
      for (let i = 0; i < group.rows.length; i++) await finishRow(group.rows[i].index, results[i]);
    }
    // Recount completed windows instead of incrementing counters before a crash-safe checkpoint.
    const outcomes = {};
    for (let index = state.batchStart; index < end; index++) { const row = await read(itemKey(index)); if (!row?.final) throw new Error('Bulk feed has unfinished rows.'); outcomes[row.status] = (outcomes[row.status] || 0) + 1; }
    for (const [status, count] of Object.entries(outcomes)) state.outcomes[status] = (state.outcomes[status] || 0) + count;
    state.batchStart = end; state.complete = end === state.selectionTotal;
    await checkpoint(); await summary();
    if (state.complete) {
      await completeJob();
    } else await yieldJob('bulk-launch', `${end}/${state.selectionTotal} products completed; next batch queued.`);
    return state;
  } catch (error) {
    if (error.bulkPause) { await yieldJob('rate-limit-wait', error.message, error.until); return; }
    throw error;
  }
}
module.exports = { runBulkLaunch, createBulkRequester, BATCH_SIZE, MAX_BYTES, pause, hash };
