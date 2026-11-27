const DEFAULTS = Object.freeze({
  categoryId: '884488',
  categoryName: 'Tools & Hardware - Hand Tools - Tool Kits',
  complianceValue: 'None of the above (VID: 1328920)',
  auctionMode: 'extendable',
  auctionDuration: 10,
  extendedAuctionDuration: 7
});

const TEMPLATE_ROWS = Object.freeze([
  [
    'Product name',
    'Category',
    'Does your product contain the following? (ID: 104355)',
    'Warehouse',
    'Quantity',
    'Package weight (g)',
    'Height (cm)',
    'Width (cm)',
    'Length (cm)',
    'Starting bid',
    'Auction format',
    'Duration',
    'Extend auction duration',
    'Main Image',
    '',
    ''
  ],
  [
    'Mandatory', 'Mandatory', 'Mandatory', 'Mandatory', 'Mandatory', 'Mandatory', 'Mandatory',
    'Mandatory', 'Mandatory', 'Mandatory', 'Mandatory', 'Mandatory', 'Optional', 'Optional', '', ''
  ],
  [
    "The product name can't exceed 255 characters.",
    'Format required: Category name (ID 1234567)',
    'Select the value for Does your product contain the following?.',
    'Format required: Warehouse name (ID 1234567)',
    'Enter the stock amount based on your actual inventory for sale. Mispresenting the stock for sale will be penalized.',
    "Enter the weight of the product after it's packaged. \nProduct weight will affect the calculation of the shipping fee. Ensure that the weight is supported by the carrier. \nIf there is a difference between the weight entered and the actual weight, you may be required to make up the difference.",
    "Enter the product dimensions after it's packaged to calculate the shipping fee based on the dimensions. \nProduct dimensions will affect the calculation of the shipping fee. Ensure that the dimensions are supported by the carrier. \nIf there is a difference between the dimensions entered and the actual dimensions, you may be required to make up the difference.",
    '',
    '',
    'Whole number above 0 (USD)',
    'Choose whether the auction ends at a fixed time or extends to let people keep bidding.',
    'Duration is the time limit of the auction.',
    'Required when auction mode is extended. Acceptable time extensions can be viewed online during setup.',
    'Enter the main product image URL (http:// or https://). Optional.',
    '',
    ''
  ],
  [
    'Product name',
    `${DEFAULTS.categoryName} (ID: ${DEFAULTS.categoryId})`,
    DEFAULTS.complianceValue,
    'U.S Pickup Warehouse (ID: 7670222102360426254)',
    '10',
    '250',
    '15',
    '20',
    '30',
    '9',
    DEFAULTS.auctionMode,
    String(DEFAULTS.auctionDuration),
    String(DEFAULTS.extendedAuctionDuration),
    'https://example.com/main.jpg',
    '',
    ''
  ],
  [
    'product_name',
    'category',
    'compliance_prop_104355',
    'warehouse',
    'quantity',
    'package_weight',
    'package_height',
    'package_width',
    'package_length',
    'starting_bid_price',
    'auction_mode',
    'auction_duration',
    'extended_auction_duration',
    'main_image',
    '__product_batch_required_properties=[104355]',
    '__product_batch_multi_select_properties=[]'
  ]
]);

const text = value => String(value ?? '').trim();
const positive = value => {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
};
const compact = value => text(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
const csvCell = value => `"${String(value ?? '').replace(/"/g, '""')}"`;

function productKeys(product = {}) {
  return [product.id, product.productId, product.sku, product.catalogSku].map(compact).filter(Boolean);
}

function productForItem(item = {}, products = []) {
  const keys = new Set([item.productId, item.sku, item.catalogSku].map(compact).filter(Boolean));
  return products.find(product => productKeys(product).some(key => keys.has(key))) || null;
}

function weightInGrams(product = {}) {
  const value = positive(product.packageWeight ?? product.package_weight);
  const unit = text(product.packageWeightUnit || product.weightUnit || product.weight_unit || 'lb').toLowerCase();
  if (!value) return 0;
  if (['g', 'gram', 'grams'].includes(unit)) return Math.ceil(value);
  if (['kg', 'kilogram', 'kilograms'].includes(unit)) return Math.ceil(value * 1000);
  if (['oz', 'ounce', 'ounces'].includes(unit)) return Math.ceil(value * 28.349523125);
  return Math.ceil(value * 453.59237);
}

function dimensionInCentimeters(value, unit = 'in') {
  const number = positive(value);
  if (!number) return 0;
  const normalized = text(unit || 'in').toLowerCase();
  if (['cm', 'centimeter', 'centimeters'].includes(normalized)) return Math.ceil(number);
  if (['mm', 'millimeter', 'millimeters'].includes(normalized)) return Math.ceil(number / 10);
  if (['m', 'meter', 'meters'].includes(normalized)) return Math.ceil(number * 100);
  return Math.ceil(number * 2.54);
}

function categoryValue(product = {}, defaults = {}) {
  const category = product.tiktokCategory && typeof product.tiktokCategory === 'object' ? product.tiktokCategory : {};
  const listing = product.tiktokListing && typeof product.tiktokListing === 'object' ? product.tiktokListing : {};
  const id = text(product.tiktokCategoryId || category.categoryId || listing.categoryId || defaults.categoryId || DEFAULTS.categoryId);
  const path = Array.isArray(category.categoryPath) ? category.categoryPath.map(text).filter(Boolean) : [];
  const name = text(path.join(' - ') || category.categoryName || category.name || listing.categoryName || defaults.categoryName || DEFAULTS.categoryName);
  return id && name ? `${name} (ID: ${id})` : '';
}

function imageValue(item = {}, product = {}) {
  const candidates = [
    item.launchImage,
    item.image,
    product.defaultImage,
    product.image,
    product.mainImage,
    product.imageUrl,
    product.tiktokListing?.mainImageUrl
  ].map(text);
  return candidates.find(value => /^https?:\/\//i.test(value)) || '';
}

function warehouseValue(product = {}, warehouses = [], defaultWarehouseId = '') {
  const listing = product.tiktokListing && typeof product.tiktokListing === 'object' ? product.tiktokListing : {};
  const requestedId = text(product.tiktokWarehouseId || listing.warehouseId || defaultWarehouseId);
  const selected = warehouses.find(row => text(row.id) === requestedId)
    || warehouses.find(row => row.isDefault === true)
    || warehouses[0]
    || null;
  const id = text(selected?.id || requestedId);
  const name = text(selected?.name || selected?.warehouseName || (id ? 'TikTok warehouse' : ''));
  return { id, name, value: id && name ? `${name} (ID: ${id})` : '' };
}

function buildTikTokLiveAuctionCsv({ session = {}, items = [], products = [], warehouses = [], defaults = {} } = {}) {
  const options = { ...DEFAULTS, ...defaults };
  const grouped = new Map();
  for (const rawItem of items) {
    const quantity = Math.max(0, Math.floor(Number(rawItem.remainingQty ?? rawItem.reservedQty ?? 0) || 0));
    if (!quantity) continue;
    const product = productForItem(rawItem, products);
    const key = compact(product?.id || product?.sku || rawItem.productId || rawItem.sku || rawItem.id);
    if (!key) continue;
    const existing = grouped.get(key);
    if (existing) {
      existing.quantity += quantity;
      existing.startingBid = Math.max(existing.startingBid, positive(rawItem.salePrice) || 1);
      continue;
    }
    grouped.set(key, {
      item: rawItem,
      product,
      quantity,
      startingBid: positive(rawItem.salePrice) || 1
    });
  }

  const rows = [];
  const rejected = [];
  for (const entry of grouped.values()) {
    const { item, product, quantity } = entry;
    const sku = text(item.sku || product?.sku || item.productId || item.id || 'Unknown SKU');
    const productName = text(item.launchTitle || item.launch?.title || item.title || product?.marketplaceTitle || product?.title).slice(0, 255);
    const category = categoryValue(product || {}, options);
    const warehouse = warehouseValue(product || {}, warehouses, options.warehouseId);
    const dimensionUnit = text(product?.packageDimensionUnit || product?.dimensionUnit || product?.dimension_unit || 'in');
    const packageWeight = weightInGrams(product || {});
    const packageHeight = dimensionInCentimeters(product?.packageHeight ?? product?.package_height, dimensionUnit);
    const packageWidth = dimensionInCentimeters(product?.packageWidth ?? product?.package_width, dimensionUnit);
    const packageLength = dimensionInCentimeters(product?.packageLength ?? product?.package_length, dimensionUnit);
    const startingBid = Math.max(1, Math.ceil(entry.startingBid));
    const issues = [
      !product && 'catalog product was not found',
      !productName && 'product name is missing',
      !category && 'TikTok category is missing',
      !warehouse.value && 'TikTok warehouse is missing',
      !packageWeight && 'package weight is missing',
      (!packageHeight || !packageWidth || !packageLength) && 'complete package dimensions are missing'
    ].filter(Boolean);
    if (issues.length) {
      rejected.push({ sku, issues });
      continue;
    }
    rows.push([
      productName,
      category,
      text(product?.tiktokComplianceProp104355 || product?.tiktokAuction?.complianceValue || options.complianceValue),
      warehouse.value,
      String(quantity),
      String(packageWeight),
      String(packageHeight),
      String(packageWidth),
      String(packageLength),
      String(startingBid),
      text(options.auctionMode || DEFAULTS.auctionMode),
      String(Math.max(1, Math.floor(Number(options.auctionDuration || DEFAULTS.auctionDuration)))),
      text(options.auctionMode || DEFAULTS.auctionMode) === 'extendable'
        ? String(Math.max(1, Math.floor(Number(options.extendedAuctionDuration || DEFAULTS.extendedAuctionDuration))))
        : '',
      imageValue(item, product || {}),
      '',
      ''
    ]);
  }

  const csv = [...TEMPLATE_ROWS, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
  return {
    csv,
    rows,
    rejected,
    productCount: rows.length,
    skippedCount: rejected.length,
    sourceItemCount: grouped.size,
    sessionNumber: text(session.sessionNumber || session.id)
  };
}

module.exports = {
  DEFAULTS,
  TEMPLATE_ROWS,
  buildTikTokLiveAuctionCsv,
  dimensionInCentimeters,
  weightInGrams
};
