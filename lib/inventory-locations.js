const DATAWAREHOUSE_LOCATION_ID = "datawarehouse";
const DATAWAREHOUSE_LOCATION_CODE = "DATAWAREHOUSE";
const DATAWAREHOUSE_LOCATION_NAME = "DataWarehouse";

function normalized(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isDataWarehouseLocation(value = {}) {
  const candidates = [value.id, value.code, value.name, value.warehouseId, value.warehouseCode, value.warehouseName];
  return candidates.some((candidate) => normalized(candidate) === "datawarehouse")
    || String(value.inventorySourceType || "").toLowerCase() === "supplier_feed";
}

function createDataWarehouseLocation(existing = {}) {
  const now = new Date().toISOString();
  return {
    ...existing,
    id: existing.id || DATAWAREHOUSE_LOCATION_ID,
    code: DATAWAREHOUSE_LOCATION_CODE,
    name: DATAWAREHOUSE_LOCATION_NAME,
    status: "active",
    warehouseType: "Virtual supplier network",
    inventorySourceType: "supplier_feed",
    isPhysical: false,
    allowReceiving: false,
    allowAudits: false,
    isDefaultReceiving: false,
    isDefaultReturns: false,
    requireBinValidation: false,
    shopifyInventoryPushEnabled: false,
    bins: [],
    notes: existing.notes || "Virtual availability imported from the DataWarehouse universal supplier feed. This is not physical stock.",
    createdAt: existing.createdAt || now,
    updatedAt: existing.updatedAt || now
  };
}

function ensureDataWarehouseLocation(warehouses = []) {
  const rows = Array.isArray(warehouses) ? [...warehouses] : [];
  const index = rows.findIndex(isDataWarehouseLocation);
  if (index >= 0) rows[index] = createDataWarehouseLocation(rows[index]);
  else rows.push(createDataWarehouseLocation());
  return rows;
}

function isPhysicalWarehouse(value = {}) {
  return !isDataWarehouseLocation(value)
    && value.isPhysical !== false
    && String(value.inventorySourceType || "physical").toLowerCase() !== "supplier_feed";
}

function isDataWarehouseImportedProduct(item = {}) {
  const sources = item.sources && typeof item.sources === "object" ? Object.keys(item.sources) : [];
  return Boolean(item.productDumpCreatedAt || item.productDumpUpdatedAt)
    || sources.some((source) => /datawarehouse|product.?dump/i.test(source))
    || /datawarehouse|product.?dump/i.test(String(item.importedFrom || item.creationSource || item.createdSource || item.systemFieldSource || ""));
}

function dataWarehouseStockRow(qty = 0, updatedAt = "") {
  return {
    warehouseId: DATAWAREHOUSE_LOCATION_ID,
    warehouseCode: DATAWAREHOUSE_LOCATION_CODE,
    warehouseName: DATAWAREHOUSE_LOCATION_NAME,
    inventorySourceType: "supplier_feed",
    isPhysical: false,
    aggregate: true,
    locationBin: "",
    qty: Math.max(0, Number(qty || 0)),
    reserved: 0,
    reorderPoint: 0,
    updatedAt: updatedAt || new Date().toISOString()
  };
}

function upsertDataWarehouseStock(item = {}, qty, updatedAt = "") {
  const rows = Array.isArray(item.warehouseStock) ? item.warehouseStock.filter(Boolean) : [];
  const index = rows.findIndex(isDataWarehouseLocation);
  const next = dataWarehouseStockRow(qty, updatedAt || item.productDumpUpdatedAt || item.updatedAt);
  if (index >= 0) rows[index] = { ...rows[index], ...next };
  else rows.push(next);
  item.warehouseStock = rows;
  return item;
}

module.exports = {
  DATAWAREHOUSE_LOCATION_ID,
  DATAWAREHOUSE_LOCATION_CODE,
  DATAWAREHOUSE_LOCATION_NAME,
  createDataWarehouseLocation,
  dataWarehouseStockRow,
  ensureDataWarehouseLocation,
  isDataWarehouseImportedProduct,
  isDataWarehouseLocation,
  isPhysicalWarehouse,
  upsertDataWarehouseStock
};
