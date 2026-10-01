const test = require("node:test");
const assert = require("node:assert/strict");
const { PDFDocument } = require("pdf-lib");
const { buildLabelPacket, buildPrintPreview } = require("../lib/fulfillment-print");

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
    orderDate: "2026-09-30",
    customer: "Test Customer",
    channel: "Temu",
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
