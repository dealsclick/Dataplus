const assert = require('node:assert/strict');
const { dedupeCategorySettings } = require('../lib/category-setting-resolution');
const { identifierUnitQty, normalizeEbayIdentifier, sellingUnitIdentifierConfig, hasVerifiedProductIdentifier } = require('../lib/ebay-identifiers');

const duplicateCategory = 'Tools & Test Equipment > Power Tools > Rotary & Multi-Tools & Accessories';
const settings = dedupeCategorySettings([
  { id: 'missing', name: duplicateCategory, mappings: { ebay: { status: 'missing', categoryId: '' } } },
  { id: 'mapped', name: duplicateCategory, mappings: { ebay: { status: 'mapped', locked: true, categoryId: '260207', categoryPath: 'Root > Rotary Tool Accessories' } } }
]);
assert.equal(settings.length, 1);
assert.equal(settings[0].mappings.ebay.categoryId, '260207', 'approved mapping wins over an unmapped duplicate');

const trueValueEach = { sku: 'BUS102194TRV', uom: 'EA', uomQty: 1, minQuantity: 6, quantityIncrements: 6 };
assert.equal(identifierUnitQty(trueValueEach), 1, 'supplier order multiples do not change the UPC selling unit');
assert.equal(normalizeEbayIdentifier('25545048034', 'UPC'), '025545048034', 'stripped leading zero is restored and checksum validated');
assert.equal(normalizeEbayIdentifier('0', 'UPC'), '', 'placeholder zero is not a verified identifier');
assert.equal(normalizeEbayIdentifier('123456789013', 'UPC'), '', 'invalid check digits are rejected');

const config = { identifierValue: '025545048034', ePid: '', mpn: '66460' };
assert.equal(sellingUnitIdentifierConfig(config, trueValueEach, 1).identifierValue, '025545048034');
assert.equal(sellingUnitIdentifierConfig(config, trueValueEach, 6).identifierValue, '', 'generated pack never reuses the Each UPC');
assert.equal(sellingUnitIdentifierConfig(config, trueValueEach, 6).mpn, '66460', 'brand plus MPN remains available for the generated pack');
assert.equal(hasVerifiedProductIdentifier({ mpn: '66460' }, { brand: 'True Temper' }), true);
assert.equal(hasVerifiedProductIdentifier({ mpn: '66460' }, {}), false, 'MPN alone is not a complete eBay product identity');

console.log('eBay category precedence, identifier-unit and GTIN validation tests passed.');
