const assert = require("assert");
const { veeqoShipmentTrackingDetails } = require("../lib/veeqo-tracking");

assert.deepEqual(
  veeqoShipmentTrackingDetails({
    tracking_number: {
      tracking_number: "778899001122",
      carrier_name: "FedEx",
      tracking_url: "https://example.test/778899001122"
    }
  }),
  {
    trackingNumber: "778899001122",
    carrier: "FedEx",
    trackingUrl: "https://example.test/778899001122"
  }
);

assert.deepEqual(
  veeqoShipmentTrackingDetails({
    tracking: { number: "1Z999AA10123456784" },
    carrier: { name: "UPS" }
  }),
  {
    trackingNumber: "1Z999AA10123456784",
    carrier: "UPS",
    trackingUrl: ""
  }
);

assert.deepEqual(
  veeqoShipmentTrackingDetails(
    { tracking_number: {}, carrier: {} },
    { trackingNumber: "9341900000000000000000", carrier: "USPS", trackingUrl: "https://tools.usps.com/" }
  ),
  {
    trackingNumber: "9341900000000000000000",
    carrier: "USPS",
    trackingUrl: "https://tools.usps.com/"
  }
);

assert.equal(veeqoShipmentTrackingDetails({ tracking_number: { pending: true } }).trackingNumber, "");

console.log("Veeqo tracking tests passed.");
