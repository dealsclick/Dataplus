const key = (value) => String(value || "").trim().toLowerCase();
const supplierKeys = (row = {}) => [row.supplierCode, row.supplier_code, row.supplier, row.vendor].map(key).filter(Boolean);
const scopedVendorSku = (supplier, vendorSku) => supplier && key(vendorSku) ? `${supplier}:${key(vendorSku)}` : "";

// This pass creates only new catalog identities. Potential supplier matches are
// retained for review; they never overwrite or merge an existing product.
function createDiscovery({ vendors, settings, identities, normalize, save, report }) {
  const allowed = new Set();
  for (const vendor of vendors) {
    if (vendor.catalogSettings?.enabled !== true || vendor.active === false
      || ["inactive", "disabled", "deleted"].includes(key(vendor.status))) continue;
    for (const value of [vendor.name, vendor.code, ...(Array.isArray(vendor.catalogSettings.sourceCodes)
      ? vendor.catalogSettings.sourceCodes : String(vendor.catalogSettings.sourceCodes || "").split(/[|,\n]/))]) {
      if (key(value)) allowed.add(key(value));
    }
  }
  const known = new Set(identities.products.map((row) => key(row.sku)));
  for (const alias of identities.aliases) known.add(key(alias));
  const globalCandidates = new Set(identities.products.flatMap((row) =>
    [row.barcode, row.mfr_part_number].map(key).filter(Boolean)));
  const vendorSkuCandidates = new Set(identities.products.flatMap((row) => supplierKeys(row)
    .map((supplier) => scopedVendorSku(supplier, row.vendor_sku)).filter(Boolean)));
  for (const value of identities.identifiers || []) if (key(value)) globalCandidates.add(key(value));
  const counts = { scanned: 0, existing: 0, added: 0, needsReview: 0, excluded: 0 };
  return {
    counts,
    precheckIdentity(row) {
      if (settings.catalogImportNewSkusEnabled === false
        || ![row.supplierCode, row.supplier, row.vendor].some((value) => allowed.has(key(value)))) {
        counts.scanned += 1;
        counts.excluded += 1;
        return false;
      }
      if (known.has(key(row.sku))) {
        counts.scanned += 1;
        counts.existing += 1;
        return false;
      }
      return true;
    },
    async batch(rows) {
      const additions = [];
      const sources = [];
      for (const row of rows) {
        counts.scanned += 1;
        if (settings.catalogImportNewSkusEnabled === false || row.active === false || row.toBeDiscontinued
          || ![row.supplierCode, row.supplier, row.vendor].some((value) => allowed.has(key(value)))) {
          counts.excluded += 1;
          continue;
        }
        const sku = key(row.sku);
        if (!sku || known.has(sku)) { counts.existing += 1; continue; }
        const globalMatch = [row.barcode, row.mfrPartNumber].map(key).filter(Boolean)
          .some((value) => globalCandidates.has(value) || known.has(value));
        const vendorSkuMatch = supplierKeys(row)
          .map((supplier) => scopedVendorSku(supplier, row.vendorSku))
          .filter(Boolean)
          .some((value) => vendorSkuCandidates.has(value));
        const match = globalMatch || vendorSkuMatch;
        if (match) {
          counts.needsReview += 1;
          await report({ sku: row.sku, status: "needs_review", reason: "Existing identifier or supplier-SKU candidate" });
          continue;
        }
        const item = normalize(row);
        if (!item) { counts.excluded += 1; continue; }
        additions.push(item);
        sources.push(row);
        known.add(sku);
        for (const value of [row.barcode, row.mfrPartNumber].map(key).filter(Boolean)) globalCandidates.add(value);
        for (const supplier of supplierKeys(row)) {
          const value = scopedVendorSku(supplier, row.vendorSku);
          if (value) vendorSkuCandidates.add(value);
        }
      }
      if (additions.length) {
        const result = await save(additions, sources);
        counts.added += result.products;
        for (const item of additions) await report({ sku: item.sku, status: "processed", reason: "Insert-only catalog discovery" });
      }
      return { ...counts };
    }
  };
}

module.exports = { createDiscovery };
