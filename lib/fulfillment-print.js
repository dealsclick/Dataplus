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
  const fontSize = compact ? 7.5 : 9;
  let y = page.getHeight() - margin;
  page.drawText("DealsClick", { x: margin, y, size: compact ? 16 : 21, font: fonts.bold, color: rgb(0.08, 0.09, 0.11) });
  const slipHeading = "PACKING SLIP";
  page.drawText(slipHeading, { x: page.getWidth() - margin - fonts.bold.widthOfTextAtSize(slipHeading, compact ? 9 : 12), y: y + 2, size: compact ? 9 : 12, font: fonts.bold, color: rgb(0.3, 0.32, 0.35) });
  y -= compact ? 23 : 31;
  page.drawLine({ start: { x: margin, y }, end: { x: margin + width, y }, thickness: 1.2, color: rgb(0.08, 0.09, 0.11) });

  const summaryTop = y - (compact ? 17 : 23);
  page.drawText("SHIP TO", { x: margin, y: summaryTop, size: fontSize, font: fonts.bold, color: rgb(0.3, 0.32, 0.35) });
  const detailX = compact ? margin + 132 : margin + 320;
  page.drawText("ORDER", { x: detailX, y: summaryTop, size: fontSize, font: fonts.bold, color: rgb(0.3, 0.32, 0.35) });
  let addressY = summaryTop - (compact ? 14 : 18);
  for (const line of addressLines(entry).slice(0, compact ? 6 : 7)) {
    page.drawText(line.slice(0, compact ? 27 : 48), { x: margin, y: addressY, size: fontSize, font: fonts.font });
    addressY -= compact ? 11 : 14;
  }
  const details = [
    [`Order #`, text(entry.orderNumber || entry.orderId)],
    ["Date", text(entry.orderDate) || "Not provided"],
    ["Shipping", text(entry.shippingMethod || entry.service) || "Not provided"]
  ];
  let detailY = summaryTop - (compact ? 14 : 18);
  for (const [label, value] of details) {
    page.drawText(`${label}:`, { x: detailX, y: detailY, size: fontSize, font: fonts.bold });
    const valueLines = compact && label === "Shipping" ? wrappedLines(value, 16).slice(0, 2) : [String(value).slice(0, compact ? 18 : 38)];
    valueLines.forEach((line, index) => page.drawText(line, { x: detailX + (compact ? 38 : 56), y: detailY - index * (compact ? 10 : 13), size: fontSize, font: fonts.font }));
    detailY -= (compact ? 13 : 17) + Math.max(0, valueLines.length - 1) * (compact ? 10 : 13);
  }
  y = Math.min(addressY, detailY) - (compact ? 12 : 20);

  page.drawLine({ start: { x: margin, y: y + (compact ? 13 : 17) }, end: { x: margin + width, y: y + (compact ? 13 : 17) }, thickness: 0.8, color: rgb(0.35, 0.37, 0.4) });
  if (compact) {
    page.drawText("PRODUCT", { x: margin, y, size: fontSize, font: fonts.bold });
    page.drawText("QTY", { x: margin + width - 22, y, size: fontSize, font: fonts.bold });
    y -= 9;
    for (const line of entry.lines || []) {
      const titleLines = wrappedLines(line.title || line.name || line.sku, 43).slice(0, 2);
      const rowHeight = 25 + titleLines.length * 9;
      if (y - rowHeight < margin + 22) break;
      y -= 13;
      titleLines.forEach((title, index) => page.drawText(title, { x: margin, y: y - index * 9, size: 7.5, font: index === 0 ? fonts.bold : fonts.font }));
      page.drawText(String(Number(line.qty || line.quantity || 0)), { x: margin + width - 16, y, size: 9, font: fonts.bold });
      y -= titleLines.length * 9 + 2;
      const metadata = [`Mfr SKU: ${text(line.manufacturerSku || line.mfrPartNumber) || "-"}`, `Brand: ${text(line.brand) || "-"}`].join("  |  ");
      page.drawText(metadata.slice(0, 58), { x: margin, y, size: 6.5, font: fonts.font, color: rgb(0.35, 0.37, 0.4) });
      y -= 10;
      page.drawLine({ start: { x: margin, y }, end: { x: margin + width, y }, thickness: 0.4, color: rgb(0.82, 0.83, 0.85) });
    }
  } else {
    const titleX = margin;
    const mfrX = margin + 290;
    const brandX = margin + 405;
    const qtyX = margin + width - 26;
    page.drawText("PRODUCT", { x: titleX, y, size: fontSize, font: fonts.bold });
    page.drawText("MANUFACTURER SKU", { x: mfrX, y, size: fontSize, font: fonts.bold });
    page.drawText("BRAND", { x: brandX, y, size: fontSize, font: fonts.bold });
    page.drawText("QTY", { x: qtyX, y, size: fontSize, font: fonts.bold });
    y -= 10;
    page.drawLine({ start: { x: margin, y }, end: { x: margin + width, y }, thickness: 0.8, color: rgb(0.35, 0.37, 0.4) });
    for (const line of entry.lines || []) {
      if (y < margin + 48) break;
      const titleLines = wrappedLines(line.title || line.name || line.sku, 50).slice(0, 2);
      const rowHeight = Math.max(34, titleLines.length * 12 + 15);
      y -= 14;
      titleLines.forEach((title, index) => page.drawText(title, { x: titleX, y: y - index * 11, size: 8.5, font: index === 0 ? fonts.bold : fonts.font }));
      page.drawText(text(line.manufacturerSku || line.mfrPartNumber || "-").slice(0, 20), { x: mfrX, y, size: 8.5, font: fonts.font });
      page.drawText(text(line.brand || "-").slice(0, 18), { x: brandX, y, size: 8.5, font: fonts.font });
      page.drawText(String(Number(line.qty || line.quantity || 0)), { x: qtyX + 4, y, size: 9, font: fonts.bold });
      y -= rowHeight;
      page.drawLine({ start: { x: margin, y: y + 8 }, end: { x: margin + width, y: y + 8 }, thickness: 0.4, color: rgb(0.82, 0.83, 0.85) });
    }
  }
  page.drawText("Thank you for shopping with DealsClick.", { x: margin, y: margin + 5, size: compact ? 7 : 9, font: fonts.bold, color: rgb(0.3, 0.32, 0.35) });
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

function printJobsByBatchId(printQueue = []) {
  const jobs = new Map();
  for (const job of printQueue) {
    const batchId = text(job.batchId);
    if (!batchId || job.kind === "test_page" || jobs.has(batchId)) continue;
    jobs.set(batchId, job);
  }
  return jobs;
}

module.exports = { buildLabelPacket, buildPrintPreview, attachmentFilePath, printJobsByBatchId };
