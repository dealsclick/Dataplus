const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const purchasingUi = fs.readFileSync(path.join(root, "web", "src", "components", "purchasing-workspaces.tsx"), "utf8");

function functionSource(name) {
  const start = server.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const bodyStart = server.indexOf(") {", start) + 2;
  let depth = 0;
  for (let index = bodyStart; index < server.length; index += 1) {
    if (server[index] === "{") depth += 1;
    if (server[index] === "}") depth -= 1;
    if (depth === 0) return server.slice(start, index + 1);
  }
  throw new Error(`Unable to extract ${name}`);
}

const context = { Set, Array };
vm.createContext(context);
vm.runInContext([
  functionSource("catalogProductIdentityKeys"),
  functionSource("sharedCatalogBarcodeProducts"),
].join("\n"), context);

const current = { id: "catalog-bus49221216d", sku: "BUS49221216D" };
const existingSupplierSku = { id: "catalog-dps10281", sku: "DPS10281" };
const shared = context.sharedCatalogBarcodeProducts({ products: [current, existingSupplierSku] }, current);
assert.deepEqual(JSON.parse(JSON.stringify(shared)), [existingSupplierSku], "the existing supplier SKU is retained as a shared UPC association");

assert.match(server, /parts\[4\] === "upc"[\s\S]*type: "upc_added_from_purchase_order"/, "purchase orders expose a missing-UPC route");
assert.match(server, /catalog_upc_added_from_purchase_order/, "a PO UPC update synchronizes its active receiving audit");
assert.match(server, /Receiving this PO will use \$\{productKey\}/, "the response confirms the supplier-specific PO SKU used for receiving");
assert.match(purchasingUi, /Add UPC/, "the PO line action menu exposes Add UPC");
assert.match(purchasingUi, /\/lines\/upc/, "the PO dialog saves through the purchase-order UPC endpoint");
assert.match(purchasingUi, /Shared UPCs are supported/, "the PO dialog explains shared physical UPC behavior");

console.log("Shared UPCs remain supplier-specific while audit and PO receiving stay synchronized.");
