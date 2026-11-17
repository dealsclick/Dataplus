const assert = require("node:assert/strict");

const { buildProduct } = require("./import-product-dump.js");
const { buildRecord } = require("./import-product-pricing-inventory.js");

const source = {
  _id: "BUS202637TRV",
  sku: "BUS202637TRV",
  supplier: "TRUE VALUE",
  supplier_code: "TRV",
  name: "LG Mens Blizzard Glove",
  uom: "EA",
  uom_qty: "3",
  min_quantity: "3",
  quantity_increments: "3",
  zoro_minimum_qty: "12",
  price: "34.86"
};

const full = buildProduct(source);
assert.equal(full.uom, "EA");
assert.equal(full.uomQty, "3");
assert.equal(full.minQuantity, "3");
assert.equal(full.quantityIncrements, "3");

const daily = buildRecord(source);
assert.equal(daily.uom, "EA");
assert.equal(daily.uom_qty, 3);
assert.equal(daily.minimum_quantity, 3);
assert.equal(daily.raw.uom, "EA");
assert.equal(daily.raw.uomQty, 3);
assert.equal(daily.raw.minQuantity, 3);
assert.equal(daily.raw.quantityIncrements, 3);
assert.equal(daily.raw.zoroMinimumQty, undefined, "channel minimums must not become supplier purchasing rules");

console.log("product dump UOM field checks passed");
