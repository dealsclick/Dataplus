function timestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function activeLabelFailure(labelOutcome, rateReview) {
  if (String(labelOutcome?.status || "").toLowerCase() !== "failed") return null;

  const recoveredAt = rateReview?.selectedRate
    ? Math.max(timestamp(rateReview.ratedAt), timestamp(rateReview.attemptedAt))
    : 0;
  const failedAt = timestamp(labelOutcome.occurredAt);
  if (recoveredAt > failedAt) return null;

  return {
    message: labelOutcome.error || "The last label purchase failed.",
    occurredAt: labelOutcome.occurredAt || ""
  };
}

function releaseUnstartedLabelRows(batch, options = {}) {
  const now = String(options.now || new Date().toISOString());
  const actor = String(options.actor || "DataPlus recovery");
  const message = String(options.message || "The label purchase ended before the carrier request started. No label was purchased.");
  let released = 0;
  for (const row of Array.isArray(batch?.rows) ? batch.rows : []) {
    if (!new Set(["queued", "rated"]).has(String(row?.status || "").toLowerCase()) || row.releasedAt) continue;
    row.status = "failed";
    row.error = message;
    row.releasedAt = now;
    row.releasedBy = actor;
    row.releaseReason = message;
    row.updatedAt = now;
    released += 1;
  }
  if (released && batch) batch.updatedAt = now;
  return released;
}

module.exports = { activeLabelFailure, releaseUnstartedLabelRows };
