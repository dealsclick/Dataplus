const assert = require('node:assert/strict');
const { mappedTaxonomy } = require('../lib/datadump-category');
const input = { level3: "Ductless AC's", unspsc: 40101701, level1: 'HVAC & Fans', level2: 'Air Conditioning' };
const expected = { path: "HVAC & Fans > Air Conditioning > Ductless AC's", unspsc: '40101701' };
assert.deepEqual(mappedTaxonomy({ mapped_category: input }), expected);
assert.deepEqual(mappedTaxonomy({ productManagerFields: { mapped_category: input } }), expected);
assert.deepEqual(mappedTaxonomy({ mappedCategory: JSON.stringify(input) }), expected);
assert.deepEqual(mappedTaxonomy({ mapped_category: { level10: 'Ten', level2: 'Two', level1: ' One  ', level3: null, unspsc: { invalid: true } } }), { path: 'One > Two > Ten', unspsc: '' });
for (const value of [null, [], 'broken JSON', { unspsc: 123 }, { level1: {} }]) assert.equal(mappedTaxonomy({ mapped_category: value }).path, '');
assert.equal(input.level1, 'HVAC & Fans');
const { buildProduct } = require('./import-product-dump');
const product = buildProduct({ _id: 'BUS0005NXXXSRC1225DH', sku: 'BUS0005NXXXSRC1225DH', supplier: 'D&H', supplier_code: 'DH', mapped_category: input });
assert.equal(product.sourceCategory, expected.path);
assert.equal(product.vendorCategory, expected.path);
assert.equal(product.unspsc, '40101701');
assert.equal(product.categoryVerified, false); // Source parsing alone never approves a main category.
assert.equal(buildProduct({ sku: 'test', category: 'Existing Category', mapped_category: input }).sourceCategory, 'Existing Category');
console.log('Datadump structured taxonomy tests passed');
