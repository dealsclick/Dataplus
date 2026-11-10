const assert = require("node:assert/strict");
const { fulfillmentRouteReservationExpired, orderNeedsAutomaticRouting } = require("../server");

const now = Date.parse("2026-11-10T12:00:00.000Z");

assert.equal(fulfillmentRouteReservationExpired({}, now), false);
assert.equal(fulfillmentRouteReservationExpired({ reservationExpiresAt: "" }, now), false);
assert.equal(fulfillmentRouteReservationExpired({ reservationExpiresAt: "not-a-date" }, now), false);
assert.equal(fulfillmentRouteReservationExpired({ reservationExpiresAt: "2026-11-10T13:00:00.000Z" }, now), false);
assert.equal(fulfillmentRouteReservationExpired({ reservationExpiresAt: "2026-11-10T11:00:00.000Z" }, now), true);

const routedOrder = {
  status: "paid",
  financialStatus: "paid",
  operationalStatus: "ready_to_ship",
  items: [{ sku: "LIVE-1", qty: 1 }],
  fulfillmentRoutes: [{ type: "warehouse", status: "allocated", lineIndex: 0, qty: 1 }]
};
assert.equal(orderNeedsAutomaticRouting(routedOrder, now), false, "a warehouse route with no expiration must not re-enter the queue");
assert.equal(orderNeedsAutomaticRouting({
  ...routedOrder,
  fulfillmentRoutes: [{ ...routedOrder.fulfillmentRoutes[0], reservationExpiresAt: "2026-11-10T11:00:00.000Z" }]
}, now), true, "an explicitly expired reservation must be routed again");

console.log("Order routing reservation tests passed.");
