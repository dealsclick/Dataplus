const state = {
  connected: false,
  baseUrl: '',
  organization: null,
  quotes: [],
  selectedQuoteId: '',
  capture: null,
  existingRfqQuote: null,
  matches: [],
  selectedMatchKey: '',
  activeHost: '',
  busy: false
};

const byId = (id) => document.getElementById(id);

function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = String(text);
  return node;
}

function money(value, currency = 'USD') {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(number); }
  catch { return `$${number.toFixed(2)}`; }
}

function dateLabel(value) {
  const date = new Date(value || 0);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
}

function setNotice(message = '', type = '') {
  const notice = byId('notice');
  notice.hidden = !message;
  notice.className = `notice${type ? ` ${type}` : ''}`;
  notice.textContent = message;
}

function setBusy(value) {
  state.busy = Boolean(value);
  for (const button of document.querySelectorAll('button')) button.disabled = state.busy;
  if (!state.busy) {
    renderContext();
    renderQuotes();
    renderCapture();
  }
}

function runtimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response?.ok) return reject(new Error(response?.error || 'Extension request failed.'));
      resolve(response.result);
    });
  });
}

function api(path, options = {}) {
  return runtimeMessage({ type: 'dataplus:api', path, options });
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('Open a website tab and try again.');
  return tab;
}

async function savedTemplates() {
  const saved = await chrome.storage.local.get('siteTemplates');
  return saved.siteTemplates && typeof saved.siteTemplates === 'object' ? saved.siteTemplates : {};
}

async function extractCurrentPage() {
  const tab = await activeTab();
  const url = new URL(tab.url || 'https://invalid.local');
  const templates = await savedTemplates();
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tab.id, { type: 'dataplus:extract-page', template: templates[url.hostname] || {} }, (response) => {
      if (chrome.runtime.lastError) return reject(new Error('This page cannot be scanned. Open a normal website page and try again.'));
      if (!response?.ok) return reject(new Error(response?.error || 'The page could not be scanned.'));
      resolve(response.result);
    });
  });
}

function currentCompany() {
  const directory = state.organization || {};
  const selection = directory.selection || {};
  const companies = Array.isArray(directory.companies) ? directory.companies : [];
  return companies.find((company) => String(company.id) === String(selection.companyId) && String(company.tenant_id || company.tenantId) === String(selection.tenantId))
    || companies.find((company) => String(company.mode || '').toLowerCase() === 'legacy')
    || companies[0]
    || null;
}

function quoteTotal(quote) {
  return (Array.isArray(quote.items) ? quote.items : []).reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.price || 0), 0) + Number(quote.shippingEstimate?.amount || 0);
}

function quoteLabel(quote) {
  return `${quote.draftNumber || 'Draft'} · ${quote.buyer || 'Customer'} · ${money(quoteTotal(quote))}`;
}

function quoteUrl(id) {
  if (!id) return '';
  return `${String(state.baseUrl || 'https://dataplusapp.duckdns.org').replace(/\/$/, '')}/drafts/${encodeURIComponent(String(id))}`;
}

function renderContext() {
  const companySelect = byId('company-select');
  companySelect.replaceChildren();
  const directory = state.organization || {};
  const selectedCompany = currentCompany();
  for (const company of Array.isArray(directory.companies) ? directory.companies : []) {
    const option = element('option');
    const tenantId = company.tenant_id || company.tenantId || '';
    option.value = `${tenantId}::${company.id}`;
    option.textContent = company.name || company.id;
    option.selected = String(company.id) === String(selectedCompany?.id);
    companySelect.append(option);
  }

  const quoteSelect = byId('quote-select');
  quoteSelect.replaceChildren();
  const empty = element('option', '', state.quotes.length ? 'Choose a quote' : 'No active quotes');
  empty.value = '';
  quoteSelect.append(empty);
  for (const quote of state.quotes) {
    const option = element('option');
    option.value = String(quote.id || '');
    option.textContent = quoteLabel(quote);
    option.selected = option.value === state.selectedQuoteId;
    quoteSelect.append(option);
  }
  byId('open-quote-button').disabled = !state.selectedQuoteId || state.busy;
}

function renderQuotes() {
  const list = byId('quote-list');
  list.replaceChildren();
  if (!state.quotes.length) {
    list.className = 'quote-list empty-state';
    list.textContent = 'No active quotes are available for this company.';
    return;
  }
  list.className = 'quote-list';
  for (const quote of state.quotes) {
    const button = element('button', `quote-row${String(quote.id) === state.selectedQuoteId ? ' selected' : ''}`);
    button.type = 'button';
    button.dataset.quoteId = String(quote.id || '');
    button.append(element('strong', '', `${quote.draftNumber || 'Draft'} · ${quote.buyer || 'Customer'}`));
    const meta = element('div', 'quote-meta');
    meta.append(element('span', '', String(quote.status || 'draft').replaceAll('_', ' ')));
    meta.append(element('span', '', `${Array.isArray(quote.items) ? quote.items.length : 0} lines`));
    meta.append(element('span', '', money(quoteTotal(quote))));
    if (quote.expiresAt) meta.append(element('span', '', `Valid to ${dateLabel(quote.expiresAt)}`));
    button.append(meta);
    button.addEventListener('click', async () => {
      state.selectedQuoteId = String(quote.id || '');
      await chrome.storage.local.set({ selectedQuoteId: state.selectedQuoteId });
      renderContext();
      renderQuotes();
      setNotice(`${quote.draftNumber || 'Quote'} is now open in the extension.`, 'success');
    });
    list.append(button);
  }
}

async function loadQuotes() {
  const payload = await api('/api/order-drafts');
  const rows = Array.isArray(payload.orderDrafts) ? payload.orderDrafts : [];
  state.quotes = rows.filter((quote) => !quote.convertedOrderId && !['accepted', 'lost', 'converted'].includes(String(quote.status || '').toLowerCase()));
  const saved = await chrome.storage.local.get('selectedQuoteId');
  const requested = String(saved.selectedQuoteId || state.selectedQuoteId || '');
  state.selectedQuoteId = state.quotes.some((quote) => String(quote.id) === requested) ? requested : String(state.quotes[0]?.id || '');
  if (state.selectedQuoteId) await chrome.storage.local.set({ selectedQuoteId: state.selectedQuoteId });
  renderContext();
  renderQuotes();
}

async function loadWorkspace() {
  const [organization] = await Promise.all([api('/api/organization'), loadQuotes()]);
  state.organization = organization;
  renderContext();
}

async function findExistingRfqQuote(rfq) {
  const reference = String(rfq?.externalId || '').trim();
  if (!reference) return null;
  const query = new URLSearchParams({ source: 'BuySupply DW RFQ', reference });
  const payload = await api(`/api/order-drafts/import-match?${query.toString()}`);
  return payload?.draft || null;
}

function normalizedIdentifier(value) {
  return String(value || '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function matchBasis(product, candidate) {
  const gtin = String(product.gtin || '').replace(/\D/g, '').padStart(14, '0');
  const candidateGtin = String(candidate.barcode || candidate.upc || candidate.gtin || '').replace(/\D/g, '').padStart(14, '0');
  if (gtin && gtin !== '00000000000000' && gtin === candidateGtin) return 'UPC / GTIN';
  if (product.sku && [candidate.sku, candidate.vendorSku, candidate.sourceSku].some((value) => normalizedIdentifier(value) === normalizedIdentifier(product.sku))) return 'Page SKU';
  if (product.mpn && [candidate.mfrPartNumber, candidate.manufacturerPartNumber, candidate.mpn].some((value) => normalizedIdentifier(value) === normalizedIdentifier(product.mpn))) return 'Manufacturer part number';
  return 'Catalog suggestion';
}

async function findCatalogMatches(product) {
  const terms = [...new Set([product.gtin, product.sku, product.mpn, product.title].map((value) => String(value || '').trim()).filter(Boolean))].slice(0, 4);
  const pages = await Promise.all(terms.map((term) => api(`/api/inventory?q=${encodeURIComponent(term)}&limit=8&fastPage=1`).catch(() => ({ inventory: [] }))));
  const seen = new Set();
  const matches = [];
  for (const page of pages) {
    for (const candidate of Array.isArray(page.inventory) ? page.inventory : []) {
      const key = String(candidate.id || candidate.sku || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      matches.push({ ...candidate, matchBasis: matchBasis(product, candidate) });
    }
  }
  matches.sort((left, right) => Number(left.matchBasis === 'Catalog suggestion') - Number(right.matchBasis === 'Catalog suggestion') || String(left.sku || '').localeCompare(String(right.sku || '')));
  return matches.slice(0, 12);
}

function summaryItem(label, value) {
  const wrapper = element('div');
  wrapper.append(element('span', '', label));
  wrapper.append(element('strong', '', value || '-'));
  return wrapper;
}

function renderRfq(rfq) {
  const root = byId('capture-result');
  root.className = 'capture-result';
  const header = element('div', 'result-title');
  header.append(element('h2', '', rfq.externalId || 'Website RFQ'));
  header.append(element('p', '', `${rfq.company || rfq.buyer || 'Customer'} · ${rfq.status || 'pending'}`));
  root.append(header);

  const summary = element('div', 'summary-strip');
  summary.append(summaryItem('Email', rfq.email || 'Not supplied'));
  summary.append(summaryItem('Phone', rfq.phone || 'Not supplied'));
  summary.append(summaryItem('Ship to', [rfq.shippingAddress?.city, rfq.shippingAddress?.state, rfq.shippingAddress?.postalCode].filter(Boolean).join(', ')));
  summary.append(summaryItem('Requested total', money(rfq.total)));
  root.append(summary);

  root.append(element('h3', 'subheading', `${rfq.items.length} requested line${rfq.items.length === 1 ? '' : 's'}`));
  const lines = element('div', 'line-list');
  for (const item of rfq.items.slice(0, 100)) {
    const row = element('div', 'line-row');
    const copy = element('div');
    copy.append(element('strong', '', item.title || item.sku));
    copy.append(element('span', '', `${item.sourceSku}${item.matchedSku ? ` → ${item.matchedSku}` : ''}`));
    row.append(copy, element('strong', '', `${item.qty} × ${money(item.price)}`));
    lines.append(row);
  }
  root.append(lines);

  const existing = state.existingRfqQuote;
  const actions = element('div', 'action-stack');
  if (existing) {
    actions.append(element(
      'div',
      'inline-message success',
      `${existing.draftNumber || 'This quote'} already exists in DataPlus with status ${String(existing.status || 'draft').replaceAll('_', ' ')}. A duplicate will not be created.`
    ));
    const url = quoteUrl(existing.id);
    const link = element('a', 'quote-url-link', url);
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = 'Open quote in DataPlus';
    actions.append(link);
  }
  const button = element('button', existing ? 'secondary-button' : 'primary-button', existing ? `Open ${existing.draftNumber || 'existing draft'}` : 'Import as draft quote');
  button.type = 'button';
  button.addEventListener('click', () => existing ? openQuote(existing.id) : importRfq(rfq));
  actions.append(button);
  root.append(actions);
}

function renderProduct(product) {
  const root = byId('capture-result');
  root.className = 'capture-result';
  const header = element('div', 'result-header');
  if (product.imageUrl) {
    const image = element('img', 'result-image');
    image.src = product.imageUrl;
    image.alt = '';
    image.referrerPolicy = 'no-referrer';
    header.append(image);
  }
  const copy = element('div', 'result-title');
  copy.append(element('h2', '', product.title || 'Product title not found'));
  copy.append(element('p', '', product.sourceHost || product.sourceUrl));
  header.append(copy);
  root.append(header);

  const summary = element('div', 'summary-strip');
  summary.append(summaryItem('Page SKU', product.sku || 'Not found'));
  summary.append(summaryItem('UPC / GTIN', product.gtin || 'Not found'));
  summary.append(summaryItem('MPN', product.mpn || 'Not found'));
  summary.append(summaryItem('Observed price', product.competitorPrice === null ? 'Not found' : money(product.competitorPrice, product.currency)));
  root.append(summary);

  root.append(element('h3', 'subheading', state.matches.length ? 'DataPlus catalog matches' : 'No catalog match found'));
  if (state.matches.length) {
    const matches = element('div', 'match-list');
    for (const match of state.matches) {
      const key = String(match.id || match.sku || '');
      const button = element('button', `match-row${key === state.selectedMatchKey ? ' selected' : ''}`);
      button.type = 'button';
      button.append(element('strong', '', `${match.sku || 'SKU'} · ${match.title || 'Catalog product'}`));
      const meta = element('div', 'match-meta');
      meta.append(element('span', '', match.matchBasis));
      if (match.price !== null && match.price !== undefined) meta.append(element('span', '', money(match.price)));
      if (match.brand) meta.append(element('span', '', match.brand));
      button.append(meta);
      button.addEventListener('click', () => { state.selectedMatchKey = key; renderCapture(); });
      matches.append(button);
    }
    root.append(matches);
  } else {
    root.append(element('div', 'inline-message', 'DataPlus can create a provisional draft SKU from this page. A future exact supplier import can replace that provisional identity while preserving the competitor observation.'));
  }

  const actions = element('div', 'action-stack');
  const selected = state.matches.find((match) => String(match.id || match.sku || '') === state.selectedMatchKey);
  const addLabel = selected ? 'Add matched product to open quote' : state.matches.length ? 'Select a catalog product' : 'Create draft SKU and add to quote';
  const add = element('button', 'primary-button', addLabel);
  add.type = 'button';
  add.disabled = !state.selectedQuoteId || (state.matches.length > 0 && !selected);
  add.addEventListener('click', () => selected ? addProductToQuote(product, selected) : state.matches.length ? undefined : createProductAndAdd(product));
  actions.append(add);
  if (!state.selectedQuoteId) actions.append(element('div', 'inline-message', 'Open a quote above before adding this product.'));
  root.append(actions);
}

function renderCapture() {
  const root = byId('capture-result');
  root.replaceChildren();
  if (!state.capture) {
    root.className = 'capture-result empty-state';
    root.textContent = 'BuySupply RFQs are checked automatically. Use Rescan for product pages or to refresh the current result.';
    return;
  }
  if (state.capture.kind === 'rfq') renderRfq(state.capture);
  else renderProduct(state.capture);
}

async function scanPage({ automatic = false } = {}) {
  if (automatic && (!state.connected || state.busy)) return;
  setBusy(true);
  setNotice(automatic ? 'Checking this RFQ in DataPlus...' : 'Scanning the current page...');
  try {
    const capture = await extractCurrentPage();
    state.capture = capture;
    state.activeHost = capture.sourceHost || '';
    state.existingRfqQuote = capture.kind === 'rfq' ? await findExistingRfqQuote(capture) : null;
    state.matches = capture.kind === 'product' ? await findCatalogMatches(capture) : [];
    const exact = state.matches.find((match) => match.matchBasis !== 'Catalog suggestion');
    state.selectedMatchKey = String(exact?.id || exact?.sku || '');
    byId('page-host').textContent = capture.sourceHost || capture.sourceUrl || 'Current page';
    byId('template-host').textContent = state.activeHost || 'Scan a product page first.';
    await loadTemplateFields();
    renderCapture();
    setNotice(capture.kind === 'rfq'
      ? state.existingRfqQuote
        ? `${state.existingRfqQuote.draftNumber || 'A quote'} already exists for ${capture.externalId || 'this RFQ'}.`
        : `${capture.externalId || 'RFQ'} is ready to import.`
      : `${state.matches.length} catalog match${state.matches.length === 1 ? '' : 'es'} found.`, 'success');
  } catch (error) {
    setNotice(error.message || 'The current page could not be scanned.', 'error');
  } finally { setBusy(false); renderContext(); }
}

async function importRfq(rfq) {
  if (!rfq.items.length) return setNotice('This RFQ does not contain importable line items.', 'error');
  setBusy(true);
  try {
    await requireConnectedSession();
    const existing = await findExistingRfqQuote(rfq);
    if (existing) {
      state.existingRfqQuote = existing;
      renderCapture();
      setNotice(`${existing.draftNumber || 'This quote'} already exists. Open it instead of importing another copy.`, 'success');
      await refreshActivePageBadge();
      return;
    }
    const payload = await api('/api/order-drafts', {
      method: 'POST',
      body: {
        source: 'BuySupply DW RFQ',
        buyer: rfq.buyer || rfq.company || rfq.email || 'Website RFQ customer',
        buyerEmail: rfq.email || '',
        phone: rfq.phone || '',
        marketplaceOrderNumber: rfq.externalId || '',
        note: `Imported from BuySupply Data Warehouse RFQ ${rfq.externalId || ''}. Source: ${rfq.sourceUrl}`,
        customerNote: '',
        shippingAddress: rfq.shippingAddress || {},
        billingAddress: {},
        items: rfq.items.map((item) => ({
          sku: item.sku,
          title: item.title,
          qty: item.qty,
          price: item.price,
          priceOverridden: item.price > 0,
          note: item.matchedSku && item.sourceSku !== item.matchedSku ? `Customer requested ${item.sourceSku}.` : ''
        }))
      }
    });
    await loadQuotes();
    state.selectedQuoteId = String(payload.draft?.id || state.selectedQuoteId);
    await chrome.storage.local.set({ selectedQuoteId: state.selectedQuoteId });
    state.existingRfqQuote = payload.draft || null;
    renderContext();
    renderQuotes();
    renderCapture();
    await refreshActivePageBadge();
    setNotice(payload.duplicate
      ? `${payload.draft?.draftNumber || 'Draft quote'} already exists and was opened without creating a duplicate.`
      : `${payload.draft?.draftNumber || 'Draft quote'} was imported and opened.`, 'success');
  } catch (error) { setNotice(error.message || 'The RFQ could not be imported.', 'error'); }
  finally { setBusy(false); renderContext(); }
}

async function addProductToQuote(product, match) {
  if (!state.selectedQuoteId) return setNotice('Open a quote before adding the product.', 'error');
  setBusy(true);
  try {
    const detail = await api(`/api/order-drafts/${encodeURIComponent(state.selectedQuoteId)}`);
    const draft = detail.draft;
    if (!draft) throw new Error('The selected quote is no longer available.');
    const items = Array.isArray(draft.items) ? draft.items.map((item) => ({ ...item })) : [];
    const sku = String(match.sku || '').trim();
    if (!sku) throw new Error('The selected catalog product does not have a SKU.');
    const observedAt = new Date().toISOString();
    const evidence = {
      sourceUrl: product.sourceUrl || '',
      sourceHost: product.sourceHost || '',
      sourcePageSku: product.sku || '',
      competitorPrice: product.competitorPrice,
      competitorCurrency: product.currency || 'USD',
      competitorObservedAt: observedAt,
      catalogMatchBasis: match.matchBasis || 'Catalog selection',
      note: `Competitor product observed at ${product.sourceHost || product.sourceUrl}.`
    };
    const existing = items.find((item) => String(item.sku || '').toLowerCase() === sku.toLowerCase());
    if (existing) Object.assign(existing, evidence, { qty: Number(existing.qty || 1) + 1 });
    else items.push({
      id: crypto.randomUUID?.() || `${Date.now()}`,
      sku,
      title: match.title || product.title || sku,
      qty: 1,
      price: Number(match.price ?? match.websitePrice ?? product.competitorPrice ?? 0),
      priceOverridden: false,
      msrp: Number(match.msrp || match.listPrice || 0),
      listPrice: Number(match.listPrice || match.msrp || 0),
      mapPrice: Number(match.mapPrice || 0),
      ...evidence
    });
    const result = await api(`/api/order-drafts/${encodeURIComponent(state.selectedQuoteId)}`, { method: 'PATCH', body: { items } });
    await loadQuotes();
    setNotice(`${sku} was added to ${result.draft?.draftNumber || 'the quote'}.`, 'success');
  } catch (error) { setNotice(error.message || 'The product could not be added to the quote.', 'error'); }
  finally { setBusy(false); renderContext(); }
}

async function createProductAndAdd(product) {
  if (!state.selectedQuoteId) return setNotice('Open a quote before creating the draft SKU.', 'error');
  setBusy(true);
  try {
    const base = `/api/order-drafts/${encodeURIComponent(state.selectedQuoteId)}/competitor-product`;
    const inspection = await api(`${base}/inspect`, { method: 'POST', body: { url: product.sourceUrl, extractedProduct: product } });
    if (Array.isArray(inspection.matches) && inspection.matches.length) {
      state.matches = inspection.matches;
      state.selectedMatchKey = '';
      renderCapture();
      throw new Error('DataPlus found a catalog candidate. Review and add that match instead of creating a duplicate SKU.');
    }
    const created = await api(`${base}/create`, {
      method: 'POST',
      body: {
        inspectionId: inspection.inspectionId,
        confirmNoMatch: true,
        product: { title: product.title, brand: product.brand, gtin: product.gtin, mpn: product.mpn, description: product.description }
      }
    });
    await addProductToQuote(product, { ...created.product, matchBasis: 'Extension-created draft SKU', price: product.competitorPrice || 0 });
  } catch (error) { setNotice(error.message || 'The draft SKU could not be created.', 'error'); }
  finally { setBusy(false); renderContext(); }
}

async function openQuote(id = state.selectedQuoteId) {
  if (!id) return;
  await runtimeMessage({ type: 'dataplus:open-tab', path: `/drafts/${encodeURIComponent(id)}` });
}

async function refreshActivePageBadge() {
  try {
    const tab = await activeTab();
    await new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { type: 'dataplus:refresh-rfq-status' }, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    });
  } catch { /* RFQ page status will refresh the next time the page becomes active. */ }
}

async function loadTemplateFields() {
  const templates = await savedTemplates();
  const template = templates[state.activeHost] || {};
  for (const key of ['title', 'price', 'sku', 'gtin', 'mpn', 'brand', 'image']) byId(`selector-${key}`).value = template[key] || '';
}

async function saveTemplate() {
  if (!state.activeHost) return setNotice('Scan a product page before saving its template.', 'error');
  const templates = await savedTemplates();
  templates[state.activeHost] = Object.fromEntries(['title', 'price', 'sku', 'gtin', 'mpn', 'brand', 'image'].map((key) => [key, byId(`selector-${key}`).value.trim()]).filter(([, value]) => value));
  await chrome.storage.local.set({ siteTemplates: templates });
  setNotice(`Extraction template saved for ${state.activeHost}.`, 'success');
}

async function showTab(name) {
  for (const button of document.querySelectorAll('.tab-button')) button.classList.toggle('active', button.dataset.tab === name);
  for (const id of ['capture', 'quotes', 'settings']) byId(`${id}-tab`).hidden = id !== name;
}

async function updateActiveHost() {
  try {
    const tab = await activeTab();
    const url = new URL(tab.url || 'https://invalid.local');
    state.activeHost = url.hostname === 'invalid.local' ? '' : url.hostname;
    byId('page-host').textContent = state.activeHost || 'Open an RFQ or product page.';
    byId('template-host').textContent = state.activeHost || 'Scan a product page first.';
    await loadTemplateFields();
  } catch { /* The page label remains unchanged. */ }
}

let autoScanTimer = null;
let lastAutoScanKey = '';

function scheduleAutoScan(delay = 180, force = false) {
  if (autoScanTimer) clearTimeout(autoScanTimer);
  autoScanTimer = setTimeout(() => {
    autoScanTimer = null;
    autoScanRfqPage(force).catch(() => {});
  }, delay);
}

async function autoScanRfqPage(force = false) {
  if (!state.connected || state.busy) return;
  const tab = await activeTab();
  const url = new URL(tab.url || 'https://invalid.local');
  const isRfq = /dw\.buysupply\.com$/i.test(url.hostname) && /\/baskets\/view\//i.test(url.pathname);
  if (!isRfq) return;
  const key = `${tab.id}:${url.href}`;
  if (!force && key === lastAutoScanKey) return;
  lastAutoScanKey = key;
  await scanPage({ automatic: true });
}

async function connect() {
  setBusy(true);
  try {
    await runtimeMessage({ type: 'dataplus:connect' });
    await initialize();
    setNotice('DataPlus is connected for 30 days.', 'success');
  } catch (error) { setNotice(error.message || 'Unable to connect to DataPlus.', 'error'); }
  finally { setBusy(false); renderContext(); }
}

function applyConnectionStatus(status = {}) {
  state.connected = status.connected === true;
  state.baseUrl = status.baseUrl || state.baseUrl || '';
  byId('base-url-input').value = state.baseUrl;
  byId('connection-panel').hidden = state.connected;
  byId('workspace').hidden = !state.connected;
  byId('connection-label').textContent = state.connected
    ? `${status.user?.name || status.user?.username || 'Connected'} · expires ${dateLabel(status.expiresAt)}`
    : 'Not connected';
}

async function requireConnectedSession() {
  const status = await runtimeMessage({ type: 'dataplus:connection-status' });
  applyConnectionStatus(status);
  if (!state.connected) {
    state.organization = null;
    state.quotes = [];
    state.selectedQuoteId = '';
    throw new Error('Sign in to DataPlus and connect the extension before importing a quote.');
  }
  return status;
}

async function initialize() {
  const status = await runtimeMessage({ type: 'dataplus:connection-status' });
  applyConnectionStatus(status);
  if (state.connected) await loadWorkspace();
  else {
    state.organization = null;
    state.quotes = [];
    state.selectedQuoteId = '';
    state.capture = null;
    state.existingRfqQuote = null;
  }
  await updateActiveHost();
  if (state.connected) scheduleAutoScan();
}

byId('connect-button').addEventListener('click', connect);
byId('open-login-button').addEventListener('click', () => runtimeMessage({ type: 'dataplus:open-tab', path: '/' }));
byId('refresh-button').addEventListener('click', async () => { setNotice('Refreshing...'); try { await initialize(); setNotice('Extension data refreshed.', 'success'); } catch (error) { setNotice(error.message, 'error'); } });
byId('scan-button').addEventListener('click', () => scanPage());
byId('open-quote-button').addEventListener('click', () => openQuote());
byId('quote-select').addEventListener('change', async (event) => {
  state.selectedQuoteId = event.target.value;
  await chrome.storage.local.set({ selectedQuoteId: state.selectedQuoteId });
  renderQuotes();
  renderContext();
});
byId('company-select').addEventListener('change', async (event) => {
  const [tenantId, companyId] = event.target.value.split('::');
  if (!tenantId || !companyId) return;
  setBusy(true);
  try {
    await api('/api/organization/select', { method: 'POST', body: { tenantId, companyId } });
    await loadWorkspace();
    setNotice(`${currentCompany()?.name || 'Company'} is active in the extension.`, 'success');
  } catch (error) { setNotice(error.message || 'The company could not be selected.', 'error'); }
  finally { setBusy(false); renderContext(); }
});
byId('save-settings-button').addEventListener('click', async () => {
  await runtimeMessage({ type: 'dataplus:settings', baseUrl: byId('base-url-input').value });
  setNotice('DataPlus URL saved. Connect again for this environment.', 'success');
  await initialize();
});
byId('disconnect-button').addEventListener('click', async () => {
  await runtimeMessage({ type: 'dataplus:disconnect' });
  setNotice('The extension session was disconnected.', 'success');
  await initialize();
});
byId('save-template-button').addEventListener('click', saveTemplate);
for (const button of document.querySelectorAll('.tab-button')) button.addEventListener('click', () => showTab(button.dataset.tab));

chrome.tabs.onActivated.addListener(() => scheduleAutoScan(180, true));
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (tab.active && changeInfo.status === 'complete') scheduleAutoScan(240, true);
});

initialize().catch((error) => setNotice(error.message || 'The extension could not start.', 'error'));
