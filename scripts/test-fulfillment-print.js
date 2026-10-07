const test = require("node:test");
const assert = require("node:assert/strict");
const { PDFDocument } = require("pdf-lib");
const { buildLabelPacket, buildPrintPreview, printJobsByBatchId, packingSlipChannel, sortPrintEntriesByCarrier } = require("../lib/fulfillment-print");

test("packing slip presents Shopify as the DealsClick storefront", () => {
  assert.equal(packingSlipChannel({ channel: "Shopify" }), "dealsclick.com");
  assert.equal(packingSlipChannel({ channel: "Temu" }), "Temu");
});

test("print job index never associates printer tests or empty batch IDs with shipments", () => {
  const jobs = printJobsByBatchId([
    { id: "test", kind: "test_page" },
    { id: "empty" },
    { id: "newest", batchId: "batch-1" },
    { id: "older", batchId: "batch-1" }
  ]);
  assert.equal(jobs.has(""), false);
  assert.equal(jobs.size, 1);
  assert.equal(jobs.get("batch-1").id, "newest");
});

test("batch print entries are grouped by carrier and then order number", () => {
  const sorted = sortPrintEntriesByCarrier([
    { orderNumber: "102", carrierName: "USPS" },
    { orderNumber: "100", carrierName: "UPS" },
    { orderNumber: "99", carrierName: "FedEx Ground" },
    { orderNumber: "101", carrierName: "USPS" },
    { orderNumber: "98", carrierName: "UPS Ground" }
  ]);
  assert.deepEqual(sorted.map((entry) => entry.orderNumber), ["99", "98", "100", "101", "102"]);
});

test("empty print queue still produces an explanatory PDF", async () => {
  const result = await buildLabelPacket([]);
  const pdf = await PDFDocument.load(result.buffer);
  assert.equal(pdf.getPageCount(), 1);
  assert.deepEqual(result.failures, []);
});

test("print preview includes a sample label and packing slip at the selected size", async () => {
  const buffer = await buildPrintPreview([{
    orderId: "ORDER-1",
    orderNumber: "41003",
    channelOrderId: "211-123456789",
    orderDate: "2026-09-30",
    customer: "Test Customer",
    channel: "Temu",
    batchId: "BATCH-1008",
    address: { line1: "388 South Ave", city: "Staten Island", state: "NY", postalCode: "10303", country: "US" },
    lines: [{ sku: "SKU-1", title: "Test product", qty: 2 }]
  }], { size: "4x6", includePackingSlips: true });
  const pdf = await PDFDocument.load(buffer);
  assert.equal(pdf.getPageCount(), 2);
  assert.equal(pdf.getPage(0).getWidth(), 288);
  assert.equal(pdf.getPage(0).getHeight(), 432);
  assert.equal(pdf.getPage(1).getWidth(), 288);
  assert.equal(pdf.getPage(1).getHeight(), 432);
});

test("4x6 packing slips can use portrait orientation", async () => {
  const buffer = await buildPrintPreview([{
    orderId: "ORDER-2",
    orderNumber: "41004",
    channelOrderId: "211-987654321",
    address: { name: "Test Customer", line1: "1 Main St", city: "Staten Island", state: "NY", postalCode: "10303" },
    lines: [{ sku: "SKU-2", title: "Portrait packing slip item", qty: 1 }]
  }], { size: "4x6", includePackingSlips: true, packingSlipOrientation: "portrait" });
  const pdf = await PDFDocument.load(buffer);
  assert.equal(pdf.getPage(1).getWidth(), 288);
  assert.equal(pdf.getPage(1).getHeight(), 432);
});
