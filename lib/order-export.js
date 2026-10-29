function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function text(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return "";
}

function amount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function activeShipments(order = {}) {
  return list(order.shipments).filter((shipment) => !["canceled", "cancelled", "void", "voided", "superseded"].includes(text(shipment?.status).toLowerCase()));
}

function orderLabelStatus(order = {}) {
  const shipments = activeShipments(order);
  if (shipments.some((shipment) => shipment.labelPrintedAt || shipment.labelLastPrintedAt || Number(shipment.labelPrintCount || 0) > 0)) return "Label printed";
  if (shipments.some((shipment) => shipment.labelPurchaseId || shipment.labelProvider || shipment.labelSource || list(shipment.documents).length > 0)) return "Label purchased";
  return "No label";
}

function orderShippingStatus(order = {}) {
  const shipments = activeShipments(order);
  const statuses = [
    order.deliveryStatus,
    order.trackingStatus,
    order.fulfillmentStatus,
    order.fulfillmentStage,
    order.status,
    ...shipments.flatMap((shipment) => [shipment.status, shipment.fulfillmentStatus, shipment.shipmentStatus, shipment.trackingStatus, shipment.carrierStatus])
  ].map((value) => text(value).toLowerCase()).filter(Boolean);
  if (order.deliveredAt || statuses.some((status) => status.includes("deliver"))) return "Delivered";
  if (statuses.some((status) => status.includes("partial"))) return "Partially shipped";
  if (order.shippedAt || order.shipDate || statuses.some((status) => status.includes("ship") || status.includes("transit"))) return "Shipped";
  const labelStatus = orderLabelStatus(order);
  if (labelStatus !== "No label") return labelStatus;
  return "Unshipped";
}

function orderReturnStatus(order = {}) {
  if (order.returnReceivedAt) return "Received";
  if (order.returnRequestedAt || order.returnId || order.returnNumber || list(order.returns).length) return "Requested";
  if (order.refundedAt || amount(order.refundAmount) > 0 || list(order.refunds).length) return "Refunded";
  return "No return";
}

function shipmentValues(order, keys) {
  return [...new Set(activeShipments(order).flatMap((shipment) => keys.map((key) => text(shipment?.[key]))).filter(Boolean))];
}

function lineSupplier(line = {}) {
  return text(line.supplier, line.vendor, line.vendorName, line.supplierName);
}

function lineBrand(line = {}) {
  return text(line.brand, line.brandName, line.manufacturer);
}

function orderSuppliers(order = {}) {
  return [...new Set(list(order.items).map(lineSupplier).filter(Boolean))];
}

function customerShipping(order = {}) {
  return amount(order.customerShippingCollected ?? order.shippingAmount ?? order.shippingPrice ?? order.shippingTotal ?? order.shippingCollected);
}

function labelCost(order = {}) {
  return activeShipments(order).reduce((total, shipment) => total + amount(shipment.labelCost ?? shipment.cost ?? shipment.shippingCost), 0);
}

function commonOrderValues(order = {}) {
  const address = record(order.shippingAddress || order.address);
  const tracking = [...new Set([
    text(order.trackingNumber),
    ...shipmentValues(order, ["trackingNumber", "tracking"])
  ].filter(Boolean))];
  const carriers = [...new Set([
    text(order.carrier, order.shippingCarrier),
    ...shipmentValues(order, ["carrier", "carrierName"])
  ].filter(Boolean))];
  return [
    text(order.id, order.orderId),
    text(order.orderNumber, order.internalOrderNumber),
    text(order.channelSource, order.salesChannel, order.source),
    text(order.channelOrderNumber, order.marketplaceOrderNumber, order.marketplaceOrderId, order.channelOrderId, order.externalOrderNumber, order.externalOrderId),
    text(order.orderDate, order.orderedAt, order.purchaseDate, order.createdAt),
    text(order.shipDate, order.shippedAt),
    text(order.deliveredAt),
    text(order.cancelledAt, order.canceledAt),
    text(order.refundedAt),
    text(order.status),
    text(order.financialStatus, order.paymentStatus),
    orderShippingStatus(order),
    text(order.fulfillmentStatus, order.fulfillmentStage),
    text(order.deliveryStatus, order.trackingStatus),
    orderLabelStatus(order),
    orderReturnStatus(order),
    text(order.buyer, order.customerName),
    text(order.buyerEmail, order.customerEmail),
    amount(order.total),
    amount(order.paidAmount),
    amount(order.refundAmount),
    customerShipping(order),
    labelCost(order),
    carriers.join(" | "),
    tracking.join(" | "),
    text(address.name, address.recipient, address.fullName),
    text(address.address1, address.line1, order.shippingAddress1),
    text(address.address2, address.line2),
    text(address.city),
    text(address.state, address.province, address.stateCode, address.provinceCode),
    text(address.postalCode, address.zip, address.zipCode),
    text(address.countryCode, address.country),
    list(order.purchaseOrderNumbers).map(text).filter(Boolean).join(" | "),
    orderSuppliers(order).join(" | "),
    text(order.returnNumber, order.returnId),
    text(order.returnRequestedAt),
    text(order.returnReceivedAt),
    text(order.createdAt),
    text(order.updatedAt)
  ];
}

const ORDER_EXPORT_HEADERS = [
  "DataPlus record ID", "Internal order number", "Channel", "Channel order number", "Order date",
  "Ship date", "Delivery date", "Canceled date", "Refunded date", "Order status", "Payment status",
  "Shipping status", "Fulfillment status", "Delivery status", "Label status", "Return status", "Customer",
  "Customer email", "Order total", "Paid amount", "Refund amount", "Customer shipping", "Label cost",
  "Carrier", "Tracking numbers", "Ship-to name", "Ship-to address 1", "Ship-to address 2", "Ship-to city",
  "Ship-to state", "Ship-to postal code", "Ship-to country", "Purchase order numbers", "Suppliers",
  "Return number", "Return requested date", "Return received date", "Created date", "Last updated"
];

const LINE_EXPORT_HEADERS = [
  ...ORDER_EXPORT_HEADERS,
  "Line number", "Line ID", "SKU", "Original SKU", "Mapped SKU", "Item title", "Brand", "Supplier",
  "Quantity", "Unit price", "Line total", "Unit cost", "Line cost", "Line status", "Line fulfillment status",
  "Canceled quantity", "Canceled date", "Refunded quantity", "Refunded date"
];

function lineValues(line = {}, index = 0) {
  const quantity = amount(line.qty ?? line.quantity);
  const unitPrice = amount(line.price ?? line.unitPrice);
  const unitCost = amount(line.cost ?? line.unitCost);
  return [
    Number(line.lineIndex ?? line.line_index ?? index) + 1,
    text(line.lineId, line.id),
    text(line.sku),
    text(line.originalSku, line.original_sku),
    text(line.mappedSku, line.mapped_sku),
    text(line.title),
    lineBrand(line),
    lineSupplier(line),
    quantity,
    unitPrice,
    quantity * unitPrice,
    unitCost,
    quantity * unitCost,
    text(line.status),
    text(line.fulfillmentStatus),
    amount(line.cancelledQty ?? line.canceledQty ?? line.cancelledQuantity ?? line.canceledQuantity),
    text(line.cancelledAt, line.canceledAt),
    amount(line.refundedQty ?? line.refundQty ?? line.refundedQuantity ?? line.refundQuantity),
    text(line.refundedAt, line.refundDate)
  ];
}

function orderExportHeaders(mode = "summary") {
  return mode === "lines" ? LINE_EXPORT_HEADERS : ORDER_EXPORT_HEADERS;
}

function orderExportRows(order = {}, mode = "summary") {
  const common = commonOrderValues(order);
  if (mode !== "lines") return [common];
  const items = list(order.items);
  if (!items.length) return [[...common, ...lineValues({}, 0)]];
  return items.map((line, index) => [...common, ...lineValues(line, index)]);
}

module.exports = {
  orderExportHeaders,
  orderExportRows,
  orderLabelStatus,
  orderReturnStatus,
  orderShippingStatus
};
