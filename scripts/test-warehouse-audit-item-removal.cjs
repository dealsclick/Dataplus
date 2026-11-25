const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const at = source.indexOf('parts[5] === "remove" && postgres.isPostgresEnabled()');
const route = source.slice(source.lastIndexOf("  if (", at), source.indexOf("\n  if (", at));

async function run({ kind = "known", lineKey = "line", status = "in_progress", reason = "Scanned wrong item" } = {}) {
  const known = { id: "line", productId: "product", sku: "SKU-1", title: "Known item", countedQty: 4, locationBin: "A-01", receivingPurchaseOrderLineId: "po-line" };
  const unknown = { id: "unknown", barcode: "012345678905", count: 2, locationBin: "B-02" };
  const audit = { id: "audit", auditNumber: "A-230", status, lines: [known], unknownBarcodes: [unknown], purchaseOrderExpectedLines: [{ id: "expected", sku: "SKU-1", expectedQty: 4 }] };
  let saved;
  let synced = 0;
  const context = {
    req: { method: "POST" },
    res: {},
    parts: ["api", "warehouse-audits", "audit", "lines", lineKey, "remove"],
    authUser: { name: "Luis" },
    parseBody: async () => ({ kind, reason }),
    sendJson: (_, responseStatus, data) => ({ status: responseStatus, data }),
    notFound: () => ({ status: 404 }),
    auditLineKey: (line) => String(line.id || `${line.productId || line.sku || ""}::${line.locationBin || ""}`),
    syncPurchaseOrderReceivingProgress: async () => { synced += 1; },
    postgres: {
      isPostgresEnabled: () => true,
      readWarehouseAudit: async () => audit,
      saveWarehouseAudit: async (nextAudit) => { saved = structuredClone(nextAudit); }
    }
  };
  const response = await vm.runInNewContext(`(async()=>{${route}})()`, context);
  return { response, audit, saved, synced };
}

(async () => {
  const known = await run();
  assert.equal(known.response.status, 200);
  assert.equal(known.audit.lines.length, 0);
  assert.equal(known.audit.purchaseOrderExpectedLines.length, 1, "Removing a scan must preserve the PO requirement.");
  assert.equal(known.audit.removedItems[0].sku, "SKU-1");
  assert.equal(known.audit.removedItems[0].removedBy, "Luis");
  assert.equal(known.audit.removedItems[0].reason, "Scanned wrong item");
  assert.equal(known.audit.lifecycleEvents[0].type, "audit_item_removed");
  assert.equal(known.synced, 1);

  const unknown = await run({ kind: "unknown", lineKey: "unknown" });
  assert.equal(unknown.response.status, 200);
  assert.equal(unknown.audit.unknownBarcodes.length, 0);
  assert.equal(unknown.audit.removedItems[0].barcode, "012345678905");
  assert.equal(unknown.audit.removedItems[0].countedQty, 2);

  for (const options of [
    { lineKey: "expected" },
    { lineKey: "missing" },
    { status: "completed" }
  ]) {
    const result = await run(options);
    assert.equal(result.response.status, options.status === "completed" ? 400 : 404);
    assert.equal(result.saved, undefined);
    assert.equal(result.synced, 0);
  }

  console.log("Warehouse audit item removal: known and unknown scans, PO preservation, history, and closed-audit guards passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
