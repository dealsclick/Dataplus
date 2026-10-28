const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('server.js', 'utf8');
const databaseSource = fs.readFileSync('db.js', 'utf8');
const warehouseRouteSource = fs.readFileSync('web/src/components/warehouse-route.tsx', 'utf8');

const context = {
  crypto,
  Date,
  Error,
  Map,
  Math,
  Number,
  Set,
  String,
  postgres: {
    readProductByKey: async () => null,
  },
};
vm.createContext(context);
vm.runInContext(
  source.slice(
    source.indexOf('function normalizeShadowSku('),
    source.indexOf('function normalizeProductAlias('),
  ),
  context,
);
vm.runInContext(
  source.slice(
    source.indexOf('function ebayShadowListingSeed('),
    source.indexOf('function auditExpectedQuantity('),
  ),
  context,
);

async function main() {
  assert.equal(context.normalizedWarehouseShadowCode({ name: 'Staten Island' }), 'SI');
  assert.equal(context.normalizedWarehouseShadowCode({ name: 'Staten Island 2' }), 'SI2');
  assert.equal(context.normalizedWarehouseShadowCode({ name: 'Buy Supply Warehouse' }), 'BS');
  assert.equal(context.normalizedWarehouseShadowCode({ code: ' si-02 ' }), 'SI02');

  const longSku = context.warehouseShadowSku('A'.repeat(80), { name: 'Staten Island 2' });
  assert.equal(longSku.length, 50);
  assert.match(longSku, /-SI2$/);

  const product = {
    id: 'product-1',
    sku: '123',
    title: 'Clearance product',
    price: 19.99,
    aliases: [{ aliasSku: 'OLD-123', type: 'direct' }],
    shadowSkus: [],
    ebayListing: {
      categoryId: '12345',
      settings: { useChannelDefaults: true },
    },
  };
  const audit = { id: 'audit-1' };
  const warehouse = { id: 'warehouse-si', name: 'Staten Island', code: 'SI' };
  const first = await context.ensureWarehouseAuditShadows(audit, warehouse, [product]);

  assert.equal(first.created.length, 1);
  assert.equal(first.reused.length, 0);
  assert.equal(product.shadowSkus.length, 1);
  assert.equal(product.shadowSkus[0].shadowSku, '123-SI');
  assert.equal(product.shadowSkus[0].kind, 'warehouse_clearance');
  assert.equal(product.shadowSkus[0].inventoryPolicy, 'Warehouse only');
  assert.equal(product.shadowSkus[0].warehouseId, 'warehouse-si');
  assert.deepEqual(Array.from(product.shadowSkus[0].channels), ['eBay']);
  assert.equal(product.shadowSkus[0].channelListings.ebay.categoryId, '12345');
  assert.equal(product.aliases.length, 1, 'warehouse shadows must not create catalog aliases');

  const second = await context.ensureWarehouseAuditShadows({ id: 'audit-2' }, warehouse, [product]);
  assert.equal(second.created.length, 0);
  assert.equal(second.reused.length, 1);
  assert.equal(product.shadowSkus.length, 1, 'a later audit must reuse the warehouse shadow');
  assert.deepEqual(Array.from(product.shadowSkus[0].sourceAuditIds), ['audit-1', 'audit-2']);

  const workerSource = source.slice(
    source.indexOf('async function runEbayListingLaunchWorkerJob('),
    source.indexOf('async function ebayBulkUpdatePriceQuantity('),
  );
  assert.match(workerSource, /warehouseRows\.reduce[\s\S]*Number\(row\.qty[\s\S]*Number\(row\.reserved/, 'shadow launch quantity must come from its assigned warehouse');
  assert.match(workerSource, /shadow\.channelListings\.ebay/, 'eBay listing identity must be persisted on the shadow');
  assert.match(source, /shadowWarehouseId/, 'imported shadow orders must retain their assigned warehouse');
  assert.match(source, /warehouse_shadow_inventory_shortage/, 'shadow orders must stop instead of falling back to supplier stock');
  assert.match(databaseSource, /jsonb_array_elements[\s\S]*shadowSkus[\s\S]*marketplaceSku/, 'PostgreSQL must resolve shadows without catalog aliases');
  const orderShadowSource = source.slice(
    source.indexOf('function createShadowSkuFromOrderLine('),
    source.indexOf('function createInventoryFromOrderLine('),
  );
  assert.doesNotMatch(orderShadowSource, /addProductAlias/, 'order-created shadows must remain separate from aliases');
  const aliasBackfillSource = source.slice(
    source.indexOf('function backfillAliasesFromMappedOrders('),
    source.indexOf('function normalizeChannel('),
  );
  assert.match(aliasBackfillSource, /line\.shadowId \|\| line\.shadowSku/, 'mapped shadow order lines must be excluded from alias backfill');
  assert.doesNotMatch(aliasBackfillSource, /type: [^\n]*shadow/, 'alias backfill must not classify identifiers as shadows');
  const shadowApiSource = source.slice(
    source.indexOf('if (req.method === "POST" && parts[0] === "api" && parts[1] === "inventory" && parts[2] && parts[3] === "shadows" && parts.length === 4'),
    source.indexOf('if (req.method === "POST" && parts[0] === "api" && parts[1] === "inventory" && parts[2] && parts[3] === "shadows" && parts[4]'),
  );
  assert.doesNotMatch(shadowApiSource, /addProductAlias/, 'manually created shadows must remain separate from aliases');
  assert.match(warehouseRouteSource, /ebay_one_time_listing/, 'warehouse audits must expose the one-time eBay listing reason');
  assert.match(warehouseRouteSource, /Stock here and create shadows/, 'the completion flow must describe shadow creation');

  console.log('Warehouse marketplace shadows are reusable, warehouse-bound, and separate from aliases.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
