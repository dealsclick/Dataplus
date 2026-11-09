const assert = require('node:assert/strict');
const {
  competitorSearchTargets,
  competitorSiteForHost,
  normalizeCompetitorOffer,
  productIdentifiers
} = require('../lib/competitor-offers');

const product = {
  company_sku: 'BUY-100',
  source_sku: 'BUS-100',
  barcode: '012345678905',
  mfr_part_number: 'ABC-123'
};

assert.deepEqual(productIdentifiers(product), { type: 'UPC / GTIN', query: '012345678905' });
const targets = competitorSearchTargets(product);
assert.equal(targets.length, 3);
assert.match(targets.find((target) => target.key === 'home-depot').searchUrl, /homedepot\.com\/s\/012345678905/);
assert.match(targets.find((target) => target.key === 'global-industrial').searchUrl, /globalindustrial\.com\/searchResult\?q=012345678905/);
assert.match(targets.find((target) => target.key === 'zoro').searchUrl, /zoro\.com\/search\?q=012345678905/);
assert.equal(competitorSiteForHost('www.zoro.com').key, 'zoro');

const exact = normalizeCompetitorOffer({
  confirmed: true,
  sourceUrl: 'https://www.homedepot.com/p/example/123',
  title: 'Example product',
  gtin: '012345678905',
  price: 12.34,
  currency: 'usd',
  observedAt: '2026-11-09T00:00:00.000Z'
}, product);
assert.equal(exact.competitorKey, 'home-depot');
assert.equal(exact.matchBasis, 'Exact UPC / GTIN');
assert.equal(exact.price, 12.34);
assert.equal(exact.currency, 'USD');

const visual = normalizeCompetitorOffer({
  confirmed: true,
  sourceUrl: 'https://competitor.example/products/one',
  title: 'Visually reviewed product',
  sku: 'OTHER-1',
  price: null
}, product);
assert.equal(visual.competitorName, 'competitor.example');
assert.equal(visual.matchBasis, 'User-confirmed product match');

assert.throws(() => normalizeCompetitorOffer({ sourceUrl: 'https://www.zoro.com/i/x' }, product), /Confirm/);
assert.throws(() => normalizeCompetitorOffer({ confirmed: true, sourceUrl: 'javascript:alert(1)' }, product), /valid competitor product URL/);
assert.throws(() => normalizeCompetitorOffer({ confirmed: true, sourceUrl: 'https://www.zoro.com/i/x', price: -1 }, product), /valid competitor price/);

console.log('Competitor offer search and validation checks passed.');
