const assert = require("node:assert/strict");
const {
  canonicalCarrierName,
  inferCarrierFromTracking,
  normalizeShipmentCarrier,
  normalizeTrackingNumber,
  validateCarrierService,
  walmartCarrierName,
  walmartMethodCode
} = require("../lib/shipping-carriers");

assert.equal(inferCarrierFromTracking("1Z999AA10123456784"), "UPS");
assert.equal(inferCarrierFromTracking("9400111899223856928499"), "USPS");
assert.equal(inferCarrierFromTracking("123456789012"), "FedEx");
assert.equal(inferCarrierFromTracking("TBA123456789012"), "Amazon Shipping");
assert.equal(inferCarrierFromTracking("GF6383377250020"), "GOFO");
assert.equal(inferCarrierFromTracking("1234567890"), "", "ambiguous numeric tracking is not guessed");
assert.equal(canonicalCarrierName("fed ex"), "FedEx");
assert.equal(normalizeTrackingNumber("1Z 999-AA"), "1Z999AA");
assert.equal(normalizeTrackingNumber("ab&12"), "AB12");
assert.deepEqual(normalizeShipmentCarrier({ carrier: "UPS", service: "ups ground", trackingNumber: "1Z999AA10123456784" }), {
  carrier: "UPS",
  carrierName: "UPS",
  service: "UPS Ground",
  trackingNumber: "1Z999AA10123456784",
  detectedCarrier: "UPS"
});
assert.equal(normalizeShipmentCarrier({ carrier: "UPS", service: "UPS Ground", trackingNumber: "1z 999-aa10123456784" }).trackingNumber, "1Z999AA10123456784");
assert.equal(normalizeShipmentCarrier({ carrier: "Other", carrierName: "Local Courier", service: "Same day", trackingNumber: "LOCAL1" }).carrier, "Other");
assert.throws(() => normalizeShipmentCarrier({ carrier: "USPS", service: "USPS Priority Mail", trackingNumber: "1Z999AA10123456784" }), /matches UPS/);
assert.equal(validateCarrierService("FedEx", "FedEx Ground"), true);
assert.equal(validateCarrierService("FedEx", "FedEx Ground Economy"), true);
assert.equal(normalizeShipmentCarrier({ carrier: "FedEx", service: "fedex ground economy", trackingNumber: "123456789012" }).service, "FedEx Ground Economy");
assert.equal(validateCarrierService("FedEx", "UPS Ground"), false);
assert.equal(walmartCarrierName("DHL eCommerce"), "DHL");
assert.equal(walmartCarrierName("Amazon Shipping"), "");
assert.equal(walmartMethodCode("standard"), "Standard");
assert.equal(walmartMethodCode("UPS Ground"), "Standard");

console.log("Shipping carrier tests passed.");
