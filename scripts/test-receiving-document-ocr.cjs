const assert = require("assert");
const {
  defaultReceivingDocumentTemplate,
  normalizeReceivingDocumentTemplate,
  extractMappedLines,
  buildReceivingReview
} = require("../lib/receiving-document-ocr");

const vendor = { id: "true-value", name: "True Value", code: "TRV" };
const template = defaultReceivingDocumentTemplate(vendor);
assert.equal(template.templateKey, "true-value-carton-cross-reference-v1");
assert.equal(template.columns.quantity.label, "CTN QTY");

const normalized = normalizeReceivingDocumentTemplate({
  ...template,
  minimumConfidence: 150,
  columns: { ...template.columns, quantity: { label: "Qty", startPercent: 90, endPercent: 80 } }
}, vendor);
assert.equal(normalized.minimumConfidence, 100);
assert.equal(normalized.columns.quantity.startPercent, 80);
assert.equal(normalized.columns.quantity.endPercent, 90);

const headers = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext";
const rows = [
  "1\t1\t0\t0\t0\t0\t0\t0\t2000\t1200\t-1\t",
  "5\t1\t1\t1\t1\t1\t650\t300\t50\t20\t94\t172",
  "5\t1\t1\t1\t1\t2\t705\t300\t50\t20\t94\t083",
  "5\t1\t1\t1\t1\t3\t790\t300\t60\t20\t92\tAP16",
  "5\t1\t1\t1\t1\t4\t940\t300\t150\t20\t95\t00050197701167",
  "5\t1\t1\t1\t1\t5\t1120\t300\t70\t20\t91\tOrganic",
  "5\t1\t1\t1\t1\t6\t1200\t300\t50\t20\t91\tMix",
  "5\t1\t1\t1\t1\t7\t1540\t300\t20\t20\t96\t1",
  "5\t1\t1\t1\t1\t8\t1660\t300\t100\t20\t93\tD188419LNQ"
];
const extracted = extractMappedLines([headers, ...rows].join("\n"), template, vendor);
assert.equal(extracted.lines.length, 1);
assert.equal(extracted.lines[0].vendorItemNumber, "172 083");
assert.equal(extracted.lines[0].upc, "00050197701167");
assert.equal(extracted.lines[0].quantity, 1);

const review = buildReceivingReview({ supplierName: "True Value", lines: [{ sku: "BUS172083TRV", barcode: "50197701167", countedQty: 1 }] }, extracted, { templateKey: template.templateKey, documentsAnalyzed: ["photo-1"], documentCount: 1 });
assert.equal(review.lines.length, 1);
assert.equal(review.lines[0].status, "matched");
assert.equal(review.provider, "local-ocr");

console.log("receiving document OCR tests passed");
