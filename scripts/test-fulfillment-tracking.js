const assert = require("assert")
const {
  carrierStatusConfirmsShipment,
  normalizeCarrierTrackingStatus,
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

console.log("Fulfillment tracking tests passed.")
