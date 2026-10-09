const RECENT_SHIPMENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const CANCELED = new Set(['canceled', 'cancelled', 'void', 'voided', 'deleted', 'refunded', 'fully_refunded']);
const ROUTE_TERMINAL = new Set(['canceled', 'cancelled', 'closed', 'delivered', 'dismissed', 'expired', 'fulfilled', 'rejected', 'shipped', 'superseded', 'superseded_by_receipt_stock', 'void', 'voided']);
const SHIPMENT_TERMINAL = new Set(['canceled', 'cancelled', 'void', 'voided']);

function status(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function orderStatusValues(order = {}) {
  const external = order.external && typeof order.external === 'object' ? order.external : {};
  return [
    order.status, order.operationalStatus, order.workflowStatus, order.fulfillmentStatus,
    order.financialStatus, order.paymentStatus, order.channelStatus, order.marketplaceStatus,
    external.status, external.orderStatus, external.fulfillmentStatus,
    external.orderFulfillmentStatus, external.parentOrderStatus
  ].map(status).filter(Boolean);
}

function recentTimestamp(values = [], now = Date.now(), windowMs = RECENT_SHIPMENT_WINDOW_MS) {
  return values.some((value) => {
    const timestamp = new Date(value || 0).getTime();
    return Number.isFinite(timestamp) && timestamp > 0 && now >= timestamp && now - timestamp <= windowMs;
  });
}

function orderVisibleInAllShipments(order = {}, now = Date.now()) {
  if (order.cancelledAt || orderStatusValues(order).some((value) => CANCELED.has(value))) return false;

  const routes = Array.isArray(order.fulfillmentRoutes) ? order.fulfillmentRoutes : [];
  if (routes.some((route) => {
    const qty = Number(route.qty ?? route.quantity ?? route.qtyAllocated ?? 1);
    return qty > 0 && !ROUTE_TERMINAL.has(status(route.status));
  })) return true;

  const shipments = Array.isArray(order.shipments) ? order.shipments : [];
  return shipments.some((shipment) => {
    if (SHIPMENT_TERMINAL.has(status(shipment.voidStatus || shipment.status))) return false;
    const hasShipmentEvidence = Boolean(
      String(shipment.trackingNumber || '').trim()
      || String(shipment.labelPurchaseId || '').trim()
      || (Array.isArray(shipment.documents) && shipment.documents.length)
    );
    if (!hasShipmentEvidence) return false;
    return recentTimestamp([
      shipment.shippedAt,
      shipment.carrierConfirmedAt,
      shipment.labelPurchasedAt,
      shipment.createdAt,
      shipment.updatedAt
    ], now);
  });
}

module.exports = { RECENT_SHIPMENT_WINDOW_MS, orderVisibleInAllShipments };
