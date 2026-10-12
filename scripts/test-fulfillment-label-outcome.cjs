const assert = require("node:assert/strict");
const { activeLabelFailure, releaseUnstartedLabelRows } = require("../lib/fulfillment-label-outcome");

const failure = {
  status: "failed",
  error: "Carrier rejected the saved shipment token.",
  occurredAt: "2026-10-08T20:00:00.000Z"
};

assert.deepEqual(activeLabelFailure(failure, null), {
  message: failure.error,
  occurredAt: failure.occurredAt
});
assert.deepEqual(activeLabelFailure(failure, {
  selectedRate: { id: "fresh-rate" },
  ratedAt: "2026-10-08T19:59:59.000Z"
}), {
  message: failure.error,
  occurredAt: failure.occurredAt
});
assert.equal(activeLabelFailure(failure, {
  selectedRate: { id: "fresh-rate" },
  ratedAt: "2026-10-08T20:01:00.000Z"
}), null);
assert.equal(activeLabelFailure(failure, {
  selectedRate: { id: "fresh-rate" },
  attemptedAt: "2026-10-08T20:01:00.000Z"
}), null);
assert.deepEqual(activeLabelFailure(failure, {
  ratedAt: "2026-10-08T20:01:00.000Z"
}), {
  message: failure.error,
  occurredAt: failure.occurredAt
});
assert.equal(activeLabelFailure({ status: "purchased", occurredAt: failure.occurredAt }, null), null);

const interrupted = {
  rows: [
    { status: "rated" },
    { status: "queued" },
    { status: "processing" },
    { status: "label_pending" },
    { status: "purchased", documentId: "label" }
  ]
};
assert.equal(releaseUnstartedLabelRows(interrupted, {
  now: "2026-10-11T20:00:00.000Z",
  actor: "Recovery",
  message: "Purchase interrupted."
}), 2);
assert.deepEqual(interrupted.rows.slice(0, 2).map((row) => row.status), ["failed", "failed"]);
assert.ok(interrupted.rows.slice(0, 2).every((row) => row.releasedAt === "2026-10-11T20:00:00.000Z"));
assert.equal(interrupted.rows[2].status, "processing", "an uncertain carrier request must remain held for verification");
assert.equal(interrupted.rows[3].status, "label_pending", "accepted Temu packages stay in document recovery");
assert.equal(interrupted.rows[4].status, "purchased", "completed labels are never released");

console.log("Fulfillment label outcome tests passed.");
