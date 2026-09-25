function normalizedText(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function stringValues(value) {
  return (Array.isArray(value) ? value : value == null ? [] : [value])
    .map(entry => String(entry || '').trim())
    .filter(Boolean);
}

function catalogSearchInput(item = {}, config = {}) {
  const identifierType = String(config.identifierType || '').trim().toUpperCase();
  const identifierValue = String(config.identifierValue || '').trim();
  const categoryId = String(config.categoryId || '').trim();
  if (identifierValue && ['UPC', 'EAN', 'ISBN', 'GTIN'].includes(identifierType)) return { kind: 'gtin', value: identifierValue, categoryId };
  const mpn = String(config.mpn || item.mfrPartNumber || '').trim();
  const brand = String(item.brand || item.manufacturer || '').trim();
  if (mpn && brand) return { kind: 'mpn_brand', value: mpn, brand, categoryId };
  return null;
}

function selectExactCatalogProduct(productSummaries = [], input = {}) {
  const exact = (Array.isArray(productSummaries) ? productSummaries : []).filter(row => {
    if (!row || !row.epid) return false;
    if (input.kind === 'gtin') return stringValues(row.gtin).some(value => normalizedText(value) === normalizedText(input.value));
    if (input.kind === 'mpn_brand') {
      return stringValues(row.mpn).some(value => normalizedText(value) === normalizedText(input.value))
        && normalizedText(row.brand) === normalizedText(input.brand);
    }
    return false;
  });
  const byEpid = new Map(exact.map(row => [String(row.epid), row]));
  if (byEpid.size === 1) return { status: 'matched', product: [...byEpid.values()][0] };
  if (byEpid.size > 1) return { status: 'ambiguous', candidates: [...byEpid.values()] };
  return { status: 'not_found', candidates: [] };
}

module.exports = { catalogSearchInput, selectExactCatalogProduct };
