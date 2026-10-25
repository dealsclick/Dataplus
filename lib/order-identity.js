const LEGACY_TENANT_ID = "organization-default";
const LEGACY_COMPANY_ID = "linq-usa";
const LEGACY_COMPANY_NUMBER = 100;

const CHANNEL_NUMBERS = Object.freeze({
  ebay: 1,
  shopify: 2,
  walmart: 3,
  temu: 4,
  amazon: 5,
  tiktok: 6,
  manual: 9000
});

const CHANNEL_ALIASES = new Map([
  ["ebay", "ebay"],
  ["ebay live", "ebay"],
  ["ebay-live", "ebay"],
  ["shopify", "shopify"],
  ["online store", "shopify"],
  ["shop", "shopify"],
  ["shopify pos", "shopify"],
  ["pos", "shopify"],
  ["draft order", "shopify"],
  ["walmart", "walmart"],
  ["walmart marketplace", "walmart"],
  ["temu", "temu"],
  ["amazon", "amazon"],
  ["amazon marketplace", "amazon"],
  ["tiktok", "tiktok"],
  ["tiktok shop", "tiktok"],
  ["manual", "manual"]
]);

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeChannelKey(...values) {
  for (const value of values.flat()) {
    const candidate = clean(value).toLowerCase().replace(/\s+/g, " ");
    if (!candidate) continue;
    const known = CHANNEL_ALIASES.get(candidate);
    if (known) return known;
    for (const channelKey of ["ebay", "shopify", "walmart", "temu", "amazon", "tiktok"]) {
      if (candidate === channelKey || candidate.startsWith(`${channelKey} `) || candidate.startsWith(`${channelKey}/`) || candidate.startsWith(`${channelKey}-`)) return channelKey;
    }
    const slug = candidate.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (slug) return slug;
  }
  return "";
}

function normalizeChannelOrderId(value) {
  return clean(value).toLowerCase();
}

function normalizeCompanyNumber(value, fallback = LEGACY_COMPANY_NUMBER) {
  const parsed = Number(value);
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  const fallbackNumber = Number(fallback);
  return Number.isSafeInteger(fallbackNumber) && fallbackNumber > 0 ? fallbackNumber : LEGACY_COMPANY_NUMBER;
}

function channelNumberFor(channelKey) {
  return CHANNEL_NUMBERS[normalizeChannelKey(channelKey)] || null;
}

function buildOrderIdentity(order = {}, defaults = {}) {
  const tenantId = clean(order.tenantId || order.tenant_id || defaults.tenantId || LEGACY_TENANT_ID);
  const companyId = clean(order.workspaceCompanyId || order.companyId || order.company_id || defaults.companyId || LEGACY_COMPANY_ID);
  const companyNumber = normalizeCompanyNumber(
    order.companyNumber || order.company_number || defaults.companyNumber,
    defaults.companyNumber || LEGACY_COMPANY_NUMBER
  );
  const channelKey = normalizeChannelKey(
    order.channelKey,
    order.channel_key,
    order.source,
    order.channelSource,
    order.salesChannel,
    order.sourceChannel,
    order.marketplace,
    defaults.channelKey
  );
  const channelOrderId = clean(
    order.channelOrderId
      || order.marketplaceOrderId
      || order.marketplaceOrderNumber
      || order.external?.orderId
      || order.external?.legacyOrderId
      || order.external?.parentOrderSn
      || defaults.channelOrderId
  );
  const normalizedChannelOrderId = normalizeChannelOrderId(channelOrderId);
  const channelNumber = channelNumberFor(channelKey);
  const identityKey = companyNumber && channelKey && normalizedChannelOrderId
    ? `${companyNumber}+${channelKey}+${normalizedChannelOrderId}`
    : "";
  return {
    tenantId,
    companyId,
    companyNumber,
    channelKey,
    channelNumber,
    channelOrderId,
    normalizedChannelOrderId,
    identityKey
  };
}

module.exports = {
  CHANNEL_NUMBERS,
  LEGACY_COMPANY_ID,
  LEGACY_COMPANY_NUMBER,
  LEGACY_TENANT_ID,
  buildOrderIdentity,
  channelNumberFor,
  normalizeChannelKey,
  normalizeChannelOrderId,
  normalizeCompanyNumber
};
