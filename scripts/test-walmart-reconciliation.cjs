const assert = require('node:assert/strict');
const { Client } = require('pg');
const { gtin, chooseMatch, reconcileItem, runReconciliation, resolveOrderLinks } = require('../lib/walmart-reconciliation');
async function main() {
  assert.equal(gtin('036000291452'), '00036000291452'); assert.equal(gtin('36000291452'), '00036000291452'); assert.equal(gtin('036000291453'), ''); assert.equal(gtin(36000291452), '');
  const local = { id: 'p', sku: 'LOCAL', upc: '036000291452', uomQty: 1 };
  assert.equal(chooseMatch({ sku: 'LOCAL', upc: local.upc }, [local], [local, local], 2).basis, 'sku');
  assert.equal(chooseMatch({ sku: 'REMOTE', gtin: '00036000291452' }, [], [local], 1).basis, 'upc');
  assert.equal(chooseMatch({ sku: 'REMOTE', upc: local.upc }, [], [local, local], 1).status, 'review');
  assert.equal(chooseMatch({ sku: 'REMOTE', upc: local.upc }, [], [local], 2).status, 'review');
  assert.equal(chooseMatch({ sku: 'REMOTE', upc: local.upc }, [], [{ ...local, uomQty: 2 }], 1).status, 'review');
  assert.equal(chooseMatch({ sku: 'LOCAL', upc: '012345678905' }, [local], [], 1).status, 'review');
  assert.equal(chooseMatch({ sku: 'UNKNOWN' }, [], [], 0).status, 'unmatched');
  if (!process.argv.includes('--sql')) { console.log('PASS Walmart SKU-first/UPC fallback identity decisions'); return; }
  // Local PostgreSQL only. All fixtures are connection-local TEMP tables, removed on disconnect.
  const db = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', database: 'postgres' }); await db.connect();
  const pool = { connect: async () => ({ query: (...args) => db.query(...args), release() {} }) };
  try {
    await db.query('create temp table products(product_id text primary key, sku text unique, barcode text, uom_qty numeric, raw jsonb, updated_at timestamptz)');
    const reset = async () => { await db.query('truncate products'); await db.query(`insert into products values('p','LOCAL','036000291452',1,$1,now())`, [JSON.stringify({ qty: 17, price: 20, ebayListing: { id: 'keep' }, upc: local.upc })]); };
    const context = { environment: 'production', credentialKey: 'credential-v1', channelId: 'c', actor: 'u', identifierCount: 1, sellerSkus: new Set(), check: async () => {} };
    const remote = { sku: 'REMOTE', upc: local.upc, itemId: '123', publishedStatus: 'PUBLISHED' };
    await reset(); await db.query("update products set barcode='36000291452',raw=raw-'upc' where product_id='p'");
    assert.equal((await reconcileItem(pool, remote, context)).basis, 'upc', 'find local records whose UPC lost its leading zero');
    await reset();
    let result = await reconcileItem(pool, remote, context); assert.equal(result.basis, 'upc'); assert.equal(result.catalogSku, 'LOCAL');
    const saved = (await db.query('select raw from products')).rows[0].raw;
    assert.equal(saved.qty, 17); assert.equal(saved.price, 20); assert.equal(saved.ebayListing.id, 'keep'); assert.equal(saved.walmartListing.sku, 'REMOTE');
    const imported = await resolveOrderLinks(db, { items: [{ sku: 'REMOTE', sourceLineId: '7', cost: null }], shipments: [{ lines: [{ lineIndex: 0, sku: 'REMOTE' }] }] }, context);
    assert.equal(imported.items[0].sku, 'LOCAL'); assert.equal(imported.items[0].walmartSellerSku, 'REMOTE'); assert.equal(imported.items[0].sourceLineId, '7'); assert.equal(imported.items[0].cost, null); assert.equal(imported.shipments[0].lines[0].sku, 'LOCAL');
    await reconcileItem(pool, remote, context); assert.equal((await db.query('select raw from products')).rows[0].raw.walmartListing.linkedAt, saved.walmartListing.linkedAt);
    assert.equal((await reconcileItem(pool, { ...remote, sku: 'OTHER' }, context)).status, 'review');
    assert.equal((await reconcileItem(pool, remote, { ...context, credentialKey: 'different' })).status, 'review');
    await reset(); assert.equal((await reconcileItem(pool, remote, { ...context, sellerSkus: new Set(['LOCAL']) })).status, 'review');
    await reset(); assert.equal((await reconcileItem(pool, { ...remote, sku: 'LOCAL' }, { ...context, identifierCount: 2 })).basis, 'sku');
    await reset(); await db.query(`insert into products values('p2','OTHER','036000291452',1,'{}',now())`);
    assert.equal((await reconcileItem(pool, remote, context)).status, 'review');
    await reset(); await assert.rejects(reconcileItem(pool, remote, { ...context, check: async () => { throw new Error('stopped'); } }), /stopped/);
    assert.equal((await db.query('select raw from products')).rows[0].raw.walmartListing, undefined);
    await reset();
    const documents = new Map(), artifacts = []; let call = 0;
    const run = { pool, job: { id: 'fixture', workerPayload: context }, write: async (key, value) => documents.set(key, structuredClone(value)), read: async key => documents.get(key), check: async () => {}, persist: async () => {}, record: row => artifacts.push(row), client: { request: async () => (++call === 1 ? { ItemResponse: [remote], nextCursor: 'same' } : call === 2 ? { ItemResponse: [{ sku: 'LOCAL', upc: local.upc, itemId: '456' }], nextCursor: 'same' } : { ItemResponse: [] }) } };
    await runReconciliation(run);
    assert.equal(artifacts.find(row => row.sellerSku === 'REMOTE').status, 'review', 'reserve exact SKU across later pages');
    assert.equal(artifacts.find(row => row.sellerSku === 'LOCAL').basis, 'sku');
    await reset(); call = 0;
    await assert.rejects(runReconciliation({ ...run, client: { request: async () => ({ ItemResponse: [remote], nextCursor: 'repeat' }) } }), /repeated/);
    assert.equal((await db.query('select raw from products')).rows[0].raw.walmartListing, undefined);
    await assert.rejects(runReconciliation({ ...run, client: { request: async () => ({ ItemResponse: [remote], totalItems: 20 }) } }), /before all/);
    console.log('PASS local TEMP-table Walmart reconciliation: SKU priority across pages, UPC fallback, conflicts, idempotency, rollback, pagination, and unrelated-data preservation');
  } finally { await db.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
