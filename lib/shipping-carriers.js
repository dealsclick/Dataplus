const CARRIERS = Object.freeze([
  { id: "ups", name: "UPS", aliases: ["ups", "united parcel service"], walmart: "UPS", services: ["UPS Ground", "UPS 3 Day Select", "UPS 2nd Day Air", "UPS Next Day Air Saver", "UPS Next Day Air"] },
  { id: "fedex", name: "FedEx", aliases: ["fedex", "fed ex", "fdx"], walmart: "FedEx", services: ["FedEx Ground", "FedEx Ground Economy", "FedEx Home Delivery", "FedEx Express Saver", "FedEx 2Day", "FedEx Standard Overnight", "FedEx Priority Overnight"] },
  { id: "usps", name: "USPS", aliases: ["usps", "united states postal service", "postal service"], walmart: "USPS", services: ["USPS Ground Advantage", "USPS Priority Mail", "USPS Priority Mail Express"] },
  { id: "dhl", name: "DHL", aliases: ["dhl", "dhl express", "dhl ecommerce", "dhl e-commerce"], walmart: "DHL", services: ["DHL eCommerce Ground", "DHL eCommerce Expedited", "DHL Express Worldwide"] },
  { id: "ontrac", name: "OnTrac", aliases: ["ontrac", "laser ship", "lasership"], walmart: "OnTrac", services: ["OnTrac Ground", "OnTrac Sunrise", "OnTrac Ground Plus"] },
  { id: "amazon-shipping", name: "Amazon Shipping", aliases: ["amazon shipping", "amazon logistics", "amazon"], walmart: "", services: ["Amazon Shipping Ground", "Amazon Shipping Standard", "Amazon Shipping Premium"] },
  { id: "gofo", name: "GOFO", aliases: ["gofo"], walmart: "", services: ["GOFO Standard"] },
  { id: "speedx", name: "SpeedX", aliases: ["speedx", "speed x"], walmart: "", services: ["SpeedX Standard"] },
  { id: "swiftx", name: "SwiftX", aliases: ["swiftx", "swift x"], walmart: "", services: ["SwiftX Standard"] }
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
  if (/^1Z[0-9A-Z]{10,}$/.test(tracking)) return "UPS";
  if (/^(?:9[23456]|82)\d{18,20}$/.test(tracking) || /^[A-Z]{2}\d{9}US$/.test(tracking)) return "USPS";
  if (/^(?:\d{12}|\d{15})$/.test(tracking)) return "FedEx";
  if (/^(?:GM|JVGL|JJD)\d{10,22}$/.test(tracking)) return "DHL";
  if (/^C\d{14}$/.test(tracking)) return "OnTrac";
  if (/^TB[AMCD]\d{8,}$/.test(tracking)) return "Amazon Shipping";
  if (/^(?:SPX|SPD)\d{8,}$/.test(tracking)) return "SpeedX";
  if (/^(?:GF\d{10,}|GOFO[0-9A-Z]{6,})$/.test(tracking)) return "GOFO";
  if (/^SWIFTX[0-9A-Z]{6,}$/.test(tracking)) return "SwiftX";
  return canonicalCarrierName(fallback);
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
  WALMART_METHOD_CODES,
  canonicalCarrierName,
  canonicalCarrierService,
  carrierDefinition,
  carrierServices,
  inferCarrierFromTracking,
  isCarrierProviderPlaceholder,
  normalizeShipmentCarrier,
  normalizeTrackingNumber,
  validateCarrierService,
  walmartCarrierName,
  walmartMethodCode
};
