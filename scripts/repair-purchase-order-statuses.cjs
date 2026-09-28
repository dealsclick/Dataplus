const postgres = require("../db");
const { restorePurchaseOrderStatusFromEvidence } = require("../server");

async function main() {
  if (!postgres.isPostgresEnabled()) throw new Error("DATABASE_URL is required.");
  const apply = process.argv.includes("--apply");
  await postgres.initDatabase();
  const purchaseOrders = await postgres.listPurchaseOrders({ limit: 10000, includeDeleted: true }) || [];
  const repairs = [];
  for (const po of purchaseOrders) {
    const previousStatus = String(po.status || "draft").trim().toLowerCase();
    let changed = false;
    if (previousStatus === "deleted") {
      po.status = "canceled";
      po.workflowStage = "history";
      po.legacyDeletedStatusRecoveredAt = new Date().toISOString();
      po.timeline = Array.isArray(po.timeline) ? po.timeline : [];
      po.timeline.push({
        id: require("node:crypto").randomUUID(),
        type: "status_recovered",
        title: "Legacy deleted status recovered",
        message: "This purchase order was restored to permanent canceled history. Its record is no longer hidden as deleted.",
        user: "PO lifecycle repair",
        createdAt: new Date().toISOString(),
      });
      changed = true;
    } else {
      changed = restorePurchaseOrderStatusFromEvidence(po);
    }
    if (!changed) continue;
    repairs.push({ id: po.id, poNumber: po.poNumber, previousStatus, nextStatus: po.status });
    if (apply) await postgres.savePurchaseOrder(po, { allowStatusRegression: true });
  }
  process.stdout.write(`${JSON.stringify({ mode: apply ? "apply" : "dry-run", scanned: purchaseOrders.length, repaired: repairs.length, repairs }, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message || error}\n`);
    process.exitCode = 1;
  })
  .finally(() => postgres.closePool());
