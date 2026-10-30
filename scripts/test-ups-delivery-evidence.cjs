const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const { storeUpsDeliveryEvidence } = require("../lib/ups-delivery-evidence")

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dataplus-ups-evidence-"))
try {
  const order = { id: "order-1", documents: [] }
  const shipment = { id: "shipment-1", trackingNumber: "1Z999AA10123456784", documents: [] }
  const tracking = {
    trackingNumber: shipment.trackingNumber,
    status: "delivered",
    statusDescription: "Delivered",
    latestActivity: "Delivered",
    latestActivityAt: "2026-10-30T17:00:00.000Z",
    transactionId: "transaction-1",
    activities: [{ description: "Delivered", occurredAt: "2026-10-30T17:00:00.000Z", physical: true }],
    deliveryEvidence: {
      deliveredAt: "2026-10-30T17:00:00.000Z",
      location: "Front Door",
      receivedBy: "J SMITH",
      hasProofOfDelivery: true,
      hasDeliveryPhoto: true,
      hasSignatureImage: true,
      artifacts: [
        { kind: "proof_of_delivery", contentBase64: Buffer.from("%PDF-proof").toString("base64") },
        { kind: "delivery_photo", contentBase64: Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString("base64") },
        { kind: "signature_confirmation", contentBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64") },
      ],
    },
  }
  const first = storeUpsDeliveryEvidence(order, shipment, tracking, {
    attachmentDir: directory,
    attachmentUrl: (id) => `/api/orders/order-1/attachments/${id}`,
    capturedAt: "2026-10-30T17:01:00.000Z",
  })
  assert.equal(first.documents.length, 4)
  assert.equal(first.evidence.receivedBy, "J SMITH")
  assert.equal(first.evidence.hasProofOfDelivery, true)
  assert.equal(first.evidence.hasDeliveryPhoto, true)
  assert.equal(first.evidence.hasSignatureImage, true)
  assert.equal(order.documents.length, 4)
  assert.equal(shipment.documents.length, 4)
  for (const document of first.documents) assert.equal(fs.existsSync(path.join(directory, document.storageKey)), true)

  const ids = new Set(first.documents.map((document) => document.id))
  const second = storeUpsDeliveryEvidence(order, shipment, tracking, {
    attachmentDir: directory,
    attachmentUrl: (id) => `/api/orders/order-1/attachments/${id}`,
    capturedAt: "2026-10-30T17:02:00.000Z",
  })
  assert.equal(second.documents.length, 4)
  assert.deepEqual(new Set(second.documents.map((document) => document.id)), ids)
  assert.equal(order.documents.length, 4)
  assert.equal(shipment.documents.length, 4)
  console.log("UPS delivery evidence tests passed")
} finally {
  fs.rmSync(directory, { recursive: true, force: true })
}
