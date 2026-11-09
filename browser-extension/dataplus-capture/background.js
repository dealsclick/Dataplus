const DEFAULT_BASE_URL = "https://dataplusapp.duckdns.org";
const COMPETITOR_HOSTS = new Map([
  ['homedepot.com', 'home-depot'],
  ['globalindustrial.com', 'global-industrial'],
  ['zoro.com', 'zoro']
]);

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

function competitorHostKey(hostname) {
  return COMPETITOR_HOSTS.get(String(hostname || '').toLowerCase().replace(/^www\./, '')) || '';
}

function sanitizeResearchContext(value) {
  if (!value || typeof value !== 'object') throw new Error('DataPlus did not provide valid competitor research details.');
  const product = value.product && typeof value.product === 'object' ? value.product : {};
  const target = value.target && typeof value.target === 'object' ? value.target : {};
  const scope = value.scope && typeof value.scope === 'object' ? value.scope : {};
  const sku = String(product.sku || '').trim().slice(0, 160);
  if (!sku) throw new Error('The DataPlus SKU is required before searching a competitor.');
  let searchUrl;
  try { searchUrl = new URL(String(target.searchUrl || '')); } catch { throw new Error('The competitor search URL is invalid.'); }
  const competitorKey = competitorHostKey(searchUrl.hostname);
  if (!competitorKey || !['http:', 'https:'].includes(searchUrl.protocol)) throw new Error('Choose a supported competitor website.');
  return {
    version: 1,
    scope: {
      tenantId: String(scope.tenantId || '').trim().slice(0, 200),
      companyId: String(scope.companyId || '').trim().slice(0, 200)
    },
    product: {
      productId: String(product.productId || '').trim().slice(0, 200),
      sku,
      sourceSku: String(product.sourceSku || '').trim().slice(0, 160),
      title: String(product.title || '').trim().slice(0, 500),
      brand: String(product.brand || '').trim().slice(0, 240),
      manufacturer: String(product.manufacturer || '').trim().slice(0, 240),
      mfrPartNumber: String(product.mfrPartNumber || '').trim().slice(0, 160),
      barcode: String(product.barcode || '').replace(/\D/g, '').slice(0, 14),
      defaultImage: String(product.defaultImage || '').trim().slice(0, 2000)
    },
    target: {
      key: competitorKey,
      name: String(target.name || competitorKey).trim().slice(0, 160),
      query: String(target.query || '').trim().slice(0, 200),
      identifierType: String(target.identifierType || 'SKU').trim().slice(0, 120),
      searchUrl: searchUrl.toString()
    },
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  };
}

async function setCompetitorContext(value) {
  const context = sanitizeResearchContext(value);
  if (!context.scope.tenantId || !context.scope.companyId) throw new Error('The active DataPlus company could not be identified.');
  await apiRequest('/api/organization/select', { method: 'POST', body: context.scope });
  await chrome.storage.local.set({ competitorResearchContext: context });
  return context;
}

async function competitorContext() {
  const saved = await chrome.storage.local.get('competitorResearchContext');
  const context = saved.competitorResearchContext;
  if (!context || !context.expiresAt || Date.parse(context.expiresAt) <= Date.now()) {
    await chrome.storage.local.remove('competitorResearchContext');
    return null;
  }
  return context;
}

async function clearCompetitorContext() {
  await chrome.storage.local.remove('competitorResearchContext');
  return { cleared: true };
}

async function apiRequest(path, options = {}) {
  const current = await settings();
  if (!current.extensionToken) throw new Error('Connect the extension to DataPlus first.');
  const response = await fetch(`${current.baseUrl}${path}`, {
    method: options.method || 'GET',
    cache: 'no-store',
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

async function rfqStatus(reference) {
  const normalizedReference = String(reference || '').trim();
  const current = await settings();
  if (!normalizedReference) throw new Error('The RFQ reference could not be detected.');
  if (!current.extensionToken) return { connected: false, baseUrl: current.baseUrl, exists: false, draft: null, quoteUrl: '' };
  const status = await connectionStatus();
  if (!status.connected) return { connected: false, baseUrl: current.baseUrl, exists: false, draft: null, quoteUrl: '' };
  const payload = await apiRequest('/api/order-drafts/import-matches', {
    method: 'POST',
    body: { source: 'BuySupply DW RFQ', references: [normalizedReference] }
  });
  const draft = payload?.matches?.[0]?.draft || null;
  const quoteUrl = draft?.id ? `${current.baseUrl}/drafts/${encodeURIComponent(String(draft.id))}` : '';
  return {
    connected: true,
    baseUrl: current.baseUrl,
    exists: Boolean(draft),
    draft: draft ? { id: draft.id, draftNumber: draft.draftNumber || '', status: draft.status || 'draft' } : null,
    quoteUrl
  };
}

async function rfqStatuses(references) {
  const normalizedReferences = [...new Set((Array.isArray(references) ? references : [])
    .map((value) => String(value || '').trim()).filter(Boolean))].slice(0, 100);
  const current = await settings();
  if (!normalizedReferences.length) throw new Error('No RFQ references were detected on this page.');
  if (!current.extensionToken) return { connected: false, baseUrl: current.baseUrl, matches: [] };
  const status = await connectionStatus();
  if (!status.connected) return { connected: false, baseUrl: current.baseUrl, matches: [] };
  const payload = await apiRequest('/api/order-drafts/import-matches', {
    method: 'POST',
    body: { source: 'BuySupply DW RFQ', references: normalizedReferences }
  });
  return {
    connected: true,
    baseUrl: current.baseUrl,
    matches: (Array.isArray(payload?.matches) ? payload.matches : []).map((match) => {
      const draft = match?.draft || null;
      return {
        reference: String(match?.reference || ''),
        exists: Boolean(draft),
        draft: draft ? { id: draft.id, draftNumber: draft.draftNumber || '', status: draft.status || 'draft' } : null,
        quoteUrl: draft?.id ? `${current.baseUrl}/drafts/${encodeURIComponent(String(draft.id))}` : ''
      };
    })
  };
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
    if (message?.type === 'dataplus:rfq-status') return rfqStatus(message.reference);
    if (message?.type === 'dataplus:rfq-statuses') return rfqStatuses(message.references);
    if (message?.type === 'dataplus:set-competitor-context') return setCompetitorContext(message.context);
    if (message?.type === 'dataplus:competitor-context') return competitorContext();
    if (message?.type === 'dataplus:clear-competitor-context') return clearCompetitorContext();
    if (message?.type === 'dataplus:open-sidepanel') {
      if (!sender.tab?.id) throw new Error('Open DataPlus Capture from a website tab.');
      await chrome.sidePanel.open({ tabId: sender.tab.id });
      return { opened: true };
    }
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
