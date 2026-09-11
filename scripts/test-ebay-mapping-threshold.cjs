const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'server.js'), 'utf8');
const start = source.indexOf('async function autoMapEbayCategories(');
const end = source.indexOf('\nasync function readEbayCategoryAutoMapDb(', start);
async function check(confidence, saved = {}, search = {}) {
  let written;
  const context = {
    ebayChannelSettings: () => ({}), ebayAutoMapRows: () => [{ id: 'a', name: 'Test category' }],
    ebayCategoryAutoSearchQuery: () => 'test', normalizeCategorySettings: x => x,
    normalizeChannelCategoryMapping: x => x,
    categoryMappingIsLocked: x => x.locked === true,
    ebayMappingWasAutoSuggested: () => true,
    searchEbayTaxonomy: async () => ({ categories: confidence === null ? [] : [{ categoryId: '123', name: 'Test' }], ...search }),
    rankEbayCategoryMatches: (_name, categories) => categories.map(category => ({ category, confidence, exactLeaf: true })),
    findOrCreateCategorySetting: () => ({ mappings: {} }),
    categoryConfidenceLevel: x => x >= 0.9 ? 'high' : x >= 0.75 ? 'medium' : 'low'
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  const result = await context.autoMapEbayCategories({}, {
    autoApproveThreshold: 0.4, refreshAutoSuggestions: true,
    loadCategorySetting: async () => ({ mappings: { ebay: saved } }),
    saveCategorySetting: async setting => { written = setting; }
  });
  return { result, written };
}
(async () => {
  assert.equal((await check(0.3999)).written.mappings.ebay.pendingSuggestion.confidence, 0.3999);
  const boundary = await check(0.4);
  assert.equal(boundary.result.autoApproved, 1);
  assert.equal(boundary.written.mappings.ebay.confidenceLevel, 'low');
  assert.equal((await check(0.99, { locked: true, categoryId: 'old' })).written, undefined);
  assert.equal((await check(0.99, { status: 'blocked' })).written, undefined);
  assert.equal((await check(null)).written.mappings.ebay.pendingSuggestion.action, 'no_match');
  const unavailable = await check(0.9, {}, { source: 'unavailable' });
  assert.equal(unavailable.result.errors, 1);
  assert.equal(unavailable.written, undefined);
  assert.equal((await check(0.99, {}, { categories: [{ categoryId: 'parent', leafCategoryTreeNode: false }] })).result.autoApproved, 0);
  console.log('eBay mapping threshold tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
