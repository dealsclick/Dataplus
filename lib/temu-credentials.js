const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { encryptionKey, seal, unseal } = require('./encrypted-credentials');

const clean = (value, limit = 8192) => String(value ?? '').trim().slice(0, limit);

function createTemuCredentials({ directory, env = process.env }) {
  const file = path.join(directory, 'temu-runtime-credentials.json');

  function readStore() {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return parsed?.sealed ? unseal(parsed.sealed, env) : {};
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw new Error('Temu account credential storage could not be read.');
    }
  }

  function accountRecord(id, value = {}) {
    return {
      id,
      label: clean(value.label || value.mallName || value.mallId || id, 256),
      accessToken: clean(value.accessToken),
      refreshToken: clean(value.refreshToken),
      accessTokenExpiresAt: clean(value.accessTokenExpiresAt, 64),
      mallId: clean(value.mallId, 256),
      mallName: clean(value.mallName, 256),
      apiScopeList: Array.isArray(value.apiScopeList) ? value.apiScopeList.map(scope => clean(scope, 256)).filter(Boolean) : [],
      createdAt: clean(value.createdAt, 64) || new Date().toISOString(),
      updatedAt: clean(value.updatedAt, 64) || new Date().toISOString()
    };
  }

  function legacyAccount(legacy = {}) {
    const accessToken = clean(legacy.accessToken);
    if (!accessToken) return null;
    const mallId = clean(legacy.mallId, 256);
    const id = mallId || `legacy-${crypto.createHash('sha256').update(accessToken).digest('hex').slice(0, 12)}`;
    return accountRecord(id, { ...legacy, mallId, label: legacy.mallName || mallId || 'Legacy Temu shop' });
  }

  function state(legacy = {}) {
    const stored = readStore();
    const accounts = {};
    for (const [rawId, value] of Object.entries(stored.accounts || {})) {
      const id = clean(rawId || value?.id, 256);
      if (id) accounts[id] = accountRecord(id, value);
    }
    const fallback = legacyAccount(legacy);
    if (fallback && !accounts[fallback.id]) accounts[fallback.id] = fallback;
    const requested = clean(stored.activeAccountId, 256);
    return {
      accounts,
      activeAccountId: accounts[requested] ? requested : Object.keys(accounts)[0] || '',
      updatedAt: clean(stored.updatedAt, 64)
    };
  }

  function writeState(value) {
    if (!encryptionKey(env)) throw new Error('Set DATAPLUS_CREDENTIALS_ENCRYPTION_KEY before connecting Temu shops.');
    fs.mkdirSync(directory, { recursive: true });
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    const payload = { version: 1, ...value, updatedAt: new Date().toISOString() };
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, sealed: seal(payload, env), updatedAt: payload.updatedAt }), { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, file);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  function get(accountId = '', legacy = {}) {
    const current = state(legacy);
    const requested = clean(accountId, 256);
    const id = requested && current.accounts[requested] ? requested : current.activeAccountId;
    return { ...(id ? current.accounts[id] : {}), accountId: id, activeAccountId: current.activeAccountId };
  }

  function summaries(legacy = {}) {
    const current = state(legacy);
    return Object.values(current.accounts).map(account => ({
      id: account.id,
      label: account.mallName || account.label || account.mallId || account.id,
      mallId: account.mallId || '',
      mallName: account.mallName || '',
      configured: Boolean(account.accessToken),
      accessTokenExpiresAt: account.accessTokenExpiresAt || '',
      apiScopeList: account.apiScopeList || [],
      active: account.id === current.activeAccountId,
      updatedAt: account.updatedAt || ''
    }));
  }

  function status(legacy = {}) {
    const current = state(legacy);
    const active = current.activeAccountId ? current.accounts[current.activeAccountId] : {};
    return {
      encryptedStorageReady: Boolean(encryptionKey(env)),
      activeAccountId: current.activeAccountId,
      configured: Boolean(active?.accessToken),
      mallId: active?.mallId || '',
      mallName: active?.mallName || '',
      accessTokenExpiresAt: active?.accessTokenExpiresAt || '',
      accounts: summaries(legacy)
    };
  }

  function tokenExpiry(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return '';
    return new Date(numeric > 10_000_000_000 ? numeric : numeric > Date.now() / 1000 ? numeric * 1000 : Date.now() + numeric * 1000).toISOString();
  }

  function updateTokens(token = {}, requestedAccountId = '', legacy = {}) {
    const current = state(legacy);
    const mallId = clean(token.mall_id || token.mallId || token.mallIdList?.[0], 256);
    const requested = clean(requestedAccountId, 256);
    const existingRequested = requested ? current.accounts[requested] : null;
    if (existingRequested?.mallId && mallId && existingRequested.mallId !== mallId) {
      throw new Error('Temu authorized a different shop. Add it as a new shop instead of reconnecting the selected shop.');
    }
    const targetId = requested || mallId || crypto.randomUUID();
    const existing = current.accounts[targetId] || {};
    const accessToken = clean(token.access_token || token.accessToken || token.token || existing.accessToken);
    if (!accessToken) throw new Error('Temu token exchange did not return an access token.');
    const account = accountRecord(targetId, {
      ...existing,
      accessToken,
      refreshToken: clean(token.refresh_token || token.refreshToken || existing.refreshToken),
      accessTokenExpiresAt: tokenExpiry(token.expiredTime || token.expires_in) || clean(existing.accessTokenExpiresAt, 64),
      mallId: mallId || existing.mallId,
      mallName: clean(token.mall_name || token.mallName || existing.mallName, 256),
      apiScopeList: Array.isArray(token.apiScopeList) ? token.apiScopeList : existing.apiScopeList || [],
      updatedAt: new Date().toISOString()
    });
    writeState({ ...current, accounts: { ...current.accounts, [targetId]: account }, activeAccountId: targetId });
    return get(targetId);
  }

  function setActiveAccount(accountId = '', legacy = {}) {
    const current = state(legacy);
    const id = clean(accountId, 256);
    if (!id || !current.accounts[id]) throw new Error('Choose a connected Temu shop.');
    writeState({ ...current, activeAccountId: id });
    return status(legacy);
  }

  function removeAccount(accountId = '', legacy = {}) {
    const current = state(legacy);
    const id = clean(accountId, 256);
    if (!id || !current.accounts[id]) throw new Error('Choose a connected Temu shop to disconnect.');
    const removed = current.accounts[id];
    const accounts = { ...current.accounts };
    delete accounts[id];
    const activeAccountId = current.activeAccountId === id
      ? Object.keys(accounts)[0] || ''
      : current.activeAccountId;
    writeState({ ...current, accounts, activeAccountId });
    return {
      ...status(),
      removed: {
        id: removed.id,
        label: removed.mallName || removed.label || removed.mallId || removed.id,
        mallId: removed.mallId || ''
      }
    };
  }

  function fingerprint(accountId = '', legacy = {}) {
    const value = get(accountId, legacy);
    return crypto.createHash('sha256').update(JSON.stringify([value.accountId, value.mallId, value.accessToken])).digest('hex');
  }

  return { get, status, accounts: summaries, updateTokens, setActiveAccount, removeAccount, fingerprint };
}

module.exports = { createTemuCredentials };
