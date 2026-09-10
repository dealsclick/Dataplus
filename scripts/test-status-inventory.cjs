const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStatusInventoryWorker, protection, requireChannel } = require('../lib/status-inventory');
const { supplierUnavailable } = require('../lib/supplier-retirement');
const vendor = { id: 'v', name: 'Test', status: 'inactive' };
assert.equal(supplierUnavailable(vendor), true);
assert.equal(supplierUnavailable({ status: 'active', catalogSettings: { enabled: false } }), false);
assert.equal(protection({ active: false }, [], 9), 'master');
assert.equal(protection({ active: true, supplier: 'Test' }, [vendor]), 'supplier');
assert.throws(() => protection({ supplier: 'Test' }, [vendor], 1), /alternate/);
assert.throws(() => requireChannel({ settings: { channelEnabled: false } }, 'ebay'), /disabled/);

async function scenario({ key = 'ebay', active = false, disabled = false, physical = false, alternate = false, reject = false, supplier = false, reactivated = false } = {}) {
  const item = { id: 'p', sku: 'SKU', active, supplier: 'Test', qty: 999, shopifyId: key === 'shopify' ? '1' : undefined,
    ebayListing: key === 'ebay' ? { listingId: '1', offerId: '2' } : undefined,
    whatnotListing: key === 'whatnot' ? { listingId: '1' } : undefined,
    warehouseStock: physical ? [{ isPhysical: true, qty: 5 }] : [] };
  const original = JSON.stringify(item), patches = [], writes = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-inventory-test-'));
  let reads = 0;
  const postgres = {
    getPool: () => ({ query: async (sql, args) => ({ rows: sql.includes('count(*)') ? [{ n: alternate ? 1 : 0 }] : args[0] ? [] : [{ product_id: 'p' }] }) }),
    readOperationJob: async () => ({ status: 'running' }),
    readProductsByKeys: async () => { reads++; return [{ ...item, active: reactivated && reads > 1 ? true : item.active }]; },
    readStateField: async name => name === 'vendors' ? (supplier ? [vendor] : []) : name === 'connections' ? [{ name: { ebay: 'eBay', shopify: 'Shopify', whatnot: 'Whatnot' }[key], settings: { channelEnabled: !disabled, shopifyInventoryPushEnabled: true, whatnotInventorySyncEnabled: true } }] : []
  };
  const run = createStatusInventoryWorker({ postgres, artifactsDir: dir, persistJob: async (job, patch) => { patches.push(patch); Object.assign(job, patch); }, readDb: async () => ({}), log: () => {},
    ebayRequest: async (db, url, options) => { writes.push(options.body); return reject ? { responses: [] } : { responses: [{ sku: 'SKU', statusCode: 200 }] }; },
    send: async (key, request) => { writes.push(request); if (reject) throw new Error('Rejected'); },
    shopify: async (query, vars) => {
      if (query.startsWith('query')) return { product: { variants: { nodes: [{ sku: 'SKU', inventoryPolicy: 'DENY', inventoryItem: { id: 'i', tracked: true, inventoryLevels: { nodes: [{ location: { id: 'a' } }, { location: { id: 'b' } }] } } }], pageInfo: {} } } };
      writes.push(vars.input); return { inventorySetQuantities: { inventoryAdjustmentGroup: {}, userErrors: reject ? [{ message: 'Rejected' }] : [] } };
    }
  });
  try {
    await run({ id: 'job', workerPayload: supplier ? { vendorId: 'v' } : { productId: 'p' } });
    assert.equal(JSON.stringify(item), original, 'Local stock and listings must not change');
    return { writes, last: patches.at(-1) };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

async function testSql() {
  // Explicit local-only connection; fixtures are rolled back, never production.
  const { Client } = require('pg');
  const client = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', database: 'postgres' });
  await client.connect();
  try {
    await client.query('begin');
    await client.query('create schema status_inventory_fixture');
    await client.query('set local search_path to status_inventory_fixture');
    await client.query(`create sequence operations_job_number_seq;
      create table products(product_id text, sku text, active boolean, raw jsonb);
      create table entity_documents(collection text, entity_id text, data jsonb);
      create table operations_jobs(job_id text,job_number bigint,status text,name text,category text,message text,raw jsonb);`);
    await require('../lib/status-inventory-schema').installStatusInventoryTriggers(client);
    await client.query(`insert into products values('p','SKU',true,'{}');
      update products set active=false; update products set raw='{"status":"inactive"}';
      insert into entity_documents values('vendors','v','{"status":"active"}');
      update entity_documents set data='{"status":"other"}';
      update entity_documents set data='{"status":"inactive"}';
      update entity_documents set data='{"status":"inactive","retirement":{"retiredAt":"now"}}';`);
    assert.equal(Number((await client.query('select count(*) from operations_jobs')).rows[0].count), 2);
    await client.query('savepoint atomic_test');
    await client.query(`update products set active=true,raw='{}'; update products set active=false`);
    assert.equal(Number((await client.query('select count(*) from operations_jobs')).rows[0].count), 3);
    await client.query('rollback to atomic_test');
    assert.equal(Number((await client.query('select count(*) from operations_jobs')).rows[0].count), 2);
  } finally { await client.query('rollback'); await client.end(); }
}
(async () => {
  assert.equal((await scenario()).writes.length, 1);
  assert.equal((await scenario({ disabled: true })).writes.length, 0);
  assert.equal((await scenario({ reactivated: true })).writes.length, 0);
  assert.equal((await scenario({ reject: true })).last.status, 'warning');
  assert.equal((await scenario({ key: 'shopify' })).writes.length, 2);
  assert.equal((await scenario({ key: 'whatnot' })).writes.length, 1);
  assert.equal((await scenario({ active: true, supplier: true })).writes.length, 1);
  assert.equal((await scenario({ active: true, supplier: true, physical: true })).writes.length, 0);
  assert.equal((await scenario({ active: true, supplier: true, alternate: true })).writes.length, 0);
  if (process.argv.includes('--sql')) await testSql();
  console.log('Status inventory tests passed: transitions, gates, local stock preservation, channel acknowledgments and source exceptions.');
})().catch(e => { console.error(e); process.exitCode = 1; });
