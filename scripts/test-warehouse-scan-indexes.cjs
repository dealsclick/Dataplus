const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Client } = require('pg');

// Local PostgreSQL only. All fixtures and indexes live in temporary tables,
// and are rolled back; never point this test at production.
async function main() {
  const client = new Client({ host: '127.0.0.1', user: 'postgres', database: 'postgres', port: 5432 });
  await client.connect();
  try {
    await client.query('begin');
    await client.query("set local statement_timeout = '15s'");
    await client.query("create temp table products (barcode text, raw jsonb default '{}', updated_at timestamptz default now()) on commit drop");
    await client.query('create temp table vendor_catalog_items (like products including defaults) on commit drop');
    await client.query("insert into products (barcode) select 'unrelated-' || n from generate_series(1,10000) n");
    await client.query("insert into products (barcode,raw) values ('X0039-W0Z71','{}'), ('012345678901','{}'), ('raw-upc','{\"upc\":\"UPC-A 12\"}'), ('raw-gtin','{\"gtin\":\"GTIN-B 34\"}'), ('raw-code','{\"upcCode\":\"CODE-C 56\"}')");
    await client.query("insert into vendor_catalog_items (barcode) values ('sourceonly')");
    const indexSql = fs.readFileSync(path.join(__dirname, 'warehouse-scan-indexes.sql'), 'utf8').replaceAll('CONCURRENTLY ', '');
    await client.query(indexSql);
    await client.query('analyze products');
    const source = fs.readFileSync(path.join(__dirname, '../db.js'), 'utf8');
    const start = source.indexOf('async function findBarcodeMatches(');
    const end = source.indexOf('\nasync function ', start + 1);
    const queries = [];
    const find = vm.runInNewContext(`(${source.slice(start, end)})`, {
      getPool: () => ({ query: (sql, values) => { queries.push({ sql, values }); return client.query(sql, values); } }),
      initRelationalSchema: async () => {}, productRowToState: row => row, vendorCatalogRowToState: row => row,
    });
    for (const [scan, expected] of [['x0039w0z71','X0039-W0Z71'],['012345678901','012345678901'],['upca12','raw-upc'],['gtinb34','raw-gtin'],['codec56','raw-code']]) {
      const result = await find([scan]);
      assert.equal(result.products[0]?.barcode, expected, `Must retain matching for ${scan}`);
    }
    assert.equal((await find(['source-only'])).sourceItems[0]?.barcode, 'sourceonly');
    queries.length = 0;
    const unknown = await find(['x0039woz71']); // Letter O is not digit 0.
    assert.equal(unknown.products.length, 0);
    assert.equal(unknown.sourceItems.length, 0);
    const normalized = queries.find(query => query.sql.includes('regexp_replace'));
    const plan = (await client.query('explain (format json) ' + normalized.sql, normalized.values)).rows[0]['QUERY PLAN'];
    const planText = JSON.stringify(plan);
    for (const field of ['barcode','upc','gtin','upc_code']) assert.ok(planText.includes(`products_scan_${field}_normalized_idx`), `Missing indexed ${field} branch`);
    assert.ok(!planText.includes('Seq Scan'), 'Unknown barcode must not sequentially scan products');
    console.log('Warehouse scans: exact, normalized, source-only, unknown, O/0 distinction, and all four indexed branches passed.');
  } finally {
    await client.query('rollback').catch(() => {});
    await client.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
