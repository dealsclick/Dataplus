const assert = require("node:assert/strict");
const fs = require("node:fs");

const dbSource = fs.readFileSync("db.js", "utf8");
const serverSource = fs.readFileSync("server.js", "utf8");
const uiSource = fs.readFileSync("web/src/App.tsx", "utf8");

assert.match(
  dbSource,
  /if \(options\.replaceAliases === true && products\.length\)/,
  "ordinary product upserts must preserve aliases"
);
assert.doesNotMatch(
  dbSource,
  /if \(products\.length\) \{\s+for \(let i = 0; i < products\.length; i \+= batchSize\) \{\s+await client\.query\("delete from product_aliases/,
  "alias replacement must require an explicit option"
);
assert.match(serverSource, /const soldAsQty = Number\(body\.soldAsQty/);
assert.match(serverSource, /soldAsQty > 1 && body\.confirmPieceInventory !== true/);
assert.match(serverSource, /type: soldAsQty > 1[^\n]+"sell-unit"/);
assert.match(serverSource, /item\.inventoryTrackingMode = "piece"/);
assert.match(serverSource, /skuAliases: \(routeProduct\?\.aliases \|\| \[\]\)/);
assert.match(serverSource, /sellingUnitSkus: systemProductVariants\(routeProduct \|\| \{\}\)/);
assert.match(serverSource, /\["sell-unit", "sold-as", "purchase-unit"\]/);
assert.match(serverSource, /item: publicInventoryItem\(refreshedItem\), alias, ordersRemapped/);

assert.match(uiSource, /Add sold-as option/);
assert.match(uiSource, /Pieces per sale/);
assert.match(uiSource, /soldAsQty: relationshipMode === "selling-unit"/);
assert.match(uiSource, /current warehouse inventory is already counted as individual pieces/);

console.log("Product alias and sold-as unit regression checks passed.");
