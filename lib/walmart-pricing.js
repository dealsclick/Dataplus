const crypto = require('node:crypto');
const { fail } = require('./walmart-client');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const accountKey = payload => hash([payload.channelId, payload.environment, payload.credentialKey]);
const prefix = payload => `walmart.pricing.${accountKey(payload)}`;
const rowKey = (payload, sku) => `${prefix(payload)}.sku.${hash(sku)}`;
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
function normalize(row, checkedAt) {
  return { sku: row.sku, checkedAt, currentPrice: number(row.currentPrice), buyBoxBasePrice: number(row.buyBoxBasePrice), buyBoxTotalPrice: number(row.buyBoxTotalPrice), competitorPrice: number(row.competitorPrice), suggestedPrice: number(row.suggestedPrice), buyBoxWinRate: number(row.buyBoxWinRate) };
}
async function runPricing({ job, client, read, write, lock, check, persist, now = Date.now }) {
  const account = prefix(job.workerPayload), runKey = `walmart.pricing-run.${job.id}`;
  const state = await read(runKey) || { page: 0, processed: 0 };
  const finish = async () => {
    await write(`${account}.sync`, { checkedAt: new Date(now()).toISOString(), jobId: job.id, count: state.processed });
    await persist({ status: 'success', phase: 'complete', finishedAt: new Date(now()).toISOString(), processedRows: state.processed, totalRows: state.processed, progressPercent: 100, message: `${state.processed} Walmart pricing insights cached. Prices were not changed.` });
  };
  const defer = async (until, message) => persist({ status: 'queued', phase: 'pricing-wait', scheduledFor: new Date(until).toISOString(), queuePriority: 25, message, processedRows: state.processed });
  await check();
  if (state.complete) return finish();
  const rateKey = `${account}.rate`;
  const nextAt = await lock('pricing-rate', async () => {
    const saved = await read(rateKey);
    if (saved?.nextAt > now()) return saved.nextAt;
    await write(rateKey, { nextAt: now() + 35000 }); return 0;
  });
  if (nextAt) return defer(nextAt, 'Waiting for Walmart pricing allowance; listing linking continues independently.');
  let response;
  try {
    response = await client.request('/v3/price/getPricingInsights', { method: 'POST', body: { pageNumber: state.page }, jobId: job.id, retryReads: false, onResponse: async r => {
      if (r.status !== 429) return;
      const retry = r.headers.get('retry-after');
      const delay = retry && Number.isFinite(Number(retry)) ? Number(retry) * 1000 : Date.parse(retry || '') - now();
      await write(rateKey, { nextAt: now() + Math.max(60000, delay || 0) });
    } });
  } catch (error) {
    if (error.upstreamStatus === 429) return defer((await read(rateKey))?.nextAt || now() + 60000, 'Walmart throttled pricing insights; automatic retry scheduled.');
    throw error;
  }
  const rows = response?.data?.pricingInsightsResponseList, paging = response?.data?.pageContext;
  if (!Array.isArray(rows) || !paging || rows.some(row => !row || typeof row.sku !== 'string' || !row.sku)) throw fail('Invalid Walmart pricing response. Previous cached prices preserved.');
  if (new Set(rows.map(row => row.sku)).size !== rows.length) throw fail('Walmart repeated a seller SKU within a pricing page.');
  const count = Number(paging.totalCount), totalPages = Number(paging.totalPages);
  if (!Number.isInteger(count) || count < 0 || !Number.isInteger(totalPages) || totalPages < 0) throw fail('Missing Walmart pricing pagination. Previous cached prices preserved.');
  const pageHash = hash(rows.map(row => row.sku));
  if (rows.length && await read(`${runKey}.seen.${pageHash}`)) throw fail('Walmart repeated a pricing page; refusing incomplete success.');
  if (!rows.length && state.processed < count) throw fail('Walmart pricing pagination ended early.');
  const checkedAt = new Date(now()).toISOString();
  await check();
  for (const row of rows) await write(rowKey(job.workerPayload, row.sku), normalize(row, checkedAt));
  // Commit cursor before the duplicate-page marker so a crash can repeat harmless local cache writes.
  state.processed += rows.length; state.page++; state.complete = state.processed >= count;
  if (!state.complete && totalPages > 0 && state.page >= totalPages) throw fail('Walmart pricing page count ended before the reported items.');
  await write(runKey, state);
  if (rows.length) await write(`${runKey}.seen.${pageHash}`, { seen: true });
  if (state.complete) return finish();
  await defer(now() + 35000, `${state.processed}/${count} pricing insights cached; next page queued.`);
}
module.exports = { runPricing, rowKey, prefix, normalize };
