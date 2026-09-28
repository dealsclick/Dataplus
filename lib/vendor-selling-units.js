const modes = ['inherit', 'supplier-uom', 'individual-only', 'case-only', 'individual-and-case'];

function validateSellingUnitMode(value) {
  const mode = value == null || value === '' ? 'inherit' : String(value);
  if (!modes.includes(mode)) throw Object.assign(new Error('Choose a valid supplier selling-unit mode.'), { status: 400 });
  return mode;
}

function sellingUnits(vendor = {}, item = {}, legacyRules = vendor.variationRules || {}) {
  const mode = validateSellingUnitMode(vendor.variationRules?.sellingUnitMode);
  const minimums = [item.minQuantity, item.min_quantity, item.quantityIncrements, item.quantity_increments]
    .map(Number).filter(value => Number.isSafeInteger(value) && value > 1);
  const supplierMinimumQuantity = Math.max(1, ...minimums);
  const quantity = mode === 'inherit' ? Number(item.uomQty ?? item.uom_qty ?? 1)
    : Math.max(Number(item.uomQty ?? item.uom_qty ?? 1), supplierMinimumQuantity);
  const sourceQty = Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null;
  const legacyBoth = legacyRules.shopifyVariantMode === 'each-and-uom' && legacyRules.allowShopifyVariations !== false;
  const individual = mode === 'individual-only' || mode === 'individual-and-case' ||
    (mode === 'supplier-uom' || mode === 'inherit') && (sourceQty === 1 || mode === 'inherit' && legacyBoth);
  const cases = sourceQty > 1 && mode !== 'individual-only';
  // An explicit supplier permission may break the purchasing multiple into individual sales.
  const allowsBreakingPacks = mode === 'individual-only' || mode === 'individual-and-case';
  return { mode, sourceQty, supplierMinimumQuantity, individual: Boolean(individual && (allowsBreakingPacks || supplierMinimumQuantity <= 1)), cases: Boolean(cases),
    explicit: mode !== 'inherit' };
}

function permitsUnit(policy, quantity) {
  return Number(quantity) === 1 ? policy.individual : policy.cases && Number(quantity) === policy.sourceQty;
}

module.exports = { modes, validateSellingUnitMode, sellingUnits, permitsUnit };
