const { trackingLookupCandidates } = require('./tracking-barcode');

function returnTrackingNumbers(record = {}) {
  return [
    ...(Array.isArray(record.returnTracking) ? record.returnTracking : []).map(row => row?.trackingNumber),
    record.returnLabel?.trackingNumber,
    record.returnLabel?.tracking,
    record.trackingNumber
  ].filter(Boolean);
}

function findReturnReceipts(records, query) {
  const key = String(query || '').trim().toLowerCase();
  if (!key || key.length > 200) return [];
  const trackingCandidates = new Set(trackingLookupCandidates(query));
  return records.filter(record => [record.id, record.returnNumber, record.channelReturnId,
    record.orderId, record.orderNumber, record.channelOrderId
  ].some(value => value != null && String(value).trim().toLowerCase() === key)
    || returnTrackingNumbers(record).some(value => trackingLookupCandidates(value).some(candidate => trackingCandidates.has(candidate))));
}
module.exports = { findReturnReceipts, returnTrackingNumbers };
