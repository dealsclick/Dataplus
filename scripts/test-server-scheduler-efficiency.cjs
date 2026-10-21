const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function functionBody(name) {
  const start = source.indexOf(`async function ${name}`);
  assert(start >= 0, `${name} must exist`);
  const end = source.indexOf('\nasync function ', start + 1);
  return source.slice(start, end < 0 ? source.length : end);
}

assert.doesNotMatch(source, /reconcileSupplierDirectoryOnStartup/, 'web startup must not hydrate purchase orders for global supplier reconciliation');

const orderRoutingScan = functionBody('scheduledOrderRoutingCandidateIds');
assert.match(orderRoutingScan, /listOrders\(\{ limit: 1000, summary: true \}\)/, 'order routing must scan compact summaries');
const orderRoutingQueue = functionBody('processScheduledOrderRouting');
assert.match(orderRoutingQueue, /workerTask: "paid-order-routing"/, 'the web scheduler must queue routing on the background worker');
assert.doesNotMatch(orderRoutingQueue, /readDbFast|readOrdersByIds|routeOrderForFulfillment/, 'the web scheduler must not execute routing work');
const orderRoutingWorker = functionBody('runPaidOrderRoutingWorkerJob');
assert.match(orderRoutingWorker, /readOrdersByIds\(candidateIds\)/, 'the worker must hydrate only candidate orders');
assert.match(orderRoutingWorker, /routeOrderForFulfillment/, 'the worker must own fulfillment routing');
assert.doesNotMatch(orderRoutingWorker, /listOrders\(\{ limit: 1000 \}\)/, 'order routing must not scan complete order documents');

const purchasePooling = functionBody('processScheduledPurchasePooling');
assert.match(purchasePooling, /orderLimit: 1, purchaseOrderLimit: 1/, 'purchase pooling must avoid broad state hydration');
assert.match(purchasePooling, /readOrdersByIds\(dueOrderIds\)/, 'purchase pooling must hydrate only due order records');

const fulfillmentSnapshot = functionBody('buildFulfillmentConsoleSnapshot');
assert.match(fulfillmentSnapshot, /listOrders\(\{ limit: 50000, summary: true, dateFrom: recentShipmentDate, includeOpenWork: true \}\)/, 'fulfillment must use compact summaries for recent history and every open order');
assert.match(source, /FULFILLMENT_CONSOLE_SNAPSHOT_DIRTY_COOLDOWN_MS = 30_000/, 'dirty fulfillment snapshots must be refresh-throttled');

const trackingRefresh = functionBody('refreshFulfillmentShipmentTracking');
assert.match(trackingRefresh, /listShipmentTrackingCandidates\(/, 'tracking refresh must query the relational shipment candidate index');
assert.match(trackingRefresh, /readOrdersByIds\(candidateOrderIds\)/, 'tracking refresh must hydrate only due candidate orders');
assert.doesNotMatch(trackingRefresh, /listOrders\(/, 'tracking refresh must not scan the order list');
assert.doesNotMatch(trackingRefresh, /readStateArrayItems\("fulfillmentLabelBatches"/, 'tracking refresh must not hydrate full historical batches for indexed shipments');
assert.match(trackingRefresh, /patchFulfillmentBatchTrackingReference/, 'tracking refresh must patch only the referenced batch after resolving tracking');
assert.match(trackingRefresh, /allowLabelFallback/, 'tracking refresh must make PDF fallback an explicit bounded option');
assert.ok(
  trackingRefresh.indexOf('veeqoShipmentTrackingDetails(remote') < trackingRefresh.indexOf('trackingNumberFromStoredShipmentLabel'),
  'Veeqo tracking refresh must inspect provider JSON before parsing a stored label'
);

const dbSource = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
assert.match(dbSource, /jsonb_build_object\(\s*'id', shipment->'id'/, 'summary shipments must use a compact projection');
assert.match(dbSource, /async function listFulfillmentConsoleRateCandidates/, 'scheduled rate discovery must query a bounded relational projection');
assert.match(dbSource, /async function listFulfillmentLabelBatchProjectionRows/, 'snapshot rebuilds must project compact label batches in PostgreSQL');

console.log('Server scheduler efficiency checks passed.');
