const { veeqoRateExpiresAt } = require("./veeqo-rate-freshness");

const DEFAULT_RATE_TTL_MS = 15 * 60_000;
const VEEQO_EXPIRY_SAFETY_MS = 5 * 60_000;

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
  return quotedAt === null ? 0 : quotedAt + ttlMs;
}

function rateReviewNeedsScheduledRefresh(review = {}, fallbackProvider = "", options = {}) {
  const nextRefreshAt = rateReviewNextRefreshAt(review, fallbackProvider, options);
  if (nextRefreshAt === null) return false;
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  return nextRefreshAt <= now;
}

module.exports = {
  DEFAULT_RATE_TTL_MS,
  VEEQO_EXPIRY_SAFETY_MS,
  rateReviewNeedsScheduledRefresh,
  rateReviewNextRefreshAt,
  rateReviewProvider
};
