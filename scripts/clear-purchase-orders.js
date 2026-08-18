const crypto = require("crypto");
const postgres = require("../db");

const confirmation = "DELETE_ALL_PURCHASE_ORDERS";

async function persistJob(job) {
  await postgres.upsertOperationJob(job);
  return job;
}

async function main() {
  if (process.env.CONFIRM_CLEAR_PURCHASE_ORDERS !== confirmation) {
    throw new Error(`Set CONFIRM_CLEAR_PURCHASE_ORDERS=${confirmation} to run this destructive maintenance task.`);
  }
  if (!postgres.isPostgresEnabled()) throw new Error("DATABASE_URL is required to clear purchase orders.");
  await postgres.initDatabase();

  const now = new Date().toISOString();
  const job = {
    id: crypto.randomUUID(),
    type: "maintenance",
    category: "Purchasing",
    status: "running",
    name: "Clear unused purchase orders",
    message: "Deleting all purchase orders and clearing order-side PO references.",
    source: "purchasing-maintenance",
    totalRows: 0,
    processed: 0,
    changed: 0,
    missing: 0,
    progress: 5,
    createdAt: now,
    startedAt: now,
    notes: "Authorized pre-launch reset. Customer orders are retained; only purchase orders and PO links are cleared."
  };
  await persistJob(job);

  try {
    const result = await postgres.clearPurchaseOrders();
    const endedAt = new Date().toISOString();
    await persistJob({
      ...job,
      status: "success",
      message: `Deleted ${result.purchaseOrdersDeleted} purchase orders and cleared PO links from ${result.ordersUpdated} orders. Next PO is ${result.nextPoNumber}.`,
      totalRows: result.purchaseOrdersDeleted,
      processed: result.purchaseOrdersDeleted,
      changed: result.purchaseOrdersDeleted + result.ordersUpdated,
      progress: 100,
      endedAt,
      result
    });
    process.stdout.write(`${JSON.stringify({ jobId: job.id, ...result }, null, 2)}\n`);
  } catch (error) {
    await persistJob({
      ...job,
      status: "failed",
      message: error.message || String(error),
      progress: 0,
      endedAt: new Date().toISOString()
    });
    throw error;
  }
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message || error}\n`);
    process.exitCode = 1;
  })
  .finally(() => postgres.closePool());
