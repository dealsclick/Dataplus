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

function eventIdsForSession(session = {}) {
  return unique([
    session.channelEventId,
    session.ebayLiveEventId,
    session.eventId,
    ...(Array.isArray(session.channelEventIds) ? session.channelEventIds : [])
  ]).map((value) => value.toLowerCase());
}

function eventIdsForOrder(order = {}, line = {}) {
  return unique([
    line.channelEventId,
    line.ebayLiveEventId,
    line.ebayLiveContext?.eventId,
    order.channelEventId,
    order.ebayLiveEventId,
    ...(Array.isArray(order.ebayLive?.eventIds) ? order.ebayLive.eventIds : []),
    ...(Array.isArray(order.external?.ebayLive?.eventIds) ? order.external.ebayLive.eventIds : [])
  ]).map((value) => value.toLowerCase());
}

function sessionOrderEventPriority(session = {}, order = {}, line = {}) {
  const sessionEvents = eventIdsForSession(session);
  const orderEvents = eventIdsForOrder(order, line);
  if (sessionEvents.length && orderEvents.length) {
    return sessionEvents.some((eventId) => orderEvents.includes(eventId)) ? 0 : Number.POSITIVE_INFINITY;
  }
  return sessionEvents.length || orderEvents.length ? 1 : 2;
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

function sessionMatchesOrder(session = {}, order = {}, line = {}) {
  if (normalizeLiveChannel(session.channel || session.liveChannel) !== channelForOrder(order)) return false;
  const selectedAccount = text(session.channelAccountId || session.channelShopId).toLowerCase();
  if (selectedAccount && !accountKeysForOrder(order).includes(selectedAccount)) return false;
  const eventPriority = sessionOrderEventPriority(session, order, line);
  if (!Number.isFinite(eventPriority)) return false;
  if (eventPriority === 0) return true;
  const orderAt = orderOccurredAt(order);
  const sessionStart = eventTimestamp(session.scheduledStartAt || session.startedAt || session.createdAt);
  const sessionEnd = eventTimestamp(session.scheduledEndAt || session.completedAt || session.canceledAt || session.endedAt);
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

function launchProductKeys(product = {}) {
  return unique([product.id, product.productId, product.sku, product.catalogSku]).map((value) => value.toLowerCase());
}

function launchProductForItem(item = {}, products = []) {
  const wanted = new Set(unique([item.productId, item.sku, item.catalogSku]).map((value) => value.toLowerCase()));
  return (Array.isArray(products) ? products : []).find((product) => launchProductKeys(product).some((key) => wanted.has(key))) || null;
}

function launchMerchantSkuIdentity(item = {}, product = {}, channel = "") {
  const manufacturerSku = text(
    item.manufacturerSku
    || item.manufacturerPartNumber
    || item.mfrPartNumber
    || item.mpn
    || product.mfrPartNumber
    || product.manufacturerPartNumber
    || product.manufacturerSku
    || product.mpn
  );
  if (manufacturerSku) return { value: manufacturerSku, source: "manufacturer_sku" };
  const normalizedChannel = normalizeLiveChannel(channel);
  const dataplusSku = text(item.sku || item.catalogSku || product.sku || product.catalogSku);
  if (normalizedChannel === "tiktok_live" && /^DPS\d+$/i.test(dataplusSku)) {
    return { value: dataplusSku, source: "dataplus_sku" };
  }
  if (normalizedChannel === "ebay_live") {
    if (dataplusSku) return { value: dataplusSku, source: "dataplus_sku" };
  }
  return { value: "", source: "" };
}

function launchMerchantSku(item = {}, product = {}, channel = "") {
  return launchMerchantSkuIdentity(item, product, channel).value;
}

function launchDateKey(value = "", timeZone = "America/New_York") {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: text(timeZone) || "America/New_York",
      year: "2-digit",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
    return `${parts.month}-${parts.day}-${parts.year}`;
  } catch {
    return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}-${String(date.getFullYear()).slice(-2)}`;
  }
}

function datedLiveMerchantSku(baseSku = "", dateKey = "") {
  const base = text(baseSku).replace(/\s+/g, "-");
  const suffix = dateKey ? `-LV-${dateKey}` : "";
  if (!base) return "";
  return `${base.slice(0, Math.max(1, 50 - suffix.length))}${suffix}`;
}

function launchStatus(value = "") {
  const status = text(value).toLowerCase();
  if (["blocked", "ready", "queued", "publishing", "scheduled", "submitted", "live", "failed"].includes(status)) return status;
  return "not_reviewed";
}

function launchCounts(items = []) {
  const rows = Array.isArray(items) ? items : [];
  const statuses = rows.map((item) => launchStatus(item?.launch?.status));
  return {
    readyItems: statuses.filter((status) => status === "ready").length,
    blockedItems: statuses.filter((status) => status === "blocked").length,
    queuedItems: statuses.filter((status) => ["queued", "publishing"].includes(status)).length,
    submittedItems: statuses.filter((status) => ["scheduled", "submitted"].includes(status)).length,
    liveItems: statuses.filter((status) => status === "live").length,
    failedItems: statuses.filter((status) => status === "failed").length
  };
}

function launchReadiness(session = {}, products = [], options = {}) {
  const measured = sessionTotals(session);
  const channel = normalizeLiveChannel(measured.channel || measured.liveChannel);
  const merchantSkuDate = text(measured.launch?.merchantSkuDate)
    || launchDateKey(options.reviewedAt || new Date().toISOString(), measured.scheduleTimeZone);
  const channelSupported = options.channelSupported !== false && ["ebay_live", "tiktok_live"].includes(channel);
  const accountConnected = options.accountConnected !== false;
  const sessionStatus = text(measured.status || "draft").toLowerCase();
  const sessionBlockers = [];
  if (!channel) sessionBlockers.push("Select a live channel.");
  else if (!channelSupported) sessionBlockers.push(channel === "whatnot_live" ? "Whatnot publishing is not connected yet." : "This live channel does not support publishing yet.");
  if (!text(measured.channelAccountId || measured.channelShopId)) sessionBlockers.push("Select a connected seller account or shop.");
  else if (!accountConnected) sessionBlockers.push("The selected seller account is no longer connected.");
  if (!["ready", "live"].includes(sessionStatus)) sessionBlockers.push("Mark the session ready before publishing.");
  if (sessionIsTerminal(measured)) sessionBlockers.push("Closed sessions cannot publish inventory.");

  const planned = measured.items.map((rawItem) => {
    const item = itemMetrics(rawItem);
    const product = launchProductForItem(item, products);
    const merchantSkuIdentity = launchMerchantSkuIdentity(item, product || {}, channel);
    const merchantSkuBase = merchantSkuIdentity.value;
    const quantityToPublish = Math.max(0, Math.floor(quantity(item.remainingQty)));
    const blockers = [...sessionBlockers];
    const productBlockers = [];
    if (!product) productBlockers.push("Catalog product not found.");
    if (!merchantSkuBase) productBlockers.push(channel === "ebay_live"
      ? "A manufacturer SKU or DataPlus SKU is required as the channel merchant SKU."
      : "A manufacturer SKU or generated DataPlus DPS SKU is required as the channel merchant SKU.");
    blockers.push(...productBlockers);
    if (!(quantityToPublish > 0)) blockers.push("No remaining reserved units are available to publish.");
    const productStatus = text(product?.status || product?.productStatus || product?.lifecycleStatus).toLowerCase();
    if (product?.active === false || product?.toBeDiscontinued === true || ["inactive", "discontinued", "retired", "deleted"].includes(productStatus)) {
      productBlockers.push("Catalog selling status blocks marketplace launch.");
      blockers.push("Catalog selling status blocks marketplace launch.");
    }
    const previous = item.launch && typeof item.launch === "object" ? item.launch : {};
    const previousStatus = launchStatus(previous.status);
    const preserveSubmittedSku = ["queued", "publishing", "scheduled", "submitted", "live"].includes(previousStatus)
      && text(previous.merchantSku);
    const merchantSku = preserveSubmittedSku
      ? text(previous.merchantSku)
      : channel === "ebay_live"
        ? datedLiveMerchantSku(merchantSkuBase, merchantSkuDate)
        : merchantSkuBase;
    const nextStatus = blockers.length
      ? "blocked"
      : ["queued", "publishing", "scheduled", "submitted", "live"].includes(previousStatus)
        ? previousStatus
        : "ready";
    return itemMetrics({
      ...item,
      merchantSku,
      launch: {
        ...previous,
        status: nextStatus,
        channel,
        accountId: text(measured.channelAccountId),
        accountName: text(measured.channelAccountName),
        shopId: text(measured.channelShopId),
        merchantSkuBase,
        merchantSkuSource: merchantSkuIdentity.source,
        merchantSkuDate: channel === "ebay_live" ? merchantSkuDate : "",
        merchantSku,
        quantity: quantityToPublish,
        blockers: unique(blockers),
        sessionBlockers: unique(sessionBlockers),
        productBlockers: unique(productBlockers),
        reviewedAt: options.reviewedAt || new Date().toISOString()
      }
    });
  });

  const groups = [];
  const byMerchantSku = new Map();
  const collidedMerchantSkus = new Set();
  for (const item of planned) {
    if (item.launch?.status !== "ready") continue;
    const key = compactIdentifier(item.launch.merchantSku);
    if (collidedMerchantSkus.has(key)) continue;
    const product = launchProductForItem(item, products);
    const productKey = text(product?.id || product?.productId || product?.sku || item.productId || item.sku);
    const existing = byMerchantSku.get(key);
    if (existing && existing.productKey.toLowerCase() !== productKey.toLowerCase()) {
      for (const candidate of planned.filter((row) => compactIdentifier(row.launch?.merchantSku) === key)) {
        candidate.launch.status = "blocked";
        const blocker = "Manufacturer SKU is assigned to more than one catalog product in this session.";
        candidate.launch.blockers = unique([...(candidate.launch.blockers || []), blocker]);
        candidate.launch.productBlockers = unique([...(candidate.launch.productBlockers || []), blocker]);
      }
      const existingIndex = groups.indexOf(existing);
      if (existingIndex >= 0) groups.splice(existingIndex, 1);
      byMerchantSku.delete(key);
      collidedMerchantSkus.add(key);
      continue;
    }
    if (existing) {
      existing.quantity = quantity(existing.quantity + Number(item.launch.quantity || 0));
      existing.salePrice = Math.max(Number(existing.salePrice || 0), Number(item.salePrice || 0));
      existing.itemIds.push(text(item.id));
      continue;
    }
    const group = {
      merchantSku: text(item.launch.merchantSku),
      productKey,
      productId: text(product?.id || product?.productId || item.productId),
      parentSku: text(product?.sku || item.sku),
      quantity: quantity(item.launch.quantity),
      salePrice: Math.max(0.01, Number(item.salePrice || 1)),
      itemIds: [text(item.id)]
    };
    byMerchantSku.set(key, group);
    groups.push(group);
  }
  const groupsByProduct = new Map();
  for (const group of [...groups]) {
    const productKey = text(group.productKey).toLowerCase();
    const existing = groupsByProduct.get(productKey);
    if (!existing) {
      groupsByProduct.set(productKey, group);
      continue;
    }
    for (const candidate of planned.filter((row) => [existing, group].some((entry) => entry.itemIds.includes(text(row.id))))) {
      candidate.launch.status = "blocked";
      const blocker = "One catalog product has conflicting manufacturer SKUs in this session.";
      candidate.launch.blockers = unique([...(candidate.launch.blockers || []), blocker]);
      candidate.launch.productBlockers = unique([...(candidate.launch.productBlockers || []), blocker]);
    }
    const firstIndex = groups.indexOf(existing);
    if (firstIndex >= 0) groups.splice(firstIndex, 1);
    const secondIndex = groups.indexOf(group);
    if (secondIndex >= 0) groups.splice(secondIndex, 1);
  }
  const plannedStatuses = planned.map((item) => launchStatus(item.launch?.status));
  const counts = launchCounts(planned);
  const summary = {
    status: plannedStatuses.includes("ready")
      ? "ready"
      : plannedStatuses.some((status) => ["queued", "publishing"].includes(status))
        ? "publishing"
        : plannedStatuses.some((status) => ["scheduled", "submitted", "live"].includes(status))
          ? "complete"
          : "blocked",
    ...counts,
    reviewedAt: options.reviewedAt || new Date().toISOString(),
    merchantSkuDate: channel === "ebay_live" ? merchantSkuDate : "",
    channel,
    accountId: text(measured.channelAccountId),
    accountName: text(measured.channelAccountName),
    shopId: text(measured.channelShopId),
    blockers: unique(sessionBlockers)
  };
  return { session: sessionTotals({ ...measured, items: planned, launch: { ...(measured.launch || {}), ...summary } }), groups, summary };
}

function applyLaunchJob(session = {}, job = {}) {
  const measured = sessionTotals(session);
  const jobStatus = text(job.status).toLowerCase();
  const active = ["queued", "running", "starting"].includes(jobStatus);
  const failedJob = ["failed", "stopped", "canceled", "cancelled"].includes(jobStatus);
  const results = Array.isArray(job.liveSessionLaunchResults)
    ? job.liveSessionLaunchResults
    : Array.isArray(job.raw?.liveSessionLaunchResults)
      ? job.raw.liveSessionLaunchResults
      : [];
  const resultByMerchantSku = new Map(results.map((result) => [compactIdentifier(result.merchantSku || result.sku), result]));
  const items = measured.items.map((item) => {
    const previous = item.launch && typeof item.launch === "object" ? item.launch : {};
    if (text(previous.jobId) !== text(job.id)) return item;
    const result = resultByMerchantSku.get(compactIdentifier(previous.merchantSku || item.merchantSku));
    let status = launchStatus(previous.status);
    let error = text(previous.error);
    if (active) status = jobStatus === "queued" ? "queued" : "publishing";
    else if (result) {
      const resultStatus = text(result.status).toLowerCase();
      status = ["live", "published"].includes(resultStatus)
        ? "live"
        : resultStatus === "scheduled"
          ? "scheduled"
          : ["offer", "submitted", "already_linked"].includes(resultStatus)
            ? "submitted"
            : "failed";
      error = status === "failed" ? text(result.error || result.reason || result.missing || job.message) : "";
    } else if (failedJob) {
      status = "failed";
      error = text(job.message || (Array.isArray(job.errors) ? job.errors[0] : "") || "Channel launch failed.");
    } else if (["success", "warning", "done_with_warnings"].includes(jobStatus)) {
      status = "failed";
      error = "The channel job completed without returning a result for this merchant SKU.";
    }
    return itemMetrics({
      ...item,
      launch: {
        ...previous,
        status,
        error,
        listingId: text(result?.listingId || result?.listing_id || result?.productId || previous.listingId),
        offerId: text(result?.offerId || result?.offer_id || previous.offerId),
        listingUrl: text(result?.listingUrl || result?.listing_url || previous.listingUrl),
        requestId: text(result?.requestId || previous.requestId),
        updatedAt: job.updatedAt || job.finishedAt || new Date().toISOString()
      }
    });
  });
  const launch = {
    ...(measured.launch || {}),
    status: active ? (jobStatus === "queued" ? "queued" : "publishing") : failedJob ? "failed" : "complete",
    jobId: text(job.id),
    jobNumber: Number(job.jobNumber || 0) || 0,
    jobStatus,
    jobPhase: text(job.phase || job.stage),
    processedItems: quantity(job.processedRows),
    totalItems: quantity(job.totalRows),
    changedItems: quantity(job.changedRows),
    missingItems: quantity(job.missingCount),
    progressPercent: Math.max(0, Math.min(100, Number(job.progressPercent || 0))),
    message: text(job.message),
    updatedAt: job.updatedAt || job.finishedAt || new Date().toISOString(),
    ...launchCounts(items)
  };
  return sessionTotals({ ...measured, items, launch, updatedAt: new Date().toISOString() });
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

function sourceAvailabilityItems(items = [], sessions = [], options = {}) {
  const existing = sourceReservations(sessions, { excludeSessionId: options.excludeSessionId });
  return items.map((rawItem, index) => {
    const sourceKey = itemSourceKey(rawItem, `manual:${rawItem.productId || rawItem.sku || index}`);
    const sourceAvailableQty = quantity(rawItem.sourceAvailableQty ?? rawItem.availableQty ?? rawItem.receivedQty ?? 0);
    const sourceCommittedQty = Math.min(sourceAvailableQty, quantity(existing.get(sourceKey) || 0));
    const allocatableQty = Math.max(0, sourceAvailableQty - sourceCommittedQty);
    return itemMetrics({
      ...rawItem,
      sourceKey,
      sourceAvailableQty,
      sourceCommittedQty,
      allocatableQty,
      requestedQty: allocatableQty,
      reservedQty: 0,
      soldQty: 0,
      shippedQty: 0,
      releasedQty: 0,
      shortageQty: 0
    });
  });
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
  const reconciledAt = new Date().toISOString();
  const next = sessions.map((session) => ({
    ...session,
    items: (Array.isArray(session.items) ? session.items : []).map((item) => itemMetrics({
      ...item,
      soldQty: 0,
      shippedQty: 0,
      receivedSoldQty: 0,
      linkedOrderIds: [],
      linkedOutboundScanIds: []
    }))
  }));
  const candidates = next
    .filter((session) => ["ready", "live", "completed"].includes(text(session.status).toLowerCase()))
    .sort((left, right) => new Date(left.startedAt || left.createdAt || 0).getTime() - new Date(right.startedAt || right.createdAt || 0).getTime());

  for (const order of orders) {
    if (!channelForOrder(order)) continue;
    const orderSessionIds = new Set();
    const orderSessionNumbers = new Set();
    orderLines(order).forEach((line, lineIndex) => {
      const previousAllocations = Array.isArray(line.liveSessionAllocations) ? line.liveSessionAllocations : [];
      line.liveSessionAllocations = [];
      line.liveSessionId = "";
      line.liveSessionNumber = "";
      line.liveSessionItemId = "";
      line.liveSessionMatchMode = "";
      let unitsToAllocate = lineQuantity(line);
      let shippedToAllocate = fulfilledLineQuantity(order, line, lineIndex);
      if (!unitsToAllocate) return;
      const matches = [];
      for (const session of candidates) {
        if (!sessionMatchesOrder(session, order, line)) continue;
        const eventPriority = sessionOrderEventPriority(session, order, line);
        session.items.forEach((item, itemIndex) => {
          const match = matchSessionItemToOrderLine(item, line);
          if (match) matches.push({ session, item, itemIndex, match, eventPriority });
        });
      }
      matches.sort((left, right) => left.eventPriority - right.eventPriority
        || left.match.priority - right.match.priority
        || new Date(left.session.startedAt || left.session.createdAt || 0).getTime() - new Date(right.session.startedAt || right.session.createdAt || 0).getTime());
      for (const candidate of matches) {
        if (unitsToAllocate <= 0) break;
        const capacity = Math.max(0, quantity(candidate.item.reservedQty) - quantity(candidate.item.soldQty) - quantity(candidate.item.releasedQty));
        if (!capacity) continue;
        const sold = Math.min(capacity, unitsToAllocate);
        const shipped = Math.min(sold, shippedToAllocate);
        const receivedCapacity = Math.max(0,
          Math.min(quantity(candidate.item.reservedQty), quantity(candidate.item.receivedQty))
          - quantity(candidate.item.receivedSoldQty));
        const receivedInventoryQty = Math.min(sold, receivedCapacity);
        candidate.item.soldQty = quantity(candidate.item.soldQty + sold);
        candidate.item.shippedQty = quantity(candidate.item.shippedQty + shipped);
        candidate.item.receivedSoldQty = quantity(candidate.item.receivedSoldQty + receivedInventoryQty);
        candidate.item.lastMatchMode = candidate.match.mode;
        candidate.item.linkedOrderIds = unique([...(candidate.item.linkedOrderIds || []), order.id, order.orderNumber].filter(Boolean));
        candidate.item.linkedOutboundScanIds = unique([
          ...(candidate.item.linkedOutboundScanIds || []),
          ...(Array.isArray(order.outboundLiveItems) ? order.outboundLiveItems
            .filter((entry) => Number(entry.listingLineIndex ?? entry.lineIndex ?? -1) === lineIndex)
            .map((entry) => entry.clientScanId || entry.id) : [])
        ]);
        const sourceType = text(candidate.item.sourceType || candidate.session.sourceType).toLowerCase();
        const previousAllocation = previousAllocations.find((entry) => (
          text(entry.liveSessionId) === text(candidate.session.id)
          && text(entry.liveSessionItemId) === text(candidate.item.id)
        ));
        const allocation = {
          liveSessionId: text(candidate.session.id),
          liveSessionNumber: text(candidate.session.sessionNumber),
          liveSessionItemId: text(candidate.item.id),
          qty: sold,
          shippedQty: shipped,
          receivedInventoryQty,
          receivedInventory: receivedInventoryQty > 0 && ["purchase_order", "warehouse_audit", "previous_session", "extra_items"].includes(sourceType),
          matchMode: candidate.match.mode,
          channelEventId: eventIdsForSession(candidate.session)[0] || eventIdsForOrder(order, line)[0] || "",
          sourceType,
          sourceId: text(candidate.item.sourceId || candidate.session.sourceId),
          sourceNumber: text(candidate.item.sourceNumber || candidate.session.sourceNumber),
          sourcePurchaseOrderId: text(candidate.item.sourcePurchaseOrderId || candidate.session.sourcePurchaseOrderId),
          sourcePurchaseOrderNumber: text(candidate.item.sourcePurchaseOrderNumber || candidate.session.sourcePurchaseOrderNumber),
          sourceAuditId: text(candidate.item.sourceAuditId || candidate.session.linkedAuditId),
          sourceAuditNumber: text(candidate.item.sourceAuditNumber || candidate.session.linkedAuditNumber),
          warehouseId: text(candidate.session.warehouseId),
          warehouseName: text(candidate.session.warehouseName),
          matchedAt: text(previousAllocation?.matchedAt) || reconciledAt
        };
        line.liveSessionAllocations.push(allocation);
        if (!line.liveSessionId) {
          line.liveSessionId = allocation.liveSessionId;
          line.liveSessionNumber = allocation.liveSessionNumber;
          line.liveSessionItemId = allocation.liveSessionItemId;
          line.liveSessionMatchMode = allocation.matchMode;
        }
        if (allocation.liveSessionId) orderSessionIds.add(allocation.liveSessionId);
        if (allocation.liveSessionNumber) orderSessionNumbers.add(allocation.liveSessionNumber);
        unitsToAllocate -= sold;
        shippedToAllocate -= shipped;
      }
    });
    order.liveSessionIds = [...orderSessionIds];
    order.liveSessionNumbers = [...orderSessionNumbers];
    order.liveSessionId = order.liveSessionIds[0] || "";
    order.liveSessionNumber = order.liveSessionNumbers[0] || "";
    order.liveSessionReconciledAt = reconciledAt;
    order.external = {
      ...(order.external || {}),
      liveSessionIds: [...orderSessionIds],
      liveSessionNumbers: [...orderSessionNumbers]
    };
  }
  return next.map((session) => sessionTotals({ ...session, items: session.items.map(itemMetrics), reconciledAt }));
}

module.exports = {
  ACTIVE_SESSION_STATUSES,
  TERMINAL_SESSION_STATUSES,
  SOURCE_LABELS,
  allocateRequestedItems,
  applyLaunchJob,
  channelForOrder,
  compactIdentifier,
  datedLiveMerchantSku,
  eventIdsForOrder,
  eventIdsForSession,
  identifierSet,
  identifiersForItem,
  identifiersForOrderLine,
  itemMetrics,
  itemSourceKey,
  launchCounts,
  launchDateKey,
  launchMerchantSku,
  launchReadiness,
  launchStatus,
  matchSessionItemToOrderLine,
  normalizeLiveChannel,
  orderOccurredAt,
  quantity,
  reconcileLiveSessions,
  sessionBelongsToScope,
  sessionIsActive,
  sessionIsTerminal,
  sessionMatchesOrder,
  sessionOrderEventPriority,
  sessionTotals,
  sourceLabel,
  sourceAvailabilityItems,
  sourceReservations
};
