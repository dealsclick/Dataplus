const ACTIVE_QUOTE_STATUSES = new Set(["draft", "reviewing", "quoted", "sent"]);
const APPROVED_QUOTE_STATUSES = new Set(["accepted"]);
const REJECTED_QUOTE_STATUSES = new Set(["lost"]);
const VOIDED_QUOTE_STATUSES = new Set(["void", "voided"]);

function quoteStatus(value) {
  const normalized = String(value || "draft").trim().toLowerCase();
  if (normalized === "approved") return "accepted";
  if (normalized === "rejected") return "lost";
  if (normalized === "void") return "voided";
  return normalized || "draft";
}

function quoteTotal(draft = {}) {
  if (draft.total !== null && draft.total !== undefined && draft.total !== "" && Number.isFinite(Number(draft.total))) {
    return Number(draft.total);
  }
  const itemTotal = (Array.isArray(draft.items) ? draft.items : [])
    .reduce((sum, item) => sum + Number(item?.price || 0) * Number(item?.qty || 0), 0);
  return itemTotal + Number(draft.shippingEstimate?.amount || 0) + Number(draft.taxAmount || 0);
}

function isVoidedQuote(draft = {}) {
  return VOIDED_QUOTE_STATUSES.has(quoteStatus(draft.status));
}

function visibleQuoteDrafts(drafts, visibility = "active") {
  const rows = Array.isArray(drafts) ? drafts : [];
  if (String(visibility || "").trim().toLowerCase() === "voided") return rows.filter(isVoidedQuote);
  return rows.filter((draft) => !draft?.convertedOrderId && !isVoidedQuote(draft));
}

function quotePipelineMetrics(drafts, now = Date.now()) {
  const rows = visibleQuoteDrafts(drafts, "active");
  const owners = new Map();
  const summary = {
    totalCount: rows.length,
    openCount: 0,
    potentialSales: 0,
    approvedCount: 0,
    approvedValue: 0,
    rejectedCount: 0,
    rejectedValue: 0,
    followUpsDue: 0,
    winRate: null,
    byOwner: []
  };
  for (const draft of rows) {
    const status = quoteStatus(draft.status);
    const total = quoteTotal(draft);
    const owner = String(draft.salesOwner || "").trim() || "Unassigned";
    const ownerRow = owners.get(owner) || {
      owner,
      totalCount: 0,
      openCount: 0,
      potentialSales: 0,
      approvedCount: 0,
      approvedValue: 0,
      rejectedCount: 0,
      rejectedValue: 0,
      winRate: null
    };
    ownerRow.totalCount += 1;
    if (ACTIVE_QUOTE_STATUSES.has(status)) {
      summary.openCount += 1;
      summary.potentialSales += total;
      ownerRow.openCount += 1;
      ownerRow.potentialSales += total;
      const followUpAt = Date.parse(String(draft.nextFollowUpAt || ""));
      if (Number.isFinite(followUpAt) && followUpAt <= Number(now)) summary.followUpsDue += 1;
    } else if (APPROVED_QUOTE_STATUSES.has(status)) {
      summary.approvedCount += 1;
      summary.approvedValue += total;
      ownerRow.approvedCount += 1;
      ownerRow.approvedValue += total;
    } else if (REJECTED_QUOTE_STATUSES.has(status)) {
      summary.rejectedCount += 1;
      summary.rejectedValue += total;
      ownerRow.rejectedCount += 1;
      ownerRow.rejectedValue += total;
    }
    owners.set(owner, ownerRow);
  }
  const closedCount = summary.approvedCount + summary.rejectedCount;
  summary.winRate = closedCount ? summary.approvedCount / closedCount : null;
  summary.byOwner = [...owners.values()].map((row) => {
    const closed = row.approvedCount + row.rejectedCount;
    return { ...row, winRate: closed ? row.approvedCount / closed : null };
  }).sort((left, right) => right.approvedValue - left.approvedValue || right.potentialSales - left.potentialSales || left.owner.localeCompare(right.owner));
  return summary;
}

module.exports = {
  ACTIVE_QUOTE_STATUSES,
  APPROVED_QUOTE_STATUSES,
  REJECTED_QUOTE_STATUSES,
  VOIDED_QUOTE_STATUSES,
  isVoidedQuote,
  quotePipelineMetrics,
  quoteStatus,
  quoteTotal,
  visibleQuoteDrafts
};
