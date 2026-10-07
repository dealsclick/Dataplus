function normalizedStatusToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
}

function normalizeCarrierTrackingStatus(value) {
  const status = normalizedStatusToken(value)
  if (!status) return "awaiting_pickup"
  if (["void", "voided", "cancelled", "canceled"].includes(status)) return "voided"
  if (["delivered", "delivery_complete", "completed_delivery"].includes(status)) return "delivered"
  if (["out_for_delivery", "in_transit", "intransit", "shipped", "fulfilled", "picked_up", "accepted", "carrier_accepted", "departed"].includes(status)) return "in_transit"
  if (["delayed", "delivery_exception", "exception"].includes(status)) return "delayed"
  return "awaiting_pickup"
}

function carrierStatusConfirmsShipment(value) {
  return ["in_transit", "delivered"].includes(normalizeCarrierTrackingStatus(value))
}

function veeqoRemoteTrackingStatus(remote = {}, fallback = "") {
  return String(
    remote.tracking_status
      || remote.trackingStatus
      || remote.carrier_status
      || remote.carrierStatus
      || remote.shipment_status
      || remote.shipmentStatus
      || remote.status
      || fallback
      || "label_purchased"
  ).trim()
}

module.exports = {
  carrierStatusConfirmsShipment,
  normalizeCarrierTrackingStatus,
  veeqoRemoteTrackingStatus
}
