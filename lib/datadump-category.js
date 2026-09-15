// DataWarehouse may encode its taxonomy as ordered levels rather than a path.
function mappedTaxonomy(record = {}) {
  let value = record.mappedCategory ?? record.mapped_category ?? record.productManagerFields?.mapped_category;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return { path: '', unspsc: '' }; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { path: '', unspsc: '' };
  const levels = Object.keys(value).filter(key => /^level[1-9]\d*$/.test(key))
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)))
    .map(key => typeof value[key] === 'string' ? value[key].replace(/\s+/g, ' ').trim() : '')
    .filter(Boolean);
  return { path: levels.join(' > '), unspsc: ['string', 'number'].includes(typeof value.unspsc) ? String(value.unspsc).trim() : '' };
}
module.exports = { mappedTaxonomy };
