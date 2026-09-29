const crypto = require("crypto");

function text(value, max = 250) {
  return String(value ?? "").trim().slice(0, max);
}

function nonnegativeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function locationId(location = {}, vendorId = "", index = 0) {
  const provided = text(location.id || location.locationId, 120);
  if (provided) return provided;
  const identity = `${text(vendorId, 120)}:${text(location.code || location.name, 120).toLowerCase()}:${index}`;
  return `supplier-location-${crypto.createHash("sha1").update(identity).digest("hex").slice(0, 16)}`;
}

function normalizeSupplierLocation(location = {}, options = {}) {
  const id = locationId(location, options.vendorId, options.index);
  const sourceLocationIds = [...new Set((Array.isArray(location.sourceLocationIds)
    ? location.sourceLocationIds
    : String(location.sourceLocationIds || location.sourceLocationId || "").split(/[|,\n]/))
    .map((value) => text(value, 160)).filter(Boolean))];
  const status = ["inactive", "disabled"].includes(text(location.status).toLowerCase()) || location.active === false
    ? "inactive"
    : "active";
  const safetyQty = location.safetyQty === null || location.safetyQty === undefined || location.safetyQty === ""
    ? null
    : Math.floor(nonnegativeNumber(location.safetyQty));
  return {
    id,
    code: text(location.code, 80),
    name: text(location.name, 160) || text(location.code, 80) || "Supplier location",
    status,
    address: {
      line1: text(location.address?.line1 || location.addressLine1, 200),
      line2: text(location.address?.line2 || location.addressLine2, 200),
      city: text(location.address?.city || location.city, 100),
      state: text(location.address?.state || location.state, 100),
      postalCode: text(location.address?.postalCode || location.postalCode, 40),
      country: text(location.address?.country || location.country || "US", 2).toUpperCase()
    },
    timezone: text(location.timezone || "America/New_York", 80),
    dropshipEnabled: location.dropshipEnabled === true,
    inventoryEnabled: location.inventoryEnabled !== false,
    priority: Math.max(1, Math.floor(nonnegativeNumber(location.priority, options.index + 1) || options.index + 1)),
    leadTimeDays: nonnegativeNumber(location.leadTimeDays),
    cutoffTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(text(location.cutoffTime)) ? text(location.cutoffTime) : "",
    safetyQtyEnabled: location.safetyQtyEnabled === true && safetyQty !== null,
    safetyQty,
    freshnessHours: Math.max(1, Math.floor(nonnegativeNumber(location.freshnessHours, 24) || 24)),
    sourceLocationIds,
    lastInventoryAt: text(location.lastInventoryAt, 50),
    notes: text(location.notes, 1000),
    createdAt: text(location.createdAt, 50) || new Date().toISOString(),
    updatedAt: text(location.updatedAt, 50) || text(location.createdAt, 50) || new Date().toISOString()
  };
}

function normalizeSupplierLocations(value, options = {}) {
  const rows = Array.isArray(value) ? value : [];
  if (rows.length > 100) throw new Error("A vendor can have at most 100 supplier locations.");
  const normalized = rows.map((row, index) => normalizeSupplierLocation(row, { ...options, index }));
  const ids = new Set();
  const codes = new Set();
  for (const row of normalized) {
    const id = row.id.toLowerCase();
    if (ids.has(id)) throw new Error(`Duplicate supplier location ID: ${row.id}`);
    ids.add(id);
    const code = row.code.toLowerCase();
    if (code && codes.has(code)) throw new Error(`Duplicate supplier location code: ${row.code}`);
    if (code) codes.add(code);
  }
  return normalized;
}

function supplierLocationWarehouseId(vendorId, locationIdValue) {
  const digest = crypto.createHash("sha1").update(`${text(vendorId, 160)}:${text(locationIdValue, 160)}`).digest("hex").slice(0, 20);
  return `vendor-location-${digest}`;
}

module.exports = {
  normalizeSupplierLocation,
  normalizeSupplierLocations,
  supplierLocationWarehouseId
};
