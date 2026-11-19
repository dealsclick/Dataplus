const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  canonicalLiveSessionReference,
  liveSessionAuditUrl,
  liveSessionWithAudit,
} = require("../server.js");

assert.equal(canonicalLiveSessionReference("live 42"), "LS-42");
assert.equal(canonicalLiveSessionReference("LS-91"), "LS-91");
assert.equal(liveSessionAuditUrl({ auditNumber: "AUDIT-221", id: "uuid" }), "/warehouse/audits/A-221");
assert.equal(liveSessionAuditUrl({ auditNumber: "AUDIT-221", id: "uuid" }, true), "/warehouse/mobile/audits/A-221");

const counting = liveSessionWithAudit({
  id: "session-1",
  sessionNumber: "LIVE-101",
  status: "draft",
  channel: "",
}, {
  id: "audit-1",
  auditNumber: "AUDIT-222",
  status: "in_progress",
  lines: [{ sku: "SKU-1", countedQty: 3 }, { sku: "SKU-2", countedQty: 2 }],
  unknownBarcodes: [{ barcode: "123", count: 1 }],
});
assert.equal(counting.sessionNumber, "LS-101");
assert.equal(counting.status, "counting");
assert.equal(counting.channelLabel, "Not assigned");
assert.equal(counting.scannedSkus, 2);
assert.equal(counting.unknownBarcodes, 1);
assert.equal(counting.scannedUnits, 6);

const ready = liveSessionWithAudit({ id: "session-2", sessionNumber: "LS-102" }, {
  id: "audit-2",
  auditNumber: "A-223",
  status: "completed",
  lines: [],
  unknownBarcodes: [],
});
assert.equal(ready.status, "ready");

const live = liveSessionWithAudit({
  id: "session-3",
  sessionNumber: "LS-103",
  status: "live",
  sourceType: "extra_items",
  items: [{ sourceLineId: "line-1", sku: "SKU-1", soldQty: 2, shippedQty: 1 }],
}, {
  id: "audit-3",
  auditNumber: "A-224",
  status: "completed",
  lines: [{ id: "line-1", sku: "SKU-1", countedQty: 5 }],
  unknownBarcodes: [],
});
assert.equal(live.status, "live");
assert.equal(live.items[0].soldQty, 2);
assert.equal(live.items[0].shippedQty, 1);
assert.equal(live.items[0].remainingQty, 3);

const splitAudit = liveSessionWithAudit({
  id: "session-4",
  sessionNumber: "LS-104",
  status: "ready",
  sourceType: "warehouse_audit",
  linkedAuditId: "audit-4",
  items: [{ sourceLineId: "line-1", sku: "SKU-1", requestedQty: 3, reservedQty: 3 }],
}, {
  id: "audit-4",
  auditNumber: "A-225",
  status: "completed",
  lines: [{ id: "line-1", sku: "SKU-1", countedQty: 10 }],
  unknownBarcodes: [],
});
assert.equal(splitAudit.items[0].sourceAvailableQty, 10);
assert.equal(splitAudit.items[0].reservedQty, 3);
assert.equal(splitAudit.items[0].remainingQty, 3);

const dbSource = fs.readFileSync(path.join(__dirname, "..", "db.js"), "utf8");
const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const uiSource = fs.readFileSync(path.join(__dirname, "..", "web", "src", "components", "live-sessions-route.tsx"), "utf8");
assert.match(dbSource, /async function createLiveSessionWithAudit[\s\S]*await client\.query\("begin"\)[\s\S]*replaceWarehouseAudits[\s\S]*insert into entity_documents[\s\S]*await client\.query\("commit"\)/);
assert.match(dbSource, /outcome\?\.warehouseAudit[\s\S]*replaceWarehouseAudits\(\[outcome\.warehouseAudit\]/);
assert.match(dbSource, /const ENTITY_DOCUMENT_COLLECTIONS = new Set\(\[[\s\S]*"liveSessions"/);
assert.match(serverSource, /sourceType === "purchase_order"/);
assert.match(serverSource, /sourceType === "warehouse_audit"/);
assert.match(serverSource, /sourceType === "previous_session"/);
assert.match(serverSource, /sourceType === "manual_skus"/);
assert.match(serverSource, /\/api\/live-sessions\/source-preview/);
assert.match(serverSource, /liveSessionLinks:/);
assert.match(serverSource, /liveSessionId: sessionId/);
assert.match(serverSource, /mutateLiveSessionsAtomically/);
assert.match(serverSource, /parts\[3\] === "launch" && parts\[4\] === "readiness"/);
assert.match(serverSource, /sourceLiveSessionId: plan\.session\.id/);
assert.match(serverSource, /getTikTokMarketplace\(\)\.queue\("launch"/);
assert.match(uiSource, /Session from remaining/);
assert.match(uiSource, /Create and scan/);
assert.match(uiSource, /Review readiness/);
assert.match(uiSource, /Publish ready/);
assert.match(uiSource, /Whatnot publishing is not connected/);
assert.match(uiSource, /Select only the items for this session/);
assert.match(uiSource, /20%\+ markup/);
assert.match(serverSource, /requestedLiveSessionSalePrice/);
assert.match(serverSource, /price: group\.salePrice/);

console.log("Live session audit-link regression tests passed.");
