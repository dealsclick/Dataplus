const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const start = source.indexOf('function prepareHistoricalBackfillOrder(');
const end = source.indexOf('\nasync function importShopifyOrders(', start);
assert(start >= 0 && end > start, 'Historical backfill order guard must exist.');

const context = {
  sourceOrderFullyShipped: order => ['shipped', 'fulfilled', 'completed', 'delivered'].includes(String(order.fulfillmentStatus || order.status || '').toLowerCase()),
};
vm.createContext(context);
vm.runInContext(`${source.slice(start, end)}\nthis.prepare = prepareHistoricalBackfillOrder;`, context);

const completed = context.prepare({ source: 'Temu', status: 'shipped', total: 12.5 }, { channel: 'Temu', jobId: 'job-1' });
assert.equal(completed.historicalBackfill, true);
assert.equal(completed.excludedFromOperationalQueues, true);
assert.equal(completed.historicalReviewRequired, false);
assert.equal(completed.total, 12.5, 'Historical sales remain reportable.');

const open = context.prepare({ source: 'Temu', status: 'paid' }, { channel: 'Temu', jobId: 'job-2' });
assert.equal(open.excludedFromOperationalQueues, false);
assert.equal(open.historicalReviewRequired, true);
assert.equal(open.operationalStatus, 'on_hold');
assert.match(open.historicalReviewReason, /review/i);

assert.match(source, /soldSkus\.length && !payload\.historicalBackfill/);
assert.match(source, /options\.historicalBackfill !== true && checkpointComplete/);
assert.match(source, /if \(!payload\.historicalBackfill\) await reconcilePersistedTerminalOrders/);

console.log('PASS historical order backfill isolation');
