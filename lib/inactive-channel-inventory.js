const crypto = require('node:crypto');
const { productIsMasterInactive } = require('./product-selling-status');

const CHANNELS = { temu: 'Temu', whatnot: 'Whatnot', tiktok: 'TikTok Shop' };
function channelKey(name) {
  return Object.keys(CHANNELS).find(key => [key, CHANNELS[key].toLowerCase()].includes(String(name).toLowerCase()));
}
function requireInventoryChannel(channel) {
  const key = channelKey(channel?.name);
  if (!key) throw new Error('Unsupported inventory channel.');
  const settings = channel.settings || {};
  if (settings.channelEnabled === false) throw new Error('Channel is disabled.');
  if (settings.inventoryUpdateEnabled === false || (key !== 'tiktok' && settings[`${key}InventorySyncEnabled`] !== true)) throw new Error('Enable inventory synchronization in channel settings.');
  return key;
}
function inventoryLinks(item, key) {
  const explicit = item.channelInventoryLinks?.[key];
  if (Array.isArray(explicit) && explicit.length) return explicit;
  const listing = item[`${key}Listing`] || {};
  return [{
    productId: listing.goodsId || listing.productId || item[`${key}ProductId`],
    skuId: listing.skuId || item[`${key}SkuId`],
    listingId: listing.listingId || item[`${key}ListingId`],
    warehouseIds: listing.warehouseIds || item[`${key}WarehouseIds`]
  }];
}
function required(value, name) {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`Missing ${name}; relink this SKU before retrying.`);
  if (!String(value).trim()) throw new Error(`Missing ${name}; relink this SKU before retrying.`);
  return String(value).trim();
}
function longId(value, name) {
  const text = required(value, name);
  const number = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(number) || number <= 0) throw new Error(`Invalid ${name}.`);
  return number;
}
function zeroRequests(item, key) {
  if (!productIsMasterInactive(item)) return [];
  const requests = [];
  for (const link of inventoryLinks(item, key)) {
    if (key === 'temu') {
      const goodsId = longId(link.productId, 'Temu goods ID');
      const skuId = longId(link.skuId, 'Temu SKU ID');
      // Ordinary and presale stock are separate pools; both must be suppressed.
      for (const stockType of [0, 1]) requests.push({ type: 'bg.local.goods.stock.edit', body: { goodsId, stockType, skuStockTargetList: [{ skuId, stockTarget: 0 }] } });
    } else if (key === 'whatnot') {
      const id = required(link.listingId, 'Whatnot listing ID');
      requests.push({ body: { query: 'mutation ZeroInventory($input: ListingInput!) { listingUpdate(input: $input) { listing { id inventoryLevel { quantity } } userErrors { message } } }', variables: { input: { id, inventoryLevel: { quantity: 0 } } } } });
    } else if (key === 'tiktok') {
      const productId = required(link.productId, 'TikTok product ID');
      const id = required(link.skuId, 'TikTok SKU ID');
      if (!Array.isArray(link.warehouseIds) || !link.warehouseIds.length) throw new Error('Missing TikTok warehouse IDs; relink all listing warehouses before retrying.');
      const inventory = [...new Set(link.warehouseIds.map(v => required(v, 'TikTok warehouse ID')))].map(warehouse_id => ({ warehouse_id, quantity: 0, backorder_quantity: 0 }));
      requests.push({ path: `/product/202309/products/${encodeURIComponent(productId)}/inventory/update`, body: { skus: [{ id, inventory }] } });
    } else throw new Error('Unsupported inventory channel.');
  }
  return requests;
}
function tiktokSignature(path, params, body, secret) {
  const query = Object.keys(params).filter(k => !['sign', 'access_token'].includes(k)).sort().map(k => k + params[k]).join('');
  return crypto.createHmac('sha256', secret).update(secret + path + query + body + secret).digest('hex');
}
function validateResponse(key, request, data) {
  if (key === 'temu') {
    const result = data?.result;
    const sku = request.body.skuStockTargetList[0].skuId;
    const row = result?.skuStockEditStatusInfoList?.find(r => String(r.skuId) === String(sku));
    if (data?.success !== true || result?.operateResult !== true || row?.stockEditStatus !== true) throw new Error(`Temu did not confirm zero inventory: ${row?.errorMsg || result?.msg || data?.errorMsg || 'missing SKU confirmation'}`);
  } else if (key === 'whatnot') {
    const result = data?.data?.listingUpdate;
    if (data?.errors?.length || result?.userErrors?.length || result?.listing?.id !== request.body.variables.input.id || result?.listing?.inventoryLevel?.quantity !== 0) throw new Error(`Whatnot did not confirm zero inventory: ${data?.errors?.[0]?.message || result?.userErrors?.[0]?.message || 'missing listing confirmation'}`);
  } else if (data?.code !== 0) throw new Error(`TikTok inventory update rejected: ${data?.message || 'missing success code'}`);
}
async function sendZeroRequest(key, request, channel, { temuRequest, db, fetchImpl = fetch, env = process.env }) {
  let data;
  if (key === 'temu') {
    data = await temuRequest(request.type, request.body, { db, timeoutMs: 30000, allowErrorResult: true });
  } else {
    let url, headers = { 'content-type': 'application/json' };
    const body = JSON.stringify(request.body);
    if (key === 'whatnot') {
      const production = channel.settings?.whatnotApiEnvironment === 'production';
      const token = required(production ? env.WHATNOT_ACCESS_TOKEN : env.WHATNOT_STAGING_ACCESS_TOKEN, production ? 'WHATNOT_ACCESS_TOKEN' : 'WHATNOT_STAGING_ACCESS_TOKEN');
      url = production ? 'https://api.whatnot.com/seller-api/graphql' : 'https://api.stage.whatnot.com/seller-api/graphql';
      headers.Authorization = `Bearer ${token}`;
    } else {
      const appKey = required(env.TIKTOK_APP_KEY, 'TIKTOK_APP_KEY');
      const secret = required(env.TIKTOK_APP_SECRET, 'TIKTOK_APP_SECRET');
      const token = required(env.TIKTOK_ACCESS_TOKEN, 'TIKTOK_ACCESS_TOKEN');
      const params = { app_key: appKey, shop_cipher: required(env.TIKTOK_SHOP_CIPHER, 'TIKTOK_SHOP_CIPHER'), timestamp: String(Math.floor(Date.now() / 1000)) };
      params.sign = tiktokSignature(request.path, params, body, secret);
      url = `https://open-api.tiktokglobalshop.com${request.path}?${new URLSearchParams(params)}`;
      headers['x-tts-access-token'] = token;
    }
    const response = await fetchImpl(url, { method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`${CHANNELS[key]} inventory HTTP ${response.status}; review authorization or retry later.`);
    data = await response.json();
  }
  validateResponse(key, request, data);
}

module.exports = { CHANNELS, channelKey, requireInventoryChannel, zeroRequests, tiktokSignature, validateResponse, sendZeroRequest };
