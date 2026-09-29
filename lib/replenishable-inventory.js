function booleanValue(value) {
  return value === true || ["true", "yes", "y", "1"].includes(String(value ?? "").trim().toLowerCase());
}

function positiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.max(1, Math.floor(numeric));
}

function resolveReplenishableInventory(product = {}, vendor = null, channelDefaultQty = 1) {
  const raw = product.raw && typeof product.raw === "object" ? product.raw : {};
  const inventoryRules = vendor?.inventoryRules && typeof vendor.inventoryRules === "object" ? vendor.inventoryRules : {};
  const useVendorRules = booleanValue(product.replenishableUseVendorRules ?? product.replenishable_use_vendor_rules ?? raw.replenishableUseVendorRules);
  const useVendorQty = useVendorRules || booleanValue(product.replenishableQtyUseVendorDefault ?? product.replenishable_qty_use_vendor_default ?? raw.replenishableQtyUseVendorDefault);
  const skuEnabled = booleanValue(product.replenishable ?? product.isReplenishable ?? raw.replenishable ?? raw.isReplenishable);
  const vendorEnabled = booleanValue(inventoryRules.replenishableEnabled ?? inventoryRules.enabled);
  const enabled = useVendorRules ? vendorEnabled : skuEnabled;
  if (!enabled) return { enabled: false, quantity: 0, source: "disabled" };

  const channelQuantity = positiveInteger(channelDefaultQty, 1);
  const vendorQuantity = positiveInteger(inventoryRules.replenishableQty ?? vendor?.replenishableQty, 0);
  const skuQuantity = positiveInteger(product.replenishableQty ?? product.replenishable_qty ?? raw.replenishableQty, 0);

  if (useVendorQty && vendorEnabled && vendorQuantity > 0) {
    return { enabled: true, quantity: vendorQuantity, source: "vendor" };
  }
  if (!useVendorQty && skuQuantity > 0) {
    return { enabled: true, quantity: skuQuantity, source: "sku" };
  }
  return { enabled: true, quantity: channelQuantity, source: "channel" };
}

module.exports = { resolveReplenishableInventory };
