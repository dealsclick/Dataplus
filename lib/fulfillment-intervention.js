const WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const RECOVERY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const CANCELED = new Set(['canceled', 'cancelled', 'void', 'voided', 'deleted']);
const REFUNDED = new Set(['refunded', 'fully_refunded', 'refunded_without_return']);
const MOVING = new Set(['accepted', 'picked_up', 'carrier_confirmed', 'in_transit', 'out_for_delivery']);
const SHIPPED = new Set(['fulfilled', 'shipped', 'in_transit', 'out_for_delivery', 'delivered']);

function status(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function externalStatuses(order = {}) {
  const external = order.external && typeof order.external === 'object' ? order.external : {};
  const marketplaceCancellation = order.marketplaceCancellation && typeof order.marketplaceCancellation === 'object' ? order.marketplaceCancellation : {};
  return [
    order.status, order.fulfillmentStatus, order.fulfillmentStage, order.channelStatus, order.marketplaceStatus,
    external.status, external.fulfillmentStatus, external.fulfillmentStage, external.orderStatus,
    external.orderFulfillmentStatus, external.parentOrderStatus, external.packageStatus, external.shippingStatus,
    external.cancelStatus?.cancelState, marketplaceCancellation.status
  ].map(status).filter(Boolean);
}

function evaluateFulfillmentIntervention(order = {}, now = Date.now()) {
  const statuses = externalStatuses(order);
  const financialStatus = status(order.financialStatus || order.paymentStatus || '');
  const refunds = Array.isArray(order.refunds) ? order.refunds.filter(Boolean) : [];
  const refundedAmount = Math.max(Number(order.refundAmount || 0), refunds.reduce((sum, refund) => sum + Number(refund.amount || refund.refundAmount || refund.total || 0), 0));
  const orderTotal = Number(order.paidAmount || order.total || order.orderTotal || 0);
  const isRefunded = REFUNDED.has(financialStatus)
    || statuses.some((value) => REFUNDED.has(value))
    || (refundedAmount > 0 && orderTotal > 0 && refundedAmount >= orderTotal - 0.01)
    || refunds.some((refund) => ['full_refund', 'fully_refunded', 'refunded_without_return'].includes(status(refund.status || refund.type)));
  const isCanceled = Boolean(order.cancelledAt || order.canceledAt) || statuses.some((value) => CANCELED.has(value));
  if (!isRefunded && !isCanceled) return null;

  const recent = (value) => {
    const time = new Date(value || 0).getTime();
    return Number.isFinite(time) && time > 0 && now - time >= 0 && now - time <= WINDOW_MS;
  };
  const recentRecoveryEvidence = (value) => {
    const time = new Date(value || 0).getTime();
    return Number.isFinite(time) && time > 0 && now - time >= 0 && now - time <= RECOVERY_WINDOW_MS;
  };
  const shipments = Array.isArray(order.shipments) ? order.shipments : [];
  const shipmentStatuses = (shipment = {}) => [shipment.trackingStatus, shipment.carrierStatus, shipment.shipmentStatus, shipment.fulfillmentStatus, shipment.status].map(status).filter(Boolean);
  const movingShipment = shipments.find((shipment) => String(shipment.trackingNumber || '').trim()
    && shipmentStatuses(shipment).some((value) => MOVING.has(value)));
  const shippedShipment = movingShipment || shipments.find((shipment) => String(shipment.trackingNumber || '').trim()
    && shipmentStatuses(shipment).some((value) => SHIPPED.has(value)));
  const trackingNumber = String(order.trackingNumber || shippedShipment?.trackingNumber || shipments.find((shipment) => shipment.trackingNumber)?.trackingNumber || '').trim();
  // A routine import can update the order row without changing its marketplace
  // disposition. Only explicit cancellation/refund status timestamps establish
  // the three-day intervention window.
  const interventionChangedAt = order.refundedAt || order.cancelledAt || order.canceledAt || order.channelStatusUpdatedAt || order.financialStatusUpdatedAt || '';
  const activeRoutes = (Array.isArray(order.fulfillmentRoutes) ? order.fulfillmentRoutes : []).filter((route) => {
    const routeStatus = status(route.status || '');
    const qty = Number(route.qty ?? route.quantity ?? route.qtyAllocated ?? 1);
    return qty > 0 && !['canceled', 'cancelled', 'closed', 'delivered', 'dismissed', 'fulfilled', 'received', 'rejected', 'shipped', 'superseded', 'superseded_by_receipt_stock', 'void', 'voided'].includes(routeStatus);
  });
  const pendingOperationalStatus = ['allocated', 'label_ready', 'packing', 'pending_shipment', 'picked', 'processing', 'ready_to_ship']
    .includes(status(order.operationalStatus || order.workflowStatus || order.fulfillmentStage || ''));
  const labelAwaitingShipment = shipments.some((shipment) => String(shipment.trackingNumber || '').trim()
    && !shipmentStatuses(shipment).some((value) => MOVING.has(value) || value === 'delivered'));
  const pendingShipmentWork = activeRoutes.length > 0 || pendingOperationalStatus || labelAwaitingShipment;
  const wasPaid = Number(order.paidAmount || 0) > 0
    || ['paid', 'partially_refunded', 'refunded'].includes(status(order.previousFinancialStatus || order.paymentStatusBeforeRefund || ''));
  // Once a paid parcel has left the warehouse, a later channel cancellation or
  // refund remains actionable until an operator resolves it. Do not age it out
  // merely because carrier movement or the cancellation timestamp was omitted
  // by an older marketplace import.
  const persistedRecovery = order.fulfillmentDisposition?.kind === 'recovery_required'
    && !['resolved', 'closed', 'dismissed'].includes(status(order.fulfillmentDisposition?.status));
  const recoveryEvidenceAt = shippedShipment?.shippedAt || shippedShipment?.shipDate || shippedShipment?.carrierConfirmedAt
    || shippedShipment?.trackingCheckedAt || shippedShipment?.updatedAt || shippedShipment?.createdAt || order.shippedAt || order.shipDate || order.orderDate;
  const recoveryRequired = (isRefunded || isCanceled) && wasPaid && Boolean(shippedShipment)
    && (persistedRecovery || recentRecoveryEvidence(recoveryEvidenceAt)) && order.duplicateOrderRecord !== true;
  if (!recoveryRequired && (!recent(interventionChangedAt) || !pendingShipmentWork)) return null;

  const hasReturn = (Array.isArray(order.returns) && order.returns.some((entry) => !['canceled', 'cancelled', 'rejected', 'void', 'voided'].includes(status(entry.status))))
    || Boolean(order.returnId || order.returnNumber || order.returnRequestedAt || order.returnReceivedAt);
  const sourceReason = isRefunded ? 'refunded' : 'canceled';
  const deliveredWithoutReturn = recoveryRequired && isRefunded && !hasReturn
    && shipmentStatuses(shippedShipment).includes('delivered');
  const reasonCode = deliveredWithoutReturn ? 'refunded_after_delivery_no_return'
    : recoveryRequired ? `${sourceReason}_after_shipment`
      : trackingNumber ? `${sourceReason}_with_unshipped_label` : `${sourceReason}_at_channel`;
  const reasonLabel = deliveredWithoutReturn ? 'Refunded after delivery; return or reimbursement required'
    : recoveryRequired ? `${isRefunded ? 'Refunded' : 'Canceled'} after shipment; recovery required`
      : isRefunded ? trackingNumber ? 'Refunded; label must be voided' : 'Refunded at channel'
        : trackingNumber ? 'Canceled; label must be voided' : 'Canceled at channel';
  const action = recoveryRequired
    ? hasReturn ? 'Track the customer return and open a marketplace case if reimbursement is not received.' : 'Request a customer return or open a marketplace reimbursement case.'
    : trackingNumber ? 'Do not ship. Void the unused label and release warehouse work.' : 'Do not ship. Release warehouse work and stop label purchase.';
  return {
    kind: recoveryRequired ? 'recovery_required' : 'do_not_ship', sourceReason, reasonCode, reasonLabel, action,
    shipmentState: recoveryRequired ? 'in_transit' : trackingNumber ? 'label_created' : 'not_shipped',
    trackingNumber,
    carrier: String(order.carrier || shippedShipment?.carrier || shipments.find((shipment) => shipment.trackingNumber === trackingNumber)?.carrier || shipments.find((shipment) => shipment.carrier)?.carrier || '').trim(),
    hasReturn
  };
}

module.exports = { evaluateFulfillmentIntervention };
