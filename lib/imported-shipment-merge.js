function normalizedIdentity(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizedTracking(value) {
  return normalizedIdentity(value).replace(/[^a-z0-9]/g, "");
}

function shipmentIdentity(shipment = {}) {
  const ids = new Set([
    shipment.remoteShipmentId,
    shipment.fulfillmentId,
    shipment.sourceFulfillmentId,
    shipment.id
  ].map(normalizedIdentity).filter(Boolean));
  const packageNumbers = new Set([
    ...(Array.isArray(shipment.packageSnList) ? shipment.packageSnList : []),
    shipment.packageSn,
    ...(Array.isArray(shipment.packages) ? shipment.packages.map((entry) => entry?.packageSn) : [])
  ].map(normalizedIdentity).filter(Boolean));
  return {
    ids,
    packageNumbers,
    trackingNumber: normalizedTracking(shipment.trackingNumber),
    reference: normalizedIdentity(shipment.reference)
  };
}

function setsIntersect(left, right) {
  return [...left].some((value) => right.has(value));
}

function shipmentsMatch(left = {}, right = {}) {
  const leftIdentity = shipmentIdentity(left);
  const rightIdentity = shipmentIdentity(right);
  if (leftIdentity.trackingNumber && rightIdentity.trackingNumber) {
    return leftIdentity.trackingNumber === rightIdentity.trackingNumber;
  }
  if (setsIntersect(leftIdentity.packageNumbers, rightIdentity.packageNumbers)) return true;
  if (setsIntersect(leftIdentity.ids, rightIdentity.ids)) return true;
  const leftHasStrongIdentity = Boolean(leftIdentity.trackingNumber || leftIdentity.packageNumbers.size || leftIdentity.ids.size);
  const rightHasStrongIdentity = Boolean(rightIdentity.trackingNumber || rightIdentity.packageNumbers.size || rightIdentity.ids.size);
  return !leftHasStrongIdentity && !rightHasStrongIdentity
    && Boolean(leftIdentity.reference)
    && leftIdentity.reference === rightIdentity.reference;
}

function measuredPackage(packages = []) {
  return packages.some((entry) => [
    entry?.weight,
    entry?.packageWeight,
    entry?.length,
    entry?.packageLength,
    entry?.width,
    entry?.packageWidth,
    entry?.height,
    entry?.packageHeight
  ].some((value) => Number(value || 0) > 0));
}

function mergeDocuments(stored = [], incoming = []) {
  const documents = new Map();
  for (const document of [...stored, ...incoming]) {
    const key = normalizedIdentity(document?.documentId || document?.id || document?.url)
      || `${normalizedIdentity(document?.name || "document")}:${documents.size}`;
    if (!documents.has(key)) documents.set(key, document);
  }
  return [...documents.values()];
}

function mergeShipment(stored = {}, incoming = {}) {
  const merged = { ...stored, ...incoming, id: stored.id || incoming.id };
  const preservedFields = [
    "labelSource", "labelSourceLabel", "labelProvider", "labelPurchaseId", "labelId",
    "labelPurchasedAt", "purchasedAt", "fulfillmentBatchId", "fulfillmentRouteIds",
    "packageGroupKey", "packageMeasurementSource", "packageInferred", "warehouseId", "warehouseName",
    "labelPrintedAt", "labelPrintedBy", "labelPrintCount", "labelPrintHistory",
    "labelLastPrintedAt", "labelLastPrintedBy", "labelLastPrintStation", "labelLastPrinterName",
    "selectedRate", "rate", "rawSummary"
  ];
  for (const key of preservedFields) {
    if (stored[key] !== undefined && stored[key] !== null && stored[key] !== "") merged[key] = stored[key];
  }
  if (Number(stored.shippingCost || 0) > 0 || !Number(incoming.shippingCost || 0)) merged.shippingCost = stored.shippingCost;
  if (stored.package && typeof stored.package === "object" && !Array.isArray(stored.package)) merged.package = stored.package;
  const storedPackages = Array.isArray(stored.packages) ? stored.packages : [];
  const incomingPackages = Array.isArray(incoming.packages) ? incoming.packages : [];
  merged.packages = measuredPackage(storedPackages) ? storedPackages : incomingPackages.length ? incomingPackages : storedPackages;
  merged.documents = mergeDocuments(
    Array.isArray(stored.documents) ? stored.documents : [],
    Array.isArray(incoming.documents) ? incoming.documents : []
  );
  merged.packageSnList = [...new Set([
    ...(Array.isArray(stored.packageSnList) ? stored.packageSnList : []),
    ...(Array.isArray(incoming.packageSnList) ? incoming.packageSnList : []),
    stored.packageSn,
    incoming.packageSn
  ].map((value) => String(value || "").trim()).filter(Boolean))];
  return merged;
}

function mergeImportedShipments(existingShipments = [], incomingShipments = []) {
  const existing = Array.isArray(existingShipments) ? existingShipments.filter(Boolean).map((shipment) => ({ ...shipment })) : [];
  const incoming = Array.isArray(incomingShipments) ? incomingShipments.filter(Boolean) : [];
  const merged = [];
  for (const shipment of incoming) {
    const matchIndex = existing.findIndex((stored) => shipmentsMatch(stored, shipment));
    if (matchIndex < 0) merged.push(shipment);
    else merged.push(mergeShipment(existing.splice(matchIndex, 1)[0], shipment));
  }
  return [...merged, ...existing];
}

module.exports = { mergeImportedShipments, shipmentIdentity, shipmentsMatch };
