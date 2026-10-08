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

module.exports = { activeLabelFailure };
