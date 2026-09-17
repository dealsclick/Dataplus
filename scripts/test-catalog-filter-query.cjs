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
      create table walmart_documents(doc_key text primary key,data jsonb,updated_at timestamptz);
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
    await client.query("insert into walmart_documents values('walmart.mapping.test', '{\"category\":\"Tools\",\"productType\":\"Hammers\"}',now())");
    const walmartBase = { upc:'71485109977', packageWeight:1, images:['https://example.com/item.jpg'] };
    const fixture = [
      ['WM-READY',walmartBase,true],
      ['WM-BADUPC',{...walmartBase,upc:'71485109978'},true],
      ['WM-INACTIVE',walmartBase,false],
      ['WM-LIVE',{walmartListing:{sku:'seller-live',publishedStatus:'PUBLISHED'}},true],
      ['WM-RETIRED',{walmartListing:{sku:'seller-retired',publishedStatus:'PUBLISHED',lifecycleStatus:'RETIRED'}},true],
      ['WM-SUBMITTED',{walmartListing:{sku:'seller-pending',feedId:'feed',ingestionStatus:'SUCCESS'}},true],
      ['WM-ERROR',{walmartListing:{sku:'seller-error',feedId:'feed',ingestionStatus:'DATA_ERROR'}},true],
      ['WM-NULL',null,true]
    ];
    for (const [id,raw,active] of fixture) await client.query("insert into products(product_id,sku,title,price,category,active,raw) values($1,$1,'Walmart item',10,'Tools',$2,$3)",[id,active,raw]);
    const wm = async value => (await context.listProducts({fastPage:true,includeTotal:true,limit:100,filters:{channelStatus:value}}));
    assert.equal((await wm('walmart-live')).total,1);
    assert.equal((await wm('walmart-live')).inventory[0].sku,'WM-LIVE');
    assert.equal((await wm('walmart-detected')).total,4);
    assert.equal((await wm('walmart-not-live')).total,3);
    assert.equal((await wm('walmart-submitted')).total,1,'ingestion success is not live publication');
    assert.equal((await wm('walmart-error')).total,1);
    assert.equal((await wm('walmart-ready')).total,1);
    assert.equal((await wm('walmart-ready')).inventory[0].sku,'WM-READY','valid missing-zero UPC is eligible');
    assert.equal((await wm('walmart-not-ready')).total,7,'invalid UPC, inactive and missing fields are incomplete');
    assert.equal((await wm('walmart-missing')).total,8);
    assert.equal((await wm('walmart-live|walmart-error')).total,2);
    assert.equal((await context.listProducts({fastPage:true,includeTotal:true,limit:1,filters:{channelStatusAll:'walmart-detected|walmart-not-live'}})).total,3);
    await client.query("update products set updated_at=now()-interval '1 minute' where sku like 'WM-%'");
    await client.query("insert into walmart_documents values ('walmart.readiness.WM-READY', $1, now())", [JSON.stringify({existingOffer:{status:'ready'},newItem:{status:'blocked'}})]);
    assert.equal((await wm('walmart-offer-ready')).total,1);
    assert.equal((await wm('walmart-new-ready')).total,0);
    assert.equal((await wm('walmart-new-blocked')).total,1);
    assert.equal((await wm('walmart-offer-ready|walmart-new-blocked')).total,1);
    await client.query("update products set updated_at=now()+interval '1 minute' where sku='WM-READY'");
    assert.equal((await wm('walmart-offer-ready')).total,0,'edited products require a recheck');
    await client.query("update products set updated_at=now()-interval '2 days' where sku='WM-READY'");
    await client.query("update walmart_documents set updated_at=now()-interval '25 hours' where doc_key='walmart.readiness.WM-READY'");
    assert.equal((await wm('walmart-offer-ready')).total,0,'old assessments expire');
    console.log('Catalog query tests passed: exact counts, eBay filters, inclusive creation dates, stable pagination and image projection.');
  } finally { await client.query('rollback'); await client.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
