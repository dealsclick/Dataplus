const PACKAGE_DIMENSION_FIELDS = ["packageLength", "packageWidth", "packageHeight", "packageWeight"];

function packageDimensionsChanged(product = {}, input = {}) {
  return PACKAGE_DIMENSION_FIELDS.some((field) => input[field] !== undefined
    && Number(product[field] || 0) !== Number(input[field] || 0));
}

function applyManualPackageDimensions(product = {}, input = {}, actor = "System", now = new Date().toISOString()) {
  for (const field of PACKAGE_DIMENSION_FIELDS) {
    if (input[field] !== undefined && Number.isFinite(Number(input[field]))) {
      product[field] = Math.max(0, Number(input[field]));
    }
  }
  product.packageDimensionsLocked = true;
  product.packageDimensionsSource = "manual";
  product.packageDimensionsSavedAt = now;
  product.packageDimensionsSavedBy = String(actor || "System");
  return product;
}

module.exports = { PACKAGE_DIMENSION_FIELDS, packageDimensionsChanged, applyManualPackageDimensions };
