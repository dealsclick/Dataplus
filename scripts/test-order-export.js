const assert = require("assert");
const {
  orderExportHeaders,
  orderExportRows,
  orderLabelStatus,
  orderReturnStatus,
  orderStatus,
  orderShippingStatus
} = require("../lib/order-export");

const order = {
  id: "order-1",
  orderNumber: "55577",
  channelSource: "Shopify",
  channelOrderNumber: "#1042",
  orderDate: "2026-10-29T10:00:00.000Z",
  status: "fulfilled",
  financialStatus: "Paid",
  total: 45,
  paidAmount: 45,
  refundAmount: 5,
  refundedAt: "2026-10-30T10:00:00.000Z",
  returnNumber: "RET-00001",
  returnRequestedAt: "2026-10-30T09:00:00.000Z",
  shippingAddress: { city: "Brooklyn", state: "NY", postalCode: "11201", countryCode: "US" },
  purchaseOrderNumbers: ["PO-100"],
  shipments: [{
    status: "shipped",
    carrier: "UPS",
    trackingNumber: "1Z999",
    labelCost: 12.25,
    labelPurchaseId: "label-1",
    labelPrintedAt: "2026-10-29T11:00:00.000Z"
  }],
  items: [{
    lineId: "line-1",
    lineIndex: 0,
    sku: "SKU-1",
    originalSku: "SOURCE-1",
    mappedSku: "SKU-1",
    title: "Test item",
    brand: "Example Brand",
    supplier: "True Value",
    vendorSku: "TV-100",
    mfrPartNumber: "MFR-100",
    upc: "012345678905",
    qty: 2,
    price: 20,
    cost: 8,
    refundedQty: 1,
    refundedAt: "2026-10-30T10:00:00.000Z"
  }],
  returns: [{
    id: "return-1",
    returnNumber: "RET-00001",
    channelReturnId: "CHANNEL-RETURN-1",
    reason: "DAMAGED",
    description: "Box arrived crushed",
    items: [{ lineId: "line-1", sku: "SKU-1", reason: "DAMAGED", description: "Box arrived crushed" }]
  }]
};

assert.equal(orderLabelStatus(order), "Label printed");
assert.equal(orderShippingStatus(order), "Shipped");
assert.equal(orderReturnStatus(order), "Requested");
assert.equal(orderStatus("cancelled"), "Canceled");
assert.equal(orderStatus("canceled"), "Canceled");

const summaryHeaders = orderExportHeaders("summary");
const summaryRows = orderExportRows(order, "summary");
assert.equal(summaryRows.length, 1);
assert.equal(summaryRows[0].length, summaryHeaders.length);
assert.equal(summaryRows[0][summaryHeaders.indexOf("Internal order number")], "55577");
assert.equal(summaryRows[0][summaryHeaders.indexOf("Label status")], "Label printed");
assert.equal(orderExportRows({ ...order, status: "cancelled" }, "summary")[0][summaryHeaders.indexOf("Order status")], "Canceled");

const lineHeaders = orderExportHeaders("lines");
const lineRows = orderExportRows(order, "lines");
assert.equal(lineRows.length, 1);
assert.equal(lineRows[0].length, lineHeaders.length);
assert.equal(lineRows[0][lineHeaders.indexOf("Brand")], "Example Brand");
assert.equal(lineRows[0][lineHeaders.indexOf("Supplier")], "True Value");
assert.equal(lineRows[0][lineHeaders.indexOf("Vendor SKU")], "TV-100");
assert.equal(lineRows[0][lineHeaders.indexOf("Manufacturer part number")], "MFR-100");
assert.equal(lineRows[0][lineHeaders.indexOf("UPC")], "012345678905");
assert.equal(lineRows[0][lineHeaders.indexOf("Return reason")], "DAMAGED: Box arrived crushed");
assert.equal(lineRows[0][lineHeaders.indexOf("Return number")], "RET-00001");
assert.equal(lineRows[0][lineHeaders.indexOf("Line total")], 40);
assert.equal(lineRows[0][lineHeaders.indexOf("Refunded quantity")], 1);

const emptyLineRows = orderExportRows({ ...order, items: [] }, "lines");
assert.equal(emptyLineRows.length, 1, "line exports retain orders that have no normalized lines");
assert.equal(emptyLineRows[0].length, lineHeaders.length);

console.log("order export tests passed");
