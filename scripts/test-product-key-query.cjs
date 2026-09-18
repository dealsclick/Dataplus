const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Client } = require('pg');

async function main() {
  // Isolated temporary tables on local PostgreSQL only; never production fixtures.
  const client = new Client({ host: '127.0.0.1', user: 'postgres', database: 'postgres', port: 5432 });
  await client.connect();
  const source = fs.readFileSync(path.join(__dirname, '../db.js'), 'utf8');
  const context = {
    getPool: () => client, initRelationalSchema: async () => {},
    nullableString: value => value == null ? null : String(value).trim() || null,
    productRowToState: row => ({ id: row.product_id, sku: row.sku }),
    aliasRowToState: row => row, hydrateProductsWithVendorOffers: async rows => rows
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('async function readProductsByKeys('), source.indexOf('async function readProductsByEbayListingKeys(')), context);
  try {
    await client.query('begin');
    await client.query(`create temporary table products(product_id text, sku text, raw jsonb) on commit drop;
      create temporary table product_aliases(product_id text, alias_sku text, active boolean) on commit drop;
      insert into products values ('p1','SKU1','{"shopifyId":"gid://shopify/Product/123"}');
      insert into product_aliases values ('p1','ALIAS1',true),('p1','OLD',false);`);
    for (const includeMarketplaceIds of [false, true, undefined]) {
      for (const key of ['p1', 'SKU1', 'alias1']) {
        const rows = await context.readProductsByKeys([key], { includeMarketplaceIds });
        assert.equal(rows.length, 1);
        assert.equal(rows[0].id, 'p1');
      }
      assert.equal((await context.readProductsByKeys(['missing'], { includeMarketplaceIds })).length, 0);
      assert.equal((await context.readProductsByKeys(['OLD'], { includeMarketplaceIds })).length, 0);
      assert.equal((await context.readProductsByKeys(['123'], { includeMarketplaceIds })).length, includeMarketplaceIds === false ? 0 : 1);
    }
    console.log('Product key query tests passed: exact IDs, SKUs, aliases and optional marketplace IDs.');
  } finally {
    await client.query('rollback');
    await client.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
