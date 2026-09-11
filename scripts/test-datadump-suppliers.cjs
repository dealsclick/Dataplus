const assert = require("node:assert/strict");
const { createSupplierInventory, missingSupplierProfiles } = require("../lib/datadump-suppliers");
const { buildProduct } = require("./import-product-dump");
const { createDiscovery } = require("../lib/product-dump-discovery");

async function main() {
  const source = { _id: "BUS00667C2GDH", supplier: "D&H", supplier_code: "DH", vendor_sku: "00667C2G", active: true, upc: "757120006671", name: "5FT CAT6A SNAG UNSHIELDPATCH G", stock_qty: 0 };
  const inventory = createSupplierInventory();
  inventory.observe(source);
  inventory.observe({ ...source, _id: "BUS00668C2GDH" });
  inventory.observe({ sku: "NO-SUPPLIER" });
  assert.deepEqual(inventory.rows(), [{ name: "D&H", code: "DH", rows: 2, exampleSku: source._id }]);
  const additions = missingSupplierProfiles(inventory.rows(), [], { jobId: "test-job" });
  assert.equal(additions.length, 1);
  assert.equal(additions[0].name, "D&H");
  assert.equal(additions[0].catalogSettings.enabled, false);
  assert.deepEqual(additions[0].catalogSettings.sourceCodes, ["DH", "D&H"]);
  assert.equal(missingSupplierProfiles(inventory.rows(), additions).length, 0);
  assert.equal(missingSupplierProfiles(inventory.rows(), [ { name: "D and H", code: "dh", status: "inactive", retirement: { retiredAt: "2026-01-01" } } ]).length, 0);
  assert.equal(missingSupplierProfiles(inventory.rows(), [ { name: "D and H", catalogSettings: { sourceCodes: "ONE|DH" } } ]).length, 0);
  assert.equal(missingSupplierProfiles([{ name: "DIB", code: "DIB" }], [{ name: "Do It Best" }], { canonicalize: () => "Do It Best" }).length, 0);
  const aliases = missingSupplierProfiles([...inventory.rows(), { name: "D&H", code: "DH2", rows: 1 }], []);
  assert.equal(aliases.length, 1);
  assert(aliases[0].catalogSettings.sourceCodes.includes("DH2"));
  const saved = [];
  const options = { vendors: additions, settings: {}, identities: { products: [], aliases: [] }, normalize: row => row, save: async rows => { saved.push(...rows); return { products: rows.length }; }, report: async () => {} };
  const product = buildProduct(source);
  assert.equal(product.sku, source._id);
  assert.equal(product.supplierCode, "DH");
  const excluded = createDiscovery(options);
  await excluded.batch([product]);
  assert.equal(excluded.counts.excluded, 1);
  additions[0].catalogSettings.enabled = true;
  const enabled = createDiscovery(options);
  await enabled.batch([product]);
  assert.equal(saved.length, 1, "Approved D&H SKU is discoverable even with zero stock");
  const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "datadump-supplier-test-"));
  try {
    const input = path.join(temp, "fixture.bson.gz");
    const output = path.join(temp, "audit.json");
    fs.writeFileSync(input, require("node:zlib").gzipSync(require("bson").BSON.serialize(source)));
    require("node:child_process").execFileSync(process.execPath, [path.join(__dirname, "audit-datadump-suppliers.cjs"), "--source", input, "--output", output, "--sku", source._id], { stdio: "inherit" });
    const audit = JSON.parse(fs.readFileSync(output, "utf8"));
    assert.equal(audit.scanned, 1);
    assert.equal(audit.skuMatches[0].supplierCode, "DH");
    assert.equal(audit.suppliers[0].name, "D&H");
    assert.equal(audit.size, fs.statSync(input).size);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  console.log("Datadump supplier observation, alias deduplication, disabled registration and D&H SKU discovery passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
