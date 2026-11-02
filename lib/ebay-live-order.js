function text(value) {
  return String(value || "").trim();
}

function ebayLiveLineContext(item = {}) {
  const purchaseSource = text(item.purchaseSource).toUpperCase();
  const eventId = text(item.ebayLiveContext?.eventId);
  const shippingWindow = item.combineShipping?.shippingWindow && typeof item.combineShipping.shippingWindow === "object"
    ? item.combineShipping.shippingWindow
    : {};
  return {
    isLive: purchaseSource === "EBAY_LIVE" || Boolean(eventId),
    purchaseSource,
    soldFormat: text(item.soldFormat).toUpperCase(),
    eventId,
    shippingWindow: {
      windowId: text(shippingWindow.windowId),
      status: text(shippingWindow.status).toUpperCase(),
      endDate: text(shippingWindow.shippingWindowEndDate),
    },
  };
}

function ebayLiveOrderContext(order = {}) {
  const salesOrigin = text(order.salesOrigin || order.external?.salesOrigin).toLowerCase();
  return {
    isLive: order.isEbayLive === true
      || order.ebayLive?.isLive === true
      || order.external?.isEbayLive === true
      || salesOrigin === "ebay_live",
    salesOrigin,
  };
}

function ebayLiveOrderUsesCommittedStock(order = {}, line = {}) {
  return line.isEbayLive === true
    || text(line.purchaseSource).toUpperCase() === "EBAY_LIVE"
    || Boolean(text(line.ebayLiveEventId || line.ebayLiveContext?.eventId))
    || ebayLiveOrderContext(order).isLive;
}

module.exports = { ebayLiveLineContext, ebayLiveOrderContext, ebayLiveOrderUsesCommittedStock };
