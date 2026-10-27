const assert = require("node:assert/strict")

const { parseTrackingResponse } = require("../lib/ups-rating")

function response(currentStatus, activities = []) {
  return {
    trackResponse: {
      shipment: [{
        package: [{
          trackingNumber: "1Z999AA10123456784",
          currentStatus: { description: currentStatus },
          activity: activities,
        }],
      }],
    },
  }
}

const labelCreated = parseTrackingResponse(response("Label Created", [{
  logicalScan: true,
  gmtDate: "20261027",
  gmtTime: "101500",
  gmtOffset: "-04:00",
  status: { description: "Shipper created a label, UPS has not received the package yet." },
}]), "1Z999AA10123456784")
assert.equal(labelCreated.status, "awaiting_pickup")
assert.equal(labelCreated.physicalScan, false)
assert.equal(labelCreated.physicalScanAt, "")

const originScan = parseTrackingResponse(response("On the Way", [{
  logicalScan: false,
  gmtDate: "20261027",
  gmtTime: "111500",
  gmtOffset: "-04:00",
  status: { description: "Origin Scan" },
}]), "1Z999AA10123456784")
assert.equal(originScan.status, "in_transit")
assert.equal(originScan.physicalScan, true)
assert.equal(originScan.physicalScanAt, "2026-10-27T15:15:00.000Z")

const delivered = parseTrackingResponse(response("Delivered", [{
  logicalScan: false,
  gmtDate: "20261028",
  gmtTime: "151500",
  gmtOffset: "-04:00",
  status: { description: "Delivered" },
}]), "1Z999AA10123456784")
assert.equal(delivered.status, "delivered")
assert.equal(delivered.physicalScan, true)

console.log("UPS tracking parser tests passed")
