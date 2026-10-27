function text(value) {
  return String(value || "").trim()
}

function normalizeLabelScanCode(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]/g, "")
}

function shipmentScanIdentifiers(shipment = {}) {
  return [
    ["tracking_number", shipment.trackingNumber || shipment.tracking_number],
    ["shipment_id", shipment.id || shipment.shipmentId],
    ["remote_shipment_id", shipment.remoteShipmentId || shipment.remote_shipment_id],
    ["label_purchase_id", shipment.labelPurchaseId || shipment.label_purchase_id],
    ...([shipment.packageSn, ...(Array.isArray(shipment.packageSns) ? shipment.packageSns : [])]
      .filter(Boolean)
      .map((value) => ["package_id", value]))
  ].map(([kind, value]) => ({ kind, value: text(value), normalized: normalizeLabelScanCode(value) })).filter((entry) => entry.normalized)
}

function orderScanIdentifiers(order = {}) {
  return [
    ["order_id", order.id],
    ["order_number", order.orderNumber],
    ["internal_order_number", order.internalOrderNumber],
    ["channel_order_number", order.channelOrderNumber],
    ["marketplace_order_number", order.marketplaceOrderNumber],
    ["marketplace_order_id", order.marketplaceOrderId]
  ].map(([kind, value]) => ({ kind, value: text(value), normalized: normalizeLabelScanCode(value) })).filter((entry) => entry.normalized)
}

function activeLabelShipments(order = {}) {
  return (Array.isArray(order.shipments) ? order.shipments : []).filter((shipment) => {
    if (String(shipment?.voidStatus || "").toLowerCase() === "voided") return false
    return Boolean(shipmentScanIdentifiers(shipment).length || shipment?.documents?.length || shipment?.labelPurchasedAt || shipment?.labelPurchaseId)
  })
}

function findShippingLabelMatches(orders = [], code = "") {
  const normalized = normalizeLabelScanCode(code)
  if (!normalized) return []
  const matches = []
  for (const order of Array.isArray(orders) ? orders : []) {
    const shipments = activeLabelShipments(order)
    for (const shipment of shipments) {
      const identifier = shipmentScanIdentifiers(shipment).find((entry) => entry.normalized === normalized)
      if (identifier) matches.push({ order, shipment, matchedBy: identifier.kind, matchedValue: identifier.value })
    }
    if (!matches.some((entry) => entry.order === order)) {
      const identifier = orderScanIdentifiers(order).find((entry) => entry.normalized === normalized)
      if (identifier) {
        for (const shipment of shipments) matches.push({ order, shipment, matchedBy: identifier.kind, matchedValue: identifier.value })
      }
    }
  }
  const unique = new Map()
  for (const match of matches) unique.set(`${text(match.order?.id)}:${text(match.shipment?.id)}:${normalizeLabelScanCode(match.shipment?.trackingNumber)}`, match)
  return [...unique.values()]
}

function statusToken(value) {
  return text(value).toLowerCase().replace(/[\s-]+/g, "_")
}

const DELIVERED_STATUSES = new Set(["delivered", "delivery_complete", "completed_delivery"])
const SHIPPED_STATUSES = new Set(["shipped", "fulfilled", "completed", "complete", "closed", "in_transit", "intransit", "out_for_delivery", "picked_up", "accepted", "carrier_accepted", "departed"])
const CARRIER_EXCEPTION_STATUSES = new Set(["delayed", "delivery_exception"])
const CANCELED_STATUSES = new Set(["void", "voided", "cancelled", "canceled"])
const LABEL_STATUSES = new Set(["label_created", "label_purchased", "purchased", "awaiting_pickup", "label_pending", "label_generating", "purchase_processing", "ready_to_ship"])

function packageShipmentStatus(order = {}, shipment = {}) {
  const carrierStatuses = [shipment.trackingStatus, shipment.carrierStatus].map(statusToken).filter(Boolean)
  const shipmentStatuses = [shipment.trackingStatus, shipment.carrierStatus, shipment.status, shipment.fulfillmentStatus].map(statusToken).filter(Boolean)
  const oneShipment = activeLabelShipments(order).length === 1
  const orderStatuses = oneShipment ? [order.fulfillmentStatus, order.operationalStatus, order.workflowStatus, order.status].map(statusToken).filter(Boolean) : []
  const allStatuses = [...shipmentStatuses, ...orderStatuses]
  const deliveredAt = text(shipment.deliveredAt || (oneShipment ? order.deliveredAt : ""))
  const shippedAt = text(shipment.shippedAt || shipment.carrierConfirmedAt || (oneShipment ? order.shippedAt || order.shipDate : ""))
  if (deliveredAt || allStatuses.some((value) => DELIVERED_STATUSES.has(value))) {
    return { code: "delivered", label: "Delivered", shipped: true, delivered: true, occurredAt: deliveredAt || shippedAt, source: shipmentStatuses.some((value) => DELIVERED_STATUSES.has(value)) ? "package" : "order" }
  }
  if (shippedAt || allStatuses.some((value) => SHIPPED_STATUSES.has(value)) || carrierStatuses.some((value) => CARRIER_EXCEPTION_STATUSES.has(value))) {
    return { code: "shipped", label: "Shipped", shipped: true, delivered: false, occurredAt: shippedAt, source: shipmentStatuses.some((value) => SHIPPED_STATUSES.has(value) || CARRIER_EXCEPTION_STATUSES.has(value)) || text(shipment.shippedAt || shipment.carrierConfirmedAt) ? "package" : "order" }
  }
  if (allStatuses.some((value) => CANCELED_STATUSES.has(value))) {
    return { code: "canceled", label: "Canceled / voided", shipped: false, delivered: false, occurredAt: "", source: shipmentStatuses.some((value) => CANCELED_STATUSES.has(value)) ? "package" : "order" }
  }
  if (allStatuses.some((value) => LABEL_STATUSES.has(value)) || text(shipment.trackingNumber) || text(shipment.labelPurchasedAt) || text(shipment.labelPurchaseId)) {
    return { code: "not_shipped", label: "Not shipped", shipped: false, delivered: false, occurredAt: "", source: "package" }
  }
  return { code: "unknown", label: "Shipment status unknown", shipped: false, delivered: false, occurredAt: "", source: "none" }
}

function recordShipmentLabelScan(shipment = {}, detail = {}, now = new Date()) {
  const scannedAt = now.toISOString()
  const scanId = text(detail.scanId) || `scan:${scannedAt}`
  const history = Array.isArray(shipment.labelScanHistory) ? shipment.labelScanHistory : []
  const existing = history.find((entry) => text(entry.scanId) === scanId)
  if (existing) return { shipment, event: existing, recorded: false, addedPrintEvidence: false }
  const hasPhysicalPrintEvidence = Boolean(
    text(shipment.labelPrintedAt || shipment.labelLastPrintedAt || shipment.labelScanVerifiedAt)
    || Number(shipment.labelPrintCount || 0) > 0
  )
  const scannedBy = text(detail.scannedBy) || "Warehouse"
  const event = {
    scanId,
    scannedAt,
    scannedBy,
    code: text(detail.code),
    matchedBy: text(detail.matchedBy),
    source: "physical_label_scan"
  }
  shipment.labelScanHistory = [event, ...history].slice(0, 50)
  shipment.labelScanCount = Number(shipment.labelScanCount || 0) + 1
  shipment.labelScanVerifiedAt = shipment.labelScanVerifiedAt || scannedAt
  shipment.labelScanVerifiedBy = shipment.labelScanVerifiedBy || scannedBy
  shipment.labelLastScannedAt = scannedAt
  shipment.labelLastScannedBy = scannedBy
  shipment.labelScanEvidenceSource = "physical_scan"
  shipment.updatedAt = scannedAt
  return { shipment, event, recorded: true, addedPrintEvidence: !hasPhysicalPrintEvidence }
}

module.exports = {
  findShippingLabelMatches,
  normalizeLabelScanCode,
  packageShipmentStatus,
  recordShipmentLabelScan,
  shipmentScanIdentifiers
}
