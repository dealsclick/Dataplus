const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const dbSource = fs.readFileSync(path.join(root, "db.js"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const appSource = ["App.tsx", "components/fulfillment-route.tsx"].map((file) => fs.readFileSync(path.join(root, "web", "src", ...file.split("/")), "utf8")).join("\n");

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
  assert.match(route, /await postgres\.saveOrder\(member\)/);
});

test("shipment package edits persist the final carton across every combined order", () => {
  const route = serverSource.slice(serverSource.indexOf('parts[3] === "fulfillment-package"'), serverSource.indexOf('parts[2] === "exceptions"'));
  assert.match(route, /readOrdersByShipmentGroupId\(shipmentGroupId\)/);
  assert.match(route, /member\.shipmentGroupPackage = groupPackage/);
  assert.match(route, /memberRoute\.package = \{ \.\.\.\(memberRoute\.package \|\| \{\}\), \.\.\.packageInfo \}/);
  assert.match(route, /invalidateFulfillmentConsoleSnapshot\(affectedOrderIds\)/);
  assert.match(route, /const projectionUpdated = await drainFulfillmentConsoleProjectionPatches\(\)/);
  assert.match(route, /projectionUpdated, message:/);
});

test("bulk package edits save each shipment group once and retain active queue filters", () => {
  assert.match(appSource, /function fulfillmentPhysicalPackageKey/);
  assert.match(appSource, /if \(shipmentGroupId\) return `shipment-group:\$\{shipmentGroupId\}`/);
  assert.match(appSource, /const key = fulfillmentPhysicalPackageKey\(row\)/);
  assert.match(appSource, /const rowsToSave = shipmentGroupId \? packageRows\.slice\(0, 1\) : packageRows/);
  assert.match(appSource, /fulfillmentLoadRef\.current\(false, true\)/);
  assert.match(appSource, /setData\(\(current\) => \(\{ \.\.\.current, work: applyPackageValues\(current\.work\), allWork: applyPackageValues\(current\.allWork\) \}\)\)/);
  assert.match(appSource, /Package saved · ready for quote/);
  assert.match(appSource, /Ready to request rates\./);
  assert.doesNotMatch(appSource, /window\.setTimeout\(\(\) => void fulfillmentLoadRef\.current\(false, true\), 750\)/);
  assert.doesNotMatch(appSource, /if \(previousKey[\s\S]{0,300}await load\(false, true\)/);
  assert.match(appSource, /Edit combined shipment package/);
  assert.match(appSource, /Each combined group will use these values as its shared final carton for rates and one label\./);
});

test("combined shipments render and paginate as one physical package", () => {
  assert.match(appSource, /const key = fulfillmentPhysicalPackageKey\(row\)[\s\S]{0,120}groups\.set\(key/);
  assert.match(appSource, /function fulfillmentPackageOwnerRows/);
  assert.match(appSource, /flatMap\(\(packageRows\) => fulfillmentPackageOwnerRows\(packageRows\)\)/);
  assert.match(appSource, /FulfillmentShipmentGroupChildRow/);
  assert.match(appSource, /Quote once for this group/);
  assert.match(dbSource, /when coalesce\(data->>'shipmentGroupId', ''\) <> '' then 'shipment-group:' \|\| data->>'shipmentGroupId'/);
  assert.match(dbSource, /count\(distinct \(\$\{physicalGroupExpression\}\)\)/);
});

test("eligible shipment candidates render as one suggested cluster until dimensions create the group", () => {
  assert.match(appSource, /function fulfillmentSuggestedClusterOrderIds/);
  assert.match(appSource, /return orderIds\.length > 1 \? `suggested:\$\{orderIds\.join\("\|"\)\}` : ""/);
  assert.match(appSource, /const suggestedCombinedShipment = !persistedCombinedShipment/);
  assert.match(appSource, /"Suggested combination"/);
  assert.match(appSource, /Final combined package required/);
  assert.match(appSource, /shipment-group-candidates/);
  assert.match(appSource, /body: JSON\.stringify\(\{ orderIds: candidateOrderIds, \.\.\.packageValues, user: "Luis" \}\)/);
  assert.match(appSource, /!key\.startsWith\("suggested:"\)/);
});

test("shipment groups persist an explicit master order", () => {
  assert.match(serverSource, /const existingPrimaryOrderId = groupOrders/);
  assert.match(serverSource, /candidate\.shipmentGroupPrimaryOrderId = primaryOrderId/);
  assert.match(serverSource, /candidateRoute\.package = \{ \.\.\.\(candidateRoute\.package \|\| \{\}\), \.\.\.savedGroupPackage \}/);
  assert.match(serverSource, /shipmentGroupPrimaryOrderId: order\.shipmentGroupPrimaryOrderId \|\| order\.shipmentGroupOrderIds\?\.\[0\] \|\| ""/);
  assert.match(dbSource, /shipmentGroupPrimaryOrderId: row\.shipment_group_primary_order_id \|\| ''/);
  assert.match(dbSource, /"shipmentGroupOrderIds" jsonb,[\s\S]{0,80}"shipmentGroupPrimaryOrderId" text/);
});
