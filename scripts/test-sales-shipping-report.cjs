const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const db = read("db.js");
const server = read("server.js");
const app = read("web/src/App.tsx");
const component = read("web/src/components/sales-shipping-report.tsx");
const docs = read("docs/shipping-report.md");

test("shipping reporting keeps revenue, estimates, and actual cost distinct", () => {
  assert.match(db, /order_shipping_revenue \/ active_shipment_count as allocated_shipping_revenue/);
  assert.match(db, /when actual_shipping_cost is not null then actual_shipping_cost else greatest/);
  assert.match(db, /coalesce\(estimated_shipping_cost, 0\) - coalesce\(refunded_cost, 0\)/);
  assert.match(db, /order_shipping_adjustments \/ active_shipment_count as allocated_adjustment/);
  assert.match(db, /actual_shipping_cost - greatest/);
});

test("shipping reporting is bounded and supports the expected audit filters", () => {
  assert.match(db, /salesShippingReportingSummary/);
  assert.match(db, /salesShippingReportingShipments/);
  assert.match(db, /statement_timeout = '45s'/);
  assert.match(db, /exportAll \? 25000/);
  assert.match(db, /includeVoided/);
  assert.match(db, /destinationState/);
  assert.match(db, /billingStatus/);
  assert.match(db, /costBasis/);
});

test("shipping routes expose summary, paginated ledger, and CSV export", () => {
  assert.match(server, /\/api\/reports\/sales\/shipping\/export\.csv/);
  assert.match(server, /\/api\/reports\/sales\/shipping\/shipments/);
  assert.match(server, /\/api\/reports\/sales\/shipping"/);
  assert.match(server, /This export contains.*Narrow the date range or filters below 25,000 rows/);
  assert.match(server, /Customer shipping collected \(allocated\)/);
  assert.match(server, /Reconciled actual cost/);
});

test("new React Sales Reports loads the shipping workspace lazily", () => {
  assert.match(app, /const SalesShippingReport = lazy/);
  assert.match(app, /TabsTrigger value="shipping">Shipping/);
  assert.match(app, /<SalesShippingReport/);
  assert.match(component, /Shipping report/);
  assert.match(component, /Shipment ledger/);
  assert.match(component, /Shipping profitability/);
  assert.match(component, /Export shipment CSV/);
  assert.match(component, /Carrier invoices are not reconciled yet/);
});

test("shipping product allocation and accounting rules are documented", () => {
  assert.match(db, /when order_product_sales > 0 then product_sales \/ order_product_sales/);
  assert.match(db, /when order_qty > 0 then qty \/ order_qty/);
  assert.match(docs, /Customer-paid shipping is revenue/);
  assert.match(docs, /Purchased label cost is an estimate/);
  assert.match(docs, /Reconciled actual cost replaces the estimate/);
  assert.match(docs, /Voided labels are excluded by default/);
});

