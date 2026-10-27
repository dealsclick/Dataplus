const crypto = require('node:crypto');

const EVENT_TOPICS = Object.freeze([
  'ORDER_STATUS_CHANGE',
  'RECIPIENT_ADDRESS_UPDATE',
  'PACKAGE_UPDATE',
  'CANCELLATION_STATUS_CHANGE',
  'RETURN_STATUS_CHANGE',
  'REVERSE_STATUS_UPDATE',
  'PRODUCT_STATUS_CHANGE',
  'PRODUCT_INFORMATION_CHANGE',
  'PRODUCT_CREATION',
  'PRODUCT_CATEGORY_CHANGE',
  'PRODUCT_AUDIT_STATUS_CHANGE',
  'NEW_CONVERSATION',
  'NEW_MESSAGE',
  'NEW_MESSAGE_LISTENER',
  'SELLER_DEAUTHORIZATION',
  'UPCOMING_AUTHORIZATION_EXPIRATION',
  'INVOICE_STATUS_CHANGE'
]);

const text = value => String(value ?? '').trim();

function safeEqual(left, right) {
  const a = Buffer.from(text(left).toLowerCase(), 'utf8');
  const b = Buffer.from(text(right).toLowerCase(), 'utf8');
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyTikTokShopWebhook(rawBody, authorization, appKey, appSecret) {
  if (!Buffer.isBuffer(rawBody) || !text(appKey) || !text(appSecret) || !text(authorization)) return false;
  const expected = crypto.createHmac('sha256', appSecret)
    .update(Buffer.concat([Buffer.from(appKey, 'utf8'), rawBody]))
    .digest('hex');
  return safeEqual(expected, text(authorization).replace(/^sha256=/i, ''));
}

function webhookIdentity(payload = {}, rawBody = Buffer.alloc(0)) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
  const id = text(
    payload.event_id || payload.eventId || payload.tts_notification_id || payload.notification_id
    || data.event_id || data.idempotency_key || data.notification_id
  );
  return id || crypto.createHash('sha256').update(rawBody).digest('hex');
}

function webhookTopic(payload = {}) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
  const named = text(payload.event_type || payload.eventType || payload.topic || data.event_type || data.eventType).toUpperCase();
  if (named) return named;
  if (Number(payload.type) === 71) return 'INVENTORY_CHANGED_BY_SHOP';
  return `TYPE_${text(payload.type || 'UNKNOWN')}`;
}

function webhookEntity(payload = {}) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
  return {
    shopId: text(payload.shop_id || payload.shopId || data.shop_id),
    orderId: text(data.order_id || data.orderId || payload.order_id),
    returnId: text(data.return_id || data.returnId || data.reverse_order_id || payload.return_id),
    productId: text(data.product_id || data.productId || payload.product_id),
    skuId: text(data.sku_id || data.skuId || payload.sku_id),
    packageId: text(data.package_id || data.packageId || payload.package_id),
    conversationId: text(data.conversation_id || data.conversationId || payload.conversation_id),
    idempotencyKey: text(data.idempotency_key || payload.idempotency_key)
  };
}

function reconcileOperation(topic = '') {
  const value = text(topic).toUpperCase();
  if (/NEW_(CONVERSATION|MESSAGE)/.test(value)) return 'messages';
  if (/RETURN|REVERSE/.test(value)) return 'returns';
  if (/PRODUCT|INVENTORY/.test(value)) return 'products';
  if (/ORDER|ADDRESS|PACKAGE|CANCELLATION/.test(value)) return 'orders';
  return '';
}

module.exports = {
  EVENT_TOPICS,
  reconcileOperation,
  verifyTikTokShopWebhook,
  webhookEntity,
  webhookIdentity,
  webhookTopic
};
