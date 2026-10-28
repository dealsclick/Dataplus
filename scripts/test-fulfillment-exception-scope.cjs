const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const fulfillmentSource = fs.readFileSync(path.join(root, "web", "src", "components", "fulfillment-route.tsx"), "utf8");

test("fulfillment exceptions are limited to current unfulfilled orders", () => {
  assert.match(serverSource, /if \(orderIsReportingOnly\(order\) \|\| isTerminalCustomerDemand\(order\)\) continue/);
  assert.match(serverSource, /activeFulfillmentOrders = orders\.filter\(\(order\) => !orderIsReportingOnly\(order\) && !isTerminalCustomerDemand\(order\)\)/);
  assert.match(serverSource, /const orderExceptions = activeFulfillmentOrders\.flatMap/);
  assert.match(serverSource, /activeFulfillmentOrderIds\.has\(String\(row\.orderId \|\| ""\)\)/);
  assert.match(serverSource, /\["failed", "blocked"\]\.includes\(String\(row\.status \|\| ""\)\.toLowerCase\(\)\) && !row\.releasedAt/);
});

test("incremental batch projection cannot reinsert unrelated exception rows", () => {
  const batchStart = serverSource.indexOf("const batchExceptions =");
  const batchEnd = serverSource.indexOf("const trackingExceptions =", batchStart);
  const batchSource = serverSource.slice(batchStart, batchEnd);
  assert.match(batchSource, /activeFulfillmentOrderIds\.has/);
  assert.match(batchSource, /!row\.releasedAt/);
});

test("marketplace cancellation evidence closes fulfillment demand", () => {
  const statusStart = serverSource.indexOf("function orderExternalStatusValues");
  const statusEnd = serverSource.indexOf("function orderTerminalDemandReason", statusStart);
  const statusSource = serverSource.slice(statusStart, statusEnd);
  assert.match(statusSource, /external\.cancelStatus\?\.cancelState/);
  assert.match(statusSource, /marketplaceCancellation\.status/);
  assert.match(serverSource, /order\.cancelledAt \|\| order\.canceledAt/);
});

test("fulfillment cancellation queue contains only shipment recovery", () => {
  assert.match(serverSource, /!disposition \|\| disposition\.kind !== "recovery_required"/);
  assert.match(fulfillmentSource, /Shipment cancellations/);
  assert.match(fulfillmentSource, /Ordinary cancellations remain in Orders/);
  assert.doesNotMatch(fulfillmentSource, /Do Not Ship &amp; Recovery/);
});

