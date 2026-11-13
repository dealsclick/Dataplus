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
assert.match(orderRoutingScan, /paginated: true/, 'order routing must paginate compact summaries');
assert.match(orderRoutingScan, /summary: true/, 'order routing must scan compact summaries');
assert.match(orderRoutingScan, /openWorkOnly: true/, 'order routing must exclude historical and terminal orders before pagination');
assert.match(orderRoutingScan, /sort: "created-asc"/, 'order routing must rescue the oldest open work first');
assert.match(orderRoutingScan, /page <= totalPages/, 'order routing must continue beyond the first page when necessary');
assert.doesNotMatch(orderRoutingScan, /limit: 1000/, 'order routing must not strand orders behind a fixed newest-order window');
const orderRoutingQueue = functionBody('processScheduledOrderRouting');
assert.match(orderRoutingQueue, /workerTask: "paid-order-routing"/, 'the web scheduler must queue routing on a worker');
assert.match(orderRoutingQueue, /queuePriority: 110/, 'paid-order routing must outrank background refresh work without delaying label purchases');
assert.match(orderRoutingQueue, /candidateFingerprint/, 'the web scheduler must identify repeated candidate sets');
assert.match(orderRoutingQueue, /SCHEDULED_ORDER_ROUTING_NOOP_COOLDOWN_MS/, 'the web scheduler must back off after a no-change routing pass');
assert.doesNotMatch(orderRoutingQueue, /readDbFast|readOrdersByIds|routeOrderForFulfillment/, 'the web scheduler must not execute routing work');
const orderRoutingWorker = functionBody('runPaidOrderRoutingWorkerJob');
assert.match(orderRoutingWorker, /readOrdersByIds\(candidateIds\)/, 'the worker must hydrate only candidate orders');
assert.match(orderRoutingWorker, /readOrderRoutingContext/, 'the worker must use the targeted routing context');
assert.doesNotMatch(orderRoutingWorker, /readDbFast/, 'the worker must not hydrate unrelated operational documents');
assert.match(orderRoutingWorker, /routeOrderForFulfillment/, 'the worker must own fulfillment routing');
assert.doesNotMatch(orderRoutingWorker, /listOrders\(\{ limit: 1000 \}\)/, 'order routing must not scan complete order documents');

const immediateRoutingQueue = functionBody('queuePaidOrderRoutingCandidates');
assert.match(immediateRoutingQueue, /lower\(status\) in \('queued', 'running'\)/, 'immediate routing must deduplicate active routing work');
assert.match(immediateRoutingQueue, /queuePriority: options\.immediate === true \? 150 : 110/, 'import-triggered routing must outrank the periodic recovery pass');
assert.match(immediateRoutingQueue, /pendingIds\.length; offset \+= SCHEDULED_ORDER_ROUTING_LIMIT/, 'immediate routing must preserve bounded worker payloads');
for (const importSource of ['ebay-order-import', 'temu-order-import', 'shopify-order-import', 'walmart-order-import', 'tiktok-orders']) {
  assert.match(source, new RegExp(`queuePaidOrderRoutingCandidates\\([^\\n]+source: ['\"]${importSource}['\"]`), `${importSource} must enqueue fulfillment routing immediately after a live import`);
}

const routingWatchdog = functionBody('refreshFulfillmentRoutingHealth');
assert.match(source, /FULFILLMENT_ROUTING_WATCHDOG_INTERVAL_MS = 5 \* 60_000/, 'the reconciliation watchdog must run every five minutes');
assert.match(source, /FULFILLMENT_ROUTING_BACKLOG_ALERT_MINUTES = 5/, 'paid orders waiting five minutes must trigger an alert');
assert.match(routingWatchdog, /scanFulfillmentRoutingBacklog/, 'the watchdog must reconcile paid orders against routing state');
assert.match(routingWatchdog, /createSystemNotification/, 'the watchdog must notify operators when routing or critical queues are late');
assert.match(source, /\/api\/fulfillment\/routing-health/, 'fulfillment routing health must have a dedicated API');
const criticalQueueWatchdog = functionBody('auditCriticalOperationQueues');
assert.match(criticalQueueWatchdog, /recoverStaleCriticalOperationJobs/, 'the one-minute queue watchdog must recover stale queued critical work');
assert.match(criticalQueueWatchdog, /createSystemNotification/, 'the one-minute queue watchdog must alert on critical queue age');
assert.match(source, /setInterval\(\(\) => void auditCriticalOperationQueues\(\), 60_000\)/, 'critical queue SLAs must be audited every minute');

const purchasePooling = functionBody('processScheduledPurchasePooling');
assert.match(purchasePooling, /readOrderRoutingContext/, 'purchase pooling must use the targeted routing context');
assert.doesNotMatch(purchasePooling, /readDbFast/, 'purchase pooling must not hydrate unrelated operational documents');
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
assert.match(trackingRefresh, /includeLegacyRecovery/, 'tracking refresh must make historical batch hydration explicit');
assert.ok(
  trackingRefresh.indexOf('veeqoShipmentTrackingDetails(remote') < trackingRefresh.indexOf('trackingNumberFromStoredShipmentLabel'),
  'Veeqo tracking refresh must inspect provider JSON before parsing a stored label'
);

const dbSource = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
assert.match(dbSource, /jsonb_build_object\(\s*'id', shipment->'id'/, 'summary shipments must use a compact projection');
assert.match(dbSource, /coalesce\(summary_raw\."routingLastAttemptAt", ''\) as routing_last_attempt_at/, 'order summaries must retain routing retry timestamps');
assert.match(dbSource, /coalesce\(summary_raw\."routingLastResult", ''\) as routing_last_result/, 'order summaries must retain routing outcomes');
assert.match(dbSource, /coalesce\(summary_raw\."routingAttemptCount", '0'\) as routing_attempt_count/, 'order summaries must retain routing retry counts');
assert.match(dbSource, /async function listFulfillmentConsoleRateCandidates/, 'scheduled rate discovery must query a bounded relational projection');
assert.match(dbSource, /async function listFulfillmentLabelBatchProjectionRows/, 'snapshot rebuilds must project compact label batches in PostgreSQL');
assert.match(dbSource, /async function pruneRedundantNoopOperationJobs/, 'retention cleanup must compact redundant no-change routing history');
assert.match(dbSource, /async function readCriticalOperationQueueHealth/, 'critical queue telemetry must report queue age and worker progress');
assert.match(dbSource, /async function recoverStaleCriticalOperationJobs/, 'critical queued jobs must have bounded priority recovery');
assert.match(dbSource, /queueRecoveryCount[\s\S]*?< 3/, 'automatic recovery must be bounded to prevent endless queue churn');
const ratePreparation = source.slice(source.indexOf('async function prepareFulfillmentRateRefresh'), source.indexOf('async function refreshFulfillmentRateRow'));
assert.match(ratePreparation, /readStateField\("fulfillmentOperationsSettings"\)/, 'rate jobs must read only fulfillment settings before hydrating targeted orders');
assert.doesNotMatch(ratePreparation, /readFulfillmentOperationsState\(/, 'rate jobs must not hydrate historical label batches');

const labelPurchase = functionBody('runFulfillmentLabelPurchaseWorkerJob');
assert.match(labelPurchase, /readFulfillmentLabelPurchaseState\(batchId\)/, 'label purchasing must hydrate only its requested batch');
assert.doesNotMatch(labelPurchase, /readFulfillmentOperationsState\(/, 'label purchasing must not hydrate all historical batches');
assert.doesNotMatch(labelPurchase, /writeStateDocuments\(\{ fulfillmentLabelBatches/, 'label purchasing must persist targeted batch entities');

const rateQueue = functionBody('queueFulfillmentRateRefreshJob');
assert.match(rateQueue, /postgres\.isPostgresEnabled\(\)[\s\S]*?\{ importJobs: \[\] \}/, 'rate queueing must use a compact PostgreSQL job context');
assert.match(rateQueue, /queuePriority: background \? 80 : 130/, 'operator rate refreshes must outrank ordinary background work');
assert.match(rateQueue, /workerPayload:[\s\S]*?background: true,[\s\S]*?scheduled: options\.scheduled === true/, 'rate refreshes must use the background carrier worker without changing their manual or automated trigger');
const labelQueue = functionBody('queueFulfillmentLabelPurchaseJob');
assert.match(labelQueue, /postgres\.isPostgresEnabled\(\)[\s\S]*?\{ importJobs: \[\] \}/, 'label queueing must use a compact PostgreSQL job context');
assert.match(labelQueue, /queuePriority: 140/, 'label purchases must outrank rate refreshes and ordinary background work');
assert.match(labelQueue, /workerPayload:[\s\S]*?background: true/, 'label purchases must use the background carrier worker instead of waiting behind manual catalog jobs');

const batchCreationState = functionBody('readFulfillmentLabelBatchCreationState');
assert.match(batchCreationState, /listFulfillmentLabelBatchProjectionRows\(\)/, 'batch creation must inspect compact PostgreSQL projections');
assert.doesNotMatch(batchCreationState, /readFulfillmentOperationsState\(/, 'batch creation must not hydrate historical batch payloads');

const routingContext = functionBody('readOrderRoutingContext');
assert.match(routingContext, /postgres\.readStateFields\(fields/, 'routing context must request named state fields only');
assert.doesNotMatch(routingContext, /fulfillmentLabelBatches|warehouseAudits|fulfillmentPrintQueue/, 'routing context must exclude heavyweight operational history');

const fulfillmentUiSource = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'components', 'fulfillment-route.tsx'), 'utf8');
assert.match(fulfillmentUiSource, /Fulfillment routing health/, 'the fulfillment workspace must display routing health');
assert.match(fulfillmentUiSource, /Package data needed/, 'package readiness must be distinct from routing status');
assert.match(fulfillmentUiSource, /FulfillmentRoutingStatus/, 'routed work must show its routing state independently');
const orderDetailUiSource = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'components', 'order-detail-route.tsx'), 'utf8');
assert.match(orderDetailUiSource, /Fulfillment \(\{fulfillmentRecordCount\}\)/, 'order detail must count active routes before a shipment is purchased');

console.log('Server scheduler efficiency checks passed.');
