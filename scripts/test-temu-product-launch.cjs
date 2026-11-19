const assert = require('node:assert/strict');
const {
  addProductPayload,
  launchFingerprint,
  launchResult,
  listingForAccount,
  productLaunchReadiness
} = require('../lib/temu-products');

const product = {
  id: 'product-1',
  sku: 'BUS123TRV',
  title: 'Cordless tool kit',
  longDescription: 'A complete cordless tool kit for home and professional work.',
  bulletPoints: ['Includes two batteries', 'Durable carrying case'],
  defaultImage: 'https://cdn.example.com/one.jpg',
  images: ['https://cdn.example.com/two.jpg', { url: 'https://cdn.example.com/three.jpg' }],
  physicalAvailable: 7,
  websitePrice: 49.99,
  msrp: 69.99,
  packageLength: 18,
  packageWidth: 12,
  packageHeight: 8,
  packageWeight: 9.5,
  barcode: '012345678905',
  brand: 'Example',
  active: true
};
const shopOne = { id: 'mall-1', mallId: 'mall-1', mallName: 'Island Supply', configured: true, accessToken: 'token-1', apiScopeList: ['Product Management'] };
const shopTwo = { id: 'mall-2', mallId: 'mall-2', mallName: 'DealsClick', configured: true, accessToken: 'token-2' };

const readiness = productLaunchReadiness(product, shopOne);
assert.equal(readiness.ready, true);
assert.equal(readiness.draft.accountId, 'mall-1');
assert.equal(readiness.draft.merchantSku, 'BUS123TRV');
assert.equal(readiness.draft.images.length, 3);

const built = addProductPayload(product, shopOne);
assert.equal(built.payload.version, 'V3');
assert.equal(built.payload.goodsBasic.goodsName, product.title);
assert.equal(built.payload.skuList[0].externalSkuId, product.sku);
assert.equal(built.payload.skuList[0].quantity, 7);
assert.equal(built.payload.skuList[0].price.basePrice.amount, '49.99');
assert.equal(built.payload.skuList[0].barCode.barCodeId[0], product.barcode);
assert.notEqual(launchFingerprint(product, shopOne), launchFingerprint(product, shopTwo));

const separateListings = {
  ...product,
  temuListing: { accountId: 'mall-1', goodsId: 'legacy-one' },
  temuListings: {
    'mall-1': { accountId: 'mall-1', goodsId: 'goods-one', merchantSku: 'ONE' },
    'mall-2': { accountId: 'mall-2', goodsId: 'goods-two', merchantSku: 'TWO' }
  }
};
assert.equal(listingForAccount(separateListings, 'mall-1').goodsId, 'goods-one');
assert.equal(listingForAccount(separateListings, 'mall-2').goodsId, 'goods-two');
assert.equal(productLaunchReadiness(separateListings, shopOne).ready, false);
assert.match(productLaunchReadiness(separateListings, shopOne).blockers.map(issue => issue.message).join(' '), /already linked/i);

const uncertainListing = {
  ...product,
  temuListings: {
    'mall-1': { accountId: 'mall-1', status: 'verification_required' }
  }
};
assert.equal(productLaunchReadiness(uncertainListing, shopOne).ready, false);
assert.match(productLaunchReadiness(uncertainListing, shopOne).blockers.map(issue => issue.message).join(' '), /verify this shop/i);

const incomplete = productLaunchReadiness({ sku: 'DRAFT', title: 'Draft', active: true }, shopOne);
assert.equal(incomplete.ready, false);
assert.deepEqual(new Set(incomplete.blockers.map(issue => issue.code)), new Set(['description_missing', 'price_missing', 'list_price_invalid', 'inventory_missing', 'images_missing', 'package_missing']));

assert.deepEqual(launchResult({ success: true, result: { goodsId: 123, externalGoodsId: 'BUS123TRV' } }), {
  success: true,
  goodsId: '123',
  externalGoodsId: 'BUS123TRV',
  errorCode: 0,
  errorMessage: ''
});
assert.equal(launchResult({ success: false, errorCode: 150010090, errorMsg: 'SKU duplicated' }).success, false);

console.log('Temu product launch tests passed.');
