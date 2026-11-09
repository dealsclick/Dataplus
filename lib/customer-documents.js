const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

function plainText(value) {
  return String(value ?? "").normalize("NFKD").replace(/[^\x20-\x7E\n]/g, "?");
}

function safeHeader(value) {
  return plainText(value).replace(/[\r\n]+/g, " ").trim();
}

function safeFileName(value, fallback = "document") {
  return safeHeader(value).replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 120) || fallback;
}

function base64Lines(value) {
  const encoded = (Buffer.isBuffer(value) ? value : Buffer.from(String(value || ""), "utf8")).toString("base64");
  return encoded.match(/.{1,76}/g)?.join("\r\n") || "";
}

function buildOutlookDraft({ to = "", subject = "", body = "", attachmentName = "document.pdf", attachment }) {
  const boundary = `DataPlus_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const lines = [
    "X-Unsent: 1",
    `To: ${safeHeader(to)}`,
    `Subject: ${safeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary=\"${boundary}\"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=\"UTF-8\"",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(body),
    "",
    `--${boundary}`,
    `Content-Type: application/pdf; name=\"${safeFileName(attachmentName, "document.pdf")}\"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename=\"${safeFileName(attachmentName, "document.pdf")}\"`,
    "",
    base64Lines(attachment),
    "",
    `--${boundary}--`,
    ""
  ];
  return Buffer.from(lines.join("\r\n"), "utf8");
}

function orderCustomerName(order = {}) {
  return String(order.buyer || order.customerName || order.customer?.name || order.address?.name || order.shippingAddress?.name || "Customer").trim() || "Customer";
}

function orderCustomerEmail(order = {}) {
  return String(order.buyerEmail || order.customerEmail || order.email || order.customer?.email || order.address?.email || order.shippingAddress?.email || "").trim();
}

function orderItems(order = {}) {
  const source = Array.isArray(order.items) && order.items.length ? order.items : Array.isArray(order.lineItems) ? order.lineItems : [];
  return source.map((item) => ({
    sku: String(item.sku || item.vendorSku || "").trim(),
    title: String(item.title || item.name || item.sku || "Item").trim(),
    qty: Math.max(0, Number(item.qty ?? item.quantity ?? 0) || 0),
    price: Math.max(0, Number(item.price ?? item.unitPrice ?? item.salePrice ?? 0) || 0)
  }));
}

function orderCompanyProfile(profile = {}) {
  return {
    name: String(profile.organizationName || profile.displayName || profile.name || "DataPlus").trim() || "DataPlus",
    legalName: String(profile.organizationLegalName || profile.legalName || "").trim(),
    email: String(profile.organizationEmail || profile.email || "").trim(),
    phone: String(profile.organizationPhone || profile.phone || "").trim(),
    address: profile.organizationAddress || profile.address || {}
  };
}

function wrapText(text, font, size, width) {
  const output = [];
  for (const paragraph of plainText(text).split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) { output.push(""); continue; }
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (!line || font.widthOfTextAtSize(next, size) <= width) line = next;
      else { output.push(line); line = word; }
    }
    if (line) output.push(line);
  }
  return output;
}

function money(value) {
  return `$${Math.max(0, Number(value || 0)).toFixed(2)}`;
}

async function buildInvoicePdf(order = {}, companyProfile = {}) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const margin = 42;
  const width = 612;
  const height = 792;
  const contentWidth = width - margin * 2;
  const profile = orderCompanyProfile(companyProfile);
  const customer = orderCustomerName(order);
  const address = order.billingAddress || order.address || order.shippingAddress || {};
  const items = orderItems(order);
  const itemSubtotal = items.reduce((sum, item) => sum + item.qty * item.price, 0);
  const shipping = Math.max(0, Number(order.shippingAmount ?? order.shippingPrice ?? order.shippingCost ?? 0) || 0);
  const tax = Math.max(0, Number(order.taxAmount ?? order.tax ?? order.totalTax ?? 0) || 0);
  const discount = Math.max(0, Number(order.discountAmount ?? order.discount ?? order.totalDiscount ?? 0) || 0);
  const total = Math.max(0, Number(order.total ?? order.totalPrice ?? order.amount ?? (itemSubtotal + shipping + tax - discount)) || 0);
  const invoiceNumber = String(order.invoiceNumber || `INV-${order.orderNumber || order.id || "ORDER"}`).trim();
  const pages = [];
  let page;
  let y;
  const draw = (text, x, currentY, options = {}) => {
    const font = options.bold ? bold : regular;
    const size = options.size || 9;
    const value = plainText(text);
    const drawX = options.align === "right" ? x - font.widthOfTextAtSize(value, size) : x;
    page.drawText(value, { x: drawX, y: currentY, size, font, color: options.color || rgb(0.08, 0.1, 0.12) });
  };
  const rule = (currentY, color = rgb(0.82, 0.84, 0.86), thickness = 0.6) => page.drawLine({ start: { x: margin, y: currentY }, end: { x: width - margin, y: currentY }, color, thickness });
  const newPage = (continued = false) => {
    page = document.addPage([width, height]);
    pages.push(page);
    y = height - margin;
    draw(profile.name, margin, y, { bold: true, size: 18 });
    draw(continued ? "INVOICE - CONTINUED" : "INVOICE", width - margin, y + 1, { bold: true, size: 16, align: "right" });
    y -= 22;
    rule(y, rgb(0.15, 0.18, 0.22), 1.2);
    y -= 20;
  };
  const ensure = (space) => { if (y - space >= margin + 28) return false; newPage(true); return true; };
  const addressText = [address.line1 || address.address1, address.line2 || address.address2, [address.city, address.state || address.province, address.postalCode || address.zip].filter(Boolean).join(", "), address.country].filter(Boolean).join("\n");
  newPage();
  draw("INVOICE NUMBER", margin, y, { bold: true, size: 7, color: rgb(0.36, 0.39, 0.43) });
  draw(invoiceNumber, margin, y - 14, { bold: true, size: 10 });
  draw("ORDER", 225, y, { bold: true, size: 7, color: rgb(0.36, 0.39, 0.43) });
  draw(String(order.orderNumber || order.id || "-"), 225, y - 14, { size: 10 });
  draw("DATE", 400, y, { bold: true, size: 7, color: rgb(0.36, 0.39, 0.43) });
  draw(String(order.createdAt || order.orderDate || new Date().toISOString()).slice(0, 10), 400, y - 14, { size: 10 });
  y -= 50;
  rule(y);
  y -= 18;
  draw("BILL TO", margin, y, { bold: true, size: 7, color: rgb(0.36, 0.39, 0.43) });
  y -= 15;
  draw(customer, margin, y, { bold: true, size: 10 });
  y -= 14;
  for (const line of wrapText(addressText, regular, 9, contentWidth).slice(0, 5)) { draw(line, margin, y, { size: 9 }); y -= 12; }
  y -= 10;
  const drawHeader = () => {
    page.drawRectangle({ x: margin, y: y - 4, width: contentWidth, height: 21, color: rgb(0.16, 0.19, 0.23) });
    draw("SKU", margin + 8, y + 3, { bold: true, size: 7.5, color: rgb(1, 1, 1) });
    draw("ITEM", 132, y + 3, { bold: true, size: 7.5, color: rgb(1, 1, 1) });
    draw("QTY", 397, y + 3, { bold: true, size: 7.5, color: rgb(1, 1, 1) });
    draw("PRICE", 485, y + 3, { bold: true, size: 7.5, align: "right", color: rgb(1, 1, 1) });
    draw("TOTAL", width - margin - 8, y + 3, { bold: true, size: 7.5, align: "right", color: rgb(1, 1, 1) });
    y -= 22;
  };
  drawHeader();
  for (const item of items) {
    const titleLines = wrapText(item.title, regular, 8.5, 240).slice(0, 2);
    const rowHeight = Math.max(27, titleLines.length * 11 + 9);
    if (ensure(rowHeight + 22)) drawHeader();
    draw(item.sku || "-", margin + 8, y, { size: 8 });
    titleLines.forEach((line, index) => draw(line, 132, y - index * 11, { size: 8.5 }));
    draw(String(item.qty), 397, y, { size: 8.5 });
    draw(money(item.price), 485, y, { size: 8.5, align: "right" });
    draw(money(item.qty * item.price), width - margin - 8, y, { bold: true, size: 8.5, align: "right" });
    y -= rowHeight;
    rule(y + 6);
  }
  if (!items.length) { draw("No line items are recorded.", margin, y, { size: 9 }); y -= 28; }
  ensure(125);
  const labelX = 405;
  for (const [label, value] of [["Subtotal", itemSubtotal], ["Shipping", shipping], ["Tax", tax], ...(discount ? [["Discount", -discount]] : [])]) {
    draw(label, labelX, y, { size: 9 });
    draw(`${Number(value) < 0 ? "-" : ""}${money(Math.abs(Number(value)))}`, width - margin, y, { size: 9, align: "right" });
    y -= 16;
  }
  draw("INVOICE TOTAL", labelX, y, { bold: true, size: 10 });
  draw(money(total), width - margin, y, { bold: true, size: 12, align: "right" });
  pages.forEach((current, index) => current.drawText(`${plainText(invoiceNumber)} | Page ${index + 1} of ${pages.length}`, { x: margin, y: 24, size: 7, font: regular, color: rgb(0.42, 0.44, 0.47) }));
  return Buffer.from(await document.save());
}

function quoteEmailContent(draft = {}, companyName = "DataPlus") {
  const customer = String(draft.buyer || draft.customerName || "Customer").trim() || "Customer";
  const reference = String(draft.draftNumber || draft.id || "").trim();
  return {
    to: String(draft.buyerEmail || draft.customerEmail || "").trim(),
    subject: `Quote ${reference} from ${companyName}`,
    body: `Hello ${customer},\n\nPlease see attached quote ${reference}.\n\nPlease let me know if you have any questions.\n\nThank you,`
  };
}

function invoiceEmailContent(order = {}, companyName = "DataPlus") {
  const customer = orderCustomerName(order);
  const reference = String(order.orderNumber || order.id || "").trim();
  return {
    to: orderCustomerEmail(order),
    subject: `Invoice for order ${reference} from ${companyName}`,
    body: `Hello ${customer},\n\nPlease see attached invoice for order ${reference}.\n\nPlease let me know if you have any questions.\n\nThank you,`
  };
}

module.exports = { buildInvoicePdf, buildOutlookDraft, invoiceEmailContent, orderCompanyProfile, orderCustomerEmail, orderCustomerName, quoteEmailContent, safeFileName };
