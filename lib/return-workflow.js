const terminal = new Set(["closed", "resolved", "done", "canceled", "cancelled", "completed", "declined"]);
const normalized = (value) => String(value || "").trim().toLowerCase();
const crypto = require("node:crypto");
const { isPhysicalWarehouse } = require("./inventory-locations");

const returnAuditFields = [
  ["status", "Status"], ["condition", "Condition"], ["disposition", "Disposition"],
  ["warehouse", "Warehouse"], ["binLocation", "Bin"], ["inspectionStatus", "Inspection status"],
  ["inspectionCondition", "Inspection condition"], ["receivedAt", "Received date"], ["receivedBy", "Received by"],
  ["reason", "Reason"], ["note", "Internal note"], ["inspectionNotes", "Inspection notes"],
  ["resolutionNotes", "Resolution notes"], ["returnFee", "Return fee"], ["responsibility", "Responsibility"],
  ["attachmentCount", "Attachments"], ["items", "Received quantities"],
  ["vendorReturnEligibility", "Vendor return eligibility"]
];

function compactReturnAuditValue(value) {
  if (Array.isArray(value)) return value.map((line) => `${line.sku || "Item"}: ${Number(line.receivedQty || 0)}/${Number(line.qty || 0)}`).join(", ").slice(0, 1000);
  return String(value ?? "").slice(0, 1000);
}

function returnChangeSnapshot(record = {}) {
  return {
    status: record.status || record.receivingStatus || "",
    condition: record.condition || "",
    disposition: record.disposition || "",
    warehouse: record.warehouseName || record.warehouseId || "",
    binLocation: record.binLocation || "",
    inspectionStatus: record.inspectionStatus || "",
    inspectionCondition: record.inspectionCondition || "",
    receivedAt: record.receivedAt || "",
    receivedBy: record.receivedBy || "",
    reason: record.reason || "",
    note: record.note || "",
    inspectionNotes: record.inspectionNotes || "",
    resolutionNotes: record.resolutionNotes || "",
    returnFee: Number(record.returnFee || 0),
    responsibility: record.responsibility || "",
    attachmentCount: Array.isArray(record.attachments) ? record.attachments.length : 0,
    items: (Array.isArray(record.items) ? record.items : []).map((line) => ({ sku: line.sku || "", qty: Number(line.qty || 0), receivedQty: Number(line.receivedQty || 0) })),
    vendorReturnEligibility: record.vendorReturnEligibility
      ? [record.vendorReturnEligibility.status, record.vendorReturnEligibility.deadline, record.vendorReturnEligibility.supplier].filter(Boolean).join(" / ")
      : ""
  };
}

function appendReturnChangeHistory(record, beforeSnapshot = {}, options = {}) {
  const before = beforeSnapshot && beforeSnapshot.items !== undefined ? beforeSnapshot : returnChangeSnapshot(beforeSnapshot);
  const after = returnChangeSnapshot(record);
  const changes = returnAuditFields.flatMap(([field, label]) => {
    const previousValue = compactReturnAuditValue(before[field]);
    const nextValue = compactReturnAuditValue(after[field]);
    return previousValue === nextValue ? [] : [{ field, label, from: previousValue, to: nextValue }];
  });
  if (!changes.length && !options.force) return null;
  const action = String(options.action || (options.receiptOnly ? "received" : options.restocked ? "restocked" : "updated"));
  const event = {
    id: crypto.randomUUID(),
    action,
    title: String(options.title || (action === "received" ? "Return received" : action === "restocked" ? "Return restocked" : "Return updated")),
    user: String(options.user || "System"),
    createdAt: String(options.createdAt || new Date().toISOString()),
    changes
  };
  record.changeHistory = [event, ...(Array.isArray(record.changeHistory) ? record.changeHistory : [])].slice(0, 200);
  return event;
}

function calendarDate(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (dateOnly) {
    const date = new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

function evaluateVendorReturnEligibility(record = {}, order = {}, options = {}) {
  const windowDays = Math.max(1, Number(options.windowDays || 30));
  const orderDateValue = order.orderDate || order.orderedAt || order.placedAt || order.createdAt || record.orderDate || "";
  const orderDate = calendarDate(orderDateValue);
  const evaluatedInstant = new Date(options.now || Date.now());
  const evaluatedDate = calendarDate(evaluatedInstant) || calendarDate(new Date());
  const routes = Array.isArray(order.fulfillmentRoutes) ? order.fulfillmentRoutes : [];
  const returnSkus = new Set((Array.isArray(record.items) ? record.items : []).map((line) => normalized(line.sku)).filter(Boolean));
  const matchingRoutes = routes.filter((route) => !returnSkus.size || !route.sku || returnSkus.has(normalized(route.sku)));
  const source = matchingRoutes[0] || routes[0] || {};
  const supplier = String(source.vendorName || source.supplierName || source.supplier || order.vendorName || order.supplierName || order.supplier || "").trim();
  const vendorId = String(source.vendorId || order.vendorId || "").trim();
  const purchaseOrderId = String(source.purchaseOrderId || (Array.isArray(order.purchaseOrderIds) ? order.purchaseOrderIds[0] : "") || "").trim();
  const purchaseOrderNumber = String(source.purchaseOrderNumber || (Array.isArray(order.purchaseOrderNumbers) ? order.purchaseOrderNumbers[0] : "") || "").trim();
  const base = {
    windowDays,
    evaluatedAt: Number.isNaN(evaluatedInstant.getTime()) ? new Date().toISOString() : evaluatedInstant.toISOString(),
    orderDate: orderDate ? orderDate.toISOString().slice(0, 10) : "",
    supplier,
    vendorId,
    purchaseOrderId,
    purchaseOrderNumber
  };
  if (!orderDate || !evaluatedDate) {
    return { ...base, status: "unknown", qualifies: false, daysSinceOrder: null, daysRemaining: null, deadline: "", message: "Order date is unavailable. Purchasing must review vendor-return eligibility manually." };
  }
  const dayMs = 24 * 60 * 60 * 1000;
  const daysSinceOrder = Math.floor((evaluatedDate.getTime() - orderDate.getTime()) / dayMs);
  const deadlineDate = new Date(orderDate.getTime() + windowDays * dayMs);
  const deadline = deadlineDate.toISOString().slice(0, 10);
  if (daysSinceOrder < 0) {
    return { ...base, status: "unknown", qualifies: false, daysSinceOrder, daysRemaining: null, deadline, message: "Order date is in the future. Purchasing must review vendor-return eligibility manually." };
  }
  const qualifies = daysSinceOrder <= windowDays;
  const daysRemaining = Math.max(0, windowDays - daysSinceOrder);
  return {
    ...base,
    status: qualifies ? "eligible" : "expired",
    qualifies,
    daysSinceOrder,
    daysRemaining,
    deadline,
    message: qualifies
      ? `This order is ${daysSinceOrder} day${daysSinceOrder === 1 ? "" : "s"} old and is within the ${windowDays}-day vendor-return review window.`
      : `This order is ${daysSinceOrder} days old and is outside the ${windowDays}-day vendor-return review window.`
  };
}

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
    if (normalized(body.condition || record.condition) === "new" && normalized(body.disposition || record.disposition) === "restock" && photos.length < 1) return "Add one photo before receiving a New item for restock.";
  }
  const rawStatus = body.status || record.status;
  const status = rawStatus === "resolved" ? "done" : rawStatus;
  const disposition = body.disposition || record.disposition;
  const receiving = ["received", "inspection"].includes(status) || (status === "done" && disposition === "restock");
  if (record.restockedAt && (body.items?.some((line, index) => line.sku !== record.items?.[index]?.sku || Number(line.qty) !== Number(record.items?.[index]?.qty) || Number(line.receivedQty) !== Number(record.items?.[index]?.receivedQty)) || body.warehouseId && body.warehouseId !== record.warehouseId)) return "Restocked quantities and warehouse cannot be edited. Use an inventory adjustment to correct stock.";
  if (!receiving) return "";
  const warehouseId = body.receiptOnly && body.warehouseId !== undefined ? body.warehouseId : (body.warehouseId || record.warehouseId);
  const warehouse = warehouses.find((row) => row.id === warehouseId);
  if ((!body.receiptOnly || warehouseId) && (!warehouse || !isPhysicalWarehouse(warehouse) || /virtual|supplier|transfer/i.test(String(warehouse.warehouseType || warehouse.type || "")) || warehouse.allowReceiving === false || warehouse.active === false || String(warehouse.status).toLowerCase() === "inactive")) return "Select an active physical return warehouse.";
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

module.exports = { returnNeedsAttention, reconcileOrderReturns, ebayReturnEnvelope, validateReturnReceipt, returnChangeSnapshot, appendReturnChangeHistory, evaluateVendorReturnEligibility };
