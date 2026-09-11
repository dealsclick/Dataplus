const assert = require('node:assert/strict');
const { sourceKeys, assertEligible, refreshStoredSupplier } = require('../lib/vendor-catalog-refresh');
async function main() {
  const vendor = { id: 'v', name: 'D&H', code: 'DH', catalogSettings: { enabled: true, sourceCodes: ['DH'] } };
  assert.deepEqual(sourceKeys(vendor), ['dh', 'd-h']);
  for (const attrs of [{ status: 'inactive' }, { retirement: { retiredAt: 'now' } }, { catalogSettings: { enabled: false } }]) assert.throws(() => assertEligible({ ...vendor, ...attrs }, {}));
  assert.throws(() => assertEligible(vendor, { catalogImportNewSkusEnabled: false }));
  const saved = [], reports = [], progress = [];
  const rows = [
    { sku: 'NEW', active: true, barcode: 'NEW-UPC' },
    { sku: 'EXISTING' },
    { sku: 'UNKNOWN' },
    { sku: 'INACTIVE', active: false },
    { sku: 'DISCONTINUED', active: true, toBeDiscontinued: true },
    { sku: 'MATCH', active: true, barcode: '123' },
    { sku: 'OTHER-SUPPLIER', active: true, supplierCode: 'OTHER' },
    { sku: 'DUP', active: true, barcode: 'NEW-UPC' }
  ].map(row => ({ ...row, supplierCode: row.supplierCode || 'DH' }));
  const options = { vendor, settings: {}, identities: { products: [{ sku: 'EXISTING', barcode: '123' }], aliases: [] },
    check: async () => {}, normalize: row => row,
    readBatch: async cursor => {
      const start = cursor || 0;
      return rows.slice(start, start + 3).map((product, index) => ({ product, cursor: start + index + 1 }));
    }, save: async batch => { saved.push(...batch); return { products: batch.length }; },
    report: async row => reports.push(row), progress: async counts => progress.push(counts) };
  const counts = await refreshStoredSupplier(options);
  assert.deepEqual(saved.map(row => row.sku), ['NEW']);
  assert.deepEqual(counts, { scanned: 8, existing: 1, added: 1, needsReview: 3, excluded: 3 });
  assert(reports.some(row => row.sku === 'UNKNOWN' && row.reason.includes('status')));
  assert.equal(progress.length, 3);
  let checks = 0;
  await assert.rejects(refreshStoredSupplier({ ...options, check: async () => { if (++checks === 2) throw Error('stopped'); } }), /stopped/);
  assert.equal(saved.length, 1, 'Cancellation before saving must not create rows');
  const again = await refreshStoredSupplier({ ...options, identities: { products: [{ sku: 'EXISTING', barcode: '123' }, { sku: 'NEW', barcode: 'NEW-UPC' }], aliases: [] } });
  assert.equal(again.added, 0);
  console.log('Stored supplier refresh: scope, status gates, keyset batches, matches, cancellation and retry passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
