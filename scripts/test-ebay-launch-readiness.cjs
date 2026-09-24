const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EBAY_LAUNCH_READINESS_VERSION, normalizeEbayProductIdentifier, validEbayProductIdentifier } = require('../lib/ebay-launch-readiness');
const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const saved = { name: 'Paper > Toilet Paper', mappings: { ebay: { categoryId: '179204', locked: true, status: 'mapped' } } };
let reads = 0;
const context = {
  Set, Map, formatCategoryName: value => String(value || '').trim(),
  readSystemSettingsStore: value => value || {},
  effectiveMainCategoryName: item => String(item.sourceCategory || item.category || item.mainCategory || '').trim(),
  applyStoredAttributeMappingsToCategory: value => value,
  ebayChannelSettings: () => ({}),
  postgres: {
    isPostgresEnabled: () => true,
    readCategorySettingsByNames: async names => { reads++; assert.deepEqual(Array.from(names), ['paper > toilet paper']); return [saved]; }
  }
};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('async function loadEbayLaunchCategorySettings('), source.indexOf('function ebayChannelSettings(')), context);
vm.runInContext(source.slice(source.indexOf('function categorySettingForProduct('), source.indexOf('function mappedAttributeSourceValue(')), context);
vm.runInContext(source.slice(source.indexOf('async function ebayListingLaunchCandidates('), source.indexOf('async function runEbayOrderImportWorkerJob(')), context);
async function main() {
  assert.equal(EBAY_LAUNCH_READINESS_VERSION, '2026-09-24-v3');
  assert.equal(validEbayProductIdentifier('UPC', '036000291452'), true);
  assert.equal(normalizeEbayProductIdentifier('UPC', '8236089394'), '008236089394');
  assert.equal(normalizeEbayProductIdentifier('UPC', '8925157106'), '008925157106');
  assert.equal(validEbayProductIdentifier('UPC', '8236089395'), false);
  assert.equal(validEbayProductIdentifier('EAN', '4006381333931'), true);
  assert.match(source, /categoryId must be a leaf category/);
  assert.match(source, /category requirements unavailable/);
  assert.match(source, /package weight or complete package dimensions/);
  assert.match(source, /validatorVersion: EBAY_LAUNCH_READINESS_VERSION/);
  const db = { categorySettings: [] };
  const item = { id: 'a', sku: 'A', category: 'Old catalog category', sourceCategory: saved.name };
  await context.loadEbayLaunchCategorySettings(db, [item]);
  assert.equal(context.ebayListingCategoryId(db, item, { categoryId: '' }), '179204');
  assert.equal(context.categorySettingForProduct(db, item).mappings.ebay.categoryId, '179204');
  assert.equal(db.categorySettings[0].mappings.ebay.locked, true);
  await context.loadEbayLaunchCategorySettings(db, [item]);
  assert.equal(reads, 1, 'one scoped read, not one database request per SKU');
  assert(!JSON.stringify(db).includes('__ebayLoadedCategoryNames'));
  assert.equal(context.ebayListingCategoryId(db, item, { categoryId: '123' }), '123');
  const products = [item, { id: 'b', sku: 'B', active: false }];
  context.postgres.withStoredPriceFloors = async rows => rows;
  context.postgres.readProductsByKeys = async (keys, options) => { assert.equal(options.includeMarketplaceIds, false); return products; };
  context.ebayReadinessDefaultsForFilters = async () => ({});
  context.postgres.listProducts = async options => {
    assert.deepEqual(Array.from(options.productIds), ['a', 'b']);
    assert.equal(options.filters.active, 'true');
    return { inventory: [item] };
  };
  const rows = await context.ebayListingLaunchCandidates({ skus: ['a','b'], selectionScope: true, filters: { active: 'true' } });
  assert.equal(rows[0].__ebaySelectionMismatch, undefined);
  assert.equal(rows[1].__ebaySelectionMismatch, true);
  assert.equal(products[1].__ebaySelectionMismatch, undefined, 'selection checks do not persist changes to catalog records');
  console.log('eBay launch mapping hydration and selected-scope checks passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
