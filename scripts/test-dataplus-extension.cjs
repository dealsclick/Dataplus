const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const extensionRoot = path.join(root, 'browser-extension', 'dataplus-capture');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));
const extractor = require(path.join(extensionRoot, 'content.js'));
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const companyOperations = fs.readFileSync(path.join(root, 'lib', 'company-operations-http.js'), 'utf8');

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.side_panel.default_path, 'sidepanel.html');
assert.ok(manifest.permissions.includes('cookies'));
assert.ok(manifest.permissions.includes('sidePanel'));
assert.ok(manifest.host_permissions.includes('https://dataplusapp.duckdns.org/*'));

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

assert.match(server, /\/api\/auth\/extension\/connect/);
assert.match(server, /sessionType: "browser_extension"/);
assert.match(server, /function requestSessionToken/);
assert.match(server, /registerExtractedProduct\(body\.extractedProduct/);
assert.match(server, /importSource === "buysupply dw rfq"/);
assert.match(companyOperations, /body\.extractedProduct/);
assert.match(companyOperations, /importSource==='buysupply dw rfq'/);

for (const file of ['background.js', 'content.js', 'sidepanel.js']) {
  const source = fs.readFileSync(path.join(extensionRoot, file), 'utf8');
  assert.doesNotMatch(source, /eval\s*\(/, `${file} must not execute saved website code`);
  assert.doesNotMatch(source, /new Function\s*\(/, `${file} must not execute saved website code`);
}

console.log('DataPlus Capture extension manifest, extraction, authentication, and RFQ idempotency checks passed.');
