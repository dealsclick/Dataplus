const crypto = require('node:crypto');
const { fail } = require('./walmart-client');

const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const TRANSIENT_CODES = new Set(['ERR_INT_SYS_01010010', 'EXT_DATA_ERROR_58585353020403']);

function ingestionErrors(value) {
  const rows = [];
  const visit = item => {
    if (!item) return;
    if (Array.isArray(item)) return item.forEach(visit);
    if (typeof item !== 'object') return;
    if (item.code || item.errorCode || item.description || item.message) rows.push({
      code: String(item.code || item.errorCode || '').trim(),
      message: String(item.description || item.message || item.errorDescription || '').trim()
    });
    for (const key of ['ingestionError', 'ingestionErrors', 'errors', 'error']) visit(item[key]);
  };
  visit(value);
  return rows;
}

function classifyIngestion(row = {}) {
  const status = String(row.ingestionStatus || '').toUpperCase();
  if (status === 'SUCCESS') return { category: 'accepted', retryable: false, label: 'Accepted by Walmart' };
  if (['INPROGRESS', 'RECEIVED', ''].includes(status)) return { category: 'pending', retryable: false, label: 'Awaiting Walmart' };
  const errors = ingestionErrors(row.ingestionErrors || row);
  const codes = errors.map(error => error.code).filter(Boolean);
  const text = errors.map(error => `${error.code} ${error.message}`).join(' ').toLowerCase();
  if (codes.some(code => TRANSIENT_CODES.has(code))) return { category: 'retryable_system', retryable: true, label: 'Retryable Walmart system error', errors };
  if (/approval|required approval|health\s*&\s*compliance|restricted category/.test(text)) return { category: 'approval_required', retryable: false, label: 'Walmart category approval required', errors };
  if (/already exists|sku and product id combination/.test(text) || codes.includes('EXT_DATA_ERROR_57055656036668')) return { category: 'existing_offer_relink', retryable: false, label: 'Already exists; link the Walmart offer', errors };
  if (/condition mismatch|product condition/.test(text) || codes.includes('EXT_DATA_ERROR_59747109670058')) return { category: 'condition_mismatch', retryable: false, label: 'Product condition mismatch', errors };
  return { category: 'rejected_other', retryable: false, label: 'Other Walmart rejection', errors };
}

function isLiveListing(row = {}) {
  const published = String(row.publishedStatus || '').toUpperCase();
  const lifecycle = String(row.lifecycleStatus || '').toUpperCase();
  return published === 'PUBLISHED' && !['RETIRED', 'ARCHIVED', 'DELETED'].includes(lifecycle);
}

function launchStatus(row = {}) {
  const classified = classifyIngestion(row);
  let category = classified.category;
  let label = classified.label;
  if (category === 'accepted') {
    category = isLiveListing(row) ? 'verified_live' : 'accepted_not_live';
    label = category === 'verified_live' ? 'Verified live on Walmart' : 'Accepted by Walmart, not live';
  }
  return {
    category,
    label,
    retryable: classified.retryable,
    errors: classified.errors || [],
    ingestionStatus: String(row.ingestionStatus || '').toUpperCase(),
    pendingStatusDescription: String(row.pendingStatusDescription || ''),
    automaticRetryAt: String(row.automaticRetryAt || ''),
    checkedAt: String(row.checkedAt || '')
  };
}

async function loadSubmitted(pool, runId) {
  const result = await pool.query(`select data from walmart_documents
    where starts_with(doc_key,$1) and data->>'status'='submitted' order by (data->>'index')::int nulls last`, [`walmart.bulk.${runId}.item.`]);
  return result.rows.map(row => row.data).filter(row => row.productId && row.sku && row.feedId);
}

async function loadTrackers(pool, environment, feedIds) {
  if (!feedIds.length) return [];
  const keys = feedIds.map(feedId => `walmart.pendingFeed.${digest([environment, feedId])}`);
  const result = await pool.query('select data from walmart_documents where doc_key=any($1::text[])', [keys]);
  return result.rows.map(row => row.data);
}

async function loadRunRetryFeeds(pool, runId) {
  const result = await pool.query("select data->>'feedId' as \"feedId\" from walmart_documents where starts_with(doc_key,'walmart.pendingFeed.') and data->>'bulkRunId'=$1", [runId]);
  return result.rows.map(row => row.feedId).filter(Boolean);
}

async function loadProducts(pool, productIds) {
  if (!productIds.length) return new Map();
  const result = await pool.query("select product_id as id, sku, raw->'walmartListing' as listing from products where product_id=any($1::text[])", [productIds]);
  return new Map(result.rows.map(row => [String(row.id), row]));
}

async function runLaunchReconciliation({ job, pool, read, write, check, persist, record = () => {}, getReportRows, retry, saveVerified, queueInventory, now = Date.now }) {
  const payload = job.workerPayload || {};
  const runId = String(payload.bulkRunId || '');
  if (!runId || payload.environment !== 'production') throw fail('A production Walmart bulk launch is required for reconciliation.');
  const summaryKey = `walmart.launch-reconciliation.${runId}`;
  const previousSummary = await read(summaryKey);
  const launchState = await read(`walmart.bulk.${runId}.state`) || {};
  const submitted = await loadSubmitted(pool, runId);
  const retryFeedIds = await loadRunRetryFeeds(pool, runId);
  const feedIds = [...new Set([...submitted.map(row => row.feedId), ...retryFeedIds, ...((previousSummary?.retryFeedIds || []).filter(Boolean))])];
  const trackers = await loadTrackers(pool, payload.environment, feedIds);
  const trackerByFeed = new Map(trackers.map(row => [row.feedId, row]));
  const waiting = feedIds.filter(feedId => !trackerByFeed.get(feedId)?.complete);
  if (waiting.length) {
    const next = new Date(now() + 15 * 60000).toISOString();
    const summary = { runId, launchJobId: payload.launchJobId, status: 'waiting_for_feeds', selectionTotal: launchState.selectionTotal || submitted.length, launchOutcomes: launchState.outcomes || {}, submitted: submitted.length, feeds: feedIds.length, waitingFeeds: waiting.length, retrySubmitted: previousSummary?.retrySubmitted || 0, updatedAt: new Date(now()).toISOString(), reconciliationJobId: job.id };
    await write(summaryKey, summary);
    await write('walmart.launch-reconciliation.latest', summary);
    await persist({ status: 'queued', phase: 'waiting-for-feeds', scheduledFor: next, queuePriority: 30, finishedAt: '', totalRows: submitted.length, processedRows: 0, message: `${waiting.length} Walmart feed${waiting.length === 1 ? '' : 's'} still processing; reconciliation will resume automatically.` });
    return summary;
  }

  await check();
  let products = await loadProducts(pool, [...new Set(submitted.map(row => String(row.productId)))]);
  const classify = row => {
    const product = products.get(String(row.productId));
    const listing = product?.listing || {};
    const latest = listing.feedId === row.feedId || listing.retrySourceFeedId === row.feedId ? listing : {};
    return { row, product, listing: latest, result: classifyIngestion(latest) };
  };
  let classified = submitted.map(classify);
  const retryable = classified.filter(entry => entry.result.retryable && !entry.listing.automaticRetryAt);
  if (retryable.length && payload.retryAttempt !== false) {
    await persist({ phase: 'retry-transient', totalRows: submitted.length, processedRows: submitted.length - retryable.length, message: `Retrying ${retryable.length} confirmed transient Walmart rejection${retryable.length === 1 ? '' : 's'} once.` });
    const retried = await retry(retryable.map(entry => entry.row), { runId, reconciliationJobId: job.id });
    const retryFeedIds = [...new Set(retried.map(row => row.feedId).filter(Boolean))];
    const next = new Date(now() + 15 * 60000).toISOString();
    const summary = { runId, launchJobId: payload.launchJobId, status: 'retry_submitted', submitted: submitted.length, feeds: feedIds.length + retryFeedIds.length, retrySubmitted: retried.length, retryFeedIds, updatedAt: new Date(now()).toISOString(), reconciliationJobId: job.id };
    await write(summaryKey, summary);
    await write('walmart.launch-reconciliation.latest', summary);
    await persist({ status: 'queued', phase: 'waiting-for-retry', scheduledFor: next, queuePriority: 30, finishedAt: '', processedRows: submitted.length, totalRows: submitted.length, message: `${retried.length} transient Walmart rejection${retried.length === 1 ? '' : 's'} resubmitted; publication verification will resume automatically.` });
    return summary;
  }

  products = await loadProducts(pool, [...new Set(submitted.map(row => String(row.productId)))]);
  classified = submitted.map(classify);
  await persist({ phase: 'verify-publication', processedRows: 0, totalRows: submitted.length, message: 'Downloading Walmart seller-item truth to verify publication.' });
  const reportRows = await getReportRows();
  const remoteBySku = new Map((reportRows || []).map(row => [String(row.sku), row]));
  const counts = {};
  const verifiedProductIds = [];
  const rows = [];
  for (const entry of classified) {
    await check();
    const remote = remoteBySku.get(String(entry.row.sku));
    let category = entry.result.category;
    if (category === 'accepted') category = remote && isLiveListing(remote) ? 'verified_live' : 'accepted_not_live';
    counts[category] = (counts[category] || 0) + 1;
    if (category === 'verified_live') {
      verifiedProductIds.push(String(entry.row.productId));
      await saveVerified(entry.row, remote);
    }
    rows.push({ sku: entry.row.sku, productId: entry.row.productId, feedId: entry.listing.feedId || entry.row.feedId, category, label: category === 'verified_live' ? 'Verified live' : category === 'accepted_not_live' ? 'Accepted, not live' : entry.result.label, errors: entry.result.errors || [] });
    record(rows.at(-1));
  }
  const inventory = verifiedProductIds.length ? await queueInventory([...new Set(verifiedProductIds)]) : null;
  const attention = rows.length - (counts.verified_live || 0);
  const summary = { runId, launchJobId: payload.launchJobId, status: attention ? 'needs_attention' : 'complete', selectionTotal: launchState.selectionTotal || submitted.length, launchOutcomes: launchState.outcomes || {}, submitted: submitted.length, feeds: feedIds.length, retrySubmitted: previousSummary?.retrySubmitted || 0, retryFeedIds, counts, verifiedLive: counts.verified_live || 0, inventoryJobId: inventory?.job?.id || '', inventoryQueued: Boolean(inventory?.job), inventoryMessage: inventory?.message || '', completedAt: new Date(now()).toISOString(), updatedAt: new Date(now()).toISOString(), reconciliationJobId: job.id, rows: rows.slice(0, 250) };
  await write(summaryKey, summary);
  await write('walmart.launch-reconciliation.latest', { ...summary, rows: undefined });
  await persist({ status: attention ? 'warning' : 'success', phase: 'complete', finishedAt: summary.completedAt, processedRows: rows.length, totalRows: rows.length, missingCount: attention, progressPercent: 100, message: `${summary.verifiedLive} Walmart listings verified live; ${attention} need attention.${summary.inventoryQueued ? ' Inventory sync queued only for verified-live listings.' : ''}` });
  return summary;
}

module.exports = { TRANSIENT_CODES, ingestionErrors, classifyIngestion, isLiveListing, launchStatus, runLaunchReconciliation };
