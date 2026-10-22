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

module.exports = { ebayLiveLineContext };
