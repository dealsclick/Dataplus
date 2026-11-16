const postgres = require("../db");

function identity(value = "") {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function identifierKeys(value = "") {
  const exact = identity(value);
  if (!exact) return [];
  const withoutLeadingZeros = /^\d+$/.test(exact) ? exact.replace(/^0+(?=\d)/, "") : exact;
  return [...new Set([exact, withoutLeadingZeros].filter(Boolean))];
}

function firstNumber(...values) {
  const value = values.find((candidate) => candidate !== null && candidate !== undefined && candidate !== "" && Number.isFinite(Number(candidate)));
  return value === undefined ? null : Number(value);
}

function expectedLineFor(audit = {}, line = {}, product = {}) {
  const expectedLines = Array.isArray(audit.purchaseOrderExpectedLines) ? audit.purchaseOrderExpectedLines : [];
  const sku = String(line.sku || product.sku || "").trim().toLowerCase();
  const exact = sku ? expectedLines.find((row) => String(row.sku || "").trim().toLowerCase() === sku) : null;
  if (exact) return exact;
  const identifiers = new Set([
    line.barcode,
    line.upc,
    line.selectedSupplierUpc,
    line.selectedVendorSku,
    line.selectedManufacturerSku,
    product.sku,
    product.upc,
    product.barcode,
    product.gtin,
    product.vendorSku,
    product.sourceSku,
    product.mfrPartNumber,
    product.manufacturerPartNumber,
    product.mpn,
  ].flatMap(identifierKeys));
  return expectedLines.find((row) => [row.sku, row.upc, row.barcode, row.vendorItemNumber, row.manufacturerSku]
    .some((value) => identifierKeys(value).some((key) => identifiers.has(key)))) || null;
}

function purchaseOrderLineFor(po = {}, expectedLine = {}, line = {}, product = {}) {
  const poLines = Array.isArray(po.items) ? po.items : [];
  const sku = String(expectedLine.sku || line.sku || product.sku || "").trim().toLowerCase();
  const exact = sku ? poLines.find((row) => String(row.sku || "").trim().toLowerCase() === sku) : null;
  if (exact) return exact;
  const identifiers = new Set([
    expectedLine.upc,
    expectedLine.vendorItemNumber,
    expectedLine.manufacturerSku,
    line.barcode,
    line.upc,
    product.upc,
    product.barcode,
    product.gtin,
    product.vendorSku,
    product.sourceSku,
    product.mfrPartNumber,
    product.manufacturerPartNumber,
    product.mpn,
  ].flatMap(identifierKeys));
  return poLines.find((row) => [row.sku, row.upc, row.barcode, row.sourceItemNumber, row.vendorSku, row.manufacturerSku, row.mfrPartNumber]
    .some((value) => identifierKeys(value).some((key) => identifiers.has(key)))) || null;
}

function sameValue(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function applyFields(target, fields) {
  let changed = false;
  for (const [key, value] of Object.entries(fields)) {
    if (sameValue(target[key], value)) continue;
    target[key] = value;
    changed = true;
  }
  return changed;
}

async function main() {
  if (!postgres.isPostgresEnabled()) throw new Error("DATABASE_URL is required.");
  const apply = process.argv.includes("--apply");
  await postgres.initDatabase();
  const [audits, purchaseOrders] = await Promise.all([
    postgres.readWarehouseAudits(),
    postgres.listPurchaseOrders({ limit: 50000, includeDeleted: true }),
  ]);
  const poById = new Map();
  const poByNumber = new Map();
  for (const po of purchaseOrders || []) {
    if (po.id) poById.set(String(po.id), po);
    if (po.poNumber) poByNumber.set(identity(po.poNumber), po);
  }
  const productCache = new Map();
  const coverageCache = new Map();
  const getProduct = async (key) => {
    const cacheKey = String(key || "").trim().toLowerCase();
    if (!cacheKey) return null;
    if (!productCache.has(cacheKey)) productCache.set(cacheKey, await postgres.readProductByKey(key).catch(() => null));
    return productCache.get(cacheKey);
  };
  const getCoverage = async (product) => {
    const cacheKey = String(product?.id || product?.sku || "").trim().toLowerCase();
    if (!cacheKey) return [];
    if (!coverageCache.has(cacheKey)) {
      const coverage = await postgres.readProductSupplierLinks({ productId: product.id, sku: product.sku }).catch(() => ({ matches: [] }));
      coverageCache.set(cacheKey, Array.isArray(coverage.matches) ? coverage.matches : []);
    }
    return coverageCache.get(cacheKey);
  };
  const repaired = [];
  const skipped = [];
  for (const audit of (audits || []).filter((row) => String(row.reason || "") === "purchase_order_receipt")) {
    const po = poById.get(String(audit.linkedPurchaseOrderId || ""))
      || poByNumber.get(identity(audit.linkedPurchaseOrderNumber || ""));
    if (!po) {
      skipped.push({ auditNumber: audit.auditNumber, reason: "linked PO not found" });
      continue;
    }
    const repairedAt = new Date().toISOString();
    const supplierId = String(po.vendorId || audit.supplierId || "").trim();
    const supplierName = String(po.supplier || audit.supplierName || "").trim();
    let metadataChanged = applyFields(audit, { supplierId, supplierName });
    audit.purchaseOrderExpectedLines = Array.isArray(audit.purchaseOrderExpectedLines) ? audit.purchaseOrderExpectedLines : [];
    for (const expectedLine of audit.purchaseOrderExpectedLines) {
      const poLine = purchaseOrderLineFor(po, expectedLine);
      const product = await getProduct(expectedLine.sku);
      const productMatchesSupplier = identity(product?.supplier || product?.vendor) === identity(supplierName);
      metadataChanged = applyFields(expectedLine, {
        supplierId,
        supplierName,
        supplierCode: String(poLine?.supplierCode || po.supplierCode || (productMatchesSupplier ? product?.supplierCode : "") || expectedLine.supplierCode || "").trim(),
        supplierSku: String(poLine?.sourceSku || poLine?.supplierSku || (productMatchesSupplier ? product?.sourceSku : "") || expectedLine.supplierSku || expectedLine.sku || "").trim(),
        unitCost: firstNumber(poLine?.estimatedUnitCost, poLine?.unitCost, poLine?.cost, expectedLine.unitCost),
      }) || metadataChanged;
    }
    let repairedLines = 0;
    for (const originalLine of audit.lines || []) {
      const line = { ...originalLine };
      const product = await getProduct(line.productId || line.sku);
      const expectedLine = expectedLineFor(audit, line, product || {});
      const poLine = purchaseOrderLineFor(po, expectedLine || {}, line, product || {});
      const coverage = product ? await getCoverage(product) : [];
      const supplierMatch = coverage.find((row) => String(row.matchStatus || "confirmed").toLowerCase() !== "rejected"
        && identity(row.supplier || row.supplierName || row.supplierCode) === identity(supplierName)) || null;
      const productMatchesSupplier = identity(product?.supplier || product?.vendor) === identity(supplierName);
      const source = supplierMatch || (productMatchesSupplier ? product : {}) || {};
      const cost = firstNumber(poLine?.estimatedUnitCost, poLine?.unitCost, poLine?.cost, expectedLine?.unitCost, source.cost, source.unitCost);
      const qty = firstNumber(source.qty, source.stockQty);
      const fields = {
        selectedSupplierKey: `purchase-order:${supplierId || identity(supplierName)}`,
        selectedSupplierId: supplierId,
        selectedSupplierName: supplierName,
        selectedSupplierCode: String(expectedLine?.supplierCode || source.supplierCode || "").trim(),
        selectedSupplierSku: String(expectedLine?.supplierSku || source.sourceSku || (productMatchesSupplier ? product?.sourceSku : "") || expectedLine?.sku || product?.sku || line.sku || "").trim(),
        selectedVendorSku: String(expectedLine?.vendorItemNumber || poLine?.sourceItemNumber || poLine?.vendorSku || source.vendorSku || (productMatchesSupplier ? product?.vendorSku : "") || "").trim(),
        selectedManufacturerSku: String(expectedLine?.manufacturerSku || poLine?.manufacturerSku || poLine?.mfrPartNumber || source.mfrPartNumber || product?.mfrPartNumber || product?.manufacturerPartNumber || product?.mpn || "").trim(),
        selectedSupplierUpc: String(expectedLine?.upc || poLine?.upc || poLine?.barcode || source.upc || source.barcode || source.gtin || product?.upc || product?.barcode || product?.gtin || line.barcode || "").trim(),
        selectedSupplierCost: cost,
        selectedSupplierQty: qty,
        selectedSupplierMatchType: "purchase-order",
        selectedSupplierIndexed: true,
        supplierName,
        supplierInheritedFromPurchaseOrder: true,
        supplierInheritedPurchaseOrderId: String(po.id || audit.linkedPurchaseOrderId || "").trim(),
        supplierInheritedPurchaseOrderNumber: String(po.poNumber || audit.linkedPurchaseOrderNumber || "").trim(),
        supplierSelectedAt: String(line.supplierSelectedAt || repairedAt),
        supplierSelectedBy: String(line.supplierSelectedBy || "PO supplier inheritance repair"),
      };
      if (!applyFields(line, fields)) continue;
      repairedLines += 1;
      if (apply) await postgres.saveWarehouseAuditLine(audit.id, line);
    }
    if (!metadataChanged && !repairedLines) continue;
    applyFields(audit, {
      poSupplierInheritanceRepairedAt: repairedAt,
      poSupplierInheritanceRepairVersion: 1,
      poSupplierInheritanceRepairedLines: repairedLines,
    });
    if (apply) await postgres.saveWarehouseAuditMetadata(audit);
    repaired.push({
      auditId: audit.id,
      auditNumber: audit.auditNumber,
      purchaseOrder: po.poNumber,
      supplier: supplierName,
      status: audit.status,
      lines: (audit.lines || []).length,
      repairedLines,
      metadataChanged,
    });
  }
  process.stdout.write(`${JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    scanned: (audits || []).filter((row) => String(row.reason || "") === "purchase_order_receipt").length,
    repaired: repaired.length,
    skipped: skipped.length,
    repairs: repaired,
    skippedAudits: skipped,
  }, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message || error}\n`);
    process.exitCode = 1;
  })
  .finally(() => postgres.closePool());
