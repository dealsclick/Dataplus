const assert = require("node:assert/strict");
const { isVoidedQuote, quotePipelineMetrics, visibleQuoteDrafts } = require("../lib/quote-pipeline");

const drafts = [
  { id: "draft", status: "draft", total: 100, salesOwner: "A", nextFollowUpAt: "2026-11-09T12:00:00.000Z" },
  { id: "sent", status: "sent", items: [{ qty: 2, price: 25 }], taxAmount: 5, salesOwner: "B" },
  { id: "approved", status: "accepted", total: 80, salesOwner: "A" },
  { id: "rejected", status: "lost", total: 40, salesOwner: "A" },
  { id: "voided", status: "voided", total: 99999, salesOwner: "A" },
  { id: "converted", status: "converted", total: 500, convertedOrderId: "order-1", salesOwner: "A" }
];

assert.equal(isVoidedQuote(drafts[4]), true);
assert.deepEqual(visibleQuoteDrafts(drafts).map((draft) => draft.id), ["draft", "sent", "approved", "rejected"]);
assert.deepEqual(visibleQuoteDrafts(drafts, "voided").map((draft) => draft.id), ["voided"]);

const metrics = quotePipelineMetrics(drafts, Date.parse("2026-11-10T12:00:00.000Z"));
assert.equal(metrics.totalCount, 4);
assert.equal(metrics.openCount, 2);
assert.equal(metrics.potentialSales, 155);
assert.equal(metrics.approvedCount, 1);
assert.equal(metrics.approvedValue, 80);
assert.equal(metrics.rejectedCount, 1);
assert.equal(metrics.rejectedValue, 40);
assert.equal(metrics.followUpsDue, 1);
assert.equal(metrics.winRate, 0.5);
assert.equal(metrics.byOwner.find((row) => row.owner === "A").winRate, 0.5);
assert.equal(metrics.byOwner.some((row) => row.potentialSales >= 99999), false);

console.log("Quote visibility and analytics tests passed.");
