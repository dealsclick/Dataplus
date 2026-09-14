const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'server.js'), 'utf8');
const start = source.indexOf('  async function readCategoryWorkflowDb()');
const end = source.indexOf('\n  async function persistCategoryWorkflowDb', start);
assert(start > 0 && end > start);
const category = { name: 'Test category', mappings: { ebay: { categoryId: '123', locked: true } } };
const context = {
  postgres: {
    isPostgresEnabled: () => true,
    readCategoryState: () => { throw new Error('Must not load full catalog JSON'); },
    readStateFields: async (fields, options) => {
      assert.deepEqual(Array.from(fields), ['categorySettings', 'vendorCategoryMappings']);
      assert.equal(options.fallbackToLegacy, false);
      return { categorySettings: [category], vendorCategoryMappings: {} };
    },
    listCategoryProductStats: async () => [{ name: 'Test category', productCount: 42 }]
  },
  readDbFast: async options => { assert.equal(options.skipInventory, true); return { inventory: [], connections: [] }; },
  readCategoryResponseCacheFile: () => null,
  normalizeDb: value => value
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
context.readCategoryWorkflowDb().then(result => {
  assert.equal(result.inventory.length, 0);
  assert.equal(result.categorySettings[0], category);
  assert.equal(result.__mainCategoryRows[0].productCount, 42);
  console.log('Category save projection test passed.');
}).catch(error => { console.error(error); process.exitCode = 1; });
