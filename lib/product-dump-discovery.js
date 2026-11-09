const key = (value) => String(value || "").trim().toLowerCase();
const supplierKeys = (row = {}) => [row.supplierCode, row.supplier_code, row.supplier, row.vendor].map(key).filter(Boolean);
const scopedVendorSku = (supplier, vendorSku) => supplier && key(vendorSku) ? `${supplier}:${key(vendorSku)}` : "";

// This pass creates every valid new source SKU as an independent catalog
// identity. Supplier participation controls sourcing and marketplace actions;
// they never suppress product creation. Potential identifier matches are
// retained for review and never overwrite or merge an existing product.
function identitySets(identities = {}) {
  return {
    known: new Set([
      ...(identities.products || []).map((row) => key(row.sku)),
      ...(identities.aliases || []).map(key)
    ].filter(Boolean)),
    globalCandidates: new Set([
      ...(identities.products || []).flatMap((row) => [row.barcode, row.mfr_part_number].map(key)),
      ...(identities.identifiers || []).map(key)
    ].filter(Boolean)),
    vendorSkuCandidates: new Set((identities.products || []).flatMap((row) => supplierKeys(row)
      .map((supplier) => scopedVendorSku(supplier, row.vendor_sku)).filter(Boolean)))
  };
}

function createDiscovery({ settings, identities = {}, lookup, normalize, save, report }) {
  const initial = identitySets(identities);
  const known = initial.known;
  const globalCandidates = initial.globalCandidates;
  const vendorSkuCandidates = initial.vendorSkuCandidates;
  const counts = { scanned: 0, existing: 0, added: 0, needsReview: 0, excluded: 0 };
  return {
    counts,
    precheckIdentity(row) {
      if (settings.catalogImportNewSkusEnabled === false) {
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
      const persisted = typeof lookup === "function" ? identitySets(await lookup(rows)) : identitySets();
      const additions = [];
      const sources = [];
      for (const row of rows) {
        counts.scanned += 1;
        if (settings.catalogImportNewSkusEnabled === false) {
          counts.excluded += 1;
          continue;
        }
        const sku = key(row.sku);
        if (!sku || known.has(sku) || persisted.known.has(sku)) { counts.existing += 1; continue; }
        const globalMatch = [row.barcode, row.mfrPartNumber].map(key).filter(Boolean)
          .some((value) => globalCandidates.has(value) || persisted.globalCandidates.has(value) || known.has(value));
        const vendorSkuMatch = supplierKeys(row)
          .map((supplier) => scopedVendorSku(supplier, row.vendorSku))
          .filter(Boolean)
          .some((value) => vendorSkuCandidates.has(value) || persisted.vendorSkuCandidates.has(value));
        const match = globalMatch || vendorSkuMatch;
        const item = normalize(row);
        if (!item) { counts.excluded += 1; continue; }
        if (match) {
          counts.needsReview += 1;
          item.catalogAttentionRequired = true;
          item.catalogAttentionReason = "Another catalog SKU has a similar identifier. This source SKU remains an independent product.";
        }
        additions.push(item);
        sources.push(row);
        known.add(sku);
        for (const value of [row.barcode, row.mfrPartNumber].map(key).filter(Boolean)) globalCandidates.add(value);
        for (const supplier of supplierKeys(row)) {
          const value = scopedVendorSku(supplier, row.vendorSku);
          if (value) vendorSkuCandidates.add(value);
        }
      }
      if (sources.length) {
        const result = await save(additions, sources);
        counts.added += result.products;
        for (const item of additions) await report({
          sku: item.sku,
          status: "processed",
          reason: item.catalogAttentionRequired
            ? "Independent catalog SKU created; similar identifier retained as a review signal"
            : "Insert-only catalog discovery"
        });
      }
      return { ...counts };
    }
  };
}

module.exports = { createDiscovery };
