// Freight is added once per selling unit, after vendor/MAP/pack pricing.
// It is never discounted with a multipack or marked up as merchandise.
function freightAllowance(shippingClass, settings = {}) {
  const amount = Number(settings.shopifyLtlFreightAllowance ?? 250);
  return shippingClass === "ltl" ? (Number.isFinite(amount) && amount >= 0 ? amount : 250) : 0;
}

function priceIncludingFreight(basePrice, shippingClass, settings = {}) {
  const price = Number(basePrice);
  if (!Number.isFinite(price) || price <= 0) return 0;
  return Math.round((price + freightAllowance(shippingClass, settings)) * 100) / 100;
}

module.exports = { freightAllowance, priceIncludingFreight };
