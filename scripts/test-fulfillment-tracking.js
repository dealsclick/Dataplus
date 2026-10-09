const assert = require("assert")
const {
  carrierStatusConfirmsShipment,
  normalizeCarrierTrackingStatus,
  shouldSyncRecoveredTracking,
  veeqoRemoteTrackingStatus
} = require("../lib/fulfillment-tracking")

assert.equal(normalizeCarrierTrackingStatus("label_purchased"), "awaiting_pickup")
assert.equal(normalizeCarrierTrackingStatus("pre transit"), "awaiting_pickup")
assert.equal(normalizeCarrierTrackingStatus("in-transit"), "in_transit")
assert.equal(normalizeCarrierTrackingStatus("out for delivery"), "in_transit")
assert.equal(normalizeCarrierTrackingStatus("delivered"), "delivered")
assert.equal(normalizeCarrierTrackingStatus("cancelled"), "voided")
assert.equal(carrierStatusConfirmsShipment("label_purchased"), false)
assert.equal(carrierStatusConfirmsShipment("in_transit"), true)
assert.equal(carrierStatusConfirmsShipment("delivered"), true)
assert.equal(veeqoRemoteTrackingStatus({ tracking_status: "in_transit", status: "purchased" }), "in_transit")
assert.equal(shouldSyncRecoveredTracking({ trackingNumber: "1Z999", labelPrintedAt: "2026-10-09T12:00:00Z", channelSync: { status: "failed" } }), true)
assert.equal(shouldSyncRecoveredTracking({ trackingNumber: "1Z999", labelPrintedAt: "", channelSync: { status: "failed" } }), false)
assert.equal(shouldSyncRecoveredTracking({ trackingNumber: "1Z999", labelPrintedAt: "2026-10-09T12:00:00Z", channelSync: { status: "sent" } }), false)
assert.equal(shouldSyncRecoveredTracking({ trackingNumber: "", labelPrintedAt: "2026-10-09T12:00:00Z", channelSync: { status: "failed" } }), false)

console.log("Fulfillment tracking tests passed.")
