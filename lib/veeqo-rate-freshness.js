const DEFAULT_SAFETY_WINDOW_MS = 60_000;

function normalizedText(value = "") {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function veeqoRateExpiresAt(rate = {}) {
  return String(
    rate.expiresAt
      || rate.expires_at
      || rate.cutoff
      || rate.raw?.expires_at
      || rate.raw?.expiresAt
      || rate.raw?.cutoff
      || ""
  ).trim();
}

function veeqoRateNeedsRefresh(rate = {}, options = {}) {
  const expiresAt = veeqoRateExpiresAt(rate);
  if (!expiresAt) return true;
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) return true;
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const safetyWindowMs = Math.max(0, Number(options.safetyWindowMs ?? DEFAULT_SAFETY_WINDOW_MS) || 0);
  return expiresAtMs <= now + safetyWindowMs;
}

function sameVeeqoService(left = {}, right = {}) {
  const leftCarrier = normalizedText(left.carrier || left.raw?.service_carrier || left.raw?.carrier_id || left.raw?.carrier);
  const rightCarrier = normalizedText(right.carrier || right.raw?.service_carrier || right.raw?.carrier_id || right.raw?.carrier);
  const leftService = normalizedText(left.service || left.raw?.service_name || left.raw?.name || left.serviceType);
  const rightService = normalizedText(right.service || right.raw?.service_name || right.raw?.name || right.serviceType);
  return Boolean(leftCarrier && rightCarrier && leftService && rightService && leftCarrier === rightCarrier && leftService === rightService);
}

function findFreshVeeqoRate(rates = [], selectedRate = {}) {
  const candidates = (Array.isArray(rates) ? rates : []).filter((rate) => String(rate?.provider || "").toLowerCase() === "veeqo");
  return candidates.find((rate) => sameVeeqoService(rate, selectedRate))
    || candidates.find((rate) => String(rate?.serviceType || "") && String(rate.serviceType) === String(selectedRate.serviceType || ""))
    || null;
}

function isStaleVeeqoRateError(error) {
  const message = String(error?.message || error || "");
  return /no rate data found|rate quote has expired|rate(?:s)? may have expired|remote_shipment_id[^.]*invalid|invalid[^.]*remote_shipment_id/i.test(message);
}

module.exports = {
  DEFAULT_SAFETY_WINDOW_MS,
  findFreshVeeqoRate,
  isStaleVeeqoRateError,
  sameVeeqoService,
  veeqoRateExpiresAt,
  veeqoRateNeedsRefresh
};
