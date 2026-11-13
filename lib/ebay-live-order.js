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

function uniqueTextValues(...lists) {
  return [...new Set(lists.flat().map(text).filter(Boolean))];
}

function mergeShippingWindows(...lists) {
  return [...new Map(lists.flat()
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => [text(entry.windowId), entry])
    .filter(([windowId]) => windowId)).values()];
}

function preserveEbayLiveOrderIdentity(incoming = {}, existing = null) {
  if (!existing || text(incoming.source).toLowerCase() !== "ebay") return incoming;
  if (!ebayLiveOrderContext(existing).isLive || ebayLiveOrderContext(incoming).isLive) return incoming;

  const existingItems = Array.isArray(existing.items) ? existing.items : [];
  const existingByLineId = new Map(existingItems
    .map((item) => [text(item.marketplaceLineItemId), item])
    .filter(([lineId]) => lineId));
  const items = (Array.isArray(incoming.items) ? incoming.items : []).map((item, index) => {
    const previous = existingByLineId.get(text(item.marketplaceLineItemId)) || existingItems[index] || {};
    if (!ebayLiveLineContext(previous).isLive || ebayLiveLineContext(item).isLive) return item;
    return {
      ...item,
      purchaseSource: previous.purchaseSource || "EBAY_LIVE",
      soldFormat: previous.soldFormat || item.soldFormat || "",
      salesOrigin: "ebay_live",
      isEbayLive: true,
      ebayLiveEventId: previous.ebayLiveEventId || previous.ebayLiveContext?.eventId || "",
      ebayLiveContext: previous.ebayLiveContext || item.ebayLiveContext || null,
      ebayCombineShippingWindowId: previous.ebayCombineShippingWindowId || "",
      ebayCombineShippingStatus: previous.ebayCombineShippingStatus || "",
      ebayCombineShippingWindowEndDate: previous.ebayCombineShippingWindowEndDate || "",
      combineShipping: previous.combineShipping || item.combineShipping || null,
    };
  });
  const existingLive = existing.ebayLive && typeof existing.ebayLive === "object" ? existing.ebayLive : {};
  const incomingLive = incoming.ebayLive && typeof incoming.ebayLive === "object" ? incoming.ebayLive : {};
  const existingExternalLive = existing.external?.ebayLive && typeof existing.external.ebayLive === "object" ? existing.external.ebayLive : {};
  const incomingExternalLive = incoming.external?.ebayLive && typeof incoming.external.ebayLive === "object" ? incoming.external.ebayLive : {};
  const ebayLive = {
    ...existingLive,
    ...incomingLive,
    isLive: true,
    eventIds: uniqueTextValues(existingLive.eventIds || [], incomingLive.eventIds || []),
    combineShippingWindows: mergeShippingWindows(existingLive.combineShippingWindows || [], incomingLive.combineShippingWindows || []),
    soldFormats: uniqueTextValues(existingLive.soldFormats || [], incomingLive.soldFormats || []),
  };

  return {
    ...incoming,
    salesOrigin: "ebay_live",
    isEbayLive: true,
    ebayLive,
    items,
    external: {
      ...(incoming.external || {}),
      salesOrigin: "ebay_live",
      isEbayLive: true,
      ebayLive: {
        ...existingExternalLive,
        ...incomingExternalLive,
        eventIds: uniqueTextValues(existingExternalLive.eventIds || [], incomingExternalLive.eventIds || [], ebayLive.eventIds),
        combineShippingWindows: mergeShippingWindows(existingExternalLive.combineShippingWindows || [], incomingExternalLive.combineShippingWindows || [], ebayLive.combineShippingWindows),
        soldFormats: uniqueTextValues(existingExternalLive.soldFormats || [], incomingExternalLive.soldFormats || [], ebayLive.soldFormats),
      },
    },
  };
}

module.exports = {
  ebayLiveLineContext,
  ebayLiveOrderContext,
  ebayLiveOrderUsesCommittedStock,
  preserveEbayLiveOrderIdentity,
};
