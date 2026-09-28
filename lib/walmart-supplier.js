const { retiredSupplier } = require('./supplier-retirement');
// An inactive feed-code alias must not override an explicitly identified canonical supplier.
function walmartSupplierBlock(product, vendors = []) {
  const norm = value => String(value || '').trim().toLowerCase();
  const byId = product.vendorId ? vendors.filter(v => norm(v.id) === norm(product.vendorId)) : [];
  const names = [product.vendor, product.supplier].map(norm).filter(Boolean);
  const byName = vendors.filter(v => names.includes(norm(v.name)));
  const candidates = byId.length ? byId : byName;
  const canonical = candidates.length === 1 ? candidates[0] : null;
  if (!canonical) return retiredSupplier(product, vendors);
  // Explicit retirement records and product retirement markers still require review.
  return retiredSupplier(product, [canonical, ...vendors.filter(v => v !== canonical && v.retirement?.retiredAt)]);
}
module.exports = { walmartSupplierBlock };
