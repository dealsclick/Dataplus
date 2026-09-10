const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Client } = require('pg');

async function main() {
  const { boundedCatalogCount } = require('../lib/catalog-count');
  for (const fail of [false, true]) {
    const calls = []; let released = false;
    const pool = { connect: async () => ({ query: async sql => {
      calls.push(sql);
      if (sql === 'count') { if (fail) throw Object.assign(new Error('timeout'), { code: '57014' }); return { rows: [{ total: 4 }] }; }
      return { rows: [] };
    }, release: () => { released = true; } }) };
    const result = await boundedCatalogCount(pool, 'count', []);
    assert.equal(released, true);
    assert(calls.includes(fail ? 'rollback' : 'commit'));
    assert.equal(result.timedOut === true, fail);
  }
  const client = new Client({ host: '127.0.0.1', user: 'postgres', database: 'postgres', port: 5432 });
  await client.connect();
  const source = fs.readFileSync(path.join(__dirname, '../db.js'), 'utf8');
  const queries = [];
  const context = {
    process, getPool: () => ({ query: (sql, args) => { queries.push(sql); return client.query(sql, args); } }),
    initRelationalSchema: async () => {}, nullableString: value => value == null ? null : String(value).trim() || null,
    splitFilterValues: value => (Array.isArray(value) ? value : String(value || '').split('|')).filter(Boolean),
    parseFilterBoolean: value => ['true', '1'].includes(String(value)), productRowToState: row => row,
    hydrateProductsWithShopifyStatuses: async rows => rows, hydrateProductsWithVendorOffers: async rows => rows,
    hydrateProductsWithInventoryLevels: async rows => rows
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('async function listProducts('), source.indexOf('async function inventoryReportingSummary(')), context);
  try {
    await client.query('begin');
    await client.query('create schema catalog_query_fixture');
    await client.query('set local search_path to catalog_query_fixture');
    await client.query(`create table products(product_id text primary key,sku text,title text,marketplace_title text,brand text,
      manufacturer text,mfr_part_number text,vendor_sku text,barcode text,category text,main_category text,source_category text,
      supplier text,supplier_code text,active boolean,to_be_discontinued boolean,uom text,uom_qty numeric,cost numeric,price numeric,
      qty numeric,default_image text,raw jsonb,created_at timestamptz,updated_at timestamptz);
      create table category_channel_mappings(channel text,category_name text,channel_category_id text,status text);`);
    const ready = { createdSource: 'Internal universal datadump', images: ['https://example.com/image.jpg'], ebayListing: { categoryId: '1', merchantLocationKey: 'loc', paymentPolicyId: 'pay', returnPolicyId: 'return', fulfillmentPolicyId: 'ship' } };
    for (const [id, raw, date] of [['A', ready, '2026-09-08T23:59:59Z'], ['B', { ...ready, ebayListing: { offerId: 'offer' } }, '2026-09-08'], ['C', { ebayListing: { listingId: 'live' } }, '2026-09-09'], ['D', {}, '2026-09-07']]) {
      await client.query(`insert into products(product_id,sku,title,price,qty,raw,created_at) values($1,$1,'same',10,5,$2,$3)`, [id, JSON.stringify(raw), date]);
    }
    await client.query(fs.readFileSync(path.join(__dirname, 'catalog-filter-indexes.sql'), 'utf8').replaceAll('CONCURRENTLY ', ''));
    const run = filters => context.listProducts({ fastPage: true, includeTotal: true, limit: 1, filters });
    const missing = await run({ channelStatus: 'ebay-missing' });
    assert.equal(missing.total, 2); assert.equal(missing.inventory[0].sku, 'A'); assert.equal(missing.hasMore, true);
    const offer = await run({ channelStatus: 'ebay-offer' });
    assert.equal(offer.total, 1); assert.equal(offer.inventory[0].sku, 'B');
    const readyRows = await run({ channelStatus: 'ebay-offer|ebay-ready' });
    assert.equal(readyRows.total, 2);
    const dated = await run({ createdFrom: '2026-09-08', createdTo: '2026-09-08', creationSource: 'internal universal datadump' });
    assert.equal(dated.total, 2);
    const page2 = await context.listProducts({ fastPage: true, limit: 1, page: 2, sort: 'title', filters: { channelStatus: 'ebay-missing' } });
    assert.equal(page2.inventory[0].sku, 'D'); assert.equal(page2.hasMore, false);
    assert(queries.some(sql => /with catalog_page as materialized/.test(sql)));
    assert.equal(missing.inventory[0].raw.images, undefined);
    assert.equal(missing.inventory[0].default_image, '__dataplus_catalog_image__');
    console.log('Catalog query tests passed: exact counts, eBay filters, inclusive creation dates, stable pagination and image projection.');
  } finally { await client.query('rollback'); await client.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
