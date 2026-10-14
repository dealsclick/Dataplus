const assert = require('node:assert/strict');
const test = require('node:test');

const { createDataQualityEngine } = require('../lib/data-quality');
const { createInventoryFromOrderLine, normalizeChannel, shopifyProductCreateReadiness } = require('../server');

test('existing channels migrate once to create SKUs from order imports', () => {
  const migrated = normalizeChannel({ name: 'eBay', settings: { createMissingOrderSkusFromSource: false } });
  assert.equal(migrated.settings.createMissingOrderSkusFromSource, true);
  assert.equal(migrated.settings.orderImportSkuPolicyVersion, 1);

  const operatorDisabled = normalizeChannel({ name: 'eBay', settings: { createMissingOrderSkusFromSource: false, orderImportSkuPolicyVersion: 1 } });
  assert.equal(operatorDisabled.settings.createMissingOrderSkusFromSource, false);
});

test('an unknown imported SKU becomes a draft with durable provenance and attention', () => {
  const db = { inventory: [] };
  const order = { id: 'order-1', orderNumber: '50001', source: 'eBay' };
  const product = createInventoryFromOrderLine(db, order, { sku: 'ONE-TIME-123', title: 'One-time listing', price: 12.5 }, 'ONE-TIME-123');

  assert.equal(product.status, 'Draft');
  assert.equal(product.createdBy, 'DataPlus system');
  assert.equal(product.createdMethod, 'Automatic product creation from order import');
  assert.equal(product.createdSource, 'eBay order import');
  assert.equal(product.systemCreatedFromOrderImport, true);
  assert.equal(product.catalogAttentionRequired, true);
  assert.match(product.catalogAttentionReason, /link this SKU as an alias/i);
});

test('system-created SKU remains in readiness and cannot launch before review', () => {
  const product = {
    sku: 'ONE-TIME-123', title: 'One-time listing title', marketplaceTitle: 'One-time listing title',
    catalogAttentionRequired: true, category: 'Supplies', categoryVerified: true, brand: 'Example', vendor: 'Example',
    price: 12.5, cost: 5, qty: 1, barcode: '123456789012', longDescription: 'A complete description long enough for the ordinary product quality check.',
    defaultImage: 'https://example.com/image.jpg', itemWeight: 1, itemLength: 2, itemWidth: 2, itemHeight: 2
  };
  const quality = createDataQualityEngine().dataQualityRow({}, product);
  assert.ok(quality.issues.includes('System-created SKU review'));
  const launch = shopifyProductCreateReadiness({ connections: [], systemSettings: { catalogRequireImageForLaunch: false } }, product);
  assert.ok(launch.missing.includes('System-created SKU needs catalog review'));
});
