const ACTIVE_SESSION_STATUSES = new Set(["draft", "counting", "ready", "live"]);
const TERMINAL_SESSION_STATUSES = new Set(["completed", "canceled"]);

const SOURCE_LABELS = Object.freeze({
  purchase_order: "Purchase order",
  warehouse_audit: "Warehouse audit",
  previous_session: "Previous live session",
  manual_skus: "Manual SKU selection",
  extra_items: "Scanned extra items"
});

function text(value = "") {
  return String(value ?? "").trim();
}

function quantity(value = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number * 1000) / 1000) : 0;
}

function compactIdentifier(value = "") {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function unique(values = []) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function normalizeLiveChannel(value = "") {
  const key = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (["ebay", "ebay_live"].includes(key)) return "ebay_live";
  if (["tiktok", "tiktok_shop", "tiktok_live"].includes(key)) return "tiktok_live";
  if (["whatnot", "whatnot_live"].includes(key)) return "whatnot_live";
  return "";
}

function sourceLabel(sourceType = "") {
  return SOURCE_LABELS[text(sourceType).toLowerCase()] || "Live inventory";
}

function sessionBelongsToScope(session = {}, scope = {}) {
  const tenantId = text(session.tenantId);
  const companyId = text(session.companyId);
  if (!tenantId && !companyId) return scope.legacy === true;
  return tenantId === text(scope.tenantId) && companyId === text(scope.companyId);
}

function sessionIsActive(session = {}) {
  return ACTIVE_SESSION_STATUSES.has(text(session.status || "draft").toLowerCase());
}

function sessionIsTerminal(session = {}) {
  return TERMINAL_SESSION_STATUSES.has(text(session.status).toLowerCase());
}

function itemSourceKey(item = {}, fallback = "") {
  return text(item.sourceKey || fallback || [item.sourceType, item.sourceId, item.sourceLineId || item.productId || item.sku].filter(Boolean).join(":"));
}

function identifiersForItem(item = {}) {
  return {
    upcs: unique([item.upc, item.barcode, item.gtin, item.ean, ...(Array.isArray(item.upcs) ? item.upcs : [])]),
    manufacturerSkus: unique([item.manufacturerSku, item.manufacturerPartNumber, item.mfrPartNumber, item.mpn, ...(Array.isArray(item.manufacturerSkus) ? item.manufacturerSkus : [])]),
    supplierSkus: unique([item.supplierSku, item.vendorSku, item.sourceSku, item.catalogSku, item.sku, ...(Array.isArray(item.supplierSkus) ? item.supplierSkus : [])])
  };
}

function identifiersForOrderLine(line = {}) {
  const matchMode = text(line.skuMappingMode || line.catalogIdentityMatch?.mode).toLowerCase();
  const importedIdentifiers = unique([
    line.originalSku,
    line.mappedFromSku,
    line.catalogIdentityMatch?.importedSku,
    line.catalogIdentityMatch?.sourceSku
  ]);
  return {
    upcs: unique([
      line.upc,
      line.upcCode,
      line.barcode,
      line.gtin,
      line.ean,
      line.productBarcode,
      line.variantBarcode,
      ...(matchMode.includes("upc") || matchMode.includes("gtin") ? importedIdentifiers : [])
    ]),
    manufacturerSkus: unique([
      line.mfrPartNumber,
      line.manufacturerPartNumber,
      line.mpn,
      line.manufacturerSku,
      line.manufacturerSKU,
      ...(matchMode.includes("manufacturer") || matchMode.includes("mpn") ? importedIdentifiers : [])
    ]),
    supplierSkus: unique([line.originalSku, line.marketplaceSku, line.channelSku, line.channelVariantSku, line.vendorSku, line.supplierSku, line.sourceSku, line.mappedFromSku, line.sku])
  };
}

function identifierSet(values = []) {
  return new Set(values.map(compactIdentifier).filter((value) => value.length >= 4));
}

function intersects(left = [], right = []) {
  const set = identifierSet(left);
  return right.some((value) => set.has(compactIdentifier(value)));
}

function matchSessionItemToOrderLine(item = {}, line = {}) {
  const itemValues = identifiersForItem(item);
  const lineValues = identifiersForOrderLine(line);
  if (intersects(itemValues.upcs, lineValues.upcs)) return { mode: "upc", priority: 1 };
  if (intersects(itemValues.manufacturerSkus, lineValues.manufacturerSkus)) return { mode: "manufacturer-part-number", priority: 2 };
  if (intersects(itemValues.supplierSkus, lineValues.supplierSkus)) return { mode: "supplier-sku", priority: 3 };
  return null;
}

function channelForOrder(order = {}) {
  const origin = text(order.salesOrigin || order.external?.salesOrigin || order.channelType).toLowerCase().replace(/[\s-]+/g, "_");
  if (order.isEbayLive === true || order.ebayLive?.isLive === true || order.external?.isEbayLive === true || origin === "ebay_live") return "ebay_live";
  if (order.isTikTokLive === true || order.tiktokLive?.isLive === true || order.external?.isTikTokLive === true || origin === "tiktok_live") return "tiktok_live";
  if (order.isWhatnotLive === true || order.whatnotLive?.isLive === true || order.external?.isWhatnotLive === true || origin === "whatnot_live") return "whatnot_live";
  return "";
}

function accountKeysForOrder(order = {}) {
  return unique([
    order.channelAccountId, order.sellerAccountId, order.accountId, order.shopId, order.shopCode,
    order.external?.accountId, order.external?.shopId, order.external?.shopCode,
    order.ebayLive?.accountId, order.tiktokLive?.accountId, order.whatnotLive?.accountId
  ]).map((value) => value.toLowerCase());
}

function eventTimestamp(value) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

function orderOccurredAt(order = {}) {
  return eventTimestamp(
    order.placedAt
    || order.orderDate
    || order.purchasedAt
    || order.createdAt
    || order.external?.placedAt
    || order.external?.createdAt
  );
}

function sessionMatchesOrder(session = {}, order = {}) {
  if (normalizeLiveChannel(session.channel || session.liveChannel) !== channelForOrder(order)) return false;
  const selectedAccount = text(session.channelAccountId || session.channelShopId).toLowerCase();
  if (selectedAccount && !accountKeysForOrder(order).includes(selectedAccount)) return false;
  const orderAt = orderOccurredAt(order);
  const sessionStart = eventTimestamp(session.startedAt || session.createdAt);
  const sessionEnd = eventTimestamp(session.completedAt || session.canceledAt || session.endedAt);
  if (orderAt && sessionStart && orderAt < sessionStart) return false;
  if (orderAt && sessionEnd && orderAt > sessionEnd) return false;
  return true;
}

function itemMetrics(item = {}) {
  const receivedQty = quantity(item.receivedQty);
  const incomingQty = quantity(item.incomingQty);
  const sourceAvailableQty = quantity(item.sourceAvailableQty ?? item.availableQty ?? receivedQty + incomingQty);
  const reservedQty = quantity(item.reservedQty);
  const soldQty = quantity(item.soldQty);
  const shippedQty = Math.min(soldQty, quantity(item.shippedQty));
  const releasedQty = quantity(item.releasedQty);
  const remainingQty = Math.max(0, reservedQty - Math.max(soldQty, shippedQty) - releasedQty);
  const requestedQty = quantity(item.requestedQty || reservedQty);
  const shortageQty = quantity(item.shortageQty || Math.max(0, requestedQty - reservedQty));
  return {
    ...item,
    sourceKey: itemSourceKey(item),
    merchantSku: text(item.merchantSku || item.manufacturerSku || item.manufacturerPartNumber || item.mfrPartNumber || item.sku),
    receivedQty,
    incomingQty,
    sourceAvailableQty,
    requestedQty,
    reservedQty,
    soldQty,
    shippedQty,
    releasedQty,
    remainingQty,
    shortageQty,
    linkedOrderIds: unique(item.linkedOrderIds || []),
    linkedOutboundScanIds: unique(item.linkedOutboundScanIds || [])
  };
}

function sessionTotals(session = {}) {
  const items = (Array.isArray(session.items) ? session.items : []).map(itemMetrics);
  const total = (field) => quantity(items.reduce((sum, item) => sum + quantity(item[field]), 0));
  return {
    ...session,
    items,
    itemCount: items.length,
    receivedUnits: total("receivedQty"),
    incomingUnits: total("incomingQty"),
    availableUnits: total("sourceAvailableQty"),
    reservedUnits: total("reservedQty"),
    soldUnits: total("soldQty"),
    shippedUnits: total("shippedQty"),
    releasedUnits: total("releasedQty"),
    remainingUnits: total("remainingQty"),
    shortageUnits: total("shortageQty")
  };
}

function sourceReservations(sessions = [], options = {}) {
  const excludedSessionId = text(options.excludeSessionId);
  const reservations = new Map();
  for (const session of sessions) {
    if (excludedSessionId && text(session.id) === excludedSessionId) continue;
    const active = sessionIsActive(session);
    for (const rawItem of Array.isArray(session.items) ? session.items : []) {
      const item = itemMetrics(rawItem);
      if (!item.sourceKey) continue;
      const traceableSource = /^(?:purchase_order|warehouse_audit):/i.test(item.sourceKey);
      const protectedQty = (active ? item.remainingQty : 0) + (traceableSource ? item.soldQty : 0);
      if (!protectedQty) continue;
      reservations.set(item.sourceKey, quantity((reservations.get(item.sourceKey) || 0) + protectedQty));
    }
  }
  return reservations;
}

function allocateRequestedItems(items = [], sessions = [], options = {}) {
  const existing = sourceReservations(sessions, { excludeSessionId: options.excludeSessionId });
  return items.map((rawItem, index) => {
    const sourceKey = itemSourceKey(rawItem, `manual:${rawItem.productId || rawItem.sku || index}`);
    const available = quantity(rawItem.sourceAvailableQty ?? rawItem.availableQty ?? rawItem.receivedQty ?? 0);
    const alreadyReserved = quantity(existing.get(sourceKey) || 0);
    const usable = Math.max(0, available - alreadyReserved);
    const requested = quantity(rawItem.requestedQty ?? rawItem.reservedQty ?? usable);
    const reserved = Math.min(requested, usable);
    return itemMetrics({
      ...rawItem,
      id: text(rawItem.id) || `${sourceKey}:${index}`,
      sourceKey,
      requestedQty: requested,
      reservedQty: reserved,
      shortageQty: Math.max(0, requested - reserved),
      sourceAvailableQty: available
    });
  });
}

function orderLines(order = {}) {
  return Array.isArray(order.items) ? order.items : Array.isArray(order.lineItems) ? order.lineItems : [];
}

function lineQuantity(line = {}) {
  return quantity(line.qty ?? line.quantity ?? 0) * Math.max(1, quantity(line.inventoryMultiplier || 1));
}

function fulfilledLineQuantity(order = {}, line = {}, lineIndex = 0) {
  const actual = Array.isArray(line.actualFulfillmentItems) ? line.actualFulfillmentItems.length : 0;
  const fulfillment = (Array.isArray(order.fulfillmentLines) ? order.fulfillmentLines : [])
    .find((entry) => Number(entry.lineIndex) === lineIndex);
  const outbound = (Array.isArray(order.outboundLiveItems) ? order.outboundLiveItems : [])
    .filter((entry) => Number(entry.listingLineIndex ?? entry.lineIndex ?? -1) === lineIndex).length;
  const terminal = ["shipped", "fulfilled", "delivered", "completed", "complete", "done"].includes(text(order.status || order.fulfillmentStatus).toLowerCase());
  return Math.min(lineQuantity(line), Math.max(actual, outbound, quantity(fulfillment?.qtyFulfilled), terminal ? lineQuantity(line) : 0));
}

function reconcileLiveSessions(sessions = [], orders = []) {
  const next = sessions.map((session) => ({
    ...session,
    items: (Array.isArray(session.items) ? session.items : []).map((item) => itemMetrics({
      ...item,
      soldQty: 0,
      shippedQty: 0,
      linkedOrderIds: [],
      linkedOutboundScanIds: []
    }))
  }));
  const candidates = next
    .filter((session) => ["ready", "live", "completed"].includes(text(session.status).toLowerCase()))
    .sort((left, right) => new Date(left.startedAt || left.createdAt || 0).getTime() - new Date(right.startedAt || right.createdAt || 0).getTime());

  for (const order of orders) {
    if (!channelForOrder(order)) continue;
    orderLines(order).forEach((line, lineIndex) => {
      let unitsToAllocate = lineQuantity(line);
      let shippedToAllocate = fulfilledLineQuantity(order, line, lineIndex);
      if (!unitsToAllocate) return;
      const matches = [];
      for (const session of candidates) {
        if (!sessionMatchesOrder(session, order)) continue;
        session.items.forEach((item, itemIndex) => {
          const match = matchSessionItemToOrderLine(item, line);
          if (match) matches.push({ session, item, itemIndex, match });
        });
      }
      matches.sort((left, right) => left.match.priority - right.match.priority
        || new Date(left.session.startedAt || left.session.createdAt || 0).getTime() - new Date(right.session.startedAt || right.session.createdAt || 0).getTime());
      for (const candidate of matches) {
        if (unitsToAllocate <= 0) break;
        const capacity = Math.max(0, quantity(candidate.item.reservedQty) - quantity(candidate.item.soldQty) - quantity(candidate.item.releasedQty));
        if (!capacity) continue;
        const sold = Math.min(capacity, unitsToAllocate);
        const shipped = Math.min(sold, shippedToAllocate);
        candidate.item.soldQty = quantity(candidate.item.soldQty + sold);
        candidate.item.shippedQty = quantity(candidate.item.shippedQty + shipped);
        candidate.item.lastMatchMode = candidate.match.mode;
        candidate.item.linkedOrderIds = unique([...(candidate.item.linkedOrderIds || []), order.id, order.orderNumber].filter(Boolean));
        candidate.item.linkedOutboundScanIds = unique([
          ...(candidate.item.linkedOutboundScanIds || []),
          ...(Array.isArray(order.outboundLiveItems) ? order.outboundLiveItems
            .filter((entry) => Number(entry.listingLineIndex ?? entry.lineIndex ?? -1) === lineIndex)
            .map((entry) => entry.clientScanId || entry.id) : [])
        ]);
        unitsToAllocate -= sold;
        shippedToAllocate -= shipped;
      }
    });
  }
  const reconciledAt = new Date().toISOString();
  return next.map((session) => sessionTotals({ ...session, items: session.items.map(itemMetrics), reconciledAt }));
}

module.exports = {
  ACTIVE_SESSION_STATUSES,
  TERMINAL_SESSION_STATUSES,
  SOURCE_LABELS,
  allocateRequestedItems,
  channelForOrder,
  compactIdentifier,
  identifierSet,
  identifiersForItem,
  identifiersForOrderLine,
  itemMetrics,
  itemSourceKey,
  matchSessionItemToOrderLine,
  normalizeLiveChannel,
  orderOccurredAt,
  quantity,
  reconcileLiveSessions,
  sessionBelongsToScope,
  sessionIsActive,
  sessionIsTerminal,
  sessionMatchesOrder,
  sessionTotals,
  sourceLabel,
  sourceReservations
};
