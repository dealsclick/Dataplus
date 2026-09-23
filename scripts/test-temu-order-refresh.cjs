const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { fingerprint, canSkip, parallelReads } = require('../lib/temu-order-refresh');
const source = fs.readFileSync(require.resolve('../server'), 'utf8');
const start = source.indexOf('async function importTemuOrders(');
const code = source.slice(start, source.indexOf('async function queueTemuOrderImportJob(', start));
function harness(pages, { existing = [], failure = false } = {}) {
  const calls = [], saved = [], lookups = [], progress = [];
  const db = { orders: [], connections: [], connectorState: { temuLastOrderSync: 100 } };
  const find = (state, row) => state.orders.find(o => o.marketplaceOrderNumber === row.marketplaceOrderNumber);
  const run = vm.runInNewContext(code + '\nimportTemuOrders', {
    require: name => require('../' + name.replace('./', '')),
    temuChannelSettings: () => ({}), unixStartOfDay: () => 0, getTemuConfig: () => ({ pageSize: 2 }),
    chunkTemuList: (rows, size) => { const out=[]; for(let i=0;i<rows.length;i+=size)out.push(rows.slice(i,i+size)); return out; },
    temuOrderPages: require('../lib/temu-order-pagination').temuOrderPages,
    temuRequest: async (method, payload) => { calls.push({method, payload}); if(method==='bg.order.list.v2.get') return pages[Math.min(payload.pageNumber-1,pages.length-1)]; return { success: true }; },
    optionalTemuOrderRequest: async (method, payload, options) => { calls.push({method,payload}); if(failure && method==='bg.order.amount.query') { options.errors.push('amount failed'); options.orderErrors.push('amount failed'); } return { value: 1 }; },
    temuPayload: x => x, firstArrayFrom: r => r.rows, valueAt: (r, keys, fallback) => { for(const k of keys)if(r[k]!==undefined)return r[k]; return fallback; },
    extractTemuOrderSn: r => r.id, mapTemuStatus: s => s, temuOrderStatusImpliesPaid: () => true,
    findExistingMarketplaceOrder: find, childItemsFromTemuPayload: () => [], extractTemuPackageSns: () => [],
    mapTemuOrder: row => ({ id: row.id, source: 'Temu', marketplaceOrderNumber: row.id, external: {}, items: [] }),
    temuOrderIsImportable: () => true,
    upsertOrder: (state, row) => { const old=find(state,row); if(old){Object.assign(old,row);return 'updated';}state.orders.push(row);return 'created'; },
    orderLineItems: () => [], sourceTextValue: String,
  });
  return { db,calls,saved,lookups,progress, run: options => run(db, {
    forceLookback: false, limit: 5000,
    loadOrders: async ids => { lookups.push([...ids]); return existing.filter(o=>ids.includes(o.id)); },
    flushOrders: async rows => saved.push(...rows), progress: async p => progress.push(p), ...options
  }) };
}
test('unchanged cache is canonical, time bounded, and bypassed for events/errors/legacy orders', () => {
  const row={ id:'A', updateTime:100, status:2 };
  const existing={ external:{temuListRefresh:{fingerprint:fingerprint(row),completedAt:new Date().toISOString()}}};
  assert.equal(canSkip(existing,{status:2,updateTime:100,id:'A'}),true);
  assert.equal(canSkip(existing,{...row,updateTime:101}),false);
  assert.equal(canSkip(existing,row,{force:true}),false);
  assert.equal(canSkip({},row),false);
  assert.equal(canSkip(existing,row,{now:Date.now()+7*3600000}),false);
  existing.external.importWarnings=['retry']; assert.equal(canSkip(existing,row),false);
});
test('independent requests are bounded to two and retain result order', async () => {
  let active=0, peak=0;
  const values=await parallelReads(Array.from({length:7},(_,i)=>async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,2));active--;return i;}));
  assert.equal(peak,2); assert.deepEqual(values,[0,1,2,3,4,5,6]);
});
test('unchanged overlap makes no detail calls or writes; changed and new orders are saved', async () => {
  const a={id:'A',status:'paid',updateTime:100}, b={id:'B',status:'paid',updateTime:101};
  const existing=[{id:'A',marketplaceOrderNumber:'A',external:{temuListRefresh:{fingerprint:fingerprint(a),completedAt:new Date().toISOString()}}}];
  const h=harness([{rows:[a,b],total:2}],{existing}); const result=await h.run({});
  assert.equal(result.skipped,1); assert.equal(result.created,1);
  assert.deepEqual(h.calls.filter(c=>c.method==='bg.order.detail.v2.get').map(c=>c.payload.parentOrderSn),['B']);
  assert.deepEqual(h.saved.map(o=>o.id),['B']); assert.deepEqual(h.lookups,[['A','B']]);
  assert.ok(h.db.connectorState.temuLastOrderSync>100);
});
test('cap, failed enrichment, failed list, and repeated pages never advance the checkpoint', async () => {
  const rows=[{id:'A'},{id:'B'}];
  const capped=harness([{rows,total:4}]); const r=await capped.run({limit:2}); assert.equal(capped.db.connectorState.temuLastOrderSync,100); assert.match(r.errors.join(' '),/configured limit/);
  const failed=harness([{rows:[rows[0]],total:1}],{failure:true}); await failed.run({}); assert.equal(failed.db.connectorState.temuLastOrderSync,100); assert.equal(failed.saved[0].external.temuListRefresh,undefined);
  for(const pages of [[{success:false,errorMsg:'API failed'}],[{rows,total:4}]]) { const h=harness(pages);await assert.rejects(h.run({}));assert.equal(h.db.connectorState.temuLastOrderSync,100); }
});
test('targeted webhook bypasses unchanged detection and never moves polling checkpoint', async () => {
  const row={id:'A'}; const existing=[{id:'A',marketplaceOrderNumber:'A',external:{temuListRefresh:{fingerprint:fingerprint(row),completedAt:new Date().toISOString()}}}];
  const h=harness([{rows:[row],total:1}],{existing});await h.run({parentOrderSnList:['A']});
  assert.equal(h.calls.filter(c=>c.method==='bg.order.detail.v2.get').length,1);assert.equal(h.db.connectorState.temuLastOrderSync,100);
});
test('full incremental scan saves every page and advances only after the final page', async () => {
  const h=harness([{rows:[{id:'A'},{id:'B'}],total:5},{rows:[{id:'C'},{id:'D'}],total:5},{rows:[{id:'E'}],total:5}]);
  const last=Math.floor(Date.now()/1000)-120;h.db.connectorState.temuLastOrderSync=last;
  const result=await h.run({fetchAll:true,limit:0});
  assert.equal(result.fetched,5);assert.deepEqual(h.saved.map(o=>o.id),['A','B','C','D','E']);
  const requests=h.calls.filter(c=>c.method==='bg.order.list.v2.get');
  assert.deepEqual(requests.map(c=>c.payload.pageNumber),[1,2,3]);
  assert.equal(requests[0].payload.updateAtStart,last-3600);
  assert.ok(h.db.connectorState.temuLastOrderSync>last);
});
