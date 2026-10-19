const assert = require('node:assert/strict');
const { classifyIngestion, ingestionErrors, isLiveListing, launchStatus, runLaunchReconciliation } = require('../lib/walmart-launch-reconciliation');

assert.deepEqual(ingestionErrors({ ingestionError: [{ code: 'A', description: 'First' }, { errorCode: 'B', message: 'Second' }] }), [
  { code: 'A', message: 'First' },
  { code: 'B', message: 'Second' }
]);
assert.equal(classifyIngestion({ ingestionStatus: 'SUCCESS' }).category, 'accepted');
assert.equal(classifyIngestion({ ingestionStatus: 'SYSTEM_ERROR', ingestionErrors: { ingestionError: [{ code: 'ERR_INT_SYS_01010010', description: 'Try again' }] } }).retryable, true);
assert.equal(classifyIngestion({ ingestionStatus: 'DATA_ERROR', ingestionErrors: { ingestionError: [{ code: 'EXT_DATA_ERROR_58585353020403', description: 'Out of sequence' }] } }).retryable, true);
assert.equal(classifyIngestion({ ingestionStatus: 'DATA_ERROR', ingestionErrors: { ingestionError: [{ code: 'X', description: 'Health & Compliance approval required' }] } }).category, 'approval_required');
assert.equal(classifyIngestion({ ingestionStatus: 'DATA_ERROR', ingestionErrors: { ingestionError: [{ code: 'EXT_DATA_ERROR_57055656036668', description: 'SKU and Product ID combination already exists' }] } }).category, 'existing_offer_relink');
assert.equal(classifyIngestion({ ingestionStatus: 'DATA_ERROR', ingestionErrors: { ingestionError: [{ code: 'EXT_DATA_ERROR_59747109670058', description: 'Product Condition mismatch' }] } }).category, 'condition_mismatch');
assert.equal(classifyIngestion({ ingestionStatus: 'SYSTEM_ERROR', ingestionErrors: { ingestionError: [{ code: 'UNKNOWN', description: 'Unknown failure' }] } }).retryable, false);
assert.equal(isLiveListing({ publishedStatus: 'PUBLISHED', lifecycleStatus: 'ACTIVE' }), true);
assert.equal(isLiveListing({ publishedStatus: 'PUBLISHED', lifecycleStatus: 'RETIRED' }), false);
assert.equal(isLiveListing({ publishedStatus: 'UNPUBLISHED', lifecycleStatus: 'ACTIVE' }), false);
assert.equal(launchStatus({ ingestionStatus: 'SUCCESS', publishedStatus: 'PUBLISHED', lifecycleStatus: 'ACTIVE' }).category, 'verified_live');
assert.equal(launchStatus({ ingestionStatus: 'SUCCESS', publishedStatus: 'UNPUBLISHED', lifecycleStatus: 'ACTIVE' }).category, 'accepted_not_live');
assert.equal(launchStatus({ ingestionStatus: 'DATA_ERROR', ingestionErrors: [{ code: 'X', message: 'Approval required' }] }).category, 'approval_required');

async function workflow() {
  const documents = new Map();
  const submitted = [{ index: 0, sku: 'LIVE', productId: 'p-live', feedId: 'feed-1', status: 'submitted' }];
  const products = new Map([['p-live', { id: 'p-live', sku: 'LIVE', listing: { feedId: 'feed-1', ingestionStatus: 'SUCCESS' } }]]);
  let inventoryKeys = [], reportCalls = 0;
  const pool = { query: async (sql, params) => {
    if (sql.includes("data->>'status'='submitted'")) return { rows: submitted.map(data => ({ data })) };
    if (sql.includes("data->>'bulkRunId'")) return { rows: [] };
    if (sql.includes('doc_key=any') && sql.includes('walmart_documents')) return { rows: [{ data: { feedId: 'feed-1', complete: true } }] };
    if (sql.includes('from products')) return { rows: params[0].map(id => products.get(id)).filter(Boolean) };
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const job = { id: 'reconcile-job', workerPayload: { bulkRunId: 'run-1', launchJobId: 'launch-job', environment: 'production' } };
  const summary = await runLaunchReconciliation({ job, pool, read: async key => documents.get(key), write: async (key, value) => documents.set(key, structuredClone(value)), check: async () => {}, persist: async patch => Object.assign(job, patch),
    getReportRows: async () => { reportCalls++; return [{ sku: 'LIVE', publishedStatus: 'PUBLISHED', lifecycleStatus: 'ACTIVE' }]; },
    retry: async () => { throw new Error('Successful rows must not retry.'); }, saveVerified: async () => {}, queueInventory: async keys => { inventoryKeys = keys; return { job: { id: 'inventory-job' } }; } });
  assert.equal(reportCalls, 1); assert.deepEqual(inventoryKeys, ['p-live']); assert.equal(summary.verifiedLive, 1); assert.equal(summary.inventoryJobId, 'inventory-job');

  submitted[0] = { ...submitted[0], sku: 'RETRY', productId: 'p-retry', feedId: 'feed-2' };
  products.clear(); products.set('p-retry', { id: 'p-retry', sku: 'RETRY', listing: { feedId: 'feed-2', ingestionStatus: 'SYSTEM_ERROR', ingestionErrors: { ingestionError: [{ code: 'ERR_INT_SYS_01010010', description: 'Try again' }] } } });
  pool.query = async (sql, params) => {
    if (sql.includes("data->>'status'='submitted'")) return { rows: submitted.map(data => ({ data })) };
    if (sql.includes("data->>'bulkRunId'")) return { rows: [] };
    if (sql.includes('doc_key=any') && sql.includes('walmart_documents')) return { rows: [{ data: { feedId: 'feed-2', complete: true } }] };
    if (sql.includes('from products')) return { rows: params[0].map(id => products.get(id)).filter(Boolean) };
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  let retries = 0;
  const retryJob = { id: 'retry-job', workerPayload: { bulkRunId: 'run-2', launchJobId: 'launch-job-2', environment: 'production' } };
  const retrySummary = await runLaunchReconciliation({ job: retryJob, pool, read: async key => documents.get(key), write: async (key, value) => documents.set(key, structuredClone(value)), check: async () => {}, persist: async patch => Object.assign(retryJob, patch), getReportRows: async () => { throw new Error('Publication report must wait for the retry feed.'); }, retry: async rows => { retries += rows.length; return [{ feedId: 'retry-feed' }]; }, saveVerified: async () => {}, queueInventory: async () => null });
  assert.equal(retries, 1); assert.equal(retrySummary.status, 'retry_submitted'); assert.deepEqual(retrySummary.retryFeedIds, ['retry-feed']); assert.equal(retryJob.status, 'queued');
}

workflow().then(() => console.log('PASS Walmart launch rejection classification, controlled retry, publication verification, and targeted inventory')).catch(error => { console.error(error); process.exitCode = 1 });
