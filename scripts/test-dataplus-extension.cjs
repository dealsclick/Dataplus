const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const extensionRoot = path.join(root, 'browser-extension', 'dataplus-capture');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));
const extractor = require(path.join(extensionRoot, 'content.js'));
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const companyOperations = fs.readFileSync(path.join(root, 'lib', 'company-operations-http.js'), 'utf8');
const sidepanel = fs.readFileSync(path.join(extensionRoot, 'sidepanel.js'), 'utf8');
const sidepanelHtml = fs.readFileSync(path.join(extensionRoot, 'sidepanel.html'), 'utf8');
const sidepanelCss = fs.readFileSync(path.join(extensionRoot, 'sidepanel.css'), 'utf8');
const background = fs.readFileSync(path.join(extensionRoot, 'background.js'), 'utf8');
const content = fs.readFileSync(path.join(extensionRoot, 'content.js'), 'utf8');

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, '0.2.4');
assert.equal(manifest.side_panel.default_path, 'sidepanel.html');
assert.ok(manifest.permissions.includes('cookies'));
assert.ok(manifest.permissions.includes('scripting'));
assert.ok(manifest.permissions.includes('sidePanel'));
assert.ok(manifest.host_permissions.includes('https://dataplusapp.duckdns.org/*'));
for (const size of [16, 32, 48, 128]) {
  assert.equal(manifest.icons[String(size)], `icons/icon-${size}.png`);
  assert.ok(fs.existsSync(path.join(extensionRoot, manifest.icons[String(size)])), `extension icon ${size}px must exist`);
}

assert.deepEqual(extractor.parseShippingSummary('+91424234 • test tet • NY • NY 4244'), {
  phone: '+91424234',
  line1: 'test tet',
  city: 'NY',
  state: 'NY',
  postalCode: '4244',
  country: 'US',
  raw: '+91424234 • test tet • NY • NY 4244'
});
assert.deepEqual(extractor.parseShippingSummary('1870 bath ave • br • NY 11204'), {
  phone: '',
  line1: '1870 bath ave',
  city: 'br',
  state: 'NY',
  postalCode: '11204',
  country: 'US',
  raw: '1870 bath ave • br • NY 11204'
});
assert.equal(extractor.numberValue('$1,249.95'), 1249.95);

const rfqDocument = {
  title: 'BuySupply RFQ',
  body: { innerText: 'Website RFQ: Q-261109-AB12\nRFQ status: Open' },
  querySelector(selector) {
    if (selector === 'h1,h2,h3') return { textContent: 'RFQ: Q-261109-AB12 for Acme' };
    return null;
  },
  querySelectorAll() { return []; }
};
assert.equal(extractor.extractRfq(rfqDocument, { href: 'https://dw.buysupply.com/baskets/view/999', hostname: 'dw.buysupply.com' }).externalId, 'Q-261109-AB12');

assert.match(server, /\/api\/auth\/extension\/connect/);
assert.match(server, /sessionType: "browser_extension"/);
assert.match(server, /function requestSessionToken/);
assert.match(server, /registerExtractedProduct\(body\.extractedProduct/);
assert.match(server, /importSource === "buysupply dw rfq"/);
assert.match(server, /parts\[2\] === "import-match"/);
assert.match(server, /parts\[2\] === "import-matches"/);
assert.match(companyOperations, /body\.extractedProduct/);
assert.match(companyOperations, /importSource==='buysupply dw rfq'/);
assert.match(companyOperations, /parts\[2\]==='import-match'/);
assert.match(companyOperations, /parts\[2\]==='import-matches'/);
assert.match(sidepanel, /findExistingRfqQuote/);
assert.match(sidepanel, /sourcePageSku:\s*item\.sourceSku/);
assert.match(sidepanel, /catalogMatchedSku:\s*item\.matchedSku/);
assert.match(sidepanel, /requireConnectedSession/);
assert.match(sidepanel, /autoScanRfqPage/);
assert.match(sidepanel, /saveCompetitorMatch/);
assert.match(sidepanel, /\/competitors/);
assert.match(sidepanel, /match\.mapPrice/);
assert.match(sidepanel, /availableLabel\(match\)/);
assert.match(sidepanel, /Open \$\{match\.sku \|\| 'product'\} in DataPlus/);
assert.match(sidepanel, /chrome\.tabs\.onActivated/);
assert.match(sidepanel, /chrome\.scripting\.executeScript/);
assert.match(sidepanel, /requestPageExtraction\(tab\.id, template\)/);
assert.match(sidepanel, /quote-url-link/);
assert.match(background, /dataplus:rfq-status/);
assert.match(background, /dataplus:rfq-statuses/);
assert.match(background, /cache:\s*'no-store'/);
assert.match(background, /references:\s*\[normalizedReference\]/);
assert.match(background, /dataplus:open-sidepanel/);
assert.match(background, /dataplus:set-competitor-context/);
assert.match(background, /competitorResearchContext/);
assert.match(content, /dataplus-rfq-status-card/);
assert.match(content, /data-dataplus-rfq-cell/);
assert.match(content, /statusRefreshQueued/);
assert.match(content, /MutationObserver\(\(\) => scheduleRfqStatusRefresh/);
assert.match(content, /Open quote in DataPlus/);
assert.match(content, /dataplus:competitor-search/);
assert.match(content, /DataPlus competitor research/);
assert.match(sidepanelHtml, /Sign in to DataPlus first/);
assert.match(sidepanelHtml, /BuySupply RFQs are checked automatically/);
assert.match(sidepanelHtml, /id="extension-version"/);
assert.match(sidepanel, /chrome\.runtime\.getManifest\(\)/);
assert.match(sidepanelCss, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
assert.match(sidepanelCss, /\.match-commercial/);

for (const file of ['background.js', 'content.js', 'sidepanel.js']) {
  const source = fs.readFileSync(path.join(extensionRoot, file), 'utf8');
  assert.doesNotMatch(source, /eval\s*\(/, `${file} must not execute saved website code`);
  assert.doesNotMatch(source, /new Function\s*\(/, `${file} must not execute saved website code`);
}

console.log('DataPlus Capture extension manifest, extraction, authentication, and RFQ idempotency checks passed.');
