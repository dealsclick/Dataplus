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

const supplierStartup = functionBody('reconcileSupplierDirectoryOnStartup');
assert.doesNotMatch(supplierStartup, /postgres\.readState\(/, 'supplier startup reconciliation must not hydrate orders');
assert.match(supplierStartup, /postgres\.readStateFields\(/, 'supplier startup reconciliation must read only required state fields');

const orderRouting = functionBody('processScheduledOrderRouting');
assert.match(orderRouting, /listOrders\(\{ limit: 1000, summary: true \}\)/, 'order routing must scan compact summaries');
assert.match(orderRouting, /readOrdersByIds\(candidateIds\)/, 'order routing must hydrate only candidate orders');
assert.doesNotMatch(orderRouting, /listOrders\(\{ limit: 1000 \}\)/, 'order routing must not scan complete order documents');

const purchasePooling = functionBody('processScheduledPurchasePooling');
assert.match(purchasePooling, /orderLimit: 1, purchaseOrderLimit: 1/, 'purchase pooling must avoid broad state hydration');
assert.match(purchasePooling, /readOrdersByIds\(dueOrderIds\)/, 'purchase pooling must hydrate only due order records');

const fulfillmentSnapshot = functionBody('buildFulfillmentConsoleSnapshot');
assert.match(fulfillmentSnapshot, /listOrders\(\{ limit: 5000, summary: true \}\)/, 'fulfillment must use compact order summaries');
assert.match(source, /FULFILLMENT_CONSOLE_SNAPSHOT_DIRTY_COOLDOWN_MS = 30_000/, 'dirty fulfillment snapshots must be refresh-throttled');

const dbSource = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
assert.match(dbSource, /shipment\s+- 'raw'\s+- 'rawSummary'/, 'summary shipments must exclude nested marketplace payloads');

console.log('Server scheduler efficiency checks passed.');
