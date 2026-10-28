const { trackingLookupCandidates } = require('./tracking-barcode');

const RETURN_TRACKING_KEYS = [
  'trackingNumber', 'tracking', 'trackingNo', 'trackingNum', 'trackingSn', 'trackingCode', 'trackingId',
  'waybillNo', 'waybillNumber', 'waybillSn', 'waybillCode', 'mailNo', 'shipTrackingNumber'
];

function trackingValues(record = {}) {
  return RETURN_TRACKING_KEYS.map(key => record?.[key]).filter(Boolean);
}

function returnTrackingNumbers(record = {}) {
  return [
    ...(Array.isArray(record.returnTracking) ? record.returnTracking : []).flatMap(trackingValues),
    ...trackingValues(record.returnLabel),
    ...(Array.isArray(record.returnLabelHistory) ? record.returnLabelHistory : []).flatMap(trackingValues),
    ...trackingValues(record)
  ].filter(Boolean);
}

function findReturnReceipts(records, query) {
  const key = String(query || '').trim().toLowerCase();
  if (!key || key.length > 300) return [];
  const trackingCandidates = new Set(trackingLookupCandidates(query));
  return records.filter(record => [record.id, record.returnNumber, record.channelReturnId,
    record.orderId, record.orderNumber, record.channelOrderId
  ].some(value => value != null && String(value).trim().toLowerCase() === key)
    || returnTrackingNumbers(record).some(value => trackingLookupCandidates(value).some(candidate => trackingCandidates.has(candidate))));
}
module.exports = { findReturnReceipts, returnTrackingNumbers };
