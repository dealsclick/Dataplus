const assert = require('node:assert/strict');
const { catalogSearchInput, selectExactCatalogProduct } = require('../lib/ebay-catalog-match');

assert.deepEqual(catalogSearchInput({}, { identifierType: 'UPC', identifierValue: '012345678905', categoryId: '123' }), { kind: 'gtin', value: '012345678905', categoryId: '123' });
assert.deepEqual(catalogSearchInput({ brand: 'Acme', mfrPartNumber: 'AB-12' }, { categoryId: '456' }), { kind: 'mpn_brand', value: 'AB-12', brand: 'Acme', categoryId: '456' });
assert.equal(catalogSearchInput({ mfrPartNumber: 'AB-12' }, {}), null, 'MPN matching requires an exact brand');

const gtinMatch = selectExactCatalogProduct([{ epid: '111', gtin: ['012345678905'] }, { epid: '222', gtin: ['999999999999'] }], { kind: 'gtin', value: '012345678905' });
assert.equal(gtinMatch.status, 'matched');
assert.equal(gtinMatch.product.epid, '111');

const mpnMatch = selectExactCatalogProduct([{ epid: '333', mpn: ['AB-12'], brand: 'Acme' }, { epid: '444', mpn: ['AB-12'], brand: 'Different' }], { kind: 'mpn_brand', value: 'AB12', brand: 'ACME' });
assert.equal(mpnMatch.status, 'matched');
assert.equal(mpnMatch.product.epid, '333');

assert.equal(selectExactCatalogProduct([{ epid: '555', gtin: ['012345678905'] }, { epid: '666', gtin: ['012345678905'] }], { kind: 'gtin', value: '012345678905' }).status, 'ambiguous');
console.log('eBay catalog matching accepts only one exact GTIN or brand/MPN result.');
