const crypto = require("node:crypto");
const { CARRIERS } = require("./shipping-carriers");

const DEFAULT_CARRIERS = Object.freeze([
  {
    id: "ups",
    name: "UPS",
    enabled: true,
    trackingUrlTemplate: "https://www.ups.com/track?tracknum={trackingNumber}",
    phone: "1-800-742-5877",
    services: ["UPS Ground", "UPS 3 Day Select", "UPS 2nd Day Air", "UPS Next Day Air Saver", "UPS Next Day Air"]
  },
  {
    id: "fedex",
    name: "FedEx",
    enabled: true,
    trackingUrlTemplate: "https://www.fedex.com/fedextrack/?trknbr={trackingNumber}",
    phone: "1-800-463-3339",
    services: ["FedEx Ground", "FedEx Home Delivery", "FedEx Express Saver", "FedEx 2Day", "FedEx Standard Overnight", "FedEx Priority Overnight"]
  },
  {
    id: "usps",
    name: "USPS",
    enabled: true,
    trackingUrlTemplate: "https://tools.usps.com/go/TrackConfirmAction?tLabels={trackingNumber}",
    phone: "1-800-275-8777",
    services: ["USPS Ground Advantage", "USPS Priority Mail", "USPS Priority Mail Express", "USPS Media Mail"]
  },
  {
    id: "dhl",
    name: "DHL",
    enabled: true,
    trackingUrlTemplate: "https://www.dhl.com/us-en/home/tracking.html?tracking-id={trackingNumber}",
    phone: "1-800-225-5345",
    services: ["DHL eCommerce Ground", "DHL eCommerce Expedited", "DHL Express Worldwide"]
  },
  {
    id: "ontrac",
    name: "OnTrac",
    enabled: true,
    trackingUrlTemplate: "https://www.ontrac.com/tracking/?number={trackingNumber}",
    phone: "1-800-334-5000",
    services: ["OnTrac Ground", "OnTrac Sunrise", "OnTrac Ground Plus"]
  },
  {
    id: "amazon-shipping",
    name: "Amazon Shipping",
    enabled: true,
    trackingUrlTemplate: "https://track.amazon.com/tracking/{trackingNumber}",
    phone: "",
    services: ["Amazon Shipping Ground", "Amazon Shipping Standard", "Amazon Shipping Premium"]
  },
  {
    id: "gofo",
    name: "GOFO",
    enabled: true,
    trackingUrlTemplate: "https://www.gofoexpress.com/tracking.html?searchID={trackingNumber}",
    phone: "",
    services: CARRIERS.find((carrier) => carrier.id === "gofo").services
  },
  {
    id: "speedx",
    name: "SpeedX",
    enabled: true,
    trackingUrlTemplate: "https://tracking.speedx.io/?trackingNumber={trackingNumber}",
    phone: "",
    services: CARRIERS.find((carrier) => carrier.id === "speedx").services
  },
  {
    id: "swiftx",
    name: "SwiftX",
    enabled: true,
    trackingUrlTemplate: "",
    phone: "",
    services: CARRIERS.find((carrier) => carrier.id === "swiftx").services
  }
]);

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

function carrierKey(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function normalizeCarrierService(value, index = 0) {
  const source = typeof value === "string" ? { name: value } : (value || {});
  const name = text(source.name || source.label || source.id) || `Service ${index + 1}`;
  return {
    id: text(source.id) || carrierKey(name) || `service-${index + 1}`,
    name,
    enabled: source.enabled !== false
  };
}

function normalizeCarriers(value) {
  const saved = Array.isArray(value) ? value : [];
  const savedByKey = new Map(saved.map((carrier) => [carrierKey(carrier?.id || carrier?.name), carrier]));
  const defaults = DEFAULT_CARRIERS.map((carrier) => {
    const configured = savedByKey.get(carrierKey(carrier.id)) || savedByKey.get(carrierKey(carrier.name)) || {};
    const savedServices = Array.isArray(configured.services) ? configured.services : [];
    const savedServicesByKey = new Map(savedServices.map((service) => [carrierKey(typeof service === "string" ? service : service?.id || service?.name), service]));
    const services = carrier.services.map((service, index) => {
      const configuredService = savedServicesByKey.get(carrierKey(service));
      return normalizeCarrierService(configuredService ? { name: service, ...(typeof configuredService === "string" ? {} : configuredService) } : service, index);
    });
    for (const service of savedServices) {
      const normalized = normalizeCarrierService(service, services.length);
      if (!services.some((entry) => carrierKey(entry.id) === carrierKey(normalized.id) || carrierKey(entry.name) === carrierKey(normalized.name))) services.push(normalized);
    }
    return {
      id: carrier.id,
      name: carrier.name,
      enabled: configured.enabled !== false,
      trackingUrlTemplate: text(configured.trackingUrlTemplate || carrier.trackingUrlTemplate),
      phone: text(configured.phone || carrier.phone),
      services
    };
  });
  for (const carrier of saved) {
    if (defaults.some((entry) => carrierKey(entry.id) === carrierKey(carrier?.id || carrier?.name))) continue;
    const name = text(carrier?.name || carrier?.id);
    if (!name) continue;
    defaults.push({
      id: text(carrier.id) || carrierKey(name),
      name,
      enabled: carrier.enabled !== false,
      trackingUrlTemplate: text(carrier.trackingUrlTemplate),
      phone: text(carrier.phone),
      services: (Array.isArray(carrier.services) ? carrier.services : []).map(normalizeCarrierService)
    });
  }
  return defaults;
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
    carriers: normalizeCarriers(value.carriers),
    rules: (Array.isArray(value.rules) ? value.rules : []).map(normalizeRule).sort((a, b) => a.priority - b.priority)
  };
}

function addressFor(order = {}) {
  return order.address || order.shippingAddress || order.shipping_address || {};
}

function packageFor(order = {}) {
  return order.selectedShippingQuote?.package || order.package || {};
}

function measurementSet(value = {}, keys = {}) {
  const result = {
    packageLength: Number(value[keys.length] || 0),
    packageWidth: Number(value[keys.width] || 0),
    packageHeight: Number(value[keys.height] || 0),
    packageWeight: Number(value[keys.weight] || 0)
  };
  return Object.values(result).every((measurement) => Number.isFinite(measurement) && measurement > 0) ? result : null;
}

function legacyPackSkuCandidate(value = "") {
  const sku = text(value);
  const match = sku.match(/^(.*?)[-_](\d+)(?:PC|PK|PACK|CT|CS|CASE|BX)$/i);
  if (!match?.[1] || Number(match[2]) <= 1) return null;
  return { parentSku: match[1], quantity: Number(match[2]), orderedSku: sku };
}

const DEFAULT_WEIGHT_DIMENSION_FALLBACKS = Object.freeze([
  { maxWeight: 10, length: 3, width: 3, height: 3 },
  { maxWeight: 20, length: 5, width: 5, height: 5 },
  { maxWeight: 40, length: 10, width: 10, height: 10 },
  { maxWeight: 75, length: 10, width: 10, height: 15 },
  { maxWeight: 100, length: 10, width: 15, height: 15 },
  { maxWeight: 125, length: 15, width: 15, height: 15 },
  { maxWeight: 126, length: 20, width: 20, height: 15 }
]);

function positiveNumber(...values) {
  for (const value of values) {
    const number = Number(value || 0);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}

function completeDimensions(value = {}, keySets = []) {
  for (const keys of keySets) {
    const length = positiveNumber(value[keys.length]);
    const width = positiveNumber(value[keys.width]);
    const height = positiveNumber(value[keys.height]);
    if (length && width && height) return { length, width, height };
  }
  return null;
}

function dimensionalWeight(dimensions) {
  if (!dimensions) return 0;
  return Number(((dimensions.length * dimensions.width * dimensions.height) / 139).toFixed(3));
}

function dimensionsForWeight(weight) {
  const numericWeight = positiveNumber(weight);
  const match = numericWeight ? DEFAULT_WEIGHT_DIMENSION_FALLBACKS.find((rule) => numericWeight <= rule.maxWeight) : null;
  return match ? { length: match.length, width: match.width, height: match.height } : null;
}

function legacyPackSkuMatchesProduct(value = "", productSku = "", uomQty = 1) {
  const candidate = legacyPackSkuCandidate(value);
  return Boolean(candidate
    && candidate.parentSku.toLowerCase() === text(productSku).toLowerCase()
    && candidate.quantity === Number(uomQty));
}

function resolvePackage(order = {}, routes = [], products = []) {
  const saved = packageFor(order);
  const savedDimensions = completeDimensions(saved, [
    { length: "packageLength", width: "packageWidth", height: "packageHeight" },
    { length: "lengthInches", width: "widthInches", height: "heightInches" },
    { length: "length", width: "width", height: "height" }
  ]);
  const savedWeight = positiveNumber(saved.packageWeight, saved.weightPounds, saved.weight);

  const skus = [...new Set((routes || []).map((route) => text(route.sku).toLowerCase()).filter(Boolean))];
  const quantity = Math.max(1, (routes || []).reduce((sum, route) => sum + Number(route.qty || 0), 0));
  const productKeys = (entry = {}) => [
    entry.sku,
    entry.id,
    ...(Array.isArray(entry.aliases) ? entry.aliases
      .filter((alias) => alias?.active !== false)
      .map((alias) => alias?.aliasSku || alias?.sku || alias?.value) : [])
  ].map((value) => text(value).toLowerCase()).filter(Boolean);
  const productForSku = (sku) => (products || []).find((entry) => productKeys(entry).includes(text(sku).toLowerCase()));
  const productWeight = (entry, routeQuantity = 1) => {
    if (!entry) return 0;
    const packageWeight = positiveNumber(entry.packageWeight);
    const itemWeight = positiveNumber(entry.itemWeight);
    const itemDimensions = completeDimensions(entry, [{ length: "itemLength", width: "itemWidth", height: "itemHeight" }]);
    const packageDimensions = completeDimensions(entry, [{ length: "packageLength", width: "packageWidth", height: "packageHeight" }]);
    return positiveNumber(packageWeight, itemWeight, dimensionalWeight(itemDimensions), dimensionalWeight(packageDimensions)) * Math.max(1, Number(routeQuantity || 0));
  };
  if (skus.length > 1) {
    const routeWeights = (routes || []).map((route) => productWeight(productForSku(route.sku), route.qty));
    const combinedWeight = routeWeights.length && routeWeights.every((weight) => weight > 0)
      ? routeWeights.reduce((sum, weight) => sum + weight, 0)
      : 0;
    const weight = positiveNumber(savedWeight, combinedWeight);
    const dimensions = savedDimensions || dimensionsForWeight(weight);
    const hasSavedMeasurements = Object.values(saved || {}).some((value) => Number(value || 0) > 0);
    if (!weight && !dimensions) return { package: saved, source: hasSavedMeasurements ? "incomplete_order_package" : "missing", inferred: false };
    return {
      package: {
        ...saved,
        ...(dimensions ? { packageLength: dimensions.length, packageWidth: dimensions.width, packageHeight: dimensions.height } : {}),
        ...(weight ? { packageWeight: Number(weight.toFixed(3)) } : {})
      },
      source: savedDimensions && savedWeight ? "order_package" : savedDimensions ? "order_dimensions_combined_product_weight" : "combined_weight_dimensions",
      inferred: !(savedDimensions && savedWeight)
    };
  }
  const product = skus.length === 1 ? productForSku(skus[0]) : null;
  const productSku = product ? product.sku || product.id : "";
  const isAlias = Boolean(product && text(productSku).toLowerCase() !== skus[0]);
  const identity = product && isAlias
    ? { productSku, orderedSku: (routes || []).find((route) => text(route.sku).toLowerCase() === skus[0])?.sku || "", isAlias: true }
    : product ? { productSku } : {};
  const packageDimensions = product ? completeDimensions(product, [{ length: "packageLength", width: "packageWidth", height: "packageHeight" }]) : null;
  const itemDimensions = product ? completeDimensions(product, [{ length: "itemLength", width: "itemWidth", height: "itemHeight" }]) : null;
  const productPackageWeight = product ? positiveNumber(product.packageWeight) * quantity : 0;
  const productItemWeight = product ? positiveNumber(product.itemWeight) * quantity : 0;
  const inferredItemWeight = product && !productPackageWeight && !productItemWeight ? dimensionalWeight(itemDimensions) * quantity : 0;
  const inferredPackageWeight = product && !productPackageWeight && !productItemWeight && !inferredItemWeight ? dimensionalWeight(packageDimensions) * quantity : 0;
  const inferredSavedWeight = !savedWeight && !productPackageWeight && !productItemWeight && !inferredItemWeight && !inferredPackageWeight
    ? dimensionalWeight(savedDimensions)
    : 0;
  const weight = positiveNumber(savedWeight, productPackageWeight, productItemWeight, inferredItemWeight, inferredPackageWeight, inferredSavedWeight);
  const dimensions = savedDimensions || packageDimensions || itemDimensions || dimensionsForWeight(weight);
  const hasSavedMeasurements = Object.values(saved || {}).some((value) => Number(value || 0) > 0);
  if (!weight && !dimensions) return { package: saved, source: hasSavedMeasurements ? "incomplete_order_package" : "missing", inferred: false, ...identity };

  const source = savedDimensions && savedWeight
    ? "order_package"
    : savedDimensions
      ? inferredSavedWeight ? "order_dimensions_dimensional_weight" : "order_dimensions_product_weight"
      : packageDimensions && productPackageWeight
        ? "product_package"
        : itemDimensions && productItemWeight
          ? "product_item"
          : inferredItemWeight
            ? "product_item_dimensional_weight"
            : inferredPackageWeight
              ? "product_package_dimensional_weight"
              : dimensions && !packageDimensions && !itemDimensions
                ? "weight_based_dimensions"
                : "inferred_package";
  return {
    package: {
      ...saved,
      ...(dimensions ? { packageLength: dimensions.length, packageWidth: dimensions.width, packageHeight: dimensions.height } : {}),
      ...(weight ? { packageWeight: Number(weight.toFixed(3)) } : {})
    },
    source,
    inferred: source !== "order_package",
    ...identity
  };
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

function rateAllowedByCarrierSettings(rate = {}, settings = {}) {
  const carriers = normalizeSettings(settings).carriers;
  const rateCarrierKey = carrierKey(rate.carrier || rate.carrierName);
  if (!rateCarrierKey) return true;
  const carrier = carriers.find((entry) => {
    const configuredKey = carrierKey(entry.name || entry.id);
    return rateCarrierKey === configuredKey || rateCarrierKey.includes(configuredKey) || configuredKey.includes(rateCarrierKey);
  });
  if (!carrier) return true;
  if (!carrier.enabled) return false;
  const withoutCarrier = (value, carrierName) => {
    const valueKey = carrierKey(value);
    const prefix = carrierKey(carrierName);
    return valueKey.startsWith(`${prefix}-`) ? valueKey.slice(prefix.length + 1) : valueKey;
  };
  const rateServiceKey = withoutCarrier(rate.service || rate.serviceName, carrier.name);
  const service = carrier.services.find((entry) => withoutCarrier(entry.name, carrier.name) === rateServiceKey || carrierKey(entry.id) === carrierKey(rate.service || rate.serviceName));
  return service ? service.enabled : true;
}

function selectRate(rates = [], settings = {}, order = {}, route = {}) {
  const available = rates.filter((rate) => rate && rate.id && Number.isFinite(Number(rate.amount)) && rateAllowedByCarrierSettings(rate, settings));
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
  if (rows.every((row) => [success, "skipped", "superseded"].includes(row.status))) return "completed";
  if (rows.some((row) => row.status === "processing")) return "running";
  if (rows.some((row) => row.status === "failed") && rows.every((row) => [success, "failed", "skipped", "superseded", "blocked"].includes(row.status))) return "warning";
  return "queued";
}

module.exports = { DEFAULT_SETTINGS, DEFAULT_CARRIERS, DEFAULT_WEIGHT_DIMENSION_FALLBACKS, normalizeSettings, normalizeCarriers, normalizeRule, matchingRules, rateAllowedByCarrierSettings, selectRate, batchStatus, legacyPackSkuCandidate, legacyPackSkuMatchesProduct, resolvePackage };
