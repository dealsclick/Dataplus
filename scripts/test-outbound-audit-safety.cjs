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

const groupedLiveScan = publicScan({
  scan_id: 'scan-live', tracking_number: '1Z999AA10123456784', carrier: 'UPS', match_status: 'multiple',
  order_matches: [{ orderId: 'order-1', shipmentGroupId: 'SG-1' }, { orderId: 'order-2', shipmentGroupId: 'SG-1' }],
  live_item_required: true, live_item_status: 'pending', live_item_expected_count: 3,
  live_item_scans: [{ clientScanId: 'item-1', orderId: 'order-1', listingLineIndex: 0, sku: 'DPS10001' }]
});
assert.equal(groupedLiveScan.liveItemRequired, true);
assert.equal(groupedLiveScan.liveItemExpectedCount, 3);
assert.equal(groupedLiveScan.liveItemScannedCount, 1);
assert.equal(groupedLiveScan.liveItemStatus, 'pending');

const optionalItemScan = publicScan({
  scan_id: 'scan-standard', tracking_number: '9400111899223856928499', carrier: 'USPS', match_status: 'matched',
  order_matches: [{ orderId: 'order-2', itemScanItems: [{ listingSku: 'SKU-2', qty: 1 }] }],
  live_item_required: false, live_item_status: 'pending', live_item_expected_count: 1,
  live_item_scans: [{ clientScanId: 'item-2', orderId: 'order-2', sku: 'SKU-2', verificationOnly: true, verificationMatched: true }]
});
assert.equal(optionalItemScan.liveItemRequired, false);
assert.equal(optionalItemScan.liveItemExpectedCount, 1);
assert.equal(optionalItemScan.liveItemScannedCount, 1);

const unmatchedItemScan = publicScan({
  scan_id: 'scan-unmatched-item', tracking_number: 'EXTERNAL-TRACKING-456', match_status: 'unmatched',
  order_matches: [], live_item_required: false, live_item_status: 'pending', live_item_expected_count: 0,
  live_item_scans: [{ clientScanId: 'item-3', sku: 'DPS10003', verificationOnly: true }]
});
assert.equal(unmatchedItemScan.matches.length, 0);
assert.equal(unmatchedItemScan.liveItemExpectedCount, 0);
assert.equal(unmatchedItemScan.liveItemScannedCount, 1);
assert.equal(unmatchedItemScan.liveItemStatus, 'pending');

const dbSource = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
assert.match(dbSource, /RELATIONAL_SCHEMA_VERSION = "2026-10-29-shipping-report-facts-v1"/);
assert.match(dbSource, /create table if not exists outbound_audit_sessions/);
assert.match(dbSource, /create table if not exists outbound_audit_scans/);
assert.match(dbSource, /create table if not exists outbound_audit_evidence/);
assert.match(dbSource, /storage_backend text not null default 'filesystem'/);
assert.match(dbSource, /unique \(audit_id, tracking_normalized\)/);
assert.match(dbSource, /live_item_required boolean not null default false/);
assert.match(dbSource, /live_item_expected_count integer not null default 0/);
assert.match(dbSource, /live_item_scans jsonb not null default '\[\]'::jsonb/);
assert.match(dbSource, /async function ensureOutboundAuditSchema\(client\)/);
assert.match(dbSource, /if \(schemaVersion\.rows\[0\]\?\.current === true\) \{\s+await ensureOutboundAuditSchema\(client\)/);
const outboundScanCreate = dbSource.match(/create table if not exists outbound_audit_scans \([\s\S]*?\n    \);/)?.[0] || '';
assert.match(outboundScanCreate, /live_item_required boolean not null default false/);
assert.match(outboundScanCreate, /live_item_status text not null default 'not_required'/);
assert.match(outboundScanCreate, /live_item_expected_count integer not null default 0/);
assert.match(outboundScanCreate, /live_item_scans jsonb not null default '\[\]'::jsonb/);

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
assert.match(serverSource, /readOrdersByShipmentGroupId/);
assert.match(serverSource, /recordOutboundLiveItem/);
assert.match(serverSource, /completeOutboundLiveShipmentGroup/);
assert.match(serverSource, /Live shipment items verified/);
assert.match(serverSource, /outbound_live_fulfillment/);
assert.match(serverSource, /Every item in this Live shipment group has already been scanned/);
assert.match(serverSource, /itemScanItems/);
assert.match(serverSource, /verificationOnly: true/);
assert.match(serverSource, /Unmatched package item/);
assert.match(serverSource, /Unrecognized item barcode/);
assert.match(serverSource, /recorded for this package\. Scan another item or continue to the package photo/);
assert.match(serverSource, /Item scanning is optional; scan the items or continue to the package photo/);
assert.match(serverSource, /Reused today's outbound handoff audit/);
assert.match(routes, /action === "item-scan"/);
assert.match(routes, /action === "quick-item"/);

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
assert.match(workspaceSource, /Combined Live shipment/);
assert.match(workspaceSource, /Continue item scans/);
assert.match(workspaceSource, /incompleteLiveScans\.length > 0/);
assert.match(workspaceSource, /Optional item verification/);
assert.match(workspaceSource, /Unmatched package contents/);
assert.match(workspaceSource, /Every package can continue to item scans and a photo/);
assert.match(workspaceSource, /Skip to package photo/);
assert.match(workspaceSource, /Item verification/);
assert.match(workspaceSource, /Use today&apos;s audit/);

const outboundStoreSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'outbound-audit-store.js'), 'utf8');
assert.match(outboundStoreSource, /timezone\('America\/New_York', started_at\)::date = timezone\('America\/New_York', now\(\)\)::date/);
assert.match(outboundStoreSource, /pg_advisory_xact_lock/);
assert.match(outboundStoreSource, /when scan\.live_item_expected_count > 0 and jsonb_array_length\(scan\.live_item_scans\) \+ 1 >= scan\.live_item_expected_count then 'complete'/);
assert.doesNotMatch(outboundStoreSource, /scan\.live_item_required = true or scan\.live_item_expected_count > 0/);

const warehouseMobileSource = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'components', 'warehouse-mobile.tsx'), 'utf8');
assert.match(warehouseMobileSource, /id: "outbound"/);
assert.match(warehouseMobileSource, /section === "outbound"/);

const warehouseRouteSource = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'components', 'warehouse-route.tsx'), 'utf8');
assert.match(warehouseRouteSource, /OutboundAuditWorkspace/);
assert.match(warehouseRouteSource, /startFastBarcodeScanner/);
assert.match(warehouseRouteSource, /compressEvidenceImage/);
assert.match(warehouseRouteSource, /capture="environment"/);
assert.match(warehouseRouteSource, /Quick create/);
assert.match(warehouseRouteSource, /Full create/);
assert.match(warehouseRouteSource, /reopenUnknownSku\(item, "quick"\)/);
assert.match(warehouseRouteSource, /scannerEngine/);
assert.match(warehouseRouteSource, /h-28 rounded-md border-2/);
assert.match(warehouseRouteSource, /Align one barcode inside the frame/);

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
