const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { encryptionKey, seal, unseal } = require('./encrypted-credentials');
const channelOAuthState = require('./channel-oauth-state');

const ENVIRONMENTS = new Set(['production', 'development']);
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const ACCOUNT_FIELDS = [
  'accessToken', 'refreshToken', 'accessTokenExpiresAt', 'refreshTokenExpiresAt',
  'grantedScopes', 'openId', 'shopCipher', 'shopId', 'shopName', 'shopCode', 'sellerType', 'label'
];
const CREATOR_FIELDS = [
  'accessToken', 'refreshToken', 'accessTokenExpiresAt', 'refreshTokenExpiresAt',
  'grantedScopes', 'openId', 'username', 'creatorUserOpenId', 'userType', 'permissions',
  'registerRegion', 'selectionRegion', 'avatarUrl', 'label'
];
const clean = (value, limit = 4096) => String(value ?? '').trim().slice(0, limit);
const stateHash = value => crypto.createHash('sha256').update(String(value || '')).digest();
const stateHashHex = value => stateHash(value).toString('hex');
const safeReturnTo = value => {
  const target = clean(value, 1000);
  return target && target.startsWith('/') && !target.startsWith('//') && !target.includes('\\') ? target : '/channels?channel=TikTok%20Shop';
};

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
      serviceId: env[`TIKTOK_SERVICE_ID${suffix}`] || env.TIKTOK_SERVICE_ID || '',
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

  function accountRecord(id, value = {}) {
    return {
      id,
      label: clean(value.label || value.shopName || value.openId || id, 256),
      accessToken: clean(value.accessToken, 8192),
      refreshToken: clean(value.refreshToken, 8192),
      accessTokenExpiresAt: clean(value.accessTokenExpiresAt, 64),
      refreshTokenExpiresAt: clean(value.refreshTokenExpiresAt, 64),
      grantedScopes: Array.isArray(value.grantedScopes) ? value.grantedScopes.map(scope => clean(scope, 160)).filter(Boolean) : [],
      openId: clean(value.openId, 256),
      shopCipher: clean(value.shopCipher, 1024),
      shopId: clean(value.shopId, 256),
      shopName: clean(value.shopName, 256),
      shopCode: clean(value.shopCode, 256),
      sellerType: clean(value.sellerType, 128),
      region: clean(value.region, 16).toUpperCase() || 'US',
      createdAt: clean(value.createdAt, 64) || new Date().toISOString(),
      updatedAt: clean(value.updatedAt, 64) || new Date().toISOString()
    };
  }

  function creatorRecord(id, value = {}) {
    return {
      id,
      label: clean(value.label || value.username || value.creatorUserOpenId || value.openId || id, 256),
      accessToken: clean(value.accessToken, 8192),
      refreshToken: clean(value.refreshToken, 8192),
      accessTokenExpiresAt: clean(value.accessTokenExpiresAt, 64),
      refreshTokenExpiresAt: clean(value.refreshTokenExpiresAt, 64),
      grantedScopes: Array.isArray(value.grantedScopes) ? value.grantedScopes.map(scope => clean(scope, 160)).filter(Boolean) : [],
      openId: clean(value.openId, 256),
      username: clean(value.username, 256),
      creatorUserOpenId: clean(value.creatorUserOpenId, 256),
      userType: clean(value.userType, 128),
      permissions: Array.isArray(value.permissions) ? value.permissions.map(permission => clean(permission, 160)).filter(Boolean) : [],
      registerRegion: clean(value.registerRegion, 32),
      selectionRegion: clean(value.selectionRegion, 32),
      avatarUrl: clean(value.avatarUrl, 2048),
      createdAt: clean(value.createdAt, 64) || new Date().toISOString(),
      updatedAt: clean(value.updatedAt, 64) || new Date().toISOString()
    };
  }

  function environmentRecord(environment = 'production') {
    const name = environmentName(environment);
    const merged = { ...fallback(name), ...saved(name) };
    const accounts = {};
    if (merged.accounts && typeof merged.accounts === 'object' && !Array.isArray(merged.accounts)) {
      for (const [rawId, value] of Object.entries(merged.accounts)) {
        const id = clean(rawId || value?.id, 256);
        if (id) accounts[id] = accountRecord(id, value);
      }
    }
    const creators = {};
    if (merged.creators && typeof merged.creators === 'object' && !Array.isArray(merged.creators)) {
      for (const [rawId, value] of Object.entries(merged.creators)) {
        const id = clean(rawId || value?.id, 256);
        if (id) creators[id] = creatorRecord(id, value);
      }
    }
    const hasLegacyAccount = ACCOUNT_FIELDS.some(field => field === 'grantedScopes'
      ? Array.isArray(merged[field]) && merged[field].length
      : Boolean(clean(merged[field])));
    if (!Object.keys(accounts).length && hasLegacyAccount) {
      const id = clean(merged.openId || merged.shopId, 256)
        || `legacy-${crypto.createHash('sha256').update(`${name}:${merged.appKey || 'tiktok'}`).digest('hex').slice(0, 12)}`;
      accounts[id] = accountRecord(id, merged);
    }
    const requestedActive = clean(merged.activeAccountId, 256);
    const activeAccountId = accounts[requestedActive] ? requestedActive : Object.keys(accounts)[0] || '';
    const activeCreatorId = creators[clean(merged.activeCreatorId, 256)] ? clean(merged.activeCreatorId, 256) : Object.keys(creators)[0] || '';
    const shared = { ...merged, accounts, activeAccountId, creators, activeCreatorId };
    for (const field of ACCOUNT_FIELDS) delete shared[field];
    return shared;
  }

  function creatorSummaries(environment = 'production') {
    const record = environmentRecord(environmentName(environment));
    return Object.values(record.creators || {}).map(creator => ({
      id: creator.id,
      label: creator.username || creator.label || creator.creatorUserOpenId || creator.openId || creator.id,
      username: creator.username || '',
      creatorUserOpenId: creator.creatorUserOpenId || '',
      userType: creator.userType || '',
      permissions: creator.permissions || [],
      registerRegion: creator.registerRegion || '',
      selectionRegion: creator.selectionRegion || '',
      avatarUrl: creator.avatarUrl || '',
      configured: Boolean(record.appKey && record.appSecret && creator.accessToken),
      refreshTokenConfigured: Boolean(creator.refreshToken),
      accessTokenExpiresAt: creator.accessTokenExpiresAt || '',
      grantedScopes: creator.grantedScopes || [],
      updatedAt: creator.updatedAt || '',
      active: record.activeCreatorId === creator.id
    }));
  }

  function getCreator(environment = 'production', creatorId = '') {
    const name = environmentName(environment);
    const record = environmentRecord(name);
    const id = clean(creatorId, 256) || record.activeCreatorId;
    const creator = id ? record.creators?.[id] : null;
    if (!creator) return { appKey: record.appKey || '', appSecret: record.appSecret || '', environment: name, accountId: '' };
    return { appKey: record.appKey || '', appSecret: record.appSecret || '', environment: name, accountId: id, ...creator };
  }

  function resolveAccountId(record, accountId = '', required = false) {
    const requested = clean(accountId, 256);
    const resolved = requested || clean(record.activeAccountId, 256);
    if (resolved && record.accounts?.[resolved]) return resolved;
    if (required) throw new Error('Choose a connected TikTok Shop seller account.');
    return '';
  }

  function get(environment = 'production', accountId = '') {
    const name = environmentName(environment);
    const record = environmentRecord(name);
    const resolved = resolveAccountId(record, accountId);
    const account = resolved ? record.accounts[resolved] : {};
    const { accounts: _accounts, ...shared } = record;
    return { ...shared, ...account, environment: name, accountId: resolved };
  }

  function accountSummaries(environment = 'production') {
    const name = environmentName(environment);
    const record = environmentRecord(name);
    return Object.values(record.accounts || {}).map(account => ({
      id: account.id,
      label: account.shopName || account.label || account.openId || account.id,
      shopId: account.shopId || '',
      shopName: account.shopName || '',
      shopCode: account.shopCode || '',
      region: account.region || record.region || 'US',
      sellerType: account.sellerType || '',
      configured: Boolean(record.appKey && record.appSecret && account.accessToken),
      refreshTokenConfigured: Boolean(account.refreshToken),
      shopSelected: Boolean(account.shopCipher),
      accessTokenExpiresAt: account.accessTokenExpiresAt || '',
      grantedScopes: account.grantedScopes || [],
      updatedAt: account.updatedAt || ''
    }));
  }

  function status(environment = 'production', accountId = '') {
    const name = environmentName(environment);
    const value = get(name, accountId);
    return {
      environment: name,
      encryptedStorageReady: Boolean(encryptionKey(env)),
      appKey: value.appKey || '',
      serviceId: value.serviceId || '',
      appSecretConfigured: Boolean(value.appSecret),
      accessTokenConfigured: Boolean(value.accessToken),
      refreshTokenConfigured: Boolean(value.refreshToken),
      appConfigured: Boolean(value.appKey && value.appSecret && value.serviceId),
      configured: Boolean(value.appKey && value.appSecret && value.accessToken),
      accountId: value.accountId || '',
      activeAccountId: value.activeAccountId || '',
      accounts: accountSummaries(name),
      shopCipher: value.shopCipher || '',
      shopId: value.shopId || '',
      shopName: value.shopName || '',
      shopCode: value.shopCode || '',
      region: value.region || 'US',
      accessTokenExpiresAt: value.accessTokenExpiresAt || '',
      refreshTokenExpiresAt: value.refreshTokenExpiresAt || '',
      grantedScopes: Array.isArray(value.grantedScopes) ? value.grantedScopes : [],
      openId: value.openId || '',
      authorizationPending: Boolean(
        (value.oauthStateHash && Date.parse(value.oauthStateExpiresAt || '') > Date.now())
        || (Array.isArray(value.oauthPendingStates) && value.oauthPendingStates.some(entry => Date.parse(entry?.expiresAt || '') > Date.now()))
      ),
      updatedAt: value.updatedAt || ''
    };
  }

  function writeEnvironment(environment, value) {
    const name = environmentName(environment);
    const current = readStore();
    const next = {
      version: 2,
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
    const current = environmentRecord(name);
    const appKey = clean(patch.appKey || current.appKey, 512);
    const appSecret = clean(patch.appSecret || current.appSecret);
    const serviceId = clean(patch.serviceId || current.serviceId, 512);
    const identityChanged = appKey !== current.appKey || serviceId !== current.serviceId || (Boolean(clean(patch.appSecret)) && appSecret !== current.appSecret);
    if (!appKey || !appSecret) throw new Error('App key and app secret are required.');
    if (appKey !== current.appKey && !clean(patch.appSecret)) throw new Error('Enter the matching app secret when changing the app key.');
    if ([appKey, appSecret, serviceId].some(value => /[\r\n]/.test(value))) throw new Error('TikTok credentials cannot contain line breaks.');
    writeEnvironment(name, {
      ...current,
      appKey,
      appSecret,
      serviceId,
      accounts: identityChanged ? {} : current.accounts,
      activeAccountId: identityChanged ? '' : current.activeAccountId,
      creators: identityChanged ? {} : current.creators,
      activeCreatorId: identityChanged ? '' : current.activeCreatorId,
      region: clean(patch.region ?? current.region, 16).toUpperCase() || 'US',
      oauthStateHash: '',
      oauthStateExpiresAt: '',
      oauthActorId: '',
      oauthActorName: '',
      oauthReturnTo: '',
      oauthStateMode: '',
      oauthPendingStates: [],
      oauthConsumedStateHashes: [],
      creatorOauthPendingStates: [],
      creatorOauthConsumedStateHashes: [],
      updatedAt: new Date().toISOString()
    });
    return status(name);
  }

  function tokenExpiry(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return '';
    return new Date(numeric > 10_000_000_000 ? numeric : numeric > Date.now() / 1000 ? numeric * 1000 : Date.now() + numeric * 1000).toISOString();
  }

  function updateTokens(environment = 'production', token = {}, accountId = '') {
    const name = environmentName(environment);
    const current = environmentRecord(name);
    const returnedOpenId = clean(token.open_id || token.openId, 256);
    const requestedAccountId = clean(accountId, 256);
    const existingRequested = requestedAccountId ? current.accounts?.[requestedAccountId] : null;
    if (existingRequested?.openId && returnedOpenId && existingRequested.openId !== returnedOpenId) {
      throw new Error('TikTok authorized a different seller account. Start a new account connection instead of reconnecting the selected account.');
    }
    const targetId = requestedAccountId || returnedOpenId || crypto.randomUUID();
    const existing = current.accounts?.[targetId] || {};
    const account = accountRecord(targetId, {
      ...existing,
      accessToken: clean(token.access_token || token.accessToken || existing.accessToken, 8192),
      refreshToken: clean(token.refresh_token || token.refreshToken || existing.refreshToken, 8192),
      accessTokenExpiresAt: tokenExpiry(token.access_token_expire_in ?? token.expires_in) || clean(token.accessTokenExpiresAt || existing.accessTokenExpiresAt, 64),
      refreshTokenExpiresAt: tokenExpiry(token.refresh_token_expire_in) || clean(token.refreshTokenExpiresAt || existing.refreshTokenExpiresAt, 64),
      grantedScopes: Array.isArray(token.granted_scopes) ? token.granted_scopes : Array.isArray(token.grantedScopes) ? token.grantedScopes : existing.grantedScopes || [],
      openId: clean(token.open_id || token.openId || existing.openId, 256),
      updatedAt: new Date().toISOString()
    });
    writeEnvironment(name, {
      ...current,
      accounts: { ...(current.accounts || {}), [targetId]: account },
      activeAccountId: targetId,
      updatedAt: new Date().toISOString()
    });
    return get(name, targetId);
  }

  function updateCreatorTokens(environment = 'production', token = {}, creatorId = '') {
    const name = environmentName(environment);
    const current = environmentRecord(name);
    const returnedOpenId = clean(token.open_id || token.openId, 256);
    const requestedId = clean(creatorId, 256);
    const existingRequested = requestedId ? current.creators?.[requestedId] : null;
    if (existingRequested?.openId && returnedOpenId && existingRequested.openId !== returnedOpenId) {
      throw new Error('TikTok authorized a different creator. Add it as a new creator connection instead of replacing this one.');
    }
    const targetId = requestedId || returnedOpenId || crypto.randomUUID();
    const existing = current.creators?.[targetId] || {};
    const creator = creatorRecord(targetId, {
      ...existing,
      accessToken: clean(token.access_token || token.accessToken || existing.accessToken, 8192),
      refreshToken: clean(token.refresh_token || token.refreshToken || existing.refreshToken, 8192),
      accessTokenExpiresAt: tokenExpiry(token.access_token_expire_in ?? token.expires_in) || clean(token.accessTokenExpiresAt || existing.accessTokenExpiresAt, 64),
      refreshTokenExpiresAt: tokenExpiry(token.refresh_token_expire_in) || clean(token.refreshTokenExpiresAt || existing.refreshTokenExpiresAt, 64),
      grantedScopes: Array.isArray(token.granted_scopes) ? token.granted_scopes : Array.isArray(token.grantedScopes) ? token.grantedScopes : existing.grantedScopes || [],
      openId: returnedOpenId || existing.openId,
      updatedAt: new Date().toISOString()
    });
    writeEnvironment(name, { ...current, creators: { ...(current.creators || {}), [targetId]: creator }, activeCreatorId: targetId, updatedAt: new Date().toISOString() });
    return getCreator(name, targetId);
  }

  function updateCreatorProfile(environment = 'production', creatorId = '', profile = {}) {
    const name = environmentName(environment);
    const current = environmentRecord(name);
    const targetId = clean(creatorId, 256) || current.activeCreatorId;
    if (!targetId || !current.creators?.[targetId]) throw new Error('Choose a connected TikTok creator account.');
    const existing = current.creators[targetId];
    const creator = creatorRecord(targetId, {
      ...existing,
      username: profile.username || existing.username,
      creatorUserOpenId: profile.creator_user_open_id || profile.creator_user_id || existing.creatorUserOpenId,
      userType: profile.user_type || existing.userType,
      permissions: Array.isArray(profile.permissions) ? profile.permissions : existing.permissions,
      registerRegion: profile.register_region || existing.registerRegion,
      selectionRegion: profile.selection_region || existing.selectionRegion,
      avatarUrl: profile.avatar?.url || existing.avatarUrl,
      label: profile.username || existing.label,
      updatedAt: new Date().toISOString()
    });
    writeEnvironment(name, { ...current, creators: { ...current.creators, [targetId]: creator }, activeCreatorId: targetId, updatedAt: new Date().toISOString() });
    return getCreator(name, targetId);
  }

  function removeCreator(environment = 'production', creatorId = '') {
    const name = environmentName(environment);
    const current = environmentRecord(name);
    const targetId = clean(creatorId, 256);
    if (!targetId || !current.creators?.[targetId]) throw new Error('Choose a connected TikTok creator account.');
    const removed = current.creators[targetId];
    const creators = { ...current.creators };
    delete creators[targetId];
    writeEnvironment(name, { ...current, creators, activeCreatorId: current.activeCreatorId === targetId ? Object.keys(creators)[0] || '' : current.activeCreatorId, updatedAt: new Date().toISOString() });
    return { id: targetId, label: removed.username || removed.label || targetId, creators: creatorSummaries(name) };
  }

  function beginCreatorAuthorization(environment = 'production', options = {}) {
    const name = environmentName(environment);
    const current = environmentRecord(name);
    if (!current.appKey || !current.appSecret) throw new Error('Save the TikTok Shop app key and app secret first.');
    const sessionToken = clean(options.sessionToken, 8192);
    if (!sessionToken) throw new Error('Sign in to DataPlus again before connecting a TikTok creator.');
    const creatorId = clean(options.creatorId, 256);
    if (creatorId && !current.creators?.[creatorId]) throw new Error('Choose an existing TikTok creator or add a new one.');
    const signedState = channelOAuthState.createState({
      provider: 'TikTok Creator', clientId: current.appKey, signingSecret: current.appSecret,
      redirectUri: 'tiktok-creator', sessionToken, returnTo: safeReturnTo(options.returnTo),
      defaultReturnTo: '/channels?channel=TikTok%20Shop',
      data: { actorId: clean(options.actorId, 96), actorName: clean(options.actorName, 96), creatorId }
    });
    const state = `creator.${name}.${signedState}`;
    const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString();
    const pendingStates = (Array.isArray(current.creatorOauthPendingStates) ? current.creatorOauthPendingStates : [])
      .filter(entry => entry?.hash && Date.parse(entry.expiresAt || '') > Date.now())
      .concat({ hash: stateHashHex(state), expiresAt })
      .slice(-12);
    writeEnvironment(name, {
      ...current,
      creatorOauthPendingStates: pendingStates,
      updatedAt: new Date().toISOString()
    });
    return { environment: name, creatorId, state, returnTo: safeReturnTo(options.returnTo), expiresAt };
  }

  function consumeCreatorAuthorization(state, options = {}) {
    const token = clean(state, 2000);
    const match = token.match(/^creator\.(production|development)\.(v2\..+)$/);
    if (!match) throw new Error('TikTok creator authorization state is invalid or expired. Start the connection again.');
    const environment = environmentName(match[1]);
    const current = environmentRecord(environment);
    const result = channelOAuthState.validateState({
      provider: 'TikTok Creator', clientId: current.appKey, signingSecret: current.appSecret,
      redirectUri: 'tiktok-creator', sessionToken: clean(options.sessionToken, 8192), state: match[2],
      ttlMs: OAUTH_STATE_TTL_MS, defaultReturnTo: '/channels?channel=TikTok%20Shop'
    });
    const hash = stateHashHex(token);
    const pending = (Array.isArray(current.creatorOauthPendingStates) ? current.creatorOauthPendingStates : [])
      .filter(entry => entry?.hash && Date.parse(entry.expiresAt || '') > Date.now());
    const consumed = (Array.isArray(current.creatorOauthConsumedStateHashes) ? current.creatorOauthConsumedStateHashes : [])
      .filter(entry => entry?.hash && Date.parse(entry.expiresAt || '') > Date.now());
    if (!pending.some(entry => entry.hash === hash) || consumed.some(entry => entry.hash === hash)) {
      throw new Error('TikTok creator authorization state is invalid or expired. Start the connection again.');
    }
    writeEnvironment(environment, {
      ...current,
      creatorOauthPendingStates: pending.filter(entry => entry.hash !== hash),
      creatorOauthConsumedStateHashes: consumed.concat({ hash, expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString() }).slice(-24),
      updatedAt: new Date().toISOString()
    });
    return {
      environment, creatorId: clean(result.data.creatorId, 256), actorId: clean(result.data.actorId, 96),
      actorName: clean(result.data.actorName, 96), returnTo: safeReturnTo(result.returnTo), credentials: current
    };
  }

  function creatorFingerprint(environment = 'production', creatorId = '') {
    const value = getCreator(environment, creatorId);
    return crypto.createHash('sha256').update(JSON.stringify([environmentName(environment), value.accountId, value.appKey, value.appSecret, value.openId])).digest('hex');
  }

  function selectShop(environment = 'production', shop = {}, accountId = '') {
    const name = environmentName(environment);
    const current = environmentRecord(name);
    const targetId = resolveAccountId(current, accountId, true);
    const existing = current.accounts[targetId];
    const cipher = clean(shop.cipher || shop.shopCipher, 1024);
    if (!cipher) throw new Error('Choose an authorized TikTok Shop.');
    const account = accountRecord(targetId, {
      ...existing,
      label: clean(shop.name || shop.shopName || existing.label, 256),
      shopCipher: cipher,
      shopId: clean(shop.id || shop.shopId, 256),
      shopName: clean(shop.name || shop.shopName, 256),
      shopCode: clean(shop.code || shop.shopCode, 256),
      sellerType: clean(shop.seller_type || shop.sellerType || existing.sellerType, 128),
      region: clean(shop.region || existing.region || current.region, 16).toUpperCase() || 'US',
      updatedAt: new Date().toISOString()
    });
    writeEnvironment(name, {
      ...current,
      accounts: { ...current.accounts, [targetId]: account },
      activeAccountId: targetId,
      updatedAt: new Date().toISOString()
    });
    return status(name, targetId);
  }

  function setActiveAccount(environment = 'production', accountId = '') {
    const name = environmentName(environment);
    const current = environmentRecord(name);
    const targetId = resolveAccountId(current, accountId, true);
    writeEnvironment(name, { ...current, activeAccountId: targetId, updatedAt: new Date().toISOString() });
    return status(name, targetId);
  }

  function removeAccount(environment = 'production', accountId = '') {
    const name = environmentName(environment);
    const current = environmentRecord(name);
    const targetId = resolveAccountId(current, accountId, true);
    const removed = current.accounts[targetId];
    const accounts = { ...current.accounts };
    delete accounts[targetId];
    const activeAccountId = current.activeAccountId === targetId
      ? Object.keys(accounts)[0] || ''
      : current.activeAccountId;
    const account = {
      id: targetId,
      label: removed.shopName || removed.label || removed.openId || targetId,
      shopId: removed.shopId || '',
      shopName: removed.shopName || '',
      shopCode: removed.shopCode || ''
    };
    writeEnvironment(name, { ...current, accounts, activeAccountId, updatedAt: new Date().toISOString() });
    return {
      account,
      status: status(name)
    };
  }

  function beginAuthorization(environment = 'production', options = {}) {
    const name = environmentName(environment);
    const current = environmentRecord(name);
    if (!current.appKey || !current.appSecret || !current.serviceId) throw new Error('Save the TikTok Shop app key, app secret, and Service ID first.');
    const sessionToken = clean(options.sessionToken, 8192);
    if (!sessionToken) throw new Error('Sign in to DataPlus again before connecting TikTok Shop.');
    const accountId = clean(options.accountId, 256);
    if (accountId && !current.accounts?.[accountId]) throw new Error('Choose an existing TikTok seller account or add a new one.');
    const signedState = channelOAuthState.createState({
      provider: 'TikTok Shop',
      clientId: current.appKey,
      signingSecret: current.appSecret,
      redirectUri: current.serviceId,
      sessionToken,
      returnTo: safeReturnTo(options.returnTo),
      defaultReturnTo: '/channels?channel=TikTok%20Shop',
      data: {
        actorId: clean(options.actorId, 96),
        actorName: clean(options.actorName, 96),
        accountId
      }
    });
    const state = `${name}.${signedState}`;
    const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString();
    const pendingStates = (Array.isArray(current.oauthPendingStates) ? current.oauthPendingStates : [])
      .filter(entry => entry?.hash && Date.parse(entry.expiresAt || '') > Date.now())
      .concat({ hash: stateHashHex(state), expiresAt })
      .slice(-12);
    writeEnvironment(name, {
      ...current,
      oauthStateHash: '',
      oauthStateExpiresAt: expiresAt,
      oauthActorId: '',
      oauthActorName: '',
      oauthReturnTo: '',
      oauthStateMode: 'signed',
      oauthPendingStates: pendingStates,
      oauthStartedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    return { environment: name, accountId, state, returnTo: safeReturnTo(options.returnTo), expiresAt };
  }

  function consumeAuthorization(state, options = {}) {
    const token = clean(state, 2000);
    const separator = token.indexOf('.');
    const prefix = separator > 0 ? token.slice(0, separator) : '';
    if (!ENVIRONMENTS.has(prefix)) throw new Error('TikTok Shop authorization state is invalid or expired. Start the connection again.');
    const environment = environmentName(prefix);
    const current = environmentRecord(environment);
    const signedState = token.slice(separator + 1);
    if (signedState.startsWith('v2.')) {
      const result = channelOAuthState.validateState({
        provider: 'TikTok Shop',
        clientId: current.appKey,
        signingSecret: current.appSecret,
        redirectUri: current.serviceId,
        sessionToken: clean(options.sessionToken, 8192),
        state: signedState,
        ttlMs: OAUTH_STATE_TTL_MS,
        defaultReturnTo: '/channels?channel=TikTok%20Shop'
      });
      const hash = stateHashHex(token);
      const consumed = (Array.isArray(current.oauthConsumedStateHashes) ? current.oauthConsumedStateHashes : [])
        .filter(entry => entry?.hash && Date.parse(entry.expiresAt || '') > Date.now());
      if (consumed.some(entry => entry.hash === hash)) throw new Error('TikTok Shop authorization state is invalid or expired. Start the connection again.');
      const pending = (Array.isArray(current.oauthPendingStates) ? current.oauthPendingStates : [])
        .filter(entry => entry?.hash && entry.hash !== hash && Date.parse(entry.expiresAt || '') > Date.now());
      consumed.push({ hash, expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString() });
      writeEnvironment(environment, {
        ...current,
        oauthStateMode: pending.length ? 'signed' : '',
        oauthStateExpiresAt: pending.reduce((latest, entry) => Date.parse(entry.expiresAt || '') > Date.parse(latest || '') ? entry.expiresAt : latest, ''),
        oauthPendingStates: pending,
        oauthConsumedStateHashes: consumed.slice(-24),
        updatedAt: new Date().toISOString()
      });
      return {
        environment,
        accountId: clean(result.data.accountId, 256),
        actorId: clean(result.data.actorId, 96),
        actorName: clean(result.data.actorName, 96),
        returnTo: safeReturnTo(result.returnTo),
        credentials: current
      };
    }

    const expectedHex = clean(current.oauthStateHash, 128);
    const expiresAt = Date.parse(current.oauthStateExpiresAt || '');
    const received = stateHash(token);
    const expected = /^[a-f0-9]{64}$/i.test(expectedHex) ? Buffer.from(expectedHex, 'hex') : Buffer.alloc(0);
    if (!expected.length || expected.length !== received.length || !crypto.timingSafeEqual(expected, received) || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw new Error('TikTok Shop authorization state is invalid or expired. Start the connection again.');
    }
    writeEnvironment(environment, {
      ...current,
      oauthStateHash: '',
      oauthStateExpiresAt: '',
      oauthActorId: '',
      oauthActorName: '',
      oauthReturnTo: '',
      oauthStateMode: '',
      updatedAt: new Date().toISOString()
    });
    return {
      environment,
      accountId: clean(current.activeAccountId, 256),
      actorId: clean(current.oauthActorId, 256),
      actorName: clean(current.oauthActorName, 256),
      returnTo: safeReturnTo(current.oauthReturnTo),
      credentials: current
    };
  }

  function fingerprint(environment = 'production', accountId = '') {
    const value = get(environment, accountId);
    return crypto.createHash('sha256').update(JSON.stringify([
      environmentName(environment), value.accountId, value.appKey, value.appSecret, value.serviceId, value.shopCipher, value.shopId
    ])).digest('hex');
  }

  return {
    get, status, accounts: accountSummaries, save, updateTokens, selectShop, setActiveAccount, removeAccount, beginAuthorization, consumeAuthorization, fingerprint,
    creators: creatorSummaries, getCreator, updateCreatorTokens, updateCreatorProfile, removeCreator,
    beginCreatorAuthorization, consumeCreatorAuthorization, creatorFingerprint
  };
}

module.exports = { createTikTokCredentials };
