const crypto = require('node:crypto');

// Only quantity-specific aspects can describe Each/pack choices. Color/size
// support alone does not make a category suitable for purchase-unit variations.
const quantityAspects = ['number in pack', 'number of items', 'pack size', 'unit quantity'];

function groupingPolicy(policy, aspects, variants) {
  if (typeof policy?.variationsSupported !== 'boolean') throw new Error('eBay variation support could not be verified. Retry the category metadata check.');
  if (!policy.variationsSupported) return { mode: 'separate', reason: 'Category does not support variations.' };
  for (const name of quantityAspects) {
    const aspect = aspects.find(row => String(row.localizedAspectName || row.name).toLowerCase() === name);
    const constraint = aspect?.aspectConstraint || {};
    if (constraint.aspectEnabledForVariations !== true) continue;
    const values = variants.map(row => String(row.uomQty));
    const allowed = (aspect.aspectValues || []).map(row => String(row.localizedValue));
    if (constraint.aspectMode === 'SELECTION_ONLY' && !values.every(value => allowed.includes(value))) continue;
    // Conditional aspect values need additional dependency validation; do not
    // infer that they are valid for every child just because their text matches.
    if ((aspect.aspectValues || []).some(row => values.includes(String(row.localizedValue)) && row.valueConstraints?.length)) continue;
    return { mode: 'group', aspectName: aspect.localizedAspectName || aspect.name, values };
  }
  return { mode: 'separate', reason: 'Category has no supported quantity variation for these pack sizes.' };
}

function allocateQuantities(units, variants, mode = 'split') {
  const available = Math.max(0, Math.floor(Number(units) || 0));
  const sizes = variants.map(row => Number(row.uomQty));
  if (sizes.some(size => !Number.isSafeInteger(size) || size < 1)) throw new Error('eBay pack sizes must be positive whole numbers.');
  if (mode === 'export') return sizes.map(() => available);
  if (mode === 'shared') return sizes.map(size => Math.floor(available / size));
  const budget = Math.floor(available / sizes.length);
  const result = sizes.map(size => Math.floor(budget / size));
  const remaining = available - result.reduce((sum, qty, i) => sum + qty * sizes[i], 0);
  const smallest = sizes.indexOf(Math.min(...sizes));
  result[smallest] += Math.floor(remaining / sizes[smallest]);
  return result;
}

function assertVariantIdentity(item, variants) {
  const listing = item.ebayListing || {};
  const saved = listing.variants || [];
  if (!saved.length && (listing.offerId || listing.listingId || item.ebayId)) {
    throw new Error('Existing single eBay offer/listing requires a reviewed variation migration. It will not be replaced or duplicated automatically.');
  }
  if (variants.length > 250) throw new Error('eBay supports at most 250 variations per listing.');
  const keys = variants.map(row => String(row.sku || '').trim());
  if (keys.some(key => !key || key.length > 50) || new Set(keys.map(key => key.toLowerCase())).size !== keys.length) {
    throw new Error('eBay variation SKUs must be unique and at most 50 characters.');
  }
  if (new Set(variants.map(row => Number(row.uomQty))).size !== variants.length) throw new Error('Duplicate eBay purchase-unit sizes require review.');
  if (saved.length && (saved.length !== variants.length || saved.some(row => !variants.some(next => next.sku === row.sku && Number(next.uomQty) === Number(row.uomQty))))) {
    throw new Error('Vendor purchase-unit rules changed. Review the existing eBay variation identities before relaunching.');
  }
}

function groupKey(item, marketplaceId) {
  return `dp-${crypto.createHash('sha256').update(`${marketplaceId}:${item.id || item.sku}`).digest('hex').slice(0, 40)}`;
}

function listingTargets(item) {
  const listing = item.ebayListing || {};
  return listing.variants?.length ? listing.variants : [{ ...listing, sku: listing.merchantSku || item.sku }];
}

module.exports = { groupingPolicy, allocateQuantities, assertVariantIdentity, groupKey, listingTargets };
