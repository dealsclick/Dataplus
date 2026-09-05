const { reconcileOrderReturns } = require('./return-workflow');
const { normalizeSourceOrderCompletion } = require('./source-order-completion');

function indexSavedTemuReturns(records) {
  const index = new Map();
  for (const record of records) {
    if (String(record.source).toLowerCase() !== 'temu') continue;
    const reference = record.channelOrderId || record.external?.parentOrderSn || record.external?.detail?.parentOrderSn;
    if (!reference) continue;
    const key = String(reference).trim();
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(record);
  }
  return index;
}

async function linkSavedTemuReturns(orders, index, { save, linesForOrder }) {
  let linked = 0;
  for (const order of orders) {
    if (String(order.source).toLowerCase() !== 'temu') continue;
    const reference = String(order.marketplaceOrderNumber || order.marketplaceOrderId || order.external?.parentOrderSn || '').trim();
    const records = index.get(reference) || [];
    const attached = [];
    for (const record of records) {
      // Never move an operator-linked return to a different order automatically.
      if (record.orderId && record.orderId !== order.id) continue;
      const items = (record.items || []).map((item) => {
        if (item.sku || !item.channelOrderItemId) return item;
        const candidates = linesForOrder(order).filter(line => String(line.temuOrderItemId || line.channelOrderItemId || line.orderSn || '') === String(item.channelOrderItemId));
        return candidates.length === 1 ? { ...item, sku: candidates[0].sku || '', title: item.title || candidates[0].title || '' } : item;
      });
      const wasUnlinked = !record.orderId;
      const next = await save({ ...record, orderId: order.id, orderNumber: order.orderNumber, items,
        updatedAt: new Date().toISOString(), linkedBy: record.linkedBy || 'Temu order import', linkedAt: record.linkedAt || new Date().toISOString() });
      Object.assign(record, next);
      attached.push(next);
      if (wasUnlinked) linked++;
    }
    if (attached.length) {
      reconcileOrderReturns(order, attached);
      normalizeSourceOrderCompletion(order);
    }
  }
  return linked;
}

module.exports = { indexSavedTemuReturns, linkSavedTemuReturns };
