const assert = require("node:assert/strict");

const {
  csvProductRows,
  reconcileLiveSessionCsv,
  studioProductsWithSessionSkus,
} = require("../lib/live-session-csv");

const session = {
  id: "session-104",
  sessionNumber: "LS-104",
  items: [{
    id: "item-1",
    sku: "BUS210787TRV",
    manufacturerSku: "48-89-2801",
    launchTitle: "THUNDERBOLT Black Oxide Drill Bit Set",
    launch: { listingId: "tiktok-product-1", merchantSku: "48-89-2801" },
  }, {
    id: "item-2",
    sku: "BUS142523TRV",
    manufacturerSku: "48-89-4670",
    launchTitle: "SHOCKWAVE Impact Duty Red Helix Set",
  }],
};

const auctionCsv = [
  "TikTok LIVE auction upload template",
  "Do not remove required columns",
  'Product Name,Seller SKU,Product ID,Quantity,Starting Bid Price',
  '"THUNDERBOLT Black Oxide Drill Bit Set","wrong-sku","tiktok-product-1",20,31.81',
  '"SHOCKWAVE Impact Duty Red Helix Set","48-89-4670",,20,31.81',
  '"Unknown product","missing-sku",,1,5.00',
].join("\r\n");

const parsed = csvProductRows(auctionCsv);
assert.equal(parsed.headerIndex, 2);
assert.equal(parsed.products.length, 3);

const reconciliation = reconcileLiveSessionCsv({ session, csv: auctionCsv, filename: "live.csv", actor: "Test user" });
assert.equal(reconciliation.summary.csvRows, 3);
assert.equal(reconciliation.summary.matchedRows, 2);
assert.equal(reconciliation.summary.unmatchedRows, 1);
assert.equal(reconciliation.summary.sessionItemsMissingFromCsv, 0);
assert.equal(reconciliation.rows[0].matchBasis, "product_id", "TikTok product ID must outrank an incorrect seller SKU");
assert.equal(reconciliation.rows[1].matchBasis, "seller_sku");

const titleOnly = reconcileLiveSessionCsv({
  session,
  csv: "Product Name,Quantity\nSHOCKWAVE Impact Duty Red Helix Set,20",
});
assert.equal(titleOnly.rows[0].status, "matched");
assert.equal(titleOnly.rows[0].matchBasis, "product_name");

const ambiguous = reconcileLiveSessionCsv({
  session: { items: [...session.items, { id: "item-3", sku: "ANOTHER", launchTitle: "SHOCKWAVE Impact Duty Red Helix Set" }] },
  csv: "Product Name\nSHOCKWAVE Impact Duty Red Helix Set",
});
assert.equal(ambiguous.rows[0].status, "ambiguous");
assert.deepEqual(ambiguous.rows[0].candidateSkus.sort(), ["ANOTHER", "BUS142523TRV"]);

const tray = studioProductsWithSessionSkus(session, [{ productId: "tiktok-product-1", title: "TikTok title" }, { productId: "not-mapped", title: "Other" }]);
assert.equal(tray[0].sku, "BUS210787TRV");
assert.equal(tray[0].merchantSku, "48-89-2801");
assert.equal(tray[0].matchStatus, "matched");
assert.equal(tray[1].matchStatus, "unmatched");

console.log("Live-session TikTok CSV matching checks passed.");
