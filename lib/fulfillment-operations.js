const crypto = require("node:crypto");

const DEFAULT_SETTINGS = Object.freeze({
  maxOrdersPerBatch: 100,
  processingChunkSize: 10,
  defaultPickingMode: "most_efficient",
  defaultLabelFormat: "PDF",
  defaultPrintSize: "4x6",
  requireScanToPack: false,
  requireQualityCheck: false,
  autoPrintPackingSlip: true,
  rules: []
});

function text(value) {
  return String(value || "").trim();
}

function list(value) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function normalizeRule(rule = {}, index = 0) {
  return {
    id: text(rule.id) || crypto.randomUUID(),
    name: text(rule.name) || `Shipping rule ${index + 1}`,
    enabled: rule.enabled !== false,
    priority: Math.max(1, Number(rule.priority || index + 1) || index + 1),
    channels: list(rule.channels).map((value) => value.toLowerCase()),
    warehouseIds: list(rule.warehouseIds),
    destinationCountries: list(rule.destinationCountries).map((value) => value.toUpperCase()),
    destinationStates: list(rule.destinationStates).map((value) => value.toUpperCase()),
    postalPrefixes: list(rule.postalPrefixes).map((value) => value.toUpperCase()),
    deliveryMethodContains: text(rule.deliveryMethodContains).toLowerCase(),
    minWeight: Math.max(0, Number(rule.minWeight || 0) || 0),
    maxWeight: Math.max(0, Number(rule.maxWeight || 0) || 0),
    minOrderValue: Math.max(0, Number(rule.minOrderValue || 0) || 0),
    maxOrderValue: Math.max(0, Number(rule.maxOrderValue || 0) || 0),
    carrier: text(rule.carrier),
    service: text(rule.service),
    packagePresetId: text(rule.packagePresetId),
    selection: ["cheapest", "fastest", "preferred"].includes(text(rule.selection).toLowerCase()) ? text(rule.selection).toLowerCase() : "preferred",
    note: text(rule.note)
  };
}

function normalizeSettings(value = {}) {
  return {
    ...DEFAULT_SETTINGS,
    maxOrdersPerBatch: Math.max(1, Math.min(100, Number(value.maxOrdersPerBatch || DEFAULT_SETTINGS.maxOrdersPerBatch) || DEFAULT_SETTINGS.maxOrdersPerBatch)),
    processingChunkSize: Math.max(1, Math.min(20, Number(value.processingChunkSize || DEFAULT_SETTINGS.processingChunkSize) || DEFAULT_SETTINGS.processingChunkSize)),
    defaultPickingMode: ["single_tote", "pick_to_order", "most_efficient"].includes(text(value.defaultPickingMode)) ? text(value.defaultPickingMode) : DEFAULT_SETTINGS.defaultPickingMode,
    defaultLabelFormat: ["PDF", "PNG", "ZPL"].includes(text(value.defaultLabelFormat).toUpperCase()) ? text(value.defaultLabelFormat).toUpperCase() : DEFAULT_SETTINGS.defaultLabelFormat,
    defaultPrintSize: ["4x6", "letter"].includes(text(value.defaultPrintSize).toLowerCase()) ? text(value.defaultPrintSize).toLowerCase() : DEFAULT_SETTINGS.defaultPrintSize,
    requireScanToPack: value.requireScanToPack === true,
    requireQualityCheck: value.requireQualityCheck === true,
    autoPrintPackingSlip: value.autoPrintPackingSlip !== false,
    rules: (Array.isArray(value.rules) ? value.rules : []).map(normalizeRule).sort((a, b) => a.priority - b.priority)
  };
}

function addressFor(order = {}) {
  return order.address || order.shippingAddress || order.shipping_address || {};
}

function packageFor(order = {}) {
  return order.selectedShippingQuote?.package || order.package || {};
}

function orderWeight(order = {}) {
  const parcel = packageFor(order);
  return Number(parcel.packageWeight || parcel.weightPounds || parcel.weight || 0) || 0;
}

function matchesRule(rule, order = {}, route = {}) {
  if (!rule.enabled) return false;
  const address = addressFor(order);
  const channel = text(order.channelSource || order.source).toLowerCase();
  const country = text(address.countryCode || address.country_code || address.country).toUpperCase();
  const state = text(address.state || address.province || address.county).toUpperCase();
  const postal = text(address.postalCode || address.zip || address.postcode).toUpperCase();
  const deliveryMethod = text(order.shippingService || order.deliveryMethod || order.shippingMethod).toLowerCase();
  const weight = orderWeight(order);
  const total = Number(order.total || 0) || 0;
  if (rule.channels.length && !rule.channels.includes(channel)) return false;
  if (rule.warehouseIds.length && !rule.warehouseIds.includes(text(route.warehouseId || order.fulfillmentWarehouseId))) return false;
  if (rule.destinationCountries.length && !rule.destinationCountries.includes(country)) return false;
  if (rule.destinationStates.length && !rule.destinationStates.includes(state)) return false;
  if (rule.postalPrefixes.length && !rule.postalPrefixes.some((prefix) => postal.startsWith(prefix))) return false;
  if (rule.deliveryMethodContains && !deliveryMethod.includes(rule.deliveryMethodContains)) return false;
  if (rule.minWeight && weight < rule.minWeight) return false;
  if (rule.maxWeight && weight > rule.maxWeight) return false;
  if (rule.minOrderValue && total < rule.minOrderValue) return false;
  if (rule.maxOrderValue && total > rule.maxOrderValue) return false;
  return true;
}

function matchingRules(settings, order = {}, route = {}) {
  return normalizeSettings(settings).rules.filter((rule) => matchesRule(rule, order, route));
}

function selectRate(rates = [], settings = {}, order = {}, route = {}) {
  const available = rates.filter((rate) => rate && rate.id && Number.isFinite(Number(rate.amount)));
  if (!available.length) return { rate: null, rule: null, explanation: "No eligible rates were returned." };
  const matches = matchingRules(settings, order, route);
  const rule = matches[0] || null;
  const preference = rule || {
    selection: text(settings.autoSelectRule || "cheapest").toLowerCase(),
    carrier: text(settings.preferredCarrier),
    service: text(settings.preferredService)
  };
  const preferred = available.filter((rate) => {
    const carrier = text(rate.carrier).toLowerCase();
    const service = text(rate.service).toLowerCase();
    return (!preference.carrier || carrier.includes(text(preference.carrier).toLowerCase()))
      && (!preference.service || service.includes(text(preference.service).toLowerCase()));
  });
  const pool = preferred.length ? preferred : available;
  const selection = text(preference.selection || "cheapest").toLowerCase();
  const rate = [...pool].sort((a, b) => selection === "fastest"
    ? (Number(a.deliveryDays || 999) - Number(b.deliveryDays || 999)) || (Number(a.amount) - Number(b.amount))
    : (Number(a.amount) - Number(b.amount)) || (Number(a.deliveryDays || 999) - Number(b.deliveryDays || 999)))[0];
  const explanation = rule
    ? `${rule.name} selected ${rate.carrier} ${rate.service}.`
    : `${selection === "fastest" ? "Fastest" : preferred.length ? "Preferred carrier/service" : "Lowest cost"} eligible service selected.`;
  return { rate, rule, explanation, conflicts: matches.slice(1).map((entry) => ({ id: entry.id, name: entry.name })) };
}

function batchStatus(rows = [], mode = "rates") {
  if (!rows.length) return "empty";
  const success = mode === "purchase" ? "purchased" : "rated";
  if (rows.every((row) => row.status === success || row.status === "skipped")) return "completed";
  if (rows.some((row) => row.status === "processing")) return "running";
  if (rows.some((row) => row.status === "failed") && rows.every((row) => [success, "failed", "skipped", "blocked"].includes(row.status))) return "warning";
  return "queued";
}

module.exports = { DEFAULT_SETTINGS, normalizeSettings, normalizeRule, matchingRules, selectRate, batchStatus };
