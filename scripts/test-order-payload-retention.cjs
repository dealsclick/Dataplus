const assert = require("node:assert/strict");
const zlib = require("zlib");
const { compactOrderForStorage, shipmentTrackingRecords } = require("../lib/order-payload-retention");

const source = {
  id: "order-1",
  status: "shipped",
  external: {
    source: "Temu",
    parentOrderSn: "PO-1",
    shipmentResult: { result: { packageSnList: ["PK-1"], trackingNumber: "9400000000000000000000" }, large: "x".repeat(5000) }
  },
  shipments: [{
    id: "shipment-1",
    provider: "veeqo",
    status: "shipped",
    trackingStatus: "in_transit",
    trackingNumber: "1Z9999999999999999",
    trackingCheckedAt: "2026-10-09T12:00:00.000Z",
    remoteShipmentId: "remote-1",
    raw: { response: "y".repeat(5000) },
    packages: [{ packageSn: "PK-1", status: "shipped", raw: { duplicate: "z".repeat(5000) } }],
    documents: [{ documentType: "shipping_label", documentId: "doc-1" }]
  }],
  shippingRateActivity: Array.from({ length: 30 }, (_, index) => ({
    id: `rate-${index}`,
    details: { responseBody: "r".repeat(2000), rateId: `R-${index}` }
  }))
};

const compacted = compactOrderForStorage(source);
assert.equal(compacted.order.external.source, "Temu");
assert.equal(compacted.order.external.shipmentResult, undefined);
assert.deepEqual(compacted.order.external.packageSnList, ["PK-1"]);
assert.equal(compacted.order.shipments[0].raw, undefined);
assert.equal(compacted.order.shipments[0].packages[0].raw, undefined);
assert.deepEqual(compacted.order.shipments[0].packageSnList, ["PK-1"]);
assert.equal(compacted.order.shippingRateActivity.length, 20);
assert.ok(compacted.archives.length >= 3);
for (const archive of compacted.archives) {
  assert.ok(archive.compressedBytes < archive.originalBytes);
  assert.doesNotThrow(() => JSON.parse(zlib.gunzipSync(archive.payload).toString("utf8")));
}

const tracking = shipmentTrackingRecords(compacted.order);
assert.equal(tracking.length, 1);
assert.equal(tracking[0].monitoringComplete, false, "shipped/in-transit shipments remain monitored until delivered");
assert.ok(tracking[0].nextCheckAt instanceof Date);

const delivered = shipmentTrackingRecords({
  id: "order-2",
  shipments: [{ id: "shipment-2", provider: "veeqo", status: "delivered", trackingNumber: "TRACKED" }]
});
assert.equal(delivered[0].monitoringComplete, true);
assert.equal(delivered[0].nextCheckAt, null);

const temuMissing = shipmentTrackingRecords({
  id: "order-3",
  shipments: [{ id: "shipment-3", provider: "temu", status: "label_purchased", packageSnList: ["PK-3"] }]
});
assert.equal(temuMissing[0].monitoringComplete, false);
assert.ok(temuMissing[0].nextCheckAt instanceof Date);

const embeddedOnly = compactOrderForStorage({
  id: "order-4",
  shipments: [{ id: "shipment-4", provider: "veeqo", raw: { labelBase64: "A".repeat(2000) }, documents: [] }]
});
assert.equal(embeddedOnly.order.shipments[0].raw.labelBase64.length, 2000, "an embedded label is retained until an attachment exists");
assert.match(embeddedOnly.order.shipments[0].payloadRetentionPending, /attachment/i);

console.log("Order payload retention checks passed.");
