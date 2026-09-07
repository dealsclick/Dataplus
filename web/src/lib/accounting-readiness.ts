type Source = {
  id: string; key: string; kind: string; amountMinor: number | null;
  certainty: string; postingPolicy?: string; capturedAt: string; returnId?: string;
}

// Observations are append-only; only the latest version of each source is current.
export function accountingReadiness(sources: Source[], returnId?: string) {
  const latest = [...new Map(sources.map(source => [source.key, source])).values()]
    .filter(source => !returnId || source.returnId === returnId)
  const findings = latest.flatMap(source => {
    const message = source.amountMinor === null || source.certainty === "unknown"
      ? "Amount unavailable or unverified"
      : source.certainty === "pending" ? "Pending source confirmation"
      : source.certainty === "estimated" ? "Estimate, not a confirmed amount" : ""
    return message ? [{ id: source.id, kind: source.kind, message, referenceOnly: source.postingPolicy === "reference_only" }] : []
  })
  return {
    captured: latest.length > 0,
    findings,
    reported: latest.filter(source => source.amountMinor !== null && source.certainty === "reported").length,
    latestCapture: latest.reduce((value, source) => source.capturedAt > value ? source.capturedAt : value, ""),
  }
}
