const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { encryptionKey, seal, unseal } = require('./encrypted-credentials');

const ENVIRONMENTS = new Set(['production', 'development']);
const clean = (value, limit = 4096) => String(value ?? '').trim().slice(0, limit);

function createTikTokCredentials({ directory, env = process.env }) {
  const file = path.join(directory, 'tiktok-runtime-credentials.json');

  function readStore() {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw new Error('TikTok Shop credential storage could not be read.');
    }
  }

  function environmentName(value = 'production') {
    const name = clean(value, 32).toLowerCase();
    if (!ENVIRONMENTS.has(name)) throw new Error('Select production or development shop.');
    return name;
  }

  function fallback(environment = 'production') {
    const suffix = environment === 'development' ? '_DEVELOPMENT' : '';
    return {
      appKey: env[`TIKTOK_APP_KEY${suffix}`] || env.TIKTOK_APP_KEY || '',
      appSecret: env[`TIKTOK_APP_SECRET${suffix}`] || env.TIKTOK_APP_SECRET || '',
      accessToken: env[`TIKTOK_ACCESS_TOKEN${suffix}`] || env.TIKTOK_ACCESS_TOKEN || '',
      refreshToken: env[`TIKTOK_REFRESH_TOKEN${suffix}`] || env.TIKTOK_REFRESH_TOKEN || '',
      shopCipher: env[`TIKTOK_SHOP_CIPHER${suffix}`] || env.TIKTOK_SHOP_CIPHER || '',
      shopId: env[`TIKTOK_SHOP_ID${suffix}`] || env.TIKTOK_SHOP_ID || '',
      region: env[`TIKTOK_SHOP_REGION${suffix}`] || env.TIKTOK_SHOP_REGION || 'US',
      grantedScopes: []
    };
  }

  function saved(environment) {
    const envelope = readStore().environments?.[environment]?.sealed;
    return envelope ? unseal(envelope, env) : {};
  }

  function get(environment = 'production') {
    const name = environmentName(environment);
    return { ...fallback(name), ...saved(name) };
  }

  function status(environment = 'production') {
    const name = environmentName(environment);
    const value = get(name);
    return {
      environment: name,
      encryptedStorageReady: Boolean(encryptionKey(env)),
      appKey: value.appKey || '',
      appSecretConfigured: Boolean(value.appSecret),
      accessTokenConfigured: Boolean(value.accessToken),
      refreshTokenConfigured: Boolean(value.refreshToken),
      configured: Boolean(value.appKey && value.appSecret && value.accessToken),
      shopCipher: value.shopCipher || '',
      shopId: value.shopId || '',
      shopName: value.shopName || '',
      region: value.region || 'US',
      accessTokenExpiresAt: value.accessTokenExpiresAt || '',
      refreshTokenExpiresAt: value.refreshTokenExpiresAt || '',
      grantedScopes: Array.isArray(value.grantedScopes) ? value.grantedScopes : [],
      openId: value.openId || '',
      updatedAt: value.updatedAt || ''
    };
  }

  function writeEnvironment(environment, value) {
    const name = environmentName(environment);
    const current = readStore();
    const next = {
      version: 1,
      environments: {
        ...(current.environments || {}),
        [name]: { sealed: seal(value, env), updatedAt: new Date().toISOString() }
      }
    };
    fs.mkdirSync(directory, { recursive: true });
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, file);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  function save(environment = 'production', patch = {}) {
    const name = environmentName(environment);
    const current = get(name);
    const appKey = clean(patch.appKey || current.appKey, 512);
    const appSecret = clean(patch.appSecret || current.appSecret);
    const accessToken = clean(patch.accessToken || current.accessToken, 8192);
    const refreshToken = clean(patch.refreshToken || current.refreshToken, 8192);
    const shopCipher = clean(patch.shopCipher ?? current.shopCipher, 1024);
    if (!appKey || !appSecret || !accessToken) throw new Error('App key, app secret, and seller access token are required.');
    if (appKey !== current.appKey && !clean(patch.appSecret)) throw new Error('Enter the matching app secret when changing the app key.');
    if ([appKey, appSecret, accessToken, refreshToken, shopCipher].some(value => /[\r\n]/.test(value))) throw new Error('TikTok credentials cannot contain line breaks.');
    writeEnvironment(name, {
      ...current,
      appKey,
      appSecret,
      accessToken,
      refreshToken,
      shopCipher,
      shopId: clean(patch.shopId ?? current.shopId, 256),
      shopName: clean(patch.shopName ?? current.shopName, 256),
      region: clean(patch.region ?? current.region, 16).toUpperCase() || 'US',
      accessTokenExpiresAt: clean(patch.accessTokenExpiresAt ?? current.accessTokenExpiresAt, 64),
      refreshTokenExpiresAt: clean(patch.refreshTokenExpiresAt ?? current.refreshTokenExpiresAt, 64),
      grantedScopes: Array.isArray(patch.grantedScopes) ? [...new Set(patch.grantedScopes.map(scope => clean(scope, 160)).filter(Boolean))] : current.grantedScopes || [],
      openId: clean(patch.openId ?? current.openId, 256),
      updatedAt: new Date().toISOString()
    });
    return status(name);
  }

  function updateTokens(environment = 'production', token = {}) {
    const name = environmentName(environment);
    const current = get(name);
    const tokenExpiry = value => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) return '';
      // TikTok responses have used both duration-style and epoch-style expiry fields.
      return new Date(numeric > 10_000_000_000 ? numeric : numeric > Date.now() / 1000 ? numeric * 1000 : Date.now() + numeric * 1000).toISOString();
    };
    writeEnvironment(name, {
      ...current,
      accessToken: clean(token.access_token || token.accessToken || current.accessToken, 8192),
      refreshToken: clean(token.refresh_token || token.refreshToken || current.refreshToken, 8192),
      accessTokenExpiresAt: tokenExpiry(token.access_token_expire_in ?? token.expires_in) || clean(token.accessTokenExpiresAt || current.accessTokenExpiresAt, 64),
      refreshTokenExpiresAt: tokenExpiry(token.refresh_token_expire_in) || clean(token.refreshTokenExpiresAt || current.refreshTokenExpiresAt, 64),
      grantedScopes: Array.isArray(token.granted_scopes) ? token.granted_scopes : Array.isArray(token.grantedScopes) ? token.grantedScopes : current.grantedScopes || [],
      openId: clean(token.open_id || token.openId || current.openId, 256),
      updatedAt: new Date().toISOString()
    });
    return get(name);
  }

  function selectShop(environment = 'production', shop = {}) {
    const name = environmentName(environment);
    const current = get(name);
    const cipher = clean(shop.cipher || shop.shopCipher, 1024);
    if (!cipher) throw new Error('Choose an authorized TikTok Shop.');
    writeEnvironment(name, {
      ...current,
      shopCipher: cipher,
      shopId: clean(shop.id || shop.shopId, 256),
      shopName: clean(shop.name || shop.shopName, 256),
      region: clean(shop.region || current.region, 16).toUpperCase() || 'US',
      updatedAt: new Date().toISOString()
    });
    return status(name);
  }

  function fingerprint(environment = 'production') {
    const value = get(environment);
    return crypto.createHash('sha256').update(JSON.stringify([
      environmentName(environment), value.appKey, value.appSecret, value.shopCipher, value.shopId
    ])).digest('hex');
  }

  return { get, status, save, updateTokens, selectShop, fingerprint };
}

module.exports = { createTikTokCredentials };
