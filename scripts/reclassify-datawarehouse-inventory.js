const fs = require("fs");
const path = require("path");
const postgres = require("../db");
const {
  ensureDataWarehouseLocation,
  isDataWarehouseImportedProduct,
  isDataWarehouseLocation,
  isPhysicalWarehouse,
  upsertDataWarehouseStock
} = require("../lib/inventory-locations");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skuIndex = args.indexOf("--sku");
const requestedSku = skuIndex >= 0 ? String(args[skuIndex + 1] || "").trim().toLowerCase() : "";
const batchIndex = args.indexOf("--batch-size");
const batchSize = Math.max(100, Math.min(5000, Number(batchIndex >= 0 ? args[batchIndex + 1] : 1000) || 1000));
const reportIndex = args.indexOf("--report");
const reportPath = reportIndex >= 0 ? String(args[reportIndex + 1] || "").trim() : "";

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function evidenceKey(sku, warehouseId) {
  return `${normalized(sku)}::${normalized(warehouseId)}`;
}

function warehouseKey(row = {}) {
  return String(row.warehouseId || row.locationKey || row.warehouseCode || row.warehouseName || row.name || "").trim();
}

function addEvidence(set, sku, warehouseId) {
  if (sku && warehouseId) set.add(evidenceKey(sku, warehouseId));
}

function collectPhysicalEvidence(state = {}) {
  const evidence = new Set();
  for (const entry of state.inventoryLedger || []) {
    if (isDataWarehouseLocation(entry)) continue;
    const eventType = normalized(entry.type || entry.eventType || entry.source);
    if (!/(receipt|receiv|warehouse_audit|return_restock|transfer_in|manual_adjustment)/.test(eventType)) continue;
    addEvidence(evidence, entry.sku, entry.warehouseId || entry.warehouseName);
  }
  for (const receipt of state.manualWarehouseReceipts || []) {
    for (const item of receipt.items || []) addEvidence(evidence, item.sku, receipt.warehouseId || receipt.warehouseName);
  }
  for (const audit of state.warehouseAudits || []) {
    if (!String(audit.status || "").toLowerCase().includes("complete")) continue;
    for (const line of audit.lines || []) addEvidence(evidence, line.sku, audit.warehouseId || audit.warehouseName);
  }
  return evidence;
}

function hasPhysicalEvidence(item, row, evidence) {
  const sku = item.sku || item.id;
  const keys = [row.warehouseId, row.warehouseName, row.warehouseCode].filter(Boolean);
  return keys.some((key) => evidence.has(evidenceKey(sku, key)));
}

function finiteQty(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : Math.max(0, Number(fallback || 0));
}

function sourceTimestamp(row = {}) {
  const value = Date.parse(row.lastSeenAt || row.updatedAt || row.productDumpUpdatedAt || "");
  return Number.isFinite(value) ? value : 0;
}

function sourceKeys(row = {}) {
  return [row.sourceSku, row.internalSku, row.sku, row.vendorSku, row.raw?.sourceSku, row.raw?.internalSku]
    .map(normalized)
    .filter(Boolean);
}

function latestSourceRecord(item = {}, batchSources = []) {
  const itemKeys = new Set([item.sku, item.id, item.internalSku].map(normalized).filter(Boolean));
  const candidates = [...(item.sourceCatalogMatches || []), ...batchSources]
    .filter((row) => sourceKeys(row).some((key) => itemKeys.has(key)))
    .sort((a, b) => sourceTimestamp(b) - sourceTimestamp(a));
  return candidates[0] || null;
}

function summarizeRows(rows = []) {
  return rows.map((row) => ({
    location: row.warehouseName || row.warehouseCode || row.warehouseId || "",
    type: isDataWarehouseLocation(row) ? "supplier_feed" : "physical",
    qty: finiteQty(row.qty ?? row.onHand ?? row.available),
    bin: row.locationBin || ""
  }));
}

function repairProduct(item, evidence, sourceRecord = null) {
  const existingRows = Array.isArray(item.warehouseStock) ? item.warehouseStock.filter(Boolean) : [];
  const existingFeedRow = existingRows.find(isDataWarehouseLocation);
  const hasCurrentSourceQty = sourceRecord && sourceRecord.qty !== null && sourceRecord.qty !== undefined && sourceRecord.qty !== "";
  const sourceQty = hasCurrentSourceQty
    ? finiteQty(sourceRecord.qty)
    : finiteQty(existingFeedRow?.qty, item.stockQty ?? item.qty ?? 0);
  const keptPhysicalRows = existingRows.filter((row) => isPhysicalWarehouse(row) && hasPhysicalEvidence(item, row, evidence));
  const removedPhysicalRows = existingRows.filter((row) => isPhysicalWarehouse(row) && !hasPhysicalEvidence(item, row, evidence));
  const before = summarizeRows(existingRows);

  item.warehouseStock = keptPhysicalRows;
  upsertDataWarehouseStock(
    item,
    sourceQty,
    sourceRecord?.lastSeenAt || sourceRecord?.updatedAt || item.productDumpUpdatedAt || item.stockUpdatedAt || item.updatedAt
  );

  const allRows = item.warehouseStock || [];
  const physicalRows = allRows.filter(isPhysicalWarehouse);
  const physicalQty = physicalRows.reduce((sum, row) => sum + finiteQty(row.qty ?? row.onHand), 0);
  const physicalReserved = physicalRows.reduce((sum, row) => sum + finiteQty(row.reserved), 0);
  item.stockQty = sourceQty;
  item.qty = sourceQty + physicalQty;
  item.reserved = physicalReserved;
  item.available = allRows.reduce((sum, row) => {
    const qty = finiteQty(row.qty ?? row.onHand ?? row.available);
    return sum + Math.max(0, qty - finiteQty(row.reserved) - finiteQty(row.committed));
  }, 0);
  item.warehouseCount = allRows.filter((row) => finiteQty(row.qty ?? row.onHand) > 0).length;
  item.inventoryClassificationUpdatedAt = new Date().toISOString();
  item.inventoryClassificationSource = "datawarehouse-location-repair";

  return {
    changed: JSON.stringify(before) !== JSON.stringify(summarizeRows(allRows)),
    removedPhysicalRows,
    sourceQty,
    physicalQty,
    before,
    after: summarizeRows(allRows)
  };
}

async function main() {
  if (!postgres.isPostgresEnabled()) throw new Error("DATABASE_URL is required for this repair.");
  await postgres.initDatabase();

  const state = await postgres.readStateFields([
    "warehouses",
    "inventoryLedger",
    "warehouseAudits",
    "manualWarehouseReceipts"
  ]);
  const warehouses = ensureDataWarehouseLocation(state.warehouses || []);
  const evidence = collectPhysicalEvidence(state);
  const stats = {
    dryRun,
    requestedSku: requestedSku || null,
    scanned: 0,
    dataWarehouseProducts: 0,
    changed: 0,
    removedUnsupportedPhysicalRows: 0,
    preservedPhysicalRows: 0,
    supplierUnits: 0,
    physicalUnits: 0,
    samples: []
  };

  async function processRows(rows) {
    const changed = [];
    stats.scanned += rows.length;
    const batchSources = await postgres.readVendorCatalogItemsBySkus(rows.map((item) => item.sku || item.id)) || [];

    for (const item of rows) {
      if (!isDataWarehouseImportedProduct(item)) continue;
      stats.dataWarehouseProducts += 1;
      const sourceRecord = latestSourceRecord(item, batchSources);
      const result = repairProduct(item, evidence, sourceRecord);
      stats.removedUnsupportedPhysicalRows += result.removedPhysicalRows.length;
      stats.preservedPhysicalRows += (item.warehouseStock || []).filter(isPhysicalWarehouse).length;
      stats.supplierUnits += result.sourceQty;
      stats.physicalUnits += result.physicalQty;
      if (result.changed) {
        stats.changed += 1;
        changed.push(item);
        if (stats.samples.length < 20 || normalized(item.sku) === requestedSku) {
          stats.samples.push({ sku: item.sku, before: result.before, after: result.after });
        }
      }
    }

    if (!dryRun && changed.length) {
      await postgres.upsertProductsFromState(changed, { batchSize });
      await postgres.upsertInventoryLevelsFromProducts(changed, { batchSize, replace: true });
    }
  }

  if (requestedSku) {
    const product = await postgres.readProductByKey(requestedSku);
    if (product) await processRows([product]);
  }

  let offset = 0;
  while (!requestedSku) {
    const rows = await postgres.readAllProducts({ limit: batchSize, offset });
    if (!rows.length) break;
    await processRows(rows);
    if (rows.length < batchSize) break;
    offset += rows.length;
  }

  if (!dryRun) await postgres.writeStateDocuments({ warehouses });
  if (reportPath) {
    const absoluteReportPath = path.resolve(reportPath);
    fs.mkdirSync(path.dirname(absoluteReportPath), { recursive: true });
    fs.writeFileSync(absoluteReportPath, `${JSON.stringify(stats, null, 2)}\n`);
    stats.reportPath = absoluteReportPath;
  }
  process.stdout.write(`${JSON.stringify(stats, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message || error}\n`);
    process.exitCode = 1;
  })
  .finally(() => postgres.closePool());
