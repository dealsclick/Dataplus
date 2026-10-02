const { isDeepStrictEqual } = require('node:util');
const { sourceOrderFullyShipped } = require('./source-order-completion');
const MODES = ['intake', 'status', 'enrichment'];
const CLOSED_ORDER_STATUSES = new Set(['canceled', 'cancelled', 'void', 'voided', 'deleted', 'refunded']);

function temuParentOrderSn(order = {}) {
  return String(order.marketplaceOrderNumber || order.marketplaceOrderId || order.external?.parentOrderSn || '').trim();
}

function selectOpenStatusSweep(orders = [], options = {}) {
  const limit = Math.max(1, Math.min(5000, Number(options.limit || 250) || 250));
  const candidates = [...new Set((Array.isArray(orders) ? orders : [])
    .filter((order) => String(order?.source || '').trim().toLowerCase() === 'temu')
    .filter((order) => !sourceOrderFullyShipped(order))
    .filter((order) => !CLOSED_ORDER_STATUSES.has(String(order.status || order.fulfillmentStatus || '').trim().toLowerCase()))
    .map(temuParentOrderSn)
    .filter(Boolean))].sort((left, right) => left.localeCompare(right));
  if (!candidates.length) return { parentOrderSnList: [], candidateCount: 0, nextOffset: 0 };
  const offset = Math.max(0, Number(options.offset || 0) || 0) % candidates.length;
  const count = Math.min(limit, candidates.length);
  const parentOrderSnList = Array.from({ length: count }, (_, index) => candidates[(offset + index) % candidates.length]);
  return { parentOrderSnList, candidateCount: candidates.length, nextOffset: (offset + count) % candidates.length };
}

function lineIdentity(line = {}, fallback = '') {
  return String(line.channelOrderItemId || line.temuOrderItemId || line.external?.raw?.orderSn || fallback).trim();
}

function mergeStatusLines(existingLines = [], incomingLines = []) {
  if (!Array.isArray(existingLines) || !Array.isArray(incomingLines) || !incomingLines.length) return existingLines;
  const incomingById = new Map(incomingLines.map((line, index) => [lineIdentity(line, `index:${index}`), line]));
  return existingLines.map((line, index) => {
    const incoming = incomingById.get(lineIdentity(line, `index:${index}`));
    if (!incoming) return line;
    const next = { ...line };
    for (const key of ['fulfilledQty', 'remainingQty', 'fulfillmentStatus', 'status']) {
      if (incoming[key] !== undefined && incoming[key] !== null && incoming[key] !== '') next[key] = incoming[key];
    }
    if (incoming.external?.raw) next.external = { ...(line.external || {}), raw: incoming.external.raw };
    return next;
  });
}
function orderMode(options = {}) {
  const mode = options.mode || (options.repairBlind ? 'enrichment' : options.parentOrderSnList?.length ? 'status' : 'intake');
  if (!MODES.includes(mode)) throw new Error('Unknown Temu order job mode.');
  return mode;
}
function mergePhase(existing, incoming, mode, mergeShipments) {
  if (!existing) return mode === 'intake' ? incoming : null;
  if (mode === 'intake' || ['void', 'deleted'].includes(existing.status)) return null;
  const next = { ...existing, external: { ...existing.external } };
  if (mode === 'status') {
    // Status reconciliation must not replace prices, quantities, SKU links or local work.
    for (const key of ['status', 'fulfillmentStatus', 'financialStatus', 'paymentStatus']) {
      if (incoming[key]) next[key] = incoming[key];
    }
    if (incoming.shipBy) next.shipBy = incoming.shipBy;
    if (incoming.shipDate) next.shipDate = incoming.shipDate;
    next.items = mergeStatusLines(existing.items, incoming.items);
    if (incoming.shipments?.length && typeof mergeShipments === 'function') next.shipments = mergeShipments(existing.shipments, incoming.shipments);
    for (const key of ['trackingNumber', 'trackingUrl', 'shippingCarrier', 'carrierName']) {
      if (incoming[key]) next[key] = incoming[key];
    }
  } else {
    for (const key of ['trackingNumber', 'trackingUrl', 'shippingCarrier', 'carrierName', 'shipDate']) {
      if (incoming[key]) next[key] = incoming[key];
    }
    if (incoming.address?.line1 && incoming.address?.city && incoming.address?.postalCode) next.address = incoming.address;
    for (const key of ['buyer', 'buyerEmail', 'phone']) {
      if (incoming[key] && incoming[key] !== 'Temu buyer') next[key] = incoming[key];
    }
    if (incoming.shipments?.length) next.shipments = mergeShipments(existing.shipments, incoming.shipments);
    for (const key of ['shipping', 'decryptedShipping', 'unshippedPackage', 'combinedShipment', 'logisticsShipmentV2', 'shipmentResult', 'trackingInfo', 'labelList', 'customization']) {
      if (incoming.external?.[key] && Object.keys(incoming.external[key]).length) next.external[key] = incoming.external[key];
    }
  }
  if (isDeepStrictEqual(next, existing)) return null;
  return next;
}
module.exports = { MODES, orderMode, mergePhase, selectOpenStatusSweep };
