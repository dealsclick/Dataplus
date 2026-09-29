const CHANNEL_ALIASES = {
  ebay: 'ebay',
  shopify: 'shopify',
  walmart: 'walmart',
  temu: 'temu',
  whatnot: 'whatnot',
  tiktok: 'tiktok',
  'tiktok shop': 'tiktok'
};

const SUPPORTED_CHANNELS = Object.freeze(['shopify', 'ebay', 'walmart', 'temu', 'whatnot', 'tiktok']);

function channelKey(value = '') {
  return CHANNEL_ALIASES[String(value || '').trim().toLowerCase()] || '';
}

function statusMap(product = {}) {
  const value = product.channelSellingStatus ?? product.raw?.channelSellingStatus;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function productChannelInactive(product = {}, channel = '') {
  const key = channelKey(channel);
  if (!key) return false;
  const value = statusMap(product)[key];
  return value === false
    || value === 'inactive'
    || value?.inactive === true
    || String(value?.status || '').toLowerCase() === 'inactive';
}

function setProductChannelStatus(product = {}, channels = [], status = 'inactive', audit = {}) {
  const next = { ...statusMap(product) };
  const inactive = String(status).toLowerCase() === 'inactive';
  const updatedAt = audit.updatedAt || new Date().toISOString();
  for (const value of channels) {
    const key = channelKey(value);
    if (!key) continue;
    next[key] = {
      status: inactive ? 'inactive' : 'active',
      inactive,
      updatedAt,
      updatedBy: String(audit.updatedBy || 'DataPlus'),
      reason: String(audit.reason || '')
    };
  }
  product.channelSellingStatus = next;
  return product;
}

module.exports = { SUPPORTED_CHANNELS, channelKey, productChannelInactive, setProductChannelStatus, statusMap };
