const crypto = require('node:crypto');

const text = value => String(value ?? '').trim();
const array = value => Array.isArray(value) ? value : [];

function signatureBuffer(value) {
  const clean = text(value).replace(/^sha256=/i, '');
  if (/^[a-f0-9]{64}$/i.test(clean)) return Buffer.from(clean, 'hex');
  try { return Buffer.from(clean, 'base64'); } catch { return Buffer.alloc(0); }
}

function verifyWalmartWebhook(rawBody, signature, secret) {
  const provided = signatureBuffer(signature);
  if (!secret || !provided.length) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

function valuesForKey(value, wanted, rows = [], depth = 0) {
  if (!value || typeof value !== 'object' || depth > 8) return rows;
  if (Array.isArray(value)) {
    for (const entry of value) valuesForKey(entry, wanted, rows, depth + 1);
    return rows;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (wanted.has(key) && entry !== undefined && entry !== null) rows.push(entry);
    if (entry && typeof entry === 'object') valuesForKey(entry, wanted, rows, depth + 1);
  }
  return rows;
}

function walmartWebhookEnvelope(payload = {}, rawBody = Buffer.alloc(0)) {
  const source = payload.source || payload.eventSource || payload.metadata || {};
  const eventType = text(source.eventType || payload.eventType || payload.type).toUpperCase();
  const subEventType = text(source.subEventType || payload.payload?.meta?.subEventType || payload.meta?.subEventType || payload.subEventType || payload.eventSubtype).toUpperCase();
  const eventId = text(source.eventId || source.notificationId || payload.eventId || payload.notificationId)
    || crypto.createHash('sha256').update(rawBody).digest('hex');
  const purchaseOrderIds = [...new Set(valuesForKey(payload, new Set(['purchaseOrderId', 'purchaseOrderNo', 'purchaseOrderNumber'])).map(text).filter(Boolean))];
  const returnOrderIds = [...new Set(valuesForKey(payload, new Set(['returnOrderId'])).map(text).filter(Boolean))];
  const returnRows = [...array(payload.returnOrders), ...array(payload.payload?.returnOrders), ...array(payload.eventPayload?.returnOrders)].filter(row => row && typeof row === 'object');
  const supported = eventType === 'ORDER_UPDATES'
    || ['PO_CREATED', 'PO_LINE_AUTOCANCELLED', 'INTENT_TO_CANCEL', 'FRAUD_CANCEL'].includes(eventType)
    || ['RETURN_CREATED', 'RETURN_DELIVERED', 'RETURN_INVOICED'].includes(eventType);
  return { eventId, eventType, subEventType, purchaseOrderIds, returnOrderIds, returnRows, supported };
}

function walmartWebhookEventTypes(response = {}) {
  const rows = array(response.events).length ? response.events
    : array(response.eventTypes).length ? response.eventTypes
      : array(response.eventTypes?.eventType).length ? response.eventTypes.eventType
        : array(response.eventType).length ? response.eventType
          : array(response.list?.elements?.eventType);
  const wanted = new Set(['ORDER_UPDATES', 'RETURN_CREATED', 'RETURN_DELIVERED', 'RETURN_INVOICED']);
  const legacyOrders = new Set(['PO_CREATED', 'PO_LINE_AUTOCANCELLED', 'INTENT_TO_CANCEL', 'FRAUD_CANCEL']);
  const normalized = rows.map(row => ({ eventType: text(row.eventType || row.name).toUpperCase(), eventVersion: text(row.eventVersion || row.version || 'V1') || 'V1', resourceName: text(row.resourceName || row.resource || row.resourceType) })).filter(row => row.eventType && row.resourceName);
  const hasUnifiedOrders = normalized.some(row => row.eventType === 'ORDER_UPDATES');
  return normalized.filter(row => wanted.has(row.eventType) || (!hasUnifiedOrders && legacyOrders.has(row.eventType)));
}

function sanitizeWalmartSubscriptions(response = {}) {
  const scrub = value => {
    if (Array.isArray(value)) return value.map(scrub);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !/secret|token|credential|authHeaderValue/i.test(key)).map(([key, entry]) => [key, scrub(entry)]));
  };
  return scrub(response);
}

function walmartWebhookSubscriptionRows(response = {}) {
  const rows = [];
  const visit = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 8) return;
    if (Array.isArray(value)) return value.forEach(entry => visit(entry, depth + 1));
    const eventType = text(value.eventType).toUpperCase();
    const eventUrl = text(value.eventUrl);
    if (eventType && eventUrl) rows.push({ eventType, eventUrl, status: text(value.status).toUpperCase(), subscriptionId: text(value.subscriptionId) });
    for (const entry of Object.values(value)) visit(entry, depth + 1);
  };
  visit(response);
  return rows;
}

module.exports = { verifyWalmartWebhook, walmartWebhookEnvelope, walmartWebhookEventTypes, walmartWebhookSubscriptionRows, sanitizeWalmartSubscriptions };
