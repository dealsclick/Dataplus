const CARRIERS = Object.freeze([
  { id: "ups", name: "UPS", aliases: ["ups", "ups direct", "united parcel service"], walmart: "UPS", services: ["UPS Ground", "UPS 3 Day Select", "UPS 2nd Day Air", "UPS Next Day Air Saver", "UPS Next Day Air"] },
  { id: "fedex", name: "FedEx", aliases: ["fedex", "fed ex", "fdx"], walmart: "FedEx", services: ["FedEx Ground", "FedEx Ground Economy", "FedEx Home Delivery", "FedEx Express Saver", "FedEx 2Day", "FedEx Standard Overnight", "FedEx Priority Overnight"] },
  { id: "usps", name: "USPS", aliases: ["usps", "united states postal service", "postal service"], walmart: "USPS", services: ["USPS Ground Advantage", "USPS Priority Mail", "USPS Priority Mail Express"] },
  { id: "dhl", name: "DHL", aliases: ["dhl", "dhl express", "dhl ecommerce", "dhl e-commerce"], walmart: "DHL", services: ["DHL eCommerce Ground", "DHL eCommerce Expedited", "DHL Express Worldwide"] },
  { id: "ontrac", name: "OnTrac", aliases: ["ontrac", "laser ship", "lasership"], walmart: "OnTrac", services: ["OnTrac Ground", "OnTrac Sunrise", "OnTrac Ground Plus"] },
  { id: "amazon-shipping", name: "Amazon Shipping", aliases: ["amazon shipping", "amazon logistics", "amazon"], walmart: "", services: ["Amazon Shipping Ground", "Amazon Shipping Standard", "Amazon Shipping Premium"] },
  { id: "gofo", name: "GOFO", aliases: ["gofo"], walmart: "", services: ["GOFO Standard"] },
  { id: "speedx", name: "SpeedX", aliases: ["speedx", "speed x"], walmart: "", services: ["SpeedX Standard"] },
  { id: "swiftx", name: "SwiftX", aliases: ["swiftx", "swift x"], walmart: "", services: ["SwiftX Standard"] }
]);

const TRACKING_RULES = Object.freeze([
  { carrier: "UPS", pattern: /^1Z[0-9A-Z]{16}$/ },
  { carrier: "UPS", pattern: /^T\d{10}$/ },
  { carrier: "USPS", pattern: /^9[23456]\d{18,20}$/ },
  { carrier: "USPS", pattern: /^82\d{9}$/ },
  { carrier: "USPS", pattern: /^[A-Z]{2}\d{9}US$/ },
  { carrier: "FedEx", pattern: /^\d{12,15}$/ },
  { carrier: "DHL", pattern: /^(?:GM|JVGL|JJD|JD)[0-9A-Z]{8,24}$/ },
  { carrier: "OnTrac", pattern: /^C\d{14}$/ },
  { carrier: "Amazon Shipping", pattern: /^TB[AMCD]\d{8,}$/ },
  { carrier: "SpeedX", pattern: /^(?:SPX|SPD)\d{8,}$/ },
  { carrier: "GOFO", pattern: /^(?:GF\d{10,}|GOFO[0-9A-Z]{6,})$/ },
  { carrier: "SwiftX", pattern: /^SWIFTX[0-9A-Z]{6,}$/ }
]);

const WALMART_METHOD_CODES = new Set(["Standard", "Express", "OneDay", "Freight", "WhiteGlove", "Value"]);
const CARRIER_PROVIDER_PLACEHOLDERS = new Set([
  "buyshipping",
  "marketplaceshippinglabel",
  "marketplacelabel",
  "veeqo",
  "veeqolabel",
  "channellabel",
  "shippinglabel"
]);

function clean(value = "") {
  return String(value || "").trim();
}

function key(value = "") {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeTrackingNumber(value = "") {
  return clean(value).toUpperCase().replace(/[^0-9A-Z]/g, "");
}

function carrierDefinition(value = "") {
  const sought = key(value);
  if (!sought) return null;
  return CARRIERS.find((carrier) => [carrier.id, carrier.name, ...carrier.aliases].some((alias) => key(alias) === sought)) || null;
}

function canonicalCarrierName(value = "") {
  return carrierDefinition(value)?.name || clean(value);
}

function isCarrierProviderPlaceholder(value = "") {
  return CARRIER_PROVIDER_PLACEHOLDERS.has(key(value));
}

function inferCarrierFromTracking(trackingNumber = "", fallback = "") {
  const tracking = normalizeTrackingNumber(trackingNumber);
  const detected = TRACKING_RULES.find((rule) => rule.pattern.test(tracking))?.carrier || "";
  if (detected) return detected;
  const fallbackCarrier = canonicalCarrierName(fallback);
  return isCarrierProviderPlaceholder(fallbackCarrier) ? "" : fallbackCarrier;
}

function carrierTrackingUrl(carrier = "", trackingNumber = "") {
  const tracking = normalizeTrackingNumber(trackingNumber);
  if (!tracking) return "";
  const definition = carrierDefinition(inferCarrierFromTracking(tracking, carrier) || carrier);
  if (!definition) return "";
  const encoded = encodeURIComponent(tracking);
  if (definition.id === "usps") return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encoded}`;
  if (definition.id === "ups") return `https://www.ups.com/track?tracknum=${encoded}`;
  if (definition.id === "fedex") return `https://www.fedex.com/fedextrack/?trknbr=${encoded}`;
  if (definition.id === "dhl") return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${encoded}`;
  if (definition.id === "ontrac") return `https://www.ontrac.com/tracking/?number=${encoded}`;
  if (definition.id === "amazon-shipping") return `https://track.amazon.com/tracking/${encoded}`;
  if (definition.id === "swiftx") return `https://swiftx-express.com/track?trackingNumber=${encoded}`;
  if (definition.id === "speedx") return `https://tracking.speedx.io/?trackingNumber=${encoded}`;
  if (definition.id === "gofo") return `https://www.gofoexpress.com/tracking.html?searchID=${encoded}`;
  return "";
}

function carrierServices(carrier = "") {
  return [...(carrierDefinition(carrier)?.services || [])];
}

function canonicalCarrierService(carrier = "", service = "") {
  const supplied = clean(service);
  if (!supplied) return "";
  const exact = carrierServices(carrier).find((candidate) => key(candidate) === key(supplied));
  return exact || supplied;
}

function validateCarrierService(carrier = "", service = "") {
  const definition = carrierDefinition(carrier);
  if (!definition) return Boolean(clean(service));
  return definition.services.some((candidate) => key(candidate) === key(service));
}

function normalizeShipmentCarrier(input = {}) {
  const rawTrackingNumber = clean(input.trackingNumber);
  const normalizedTrackingNumber = normalizeTrackingNumber(rawTrackingNumber);
  const carrierSelection = clean(input.carrier);
  const customCarrier = key(carrierSelection) === "other" ? clean(input.carrierName) : "";
  const suppliedCarrier = canonicalCarrierName(customCarrier || input.carrierName || carrierSelection);
  const detectedCarrier = inferCarrierFromTracking(normalizedTrackingNumber);
  const suppliedIsProviderPlaceholder = isCarrierProviderPlaceholder(suppliedCarrier);
  if (detectedCarrier && suppliedCarrier && key(detectedCarrier) !== key(suppliedCarrier) && !customCarrier && !suppliedIsProviderPlaceholder) {
    throw new Error(`Tracking number format matches ${detectedCarrier}, not ${suppliedCarrier}.`);
  }
  const carrierName = detectedCarrier || (suppliedIsProviderPlaceholder ? "" : suppliedCarrier);
  const carrier = customCarrier && !detectedCarrier ? "Other" : carrierName;
  const service = canonicalCarrierService(carrierName, input.service);
  const trackingNumber = carrier === "Other" ? rawTrackingNumber : normalizedTrackingNumber;
  return { carrier, carrierName, service, trackingNumber, detectedCarrier };
}

function walmartCarrierName(carrier = "") {
  return carrierDefinition(carrier)?.walmart || "";
}

function walmartMethodCode(value = "", fallback = "Standard") {
  const supplied = clean(value);
  const exact = [...WALMART_METHOD_CODES].find((candidate) => key(candidate) === key(supplied));
  return exact || fallback;
}

module.exports = {
  CARRIERS,
  TRACKING_RULES,
  WALMART_METHOD_CODES,
  canonicalCarrierName,
  canonicalCarrierService,
  carrierDefinition,
  carrierServices,
  carrierTrackingUrl,
  inferCarrierFromTracking,
  isCarrierProviderPlaceholder,
  normalizeShipmentCarrier,
  normalizeTrackingNumber,
  validateCarrierService,
  walmartCarrierName,
  walmartMethodCode
};
