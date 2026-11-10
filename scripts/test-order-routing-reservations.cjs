const assert = require("node:assert/strict");
const { fulfillmentRouteReservationExpired } = require("../server");

const now = Date.parse("2026-11-10T12:00:00.000Z");

assert.equal(fulfillmentRouteReservationExpired({}, now), false);
assert.equal(fulfillmentRouteReservationExpired({ reservationExpiresAt: "" }, now), false);
assert.equal(fulfillmentRouteReservationExpired({ reservationExpiresAt: "not-a-date" }, now), false);
assert.equal(fulfillmentRouteReservationExpired({ reservationExpiresAt: "2026-11-10T13:00:00.000Z" }, now), false);
assert.equal(fulfillmentRouteReservationExpired({ reservationExpiresAt: "2026-11-10T11:00:00.000Z" }, now), true);

console.log("Order routing reservation tests passed.");
