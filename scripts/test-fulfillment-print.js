const test = require("node:test");
const assert = require("node:assert/strict");
const { PDFDocument } = require("pdf-lib");
const { buildLabelPacket } = require("../lib/fulfillment-print");

test("empty print queue still produces an explanatory PDF", async () => {
  const result = await buildLabelPacket([]);
  const pdf = await PDFDocument.load(result.buffer);
  assert.equal(pdf.getPageCount(), 1);
  assert.deepEqual(result.failures, []);
});
