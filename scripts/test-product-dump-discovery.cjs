const assert = require("node:assert/strict");
const { createDiscovery } = require("../lib/product-dump-discovery");

async function main() {
  const saved = [], reports = [];
  const options = {
    vendors: [
      { name: "True Value", status: "active", catalogSettings: { enabled: true, sourceCodes: ["TRV"] } },
      { name: "Inactive", status: "inactive", catalogSettings: { enabled: true, sourceCodes: ["OFF"] } }
    ],
    settings: {},
    identities: { products: [{ sku: "EXISTING", barcode: "123", mfr_part_number: "PART" }], aliases: ["ALIAS"] },
    normalize: (row) => ({ ...row }),
    save: async (rows, sources) => { assert.equal(rows.length, sources.length); saved.push(...rows); return { products: rows.length }; },
    report: async (row) => reports.push(row)
  };
  const run = createDiscovery(options);
  const product = (sku, attrs = {}) => ({ sku, supplierCode: "TRV", ...attrs });
  await run.batch([
    product("NEW", { barcode: "999" }), product("existing"), product("alias"),
    product("UPC-MATCH", { barcode: "123" }), product("MPN-MATCH", { mfrPartNumber: "PART" }),
    product("DISCONTINUED", { toBeDiscontinued: true }), product("INACTIVE", { supplierCode: "OFF" }),
    product("UNAPPROVED", { supplierCode: "OTHER" })
  ]);
  await run.batch([product("NEW"), product("DUPLICATE-UPC", { barcode: "999" })]);
  assert.deepEqual(saved.map((row) => row.sku), ["NEW"]);
  assert.equal(run.counts.needsReview, 3);
  assert.equal(run.counts.existing, 3);
  assert.equal(run.counts.excluded, 3);
  const disabled = createDiscovery({ ...options, settings: { catalogImportNewSkusEnabled: false } });
  await disabled.batch([product("NO-CREATE")]);
  assert.equal(disabled.counts.added, 0);
  const retry = createDiscovery({ ...options, identities: { products: [...options.identities.products, { sku: "NEW", barcode: "999" }], aliases: ["ALIAS"] } });
  await retry.batch([product("NEW", { barcode: "999" })]);
  assert.equal(retry.counts.added, 0);
  assert.equal(reports.filter((row) => row.status === "needs_review").length, 3);
  assert.equal(retry.precheckIdentity(product("NEW")), false);
  assert.equal(retry.precheckIdentity(product("OUTSIDE", { supplierCode: "OFF" })), false);
  assert.equal(retry.precheckIdentity(product("NEXT")), true);
  console.log("Discovery: eligibility, identifier review, duplicate batches, disabled creation and retry checks passed.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
