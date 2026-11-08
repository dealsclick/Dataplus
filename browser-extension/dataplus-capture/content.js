(function initDataPlusExtractor(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DataPlusPageExtractor = api;
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== 'dataplus:extract-page') return false;
      try { sendResponse({ ok: true, result: api.extractPage(document, location, message.template || {}) }); }
      catch (error) { sendResponse({ ok: false, error: error.message || 'Unable to read this page.' }); }
      return false;
    });
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
    const externalId = /RFQ\s*["']?([^"']+?)["']?(?:\s|$)/i.exec(titleText)?.[1]?.trim() || /Q-[A-Z0-9-]+/i.exec(doc.body?.innerText || '')?.[0] || '';
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
