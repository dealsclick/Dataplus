const { returnNeedsAttention } = require("./return-workflow");
const complete = new Set(["fulfilled", "shipped", "delivered", "completed", "complete", "done"]);
const canceled = new Set(["canceled", "cancelled", "void", "voided", "deleted"]);
const normalize = (value) => String(value || "").trim().toLowerCase();
const obsoleteSourcing = new Set(["no_fulfillment_source", "missing_catalog_product", "supplier_unavailable", "supplier_assignment_required"]);

function sourceOrderFullyShipped(order) {
  const external = order.external || {};
  if (order.shipmentCorrection?.active || order.cancelledAt) return false;
  if ([order.status, order.channelStatus, external.status, external.orderStatus, external.cancelStatus?.cancelState].some((value) => canceled.has(normalize(value)))) return false;
  if ([order.status, order.fulfillmentStatus, order.channelStatus, external.orderFulfillmentStatus, external.fulfillmentStatus, external.shippingStatus].some((value) => complete.has(normalize(value)))) return true;
  const lines = order.items || order.lineItems || order.lines || [];
  return lines.length > 0 && lines.every((line) => complete.has(normalize(line.fulfillmentStatus)));
}

function normalizeSourceOrderCompletion(order, options = {}) {
  if (!sourceOrderFullyShipped(order)) return false;
  const now = options.now || new Date().toISOString();
  const actor = options.user || "Channel completion reconciliation";
  let changed = false;
  for (const entry of order.workflowExceptions || []) {
    if (normalize(entry.status) === "resolved") continue;
    if (obsoleteSourcing.has(entry.type) || entry.type === "channel_canceled_after_shipment") {
      Object.assign(entry, { status: "resolved", resolvedAt: now, resolvedBy: actor, resolution: "The source confirms full shipment. No active cancellation is present; this fulfillment exception is obsolete." });
      changed = true;
    }
  }
  const openReturn = [...(order.returns || []), ...(options.relatedReturns || [])].some(returnNeedsAttention);
  const blocking = (order.workflowExceptions || []).some((entry) => normalize(entry.status) !== "resolved" && ["blocking", "error", "critical", "destructive"].includes(normalize(entry.severity)));
  const next = openReturn || blocking ? "on_hold" : "completed";
  if (order.operationalStatus !== next || order.workflowStatus !== next) {
    order.operationalStatus = next;
    order.workflowStatus = next;
    order.routingLastResult = "terminal";
    changed = true;
  }
  if (changed) {
    order.workflowUpdatedAt = now;
    order.updatedAt = now;
    order.timeline = [...(order.timeline || []), { id: require("node:crypto").randomUUID(), type: "channel_sync", title: "Source shipment reconciled", message: "Full source shipment confirmed. Obsolete fulfillment exceptions resolved; payment and refund records retained.", user: actor, createdAt: now }];
  }
  return changed;
}

module.exports = { sourceOrderFullyShipped, normalizeSourceOrderCompletion };
