const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../db.js'), 'utf8');
const body = source.slice(
  source.indexOf('async function assignOrderRecordNumbers('),
  source.indexOf('async function upsertOrdersFromState(')
);
const queries = [];
const client = {
  async query(sql, params = []) {
    const normalized = String(sql).trim();
    queries.push({ sql: normalized, params });
    if (normalized.startsWith('select order_id, order_number, internal_order_number')) {
      return { rows: [{ order_id: 'existing', order_number: '50000', internal_order_number: '50000' }] };
    }
    if (normalized.startsWith('select greatest(')) return { rows: [{ current_value: '55000' }] };
    return { rows: [] };
  }
};
const context = { Map, Set };
vm.createContext(context);
vm.runInContext(body, context);

(async () => {
  const records = [
    { order_id: 'existing', order_number: '1', internal_order_number: '1', raw: {} },
    { order_id: 'collision', order_number: '50000', internal_order_number: '50000', raw: {} },
    { order_id: 'missing', order_number: null, internal_order_number: null, raw: {} }
  ];
  const assigned = await context.assignOrderRecordNumbers(client, records);
  assert.equal(records[0].internal_order_number, '50000');
  assert.equal(records[1].internal_order_number, '55001');
  assert.equal(records[2].internal_order_number, '55002');
  assert.equal(records[2].raw.displayOrderNumber, '55002');
  assert.equal(assigned.get('collision'), '55001');
  assert.match(queries[0].sql, /pg_advisory_xact_lock/);
  assert.equal(queries.at(-1).params[0], 55002);
  console.log('PASS order number allocation preserves existing numbers and replaces conflicts atomically');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
