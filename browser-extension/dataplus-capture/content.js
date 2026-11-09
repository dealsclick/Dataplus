(function initDataPlusExtractor(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DataPlusPageExtractor = api;
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    const documentRef = root?.document;
    const locationRef = root?.location;
    let statusRequestPending = false;
    let statusRefreshQueued = false;
    let lastRfqReference = '';
    let detailMutationTimer = null;
    let indexStatusRequestPending = false;
    let indexStatusRefreshQueued = false;
    let lastIndexReferencesKey = '';
    let indexMutationTimer = null;

    const isRfqPage = () => Boolean(
      documentRef
      && /dw\.buysupply\.com$/i.test(String(locationRef?.hostname || ''))
      && /\/baskets\/view\//i.test(String(locationRef?.pathname || ''))
    );

    const isRfqIndexPage = () => Boolean(
      documentRef
      && /dw\.buysupply\.com$/i.test(String(locationRef?.hostname || ''))
      && /^\/rfqs\/website\/?$/i.test(String(locationRef?.pathname || ''))
    );

    function runtimeMessage(message) {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          if (!response?.ok) return reject(new Error(response?.error || 'DataPlus could not check this RFQ.'));
          resolve(response.result);
        });
      });
    }

    const isDataPlusPage = () => /^(dataplusapp\.duckdns\.org|localhost|127\.0\.0\.1)$/i.test(String(locationRef?.hostname || ''));
    const competitorKeyForHost = (hostname) => ({
      'homedepot.com': 'home-depot',
      'globalindustrial.com': 'global-industrial',
      'zoro.com': 'zoro'
    })[String(hostname || '').toLowerCase().replace(/^www\./, '')] || '';

    function renderCompetitorResearchStatus(context) {
      if (!documentRef || !context?.product?.sku || competitorKeyForHost(locationRef?.hostname) !== context?.target?.key) return;
      let host = documentRef.getElementById('dataplus-competitor-research');
      if (!host) {
        host = documentRef.createElement('div');
        host.id = 'dataplus-competitor-research';
        host.attachShadow({ mode: 'open' });
        Object.assign(host.style, { position: 'fixed', right: '14px', bottom: '14px', zIndex: '2147483647' });
        documentRef.documentElement.append(host);
      }
      const rootNode = host.shadowRoot;
      const style = documentRef.createElement('style');
      style.textContent = `:host{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box;letter-spacing:0}.card{width:min(320px,calc(100vw - 28px));padding:12px;border:1px solid #35506e;border-radius:7px;background:#111820;color:#edf4fb;box-shadow:0 12px 32px rgba(0,0,0,.28);font-size:12px;line-height:1.4}.title{font-size:13px;font-weight:750}.detail{margin-top:5px;color:#b4c0cc}.sku{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:#8bc5ff}.action{display:inline-flex;min-height:30px;align-items:center;justify-content:center;margin-top:9px;padding:5px 10px;border:1px solid #4899e8;border-radius:5px;background:#2186eb;color:#fff;font:inherit;font-weight:700;cursor:pointer}`;
      const card = documentRef.createElement('section');
      card.className = 'card';
      const title = documentRef.createElement('div');
      title.className = 'title';
      title.textContent = 'DataPlus competitor research';
      const detail = documentRef.createElement('div');
      detail.className = 'detail';
      detail.append('Select the correct result for ');
      const sku = documentRef.createElement('span');
      sku.className = 'sku';
      sku.textContent = context.product.sku;
      detail.append(sku, '. On its product page, open DataPlus Capture to confirm the match.');
      const button = documentRef.createElement('button');
      button.type = 'button';
      button.className = 'action';
      button.textContent = 'Open DataPlus Capture';
      button.addEventListener('click', () => runtimeMessage({ type: 'dataplus:open-sidepanel' }).catch(() => {}));
      card.append(title, detail, button);
      rootNode.replaceChildren(style, card);
    }

    if (isDataPlusPage()) {
      root.addEventListener('dataplus:competitor-search', (event) => {
        runtimeMessage({ type: 'dataplus:set-competitor-context', context: event?.detail }).catch(() => {});
      });
    } else if (competitorKeyForHost(locationRef?.hostname)) {
      runtimeMessage({ type: 'dataplus:competitor-context' }).then(renderCompetitorResearchStatus).catch(() => {});
    }

    function statusStyles() {
      return `
        :host { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        * { box-sizing: border-box; letter-spacing: 0; }
        .card { width: min(340px, calc(100vw - 24px)); padding: 12px; border: 1px solid #35506e; border-radius: 7px; background: #111820; color: #edf4fb; box-shadow: 0 12px 32px rgba(0,0,0,.28); font-size: 12px; line-height: 1.4; }
        .card.success { border-color: #24704d; background: #10261c; }
        .card.warning { border-color: #80651f; background: #2b240f; }
        .card.error { border-color: #8a3e45; background: #32181b; }
        .title { display: flex; align-items: center; gap: 8px; font-weight: 750; font-size: 13px; }
        .dot { width: 8px; height: 8px; flex: none; border-radius: 50%; background: #56a7f6; }
        .success .dot { background: #39c985; } .warning .dot { background: #e3b940; } .error .dot { background: #ef6d76; }
        .detail { margin-top: 5px; color: #b4c0cc; }
        .url { display: block; margin-top: 7px; overflow: hidden; color: #8bc5ff; text-overflow: ellipsis; white-space: nowrap; }
        .action { display: inline-flex; align-items: center; justify-content: center; min-height: 30px; margin-top: 9px; padding: 5px 10px; border: 1px solid #4899e8; border-radius: 5px; background: #2186eb; color: white; font: inherit; font-weight: 700; text-decoration: none; cursor: pointer; }
        .pill { display: inline-flex; align-items: center; gap: 6px; min-height: 25px; padding: 3px 8px; border: 1px solid #35506e; border-radius: 999px; background: #edf6ff; color: #174f82; font: 650 11px/1.2 Inter, ui-sans-serif, system-ui, sans-serif; text-decoration: none; vertical-align: middle; cursor: pointer; }
        .pill.success { border-color: #23865b; background: #e7f8ef; color: #11623f; }
        .pill.warning { border-color: #9b7622; background: #fff7da; color: #73530c; }
        .pill.error { border-color: #a74e55; background: #fff0f1; color: #842f36; }
        @media (prefers-color-scheme: dark) { .pill { background: #142638; color: #b9dcff; } .pill.success { background: #112c20; color: #8ee7b7; } .pill.warning { background: #302710; color: #f4d16f; } .pill.error { background: #35191c; color: #ffadb3; } }
      `;
    }

    function indexStatusStyles() {
      return `
        :host { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        * { box-sizing: border-box; letter-spacing: 0; }
        .status { display: inline-flex; max-width: 150px; min-height: 26px; align-items: center; gap: 6px; padding: 4px 8px; border: 1px solid #68727d; border-radius: 999px; background: #f2f4f6; color: #46515c; font: 650 11px/1.2 Inter, ui-sans-serif, system-ui, sans-serif; text-decoration: none; white-space: nowrap; }
        .status.success { border-color: #23865b; background: #e7f8ef; color: #11623f; }
        .status.warning { border-color: #9b7622; background: #fff7da; color: #73530c; }
        .status.error { border-color: #a74e55; background: #fff0f1; color: #842f36; }
        a.status:hover { filter: brightness(.96); text-decoration: underline; }
        .dot { width: 7px; height: 7px; flex: none; border-radius: 50%; background: #87919b; }
        .success .dot { background: #22a669; } .warning .dot { background: #c49518; } .error .dot { background: #d54a54; }
        .wrap { display: grid; justify-items: start; gap: 3px; }
        .meta { max-width: 150px; overflow: hidden; color: #68727d; font: 500 10px/1.2 Inter, ui-sans-serif, system-ui, sans-serif; text-overflow: ellipsis; white-space: nowrap; }
        @media (prefers-color-scheme: dark) { .status { border-color: #46505b; background: #222930; color: #c1c9d1; } .status.success { border-color: #23865b; background: #112c20; color: #8ee7b7; } .status.warning { border-color: #9b7622; background: #302710; color: #f4d16f; } .status.error { border-color: #a74e55; background: #35191c; color: #ffadb3; } .meta { color: #929da8; } }
      `;
    }

    function ensureStatusHost(id, kind, reference) {
      let host = documentRef.getElementById(id);
      if (!host) {
        host = documentRef.createElement(kind === 'card' ? 'div' : 'span');
        host.id = id;
        host.attachShadow({ mode: 'open' });
        if (kind === 'card') {
          Object.assign(host.style, { position: 'fixed', top: '14px', right: '14px', zIndex: '2147483647' });
          documentRef.documentElement.append(host);
        } else {
          Object.assign(host.style, { display: 'inline-block', marginLeft: '10px', verticalAlign: 'middle' });
          const heading = Array.from(documentRef.querySelectorAll('h1,h2,h3')).find((node) => new RegExp(`RFQ.*${String(reference || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(node.textContent || ''))
            || documentRef.querySelector('h1,h2,h3');
          if (heading) heading.append(host);
          else documentRef.body?.prepend(host);
        }
      }
      return host;
    }

    function appendAction(parent, status, compact = false) {
      if (status.quoteUrl) {
        const link = documentRef.createElement('a');
        link.className = compact ? `pill ${status.tone || ''}` : 'action';
        link.href = status.quoteUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = compact ? `${status.label} - Open in DataPlus` : 'Open quote in DataPlus';
        parent.append(link);
        return;
      }
      if (status.action === 'capture') {
        const button = documentRef.createElement('button');
        button.type = 'button';
        button.className = compact ? `pill ${status.tone || ''}` : 'action';
        button.textContent = compact ? status.label : 'Open DataPlus Capture';
        button.addEventListener('click', () => runtimeMessage({ type: 'dataplus:open-sidepanel' }).catch(() => {}));
        parent.append(button);
        return;
      }
      if (status.action === 'signin') {
        const link = documentRef.createElement('a');
        link.className = compact ? `pill ${status.tone || ''}` : 'action';
        link.href = status.baseUrl || 'https://dataplusapp.duckdns.org';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = compact ? status.label : 'Sign in to DataPlus';
        parent.append(link);
        return;
      }
      const pill = documentRef.createElement('span');
      pill.className = `pill ${status.tone || ''}`;
      pill.textContent = status.label;
      parent.append(pill);
    }

    function renderRfqStatus(status, reference) {
      if (!documentRef) return;
      const cardHost = ensureStatusHost('dataplus-rfq-status-card', 'card', reference);
      const cardRoot = cardHost.shadowRoot;
      const style = documentRef.createElement('style');
      style.textContent = statusStyles();
      const card = documentRef.createElement('section');
      card.className = `card ${status.tone || ''}`;
      const title = documentRef.createElement('div');
      title.className = 'title';
      const dot = documentRef.createElement('span');
      dot.className = 'dot';
      const titleText = documentRef.createElement('span');
      titleText.textContent = status.label;
      title.append(dot, titleText);
      const detail = documentRef.createElement('div');
      detail.className = 'detail';
      detail.textContent = status.detail;
      card.append(title, detail);
      if (status.quoteUrl) {
        const url = documentRef.createElement('span');
        url.className = 'url';
        url.textContent = status.quoteUrl;
        card.append(url);
      }
      if (status.action || status.quoteUrl) appendAction(card, status);
      cardRoot.replaceChildren(style, card);

      const inlineHost = ensureStatusHost('dataplus-rfq-status-inline', 'inline', reference);
      const inlineRoot = inlineHost.shadowRoot;
      const inlineStyle = documentRef.createElement('style');
      inlineStyle.textContent = statusStyles();
      const inline = documentRef.createElement('span');
      appendAction(inline, status, true);
      inlineRoot.replaceChildren(inlineStyle, inline);
    }

    function rfqIndexEntries() {
      const entries = [];
      const seenRows = new Set();
      for (const row of documentRef.querySelectorAll('.rfq-row:not(.rfq-row--head), table tr')) {
        if (!row || seenRows.has(row)) continue;
        const reference = String(row.textContent || '').match(/\bQ-\d{6}-[A-Z0-9]+\b/i)?.[0] || '';
        if (!reference) continue;
        seenRows.add(row);
        entries.push({ row, reference });
      }
      return entries;
    }

    function ensureRfqIndexColumns(entries) {
      for (const entry of entries) {
        const nameCell = entry.row.querySelector('.rfq-name-cell') || entry.row.querySelector('td,th') || entry.row.firstElementChild;
        if (!nameCell) continue;
        let host = nameCell.querySelector(':scope > [data-dataplus-rfq-cell]');
        if (!host) {
          host = documentRef.createElement('span');
          host.setAttribute('data-dataplus-rfq-cell', entry.reference);
          Object.assign(host.style, { display: 'block', marginTop: '5px' });
          host.attachShadow({ mode: 'open' });
          nameCell.append(host);
        }
        entry.host = host;
      }
    }

    function renderRfqIndexCell(entry, status) {
      const rootNode = entry.host?.shadowRoot;
      if (!rootNode) return;
      const style = documentRef.createElement('style');
      style.textContent = indexStatusStyles();
      const wrap = documentRef.createElement('span');
      wrap.className = 'wrap';
      const element = status.quoteUrl || status.href ? documentRef.createElement('a') : documentRef.createElement('span');
      element.className = `status ${status.tone || ''}`;
      if (element.tagName === 'A') {
        element.href = status.quoteUrl || status.href;
        element.target = '_blank';
        element.rel = 'noopener noreferrer';
        element.title = status.quoteUrl || status.href;
      }
      const dot = documentRef.createElement('span');
      dot.className = 'dot';
      const label = documentRef.createElement('span');
      label.textContent = status.label;
      element.append(dot, label);
      wrap.append(element);
      if (status.meta) {
        const meta = documentRef.createElement('span');
        meta.className = 'meta';
        meta.textContent = status.meta;
        wrap.append(meta);
      }
      rootNode.replaceChildren(style, wrap);
    }

    async function refreshRfqIndexStatus(force = false) {
      if (!isRfqIndexPage()) return;
      if (indexStatusRequestPending) {
        if (force) indexStatusRefreshQueued = true;
        return;
      }
      const entries = rfqIndexEntries();
      if (!entries.length) return;
      ensureRfqIndexColumns(entries);
      const references = entries.map((entry) => entry.reference);
      const key = references.map((reference) => reference.toLowerCase()).join('|');
      if (!force && key === lastIndexReferencesKey) return;
      indexStatusRequestPending = true;
      for (const entry of entries) renderRfqIndexCell(entry, { label: 'Checking...' });
      try {
        const result = await runtimeMessage({ type: 'dataplus:rfq-statuses', references });
        if (!result.connected) {
          for (const entry of entries) renderRfqIndexCell(entry, { tone: 'warning', label: 'Sign in required', href: result.baseUrl, meta: 'Connect DataPlus Capture' });
        } else {
          const matches = new Map((result.matches || []).map((match) => [String(match.reference || '').toLowerCase(), match]));
          for (const entry of entries) {
            const match = matches.get(entry.reference.toLowerCase());
            if (match?.exists) {
              renderRfqIndexCell(entry, {
                tone: 'success',
                label: match.draft?.draftNumber || 'Open quote',
                meta: String(match.draft?.status || 'draft').replaceAll('_', ' '),
                quoteUrl: match.quoteUrl
              });
            } else {
              renderRfqIndexCell(entry, { label: 'Not imported' });
            }
          }
        }
        lastIndexReferencesKey = key;
      } catch (error) {
        lastIndexReferencesKey = '';
        for (const entry of entries) renderRfqIndexCell(entry, { tone: 'error', label: 'Check failed', meta: error.message || 'Try again' });
      } finally {
        indexStatusRequestPending = false;
        if (indexStatusRefreshQueued) {
          indexStatusRefreshQueued = false;
          scheduleRfqIndexStatus(true);
        }
      }
    }

    function scheduleRfqIndexStatus(force = false) {
      if (indexMutationTimer) root.clearTimeout(indexMutationTimer);
      indexMutationTimer = root.setTimeout(() => {
        indexMutationTimer = null;
        refreshRfqIndexStatus(force).catch(() => {});
      }, 120);
    }

    async function refreshRfqStatus(force = false) {
      if (!isRfqPage()) return;
      const rfq = api.extractRfq(documentRef, locationRef);
      const reference = String(rfq.externalId || '').trim();
      if (!force && reference && reference.toLowerCase() === lastRfqReference.toLowerCase()) return;
      if (statusRequestPending) {
        statusRefreshQueued = true;
        return;
      }
      statusRequestPending = true;
      renderRfqStatus({ label: 'Checking DataPlus...', detail: `Looking for ${reference || 'this RFQ'} in the quote pipeline.` }, reference);
      try {
        const result = await runtimeMessage({ type: 'dataplus:rfq-status', reference });
        if (!result.connected) {
          renderRfqStatus({ tone: 'warning', label: 'DataPlus sign-in required', detail: 'Sign in and connect DataPlus Capture to check or import this RFQ.', action: 'signin', baseUrl: result.baseUrl }, reference);
        } else if (result.exists) {
          const draftNumber = result.draft?.draftNumber || 'Quote';
          const draftStatus = String(result.draft?.status || 'draft').replaceAll('_', ' ');
          renderRfqStatus({ tone: 'success', label: `${draftNumber} already exists`, detail: `${reference} is in DataPlus with status ${draftStatus}.`, quoteUrl: result.quoteUrl }, reference);
        } else {
          renderRfqStatus({ label: 'Not yet in DataPlus', detail: `${reference} is ready to import as a draft quote.`, action: 'capture' }, reference);
        }
      } catch (error) {
        renderRfqStatus({ tone: 'error', label: 'DataPlus check failed', detail: error.message || 'Refresh the page to try again.' }, reference);
      } finally {
        statusRequestPending = false;
        lastRfqReference = reference;
        if (statusRefreshQueued) {
          statusRefreshQueued = false;
          root.setTimeout(() => refreshRfqStatus(true), 0);
        }
      }
    }

    function scheduleRfqStatusRefresh(force = false) {
      if (detailMutationTimer) root.clearTimeout(detailMutationTimer);
      detailMutationTimer = root.setTimeout(() => {
        detailMutationTimer = null;
        refreshRfqStatus(force).catch(() => {});
      }, 180);
    }

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'dataplus:extract-page') {
        try { sendResponse({ ok: true, result: api.extractPage(document, location, message.template || {}) }); }
        catch (error) { sendResponse({ ok: false, error: error.message || 'Unable to read this page.' }); }
        return false;
      }
      if (message?.type === 'dataplus:refresh-rfq-status') {
        Promise.all([refreshRfqStatus(true), refreshRfqIndexStatus(true)]).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error.message }));
        return true;
      }
      return false;
    });

    if (isRfqPage()) {
      root.setTimeout(() => refreshRfqStatus(true), 0);
      root.addEventListener('focus', () => refreshRfqStatus(true));
      documentRef.addEventListener('visibilitychange', () => { if (documentRef.visibilityState === 'visible') refreshRfqStatus(true); });
      if (documentRef.body && typeof MutationObserver !== 'undefined') {
        new MutationObserver(() => scheduleRfqStatusRefresh()).observe(documentRef.body, { childList: true, subtree: true, characterData: true });
      }
    }
    if (isRfqIndexPage()) {
      scheduleRfqIndexStatus(true);
      root.addEventListener('focus', () => scheduleRfqIndexStatus(true));
      documentRef.addEventListener('visibilitychange', () => { if (documentRef.visibilityState === 'visible') scheduleRfqIndexStatus(true); });
      if (documentRef.body && typeof MutationObserver !== 'undefined') {
        new MutationObserver(() => scheduleRfqIndexStatus()).observe(documentRef.body, { childList: true, subtree: true });
      }
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createDataPlusExtractor() {
  function clean(value, maximum = 2000) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
  }

  function numberValue(value) {
    const normalized = String(value ?? '').replace(/[^0-9.-]/g, '');
    const result = Number(normalized);
    return normalized && Number.isFinite(result) && result >= 0 ? Number(result.toFixed(2)) : null;
  }

  function digits(value) {
    const result = String(value || '').replace(/\D/g, '');
    return [8, 12, 13, 14].includes(result.length) ? result : '';
  }

  function selectorText(doc, selector) {
    if (!selector) return '';
    try { return clean(doc.querySelector(selector)?.textContent || ''); } catch { return ''; }
  }

  function selectorAttribute(doc, selector, attribute) {
    if (!selector) return '';
    try {
      const element = doc.querySelector(selector);
      return clean(element?.getAttribute(attribute) || element?.[attribute] || '');
    } catch { return ''; }
  }

  function jsonLdProducts(doc) {
    const products = [];
    const add = (value) => {
      if (!value) return;
      if (Array.isArray(value)) return value.forEach(add);
      if (typeof value !== 'object') return;
      const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
      if (types.some((type) => String(type || '').toLowerCase() === 'product')) products.push(value);
      if (Array.isArray(value['@graph'])) value['@graph'].forEach(add);
      if (value.mainEntity) add(value.mainEntity);
    };
    for (const script of doc.querySelectorAll('script[type*="ld+json"]')) {
      try { add(JSON.parse(script.textContent || '')); } catch { /* Ignore malformed merchant data. */ }
    }
    return products.sort((left, right) => JSON.stringify(right).length - JSON.stringify(left).length);
  }

  function meta(doc, ...names) {
    for (const name of names) {
      const escaped = String(name).replace(/"/g, '\\"');
      const value = doc.querySelector(`meta[property="${escaped}"],meta[name="${escaped}"],meta[itemprop="${escaped}"]`)?.getAttribute('content');
      if (clean(value)) return clean(value);
    }
    return '';
  }

  function offer(product) {
    const offers = Array.isArray(product?.offers) ? product.offers : [product?.offers];
    for (const row of offers) {
      if (!row || typeof row !== 'object') continue;
      const price = numberValue(row.price ?? row.lowPrice ?? row.highPrice ?? row.priceSpecification?.price);
      if (price !== null) return { price, currency: clean(row.priceCurrency || row.priceSpecification?.priceCurrency || 'USD', 3).toUpperCase() };
    }
    return { price: null, currency: '' };
  }

  function imageValue(value, sourceUrl) {
    const candidates = Array.isArray(value) ? value : [value];
    for (const candidate of candidates) {
      const raw = typeof candidate === 'object' ? candidate?.url || candidate?.contentUrl : candidate;
      if (!raw) continue;
      try { return new URL(String(raw), sourceUrl).toString(); } catch { /* Try the next image. */ }
    }
    return '';
  }

  function visibleIdentifier(text, label) {
    const patterns = {
      gtin: /\b(?:UPC|GTIN(?:-?\d+)?|EAN)\s*(?:#|:)?\s*([0-9][0-9\s-]{6,20})/i,
      mpn: /\b(?:MPN|Manufacturer(?:'s)? Part(?: Number)?|Model(?: Number)?|Part Number)\s*(?:#|:)?\s*([A-Z0-9][A-Z0-9._\/-]{2,79})/i,
      sku: /\b(?:SKU|Item(?: Number)?|Product Code)\s*(?:#|:)?\s*([A-Z0-9][A-Z0-9._\/-]{2,79})/i
    };
    return clean(patterns[label]?.exec(text)?.[1] || '', 120);
  }

  function extractProduct(doc, locationLike, template = {}) {
    const sourceUrl = String(locationLike?.href || '');
    const product = jsonLdProducts(doc)[0] || {};
    const offers = offer(product);
    const brand = typeof product.brand === 'object' ? product.brand?.name : product.brand;
    const visibleText = clean(doc.body?.innerText || '', 80000);
    const title = selectorText(doc, template.title) || clean(product.name || meta(doc, 'og:title', 'twitter:title') || doc.title, 300);
    const rawPrice = selectorText(doc, template.price);
    const rawGtin = selectorText(doc, template.gtin);
    const rawSku = selectorText(doc, template.sku);
    const rawMpn = selectorText(doc, template.mpn);
    const imageUrl = selectorAttribute(doc, template.image, 'src') || imageValue(product.image || meta(doc, 'og:image', 'twitter:image'), sourceUrl);
    const result = {
      kind: 'product',
      sourceUrl,
      sourceHost: String(locationLike?.hostname || ''),
      title,
      brand: selectorText(doc, template.brand) || clean(brand || meta(doc, 'product:brand', 'brand'), 160),
      description: clean(product.description || meta(doc, 'og:description', 'description'), 1000),
      gtin: digits(rawGtin || product.gtin14 || product.gtin13 || product.gtin12 || product.gtin8 || product.gtin || product.upc || meta(doc, 'product:upc', 'product:gtin') || visibleIdentifier(visibleText, 'gtin')),
      sku: clean(rawSku || product.sku || meta(doc, 'product:retailer_item_id', 'sku') || visibleIdentifier(visibleText, 'sku'), 120),
      mpn: clean(rawMpn || product.mpn || product.model || meta(doc, 'product:mpn', 'mpn') || visibleIdentifier(visibleText, 'mpn'), 120),
      imageUrl,
      competitorPrice: numberValue(rawPrice) ?? offers.price ?? numberValue(meta(doc, 'product:price:amount', 'og:price:amount')),
      currency: clean(template.currency ? selectorText(doc, template.currency) : offers.currency || meta(doc, 'product:price:currency', 'og:price:currency') || 'USD', 3).toUpperCase(),
      structuredDataFound: Boolean(Object.keys(product).length),
      templateApplied: Object.values(template || {}).some(Boolean)
    };
    result.identifiersFound = [result.gtin, result.sku, result.mpn].filter(Boolean).length;
    return result;
  }

  function parseShippingSummary(value) {
    const segments = String(value || '').split('•').map((part) => clean(part, 500)).filter(Boolean);
    const phonePattern = /^\+?[0-9][0-9\s().-]{6,}$/;
    const phone = phonePattern.test(segments[0] || '') ? segments.shift() : '';
    const line1 = segments.shift() || '';
    const city = segments.shift() || '';
    const statePostal = segments.join(' ');
    const stateMatch = /^([A-Z]{2})\s+(.+)$/i.exec(statePostal);
    return {
      phone,
      line1,
      city,
      state: clean(stateMatch?.[1] || statePostal, 80).toUpperCase(),
      postalCode: clean(stateMatch?.[2] || '', 40),
      country: 'US',
      raw: clean(value, 2000)
    };
  }

  function tableRows(table) {
    if (!table) return [];
    const headers = Array.from(table.querySelectorAll('thead th')).map((cell) => clean(cell.textContent, 120).toUpperCase());
    return Array.from(table.querySelectorAll('tbody tr')).map((row) => {
      const cells = Array.from(row.querySelectorAll('th,td')).map((cell) => clean(cell.textContent, 1000));
      return Object.fromEntries(headers.map((header, index) => [header || String(index), cells[index] || '']));
    });
  }

  function tableByHeaders(doc, requiredHeaders) {
    return Array.from(doc.querySelectorAll('table')).find((table) => {
      const headers = Array.from(table.querySelectorAll('thead th')).map((cell) => clean(cell.textContent).toUpperCase());
      return requiredHeaders.every((header) => headers.includes(header));
    });
  }

  function extractRfq(doc, locationLike) {
    const titleText = clean(doc.querySelector('h1,h2,h3')?.textContent || doc.title, 300);
    const pageText = String(doc.body?.innerText || '');
    const canonicalReference = /\bQ-[A-Z0-9]+(?:-[A-Z0-9]+)+\b/i.exec(`${titleText}\n${pageText}`)?.[0] || '';
    const externalId = canonicalReference || /RFQ\s*[:#-]?\s*["']?([^"'\s]+)["']?/i.exec(titleText)?.[1]?.trim() || '';
    const shippingCard = Array.from(doc.querySelectorAll('.card-body')).find((card) => /Shipping Address/i.test(card.innerText || ''));
    const shippingText = clean(shippingCard?.querySelector('.text-muted')?.textContent || '', 2000);
    const shippingAddress = parseShippingSummary(shippingText);
    const summary = Array.from(doc.querySelectorAll('body *')).filter((node) => /^Website RFQ:/i.test(clean(node.textContent))).sort((a, b) => clean(a.textContent).length - clean(b.textContent).length)[0];
    const summaryText = clean(summary?.textContent || '', 2000);
    const email = clean(summary?.querySelector('a')?.textContent || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.exec(summaryText)?.[0] || '', 320);
    const afterEmail = email ? summaryText.slice(summaryText.indexOf(email) + email.length) : summaryText.replace(/^Website RFQ:\s*/i, '');
    const company = clean(afterEmail.split('•').map((part) => clean(part)).find((part) => part && !/^Total:/i.test(part)) || '', 300);
    const total = numberValue(/Total:\s*([^•]+)/i.exec(summaryText)?.[1]);
    const initial = tableRows(tableByHeaders(doc, ['SKU', 'PRODUCT', 'QTY', 'RFQ PRICE']));
    const processed = tableRows(tableByHeaders(doc, ['RFQ_SKU', 'RFQ_TITLE', 'BUYSUPPLY SKU']));
    const items = initial.map((row, index) => {
      const enriched = processed[index] || {};
      const sourceSku = row.SKU || enriched.RFQ_SKU || '';
      const matchedSku = enriched['BUYSUPPLY SKU'] || '';
      return {
        sourceSku,
        sku: matchedSku || sourceSku,
        matchedSku,
        title: row.PRODUCT || enriched.RFQ_TITLE || sourceSku,
        qty: Math.max(1, Number(row.QTY || enriched.RFQ_QTY || 1) || 1),
        price: numberValue(row['RFQ PRICE'] || enriched.RFQ_PRICE) || 0,
        lineTotal: numberValue(row['LINE TOTAL'])
      };
    });
    return {
      kind: 'rfq',
      sourceUrl: String(locationLike?.href || ''),
      sourceHost: String(locationLike?.hostname || ''),
      externalId: clean(externalId, 160),
      status: clean(/RFQ status:\s*([^\n]+)/i.exec(doc.body?.innerText || '')?.[1] || '', 80).toLowerCase(),
      buyer: company || email || 'Website RFQ customer',
      email,
      company,
      phone: shippingAddress.phone,
      shippingAddress,
      total,
      items
    };
  }

  function extractPage(doc, locationLike, template = {}) {
    if (/dw\.buysupply\.com$/i.test(String(locationLike?.hostname || '')) && /\/baskets\/view\//i.test(String(locationLike?.pathname || ''))) {
      return extractRfq(doc, locationLike);
    }
    return extractProduct(doc, locationLike, template);
  }

  return { clean, extractPage, extractProduct, extractRfq, numberValue, parseShippingSummary };
});
