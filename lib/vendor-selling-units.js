const modes = ['inherit', 'supplier-uom', 'individual-only', 'case-only', 'individual-and-case'];

function validateSellingUnitMode(value) {
  const mode = value == null || value === '' ? 'inherit' : String(value);
  if (!modes.includes(mode)) throw Object.assign(new Error('Choose a valid supplier selling-unit mode.'), { status: 400 });
  return mode;
}

function sellingUnits(vendor = {}, item = {}, legacyRules = vendor.variationRules || {}) {
  const mode = validateSellingUnitMode(vendor.variationRules?.sellingUnitMode);
  const quantity = Number(item.uomQty ?? item.uom_qty ?? 1);
  const sourceQty = Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null;
  const legacyBoth = legacyRules.shopifyVariantMode === 'each-and-uom' && legacyRules.allowShopifyVariations !== false;
  const individual = mode === 'individual-only' || mode === 'individual-and-case' ||
    (mode === 'supplier-uom' || mode === 'inherit') && (sourceQty === 1 || mode === 'inherit' && legacyBoth);
  const cases = sourceQty > 1 && mode !== 'individual-only';
  const minimum = Number(item.minQuantity ?? item.min_quantity ?? item.quantityIncrements ?? 1);
  return { mode, sourceQty, individual: Boolean(individual && !(minimum > 1)), cases: Boolean(cases),
    explicit: mode !== 'inherit' };
}

function permitsUnit(policy, quantity) {
  return Number(quantity) === 1 ? policy.individual : policy.cases && Number(quantity) === policy.sourceQty;
}

module.exports = { modes, validateSellingUnitMode, sellingUnits, permitsUnit };
