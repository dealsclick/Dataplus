function findReturnReceipts(records, query) {
  const key = String(query || '').trim().toLowerCase();
  if (!key || key.length > 200) return [];
  return records.filter(record => [record.id, record.returnNumber, record.channelReturnId,
    record.orderId, record.orderNumber, record.channelOrderId,
    ...(Array.isArray(record.returnTracking) ? record.returnTracking : []).map(row => row.trackingNumber)
  ].some(value => value != null && String(value).trim().toLowerCase() === key));
}
module.exports = { findReturnReceipts };
