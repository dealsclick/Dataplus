const { sourceOrderFullyShipped } = require('./source-order-completion');
const { returnNeedsAttention } = require('./return-workflow');
const normal = value => String(value || '').trim().toLowerCase();
const list = value => Array.isArray(value) ? value : [];
const complete = new Set(['fulfilled', 'shipped', 'delivered', 'completed', 'complete', 'done']);
const terminalPo = new Set(['canceled', 'cancelled', 'closed', 'completed', 'received', 'deleted', 'rejected', 'superseded']);
const moneyKnown = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
const text = value => String(value || '').trim();

function reviewOrder(order, { returns = [], purchaseOrders = [] } = {}) {
  const issues = [];
  const base = { recordType: 'order', recordId: order.id, orderNumber: order.orderNumber || order.id, source: order.source || '', channelReference: order.channelOrderNumber || order.marketplaceOrderNumber || order.marketplaceOrderId || '', orderDate: order.orderDate || order.createdAt || '' };
  const add = (code, category, reason, action, extra = {}) => issues.push({ ...base, id: `${order.id}:${code}:${extra.lineIndex ?? extra.poId ?? ''}`, code, category, reason, action, ...extra });
  // Unship overrides, cancellations, open returns and genuine blockers must not be sent back to Done.
  if (!sourceOrderFullyShipped(order)) return issues;
  const openReturn = [...list(order.returns), ...returns].some(returnNeedsAttention);
  const blocking = list(order.workflowExceptions).some(row => normal(row.status) !== 'resolved' && ['blocking', 'error', 'critical', 'destructive'].includes(normal(row.severity)) && !['no_fulfillment_source', 'missing_catalog_product', 'supplier_unavailable', 'supplier_assignment_required'].includes(row.type));
  if (!openReturn && !blocking && !complete.has(normal(order.operationalStatus || order.workflowStatus))) {
    add('shipped_outside_done', 'operational', `Full shipment is recorded, but the operational queue is ${order.operationalStatus || order.workflowStatus || 'not set'}.`, 'Review the channel shipment and reconcile the local queue.');
  }
  const shipments = list(order.shipments).filter(row => !['canceled', 'cancelled', 'void', 'voided', 'unshipped', 'superseded'].includes(normal(row.status)));
  const items = list(order.items || order.lineItems || order.lines);
  items.forEach((line, index) => {
    const qty = Number(line.qty ?? line.quantity ?? 0);
    const explicitRemaining = line.remainingQty ?? line.remainingQuantity ?? line.unfulfilledQuantity;
    const direct = Number(line.fulfilledQty ?? line.fulfilledQuantity ?? line.qtyFulfilled ?? 0);
    const matches = row => Number(row.lineIndex) === index && (!row.sku || normal(row.sku) === normal(line.sku));
    const fulfillmentQty = list(order.fulfillmentLines).filter(matches).reduce((sum, row) => sum + Number(row.qtyFulfilled || 0), 0);
    const shipmentQty = shipments.flatMap(row => list(row.lines)).filter(matches).reduce((sum, row) => sum + Number(row.qtyFulfilled || 0), 0);
    const explicitOpen = explicitRemaining !== undefined && explicitRemaining !== null && Number(explicitRemaining) > 0;
    const fulfilled = complete.has(normal(line.fulfillmentStatus || line.status)) || Math.max(direct, fulfillmentQty, shipmentQty) >= qty;
    if (qty > 0 && (explicitOpen || !fulfilled)) add('line_fulfillment_mismatch', 'operational', `Line ${index + 1} still has open fulfillment data on a fully shipped order.`, 'Compare line quantities with source packages before correcting fulfillment.', { lineIndex: index, sku: line.sku || '' });
  });
  const packages = shipments.filter(row => complete.has(normal(row.status)) || row.trackingNumber || row.tracking?.number);
  if (packages.length) {
    const missingTracking = packages.filter(row => !text(row.trackingNumber || row.tracking?.number || (packages.length === 1 ? order.trackingNumber : '')));
    const missingCarrier = packages.filter(row => !text(row.carrierName || row.carrier || row.shippingCarrier || row.tracking?.company || (packages.length === 1 ? order.shippingCarrier || order.carrierName : '')));
    if (missingTracking.length) add('missing_tracking', 'reporting', `${missingTracking.length} shipped package(s) have no tracking number.`, 'Refresh shipment metadata from the channel.');
    if (missingCarrier.length) add('missing_carrier', 'reporting', `${missingCarrier.length} shipped package(s) have no carrier.`, 'Refresh the carrier from the channel or review the shipment.');
  } else {
    if (!text(order.trackingNumber)) add('missing_tracking', 'reporting', 'The shipped order has no saved tracking number.', 'Refresh source shipment metadata; do not reopen fulfillment.');
    if (!text(order.shippingCarrier || order.carrierName)) add('missing_carrier', 'reporting', 'The shipped order has no saved carrier.', 'Refresh source shipment metadata; do not reopen fulfillment.');
  }
  const labelCosts = [order.shippingCost, order.shippingLabelCost, ...packages.map(row => row.labelCost ?? row.shippingCost ?? row.cost)];
  if (!labelCosts.some(moneyKnown)) add('missing_label_cost', 'reporting', 'No usable shipping-label cost is saved. Customer shipping charges are not label costs.', 'Retrieve label charges or the provider statement before profit reporting.');
  for (const po of purchaseOrders) {
    if (terminalPo.has(normal(po.status))) continue;
    add('shipped_active_po', 'operational', `Fully shipped order remains linked to active PO ${po.poNumber || po.id} (${po.status || 'unknown status'}).`, 'Review this order\'s outstanding demand with Purchasing; do not cancel the whole PO automatically.', { poId: po.id, poNumber: po.poNumber || po.id });
  }
  return issues;
}
function reviewReturn(record, orderExists) {
  if (orderExists) return [];
  return [{ id: `return:${record.id}:unmatched_return`, code: 'unmatched_return', category: 'reporting', recordType: 'return', recordId: record.id, orderNumber: record.orderNumber || '', source: record.source || '', channelReference: record.channelOrderId || record.channelOrderNumber || '', orderDate: record.createdAt || '', reason: 'The return has no resolvable internal order link.', action: 'Recheck after the channel order import finishes. Do not match by channel reference alone.' }];
}
module.exports = { reviewOrder, reviewReturn };
