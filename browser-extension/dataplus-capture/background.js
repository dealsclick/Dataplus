const DEFAULT_BASE_URL = "https://dataplusapp.duckdns.org";

function normalizeBaseUrl(value) {
  const fallback = DEFAULT_BASE_URL;
  try {
    const url = new URL(String(value || fallback).trim());
    if (!['http:', 'https:'].includes(url.protocol)) return fallback;
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return fallback;
  }
}

async function settings() {
  const saved = await chrome.storage.local.get(['baseUrl', 'extensionToken', 'extensionExpiresAt']);
  return {
    baseUrl: normalizeBaseUrl(saved.baseUrl),
    extensionToken: String(saved.extensionToken || ''),
    extensionExpiresAt: String(saved.extensionExpiresAt || '')
  };
}

async function apiRequest(path, options = {}) {
  const current = await settings();
  if (!current.extensionToken) throw new Error('Connect the extension to DataPlus first.');
  const response = await fetch(`${current.baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${current.extensionToken}`,
      'X-DataPlus-Client': 'chrome-extension'
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || payload.message || `DataPlus request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function connect() {
  const current = await settings();
  const cookie = await chrome.cookies.get({ url: current.baseUrl, name: 'dataplus_session' });
  if (!cookie?.value) throw new Error('Sign in to DataPlus in this Chrome profile, then connect again.');
  const response = await fetch(`${current.baseUrl}/api/auth/extension/connect`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cookie.value}`,
      'X-DataPlus-Client': 'chrome-extension'
    },
    body: '{}'
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.token) throw new Error(payload.error || 'DataPlus could not connect the extension.');
  await chrome.storage.local.set({ extensionToken: payload.token, extensionExpiresAt: payload.expiresAt || '' });
  return { ...payload, token: undefined };
}

async function disconnect() {
  const current = await settings();
  if (current.extensionToken) {
    try { await apiRequest('/api/auth/extension/disconnect', { method: 'POST', body: {} }); } catch { /* Local disconnect still succeeds. */ }
  }
  await chrome.storage.local.remove(['extensionToken', 'extensionExpiresAt']);
  return { disconnected: true };
}

async function connectionStatus() {
  const current = await settings();
  if (!current.extensionToken) return { connected: false, baseUrl: current.baseUrl };
  try {
    const session = await apiRequest('/api/auth/session');
    return { connected: session.authenticated === true, baseUrl: current.baseUrl, expiresAt: current.extensionExpiresAt, user: session.user || null };
  } catch (error) {
    if (error.status === 401) await chrome.storage.local.remove(['extensionToken', 'extensionExpiresAt']);
    return { connected: false, baseUrl: current.baseUrl, error: error.message };
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const run = async () => {
    if (message?.type === 'dataplus:settings') {
      if (message.baseUrl !== undefined) {
        await chrome.storage.local.set({ baseUrl: normalizeBaseUrl(message.baseUrl) });
        await chrome.storage.local.remove(['extensionToken', 'extensionExpiresAt']);
      }
      return settings();
    }
    if (message?.type === 'dataplus:connect') return connect();
    if (message?.type === 'dataplus:disconnect') return disconnect();
    if (message?.type === 'dataplus:connection-status') return connectionStatus();
    if (message?.type === 'dataplus:api') return apiRequest(String(message.path || ''), message.options || {});
    if (message?.type === 'dataplus:open-tab') {
      const current = await settings();
      const rawPath = String(message.path || '/');
      const target = rawPath.startsWith('http') ? rawPath : `${current.baseUrl}${rawPath.startsWith('/') ? rawPath : `/${rawPath}`}`;
      await chrome.tabs.create({ url: target });
      return { opened: true };
    }
    throw new Error('Unsupported extension request.');
  };
  run().then((result) => sendResponse({ ok: true, result })).catch((error) => sendResponse({ ok: false, error: error.message || 'Extension request failed.' }));
  return true;
});
