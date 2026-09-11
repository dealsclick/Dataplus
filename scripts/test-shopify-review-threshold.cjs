const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'server.js'), 'utf8');
const start = source.indexOf('async function applyDavidBackgroundCategoryDecision(');
const end = source.indexOf('\nasync function queueAiCategoryReviewJob(', start);
async function run(confidence, current = {}, suggestion = { categoryId: 'shopify-id' }) {
  const ebay = { categoryId: 'existing-ebay', locked: true };
  const category = { mappings: { shopify: current, ebay } };
  const context = {
    findOrCreateCategorySetting: () => category,
    normalizeChannelCategoryMapping: mapping => mapping,
    categoryMappingIsLocked: mapping => mapping.locked === true,
    davidToolEnabled: () => true,
    enrichShopifyCategoryMapping: mapping => ({ ...mapping, googleCategory: { id: '123', breadcrumb: 'Google path' } }),
    categoryConfidenceLevel: () => 'low',
    withCategoryMappingHistory: (_previous, next) => next
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  const result = await context.applyDavidBackgroundCategoryDecision({}, { name: 'Test', id: 'test' }, { channel: 'shopify', confidence, suggestion }, { aiCategoryAutoApproveThreshold: 0.4, aiCategoryAutoApproveEnabled: true });
  assert.deepEqual(category.mappings.ebay, ebay);
  return { result, category };
}
(async () => {
  const approved = await run(0.4);
  assert.equal(approved.result.status, 'auto_approved');
  assert.equal(approved.category.mappings.shopify.googleCategory.id, '123');
  const pending = await run(0.3999);
  assert.equal(pending.result.status, 'needs_approval');
  assert.equal(pending.category.mappings.shopify.pendingSuggestion.googleCategory.id, '123');
  for (const current of [{ categoryId: 'old', locked: true }, { categoryId: 'old', status: 'mapped' }, { status: 'blocked' }, { status: 'denied' }]) {
    assert.equal((await run(0.99, current)).result.status, 'skipped');
  }
  assert.equal((await run(0.99, {}, {})).result.status, 'needs_approval');
  console.log('Shopify/Google review threshold tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
