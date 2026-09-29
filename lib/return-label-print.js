const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const PAGE_SIZES = {
  "4x6": [288, 432],
  letter: [612, 792]
};

function printableText(value) {
  return String(value ?? "").normalize("NFKD").replace(/[^\x20-\x7E]/g, "?").trim();
}

function wrappedLines(value, font, size, maxWidth) {
  const lines = [];
  for (const paragraph of printableText(value).split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(""); continue; }
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (!line || font.widthOfTextAtSize(next, size) <= maxWidth) line = next;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function drawFit(page, drawable, sourceWidth, sourceHeight, kind = "page") {
  const { width, height } = page.getSize();
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  if (kind === "image") page.drawImage(drawable, { x: (width - drawWidth) / 2, y: (height - drawHeight) / 2, width: drawWidth, height: drawHeight });
  else page.drawPage(drawable, { x: (width - drawWidth) / 2, y: (height - drawHeight) / 2, width: drawWidth, height: drawHeight });
}

async function addCarrierLabel(output, input, mimeType, requestedSize) {
  if (mimeType === "application/pdf") {
    const source = await PDFDocument.load(input);
    const pages = source.getPages();
    if (requestedSize === "original") {
      const copied = await output.copyPages(source, pages.map((_page, index) => index));
      copied.forEach((page) => output.addPage(page));
      const original = pages[0]?.getSize();
      return original ? [original.width, original.height] : PAGE_SIZES["4x6"];
    }
    const targetSize = PAGE_SIZES[requestedSize] || PAGE_SIZES["4x6"];
    for (let index = 0; index < pages.length; index += 1) {
      const [embedded] = await output.embedPdf(input, [index]);
      drawFit(output.addPage(targetSize), embedded, embedded.width, embedded.height);
    }
    return targetSize;
  }
  const image = mimeType === "image/png" ? await output.embedPng(input) : await output.embedJpg(input);
  const targetSize = requestedSize === "original" ? [image.width, image.height] : (PAGE_SIZES[requestedSize] || PAGE_SIZES["4x6"]);
  drawFit(output.addPage(targetSize), image, image.width, image.height, "image");
  return targetSize;
}

async function addInstructionLabel(output, size, details = {}) {
  const page = output.addPage(size);
  const regular = await output.embedFont(StandardFonts.Helvetica);
  const bold = await output.embedFont(StandardFonts.HelveticaBold);
  const compact = size[0] <= PAGE_SIZES["4x6"][0] + 1;
  const margin = compact ? 18 : 42;
  const titleSize = compact ? 15 : 20;
  const bodySize = compact ? 8.5 : 11;
  const lineHeight = bodySize * 1.34;
  let y = size[1] - margin - titleSize;
  const draw = (value, options = {}) => {
    const font = options.bold ? bold : regular;
    const fontSize = options.size || bodySize;
    for (const line of wrappedLines(value, font, fontSize, size[0] - (margin * 2))) {
      if (y < margin + lineHeight) break;
      page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0.08, 0.1, 0.12) });
      y -= options.lineHeight || lineHeight;
    }
  };
  draw("HOW TO SHIP YOUR RETURN", { bold: true, size: titleSize, lineHeight: titleSize * 1.35 });
  draw(`RMA: ${details.returnNumber || "-"}`, { bold: true });
  draw(`Order: ${details.orderNumber || "-"}`);
  if (details.carrier || details.trackingNumber) draw(`${details.carrier || "Carrier"}: ${details.trackingNumber || "See carrier label"}`);
  y -= lineHeight * 0.35;
  draw("1. Pack only the approved return items securely.");
  draw("2. Remove or fully cover every old shipping label and barcode.");
  draw("3. Attach the prepaid carrier label flat on the outside of the package.");
  draw(`4. Drop the package off with ${details.carrier || "the carrier shown on the label"}.`);
  draw("5. Keep the carrier receipt and tracking number until the return is completed.");
  if (details.instructions) { y -= lineHeight * 0.35; draw(details.instructions); }
  if (details.returnAddress) { y -= lineHeight * 0.35; draw("RETURN DESTINATION", { bold: true }); draw(details.returnAddress); }
  page.drawText("Place this instruction label inside the package.", { x: margin, y: margin, size: bodySize, font: bold, color: rgb(0.05, 0.35, 0.22) });
}

async function buildReturnLabelPrintPacket({ label, mimeType = "application/pdf", size = "4x6", includeInstructions = true, details = {} }) {
  if (!Buffer.isBuffer(label) || !label.length) throw new Error("The saved carrier label is empty.");
  const output = await PDFDocument.create();
  const normalizedSize = ["4x6", "letter", "original"].includes(size) ? size : "4x6";
  const instructionSize = await addCarrierLabel(output, label, mimeType, normalizedSize);
  if (includeInstructions) await addInstructionLabel(output, instructionSize, details);
  return Buffer.from(await output.save());
}

module.exports = { PAGE_SIZES, buildReturnLabelPrintPacket };
