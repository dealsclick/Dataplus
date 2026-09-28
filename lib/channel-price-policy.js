const { variantPriceFloor } = require('./product-price-floors');

const modes = ['inherit', 'protected', 'calculated'];
function validatePriceMode(value, inherit = true) {
  if (!modes.includes(value) || (!inherit && value === 'inherit')) throw new Error('Choose MAP/LAP protected pricing or calculated pricing.');
  return value;
}
function resolvePricePolicy(item = {}, db = {}, channel = {}) {
  const key = String(channel.name || '').trim().toLowerCase();
  // Every selling channel must honor imported MAP, LAP, and source minimums.
  // Formula and manual prices remain valid only when they are higher.
  if (key) {
    return { mode: 'protected', source: 'channel-required' };
  }
  const skuMode = item.channelPriceModes?.[channel.id] ?? item.channelPriceModes?.[key];
  const brandName = String(item.brand || '').trim().toLowerCase();
  const brand = (db?.brands || []).find(row => String(row.name || '').trim().toLowerCase() === brandName);
  for (const [source, mode] of [['sku', skuMode], ['brand', brand?.mapPricingMode], ['channel', channel.settings?.mapPricingMode]]) {
    if (mode === 'protected' || mode === 'calculated') return { mode, source };
  }
  return { mode: 'protected', source: 'default' };
}
function applyPricePolicy(calculated, item, db, channel, quantity = 1, sourceQuantity = 1) {
  const price = Number(calculated);
  if (!Number.isFinite(price) || price <= 0) return 0;
  const policy = resolvePricePolicy(item, db, channel);
  return Math.max(price, policy.mode === 'protected' ? variantPriceFloor(item, quantity, sourceQuantity) : 0);
}
module.exports = { validatePriceMode, resolvePricePolicy, applyPricePolicy };
