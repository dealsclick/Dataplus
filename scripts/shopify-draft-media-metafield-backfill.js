const fs = require("fs");
const path = require("path");
const https = require("https");
const { Client } = require("pg");

loadEnv(path.join(process.cwd(), ".env"));

const SHOPIFY_DUMP_FIELD_METAFIELDS = {
  shortDescription: { key: "custom.short_description", type: "multi_line_text_field" },
  itemHeight: { key: "custom.item_height", type: "dimension" },
  itemLength: { key: "custom.item_length", type: "dimension" },
  itemWeight: { key: "custom.item_weight", type: "weight" },
  itemWidth: { key: "custom.item_width", type: "dimension" },
  packageHeight: { key: "custom.package_height", type: "dimension" },
  packageLength: { key: "custom.package_length", type: "dimension" },
  packageWeight: { key: "custom.package_weight", type: "weight" },
  packageWidth: { key: "custom.package_width", type: "dimension" },
  uom: { key: "custom.uom", type: "single_line_text_field" },
  uomQty: { key: "custom.uom_qty", type: "number_integer" },
  countryOfOrigin: { key: "custom.country_of_origin", type: "single_line_text_field" },
  createdBy: { key: "custom.created_by", type: "single_line_text_field" },
  altSku: { key: "custom.alt_sku", type: "single_line_text_field" },
  minimumAllowedPrice: { key: "custom.minimum_allowed_price", type: "money" },
  fobPriceForZoro: { key: "custom.fob_price_for_zoro", type: "money" },
  preferredVendor: { key: "custom.preferred_vendor", type: "single_line_text_field" },
  uploadedImage: { key: "custom.uploaded_image", type: "url" },
  restrictedStates: { key: "custom.restricted_states", type: "single_line_text_field" },
  shipMode: { key: "custom.ship_mode", type: "single_line_text_field" },
  dropShip: { key: "custom.drop_ship", type: "boolean" },
  showProp65: { key: "custom.show_prop_65", type: "boolean" },
  prop65Message: { key: "custom.prop_65_message", type: "multi_line_text_field" },
  warranty: { key: "custom.warranty", type: "multi_line_text_field" },
  dropShipMinQty: { key: "custom.drop_ship_min_qty", type: "single_line_text_field" },
  additionalAttributes: { key: "custom.additional_attributes", type: "multi_line_text_field" },
  certifications: { key: "custom.certifications", type: "list.single_line_text_field" },
  returnable: { key: "custom.returnable", type: "single_line_text_field" },
  competitorPartNumber: { key: "custom.competitor_part_number", type: "list.single_line_text_field" },
  oversize: { key: "custom.oversize", type: "boolean" },
  mappedCategory: { key: "custom.mapped_category", type: "json" },
  checkedSds: { key: "custom.checked_sds", type: "json" },
  sourceCategoryId: { key: "custom.source_category_id", type: "single_line_text_field" },
  vendorWebsitePrice: { key: "custom.vendor_website_price", type: "money" },
  isBanned: { key: "custom.is_banned", type: "boolean" },
  isMarketplaceRestricted: { key: "custom.is_marketplace_restricted", type: "boolean" },
  bulkPrices: { key: "custom.bulk_prices", type: "json" },
  trustedBrand: { key: "custom.trusted_brand", type: "single_line_text_field" },
  keywords: { key: "custom.keywords", type: "multi_line_text_field" },
  subBrand: { key: "custom.sub_brand", type: "single_line_text_field" },
  replacementSku: { key: "custom.replacement_sku", type: "single_line_text_field" },
  icons: { key: "custom.icons", type: "list.single_line_text_field" },
  altVendorSku: { key: "custom.alt_vendor_sku", type: "single_line_text_field" },
  brand: { key: "custom.brand", type: "single_line_text_field" },
  ctechId: { key: "custom.ctech_id", type: "single_line_text_field" },
  defaultSupplier: { key: "custom.default_supplier", type: "single_line_text_field" },
  dwId: { key: "custom.dw_id", type: "single_line_text_field" },
  fobPrice: { key: "custom.fob_price", type: "number_decimal" },
  googleTaxonomyId: { key: "custom.google_taxonomy_id", type: "single_line_text_field" },
  hazardous: { key: "custom.hazardous", type: "boolean" },
  lastLocalSyncAt: { key: "custom.last_local_sync_at", type: "date_time" },
  lastPricesUpdateAt: { key: "custom.last_prices_update_at", type: "single_line_text_field" },
  lastPricesUpdateBy: { key: "custom.last_prices_update_by", type: "single_line_text_field" },
  leadTime: { key: "custom.lead_time", type: "single_line_text_field" },
  leadtime: { key: "custom.leadtime", type: "number_decimal" },
  listPrice: { key: "custom.list_price", type: "number_decimal" },
  manufacturer: { key: "custom.manufacturer", type: "single_line_text_field" },
  mfrPartNumber: { key: "custom.mfr_part_number", type: "single_line_text_field" },
  minQuantity: { key: "custom.min_quantity", type: "number_integer" },
  originalJson: { key: "custom.original_json", type: "json" },
  originalSdsUrl: { key: "custom.original_sds_url", type: "url" },
  purchaseUnit: { key: "custom.purchase_unit", type: "single_line_text_field" },
  quantityIncrements: { key: "custom.quantity_increments", type: "number_integer" },
  relatedSku: { key: "custom.related_sku", type: "variant_reference" },
  replacedBy: { key: "custom.replaced_by", type: "product_reference" },
  sdsUrl: { key: "custom.sds_url", type: "url" },
  sellUnitCost: { key: "custom.sell_unit_cost", type: "number_decimal" },
  shippingMethod: { key: "custom.shipping_method", type: "list.single_line_text_field" },
  shippingClass: { key: "custom.shipping_class", type: "single_line_text_field" },
  shippingClassReason: { key: "custom.shipping_class_reason", type: "multi_line_text_field" },
  dimensionalWeight: { key: "custom.dimensional_weight", type: "number_decimal" },
  sourceActive: { key: "custom.source_active", type: "boolean" },
  sourceCategory: { key: "custom.source_category", type: "single_line_text_field" },
  sourceCreatedAt: { key: "custom.source_created_at", type: "date_time" },
  sourceDataHash: { key: "custom.source_data_hash", type: "single_line_text_field" },
  sourceMongoId: { key: "custom.source_mongo_id", type: "single_line_text_field" },
  sourceSystem: { key: "custom.source_system", type: "single_line_text_field" },
  sourceUpdatedAt: { key: "custom.source_updated_at", type: "date_time" },
  stockQty: { key: "custom.stock_qty", type: "number_decimal" },
  stockStatus: { key: "custom.stock_status", type: "boolean" },
  stockUpdatedAt: { key: "custom.stock_updated_at", type: "date_time" },
  supplier: { key: "custom.supplier", type: "single_line_text_field" },
  supplierCode: { key: "custom.supplier_code", type: "single_line_text_field" },
  suppliersJson: { key: "custom.suppliers_json", type: "json" },
  unspsc: { key: "custom.unspsc", type: "single_line_text_field" },
  updatedAt: { key: "custom.updated_at", type: "date_time" },
  uploadedBy: { key: "custom.uploaded_by", type: "single_line_text_field" },
  validatedAt: { key: "custom.validated_at", type: "date_time" },
  vendorSku: { key: "custom.vendor_sku", type: "single_line_text_field" }
};

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function requestJson(options, body = "") {
  return new Promise((resolve, reject) => {
    const req = https.request({
      ...options,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": options.contentType || "application/json", "Content-Length": Buffer.byteLength(body) } : {}),
        ...(options.headers || {})
      }
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          return reject(new Error(`Non-JSON response (${res.statusCode}) from ${options.path}: ${text.slice(0, 500)}`));
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode} from ${options.path}: ${text.slice(0, 500)}`));
        }
        resolve(data);
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function shopifyToken() {
  if (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN) return process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const shop = process.env.SHOPIFY_STORE_DOMAIN;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!shop || !clientId || !clientSecret) throw new Error("Shopify credentials are not configured.");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret
  }).toString();
  const data = await requestJson({
    hostname: shop,
    path: "/admin/oauth/access_token",
    method: "POST",
    contentType: "application/x-www-form-urlencoded"
  }, body);
  if (!data.access_token) throw new Error("Shopify token response did not include access_token.");
  return data.access_token;
}

async function graphql(query, variables = {}, token) {
  const shop = process.env.SHOPIFY_STORE_DOMAIN;
  const version = process.env.SHOPIFY_ADMIN_API_VERSION || "2026-04";
  const data = await requestJson({
    hostname: shop,
    path: `/admin/api/${encodeURIComponent(version)}/graphql.json`,
    method: "POST",
    headers: { "X-Shopify-Access-Token": token }
  }, JSON.stringify({ query, variables }));
  if (Array.isArray(data.errors) && data.errors.length) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(data.errors).slice(0, 1000)}`);
  }
  return data.data || {};
}

function listValue(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === "") return [];
  return String(value).split(/[|,\n]/).map((part) => part.trim()).filter(Boolean);
}

function numberValue(value) {
  if (value === null || value === undefined || value === "") return 0;
  const number = Number(String(value).replace(/[$,]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function boolValue(value) {
  if (typeof value === "boolean") return value;
  return ["true", "1", "yes", "y"].includes(String(value || "").trim().toLowerCase());
}

function textValue(value) {
  return String(value ?? "").trim();
}

function camelFromSnake(value = "") {
  return String(value).replace(/_([a-z])/g, (_, char) => char.toUpperCase());
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function metafieldValue(row, field, config) {
  const raw = row.commercial_raw && typeof row.commercial_raw === "object" ? row.commercial_raw : {};
  const key = config.key.replace(/^custom\./, "");
  const value = firstPresent(row[field], row[key], row[camelFromSnake(key)], raw[key], raw[camelFromSnake(key)]);
  if (value === undefined || value === null || value === "") return "";
  if (config.type === "money") {
    const amount = numberValue(value);
    return amount > 0 ? JSON.stringify({ amount: amount.toFixed(2), currency_code: "USD" }) : "";
  }
  if (config.type === "dimension") {
    const amount = numberValue(value);
    return amount > 0 ? JSON.stringify({ value: amount, unit: "INCHES" }) : "";
  }
  if (config.type === "weight") {
    const amount = numberValue(value);
    return amount > 0 ? JSON.stringify({ value: amount, unit: "POUNDS" }) : "";
  }
  if (config.type === "number_integer") {
    const amount = Math.round(numberValue(value));
    return amount > 0 ? String(amount) : "";
  }
  if (config.type === "number_decimal") {
    const amount = numberValue(value);
    return Number.isFinite(amount) ? String(amount) : "";
  }
  if (config.type === "date_time") {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : "";
  }
  if (config.type === "boolean") return boolValue(value) ? "true" : "false";
  if (config.type === "json") return typeof value === "string" ? value : JSON.stringify(value);
  if (config.type === "product_reference") return /^gid:\/\/shopify\/Product\/\d+$/i.test(textValue(value)) ? textValue(value) : "";
  if (config.type === "variant_reference") return /^gid:\/\/shopify\/ProductVariant\/\d+$/i.test(textValue(value)) ? textValue(value) : "";
  if (config.type.startsWith("list.")) {
    const values = Array.isArray(value) ? value : listValue(value);
    return values.length ? JSON.stringify(values) : "";
  }
  if (config.type === "single_line_text_field" && (Array.isArray(value) || typeof value === "object")) {
    const values = Array.isArray(value) ? value : Object.values(value || {});
    return values.map((item) => String(item || "").trim()).filter(Boolean).join(", ");
  }
  return textValue(value);
}

function productImages(row = {}) {
  const rawImages = listValue(row.raw_images);
  const sourceRawImages = listValue(row.source_raw_images);
  const commercialRawImages = listValue(row.commercial_raw?.images);
  return [...new Set([
    row.default_image,
    row.source_default_image,
    row.uploadedImage,
    row.uploaded_image,
    row.commercial_raw?.uploaded_image,
    ...rawImages,
    ...sourceRawImages,
    ...commercialRawImages
  ].map((url) => String(url || "").trim()).filter((url) => /^https?:\/\//i.test(url)))].slice(0, 10);
}

async function draftProducts(client, limit) {
  const result = await client.query(`
    with draft as (
      select distinct on (sps.shopify_id)
        sps.shopify_id,
        sps.sku,
        coalesce(sps.status_payload ->> 'shopifyVariantSku', sps.sku) as variant_sku,
        sps.status_payload ->> 'shopifyTitle' as shopify_title,
        regexp_replace(coalesce(sps.status_payload ->> 'shopifyVariantSku', sps.sku), '-[0-9]+PC$', '', 'i') as base_sku
      from shopify_product_statuses sps
      where lower(coalesce(sps.shopify_status, '')) = 'draft'
        and coalesce(sps.shopify_id, '') <> ''
      order by sps.shopify_id, sps.sku
    )
    select
      d.*,
      p.default_image,
      p.raw -> 'images' as raw_images,
      v.default_image as source_default_image,
      v.raw -> 'images' as source_raw_images,
      c.raw as commercial_raw,
      c.alt_sku as "altSku",
      c.minimum_allowed_price as "minimumAllowedPrice",
      c.fob_price_for_zoro as "fobPriceForZoro",
      c.preferred_vendor as "preferredVendor",
      c.uploaded_image as "uploadedImage",
      c.restricted_states as "restrictedStates",
      c.ship_mode as "shipMode",
      c.drop_ship as "dropShip",
      c.show_prop_65 as "showProp65",
      c.prop_65_message as "prop65Message",
      c.warranty,
      c.drop_ship_min_qty as "dropShipMinQty",
      c.additional_attributes as "additionalAttributes",
      c.certifications,
      c.returnable,
      c.competitor_part_number as "competitorPartNumber",
      c.oversize,
      c.mapped_category as "mappedCategory",
      c.checked_sds as "checkedSds",
      c.category_id as "sourceCategoryId",
      c.vendor_website_price as "vendorWebsitePrice",
      c.is_banned as "isBanned",
      c.is_marketplace_restricted as "isMarketplaceRestricted",
      c.bulk_prices as "bulkPrices",
      c.trusted_brand as "trustedBrand",
      c.keywords,
      c.sub_brand as "subBrand",
      c.replacement_sku as "replacementSku",
      c.icons
    from draft d
    left join products p on lower(p.sku) = lower(d.base_sku)
    left join vendor_catalog_items v on lower(v.source_sku) = lower(d.base_sku)
    left join product_dump_commercial_fields c on lower(c.source_sku) = lower(d.base_sku)
    order by d.base_sku
    limit $1
  `, [limit]);
  return result.rows;
}

async function fetchShopifyProducts(ids, token) {
  const query = `
    query DataPlusDraftProductAudit($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          title
          status
          media(first: 1) { nodes { id } }
          metafields(first: 100, namespace: "custom") {
            nodes { id namespace key type value }
          }
        }
      }
    }
  `;
  const data = await graphql(query, { ids }, token);
  return data.nodes || [];
}

async function addImages(productId, title, images, token) {
  const mutation = `
    mutation DataPlusProductCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media { id status mediaContentType }
        mediaUserErrors { field message }
      }
    }
  `;
  const media = images.map((url, index) => ({
    mediaContentType: "IMAGE",
    originalSource: url,
    alt: index === 0 ? title : `${title} ${index + 1}`
  }));
  const data = await graphql(mutation, { productId, media }, token);
  const result = data.productCreateMedia || {};
  const errors = result.mediaUserErrors || [];
  if (errors.length) throw new Error(errors.map((error) => error.message).join("; "));
  return result.media || [];
}

async function setMetafields(metafields, token) {
  if (!metafields.length) return [];
  const mutation = `
    mutation DataPlusMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id namespace key type value }
        userErrors { field message code }
      }
    }
  `;
  const data = await graphql(mutation, { metafields }, token);
  const result = data.metafieldsSet || {};
  const errors = result.userErrors || [];
  if (errors.length) throw new Error(errors.map((error) => `${error.key || ""} ${error.message}`.trim()).join("; "));
  return result.metafields || [];
}

function expectedMetafields(row, existingByKey) {
  const inputs = [];
  for (const [field, config] of Object.entries(SHOPIFY_DUMP_FIELD_METAFIELDS)) {
    const [namespace, key] = config.key.split(".");
    const existing = existingByKey.get(key);
    if (existing?.value) continue;
    const value = metafieldValue(row, field, config);
    if (!value) continue;
    inputs.push({
      ownerId: row.shopify_id,
      namespace,
      key,
      type: config.type,
      value
    });
  }
  if (!existingByKey.get("created_by")?.value) {
    inputs.push({
      ownerId: row.shopify_id,
      namespace: "custom",
      key: "created_by",
      type: "single_line_text_field",
      value: "DataPlus API"
    });
  }
  return inputs;
}

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

async function main() {
  const apply = hasFlag("apply");
  const limit = Math.max(1, Math.min(50000, Number(argValue("limit", "12549")) || 12549));
  const batchSize = Math.max(1, Math.min(50, Number(argValue("batch-size", "25")) || 25));
  const client = new Client({ connectionString: process.env.DATABASE_URL || "postgres://postgres:Brooklyn2025@localhost:5432/dataplus" });
  const token = await shopifyToken();
  await client.connect();
  const rows = await draftProducts(client, limit);
  const byId = new Map(rows.map((row) => [row.shopify_id, row]));
  const productIds = [...byId.keys()];
  const report = [];
  let imagesAdded = 0;
  let metafieldsAdded = 0;
  let missingImageNoDataPlusImage = 0;
  let missingImageWithDataPlusImage = 0;
  let productsWithMissingMetafields = 0;
  const errors = [];

  for (let i = 0; i < productIds.length; i += batchSize) {
    const ids = productIds.slice(i, i + batchSize);
    const products = await fetchShopifyProducts(ids, token);
    for (const product of products) {
      if (!product?.id) continue;
      const row = byId.get(product.id);
      if (!row) continue;
      const images = productImages(row);
      const hasMedia = Array.isArray(product.media?.nodes) && product.media.nodes.length > 0;
      const existingByKey = new Map((product.metafields?.nodes || []).map((metafield) => [metafield.key, metafield]));
      const missingMetafields = expectedMetafields(row, existingByKey);
      if (missingMetafields.length) productsWithMissingMetafields += 1;
      if (!hasMedia && images.length) missingImageWithDataPlusImage += 1;
      if (!hasMedia && !images.length) missingImageNoDataPlusImage += 1;
      const rowReport = {
        shopifyId: product.id,
        sku: row.variant_sku || row.sku,
        baseSku: row.base_sku,
        title: product.title || row.shopify_title || "",
        hasShopifyMedia: hasMedia,
        dataPlusImageCount: images.length,
        imagesAdded: 0,
        missingMetafields: missingMetafields.map((item) => `${item.namespace}.${item.key}`).join("|"),
        metafieldsAdded: 0,
        error: ""
      };
      if (apply) {
        try {
          if (!hasMedia && images.length) {
            const added = await addImages(product.id, product.title || row.shopify_title || row.base_sku, images, token);
            rowReport.imagesAdded = added.length || images.length;
            imagesAdded += rowReport.imagesAdded;
          }
          if (missingMetafields.length) {
            const chunks = [];
            for (let m = 0; m < missingMetafields.length; m += 25) chunks.push(missingMetafields.slice(m, m + 25));
            for (const chunk of chunks) {
              const added = await setMetafields(chunk, token);
              rowReport.metafieldsAdded += added.length || chunk.length;
            }
            metafieldsAdded += rowReport.metafieldsAdded;
          }
        } catch (error) {
          rowReport.error = error.message || String(error);
          errors.push({ sku: rowReport.sku, shopifyId: product.id, error: rowReport.error });
        }
      }
      if (!hasMedia || missingMetafields.length || rowReport.error) report.push(rowReport);
    }
    process.stderr.write(`Checked ${Math.min(i + batchSize, productIds.length)}/${productIds.length}\r`);
  }

  await client.end();
  const outDir = path.join(process.cwd(), "outputs");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const csvPath = path.join(outDir, `shopify-draft-media-metafield-${apply ? "apply" : "audit"}-${stamp}.csv`);
  const headers = ["sku", "baseSku", "shopifyId", "title", "hasShopifyMedia", "dataPlusImageCount", "imagesAdded", "missingMetafields", "metafieldsAdded", "error"];
  fs.writeFileSync(csvPath, [headers.join(",")].concat(report.map((row) => headers.map((key) => csvEscape(row[key])).join(","))).join("\n"));
  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    draftProductsChecked: productIds.length,
    missingImageWithDataPlusImage,
    missingImageNoDataPlusImage,
    productsWithMissingMetafields,
    imagesAdded,
    metafieldsAdded,
    errors: errors.length,
    csvPath,
    errorSample: errors.slice(0, 20)
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
