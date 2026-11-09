const key = (value) => String(value || "").trim().toLowerCase();
const supplierKeys = (row = {}) => [row.supplierCode, row.supplier_code, row.supplier, row.vendor].map(key).filter(Boolean);
const scopedVendorSku = (supplier, vendorSku) => supplier && key(vendorSku) ? `${supplier}:${key(vendorSku)}` : "";

function createBoundedIdentitySet(limit = 20_000) {
  const maximum = Math.max(1, Number(limit || 20_000) || 20_000);
  const values = new Set();
  const order = [];
  return {
    add(value) {
      const normalized = key(value);
      if (!normalized || values.has(normalized)) return;
      values.add(normalized);
      order.push(normalized);
      while (order.length > maximum) values.delete(order.shift());
    },
    has(value) { return values.has(key(value)); },
    get size() { return values.size; }
  };
}

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

function createDiscovery({ settings, identities = {}, lookup, normalize, save, report, recentIdentityLimit = 20_000 }) {
  const initial = identitySets(identities);
  const known = initial.known;
  const globalCandidates = initial.globalCandidates;
  const vendorSkuCandidates = initial.vendorSkuCandidates;
  // PostgreSQL is authoritative across batches. These bounded caches only
  // cover duplicates and identifier relationships that occur close together
  // in the stream, preventing multi-million-row imports from retaining every
  // identity in the Node process.
  const recentKnown = createBoundedIdentitySet(recentIdentityLimit);
  const recentGlobalCandidates = createBoundedIdentitySet(recentIdentityLimit);
  const recentVendorSkuCandidates = createBoundedIdentitySet(recentIdentityLimit);
  const counts = { scanned: 0, existing: 0, added: 0, needsReview: 0, excluded: 0 };
  return {
    counts,
    precheckIdentity(row) {
      if (settings.catalogImportNewSkusEnabled === false) {
        counts.scanned += 1;
        counts.excluded += 1;
        return false;
      }
      if (known.has(key(row.sku)) || recentKnown.has(row.sku)) {
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
        if (!sku || known.has(sku) || recentKnown.has(sku) || persisted.known.has(sku)) { counts.existing += 1; continue; }
        const globalMatch = [row.barcode, row.mfrPartNumber].map(key).filter(Boolean)
          .some((value) => globalCandidates.has(value) || recentGlobalCandidates.has(value)
            || persisted.globalCandidates.has(value) || known.has(value) || recentKnown.has(value));
        const vendorSkuMatch = supplierKeys(row)
          .map((supplier) => scopedVendorSku(supplier, row.vendorSku))
          .filter(Boolean)
          .some((value) => vendorSkuCandidates.has(value) || recentVendorSkuCandidates.has(value)
            || persisted.vendorSkuCandidates.has(value));
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
        recentKnown.add(sku);
        for (const value of [row.barcode, row.mfrPartNumber].map(key).filter(Boolean)) recentGlobalCandidates.add(value);
        for (const supplier of supplierKeys(row)) {
          const value = scopedVendorSku(supplier, row.vendorSku);
          if (value) recentVendorSkuCandidates.add(value);
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

// The creation-only datadump pass intentionally checks only the canonical SKU
// column. Identifier and supplier similarity work belongs to the later
// commercial refresh and must not slow down millions of no-op existence checks.
function createSkuCreationScanner({ enabled = true, lookup, normalize, save, report }) {
  const counts = { scanned: 0, existing: 0, added: 0, needsReview: 0, excluded: 0 };
  return {
    counts,
    async batch(rows = []) {
      const candidates = Array.isArray(rows) ? rows : [];
      counts.scanned += candidates.length;
      if (!enabled) {
        counts.excluded += candidates.length;
        return { ...counts };
      }

      const candidateSkus = [...new Set(candidates.map((row) => key(row.sku)).filter(Boolean))];
      const persisted = new Set((typeof lookup === "function" ? await lookup(candidateSkus) : []).map(key).filter(Boolean));
      const accepted = new Set();
      const additions = [];
      const sources = [];
      for (const row of candidates) {
        const sku = key(row.sku);
        if (!sku) {
          counts.excluded += 1;
          continue;
        }
        if (persisted.has(sku) || accepted.has(sku)) {
          counts.existing += 1;
          continue;
        }
        const item = normalize(row);
        if (!item) {
          counts.excluded += 1;
          continue;
        }
        accepted.add(sku);
        additions.push(item);
        sources.push(row.source || row);
      }

      if (additions.length) {
        const result = await save(additions, sources);
        const inserted = Math.max(0, Math.min(additions.length, Number(result?.products || 0)));
        counts.added += inserted;
        counts.existing += additions.length - inserted;
        for (const item of additions) await report({
          sku: item.sku,
          status: "processed",
          reason: "Insert-only SKU creation"
        });
      }
      return { ...counts };
    }
  };
}

module.exports = { createBoundedIdentitySet, createDiscovery, createSkuCreationScanner };
