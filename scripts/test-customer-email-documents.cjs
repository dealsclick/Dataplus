const assert = require("node:assert/strict");
const { buildInvoicePdf, buildOutlookDraft, invoiceEmailContent, quoteEmailContent } = require("../lib/customer-documents");
const { createStoredZip } = require("../lib/zip-archive");

async function main() {
  const order = {
    id: "order-1",
    orderNumber: "12345",
    buyer: "Ada Lovelace",
    buyerEmail: "ada@example.com",
    total: 28.5,
    shippingAmount: 3.5,
    address: { line1: "1 Main St", city: "New York", state: "NY", postalCode: "10001" },
    items: [{ sku: "ABC-123", title: "Test item", qty: 2, price: 12.5 }]
  };
  const pdf = await buildInvoicePdf(order, { organizationName: "BuySupply" });
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF", "invoice output is a PDF");
  assert.ok(pdf.length > 800, "invoice PDF contains rendered content");

  const invoiceMessage = invoiceEmailContent(order, "BuySupply");
  assert.equal(invoiceMessage.to, "ada@example.com");
  assert.match(invoiceMessage.subject, /Invoice for order 12345 from BuySupply/);
  assert.match(invoiceMessage.body, /Hello Ada Lovelace,[\s\S]*Please see attached invoice/);

  const quoteMessage = quoteEmailContent({ draftNumber: "D#1011", buyer: "Ada Lovelace", buyerEmail: "ada@example.com" }, "BuySupply");
  assert.match(quoteMessage.body, /Please see attached quote D#1011/);
  const eml = buildOutlookDraft({ ...quoteMessage, attachmentName: "D-1011.pdf", attachment: pdf }).toString("utf8");
  assert.match(eml, /^X-Unsent: 1\r$/m, "Outlook opens the EML as an unsent message");
  assert.match(eml, /^To: ada@example.com\r$/m);
  assert.match(eml, /Content-Disposition: attachment; filename="D-1011.pdf"/);
  assert.match(eml, new RegExp(pdf.subarray(0, 12).toString("base64").slice(0, 12)), "PDF bytes are embedded in the message");

  const zip = createStoredZip([
    { name: "dataplus-capture/manifest.json", content: Buffer.from('{"version":"1.0.0"}') },
    { name: "dataplus-capture/content.js", content: Buffer.from("console.log('ok')") }
  ]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50, "ZIP starts with a local file header");
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50, "ZIP ends with a central-directory record");
  assert.match(zip.toString("latin1"), /dataplus-capture\/manifest\.json/);
  console.log("Customer PDFs, Outlook drafts, and extension ZIP packages are valid.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
