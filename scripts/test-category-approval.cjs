const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const start = source.indexOf('  if (req.method === "POST" && davidPendingCategoryApplyMatch)');
const end = source.indexOf('\n  if (req.method', start + 10);
assert.ok(start > 0 && end > start);
const pending = { categoryId: 'fixture-target', categoryPath: 'Fixture > Target', reviewedAt: '2026-09-16', confidence: 0.39, provider: 'repository' };
async function run(channel, { locked = false, enabled = true, stale = false, missing = false } = {}) {
  const record = { name: 'Fixture', mappings: { [channel]: { locked, pendingSuggestion: missing ? null : pending } } };
  let persisted = null, response;
  const context = {
    req: { method: 'POST' }, res: {}, davidPendingCategoryApplyMatch: ['', 'fixture'],
    parseBody: async () => ({ channel, expectedSuggestion: { categoryId: stale ? 'old-target' : pending.categoryId, reviewedAt: pending.reviewedAt } }),
    sendJson: (res, code, data) => { response = { code, data }; },
    sourceTextValue: value => String(value || ''),
    readCategoryReviewContext: async () => ({ db: {}, source: { id: 'fixture', name: 'Fixture' } }),
    readSystemSettingsStore: () => ({ aiEnabled: enabled }), dbCache: { data: {} }, davidToolEnabled: () => true,
    findOrCreateCategorySetting: () => record, normalizeChannelCategoryMapping: value => value,
    categoryMappingIsLocked: value => value.locked === true, enrichShopifyCategoryMapping: value => value,
    withCategoryMappingHistory: (previous, next) => next, categoryConfidenceLevel: () => 'low',
    persistCategoryWorkflowDb: async (db, { category }) => { persisted = structuredClone(category); },
    clearCategoryResponseCache() {}, recordDavidAction: async () => {},
  };
  vm.createContext(context);
  await vm.runInContext(`(async () => { ${source.slice(start, end)} })()`, context);
  return { response, persisted };
}
(async () => {
  for (const channel of ['shopify', 'ebay']) {
    const success = await run(channel);
    assert.equal(success.response.code, 200);
    assert.equal(success.persisted.mappings[channel].categoryId, pending.categoryId);
    assert.equal(success.persisted.mappings[channel].pendingSuggestion, null);
    assert.equal(success.persisted.mappings[channel].locked, true);
    for (const [options, code] of [[{ locked: true }, 423], [{ enabled: false }, 403], [{ stale: true }, 409], [{ missing: true }, 409]]) {
      const result = await run(channel, options);
      assert.equal(result.response.code, code);
      assert.equal(result.persisted, null);
    }
  }
  assert.equal((await run('walmart')).response.code, 400, 'Walmart must not fall through to eBay');
  console.log('PASS category approval save, pending cleanup, locks, stale review and channel guards');
})().catch(error => { console.error(error); process.exitCode = 1; });
