const defaults = {
  mapPricingMode: "protected",
  channelEnabled: false, walmartLinkExistingEnabled: false,
  walmartOrdersEnabled: false, walmartLaunchEnabled: false, walmartInventoryEnabled: false,
  walmartInventoryScheduleEnabled: true, walmartInventoryScheduleHours: 12,
  walmartPriceEnabled: false, walmartOrderUpdatesEnabled: false, walmartOrderScheduleEnabled: false,
  walmartFeedPollingEnabled: true, walmartEnvironment: 'production', walmartSpecVersion: '',
  walmartPriceMarkupPercent: 30, walmartMinMarginPercent: 15, walmartOrderScheduleHours: 1,
  walmartOrderLookbackDays: 30, walmartWarehouseId: '', walmartShipNode: '', walmartSafetyQty: 0,
  walmartMaxQuantity: 0
};

function applyWalmartSettings(current, body) {
  const input = { ...body, ...(body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings) ? body.settings : {}) };
  const next = { ...current };
  const invalid = field => { throw Object.assign(new Error(`Invalid Walmart setting: ${field}.`), { statusCode: 400 }); };
  for (const [field, fallback] of Object.entries(defaults)) {
    if (input[field] === undefined) continue;
    const value = input[field];
    if (typeof fallback === 'boolean') {
      if (![true, false, 'true', 'false'].includes(value)) invalid(field);
      next[field] = value === true || value === 'true';
    } else if (typeof fallback === 'number') {
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0) invalid(field);
      if (field === 'walmartMinMarginPercent' && number >= 100) invalid(field);
      if (field === 'walmartOrderScheduleHours' && (number < 1 || number > 24)) invalid(field);
      if (field === 'walmartInventoryScheduleHours' && (number < 1 || number > 24)) invalid(field);
      if (field === 'walmartOrderLookbackDays' && (number < 1 || number > 180)) invalid(field);
      if (['walmartOrderLookbackDays', 'walmartSafetyQty', 'walmartMaxQuantity'].includes(field) && !Number.isInteger(number)) invalid(field);
      next[field] = number;
    } else {
      if (typeof value !== 'string' || value.length > 256) invalid(field);
      next[field] = value.trim();
    }
  }
  if (next.walmartEnvironment && !['production', 'sandbox'].includes(next.walmartEnvironment)) invalid('walmartEnvironment');
  if (next.mapPricingMode && !["protected", "calculated"].includes(next.mapPricingMode)) invalid("mapPricingMode");
  return next;
}
module.exports = { applyWalmartSettings };
