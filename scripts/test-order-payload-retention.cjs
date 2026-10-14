const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("zlib");
const { compactOrderForStorage, shipmentTrackingRecords, shipmentFinancialRecords, orderShippingRevenueRecord } = require("../lib/order-payload-retention");

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

const financials = shipmentFinancialRecords({
  ...compacted.order,
  orderNumber: "50001",
  channelSource: "Temu",
  currency: "usd",
  shippingCost: 8.25,
  address: { city: "Austin", state: "TX", postalCode: "78701", country: "US" },
  shipments: [{
    ...compacted.order.shipments[0],
    shippingCost: 8.25,
    labelRefundAmount: 1.25,
    carrierName: "UPS",
    service: "Ground",
    batchId: "BATCH-1001",
    package: { weight: 4, length: 12, width: 8, height: 6 }
  }]
});
assert.equal(financials.length, 1);
assert.equal(financials[0].estimatedShippingCost, 8.25);
assert.equal(financials[0].refundedCost, 1.25);
assert.equal(financials[0].destinationState, "TX");
assert.equal(financials[0].currency, "USD");
assert.equal(financials[0].batchId, "BATCH-1001");
assert.equal(financials[0].packageWeight, 4);
const unknownCost = shipmentFinancialRecords({ id: "order-no-cost", shipments: [{ id: "shipment-no-cost", provider: "veeqo" }] });
assert.equal(unknownCost[0].estimatedShippingCost, null, "missing shipment cost is not converted into a false zero");
assert.equal(unknownCost[0].quotedCost, null, "missing quote cost remains unknown");
const epochTimestamp = shipmentFinancialRecords({ id: "order-epoch", shipments: [{ id: "shipment-epoch", purchasedAt: "1786736425000" }] });
assert.equal(epochTimestamp[0].purchasedAt, "2026-08-14T19:40:25.000Z", "legacy epoch-millisecond timestamps become PostgreSQL-safe ISO values");

const explicitShippingRevenue = orderShippingRevenueRecord({ id: "order-revenue-1", shippingPaid: 12.5, shippingCost: 7.25, currency: "usd" });
assert.equal(explicitShippingRevenue.customerShippingPaid, 12.5, "customer-paid shipping revenue is not confused with label expense");
assert.equal(explicitShippingRevenue.sourceField, "shippingPaid");
const lineShippingRevenue = orderShippingRevenueRecord({ id: "order-revenue-2", shippingLines: [{ price: "3.25" }, { price: 2 }] });
assert.equal(lineShippingRevenue.customerShippingPaid, 5.25, "shipping line revenue is summed when no explicit collected value exists");
assert.equal(orderShippingRevenueRecord({ id: "order-revenue-3", shippingCost: 9 }).customerShippingPaid, null, "label cost is never used as customer shipping revenue");

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

const migrationSource = fs.readFileSync(path.join(__dirname, "backfill-order-shipment-tracking.cjs"), "utf8");
assert.match(migrationSource, /new Map\(rows\.map\(\(row\) => \[`\$\{row\.orderId\}:\$\{row\.shipmentId\}`/, "migration deduplicates legacy shipment IDs before upsert");
assert.match(migrationSource, /select distinct on \(order_id, shipment_id\)/, "migration also deduplicates legacy shipment IDs using database key semantics");

console.log("Order payload retention checks passed.");
