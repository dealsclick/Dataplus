const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const pages = [
  { inventory: [{ id: 'p1', sku: 'A' }, { id: 'p2', sku: 'B' }], hasMore: true },
  { inventory: [{ id: 'p3', sku: 'C' }], hasMore: false }
];
const progress = [];
let candidateMode = false;
const context = {
  Set,
  Math,
  Number,
  String,
  normalizeDb: value => value,
  readDbFast: async () => ({ inventory: [] }),
  ebayReadinessDefaultsForFilters: async filters => ({ filters }),
  postgres: {
    isPostgresEnabled: () => true,
    listProducts: async options => {
      if (candidateMode) {
        assert.equal(options.includeInventoryLevels, true, 'eBay candidates hydrate supplier and physical inventory locations');
      } else {
        assert.equal(options.sort, 'sku');
        assert.equal(options.sortDirection, 'asc');
      }
      assert.equal(options.fastPage, true);
      return pages[options.page - 1] || { inventory: [], hasMore: false };
    },
    readProductsByKeys: async (_, options) => {
      assert.equal(options.includeInventoryLevels, true, 'explicit eBay selections hydrate supplier and physical inventory locations');
      return [{ id: 'p1', sku: 'A', qty: 9 }];
    },
    withStoredPriceFloors: async products => products
  }
};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('async function ebayListingLaunchCandidateKeys('), source.indexOf('async function ebayListingLaunchCandidates(')), context);
vm.runInContext(source.slice(source.indexOf('async function ebayListingLaunchCandidates('), source.indexOf('async function runEbayOrderImportWorkerJob(')), context);

async function main() {
  const keys = await context.ebayListingLaunchCandidateKeys({
    allFiltered: true,
    selectionTotal: 3,
    batchSize: 100,
    filters: { supplier: 'True Value' }
  }, { onProgress: patch => progress.push({ ...patch }) });
  assert.deepEqual(Array.from(keys), ['p1', 'p2', 'p3']);
  assert.equal(progress.length, 2);
  assert.equal(progress[1].loaded, 3);
  assert.deepEqual(Array.from(await context.ebayListingLaunchCandidateKeys({ skus: ['A', 'A', 'B'] })), ['A', 'B']);
  assert.equal((await context.ebayListingLaunchCandidates({ skus: ['A'] }))[0].qty, 9);
  candidateMode = true;
  pages[0].hasMore = false;
  await context.ebayListingLaunchCandidates({ allFiltered: true, limit: 2, filters: {} });
  console.log('eBay selections preserve every page and hydrate current inventory locations.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
