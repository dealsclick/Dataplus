const { classifyShipping } = require('./shipping-classification');

const LONG_NARROW_MIN_LENGTH_IN = 40;
const LONG_NARROW_MAX_CROSS_SECTION_IN = 6;

function measurement(item = {}, key = '') {
  const snake = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  const value = item[key] ?? item[snake] ?? item.raw?.[key] ?? item.raw?.[snake] ?? item.original?.[snake];
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function shippingDimensions(item = {}) {
  const packageDimensions = ['Length', 'Width', 'Height'].map(axis => measurement(item, `package${axis}`));
  const itemDimensions = ['Length', 'Width', 'Height'].map(axis => measurement(item, `item${axis}`));
  const dimensions = packageDimensions.some(Boolean) ? packageDimensions : itemDimensions;
  return dimensions.every(Boolean) ? dimensions.sort((a, b) => b - a) : [];
}

function launchShippingItem(item = {}, sellingUnitQty = 1, sourcePackQty = 1) {
  if (!(sellingUnitQty === 1 && sourcePackQty > 1)) return item;
  // Supplier package measurements can describe a pallet or case. An individual
  // Walmart offer must be reviewed against the individual item's measurements.
  return {
    ...item,
    packageLength: 0,
    packageWidth: 0,
    packageHeight: 0,
    packageWeight: 0
  };
}

function walmartLaunchShippingReview(item = {}, options = {}) {
  const positiveQuantity = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 1;
  const sellingUnitQty = positiveQuantity(options.sellingUnitQty);
  const sourcePackQty = positiveQuantity(options.sourcePackQty);
  const shippingItem = launchShippingItem(item, sellingUnitQty, sourcePackQty);
  const classification = options.classification || classifyShipping(shippingItem);
  const shippingClass = String(classification?.shippingClass || '').trim().toLowerCase();
  if (shippingClass === 'ltl') {
    return {
      blocked: true,
      code: 'freight_or_ltl',
      reason: classification.shippingClassReason || 'Freight/LTL products cannot launch on Walmart.'
    };
  }
  if (shippingClass === 'missing_measurements') {
    return {
      blocked: true,
      code: 'shipping_measurements_required',
      reason: 'Complete shipping dimensions and actual weight are required before Walmart launch.'
    };
  }
  const dimensions = shippingDimensions(shippingItem);
  if (dimensions.length === 3
    && dimensions[0] >= LONG_NARROW_MIN_LENGTH_IN
    && dimensions[1] <= LONG_NARROW_MAX_CROSS_SECTION_IN
    && dimensions[2] <= LONG_NARROW_MAX_CROSS_SECTION_IN) {
    return {
      blocked: true,
      code: 'long_narrow_package_review',
      reason: `Long, narrow package (${dimensions.join(' x ')} in) requires shipping review before Walmart launch.`
    };
  }
  return { blocked: false, code: '', reason: '' };
}

module.exports = {
  LONG_NARROW_MIN_LENGTH_IN,
  LONG_NARROW_MAX_CROSS_SECTION_IN,
  shippingDimensions,
  launchShippingItem,
  walmartLaunchShippingReview
};
