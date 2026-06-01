function hasText(value, min = 1) {
  return String(value || "").replace(/<[^>]+>/g, " ").trim().length >= min;
}

function numberValue(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function daysSince(value = "") {
  const ms = new Date(value || 0).getTime();
  if (!Number.isFinite(ms) || !ms) return null;
  return Math.max(0, Math.floor((Date.now() - ms) / 86400000));
}

function dataQualityIssueKey(label = "") {
  return String(label || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function defaultProductImageUrls(item = {}) {
  const raw = item.raw && typeof item.raw === "object" ? item.raw : {};
  const candidates = [
    item.defaultImage,
    item.image,
    item.imageUrl,
    raw.defaultImage,
    raw.image,
    raw.imageUrl,
    ...(Array.isArray(item.images) ? item.images : []),
    ...(Array.isArray(raw.images) ? raw.images : []),
    ...(Array.isArray(raw.imageUrls) ? raw.imageUrls : [])
  ];
  return [...new Set(candidates.flatMap((value) => {
    if (!value) return [];
    if (typeof value === "string") return [value];
    if (typeof value === "object") return [value.url, value.src, value.href].filter(Boolean);
    return [];
  }).map((value) => String(value || "").trim()).filter(Boolean))];
}

function defaultProductIsCloseout(item = {}) {
  const raw = item.raw && typeof item.raw === "object" ? item.raw : {};
  return item.toBeDiscontinued === true
    || raw.toBeDiscontinued === true
    || raw.to_be_discontinued === true
    || ["y", "yes", "true", "1"].includes(String(raw.toBeDiscontinued || raw.to_be_discontinued || item.to_be_discontinued || "").toLowerCase());
}

function defaultProductUomInfo(item = {}) {
  const qty = Math.max(1, numberValue(item.uomQty ?? item.uom_qty ?? item.raw?.uomQty ?? item.raw?.uom_qty, 1));
  return { qty, isMultiUnit: qty > 1 };
}

function defaultShopifyPurchaseVariants(item = {}) {
  const uom = defaultProductUomInfo(item);
  const quantity = numberValue(item.qty ?? item.stockQty ?? item.raw?.qty ?? item.raw?.stockQty, 0);
  const price = numberValue(item.websitePrice ?? item.shopifyPrice ?? item.price ?? item.raw?.websitePrice ?? item.raw?.price, 0);
  const variants = [{ key: "each", sku: item.sku || "", price, quantity }];
  if (uom.isMultiUnit) variants.unshift({ key: "pack", sku: `${item.sku || ""}-${uom.qty}PC`, price: price * uom.qty, quantity });
  return variants;
}

function scoreFor(checks = []) {
  return Math.round((checks.filter((check) => check.ok).length / Math.max(1, checks.length)) * 100);
}

function summarizeQualityRows(rows = [], storage = "") {
  const issueCounts = {};
  const typeCounts = {};
  for (const row of rows) {
    for (const issue of row.issues || []) issueCounts[issue] = (issueCounts[issue] || 0) + 1;
    for (const type of row.issueTypes || []) typeCounts[type] = (typeCounts[type] || 0) + 1;
  }
  return {
    generatedAt: new Date().toISOString(),
    total: rows.length,
    productReady: rows.filter((row) => row.ready).length,
    needsWork: rows.filter((row) => !row.ready).length,
    shopifyReady: rows.filter((row) => row.shopifyReady).length,
    shopifyLive: rows.filter((row) => row.shopifyLive).length,
    ebayReady: rows.filter((row) => row.ebayReady).length,
    ebayLive: rows.filter((row) => row.ebayLive).length,
    staleShopify: rows.filter((row) => row.staleDays !== null && row.staleDays > 7).length,
    closeouts: rows.filter((row) => row.toBeDiscontinued).length,
    issueCounts: Object.fromEntries(Object.entries(issueCounts).sort((a, b) => b[1] - a[1])),
    typeCounts,
    ...(storage ? { storage } : {})
  };
}

function createDataQualityEngine(helpers = {}) {
  const productImageUrls = helpers.productImageUrls || defaultProductImageUrls;
  const productIsCloseout = helpers.productIsCloseout || defaultProductIsCloseout;
  const productUomInfo = helpers.productUomInfo || defaultProductUomInfo;
  const shopifyPurchaseVariants = helpers.shopifyPurchaseVariants || defaultShopifyPurchaseVariants;
  const sourceCatalogCost = helpers.sourceCatalogCost || ((item = {}) => numberValue(item.sourceCost ?? item.cost ?? item.raw?.sourceCost ?? item.raw?.cost ?? item.raw?.vendorCost, 0));
  const marketplaceSuggestedPrice = helpers.marketplaceSuggestedPrice || ((item = {}, settings = {}) => numberValue(item.websitePrice ?? item.shopifyPrice ?? item.price ?? settings.price, 0));
  const marketplaceListingQuantity = helpers.marketplaceListingQuantity || ((item = {}) => numberValue(item.qty ?? item.stockQty ?? item.raw?.qty ?? item.raw?.stockQty, 0) - numberValue(item.reserved ?? item.raw?.reserved, 0));
  const categoryMappingForProduct = helpers.categoryMappingForProduct || (() => ({}));
  const categorySettingForProduct = helpers.categorySettingForProduct || (() => ({}));
  const ebayListingCategoryId = helpers.ebayListingCategoryId || (() => "");
  const ebayChannelSettings = helpers.ebayChannelSettings || (() => ({}));
  const withShopifyStatus = helpers.withShopifyStatus || ((item = {}, statusMap = {}) => ({ ...item, ...(statusMap[String(item.sku || "").toLowerCase()] || {}) }));

  function productQualityChecks(item = {}) {
    const available = numberValue(item.qty ?? item.stockQty, 0) - numberValue(item.reserved, 0);
    return [
      { type: "product", key: "title", label: "Title", ok: hasText(item.marketplaceTitle || item.title, 8) },
      { type: "product", key: "description", label: "Description", ok: hasText(item.longDescription || item.shortDescription, 40) },
      { type: "product", key: "image", label: "Image", ok: productImageUrls(item).length > 0 },
      { type: "category", key: "category", label: "Main category", ok: hasText(item.category) && item.categoryVerified !== false },
      { type: "product", key: "brand", label: "Brand", ok: hasText(item.brand) },
      { type: "pricing", key: "price", label: "Price", ok: numberValue(item.price || item.websitePrice, 0) > 0 },
      { type: "product", key: "vendor", label: "Vendor", ok: hasText(item.vendor || item.supplier) },
      { type: "inventory", key: "stock", label: "Stock", ok: available > 0 },
      { type: "product", key: "barcode", label: "UPC / barcode", ok: hasText(item.barcode) },
      { type: "product", key: "dimensions", label: "Weight / dimensions", ok: numberValue(item.weightOz || item.itemWeight || item.packageWeight, 0) > 0 }
    ];
  }

  function productQualitySummary(item = {}) {
    const checks = productQualityChecks(item);
    const passed = checks.filter((check) => check.ok).length;
    const missing = checks.filter((check) => !check.ok).map((check) => check.label);
    const score = Math.round((passed / checks.length) * 100);
    return { score, passed, total: checks.length, missing, ready: score >= 80 && missing.length <= 2, checks };
  }

  function shopifyQualitySummary(db, item = {}, context = null) {
    const mapping = context?.categoryChannelMapping
      ? context.categoryChannelMapping(item, "shopify") || {}
      : categoryMappingForProduct(db, item, "shopify") || {};
    const uom = productUomInfo(item);
    const variants = shopifyPurchaseVariants(item, db);
    const linked = hasText(item.shopifyId);
    const staleDays = daysSince(item.shopifySyncedAt);
    const checks = [
      { type: "shopify", key: "shopify-gid", label: "Shopify GID", ok: linked },
      { type: "shopify", key: "shopify-status", label: "Shopify status", ok: hasText(item.shopifyStatus) },
      { type: "shopify", key: "shopify-published", label: "Shopify published", ok: item.shopifyPublished === true },
      { type: "shopify", key: "shopify-product-type", label: "Shopify product type", ok: hasText(mapping.productType || mapping.categoryPath || item.category) },
      { type: "shopify", key: "shopify-taxonomy", label: "Shopify taxonomy", ok: hasText(mapping.categoryId || mapping.googleCategory?.id) },
      { type: "variant", key: "variant-sku", label: "Variant SKU", ok: variants.every((variant) => hasText(variant.sku)) },
      { type: "variant", key: "variant-price", label: "Variant price", ok: variants.every((variant) => numberValue(variant.price, 0) > 0) },
      { type: "variant", key: "variant-pack-each", label: "Pack / Each variants", ok: !uom.isMultiUnit || variants.length >= 2 },
      { type: "variant", key: "variant-upc-each", label: "UPC assigned to Each", ok: !uom.isMultiUnit || variants.some((variant) => variant.key === "each" && hasText(item.barcode)) },
      { type: "inventory", key: "variant-inventory", label: "Variant inventory", ok: variants.every((variant) => numberValue(variant.quantity, 0) === numberValue(variants[0]?.quantity, 0)) },
      { type: "variant", key: "variant-uom", label: "UOM quantity", ok: numberValue(uom.qty, 0) >= 1 },
      { type: "freshness", key: "shopify-status-stale", label: "Shopify status freshness", ok: staleDays === null || staleDays <= 7 }
    ];
    const passed = checks.filter((check) => check.ok).length;
    const missing = checks.filter((check) => !check.ok).map((check) => check.label);
    const live = linked && String(item.shopifyStatus || "").toLowerCase() === "active" && item.shopifyPublished === true;
    const ready = !missing.filter((label) => !["Shopify GID", "Shopify status", "Shopify published", "Shopify status freshness"].includes(label)).length;
    return { score: Math.round((passed / checks.length) * 100), missing, ready, live, linked, staleDays, syncSource: item.shopifySyncSource || "", checks };
  }

  function ebayQualitySummary(db, item = {}, context = null) {
    const listing = item.ebayListing && typeof item.ebayListing === "object" ? item.ebayListing : {};
    const settings = context?.ebaySettings || ebayChannelSettings(db);
    const mappedCategoryId = context?.categoryChannelMapping ? context.categoryChannelMapping(item, "ebay")?.categoryId : "";
    const categoryId = listing.categoryId || mappedCategoryId || settings.ebayDefaultCategoryId || ebayListingCategoryId(db, item, listing);
    const price = numberValue(marketplaceSuggestedPrice(item, settings) || listing.price, 0);
    const quantity = numberValue(marketplaceListingQuantity(item, settings) || listing.quantity, 0);
    const live = hasText(listing.listingId || item.ebayId);
    const checks = [
      { type: "ebay", key: "ebay-category", label: "eBay category", ok: hasText(categoryId) },
      { type: "ebay", key: "ebay-price", label: "eBay price", ok: price > 0 },
      { type: "ebay", key: "ebay-quantity", label: "eBay quantity", ok: quantity > 0 },
      { type: "ebay", key: "ebay-image", label: "eBay image", ok: productImageUrls(item).length > 0 },
      { type: "ebay", key: "ebay-description", label: "eBay description", ok: hasText(item.longDescription || item.shortDescription, 40) },
      { type: "ebay", key: "ebay-payment-policy", label: "eBay payment policy", ok: hasText(listing.paymentPolicyId || settings.ebayPaymentPolicyId || process.env.EBAY_PAYMENT_POLICY_ID) },
      { type: "ebay", key: "ebay-return-policy", label: "eBay return policy", ok: hasText(listing.returnPolicyId || settings.ebayReturnPolicyId || process.env.EBAY_RETURN_POLICY_ID) },
      { type: "ebay", key: "ebay-fulfillment-policy", label: "eBay fulfillment policy", ok: hasText(listing.fulfillmentPolicyId || settings.ebayFulfillmentPolicyId || process.env.EBAY_FULFILLMENT_POLICY_ID) }
    ];
    const missing = checks.filter((check) => !check.ok).map((check) => check.label);
    return { score: scoreFor(checks), missing, ready: !missing.length, live, checks };
  }

  function pricingQualitySummary(item = {}) {
    const cost = sourceCatalogCost(item);
    const price = numberValue(item.websitePrice || item.shopifyPrice || item.price, 0);
    const margin = price > 0 ? ((price - cost) / price) * 100 : 0;
    const checks = [
      { type: "pricing", key: "cost", label: "Cost", ok: cost > 0 },
      { type: "pricing", key: "price", label: "Sell price", ok: price > 0 },
      { type: "pricing", key: "margin", label: "Margin", ok: price > 0 && margin >= 10 }
    ];
    return { margin: Math.round(margin * 10) / 10, missing: checks.filter((check) => !check.ok).map((check) => check.label), checks };
  }

  function categoryQualitySummary(db, item = {}, context = null) {
    const shopify = context?.categoryChannelMapping ? context.categoryChannelMapping(item, "shopify") || {} : categoryMappingForProduct(db, item, "shopify") || {};
    const category = context?.categorySetting ? context.categorySetting(item) || {} : categorySettingForProduct(db, item) || {};
    const ebay = category.mappings?.ebay || {};
    const checks = [
      { type: "category", key: "master-category", label: "Master category", ok: hasText(item.category) },
      { type: "category", key: "shopify-taxonomy", label: "Shopify taxonomy", ok: hasText(shopify.categoryId || shopify.googleCategory?.id) },
      { type: "category", key: "shopify-product-type", label: "Shopify product type", ok: hasText(shopify.productType || shopify.categoryPath) },
      { type: "category", key: "ebay-category", label: "eBay category", ok: hasText(ebay.categoryId) }
    ];
    return { missing: checks.filter((check) => !check.ok).map((check) => check.label), checks };
  }

  function dataQualityRow(db, rawItem = {}, shopifyStatusMap = {}, context = null) {
    const item = withShopifyStatus(rawItem, shopifyStatusMap);
    const product = productQualitySummary(item);
    const shopify = shopifyQualitySummary(db, item, context);
    const ebay = ebayQualitySummary(db, item, context);
    const pricing = pricingQualitySummary(item);
    const category = categoryQualitySummary(db, item, context);
    const allChecks = [...product.checks, ...shopify.checks, ...ebay.checks, ...pricing.checks, ...category.checks];
    const failed = allChecks.filter((check) => !check.ok);
    return {
      id: item.id || item.sku,
      sku: item.sku || "",
      title: item.marketplaceTitle || item.title || "",
      brand: item.brand || "",
      vendor: item.vendor || item.supplier || "",
      category: item.category || "",
      productScore: product.score,
      shopifyScore: shopify.score,
      ebayScore: ebay.score,
      margin: pricing.margin,
      ready: product.ready,
      shopifyReady: shopify.ready,
      shopifyLive: shopify.live,
      ebayReady: ebay.ready,
      ebayLive: ebay.live,
      syncSource: shopify.syncSource,
      staleDays: shopify.staleDays,
      issues: [...new Set(failed.map((check) => check.label))],
      issueKeys: [...new Set(failed.map((check) => check.key || dataQualityIssueKey(check.label)))],
      issueTypes: [...new Set(failed.map((check) => check.type || "product"))],
      toBeDiscontinued: productIsCloseout(item),
      available: numberValue(item.qty ?? item.stockQty, 0) - numberValue(item.reserved, 0)
    };
  }

  function dataQualitySnapshot(db, items = [], options = {}) {
    const shopifyStatusMap = options.shopifyStatusMap || {};
    const context = options.context || null;
    const rows = (items || []).map((item) => dataQualityRow(db, item, shopifyStatusMap, context));
    return { summary: summarizeQualityRows(rows, options.storage || ""), rows };
  }

  return {
    dataQualityIssueKey,
    dataQualityRow,
    dataQualitySnapshot,
    ebayQualitySummary,
    hasText,
    pricingQualitySummary,
    productQualityChecks,
    productQualitySummary,
    shopifyQualitySummary,
    summarizeQualityRows
  };
}

module.exports = {
  createDataQualityEngine,
  dataQualityIssueKey,
  daysSince,
  hasText,
  summarizeQualityRows
};
