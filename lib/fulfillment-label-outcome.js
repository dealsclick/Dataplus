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

function retryReleasedLabelRows(batch, options = {}) {
  const now = String(options.now || new Date().toISOString());
  const actor = String(options.actor || "DataPlus operator");
  const requestedRouteIds = new Set((Array.isArray(options.routeIds) ? options.routeIds : []).map(String).filter(Boolean));
  let retried = 0;
  for (const row of Array.isArray(batch?.rows) ? batch.rows : []) {
    const routeIds = (Array.isArray(row?.routeIds) ? row.routeIds : [row?.routeId]).map(String).filter(Boolean);
    const requested = !requestedRouteIds.size || routeIds.some((routeId) => requestedRouteIds.has(routeId));
    const hasCarrierEvidence = Boolean(
      row?.documentId
      || row?.shipmentId
      || row?.trackingNumber
      || (Array.isArray(row?.packageSnList) && row.packageSnList.length)
    );
    if (!requested || String(row?.status || "").toLowerCase() !== "failed" || !row?.releasedAt || hasCarrierEvidence) continue;
    row.status = "queued";
    row.error = "";
    row.rates = [];
    row.selectedRate = null;
    row.ratedAt = "";
    row.retriedAt = now;
    row.retriedBy = actor;
    row.retryCount = Number(row.retryCount || 0) + 1;
    delete row.releasedAt;
    delete row.releasedBy;
    delete row.releaseReason;
    row.updatedAt = now;
    retried += 1;
  }
  if (retried && batch) {
    batch.phase = "rates";
    batch.status = "queued";
    batch.updatedAt = now;
  }
  return retried;
}

module.exports = { activeLabelFailure, releaseUnstartedLabelRows, retryReleasedLabelRows };
