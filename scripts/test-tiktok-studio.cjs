const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const marketplace = fs.readFileSync(path.join(__dirname, '..', 'lib', 'tiktok-marketplace.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const route = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'components', 'live-sessions-route.tsx'), 'utf8');
assert.match(marketplace, /const studioCache = new Map\(\)/, 'Studio should use a bounded short-lived cache');
assert.match(marketplace, /Date\.now\(\) \+ 20_000/, 'Studio cache should expire quickly');
assert.match(marketplace, /while \(studioCache\.size > 20\)/, 'Studio cache should be bounded');
assert.match(marketplace, /\/affiliate\/202309\/live_rooms/, 'Studio should read TikTok LIVE rooms');
assert.match(marketplace, /\/analytics\/202609\/shop_lives\/performance/, 'Studio should read current LIVE performance');
assert.match(marketplace, /studioProductAction/, 'Studio should expose product controls');
assert.match(server, /parts\[3\] === "studio"/, 'Server should expose the session Studio route');
assert.match(server, /remoteEnded[\s\S]*reconcileLiveSessions/, 'A tracked room ending should reconcile sales');
assert.match(route, /document\.visibilityState !== "visible"/, 'Hidden tabs should not poll Studio');
assert.match(route, /window\.setInterval\(\(\) => void poll\(\), 30_000\)/, 'Visible Studio should poll no faster than every 30 seconds');
assert.match(route, /Normal live-session pages and background workers do not poll TikTok/, 'The UI should explain the performance boundary');
console.log('TikTok DataPlus Studio safeguards passed.');

