const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const dbSource = fs.readFileSync(path.join(root, "db.js"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "web", "src", "App.tsx"), "utf8");

test("compact order summaries retain manually saved shipment packages", () => {
  assert.match(dbSource, /'package', case when jsonb_typeof\(route->'package'\) = 'object'/);
  assert.match(dbSource, /'packageMeasurementSource', route->'packageMeasurementSource'/);
  assert.match(dbSource, /summary_raw\.package[\s\S]{0,120}as fulfillment_package/);
  assert.match(dbSource, /package: row\.fulfillment_package/);
  assert.match(dbSource, /packageMeasurementSource: row\.package_measurement_source/);
});

test("uncataloged fulfillment rows remain eligible for shipment package entry", () => {
  assert.match(serverSource, /hasCatalogProduct: Boolean\(routeProduct\)/);
  assert.match(appSource, /This item is not in the catalog\. These measurements will still be saved for this shipment and used to request rates\./);
  assert.match(appSource, /packageRow\?\.hasCatalogProduct === true/);
});

test("a missing catalog default cannot reject a shipment package save", () => {
  const route = serverSource.slice(serverSource.indexOf('parts[3] === "fulfillment-package"'), serverSource.indexOf('parts[2] === "exceptions"'));
  assert.doesNotMatch(route, /if \(!product\) return sendJson/);
  assert.match(route, /Shipment package saved\. A reusable catalog default was not saved/);
  assert.match(route, /await postgres\.saveOrder\(order\)/);
});
