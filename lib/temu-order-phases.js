const { isDeepStrictEqual } = require('node:util');
const MODES = ['intake', 'status', 'enrichment'];
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
module.exports = { MODES, orderMode, mergePhase };
