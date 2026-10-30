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

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function searchableReturnValues(record = {}) {
  const customer = object(record.customer);
  const addresses = [record.shippingAddress, record.address, record.returnAddress, customer.address].map(object);
  const items = Array.isArray(record.items) ? record.items : [];
  return [
    record.customerName, record.buyer, customer.name,
    record.customerEmail, record.buyerEmail, customer.email,
    record.customerId, customer.id, record.customerAccount,
    ...addresses.flatMap(address => [address.name, address.line1, address.line2, address.city, address.state, address.postalCode, address.zip, address.zipCode]),
    ...items.flatMap(item => [item.sku, item.upc, item.gtin, item.barcode, item.vendorSku, item.manufacturerPartNumber, item.mpn, item.title,
      ...(Array.isArray(item.sourceSkus) ? item.sourceSkus : [])])
  ].filter(Boolean).map(value => String(value).trim().toLowerCase());
}

function returnPhoneValues(record = {}) {
  const customer = object(record.customer);
  const addresses = [record.shippingAddress, record.address, record.returnAddress, customer.address].map(object);
  return [record.customerPhone, record.phone, customer.phone, ...addresses.map(address => address.phone)]
    .filter(Boolean).map(value => String(value).replace(/\D/g, '')).filter(Boolean);
}

function findReturnReceipts(records, query) {
  const key = String(query || '').trim().toLowerCase();
  if (!key || key.length > 300) return [];
  const trackingCandidates = new Set(trackingLookupCandidates(query));
  const phoneKey = key.replace(/\D/g, '');
  return records.map((record, index) => {
    const exact = [record.id, record.returnNumber, record.channelReturnId,
      record.orderId, record.orderNumber, record.channelOrderId
    ].some(value => value != null && String(value).trim().toLowerCase() === key)
      || returnTrackingNumbers(record).some(value => trackingLookupCandidates(value).some(candidate => trackingCandidates.has(candidate)));
    const broad = key.length >= 2 && searchableReturnValues(record).some(value => value.includes(key));
    const phone = phoneKey.length >= 4 && returnPhoneValues(record).some(value => value.includes(phoneKey));
    return { record, index, rank: exact ? 0 : broad || phone ? 1 : 2 };
  }).filter(match => match.rank < 2)
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(match => match.record);
}
module.exports = { findReturnReceipts, returnTrackingNumbers, searchableReturnValues, returnPhoneValues };
