const { createDiscovery } = require('./product-dump-discovery');
const { supplierUnavailable } = require('./supplier-retirement');

function sourceKeys(vendor) {
  const codes = vendor.catalogSettings?.sourceCodes || [];
  return [...new Set([vendor.code, vendor.name, ...(Array.isArray(codes) ? codes : String(codes).split(/[|,\n]/))]
    .filter(Boolean).map(value => String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')))];
}
function assertEligible(vendor, settings) {
  if (!vendor) throw new Error('Supplier not found.');
  if (supplierUnavailable(vendor) || vendor.status === 'deleted') throw new Error('Supplier must be active and not retired.');
  if (vendor.catalogSettings?.enabled !== true) throw new Error('Enable Include supplier in catalog first.');
  if (settings.catalogImportNewSkusEnabled === false) throw new Error('New SKU creation is disabled in Catalog settings.');
}

// Dependency injection keeps this runner testable without touching a live catalog.
async function refreshStoredSupplier({ vendor, settings, identities, readBatch, check, normalize, save, report, progress }) {
  assertEligible(vendor, settings);
  const discovery = createDiscovery({ vendors: [vendor], settings, identities, normalize, save, report });
  let cursor = null;
  for (;;) {
    await check();
    const batch = await readBatch(cursor);
    if (!batch.length) break;
    const eligible = [];
    for (const source of batch) {
      const row = source.product;
      // Existing IDs can be skipped even when historical source status is missing.
      if (!discovery.precheckIdentity(row)) continue;
      if (row.active === undefined || row.active === null) {
        discovery.counts.scanned++;
        discovery.counts.needsReview++;
        await report({ sku: row.sku, status: 'needs_review', reason: 'Stored source active status is missing; verify before catalog creation.' });
      } else eligible.push(row);
    }
    await check();
    await discovery.batch(eligible);
    cursor = batch[batch.length - 1].cursor;
    await progress({ ...discovery.counts });
  }
  return discovery.counts;
}
module.exports = { sourceKeys, assertEligible, refreshStoredSupplier };
