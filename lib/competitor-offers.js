const COMPETITOR_SITES = Object.freeze([
  {
    key: 'home-depot',
    name: 'Home Depot',
    hosts: ['homedepot.com', 'www.homedepot.com'],
    searchUrl(query) { return `https://www.homedepot.com/s/${encodeURIComponent(query)}`; }
  },
  {
    key: 'global-industrial',
    name: 'Global Industrial',
    hosts: ['globalindustrial.com', 'www.globalindustrial.com'],
    searchUrl(query) { return `https://www.globalindustrial.com/searchResult?q=${encodeURIComponent(query)}`; }
  },
  {
    key: 'zoro',
    name: 'Zoro',
    hosts: ['zoro.com', 'www.zoro.com'],
    searchUrl(query) { return `https://www.zoro.com/search?q=${encodeURIComponent(query)}`; }
  }
]);

function clean(value, maximum = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function normalizedIdentifier(value) {
  return clean(value, 160).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function gtin(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return [8, 12, 13, 14].includes(digits.length) ? digits : '';
}

function publicHttpUrl(value, label = 'URL', optional = false) {
  const raw = clean(value, 2000);
  if (!raw && optional) return '';
  let parsed;
  try { parsed = new URL(raw); } catch { throw Object.assign(new Error(`Enter a valid ${label}.`), { statusCode: 400 }); }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  const nonstandardPort = parsed.port && !((parsed.protocol === 'https:' && parsed.port === '443') || (parsed.protocol === 'http:' && parsed.port === '80'));
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || nonstandardPort
    || !host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw Object.assign(new Error(`Enter a valid ${label}.`), { statusCode: 400 });
  }
  return parsed.toString();
}

function competitorSiteForHost(hostname) {
  const host = clean(hostname, 240).toLowerCase().replace(/^www\./, '');
  return COMPETITOR_SITES.find((site) => site.hosts.some((candidate) => candidate.replace(/^www\./, '') === host)) || null;
}

function productIdentifiers(product = {}) {
  const barcode = gtin(product.barcode || product.gtin || product.upc);
  const mpn = clean(product.mfr_part_number || product.mfrPartNumber || product.mpn, 160);
  const sku = clean(product.company_sku || product.sku || product.source_sku || product.sourceSku, 160);
  if (barcode) return { type: 'UPC / GTIN', query: barcode };
  if (mpn) return { type: 'Manufacturer part number', query: mpn };
  return { type: 'SKU', query: sku };
}

function competitorSearchTargets(product = {}) {
  const identifier = productIdentifiers(product);
  if (!identifier.query) return [];
  return COMPETITOR_SITES.map((site) => ({
    key: site.key,
    name: site.name,
    query: identifier.query,
    identifierType: identifier.type,
    searchUrl: site.searchUrl(identifier.query)
  }));
}

function normalizeCompetitorOffer(input = {}, product = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw Object.assign(new Error('Enter valid competitor product details.'), { statusCode: 400 });
  }
  if (input.confirmed !== true) {
    throw Object.assign(new Error('Confirm that the competitor page is the same product before saving it.'), { statusCode: 400 });
  }
  const sourceUrl = publicHttpUrl(input.sourceUrl, 'competitor product URL');
  const parsed = new URL(sourceUrl);
  const site = competitorSiteForHost(parsed.hostname);
  const amount = input.price === null || input.price === undefined || input.price === '' ? null : Number(input.price);
  if (amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > 1e9)) {
    throw Object.assign(new Error('Enter a valid competitor price.'), { statusCode: 400 });
  }
  const currency = clean(input.currency || 'USD', 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw Object.assign(new Error('Enter a valid competitor currency.'), { statusCode: 400 });
  const observed = input.observedAt ? new Date(input.observedAt) : new Date();
  if (!Number.isFinite(observed.getTime())) throw Object.assign(new Error('Enter a valid observation date.'), { statusCode: 400 });
  const offerGtin = gtin(input.gtin);
  const offerMpn = clean(input.mpn, 160);
  const offerSku = clean(input.sku || input.competitorSku, 160);
  const productGtin = gtin(product.barcode || product.gtin || product.upc);
  const productMpn = clean(product.mfr_part_number || product.mfrPartNumber || product.mpn, 160);
  const productSku = clean(product.company_sku || product.sku || product.source_sku || product.sourceSku, 160);
  const matchBasis = productGtin && offerGtin && productGtin === offerGtin
    ? 'Exact UPC / GTIN'
    : productMpn && offerMpn && normalizedIdentifier(productMpn) === normalizedIdentifier(offerMpn)
      ? 'Exact manufacturer part number'
      : productSku && offerSku && normalizedIdentifier(productSku) === normalizedIdentifier(offerSku)
        ? 'Exact SKU'
        : 'User-confirmed product match';
  return {
    competitorKey: site?.key || clean(parsed.hostname.replace(/^www\./, ''), 120),
    competitorName: site?.name || clean(parsed.hostname.replace(/^www\./, ''), 160),
    sourceUrl,
    sourceHost: clean(parsed.hostname, 240).toLowerCase(),
    title: clean(input.title, 500),
    competitorSku: offerSku,
    gtin: offerGtin,
    mpn: offerMpn,
    brand: clean(input.brand, 240),
    imageUrl: input.imageUrl ? publicHttpUrl(input.imageUrl, 'competitor image URL', true) : '',
    price: amount === null ? null : Number(amount.toFixed(6)),
    currency,
    matchBasis,
    observedAt: observed.toISOString()
  };
}

module.exports = {
  COMPETITOR_SITES,
  competitorSearchTargets,
  competitorSiteForHost,
  gtin,
  normalizeCompetitorOffer,
  normalizedIdentifier,
  productIdentifiers
};
