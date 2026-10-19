const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../db.js'), 'utf8');
const body = source.slice(source.indexOf('function orderLineRecordsFromState('), source.indexOf('function purchaseOrderIsReportable('));
const context = {
  crypto,
  nullableString: (value) => value == null || String(value).trim() === '' ? null : String(value),
  nullableNumber: (value) => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value)
};
vm.createContext(context);
vm.runInContext(body, context);

const item = { id: '1', sku: 'BUS16284DIB', title: 'Krylon COLORmaxx', qty: 1 };
const first = context.orderLineRecordsFromState({ id: 'walmart-a', items: [item] })[0];
const second = context.orderLineRecordsFromState({ id: 'walmart-b', items: [item] })[0];
const repeated = context.orderLineRecordsFromState({ id: 'walmart-a', items: [item] })[0];

assert.notEqual(first.line_id, second.line_id, 'Marketplace line IDs must be namespaced by order');
assert.equal(first.line_id, repeated.line_id, 'The relational identity must be deterministic');
assert.equal(first.raw.id, '1', 'The original marketplace line ID must remain in raw data');
assert.equal(first.sku, 'BUS16284DIB');
console.log('PASS order-scoped relational line identity');
