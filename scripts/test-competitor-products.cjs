const assert = require('node:assert/strict');
const {
  inspectCompetitorUrl,
  inspectProductHtml,
  isPublicAddress,
  matchCatalogCandidates,
  normalizeSourceUrl,
  readInspection,
  scrapeGraphExtractProduct
} = require('../lib/competitor-products');

const html = `<!doctype html><html><head>
  <meta property="og:title" content="Fallback title">
  <meta property="og:image" content="https://cdn.example.com/tool.jpg">
  <script type="application/ld+json">{
    "@context":"https://schema.org","@type":"Product","name":"Milwaukee Drill Kit",
    "sku":"48-22-4094","mpn":"48-22-4094","gtin12":"045242123456",
    "brand":{"@type":"Brand","name":"Milwaukee"},"description":"A drill kit.",
    "image":["https://cdn.example.com/tool.jpg"],
    "offers":{"@type":"Offer","price":"99.95","priceCurrency":"USD"}
  }</script>
</head><body>Product</body></html>`;

const parsed = inspectProductHtml(html, 'https://shop.example.com/products/drill');
assert.equal(parsed.title, 'Milwaukee Drill Kit');
assert.equal(parsed.brand, 'Milwaukee');
assert.equal(parsed.gtin, '045242123456');
assert.equal(parsed.sku, '48-22-4094');
assert.equal(parsed.mpn, '48-22-4094');
assert.equal(parsed.competitorPrice, 99.95);
assert.equal(parsed.currency, 'USD');
assert.equal(parsed.structuredDataFound, true);

const matches = matchCatalogCandidates(parsed, [
  { id: 'one', sku: 'BUY09134370', title: 'CEI Milwaukee Drill Kit', barcode: '045242123456' },
  { id: 'two', sku: 'BUS403966DIB', title: 'Do it Best Milwaukee Drill Kit', upc: '00045242123456' },
  { id: 'three', sku: 'DPS10269', title: 'Warehouse product', mfrPartNumber: '48-22-4094' },
  { id: 'four', sku: '48-22-4094', title: 'Page SKU candidate' }
]);
assert.equal(matches.length, 4);
assert.equal(matches.filter(row => row.matchBasis === 'UPC / GTIN').length, 2);
assert.equal(matches.filter(row => row.confirmedIdentifier).length, 2);
assert.equal(matches.find(row => row.sku === 'DPS10269').reviewRequired, true);
assert.equal(matches.find(row => row.sku === '48-22-4094').matchBasis, 'Page SKU');

assert.equal(isPublicAddress('8.8.8.8'), true);
assert.equal(isPublicAddress('10.1.2.3'), false);
assert.equal(isPublicAddress('127.0.0.1'), false);
assert.equal(isPublicAddress('::1'), false);
assert.throws(() => normalizeSourceUrl('http://localhost/product'), /Private/);
assert.throws(() => normalizeSourceUrl('http://192.168.1.10/product'), /Private/);
assert.throws(() => normalizeSourceUrl('ftp://example.com/product'), /HTTP and HTTPS/);
assert.throws(() => normalizeSourceUrl('https://user:secret@example.com/product'), /usernames or passwords/);

(async () => {
  let scrapeGraphRequest = null;
  const scrapeGraphFetch = async (url, options) => {
    scrapeGraphRequest = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'sg-request-1', json: { title: 'AI Milwaukee Drill Kit', brand: 'Milwaukee', gtin: '0 45242 123456', sku: '48-22-4094', mpn: '48-22-4094', imageUrl: 'https://cdn.example.com/ai-tool.jpg', competitorPrice: '$109.95', currency: 'usd' } })
    };
  };
  const extracted = await scrapeGraphExtractProduct('https://shop.example.com/products/drill', { apiKey: 'secret-key', renderMode: 'js', stealth: true, fetch: scrapeGraphFetch });
  assert.equal(scrapeGraphRequest.url, 'https://v2-api.scrapegraphai.com/api/extract');
  assert.equal(scrapeGraphRequest.options.headers['SGAI-APIKEY'], 'secret-key');
  assert.equal(scrapeGraphRequest.body.fetchConfig.mode, 'js');
  assert.equal(scrapeGraphRequest.body.fetchConfig.stealth, true);
  assert.equal(extracted.product.gtin, '045242123456');
  assert.equal(extracted.product.competitorPrice, 109.95);
  assert.equal(extracted.product.currency, 'USD');

  const providerInspection = await inspectCompetitorUrl('https://shop.example.com/products/drill', {
    scopeKey: 'tenant:company:user:provider-draft',
    scrapeGraph: { enabled: true, apiKey: 'secret-key', fetch: scrapeGraphFetch }
  });
  assert.equal(providerInspection.extractionProvider, 'scrapegraphai');
  assert.equal(providerInspection.providerRequestId, 'sg-request-1');
  assert.equal(providerInspection.product.title, 'AI Milwaukee Drill Kit');

  const fallbackInspection = await inspectCompetitorUrl('https://shop.example.com/products/drill', {
    scopeKey: 'tenant:company:user:fallback-draft',
    scrapeGraph: { enabled: true, apiKey: 'secret-key', fetch: async () => { throw new Error('provider offline'); } },
    fetchHtml: async () => ({ html, finalUrl: 'https://shop.example.com/products/drill', statusCode: 200, headers: { 'content-type': 'text/html' } })
  });
  assert.equal(fallbackInspection.extractionProvider, 'direct');
  assert.match(fallbackInspection.providerWarning, /provider offline/i);
  assert.equal(fallbackInspection.product.title, 'Milwaukee Drill Kit');

  const inspection = await inspectCompetitorUrl('https://shop.example.com/products/drill#details', {
    scopeKey: 'tenant:company:user:draft',
    fetchHtml: async () => ({ html, finalUrl: 'https://shop.example.com/products/drill', statusCode: 200, headers: { 'content-type': 'text/html' } })
  });
  assert.equal(inspection.sourceHost, 'shop.example.com');
  assert.equal(inspection.product.gtin, '045242123456');
  assert.equal(readInspection(inspection.inspectionId, 'tenant:company:user:draft').inspectionId, inspection.inspectionId);
  assert.throws(() => readInspection(inspection.inspectionId, 'tenant:other:user:draft'), /expired/i);
  console.log('Competitor product parsing, matching, and URL safeguards passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
