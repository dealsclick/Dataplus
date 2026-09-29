const test = require("node:test");
const assert = require("node:assert/strict");
const { PDFDocument } = require("pdf-lib");
const { PAGE_SIZES, buildReturnLabelPrintPacket } = require("../lib/return-label-print");

async function sampleLabel() {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]).drawText("Carrier label");
  return Buffer.from(await pdf.save());
}

test("creates a 4x6 carrier page and instruction label", async () => {
  const packet = await buildReturnLabelPrintPacket({ label: await sampleLabel(), size: "4x6", includeInstructions: true, details: { returnNumber: "RET-DC8479", orderNumber: "DC8479", carrier: "UPS" } });
  const pdf = await PDFDocument.load(packet);
  assert.equal(pdf.getPageCount(), 2);
  for (const page of pdf.getPages()) assert.deepEqual([page.getWidth(), page.getHeight()], PAGE_SIZES["4x6"]);
});

test("letter packet can omit instructions", async () => {
  const packet = await buildReturnLabelPrintPacket({ label: await sampleLabel(), size: "letter", includeInstructions: false });
  const pdf = await PDFDocument.load(packet);
  assert.equal(pdf.getPageCount(), 1);
  assert.deepEqual([pdf.getPage(0).getWidth(), pdf.getPage(0).getHeight()], PAGE_SIZES.letter);
});

test("original preserves the carrier page dimensions for its instruction page", async () => {
  const packet = await buildReturnLabelPrintPacket({ label: await sampleLabel(), size: "original", includeInstructions: true });
  const pdf = await PDFDocument.load(packet);
  assert.equal(pdf.getPageCount(), 2);
  assert.deepEqual([pdf.getPage(1).getWidth(), pdf.getPage(1).getHeight()], [612, 792]);
});
