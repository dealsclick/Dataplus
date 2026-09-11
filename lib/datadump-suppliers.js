const crypto = require("node:crypto");
const text = value => String(value ?? "").trim();
const key = value => text(value).toLowerCase();

function supplierTokens(vendor) {
  const codes = vendor.catalogSettings?.sourceCodes;
  return [vendor.name, vendor.code, vendor.vendorCode,
    ...(Array.isArray(codes) ? codes : text(codes).split(/[|,\n]/))].map(key).filter(Boolean);
}

// Collect supplier evidence before catalog eligibility filters discard rows.
function createSupplierInventory() {
  const suppliers = new Map();
  return {
    observe(row) {
      const name = text(row.supplier || row.vendor || row.supplier_code || row.supplierCode);
      const code = text(row.supplier_code || row.supplierCode);
      if (!name) return;
      const identity = JSON.stringify([key(name), key(code)]);
      let entry = suppliers.get(identity);
      if (!entry) {
        entry = { name, code, rows: 0, exampleSku: text(row._id || row.sku || row.SKU || row.id) };
        suppliers.set(identity, entry);
      }
      entry.rows += 1;
    },
    rows: () => [...suppliers.values()]
  };
}

function missingSupplierProfiles(suppliers, vendors, { canonicalize = name => name, jobId = "", now = new Date().toISOString() } = {}) {
  const known = new Set(vendors.flatMap(supplierTokens));
  const additions = [];
  const addedByToken = new Map();
  for (const supplier of suppliers) {
    const name = canonicalize(supplier.name, supplier.code) || supplier.name;
    const tokens = [name, supplier.name, supplier.code].map(key).filter(Boolean);
    if (tokens.some(token => known.has(token))) {
      const added = tokens.map(token => addedByToken.get(token)).find(Boolean);
      if (added) {
        added.catalogSettings.sourceCodes = [...new Set([...added.catalogSettings.sourceCodes, supplier.code, supplier.name].filter(Boolean))];
        tokens.forEach(token => { known.add(token); addedByToken.set(token, added); });
      }
      continue;
    }
    const id = `datadump-supplier-${crypto.createHash("sha256").update(key(supplier.code || name)).digest("hex").slice(0, 24)}`;
    additions.push({
      id, name, code: supplier.code, status: "active", createdAt: now, updatedAt: now,
      catalogSettings: { enabled: false, sourceCodes: [...new Set([supplier.code, supplier.name].filter(Boolean))] },
      notes: "DataWarehouse source supplier. Catalog participation remains disabled until reviewed.",
      changeLog: [{ id: crypto.randomUUID(), createdAt: now, user: "DataPlus", type: "created", title: "Datadump supplier discovery", message: `Job ${jobId}: ${supplier.rows} source rows; example SKU ${supplier.exampleSku}.` }]
    });
    tokens.forEach(token => known.add(token));
    tokens.forEach(token => addedByToken.set(token, additions[additions.length - 1]));
  }
  return additions;
}

module.exports = { createSupplierInventory, missingSupplierProfiles };
