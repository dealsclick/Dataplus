const assert = require("node:assert/strict");
const { activeLabelFailure } = require("../lib/fulfillment-label-outcome");

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

console.log("Fulfillment label outcome tests passed.");
