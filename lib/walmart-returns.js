const crypto = require('node:crypto');

const array = value => Array.isArray(value) ? value : [];
const text = value => String(value ?? '').trim();
const number = value => {
  const parsed = Number(String(value ?? '').replace(/[$,]/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
};
const returnLines = value => array(value).length ? value : array(value?.returnOrderLine);

function walmartReturnRows(response = {}) {
  const candidates = [
    response.returnOrders,
    response.returnOrders?.returnOrder,
    response.returns,
    response.returns?.returnOrder,
    response.payload,
    response.payload?.returnOrders,
    response.payload?.returnOrders?.returnOrder,
    response.list?.elements?.returnOrder
  ];
  return candidates.find(Array.isArray) || [];
}

function walmartReturnNextCursor(response = {}) {
  const cursor = text(response.meta?.nextCursor || response.list?.meta?.nextCursor || response.nextCursor);
  if (!cursor) return '';
  if (!cursor.startsWith('?') || cursor.includes('://') || cursor.includes('\\')) throw new Error('Walmart returned an invalid return cursor.');
  return cursor;
}

function returnLifecycle(lines = []) {
  const statuses = lines.flatMap(line => [line.status, ...array(line.currentTrackingStatuses).map(row => row.status)]).map(value => text(value).toUpperCase()).filter(Boolean);
  const events = lines.flatMap(line => array(line.returnTrackingDetail).map(row => text(row.eventTag).toUpperCase())).filter(Boolean);
  if (events.includes('RETURN_CANCELLED') || statuses.includes('CANCELLED')) return 'canceled';
  if (statuses.includes('COMPLETED') || events.some(value => ['REFUND_ISSUED', 'DELIVERED_AFTER_INVOICE', 'INTRANSIT_AFTER_INVOICE'].includes(value))) return 'completed';
  if (statuses.includes('DELIVERED') || events.includes('DELIVERED_AT_RETURN_CENTER')) return 'delivered';
  return 'requested';
}

function returnTracking(raw = {}) {
  const groups = array(raw.returnLineGroups).length ? raw.returnLineGroups : array(raw.returnLineGroups?.returnLineGroup);
  const rows = groups.flatMap(group => array(group.labels).length ? group.labels : array(group.labels?.label)).flatMap(label => (array(label.carrierInfoList).length ? label.carrierInfoList : array(label.carrierInfoList?.carrierInfo)).map(carrier => ({
    trackingNumber: text(carrier.trackingNo),
    carrier: text(carrier.carrierName || carrier.carrierId),
    service: text(carrier.serviceType),
    labelUrl: text(label.labelImageURL)
  })));
  return [...new Map(rows.filter(row => row.trackingNumber).map(row => [row.trackingNumber, row])).values()];
}

function walmartReturnRecord(raw = {}, order = null) {
  const lines = returnLines(raw.returnOrderLines);
  const returnId = text(raw.returnOrderId);
  if (!returnId || !lines.length) throw new Error('Walmart return is missing its return ID or line items.');
  const purchaseOrderId = text(lines.find(line => line.purchaseOrderId)?.purchaseOrderId || raw.purchaseOrderId || raw.sellerOrderId);
  const customerOrderId = text(raw.customerOrderId);
  const lifecycle = returnLifecycle(lines);
  const explicitTotal = raw.totalRefundAmount?.currencyAmount;
  const amount = explicitTotal === undefined || explicitTotal === null
    ? lines.reduce((sum, line) => sum + array(line.chargeTotals).filter(row => /lineTotal/i.test(text(row.name))).reduce((lineSum, row) => lineSum + number(row.value?.currencyAmount), 0), 0)
    : number(explicitTotal);
  const reasons = [...new Set(lines.flatMap(line => [line.returnReason, line.returnDescription]).map(text).filter(Boolean))];
  const items = lines.map(line => {
    const sourceLineId = text(line.purchaseOrderLineNumber || line.salesOrderLineNumber);
    const orderLine = array(order?.items).find(item => [item.sourceLineId, item.lineItemId, item.id].map(text).includes(sourceLineId))
      || array(order?.items).find(item => text(item.sku).toLowerCase() === text(line.item?.sku).toLowerCase());
    return {
      channelLineId: text(line.returnOrderLineNumber),
      sourceLineId,
      sku: text(orderLine?.sku || line.item?.sku),
      originalSku: text(line.item?.sku),
      title: text(line.item?.productName || orderLine?.title),
      qty: number(line.quantity?.measurementValue ?? line.refundedQty ?? 0),
      receivedQty: 0,
      reason: text(line.returnReason),
      description: text(line.returnDescription),
      channelStatus: text(line.status),
      refundStatus: text(line.currentRefundStatus),
      eventTags: array(line.returnTrackingDetail).map(event => text(event.eventTag)).filter(Boolean)
    };
  });
  return {
    id: `walmart-return-${crypto.createHash('sha256').update(returnId).digest('hex').slice(0, 24)}`,
    returnNumber: returnId,
    orderId: text(order?.id),
    orderNumber: text(order?.orderNumber),
    source: 'Walmart', channel: 'Walmart', channelReturnId: returnId,
    purchaseOrderId, customerOrderId,
    channelStatus: text(lines[0]?.status || lifecycle),
    channelLifecycleStatus: lifecycle,
    status: lifecycle,
    createdAt: text(raw.returnOrderDate || raw.createdDate),
    updatedAt: text(raw.lastUpdatedDate || lines.map(line => line.statusTime).filter(Boolean).sort().at(-1) || raw.returnOrderDate || new Date().toISOString()),
    returnByDate: text(raw.returnByDate), returnType: text(raw.returnType), refundMode: text(raw.refundMode),
    amount, actualRefundAmount: lifecycle === 'completed' ? amount : null,
    refundStatus: lines.some(line => /COMPLETED|ISSUED/i.test(text(line.currentRefundStatus))) ? 'confirmed' : 'pending',
    currency: text(raw.totalRefundAmount?.currencyUnit || lines[0]?.unitPrice?.currencyUnit || order?.currency || 'USD'),
    reason: reasons.join('; '), returnTracking: returnTracking(raw), items,
    external: { returnOrder: raw },
    channelSync: { channel: 'Walmart', status: 'synced', returnId }
  };
}

module.exports = { walmartReturnRows, walmartReturnNextCursor, walmartReturnRecord };
