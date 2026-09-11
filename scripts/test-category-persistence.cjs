const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
function extract(name, next) {
  return source.slice(source.indexOf(`async function ${name}(`), source.indexOf(`\n${next}`, source.indexOf(`async function ${name}(`)));
}
const writes = [];
const rows = new Map([['a', { id: 'a', mappings: { ebay: { categoryId: '123', locked: true } } }]]);
const client = { query: async (sql, params = []) => {
  writes.push({ sql, params });
  if (sql.includes('delete from entity_documents') && params[0].includes('categorySettings')) rows.clear();
  if (sql.includes('insert into entity_documents')) {
    for (const row of JSON.parse(params[0])) rows.set(row.entity_id, row.data);
  }
  return { rows: [] };
} };
const context = {
  getPool: () => client, initRelationalSchema: async () => {},
  STATE_DOCUMENT_KEYS: ['categorySettings', 'ebayTaxonomyIndexes'],
  ENTITY_DOCUMENT_COLLECTIONS: new Set(['categorySettings']),
  entityDocumentId: (_collection, row) => row.id
};
vm.createContext(context);
vm.runInContext(extract('writeStateDocuments', 'async function upsertStateEntityDocument'), context);
(async () => {
  await context.writeStateDocuments({ categorySettings: [] });
  assert.equal(rows.size, 1, 'An empty snapshot must preserve saved categories');
  await context.writeStateDocuments({ categorySettings: [{ id: 'b' }] });
  assert.equal(rows.size, 2, 'A partial snapshot must preserve absent categories');
  assert.equal(rows.get('a').mappings.ebay.locked, true);
  await context.writeStateDocuments({ categorySettings: [{ id: 'b' }], __replaceEntityCollections: ['categorySettings'] });
  assert.equal(rows.size, 1, 'Explicit replacement retains its deletion semantics');
  let savedState;
  let mappingOptions;
  context.writeStateDocuments = async (state) => { savedState = state; };
  context.upsertCategoryChannelMappingsFromState = async (_rows, options) => { mappingOptions = options; };
  vm.runInContext(extract('writeRelationalState', 'function vendorIdFor'), context);
  await context.writeRelationalState({ categorySettings: [], ebayTaxonomyIndexes: {} });
  assert.equal(Object.hasOwn(savedState, 'ebayTaxonomyIndexes'), false, 'General saves cannot erase taxonomy');
  assert.equal(mappingOptions.replace, false, 'General saves cannot clear the mapping projection');
  console.log('Category persistence regression tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
