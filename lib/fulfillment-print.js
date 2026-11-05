const fs = require("node:fs");
const path = require("node:path");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

async function appendDocument(output, input, mimeType = "application/pdf", size = "4x6") {
  if (mimeType === "application/pdf") {
    const source = await PDFDocument.load(input);
    if (size === "original") {
      const pages = await output.copyPages(source, source.getPageIndices());
      pages.forEach((page) => output.addPage(page));
      return;
    }
    const pageSize = size === "letter" ? [612, 792] : [288, 432];
    for (const sourcePage of source.getPages()) {
      const page = output.addPage(pageSize);
      if (!sourcePage.node.Contents()) continue;
      const embeddedPage = await output.embedPage(sourcePage);
      const scale = Math.min(pageSize[0] / embeddedPage.width, pageSize[1] / embeddedPage.height);
      const width = embeddedPage.width * scale;
      const height = embeddedPage.height * scale;
      page.drawPage(embeddedPage, {
        x: (pageSize[0] - width) / 2,
        y: (pageSize[1] - height) / 2,
        width,
        height
      });
    }
    return;
  }
  const pageSize = size === "letter" ? [612, 792] : [288, 432];
  const page = output.addPage(pageSize);
  const image = mimeType === "image/png" ? await output.embedPng(input) : await output.embedJpg(input);
  const scale = Math.min(pageSize[0] / image.width, pageSize[1] / image.height);
  page.drawImage(image, { x: (pageSize[0] - image.width * scale) / 2, y: (pageSize[1] - image.height * scale) / 2, width: image.width * scale, height: image.height * scale });
}

function text(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u00AE\u2122]/g, "")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wrappedLines(value, maxCharacters) {
  const words = text(value).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (word.length > maxCharacters) {
      if (current) lines.push(current);
      for (let offset = 0; offset < word.length; offset += maxCharacters) {
        const chunk = word.slice(offset, offset + maxCharacters);
        if (chunk.length === maxCharacters) lines.push(chunk);
        else current = chunk;
      }
      if (word.length % maxCharacters === 0) current = "";
      continue;
    }
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

function packingSlipChannel(entry = {}) {
  const channel = text(entry.channel || entry.channelSource || "Sales channel");
  return /shopify/i.test(channel) ? "dealsclick.com" : channel;
}

function packingSlipOrderNumbers(entry = {}) {
  const values = Array.isArray(entry.orderNumbers) && entry.orderNumbers.length
    ? entry.orderNumbers
    : [entry.orderNumber || entry.orderId];
  return [...new Set(values.map(text).filter(Boolean))];
}

function packingSlipChannelOrderNumbers(entry = {}) {
  const values = Array.isArray(entry.channelOrderIds) && entry.channelOrderIds.length
    ? entry.channelOrderIds
    : [entry.channelOrderId];
  return [...new Set(values.map(text).filter(Boolean))];
}

function printCarrierGroup(entry = {}) {
  const carrier = text(entry.carrierName || entry.carrier || entry.provider || entry.shippingMethod || "Other");
  if (/fed\s*ex/i.test(carrier)) return "01-fedex";
  if (/\bups\b/i.test(carrier)) return "02-ups";
  if (/usps|postal/i.test(carrier)) return "03-usps";
  if (/dhl/i.test(carrier)) return "04-dhl";
  return `99-${carrier.toLowerCase()}`;
}

function printSkuGroup(entry = {}) {
  const skus = [...new Set((entry.lines || [])
    .map((line) => text(line.sku || line.parentSku || line.originalSku).toUpperCase())
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  return skus.join("|") || "~NO-SKU";
}

function sortPrintEntriesByCarrier(entries = []) {
  return [...entries].sort((left, right) => {
    const carrierOrder = printCarrierGroup(left).localeCompare(printCarrierGroup(right));
    if (carrierOrder) return carrierOrder;
    const skuOrder = printSkuGroup(left).localeCompare(printSkuGroup(right), undefined, { numeric: true });
    if (skuOrder) return skuOrder;
    return text(left.orderNumber || left.orderId).localeCompare(text(right.orderNumber || right.orderId), undefined, { numeric: true });
  });
}

function packingSlipTypography(options = {}) {
  const compact = options.size === "4x6";
  const landscapeCompact = compact && options.packingSlipOrientation === "landscape";
  return {
    summaryFontSize: compact ? (landscapeCompact ? 8 : 9) : 11,
    summaryLineHeight: compact ? (landscapeCompact ? 11 : 13) : 16,
    productHeaderFontSize: compact ? (landscapeCompact ? 9 : 8) : 10,
    itemTitleFontSize: compact ? (landscapeCompact ? 14 : 13) : 16,
    itemTitleLineHeight: compact ? (landscapeCompact ? 15 : 14) : 19,
    itemMetadataFontSize: compact ? (landscapeCompact ? 8 : 8) : 10,
    itemMetadataLineHeight: compact ? (landscapeCompact ? 10 : 10) : 14,
    itemQuantityFontSize: compact ? (landscapeCompact ? 11 : 10) : 12
  };
}

function drawPackingSlip(output, entry, options, fonts) {
  const compact = options.size === "4x6";
  const landscapeCompact = compact && options.packingSlipOrientation === "landscape";
  const margin = compact ? (landscapeCompact ? 14 : 16) : 42;
  const {
    summaryFontSize,
    summaryLineHeight,
    productHeaderFontSize,
    itemTitleFontSize,
    itemTitleLineHeight,
    itemMetadataFontSize,
    itemMetadataLineHeight,
    itemQuantityFontSize
  } = packingSlipTypography(options);
  const orderNumbers = packingSlipOrderNumbers(entry);
  const channelOrderNumbers = packingSlipChannelOrderNumbers(entry);
  const lines = Array.isArray(entry.lines) ? entry.lines : [];
  let lineIndex = 0;
  let pageNumber = 1;
  do {
    // Thermal packing slips use the 4 x 6 stock sideways so order and item
    // details remain readable without changing the carrier label orientation.
    const page = output.addPage(compact ? (landscapeCompact ? [432, 288] : [288, 432]) : [612, 792]);
    const width = page.getWidth() - margin * 2;
    let y = page.getHeight() - margin;
    const brandSize = pageNumber === 1 ? (compact ? 24 : 34) : (compact ? 14 : 22);
    page.drawText("DealsClick", { x: margin, y, size: brandSize, font: fonts.bold, color: rgb(0.08, 0.09, 0.11) });
    const slipHeading = pageNumber === 1 ? "PACKING SLIP" : "PACKING SLIP - CONTINUED";
    const headingSize = compact ? (landscapeCompact ? 15 : (pageNumber === 1 ? 16 : 10)) : (pageNumber === 1 ? 22 : 16);
    page.drawText(slipHeading, { x: page.getWidth() - margin - fonts.bold.widthOfTextAtSize(slipHeading, headingSize), y: y + 2, size: headingSize, font: fonts.bold, color: rgb(0.3, 0.32, 0.35) });
    y -= compact ? (landscapeCompact ? 31 : 34) : 48;
    page.drawLine({ start: { x: margin, y }, end: { x: margin + width, y }, thickness: 1.2, color: rgb(0.08, 0.09, 0.11) });

    if (pageNumber === 1) {
      const summaryTop = y - (compact ? (landscapeCompact ? 16 : 18) : 26);
      page.drawText("SHIP TO", { x: margin, y: summaryTop, size: summaryFontSize, font: fonts.bold, color: rgb(0.3, 0.32, 0.35) });
      const detailX = compact ? margin + (landscapeCompact ? 218 : 0) : margin + 320;
      if (!compact || landscapeCompact) page.drawText("ORDER", { x: detailX, y: summaryTop, size: summaryFontSize, font: fonts.bold, color: rgb(0.3, 0.32, 0.35) });
      let addressY = summaryTop - summaryLineHeight - 2;
      for (const line of addressLines(entry).slice(0, compact ? (landscapeCompact ? 4 : 5) : 7)) {
        page.drawText(line.slice(0, compact ? (landscapeCompact ? 48 : 38) : 52), { x: margin, y: addressY, size: summaryFontSize, font: fonts.font });
        addressY -= summaryLineHeight;
      }
      const details = [
        [orderNumbers.length > 1 ? "Orders" : "Order #", orderNumbers.join(", ")],
        [channelOrderNumbers.length > 1 ? "Channel orders" : "Channel order", channelOrderNumbers.join(", ") || "Not provided"],
        ["Channel", packingSlipChannel(entry)],
        ["Batch ID", text(entry.batchId || entry.batchNumber) || "Not assigned"]
      ];
      if (!compact) details.push(["Date", text(entry.orderDate) || "Not provided"], ["Shipping", text(entry.shippingMethod || entry.service) || "Not provided"]);
      let detailY;
      if (compact && !landscapeCompact) {
        detailY = addressY - 14;
        page.drawText("ORDER", { x: margin, y: detailY, size: summaryFontSize, font: fonts.bold, color: rgb(0.3, 0.32, 0.35) });
        detailY -= summaryLineHeight + 3;
      } else {
        detailY = summaryTop - summaryLineHeight - 2;
      }
      for (const [label, value] of details) {
        const labelText = `${label}:`;
        const compactValueWidth = landscapeCompact ? 30 : 25;
        const valueLines = compact && (label === "Channel order" || label === "Channel orders" || label === "Orders")
          ? wrappedLines(value, landscapeCompact ? 24 : 30).slice(0, landscapeCompact ? 3 : 4)
          : [String(value).slice(0, compact ? compactValueWidth : 42)];
        const valueX = detailX + fonts.bold.widthOfTextAtSize(labelText, summaryFontSize) + (compact ? 3 : 6);
        page.drawText(labelText, { x: detailX, y: detailY, size: summaryFontSize, font: fonts.bold });
        valueLines.forEach((line, index) => page.drawText(line, { x: valueX, y: detailY - index * summaryLineHeight, size: summaryFontSize, font: fonts.font }));
        detailY -= summaryLineHeight + 2 + Math.max(0, valueLines.length - 1) * summaryLineHeight;
      }
      y = (compact && !landscapeCompact ? detailY : Math.min(addressY, detailY)) - (compact ? (landscapeCompact ? 8 : 12) : 20);
    } else {
      const continuationTop = y - (compact ? 16 : 24);
      const orderLabel = `${orderNumbers.length > 1 ? "Orders" : "Order"}: ${orderNumbers.join(", ") || "Not provided"}`;
      const batchLabel = `Batch ID: ${text(entry.batchId || entry.batchNumber) || "Not assigned"}`;
      page.drawText(orderLabel.slice(0, compact ? (landscapeCompact ? 68 : 42) : 88), { x: margin, y: continuationTop, size: summaryFontSize, font: fonts.bold });
      page.drawText(batchLabel.slice(0, compact ? 42 : 88), { x: margin, y: continuationTop - summaryLineHeight - 2, size: summaryFontSize, font: fonts.font });
      y = continuationTop - summaryLineHeight * 2 - (compact ? 10 : 16);
    }

    page.drawLine({ start: { x: margin, y: y + (compact ? 13 : 17) }, end: { x: margin + width, y: y + (compact ? 13 : 17) }, thickness: 0.8, color: rgb(0.35, 0.37, 0.4) });
    let drewLine = false;
    if (compact) {
      page.drawText("PRODUCT", { x: margin, y, size: productHeaderFontSize, font: fonts.bold });
      page.drawText("QTY", { x: margin + width - 22, y, size: productHeaderFontSize, font: fonts.bold });
      y -= landscapeCompact ? 7 : 9;
      while (lineIndex < lines.length) {
        const line = lines[lineIndex];
        const titleLines = wrappedLines(line.title || line.name || line.sku, landscapeCompact ? 38 : 25).slice(0, 2);
        const metadata = [
          orderNumbers.length > 1 ? `Order: ${text(line.orderNumber || line.orderId) || "-"}` : "",
          `SKU: ${text(line.sku) || "-"}`,
          `Mfr SKU: ${text(line.manufacturerSku || line.mfrPartNumber) || "-"}`,
          `Brand: ${text(line.brand) || "-"}`
        ].filter(Boolean).join("  |  ");
        const metadataLines = wrappedLines(metadata, landscapeCompact ? 70 : 39).slice(0, 2);
        const rowHeight = titleLines.length * itemTitleLineHeight + metadataLines.length * itemMetadataLineHeight + 18;
        if (y - rowHeight < margin + (landscapeCompact ? 14 : 22)) break;
        y -= itemTitleLineHeight + 3;
        titleLines.forEach((title, index) => page.drawText(title, { x: margin, y: y - index * itemTitleLineHeight, size: itemTitleFontSize, font: fonts.bold }));
        page.drawText(String(Number(line.qty || line.quantity || 0)), { x: margin + width - 18, y, size: itemQuantityFontSize, font: fonts.bold });
        y -= titleLines.length * itemTitleLineHeight;
        metadataLines.forEach((metadataLine, index) => page.drawText(metadataLine, { x: margin, y: y - index * itemMetadataLineHeight, size: itemMetadataFontSize, font: fonts.font }));
        y -= metadataLines.length * itemMetadataLineHeight + 3;
        page.drawLine({ start: { x: margin, y }, end: { x: margin + width, y }, thickness: 0.4, color: rgb(0.82, 0.83, 0.85) });
        lineIndex += 1;
        drewLine = true;
      }
    } else {
      const titleX = margin;
      const mfrX = margin + 290;
      const brandX = margin + 405;
      const qtyX = margin + width - 26;
      page.drawText("PRODUCT", { x: titleX, y, size: productHeaderFontSize, font: fonts.bold });
      page.drawText("MFR SKU", { x: mfrX, y, size: productHeaderFontSize, font: fonts.bold });
      page.drawText("BRAND", { x: brandX, y, size: productHeaderFontSize, font: fonts.bold });
      page.drawText("QTY", { x: qtyX, y, size: productHeaderFontSize, font: fonts.bold });
      y -= 10;
      page.drawLine({ start: { x: margin, y }, end: { x: margin + width, y }, thickness: 0.8, color: rgb(0.35, 0.37, 0.4) });
      while (lineIndex < lines.length) {
        const line = lines[lineIndex];
        const lineTitle = orderNumbers.length > 1 ? `Order ${text(line.orderNumber || line.orderId)} - ${line.title || line.name || line.sku}` : (line.title || line.name || line.sku);
        const titleLines = wrappedLines(lineTitle, 30).slice(0, 2);
        const rowHeight = Math.max(44, titleLines.length * itemTitleLineHeight + 15);
        if (y - rowHeight < margin + 40) break;
        y -= 14;
        titleLines.forEach((title, index) => page.drawText(title, { x: titleX, y: y - index * itemTitleLineHeight, size: itemTitleFontSize, font: fonts.bold }));
        page.drawText(text(line.manufacturerSku || line.mfrPartNumber || "-").slice(0, 18), { x: mfrX, y, size: itemMetadataFontSize, font: fonts.font });
        page.drawText(text(line.brand || "-").slice(0, 15), { x: brandX, y, size: itemMetadataFontSize, font: fonts.font });
        page.drawText(String(Number(line.qty || line.quantity || 0)), { x: qtyX + 4, y, size: itemQuantityFontSize, font: fonts.bold });
        y -= rowHeight;
        page.drawLine({ start: { x: margin, y: y + 8 }, end: { x: margin + width, y: y + 8 }, thickness: 0.4, color: rgb(0.82, 0.83, 0.85) });
        lineIndex += 1;
        drewLine = true;
      }
    }
    const hasMoreLines = lineIndex < lines.length;
    if (!drewLine && hasMoreLines && pageNumber > 1) throw new Error("A packing-slip item could not fit on the selected page size.");
    const footer = hasMoreLines ? `Packing slip page ${pageNumber} - continued` : "Thank you for shopping with DealsClick.";
    page.drawText(footer, { x: margin, y: margin + 5, size: compact ? 12 : 16, font: fonts.bold, color: rgb(0.3, 0.32, 0.35) });
    pageNumber += 1;
  } while (lineIndex < lines.length);
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
  for (const entry of sortPrintEntriesByCarrier(entries)) {
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

function restorePurchasedLabelReferences(order = {}, row = {}, batch = {}, options = {}) {
  const documentId = text(row.documentId);
  const attachmentRoot = text(options.attachmentRoot);
  if (!documentId || !attachmentRoot) return { changed: false, document: null, shipment: null };
  order.documents = Array.isArray(order.documents) ? order.documents : [];
  order.shipments = Array.isArray(order.shipments) ? order.shipments : [];
  let changed = false;
  let document = order.documents.find((entry) => text(entry.id) === documentId) || null;
  if (!document) {
    const storageKey = `${path.basename(documentId)}.pdf`;
    const filePath = path.join(attachmentRoot, storageKey);
    if (!fs.existsSync(filePath)) return { changed: false, document: null, shipment: null };
    const createdAt = row.completedAt || row.updatedAt || new Date().toISOString();
    document = {
      id: documentId,
      name: `Shipping label ${text(order.orderNumber || order.id) || documentId}.pdf`,
      type: "shipping_label",
      note: `${text(batch.batchNumber || batch.id) || "Fulfillment batch"} recovered purchased label`,
      mimeType: "application/pdf",
      size: fs.statSync(filePath).size,
      storage: "local",
      storageKey,
      url: `/api/orders/${encodeURIComponent(text(order.id))}/attachments/${encodeURIComponent(documentId)}`,
      createdAt,
      createdBy: text(row.selectedRate?.provider || row.labelSource) || "DataPlus"
    };
    order.documents.push(document);
    changed = true;
  }
  const routeIds = (row.routeIds || [row.routeId]).map(text).filter(Boolean);
  const routeIdSet = new Set(routeIds);
  let shipment = order.shipments.find((entry) => text(entry.id) === text(row.shipmentId))
    || order.shipments.find((entry) => text(entry.fulfillmentBatchId) === text(batch.id)
      && (!routeIdSet.size || (entry.fulfillmentRouteIds || []).map(text).some((routeId) => routeIdSet.has(routeId))))
    || null;
  const rate = row.selectedRate && typeof row.selectedRate === "object" ? row.selectedRate : {};
  if (!shipment) {
    const provider = text(rate.provider || row.labelProvider || row.labelSource) || "dataplus";
    const createdAt = row.completedAt || row.updatedAt || document.createdAt || new Date().toISOString();
    shipment = {
      id: text(row.shipmentId) || `recovered-${documentId}`,
      reference: `${text(order.orderNumber || order.id) || "Order"}-LABEL`,
      status: "label_purchased",
      trackingStatus: text(row.trackingNumber) ? "unknown" : "awaiting_pickup",
      provider,
      labelProvider: provider,
      carrier: text(rate.carrier) || "Other",
      carrierName: text(rate.carrier) || "Other",
      service: text(rate.service) || "Shipping",
      trackingNumber: text(row.trackingNumber),
      documents: [{ documentId, url: document.url || row.labelUrl || "", format: "PDF", documentType: "shipping_label" }],
      fulfillmentBatchId: text(batch.id),
      fulfillmentRouteIds: routeIds,
      packageSnList: Array.isArray(row.packageSnList) ? row.packageSnList : [],
      shippingCost: Number(row.shippingCost ?? rate.amount ?? 0),
      currency: text(rate.currency || order.currency) || "USD",
      labelSource: text(row.labelSource) || "dataplus",
      createdAt,
      updatedAt: new Date().toISOString()
    };
    order.shipments.unshift(shipment);
    changed = true;
  } else {
    shipment.documents = Array.isArray(shipment.documents) ? shipment.documents : [];
    if (!shipment.documents.some((entry) => text(entry.documentId || entry.id) === documentId)) {
      shipment.documents.push({ documentId, url: document.url || row.labelUrl || "", format: "PDF", documentType: "shipping_label" });
      changed = true;
    }
  }
  return { changed, document, shipment };
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

module.exports = { buildLabelPacket, buildPrintPreview, attachmentFilePath, restorePurchasedLabelReferences, printJobsByBatchId, packingSlipChannel, packingSlipTypography, printCarrierGroup, printSkuGroup, sortPrintEntriesByCarrier };
