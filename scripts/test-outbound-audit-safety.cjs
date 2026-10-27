const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { publicScan, publicSession } = require('../lib/outbound-audit-store');

const session = publicSession({
  audit_id: 'audit-1', audit_number: 17, warehouse_id: 'wh-1', warehouse_name: 'Staten Island',
  status: 'open', package_count: 2, matched_count: 1, unmatched_count: 1, multiple_match_count: 0,
  started_at: new Date('2026-10-27T12:00:00Z')
});
assert.equal(session.auditNumber, 'OA-000017');
assert.equal(session.packageCount, 2);
assert.equal(session.unmatchedCount, 1);

const unmatched = publicScan({
  scan_id: 'scan-1', tracking_raw: 'EXTERNAL-TRACKING-123', tracking_number: 'EXTERNAL-TRACKING-123',
  tracking_normalized: 'EXTERNALTRACKING123', match_status: 'unmatched', order_matches: [],
  scanned_by_name: 'Warehouse user', scanned_at: new Date('2026-10-27T12:01:00Z')
});
assert.equal(unmatched.matchStatus, 'unmatched');
assert.equal(unmatched.matches.length, 0);
assert.equal(unmatched.trackingNumber, 'EXTERNAL-TRACKING-123');
assert.equal(unmatched.trackingUrl, '');

const upsScan = publicScan({
  scan_id: 'scan-2', tracking_raw: '1Z999AA10123456784', tracking_number: '1Z999AA10123456784',
  tracking_normalized: '1Z999AA10123456784', carrier: 'UPS', match_status: 'matched', order_matches: []
});
assert.match(upsScan.trackingUrl, /^https:\/\/www\.ups\.com\/track/);
assert.equal(upsScan.carrier, 'UPS');

const dbSource = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
assert.match(dbSource, /RELATIONAL_SCHEMA_VERSION = "2026-10-27-outbound-evidence-v1"/);
assert.match(dbSource, /create table if not exists outbound_audit_sessions/);
assert.match(dbSource, /create table if not exists outbound_audit_scans/);
assert.match(dbSource, /create table if not exists outbound_audit_evidence/);
assert.match(dbSource, /storage_backend text not null default 'filesystem'/);
assert.match(dbSource, /unique \(audit_id, tracking_normalized\)/);

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const routeStart = serverSource.indexOf('if (url.pathname === "/api/fulfillment/outbound-audits"');
const routeEnd = serverSource.indexOf('if (req.method === "GET" && url.pathname === "/api/orders/tracking-lookup"', routeStart);
assert(routeStart > 0 && routeEnd > routeStart, 'Outbound audit routes must remain isolated and discoverable.');
const routes = serverSource.slice(routeStart, routeEnd);
for (const forbidden of ['saveOrder(', 'addInventoryLedger(', 'syncOrder', 'purchaseShippingLabel']) {
  assert.equal(routes.includes(forbidden), false, `Outbound audit routes must not call ${forbidden}`);
}
assert.match(serverSource, /writeOutboundEvidenceFile/);
assert.match(serverSource, /createWriteStream/);
assert.doesNotMatch(routes, /data:image\//);

const scannerSource = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'lib', 'fast-barcode-scanner.ts'), 'utf8');
assert.match(scannerSource, /BarcodeDetector/);
assert.match(scannerSource, /width: \{ ideal: 1280/);
assert.match(scannerSource, /reader\.possibleFormats/);
assert.doesNotMatch(scannerSource, /ideal: 1920, max: 1920/);

const workspaceSource = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'components', 'outbound-audit-workspace.tsx'), 'utf8');
assert.match(workspaceSource, /captureCompressedEvidence/);
assert.match(workspaceSource, /savePendingOutboundEvidence/);
assert.match(workspaceSource, /DataPlus order/);
assert.match(workspaceSource, /channelOrderNumber/);
assert.match(workspaceSource, /TrackingReference/);
assert.match(workspaceSource, /trackingUrl/);

const warehouseMobileSource = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'components', 'warehouse-mobile.tsx'), 'utf8');
assert.match(warehouseMobileSource, /id: "outbound"/);
assert.match(warehouseMobileSource, /section === "outbound"/);

const warehouseRouteSource = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'components', 'warehouse-route.tsx'), 'utf8');
assert.match(warehouseRouteSource, /OutboundAuditWorkspace/);
assert.match(warehouseRouteSource, /startFastBarcodeScanner/);
assert.match(warehouseRouteSource, /captureCompressedEvidence/);
assert.match(warehouseRouteSource, /Quick create/);
assert.match(warehouseRouteSource, /Full create/);

const trackingLookupSource = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'components', 'tracking-camera-lookup.tsx'), 'utf8');
assert.match(trackingLookupSource, /startFastBarcodeScanner/);
assert.match(trackingLookupSource, /torchAvailable/);
assert.doesNotMatch(trackingLookupSource, /BrowserMultiFormatReader|decodeFromConstraints/);

const cameraScannerSources = fs.readdirSync(path.join(__dirname, '..', 'web', 'src', 'components'))
  .filter(file => file.endsWith('.tsx'))
  .map(file => fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'components', file), 'utf8'))
  .join('\n');
assert.doesNotMatch(cameraScannerSources, /BrowserMultiFormatReader|decodeFromConstraints/);

assert.match(serverSource, /parts\[3\] === "quick-item"/);
assert.match(serverSource, /warehouse-audit-quick-create/);
assert.match(serverSource, /needsProductDetails: true/);

console.log('outbound audit safety tests passed');
