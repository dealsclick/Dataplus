const assert = require('node:assert/strict');
const { marketplaceInventoryOperationLabel } = require('../server');

assert.equal(
  marketplaceInventoryOperationLabel('eBay', { apply: true, partial: true, trigger: 'Temu order import' }),
  'Partial eBay inventory update after Temu order import'
);
assert.equal(
  marketplaceInventoryOperationLabel('Shopify', { apply: true, partial: true, trigger: 'eBay order import' }),
  'Partial Shopify inventory update after eBay order import'
);
assert.equal(
  marketplaceInventoryOperationLabel('eBay', { apply: false, partial: false, trigger: 'product-dump-import' }),
  'eBay inventory review after product-dump-import'
);
assert.equal(
  marketplaceInventoryOperationLabel('Shopify', { apply: true }),
  'Shopify inventory update'
);

console.log('Marketplace inventory child jobs keep channel-specific titles.');
