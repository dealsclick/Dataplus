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

module.exports = { veeqoShipmentFromResponse, veeqoShipmentTrackingDetails };
