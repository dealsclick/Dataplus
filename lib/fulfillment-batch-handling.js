function normalizeBatchHandlingStatus(batch = {}) {
  return String(batch.warehouseStatus || "").toLowerCase() === "closed" ? "closed" : "open";
}

function setBatchHandlingStatus(batch, status, { actor = "DataPlus", now = new Date() } = {}) {
  if (!batch || typeof batch !== "object") throw new Error("Shipping batch is required.");
  const nextStatus = String(status || "").trim().toLowerCase();
  if (!["open", "closed"].includes(nextStatus)) throw new Error("Batch status must be Open or Closed.");
  const previousStatus = normalizeBatchHandlingStatus(batch);
  if (previousStatus === nextStatus && batch.warehouseStatus) return { changed: false, previousStatus, status: nextStatus };

  const changedAt = now instanceof Date ? now.toISOString() : String(now);
  const changedBy = String(actor || "DataPlus");
  batch.warehouseStatus = nextStatus;
  batch.warehouseStatusUpdatedAt = changedAt;
  batch.warehouseStatusUpdatedBy = changedBy;
  if (nextStatus === "closed") {
    batch.warehouseClosedAt = changedAt;
    batch.warehouseClosedBy = changedBy;
  } else {
    batch.warehouseReopenedAt = changedAt;
    batch.warehouseReopenedBy = changedBy;
  }
  batch.warehouseStatusHistory = [
    { status: nextStatus, previousStatus, changedAt, changedBy },
    ...(Array.isArray(batch.warehouseStatusHistory) ? batch.warehouseStatusHistory : [])
  ].slice(0, 100);
  batch.updatedAt = changedAt;
  return { changed: true, previousStatus, status: nextStatus };
}

module.exports = { normalizeBatchHandlingStatus, setBatchHandlingStatus };
