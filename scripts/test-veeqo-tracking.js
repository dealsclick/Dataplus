const assert = require("assert");
const { veeqoRemoteShipmentId, veeqoShipmentFromResponse, veeqoShipmentTrackingDetails } = require("../lib/veeqo-tracking");

const directShipment = {
  remote_shipment_id: "prb01a3020f",
  tracking_number: "778899001122",
  carrier: "FedEx",
  charges: [{ chargeType: "MANDATORY", value: "14.93" }],
  documents: [{ type: "LABEL", url: "https://example.test/label.pdf" }]
};
assert.equal(veeqoShipmentFromResponse(directShipment), directShipment);
assert.equal(veeqoShipmentTrackingDetails(veeqoShipmentFromResponse(directShipment)).trackingNumber, "778899001122");

const successfulShipment = { remote_shipment_id: "prb02", tracking_number: "1Z999AA10123456784" };
assert.equal(veeqoShipmentFromResponse({ successful: { prb02: successfulShipment }, failed: {} }), successfulShipment);

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

assert.equal(
  veeqoRemoteShipmentId(
    { provider: "veeqo", remoteShipmentId: "" },
    { selectedRate: { provider: "veeqo", remoteShipmentId: "prb-batch-1026" } }
  ),
  "prb-batch-1026"
);

assert.equal(
  veeqoRemoteShipmentId(
    { provider: "veeqo" },
    { selectedRate: { raw: { remote_shipment_id: "prb-legacy-rate" } } }
  ),
  "prb-legacy-rate"
);

assert.equal(
  veeqoRemoteShipmentId(
    { provider: "veeqo" },
    { selectedRate: {}, rates: [{ provider: "veeqo", raw: { remote_shipment_id: "prb-rate-list" } }] }
  ),
  "prb-rate-list"
);

console.log("Veeqo tracking tests passed.");
