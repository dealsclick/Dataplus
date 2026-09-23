function text(value) {
  return String(value || '').trim();
}

function identifierUnitQty(item = {}) {
  const uom = text(item.uom || item.uomCode || item.unitOfMeasure).toUpperCase();
  if (['EA', 'EACH', 'PC', 'PCS', 'PIECE', 'UNIT'].includes(uom)) return 1;
  const explicit = [item.uomQty, item.uom_qty, item.packQty, item.pack_qty]
    .map(Number)
    .find(value => Number.isSafeInteger(value) && value > 0);
  return explicit || 1;
}

function validGtin(value) {
  const digits = text(value).replace(/[^0-9]/g, '');
  if (![8, 12, 13, 14].includes(digits.length) || /^0+$/.test(digits)) return false;
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let index = body.length - 1, position = 0; index >= 0; index -= 1, position += 1) {
    sum += Number(body[index]) * (position % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1));
}

function normalizeGtin(value, type = 'UPC') {
  let digits = text(value).replace(/[^0-9]/g, '');
  if (/^0+$/.test(digits)) return '';
  const normalizedType = text(type).toUpperCase();
  if ((!normalizedType || normalizedType === 'UPC' || normalizedType === 'GTIN') && digits.length === 11) digits = `0${digits}`;
  if ((normalizedType === 'EAN' || normalizedType === 'GTIN') && digits.length === 7) digits = `0${digits}`;
  return validGtin(digits) ? digits : '';
}

function normalizeEbayIdentifier(value, type = 'UPC') {
  const normalizedType = text(type).toUpperCase();
  if (normalizedType === 'MPN') return text(value);
  if (normalizedType === 'ISBN') {
    const isbn = text(value).replace(/[^0-9X]/gi, '').toUpperCase();
    return isbn.length === 10 || validGtin(isbn) ? isbn : '';
  }
  return normalizeGtin(value, normalizedType || 'UPC');
}

function sellingUnitIdentifierConfig(config = {}, item = {}, uomQty = 1) {
  if (Number(uomQty) === identifierUnitQty(item)) return { ...config };
  return { ...config, identifierValue: '', ePid: '' };
}

function hasVerifiedProductIdentifier(config = {}, item = {}) {
  return Boolean(
    text(config.identifierValue)
    || text(config.ePid)
    || (text(config.mpn) && text(item.brand || item.manufacturer))
  );
}

module.exports = { identifierUnitQty, validGtin, normalizeGtin, normalizeEbayIdentifier, sellingUnitIdentifierConfig, hasVerifiedProductIdentifier };
