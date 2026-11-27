const assert = require('node:assert/strict');

const {
  TEMPLATE_ROWS,
  buildTikTokLiveAuctionCsv,
  dimensionInCentimeters,
  weightInGrams
} = require('../lib/tiktok-live-auction-csv');

assert.equal(TEMPLATE_ROWS.length, 5);
assert.equal(TEMPLATE_ROWS[0][0], 'Product name');
assert.equal(TEMPLATE_ROWS[4][0], 'product_name');
assert.equal(TEMPLATE_ROWS[4][14], '__product_batch_required_properties=[104355]');
assert.equal(weightInGrams({ packageWeight: 2 }), 908);
assert.equal(weightInGrams({ packageWeight: 500, packageWeightUnit: 'g' }), 500);
assert.equal(dimensionInCentimeters(10), 26);
assert.equal(dimensionInCentimeters(250, 'mm'), 25);

const result = buildTikTokLiveAuctionCsv({
  session: { id: 'session-1', sessionNumber: 'LS-101' },
  items: [
    { id: 'item-1', productId: 'product-1', sku: 'BUS-1', title: 'Catalog title', launchTitle: 'Reviewed title', remainingQty: 2, salePrice: 1 },
    { id: 'item-2', productId: 'product-1', sku: 'BUS-1', title: 'Catalog title', remainingQty: 3, salePrice: 3.1 },
    { id: 'item-3', productId: 'product-2', sku: 'BUS-2', title: 'Missing package data', remainingQty: 1, salePrice: 1 }
  ],
  products: [
    {
      id: 'product-1', sku: 'BUS-1', packageWeight: 2, packageLength: 10, packageWidth: 5, packageHeight: 4,
      defaultImage: 'https://example.com/product.jpg', tiktokWarehouseId: 'warehouse-1',
      tiktokCategory: { categoryId: 'category-1', categoryPath: ['Tools & Hardware', 'Hand Tools'] }
    },
    { id: 'product-2', sku: 'BUS-2', packageWeight: 0 }
  ],
  warehouses: [{ id: 'warehouse-1', name: 'U.S Pickup Warehouse' }]
});

assert.equal(result.productCount, 1);
assert.equal(result.skippedCount, 1);
assert.equal(result.rows[0][0], 'Reviewed title');
assert.equal(result.rows[0][1], 'Tools & Hardware - Hand Tools (ID: category-1)');
assert.equal(result.rows[0][3], 'U.S Pickup Warehouse (ID: warehouse-1)');
assert.equal(result.rows[0][4], '5');
assert.equal(result.rows[0][5], '908');
assert.equal(result.rows[0][6], '11');
assert.equal(result.rows[0][7], '13');
assert.equal(result.rows[0][8], '26');
assert.equal(result.rows[0][9], '4');
assert.match(result.csv, /"product_name","category","compliance_prop_104355"/);
assert.match(result.csv, /"Reviewed title","Tools & Hardware - Hand Tools \(ID: category-1\)"/);
assert.deepEqual(result.rejected[0], {
  sku: 'BUS-2',
  issues: ['package weight is missing', 'complete package dimensions are missing']
});

console.log('TikTok LIVE auction CSV tests passed.');
