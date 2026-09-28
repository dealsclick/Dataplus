const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('server.js', 'utf8');
const marker = '  if (req.method === "PATCH" && parts[0] === "api" && parts[1] === "inventory" && parts[2] && parts.length === 3 && postgres.isPostgresEnabled()) {';
const start = source.indexOf(marker);
assert.ok(start > 0);
const end = source.indexOf('\n  }', start) + 4;
const route = source.slice(start, end);
async function run(search, options = {}) {
  const events = [];
  const item = { id: 'product-1', sku: 'TEST', qty: 3, reserved: 0, title: 'Old' };
  const context = {
    req: { method: 'PATCH' }, res: {}, parts: ['api','inventory','TEST'],
    url: new URL(`https://example.test/api/inventory/TEST${search}`),
    parseBody: async () => options.body || { title: 'Changed' },
    postgres: {
      isPostgresEnabled: () => true,
      readProductByKey: async () => options.missing ? null : item,
      upsertProductsFromState: async () => { events.push('persist'); if (options.fail) throw Error('write failed'); },
      readOperationalSummary: async () => { events.push('summary'); return { inventoryCount: 999 }; },
    },
    applyInventoryPatch: (row, body) => Object.assign(row, body),
    formatCategoryName: value => String(value).trim(),
    publicCategoriesFast: async () => ({ categories: [] }),
    redisCache: { deleteByPrefix: async key => events.push(key) },
    publicInventoryItem: row => row,
    readShopifyStatusMapSync: () => ({}), readProductSourceEnrichmentSync: () => ({}),
    sendJson: (_res, status, body) => { events.push('response'); return { status, body }; },
    notFound: () => ({ status: 404 }),
  };
  const response = await vm.runInNewContext(`(async () => { ${route} })()`, context);
  return { response, events };
}
(async () => {
  const lean = await run('?response=item');
  assert.equal(lean.response.status, 200);
  assert.equal(lean.response.body.item.title, 'Changed');
  assert.equal(lean.response.body.summary, undefined);
  assert.ok(!lean.events.includes('summary'));
  assert.equal(lean.events[0], 'persist');
  assert.equal(lean.events.at(-1), 'response');
  assert.ok(lean.events.includes('dataplus:product-detail:'));
  const legacy = await run('');
  assert.equal(legacy.response.body.summary.inventoryCount, 999);
  assert.ok(legacy.events.includes('summary'));
  assert.equal((await run('?response=item', { missing: true })).response.status, 404);
  assert.equal((await run('?response=item', { body: { mainCategory: 'Unknown' } })).response.status, 400);
  await assert.rejects(run('?response=item', { fail: true }), /write failed/);
  const ui = fs.readFileSync('web/src/App.tsx', 'utf8');
  assert.match(ui, /encodeURIComponent\(product\.sku \|\| sku \|\| product\.id \|\| ""\)\}\?response=item/);
  console.log('Product save response: 6 route cases and React request contract passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
