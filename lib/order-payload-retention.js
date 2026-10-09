const crypto = require("crypto");
const zlib = require("zlib");

const HEAVY_EXTERNAL_KEYS = new Set([
  "amount", "amountV2", "shipping", "decryptedShipping", "unshippedPackage",
  "combinedShipment", "logisticsShipmentV2", "shipmentResult", "trackingInfo",
  "labelList", "customization", "raw", "detail"
]);
const PACKAGE_KEYS = new Set([
  "packageSn", "packageSN", "package_sn", "packageNo", "packageNumber",
  "packageId", "logisticsPackageSn", "packageSnList", "packageSns"
]);
const TRACKING_KEYS = new Set([
  "trackingNumber", "trackingNo", "trackingNum", "trackingSn", "waybillNo",
  "waybillNumber", "mailNo", "shipTrackingNumber"
]);
const CARRIER_KEYS = new Set([
  "carrier", "carrierName", "shippingCarrier", "logisticsProviderName", "shippingCompanyName"
]);
const LARGE_AUDIT_KEY = /(?:raw|response|body|content|base64|labelData|documentData|fileData|payload)$/i;
const EMBEDDED_LABEL_KEY = /(?:labelContent|labelData|labelBase64|documentBase64|fileBase64|contentBase64)$/i;
const RATE_ACTIVITY_LIMIT = 20;

function scalar(value) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function collectNamedScalars(value, keys, output = new Set(), depth = 0) {
  if (!value || depth > 8) return output;
  if (Array.isArray(value)) {
    for (const entry of value) collectNamedScalars(entry, keys, output, depth + 1);
    return output;
  }
  if (typeof value !== "object") return output;
  for (const [key, entry] of Object.entries(value)) {
    if (keys.has(key)) {
      const values = Array.isArray(entry) ? entry : [entry];
      for (const value of values) {
        const text = scalar(value);
        if (text) output.add(text);
      }
    }
    if (entry && typeof entry === "object") collectNamedScalars(entry, keys, output, depth + 1);
  }
  return output;
}

function hasEmbeddedLabelPayload(value, depth = 0) {
  if (!value || depth > 8) return false;
  if (Array.isArray(value)) return value.some((entry) => hasEmbeddedLabelPayload(entry, depth + 1));
  if (typeof value !== "object") return false;
  return Object.entries(value).some(([key, entry]) => (
    EMBEDDED_LABEL_KEY.test(key) && typeof entry === "string" && entry.length > 500
  ) || hasEmbeddedLabelPayload(entry, depth + 1));
}

function makeArchive(orderId, kind, payload) {
  if (payload === undefined || payload === null) return null;
  const serialized = JSON.stringify(payload);
  if (!serialized || serialized === "{}" || serialized === "[]") return null;
  const compressed = zlib.gzipSync(Buffer.from(serialized), { level: zlib.constants.Z_BEST_SPEED });
  const sha256 = crypto.createHash("sha256").update(serialized).digest("hex");
  return {
    orderId: String(orderId || ""),
    kind,
    sha256,
    compression: "gzip",
    payload: compressed,
    originalBytes: Buffer.byteLength(serialized),
    compressedBytes: compressed.length
  };
}

function compactAuditValue(value, depth = 0) {
  if (depth > 6) return "[archived]";
  if (Array.isArray(value)) return value.slice(0, 25).map((entry) => compactAuditValue(entry, depth + 1));
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && value.length > 2000) return `${value.slice(0, 500)}...[archived]`;
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    const serializedSize = entry && typeof entry === "object" ? JSON.stringify(entry).length : String(entry || "").length;
    if (LARGE_AUDIT_KEY.test(key) && serializedSize > 1000) return [key, "[archived]"];
    return [key, compactAuditValue(entry, depth + 1)];
  }));
}

function compactOrderForStorage(order = {}) {
  const orderId = String(order.id || order.orderId || "");
  const archives = [];
  const stored = { ...order };

  if (order.external && typeof order.external === "object" && !Array.isArray(order.external)) {
    const heavy = {};
    const compact = {};
    for (const [key, value] of Object.entries(order.external)) {
      if (HEAVY_EXTERNAL_KEYS.has(key) && value !== undefined && value !== null) heavy[key] = value;
      else compact[key] = value;
    }
    const archive = makeArchive(orderId, "provider-external", heavy);
    if (archive) {
      archives.push(archive);
      const packageSnList = [...collectNamedScalars(heavy, PACKAGE_KEYS)];
      const trackingNumbers = [...collectNamedScalars(heavy, TRACKING_KEYS)];
      const carriers = [...collectNamedScalars(heavy, CARRIER_KEYS)];
      if (packageSnList.length) compact.packageSnList = packageSnList;
      if (trackingNumbers.length) compact.providerTrackingNumbers = trackingNumbers;
      if (carriers.length) compact.providerCarriers = carriers;
      compact.payloadArchive = { kind: archive.kind, sha256: archive.sha256, originalBytes: archive.originalBytes };
    }
    stored.external = compact;
  }

  stored.shipments = (Array.isArray(order.shipments) ? order.shipments : []).map((shipment, index) => {
    if (!shipment || typeof shipment !== "object") return shipment;
    const compact = { ...shipment };
    const packageRows = Array.isArray(shipment.packages) ? shipment.packages : [];
    const rawPackages = packageRows.map((entry, packageIndex) => ({ packageIndex, raw: entry?.raw })).filter((entry) => entry.raw !== undefined);
    const cold = {
      ...(shipment.raw !== undefined ? { raw: shipment.raw } : {}),
      ...(shipment.sourceSnapshot !== undefined ? { sourceSnapshot: shipment.sourceSnapshot } : {}),
      ...(rawPackages.length ? { packages: rawPackages } : {})
    };
    const archive = makeArchive(orderId, `shipment-provider:${shipment.id || index}`, cold);
    const hasLabelDocument = (Array.isArray(shipment.documents) ? shipment.documents : []).some((entry) => entry?.documentType === "shipping_label" || entry?.documentId || entry?.url);
    const preserveEmbeddedLabel = !hasLabelDocument && hasEmbeddedLabelPayload(cold);
    if (!preserveEmbeddedLabel) delete compact.raw;
    delete compact.sourceSnapshot;
    compact.packages = packageRows.map((entry) => {
      if (!entry || typeof entry !== "object") return entry;
      const next = { ...entry };
      if (!preserveEmbeddedLabel) delete next.raw;
      return next;
    });
    const packageSnList = [...new Set([
      ...(Array.isArray(shipment.packageSnList) ? shipment.packageSnList.map(String) : []),
      ...compact.packages.map((entry) => scalar(entry?.packageSn)).filter(Boolean),
      ...collectNamedScalars(cold, PACKAGE_KEYS)
    ])];
    if (packageSnList.length) compact.packageSnList = packageSnList;
    if (archive) {
      archives.push(archive);
      compact.payloadArchive = { kind: archive.kind, sha256: archive.sha256, originalBytes: archive.originalBytes };
    }
    if (preserveEmbeddedLabel) compact.payloadRetentionPending = "Extract the embedded label to an attachment before removing this provider payload.";
    return compact;
  });

  const activity = Array.isArray(order.shippingRateActivity) ? order.shippingRateActivity : [];
  const compactActivity = activity.slice(0, RATE_ACTIVITY_LIMIT).map((entry) => compactAuditValue(entry));
  const originalSize = activity.length ? Buffer.byteLength(JSON.stringify(activity)) : 0;
  const compactSize = compactActivity.length ? Buffer.byteLength(JSON.stringify(compactActivity)) : 0;
  if (activity.length > RATE_ACTIVITY_LIMIT || originalSize > compactSize + 4096) {
    const archive = makeArchive(orderId, "shipping-rate-activity", activity);
    if (archive) {
      archives.push(archive);
      stored.shippingRateActivityArchive = { kind: archive.kind, sha256: archive.sha256, originalBytes: archive.originalBytes };
    }
  }
  stored.shippingRateActivity = compactActivity;
  return { order: stored, archives };
}

function shipmentTrackingRecords(order = {}) {
  const orderId = String(order.id || order.orderId || "");
  return (Array.isArray(order.shipments) ? order.shipments : []).map((shipment, index) => {
    if (!shipment || typeof shipment !== "object") return null;
    const provider = String(shipment.provider || shipment.labelProvider || shipment.source || "").trim().toLowerCase();
    if (!provider) return null;
    const trackingNumber = String(shipment.trackingNumber || "").trim();
    const trackingStatus = String(shipment.trackingStatus || shipment.carrierStatus || shipment.status || "").trim().toLowerCase();
    const shipmentStatus = String(shipment.status || "").trim().toLowerCase();
    const voidStatus = String(shipment.voidStatus || "").trim().toLowerCase();
    const checkedAt = shipment.trackingCheckedAt ? new Date(shipment.trackingCheckedAt) : null;
    const checkedMs = checkedAt && Number.isFinite(checkedAt.getTime()) ? checkedAt.getTime() : 0;
    const packageSns = [...new Set([
      ...(Array.isArray(shipment.packageSnList) ? shipment.packageSnList.map(String) : []),
      scalar(shipment.packageSn),
      ...(Array.isArray(shipment.packages) ? shipment.packages.map((entry) => scalar(entry?.packageSn)) : [])
    ].filter(Boolean))];
    const hasLabel = (Array.isArray(shipment.documents) ? shipment.documents : []).some((entry) => entry?.documentType === "shipping_label" || entry?.documentId || entry?.url);
    const complete = voidStatus === "voided" || ["delivered", "canceled", "cancelled", "void", "voided", "completed", "complete", "closed"].includes(trackingStatus)
      || ["delivered", "canceled", "cancelled", "void", "voided", "completed", "complete", "closed"].includes(shipmentStatus);
    let nextCheckAt = null;
    if (!complete && provider === "temu" && !trackingNumber && packageSns.length) {
      nextCheckAt = new Date(checkedMs + 5 * 60_000 || 0);
    } else if (!complete && provider === "veeqo") {
      nextCheckAt = new Date(checkedMs + (trackingNumber ? 3 * 60 * 60_000 : 5 * 60_000));
    }
    return {
      orderId,
      shipmentId: String(shipment.id || `${orderId}:shipment:${index}`),
      provider,
      shipmentStatus,
      trackingStatus,
      trackingNumber,
      trackingCheckedAt: checkedMs ? new Date(checkedMs) : null,
      trackingPendingSince: shipment.trackingPendingSince ? new Date(shipment.trackingPendingSince) : null,
      nextCheckAt,
      monitoringComplete: complete || !nextCheckAt,
      remoteShipmentId: String(shipment.remoteShipmentId || ""),
      veeqoOrderId: String(shipment.veeqoOrderId || ""),
      allocationId: String(shipment.allocationId || ""),
      veeqoShipmentId: String(shipment.veeqoShipmentId || ""),
      rateSource: String(shipment.rateSource || shipment.rawSummary?.rateSource || ""),
      voidStatus,
      packageSns,
      hasLabel
    };
  }).filter(Boolean);
}

module.exports = { RATE_ACTIVITY_LIMIT, compactOrderForStorage, shipmentTrackingRecords };
