const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Client } = require('pg');

async function main() {
  const { boundedCatalogCount, catalogCountTimeoutMs } = require('../lib/catalog-count');
  const three = { supplier: 'True Value', channelStatus: 'ebay-ready', hasStock: true };
  const four = { ...three, hasImage: true };
  const five = { ...four, shippingClass: 'parcel' };
  const six = { ...five, active: false };
  assert.equal(catalogCountTimeoutMs({}), 8000);
  assert.equal(catalogCountTimeoutMs(three), 8000);
  assert.equal(catalogCountTimeoutMs(four), 20000);
  assert.equal(catalogCountTimeoutMs(five), 20000);
  assert.equal(catalogCountTimeoutMs(six), 30000);
  assert.equal(catalogCountTimeoutMs({ ...three, hasImage: '', active: [], shippingClass: ' | ' }), 8000);
  assert.equal(catalogCountTimeoutMs({ ...three, includedSuppliers: ['a','b'], shippingRules: {}, unknown: 'x' }), 8000);
  assert.equal(catalogCountTimeoutMs({ ...three, channelStatusAll: 'ebay-missing' }), 8000);
  assert.equal(catalogCountTimeoutMs({ ...three, createdFrom: '2026-09-01', createdTo: '2026-09-18' }), 20000);
  assert.equal(catalogCountTimeoutMs({ ...three, stockQty: 0 }), 20000);
  for (const fail of [false, true]) {
    const calls = []; let released = false;
    const pool = { connect: async () => ({ query: async sql => {
      calls.push(sql);
      if (sql === 'count') { if (fail) throw Object.assign(new Error('timeout'), { code: '57014' }); return { rows: [{ total: 4 }] }; }
      return { rows: [] };
    }, release: () => { released = true; } }) };
    const result = await boundedCatalogCount(pool, 'count', [], { preferBitmap: true });
    assert(calls.includes('set local enable_indexscan = off'));
    assert.equal(released, true);
    assert(calls.includes(fail ? 'rollback' : 'commit'));
    assert.equal(result.timedOut === true, fail);
  }
  for (const filters of [three, four, five, six]) {
    const calls = [];
    let released = false;
    const pool = { connect: async () => ({ query: async sql => {
      calls.push(sql);
      if (sql === 'count') return { rows: [{ total: 100 }] };
      return { rows: [] };
    }, release: () => { released = true; } }) };
    await boundedCatalogCount(pool, 'count', [], { filters });
    assert(calls.includes(`set local statement_timeout = '${catalogCountTimeoutMs(filters)}ms'`));
    assert(calls.includes('commit'));
    assert(released);
  }
  const client = new Client({ host: '127.0.0.1', user: 'postgres', database: 'postgres', port: 5432 });
  await client.connect();
  const source = fs.readFileSync(path.join(__dirname, '../db.js'), 'utf8');
  const queries = [];
  const context = {
    readStateField: async () => ({}),
    shippingClassSql: require('../lib/shipping-filter-sql').shippingClassSql,
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
      create table vendors(name text, code text);
      create table category_channel_mappings(channel text,category_name text,channel_category_id text,status text);`);
    await client.query(require('../lib/shipping-filter-sql').shippingFunctionSql());
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
    const scoped = await context.listProducts({ fastPage: true, includeTotal: true, limit: 100, productIds: ['B'], filters: { channelStatus: 'ebay-ready' } });
    assert.equal(scoped.total, 0, 'selected IDs must not expand to other matching catalog products');
    await client.query("update products set active=false where product_id='A'");
    assert.equal((await run({ channelStatus: 'ebay-ready' })).total, 0);
    await client.query("update products set active=true,raw=raw || '{\"packageLength\":120,\"packageWidth\":2,\"packageHeight\":2,\"packageWeight\":20}'::jsonb where product_id='A'");
    assert.equal((await run({ channelStatus: 'ebay-ready' })).total, 0, 'LTL is not a launch candidate when blocked');
    await client.query("update products set raw=$1 where product_id='A'", [JSON.stringify(ready)]);
    const dated = await run({ createdFrom: '2026-09-08', createdTo: '2026-09-08', creationSource: 'internal universal datadump' });
    assert.equal(dated.total, 2);
    const page2 = await context.listProducts({ fastPage: true, limit: 1, page: 2, sort: 'title', filters: { channelStatus: 'ebay-missing' } });
    assert.equal(page2.inventory[0].sku, 'D'); assert.equal(page2.hasMore, false);
    assert(queries.some(sql => /with catalog_page as materialized/.test(sql)));
    assert.equal(missing.inventory[0].raw.images, undefined);
    assert.equal(missing.inventory[0].default_image, '__dataplus_catalog_image__');
    const { classifyShipping } = require('../lib/shipping-classification');
    const { shippingClassSql } = require('../lib/shipping-filter-sql');
    const box = { packageLength: 10, packageWidth: 10, packageHeight: 10, packageWeight: 10 };
    const cases = [box, {}, { ...box, shippingClass: 'ltl' }, { ...box, packageWeight: 150 },
      { ...box, packageWeight: 151 }, { ...box, packageLength: 108, packageWidth: 10, packageHeight: 10 },
      { ...box, packageLength: 109 }, { ...box, packageLength: 65, packageWidth: 25, packageHeight: 25 },
      { ...box, packageLength: 66, packageWidth: 25, packageHeight: 25 },
      { ...box, shippingClassOverride: 'ltl' }, { ...box, shipMode: ['parcel', 'freight'] },
      { ...box, supplierFreightRequired: true }, { ...box, shippingClassOverride: 'parcel', packageWeight: 151 },
      { packageLength: 10, itemLength: 10, itemWidth: 10, itemHeight: 10, itemWeight: 2 },
      { original: { item_length: '5', item_width: '6', item_height: '7', item_weight: '1' } },
      { raw: box }, { ...box, packageWeight: 'bad' }, { ...box, shipMode: 'not freight' }];
    for (const rules of [{}, { shippingParcelMaxWeight: 5 }, { shippingHonorSupplierFreight: false }]) {
      for (const item of cases) {
        const result = await client.query(`select ${shippingClassSql('$1::jsonb', rules)} as value`, [JSON.stringify(item)]);
        assert.equal(result.rows[0].value, classifyShipping(item, rules).shippingClass, JSON.stringify({ item, rules }));
      }
    }
    await client.query("update products set raw = raw || $1::jsonb where sku = 'A'", [JSON.stringify(box)]);
    await client.query("update products set raw = raw || $1::jsonb where sku = 'B'", [JSON.stringify({ ...box, packageWeight: 151 })]);
    await client.query(fs.readFileSync(path.join(__dirname, 'catalog-shipping-index.sql'), 'utf8').replaceAll('CONCURRENTLY ', ''));
    const ground = await run({ shippingClass: 'parcel' });
    assert.equal(ground.total, 1); assert.equal(ground.inventory[0].sku, 'A');
    const freight = await run({ shippingClass: 'ltl' });
    assert.equal(freight.total, 1); assert.equal(freight.inventory[0].sku, 'B');
    const review = await run({ shippingClass: 'missing_measurements' });
    assert.equal(review.total, 2);
    const combined = await run({ shippingClass: 'parcel|ltl' });
    assert.equal(combined.total, 2); assert.equal(combined.hasMore, true);
    const combinedNext = await context.listProducts({ fastPage: true, limit: 1, page: 2, filters: { shippingClass: 'parcel|ltl' } });
    assert.equal(combinedNext.inventory[0].sku, 'B');
    assert.equal((await run({ shippingClass: 'parcel', channelStatus: 'ebay-offer' })).total, 0);
    assert.equal((await run({ shippingClass: 'parcel', shippingRules: { shippingParcelMaxWeight: 5 } })).total, 0);
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
    assert.equal((await wm('walmart-launch-ready')).total,1,'existing offer readiness ignores new-item blockers');
    assert.equal((await wm('walmart-launch-blocked')).total,0);
    await client.query("update products set category='Unmapped' where sku='WM-READY'");
    assert.ok(!(await wm('walmart-not-ready')).inventory.some(row=>row.sku==='WM-READY'),'missing local category is not an offer blocker');
    await client.query("update walmart_documents set data=$1 where doc_key='walmart.readiness.WM-READY'", [JSON.stringify({existingOffer:{status:'error'},newItem:{status:'ready'}})]);
    assert.equal((await wm('walmart-launch-ready')).total,0,'failed lookup cannot choose a new-item launch route');
    assert.equal((await wm('walmart-launch-blocked')).total,1);
    await client.query("update walmart_documents set data=$1 where doc_key='walmart.readiness.WM-READY'", [JSON.stringify({existingOffer:{status:'not_found'},newItem:{status:'ready'}})]);
    assert.equal((await wm('walmart-launch-ready')).total,1,'new item is eligible when offer lookup found no match');
    await client.query("update walmart_documents set data=$1 where doc_key='walmart.readiness.WM-READY'", [JSON.stringify({existingOffer:{status:'ready'},newItem:{status:'blocked'}})]);

    assert.equal((await wm('walmart-new-ready')).total,0);
    assert.equal((await wm('walmart-new-blocked')).total,1);
    assert.equal((await wm('walmart-offer-ready|walmart-new-blocked')).total,1);
    await client.query("update products set updated_at=now()+interval '1 minute' where sku='WM-READY'");
    assert.equal((await wm('walmart-offer-ready')).total,0,'edited products require a recheck');
    await client.query("update products set updated_at=now()-interval '2 days' where sku='WM-READY'");
    await client.query("update walmart_documents set updated_at=now()-interval '25 hours' where doc_key='walmart.readiness.WM-READY'");
    assert.equal((await wm('walmart-offer-ready')).total,0,'old assessments expire');
    await client.query("insert into vendors values ('D&H', 'DH'), ('Other alias','DH'), ('Uncoded',null)");
    await client.query("update products set supplier='D&H',supplier_code='DH' where sku='A'");
    await client.query("update products set supplier='Feed label',supplier_code='DH' where sku='B'");
    await client.query("update products set supplier='Uncoded',supplier_code=null where sku='C'");
    assert.equal((await run({ supplier: 'd&h' })).total, 2);
    assert.equal((await run({ supplier: 'DH' })).total, 2);
    assert.equal((await run({ supplier: 'Other alias', shippingClass: 'parcel' })).total, 1);
    assert.equal((await run({ supplier: 'd&h', shippingClass: 'ltl', channelStatus: 'ebay-offer' })).total, 1);
    assert.equal((await run({ supplier: 'd&h|Uncoded' })).total, 3);
    assert.equal((await run({ supplier: 'unknown' })).total, 0);
    assert.equal((await run({ supplier: 'Uncoded' })).total, 1);
    console.log('Catalog query tests passed: exact counts, eBay filters, inclusive creation dates, stable pagination and image projection.');
  } finally { await client.query('rollback'); await client.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
