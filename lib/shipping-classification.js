const DEFAULT_SHIPPING_RULES = Object.freeze({
  shippingDimensionalDivisor: 139,
  shippingLongParcelLength: 48,
  shippingLongParcelGirth: 105,
  shippingParcelMaxLength: 108,
  shippingParcelMaxGirth: 165,
  shippingParcelMaxWeight: 150,
  shippingHonorSupplierFreight: true
});

function normalizeShippingRules(settings = {}) {
  const rules = {};
  for (const [key, fallback] of Object.entries(DEFAULT_SHIPPING_RULES)) {
    const value = settings[key];
    rules[key] = typeof fallback === "boolean"
      ? value !== false && value !== "false"
      : Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
  }
  rules.shippingLongParcelLength = Math.min(rules.shippingLongParcelLength, rules.shippingParcelMaxLength);
  rules.shippingLongParcelGirth = Math.min(rules.shippingLongParcelGirth, rules.shippingParcelMaxGirth);
  return rules;
}

function classifyShipping(item = {}, settings = {}) {
  const rules = normalizeShippingRules(settings);
  const read = (key) => item[key] ?? item.raw?.[key];
  const measurement = (key) => {
    const snake = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    const n = Number(read(key) ?? read(snake) ?? item.original?.[snake]);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  // Never mix partial package dimensions with item dimensions to invent a box.
  const pkg = ["Length", "Width", "Height"].map((axis) => measurement(`package${axis}`));
  const own = ["Length", "Width", "Height"].map((axis) => measurement(`item${axis}`));
  const dims = pkg.some(Boolean) ? pkg : own;
  const complete = dims.every(Boolean);
  const sorted = [...dims].sort((a, b) => b - a);
  const longest = sorted[0];
  const girth = complete ? longest + 2 * (sorted[1] + sorted[2]) : 0;
  const weight = measurement("packageWeight") || measurement("itemWeight");
  const dimensionalWeight = complete ? Math.round(dims.reduce((a, b) => a * b, 1) / rules.shippingDimensionalDivisor * 1000) / 1000 : 0;
  const result = (shippingClass, shippingClassReason) => ({ shippingClass, shippingClassReason, dimensionalWeight,
    shippingMethod: ({ parcel: "Parcel", oversize_parcel: "Long / oversized parcel", ltl: "Freight / outside parcel limits", missing_measurements: "Shipping review" })[shippingClass] });
  const override = String(read("shippingClassOverride") || "");
  if (["parcel", "oversize_parcel", "ltl"].includes(override)) {
    return result(override, `Manual override: ${read("shippingOverrideReason") || "Operator classification"}`);
  }
  // Only source fields are evidence. Derived shippingMethod/shippingClass must not feed back into classification.
  const freightFlag = ["requiresFreight", "freightOnly", "supplierFreightRequired"].some((key) => [true, "true", 1, "1"].includes(read(key)));
  const sourceModes = [read("shipMode"), read("ship_mode"), read("sourceShippingMethod"), item.original?.ship_mode].flat().filter(Boolean);
  const sourceFreight = sourceModes.some((value) => /^(ltl|l tl|freight|truck|truckload|pallet|freight only|ltl only)$/i.test(String(value).trim()));
  if (rules.shippingHonorSupplierFreight && (freightFlag || sourceFreight)) return result("ltl", "Supplier requires freight shipping.");
  const freight = [];
  if (longest > rules.shippingParcelMaxLength) freight.push(`longest side ${longest} in exceeds ${rules.shippingParcelMaxLength} in`);
  if (girth > rules.shippingParcelMaxGirth) freight.push(`length plus girth ${girth} in exceeds ${rules.shippingParcelMaxGirth} in`);
  if (weight > rules.shippingParcelMaxWeight) freight.push(`actual weight ${weight} lb exceeds ${rules.shippingParcelMaxWeight} lb`);
  if (freight.length) return result("ltl", freight.join("; "));
  const long = [];
  if (longest > rules.shippingLongParcelLength) long.push(`longest side ${longest} in exceeds ${rules.shippingLongParcelLength} in`);
  if (girth > rules.shippingLongParcelGirth) long.push(`length plus girth ${girth} in exceeds ${rules.shippingLongParcelGirth} in`);
  if (long.length) return result("oversize_parcel", long.join("; "));
  if (!complete || !weight) return result("missing_measurements", "Complete dimensions and actual weight are required for parcel verification.");
  return result("parcel", "Within configured parcel limits. Dimensional weight is a cost estimate only.");
}

module.exports = { DEFAULT_SHIPPING_RULES, normalizeShippingRules, classifyShipping };
