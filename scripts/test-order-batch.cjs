const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { uniqueRecords } = require('../lib/order-batch');
const source = fs.readFileSync(require('node:path').join(__dirname, '../db.js'), 'utf8');
const body = source.slice(source.indexOf('async function upsertOrdersFromState('), source.indexOf('async function upsertPurchaseOrdersFromState('));
async function run({ conflict = false, failure = false } = {}) {
  const queries = []; let acquired = 0; let released = 0;
  const client = { query: async (sql) => {
    queries.push(sql.trim());
    if (failure && sql.includes('insert into order_line_items')) throw new Error('insert failed');
  }, release: () => released++ };
  const context = {
    require: () => ({ uniqueRecords }),
    getPool: () => ({ connect: async () => { acquired++; return client; }, query: () => { throw new Error('Pool query forbidden'); } }),
    initRelationalSchema: async () => {}, sourceOrderFullyShipped: () => false,
    normalizeSourceOrderCompletion: () => {},
    orderRecordFromState: o => ({ order_id: o.id, value: o.value }),
    orderLineRecordsFromState: o => [{ line_id: o.id + '-line', value: o.value }]
  };
  vm.createContext(context);
  vm.runInContext(body, context);
  const orders = Array.from({ length: 101 }, (_, i) => ({ id: String(i), value: 1 }));
  orders.push({ id: '0', value: conflict ? 2 : 1 });
  if (conflict || failure) await assert.rejects(context.upsertOrdersFromState(orders, { replace: false, batchSize: 100 }), conflict ? /this batch was not written/ : /insert failed/);
  else {
    const result = await context.upsertOrdersFromState(orders, { replace: false, batchSize: 100 });
    assert.equal(result.orders, 101); assert.equal(result.lines, 101);
  }
  assert.equal(acquired, conflict ? 0 : 1); assert.equal(released, acquired);
  if (!conflict) {
    assert.equal(queries[0], 'begin');
    assert.equal(queries.at(-1), failure ? 'rollback' : 'commit');
  }
}
(async () => {
  assert.equal(uniqueRecords([{id:1,a:2},{a:2,id:1}], 'id', 'test').length, 1);
  await run(); await run({conflict:true}); await run({failure:true});
  console.log('PASS order batch deduplication, conflict validation and pinned transaction rollback/release');
})().catch(error => { console.error(error); process.exitCode = 1; });
