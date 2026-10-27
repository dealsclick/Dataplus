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

const dbSource = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
assert.match(dbSource, /create table if not exists outbound_audit_sessions/);
assert.match(dbSource, /create table if not exists outbound_audit_scans/);
assert.match(dbSource, /unique \(audit_id, tracking_normalized\)/);

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const routeStart = serverSource.indexOf('if (url.pathname === "/api/fulfillment/outbound-audits"');
const routeEnd = serverSource.indexOf('if (req.method === "GET" && url.pathname === "/api/orders/tracking-lookup"', routeStart);
assert(routeStart > 0 && routeEnd > routeStart, 'Outbound audit routes must remain isolated and discoverable.');
const routes = serverSource.slice(routeStart, routeEnd);
for (const forbidden of ['saveOrder(', 'addInventoryLedger(', 'syncOrder', 'purchaseShippingLabel']) {
  assert.equal(routes.includes(forbidden), false, `Outbound audit routes must not call ${forbidden}`);
}

console.log('outbound audit safety tests passed');
