const methods = ['legacy', 'markup', 'gross-margin'];

function validatePricingMethod(settings = {}) {
  const method = settings.pricingMethod ?? 'legacy';
  const percent = Number(settings.pricingPercent ?? 28);
  if (!methods.includes(method) || !Number.isFinite(percent) || percent < 0 || percent > 1000 || (method === 'gross-margin' && percent >= 100)) {
    throw Object.assign(new Error('Invalid pricing method or percentage. Gross margin must be below 100%.'), { statusCode: 400 });
  }
  return { method, percent };
}

function channelCostPrice(cost, settings = {}, legacyPrice = 0) {
  const { method, percent } = validatePricingMethod(settings);
  if (method === 'legacy') return legacyPrice;
  if (!Number.isFinite(Number(cost)) || Number(cost) <= 0) return 0;
  const price = method === 'gross-margin' ? Number(cost) / (1 - percent / 100) : Number(cost) * (1 + percent / 100);
  // Round up to a cent so the chosen target is never reduced by rounding.
  return Math.ceil((price - 1e-9) * 100) / 100;
}

module.exports = { validatePricingMethod, channelCostPrice };
