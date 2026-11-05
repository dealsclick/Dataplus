const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PDFDocument } = require("pdf-lib");
const { buildLabelPacket, buildPrintPreview, printJobsByBatchId, packingSlipChannel, packingSlipTypography, printSkuGroup, sortPrintEntriesByCarrier } = require("../lib/fulfillment-print");
const { buildLabelPacketIsolated } = require("../lib/isolated-fulfillment-print");

test("packing slip presents Shopify as the DealsClick storefront", () => {
  assert.equal(packingSlipChannel({ channel: "Shopify" }), "dealsclick.com");
  assert.equal(packingSlipChannel({ channel: "Temu" }), "Temu");
});

test("packing slip item titles are more prominent than product metadata", () => {
  for (const options of [
    { size: "4x6", packingSlipOrientation: "portrait" },
    { size: "4x6", packingSlipOrientation: "landscape" },
    { size: "letter", packingSlipOrientation: "portrait" }
  ]) {
    const typography = packingSlipTypography(options);
    assert.ok(typography.itemTitleFontSize > typography.itemMetadataFontSize);
    assert.ok(typography.itemTitleFontSize > typography.productHeaderFontSize);
  }
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

test("batch print entries are grouped by carrier, SKU, and then order number", () => {
  const sorted = sortPrintEntriesByCarrier([
    { orderNumber: "102", carrierName: "USPS", lines: [{ sku: "SKU-2" }] },
    { orderNumber: "100", carrierName: "UPS", lines: [{ sku: "SKU-2" }] },
    { orderNumber: "99", carrierName: "FedEx Ground", lines: [{ sku: "SKU-9" }] },
    { orderNumber: "103", carrierName: "USPS", lines: [{ sku: "SKU-1" }] },
    { orderNumber: "101", carrierName: "USPS", lines: [{ sku: "SKU-1" }] },
    { orderNumber: "98", carrierName: "UPS Ground", lines: [{ sku: "SKU-10" }] }
  ]);
  assert.deepEqual(sorted.map((entry) => entry.orderNumber), ["99", "100", "98", "101", "103", "102"]);
});

test("multi-item orders use a stable sorted SKU group and stay together", () => {
  assert.equal(printSkuGroup({ lines: [{ sku: "sku-12" }, { sku: "SKU-2" }, { sku: "sku-12" }] }), "SKU-2|SKU-12");
  assert.equal(printSkuGroup({ lines: [] }), "~NO-SKU");
});

test("empty print queue still produces an explanatory PDF", async () => {
  const result = await buildLabelPacket([]);
  const pdf = await PDFDocument.load(result.buffer);
  assert.equal(pdf.getPageCount(), 1);
  assert.deepEqual(result.failures, []);
});

test("purchased labels are assembled by the isolated print worker", async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dataplus-print-test-"));
  const labelPath = path.join(directory, "label.pdf");
  try {
    const source = await PDFDocument.create();
    source.addPage([288, 432]);
    await fs.promises.writeFile(labelPath, await source.save());
    const result = await buildLabelPacketIsolated([{ orderId: "ORDER-1", orderNumber: "1", filePath: labelPath, mimeType: "application/pdf", lines: [] }], { size: "4x6", includePackingSlips: false });
    const packet = await PDFDocument.load(result.buffer);
    assert.equal(packet.getPageCount(), 1);
    assert.deepEqual(result.failures, []);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

test("carrier PDF pages are normalized to the selected 4x6 print size", async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dataplus-print-size-test-"));
  const labelPath = path.join(directory, "temu-label.pdf");
  try {
    const source = await PDFDocument.create();
    const sourcePage = source.addPage([284, 426]);
    sourcePage.drawRectangle({ x: 8, y: 8, width: 268, height: 410, borderWidth: 1 });
    await fs.promises.writeFile(labelPath, await source.save());
    const result = await buildLabelPacketIsolated([{ orderId: "ORDER-PR", orderNumber: "88617", filePath: labelPath, mimeType: "application/pdf", lines: [] }], { size: "4x6", includePackingSlips: false });
    const packet = await PDFDocument.load(result.buffer);
    assert.equal(packet.getPageCount(), 1);
    assert.equal(packet.getPage(0).getWidth(), 288);
    assert.equal(packet.getPage(0).getHeight(), 432);
    assert.deepEqual(result.failures, []);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
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

test("packing slips normalize marketplace text that the built-in PDF font cannot encode", async () => {
  const buffer = await buildPrintPreview([{
    orderId: "ORDER-UNICODE",
    orderNumber: "54157",
    channelOrderId: "211-14166413691512376",
    customer: "Test Customer",
    channel: "Temu",
    batchId: "BATCH-1093",
    address: { line1: "47 Hillcrest Ave", city: "Edison", state: "NJ", postalCode: "08817" },
    lines: [{ sku: "BUS143999TRV", title: "Espoma GSUL6 6磅土壤酸化剂", qty: 2 }]
  }], { size: "4x6", includePackingSlips: true, packingSlipOrientation: "portrait" });
  const pdf = await PDFDocument.load(buffer);
  assert.equal(pdf.getPageCount(), 2);
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

test("one shared label produces one packing slip containing every grouped order", async () => {
  const buffer = await buildPrintPreview([{
    orderId: "ORDER-88353",
    orderNumber: "88353",
    orderNumbers: ["88353", "88328", "88338", "88341"],
    channelOrderIds: ["EBAY-88353", "EBAY-88328", "EBAY-88338", "EBAY-88341"],
    address: { name: "Combined Buyer", line1: "1 Main St", city: "Los Angeles", state: "CA", postalCode: "90044" },
    lines: [
      { orderId: "ORDER-88353", orderNumber: "88353", sku: "SKU-A", title: "First order item", qty: 1 },
      { orderId: "ORDER-88328", orderNumber: "88328", sku: "SKU-B", title: "Second order item", qty: 1 },
      { orderId: "ORDER-88338", orderNumber: "88338", sku: "SKU-C", title: "Third order item", qty: 1 },
      { orderId: "ORDER-88341", orderNumber: "88341", sku: "SKU-D", title: "Fourth order item", qty: 1 }
    ]
  }], { size: "4x6", includePackingSlips: true, packingSlipOrientation: "portrait" });
  const pdf = await PDFDocument.load(buffer);
  assert.equal(pdf.getPageCount(), 3);
});
