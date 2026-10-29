const MODES = ["cost-plus", "higher-of-product-or-cost", "product-price"];
const ROUNDING_RULES = ["none", "nearest .99", "nearest .95", "round up"];

function normalizeMode(value) {
  return MODES.includes(String(value || "")) ? String(value) : "cost-plus";
}

function normalizeRoundingRule(value) {
  return ROUNDING_RULES.includes(String(value || "")) ? String(value) : "none";
}

function roundChannelPrice(value, rule = "none") {
  const price = Number(value || 0);
  if (!(price > 0)) return 0;
  if (rule === "nearest .99") return Math.max(0.99, Math.ceil(price) - 0.01);
  if (rule === "nearest .95") return Math.max(0.95, Math.ceil(price) - 0.05);
  if (rule === "round up") return Math.ceil(price);
  return Math.round(price * 100) / 100;
}

function variableFeeAmount(price, percent = 0) {
  const gross = Math.max(0, Number(price || 0));
  const rate = Math.max(0, Math.min(99, Number(percent || 0))) / 100;
  return Math.round(gross * rate * 100) / 100;
}

function calculateChannelPrice(options = {}) {
  const cost = Math.max(0, Number(options.cost || 0));
  const productPrice = Math.max(0, Number(options.productPrice || 0));
  const markupPercent = Math.max(0, Number(options.markupPercent || 0));
  const marginPercent = Math.max(0, Math.min(99, Number(options.minMarginPercent || 0)));
  const variableFeePercent = Math.max(0, Math.min(99, Number(options.variableFeePercent || 0)));
  const minimumPrice = Math.max(0, Number(options.minimumPrice || 0));
  const feeRate = variableFeePercent / 100;
  const costPrice = cost > 0 && feeRate < 1 ? cost / (1 - feeRate) : cost;
  const markupPrice = cost > 0 && feeRate < 1 ? cost * (1 + markupPercent / 100) / (1 - feeRate) : 0;
  const marginDenominator = 1 - feeRate - marginPercent / 100;
  const marginPrice = cost > 0 && marginPercent > 0 && marginDenominator > 0 ? cost / marginDenominator : 0;
  const costFormulaPrice = Math.max(costPrice, markupPrice, marginPrice);
  const mode = normalizeMode(options.pricingMode);
  const candidate = mode === "product-price"
    ? Math.max(productPrice, costPrice, minimumPrice)
    : mode === "higher-of-product-or-cost"
      ? Math.max(productPrice, costFormulaPrice, minimumPrice)
      : Math.max(costFormulaPrice, minimumPrice);
  return roundChannelPrice(candidate, normalizeRoundingRule(options.roundingRule));
}

module.exports = { MODES, ROUNDING_RULES, normalizeMode, normalizeRoundingRule, roundChannelPrice, variableFeeAmount, calculateChannelPrice };
