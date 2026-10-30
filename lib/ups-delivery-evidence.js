const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MAX_EVIDENCE_BYTES = 15 * 1024 * 1024;

const EVIDENCE_LABELS = {
  carrier_tracking_report: "UPS tracking report",
  proof_of_delivery: "UPS proof of delivery",
  delivery_photo: "UPS delivery photo",
  signature_confirmation: "UPS signature confirmation",
};

function text(value) {
  return String(value ?? "").trim();
}

function safeTrackingNumber(value) {
  return text(value).replace(/[^0-9a-z]/gi, "").toUpperCase() || "tracking";
}

function decodeBase64(value) {
  const encoded = text(value).replace(/^data:[^;]+;base64,/i, "").replace(/\s+/g, "");
  if (!encoded || !/^[a-z0-9+/]+={0,2}$/i.test(encoded)) return null;
  const content = Buffer.from(encoded, "base64");
  if (!content.length || content.length > MAX_EVIDENCE_BYTES) return null;
  return content;
}

function evidenceFormat(content, kind) {
  if (content.subarray(0, 5).toString("ascii") === "%PDF-") return { extension: ".pdf", mimeType: "application/pdf" };
  if (content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { extension: ".png", mimeType: "image/png" };
  if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return { extension: ".jpg", mimeType: "image/jpeg" };
  if (content.length >= 12 && content.subarray(0, 4).toString("ascii") === "RIFF" && content.subarray(8, 12).toString("ascii") === "WEBP") return { extension: ".webp", mimeType: "image/webp" };
  if (kind === "proof_of_delivery") return { extension: ".pdf", mimeType: "application/pdf" };
  return { extension: ".png", mimeType: "image/png" };
}

function publicTrackingReport(tracking = {}, capturedAt = "") {
  const evidence = tracking.deliveryEvidence && typeof tracking.deliveryEvidence === "object" ? tracking.deliveryEvidence : {};
  return {
    provider: "UPS Tracking API",
    capturedAt,
    trackingNumber: text(tracking.trackingNumber),
    status: text(tracking.status),
    statusDescription: text(tracking.statusDescription),
    service: text(tracking.service),
    deliveredAt: text(evidence.deliveredAt || tracking.latestActivityAt),
    deliveryLocation: text(evidence.location),
    receivedBy: text(evidence.receivedBy),
    latestActivity: text(tracking.latestActivity),
    latestActivityAt: text(tracking.latestActivityAt),
    physicalScanAt: text(tracking.physicalScanAt),
    activityCount: Number(tracking.activityCount || 0),
    activities: Array.isArray(tracking.activities) ? tracking.activities : [],
    proofOfDeliveryReturned: evidence.hasProofOfDelivery === true,
    deliveryPhotoReturned: evidence.hasDeliveryPhoto === true,
    signatureImageReturned: evidence.hasSignatureImage === true,
    photoDispositionCode: text(evidence.photoDispositionCode),
    photoCaptureIndicator: text(evidence.photoCaptureIndicator),
    evidenceRequestError: text(tracking.evidenceRequestError),
    transactionId: text(tracking.transactionId),
  };
}

function upsertDocument(order, shipment, input, options) {
  const key = `ups:${safeTrackingNumber(options.trackingNumber)}:${input.kind}`;
  const existing = (Array.isArray(order.documents) ? order.documents : []).find((document) => document.carrierEvidenceKey === key);
  const id = text(existing?.id) || crypto.randomUUID();
  const storageKey = text(existing?.storageKey) || `${id}${input.extension}`;
  fs.mkdirSync(options.attachmentDir, { recursive: true });
  fs.writeFileSync(path.join(options.attachmentDir, path.basename(storageKey)), input.content);
  const document = {
    id,
    name: `${EVIDENCE_LABELS[input.kind] || "UPS delivery evidence"} ${safeTrackingNumber(options.trackingNumber)}${input.extension}`,
    type: input.kind,
    note: `Retrieved directly from UPS for tracking ${options.trackingNumber}.`,
    mimeType: input.mimeType,
    size: input.content.length,
    storage: "local",
    storageKey,
    url: options.attachmentUrl(id),
    carrierEvidenceKey: key,
    carrier: "UPS",
    trackingNumber: options.trackingNumber,
    createdAt: existing?.createdAt || options.capturedAt,
    updatedAt: options.capturedAt,
    createdBy: "UPS Tracking API",
  };
  order.documents = [document, ...(Array.isArray(order.documents) ? order.documents : []).filter((entry) => String(entry.id || "") !== id && entry.carrierEvidenceKey !== key)];
  shipment.documents = Array.isArray(shipment.documents) ? shipment.documents : [];
  const reference = { documentId: id, url: document.url, format: input.extension.slice(1).toUpperCase(), mimeType: input.mimeType, documentType: input.kind, name: document.name };
  shipment.documents = [reference, ...shipment.documents.filter((entry) => String(entry.documentId || entry.id || "") !== id && entry.documentType !== input.kind)];
  return document;
}

function storeUpsDeliveryEvidence(order, shipment, tracking, options = {}) {
  if (!order || !shipment || !options.attachmentDir || typeof options.attachmentUrl !== "function") throw new Error("UPS delivery evidence storage is not configured.");
  const capturedAt = text(options.capturedAt) || new Date().toISOString();
  const trackingNumber = text(tracking.trackingNumber || shipment.trackingNumber);
  const report = publicTrackingReport(tracking, capturedAt);
  const documents = [];
  documents.push(upsertDocument(order, shipment, {
    kind: "carrier_tracking_report",
    content: Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8"),
    extension: ".json",
    mimeType: "application/json",
  }, { ...options, trackingNumber, capturedAt }));
  const artifacts = Array.isArray(tracking.deliveryEvidence?.artifacts) ? tracking.deliveryEvidence.artifacts : [];
  for (const artifact of artifacts) {
    const kind = text(artifact.kind);
    if (!EVIDENCE_LABELS[kind] || kind === "carrier_tracking_report") continue;
    const content = decodeBase64(artifact.contentBase64);
    if (!content) continue;
    const format = evidenceFormat(content, kind);
    documents.push(upsertDocument(order, shipment, { kind, content, ...format }, { ...options, trackingNumber, capturedAt }));
  }
  const evidence = tracking.deliveryEvidence && typeof tracking.deliveryEvidence === "object" ? tracking.deliveryEvidence : {};
  shipment.deliveryEvidence = {
    provider: "ups_api",
    checkedAt: capturedAt,
    deliveredAt: text(evidence.deliveredAt || (tracking.status === "delivered" ? tracking.latestActivityAt : "")),
    location: text(evidence.location),
    receivedBy: text(evidence.receivedBy),
    hasProofOfDelivery: documents.some((document) => document.type === "proof_of_delivery"),
    hasDeliveryPhoto: documents.some((document) => document.type === "delivery_photo"),
    hasSignatureImage: documents.some((document) => document.type === "signature_confirmation"),
    trackingReportAvailable: true,
    evidenceRequestError: text(tracking.evidenceRequestError),
    documents: documents.map((document) => ({ id: document.id, type: document.type, name: document.name, url: document.url, mimeType: document.mimeType })),
  };
  return { documents, evidence: shipment.deliveryEvidence, report };
}

module.exports = { decodeBase64, evidenceFormat, publicTrackingReport, storeUpsDeliveryEvidence };
