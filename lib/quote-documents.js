const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const QUOTE_EXPORT_VARIANTS = ["standard", "savings", "summary"];

const QUOTE_TERM_OPTIONS = [
  { id: "availability", group: "Commercial", label: "Availability", text: "Product availability is subject to change until the order is accepted." },
  { id: "taxes", group: "Commercial", label: "Sales tax", text: "Applicable sales tax is added unless a valid exemption certificate is on file." },
  { id: "shipping", group: "Commercial", label: "Shipping and handling", text: "Shipping and handling are added unless specifically included in this quote." },
  { id: "lead_time", group: "Commercial", label: "Estimated lead time", text: "Lead times are estimates and may change based on supplier or carrier availability." },
  { id: "payment_due", group: "Payment", label: "Due upon acceptance", text: "Payment is due upon acceptance unless written credit terms are shown." },
  { id: "net_15", group: "Payment", label: "Net 15", text: "Approved account payment is due within 15 days of the invoice date." },
  { id: "net_30", group: "Payment", label: "Net 30", text: "Approved account payment is due within 30 days of the invoice date." },
  { id: "po_required", group: "Fulfillment", label: "Purchase order required", text: "A customer purchase order number is required before fulfillment." },
  { id: "partial_shipments", group: "Fulfillment", label: "Partial shipments", text: "Partial shipments may be made as items become available." },
  { id: "returns_standard", group: "Returns", label: "Standard return policy", text: "Returns are subject to the seller's current return policy and authorization requirements." },
  { id: "special_order_final", group: "Returns", label: "Special-order items", text: "Special-order and custom items are non-cancelable and non-returnable once ordered." },
  { id: "manufacturer_warranty", group: "Returns", label: "Manufacturer warranty", text: "Product warranties are provided by the manufacturer unless stated otherwise." }
];

function defaultQuoteExpiration(days = 30, base = new Date()) {
  const date = new Date(base);
  const valid = Number.isFinite(date.getTime()) ? date : new Date();
  valid.setUTCDate(valid.getUTCDate() + Math.max(0, Number(days || 0)));
  return valid.toISOString().slice(0, 10);
}

function normalizeQuoteExpiration(value) {
  const text = String(value || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : "";
}

function normalizeQuoteTermIds(value) {
  const requested = new Set((Array.isArray(value) ? value : []).map((id) => String(id || "").trim()).filter(Boolean));
  return QUOTE_TERM_OPTIONS.map((option) => option.id).filter((id) => requested.has(id));
}

function quoteSavingsTotals(items = []) {
  return (Array.isArray(items) ? items : []).reduce((totals, item) => {
    const qty = Math.max(0, Number(item.qty || 0));
    const price = Math.max(0, Number(item.price || 0));
    const msrp = Math.max(0, Number(item.msrp || 0));
    totals.quoteTotal += qty * price;
    totals.msrpTotal += qty * msrp;
    totals.savingsTotal += qty * Math.max(0, msrp - price);
    if (msrp > 0) totals.hasMsrp = true;
    return totals;
  }, { quoteTotal: 0, msrpTotal: 0, savingsTotal: 0, hasMsrp: false });
}

function quoteTerms(draft = {}) {
  const selected = new Set(normalizeQuoteTermIds(draft.selectedTermIds));
  const terms = QUOTE_TERM_OPTIONS.filter((option) => selected.has(option.id)).map((option) => option.text);
  const custom = String(draft.customTerms || "").trim();
  if (custom) terms.push(custom);
  return terms;
}

function pdfText(value) {
  return String(value ?? "").normalize("NFKD").replace(/[^\x20-\x7E\n]/g, "?");
}

function money(value) {
  return `$${Math.max(0, Number(value || 0)).toFixed(2)}`;
}

function wrapText(text, font, size, width) {
  const lines = [];
  for (const paragraph of pdfText(text).split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (!line || font.widthOfTextAtSize(next, size) <= width) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

async function buildQuotePdf(draft = {}, requestedVariant = "standard") {
  const variant = QUOTE_EXPORT_VARIANTS.includes(requestedVariant) ? requestedVariant : "standard";
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const pages = [];
  const margin = 42;
  const pageWidth = 612;
  const pageHeight = 792;
  const contentWidth = pageWidth - margin * 2;
  const lineHeight = 13;
  let page;
  let y;

  const draw = (text, x, currentY, options = {}) => {
    const font = options.bold ? bold : regular;
    const size = options.size || 9;
    const value = pdfText(text);
    let drawX = x;
    if (options.align === "right") drawX = x - font.widthOfTextAtSize(value, size);
    page.drawText(value, { x: drawX, y: currentY, size, font, color: options.color || rgb(0.08, 0.1, 0.12) });
  };
  const line = (currentY, color = rgb(0.82, 0.84, 0.86), thickness = 0.6) => page.drawLine({ start: { x: margin, y: currentY }, end: { x: pageWidth - margin, y: currentY }, color, thickness });
  const newPage = (continued = false) => {
    page = document.addPage([pageWidth, pageHeight]);
    pages.push(page);
    y = pageHeight - margin;
    draw("DEALSCLICK", margin, y, { bold: true, size: 18 });
    draw(continued ? "QUOTE - CONTINUED" : "QUOTE", pageWidth - margin, y + 1, { bold: true, size: 16, align: "right", color: rgb(0.22, 0.25, 0.29) });
    y -= 22;
    line(y, rgb(0.15, 0.18, 0.22), 1.2);
    y -= 20;
  };
  const ensure = (height) => {
    if (y - height >= margin + 28) return false;
    newPage(true);
    return true;
  };
  const drawWrapped = (text, x, width, options = {}) => {
    const font = options.bold ? bold : regular;
    const size = options.size || 9;
    const lines = wrapText(text, font, size, width);
    for (const value of lines) {
      ensure(lineHeight + 2);
      draw(value, x, y, options);
      y -= options.lineHeight || lineHeight;
    }
    return lines.length;
  };
  const drawLabelValue = (label, value, x, width) => {
    draw(label.toUpperCase(), x, y, { bold: true, size: 7, color: rgb(0.36, 0.39, 0.43) });
    const valueLines = wrapText(value || "-", regular, 9, width);
    valueLines.slice(0, 3).forEach((valueLine, index) => draw(valueLine, x, y - 13 - index * 12, { size: 9 }));
  };

  const items = Array.isArray(draft.items) ? draft.items : [];
  const totals = quoteSavingsTotals(items);
  const address = draft.shippingAddress || {};
  const issueDate = normalizeQuoteExpiration(String(draft.createdAt || "").slice(0, 10)) || normalizeQuoteExpiration(new Date().toISOString().slice(0, 10));
  const expiresAt = normalizeQuoteExpiration(draft.expiresAt);
  const addressText = [address.line1, address.line2, [address.city, address.state, address.postalCode].filter(Boolean).join(", "), address.country].filter(Boolean).join("\n");

  newPage(false);
  drawLabelValue("Quote number", draft.draftNumber || draft.id || "Draft", margin, 150);
  drawLabelValue("Issue date", issueDate, margin + 180, 110);
  drawLabelValue("Valid until", expiresAt || "Not specified", margin + 320, 140);
  y -= 48;
  line(y);
  y -= 18;
  drawLabelValue("Prepared for", draft.buyer || "Customer", margin, 220);
  drawLabelValue("Contact", [draft.buyerEmail, draft.phone].filter(Boolean).join("\n") || "-", margin + 260, 225);
  y -= 49;
  if (addressText) {
    draw("SHIP TO", margin, y, { bold: true, size: 7, color: rgb(0.36, 0.39, 0.43) });
    y -= 13;
    drawWrapped(addressText, margin, contentWidth, { size: 9, lineHeight: 12 });
    y -= 5;
  }
  if (draft.customerNote) {
    ensure(55);
    page.drawRectangle({ x: margin, y: y - 38, width: contentWidth, height: 46, color: rgb(0.96, 0.97, 0.98), borderColor: rgb(0.84, 0.86, 0.88), borderWidth: 0.5 });
    draw("MESSAGE", margin + 10, y - 5, { bold: true, size: 7, color: rgb(0.36, 0.39, 0.43) });
    const messageLines = wrapText(draft.customerNote, regular, 8.5, contentWidth - 20).slice(0, 3);
    messageLines.forEach((value, index) => draw(value, margin + 10, y - 18 - index * 10, { size: 8.5 }));
    y -= 52;
  }

  const columns = variant === "savings"
    ? [{ label: "Item", x: margin, width: 198 }, { label: "Qty", x: 250, width: 30 }, { label: "MSRP", x: 340, width: 55, right: true }, { label: "Your price", x: 410, width: 60, right: true }, { label: "Savings", x: 480, width: 60, right: true }, { label: "Total", x: 570, width: 60, right: true }]
    : variant === "summary"
      ? [{ label: "Item", x: margin, width: 365 }, { label: "Qty", x: 430, width: 40 }, { label: "Total", x: 570, width: 70, right: true }]
      : [{ label: "SKU", x: margin, width: 78 }, { label: "Item", x: 126, width: 242 }, { label: "Qty", x: 385, width: 35 }, { label: "Unit price", x: 480, width: 70, right: true }, { label: "Total", x: 570, width: 70, right: true }];
  const drawTableHeader = () => {
    page.drawRectangle({ x: margin, y: y - 4, width: contentWidth, height: 21, color: rgb(0.16, 0.19, 0.23) });
    columns.forEach((column) => draw(column.label, column.x, y + 3, { bold: true, size: 7.5, align: column.right ? "right" : undefined, color: rgb(1, 1, 1) }));
    y -= 22;
  };
  drawTableHeader();
  for (const item of items) {
    const description = variant === "standard" ? item.title || item.sku || "Item" : [item.title || item.sku || "Item", variant === "savings" && item.sku ? `SKU ${item.sku}` : ""].filter(Boolean).join(" - ");
    const descriptionWidth = variant === "savings" ? 198 : variant === "summary" ? 365 : 242;
    const descriptionLines = wrapText(description, regular, 8.5, descriptionWidth).slice(0, 2);
    const rowHeight = Math.max(27, descriptionLines.length * 11 + 9);
    if (ensure(rowHeight + 22)) drawTableHeader();
    if (variant === "standard") draw(item.sku || "-", margin, y, { size: 8 });
    const descriptionX = variant === "standard" ? 126 : margin;
    descriptionLines.forEach((value, index) => draw(value, descriptionX, y - index * 11, { size: 8.5 }));
    draw(String(Number(item.qty || 0)), variant === "standard" ? 385 : variant === "savings" ? 250 : 430, y, { size: 8.5 });
    const qty = Math.max(0, Number(item.qty || 0));
    const price = Math.max(0, Number(item.price || 0));
    const msrp = Math.max(0, Number(item.msrp || 0));
    if (variant === "standard") draw(money(price), 480, y, { size: 8.5, align: "right" });
    if (variant === "savings") {
      draw(msrp > 0 ? money(msrp) : "N/A", 340, y, { size: 8.5, align: "right" });
      draw(money(price), 410, y, { size: 8.5, align: "right" });
      draw(msrp > 0 ? money(Math.max(0, msrp - price) * qty) : "N/A", 480, y, { size: 8.5, align: "right", color: rgb(0.05, 0.42, 0.25) });
    }
    draw(money(price * qty), 570, y, { bold: true, size: 8.5, align: "right" });
    y -= rowHeight;
    line(y + 6);
  }
  if (!items.length) {
    draw("No line items have been added.", margin, y, { size: 9, color: rgb(0.4, 0.42, 0.45) });
    y -= 28;
  }

  ensure(variant === "savings" ? 84 : 55);
  const totalsX = 405;
  y -= 4;
  if (variant === "savings") {
    draw("MSRP total", totalsX, y, { size: 9 });
    draw(money(totals.msrpTotal), pageWidth - margin, y, { size: 9, align: "right" });
    y -= 16;
    draw("Total savings", totalsX, y, { bold: true, size: 9, color: rgb(0.05, 0.42, 0.25) });
    const savingsPercent = totals.msrpTotal > 0 ? (totals.savingsTotal / totals.msrpTotal) * 100 : 0;
    draw(`${money(totals.savingsTotal)} (${savingsPercent.toFixed(1)}%)`, pageWidth - margin, y, { bold: true, size: 9, align: "right", color: rgb(0.05, 0.42, 0.25) });
    y -= 16;
  }
  draw("QUOTE TOTAL", totalsX, y, { bold: true, size: 10 });
  draw(money(totals.quoteTotal), pageWidth - margin, y, { bold: true, size: 12, align: "right" });
  y -= 29;

  const terms = quoteTerms(draft);
  if (terms.length) {
    ensure(45);
    draw("TERMS AND CONDITIONS", margin, y, { bold: true, size: 9 });
    y -= 17;
    terms.forEach((term, index) => {
      const lines = wrapText(`${index + 1}. ${term}`, regular, 8, contentWidth - 8);
      ensure(lines.length * 10 + 5);
      lines.forEach((value) => {
        draw(value, margin + 5, y, { size: 8 });
        y -= 10;
      });
      y -= 3;
    });
  }

  pages.forEach((currentPage, index) => {
    const footer = `${pdfText(draft.draftNumber || "Draft quote")} | Page ${index + 1} of ${pages.length}`;
    currentPage.drawText(footer, { x: margin, y: 24, size: 7, font: regular, color: rgb(0.42, 0.44, 0.47) });
    const variantLabel = variant === "savings" ? "Savings proposal" : variant === "summary" ? "Quote summary" : "Standard quote";
    currentPage.drawText(variantLabel, { x: pageWidth - margin - regular.widthOfTextAtSize(variantLabel, 7), y: 24, size: 7, font: regular, color: rgb(0.42, 0.44, 0.47) });
  });

  return Buffer.from(await document.save());
}

module.exports = {
  QUOTE_EXPORT_VARIANTS,
  QUOTE_TERM_OPTIONS,
  buildQuotePdf,
  defaultQuoteExpiration,
  normalizeQuoteExpiration,
  normalizeQuoteTermIds,
  quoteSavingsTotals,
  quoteTerms
};
