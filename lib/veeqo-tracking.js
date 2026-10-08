function scalarText(value) {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  return "";
}

function firstScalar(...values) {
  for (const value of values) {
    const text = scalarText(value);
    if (text) return text;
  }
  return "";
}

function veeqoShipmentFromResponse(response = {}) {
  if (Array.isArray(response)) return response.find((entry) => entry && typeof entry === "object") || {};
  if (!response || typeof response !== "object") return {};
  if (response.shipment && typeof response.shipment === "object" && !Array.isArray(response.shipment)) return response.shipment;
  if (Array.isArray(response.shipments)) return response.shipments.find((entry) => entry && typeof entry === "object") || {};
  if (response.successful && typeof response.successful === "object") {
    const successful = Object.values(response.successful).find((entry) => entry && typeof entry === "object" && !Array.isArray(entry));
    if (successful) return successful;
  }
  return response;
}

function veeqoShipmentFromAllocationOrder(response = {}, context = {}) {
  const order = response?.order && typeof response.order === "object" ? response.order : response;
  const allocations = Array.isArray(order?.allocations) ? order.allocations : [];
  const allocationId = firstScalar(context.allocationId);
  const shipmentId = firstScalar(context.shipmentId);
  const shipmentRows = (allocation) => {
    if (Array.isArray(allocation?.shipments)) return allocation.shipments;
    if (allocation?.shipment && typeof allocation.shipment === "object") return [allocation.shipment];
    return [];
  };
  const allocation = allocations.find((entry) => allocationId && firstScalar(entry?.id) === allocationId);
  const candidates = allocation ? shipmentRows(allocation) : allocations.flatMap(shipmentRows);
  return candidates.find((entry) => shipmentId && firstScalar(entry?.id) === shipmentId)
    || candidates.find((entry) => entry && typeof entry === "object")
    || {};
}

function veeqoShipmentTrackingDetails(remote = {}, fallback = {}) {
  const tracking = remote?.tracking_number && typeof remote.tracking_number === "object"
    ? remote.tracking_number
    : remote?.tracking && typeof remote.tracking === "object"
      ? remote.tracking
      : {};
  const carrierRecord = remote?.carrier && typeof remote.carrier === "object" ? remote.carrier : {};
  const trackingNumber = firstScalar(
    tracking.tracking_number,
    tracking.trackingNumber,
    tracking.number,
    tracking.code,
    remote.tracking_number,
    remote.trackingNumber,
    remote.tracking_no,
    remote.trackingNo,
    remote.tracking_code,
    remote.trackingCode,
    fallback.trackingNumber
  );
  const carrier = firstScalar(
    tracking.carrier_name,
    tracking.carrierName,
    tracking.carrier,
    carrierRecord.name,
    carrierRecord.code,
    remote.carrier,
    remote.carrier_name,
    remote.carrierName,
    fallback.carrier
  );
  const trackingUrl = firstScalar(
    tracking.tracking_url,
    tracking.trackingUrl,
    tracking.url,
    remote.tracking_url,
    remote.trackingUrl,
    fallback.trackingUrl
  );
  return { trackingNumber, carrier, trackingUrl };
}

function veeqoRemoteShipmentId(shipment = {}, batchRow = {}) {
  const selectedRate = batchRow?.selectedRate && typeof batchRow.selectedRate === "object" ? batchRow.selectedRate : {};
  const rawRate = selectedRate?.raw && typeof selectedRate.raw === "object" ? selectedRate.raw : {};
  const rawSummary = shipment?.rawSummary && typeof shipment.rawSummary === "object" ? shipment.rawSummary : {};
  const direct = firstScalar(
    shipment.remoteShipmentId,
    shipment.remote_shipment_id,
    rawSummary.remoteShipmentId,
    rawSummary.remote_shipment_id,
    batchRow.remoteShipmentId,
    batchRow.remote_shipment_id,
    selectedRate.remoteShipmentId,
    selectedRate.remote_shipment_id,
    rawRate.remoteShipmentId,
    rawRate.remote_shipment_id
  );
  if (direct) return direct;
  for (const rate of Array.isArray(batchRow.rates) ? batchRow.rates : []) {
    const raw = rate?.raw && typeof rate.raw === "object" ? rate.raw : {};
    const candidate = firstScalar(rate?.remoteShipmentId, rate?.remote_shipment_id, raw.remoteShipmentId, raw.remote_shipment_id);
    if (candidate) return candidate;
  }
  return "";
}

module.exports = { veeqoRemoteShipmentId, veeqoShipmentFromAllocationOrder, veeqoShipmentFromResponse, veeqoShipmentTrackingDetails };
