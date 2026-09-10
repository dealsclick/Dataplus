const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'server.js'), 'utf8');
const loaderStart = source.indexOf('  const isCategoryProductRefresh =');
const loaderEnd = source.indexOf('\n\n', loaderStart);
const routeStart = source.indexOf('  if (req.method === "POST" && parts[0] === "api" && parts[1] === "categories" && parts[2] && parts[3] === "apply-channel-to-products")');
const routeEnd = source.indexOf('\n  if (req.method === "POST"', routeStart + 10);
assert(loaderStart > 0 && routeStart > loaderStart && routeEnd > routeStart);

async function run({ exists = true, mapped = true, scheduledFor = '' } = {}) {
  const saved = [];
  const scheduled = [];
  const category = { id: 'main-test', name: 'Toner & Cartridges', productCount: 1908, mappings: { ebay: { categoryId: mapped ? '123' : '' } } };
  const db = { categories: exists ? [category] : [], importJobs: [] };
  const context = {
    req: { method: 'POST' }, res: {}, parts: ['api', 'categories', 'main-test', 'apply-channel-to-products'],
    url: new URL('http://localhost/api/categories/main-test/apply-channel-to-products'),
    readCategoryWorkflowDb: async () => db,
    readDb: async () => { throw new Error('Refresh used inventory-less state'); },
    postgres: { isPostgresEnabled: () => true, upsertOperationJob: async (job) => saved.push(job) },
    parseBody: async () => ({ scope: 'main', channel: 'ebay', background: true, scheduledFor }),
    findPublicCategory: (state, id) => state.categories.find(row => row.id === id),
    sendJson: (_res, status, data) => ({ status, data }),
    categoryMappingRefreshOptions: options => options,
    findOrCreateCategorySetting: () => category,
    normalizeChannelCategoryMapping: mapping => mapping,
    createImportJob: (state, fields) => { const job = { id: 'job-test', ...fields }; state.importJobs.push(job); return job; },
    normalizeDb: state => state,
    clearCategoryResponseCache: () => {},
    scheduleChannelCategoryMappingJob: (...args) => scheduled.push(args),
    publicState: (_state, options) => { assert.equal(options.lite, true); return {}; },
    process, Date, decodeURIComponent
  };
  const result = await vm.runInNewContext(`(async () => { ${source.slice(loaderStart, loaderEnd)}\n${source.slice(routeStart, routeEnd)} })()`, context);
  return { result, saved, scheduled };
}

(async () => {
  const queued = await run();
  assert.equal(queued.result.status, 202);
  assert.equal(queued.saved.length, 1);
  assert.equal(queued.saved[0].totalRows, 1908);
  assert.equal(queued.scheduled.length, 1);
  assert.equal(queued.saved[0].workerPayload.categoryMappingRefresh, true);
  const missing = await run({ exists: false });
  assert.equal(missing.result.status, 404);
  assert.equal(missing.saved.length, 0);
  const unmapped = await run({ mapped: false });
  assert.equal(unmapped.result.status, 400);
  assert.equal(unmapped.saved.length, 0);
  const later = await run({ scheduledFor: new Date(Date.now() + 3600000).toISOString() });
  assert.equal(later.result.status, 202);
  assert(later.saved[0].scheduledFor);
  console.log('Category refresh route regression tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
