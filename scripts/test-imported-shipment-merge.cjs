const assert = require("node:assert/strict");
const { mergeImportedShipments, shipmentsMatch } = require("../lib/imported-shipment-merge");

const stored = {
  id: "local-label-1",
  trackingNumber: "1Z 999-ABC",
  provider: "temu",
  labelSource: "temu",
  shippingCost: 3.3,
  package: { weight: 2, length: 12, width: 8, height: 4 },
  packageSnList: ["PK-100"],
  documents: [{ documentId: "label-1", documentType: "shipping_label" }],
  fulfillmentBatchId: "BATCH-100"
};
const imported = {
  id: "remote-shipment-1",
  remoteShipmentId: "REMOTE-1",
  trackingNumber: "1Z999ABC",
  packageSn: "PK-100",
  provider: "temu",
  status: "shipped",
  trackingStatus: "in_transit",
  shippingCost: 0
};

assert.equal(shipmentsMatch(stored, imported), true);
const merged = mergeImportedShipments([stored], [imported]);
assert.equal(merged.length, 1, "the marketplace refresh updates the purchased label instead of duplicating it");
assert.equal(merged[0].id, "local-label-1");
assert.equal(merged[0].shippingCost, 3.3);
assert.deepEqual(merged[0].package, stored.package);
assert.equal(merged[0].documents.length, 1);
assert.equal(merged[0].fulfillmentBatchId, "BATCH-100");
assert.equal(merged[0].trackingStatus, "in_transit");

const firstLabel = { id: "label-a", reference: "ORDER-1", trackingNumber: "TRACK-A" };
const secondLabel = { id: "label-b", reference: "ORDER-1", trackingNumber: "TRACK-B" };
assert.equal(shipmentsMatch(firstLabel, secondLabel), false, "different labels on the same order stay separate");
assert.equal(mergeImportedShipments([firstLabel], [secondLabel]).length, 2);

const storedByPackage = { id: "local-package", packageSnList: ["PK-200"], shippingCost: 4.5 };
const importedByPackage = { id: "remote-package", packageSn: "pk-200", status: "shipped" };
assert.equal(mergeImportedShipments([storedByPackage], [importedByPackage]).length, 1);

console.log("Imported shipment merge checks passed.");
