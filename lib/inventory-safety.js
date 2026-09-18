function optionalSafetyQty(value) {
  if (value === undefined || value === null || value === '') return null;
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error('Safety quantity must be a non-negative whole number.');
  return quantity;
}

function safetyVendor(product = {}, vendors = []) {
  const key = value => String(value || '').trim().toLowerCase();
  const id = key(product.vendorId || product.primary_vendor_id);
  if (id) {
    const match = vendors.find(vendor => key(vendor.id) === id);
    if (match) return match;
  }
  const tokens = [product.supplier, product.vendor, product.supplierCode, product.supplier_code].map(key).filter(Boolean);
  const matches = vendors.filter(vendor => {
    const codes = vendor.catalogSettings?.sourceCodes;
    return [vendor.name, vendor.code, vendor.vendorCode, ...(Array.isArray(codes) ? codes : String(codes || '').split(/[,;\n]/))].map(key).some(value => value && tokens.includes(value));
  });
  // Ambiguous supplier identities must not silently disable a stricter reserve.
  return matches.sort((a, b) => (optionalSafetyQty(b.inventoryRules?.safetyQty) ?? -1) - (optionalSafetyQty(a.inventoryRules?.safetyQty) ?? -1))[0] || null;
}

function resolveInventorySafety(product = {}, vendor = null, channelQty = 0) {
  if (product.bypassSafetyQty === true || product.raw?.bypassSafetyQty === true) return { quantity: 0, source: 'sku_bypass' };
  const quantity = optionalSafetyQty(vendor?.inventoryRules?.safetyQty);
  if (quantity !== null) return { quantity, source: 'vendor' };
  return { quantity: optionalSafetyQty(channelQty) ?? 0, source: 'channel' };
}

module.exports = { optionalSafetyQty, safetyVendor, resolveInventorySafety };
