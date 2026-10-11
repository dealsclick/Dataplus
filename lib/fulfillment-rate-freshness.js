const { veeqoRateExpiresAt, veeqoRateNeedsRefresh } = require("./veeqo-rate-freshness");

const DEFAULT_RATE_TTL_MS = 15 * 60_000;
const VEEQO_EXPIRY_SAFETY_MS = 5 * 60_000;
const DEFAULT_FALLBACK_SAFETY_MS = 3 * 60_000;

function parsedTimestamp(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function rateReviewProvider(review = {}, fallbackProvider = "") {
  return String(review?.selectedRate?.provider || fallbackProvider || "").trim().toLowerCase();
}

function rateReviewNextRefreshAt(review = {}, fallbackProvider = "", options = {}) {
  const rate = review?.selectedRate && typeof review.selectedRate === "object" ? review.selectedRate : {};
  const provider = rateReviewProvider(review, fallbackProvider);
  const action = String(rate.action || "").trim().toLowerCase();
  if (action === "retrieve_existing_label" || provider === "shopify") return null;

  const ttlMs = Math.max(60_000, Number(options.ttlMs ?? DEFAULT_RATE_TTL_MS) || DEFAULT_RATE_TTL_MS);
  const quotedAt = parsedTimestamp(rate.quotedAt || review.ratedAt || review.attemptedAt);
  if (provider === "veeqo") {
    const expiresAt = parsedTimestamp(veeqoRateExpiresAt(rate));
    if (expiresAt !== null) {
      const safetyWindowMs = Math.max(0, Number(options.veeqoSafetyWindowMs ?? VEEQO_EXPIRY_SAFETY_MS) || 0);
      return expiresAt - safetyWindowMs;
    }
  }
  const fallbackSafetyMs = Math.max(0, Number(options.fallbackSafetyWindowMs ?? DEFAULT_FALLBACK_SAFETY_MS) || 0);
  return quotedAt === null ? 0 : quotedAt + ttlMs - fallbackSafetyMs;
}

function rateReviewNeedsScheduledRefresh(review = {}, fallbackProvider = "", options = {}) {
  const nextRefreshAt = rateReviewNextRefreshAt(review, fallbackProvider, options);
  if (nextRefreshAt === null) return false;
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  return nextRefreshAt <= now;
}

function normalizedRateText(value = "") {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function sameShippingService(left = {}, right = {}) {
  const leftProvider = normalizedRateText(left.provider);
  const rightProvider = normalizedRateText(right.provider);
  const leftCarrier = normalizedRateText(left.carrier || left.raw?.service_carrier || left.raw?.carrier_id || left.raw?.carrier);
  const rightCarrier = normalizedRateText(right.carrier || right.raw?.service_carrier || right.raw?.carrier_id || right.raw?.carrier);
  const leftService = normalizedRateText(left.service || left.raw?.service_name || left.raw?.name || left.serviceType);
  const rightService = normalizedRateText(right.service || right.raw?.service_name || right.raw?.name || right.serviceType);
  return Boolean(leftProvider && rightProvider && leftCarrier && rightCarrier && leftService && rightService
    && leftProvider === rightProvider && leftCarrier === rightCarrier && leftService === rightService);
}

function findMatchingShippingRate(rates = [], selectedRate = {}) {
  const candidates = (Array.isArray(rates) ? rates : []).filter((rate) => normalizedRateText(rate?.provider) === normalizedRateText(selectedRate?.provider));
  return candidates.find((rate) => sameShippingService(rate, selectedRate))
    || candidates.find((rate) => String(rate?.serviceType || "") && String(rate.serviceType) === String(selectedRate.serviceType || ""))
    || null;
}

function rateReviewNeedsPurchaseVerification(review = {}, fallbackProvider = "", options = {}) {
  const rate = review?.selectedRate && typeof review.selectedRate === "object" ? review.selectedRate : {};
  const provider = rateReviewProvider(review, fallbackProvider);
  const action = String(rate.action || "").trim().toLowerCase();
  if (action === "retrieve_existing_label" || provider === "shopify") return false;
  if (provider === "veeqo") return veeqoRateNeedsRefresh(rate, { now: options.now, safetyWindowMs: 0 });
  return rateReviewNeedsScheduledRefresh(review, fallbackProvider, {
    ...options,
    veeqoSafetyWindowMs: 0,
    fallbackSafetyWindowMs: 0
  });
}

function shippingRatePriceChange(previousRate = {}, currentRate = {}, options = {}) {
  const previousAmount = Number(previousRate?.amount);
  const currentAmount = Number(currentRate?.amount);
  const maximumIncreaseRatio = Math.max(0, Number(options.maximumIncreaseRatio ?? 0.10) || 0);
  const validAmounts = Number.isFinite(previousAmount) && previousAmount >= 0 && Number.isFinite(currentAmount) && currentAmount >= 0;
  const increaseRatio = validAmounts && previousAmount > 0 ? (currentAmount - previousAmount) / previousAmount : 0;
  return {
    previousAmount: validAmounts ? previousAmount : null,
    currentAmount: validAmounts ? currentAmount : null,
    increaseRatio,
    maximumIncreaseRatio,
    exceedsLimit: validAmounts && previousAmount > 0 && increaseRatio > maximumIncreaseRatio + Number.EPSILON
  };
}

module.exports = {
  DEFAULT_RATE_TTL_MS,
  DEFAULT_FALLBACK_SAFETY_MS,
  VEEQO_EXPIRY_SAFETY_MS,
  findMatchingShippingRate,
  rateReviewNeedsPurchaseVerification,
  rateReviewNeedsScheduledRefresh,
  rateReviewNextRefreshAt,
  rateReviewProvider,
  sameShippingService,
  shippingRatePriceChange
};
