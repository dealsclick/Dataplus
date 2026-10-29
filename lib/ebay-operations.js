function text(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return text(value.value ?? value.text ?? value["#text"] ?? "");
  return String(value).trim();
}

function firstArray(payload, keys = []) {
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  if (!payload || typeof payload !== "object") return [];
  return Object.values(payload).find(Array.isArray) || [];
}

function amount(value) {
  if (value && typeof value === "object") {
    return {
      value: Number(value.value ?? value.amount ?? 0) || 0,
      currency: text(value.currency || value.currencyCode || "USD") || "USD"
    };
  }
  return { value: Number(value || 0) || 0, currency: "USD" };
}

function dateValue(value) {
  const raw = text(value);
  if (!raw) return "";
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : raw;
}

function orderIdFrom(row = {}) {
  return text(
    row.orderId || row.order_id || row.legacyOrderId || row.legacy_order_id ||
    row.order?.orderId || row.order?.legacyOrderId || row.order?.id ||
    row.transaction?.orderId || row.transaction?.legacyOrderId
  );
}

function itemIdFrom(row = {}) {
  return text(row.itemId || row.item_id || row.item?.itemId || row.item?.listingId || row.listingId);
}

function statusFrom(row = {}) {
  return text(
    row.status || row.cancelStatus || row.cancelStatusEnum || row.returnStatus ||
    row.returnStatusEnum || row.inquiryStatus || row.inquiryStatusEnum ||
    row.caseStatus || row.caseStatusEnum || row.paymentDisputeStatus
  ) || "UNKNOWN";
}

function normalizeCancellation(row = {}) {
  return {
    id: text(row.cancelId || row.cancellationId || row.id),
    type: "cancellation",
    status: statusFrom(row),
    orderId: orderIdFrom(row),
    itemId: itemIdFrom(row),
    buyer: text(row.buyer || row.buyerUserName || row.buyerUsername),
    reason: text(row.cancelReason || row.reason || row.requestReason),
    initiatedBy: text(row.cancelInitiator || row.initiator || row.requestedBy),
    createdAt: dateValue(row.creationDate || row.createdDate || row.createdAt),
    updatedAt: dateValue(row.lastModifiedDate || row.updatedAt),
    respondBy: dateValue(row.respondByDate || row.responseDueDate),
    raw: row
  };
}

function normalizePostOrderRow(row = {}, type) {
  const id = type === "return"
    ? text(row.returnId || row.id)
    : type === "inquiry"
      ? text(row.inquiryId || row.id)
      : text(row.caseId || row.id);
  return {
    id,
    type,
    status: statusFrom(row),
    orderId: orderIdFrom(row),
    itemId: itemIdFrom(row),
    transactionId: text(row.transactionId || row.transaction_id || row.item?.transactionId),
    buyer: text(row.buyer || row.buyerUserName || row.buyerUsername),
    reason: text(row.reason || row.returnReason || row.inquiryReason || row.caseReason),
    amount: amount(row.claimAmount || row.refundAmount || row.totalRefundAmount || row.amount),
    createdAt: dateValue(row.creationDate || row.createdDate || row.createdAt),
    updatedAt: dateValue(row.lastModifiedDate || row.updatedAt),
    respondBy: dateValue(row.respondByDate || row.responseDueDate),
    raw: row
  };
}

function normalizePaymentDispute(row = {}) {
  return {
    id: text(row.paymentDisputeId || row.id),
    type: "payment_dispute",
    status: statusFrom(row),
    orderId: orderIdFrom(row),
    buyer: text(row.buyerUsername || row.buyerUserId || row.buyer),
    reason: text(row.reason || row.disputeReason),
    amount: amount(row.amount || row.disputeAmount || row.openDisputeAmount),
    createdAt: dateValue(row.openDate || row.creationDate || row.createdAt),
    updatedAt: dateValue(row.lastModifiedDate || row.updatedAt),
    respondBy: dateValue(row.respondByDate || row.responseDueDate),
    availableOptions: Array.isArray(row.availableChoices) ? row.availableChoices.map(text).filter(Boolean) : [],
    raw: row
  };
}

function normalizeConversation(row = {}) {
  const latest = row.latestMessage || row.latest_message || row.lastMessage || row.last_message || {};
  const unreadCount = Number(row.unreadCount ?? row.unread_count ?? (row.readStatus === false || row.read === false ? 1 : 0)) || 0;
  return {
    conversationId: text(row.conversationId || row.conversation_id || row.id),
    conversationType: text(row.conversationType || row.conversation_type || "FROM_MEMBERS") || "FROM_MEMBERS",
    conversationStatus: text(row.conversationStatus || row.conversation_status || row.status || "ACTIVE") || "ACTIVE",
    otherPartyUsername: text(row.otherPartyUsername || row.other_party_username || row.participant?.username || row.senderUsername),
    subject: text(row.subject || latest.subject || row.reference?.title),
    reference: row.reference || null,
    latestMessage: latest,
    latest_message: latest,
    unreadCount,
    unread_count: unreadCount,
    updatedAt: dateValue(row.lastModifiedDate || row.updatedAt || latest.creationDate || latest.createdDate || latest.createdAt),
    raw: row
  };
}

function normalizeMessage(row = {}) {
  return {
    id: text(row.messageId || row.message_id || row.id),
    content: text(row.messageText || row.messageBody || row.message_text || row.content || row.text),
    senderUsername: text(row.senderUsername || row.senderUserName || row.sender_username || row.sender?.username),
    recipientUsername: text(row.recipientUsername || row.recipientUserName || row.recipient_username || row.recipient?.username),
    senderRole: text(row.senderRole || row.sender_role || row.sender?.role),
    read: row.readStatus ?? row.read ?? true,
    createdAt: dateValue(row.creationDate || row.createdDate || row.createdAt || row.created_at),
    reference: row.reference || null,
    media: Array.isArray(row.messageMedia) ? row.messageMedia : [],
    raw: row
  };
}

function dateRange(lookbackDays = 90) {
  const days = Math.max(1, Math.min(548, Number(lookbackDays || 90) || 90));
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  return { days, from: from.toISOString(), to: to.toISOString() };
}

function scopeCapabilities(scope = "") {
  const scopes = new Set(String(scope || "").split(/\s+/).filter(Boolean));
  const has = (suffix) => scopes.has(`https://api.ebay.com/oauth/api_scope/${suffix}`);
  return {
    orders: has("sell.fulfillment") || has("sell.fulfillment.readonly"),
    returnsAndCancellations: scopes.has("https://api.ebay.com/oauth/api_scope"),
    paymentDisputes: has("sell.fulfillment") || has("sell.fulfillment.readonly"),
    analytics: has("sell.analytics.readonly") || has("sell.analytics"),
    marketing: has("sell.marketing") || has("sell.marketing.readonly"),
    messages: has("commerce.message")
  };
}

function localOrderReference(order = {}) {
  if (!order || !Object.keys(order).length) return null;
  const shipments = Array.isArray(order.shipments) ? order.shipments : [];
  return {
    id: text(order.id || order.orderId || order.order_id),
    orderNumber: text(order.orderNumber || order.order_number || order.internalOrderNumber),
    channelOrderNumber: text(order.marketplaceOrderNumber || order.marketplaceOrderId || order.channelOrderNumber || order.channelOrderId),
    status: text(order.status),
    fulfillmentStatus: text(order.fulfillmentStatus || order.fulfillmentStage || order.operationalStatus),
    shipped: shipments.some((shipment) => /shipped|delivered|in_transit|carrier/i.test(text(shipment.status || shipment.fulfillmentStatus || shipment.carrierStatus))) || /shipped|fulfilled|delivered/i.test(text(order.status || order.fulfillmentStatus)),
    trackingNumbers: [...new Set(shipments.map((shipment) => text(shipment.trackingNumber || shipment.tracking)).filter(Boolean))]
  };
}

module.exports = {
  amount,
  dateRange,
  dateValue,
  firstArray,
  localOrderReference,
  normalizeCancellation,
  normalizeConversation,
  normalizeMessage,
  normalizePaymentDispute,
  normalizePostOrderRow,
  orderIdFrom,
  scopeCapabilities,
  text
};
