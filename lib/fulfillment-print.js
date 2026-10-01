const fs = require("node:fs");
const path = require("node:path");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

async function appendDocument(output, input, mimeType = "application/pdf", size = "4x6") {
  if (mimeType === "application/pdf") {
    const source = await PDFDocument.load(input);
    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach((page) => output.addPage(page));
    return;
  }
  const pageSize = size === "letter" ? [612, 792] : [288, 432];
  const page = output.addPage(pageSize);
  const image = mimeType === "image/png" ? await output.embedPng(input) : await output.embedJpg(input);
  const scale = Math.min(pageSize[0] / image.width, pageSize[1] / image.height);
  page.drawImage(image, { x: (pageSize[0] - image.width * scale) / 2, y: (pageSize[1] - image.height * scale) / 2, width: image.width * scale, height: image.height * scale });
}

function text(value) {
  return String(value || "").trim();
}

function wrappedLines(value, maxCharacters) {
  const words = text(value).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharacters) current = candidate;
    else {
      if (current) lines.push(current);
      current = word.slice(0, maxCharacters);
    }
  }
  if (current) lines.push(current);
  return lines;
}

function addressLines(entry = {}) {
  const address = entry.address || {};
  return [
    text(address.name || entry.customer),
    text(address.company),
    text(address.line1 || address.address1),
    text(address.line2 || address.address2),
    [text(address.city), text(address.state || address.province), text(address.postalCode || address.zip)].filter(Boolean).join(", "),
    text(address.country || address.countryCode)
  ].filter(Boolean);
}

function drawPackingSlip(output, entry, options, fonts) {
  const compact = options.size === "4x6";
  const page = output.addPage(compact ? [288, 432] : [612, 792]);
  const margin = compact ? 18 : 42;
  const width = page.getWidth() - margin * 2;
  const fontSize = compact ? 7.5 : 9.5;
  const rowHeight = compact ? 34 : 40;
  let y = page.getHeight() - margin;
  page.drawText("DATAPLUS", { x: margin, y, size: compact ? 14 : 18, font: fonts.bold, color: rgb(0.05, 0.2, 0.38) });
  page.drawText("PACKING SLIP", { x: page.getWidth() - margin - (compact ? 82 : 112), y: y + 1, size: compact ? 9 : 12, font: fonts.bold });
  y -= compact ? 22 : 28;
  page.drawLine({ start: { x: margin, y }, end: { x: margin + width, y }, thickness: 1, color: rgb(0.75, 0.78, 0.82) });
  y -= compact ? 18 : 24;
  page.drawText(`Order ${text(entry.orderNumber || entry.orderId)}`, { x: margin, y, size: compact ? 10 : 13, font: fonts.bold });
  page.drawText(text(entry.channel || "Manual"), { x: page.getWidth() - margin - 70, y, size: fontSize, font: fonts.font });
  y -= compact ? 15 : 20;
  page.drawText(`Ordered: ${text(entry.orderDate) || "Not provided"}`, { x: margin, y, size: fontSize, font: fonts.font, color: rgb(0.3, 0.32, 0.35) });
  y -= compact ? 20 : 28;
  page.drawText("SHIP TO", { x: margin, y, size: fontSize, font: fonts.bold, color: rgb(0.3, 0.32, 0.35) });
  for (const line of addressLines(entry).slice(0, compact ? 4 : 6)) {
    y -= compact ? 11 : 14;
    page.drawText(line.slice(0, compact ? 42 : 78), { x: margin, y, size: fontSize, font: fonts.font });
  }
  y -= compact ? 20 : 28;
  page.drawText("QTY", { x: margin, y, size: fontSize, font: fonts.bold });
  page.drawText("SKU / ITEM", { x: margin + (compact ? 30 : 48), y, size: fontSize, font: fonts.bold });
  y -= compact ? 8 : 10;
  page.drawLine({ start: { x: margin, y }, end: { x: margin + width, y }, thickness: 0.7, color: rgb(0.75, 0.78, 0.82) });
  for (const line of entry.lines || []) {
    if (y < margin + (compact ? 52 : 70)) break;
    y -= rowHeight;
    page.drawText(String(Number(line.qty || line.quantity || 0)), { x: margin, y: y + rowHeight - (compact ? 12 : 15), size: compact ? 11 : 13, font: fonts.bold });
    page.drawText(text(line.sku || "No SKU").slice(0, compact ? 28 : 48), { x: margin + (compact ? 30 : 48), y: y + rowHeight - (compact ? 11 : 14), size: fontSize, font: fonts.bold });
    const titleLines = wrappedLines(line.title || line.name, compact ? 38 : 76).slice(0, 2);
    titleLines.forEach((title, index) => page.drawText(title, { x: margin + (compact ? 30 : 48), y: y + rowHeight - (compact ? 22 : 28) - index * (compact ? 9 : 11), size: compact ? 6.5 : 8.5, font: fonts.font, color: rgb(0.3, 0.32, 0.35) }));
    page.drawLine({ start: { x: margin, y }, end: { x: margin + width, y }, thickness: 0.4, color: rgb(0.86, 0.87, 0.89) });
  }
  page.drawText("Thank you for your order.", { x: margin, y: margin + 22, size: fontSize, font: fonts.bold });
  page.drawText("Verify item quantities before sealing the package.", { x: margin, y: margin + 8, size: compact ? 6.5 : 8, font: fonts.font, color: rgb(0.35, 0.37, 0.4) });
}

function drawPreviewLabel(output, entry, options, fonts) {
  const page = output.addPage(options.size === "letter" ? [612, 792] : [288, 432]);
  const margin = options.size === "letter" ? 54 : 18;
  const width = page.getWidth() - margin * 2;
  page.drawRectangle({ x: margin, y: margin, width, height: page.getHeight() - margin * 2, borderWidth: 2, borderColor: rgb(0.15, 0.18, 0.22) });
  page.drawText("PRINT LAYOUT PREVIEW", { x: margin + 14, y: page.getHeight() - margin - 36, size: options.size === "letter" ? 22 : 14, font: fonts.bold, color: rgb(0.65, 0.08, 0.08) });
  page.drawText("NOT POSTAGE - NO LABEL HAS BEEN PURCHASED", { x: margin + 14, y: page.getHeight() - margin - 58, size: options.size === "letter" ? 11 : 7, font: fonts.bold });
  page.drawText(`Order ${text(entry.orderNumber || entry.orderId)}`, { x: margin + 14, y: page.getHeight() - margin - 98, size: options.size === "letter" ? 18 : 12, font: fonts.bold });
  let y = page.getHeight() - margin - 126;
  for (const line of addressLines(entry)) {
    page.drawText(line.slice(0, options.size === "letter" ? 78 : 42), { x: margin + 14, y, size: options.size === "letter" ? 11 : 8, font: fonts.font });
    y -= options.size === "letter" ? 17 : 12;
  }
  page.drawRectangle({ x: margin + 14, y: margin + 42, width: width - 28, height: options.size === "letter" ? 150 : 92, color: rgb(0.94, 0.95, 0.96) });
  page.drawText("Carrier barcode and tracking number", { x: margin + 28, y: margin + (options.size === "letter" ? 115 : 82), size: options.size === "letter" ? 14 : 8, font: fonts.bold, color: rgb(0.35, 0.37, 0.4) });
  page.drawText("will appear here after purchase.", { x: margin + 28, y: margin + (options.size === "letter" ? 92 : 66), size: options.size === "letter" ? 12 : 7, font: fonts.font, color: rgb(0.35, 0.37, 0.4) });
}

async function buildLabelPacket(entries = [], options = {}) {
  const output = await PDFDocument.create();
  const font = await output.embedFont(StandardFonts.Helvetica);
  const bold = await output.embedFont(StandardFonts.HelveticaBold);
  const failures = [];
  for (const entry of entries) {
    try {
      if (!entry.filePath || !fs.existsSync(entry.filePath)) throw new Error("Label document is missing.");
      await appendDocument(output, fs.readFileSync(entry.filePath), entry.mimeType, options.size);
      if (options.includePackingSlips) drawPackingSlip(output, entry, options, { font, bold });
    } catch (error) {
      failures.push({ orderId: entry.orderId, message: error.message });
    }
  }
  if (!output.getPageCount()) {
    const page = output.addPage([612, 792]);
    page.drawText("No printable labels are available in this batch.", { x: 42, y: 744, size: 16, font: bold });
  }
  return { buffer: Buffer.from(await output.save()), failures };
}

async function buildPrintPreview(entries = [], options = {}) {
  const output = await PDFDocument.create();
  const font = await output.embedFont(StandardFonts.Helvetica);
  const bold = await output.embedFont(StandardFonts.HelveticaBold);
  for (const entry of entries.slice(0, 10)) {
    drawPreviewLabel(output, entry, options, { font, bold });
    if (options.includePackingSlips) drawPackingSlip(output, entry, options, { font, bold });
  }
  if (!output.getPageCount()) {
    const page = output.addPage([612, 792]);
    page.drawText("Select at least one fulfillment order to preview printing.", { x: 42, y: 744, size: 14, font: bold });
  }
  return Buffer.from(await output.save());
}

function attachmentFilePath(root, attachment = {}) {
  return attachment.storageKey ? path.join(root, attachment.storageKey) : "";
}

module.exports = { buildLabelPacket, buildPrintPreview, attachmentFilePath };
