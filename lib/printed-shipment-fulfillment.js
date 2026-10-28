const { shipmentReopenPlan } = require("./shipment-corrections");

const COMPLETED_SHIPMENT_STATUSES = new Set(["fulfilled", "shipped", "delivered"]);
const CANCELED_ORDER_STATUSES = new Set(["canceled", "cancelled", "void", "deleted"]);

function normalizedSku(value) {
  return String(value || "").trim().toLowerCase();
}

function applyPrintedShipmentFulfillment(order = {}, shipment = {}, options = {}) {
  const completedAt = String(options.completedAt || new Date().toISOString());
  const actor = String(options.actor || "Warehouse");
  const shipmentStatus = String(shipment.status || "").trim().toLowerCase();
  if (shipment.printFulfillment?.status === "completed" || COMPLETED_SHIPMENT_STATUSES.has(shipmentStatus)) {
    return { status: "already_completed", changed: false, completedLines: [], completedAt: shipment.fulfilledAt || completedAt };
  }
  if (CANCELED_ORDER_STATUSES.has(String(order.status || "").trim().toLowerCase())) {
    throw new Error("A canceled order cannot be marked fulfilled from a label print.");
  }

  const orderLines = Array.isArray(order.items) && order.items.length
    ? order.items
    : [{ sku: order.sku, title: order.title, qty: order.qty }];
  const plan = shipmentReopenPlan(orderLines, shipment);
  order.fulfillmentLines = Array.isArray(order.fulfillmentLines) ? order.fulfillmentLines : [];
  order.fulfillmentRoutes = Array.isArray(order.fulfillmentRoutes) ? order.fulfillmentRoutes : [];

  const completedLines = [];
  for (const { lineIndex, qty } of plan) {
    const orderLine = orderLines[lineIndex];
    const sku = String(orderLine?.sku || "").trim();
    if (!orderLine || !sku) throw new Error("The printed shipment is not linked to a valid order line.");
    const orderedQty = Math.max(0, Number(orderLine.qty || 0));
    let fulfillmentRow = order.fulfillmentLines.find((line) => Number(line.lineIndex) === lineIndex && normalizedSku(line.sku) === normalizedSku(sku));
    if (!fulfillmentRow) {
      fulfillmentRow = { lineIndex, sku, qtyFulfilled: 0 };
      order.fulfillmentLines.push(fulfillmentRow);
    }
    const alreadyFulfilled = Math.max(0, Number(fulfillmentRow.qtyFulfilled || 0));
    const fulfilledNow = Math.max(0, Math.min(Number(qty || 0), orderedQty - alreadyFulfilled));
    fulfillmentRow.qtyFulfilled = alreadyFulfilled + fulfilledNow;
    fulfillmentRow.updatedAt = completedAt;

    orderLine.fulfilledQty = fulfillmentRow.qtyFulfilled;
    orderLine.fulfilledQuantity = fulfillmentRow.qtyFulfilled;
    orderLine.remainingQty = Math.max(0, orderedQty - fulfillmentRow.qtyFulfilled);
    orderLine.fulfillmentStatus = orderLine.remainingQty === 0 ? "fulfilled" : fulfillmentRow.qtyFulfilled > 0 ? "partially_fulfilled" : orderLine.fulfillmentStatus;
    orderLine.status = orderLine.remainingQty === 0 ? "fulfilled" : fulfillmentRow.qtyFulfilled > 0 ? "partially_fulfilled" : orderLine.status;

    if (fulfilledNow > 0) completedLines.push({ lineIndex, sku, qty: fulfilledNow });
    if (orderLine.remainingQty === 0) {
      for (const route of order.fulfillmentRoutes) {
        const routeMatches = Number(route.lineIndex) === lineIndex
          || (route.lineIndex == null && normalizedSku(route.sku) === normalizedSku(sku));
        if (!routeMatches || ["canceled", "cancelled", "closed", "shipped", "delivered"].includes(String(route.status || "").toLowerCase())) continue;
        route.status = "shipped";
        route.shippedAt = completedAt;
        route.shippedBy = actor;
        route.shipmentId = shipment.id || route.shipmentId || "";
        route.trackingNumber = shipment.trackingNumber || route.trackingNumber || "";
      }
    }
  }

  for (const shipmentLine of Array.isArray(shipment.lines) ? shipment.lines : []) {
    const linkedQty = Math.max(0, Number(shipmentLine.qtyFulfilled ?? shipmentLine.qty ?? shipmentLine.qtyAllocated ?? 0));
    shipmentLine.qtyAllocated = Math.max(linkedQty, Number(shipmentLine.qtyAllocated || 0));
    shipmentLine.qtyFulfilled = linkedQty;
  }

  const totalOrderedQty = orderLines.reduce((sum, line) => sum + Math.max(0, Number(line.qty || 0)), 0);
  const totalFulfilledQty = order.fulfillmentLines.reduce((sum, line) => sum + Math.max(0, Number(line.qtyFulfilled || 0)), 0);
  const fullyFulfilled = totalOrderedQty > 0 && totalFulfilledQty >= totalOrderedQty;
  order.status = fullyFulfilled ? "fulfilled" : "partial_fulfilled";
  order.fulfillmentStatus = order.status;
  order.fulfilledAt = fullyFulfilled ? completedAt : order.fulfilledAt || "";
  order.confirmedAt = order.confirmedAt || completedAt;
  order.shippingCarrier = shipment.carrier || shipment.carrierName || order.shippingCarrier || "";
  order.carrierName = shipment.carrierName || shipment.carrier || order.carrierName || "";
  order.shippingService = shipment.service || order.shippingService || "";
  order.trackingNumber = shipment.trackingNumber || order.trackingNumber || "";
  order.trackingUrl = shipment.trackingUrl || order.trackingUrl || "";
  order.shipDate = shipment.shipDate || completedAt.slice(0, 10);
  order.operationalStatus = fullyFulfilled ? "completed" : "partially_fulfilled";
  order.workflowStatus = order.operationalStatus;
  order.workflowUpdatedAt = completedAt;
  order.updatedAt = completedAt;

  shipment.status = "fulfilled";
  shipment.shipDate = shipment.shipDate || completedAt.slice(0, 10);
  shipment.fulfilledAt = shipment.fulfilledAt || completedAt;
  shipment.updatedAt = completedAt;
  shipment.printFulfillment = {
    status: "completed",
    completedAt,
    completedBy: actor,
    fulfilledQty: completedLines.reduce((sum, line) => sum + line.qty, 0)
  };

  return { status: "completed", changed: true, completedLines, completedAt, fullyFulfilled, totalOrderedQty, totalFulfilledQty };
}

module.exports = { applyPrintedShipmentFulfillment };
