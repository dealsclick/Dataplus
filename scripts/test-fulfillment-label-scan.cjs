const assert = require("node:assert")
const {
  findShippingLabelMatches,
  normalizeLabelScanCode,
  packageShipmentStatus,
  recordShipmentLabelScan,
} = require("../lib/fulfillment-label-scan")
const { shouldSyncRecoveredTracking } = require("../lib/fulfillment-tracking")

assert.equal(normalizeLabelScanCode(" 1Z-123 456 \n"), "1z123456")

const order = {
  id: "order-1",
  orderNumber: "55303",
  status: "new",
  shipments: [{ id: "shipment-1", status: "label_purchased", trackingNumber: "1Z-123 456", labelPurchaseId: "label-1" }],
}
let matches = findShippingLabelMatches([order], "1z123456")
assert.equal(matches.length, 1)
assert.equal(matches[0].matchedBy, "tracking_number")
matches = findShippingLabelMatches([order], "55303")
assert.equal(matches.length, 1)
assert.equal(matches[0].matchedBy, "order_number")

const secondOrder = { id: "order-2", orderNumber: "55304", shipments: [{ id: "shipment-2", trackingNumber: "1Z123456" }] }
assert.equal(findShippingLabelMatches([order, secondOrder], "1Z123456").length, 2)
const multiPackageOrder = { id: "order-3", orderNumber: "55305", shipments: [{ id: "shipment-3", trackingNumber: "TRACK-3" }, { id: "shipment-4", trackingNumber: "TRACK-4" }] }
assert.equal(findShippingLabelMatches([multiPackageOrder], "55305").length, 2, "an order-number scan must require a tracking barcode when the order has multiple packages")

assert.deepEqual(packageShipmentStatus(order, order.shipments[0]), {
  code: "not_shipped",
  label: "Not shipped",
  shipped: false,
  delivered: false,
  occurredAt: "",
  source: "package",
})
assert.equal(packageShipmentStatus(order, { ...order.shipments[0], trackingStatus: "in_transit" }).shipped, true)
assert.equal(packageShipmentStatus(order, { ...order.shipments[0], deliveredAt: "2026-10-27T12:00:00.000Z" }).code, "delivered")

const shipment = { id: "shipment-1", status: "label_purchased", trackingNumber: "1Z123456" }
let scan = recordShipmentLabelScan(shipment, { scanId: "scan-1", scannedBy: "Luis", code: "1Z123456", matchedBy: "tracking_number" }, new Date("2026-10-27T12:00:00.000Z"))
assert.equal(scan.recorded, true)
assert.equal(scan.addedPrintEvidence, true)
assert.equal(shipment.labelPrintCount, undefined, "a scan must not impersonate a print action")
assert.equal(shipment.labelScanCount, 1)
assert.equal(shipment.labelScanEvidenceSource, "physical_scan")
assert.equal(shipment.labelPrintedAt, undefined, "scan evidence must not trigger marketplace tracking recovery")
assert.equal(shouldSyncRecoveredTracking(shipment), false, "a scan alone must not notify the marketplace of shipment")
assert.equal(shipment.status, "label_purchased", "a physical scan must not change shipment status")

scan = recordShipmentLabelScan(shipment, { scanId: "scan-1", scannedBy: "Luis", code: "1Z123456" }, new Date("2026-10-27T12:00:01.000Z"))
assert.equal(scan.recorded, false)
assert.equal(shipment.labelPrintCount, undefined)
assert.equal(shipment.labelScanCount, 1)

scan = recordShipmentLabelScan(shipment, { scanId: "scan-2", scannedBy: "Luis", code: "1Z123456" }, new Date("2026-10-27T12:01:00.000Z"))
assert.equal(scan.recorded, true)
assert.equal(scan.addedPrintEvidence, false)
assert.equal(shipment.labelPrintCount, undefined, "repeat scans must not become reprints")
assert.equal(shipment.labelScanCount, 2)

console.log("Fulfillment label scan tests passed.")
