const assert = require("node:assert/strict");
const postgres = require("../db");

const originalGetPool = postgres.getPool;
const originalReadProductsByKeys = postgres.readProductsByKeys;
let capturedSql = "";

postgres.readProductsByKeys = async () => [];
postgres.getPool = () => ({
  query: async (sql) => {
    capturedSql = sql;
    return {
      rows: [
        { identifier: "48-32-4094", product_id: "product-1", sku: "BUS142489TRV", title: "80PC Impact Driver Bit Set", supplier: "True Value", match_rank: 3, match_basis: "manufacturer part number (catalog suggestion)" },
        { identifier: "48-32-4403", product_id: "product-2", sku: "BUS158978TRV", title: "18PC Driver Bit Set", supplier: "True Value", match_rank: 3, match_basis: "manufacturer part number (catalog suggestion)" },
        { identifier: "48-32-4403", product_id: "product-3", sku: "BUS175222DIB", title: "18PC Screwdriver Bit Set", supplier: "Do It Best", match_rank: 3, match_basis: "manufacturer part number (catalog suggestion)" },
      ]
    };
  }
});

const { matchExternalOperationalPoItems, catalogVendorForSupplier, vendorCatalogLookupKeys } = require("../server");

(async () => {
  try {
    const vendor = { id: "mil", name: "MILWAUKEE TOOL", code: "MIL" };
    const distributor = { id: "cei", name: "CEI", catalogSettings: { sourceCodes: ["CEI", "MIL"] } };
    assert.equal(catalogVendorForSupplier({ vendors: [vendor, distributor] }, { ...vendor, distributorVendorId: distributor.id }), distributor);
    assert.deepEqual(vendorCatalogLookupKeys(distributor), ["cei", "mil"]);
    const sourceItems = [
      { manufacturerPartNumber: "48-32-4094", description: "Driver Bit Set", qty: 30, unitCost: 25.22 },
      { manufacturerPartNumber: "48-32-4403", description: "18 Piece Hex Drive Bit Set", qty: 30, unitCost: 9.88 },
    ];

    const preview = await matchExternalOperationalPoItems(vendor, sourceItems);
    assert.match(capturedSql, /lower\(vci\.vendor_id\) = any\(\$2::text\[\]\)/);
    assert.match(capturedSql, /regexp_replace\(lower\(coalesce\(p\.mfr_part_number/);
    assert.match(capturedSql, /manufacturer part number \(catalog suggestion\)/);
    assert.equal(preview[0].matchStatus, "review");
    assert.equal(preview[0].sku, "");
    assert.equal(preview[0].candidates.length, 1);
    assert.equal(preview[0].candidates[0].sku, "BUS142489TRV");
    assert.equal(preview[1].matchStatus, "ambiguous");
    assert.equal(preview[1].candidates.length, 2);

    const reviewed = await matchExternalOperationalPoItems(vendor, sourceItems, [
      { line: 1, manufacturerPartNumber: "48324094", sku: "BUS142489TRV" },
      { line: 2, manufacturerPartNumber: "48-32-4403", sku: "BUS175222DIB" },
    ]);
    assert.equal(reviewed[0].matchStatus, "matched");
    assert.equal(reviewed[0].sku, "BUS142489TRV");
    assert.equal(reviewed[0].reviewedMatch, true);
    assert.match(reviewed[0].matchBasis, /reviewed/);
    assert.equal(reviewed[1].matchStatus, "matched");
    assert.equal(reviewed[1].sku, "BUS175222DIB");

    const rejectedInjection = await matchExternalOperationalPoItems(vendor, sourceItems, [
      { line: 1, manufacturerPartNumber: "48-32-4094", sku: "NOT-A-CANDIDATE" },
    ]);
    assert.equal(rejectedInjection[0].matchStatus, "review");
    assert.equal(rejectedInjection[0].sku, "");
  } finally {
    postgres.getPool = originalGetPool;
    postgres.readProductsByKeys = originalReadProductsByKeys;
  }
  console.log("external PO MPN matching tests passed");
})().catch((error) => {
  postgres.getPool = originalGetPool;
  postgres.readProductsByKeys = originalReadProductsByKeys;
  console.error(error);
  process.exit(1);
});
