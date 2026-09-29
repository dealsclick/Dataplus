const NEUTRAL_SERVICE_VALUES = [
  "NO_CONFIRMATION",
  "NO_SIGNATURE",
  "NONE",
  "NOT_REQUIRED",
  "NO_ADDED_SERVICE",
  "STANDARD"
];

function optionValue(entry) {
  if (entry === undefined || entry === null) return "";
  if (typeof entry !== "object") return String(entry).trim();
  return String(entry.value ?? entry.id ?? entry.code ?? entry.name ?? "").trim();
}

function shippingServiceOptions(rate = {}) {
  const raw = rate.raw && typeof rate.raw === "object" ? rate.raw : {};
  const candidates = [
    rate.shippingServiceOptions,
    rate.shipping_service_options,
    raw.shipping_service_options,
    raw.shippingServiceOptions
  ];
  return candidates.find(Array.isArray) || [];
}

function selectedServiceValue(option = {}) {
  const values = (Array.isArray(option.values) ? option.values : [])
    .map((entry) => ({
      value: optionValue(entry),
      preferred: Boolean(entry && typeof entry === "object" && (entry.default || entry.is_default || entry.selected))
    }))
    .filter((entry) => entry.value);
  const explicitDefault = optionValue(option.default ?? option.default_value ?? option.defaultValue ?? option.selected_value ?? option.selectedValue);
  if (explicitDefault && (!values.length || values.some((entry) => entry.value === explicitDefault))) return explicitDefault;
  const marked = values.find((entry) => entry.preferred);
  if (marked) return marked.value;
  const neutral = NEUTRAL_SERVICE_VALUES
    .map((value) => values.find((entry) => entry.value.toUpperCase() === value))
    .find(Boolean);
  if (neutral) return neutral.value;
  return values[0]?.value || "";
}

function veeqoShipmentServiceSelections(rate = {}) {
  return Object.fromEntries(shippingServiceOptions(rate)
    .map((option) => [String(option?.key || "").trim(), selectedServiceValue(option)])
    .filter(([key, value]) => key && value));
}

module.exports = { selectedServiceValue, shippingServiceOptions, veeqoShipmentServiceSelections };
