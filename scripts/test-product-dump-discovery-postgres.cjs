const assert = require("node:assert/strict");
const databaseUrl = process.env.DATAPLUS_TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith("_test")) throw new Error("Use a disposable database ending in _test.");
process.env.DATABASE_URL = databaseUrl;
const db = require("../db");
async function main() {
  const original = { id: "discovery-original", sku: "DISCOVERY-TEST", title: "Keep title", supplier: "Test supplier", ebayListing: { listingId: "keep-listing" } };
  await db.upsertProductsFromState([original]);
  const result = await db.upsertProductsFromState([
    { ...original, id: "different-id", title: "Must not overwrite", ebayListing: {} },
    { id: "discovery-new", sku: "DISCOVERY-NEW", title: "New product", supplier: "Test supplier", barcode: "123456789012" }
  ], { insertOnly: true });
  assert.equal(result.products, 1);
  const rows = await db.readProductsByKeys(["DISCOVERY-TEST", "DISCOVERY-NEW"]);
  assert.equal(rows.length, 2);
  const existing = rows.find((row) => row.sku === original.sku);
  assert.equal(existing.title, "Keep title");
  assert.equal(existing.ebayListing.listingId, "keep-listing");
  assert.equal((await db.upsertProductsFromState(rows, { insertOnly: true })).products, 0);
  const identities = await db.readProductDiscoveryKeys();
  assert(identities.products.some((row) => row.sku === "DISCOVERY-NEW"));
  console.log("PostgreSQL discovery insert, retry, SKU conflict and listing preservation passed.");
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => db.closePool());
