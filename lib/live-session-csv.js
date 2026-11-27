const MAX_CSV_BYTES = 5 * 1024 * 1024;
const MAX_CSV_ROWS = 5000;
const MAX_STORED_ROWS = 2000;

const text = value => String(value ?? '').trim();
const compact = value => text(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
const titleKey = value => text(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const unique = values => [...new Set(values.map(text).filter(Boolean))];

function parseCsv(input = '') {
  const source = String(input || '').replace(/^\uFEFF/, '');
  if (!source.trim()) throw Object.assign(new Error('The CSV file is empty.'), { statusCode: 400 });
  if (Buffer.byteLength(source, 'utf8') > MAX_CSV_BYTES) throw Object.assign(new Error('Choose a CSV file no larger than 5 MB.'), { statusCode: 413 });
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
      if (rows.length > MAX_CSV_ROWS + 20) throw Object.assign(new Error(`The CSV contains more than ${MAX_CSV_ROWS.toLocaleString()} product rows.`), { statusCode: 413 });
    } else cell += character;
  }
  if (quoted) throw Object.assign(new Error('The CSV ends inside a quoted field.'), { statusCode: 400 });
  row.push(cell.replace(/\r$/, ''));
  if (row.some(value => text(value))) rows.push(row);
  return rows;
}

const HEADER_ALIASES = Object.freeze({
  productId: ['product_id', 'productid', 'tiktok_product_id', 'listing_id', 'listingid'],
  sellerSku: ['seller_sku', 'sellersku', 'merchant_sku', 'merchantsku', 'sku', 'seller_stock_keeping_unit'],
  productName: ['product_name', 'productname', 'title', 'product_title', 'producttitle', 'name'],
  quantity: ['quantity', 'qty', 'stock', 'inventory'],
  startingBid: ['starting_bid_price', 'startingbidprice', 'starting_bid', 'startingbid', 'price']
});

const knownHeaders = new Set(Object.values(HEADER_ALIASES).flat().map(compact));

function findHeaderRow(rows = []) {
  let best = { index: 0, score: -1 };
  rows.slice(0, 20).forEach((row, index) => {
    const keys = row.map(compact);
    const score = keys.reduce((sum, key) => sum + (knownHeaders.has(key) ? 1 : 0), 0)
      + (keys.includes('productname') ? 2 : 0)
      + (keys.includes('productid') || keys.includes('sellersku') || keys.includes('merchantsku') ? 2 : 0);
    if (score > best.score) best = { index, score };
  });
  if (best.score <= 0) throw Object.assign(new Error('DataPlus could not find a product name, product ID, or seller SKU column in this CSV.'), { statusCode: 400 });
  return best.index;
}

function fieldValue(record = {}, aliases = []) {
  for (const alias of aliases) {
    const value = record[compact(alias)];
    if (text(value)) return text(value);
  }
  return '';
}

function csvProductRows(csv = '') {
  const rows = parseCsv(csv);
  const headerIndex = findHeaderRow(rows);
  const headers = rows[headerIndex].map(compact);
  const products = [];
  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const raw = rows[rowIndex];
    const record = Object.fromEntries(headers.map((header, index) => [header, raw[index] ?? '']));
    const productId = fieldValue(record, HEADER_ALIASES.productId);
    const sellerSku = fieldValue(record, HEADER_ALIASES.sellerSku);
    const productName = fieldValue(record, HEADER_ALIASES.productName);
    if (!productId && !sellerSku && !productName) continue;
    products.push({
      rowNumber: rowIndex + 1,
      productId,
      sellerSku,
      productName,
      quantity: Math.max(0, Number(fieldValue(record, HEADER_ALIASES.quantity).replace(/[$,]/g, '')) || 0),
      startingBid: Math.max(0, Number(fieldValue(record, HEADER_ALIASES.startingBid).replace(/[$,]/g, '')) || 0)
    });
  }
  if (!products.length) throw Object.assign(new Error('The CSV does not contain any product rows after its header.'), { statusCode: 400 });
  if (products.length > MAX_CSV_ROWS) throw Object.assign(new Error(`The CSV contains more than ${MAX_CSV_ROWS.toLocaleString()} product rows.`), { statusCode: 413 });
  return { headerIndex, products };
}

function itemIdentity(item = {}) {
  return {
    item,
    productIds: unique([
      item.tiktokLiveSync?.productId,
      item.launch?.listingId,
      item.launch?.productId,
      item.launch?.offerId,
      item.tiktokProductId
    ]).map(compact),
    skus: unique([
      item.launch?.merchantSku,
      item.merchantSku,
      item.sku,
      item.catalogSku,
      item.manufacturerSku,
      item.manufacturerPartNumber,
      item.mfrPartNumber,
      item.supplierSku
    ]).map(compact),
    titles: unique([item.launchTitle, item.launch?.title, item.title]).map(titleKey)
  };
}

function rowCandidates(row = {}, identities = []) {
  const productId = compact(row.productId);
  if (productId) {
    const candidates = identities.filter(identity => identity.productIds.includes(productId));
    if (candidates.length) return { candidates, basis: 'product_id' };
  }
  const sellerSku = compact(row.sellerSku);
  if (sellerSku) {
    const candidates = identities.filter(identity => identity.skus.includes(sellerSku));
    if (candidates.length) return { candidates, basis: 'seller_sku' };
  }
  const productName = titleKey(row.productName);
  if (productName) {
    const candidates = identities.filter(identity => identity.titles.includes(productName));
    if (candidates.length) return { candidates, basis: 'product_name' };
  }
  return { candidates: [], basis: '' };
}

function reconcileLiveSessionCsv({ session = {}, csv = '', filename = '', actor = '' } = {}) {
  const { products } = csvProductRows(csv);
  const identities = (Array.isArray(session.items) ? session.items : []).map(itemIdentity);
  const matchedItemIds = new Set();
  const seenItemIds = new Set();
  const rows = products.map(row => {
    const { candidates, basis } = rowCandidates(row, identities);
    if (candidates.length !== 1) {
      return {
        ...row,
        status: candidates.length ? 'ambiguous' : 'unmatched',
        matchBasis: basis,
        candidateSkus: candidates.map(candidate => text(candidate.item.sku || candidate.item.catalogSku)).filter(Boolean)
      };
    }
    const item = candidates[0].item;
    const sessionItemId = text(item.id || item.sourceLineId || item.productId || item.sku);
    matchedItemIds.add(sessionItemId);
    const duplicate = seenItemIds.has(sessionItemId);
    seenItemIds.add(sessionItemId);
    return {
      ...row,
      status: 'matched',
      matchBasis: basis,
      duplicate,
      sessionItemId,
      sessionSku: text(item.sku || item.catalogSku),
      sessionTitle: text(item.launchTitle || item.launch?.title || item.title)
    };
  });
  const missingSessionItems = identities
    .filter(identity => !matchedItemIds.has(text(identity.item.id || identity.item.sourceLineId || identity.item.productId || identity.item.sku)))
    .map(identity => ({
      sessionItemId: text(identity.item.id || identity.item.sourceLineId || identity.item.productId || identity.item.sku),
      sku: text(identity.item.sku || identity.item.catalogSku),
      title: text(identity.item.launchTitle || identity.item.launch?.title || identity.item.title)
    }));
  const matchedRows = rows.filter(row => row.status === 'matched');
  const importedAt = new Date().toISOString();
  return {
    filename: text(filename).slice(0, 240) || 'tiktok-live-products.csv',
    importedAt,
    importedBy: text(actor).slice(0, 160) || 'DataPlus user',
    summary: {
      csvRows: rows.length,
      matchedRows: matchedRows.length,
      matchedSessionItems: matchedItemIds.size,
      duplicateRows: matchedRows.filter(row => row.duplicate).length,
      ambiguousRows: rows.filter(row => row.status === 'ambiguous').length,
      unmatchedRows: rows.filter(row => row.status === 'unmatched').length,
      sessionItemsMissingFromCsv: missingSessionItems.length,
      storedRows: Math.min(rows.length, MAX_STORED_ROWS),
      truncatedRows: Math.max(0, rows.length - MAX_STORED_ROWS)
    },
    rows: rows.slice(0, MAX_STORED_ROWS),
    missingSessionItems: missingSessionItems.slice(0, MAX_STORED_ROWS)
  };
}

function studioProductsWithSessionSkus(session = {}, products = []) {
  const identities = (Array.isArray(session.items) ? session.items : []).map(itemIdentity);
  return (Array.isArray(products) ? products : []).map(product => {
    const row = { productId: text(product.productId || product.id), productName: text(product.title || product.name), sellerSku: '' };
    const { candidates, basis } = rowCandidates(row, identities);
    const matched = candidates.length === 1 ? candidates[0].item : null;
    return {
      ...product,
      sku: matched ? text(matched.sku || matched.catalogSku) : '',
      merchantSku: matched ? text(matched.launch?.merchantSku || matched.merchantSku || matched.manufacturerSku || matched.sku) : '',
      sessionItemId: matched ? text(matched.id || matched.sourceLineId || matched.productId || matched.sku) : '',
      matchStatus: matched ? 'matched' : candidates.length ? 'ambiguous' : 'unmatched',
      matchBasis: matched ? basis : '',
      candidateSkus: candidates.map(candidate => text(candidate.item.sku || candidate.item.catalogSku)).filter(Boolean)
    };
  });
}

module.exports = {
  MAX_CSV_BYTES,
  MAX_CSV_ROWS,
  csvProductRows,
  parseCsv,
  reconcileLiveSessionCsv,
  studioProductsWithSessionSkus
};
