function booleanValue(value) {
  return value === true || ["true", "yes", "y", "1"].includes(String(value ?? "").trim().toLowerCase());
}

function positiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.max(1, Math.floor(numeric));
}

function normalizedChannel(value = "") {
  const key = String(value || "").trim().toLowerCase();
  return key === "tiktok shop" ? "tiktok" : key;
}

function channelScope(product = {}) {
  const raw = product.raw && typeof product.raw === "object" ? product.raw : {};
  const configured = product.replenishableChannels ?? raw.replenishableChannels;
  return Array.isArray(configured) ? [...new Set(configured.map(normalizedChannel).filter(Boolean))] : [];
}

function resolveReplenishableInventory(product = {}, vendor = null, channelDefaultQty = 1, options = {}) {
  const raw = product.raw && typeof product.raw === "object" ? product.raw : {};
  const inventoryRules = vendor?.inventoryRules && typeof vendor.inventoryRules === "object" ? vendor.inventoryRules : {};
  const useVendorRules = booleanValue(product.replenishableUseVendorRules ?? product.replenishable_use_vendor_rules ?? raw.replenishableUseVendorRules);
  const useVendorQty = useVendorRules || booleanValue(product.replenishableQtyUseVendorDefault ?? product.replenishable_qty_use_vendor_default ?? raw.replenishableQtyUseVendorDefault);
  const skuEnabled = booleanValue(product.replenishable ?? product.isReplenishable ?? raw.replenishable ?? raw.isReplenishable);
  const vendorEnabled = booleanValue(inventoryRules.replenishableEnabled ?? inventoryRules.enabled);
  const enabled = useVendorRules ? vendorEnabled : skuEnabled;
  if (!enabled) return { enabled: false, quantity: 0, source: "disabled" };

  const channels = channelScope(product);
  const channel = normalizedChannel(options.channel);
  if (channel && channels.length && !channels.includes(channel)) {
    return { enabled: false, quantity: 0, source: "channel_disabled", channels };
  }

  const channelQuantity = positiveInteger(channelDefaultQty, 1);
  const vendorQuantity = positiveInteger(inventoryRules.replenishableQty ?? vendor?.replenishableQty, 0);
  const skuQuantity = positiveInteger(product.replenishableQty ?? product.replenishable_qty ?? raw.replenishableQty, 0);

  if (useVendorQty && vendorEnabled && vendorQuantity > 0) {
    return { enabled: true, quantity: vendorQuantity, source: "vendor", ...(channels.length ? { channels } : {}) };
  }
  if (!useVendorQty && skuQuantity > 0) {
    return { enabled: true, quantity: skuQuantity, source: "sku", ...(channels.length ? { channels } : {}) };
  }
  return { enabled: true, quantity: channelQuantity, source: "channel", ...(channels.length ? { channels } : {}) };
}

function timestampValue(...values) {
  for (const value of values) {
    const parsed = Date.parse(String(value || ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function replenishableSafeguard(product = {}, vendor = null, settings = {}, options = {}) {
  if (settings.replenishableSafeguardsEnabled === false) return { suspended: false, reason: "" };
  const raw = product.raw && typeof product.raw === "object" ? product.raw : {};
  const vendorStatus = String(vendor?.status || "active").trim().toLowerCase();
  if (vendor?.retirement?.retiredAt || ["inactive", "retired", "disabled"].includes(vendorStatus)) return { suspended: true, reason: "Vendor is inactive or retired" };
  if (product.active === false || ["inactive", "disabled", "deleted"].includes(String(product.status || "").trim().toLowerCase())) return { suspended: true, reason: "SKU is inactive" };
  if (product.toBeDiscontinued === true || product.discontinued === true) return { suspended: true, reason: "SKU is discontinued" };
  if (settings.replenishableBlockVendorUnavailable !== false) {
    const available = product.vendorAvailable ?? raw.vendorAvailable ?? raw.supplierAvailable;
    if (available === false || ["false", "no", "0", "unavailable"].includes(String(available ?? "").trim().toLowerCase())) return { suspended: true, reason: "Vendor marked the SKU unavailable" };
  }
  const maxAgeHours = Math.max(0, Number(settings.replenishableFeedMaxAgeHours || 0));
  const feedAt = timestampValue(product.stockUpdatedAt, product.inventoryUpdatedAt, raw.stockUpdatedAt, raw.inventoryUpdatedAt, raw.sourceUpdatedAt, vendor?.lastFeedAt, vendor?.lastImportAt);
  if (settings.replenishableRequireFreshVendorFeed !== false && maxAgeHours > 0 && feedAt > 0) {
    const now = Number(options.now || Date.now());
    if (now - feedAt > maxAgeHours * 60 * 60 * 1000) return { suspended: true, reason: `Vendor inventory is older than ${maxAgeHours} hours`, feedAt: new Date(feedAt).toISOString() };
  }
  const velocityLimit = Math.max(0, Number(settings.replenishableMaxDailyVelocity || 0));
  const velocity = Math.max(0, Number(product.averageDaily30 ?? product.inventoryMetrics?.averageDaily30 ?? raw.averageDaily30 ?? 0));
  if (velocityLimit > 0 && velocity > velocityLimit) return { suspended: true, reason: `30-day velocity ${velocity.toFixed(2)} exceeds ${velocityLimit}` };
  return { suspended: false, reason: "", feedAt: feedAt ? new Date(feedAt).toISOString() : "" };
}

function calculateReplenishableChannelInventory({ product = {}, vendor = null, settings = {}, channel = "", physicalAvailable = 0, safetyQty = 0, maxQty = 0, blockedReason = "" } = {}) {
  const plan = resolveReplenishableInventory(product, vendor, settings.defaultReplenishableQty ?? 1, { channel });
  const safeguard = plan.enabled ? replenishableSafeguard(product, vendor, settings) : { suspended: false, reason: "" };
  const maximum = Math.max(0, Math.floor(Number(maxQty || settings.defaultMaxSellableQty || 0)));
  const physical = Math.max(0, Math.floor(Number(physicalAvailable || 0)));
  const safety = Math.max(0, Math.floor(Number(safetyQty || 0)));
  const target = plan.enabled ? Math.max(0, Math.floor(Number(plan.quantity || 0))) : 0;
  const reason = blockedReason || (safeguard.suspended ? safeguard.reason : "");
  const normalQty = Math.max(0, physical - safety);
  const requested = reason ? 0 : plan.enabled ? target : normalQty;
  return { enabled: plan.enabled, source: plan.source, channels: plan.channels || [], physicalAvailable: physical, safetyQty: plan.enabled ? 0 : safety, targetQty: target, maxQty: maximum, finalQty: maximum > 0 ? Math.min(requested, maximum) : requested, suspended: Boolean(reason), reason, feedAt: safeguard.feedAt || "" };
}

module.exports = { calculateReplenishableChannelInventory, replenishableSafeguard, resolveReplenishableInventory };
