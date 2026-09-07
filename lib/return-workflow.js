const terminal = new Set(["closed", "resolved", "done", "canceled", "cancelled", "completed", "declined"]);
const normalized = (value) => String(value || "").trim().toLowerCase();
const { isPhysicalWarehouse } = require("./inventory-locations");

function returnNeedsAttention(record = {}) {
  // Receiving is independent of the channel case. Explicit local receiving keeps local work open.
  if (record.channelLifecycleStatus && !terminal.has(normalized(record.channelLifecycleStatus))) return true;
  if (record.receivingStatus) return !terminal.has(normalized(record.receivingStatus));
  if (record.channelLifecycleStatus) return false;
  return !terminal.has(normalized(record.status || record.returnStatus));
}

function reconcileOrderReturns(order, records) {
  const summaries = new Map((order.returns || []).map((row) => [String(row.id || row.channelReturnId), row]));
  for (const row of records) {
    if (row.orderId !== order.id && String(row.orderNumber) !== String(order.orderNumber)) continue;
    summaries.set(String(row.id || row.channelReturnId), {
      id: row.id, returnNumber: row.returnNumber, source: row.source,
      channelReturnId: row.channelReturnId, status: row.status,
      channelStatus: row.channelStatus, channelLifecycleStatus: row.channelLifecycleStatus,
      receivingStatus: row.receivingStatus, amount: row.amount, updatedAt: row.updatedAt
    });
  }
  order.returns = [...summaries.values()];
  const active = order.returns.filter(returnNeedsAttention);
  order.workflowExceptions = (order.workflowExceptions || []).filter((entry) => entry.type !== "open_channel_return");
  if (active.length) order.workflowExceptions.push({
    id: `returns-${order.id}`, type: "open_channel_return", severity: "blocking", status: "open",
    owner: "Returns", description: `${active.length} open return(s). Review the Returns tab for channel status, receiving, and refund details.`
  });
  return active.length;
}

function ebayReturnEnvelope(summary = {}, response = {}) {
  const header = response.summary || summary;
  const detail = response.detail || response;
  const creation = header.creationInfo || summary.creationInfo || {};
  const actual = header.sellerTotalRefund?.actualRefundAmount ?? header.buyerTotalRefund?.actualRefundAmount;
  const estimate = header.sellerTotalRefund?.estimatedRefundAmount ?? header.buyerTotalRefund?.estimatedRefundAmount;
  const shipping = detail.returnShipmentInfo || {};
  const tracking = [shipping.shipmentTracking, ...(shipping.allShipmentTrackings || [])].filter(Boolean);
  return {
    ...summary, ...header, ...detail,
    returnId: header.returnId || summary.returnId,
    state: header.state || summary.state,
    item: detail.itemDetail || creation.item,
    reason: creation.reason || summary.reason,
    creationDate: creation.creationDate || summary.creationDate,
    actualRefundAmount: actual,
    estimatedRefundAmount: estimate,
    returnTracking: [...new Map(tracking.filter((row) => row.trackingNumber).map((row) => [row.trackingNumber, {
      trackingNumber: row.trackingNumber, carrier: row.carrierName || row.carrierEnum || row.carrierUsed || "",
      status: row.deliveryStatus || "", shippedAt: row.actualShipDate?.value || row.shipDate?.value || ""
    }])).values()]
  };
}

function validateReturnReceipt(record, body, warehouses) {
  if (body.expectedUpdatedAt !== undefined && String(body.expectedUpdatedAt) !== String(record.updatedAt || "")) return "This return changed. Look it up again before receiving.";
  if (body.receiptOnly) {
    if (body.status !== "received" || record.restockedAt) return "Receiving must remain separate from restocking. This receipt cannot change restocked stock.";
    if (!Array.isArray(body.items)) return "Keep all expected return lines when recording a receipt.";
    if (body.items.some((line, index) => Number(line.receivedQty || 0) < Number(record.items?.[index]?.receivedQty || 0))) return "Previously received quantities cannot be reduced in a new receipt.";
    const photos = body.attachments || [];
    if (!Array.isArray(photos) || photos.length > 3 || photos.some(file => !/^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(String(file.dataUrl || "")) || String(file.dataUrl).length > 1400000)) return "Use up to 3 JPEG, PNG or WebP photos of 1 MB each.";
  }
  const rawStatus = body.status || record.status;
  const status = rawStatus === "resolved" ? "done" : rawStatus;
  const disposition = body.disposition || record.disposition;
  const receiving = ["received", "inspection"].includes(status) || (status === "done" && disposition === "restock");
  if (record.restockedAt && (body.items?.some((line, index) => line.sku !== record.items?.[index]?.sku || Number(line.qty) !== Number(record.items?.[index]?.qty) || Number(line.receivedQty) !== Number(record.items?.[index]?.receivedQty)) || body.warehouseId && body.warehouseId !== record.warehouseId)) return "Restocked quantities and warehouse cannot be edited. Use an inventory adjustment to correct stock.";
  if (!receiving) return "";
  const warehouse = warehouses.find((row) => row.id === (body.warehouseId || record.warehouseId));
  if (!warehouse || !isPhysicalWarehouse(warehouse) || /virtual|supplier|transfer/i.test(String(warehouse.warehouseType || warehouse.type || "")) || warehouse.allowReceiving === false || warehouse.active === false || String(warehouse.status).toLowerCase() === "inactive") return "Select an active physical return warehouse.";
  const items = body.items || record.items || [];
  if (!items.length) return "Select return items before receiving.";
  if (!Array.isArray(items) || items.length !== (record.items || []).length) return "Keep all expected return lines when recording a receipt.";
  for (const [index, line] of items.entries()) {
    const original = (record.items || [])[index];
    if (!original || original.sku !== line.sku || Number(original.qty) !== Number(line.qty)) return "Return item identity and requested quantities cannot change during receiving.";
    const qty = Number(line.receivedQty ?? original.receivedQty ?? 0);
    if (!Number.isInteger(qty) || qty < 0 || qty > Number(original.qty)) return "Received quantities must be whole numbers between zero and the requested quantity.";
  }
  if (!items.some((line) => Number(line.receivedQty || 0) > 0)) return "Confirm the quantity physically received for at least one item.";
  if (status === "done" && disposition === "restock" && (body.inspectionStatus || record.inspectionStatus) !== "passed") return "Pass the inspection before restocking.";
  return "";
}

module.exports = { returnNeedsAttention, reconcileOrderReturns, ebayReturnEnvelope, validateReturnReceipt };
