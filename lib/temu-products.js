const crypto = require('node:crypto');

const text = (value, limit = 10_000) => String(value ?? '').trim().slice(0, limit);
const number = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function listingForAccount(product = {}, accountId = '') {
  const id = text(accountId, 256);
  const listings = product.temuListings && typeof product.temuListings === 'object' ? product.temuListings : {};
  if (id && listings[id] && typeof listings[id] === 'object') return listings[id];
  const legacy = product.temuListing && typeof product.temuListing === 'object' ? product.temuListing : {};
  return !legacy.accountId || legacy.accountId === id ? legacy : {};
}

function imageUrl(value) {
  const candidate = typeof value === 'string'
    ? value
    : value && typeof value === 'object'
      ? value.url || value.src || value.imageUrl || value.originalUrl || value.previewUrl
      : '';
  const normalized = text(candidate, 4096);
  return /^https:\/\//i.test(normalized) ? normalized : '';
}

function productImages(product = {}, existing = {}) {
  const candidates = [
    ...(Array.isArray(existing.images) ? existing.images : []),
    product.defaultImage,
    product.imageUrl,
    product.primaryImage,
    product.featuredImage,
    ...(Array.isArray(product.images) ? product.images : []),
    ...(Array.isArray(product.media) ? product.media : []),
    ...(Array.isArray(product.imageUrls) ? product.imageUrls : [])
  ];
  return [...new Set(candidates.map(imageUrl).filter(Boolean))].slice(0, 10);
}

function productBullets(product = {}) {
  const source = Array.isArray(product.bulletPoints)
    ? product.bulletPoints
    : Array.isArray(product.bullets)
      ? product.bullets
      : [];
  return source.map(value => text(value, 200)).filter(Boolean).slice(0, 6);
}

function draftForAccount(product = {}, account = {}, overrides = {}) {
  const accountId = text(account.id || account.accountId, 256);
  const existing = listingForAccount(product, accountId);
  const savedDraft = existing.draft && typeof existing.draft === 'object' ? existing.draft : {};
  const value = (key, fallback) => overrides[key] !== undefined && overrides[key] !== null && overrides[key] !== ''
    ? overrides[key]
    : savedDraft[key] !== undefined && savedDraft[key] !== null && savedDraft[key] !== ''
      ? savedDraft[key]
      : fallback;
  const basePrice = number(value('price', product.temuPrice || product.websitePrice || product.price || product.listPrice));
  const suggestedListPrice = Math.max(number(product.msrp || product.listPrice), basePrice > 0 ? Math.ceil(basePrice * 120) / 100 : 0);
  const images = Array.isArray(value('images', null))
    ? [...new Set(value('images', []).map(imageUrl).filter(Boolean))].slice(0, 10)
    : productImages(product, savedDraft);
  return {
    accountId,
    accountName: text(account.mallName || account.label || account.accountName || account.mallId || accountId, 256),
    mallId: text(account.mallId, 256),
    merchantSku: text(value('merchantSku', product.temuSku || product.sku || product.id), 256),
    externalGoodsId: text(value('externalGoodsId', product.sku || product.id), 256),
    title: text(value('title', product.marketplaceTitle || product.title), 500),
    description: text(value('description', product.longDescription || product.shortDescription || product.description), 10_000),
    bulletPoints: Array.isArray(value('bulletPoints', null)) ? value('bulletPoints', []).map(row => text(row, 200)).filter(Boolean).slice(0, 6) : productBullets(product),
    images,
    quantity: Math.max(0, Math.floor(number(value('quantity', product.physicalAvailable ?? product.available ?? product.qty ?? product.stockQty)))),
    price: Math.max(0, basePrice),
    listPrice: Math.max(0, number(value('listPrice', suggestedListPrice))),
    currency: text(value('currency', 'USD'), 8).toUpperCase() || 'USD',
    handlingDays: Math.max(0, Math.min(2, Math.floor(number(value('handlingDays', 1))))),
    categoryId: text(value('categoryId', product.temuCategoryId || existing.categoryId), 64),
    shippingTemplateId: text(value('shippingTemplateId', existing.shippingTemplateId), 128),
    packageLength: Math.max(0, number(value('packageLength', product.packageLength || product.itemLength))),
    packageWidth: Math.max(0, number(value('packageWidth', product.packageWidth || product.itemWidth))),
    packageHeight: Math.max(0, number(value('packageHeight', product.packageHeight || product.itemHeight))),
    packageWeight: Math.max(0, number(value('packageWeight', product.packageWeight || product.itemWeight))),
    barcode: text(value('barcode', product.barcode || product.upc || product.gtin), 64),
    brand: text(value('brand', product.brand || product.manufacturer), 256),
    existingGoodsId: text(existing.goodsId || product.temuProductId || product.temuId, 128),
    existingStatus: text(existing.status, 64),
    sourceSku: text(product.sku || product.id, 256)
  };
}

function productLaunchReadiness(product = {}, account = {}, overrides = {}) {
  const draft = draftForAccount(product, account, overrides);
  const blockers = [];
  const warnings = [];
  const block = (code, field, message) => blockers.push({ code, field, message });
  const warn = (code, field, message) => warnings.push({ code, field, message });
  if (!draft.accountId || account.configured === false || (!account.accessToken && account.configured !== true)) block('account_not_connected', 'accountId', 'Connect the selected Temu shop before launching.');
  if (product.active === false || ['inactive', 'discontinued', 'retired'].includes(text(product.status).toLowerCase()) || product.toBeDiscontinued === true) block('product_inactive', 'status', 'Inactive or discontinued products cannot be launched.');
  if (product.systemCreatedFromOrderImport === true && product.catalogAttentionRequired !== false && !['approved', 'complete', 'completed', 'resolved'].includes(text(product.catalogAttentionStatus).toLowerCase())) block('catalog_review_required', 'catalogAttentionStatus', 'Complete the catalog review for this system-created SKU before launch.');
  if (!draft.title) block('title_missing', 'title', 'Add a Temu product title.');
  if (!draft.description) block('description_missing', 'description', 'Add a product description.');
  if (!draft.merchantSku) block('merchant_sku_missing', 'merchantSku', 'Add a merchant SKU for this shop.');
  if (draft.price <= 0) block('price_missing', 'price', 'Enter a Temu price greater than zero.');
  if (draft.listPrice <= draft.price) block('list_price_invalid', 'listPrice', 'List price must be greater than the selling price.');
  if (draft.quantity <= 0) block('inventory_missing', 'quantity', 'Temu requires a launch quantity greater than zero.');
  if (draft.images.length < 3) block('images_missing', 'images', 'Add at least three HTTPS product images for Temu.');
  if (!draft.packageLength || !draft.packageWidth || !draft.packageHeight || !draft.packageWeight) block('package_missing', 'packageInfo', 'Package length, width, height, and weight are required.');
  if (draft.existingGoodsId) block('already_launched', 'goodsId', `This shop is already linked to Temu goods ${draft.existingGoodsId}. Use the listing update workflow instead of creating a duplicate.`);
  if (['submitting', 'verification_required'].includes(draft.existingStatus.toLowerCase())) block('launch_verification_required', 'status', 'Verify this shop in Temu Seller Center before trying another launch. The previous submission may have reached Temu.');
  if (!draft.barcode) warn('barcode_missing', 'barcode', 'No UPC or GTIN is saved. Temu may require one for the selected category.');
  if (!draft.categoryId) warn('category_recommendation', 'categoryId', 'No Temu category is pinned. Temu V3 will recommend a category from the submitted product data.');
  const scopes = Array.isArray(account.apiScopeList) ? account.apiScopeList.map(scope => text(scope).toLowerCase()) : [];
  if (scopes.length && !scopes.some(scope => scope.includes('goods.add') || scope.includes('product management'))) warn('scope_unconfirmed', 'permissions', 'The saved token does not explicitly report Temu Product Management access. Launch may require the seller to reconnect after enabling that permission.');
  return { ready: blockers.length === 0, blockers, warnings, draft };
}

function addProductPayload(product = {}, account = {}, overrides = {}) {
  const readiness = productLaunchReadiness(product, account, overrides);
  const draft = readiness.draft;
  const goodsBasic = {
    externalGoodsId: draft.externalGoodsId,
    goodsName: draft.title,
    goodsDesc: draft.description,
    bulletPoints: draft.bulletPoints,
    goodsCarouselImage: draft.images,
    detailImage: draft.images,
    shipmentLimitDay: draft.handlingDays,
    productType: 1,
    ...(draft.categoryId ? { assignedPrimaryCatId: Number(draft.categoryId) || draft.categoryId } : {}),
    ...(draft.shippingTemplateId ? { costTemplate: draft.shippingTemplateId } : {})
  };
  const sku = {
    externalSkuId: draft.merchantSku,
    quantity: draft.quantity,
    images: draft.images,
    price: {
      basePrice: { amount: draft.price.toFixed(2), currency: draft.currency },
      listPrice: { amount: draft.listPrice.toFixed(2), currency: draft.currency }
    },
    packageInfo: {
      length: String(draft.packageLength),
      width: String(draft.packageWidth),
      height: String(draft.packageHeight),
      weight: String(draft.packageWeight)
    },
    ...(draft.barcode ? { barCode: { barCodeId: [draft.barcode], barCodeType: 'UPC' } } : {})
  };
  return {
    readiness,
    payload: {
      version: 'V3',
      language: 'en',
      goodsBasic,
      ...(draft.brand ? { attributes: [{ name: 'Brand', value: [draft.brand] }] } : {}),
      skuList: [sku]
    }
  };
}

function launchFingerprint(product = {}, account = {}, overrides = {}) {
  const built = addProductPayload(product, account, overrides);
  return crypto.createHash('sha256').update(JSON.stringify([built.readiness.draft.accountId, built.payload])).digest('hex');
}

function launchResult(response = {}) {
  const result = response.result && typeof response.result === 'object'
    ? response.result.result && typeof response.result.result === 'object' ? response.result.result : response.result
    : {};
  const errorCode = Number(response.errorCode ?? response.error_code ?? result.errorCode ?? 0) || 0;
  const success = response.success !== false && result.success !== false && (!errorCode || errorCode === 1000000);
  return {
    success,
    goodsId: text(result.goodsId || result.goods_id || response.goodsId, 128),
    externalGoodsId: text(result.externalGoodsId || result.external_goods_id, 256),
    errorCode,
    errorMessage: text(response.errorMsg || response.error_msg || result.errorMsg || result.errorMessage, 1000)
  };
}

module.exports = {
  addProductPayload,
  draftForAccount,
  launchFingerprint,
  launchResult,
  listingForAccount,
  productLaunchReadiness
};
