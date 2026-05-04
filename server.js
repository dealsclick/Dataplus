const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");
const postgres = require("./db");

const PORT = process.env.PORT || 4173;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const CATALOG_FILE = path.join(DATA_DIR, "catalog", "products.ndjson");
const CATALOG_MANIFEST_FILE = `${CATALOG_FILE}.manifest.json`;
const CATALOG_VENDOR_INDEX_FILE = path.join(DATA_DIR, "catalog", "vendors.json");
const CATALOG_CATEGORY_INDEX_FILE = path.join(DATA_DIR, "catalog", "categories.json");
const CATALOG_INDEX_DIR = path.join(DATA_DIR, "catalog", "index");
const CATALOG_INDEX_MANIFEST_FILE = path.join(CATALOG_INDEX_DIR, "manifest.json");
const CATALOG_INDEX_SUPPLIERS_FILE = path.join(CATALOG_INDEX_DIR, "suppliers.json");
const CATALOG_INDEX_SUPPLIER_DIR = path.join(CATALOG_INDEX_DIR, "suppliers");
const CATALOG_INDEX_SKU_DIR = path.join(CATALOG_INDEX_DIR, "sku-shards");
const SHOPIFY_TAXONOMY_INDEX_FILE = path.join(DATA_DIR, "channel-taxonomies", "shopify", "taxonomy-index.json");
const IMPORT_JOB_FILE_DIR = path.join(DATA_DIR, "import-jobs");
const CONNECTOR_STATE_FILE = path.join(DATA_DIR, "connectors.json");
const ENV_FILE = path.join(ROOT, ".env");

const SOURCES = ["Temu", "eBay", "Whatnot", "TikTok Shop"];
const ORDER_PREFIX = "DP";

const PRODUCT_MAPPING_FIELDS = [
  { key: "sku", label: "SKU", type: "text", requiredForImport: true },
  { key: "title", label: "Title", type: "text" },
  { key: "marketplaceTitle", label: "Marketplace title", type: "text" },
  { key: "shortDescription", label: "Short description", type: "text" },
  { key: "longDescription", label: "Long description", type: "text" },
  { key: "bulletPoints", label: "Bullet points", type: "list" },
  { key: "brand", label: "Brand", type: "text" },
  { key: "sourceBrand", label: "Source brand", type: "text" },
  { key: "brandLocked", label: "Brand locked", type: "boolean" },
  { key: "category", label: "Main category", type: "text" },
  { key: "sourceCategory", label: "Vendor category", type: "text" },
  { key: "categoryVerified", label: "Category verified", type: "boolean" },
  { key: "vendor", label: "Vendor", type: "text" },
  { key: "supplier", label: "Supplier", type: "text" },
  { key: "supplierCode", label: "Supplier code", type: "text" },
  { key: "manufacturer", label: "Manufacturer", type: "text" },
  { key: "mfrPartNumber", label: "Manufacturer part number", type: "text" },
  { key: "vendorSku", label: "Vendor SKU", type: "text" },
  { key: "barcode", label: "Barcode", type: "text" },
  { key: "condition", label: "Condition", type: "text" },
  { key: "status", label: "Status", type: "text" },
  { key: "active", label: "Active", type: "boolean" },
  { key: "price", label: "Price", type: "number" },
  { key: "cost", label: "Cost", type: "number" },
  { key: "msrp", label: "MSRP", type: "number" },
  { key: "qty", label: "Quantity", type: "number" },
  { key: "reserved", label: "Reserved", type: "number" },
  { key: "available", label: "Available", type: "computed" },
  { key: "reorderPoint", label: "Reorder point", type: "number" },
  { key: "stockQty", label: "Source stock quantity", type: "number" },
  { key: "stockStatus", label: "Stock status", type: "text" },
  { key: "weightOz", label: "Weight oz", type: "number" },
  { key: "lengthIn", label: "Length in", type: "number" },
  { key: "widthIn", label: "Width in", type: "number" },
  { key: "heightIn", label: "Height in", type: "number" },
  { key: "countryOfOrigin", label: "Country of origin", type: "text" },
  { key: "hazardous", label: "Hazardous", type: "boolean" },
  { key: "images", label: "Images", type: "list" },
  { key: "defaultImage", label: "Default image", type: "text" },
  { key: "shopifyId", label: "Shopify ID", type: "text" },
  { key: "shopifyVariantId", label: "Shopify variant ID", type: "text" },
  { key: "shopifyStatus", label: "Shopify status", type: "text" },
  { key: "shopifyPublished", label: "Shopify published", type: "boolean" },
  { key: "shopifyPublishedAt", label: "Shopify published at", type: "text" },
  { key: "shopifyUpdatedAt", label: "Shopify updated at", type: "text" },
  { key: "shopifySyncedAt", label: "Shopify synced at", type: "text" },
  { key: "tags", label: "Tags", type: "list" },
  { key: "seoKeywords", label: "SEO keywords", type: "text" },
  { key: "unspsc", label: "UNSPSC", type: "text" },
  { key: "uom", label: "UOM", type: "text" },
  { key: "uomQty", label: "UOM quantity", type: "text" },
  { key: "shopifyHandle", label: "Shopify handle", type: "computed" },
  { key: "shopifyCategoryId", label: "Shopify category ID", type: "category" },
  { key: "shopifyCategoryPath", label: "Shopify category breadcrumb", type: "category" },
  { key: "googleCategoryId", label: "Google category ID", type: "category" },
  { key: "googleCategoryBreadcrumb", label: "Google category breadcrumb", type: "category" },
  { key: "sdsUrl", label: "SDS URL", type: "text" },
  { key: "originalSdsUrl", label: "Original SDS URL", type: "text" }
];

const DUMP_REVIEW_FIELDS = new Set([
  "barcode",
  "vendorSku",
  "mfrPartNumber",
  "uom",
  "uomQty",
  "minQuantity",
  "quantityIncrements",
  "cost",
  "price",
  "fobPrice",
  "msrp",
  "stockQty",
  "qty",
  "stockStatus",
  "countryOfOrigin",
  "supplier",
  "supplierCode"
]);

const DUMP_PROTECTED_CONTENT_FIELDS = new Set([
  "title",
  "marketplaceTitle",
  "shortDescription",
  "longDescription",
  "bulletPoints",
  "category",
  "defaultImage",
  "images",
  "tags",
  "manufacturer",
  "seoKeywords"
]);

const DUMP_SOURCE_TRACE_FIELDS = new Set([
  "sourceBrand",
  "productManagerFields",
  "productDumpCreatedAt",
  "productDumpUpdatedAt",
  "inactiveMailedAt",
  "validatedAt",
  "checkedImage",
  "checkedImageUrl",
  "checkedImageError",
  "checkedImageSize",
  "checkedImageTimestamp",
  "wildcardSearch",
  "original",
  "originalImage",
  "vendorDescription",
  "updatedAt",
  "sources",
  "importedFrom"
]);

const DEFAULT_EXPORT_MAPPINGS = [
  {
    id: "export-shopify-basic",
    name: "Shopify Product CSV",
    source: "Shopify",
    format: "csv",
    mode: "export",
    mappings: [
      { externalColumn: "Handle", productField: "shopifyHandle" },
      { externalColumn: "Title", productField: "marketplaceTitle" },
      { externalColumn: "Body (HTML)", productField: "longDescription" },
      { externalColumn: "Vendor", productField: "vendor" },
      { externalColumn: "Product Category", productField: "shopifyCategoryPath" },
      { externalColumn: "Google Shopping / Google Product Category", productField: "googleCategoryId" },
      { externalColumn: "Tags", productField: "tags" },
      { externalColumn: "Variant SKU", productField: "sku" },
      { externalColumn: "Variant Price", productField: "price" },
      { externalColumn: "Variant Inventory Qty", productField: "available" },
      { externalColumn: "Image Src", productField: "defaultImage" },
      { externalColumn: "Status", productField: "status" }
    ],
    notes: "Starter Shopify product export. Adjust columns to match the exact Shopify CSV you use."
  },
  {
    id: "export-ebay-basic",
    name: "eBay Product CSV",
    source: "eBay",
    format: "csv",
    mode: "export",
    mappings: [
      { externalColumn: "SKU", productField: "sku" },
      { externalColumn: "Title", productField: "marketplaceTitle" },
      { externalColumn: "Description", productField: "longDescription" },
      { externalColumn: "Brand", productField: "brand" },
      { externalColumn: "Price", productField: "price" },
      { externalColumn: "Quantity", productField: "available" },
      { externalColumn: "Condition", productField: "condition" },
      { externalColumn: "Category", productField: "category" }
    ],
    notes: "Starter eBay export."
  },
  {
    id: "export-amazon-basic",
    name: "Amazon Product CSV",
    source: "Amazon",
    format: "csv",
    mode: "export",
    mappings: [
      { externalColumn: "item_sku", productField: "sku" },
      { externalColumn: "item_name", productField: "marketplaceTitle" },
      { externalColumn: "brand_name", productField: "brand" },
      { externalColumn: "manufacturer", productField: "manufacturer" },
      { externalColumn: "external_product_id", productField: "barcode" },
      { externalColumn: "standard_price", productField: "price" },
      { externalColumn: "quantity", productField: "available" },
      { externalColumn: "product_description", productField: "longDescription" }
    ],
    notes: "Starter Amazon-style product export."
  }
];

const DEFAULT_CHANNEL_SETTINGS = {
  defaultShadowStatus: "Draft",
  defaultHandlingTimeDays: 2,
  defaultSafetyQty: 0,
  defaultMaxSellableQty: 0,
  defaultShippingProfile: "Standard",
  defaultShippingService: "Marketplace Standard",
  priceUpdateEnabled: true,
  inventoryUpdateEnabled: true,
  orderDownloadEnabled: true,
  trackingUpdateEnabled: true,
  cancellationNotificationEnabled: true,
  autoCreateShadow: false,
  priceMarkupPercent: 0,
  minMarginPercent: 0,
  roundingRule: "none"
};

const DEFAULT_MARKETPLACE_TEMPLATES = [
  {
    id: "template-temu",
    marketplace: "Temu",
    requiredAttributes: ["categoryId", "brandName", "bulletPoints", "packageQty", "material", "countryOfOrigin", "complianceWarning"],
    fieldDefinitions: [
      { key: "categoryId", type: "text", options: [] },
      { key: "brandName", type: "text", options: [] },
      { key: "bulletPoints", type: "textarea", options: [] },
      { key: "packageQty", type: "number", options: [] },
      { key: "material", type: "text", options: [] },
      { key: "countryOfOrigin", type: "select", options: ["US", "CN", "MX", "CA"] },
      { key: "complianceWarning", type: "textarea", options: [] }
    ],
    optionLists: {
      countryOfOrigin: ["US", "CN", "MX", "CA"]
    },
    categoryMappings: [],
    titleMaxLength: 120,
    minImages: 1,
    requireShippingProfile: true,
    requireHandlingTime: true,
    requirePrice: true,
    notes: "Temu listings need category mapping, package details, material, origin, and compliance data before sync."
  },
  {
    id: "template-ebay",
    marketplace: "eBay",
    requiredAttributes: ["categoryId", "conditionId", "itemSpecifics", "returnPolicy", "paymentPolicy", "fulfillmentPolicy"],
    fieldDefinitions: [
      { key: "categoryId", type: "text", options: [] },
      { key: "conditionId", type: "select", options: ["1000", "1500", "3000"] },
      { key: "itemSpecifics", type: "textarea", options: [] },
      { key: "returnPolicy", type: "select", options: ["30 day returns", "No returns"] },
      { key: "paymentPolicy", type: "text", options: [] },
      { key: "fulfillmentPolicy", type: "text", options: [] }
    ],
    optionLists: {
      conditionId: ["1000", "1500", "3000"],
      returnPolicy: ["30 day returns", "No returns"]
    },
    categoryMappings: [],
    titleMaxLength: 80,
    minImages: 1,
    requireShippingProfile: true,
    requireHandlingTime: true,
    requirePrice: true,
    notes: "eBay needs category, condition, item specifics, and business policies."
  },
  {
    id: "template-whatnot",
    marketplace: "Whatnot",
    requiredAttributes: ["category", "condition", "showTitle", "auctionStartPrice", "shippingWeight"],
    fieldDefinitions: [
      { key: "category", type: "text", options: [] },
      { key: "condition", type: "select", options: ["New", "Like New", "Used"] },
      { key: "showTitle", type: "text", options: [] },
      { key: "auctionStartPrice", type: "number", options: [] },
      { key: "shippingWeight", type: "number", options: [] }
    ],
    optionLists: {
      condition: ["New", "Like New", "Used"]
    },
    categoryMappings: [],
    titleMaxLength: 100,
    minImages: 1,
    requireShippingProfile: false,
    requireHandlingTime: true,
    requirePrice: true,
    notes: "Whatnot shadows should capture auction/live selling fields and shipping weight."
  },
  {
    id: "template-tiktok",
    marketplace: "TikTok Shop",
    requiredAttributes: ["categoryId", "productCertifications", "packageWeight", "packageDimensions", "deliveryOption"],
    fieldDefinitions: [
      { key: "categoryId", type: "text", options: [] },
      { key: "productCertifications", type: "textarea", options: [] },
      { key: "packageWeight", type: "number", options: [] },
      { key: "packageDimensions", type: "text", options: [] },
      { key: "deliveryOption", type: "select", options: ["Seller shipping", "TikTok shipping"] }
    ],
    optionLists: {
      deliveryOption: ["Seller shipping", "TikTok shipping"]
    },
    categoryMappings: [],
    titleMaxLength: 255,
    minImages: 1,
    requireShippingProfile: true,
    requireHandlingTime: true,
    requirePrice: true,
    notes: "TikTok Shop needs category, package dimensions, certifications, and delivery options."
  }
];

let catalogFacetCache = null;

loadLocalEnv();

const PRODUCT_DEFAULTS = {
  "DP-HOME-001": {
    price: 24.99,
    cost: 9.2,
    msrp: 34.99,
    brand: "DataPlus Home",
    category: "Home & Kitchen",
    condition: "New",
    status: "Draft",
    barcode: "850000100001",
    shortDescription: "Stackable kitchen storage set for pantry and countertop organization.",
    longDescription: "A durable, space-saving kitchen storage set designed for dry goods, snacks, pantry staples, and countertop organization. Includes clear containers with tight-seal lids and a clean modern profile suitable for marketplace listings.",
    images: [
      "https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&w=900&q=80"
    ],
    tags: ["kitchen", "storage", "home"],
    weightOz: 32,
    lengthIn: 12,
    widthIn: 8,
    heightIn: 6,
    vendor: "Local Wholesale",
    marketplaceTitle: "Kitchen Storage Set - Stackable Pantry Containers",
    seoKeywords: "kitchen storage, pantry organizer, food containers"
  },
  "DP-BEAUTY-014": {
    price: 19.99,
    cost: 7.5,
    msrp: 29.99,
    brand: "DataPlus Beauty",
    category: "Beauty & Personal Care",
    condition: "New",
    status: "Draft",
    barcode: "850000100014",
    shortDescription: "Compact travel makeup organizer with divided storage and easy-clean lining.",
    longDescription: "A lightweight travel makeup organizer built for cosmetics, brushes, skincare minis, and daily carry essentials. The structured compartments help keep products visible and protected while traveling.",
    images: [
      "https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=900&q=80"
    ],
    tags: ["beauty", "travel", "organizer"],
    weightOz: 14,
    lengthIn: 9,
    widthIn: 6,
    heightIn: 4,
    vendor: "Beauty Supply Lot",
    marketplaceTitle: "Travel Makeup Organizer Cosmetic Bag",
    seoKeywords: "makeup organizer, cosmetic bag, travel beauty case"
  },
  "DP-TECH-032": {
    price: 27.5,
    cost: 13.5,
    msrp: 39.99,
    brand: "DataPlus Tech",
    category: "Electronics",
    condition: "New",
    status: "Draft",
    barcode: "850000100032",
    shortDescription: "USB-C charging dock for phones, earbuds, and small desk devices.",
    longDescription: "A compact USB-C charging dock for organizing desk and nightstand charging. Designed for everyday electronics, clean cable routing, and a minimal footprint.",
    images: [
      "https://images.unsplash.com/photo-1609692814858-f7cd2f0afa4f?auto=format&fit=crop&w=900&q=80"
    ],
    tags: ["usb-c", "charging", "tech"],
    weightOz: 10,
    lengthIn: 5,
    widthIn: 4,
    heightIn: 2,
    vendor: "Electronics Supplier",
    marketplaceTitle: "USB-C Charging Dock for Desk and Nightstand",
    seoKeywords: "usb c dock, charging stand, desk charger"
  }
};

const ORDER_DETAILS = {
  "EB-24018": {
    marketplaceOrderId: "13-24018-88472",
    buyerEmail: "jordan@example.com",
    phone: "(555) 014-2218",
    address: {
      name: "Jordan Miller",
      line1: "118 Market Street",
      line2: "Apt 4B",
      city: "Tampa",
      state: "FL",
      postalCode: "33602",
      country: "US"
    },
    shippingService: "USPS Ground Advantage",
    trackingNumber: "",
    productCost: 18.4,
    marketplaceFees: 5.31,
    shippingCost: 6.28,
    refundAmount: 0,
    notes: "Confirm stock before label purchase."
  },
  "TT-90221": {
    marketplaceOrderId: "577412990221",
    buyerEmail: "ariana@example.com",
    phone: "(555) 018-9021",
    address: {
      name: "Ariana Cole",
      line1: "408 Sunset Lane",
      line2: "",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
      country: "US"
    },
    shippingService: "TikTok Shop Label",
    trackingNumber: "9400111206211234567890",
    productCost: 7.5,
    marketplaceFees: 2.29,
    shippingCost: 4.15,
    refundAmount: 0,
    notes: "Label purchased from marketplace."
  },
  "WN-11904": {
    marketplaceOrderId: "whatnot-live-11904",
    buyerEmail: "chris@example.com",
    phone: "(555) 010-1904",
    address: {
      name: "Chris Nguyen",
      line1: "77 Ocean Avenue",
      line2: "",
      city: "San Diego",
      state: "CA",
      postalCode: "92101",
      country: "US"
    },
    shippingService: "Marketplace Provided",
    trackingNumber: "",
    productCost: 27,
    marketplaceFees: 7.43,
    shippingCost: 8.1,
    refundAmount: 0,
    notes: "Bundle candidate when combined order support is added."
  }
};

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    writeDbSync({
      inventory: [
        {
          id: crypto.randomUUID(),
          sku: "DP-HOME-001",
          title: "Kitchen Storage Set",
          qty: 18,
          reserved: 3,
          reorderPoint: 6,
          sources: { eBay: "EB-1001", "TikTok Shop": "TT-741" },
          updatedAt: new Date().toISOString()
        },
        {
          id: crypto.randomUUID(),
          sku: "DP-BEAUTY-014",
          title: "Travel Makeup Organizer",
          qty: 9,
          reserved: 1,
          reorderPoint: 8,
          sources: { Temu: "TM-772", Whatnot: "WN-422" },
          updatedAt: new Date().toISOString()
        },
        {
          id: crypto.randomUUID(),
          sku: "DP-TECH-032",
          title: "USB-C Charging Dock",
          qty: 4,
          reserved: 2,
          reorderPoint: 5,
          sources: { eBay: "EB-1098" },
          updatedAt: new Date().toISOString()
        }
      ],
      orders: [
        {
          id: crypto.randomUUID(),
          orderNumber: "EB-24018",
          source: "eBay",
          buyer: "Jordan Miller",
          sku: "DP-HOME-001",
          title: "Kitchen Storage Set",
          qty: 2,
          status: "new",
          total: 42.5,
          shipBy: "2026-04-23",
          createdAt: "2026-04-20T14:21:00.000Z"
        },
        {
          id: crypto.randomUUID(),
          orderNumber: "TT-90221",
          source: "TikTok Shop",
          buyer: "Ariana Cole",
          sku: "DP-BEAUTY-014",
          title: "Travel Makeup Organizer",
          qty: 1,
          status: "ready",
          total: 19.99,
          shipBy: "2026-04-22",
          createdAt: "2026-04-21T09:10:00.000Z"
        },
        {
          id: crypto.randomUUID(),
          orderNumber: "WN-11904",
          source: "Whatnot",
          buyer: "Chris Nguyen",
          sku: "DP-TECH-032",
          title: "USB-C Charging Dock",
          qty: 2,
          status: "new",
          total: 55,
          shipBy: "2026-04-24",
          createdAt: "2026-04-21T11:45:00.000Z"
        }
      ],
      syncRuns: [
        {
          id: crypto.randomUUID(),
          source: "eBay",
          type: "orders",
          status: "success",
          message: "Imported 1 new order from demo connector.",
          createdAt: new Date().toISOString()
        }
      ],
      connections: SOURCES.map((name) => ({
        id: crypto.randomUUID(),
        name,
        connected: name === "eBay",
        lastSync: name === "eBay" ? new Date().toISOString() : null
      }))
    });
  }
}

async function readDb() {
  ensureDb();
  const stored = postgres.isPostgresEnabled() ? await postgres.readState() : null;
  const db = stored || JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  const normalized = normalizeDb(db);
  if (normalized.__normalizedChanged) {
    delete normalized.__normalizedChanged;
    await writeDb(normalized);
  }
  return normalized;
}

async function writeDb(db) {
  if (postgres.isPostgresEnabled()) {
    await postgres.writeState(db);
    return;
  }
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function writeDbSync(db) {
  if (postgres.isPostgresEnabled()) return;
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function readConnectorStateSync() {
  try {
    if (!fs.existsSync(CONNECTOR_STATE_FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(CONNECTOR_STATE_FILE, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeConnectorStateSync(state) {
  ensureDb();
  const next = state && typeof state === "object" && !Array.isArray(state) ? state : {};
  fs.writeFileSync(CONNECTOR_STATE_FILE, JSON.stringify(next, null, 2));
}

function mergedConnectorState(db = {}) {
  return { ...(db.connectorState || {}), ...readConnectorStateSync() };
}

function loadLocalEnv() {
  if (!fs.existsSync(ENV_FILE)) return;
  const lines = fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function sourceScalarValue(value) {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") {
    if (value.$numberDecimal !== undefined) return value.$numberDecimal;
    if (value.$date !== undefined) return sourceScalarValue(value.$date);
    if (value._bsontype === "Decimal128" && typeof value.toString === "function") return value.toString();
    if (value._bsontype === "ObjectId" && typeof value.toString === "function") return value.toString();
  }
  return value;
}

function sourceTextValue(value) {
  const scalar = sourceScalarValue(value);
  return scalar == null ? "" : String(scalar).trim();
}

function sourceNumberValue(value, fallback = 0) {
  const number = Number(sourceScalarValue(value));
  return Number.isFinite(number) ? number : fallback;
}

function sourceListValue(value) {
  if (Array.isArray(value)) return value.map(sourceTextValue).filter(Boolean);
  const text = sourceTextValue(value);
  if (!text) return [];
  return text.split(/[|,]/).map((item) => item.trim()).filter(Boolean);
}

function sourceBooleanValue(value, fallback = false) {
  if (value === undefined) return fallback;
  if (value === true || value === false) return value;
  const text = sourceTextValue(value).toLowerCase();
  if (["true", "1", "yes", "y", "active"].includes(text)) return true;
  if (["false", "0", "no", "n", "inactive"].includes(text)) return false;
  return fallback;
}

function calculateDimensionalWeight(item = {}) {
  const length = Number(item.packageLength || 0);
  const width = Number(item.packageWidth || 0);
  const height = Number(item.packageHeight || 0);
  if (!(length > 0 && width > 0 && height > 0)) return 0;
  return Math.round(((length * width * height) / 139) * 1000) / 1000;
}

function normalizedCompareValue(value) {
  if (Array.isArray(value)) return value.map((item) => normalizedCompareValue(item)).join("|");
  if (value && typeof value === "object") return JSON.stringify(value);
  if (value === undefined || value === null) return "";
  const number = Number(value);
  if (Number.isFinite(number) && String(value).trim() !== "") return String(Number(number.toFixed(4)));
  return String(value).trim();
}

function formatBrandName(value) {
  const text = sourceTextValue(value).replace(/[\u2122\u00ae\u00a9]/g, "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const acronyms = new Set(["3M", "A/C", "AC", "ANSI", "BUNN", "CFC", "CFL", "CMM", "CNC", "CPR", "CPU", "DVI", "EPA", "GFCI", "HD", "HDMI", "HVAC", "ISO", "IT", "LED", "LLC", "LP", "MRO", "NEMA", "NSF", "OSHA", "PVC", "RFID", "UL", "UPS", "USB", "USA", "US", "UV", "VGA", "WiFi", "WIFI", "WD-40"]);
  const lowerWords = new Set(["and", "of", "the", "for", "in", "on", "to", "with"]);
  const formatPart = (part, index) => {
    if (!part) return part;
    const upper = part.toUpperCase();
    const compactUpper = upper.replace(/[^A-Z0-9]/g, "");
    if (compactUpper === "3M") return "3M";
    if (/^([A-Z]\.){2,}[A-Z]?\.?$/i.test(part)) return upper;
    if (/^[A-Z0-9]{2,4}$/.test(part)) return upper;
    if (acronyms.has(upper)) return upper === "WIFI" ? "WiFi" : upper;
    if (/^\d+[A-Z]*$/i.test(part)) return upper;
    const lower = part.toLowerCase();
    if (index > 0 && lowerWords.has(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  };
  return text
    .split(" ")
    .map((word, wordIndex) => word
      .split("/")
      .map((slashPart) => slashPart
        .split("-")
        .map((part, partIndex) => formatPart(part, wordIndex + partIndex))
        .join("-"))
      .join("/"))
    .join(" ");
}

function formatCategoryName(value) {
  const text = sourceTextValue(value).replace(/[\u2122\u00ae\u00a9]/g, "").replace(/\s*>\s*/g, " > ").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const acronyms = new Set(["3D", "A/C", "AC", "ANSI", "CFC", "CFL", "CNC", "CPR", "CPU", "DVI", "EPA", "GFCI", "HD", "HDMI", "HVAC", "ISO", "IT", "LED", "MRO", "NEMA", "NSF", "OSHA", "PPE", "PVC", "RFID", "UL", "UPS", "USB", "UV", "VGA", "VFD", "WiFi", "WIFI"]);
  const lowerWords = new Set(["and", "of", "the", "for", "in", "on", "to", "with"]);
  const formatToken = (token, index) => {
    if (!token || token === "&") return token;
    const upper = token.toUpperCase();
    if (/^([A-Z]\.){2,}[A-Z]?\.?$/i.test(token)) return upper;
    if (acronyms.has(upper)) return upper === "WIFI" ? "WiFi" : upper;
    if (/^\d+[A-Z]*$/i.test(token)) return upper;
    const lower = token.toLowerCase();
    if (index > 0 && lowerWords.has(lower)) return lower;
    if (/^[A-Z0-9]{2,4}$/.test(token)) return upper;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  };
  return text
    .split(" > ")
    .map((segment) => segment
      .split(" ")
      .map((word, wordIndex) => word
        .split("/")
        .map((slashPart) => slashPart
          .split("-")
          .map((part, partIndex) => formatToken(part, wordIndex + partIndex))
          .join("-"))
        .join("/"))
      .join(" "))
    .join(" > ");
}

function sourceBrandFrom(item = {}) {
  return sourceTextValue(item.sourceBrand || item.productManagerFields?.brand || item.original?.brand || item.brand || "");
}

function brandLooksLikeSupplier(item = {}) {
  const brand = sourceTextValue(item.brand).toLowerCase();
  if (!brand) return true;
  return [item.supplier, item.vendor, item.defaultSupplier, item.supplierCode]
    .map((value) => sourceTextValue(value).toLowerCase())
    .filter(Boolean)
    .includes(brand);
}

function normalizeCatalogImportReviews(reviews = []) {
  return (Array.isArray(reviews) ? reviews : []).map((review) => ({
    id: review.id || crypto.randomUUID(),
    sku: sourceTextValue(review.sku),
    productId: sourceTextValue(review.productId),
    field: sourceTextValue(review.field),
    label: sourceTextValue(review.label || review.field),
    currentValue: review.currentValue ?? "",
    incomingValue: review.incomingValue ?? "",
    source: sourceTextValue(review.source || "Product dump"),
    status: sourceTextValue(review.status || "pending"),
    createdAt: review.createdAt || new Date().toISOString(),
    updatedAt: review.updatedAt || review.createdAt || new Date().toISOString(),
    decidedAt: review.decidedAt || "",
    decisionNote: review.decisionNote || ""
  })).filter((review) => review.sku && review.field).slice(0, 5000);
}

function queueCatalogImportReview(db, item, field, incomingValue, source = "Product dump") {
  const currentValue = item[field];
  if (normalizedCompareValue(currentValue) === normalizedCompareValue(incomingValue)) return false;
  db.catalogImportReviews = normalizeCatalogImportReviews(db.catalogImportReviews);
  const pending = db.catalogImportReviews.find((review) => (
    review.status === "pending"
    && review.sku.toLowerCase() === String(item.sku || "").toLowerCase()
    && review.field === field
  ));
  const now = new Date().toISOString();
  if (pending) {
    pending.productId = item.id || pending.productId;
    pending.currentValue = currentValue ?? "";
    pending.incomingValue = incomingValue ?? "";
    pending.source = source;
    pending.updatedAt = now;
    return true;
  }
  db.catalogImportReviews.unshift({
    id: crypto.randomUUID(),
    sku: item.sku || "",
    productId: item.id || "",
    field,
    label: PRODUCT_MAPPING_FIELDS.find((mapping) => mapping.key === field)?.label || field,
    currentValue: currentValue ?? "",
    incomingValue: incomingValue ?? "",
    source,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    decidedAt: "",
    decisionNote: ""
  });
  db.catalogImportReviews = db.catalogImportReviews.slice(0, 5000);
  return true;
}

function isEmptyCatalogValue(value) {
  if (Array.isArray(value)) return value.length === 0;
  if (value === undefined || value === null) return true;
  if (typeof value === "number") return value === 0;
  return String(value).trim() === "";
}

function applyProtectedSourceProduct(db, existing, incoming, source = "Source catalog") {
  const sourceBrand = sourceBrandFrom(incoming);
  if (sourceBrand) existing.sourceBrand = sourceBrand;
  for (const [field, incomingValue] of Object.entries(incoming || {})) {
    if (["id", "reserved", "shadowSkus", "serialUnits", "warehouseStock"].includes(field)) continue;
    if (field === "qty" && incoming.stockQty !== undefined) continue;
    if (field === "brand") {
      if (!existing.brand || (!existing.brandLocked && brandLooksLikeSupplier(existing))) {
        existing.brand = formatBrandName(incomingValue);
      } else if (existing.brandLocked || normalizedCompareValue(existing.brand) !== normalizedCompareValue(incomingValue)) {
        queueCatalogImportReview(db, existing, "brand", formatBrandName(incomingValue), source);
      }
      continue;
    }
    if (field === "category") {
      const formattedCategory = formatCategoryName(incomingValue);
      if (formattedCategory) {
        existing.sourceCategory = existing.sourceCategory || formattedCategory;
        existing.vendorCategory = existing.vendorCategory || formattedCategory;
      }
      continue;
    }
    if (DUMP_SOURCE_TRACE_FIELDS.has(field)) {
      existing[field] = incomingValue;
      continue;
    }
    if (DUMP_REVIEW_FIELDS.has(field)) {
      if (isEmptyCatalogValue(existing[field]) && !isEmptyCatalogValue(incomingValue)) {
        existing[field] = incomingValue;
      } else {
        queueCatalogImportReview(db, existing, field, incomingValue, source);
      }
      continue;
    }
    if (DUMP_PROTECTED_CONTENT_FIELDS.has(field)) {
      if (isEmptyCatalogValue(existing[field]) && !isEmptyCatalogValue(incomingValue)) existing[field] = incomingValue;
      continue;
    }
    existing[field] = incomingValue;
  }
  existing.sources = { ...(incoming.sources || {}), ...(existing.sources || {}), catalog: incoming.sku || existing.sku };
  existing.updatedAt = new Date().toISOString();
  return existing;
}

function normalizeDb(db) {
  let changed = false;
  db.sequence = db.sequence || {};
  db.sequence.order = Number(db.sequence.order || 1000);
  db.sequence.po = Number(db.sequence.po || 2000);
  db.sequence.vendor = Number(db.sequence.vendor || 3000);
  db.sequence.draft = Number(db.sequence.draft || 0);
  db.inventoryLedger = Array.isArray(db.inventoryLedger) ? db.inventoryLedger : [];
  db.marketplaceTemplates = normalizeMarketplaceTemplates(db.marketplaceTemplates);
  db.exportMappings = normalizeExportMappings(db.exportMappings);
  db.categorySettings = normalizeCategorySettings(db.categorySettings);
  db.sourceCatalogOverrides = normalizeSourceCatalogOverrides(db.sourceCatalogOverrides);
  db.vendorCategoryMappings = normalizeVendorCategoryMappings(db.vendorCategoryMappings);
  db.catalogImportReviews = normalizeCatalogImportReviews(db.catalogImportReviews);
  db.syncRuns = Array.isArray(db.syncRuns) ? db.syncRuns : [];
  db.importJobs = normalizeImportJobs(db.importJobs, db.syncRuns);
  db.connections = (db.connections || SOURCES.map((name) => ({ id: crypto.randomUUID(), name }))).map(normalizeChannel);

  db.inventory = (db.inventory || []).map((item) => {
    const defaults = PRODUCT_DEFAULTS[item.sku] || {};
    const categoryVerified = sourceBooleanValue(item.categoryVerified ?? item.mainCategoryVerified, Boolean(defaults.category));
    const currentCategory = formatCategoryName(item.category ?? defaults.category ?? "");
    const sourceCategory = formatCategoryName(item.sourceCategory ?? item.vendorCategory ?? item.productManagerFields?.category ?? item.original?.category ?? (categoryVerified ? "" : currentCategory));
    const product = {
      title: item.title ?? item.name ?? defaults.title ?? item.sku ?? "",
      price: Number(sourceNumberValue(item.price ?? item.sale_price ?? item.sell_price ?? defaults.price ?? 0)),
      cost: Number(sourceNumberValue(item.cost ?? item.fob_price ?? item.wholesale_price ?? defaults.cost ?? 0)),
      msrp: Number(sourceNumberValue(item.msrp ?? item.list_price ?? defaults.msrp ?? 0)),
      brand: formatBrandName(item.brand ?? defaults.brand ?? ""),
      sourceBrand: item.sourceBrand ?? item.productManagerFields?.brand ?? item.original?.brand ?? item.brand ?? "",
      brandLocked: Boolean(item.brandLocked ?? false),
      category: categoryVerified ? currentCategory : "",
      mainCategory: categoryVerified ? currentCategory : "",
      categoryVerified,
      sourceCategory,
      vendorCategory: sourceCategory,
      condition: item.condition ?? defaults.condition ?? "New",
      status: item.status ?? defaults.status ?? "Draft",
      active: item.active === undefined ? true : Boolean(item.active),
      barcode: item.barcode ?? item.upc ?? item.gtin ?? defaults.barcode ?? "",
      shortDescription: item.shortDescription ?? item.short_description ?? defaults.shortDescription ?? "",
      longDescription: item.longDescription ?? item.description ?? item.long_description ?? defaults.longDescription ?? "",
      bulletPoints: sourceListValue(item.bulletPoints ?? item.bullet_points ?? item.keyFeatures ?? item.features ?? defaults.bulletPoints ?? []),
      images: sourceListValue(item.images ?? defaults.images ?? []),
      tags: sourceListValue(item.tags ?? defaults.tags ?? []),
      weightOz: Number(item.weightOz ?? defaults.weightOz ?? 0),
      lengthIn: Number(item.lengthIn ?? defaults.lengthIn ?? 0),
      widthIn: Number(item.widthIn ?? defaults.widthIn ?? 0),
      heightIn: Number(item.heightIn ?? defaults.heightIn ?? 0),
      vendor: item.vendor ?? item.supplier ?? defaults.vendor ?? "",
      marketplaceTitle: item.marketplaceTitle ?? item.name ?? defaults.marketplaceTitle ?? item.title ?? item.sku,
      seoKeywords: item.seoKeywords ?? defaults.seoKeywords ?? "",
      externalId: item.externalId ?? item._id ?? "",
      shopifyId: item.shopifyId ?? item.shopify_ID ?? item.shopify_id ?? "",
      shopifyVariantId: item.shopifyVariantId ?? item.shopify_variant_id ?? "",
      shopifyHandle: item.shopifyHandle ?? item.shopify_handle ?? "",
      shopifyStatus: item.shopifyStatus ?? item.shopify_status ?? "",
      shopifyPublished: item.shopifyPublished === undefined ? sourceBooleanValue(item.shopify_published, false) : Boolean(item.shopifyPublished),
      shopifyPublishedAt: item.shopifyPublishedAt ?? item.shopify_published_at ?? "",
      shopifyUpdatedAt: item.shopifyUpdatedAt ?? item.shopify_updated_at ?? "",
      shopifySyncedAt: item.shopifySyncedAt ?? item.shopify_synced_at ?? "",
      defaultImage: item.defaultImage ?? item.default_image ?? "",
      manufacturer: item.manufacturer ?? "",
      mfrPartNumber: item.mfrPartNumber ?? item.mfr_part_number ?? "",
      vendorSku: item.vendorSku ?? item.vendor_sku ?? "",
      supplier: item.supplier ?? "",
      supplierCode: item.supplierCode ?? item.supplier_code ?? "",
      unspsc: item.unspsc ?? "",
      uom: item.uom ?? "",
      uomQty: item.uomQty ?? item.uom_qty ?? "",
      minQuantity: item.minQuantity ?? item.min_quantity ?? "",
      quantityIncrements: item.quantityIncrements ?? item.quantity_increments ?? "",
      hazardous: Boolean(item.hazardous ?? false),
      sdsUrl: item.sdsUrl ?? item.sds_url ?? "",
      itemHeight: Number(item.itemHeight ?? item.item_height ?? 0),
      itemLength: Number(item.itemLength ?? item.item_length ?? 0),
      itemWeight: Number(item.itemWeight ?? item.item_weight ?? 0),
      itemWidth: Number(item.itemWidth ?? item.item_width ?? 0),
      packageHeight: Number(item.packageHeight ?? item.package_height ?? 0),
      packageLength: Number(item.packageLength ?? item.package_length ?? 0),
      packageWeight: Number(item.packageWeight ?? item.package_weight ?? 0),
      packageWidth: Number(item.packageWidth ?? item.package_width ?? 0),
      dimensionalWeight: Number(item.dimensionalWeight ?? item.dimensional_weight ?? calculateDimensionalWeight(item)),
      stockQty: Number(sourceNumberValue(item.stockQty ?? item.stock_qty ?? item.qty ?? 0)),
      stockStatus: item.stockStatus ?? item.stock_status ?? "",
      stockUpdatedAt: item.stockUpdatedAt ?? item.stock_updated_at ?? "",
      ctechId: item.ctechId ?? item.ctech_id ?? "",
      ctechIdLastExport: item.ctechIdLastExport ?? item.ctech_id_last_export ?? "",
      fobPrice: Number(sourceNumberValue(item.fobPrice ?? item.fob_price ?? 0)),
      wildcardSearch: item.wildcardSearch ?? "",
      productDumpCreatedAt: item.productDumpCreatedAt ?? item.created_at ?? "",
      productDumpUpdatedAt: item.productDumpUpdatedAt ?? item.updated_at ?? "",
      inactiveMailedAt: item.inactiveMailedAt ?? item.inactive_mailed_at ?? "",
      validatedAt: item.validatedAt ?? item.validated_at ?? "",
      checkedImage: item.checkedImage ?? item.checked_image ?? {},
      checkedImageUrl: item.checkedImageUrl ?? item.checked_image?.url ?? "",
      checkedImageError: item.checkedImageError ?? item.checked_image?.error ?? "",
      checkedImageSize: item.checkedImageSize ?? item.checked_image?.size ?? "",
      checkedImageTimestamp: item.checkedImageTimestamp ?? item.checked_image?.timestamp ?? "",
      zoroLeadtime: item.zoroLeadtime ?? item.zoro_leadtime ?? "",
      zoroPrice: Number(item.zoroPrice ?? item.zoro_price ?? 0),
      zoroSku: item.zoroSku ?? item.zoro_sku ?? "",
      zoroMinimumQty: Number(item.zoroMinimumQty ?? item.zoro_minimum_qty ?? 0),
      varisContractPrice: Number(item.varisContractPrice ?? item.varis_contract_price ?? 0),
      varisListPrice: Number(item.varisListPrice ?? item.varis_list_price ?? 0),
      varisOdManagedPrice: Number(item.varisOdManagedPrice ?? item.varis_od_managed_price ?? 0),
      varisNonOdManagedPrice: Number(item.varisNonOdManagedPrice ?? item.varis_non_od_managed_price ?? 0),
      varisOdPrivatePrice: Number(item.varisOdPrivatePrice ?? item.varis_od_private_price ?? 0),
      varisNonOdPrivatePrice: Number(item.varisNonOdPrivatePrice ?? item.varis_non_od_private_price ?? 0),
      originalImage: item.originalImage ?? item.original_image ?? "",
      defaultSupplier: item.defaultSupplier ?? item.default_supplier ?? "",
      lastPricesUpdateAt: item.lastPricesUpdateAt ?? item.last_prices_update_at ?? "",
      lastPricesUpdateBy: item.lastPricesUpdateBy ?? item.last_prices_update_by ?? "",
      leadTime: item.leadTime ?? item.lead_time ?? item.leadtime ?? "",
      leadtime: item.leadtime ?? "",
      suppliers: item.suppliers === undefined ? [] : item.suppliers,
      altVendorSku: item.altVendorSku ?? item.alt_vendor_sku ?? "",
      countryOfOrigin: item.countryOfOrigin ?? item.country_of_origin ?? "",
      originalSdsUrl: item.originalSdsUrl ?? item.original_sds_url ?? "",
      itemKey: item.itemKey ?? item.item_key ?? "",
      itemClearanceIndicator: item.itemClearanceIndicator ?? item.item_clearance_indicator ?? "",
      original: item.original === undefined ? null : item.original,
      vendorDescription: item.vendorDescription ?? item.vendor_descripton ?? item.vendor_description ?? "",
      uploadedBy: item.uploadedBy ?? item.uploaded_by ?? "",
      productManagerFields: item.productManagerFields && typeof item.productManagerFields === "object" ? item.productManagerFields : {},
      serialUnits: Array.isArray(item.serialUnits) ? item.serialUnits : [],
      warehouseStock: Array.isArray(item.warehouseStock) ? item.warehouseStock : [],
      shadowSkus: Array.isArray(item.shadowSkus) ? item.shadowSkus.map((shadow) => normalizeShadowSku(shadow, item)) : [],
      attributes: item.attributes || {}
    };

    const merged = { ...item, ...product, images: product.images, tags: product.tags, serialUnits: product.serialUnits, warehouseStock: product.warehouseStock, shadowSkus: product.shadowSkus };
    if (!merged.brandLocked && merged.brand && !brandLooksLikeSupplier(merged)) {
      merged.brandLocked = true;
      changed = true;
    }
    const availableWarehouses = Array.isArray(db.warehouses) ? db.warehouses : [];
    if (!Array.isArray(merged.warehouseStock) || !merged.warehouseStock.length) {
      const fallbackWarehouse = availableWarehouses.find((warehouse) => warehouse.isDefaultReceiving) || availableWarehouses[0];
      merged.warehouseStock = [
        normalizeWarehouseStockRow({
          warehouseId: fallbackWarehouse?.id || "",
          warehouseName: fallbackWarehouse?.name || "Unassigned",
          qty: Number(item.qty || 0),
          reserved: Number(item.reserved || 0),
          reorderPoint: Number(item.reorderPoint || 0)
        }, fallbackWarehouse, merged)
      ];
      changed = true;
    } else {
      merged.warehouseStock = merged.warehouseStock.map((row) => {
        const warehouse = availableWarehouses.find((item) => item.id === row.warehouseId);
        return normalizeWarehouseStockRow(row, warehouse, merged);
      });
    }
    syncInventoryTotalsFromWarehouses(merged);
    if (item.price === undefined || item.shortDescription === undefined || !Array.isArray(item.images)) changed = true;
    return merged;
  });

  db.orders = (db.orders || []).map((order) => {
    const legacyMarketplaceOrder = order.marketplaceOrderId || order.marketplaceOrderNumber || order.orderNumber;
    const internalOrderNumber = order.internalOrderNumber || (/^DP-\d{6}$/.test(order.orderNumber || "") ? order.orderNumber : nextOrderNumber(db));
    const marketplaceOrderNumber = order.marketplaceOrderNumber || legacyMarketplaceOrder || "";
    const detail = ORDER_DETAILS[marketplaceOrderNumber] || ORDER_DETAILS[order.orderNumber] || {};
    const enriched = {
      internalOrderNumber,
      orderNumber: internalOrderNumber,
      displayOrderNumber: internalOrderNumber,
      marketplaceOrderNumber: detail.marketplaceOrderId || marketplaceOrderNumber,
      marketplaceOrderId: detail.marketplaceOrderId || marketplaceOrderNumber,
      marketplaceReferences: order.marketplaceReferences || [
        {
          source: order.source,
          type: "order",
          value: detail.marketplaceOrderId || marketplaceOrderNumber,
          primary: true
        }
      ].filter((reference) => reference.value),
      buyerEmail: detail.buyerEmail || order.buyerEmail || "",
      phone: detail.phone || order.phone || "",
      address: detail.address || order.address || {
        name: order.buyer || "",
        line1: "",
        line2: "",
        city: "",
        state: "",
        postalCode: "",
        country: "US"
      },
      shippingService: detail.shippingService || order.shippingService || "Not selected",
      trackingNumber: detail.trackingNumber || order.trackingNumber || "",
      shippingCarrier: detail.shippingCarrier || order.shippingCarrier || "",
      carrierName: detail.carrierName || order.carrierName || "",
      trackingUrl: detail.trackingUrl || order.trackingUrl || "",
      shipDate: detail.shipDate || order.shipDate || "",
      productCost: Number(detail.productCost ?? order.productCost ?? Number(order.total || 0) * 0.42),
      marketplaceFees: Number(detail.marketplaceFees ?? order.marketplaceFees ?? Number(order.total || 0) * 0.12),
      shippingCost: Number(detail.shippingCost ?? order.shippingCost ?? 0),
      refundAmount: Number(detail.refundAmount ?? order.refundAmount ?? 0),
      notes: detail.notes || order.notes || "",
      items: order.items || [
        {
          sku: order.sku,
          title: order.title,
          qty: order.qty,
          price: Number(order.total || 0) / Math.max(1, Number(order.qty || 1))
        }
      ],
      ...order
    };
    enriched.internalOrderNumber = internalOrderNumber;
    enriched.orderNumber = internalOrderNumber;
    enriched.displayOrderNumber = internalOrderNumber;
    enriched.marketplaceOrderNumber = detail.marketplaceOrderId || marketplaceOrderNumber;
    enriched.marketplaceOrderId = enriched.marketplaceOrderNumber;
    enriched.marketplaceReferences = enriched.marketplaceReferences?.length ? enriched.marketplaceReferences : [
      { source: enriched.source, type: "order", value: enriched.marketplaceOrderNumber, primary: true }
    ].filter((reference) => reference.value);
    enriched.refunds = (Array.isArray(enriched.refunds) ? enriched.refunds : []).map((refund) => ({
      ...refund,
      items: (Array.isArray(refund.items) ? refund.items : []).map((item, index) => ({
        sku: String(item.sku || "").trim(),
        title: String(item.title || item.sku || "").trim(),
        qty: Number(item.qty || 0),
        price: Number(item.price || 0),
        lineIndex: Number(item.lineIndex || index)
      })).filter((item) => item.sku && item.qty > 0)
    }));
    enriched.timeline = normalizeOrderTimeline(enriched);
    if (!order.internalOrderNumber || !order.customerId || !order.items || order.productCost === undefined || !order.address) changed = true;
    return enriched;
  });

  const customerResult = normalizeCustomers(db);
  if (customerResult.changed) changed = true;

  if (!Array.isArray(db.orderDrafts)) {
    db.orderDrafts = [];
    changed = true;
  }
  db.orderDrafts = db.orderDrafts.map((draft) => normalizeOrderDraft(db, draft));

  if (!Array.isArray(db.warehouses)) {
    db.warehouses = seedWarehouses();
    changed = true;
  }
  db.warehouses = (db.warehouses || []).map((warehouse) => normalizeWarehouse(warehouse));
  const fallbackWarehouse = db.warehouses.find((warehouse) => warehouse.isDefaultReceiving) || db.warehouses[0];
  db.inventory = (db.inventory || []).map((item) => {
    item.warehouseStock = Array.isArray(item.warehouseStock) ? item.warehouseStock : [];
    if (!item.warehouseStock.length && fallbackWarehouse) {
      item.warehouseStock = [normalizeWarehouseStockRow({
        warehouseId: fallbackWarehouse.id,
        warehouseName: fallbackWarehouse.name,
        qty: Number(item.qty || 0),
        reserved: Number(item.reserved || 0),
        reorderPoint: Number(item.reorderPoint || 0)
      }, fallbackWarehouse, item)];
      changed = true;
    }
    item.warehouseStock = item.warehouseStock.map((row) => {
      const warehouse = db.warehouses.find((item) => item.id === row.warehouseId) || (row.warehouseId ? null : fallbackWarehouse);
      const normalized = normalizeWarehouseStockRow(row, warehouse, item);
      if (!normalized.warehouseId && fallbackWarehouse) {
        normalized.warehouseId = fallbackWarehouse.id;
        normalized.warehouseName = fallbackWarehouse.name;
      }
      return normalized;
    });
    syncInventoryTotalsFromWarehouses(item);
    return item;
  });
  if (db.warehouses.length && !db.warehouses.some((warehouse) => warehouse.isDefaultReceiving)) {
    db.warehouses[0].isDefaultReceiving = true;
    changed = true;
  }
  if (db.warehouses.length && !db.warehouses.some((warehouse) => warehouse.isDefaultReturns)) {
    db.warehouses[0].isDefaultReturns = true;
    changed = true;
  }

  if (!Array.isArray(db.returns)) {
    db.returns = [
      {
        id: crypto.randomUUID(),
        returnNumber: "RET-00001",
        orderNumber: "TT-90221",
        source: "TikTok Shop",
        sku: "DP-BEAUTY-014",
        warehouseId: db.warehouses[0]?.id || "",
        warehouseName: db.warehouses[0]?.name || "",
        reason: "Changed mind",
        amount: 19.99,
        status: "requested",
        createdAt: "2026-04-21T15:20:00.000Z"
      }
    ];
    changed = true;
  }
  {
    const seenReturnNumbers = new Set();
    let nextReturnSequence = 1;
    db.returns = (db.returns || []).map((item) => {
      let returnNumber = String(item.returnNumber || "").trim();
      if (returnNumber && !seenReturnNumbers.has(returnNumber)) {
        seenReturnNumbers.add(returnNumber);
        const match = returnNumber.match(/^RET-(\d+)$/);
        if (match) nextReturnSequence = Math.max(nextReturnSequence, Number(match[1]) + 1);
      } else {
        while (seenReturnNumbers.has(`RET-${String(nextReturnSequence).padStart(5, "0")}`)) nextReturnSequence += 1;
        returnNumber = `RET-${String(nextReturnSequence).padStart(5, "0")}`;
        seenReturnNumbers.add(returnNumber);
        nextReturnSequence += 1;
        changed = true;
      }
      return {
        ...item,
        returnNumber
      };
    });
    db.sequence = db.sequence || {};
    db.sequence.return = Math.max(Number(db.sequence.return || 0), nextReturnSequence - 1);
  }
  {
    db.returns = (db.returns || []).map((item) => ({
      qty: Math.max(1, Number(item.qty || item.quantity || 1)),
      status: String(item.status || "requested"),
      condition: String(item.condition || "Unknown"),
      receivedAt: item.receivedAt || "",
      receivedBy: item.receivedBy || "",
      binLocation: item.binLocation || "",
      inspectionStatus: item.inspectionStatus || "",
      inspectionCondition: item.inspectionCondition || "",
      inspectionNotes: item.inspectionNotes || "",
      disposition: item.disposition || "",
      resolutionNotes: item.resolutionNotes || "",
      resolvedAt: item.resolvedAt || "",
      resolvedBy: item.resolvedBy || "",
      restockedAt: item.restockedAt || "",
      ...item
    }));
  }

  if (!Array.isArray(db.cancellations)) {
    db.cancellations = [
      {
        id: crypto.randomUUID(),
        orderNumber: "TM-66104",
        source: "Temu",
        sku: "DP-HOME-001",
        reason: "Buyer requested cancellation",
        amount: 24.5,
        status: "closed",
        createdAt: "2026-04-19T13:05:00.000Z"
      }
    ];
    changed = true;
  }

  if (!Array.isArray(db.purchaseOrders)) {
    db.purchaseOrders = [];
    changed = true;
  }

  if (!Array.isArray(db.vendors)) {
    db.vendors = seedVendors();
    changed = true;
  }

  if (db.vendors.some((vendor) => !Array.isArray(vendor.changeLog))) changed = true;
  db.vendors = db.vendors.map((vendor) => normalizeVendor(db, vendor));

  const brandResult = normalizeBrands(db);
  if (brandResult.changed) changed = true;

  db.purchaseOrders = db.purchaseOrders.map((po) => ({
    id: po.id || crypto.randomUUID(),
    poNumber: po.poNumber || nextPoNumber(db),
    status: po.status || "draft",
    vendorId: po.vendorId || findVendorByName(db, po.supplier)?.id || "",
    supplier: po.supplier || findVendorById(db, po.vendorId)?.name || "Unassigned supplier",
    warehouseId: po.warehouseId || db.warehouses[0]?.id || "",
    warehouseName: po.warehouseName || (db.warehouses.find((warehouse) => warehouse.id === po.warehouseId)?.name || db.warehouses[0]?.name || ""),
    source: po.source || "manual",
    orderIds: Array.isArray(po.orderIds) ? po.orderIds : [],
    orderNumbers: Array.isArray(po.orderNumbers) ? po.orderNumbers : [],
    items: Array.isArray(po.items) ? po.items : [],
    totalUnits: Number(po.totalUnits || 0),
    estimatedCost: Number(po.estimatedCost || 0),
    notes: po.notes || "",
    createdBy: po.createdBy || "Luis",
    createdAt: po.createdAt || new Date().toISOString(),
    updatedAt: po.updatedAt || po.createdAt || new Date().toISOString(),
    receipts: Array.isArray(po.receipts) ? po.receipts : [],
    receiptDrafts: Array.isArray(po.receiptDrafts) ? po.receiptDrafts : [],
    submissionHistory: Array.isArray(po.submissionHistory) ? po.submissionHistory : [],
    returns: Array.isArray(po.returns) ? po.returns : [],
    timeline: Array.isArray(po.timeline) && po.timeline.length ? po.timeline : [
      {
        id: crypto.randomUUID(),
        type: "created",
        title: "PO created",
        message: `${po.poNumber || "PO"} added to purchasing.`,
        user: po.createdBy || "Luis",
        createdAt: po.createdAt || new Date().toISOString()
      }
    ]
  }));

  for (const vendor of db.vendors) {
    const pos = db.purchaseOrders.filter((po) => po.vendorId === vendor.id || po.supplier === vendor.name);
    vendor.openPOs = pos.filter((po) => !["closed", "canceled"].includes(po.status)).length;
    vendor.totalPOs = pos.length;
    vendor.totalSpend = pos.reduce((sum, po) => sum + Number(po.estimatedCost || 0), 0);
    vendor.lastPOAt = pos[0]?.createdAt || vendor.lastPOAt || "";
  }

  if (changed) writeDbSync(db);
  if (changed) db.__normalizedChanged = true;
  else delete db.__normalizedChanged;
  return db;
}

function normalizeShadowSku(shadow = {}, parent = {}) {
  const marketplace = String(shadow.marketplace || shadow.company || "").trim();
  const createdAt = shadow.createdAt || new Date().toISOString();
  return {
    id: shadow.id || crypto.randomUUID(),
    parentSku: shadow.parentSku || parent.sku || "",
    shadowSku: String(shadow.shadowSku || shadow.sku || "").trim(),
    marketplace,
    company: marketplace,
    price: Number(shadow.price ?? parent.price ?? 0),
    handlingTimeDays: Number(shadow.handlingTimeDays ?? shadow.handlingTime ?? 2),
    safetyQty: Number(shadow.safetyQty ?? 0),
    maxSellableQty: Number(shadow.maxSellableQty ?? 0),
    inventoryPolicy: shadow.inventoryPolicy || "Share parent inventory",
    shippingProfile: shadow.shippingProfile || "",
    shippingService: shadow.shippingService || "",
    shippingTemplateId: shadow.shippingTemplateId || "",
    freeShipping: Boolean(shadow.freeShipping ?? false),
    marketplaceAttributes: shadow.marketplaceAttributes || {},
    contentOverrides: {
      title: shadow.contentOverrides?.title || "",
      shortDescription: shadow.contentOverrides?.shortDescription || "",
      longDescription: shadow.contentOverrides?.longDescription || "",
      imageUrls: Array.isArray(shadow.contentOverrides?.imageUrls) ? shadow.contentOverrides.imageUrls : []
    },
    syncStatus: shadow.syncStatus || "Not synced",
    lastSyncAt: shadow.lastSyncAt || "",
    syncHistory: Array.isArray(shadow.syncHistory) ? shadow.syncHistory : [],
    timeline: Array.isArray(shadow.timeline) && shadow.timeline.length ? shadow.timeline : [
      {
        id: crypto.randomUUID(),
        type: "created",
        title: "Shadow SKU created",
        message: `${shadow.shadowSku || shadow.sku || "Shadow SKU"} created for ${marketplace || "marketplace"}.`,
        user: "System",
        createdAt
      }
    ],
    status: shadow.status || "Draft",
    notes: shadow.notes || "",
    createdAt,
    updatedAt: shadow.updatedAt || createdAt
  };
}

function normalizeChannel(channel = {}) {
  const settings = { ...DEFAULT_CHANNEL_SETTINGS, ...(channel.settings || {}) };
  for (const field of ["defaultHandlingTimeDays", "defaultSafetyQty", "defaultMaxSellableQty", "priceMarkupPercent", "minMarginPercent"]) {
    settings[field] = Number(settings[field] || 0);
  }
  for (const field of ["priceUpdateEnabled", "inventoryUpdateEnabled", "orderDownloadEnabled", "trackingUpdateEnabled", "cancellationNotificationEnabled", "autoCreateShadow"]) {
    settings[field] = settings[field] === true || String(settings[field]).toLowerCase() === "true";
  }
  return {
    id: channel.id || crypto.randomUUID(),
    name: channel.name || "Marketplace",
    connected: Boolean(channel.connected),
    status: channel.status || (channel.connected ? "active" : "inactive"),
    lastSync: channel.lastSync || null,
    logoUrl: channel.logoUrl || "",
    logoDataUrl: channel.logoDataUrl || "",
    notes: channel.notes || "",
    settings
  };
}

function findChannelByName(db, name = "") {
  const key = String(name).toLowerCase();
  return (db.connections || []).find((channel) => String(channel.name || "").toLowerCase() === key);
}

function applyChannelDefaultsToShadow(db, shadow, marketplace) {
  const channel = findChannelByName(db, marketplace);
  const settings = channel?.settings || DEFAULT_CHANNEL_SETTINGS;
  if (shadow.status === undefined) shadow.status = settings.defaultShadowStatus;
  if (shadow.handlingTimeDays === undefined) shadow.handlingTimeDays = settings.defaultHandlingTimeDays;
  if (shadow.safetyQty === undefined) shadow.safetyQty = settings.defaultSafetyQty;
  if (shadow.maxSellableQty === undefined) shadow.maxSellableQty = settings.defaultMaxSellableQty;
  if (shadow.shippingProfile === undefined) shadow.shippingProfile = settings.defaultShippingProfile;
  if (shadow.shippingService === undefined) shadow.shippingService = settings.defaultShippingService;
  return shadow;
}

function parseTemplateList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || "")
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeMarketplaceTemplate(template = {}) {
  const requiredAttributes = parseTemplateList(template.requiredAttributes);
  const fieldDefinitions = normalizeTemplateFields(template.fieldDefinitions, requiredAttributes, template.optionLists);
  return {
    id: template.id || crypto.randomUUID(),
    marketplace: String(template.marketplace || "").trim(),
    requiredAttributes,
    fieldDefinitions,
    optionLists: template.optionLists && typeof template.optionLists === "object" ? template.optionLists : Object.fromEntries(fieldDefinitions.filter((field) => field.options?.length).map((field) => [field.key, field.options])),
    categoryMappings: Array.isArray(template.categoryMappings) ? template.categoryMappings.map((mapping) => ({
      id: mapping.id || crypto.randomUUID(),
      internalCategory: mapping.internalCategory || "",
      marketplaceCategory: mapping.marketplaceCategory || "",
      marketplaceCategoryId: mapping.marketplaceCategoryId || ""
    })) : [],
    titleMaxLength: Number(template.titleMaxLength || 120),
    minImages: Number(template.minImages || 1),
    requireShippingProfile: template.requireShippingProfile !== false,
    requireHandlingTime: template.requireHandlingTime !== false,
    requirePrice: template.requirePrice !== false,
    notes: template.notes || "",
    updatedAt: template.updatedAt || new Date().toISOString()
  };
}

function normalizeTemplateFields(fields, requiredAttributes = [], optionLists = {}) {
  const source = Array.isArray(fields) && fields.length ? fields : requiredAttributes.map((key) => ({ key }));
  return source.map((field) => {
    const key = String(field.key || field.name || "").trim();
    const options = Array.isArray(field.options)
      ? field.options.map(String).filter(Boolean)
      : parseTemplateList(optionLists?.[key] || field.options || "");
    return {
      key,
      type: field.type || (options.length ? "select" : "text"),
      options,
      required: field.required !== false
    };
  }).filter((field) => field.key);
}

function parseTemplateFields(value) {
  if (Array.isArray(value)) return normalizeTemplateFields(value);
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => {
      const [key, type = "text", options = ""] = line.split("|").map((part) => part.trim());
      return key ? { key, type, options: parseTemplateList(options.replaceAll(";", ",")), required: true } : null;
    })
    .filter(Boolean);
}

function addShadowTimeline(shadow, event) {
  shadow.timeline = Array.isArray(shadow.timeline) ? shadow.timeline : [];
  shadow.timeline.push({
    id: crypto.randomUUID(),
    type: "edited",
    title: "Shadow updated",
    message: "",
    user: "Luis",
    createdAt: new Date().toISOString(),
    ...event
  });
}

function normalizeMarketplaceTemplates(templates = []) {
  const existing = new Map((Array.isArray(templates) ? templates : []).map((template) => [String(template.marketplace || "").toLowerCase(), template]));
  const merged = DEFAULT_MARKETPLACE_TEMPLATES.map((defaults) => normalizeMarketplaceTemplate({ ...defaults, ...(existing.get(defaults.marketplace.toLowerCase()) || {}) }));
  for (const template of Array.isArray(templates) ? templates : []) {
    const key = String(template.marketplace || "").toLowerCase();
    if (key && !DEFAULT_MARKETPLACE_TEMPLATES.some((defaults) => defaults.marketplace.toLowerCase() === key)) {
      merged.push(normalizeMarketplaceTemplate(template));
    }
  }
  return merged;
}

function parseMappingRows(rows) {
  if (Array.isArray(rows)) return rows;
  return String(rows || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [externalColumn, productField, defaultValue = ""] = line.split("|").map((part) => part.trim());
      return { externalColumn, productField, defaultValue };
    });
}

function normalizeExportMappingRow(row = {}) {
  return {
    id: row.id || crypto.randomUUID(),
    externalColumn: String(row.externalColumn || row.column || "").trim(),
    productField: String(row.productField || row.field || "").trim(),
    defaultValue: row.defaultValue === undefined ? "" : String(row.defaultValue),
    transform: String(row.transform || "").trim(),
    required: Boolean(row.required)
  };
}

function normalizeExportMapping(template = {}) {
  const mappings = parseMappingRows(template.mappings).map(normalizeExportMappingRow).filter((row) => row.externalColumn);
  return {
    id: template.id || crypto.randomUUID(),
    name: String(template.name || template.source || "Product Export Mapping").trim(),
    source: String(template.source || template.channel || "Custom").trim(),
    format: "csv",
    mode: template.mode || "both",
    status: template.status || "active",
    mappings,
    notes: template.notes || "",
    createdAt: template.createdAt || new Date().toISOString(),
    updatedAt: template.updatedAt || template.createdAt || new Date().toISOString()
  };
}

function normalizeExportMappings(templates = []) {
  const input = Array.isArray(templates) ? templates : [];
  const existing = new Map(input.map((template) => [String(template.id || template.name || "").toLowerCase(), template]));
  const merged = DEFAULT_EXPORT_MAPPINGS.map((defaults) => normalizeExportMapping({ ...defaults, ...(existing.get(defaults.id.toLowerCase()) || {}) }));
  for (const template of input) {
    const key = String(template.id || "").toLowerCase();
    if (!DEFAULT_EXPORT_MAPPINGS.some((defaults) => defaults.id.toLowerCase() === key)) merged.push(normalizeExportMapping(template));
  }
  return merged;
}

function categoryMappingForProduct(db, item, channel = "shopify") {
  const category = formatCategoryName(item.category || "").toLowerCase();
  if (!category) return null;
  const settings = normalizeCategorySettings(db.categorySettings);
  const match = settings.find((row) => formatCategoryName(row.name || "").toLowerCase() === category || String(row.categoryId || "").trim().toLowerCase() === category);
  return match?.mappings?.[channel] || null;
}

function slugPart(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function verifiedBrandForHandle(item = {}) {
  const explicitBrand = item.verifiedBrand || item.verified_brand;
  if (String(explicitBrand || "").trim()) return explicitBrand;
  return item.brandLocked && String(item.brand || "").trim() ? item.brand : "";
}

function shopifyHandleForProduct(item) {
  const verifiedBrand = verifiedBrandForHandle(item);
  const title = item.marketplaceTitle || item.title || item.name;
  const name = item.name || item.title || item.marketplaceTitle;
  const parts = verifiedBrand ? [verifiedBrand, item.sku, title] : [item.sku, name];
  return parts.map(slugPart)
    .filter(Boolean)
    .join("-")
    .replace(/-+/g, "-");
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => {
      const number = Number(code);
      return Number.isFinite(number) ? String.fromCharCode(number) : "";
    });
}

function stripHtml(value) {
  return decodeHtmlEntities(value)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, "\n")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function normalizeContentWhitespace(value) {
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isMostlyAllCaps(value) {
  const letters = String(value || "").replace(/[^a-z]/gi, "");
  if (letters.length < 12) return false;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  const lower = letters.replace(/[^a-z]/g, "").length;
  return upper / letters.length > 0.85 && lower < 3;
}

function smartLowerWord(word) {
  if (/^\d/.test(word) || /^[A-Z]{1,4}\d/i.test(word)) return word;
  if (/^(sku|upc|usb|led|pvc|hvac|api|seo|sds|ul|ce)$/i.test(word)) return word.toUpperCase();
  if (/^(usa|us)$/i.test(word)) return word.toUpperCase();
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function titleCaseAllCaps(value) {
  return String(value || "").split(/(\s+|[-/])/).map((part) => {
    if (!/[A-Z]/i.test(part) || /^[-/]$/.test(part)) return part;
    return smartLowerWord(part);
  }).join("");
}

function sentenceCaseAllCaps(value) {
  const text = String(value || "").toLowerCase();
  return text.replace(/(^|[.!?]\s+)([a-z])/g, (match, prefix, letter) => `${prefix}${letter.toUpperCase()}`)
    .replace(/\b(usb|led|pvc|hvac|api|seo|sds|ul|ce|usa|upc|sku)\b/g, (match) => match.toUpperCase());
}

function sanitizeProductTitle(value) {
  const text = normalizeContentWhitespace(stripHtml(value));
  return isMostlyAllCaps(text) ? titleCaseAllCaps(text) : text;
}

function sanitizeProductText(value) {
  const text = normalizeContentWhitespace(stripHtml(value));
  return isMostlyAllCaps(text) ? sentenceCaseAllCaps(text) : text;
}

function sanitizeProductHtml(value) {
  const text = sanitizeProductText(value);
  if (!text) return "";
  return text.split(/\n{2,}/).map((paragraph) => `<p>${escapeHtml(paragraph.trim())}</p>`).join("");
}

function productFieldValue(db, item, field, mapping = {}) {
  if (String(mapping.externalColumn || "").trim().toLowerCase() === "handle") return shopifyHandleForProduct(item);
  if (field === "available") return Number(item.qty ?? item.stockQty ?? 0) - Number(item.reserved || 0);
  if (field === "vendor") return item.vendor ?? item.supplier ?? "";
  if (field === "qty") return item.qty ?? item.stockQty ?? "";
  if (field === "shopifyHandle") return shopifyHandleForProduct(item);
  if (field === "images") return (item.images || []).join("|");
  if (field === "tags") return (item.tags || []).join("|");
  if (field === "bulletPoints") return (item.bulletPoints || []).join("|");
  if (field === "sources") return Object.entries(item.sources || {}).map(([source, id]) => `${source}:${id}`).join(";");
  if (field === "shopifyCategoryId") return categoryMappingForProduct(db, item, "shopify")?.categoryId || "";
  if (field === "shopifyCategoryPath") return categoryMappingForProduct(db, item, "shopify")?.categoryPath || "";
  if (field === "googleCategoryId") return categoryMappingForProduct(db, item, "shopify")?.googleCategory?.id || "";
  if (field === "googleCategoryBreadcrumb") return categoryMappingForProduct(db, item, "shopify")?.googleCategory?.breadcrumb || categoryMappingForProduct(db, item, "shopify")?.googleCategory?.fullName || "";
  if (field === "title" || field === "marketplaceTitle") return sanitizeProductTitle(item[field]);
  if (["shortDescription", "longDescription", "vendorDescription"].includes(field)) {
    return /html/i.test(String(mapping.externalColumn || "")) ? sanitizeProductHtml(item[field]) : sanitizeProductText(item[field]);
  }
  return item[field] ?? "";
}

function cleanExportNumber(value, decimals = 3) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  return Number(number.toFixed(decimals)).toString();
}

function shopifyDimensionValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  return `${cleanExportNumber(number * 25.4, 3)} mm`;
}

function shopifyWeightValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  return `${cleanExportNumber(number * 0.45359237, 3)} kg`;
}

function shopifyBooleanValue(value, item = {}) {
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  const text = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "y", "active", "in stock", "instock", "available", "received"].includes(text)) return "TRUE";
  if (["false", "0", "no", "n", "inactive", "out of stock", "outofstock", "unavailable", "discontinued", "deleted"].includes(text)) return "FALSE";
  if (Number.isFinite(Number(value))) return Number(value) > 0 ? "TRUE" : "FALSE";
  return Number(item.stockQty ?? item.qty ?? 0) > 0 ? "TRUE" : "FALSE";
}

function padDatePart(value) {
  return String(value).padStart(2, "0");
}

function shopifyDateTimeValue(value) {
  if (!value) return "";
  const text = String(value).trim();
  const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (dmy) {
    const [, day, month, year, hour = "0", minute = "0"] = dmy;
    return `${year}-${padDatePart(month)}-${padDatePart(day)} ${padDatePart(hour)}:${padDatePart(minute)}`;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getUTCFullYear()}-${padDatePart(date.getUTCMonth() + 1)}-${padDatePart(date.getUTCDate())} ${padDatePart(date.getUTCHours())}:${padDatePart(date.getUTCMinutes())}`;
}

function shopifyJsonValue(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "[object Object]") return "";
    try {
      return JSON.stringify(JSON.parse(trimmed));
    } catch {
      return JSON.stringify(trimmed);
    }
  }
  return JSON.stringify(value);
}

function barcodeTextValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  let text = raw;
  if (/^\d+(?:\.\d+)?e\+\d+$/i.test(text)) {
    const number = Number(text);
    if (Number.isFinite(number)) {
      text = number.toLocaleString("fullwide", { useGrouping: false, maximumFractionDigits: 0 });
    }
  }
  const digits = text.replace(/\D/g, "");
  if (!digits) return "";
  return digits.length > 7 && digits.length < 12 ? digits.padStart(12, "0") : digits;
}

function shopifyProductStatusValue(value, item = {}, mapping = {}) {
  const raw = String(value || mapping.defaultValue || item.status || "").trim().toLowerCase();
  if (["active", "published", "publish"].includes(raw)) return "Active";
  if (["archived", "archive", "deleted", "discontinued"].includes(raw)) return "Archived";
  return "Draft";
}

function shopifyPublishedValue(item = {}, mapping = {}) {
  return shopifyProductStatusValue(item.status, item, mapping) === "Active" ? "TRUE" : "FALSE";
}

function categoryTypeValue(value) {
  const parts = String(value || "")
    .split(">")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.slice(-2).join(" > ") || parts[0] || "";
}

function formatMappedExportValue(value, mapping = {}, item = {}) {
  const column = String(mapping.externalColumn || "");
  if (/^(Variant Barcode|Barcode|UPC|GTIN|EAN)$/i.test(column)) return barcodeTextValue(value);
  if (/^Type$/i.test(column)) return categoryTypeValue(value);
  if (/^Status$/i.test(column)) return shopifyProductStatusValue(value, item, mapping);
  if (/^Published$/i.test(column)) return shopifyPublishedValue(item, mapping);
  if (/^Variant Inventory Tracker$/i.test(column)) return "shopify";
  if (/^Metafield:\s*custom\..*\[dimension\]/i.test(column)) return shopifyDimensionValue(value);
  if (/^Metafield:\s*custom\..*\[weight\]/i.test(column)) return shopifyWeightValue(value);
  if (/^Metafield:\s*custom\..*\[boolean\]/i.test(column)) return shopifyBooleanValue(value, item);
  if (/^Metafield:\s*custom\..*\[date_time\]/i.test(column)) return shopifyDateTimeValue(value);
  if (/^Metafield:\s*custom\..*\[json\]/i.test(column)) return shopifyJsonValue(value);
  if (Array.isArray(value)) return value.join("|");
  if (value && typeof value === "object") return JSON.stringify(value);
  return value;
}

function castMappedProductValue(field, value) {
  const definition = PRODUCT_MAPPING_FIELDS.find((item) => item.key === field);
  if (!definition) return value;
  if (definition.type === "number") return Number.isFinite(Number(value)) ? Number(value) : undefined;
  if (definition.type === "boolean") return value === true || ["true", "1", "yes", "active"].includes(String(value || "").trim().toLowerCase());
  if (definition.type === "list") return parseList(value);
  return value;
}

function mappedRecordToProductPayload(record, template) {
  const payload = {};
  for (const mapping of template.mappings || []) {
    if (!record || record[mapping.externalColumn] === undefined) continue;
    const field = mapping.productField;
    if (!PRODUCT_MAPPING_FIELDS.some((definition) => definition.key === field) || field === "available" || field === "shopifyHandle" || field.startsWith("google")) continue;
    const value = castMappedProductValue(field, record[mapping.externalColumn]);
    if (value !== undefined) payload[field] = value;
  }
  return payload;
}

function mappedProductsCsv(db, template, items) {
  const headers = (template.mappings || []).map((mapping) => mapping.externalColumn);
  const rows = items.map((item) => (template.mappings || []).map((mapping) => {
    const value = productFieldValue(db, item, mapping.productField, mapping);
    const formatted = formatMappedExportValue(value, mapping, item);
    return formatted === "" || formatted === undefined || formatted === null ? mapping.defaultValue || "" : formatted;
  }));
  return [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
}

function mappedExportFilename(template) {
  return `${String(template.name || "product-export").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "product-export"}.csv`;
}

function csvValue(record, names = []) {
  for (const name of names) {
    if (record[name] !== undefined) return String(record[name] ?? "").trim();
  }
  const normalized = Object.fromEntries(Object.entries(record || {}).map(([key, value]) => [key.trim().toLowerCase(), value]));
  for (const name of names) {
    const value = normalized[String(name).trim().toLowerCase()];
    if (value !== undefined) return String(value ?? "").trim();
  }
  return "";
}

function normalizedHandle(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeShopifyStatus(value) {
  const text = String(value || "").trim().toLowerCase();
  if (["active", "published"].includes(text)) return "Active";
  if (["archived", "archive"].includes(text)) return "Archived";
  if (["draft", "unpublished", ""].includes(text)) return "Draft";
  return String(value || "").trim();
}

function normalizeShopifyPublished(value, status = "") {
  const text = String(value || "").trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(text)) return true;
  if (["false", "0", "no", "n"].includes(text)) return false;
  return normalizeShopifyStatus(status) === "Active";
}

function buildShopifyLookupMaps(db) {
  const bySku = new Map();
  const byHandle = new Map();
  const byProductId = new Map();
  for (const item of db.inventory || []) {
    if (item.sku) bySku.set(String(item.sku).trim().toLowerCase(), item);
    if (item.shopifyId) byProductId.set(String(item.shopifyId).trim(), item);
    if (item.shopifyHandle) byHandle.set(normalizedHandle(item.shopifyHandle), item);
    const computed = shopifyHandleForProduct(item);
    if (computed) byHandle.set(normalizedHandle(computed), item);
  }
  return { bySku, byHandle, byProductId };
}

function shopifyStatusPayloadFromRecord(record) {
  const status = normalizeShopifyStatus(csvValue(record, ["Status"]));
  const productId = csvValue(record, ["ID", "Product ID"]);
  return {
    sku: csvValue(record, ["Variant SKU", "Variant: SKU", "SKU"]),
    handle: csvValue(record, ["Handle"]),
    shopifyId: productId,
    shopifyVariantId: csvValue(record, ["Variant ID", "Variant: ID"]),
    shopifyHandle: csvValue(record, ["Handle"]),
    shopifyStatus: status,
    shopifyPublished: normalizeShopifyPublished(csvValue(record, ["Published"]), status),
    shopifyPublishedAt: csvValue(record, ["Published At", "Published: At"]),
    shopifyUpdatedAt: csvValue(record, ["Updated At", "Updated: At"]),
    shopifySyncedAt: new Date().toISOString()
  };
}

function findProductForShopifyRecord(record, maps) {
  const payload = shopifyStatusPayloadFromRecord(record);
  const skuKey = String(payload.sku || "").trim().toLowerCase();
  if (skuKey && maps.bySku.has(skuKey)) return { item: maps.bySku.get(skuKey), payload, matchBy: "Variant SKU" };
  const handleKey = normalizedHandle(payload.handle);
  if (handleKey && maps.byHandle.has(handleKey)) return { item: maps.byHandle.get(handleKey), payload, matchBy: "Handle" };
  if (payload.shopifyId && maps.byProductId.has(payload.shopifyId)) return { item: maps.byProductId.get(payload.shopifyId), payload, matchBy: "Shopify ID" };
  return { item: null, payload, matchBy: "" };
}
function normalizeCategorySettings(settings = []) {
  return (Array.isArray(settings) ? settings : []).map((category) => ({
    id: category.id || crypto.randomUUID(),
    categoryId: category.categoryId || category.id || "",
    name: formatCategoryName(category.name || "Uncategorized"),
    status: category.status || "needs_review",
    owner: category.owner || "",
    notes: category.notes || "",
    mappings: {
      shopify: normalizeChannelCategoryMapping(category.mappings?.shopify),
      temu: normalizeChannelCategoryMapping(category.mappings?.temu),
      tiktok: normalizeChannelCategoryMapping(category.mappings?.tiktok),
      ebay: normalizeChannelCategoryMapping(category.mappings?.ebay),
      whatnot: normalizeChannelCategoryMapping(category.mappings?.whatnot)
    },
    defaults: {
      condition: category.defaults?.condition || "New",
      countryOfOrigin: category.defaults?.countryOfOrigin || "",
      hazardousAllowed: Boolean(category.defaults?.hazardousAllowed),
      packageWeightRequired: category.defaults?.packageWeightRequired !== false,
      shippingProfile: category.defaults?.shippingProfile || "",
      returnPolicy: category.defaults?.returnPolicy || ""
    },
    requiredAttributes: Array.isArray(category.requiredAttributes) ? category.requiredAttributes : [],
    updatedAt: category.updatedAt || category.createdAt || new Date().toISOString(),
    createdAt: category.createdAt || new Date().toISOString()
  }));
}

function categoryIdentity(value, scope = "source") {
  const name = formatCategoryName(value || "Uncategorized") || "Uncategorized";
  const hash = crypto.createHash("sha1").update(name.toLowerCase()).digest("hex").slice(0, 16);
  return { id: `${scope}-${hash}`, name };
}

function normalizeChannelCategoryMapping(mapping = {}) {
  return {
    categoryId: mapping.categoryId || "",
    categoryPath: mapping.categoryPath || "",
    categoryHandle: mapping.categoryHandle || "",
    collectionHandle: mapping.collectionHandle || "",
    taxonomyVersion: mapping.taxonomyVersion || "",
    googleCategory: mapping.googleCategory && typeof mapping.googleCategory === "object" ? {
      id: mapping.googleCategory.id || "",
      fullName: mapping.googleCategory.fullName || mapping.googleCategory.breadcrumb || "",
      breadcrumb: mapping.googleCategory.breadcrumb || mapping.googleCategory.fullName || "",
      taxonomy: mapping.googleCategory.taxonomy || ""
    } : null,
    attributes: Array.isArray(mapping.attributes) ? mapping.attributes.map((attribute) => ({
      id: attribute.id || "",
      name: attribute.name || "",
      handle: attribute.handle || "",
      description: attribute.description || "",
      extended: Boolean(attribute.extended)
    })).filter((attribute) => attribute.id || attribute.name) : [],
    status: mapping.status || (mapping.categoryId || mapping.categoryPath ? "mapped" : "missing"),
    notes: mapping.notes || ""
  };
}

function readCatalogCategoryIndex() {
  if (!fs.existsSync(CATALOG_CATEGORY_INDEX_FILE)) return { categories: [], categoryCount: 0, generatedAt: "" };
  try {
    return JSON.parse(fs.readFileSync(CATALOG_CATEGORY_INDEX_FILE, "utf8"));
  } catch {
    return { categories: [], categoryCount: 0, generatedAt: "" };
  }
}

function categorySettingsMap(db) {
  db.categorySettings = normalizeCategorySettings(db.categorySettings);
  const map = new Map();
  for (const category of db.categorySettings) {
    if (category.id) map.set(category.id, category);
    if (category.categoryId) map.set(category.categoryId, category);
    const nameKey = formatCategoryName(category.name || "").toLowerCase();
    if (nameKey) map.set(`name:${nameKey}`, category);
  }
  return map;
}

function readShopifyTaxonomyIndex() {
  if (!fs.existsSync(SHOPIFY_TAXONOMY_INDEX_FILE)) return { categories: [], categoryCount: 0, version: "", generatedAt: "" };
  try {
    return JSON.parse(fs.readFileSync(SHOPIFY_TAXONOMY_INDEX_FILE, "utf8"));
  } catch {
    return { categories: [], categoryCount: 0, version: "", generatedAt: "" };
  }
}

function compactShopifyCategory(category) {
  return {
    id: category.id || "",
    handle: category.handle || String(category.id || "").split("/").pop() || "",
    name: category.name || "",
    fullName: category.fullName || category.name || "",
    path: Array.isArray(category.path) ? category.path : String(category.fullName || category.name || "").split(" > ").filter(Boolean),
    level: Number(category.level || 0),
    vertical: category.vertical || "",
    attributeCount: Number(category.attributeCount || (category.attributes || []).length || 0),
    googleCategory: category.googleCategory || null,
    attributes: Array.isArray(category.attributes) ? category.attributes : []
  };
}

function searchShopifyTaxonomy(query = "", limit = 20) {
  const index = readShopifyTaxonomyIndex();
  const q = String(query || "").trim().toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  const max = Math.max(1, Math.min(Number(limit || 20), 50));
  let rows = index.categories || [];
  if (tokens.length) {
    rows = rows.map((category) => {
      const haystack = String((category.fullName || "") + " " + (category.name || "") + " " + (category.id || "") + " " + (category.handle || "")).toLowerCase();
      if (!tokens.every((token) => haystack.includes(token))) return null;
      const exact = haystack === q ? 100 : 0;
      const leaf = String(category.name || "").toLowerCase().includes(q) ? 30 : 0;
      const path = String(category.fullName || "").toLowerCase().includes(q) ? 15 : 0;
      return { category, score: exact + leaf + path - Math.max(0, Number(category.level || 0) - 2) };
    }).filter(Boolean).sort((a, b) => b.score - a.score || a.category.fullName.localeCompare(b.category.fullName)).map((row) => row.category);
  }
  return {
    channel: "shopify",
    version: index.version || "",
    generatedAt: index.generatedAt || "",
    total: rows.length,
    categories: rows.slice(0, max).map(compactShopifyCategory)
  };
}

function enrichShopifyCategoryMapping(mapping = {}) {
  const next = { ...mapping };
  const shopifyIndex = readShopifyTaxonomyIndex();
  const lookup = String(next.categoryId || "").trim();
  const pathLookup = String(next.categoryPath || "").trim().toLowerCase();
  const shopifyCategory = (shopifyIndex.categories || []).find((row) => (
    (lookup && (row.id === lookup || row.handle === lookup || String(row.id || "").split("/").pop() === lookup)) ||
    (pathLookup && String(row.fullName || row.name || "").trim().toLowerCase() === pathLookup)
  ));
  if (!shopifyCategory) return next;
  const compact = compactShopifyCategory(shopifyCategory);
  return {
    ...next,
    categoryId: shopifyCategory.id,
    categoryPath: shopifyCategory.fullName,
    categoryHandle: shopifyCategory.handle,
    taxonomyVersion: shopifyIndex.version || "",
    googleCategory: compact.googleCategory,
    attributes: compact.attributes
  };
}

function findOrCreateCategorySetting(db, categoryName) {
  db.categorySettings = normalizeCategorySettings(db.categorySettings);
  const identity = categoryIdentity(categoryName, "main");
  let category = db.categorySettings.find((row) => (
    row.categoryId === identity.id ||
    row.id === identity.id ||
    formatCategoryName(row.name).toLowerCase() === identity.name.toLowerCase()
  ));
  if (!category) {
    category = normalizeCategorySettings([{ categoryId: identity.id, name: identity.name }])[0];
    db.categorySettings.push(category);
  }
  return category;
}

function categorySavedSettings(settings, category) {
  return settings.get(category.id) || settings.get(category.categoryId) || settings.get(`name:${formatCategoryName(category.name || "").toLowerCase()}`) || {};
}

function categoryMappingSummary(category, saved) {
  const mappings = saved.mappings || {};
  const mappingCount = ["shopify", "temu", "tiktok", "ebay", "whatnot"].filter((key) => {
    const mapping = mappings[key] || {};
    return mapping.categoryId || mapping.categoryPath || mapping.collectionHandle;
  }).length;
  return {
    mappings,
    mappingCount,
    missingMappings: ["shopify", "temu", "tiktok", "ebay", "whatnot"].filter((key) => {
      const mapping = mappings[key] || {};
      return !(mapping.categoryId || mapping.categoryPath || mapping.collectionHandle);
    })
  };
}

function publicCategoryRow(category, settings, scope) {
  const categoryName = formatCategoryName(category.name);
  const saved = categorySavedSettings(settings, { ...category, name: categoryName });
  const { mappings, mappingCount, missingMappings } = categoryMappingSummary(category, saved);
  return {
    ...category,
    scope,
    name: categoryName,
    topBrands: Array.isArray(category.topBrands) ? category.topBrands.map((brand) => ({ ...brand, name: formatBrandName(brand.name) })) : [],
    status: saved.status || (mappingCount ? "mapped" : "needs_review"),
    owner: saved.owner || "",
    notes: saved.notes || "",
    mappings: {
      shopify: normalizeChannelCategoryMapping(mappings.shopify),
      temu: normalizeChannelCategoryMapping(mappings.temu),
      tiktok: normalizeChannelCategoryMapping(mappings.tiktok),
      ebay: normalizeChannelCategoryMapping(mappings.ebay),
      whatnot: normalizeChannelCategoryMapping(mappings.whatnot)
    },
    defaults: normalizeCategorySettings([{ ...saved, name: categoryName, categoryId: category.id }])[0].defaults,
    requiredAttributes: Array.isArray(saved.requiredAttributes) ? saved.requiredAttributes : [],
    mappingCount,
    missingMappings
  };
}

function aggregateMainCatalogCategories(db) {
  const byCategory = new Map();
  for (const item of db.inventory || []) {
    const name = item.categoryVerified ? (formatCategoryName(item.category || item.mainCategory || "Uncategorized") || "Uncategorized") : "Uncategorized";
    const key = name.toLowerCase();
    if (!byCategory.has(key)) {
      const identity = categoryIdentity(name, "main");
      byCategory.set(key, {
        id: identity.id,
        categoryId: identity.id,
        name,
        productCount: 0,
        activeProductCount: 0,
        stockProductCount: 0,
        hazardousProductCount: 0,
        _vendors: new Map(),
        _brands: new Map()
      });
    }
    const row = byCategory.get(key);
    row.productCount += 1;
    if (item.active !== false) row.activeProductCount += 1;
    if (Number(item.stockQty ?? item.qty ?? 0) > 0) row.stockProductCount += 1;
    if (item.hazardous) row.hazardousProductCount += 1;
    const vendor = sourceTextValue(item.supplier || item.vendor || "Unassigned");
    if (vendor) row._vendors.set(vendor, (row._vendors.get(vendor) || 0) + 1);
    const brand = formatBrandName(item.brand || "");
    if (brand) row._brands.set(brand, (row._brands.get(brand) || 0) + 1);
  }
  for (const setting of normalizeCategorySettings(db.categorySettings)) {
    const name = formatCategoryName(setting.name || "");
    if (!name) continue;
    const key = name.toLowerCase();
    if (!byCategory.has(key)) {
      const identity = categoryIdentity(name, "main");
      byCategory.set(key, {
        id: identity.id,
        categoryId: identity.id,
        name,
        productCount: 0,
        activeProductCount: 0,
        stockProductCount: 0,
        hazardousProductCount: 0,
        _vendors: new Map(),
        _brands: new Map()
      });
    }
  }
  return [...byCategory.values()].map((row) => {
    const topVendors = [...row._vendors.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 12);
    const topBrands = [...row._brands.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 12);
    delete row._vendors;
    delete row._brands;
    return { ...row, topVendors, topBrands };
  }).sort((a, b) => b.productCount - a.productCount || a.name.localeCompare(b.name));
}

function sourceCatalogCategoryRows() {
  const index = readCatalogCategoryIndex();
  return {
    rows: (index.categories || []).map((category) => {
      const name = formatCategoryName(category.name);
      return { ...category, id: category.id || categoryIdentity(name, "source").id, categoryId: category.id || categoryIdentity(name, "source").id, name };
    }),
    index
  };
}

function categoryCoverage(db) {
  const settings = normalizeCategorySettings(db.categorySettings);
  const mainRows = aggregateMainCatalogCategories(db);
  const sourceRows = sourceCatalogCategoryRows().rows;
  const vendorMappings = normalizeVendorCategoryMappings(db.vendorCategoryMappings);
  const mappedMainNames = new Set(settings.map((row) => formatCategoryName(row.name).toLowerCase()).filter(Boolean));
  for (const row of mainRows) mappedMainNames.add(formatCategoryName(row.name).toLowerCase());
  const shopifyMapped = settings.filter((row) => row.mappings?.shopify?.categoryPath || row.mappings?.shopify?.categoryId);
  const shopifyWithTaxonomyId = shopifyMapped.filter((row) => row.mappings?.shopify?.categoryId);
  const products = Array.isArray(db.inventory) ? db.inventory : [];
  const verifiedProducts = products.filter((item) => item.categoryVerified && formatCategoryName(item.category || item.mainCategory));
  const uncategorizedProducts = products.filter((item) => !(item.categoryVerified && formatCategoryName(item.category || item.mainCategory)));
  const activeUncategorizedProducts = uncategorizedProducts.filter((item) => item.active !== false);
  const sourceCategoryNames = new Set(sourceRows.map((row) => formatCategoryName(row.name).toLowerCase()).filter(Boolean));
  const learnedVendorCategoryNames = new Set(Object.values(vendorMappings).map((row) => formatCategoryName(row.vendorCategory).toLowerCase()).filter(Boolean));
  const unmappedMainRows = mainRows.filter((row) => {
    const saved = settings.find((setting) => formatCategoryName(setting.name).toLowerCase() === formatCategoryName(row.name).toLowerCase());
    return !(saved?.mappings?.shopify?.categoryPath || saved?.mappings?.shopify?.categoryId);
  });
  const pathMissingTaxonomy = shopifyMapped.filter((row) => row.mappings?.shopify?.categoryPath && !row.mappings?.shopify?.categoryId);
  return {
    mainCategoryCount: mappedMainNames.size,
    sourceCategoryCount: sourceCategoryNames.size,
    shopifyMappedCount: shopifyMapped.length,
    shopifyTaxonomyIdCount: shopifyWithTaxonomyId.length,
    shopifyMissingCount: unmappedMainRows.length,
    shopifyPathMissingTaxonomyIdCount: pathMissingTaxonomy.length,
    productCount: products.length,
    verifiedProductCount: verifiedProducts.length,
    uncategorizedProductCount: uncategorizedProducts.length,
    activeUncategorizedProductCount: activeUncategorizedProducts.length,
    vendorCategoryMappingCount: Object.keys(vendorMappings).length,
    sourceVendorCategoryMappedCount: [...learnedVendorCategoryNames].filter((name) => sourceCategoryNames.has(name)).length,
    attention: [
      { key: "missing-shopify", label: "Main categories missing Shopify mapping", count: unmappedMainRows.length, sample: unmappedMainRows.slice(0, 5).map((row) => row.name) },
      { key: "missing-taxonomy-id", label: "Shopify paths missing taxonomy ID", count: pathMissingTaxonomy.length, sample: pathMissingTaxonomy.slice(0, 5).map((row) => row.name) },
      { key: "uncategorized-products", label: "Products missing verified Main category", count: uncategorizedProducts.length, sample: uncategorizedProducts.slice(0, 5).map((item) => item.sku || item.title).filter(Boolean) }
    ]
  };
}

function categoryCoverageRows(db, issue) {
  const settings = normalizeCategorySettings(db.categorySettings);
  const mainRows = aggregateMainCatalogCategories(db);
  const vendorMappings = normalizeVendorCategoryMappings(db.vendorCategoryMappings);
  const settingForName = (name) => settings.find((row) => formatCategoryName(row.name).toLowerCase() === formatCategoryName(name).toLowerCase());
  if (issue === "missing-shopify") {
    return mainRows
      .map((row) => ({ row, setting: settingForName(row.name) }))
      .filter(({ setting }) => !(setting?.mappings?.shopify?.categoryPath || setting?.mappings?.shopify?.categoryId))
      .map(({ row }) => ({
        category: row.name,
        products: row.productCount || 0,
        active_products: row.activeProductCount || 0,
        issue: "Missing Shopify category mapping",
        current_shopify_category: ""
      }));
  }
  if (issue === "missing-taxonomy-id") {
    return settings
      .filter((row) => row.mappings?.shopify?.categoryPath && !row.mappings?.shopify?.categoryId)
      .map((row) => ({
        category: row.name,
        shopify_category: row.mappings.shopify.categoryPath || "",
        shopify_category_id: "",
        issue: "Shopify category path did not match a taxonomy ID"
      }));
  }
  if (issue === "uncategorized-products") {
    return (db.inventory || [])
      .filter((item) => !(item.categoryVerified && formatCategoryName(item.category || item.mainCategory)))
      .map((item) => ({
        sku: item.sku || "",
        title: item.marketplaceTitle || item.title || "",
        supplier: item.supplier || item.vendor || "",
        vendor_category: item.sourceCategory || item.vendorCategory || "",
        current_main_category: item.category || item.mainCategory || "",
        active: item.active !== false ? "true" : "false"
      }));
  }
  if (issue === "vendor-category-mappings") {
    return Object.values(vendorMappings)
      .sort((a, b) => String(a.supplier).localeCompare(String(b.supplier)) || String(a.vendorCategory).localeCompare(String(b.vendorCategory)))
      .map((row) => ({
        supplier: row.supplier || "",
        vendor_category: row.vendorCategory || "",
        main_category: row.mainCategory || "",
        sample_sku: row.sampleSku || "",
        match_count: row.matchCount || 0,
        conflict_count: row.conflictCount || 0,
        updated_at: row.updatedAt || ""
      }));
  }
  return [];
}

function coverageIssueLabel(issue) {
  return {
    "missing-shopify": "missing-shopify-mappings",
    "missing-taxonomy-id": "shopify-paths-missing-taxonomy-id",
    "uncategorized-products": "uncategorized-products",
    "vendor-category-mappings": "vendor-category-mappings"
  }[issue] || "category-coverage";
}

function rowsToCsv(rows = []) {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))]
    .map((row) => row.map(escapeCsv).join(","))
    .join("\n");
}

const IMPORT_ERROR_COLUMNS = ["row", "record_key", "field", "issue", "raw_value", "sku", "category", "supplier", "details"];

function csvRecordRow(record, fallback = "") {
  return record?.__rowNumber || fallback || "";
}

function standardImportError(attrs = {}) {
  const row = {
    row: attrs.row ?? csvRecordRow(attrs.record),
    record_key: attrs.recordKey ?? attrs.key ?? attrs.sku ?? attrs.category ?? "",
    field: attrs.field || "",
    issue: attrs.issue || attrs.error || "Import issue",
    raw_value: attrs.rawValue ?? attrs.raw_value ?? "",
    sku: attrs.sku || "",
    category: attrs.category || "",
    supplier: attrs.supplier || "",
    details: attrs.details || ""
  };
  for (const [key, value] of Object.entries(attrs)) {
    if (row[key] === undefined && !["record", "key", "error", "rawValue", "raw_value"].includes(key)) row[key] = value ?? "";
  }
  return row;
}

function importErrorMessages(rows = []) {
  return rows.map((row) => {
    const normalized = standardImportError(row);
    const target = normalized.record_key || normalized.sku || normalized.category || normalized.field;
    return `${normalized.issue}${target ? `: ${target}` : ""}${normalized.row ? ` (row ${normalized.row})` : ""}`;
  }).slice(0, 50);
}

function publicCategories(db, query = "", scope = "source") {
  const settings = categorySettingsMap(db);
  const q = String(query || "").trim().toLowerCase();
  const normalizedScope = scope === "main" ? "main" : "source";
  const source = normalizedScope === "main"
    ? { rows: aggregateMainCatalogCategories(db), index: { generatedAt: "", catalogImportedAt: "" } }
    : sourceCatalogCategoryRows();
  const rows = source.rows.map((category) => publicCategoryRow(category, settings, normalizedScope)).filter((category) => !q || `${category.name} ${category.status} ${category.notes} ${(category.topVendors || []).map((v) => v.name).join(" ")}`.toLowerCase().includes(q));
  return {
    categories: rows,
    total: rows.length,
    scope: normalizedScope,
    coverage: categoryCoverage(db),
    indexGeneratedAt: source.index.generatedAt || "",
    catalogImportedAt: source.index.catalogImportedAt || ""
  };
}

function findPublicCategory(db, categoryId, scope = "source") {
  const categories = publicCategories(db, "", scope).categories;
  return categories.find((category) => category.id === categoryId || category.categoryId === categoryId);
}

function normalizeOrderTimeline(order) {
  const events = Array.isArray(order.timeline) ? order.timeline : [];
  if (!events.some((event) => event.type === "created")) {
    events.unshift({
      id: crypto.randomUUID(),
      type: "created",
      title: "Order created",
      message: `${order.source} order imported into DataPlus.`,
      user: "System",
      createdAt: order.createdAt || new Date().toISOString()
    });
  }
  if (order.notes && !events.some((event) => event.type === "note" && event.message === order.notes)) {
    events.push({
      id: crypto.randomUUID(),
      type: "note",
      title: "Initial note",
      message: order.notes,
      user: "System",
      createdAt: order.updatedAt || order.createdAt || new Date().toISOString()
    });
  }
  return events.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
}

function addOrderTimeline(order, event) {
  order.timeline = normalizeOrderTimeline(order);
  order.timeline.push({
    id: crypto.randomUUID(),
    user: "Luis",
    createdAt: new Date().toISOString(),
    ...event
  });
  order.timeline.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
}

function addInventoryLedger(db, item, event = {}) {
  db.inventoryLedger = Array.isArray(db.inventoryLedger) ? db.inventoryLedger : [];
  const qtyBefore = Number(event.qtyBefore ?? item.qty ?? 0);
  const qtyAfter = Number(event.qtyAfter ?? item.qty ?? 0);
  const reservedBefore = Number(event.reservedBefore ?? item.reserved ?? 0);
  const reservedAfter = Number(event.reservedAfter ?? item.reserved ?? 0);
  const quantityChange = Number(event.quantityChange ?? (qtyAfter - qtyBefore));
  const reservedChange = Number(event.reservedChange ?? (reservedAfter - reservedBefore));
  db.inventoryLedger.unshift({
    id: crypto.randomUUID(),
    productId: item.id,
    sku: item.sku,
    title: item.title || item.marketplaceTitle || "",
    type: event.type || "adjustment",
    source: event.source || "manual",
    referenceId: event.referenceId || "",
    referenceNumber: event.referenceNumber || "",
    warehouseId: event.warehouseId || "",
    warehouseName: event.warehouseName || "",
    locationBin: event.locationBin || "",
    quantityChange,
    reservedChange,
    qtyBefore,
    qtyAfter,
    reservedBefore,
    reservedAfter,
    reason: event.reason || "",
    serials: Array.isArray(event.serials) ? event.serials : [],
    user: event.user || "Luis",
    createdAt: new Date().toISOString()
  });
}

function cleanSerialPart(value) {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase() || "NA";
}

function generatedSerial(po, vendor, receivedAt, unitIndex = 1) {
  const base = `${cleanSerialPart(po.poNumber)}-${cleanSerialPart(vendor?.vendorNumber || po.supplier)}-${cleanSerialPart(receivedAt)}`;
  return unitIndex > 1 ? `${base}-${String(unitIndex).padStart(3, "0")}` : base;
}

function generatedReceiptSerial(po, vendor, receivedAt, sku, unitIndex = 1) {
  const base = `${cleanSerialPart(po.poNumber)}-${cleanSerialPart(vendor?.vendorNumber || po.supplier)}-${cleanSerialPart(sku)}-${cleanSerialPart(receivedAt)}`;
  return `${base}-${String(unitIndex).padStart(3, "0")}`;
}

function findOpenPurchaseOrderLinks(db, orderIds = []) {
  const ids = new Set(orderIds.filter(Boolean));
  const duplicates = [];
  for (const order of (db.orders || []).filter((row) => ids.has(row.id))) {
    const poIds = Array.isArray(order.purchaseOrderIds) ? order.purchaseOrderIds : [];
    for (const poId of poIds) {
      const po = (db.purchaseOrders || []).find((row) => row.id === poId);
      if (po && !["closed", "canceled"].includes(String(po.status || "").toLowerCase())) {
        duplicates.push({
          orderId: order.id,
          orderNumber: order.orderNumber,
          poId: po.id,
          poNumber: po.poNumber,
          status: po.status
        });
      }
    }
  }
  return duplicates;
}

function createPurchaseOrderFromOrders(db, orderIds, options = {}) {
  const ids = [...new Set((orderIds || []).filter(Boolean))];
  if (!ids.length) throw new Error("At least one order is required to create a purchase order.");
  const duplicates = options.forceDuplicate ? [] : findOpenPurchaseOrderLinks(db, ids);
  if (duplicates.length) {
    const error = new Error("One or more selected orders already has an open purchase order.");
    error.code = "DUPLICATE_OPEN_PO";
    error.duplicates = duplicates;
    throw error;
  }
  const orders = ids.map((id) => db.orders.find((order) => order.id === id)).filter(Boolean);
  if (!orders.length) throw new Error("No matching orders found for purchase order.");

  const itemMap = new Map();
  for (const order of orders) {
    const items = order.items?.length ? order.items : [{ sku: order.sku, title: order.title, qty: order.qty, price: order.productCost || 0 }];
    for (const item of items) {
      const sku = item.sku || "UNKNOWN";
      const existing = itemMap.get(sku) || {
        sku,
        title: item.title || order.title || sku,
        qty: 0,
        estimatedUnitCost: Number(order.productCost || 0) / Math.max(1, Number(order.qty || 1)),
        orderNumbers: []
      };
      existing.qty += Number(item.qty || 0);
      if (!existing.orderNumbers.includes(order.orderNumber)) existing.orderNumbers.push(order.orderNumber);
      itemMap.set(sku, existing);
    }
  }

  const vendor = options.vendorId ? findVendorById(db, options.vendorId) : findVendorByName(db, options.supplier) || preferredVendorForOrders(db, orders) || findVendorByName(db, "Local Wholesale");
  const warehouse = (db.warehouses || []).find((item) => item.id === options.warehouseId) || (db.warehouses || [])[0] || null;
  const po = {
    id: crypto.randomUUID(),
    poNumber: nextPoNumber(db),
    status: "draft",
    vendorId: vendor?.id || "",
    supplier: vendor?.name || options.supplier || "Unassigned supplier",
    warehouseId: warehouse?.id || "",
    warehouseName: warehouse?.name || "",
    source: orders.length > 1 ? "master-order-selection" : "order",
    orderIds: orders.map((order) => order.id),
    orderNumbers: orders.map((order) => order.orderNumber),
    items: Array.from(itemMap.values()),
    totalUnits: Array.from(itemMap.values()).reduce((sum, item) => sum + Number(item.qty || 0), 0),
    estimatedCost: orders.reduce((sum, order) => sum + Number(order.productCost || 0), 0),
    notes: options.notes || "",
    createdBy: options.user || "Luis",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeline: [
      {
        id: crypto.randomUUID(),
        type: "created",
        title: "PO created",
        message: `Created from ${orders.length} order${orders.length === 1 ? "" : "s"}.`,
        user: options.user || "Luis",
        createdAt: new Date().toISOString()
      }
    ],
    returns: []
  };

  db.purchaseOrders = db.purchaseOrders || [];
  db.purchaseOrders.unshift(po);

  for (const order of orders) {
    order.purchaseOrderIds = Array.isArray(order.purchaseOrderIds) ? order.purchaseOrderIds : [];
    order.purchaseOrderNumbers = Array.isArray(order.purchaseOrderNumbers) ? order.purchaseOrderNumbers : [];
    if (!order.purchaseOrderIds.includes(po.id)) order.purchaseOrderIds.push(po.id);
    if (!order.purchaseOrderNumbers.includes(po.poNumber)) order.purchaseOrderNumbers.push(po.poNumber);
    addOrderTimeline(order, {
      type: "po",
      title: "Purchase order created",
      message: `${po.poNumber} created for ${orders.length > 1 ? "selected orders" : "this order"}.`,
      user: po.createdBy
    });
  }

  return po;
}

function nextDraftNumber(db) {
  db.sequence = db.sequence || {};
  db.sequence.draft = Number(db.sequence.draft || 0) + 1;
  return `DRF-${String(db.sequence.draft).padStart(5, "0")}`;
}

function nextDraftRevisionNumber(db, quoteGroupId) {
  const group = String(quoteGroupId || "").trim();
  if (!group) return 1;
  return ((db.orderDrafts || [])
    .filter((row) => String(row.quoteGroupId || "").trim() === group)
    .reduce((max, row) => Math.max(max, Number(row.revisionNumber || 1)), 0)) + 1;
}

function nextReturnNumber(db) {
  db.sequence = db.sequence || {};
  db.sequence.return = Number(db.sequence.return || 0) + 1;
  return `RET-${String(db.sequence.return).padStart(5, "0")}`;
}

function nextOrderNumber(db) {
  db.sequence = db.sequence || {};
  db.sequence.order = Number(db.sequence.order || 1000) + 1;
  return `${ORDER_PREFIX}-${String(db.sequence.order).padStart(6, "0")}`;
}

function nextPoNumber(db) {
  db.sequence = db.sequence || {};
  db.sequence.po = Number(db.sequence.po || 2000) + 1;
  return `PO-${String(db.sequence.po).padStart(6, "0")}`;
}

function nextVendorNumber(db) {
  db.sequence = db.sequence || {};
  db.sequence.vendor = Number(db.sequence.vendor || 3000) + 1;
  return `VEN-${String(db.sequence.vendor).padStart(5, "0")}`;
}

function nextWarehouseCode(db) {
  db.sequence = db.sequence || {};
  db.sequence.warehouse = Number(db.sequence.warehouse || 0) + 1;
  return `WH-${String(db.sequence.warehouse).padStart(3, "0")}`;
}

function nextCustomerNumber(db) {
  db.sequence = db.sequence || {};
  db.sequence.customer = Number(db.sequence.customer || (db.customers || []).length) + 1;
  return `CUS-${String(db.sequence.customer).padStart(5, "0")}`;
}

function seedVendors() {
  const now = new Date().toISOString();
  return [
    {
      id: crypto.randomUUID(),
      vendorNumber: "VEN-03001",
      name: "Local Wholesale",
      status: "active",
      type: "Wholesaler",
      contactName: "Purchasing Desk",
      email: "orders@localwholesale.example",
      phone: "(555) 013-3001",
      website: "",
      paymentTerms: "Net 15",
      leadTimeDays: 7,
      moq: 12,
      address: { line1: "220 Supply Ave", line2: "", city: "Orlando", state: "FL", postalCode: "32801", country: "US" },
      categories: ["Home & Kitchen"],
      notes: "Default home goods supplier.",
      rating: 4.6,
      createdAt: now,
      updatedAt: now
    },
    {
      id: crypto.randomUUID(),
      vendorNumber: "VEN-03002",
      name: "Beauty Supply Lot",
      status: "active",
      type: "Distributor",
      contactName: "Account Support",
      email: "support@beautysupplylot.example",
      phone: "(555) 013-3002",
      website: "",
      paymentTerms: "Prepaid",
      leadTimeDays: 5,
      moq: 24,
      address: { line1: "48 Commerce Park", line2: "", city: "Miami", state: "FL", postalCode: "33130", country: "US" },
      categories: ["Beauty & Personal Care"],
      notes: "Use for makeup organizer replenishment.",
      rating: 4.3,
      createdAt: now,
      updatedAt: now
    },
    {
      id: crypto.randomUUID(),
      vendorNumber: "VEN-03003",
      name: "Electronics Supplier",
      status: "active",
      type: "Importer",
      contactName: "Ops Team",
      email: "ops@electronicssupplier.example",
      phone: "(555) 013-3003",
      website: "",
      paymentTerms: "Net 30",
      leadTimeDays: 10,
      moq: 10,
      address: { line1: "900 Tech Row", line2: "", city: "Austin", state: "TX", postalCode: "78701", country: "US" },
      categories: ["Electronics"],
      notes: "Validate cable specs before PO approval.",
      rating: 4.1,
      createdAt: now,
      updatedAt: now
    }
  ];
}

function seedWarehouses() {
  const now = new Date().toISOString();
  return [
    {
      id: crypto.randomUUID(),
      code: "WH-001",
      name: "NJ Main Warehouse",
      status: "active",
      warehouseType: "Distribution Center",
      contactName: "Receiving Team",
      managerName: "Ava Morales",
      phone: "(555) 013-4001",
      email: "nj.receiving@dataplus.example",
      timezone: "America/New_York",
      operatingHours: "Mon-Fri 8:00 AM - 5:00 PM",
      carrierCutoffTime: "3:00 PM",
      receivingInstructions: "Schedule pallet deliveries 24 hours in advance. Small parcel may arrive same day.",
      addressLine1: "1200 Commerce Dr",
      addressLine2: "",
      city: "Newark",
      state: "NJ",
      postalCode: "07102",
      country: "US",
      isDefaultReceiving: true,
      isDefaultReturns: true,
      requireAppointment: true,
      allowBlindReceipts: false,
      requireSerialScan: true,
      requirePhotoForDamage: true,
      autoRouteReturns: true,
      bins: [
        { id: crypto.randomUUID(), code: "NJ-REC", name: "Receiving Dock", type: "Receiving", isDefault: true, active: true, notes: "Default receiving bin" },
        { id: crypto.randomUUID(), code: "NJ-RTN", name: "Returns Inspection", type: "Returns", isDefault: false, active: true, notes: "Inspect returned units here" }
      ],
      notes: "Primary east coast receiving location.",
      createdAt: now,
      updatedAt: now
    },
    {
      id: crypto.randomUUID(),
      code: "WH-002",
      name: "FL Overflow Warehouse",
      status: "active",
      warehouseType: "Overflow Storage",
      contactName: "Warehouse Ops",
      managerName: "Daniel Ruiz",
      phone: "(555) 013-4002",
      email: "fl.ops@dataplus.example",
      timezone: "America/New_York",
      operatingHours: "Mon-Sat 7:00 AM - 4:00 PM",
      carrierCutoffTime: "2:30 PM",
      receivingInstructions: "Use dock door 4 for returns and overflow receipts.",
      addressLine1: "88 Distribution Way",
      addressLine2: "",
      city: "Orlando",
      state: "FL",
      postalCode: "32824",
      country: "US",
      isDefaultReceiving: false,
      isDefaultReturns: false,
      requireAppointment: false,
      allowBlindReceipts: true,
      requireSerialScan: false,
      requirePhotoForDamage: true,
      autoRouteReturns: false,
      bins: [
        { id: crypto.randomUUID(), code: "FL-OVR", name: "Overflow Floor", type: "Storage", isDefault: true, active: true, notes: "Overflow storage area" },
        { id: crypto.randomUUID(), code: "FL-RTN", name: "Return Hold", type: "Returns", isDefault: false, active: true, notes: "Hold returned units pending inspection" }
      ],
      notes: "Used for overflow inventory and returns inspection.",
      createdAt: now,
      updatedAt: now
    }
  ];
}

function normalizeWarehouseBin(bin, index = 0) {
  return {
    id: bin.id || crypto.randomUUID(),
    code: String(bin.code || `BIN-${String(index + 1).padStart(2, "0")}`).trim(),
    name: String(bin.name || bin.code || `Location ${index + 1}`).trim(),
    type: String(bin.type || "Storage").trim(),
    isDefault: Boolean(bin.isDefault),
    active: bin.active === undefined ? true : Boolean(bin.active),
    notes: String(bin.notes || "").trim()
  };
}

function normalizeWarehouseStockRow(row = {}, warehouse, item) {
  return {
    warehouseId: row.warehouseId || warehouse?.id || "",
    warehouseName: row.warehouseName || warehouse?.name || "Unassigned",
    locationBin: String(row.locationBin || "").trim(),
    qty: Number(row.qty || 0),
    reserved: Number(row.reserved || 0),
    reorderPoint: Number(row.reorderPoint || 0),
    updatedAt: row.updatedAt || item?.updatedAt || new Date().toISOString()
  };
}

function syncInventoryTotalsFromWarehouses(item) {
  const rows = Array.isArray(item.warehouseStock) ? item.warehouseStock : [];
  item.qty = rows.reduce((sum, row) => sum + Number(row.qty || 0), 0);
  item.reserved = rows.reduce((sum, row) => sum + Number(row.reserved || 0), 0);
  item.reorderPoint = rows.reduce((sum, row) => sum + Number(row.reorderPoint || 0), 0);
  return item;
}

function formatWarehouseAddress(warehouse) {
  const parts = [
    warehouse.addressLine1,
    warehouse.addressLine2,
    [warehouse.city, warehouse.state, warehouse.postalCode].filter(Boolean).join(", ").replace(", ,", ","),
    warehouse.country
  ].map((value) => String(value || "").trim()).filter(Boolean);
  return parts.join(" | ");
}

function normalizeWarehouse(warehouse) {
  const legacyAddressLine = String(warehouse.addressLine || "").trim();
  const normalized = {
    id: warehouse.id || crypto.randomUUID(),
    code: warehouse.code || "",
    name: warehouse.name || "Unnamed warehouse",
    status: warehouse.status || "active",
    warehouseType: warehouse.warehouseType || warehouse.type || "Warehouse",
    contactName: warehouse.contactName || "",
    managerName: warehouse.managerName || "",
    phone: warehouse.phone || "",
    email: warehouse.email || "",
    timezone: warehouse.timezone || "America/New_York",
    operatingHours: warehouse.operatingHours || "",
    carrierCutoffTime: warehouse.carrierCutoffTime || "",
    receivingInstructions: warehouse.receivingInstructions || "",
    addressLine1: warehouse.addressLine1 || warehouse.address?.line1 || warehouse.addressLine || "",
    addressLine2: warehouse.addressLine2 || warehouse.address?.line2 || "",
    city: warehouse.city || warehouse.address?.city || "",
    state: warehouse.state || warehouse.address?.state || "",
    postalCode: warehouse.postalCode || warehouse.address?.postalCode || "",
    country: warehouse.country || warehouse.address?.country || "US",
    isDefaultReceiving: Boolean(warehouse.isDefaultReceiving),
    isDefaultReturns: Boolean(warehouse.isDefaultReturns),
    requireAppointment: warehouse.requireAppointment === undefined ? false : Boolean(warehouse.requireAppointment),
    allowBlindReceipts: warehouse.allowBlindReceipts === undefined ? true : Boolean(warehouse.allowBlindReceipts),
    requireSerialScan: warehouse.requireSerialScan === undefined ? false : Boolean(warehouse.requireSerialScan),
    requirePhotoForDamage: warehouse.requirePhotoForDamage === undefined ? false : Boolean(warehouse.requirePhotoForDamage),
    autoRouteReturns: warehouse.autoRouteReturns === undefined ? false : Boolean(warehouse.autoRouteReturns),
    bins: Array.isArray(warehouse.bins) ? warehouse.bins.map((bin, index) => normalizeWarehouseBin(bin, index)) : [],
    notes: warehouse.notes || "",
    createdAt: warehouse.createdAt || new Date().toISOString(),
    updatedAt: warehouse.updatedAt || warehouse.createdAt || new Date().toISOString()
  };
  if (!normalized.city && !normalized.state && legacyAddressLine.includes(",")) {
    normalized.addressLine1 = legacyAddressLine;
  }
  if (!normalized.bins.some((bin) => bin.isDefault) && normalized.bins.length) normalized.bins[0].isDefault = true;
  normalized.addressLine = formatWarehouseAddress(normalized);
  return normalized;
}

function normalizeVendor(db, vendor) {
  const createdAt = vendor.createdAt || new Date().toISOString();
  const changeLog = Array.isArray(vendor.changeLog) && vendor.changeLog.length ? vendor.changeLog : [
    {
      id: crypto.randomUUID(),
      type: "created",
      title: "Vendor profile created",
      message: `${vendor.name || "Vendor"} added to DataPlus.`,
      user: "System",
      createdAt
    }
  ];
  return {
    id: vendor.id || crypto.randomUUID(),
    vendorNumber: vendor.vendorNumber || nextVendorNumber(db),
    name: vendor.name || "Unnamed vendor",
    status: vendor.status || "active",
    type: vendor.type || "Supplier",
    contactName: vendor.contactName || "",
    email: vendor.email || "",
    phone: vendor.phone || "",
    website: vendor.website || "",
    paymentTerms: vendor.paymentTerms || "TBD",
    leadTimeDays: Number(vendor.leadTimeDays || 0),
    moq: Number(vendor.moq || 0),
    address: vendor.address || { line1: "", line2: "", city: "", state: "", postalCode: "", country: "US" },
    categories: Array.isArray(vendor.categories) ? vendor.categories : [],
    notes: vendor.notes || "",
    rating: Number(vendor.rating || 0),
    fileFeeds: {
      priceUpdates: Array.isArray(vendor.fileFeeds?.priceUpdates) ? vendor.fileFeeds.priceUpdates : [],
      inventory: Array.isArray(vendor.fileFeeds?.inventory) ? vendor.fileFeeds.inventory : [],
      productCatalog: Array.isArray(vendor.fileFeeds?.productCatalog) ? vendor.fileFeeds.productCatalog : [],
      attachments: Array.isArray(vendor.fileFeeds?.attachments) ? vendor.fileFeeds.attachments : []
    },
    submissionSettings: {
      preferredMethod: vendor.submissionSettings?.preferredMethod || "email",
      apiEnabled: Boolean(vendor.submissionSettings?.apiEnabled),
      apiBaseUrl: vendor.submissionSettings?.apiBaseUrl || "",
      apiAuthType: vendor.submissionSettings?.apiAuthType || "API key",
      apiKeyReference: vendor.submissionSettings?.apiKeyReference || "",
      ftpEnabled: Boolean(vendor.submissionSettings?.ftpEnabled),
      ftpHost: vendor.submissionSettings?.ftpHost || "",
      ftpPort: vendor.submissionSettings?.ftpPort || "22",
      ftpUsername: vendor.submissionSettings?.ftpUsername || "",
      ftpPath: vendor.submissionSettings?.ftpPath || "/incoming/po",
      emailEnabled: vendor.submissionSettings?.emailEnabled !== false,
      emailTo: vendor.submissionSettings?.emailTo || vendor.email || "",
      emailCc: vendor.submissionSettings?.emailCc || "",
      emailSubjectTemplate: vendor.submissionSettings?.emailSubjectTemplate || "Purchase order {{poNumber}}",
      attachCsv: vendor.submissionSettings?.attachCsv !== false,
      attachPdf: vendor.submissionSettings?.attachPdf !== false
    },
    openPOs: Number(vendor.openPOs || 0),
    totalPOs: Number(vendor.totalPOs || 0),
    totalSpend: Number(vendor.totalSpend || 0),
    lastPOAt: vendor.lastPOAt || "",
    catalogStats: vendor.catalogStats && typeof vendor.catalogStats === "object" ? vendor.catalogStats : {},
    changeLog,
    createdAt,
    updatedAt: vendor.updatedAt || createdAt
  };
}

function findVendorById(db, id) {
  return (db.vendors || []).find((vendor) => vendor.id === id);
}

function addVendorChange(vendor, event) {
  vendor.changeLog = Array.isArray(vendor.changeLog) ? vendor.changeLog : [];
  vendor.changeLog.push({
    id: crypto.randomUUID(),
    type: "edited",
    title: "Vendor updated",
    message: "",
    user: "Luis",
    createdAt: new Date().toISOString(),
    ...event
  });
  vendor.updatedAt = new Date().toISOString();
}

function addPoSubmission(po, event) {
  po.submissionHistory = Array.isArray(po.submissionHistory) ? po.submissionHistory : [];
  po.submissionHistory.push({
    id: crypto.randomUUID(),
    method: event.method || "manual",
    status: event.status || "queued",
    message: event.message || "",
    user: event.user || "Luis",
    createdAt: new Date().toISOString()
  });
  po.status = event.poStatus || po.status || "draft";
  po.submittedAt = new Date().toISOString();
  po.updatedAt = new Date().toISOString();
}

function addPoTimeline(po, event) {
  po.timeline = Array.isArray(po.timeline) ? po.timeline : [];
  po.timeline.push({
    id: crypto.randomUUID(),
    type: "status",
    title: "PO updated",
    message: "",
    user: "Luis",
    createdAt: new Date().toISOString(),
    ...event
  });
  po.updatedAt = new Date().toISOString();
}

function normalizeBrands(db) {
  let changed = false;
  const existing = new Map();
  for (const brand of db.brands || []) {
    const formatted = formatBrandName(brand.name);
    if (!formatted) continue;
    const key = formatted.toLowerCase();
    if (existing.has(key)) {
      const current = existing.get(key);
      current.vendorIds = [...new Set([...(current.vendorIds || []), ...(brand.vendorIds || [])])];
      current.notes = current.notes || brand.notes || "";
      changed = true;
    } else {
      existing.set(key, { ...brand, name: formatted });
      if (brand.name !== formatted) changed = true;
    }
  }
  for (const item of db.inventory || []) {
    const name = formatBrandName(item.brand || "");
    if (!name) continue;
    if (item.brand !== name) {
      item.brand = name;
      changed = true;
    }
    const key = name.toLowerCase();
    if (!existing.has(key)) {
      const vendor = findVendorByName(db, item.vendor);
      existing.set(key, {
        id: crypto.randomUUID(),
        name,
        status: "active",
      vendorIds: vendor ? [vendor.id] : [],
      preferredVendorId: vendor?.id || "",
      logoUrl: "",
      logoDataUrl: "",
      category: item.category || "",
      website: "",
      mapPolicy: "",
      warranty: "",
      leadTimeNotes: "",
      notes: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      changed = true;
    }
  }
  db.brands = Array.from(existing.values()).map((brand) => {
    const vendorIds = Array.isArray(brand.vendorIds) ? brand.vendorIds.filter((id) => findVendorById(db, id)) : [];
    const preferredVendorId = findVendorById(db, brand.preferredVendorId) ? brand.preferredVendorId : vendorIds[0] || "";
    return {
      id: brand.id || crypto.randomUUID(),
      name: brand.name || "Unnamed brand",
      status: brand.status || "active",
      vendorIds,
      preferredVendorId,
      logoUrl: brand.logoUrl || "",
      logoDataUrl: brand.logoDataUrl || "",
      category: brand.category || "",
      website: brand.website || "",
      mapPolicy: brand.mapPolicy || "",
      warranty: brand.warranty || "",
      leadTimeNotes: brand.leadTimeNotes || "",
      notes: brand.notes || "",
      createdAt: brand.createdAt || new Date().toISOString(),
      updatedAt: brand.updatedAt || brand.createdAt || new Date().toISOString()
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { changed };
}

function findBrandByName(db, name) {
  const target = String(name || "").trim().toLowerCase();
  return (db.brands || []).find((brand) => brand.name.toLowerCase() === target);
}

function brandForOrder(db, order) {
  const sku = order.items?.[0]?.sku || order.sku;
  const product = (db.inventory || []).find((item) => item.sku === sku);
  return order.brand || product?.brand || "";
}

function preferredVendorForOrders(db, orders) {
  for (const order of orders) {
    const brand = findBrandByName(db, brandForOrder(db, order));
    const preferred = brand?.preferredVendorId ? findVendorById(db, brand.preferredVendorId) : null;
    if (preferred) return preferred;
  }
  return null;
}

function findVendorByName(db, name) {
  const target = String(name || "").toLowerCase();
  return (db.vendors || []).find((vendor) => vendor.name.toLowerCase() === target);
}

function customerKeyFrom(order) {
  const email = String(order.buyerEmail || "").trim().toLowerCase();
  if (email) return `email:${email}`;
  const phone = String(order.phone || "").replace(/\D/g, "");
  if (phone) return `phone:${phone}`;
  const address = order.address || {};
  return `name:${String(order.buyer || address.name || "unknown").trim().toLowerCase()}|zip:${String(address.postalCode || "").trim().toLowerCase()}`;
}

function normalizeCustomers(db) {
  let changed = false;
  const customerMap = new Map();

  for (const customer of db.customers || []) {
    customer.identities = customer.identities || [];
    customer.marketplaceAccounts = customer.marketplaceAccounts || [];
    customerMap.set(customer.matchKey || customerKeyFrom(customer), customer);
  }

  for (const order of db.orders || []) {
    const key = customerKeyFrom(order);
    let customer = customerMap.get(key);
    if (!customer) {
      customer = {
        id: crypto.randomUUID(),
        customerNumber: `CUS-${String(customerMap.size + 1).padStart(5, "0")}`,
        name: order.buyer || order.address?.name || "Unknown customer",
        email: order.buyerEmail || "",
        phone: order.phone || "",
        matchKey: key,
        identities: [],
        marketplaceAccounts: [],
        firstOrderAt: order.createdAt,
        lastOrderAt: order.createdAt,
        totalOrders: 0,
        lifetimeValue: 0,
        repeatCustomer: false,
        company: "",
        customerType: "Retail",
        status: "active",
        preferredChannel: "Email",
        taxExempt: false,
        marketingOptIn: false,
        tags: [],
        defaultAddress: order.address || {},
        billingAddress: {},
        shippingAddresses: order.address ? [{ ...order.address, label: "Primary shipping", isDefault: true }] : [],
        billingAddresses: [],
        notes: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      customerMap.set(key, customer);
      changed = true;
    }

    customer.name = customer.name || order.buyer || order.address?.name || "Unknown customer";
    customer.email = customer.email || order.buyerEmail || "";
    customer.phone = customer.phone || order.phone || "";
    customer.company = customer.company || "";
    customer.customerType = customer.customerType || "Retail";
    customer.status = customer.status || "active";
    customer.preferredChannel = customer.preferredChannel || "Email";
    customer.taxExempt = Boolean(customer.taxExempt);
    customer.marketingOptIn = Boolean(customer.marketingOptIn);
    customer.tags = Array.isArray(customer.tags) ? customer.tags : [];
    customer.billingAddress = customer.billingAddress || {};
    customer.defaultAddress = customer.defaultAddress?.line1 ? customer.defaultAddress : order.address || {};
    normalizeCustomerLists(customer);
    customer.identities = addUniqueIdentity(customer.identities, { type: "email", value: order.buyerEmail });
    customer.identities = addUniqueIdentity(customer.identities, { type: "phone", value: order.phone });
    customer.marketplaceAccounts = addUniqueIdentity(customer.marketplaceAccounts, { type: order.source, value: order.marketplaceOrderNumber || order.marketplaceOrderId });
    order.customerId = customer.id;
    order.customerNumber = customer.customerNumber;
  }

  const ordersByCustomer = new Map();
  for (const order of db.orders || []) {
    if (!order.customerId) continue;
    const orders = ordersByCustomer.get(order.customerId) || [];
    orders.push(order);
    ordersByCustomer.set(order.customerId, orders);
  }

  for (const customer of customerMap.values()) {
    normalizeCustomerLists(customer);
    const orders = ordersByCustomer.get(customer.id) || [];
    const sorted = orders.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    customer.totalOrders = orders.length;
    customer.lifetimeValue = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
    customer.firstOrderAt = sorted[0]?.createdAt || customer.firstOrderAt;
    customer.lastOrderAt = sorted[sorted.length - 1]?.createdAt || customer.lastOrderAt;
    customer.repeatCustomer = orders.length > 1;
    customer.updatedAt = new Date().toISOString();
  }

  db.customers = Array.from(customerMap.values()).sort((a, b) => new Date(b.lastOrderAt || 0) - new Date(a.lastOrderAt || 0));
  return { changed };
}

function addUniqueIdentity(list, identity) {
  if (!identity.value) return list || [];
  const next = list || [];
  const exists = next.some((item) => String(item.type).toLowerCase() === String(identity.type).toLowerCase() && String(item.value).toLowerCase() === String(identity.value).toLowerCase());
  if (!exists) next.push({ type: identity.type, value: String(identity.value) });
  return next;
}

function normalizeAddress(address = {}, type = "shipping") {
  return {
    id: address.id || crypto.randomUUID(),
    label: address.label || (type === "billing" ? "Billing" : "Shipping"),
    name: address.name || "",
    company: address.company || "",
    line1: address.line1 || "",
    line2: address.line2 || "",
    city: address.city || "",
    state: address.state || "",
    postalCode: address.postalCode || "",
    country: address.country || "US",
    phone: address.phone || "",
    isDefault: Boolean(address.isDefault)
  };
}

function normalizeCustomerLists(customer) {
  const createdAt = customer.createdAt || new Date().toISOString();
  customer.shippingAddresses = Array.isArray(customer.shippingAddresses) ? customer.shippingAddresses : [];
  customer.billingAddresses = Array.isArray(customer.billingAddresses) ? customer.billingAddresses : [];
  if (!customer.shippingAddresses.length && customer.defaultAddress && Object.keys(customer.defaultAddress).length) {
    customer.shippingAddresses.push({ ...customer.defaultAddress, label: "Primary shipping", isDefault: true });
  }
  if (!customer.billingAddresses.length && customer.billingAddress && Object.keys(customer.billingAddress).length) {
    customer.billingAddresses.push({ ...customer.billingAddress, label: "Primary billing", isDefault: true });
  }
  customer.shippingAddresses = customer.shippingAddresses.map((address, index) => normalizeAddress({ ...address, isDefault: index === 0 ? true : address.isDefault }, "shipping"));
  customer.billingAddresses = customer.billingAddresses.map((address, index) => normalizeAddress({ ...address, isDefault: index === 0 ? true : address.isDefault }, "billing"));
  customer.defaultAddress = customer.shippingAddresses[0] || customer.defaultAddress || {};
  customer.billingAddress = customer.billingAddresses[0] || customer.billingAddress || {};
  customer.timeline = Array.isArray(customer.timeline) && customer.timeline.length ? customer.timeline : [
    {
      id: crypto.randomUUID(),
      type: "created",
      title: "Customer profile created",
      message: `${customer.name || "Customer"} added to DataPlus.`,
      user: "System",
      createdAt
    }
  ];
}

function normalizeDraftLine(db, line = {}, index = 0) {
  const sku = String(line.sku || "").trim();
  const inventoryItem = (db.inventory || []).find((item) => String(item.sku || "").toLowerCase() === sku.toLowerCase());
  return {
    id: line.id || crypto.randomUUID(),
    sku,
    title: String(line.title || inventoryItem?.title || "").trim(),
    qty: Math.max(1, Number(line.qty || 1)),
    price: Number(line.price ?? inventoryItem?.price ?? 0),
    cost: Number(line.cost ?? inventoryItem?.cost ?? 0),
    note: String(line.note || "").trim(),
    sortOrder: Number(line.sortOrder ?? index)
  };
}

function orderDraftTotals(items = []) {
  return items.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.price || 0), 0);
}

function normalizeOrderDraft(db, draft = {}) {
  const createdAt = draft.createdAt || new Date().toISOString();
  const items = (Array.isArray(draft.items) ? draft.items : [])
    .map((item, index) => normalizeDraftLine(db, item, index))
    .filter((item) => item.sku || item.title);
  const quoteGroupId = String(draft.quoteGroupId || draft.id || crypto.randomUUID()).trim();
  const revisionNumber = Math.max(1, Number(draft.revisionNumber || 1));
  return {
    id: draft.id || crypto.randomUUID(),
    draftNumber: String(draft.draftNumber || nextDraftNumber(db)).trim(),
    quoteGroupId,
    revisionNumber,
    parentDraftId: String(draft.parentDraftId || "").trim(),
    sourceOrderId: String(draft.sourceOrderId || "").trim(),
    sourceOrderNumber: String(draft.sourceOrderNumber || "").trim(),
    source: String(draft.source || "Manual").trim(),
    status: String(draft.status || "draft").trim(),
    buyer: String(draft.buyer || draft.customerName || "").trim(),
    buyerEmail: String(draft.buyerEmail || "").trim(),
    phone: String(draft.phone || "").trim(),
    marketplaceOrderNumber: String(draft.marketplaceOrderNumber || "").trim(),
    note: String(draft.note || "").trim(),
    shippingAddress: normalizeAddress(draft.shippingAddress || draft.address || {}, "shipping"),
    billingAddress: normalizeAddress(draft.billingAddress || draft.shippingAddress || draft.address || {}, "billing"),
    items,
    total: Number(draft.total ?? orderDraftTotals(items)),
    createdAt,
    updatedAt: draft.updatedAt || createdAt
  };
}

function buildOrderFromDraft(db, draft, user = "Luis") {
  const now = new Date().toISOString();
  const internalOrderNumber = nextOrderNumber(db);
  const items = (draft.items || []).map((item) => ({
    sku: item.sku,
    title: item.title,
    qty: Number(item.qty || 1),
    price: Number(item.price || 0)
  }));
  const first = items[0] || {};
  const total = orderDraftTotals(items);
  const productCost = (draft.items || []).reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.cost || 0), 0);
  return {
    id: crypto.randomUUID(),
    internalOrderNumber,
    orderNumber: internalOrderNumber,
    displayOrderNumber: internalOrderNumber,
    source: draft.source || "Manual",
    buyer: draft.buyer || "Manual customer",
    sku: first.sku || "",
    title: first.title || "Manual order",
    qty: items.reduce((sum, item) => sum + Number(item.qty || 0), 0) || 1,
    status: "new",
    total,
    shipBy: "",
    createdAt: now,
    updatedAt: now,
    buyerEmail: draft.buyerEmail || "",
    phone: draft.phone || "",
    address: normalizeAddress(draft.shippingAddress || {}, "shipping"),
    shippingService: "Not selected",
    trackingNumber: "",
    shippingCarrier: "",
    carrierName: "",
    trackingUrl: "",
    shipDate: "",
    productCost,
    marketplaceFees: 0,
    shippingCost: 0,
    refundAmount: 0,
    notes: draft.note || "",
    items,
    marketplaceOrderNumber: draft.marketplaceOrderNumber || "",
    marketplaceOrderId: draft.marketplaceOrderNumber || "",
    marketplaceReferences: draft.marketplaceOrderNumber ? [
      { source: draft.source || "Manual", type: "order", value: draft.marketplaceOrderNumber, primary: true }
    ] : [],
    timeline: [
      {
        id: crypto.randomUUID(),
        type: "created",
        title: "Manual order created",
        message: `${draft.draftNumber} converted into a live order.`,
        user,
        createdAt: now
      }
    ]
  };
}

function addCustomerTimeline(customer, event) {
  customer.timeline = Array.isArray(customer.timeline) ? customer.timeline : [];
  customer.timeline.push({
    id: crypto.randomUUID(),
    type: "edited",
    title: "Customer updated",
    message: "",
    user: "Luis",
    createdAt: new Date().toISOString(),
    ...event
  });
  customer.updatedAt = new Date().toISOString();
}

function updateCustomerProfile(customer, body) {
  const textFields = new Set(["name", "company", "customerType", "status", "email", "phone", "preferredChannel", "notes"]);
  const booleanFields = new Set(["taxExempt", "marketingOptIn"]);
  const addressFields = new Set(["label", "name", "company", "line1", "line2", "city", "state", "postalCode", "country", "phone"]);
  const changes = [];

  for (const [field, rawValue] of Object.entries(body)) {
    if (textFields.has(field)) {
      const value = String(rawValue ?? "");
      if (customer[field] !== value) {
        changes.push(field);
        customer[field] = value;
      }
      continue;
    }

    if (booleanFields.has(field)) {
      const value = Boolean(rawValue);
      if (Boolean(customer[field]) !== value) {
        changes.push(field);
        customer[field] = value;
      }
      continue;
    }

    if (field === "tags") {
      const value = Array.isArray(rawValue) ? rawValue : String(rawValue || "").split(",").map((tag) => tag.trim()).filter(Boolean);
      if (JSON.stringify(customer.tags || []) !== JSON.stringify(value)) {
        changes.push(field);
        customer.tags = value;
      }
      continue;
    }

    const [group, indexOrKey, possibleKey] = field.split(".");
    if ((group === "defaultAddress" || group === "billingAddress") && addressFields.has(indexOrKey)) {
      customer[group] = customer[group] || {};
      const value = String(rawValue ?? "");
      if (customer[group][indexOrKey] !== value) {
        changes.push(field);
        customer[group][indexOrKey] = value;
      }
      continue;
    }

    if ((group === "shippingAddresses" || group === "billingAddresses") && addressFields.has(possibleKey)) {
      const index = Number(indexOrKey);
      if (!Number.isInteger(index) || index < 0) continue;
      customer[group] = Array.isArray(customer[group]) ? customer[group] : [];
      customer[group][index] = normalizeAddress(customer[group][index] || {}, group === "billingAddresses" ? "billing" : "shipping");
      const value = String(rawValue ?? "");
      if (customer[group][index][possibleKey] !== value) {
        changes.push(field);
        customer[group][index][possibleKey] = value;
      }
    }
  }

  if (customer.shippingAddresses?.length) customer.defaultAddress = customer.shippingAddresses[0];
  if (customer.billingAddresses?.length) customer.billingAddress = customer.billingAddresses[0];
  if (changes.length) {
    addCustomerTimeline(customer, {
      type: "edited",
      title: "Customer profile edited",
      message: changes.join(", ")
    });
  }
  return changes;
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function sendHtml(res, status, html) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function notFound(res) {
  sendJson(res, 404, { error: "Not found" });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 50_000_000) {
        req.destroy();
        reject(new Error("Body too large"));
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function escapeCsv(value) {
  const text = String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  if (!rows.length) return [];

  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((cells, index) => {
    const record = Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] ?? ""]));
    Object.defineProperty(record, "__rowNumber", { value: index + 2, enumerable: false });
    return record;
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));

  if (!filePath.startsWith(PUBLIC_DIR)) return notFound(res);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return notFound(res);

  const ext = path.extname(filePath);
  const contentType = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".svg": "image/svg+xml"
  }[ext] || "application/octet-stream";

  res.writeHead(200, { "Content-Type": contentType });
  fs.createReadStream(filePath).pipe(res);
}

function normalizeImportJobStatus(status) {
  const value = String(status || 'success').trim().toLowerCase();
  if (['queued', 'running', 'success', 'warning', 'failed', 'stopped'].includes(value)) return value;
  if (['done', 'complete', 'completed', 'ok'].includes(value)) return 'success';
  if (['stop', 'stopped', 'cancel', 'canceled', 'cancelled'].includes(value)) return 'stopped';
  if (['error', 'errored', 'failure'].includes(value)) return 'failed';
  return 'success';
}

function importJobSectionFromSyncRun(run = {}) {
  const type = String(run.type || '').toLowerCase();
  const source = String(run.source || 'System');
  if (/order/.test(type)) return 'Orders';
  if (/customer/.test(type)) return 'Customers';
  if (/categor/.test(type)) return 'Categories';
  if (/inventory|stock/.test(type)) return 'Inventory';
  if (/product|catalog|shopify/.test(type)) return 'Products';
  return source;
}

function normalizeImportJob(job = {}) {
  const now = new Date().toISOString();
  const status = normalizeImportJobStatus(job.status);
  const createdAt = job.createdAt || job.startedAt || job.finishedAt || job.updatedAt || now;
  const finishedAt = job.finishedAt || (['success', 'warning', 'failed'].includes(status) ? job.updatedAt || createdAt : '');
  const errors = Array.isArray(job.errors)
    ? job.errors.map((error) => typeof error === 'string' ? error : error?.message || JSON.stringify(error)).filter(Boolean).slice(0, 50)
    : (job.error ? [String(job.error)] : []);
  return {
    id: job.id || crypto.randomUUID(),
    syncRunId: job.syncRunId || '',
    section: job.section || job.source || 'System',
    operation: job.operation || job.type || 'Import',
    direction: job.direction || (/export/i.test(`${job.operation || ''} ${job.type || ''}`) ? 'export' : 'import'),
    status,
    fileName: job.fileName || '',
    originalFileName: job.originalFileName || job.fileName || '',
    originalFilePath: job.originalFilePath || '',
    errorFileName: job.errorFileName || '',
    errorFilePath: job.errorFilePath || '',
    message: job.message || '',
    details: job.details || '',
    totalRows: Number(job.totalRows ?? job.requested ?? job.rows ?? 0) || 0,
    changed: Number(job.changed ?? job.updated ?? 0) || 0,
    created: Number(job.created ?? 0) || 0,
    missingCount: Number(job.missingCount ?? job.missing ?? 0) || 0,
    errors,
    createdAt,
    startedAt: job.startedAt || createdAt,
    finishedAt,
    updatedAt: job.updatedAt || finishedAt || createdAt
  };
}

function syncRunToImportJob(run = {}) {
  return normalizeImportJob({
    id: `sync-${run.id || crypto.randomUUID()}`,
    syncRunId: run.id || '',
    section: importJobSectionFromSyncRun(run),
    operation: run.type || 'Sync',
    direction: /export/i.test(String(run.type || '')) ? 'export' : 'import',
    status: run.status || 'success',
    fileName: run.fileName || '',
    message: run.message || '',
    errors: run.errors || [],
    createdAt: run.createdAt,
    startedAt: run.createdAt,
    finishedAt: run.createdAt,
    updatedAt: run.createdAt
  });
}

function normalizeImportJobs(jobs = [], syncRuns = []) {
  const normalizedJobs = (Array.isArray(jobs) ? jobs : []).map(normalizeImportJob);
  const jobIds = new Set(normalizedJobs.map((job) => job.id));
  const derivedRuns = (Array.isArray(syncRuns) ? syncRuns : [])
    .filter((run) => !run.importJobId || !jobIds.has(run.importJobId))
    .map(syncRunToImportJob);
  const seen = new Set();
  return [...normalizedJobs, ...derivedRuns]
    .filter((job) => {
      if (seen.has(job.id)) return false;
      seen.add(job.id);
      return true;
    })
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
    .slice(0, 250);
}

function createImportJob(db, attrs = {}) {
  db.importJobs = normalizeImportJobs(db.importJobs, []);
  const now = new Date().toISOString();
  const job = normalizeImportJob({
    id: crypto.randomUUID(),
    status: 'running',
    createdAt: now,
    startedAt: now,
    updatedAt: now,
    ...attrs
  });
  db.importJobs.unshift(job);
  db.importJobs = db.importJobs.slice(0, 250);
  return job;
}

function finishImportJob(job, attrs = {}) {
  if (!job) return null;
  const now = new Date().toISOString();
  Object.assign(job, normalizeImportJob({
    ...job,
    ...attrs,
    status: attrs.status || 'success',
    finishedAt: attrs.finishedAt || now,
    updatedAt: now
  }));
  return job;
}

function safeImportFileName(fileName, fallback = "import.csv") {
  const base = path.basename(String(fileName || fallback)).replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").trim();
  return base || fallback;
}

function attachImportJobOriginalFile(job, content = "", fileName = "") {
  if (!job || !content) return job;
  const dir = path.join(IMPORT_JOB_FILE_DIR, job.id);
  fs.mkdirSync(dir, { recursive: true });
  const safeName = safeImportFileName(fileName || job.fileName || "original.csv");
  const filePath = path.join(dir, safeName);
  fs.writeFileSync(filePath, String(content), "utf8");
  job.originalFileName = safeName;
  job.originalFilePath = filePath;
  if (!job.fileName) job.fileName = safeName;
  return job;
}

function attachImportJobErrorsFile(job, rows = []) {
  if (!job || !rows.length) return job;
  const dir = path.join(IMPORT_JOB_FILE_DIR, job.id);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "errors.csv");
  const normalizedRows = rows.map((row) => {
    const normalized = typeof row === "object" && row !== null
      ? standardImportError(row)
      : standardImportError({ issue: String(row) });
    const ordered = {};
    for (const column of IMPORT_ERROR_COLUMNS) ordered[column] = normalized[column] ?? "";
    for (const [key, value] of Object.entries(normalized)) {
      if (ordered[key] === undefined) ordered[key] = value ?? "";
    }
    return ordered;
  });
  fs.writeFileSync(filePath, rowsToCsv(normalizedRows), "utf8");
  job.errorFileName = "errors.csv";
  job.errorFilePath = filePath;
  return job;
}

function findImportJob(db, id) {
  db.importJobs = normalizeImportJobs(db.importJobs, db.syncRuns);
  return db.importJobs.find((job) => job.id === id);
}

function sendImportJobFile(res, job, kind) {
  const isOriginal = kind === "original";
  const filePath = isOriginal ? job?.originalFilePath : job?.errorFilePath;
  const fileName = isOriginal ? job?.originalFileName : job?.errorFileName;
  if (!filePath || !fs.existsSync(filePath)) return false;
  const contentType = fileName?.endsWith(".gz")
    ? "application/gzip"
    : fileName?.endsWith(".json")
      ? "application/json; charset=utf-8"
      : "text/csv; charset=utf-8";
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename=${safeImportFileName(fileName || (isOriginal ? "original.csv" : "errors.csv"))}`
  });
  res.end(fs.readFileSync(filePath));
  return true;
}

function publicState(db) {
  const connectorState = mergedConnectorState(db);
  const safeDb = {
    ...db,
    connectorState: {
      temuAuthorized: Boolean(connectorState.temuAccessToken),
      temuMallId: connectorState.temuMallId || "",
      temuLastOrderSync: connectorState.temuLastOrderSync || null,
      ebayAuthorized: Boolean(connectorState.ebayAccessToken || connectorState.ebayRefreshToken),
      ebayEnvironment: process.env.EBAY_ENVIRONMENT || "production",
      ebayLastOrderSync: connectorState.ebayLastOrderSync || null
    }
  };
  return { ...safeDb, summary: summarize(safeDb) };
}

function summarize(db) {
  const openOrders = db.orders.filter((order) => order.status !== "confirmed").length;
  const lowStock = db.inventory.filter((item) => item.qty - item.reserved <= item.reorderPoint).length;
  const reserved = db.inventory.reduce((sum, item) => sum + Number(item.reserved || 0), 0);
  const sales = db.orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const profit = db.orders.reduce((sum, order) => {
    return sum + Number(order.total || 0) - Number(order.productCost || 0) - Number(order.marketplaceFees || 0) - Number(order.shippingCost || 0) - Number(order.refundAmount || 0);
  }, 0);
  const customers = db.customers || [];
  const purchaseOrders = db.purchaseOrders || [];
  return {
    inventoryCount: db.inventory.length,
    openOrders,
    lowStock,
    reserved,
    sales,
    profit,
    customerCount: customers.length,
    repeatCustomers: customers.filter((customer) => customer.repeatCustomer).length,
    purchaseOrderCount: purchaseOrders.length,
    openPurchaseOrders: purchaseOrders.filter((po) => !["closed", "canceled"].includes(po.status)).length,
    sources: db.connections
  };
}

function demoOrdersFor(source) {
  const now = new Date();
  return [
    {
      id: crypto.randomUUID(),
      orderNumber: `${source.slice(0, 2).toUpperCase()}-${Math.floor(10000 + Math.random() * 89999)}`,
      source,
      buyer: ["Sam Rivera", "Taylor Brooks", "Morgan Lee"][Math.floor(Math.random() * 3)],
      sku: ["DP-HOME-001", "DP-BEAUTY-014", "DP-TECH-032"][Math.floor(Math.random() * 3)],
      title: "Marketplace Imported Item",
      qty: Math.ceil(Math.random() * 2),
      status: "new",
      total: Number((15 + Math.random() * 80).toFixed(2)),
      shipBy: new Date(now.getTime() + 2 * 86400000).toISOString().slice(0, 10),
      createdAt: now.toISOString(),
      marketplaceOrderId: crypto.randomUUID().slice(0, 13),
      buyerEmail: "buyer@example.com",
      phone: "(555) 010-0000",
      address: {
        name: "Marketplace Buyer",
        line1: "100 Commerce Way",
        line2: "",
        city: "Orlando",
        state: "FL",
        postalCode: "32801",
        country: "US"
      },
      shippingService: "Not selected",
      trackingNumber: "",
      productCost: Number((8 + Math.random() * 26).toFixed(2)),
      marketplaceFees: Number((2 + Math.random() * 8).toFixed(2)),
      shippingCost: Number((4 + Math.random() * 7).toFixed(2)),
      refundAmount: 0,
      notes: "Demo import. Replace with marketplace API payload.",
      items: []
    }
  ].map((order) => ({
    ...order,
    items: [
      {
        sku: order.sku,
        title: order.title,
        qty: order.qty,
        price: Number(order.total || 0) / Math.max(1, Number(order.qty || 1))
      }
    ]
  }));
}

function getTemuConfig(db = {}) {
  return {
    endpoint: process.env.TEMU_ENDPOINT || "https://openapi-b-us.temu.com/openapi/router",
    appKey: process.env.TEMU_APP_KEY || "",
    appSecret: process.env.TEMU_APP_SECRET || "",
    accessToken: db.connectorState?.temuAccessToken || process.env.TEMU_ACCESS_TOKEN || "",
    pageSize: Number(process.env.TEMU_ORDER_PAGE_SIZE || 50)
  };
}

function missingTemuConfig(config) {
  return [
    ["TEMU_APP_KEY", config.appKey],
    ["TEMU_APP_SECRET", config.appSecret],
    ["TEMU_ACCESS_TOKEN", config.accessToken]
  ].filter(([, value]) => !value).map(([key]) => key);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `"${key}":${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function temuSign(params, appSecret) {
  const unsigned = Object.entries(params)
    .filter(([key, value]) => key !== "sign" && value !== undefined && value !== null)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}${typeof value === "object" ? stableJson(value) : String(value)}`)
    .join("")
    .replace(/\s/g, "");
  return crypto.createHash("md5").update(`${appSecret}${unsigned}${appSecret}`, "utf8").digest("hex").toUpperCase();
}

async function temuRequest(type, payload = {}, options = {}) {
  const config = getTemuConfig(options.db);
  const accessToken = options.accessToken ?? config.accessToken;
  const missing = [
    ["TEMU_APP_KEY", config.appKey],
    ["TEMU_APP_SECRET", config.appSecret],
    ...(options.requireAccessToken === false ? [] : [["TEMU_ACCESS_TOKEN", accessToken]])
  ].filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) {
    throw new Error(`Temu credentials missing: ${missing.join(", ")}. Add them to .env and restart the app.`);
  }

  const params = {
    type,
    app_key: config.appKey,
    access_token: accessToken,
    timestamp: Math.floor(Date.now() / 1000),
    data_type: "JSON",
    ...payload
  };
  params.sign = temuSign(params, config.appSecret);

  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json;charset=UTF-8" },
    body: JSON.stringify(params)
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`Temu returned non-JSON response (${response.status}): ${text.slice(0, 180)}`);
  }
  if (!response.ok) throw new Error(`Temu HTTP ${response.status}: ${JSON.stringify(data).slice(0, 240)}`);
  if (data.errorCode || data.error_code || data.success === false) {
    throw new Error(`Temu API error: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

function findTokenPayload(response) {
  if (!response || typeof response !== "object") return {};
  if (response.result && typeof response.result === "object") return response.result;
  if (response.data && typeof response.data === "object") return response.data;
  return response;
}

async function exchangeTemuCode(db, code) {
  const trimmedCode = String(code || "").trim();
  if (!trimmedCode) throw new Error("Temu authorization code is required.");

  const response = await temuRequest("bg.open.accesstoken.create", {}, {
    db,
    accessToken: trimmedCode,
    requireAccessToken: false
  });
  const payload = findTokenPayload(response);
  const accessToken = payload.access_token || payload.accessToken || payload.token;
  if (!accessToken) {
    throw new Error(`Temu token exchange did not return an access token: ${JSON.stringify(response).slice(0, 240)}`);
  }

  db.connectorState = db.connectorState || {};
  db.connectorState.temuAccessToken = accessToken;
  db.connectorState.temuRefreshToken = payload.refresh_token || payload.refreshToken || db.connectorState.temuRefreshToken || "";
  db.connectorState.temuMallId = payload.mall_id || payload.mallId || payload.mallIdList?.[0] || "";
  db.connectorState.temuTokenCreatedAt = new Date().toISOString();

  const connection = db.connections.find((item) => item.name === "Temu");
  if (connection) {
    connection.connected = true;
    connection.lastSync = null;
  }
  db.syncRuns.unshift({
    id: crypto.randomUUID(),
    source: "Temu",
    type: "auth",
    status: "success",
    message: "Temu access token created from authorization code.",
    createdAt: new Date().toISOString()
  });
  await writeDb(db);
  return { mallId: db.connectorState.temuMallId, authorized: true };
}

function firstArrayFrom(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["pageItems", "pageItemList", "parentOrderList", "orderList", "orders", "list", "items", "data"]) {
    if (Array.isArray(value[key])) return value[key];
  }
  for (const child of Object.values(value)) {
    const nested = firstArrayFrom(child);
    if (nested.length) return nested;
  }
  return [];
}

function valueAt(source, keys, fallback = "") {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

function nestedMoney(value) {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || 0;
  return Number(value.amount ?? value.centAmount / 100 ?? value.value ?? value.price ?? 0) || 0;
}

function temuDate(value) {
  if (!value) return new Date().toISOString();
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000).toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function mapTemuStatus(status) {
  const text = String(status ?? "").toLowerCase();
  if (["confirmed", "shipped", "delivered", "completed"].some((item) => text.includes(item))) return "confirmed";
  if (["ready", "awaiting", "pending"].some((item) => text.includes(item))) return "ready";
  if (["cancel"].some((item) => text.includes(item))) return "canceled";
  return "new";
}

function mapTemuOrder(listOrder, detail = {}, shipping = {}) {
  const raw = { ...listOrder, ...detail };
  const parentOrderSn = valueAt(raw, ["parentOrderSn", "parent_order_sn", "parentOrderSN", "orderSn", "order_sn"]);
  const childItems = firstArrayFrom(raw.orderList || raw.orderDetailList || raw.skuList || raw.goodsList || raw.items || raw);
  const items = childItems.length ? childItems.map((item) => ({
    sku: String(valueAt(item, ["sku", "skuId", "skuSn", "goodsSkuSn", "extCode"], "TEMU-SKU")),
    title: String(valueAt(item, ["goodsName", "productName", "title", "name"], "Temu item")),
    qty: Number(valueAt(item, ["quantity", "qty", "goodsNumber"], 1)) || 1,
    price: nestedMoney(valueAt(item, ["salePrice", "retailPrice", "orderAmount", "price"], 0))
  })) : [
    {
      sku: String(valueAt(raw, ["sku", "skuId", "skuSn"], "TEMU-SKU")),
      title: String(valueAt(raw, ["goodsName", "productName", "title"], "Temu order")),
      qty: Number(valueAt(raw, ["quantity", "qty"], 1)) || 1,
      price: nestedMoney(valueAt(raw, ["orderAmount", "payAmount", "totalAmount"], 0))
    }
  ];

  const total = nestedMoney(valueAt(raw, ["parentOrderAmount", "orderAmount", "payAmount", "totalAmount", "settlementAmount"], 0))
    || items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0);
  const shipTo = shipping.shippingAddress || shipping.address || shipping.receiverAddress || shipping;
  const buyer = String(valueAt(shipTo, ["name", "receiverName", "recipientName"], valueAt(raw, ["buyerName", "customerName"], "Temu buyer")));

  return {
    id: crypto.randomUUID(),
    orderNumber: parentOrderSn || `TM-${Date.now()}`,
    marketplaceOrderNumber: parentOrderSn || "",
    marketplaceOrderId: parentOrderSn || "",
    source: "Temu",
    buyer,
    buyerEmail: String(valueAt(raw, ["buyerEmail", "email"], "")),
    phone: String(valueAt(shipTo, ["phone", "mobile", "receiverPhone"], "")),
    address: {
      name: buyer,
      line1: String(valueAt(shipTo, ["addressLine1", "line1", "address1", "detailAddress"], "")),
      line2: String(valueAt(shipTo, ["addressLine2", "line2", "address2"], "")),
      city: String(valueAt(shipTo, ["city", "cityName"], "")),
      state: String(valueAt(shipTo, ["state", "province", "regionName"], "")),
      postalCode: String(valueAt(shipTo, ["postalCode", "zipCode", "postCode"], "")),
      country: String(valueAt(shipTo, ["country", "countryCode"], "US"))
    },
    sku: items[0]?.sku || "TEMU-SKU",
    title: items[0]?.title || "Temu order",
    qty: items.reduce((sum, item) => sum + Number(item.qty || 0), 0) || 1,
    status: mapTemuStatus(valueAt(raw, ["parentOrderStatus", "orderStatus", "status"])),
    total,
    productCost: 0,
    marketplaceFees: 0,
    shippingCost: 0,
    refundAmount: 0,
    shippingService: String(valueAt(raw, ["shippingService", "logisticsServiceName"], "Temu fulfillment")),
    trackingNumber: String(valueAt(raw, ["trackingNumber", "trackingNo"], "")),
    shipBy: temuDate(valueAt(raw, ["expectShipLatestTime", "latestShipTime", "shipBy"])).slice(0, 10),
    createdAt: temuDate(valueAt(raw, ["createTime", "createdAt", "parentOrderTime"], Date.now())),
    updatedAt: new Date().toISOString(),
    notes: "Imported from Temu API.",
    items,
    external: {
      source: "Temu",
      parentOrderSn,
      importedAt: new Date().toISOString()
    }
  };
}

function upsertOrder(db, incoming) {
  const incomingMarketplaceNumber = incoming.marketplaceOrderNumber || incoming.marketplaceOrderId || incoming.orderNumber;
  const existing = db.orders.find((order) => {
    const existingMarketplaceNumber = order.marketplaceOrderNumber || order.marketplaceOrderId;
    return order.source === incoming.source && existingMarketplaceNumber === incomingMarketplaceNumber;
  });
  if (!existing) {
    incoming.internalOrderNumber = nextOrderNumber(db);
    incoming.orderNumber = incoming.internalOrderNumber;
    incoming.displayOrderNumber = incoming.internalOrderNumber;
    incoming.marketplaceOrderNumber = incomingMarketplaceNumber;
    incoming.marketplaceOrderId = incomingMarketplaceNumber;
    incoming.marketplaceReferences = incoming.marketplaceReferences?.length ? incoming.marketplaceReferences : [
      { source: incoming.source, type: "order", value: incomingMarketplaceNumber, primary: true }
    ].filter((reference) => reference.value);
    db.orders.unshift(incoming);
    return "created";
  }

  Object.assign(existing, {
    ...incoming,
    id: existing.id,
    internalOrderNumber: existing.internalOrderNumber,
    orderNumber: existing.internalOrderNumber,
    displayOrderNumber: existing.internalOrderNumber,
    marketplaceOrderNumber: incomingMarketplaceNumber,
    marketplaceOrderId: incomingMarketplaceNumber,
    marketplaceReferences: existing.marketplaceReferences?.length ? existing.marketplaceReferences : incoming.marketplaceReferences,
    productCost: incoming.source === "eBay" ? incoming.productCost : existing.productCost || incoming.productCost,
    marketplaceFees: incoming.source === "eBay" ? incoming.marketplaceFees : existing.marketplaceFees || incoming.marketplaceFees,
    shippingCost: incoming.source === "eBay" ? incoming.shippingCost : existing.shippingCost || incoming.shippingCost,
    refundAmount: incoming.source === "eBay" ? incoming.refundAmount : existing.refundAmount || incoming.refundAmount
  });
  return "updated";
}

function extractTemuOrderSn(order) {
  return valueAt(order, ["parentOrderSn", "parent_order_sn", "parentOrderSN", "orderSn", "order_sn"], "");
}

async function importTemuOrders(db) {
  const now = Math.floor(Date.now() / 1000);
  db.connectorState = db.connectorState || {};
  const lastSync = Number(db.connectorState.temuLastOrderSync || 0);
  const updateAtStart = lastSync ? Math.max(0, lastSync - 3600) : now - 90 * 24 * 3600;
  const config = getTemuConfig(db);
  const pageSize = Math.min(100, Math.max(1, config.pageSize || 50));
  let pageNumber = 1;
  let created = 0;
  let updated = 0;
  let fetched = 0;
  const errors = [];

  while (pageNumber <= 10) {
    const listResponse = await temuRequest("bg.order.list.v2.get", {
      pageNumber,
      pageSize,
      updateAtStart,
      updateAtEnd: now
    }, { db });
    const list = firstArrayFrom(listResponse);
    if (!list.length) break;

    for (const listOrder of list) {
      const parentOrderSn = extractTemuOrderSn(listOrder);
      let detail = {};
      let shipping = {};
      try {
        if (parentOrderSn) detail = await temuRequest("bg.order.detail.v2.get", { parentOrderSn }, { db });
      } catch (error) {
        errors.push(`detail ${parentOrderSn || "unknown"}: ${error.message}`);
      }
      try {
        if (parentOrderSn) shipping = await temuRequest("bg.order.shippinginfo.v2.get", { parentOrderSn }, { db });
      } catch (error) {
        errors.push(`shipping ${parentOrderSn || "unknown"}: ${error.message}`);
      }

      const action = upsertOrder(db, mapTemuOrder(listOrder, detail, shipping));
      if (action === "created") created += 1;
      if (action === "updated") updated += 1;
      fetched += 1;
    }

    if (list.length < pageSize) break;
    pageNumber += 1;
  }

  db.connectorState.temuLastOrderSync = now;
  return { fetched, created, updated, errors };
}

function getEbayConfig(db = {}) {
  const environment = String(process.env.EBAY_ENVIRONMENT || "production").toLowerCase() === "sandbox" ? "sandbox" : "production";
  const apiBase = environment === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
  const authBase = environment === "sandbox" ? "https://auth.sandbox.ebay.com/oauth2/authorize" : "https://auth.ebay.com/oauth2/authorize";
  const connectorState = mergedConnectorState(db);
  return {
    environment,
    apiBase,
    authBase,
    tokenUrl: `${apiBase}/identity/v1/oauth2/token`,
    clientId: process.env.EBAY_CLIENT_ID || "",
    clientSecret: process.env.EBAY_CLIENT_SECRET || "",
    ruName: process.env.EBAY_RUNAME || "",
    scope: process.env.EBAY_SCOPE || "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
    accessToken: connectorState.ebayAccessToken || process.env.EBAY_ACCESS_TOKEN || "",
    refreshToken: connectorState.ebayRefreshToken || process.env.EBAY_REFRESH_TOKEN || "",
    accessTokenExpiresAt: connectorState.ebayAccessTokenExpiresAt || "",
    pageSize: Number(process.env.EBAY_ORDER_PAGE_SIZE || 50),
    lookbackDays: Number(process.env.EBAY_ORDER_LOOKBACK_DAYS || 90)
  };
}

function missingEbayConfig(config, options = {}) {
  const needsToken = options.requireToken !== false;
  return [
    ["EBAY_CLIENT_ID", config.clientId],
    ["EBAY_CLIENT_SECRET", config.clientSecret],
    ["EBAY_RUNAME", config.ruName],
    ...(needsToken && !config.accessToken && !config.refreshToken ? [["EBAY_REFRESH_TOKEN", config.refreshToken]] : [])
  ].filter(([, value]) => !value).map(([key]) => key);
}

function ebayBasicAuth(config) {
  return Buffer.from(`${config.clientId}:${config.clientSecret}`, "utf8").toString("base64");
}

function ebayConsentUrl(db) {
  const config = getEbayConfig(db);
  const missing = missingEbayConfig(config, { requireToken: false });
  if (missing.length) {
    throw new Error(`eBay credentials missing: ${missing.join(", ")}. Add them to .env and restart the app.`);
  }
  db.connectorState = db.connectorState || {};
  const stateToken = crypto.randomBytes(18).toString("hex");
  db.connectorState.ebayOauthState = stateToken;
  const url = new URL(config.authBase);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.ruName);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("state", stateToken);
  return url.toString();
}

async function ebayTokenRequest(db, body) {
  const config = getEbayConfig(db);
  const missing = missingEbayConfig(config, { requireToken: false });
  if (missing.length) {
    throw new Error(`eBay credentials missing: ${missing.join(", ")}. Add them to .env and restart the app.`);
  }
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${ebayBasicAuth(config)}`
    },
    body
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`eBay token endpoint returned non-JSON response (${response.status}): ${text.slice(0, 180)}`);
  }
  if (!response.ok) {
    throw new Error(`eBay token error (${response.status}): ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

function saveEbayTokenPayload(db, payload) {
  db.connectorState = db.connectorState || {};
  if (payload.access_token) db.connectorState.ebayAccessToken = payload.access_token;
  if (payload.refresh_token) db.connectorState.ebayRefreshToken = payload.refresh_token;
  const expiresIn = Number(payload.expires_in || 0);
  if (expiresIn > 0) db.connectorState.ebayAccessTokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  db.connectorState.ebayTokenCreatedAt = new Date().toISOString();
}

async function exchangeEbayCode(db, code, options = {}) {
  const trimmedCode = String(code || "").trim();
  if (!trimmedCode) throw new Error("eBay authorization code is required.");
  const config = getEbayConfig(db);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: trimmedCode,
    redirect_uri: config.ruName
  });
  const payload = await ebayTokenRequest(db, body);
  if (!payload.access_token) {
    throw new Error(`eBay token exchange did not return an access token: ${JSON.stringify(payload).slice(0, 240)}`);
  }
  saveEbayTokenPayload(db, payload);
  delete db.connectorState.ebayOauthState;
  if (options.connectorOnly) {
    const existing = readConnectorStateSync();
    writeConnectorStateSync({
      ...existing,
      ...db.connectorState,
      ebayAuthorizedAt: new Date().toISOString()
    });
    return { authorized: true, environment: config.environment };
  }
  const connection = db.connections.find((item) => item.name === "eBay");
  if (connection) {
    connection.connected = true;
    connection.lastSync = null;
  }
  db.syncRuns.unshift({
    id: crypto.randomUUID(),
    source: "eBay",
    type: "auth",
    status: "success",
    message: "eBay access token created from authorization code.",
    createdAt: new Date().toISOString()
  });
  await writeDb(db);
  return { authorized: true, environment: config.environment };
}

async function refreshEbayAccessToken(db) {
  const config = getEbayConfig(db);
  const missing = missingEbayConfig(config, { requireToken: true });
  if (missing.length) {
    throw new Error(`eBay credentials missing: ${missing.join(", ")}. Add them to .env and restart the app.`);
  }
  if (!config.refreshToken) throw new Error("eBay refresh token is missing. Connect eBay again from the Channels page.");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: config.refreshToken,
    scope: config.scope
  });
  const payload = await ebayTokenRequest(db, body);
  if (!payload.access_token) {
    throw new Error(`eBay refresh did not return an access token: ${JSON.stringify(payload).slice(0, 240)}`);
  }
  saveEbayTokenPayload(db, payload);
  if (postgres.isPostgresEnabled()) {
    writeConnectorStateSync({ ...readConnectorStateSync(), ...db.connectorState });
  }
  return db.connectorState.ebayAccessToken;
}

async function ebayAccessToken(db) {
  const config = getEbayConfig(db);
  if (config.accessToken && config.accessTokenExpiresAt) {
    const expiresAt = new Date(config.accessTokenExpiresAt).getTime();
    if (Number.isFinite(expiresAt) && expiresAt > Date.now() + 120000) return config.accessToken;
  }
  if (config.accessToken && !config.refreshToken) return config.accessToken;
  return refreshEbayAccessToken(db);
}

async function ebayRequest(db, resourcePath, options = {}) {
  const config = getEbayConfig(db);
  const request = async (token) => {
    const response = await fetch(`${config.apiBase}${resourcePath}`, {
      method: options.method || "GET",
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${token}`,
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const text = await response.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (error) {
        throw new Error(`eBay returned non-JSON response (${response.status}): ${text.slice(0, 180)}`);
      }
    }
    return { response, data };
  };

  let token = await ebayAccessToken(db);
  let { response, data } = await request(token);
  if (response.status === 401 && getEbayConfig(db).refreshToken) {
    token = await refreshEbayAccessToken(db);
    ({ response, data } = await request(token));
  }
  if (!response.ok) {
    throw new Error(`eBay API error (${response.status}): ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

async function ebayServerDate(config) {
  try {
    const response = await fetch(config.apiBase, { method: "HEAD" });
    const header = response.headers.get("date");
    const date = header ? new Date(header) : null;
    if (date && Number.isFinite(date.getTime())) return date;
  } catch {
    // Fall back to the local clock if eBay's edge does not return a Date header.
  }
  return new Date();
}

function ebayAddressFromOrder(order) {
  const shippingStep = order.fulfillmentStartInstructions?.[0]?.shippingStep || {};
  const shipTo = shippingStep.shipTo || {};
  const registration = order.buyer?.buyerRegistrationAddress || {};
  const contact = shipTo.contactAddress || registration.contactAddress || {};
  const name = shipTo.fullName || registration.fullName || order.buyer?.username || "eBay buyer";
  return {
    name,
    line1: contact.addressLine1 || "",
    line2: contact.addressLine2 || "",
    city: contact.city || "",
    state: contact.stateOrProvince || "",
    postalCode: contact.postalCode || "",
    country: contact.countryCode || "US",
    email: shipTo.email || registration.email || "",
    phone: shipTo.primaryPhone?.phoneNumber || registration.primaryPhone?.phoneNumber || ""
  };
}

function mapEbayStatus(order) {
  const cancelState = String(order.cancelStatus?.cancelState || order.cancelStatus || "").toLowerCase();
  if (cancelState.includes("cancel")) return "canceled";
  const fulfillment = String(order.orderFulfillmentStatus || "").toLowerCase();
  if (fulfillment.includes("fulfilled")) return "confirmed";
  if (fulfillment.includes("progress")) return "ready";
  return "new";
}

function ebayRefundTotal(order) {
  return (order.paymentSummary?.refunds || []).reduce((sum, refund) => sum + nestedMoney(refund.amount || refund.refundAmount), 0);
}

function ebayProductCostForItems(db, items) {
  const inventory = Array.isArray(db.inventory) ? db.inventory : [];
  return items.reduce((sum, item) => {
    const sku = String(item.sku || "").toLowerCase();
    const product = inventory.find((row) => String(row.sku || "").toLowerCase() === sku)
      || inventory.find((row) => Object.values(row.sources || {}).some((value) => String(value || "").toLowerCase() === sku));
    const unitCost = Number(product?.cost ?? product?.fobPrice ?? product?.price ?? item.cost ?? 0);
    return sum + (Number.isFinite(unitCost) ? unitCost : 0) * Number(item.qty || 0);
  }, 0);
}

function mapEbayOrder(order, db = {}) {
  const address = ebayAddressFromOrder(order);
  const items = (Array.isArray(order.lineItems) && order.lineItems.length ? order.lineItems : [{}]).map((item) => {
    const quantity = Number(item.quantity || 1) || 1;
    const lineTotal = nestedMoney(item.lineItemCost || item.total || item.discountedLineItemCost);
    const lineShipping = nestedMoney(item.deliveryCost?.shippingCost);
    return {
      sku: String(item.sku || item.legacyItemId || item.lineItemId || order.orderId || "EBAY-SKU"),
      title: String(item.title || "eBay item"),
      qty: quantity,
      price: lineTotal ? Number((lineTotal / quantity).toFixed(2)) : 0,
      cost: 0,
      marketplaceLineItemId: item.lineItemId || "",
      legacyItemId: item.legacyItemId || "",
      legacyVariationId: item.legacyVariationId || "",
      fulfillmentStatus: item.lineItemFulfillmentStatus || "",
      shippingPaid: lineShipping,
      tax: (item.taxes || []).reduce((sum, tax) => sum + nestedMoney(tax.amount), 0),
      ebayCollectAndRemitTax: (item.ebayCollectAndRemitTaxes || []).reduce((sum, tax) => sum + nestedMoney(tax.amount), 0),
      shipBy: item.lineItemFulfillmentInstructions?.shipByDate || "",
      minEstimatedDeliveryDate: item.lineItemFulfillmentInstructions?.minEstimatedDeliveryDate || "",
      maxEstimatedDeliveryDate: item.lineItemFulfillmentInstructions?.maxEstimatedDeliveryDate || "",
      itemLocation: item.itemLocation || null
    };
  });
  const itemSubtotal = nestedMoney(order.pricingSummary?.priceSubtotal)
    || items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0);
  const shippingPaid = nestedMoney(order.pricingSummary?.deliveryCost);
  const total = nestedMoney(order.pricingSummary?.total || order.paymentSummary?.payments?.[0]?.amount)
    || itemSubtotal + shippingPaid;
  const marketplaceFees = nestedMoney(order.totalMarketplaceFee);
  const productCost = ebayProductCostForItems(db, items);
  const shippingStep = order.fulfillmentStartInstructions?.[0]?.shippingStep || {};
  const shipBy = order.lineItems?.[0]?.lineItemFulfillmentInstructions?.shipByDate
    || shippingStep.maxEstimatedDeliveryDate
    || order.creationDate
    || new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    orderNumber: order.orderId || `EB-${Date.now()}`,
    marketplaceOrderNumber: order.orderId || "",
    marketplaceOrderId: order.orderId || "",
    source: "eBay",
    buyer: address.name,
    buyerEmail: address.email,
    phone: address.phone,
    address: {
      name: address.name,
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      country: address.country
    },
    sku: items[0]?.sku || "EBAY-SKU",
    title: items[0]?.title || "eBay order",
    qty: items.reduce((sum, item) => sum + Number(item.qty || 0), 0) || 1,
    status: mapEbayStatus(order),
    total,
    subtotal: itemSubtotal,
    shippingPaid,
    productCost,
    marketplaceFees,
    shippingCost: 0,
    refundAmount: ebayRefundTotal(order),
    shippingService: shippingStep.shippingServiceCode || shippingStep.shippingCarrierCode || "eBay shipping",
    shippingCarrier: shippingStep.shippingCarrierCode || "",
    carrierName: shippingStep.shippingCarrierCode || "",
    trackingNumber: "",
    shipBy: temuDate(shipBy).slice(0, 10),
    minEstimatedDeliveryDate: order.fulfillmentStartInstructions?.[0]?.minEstimatedDeliveryDate || "",
    maxEstimatedDeliveryDate: order.fulfillmentStartInstructions?.[0]?.maxEstimatedDeliveryDate || "",
    createdAt: temuDate(order.creationDate || Date.now()),
    marketplaceUpdatedAt: temuDate(order.lastModifiedDate || Date.now()),
    updatedAt: new Date().toISOString(),
    notes: "Imported from eBay Fulfillment API.",
    items,
    external: {
      source: "eBay",
      orderId: order.orderId || "",
      legacyOrderId: order.legacyOrderId || "",
      salesRecordReference: order.salesRecordReference || "",
      sellerId: order.sellerId || "",
      orderFulfillmentStatus: order.orderFulfillmentStatus || "",
      orderPaymentStatus: order.orderPaymentStatus || "",
      totalDueSeller: nestedMoney(order.paymentSummary?.totalDueSeller),
      totalFeeBasisAmount: nestedMoney(order.totalFeeBasisAmount),
      totalMarketplaceFee: marketplaceFees,
      priceSubtotal: itemSubtotal,
      shippingPaid,
      ebayCollectAndRemitTax: Boolean(order.ebayCollectAndRemitTax),
      paymentCount: Array.isArray(order.paymentSummary?.payments) ? order.paymentSummary.payments.length : 0,
      refundCount: Array.isArray(order.paymentSummary?.refunds) ? order.paymentSummary.refunds.length : 0,
      importedAt: new Date().toISOString()
    }
  };
}

async function importEbayOrders(db) {
  db.connectorState = { ...mergedConnectorState(db), ...(db.connectorState || {}) };
  const config = getEbayConfig(db);
  const pageSize = Math.min(200, Math.max(1, config.pageSize || 50));
  const now = await ebayServerDate(config);
  const lastSync = db.connectorState.ebayLastOrderSync ? new Date(db.connectorState.ebayLastOrderSync) : null;
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
  const start = lastSync && Number.isFinite(lastSync.getTime())
    ? new Date(Math.max(yearStart.getTime(), lastSync.getTime() - 60 * 60 * 1000))
    : yearStart;
  const filterName = lastSync ? "lastmodifieddate" : "creationdate";
  const filter = `${filterName}:[${start.toISOString()}..${now.toISOString()}]`;
  let offset = 0;
  let created = 0;
  let updated = 0;
  let fetched = 0;
  const errors = [];

  while (offset <= 2000) {
    const params = new URLSearchParams({
      filter,
      limit: String(pageSize),
      offset: String(offset)
    });
    const data = await ebayRequest(db, `/sell/fulfillment/v1/order?${params.toString()}`);
    const orders = Array.isArray(data.orders) ? data.orders : [];
    for (const order of orders) {
      try {
        const action = upsertOrder(db, mapEbayOrder(order, db));
        if (action === "created") created += 1;
        if (action === "updated") updated += 1;
        fetched += 1;
      } catch (error) {
        errors.push(`order ${order.orderId || "unknown"}: ${error.message}`);
      }
    }
    if (!orders.length || orders.length < pageSize || !data.next) break;
    offset += pageSize;
  }

  db.connectorState.ebayLastOrderSync = now.toISOString();
  if (postgres.isPostgresEnabled()) {
    writeConnectorStateSync({ ...readConnectorStateSync(), ebayLastOrderSync: db.connectorState.ebayLastOrderSync });
  }
  return { fetched, created, updated, errors };
}

function parseList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || "")
    .split(/[|,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function inventoryPayloadFromRecord(record) {
  record = {
    ...record,
    brand: record.brand ?? record.Brand ?? record.brandName ?? record.brand_name ?? record["Brand Name"] ?? record["brand name"] ?? record["brand_name"]
  };
  const payload = {};
  const textFields = ["marketplaceTitle", "brand", "sourceBrand", "category", "mainCategory", "sourceCategory", "vendorCategory", "condition", "status", "barcode", "shortDescription", "longDescription", "vendor", "seoKeywords", "externalId", "shopifyId", "shopifyVariantId", "shopifyHandle", "shopifyStatus", "shopifyPublishedAt", "shopifyUpdatedAt", "shopifySyncedAt", "defaultImage", "manufacturer", "mfrPartNumber", "vendorSku", "supplier", "supplierCode", "unspsc", "uom", "uomQty", "minQuantity", "quantityIncrements", "sdsUrl", "stockStatus", "stockUpdatedAt", "ctechId", "ctechIdLastExport", "wildcardSearch", "productDumpCreatedAt", "productDumpUpdatedAt", "inactiveMailedAt", "validatedAt", "checkedImageUrl", "checkedImageError", "checkedImageSize", "checkedImageTimestamp", "zoroLeadtime", "zoroSku", "originalImage", "defaultSupplier", "lastPricesUpdateAt", "lastPricesUpdateBy", "leadTime", "leadtime", "altVendorSku", "countryOfOrigin", "originalSdsUrl", "itemKey", "itemClearanceIndicator", "vendorDescription", "uploadedBy"];
  const numberFields = ["price", "cost", "msrp", "weightOz", "lengthIn", "widthIn", "heightIn", "reorderPoint", "itemHeight", "itemLength", "itemWeight", "itemWidth", "packageHeight", "packageLength", "packageWeight", "packageWidth", "dimensionalWeight", "stockQty", "fobPrice", "zoroPrice", "zoroMinimumQty", "varisContractPrice", "varisListPrice", "varisOdManagedPrice", "varisNonOdManagedPrice", "varisOdPrivatePrice", "varisNonOdPrivatePrice"];

  for (const field of textFields) {
    if (record[field] !== undefined) payload[field] = String(record[field]).trim();
  }
  if (payload.brand !== undefined) payload.brand = formatBrandName(payload.brand);
  if (payload.sourceBrand !== undefined) payload.sourceBrand = sourceTextValue(payload.sourceBrand);
  if (payload.category !== undefined) payload.category = formatCategoryName(payload.category);
  if (payload.mainCategory !== undefined) payload.mainCategory = formatCategoryName(payload.mainCategory);
  if (payload.sourceCategory !== undefined) payload.sourceCategory = formatCategoryName(payload.sourceCategory);
  if (payload.vendorCategory !== undefined) payload.vendorCategory = formatCategoryName(payload.vendorCategory);
  for (const field of numberFields) {
    if (record[field] !== undefined && Number.isFinite(Number(record[field]))) payload[field] = Number(record[field]);
  }
  if (record.hazardous !== undefined) payload.hazardous = record.hazardous === true || String(record.hazardous).toLowerCase() === "true";
  if (record.active !== undefined) payload.active = record.active === true || String(record.active).toLowerCase() === "true";
  if (record.brandLocked !== undefined) payload.brandLocked = record.brandLocked === true || String(record.brandLocked).toLowerCase() === "true";
  if (record.categoryVerified !== undefined) payload.categoryVerified = record.categoryVerified === true || String(record.categoryVerified).toLowerCase() === "true";
  if (record.shopifyPublished !== undefined) payload.shopifyPublished = record.shopifyPublished === true || String(record.shopifyPublished).toLowerCase() === "true";
  if (record.images !== undefined) payload.images = parseList(record.images);
  if (record.tags !== undefined) payload.tags = parseList(record.tags);
  if (record.productManagerFields && typeof record.productManagerFields === "object") payload.productManagerFields = record.productManagerFields;
  if (record.checkedImage && typeof record.checkedImage === "object") payload.checkedImage = record.checkedImage;
  if (record.suppliers !== undefined) payload.suppliers = record.suppliers;
  if (record.original !== undefined) payload.original = record.original;
  return payload;
}

function applyInventoryPatch(item, body) {
  const textFields = ["sku", "title", "marketplaceTitle", "brand", "sourceBrand", "category", "mainCategory", "sourceCategory", "vendorCategory", "condition", "status", "barcode", "shortDescription", "longDescription", "vendor", "seoKeywords", "externalId", "shopifyId", "shopifyVariantId", "shopifyHandle", "shopifyStatus", "shopifyPublishedAt", "shopifyUpdatedAt", "shopifySyncedAt", "defaultImage", "manufacturer", "mfrPartNumber", "vendorSku", "supplier", "supplierCode", "unspsc", "uom", "uomQty", "minQuantity", "quantityIncrements", "sdsUrl", "stockStatus", "stockUpdatedAt", "ctechId", "ctechIdLastExport", "wildcardSearch", "productDumpCreatedAt", "productDumpUpdatedAt", "inactiveMailedAt", "validatedAt", "checkedImageUrl", "checkedImageError", "checkedImageSize", "checkedImageTimestamp", "zoroLeadtime", "zoroSku", "originalImage", "defaultSupplier", "lastPricesUpdateAt", "lastPricesUpdateBy", "leadTime", "leadtime", "altVendorSku", "countryOfOrigin", "originalSdsUrl", "itemKey", "itemClearanceIndicator", "vendorDescription", "uploadedBy"];
  const numberFields = ["qty", "reserved", "reorderPoint", "price", "cost", "msrp", "weightOz", "lengthIn", "widthIn", "heightIn", "itemHeight", "itemLength", "itemWeight", "itemWidth", "packageHeight", "packageLength", "packageWeight", "packageWidth", "dimensionalWeight", "stockQty", "fobPrice", "zoroPrice", "zoroMinimumQty", "varisContractPrice", "varisListPrice", "varisOdManagedPrice", "varisNonOdManagedPrice", "varisOdPrivatePrice", "varisNonOdPrivatePrice"];

  for (const field of textFields) {
    if (body[field] !== undefined) item[field] = String(body[field]);
  }
  if (body.brand !== undefined) item.brand = formatBrandName(body.brand);
  if (body.sourceBrand !== undefined) item.sourceBrand = sourceTextValue(body.sourceBrand);
  if (body.category !== undefined) item.category = formatCategoryName(body.category);
  if (body.category !== undefined) {
    item.mainCategory = item.category;
    item.categoryVerified = true;
  }
  if (body.mainCategory !== undefined) item.mainCategory = formatCategoryName(body.mainCategory);
  if (body.sourceCategory !== undefined) item.sourceCategory = formatCategoryName(body.sourceCategory);
  if (body.vendorCategory !== undefined) item.vendorCategory = formatCategoryName(body.vendorCategory);
  for (const field of numberFields) {
    if (body[field] !== undefined && Number.isFinite(Number(body[field]))) item[field] = Number(body[field]);
  }
  if (body.hazardous !== undefined) item.hazardous = body.hazardous === true || String(body.hazardous).toLowerCase() === "true";
  if (body.active !== undefined) item.active = body.active === true || String(body.active).toLowerCase() === "true";
  if (body.brandLocked !== undefined) item.brandLocked = body.brandLocked === true || String(body.brandLocked).toLowerCase() === "true";
  if (body.categoryVerified !== undefined) item.categoryVerified = body.categoryVerified === true || String(body.categoryVerified).toLowerCase() === "true";
  if (body.shopifyPublished !== undefined) item.shopifyPublished = body.shopifyPublished === true || String(body.shopifyPublished).toLowerCase() === "true";
  if (body.images !== undefined) item.images = parseList(body.images);
  if (body.tags !== undefined) item.tags = parseList(body.tags);
  if (body.bulletPoints !== undefined) item.bulletPoints = parseList(body.bulletPoints);
  if (body.productManagerFields && typeof body.productManagerFields === "object") item.productManagerFields = body.productManagerFields;
  if (body.checkedImage && typeof body.checkedImage === "object") item.checkedImage = body.checkedImage;
  if (body.suppliers !== undefined) item.suppliers = body.suppliers;
  if (body.original !== undefined) item.original = body.original;
  if (["packageLength", "packageWidth", "packageHeight"].some((field) => body[field] !== undefined)) {
    item.dimensionalWeight = calculateDimensionalWeight(item);
  }
}

function ensureInventoryWarehouseStock(item, warehouse) {
  item.warehouseStock = Array.isArray(item.warehouseStock) ? item.warehouseStock : [];
  let row = item.warehouseStock.find((entry) => entry.warehouseId === warehouse.id);
  if (!row) {
    row = normalizeWarehouseStockRow({
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      qty: 0,
      reserved: 0,
      reorderPoint: 0
    }, warehouse, item);
    item.warehouseStock.push(row);
  }
  return row;
}

function findPreferredOrderWarehouse(db, order) {
  const preferredId = order.fulfillmentWarehouseId || order.reservationWarehouseId || order.returnWarehouseId || "";
  return (db.warehouses || []).find((warehouse) => warehouse.id === preferredId)
    || (db.warehouses || []).find((warehouse) => warehouse.isDefaultReceiving)
    || (db.warehouses || [])[0]
    || null;
}

function normalizeReceiptAttachment(file = {}, user = "Luis") {
  return {
    id: file.id || crypto.randomUUID(),
    name: String(file.name || "Receiving attachment"),
    size: Number(file.size || 0),
    mimeType: String(file.mimeType || ""),
    source: String(file.source || "Manual upload"),
    dataUrl: String(file.dataUrl || ""),
    uploadedBy: file.uploadedBy || user,
    uploadedAt: file.uploadedAt || new Date().toISOString()
  };
}

function normalizeReturnAttachment(file = {}, user = "Luis") {
  return {
    id: file.id || crypto.randomUUID(),
    name: String(file.name || "Return attachment"),
    size: Number(file.size || 0),
    mimeType: String(file.mimeType || ""),
    source: String(file.source || "Manual upload"),
    dataUrl: String(file.dataUrl || ""),
    stage: String(file.stage || "requested"),
    uploadedBy: file.uploadedBy || user,
    uploadedAt: file.uploadedAt || new Date().toISOString()
  };
}

function defaultWarehouseBinCode(warehouse) {
  const bins = Array.isArray(warehouse?.bins) ? warehouse.bins : [];
  return bins.find((bin) => bin.isDefault && bin.active !== false)?.code
    || bins.find((bin) => bin.active !== false)?.code
    || "";
}

function applyShadowSkuPatch(shadow, body) {
  const textFields = ["shadowSku", "marketplace", "company", "status", "notes", "inventoryPolicy", "shippingProfile", "shippingService", "shippingTemplateId"];
  for (const field of textFields) {
    if (body[field] !== undefined) shadow[field] = String(body[field]).trim();
  }
  const numberFields = ["price", "handlingTimeDays", "safetyQty", "maxSellableQty"];
  for (const field of numberFields) {
    if (body[field] !== undefined && Number.isFinite(Number(body[field]))) shadow[field] = Number(body[field]);
  }
  if (body.handlingTime !== undefined && Number.isFinite(Number(body.handlingTime))) shadow.handlingTimeDays = Number(body.handlingTime);
  if (body.freeShipping !== undefined) shadow.freeShipping = body.freeShipping === true || String(body.freeShipping).toLowerCase() === "true";
  if (body.attributeKey && body.attributeValue !== undefined) {
    shadow.marketplaceAttributes = shadow.marketplaceAttributes || {};
    shadow.marketplaceAttributes[String(body.attributeKey)] = body.attributeValue;
  }
  if (body.marketplaceAttributes && typeof body.marketplaceAttributes === "object") {
    shadow.marketplaceAttributes = { ...(shadow.marketplaceAttributes || {}), ...body.marketplaceAttributes };
  }
  if (body.contentOverrides && typeof body.contentOverrides === "object") {
    shadow.contentOverrides = {
      ...(shadow.contentOverrides || {}),
      ...body.contentOverrides
    };
    if (body.contentOverrides.imageUrls !== undefined) shadow.contentOverrides.imageUrls = parseList(body.contentOverrides.imageUrls);
  }
  if (body.overrideField) {
    shadow.contentOverrides = shadow.contentOverrides || {};
    shadow.contentOverrides[body.overrideField] = body.overrideField === "imageUrls" ? parseList(body.overrideValue) : String(body.overrideValue || "");
  }
  if (body.marketplace !== undefined || body.company !== undefined) {
    shadow.marketplace = shadow.marketplace || shadow.company || "";
    shadow.company = shadow.marketplace;
  }
  shadow.updatedAt = new Date().toISOString();
  addShadowTimeline(shadow, {
    type: "edited",
    title: "Shadow SKU edited",
    message: `Updated ${Object.keys(body).filter((key) => !["attributeKey", "attributeValue"].includes(key)).join(", ") || body.attributeKey || "shadow fields"}.`
  });
}

function catalogSearchText(product = {}) {
  return [
    product.sku,
    product.title,
    product.marketplaceTitle,
    product.brand,
    product.category,
    product.manufacturer,
    product.mfrPartNumber,
    product.vendorSku,
    product.supplier,
    product.supplierCode,
    product.zoroSku,
    product.altVendorSku,
    product.itemKey,
    product.barcode,
    product.wildcardSearch
  ].filter(Boolean).join(" ").toLowerCase();
}

function catalogFilterParams(searchParams) {
  return {
    supplier: searchParams.get("supplier") || "",
    suppliers: searchParams.get("suppliers") || "",
    active: searchParams.get("active") || "",
    productMembership: searchParams.get("productMembership") || "",
    stockStatus: searchParams.get("stockStatus") || "",
    hasStock: searchParams.get("hasStock") || "",
    hazardous: searchParams.get("hazardous") || "",
    brand: searchParams.get("brand") || "",
    category: searchParams.get("category") || ""
  };
}

function productMatchesCatalogFilters(product = {}, filters = {}) {
  const supplierValues = String(filters.suppliers || filters.supplier || "").split("|").map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (supplierValues.length && !supplierValues.includes(String(product.supplier || product.vendor || "").toLowerCase())) return false;
  if (filters.active && String(product.active !== false) !== filters.active) return false;
  if (filters.productMembership === "in-products" && !product.inProducts) return false;
  if (filters.productMembership === "not-in-products" && product.inProducts) return false;
  if (filters.stockStatus && String(product.stockStatus || "") !== filters.stockStatus) return false;
  if (filters.hasStock && String(Number(product.stockQty ?? product.qty ?? 0) > 0) !== filters.hasStock) return false;
  if (filters.hazardous && String(Boolean(product.hazardous)) !== filters.hazardous) return false;
  if (filters.brand && formatBrandName(product.brand || "") !== filters.brand) return false;
  if (filters.category && formatCategoryName(product.category || "") !== formatCategoryName(filters.category)) return false;
  return true;
}

function hasCatalogFilters(filters = {}) {
  return Object.values(filters).some((value) => value !== "");
}

function normalizeSourceCatalogOverrides(overrides = {}) {
  const entries = Array.isArray(overrides)
    ? overrides.map((row) => [row.sku, row])
    : Object.entries(overrides || {});
  const result = {};
  for (const [sku, row] of entries) {
    const key = String(sku || row?.sku || "").trim().toLowerCase();
    if (!key) continue;
    result[key] = {
      sku: row.sku || sku,
      status: row.status || "",
      active: row.active === undefined ? undefined : Boolean(row.active),
      category: row.category ? formatCategoryName(row.category) : "",
      categoryVerified: row.categoryVerified === undefined ? Boolean(row.category) : Boolean(row.categoryVerified),
      deleted: Boolean(row.deleted),
      updatedAt: row.updatedAt || new Date().toISOString()
    };
  }
  return result;
}

function vendorCategoryMappingKey(supplier, vendorCategory) {
  const supplierKey = String(supplier || "").trim().toLowerCase();
  const categoryKey = formatCategoryName(vendorCategory || "").toLowerCase();
  return supplierKey && categoryKey ? `${supplierKey}::${categoryKey}` : "";
}

function normalizeVendorCategoryMappings(mappings = {}) {
  const entries = Array.isArray(mappings)
    ? mappings.map((row) => [vendorCategoryMappingKey(row?.supplier, row?.vendorCategory), row])
    : Object.entries(mappings || {});
  const result = {};
  for (const [key, row] of entries) {
    const supplier = sourceTextValue(row?.supplier);
    const vendorCategory = formatCategoryName(row?.vendorCategory || row?.sourceCategory || row?.category);
    const mainCategory = formatCategoryName(row?.mainCategory || row?.mappedCategory || row?.categoryOverride);
    const normalizedKey = key && key.includes("::") ? key : vendorCategoryMappingKey(supplier, vendorCategory);
    if (!normalizedKey || !supplier || !vendorCategory || !mainCategory) continue;
    result[normalizedKey] = {
      supplier,
      vendorCategory,
      mainCategory,
      categoryVerified: row.categoryVerified === undefined ? true : Boolean(row.categoryVerified),
      source: row.source || "vendor-category-map",
      sampleSku: row.sampleSku || "",
      matchCount: Number(row.matchCount || 0),
      conflictCount: Number(row.conflictCount || 0),
      updatedAt: row.updatedAt || new Date().toISOString(),
      createdAt: row.createdAt || row.updatedAt || new Date().toISOString()
    };
  }
  return result;
}

function sourceCatalogOverrideMap(db = {}) {
  db.sourceCatalogOverrides = normalizeSourceCatalogOverrides(db.sourceCatalogOverrides);
  return db.sourceCatalogOverrides;
}

function vendorCategoryMappingMap(db = {}) {
  db.vendorCategoryMappings = normalizeVendorCategoryMappings(db.vendorCategoryMappings);
  return db.vendorCategoryMappings;
}

function applySourceCatalogOverride(product = {}, overrides = {}, vendorMappings = {}) {
  const override = overrides[String(product.sku || "").toLowerCase()];
  const supplier = sourceTextValue(product.supplier || product.vendor);
  const vendorCategory = formatCategoryName(product.sourceCategory || product.vendorCategory || product.category || "");
  const vendorMapping = vendorMappings[vendorCategoryMappingKey(supplier, vendorCategory)];
  if (!override && !vendorMapping) return product;
  const mappedCategory = override?.category || vendorMapping?.mainCategory || product.mainCategory || "";
  return {
    ...product,
    sourceCategory: product.sourceCategory || product.vendorCategory || product.category || "",
    vendorCategory: product.vendorCategory || product.sourceCategory || product.category || "",
    mainCategory: mappedCategory,
    categoryVerified: mappedCategory ? true : Boolean(product.categoryVerified),
    status: override?.status || product.status,
    active: override?.active === undefined ? product.active : override.active,
    sourceCatalogDeleted: Boolean(override?.deleted),
    sourceCatalogOverrideUpdatedAt: override?.updatedAt || "",
    vendorCategoryMappingUpdatedAt: vendorMapping?.updatedAt || "",
    vendorCategoryMappedFrom: vendorMapping ? "vendor-category-map" : ""
  };
}

function inventoryBySkuMap(db = {}) {
  const rows = Array.isArray(db.inventory) ? db.inventory : [];
  return new Map(rows.map((item) => [String(item.sku || "").toLowerCase(), item]).filter(([sku]) => sku));
}

function sourceProductDiffs(source = {}, product = {}) {
  if (!product) return [];
  const checks = [
    ["title", source.marketplaceTitle || source.title, product.marketplaceTitle || product.title],
    ["brand", source.brand, product.brand],
    ["cost", Number(source.cost || 0), Number(product.cost || 0)],
    ["price", Number(source.price || 0), Number(product.price || 0)],
    ["qty", Number(source.stockQty ?? source.qty ?? 0), Number(product.stockQty ?? product.qty ?? 0)],
    ["status", source.status || (source.active === false ? "Inactive" : "Active"), product.status || (product.active === false ? "Inactive" : "Active")]
  ];
  return checks
    .filter(([, left, right]) => String(left ?? "").trim() !== String(right ?? "").trim())
    .map(([field]) => field);
}

function decorateSourceCatalogProduct(product = {}, overrides = {}, productsBySku = new Map(), vendorMappings = {}) {
  const row = applySourceCatalogOverride(product, overrides, vendorMappings);
  const activeProduct = productsBySku.get(String(row.sku || "").toLowerCase());
  return {
    ...row,
    inProducts: Boolean(activeProduct),
    productCatalogId: activeProduct?.id || "",
    productCatalogStatus: activeProduct?.status || "",
    productCatalogActive: activeProduct ? activeProduct.active !== false : false,
    productCatalogDiffs: activeProduct ? sourceProductDiffs(row, activeProduct) : []
  };
}

function catalogSummary(product = {}) {
  return {
    id: product.id || product.sku,
    sku: product.sku || "",
    title: product.title || product.marketplaceTitle || "",
    marketplaceTitle: product.marketplaceTitle || product.title || "",
    brand: formatBrandName(product.brand || ""),
    sourceBrand: product.sourceBrand || "",
    brandLocked: Boolean(product.brandLocked),
    category: formatCategoryName(product.mainCategory || (product.categoryVerified ? product.category : "")),
    mainCategory: formatCategoryName(product.mainCategory || (product.categoryVerified ? product.category : "")),
    categoryVerified: Boolean(product.categoryVerified),
    sourceCategory: formatCategoryName(product.sourceCategory || product.vendorCategory || product.category || ""),
    vendorCategory: formatCategoryName(product.vendorCategory || product.sourceCategory || product.category || ""),
    manufacturer: product.manufacturer || "",
    mfrPartNumber: product.mfrPartNumber || "",
    vendorSku: product.vendorSku || "",
    supplier: product.supplier || "",
    supplierCode: product.supplierCode || "",
    stockStatus: product.stockStatus || "",
    hazardous: Boolean(product.hazardous),
    price: Number(product.price || 0),
    cost: Number(product.cost || 0),
    msrp: Number(product.msrp || 0),
    stockQty: Number(product.stockQty ?? product.qty ?? 0),
    active: product.active !== false,
    status: product.status || "Draft",
    inProducts: Boolean(product.inProducts),
    productCatalogId: product.productCatalogId || "",
    productCatalogStatus: product.productCatalogStatus || "",
    productCatalogActive: Boolean(product.productCatalogActive),
    productCatalogDiffs: Array.isArray(product.productCatalogDiffs) ? product.productCatalogDiffs : [],
    alternateVendorCount: Number(product.alternateVendorCount || 0),
    defaultImage: product.defaultImage || "",
    images: Array.isArray(product.images) ? product.images.slice(0, 4) : [],
    zoroSku: product.zoroSku || "",
    zoroPrice: Number(product.zoroPrice || 0),
    varisContractPrice: Number(product.varisContractPrice || 0),
    countryOfOrigin: product.countryOfOrigin || "",
    productManagerFieldCount: product.productManagerFields ? Object.keys(product.productManagerFields).length : 0
  };
}

function readCatalogManifest() {
  if (!fs.existsSync(CATALOG_MANIFEST_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(CATALOG_MANIFEST_FILE, "utf8"));
  } catch {
    return null;
  }
}

function readCatalogVendorIndex() {
  if (!fs.existsSync(CATALOG_VENDOR_INDEX_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(CATALOG_VENDOR_INDEX_FILE, "utf8"));
  } catch {
    return null;
  }
}

function readSourceCatalogIndexManifest() {
  if (!fs.existsSync(CATALOG_INDEX_MANIFEST_FILE) || !fs.existsSync(CATALOG_INDEX_SUPPLIERS_FILE)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(CATALOG_INDEX_MANIFEST_FILE, "utf8"));
    const catalogStat = fs.existsSync(CATALOG_FILE) ? fs.statSync(CATALOG_FILE) : null;
    if (!catalogStat || Number(manifest.catalogSize || 0) !== catalogStat.size || Number(manifest.catalogMtimeMs || 0) !== catalogStat.mtimeMs) return null;
    const suppliers = JSON.parse(fs.readFileSync(CATALOG_INDEX_SUPPLIERS_FILE, "utf8"));
    return { ...manifest, suppliers: suppliers.suppliers || [] };
  } catch {
    return null;
  }
}

function skuShardName(sku) {
  const key = String(sku || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return (key.slice(0, 2) || "__").padEnd(2, "_");
}

async function readCatalogProductAtOffset(offset) {
  const handle = await fs.promises.open(CATALOG_FILE, "r");
  try {
    const chunks = [];
    const buffer = Buffer.alloc(8192);
    let position = Number(offset || 0);
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      const slice = buffer.subarray(0, bytesRead);
      const newline = slice.indexOf(10);
      if (newline >= 0) {
        chunks.push(slice.subarray(0, newline));
        break;
      }
      chunks.push(Buffer.from(slice));
      position += bytesRead;
    }
    const line = Buffer.concat(chunks).toString("utf8").trim();
    return line ? JSON.parse(line) : null;
  } finally {
    await handle.close();
  }
}

function normalizeCatalogProductForInventory(record) {
  const sku = sourceTextValue(record._id || record.sku || record.SKU || record.id);
  if (!sku) return null;
  const defaultImage = sourceTextValue(record.defaultImage || record.default_image || record.image || record.image_url);
  const images = [...new Set([defaultImage, ...sourceListValue(record.images || record.image_urls)].filter(Boolean))];
  const stockQty = sourceNumberValue(record.stockQty ?? record.stock_qty ?? record.qty ?? record.quantity);
  const minQuantity = sourceTextValue(record.minQuantity || record.min_quantity);
  const checkedImage = record.checkedImage || record.checked_image || {};
  const sourceBrand = sourceTextValue(record.sourceBrand || record.brand);
  const sourceCategory = formatCategoryName(record.sourceCategory || record.vendorCategory || record.category || record.product_type);
  const mainCategory = formatCategoryName(record.mainCategory || record.categoryOverride || (record.categoryVerified ? record.category : ""));

  const product = {
    sku,
    externalId: sourceTextValue(record.externalId || record._id || record.id),
    title: sourceTextValue(record.title || record.name || sku),
    marketplaceTitle: sourceTextValue(record.marketplaceTitle || record.name || record.title || sku),
    shortDescription: sourceTextValue(record.shortDescription || record.short_description),
    longDescription: sourceTextValue(record.longDescription || record.description || record.long_description),
    bulletPoints: sourceListValue(record.bulletPoints || record.bullet_points || record.keyFeatures || record.features),
    brand: sourceBrand,
    sourceBrand,
    brandLocked: sourceBooleanValue(record.brandLocked, false),
    category: mainCategory,
    mainCategory,
    categoryVerified: Boolean(mainCategory),
    sourceCategory,
    vendorCategory: sourceCategory,
    condition: sourceTextValue(record.condition) || "New",
    status: record.active === false ? "Draft" : sourceTextValue(record.status) || "Draft",
    active: sourceBooleanValue(record.active, true),
    barcode: sourceTextValue(record.barcode || record.upc || record.gtin),
    defaultImage,
    images,
    manufacturer: sourceTextValue(record.manufacturer),
    mfrPartNumber: sourceTextValue(record.mfrPartNumber || record.mfr_part_number),
    vendorSku: sourceTextValue(record.vendorSku || record.vendor_sku),
    supplier: sourceTextValue(record.supplier),
    supplierCode: sourceTextValue(record.supplierCode || record.supplier_code),
    vendor: sourceTextValue(record.vendor || record.supplier),
    unspsc: sourceTextValue(record.unspsc),
    uom: sourceTextValue(record.uom),
    uomQty: sourceTextValue(record.uomQty || record.uom_qty),
    minQuantity,
    quantityIncrements: sourceTextValue(record.quantityIncrements || record.quantity_increments),
    hazardous: sourceBooleanValue(record.hazardous, false),
    sdsUrl: sourceTextValue(record.sdsUrl || record.sds_url),
    itemHeight: sourceNumberValue(record.itemHeight || record.item_height),
    itemLength: sourceNumberValue(record.itemLength || record.item_length),
    itemWeight: sourceNumberValue(record.itemWeight || record.item_weight),
    itemWidth: sourceNumberValue(record.itemWidth || record.item_width),
    packageHeight: sourceNumberValue(record.packageHeight || record.package_height),
    packageLength: sourceNumberValue(record.packageLength || record.package_length),
    packageWeight: sourceNumberValue(record.packageWeight || record.package_weight),
    packageWidth: sourceNumberValue(record.packageWidth || record.package_width),
    dimensionalWeight: sourceNumberValue(record.dimensionalWeight || record.dimensional_weight),
    qty: stockQty,
    stockQty,
    stockStatus: sourceTextValue(record.stockStatus || record.stock_status),
    stockUpdatedAt: sourceTextValue(record.stockUpdatedAt || record.stock_updated_at),
    reorderPoint: sourceNumberValue(minQuantity),
    ctechId: sourceTextValue(record.ctechId || record.ctech_id),
    ctechIdLastExport: sourceTextValue(record.ctechIdLastExport || record.ctech_id_last_export),
    fobPrice: sourceNumberValue(record.fobPrice || record.fob_price),
    price: sourceNumberValue(record.price || record.sale_price || record.sell_price),
    cost: sourceNumberValue(record.cost || record.fob_price || record.wholesale_price),
    msrp: sourceNumberValue(record.msrp || record.list_price),
    wildcardSearch: sourceTextValue(record.wildcardSearch),
    tags: sourceListValue(record.tags),
    attributes: record.attributes && typeof record.attributes === "object" ? record.attributes : {},
    productDumpCreatedAt: sourceTextValue(record.productDumpCreatedAt || record.created_at || record.createdAt),
    productDumpUpdatedAt: sourceTextValue(record.productDumpUpdatedAt || record.updated_at || record.updatedAt),
    inactiveMailedAt: sourceTextValue(record.inactiveMailedAt || record.inactive_mailed_at),
    validatedAt: sourceTextValue(record.validatedAt || record.validated_at),
    checkedImage: checkedImage && typeof checkedImage === "object" ? checkedImage : {},
    checkedImageUrl: sourceTextValue(checkedImage?.url),
    checkedImageError: sourceTextValue(checkedImage?.error),
    checkedImageSize: sourceTextValue(checkedImage?.size),
    checkedImageTimestamp: sourceTextValue(checkedImage?.timestamp),
    originalImage: sourceTextValue(record.originalImage || record.original_image),
    countryOfOrigin: sourceTextValue(record.countryOfOrigin || record.country_of_origin),
    original: record.original === undefined ? null : record.original,
    productManagerFields: record.productManagerFields && typeof record.productManagerFields === "object" ? record.productManagerFields : {},
    sources: { ...(record.sources || {}), catalog: sku },
    importedFrom: record.importedFrom || "source catalog",
    updatedAt: new Date().toISOString()
  };
  product.dimensionalWeight = product.dimensionalWeight || calculateDimensionalWeight(product);
  return product;
}

function isInventoryShellProduct(item) {
  const sku = sourceTextValue(item.sku);
  if (!sku) return false;
  const title = sourceTextValue(item.title);
  const marketplaceTitle = sourceTextValue(item.marketplaceTitle);
  return (!title || title === sku || marketplaceTitle === sku)
    && !sourceTextValue(item.vendorSku || item.vendor_sku)
    && !sourceTextValue(item.supplier || item.vendor)
    && !sourceTextValue(item.defaultImage || item.default_image)
    && !sourceTextValue(item.shortDescription || item.short_description)
    && !sourceTextValue(item.longDescription || item.description);
}

function upsertInventoryProductFromCatalog(db, product) {
  product = normalizeCatalogProductForInventory(product);
  if (!product) return { item: null, existing: false };
  db.inventory = Array.isArray(db.inventory) ? db.inventory : [];
  const existing = db.inventory.find((item) => String(item.sku || "").toLowerCase() === String(product.sku || "").toLowerCase());
  if (existing) {
    const wasShell = isInventoryShellProduct(existing);
    if (wasShell) {
      const keep = {
        id: existing.id,
        reserved: existing.reserved,
        shadowSkus: existing.shadowSkus,
        serialUnits: existing.serialUnits,
        warehouseStock: [],
        sources: existing.sources
      };
      Object.assign(existing, product, keep, {
        sources: { ...(product.sources || {}), ...(existing.sources || {}), catalog: product.sku },
        updatedAt: new Date().toISOString()
      });
    } else {
      applyProtectedSourceProduct(db, existing, product, "Source catalog");
    }
    return { item: existing, existing: true };
  }
  const item = {
    id: crypto.randomUUID(),
    ...product,
    qty: Number(product.stockQty ?? product.qty ?? 0),
    reserved: 0,
    reorderPoint: Number(product.reorderPoint || 0),
    shadowSkus: [],
    serialUnits: [],
    warehouseStock: [],
    sources: { ...(product.sources || {}), catalog: product.sku },
    updatedAt: new Date().toISOString()
  };
  db.inventory.push(item);
  return { item, existing: false };
}

async function findCatalogProductsBySkus(skus = [], db = {}) {
  const wanted = new Set(skus.map((sku) => String(sku || "").toLowerCase()).filter(Boolean));
  const found = [];
  if (!wanted.size || !fs.existsSync(CATALOG_FILE)) return found;
  const overrides = sourceCatalogOverrideMap(db);
  const vendorMappings = vendorCategoryMappingMap(db);
  const productsBySku = inventoryBySkuMap(db);
  const decorate = (product) => decorateSourceCatalogProduct(product, overrides, productsBySku, vendorMappings);
  const index = readSourceCatalogIndexManifest();
  if (index) {
    const byShard = new Map();
    for (const sku of wanted) {
      const shard = skuShardName(sku);
      byShard.set(shard, [...(byShard.get(shard) || []), sku]);
    }
    for (const [shard, shardSkus] of byShard) {
      const shardPath = path.join(CATALOG_INDEX_SKU_DIR, `${shard}.ndjson`);
      if (!fs.existsSync(shardPath)) continue;
      const shardWanted = new Set(shardSkus);
      const rl = readline.createInterface({ input: fs.createReadStream(shardPath, { encoding: "utf8" }), crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line.trim()) continue;
        let row;
        try { row = JSON.parse(line); } catch { continue; }
        const sku = String(row[0] || "").toLowerCase();
        if (!shardWanted.has(sku)) continue;
        const product = await readCatalogProductAtOffset(row[1]);
        if (product) found.push(decorate(product));
        wanted.delete(sku);
        shardWanted.delete(sku);
        if (!shardWanted.size) {
          rl.close();
          break;
        }
      }
    }
    return found;
  }
  const rl = readline.createInterface({
    input: fs.createReadStream(CATALOG_FILE, { encoding: "utf8" }),
    crlfDelay: Infinity
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let product;
    try {
      product = JSON.parse(line);
    } catch {
      continue;
    }
    const key = String(product.sku || "").toLowerCase();
    if (wanted.has(key)) {
      found.push(decorate(product));
      wanted.delete(key);
      if (!wanted.size) {
        rl.close();
        break;
      }
    }
  }
  return found;
}

async function findSourceCatalogAlternatesBySkus(skus = [], db = {}) {
  const wanted = [...new Set(skus.map((sku) => String(sku || "").trim().toLowerCase()).filter(Boolean))];
  const result = Object.fromEntries(wanted.map((sku) => [sku, []]));
  if (!wanted.length || !fs.existsSync(CATALOG_FILE)) return result;
  const overrides = sourceCatalogOverrideMap(db);
  const vendorMappings = vendorCategoryMappingMap(db);
  const productsBySku = inventoryBySkuMap(db);
  const index = readSourceCatalogIndexManifest();
  if (index) {
    const byShard = new Map();
    for (const sku of wanted) {
      const shard = skuShardName(sku);
      byShard.set(shard, [...(byShard.get(shard) || []), sku]);
    }
    for (const [shard, shardSkus] of byShard) {
      const shardPath = path.join(CATALOG_INDEX_SKU_DIR, `${shard}.ndjson`);
      if (!fs.existsSync(shardPath)) continue;
      const shardWanted = new Set(shardSkus);
      const rl = readline.createInterface({ input: fs.createReadStream(shardPath, { encoding: "utf8" }), crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line.trim()) continue;
        let row;
        try { row = JSON.parse(line); } catch { continue; }
        const sku = String(row[0] || "").toLowerCase();
        if (!shardWanted.has(sku)) continue;
        const product = await readCatalogProductAtOffset(row[1]);
        if (!product) continue;
        const decorated = decorateSourceCatalogProduct(product, overrides, productsBySku, vendorMappings);
        if (!decorated.sourceCatalogDeleted) result[sku].push(catalogSummary(decorated));
      }
    }
    return result;
  }
  const wantedSet = new Set(wanted);
  const rl = readline.createInterface({
    input: fs.createReadStream(CATALOG_FILE, { encoding: "utf8" }),
    crlfDelay: Infinity
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let product;
    try { product = JSON.parse(line); } catch { continue; }
    const sku = String(product.sku || "").toLowerCase();
    if (!wantedSet.has(sku)) continue;
    const decorated = decorateSourceCatalogProduct(product, overrides, productsBySku, vendorMappings);
    if (!decorated.sourceCatalogDeleted) result[sku].push(catalogSummary(decorated));
  }
  return result;
}

async function annotateCatalogAlternateCounts(items = [], db = {}) {
  const skus = items.map((item) => item.sku).filter(Boolean);
  if (!skus.length) return items;
  const alternates = await findSourceCatalogAlternatesBySkus(skus, db);
  return items.map((item) => {
    const rows = alternates[String(item.sku || "").toLowerCase()] || [];
    const vendors = new Set(rows.map((row) => row.supplier || row.vendor || "").filter(Boolean).map((value) => String(value).toLowerCase()));
    return { ...item, alternateVendorCount: Math.max(0, vendors.size - 1) };
  });
}

async function scanCatalog({ query = "", page = 1, limit = 50, filters = {}, db = {} } = {}) {
  const pageNumber = Math.max(1, Number(page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(limit || 50)));
  const offset = (pageNumber - 1) * pageSize;
  const q = String(query || "").trim().toLowerCase();
  const exactSkuQuery = /^[a-z0-9_-]{6,}$/i.test(String(query || "").trim());
  const filtered = hasCatalogFilters(filters);
  const selectedSuppliers = String(filters.suppliers || filters.supplier || "").split("|").map((value) => value.trim()).filter(Boolean);
  const supplierIndexedFilter = selectedSuppliers.length >= 1 && !q;
  const supplierOnlyFilter = supplierIndexedFilter && [filters.active, filters.productMembership, filters.stockStatus, filters.hasStock, filters.hazardous, filters.brand, filters.category].every((value) => !value);
  const vendorIndex = supplierIndexedFilter ? readCatalogVendorIndex() : null;
  const supplierNames = new Set(selectedSuppliers.map((supplier) => supplier.toLowerCase()));
  const supplierTotal = supplierOnlyFilter
    ? (vendorIndex?.vendors || []).filter((row) => supplierNames.has(String(row.name || "").toLowerCase())).reduce((sum, row) => sum + Number(row.productCount || 0), 0)
    : 0;
  const maxScanRows = q && !filtered ? 50000 : Infinity;
  const result = {
    items: [],
    page: pageNumber,
    limit: pageSize,
    totalMatches: 0,
    hasMore: false,
    scanned: 0,
    partial: false,
    manifest: readCatalogManifest(),
    vendorIndex: supplierIndexedFilter ? vendorIndex : undefined
  };
  if (!fs.existsSync(CATALOG_FILE)) return result;
  const overrides = sourceCatalogOverrideMap(db);
  const vendorMappings = vendorCategoryMappingMap(db);
  const productsBySku = inventoryBySkuMap(db);
  const sourceIndex = supplierIndexedFilter ? readSourceCatalogIndexManifest() : null;
  if (sourceIndex) {
    const supplierRows = (sourceIndex.suppliers || []).filter((row) => supplierNames.has(String(row.name || "").toLowerCase()));
    if (supplierRows.length) {
      let matched = 0;
      let scanned = 0;
      for (const supplier of supplierRows) {
        const supplierPath = path.join(CATALOG_INDEX_DIR, supplier.file || "");
        if (!fs.existsSync(supplierPath)) continue;
        const rl = readline.createInterface({ input: fs.createReadStream(supplierPath, { encoding: "utf8" }), crlfDelay: Infinity });
        for await (const line of rl) {
          if (!line.trim()) continue;
          scanned += 1;
          let item;
          try { item = JSON.parse(line); } catch { continue; }
          item = decorateSourceCatalogProduct(item, overrides, productsBySku, vendorMappings);
          if (item.sourceCatalogDeleted) continue;
          if (!productMatchesCatalogFilters(item, filters)) continue;
          if (matched >= offset && result.items.length < pageSize) result.items.push(catalogSummary(item));
          matched += 1;
          if (supplierOnlyFilter && result.items.length >= pageSize && matched >= offset + pageSize) {
            rl.close();
            break;
          }
        }
        if (supplierOnlyFilter && result.items.length >= pageSize && matched >= offset + pageSize) break;
      }
      result.scanned = scanned;
      result.totalMatches = supplierOnlyFilter ? (supplierRows.reduce((sum, row) => sum + Number(row.productCount || 0), 0) || matched) : matched;
      result.items = await annotateCatalogAlternateCounts(result.items, db);
      result.hasMore = result.totalMatches > offset + result.items.length;
      result.indexed = true;
      return result;
    }
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(CATALOG_FILE, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    result.scanned += 1;
    if (!line.trim()) continue;
    let product;
    try {
      product = JSON.parse(line);
    } catch {
      continue;
    }
    if (Number.isFinite(maxScanRows) && result.scanned >= maxScanRows) {
      result.partial = true;
      rl.close();
      break;
    }
    product = decorateSourceCatalogProduct(product, overrides, productsBySku, vendorMappings);
    if (product.sourceCatalogDeleted) continue;
    if (q && !catalogSearchText(product).includes(q)) continue;
    if (!productMatchesCatalogFilters(product, filters)) continue;
    if (result.totalMatches >= offset && result.items.length < pageSize) {
      result.items.push(catalogSummary(product));
    }
    result.totalMatches += 1;
    if (exactSkuQuery && String(product.sku || "").toLowerCase() === q) {
      result.hasMore = false;
      rl.close();
      break;
    }
    if (q && !filtered && result.items.length >= pageSize) {
      result.hasMore = true;
      result.partial = true;
      rl.close();
      break;
    }
    if (supplierOnlyFilter && supplierTotal && result.items.length >= pageSize && result.totalMatches >= offset + pageSize) {
      result.totalMatches = supplierTotal;
      result.hasMore = supplierTotal > offset + result.items.length;
      rl.close();
      break;
    }
    if (!filtered && !q && result.items.length >= pageSize && result.totalMatches > offset + pageSize) {
      result.hasMore = true;
      rl.close();
      break;
    }
  }
  if (supplierOnlyFilter && supplierTotal) result.totalMatches = supplierTotal;
  if (!result.hasMore) result.hasMore = result.totalMatches > offset + result.items.length;
  if (!q && !hasCatalogFilters(filters) && result.manifest?.productCount) result.totalMatches = Number(result.manifest.productCount || result.totalMatches);
  result.items = await annotateCatalogAlternateCounts(result.items, db);
  return result;
}

async function collectCatalogProductsForExport({ query = "", filters = {}, limit = 10000, db = {} } = {}) {
  const maxItems = Math.min(25000, Math.max(1, Number(limit || 10000)));
  const q = String(query || "").trim().toLowerCase();
  const selectedSuppliers = String(filters.suppliers || filters.supplier || "").split("|").map((value) => value.trim()).filter(Boolean);
  const supplierIndexedFilter = selectedSuppliers.length >= 1 && !q;
  const supplierOnlyFilter = supplierIndexedFilter && [filters.active, filters.productMembership, filters.stockStatus, filters.hasStock, filters.hazardous, filters.brand, filters.category].every((value) => !value);
  const sourceIndex = supplierIndexedFilter ? readSourceCatalogIndexManifest() : null;
  const supplierNames = new Set(selectedSuppliers.map((supplier) => supplier.toLowerCase()));
  const items = [];
  let matched = 0;
  const overrides = sourceCatalogOverrideMap(db);
  const vendorMappings = vendorCategoryMappingMap(db);
  const productsBySku = inventoryBySkuMap(db);

  if (sourceIndex) {
    const supplierRows = (sourceIndex.suppliers || []).filter((row) => supplierNames.has(String(row.name || "").toLowerCase()));
    for (const supplier of supplierRows) {
      const supplierPath = path.join(CATALOG_INDEX_DIR, supplier.file || "");
      if (!fs.existsSync(supplierPath)) continue;
      const rl = readline.createInterface({ input: fs.createReadStream(supplierPath, { encoding: "utf8" }), crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line.trim()) continue;
        let item;
        try { item = JSON.parse(line); } catch { continue; }
        item = decorateSourceCatalogProduct(item, overrides, productsBySku, vendorMappings);
        if (item.sourceCatalogDeleted) continue;
        if (!productMatchesCatalogFilters(item, filters)) continue;
        matched += 1;
        items.push(catalogSummary(item));
        if (items.length >= maxItems) {
          rl.close();
          break;
        }
      }
      if (items.length >= maxItems) break;
    }
    return { items, matched: supplierRows.reduce((sum, row) => sum + Number(row.productCount || 0), 0) || matched, limited: items.length >= maxItems };
  }

  if (!fs.existsSync(CATALOG_FILE)) return { items, matched: 0, limited: false };
  const rl = readline.createInterface({
    input: fs.createReadStream(CATALOG_FILE, { encoding: "utf8" }),
    crlfDelay: Infinity
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let product;
    try {
      product = JSON.parse(line);
    } catch {
      continue;
    }
    product = decorateSourceCatalogProduct(product, overrides, productsBySku, vendorMappings);
    if (product.sourceCatalogDeleted) continue;
    if (q && !catalogSearchText(product).includes(q)) continue;
    if (!productMatchesCatalogFilters(product, filters)) continue;
    matched += 1;
    items.push(catalogSummary(product));
    if (items.length >= maxItems) {
      rl.close();
      break;
    }
  }
  return { items, matched, limited: items.length >= maxItems };
}

async function scanCatalogFacets() {
  const mtime = fs.existsSync(CATALOG_FILE) ? fs.statSync(CATALOG_FILE).mtimeMs : 0;
  const vendorIndex = readCatalogVendorIndex();
  if (catalogFacetCache && catalogFacetCache.mtime === mtime && catalogFacetCache.vendorIndexGeneratedAt === vendorIndex?.generatedAt) return catalogFacetCache.data;
  const result = {
    suppliers: new Set((vendorIndex?.vendors || vendorIndex?.suppliers || []).map((vendor) => typeof vendor === "string" ? vendor : vendor.name).filter(Boolean)),
    stockStatuses: new Set(),
    brands: new Set(),
    categories: new Set(),
    scanned: 0,
    manifest: readCatalogManifest(),
    vendorIndex
  };
  if (!fs.existsSync(CATALOG_FILE)) {
    return { suppliers: [...result.suppliers].sort((a, b) => a.localeCompare(b)), stockStatuses: [], brands: [], categories: [], scanned: 0, manifest: result.manifest, vendorIndex };
  }
  const maxRows = 50000;
  const rl = readline.createInterface({
    input: fs.createReadStream(CATALOG_FILE, { encoding: "utf8" }),
    crlfDelay: Infinity
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let product;
    try {
      product = JSON.parse(line);
    } catch {
      continue;
    }
    result.scanned += 1;
    if (product.supplier || product.vendor) result.suppliers.add(String(product.supplier || product.vendor));
    if (product.stockStatus) result.stockStatuses.add(String(product.stockStatus));
    if (product.brand) result.brands.add(formatBrandName(product.brand));
    if (product.category) result.categories.add(formatCategoryName(product.category));
    if (result.scanned >= maxRows) {
      rl.close();
      break;
    }
  }
  const sortValues = (set, limit = 500) => [...set].sort((a, b) => a.localeCompare(b)).slice(0, limit);
  const sortCategories = (set, limit = 500) => {
    const byKey = new Map();
    for (const value of set) {
      const formatted = formatCategoryName(value);
      if (!formatted) continue;
      byKey.set(formatted.toLowerCase(), formatted);
    }
    return [...byKey.values()].sort((a, b) => a.localeCompare(b)).slice(0, limit);
  };
  const sortBrands = (set, limit = 500) => {
    const byKey = new Map();
    const brandLabelScore = (label) => {
      const value = String(label || "");
      let score = value === value.toLowerCase() ? 0 : 1;
      if (/[A-Z]{2,}/.test(value) || /\b\d+[A-Z]+\b/.test(value)) score += 1;
      if (/^([A-Z]\.){2,}[A-Z]?\.?/.test(value)) score += 1;
      return score;
    };
    for (const value of set) {
      const formatted = formatBrandName(value);
      if (!formatted) continue;
      const key = formatted.toLowerCase();
      const current = byKey.get(key);
      if (!current || brandLabelScore(formatted) > brandLabelScore(current)) byKey.set(key, formatted);
    }
    return [...byKey.values()].sort((a, b) => a.localeCompare(b)).slice(0, limit);
  };
  const data = {
    suppliers: sortValues(result.suppliers, 10000),
    stockStatuses: sortValues(result.stockStatuses),
    brands: sortBrands(result.brands),
    categories: sortCategories(result.categories),
    scanned: result.scanned,
    manifest: result.manifest,
    vendorIndex: result.vendorIndex
  };
  catalogFacetCache = { mtime, vendorIndexGeneratedAt: vendorIndex?.generatedAt, data };
  return data;
}

async function findCatalogProductBySku(sku, db = {}) {
  const key = String(sku || "").trim().toLowerCase();
  if (!key || !fs.existsSync(CATALOG_FILE)) return null;
  const overrides = sourceCatalogOverrideMap(db);
  const vendorMappings = vendorCategoryMappingMap(db);
  const productsBySku = inventoryBySkuMap(db);
  const rl = readline.createInterface({
    input: fs.createReadStream(CATALOG_FILE, { encoding: "utf8" }),
    crlfDelay: Infinity
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let product;
    try {
      product = JSON.parse(line);
    } catch {
      continue;
    }
    if (String(product.sku || "").toLowerCase() === key) {
      rl.close();
      return decorateSourceCatalogProduct(product, overrides, productsBySku, vendorMappings);
    }
  }
  return null;
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split("/").filter(Boolean);

  if (postgres.isPostgresEnabled() && parts[0] === "api" && parts[1] === "export-mappings" && !parts[3]) {
    let exportMappings = normalizeExportMappings(await postgres.readStateField("exportMappings"));
    if (req.method === "GET" && parts.length === 2) {
      return sendJson(res, 200, { exportMappings });
    }
    if (req.method === "POST" && parts.length === 2) {
      const body = await parseBody(req);
      const template = normalizeExportMapping({
        name: body.name || `${body.source || "Custom"} Product Mapping`,
        source: body.source || "Custom",
        mode: body.mode || "both",
        mappings: body.mappings || [
          { externalColumn: "SKU", productField: "sku" },
          { externalColumn: "Title", productField: "title" },
          { externalColumn: "Price", productField: "price" }
        ],
        notes: body.notes || ""
      });
      exportMappings.unshift(template);
      await postgres.writeStateField("exportMappings", exportMappings);
      return sendJson(res, 200, { template, exportMappings });
    }
    if (req.method === "PATCH" && parts[2]) {
      const body = await parseBody(req);
      const template = exportMappings.find((row) => row.id === parts[2]);
      if (!template) return notFound(res);
      for (const field of ["name", "source", "mode", "status", "notes"]) {
        if (body[field] !== undefined) template[field] = String(body[field] || "").trim();
      }
      if (body.mappings !== undefined) template.mappings = parseMappingRows(body.mappings).map(normalizeExportMappingRow).filter((row) => row.externalColumn);
      template.updatedAt = new Date().toISOString();
      exportMappings = normalizeExportMappings(exportMappings);
      await postgres.writeStateField("exportMappings", exportMappings);
      return sendJson(res, 200, { template: normalizeExportMapping(template), exportMappings });
    }
    if (req.method === "DELETE" && parts[2]) {
      if (DEFAULT_EXPORT_MAPPINGS.some((defaults) => defaults.id === parts[2])) {
        return sendJson(res, 400, { error: "Built-in mappings can be deactivated or duplicated, but not deleted." });
      }
      const before = exportMappings.length;
      exportMappings = exportMappings.filter((row) => row.id !== parts[2]);
      if (exportMappings.length === before) return notFound(res);
      await postgres.writeStateField("exportMappings", exportMappings);
      return sendJson(res, 200, { exportMappings });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/product-fields") {
    return sendJson(res, 200, { fields: PRODUCT_MAPPING_FIELDS });
  }

  const db = await readDb();

  if (req.method === "GET" && url.pathname === "/api/state") {
    return sendJson(res, 200, publicState(db));
  }

  if (req.method === 'GET' && url.pathname === '/api/import-jobs') {
    db.importJobs = normalizeImportJobs(db.importJobs, db.syncRuns);
    return sendJson(res, 200, { importJobs: db.importJobs });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "import-jobs" && parts[2] && parts[3] === "stop") {
    const job = findImportJob(db, parts[2]);
    if (!job) return notFound(res);
    if (!["queued", "running"].includes(String(job.status || "").toLowerCase())) {
      return sendJson(res, 400, { error: "Only queued or running jobs can be stopped." });
    }
    finishImportJob(job, {
      status: "stopped",
      message: job.message || "Job was stopped.",
      details: [job.details, "Stopped by user from Jobs profile."].filter(Boolean).join(" ")
    });
    await writeDb(db);
    const normalized = normalizeDb(db);
    return sendJson(res, 200, { job: normalized.importJobs.find((row) => row.id === job.id) || job, importJobs: normalized.importJobs });
  }

  if (req.method === "GET" && parts[0] === "api" && parts[1] === "import-jobs" && parts[2] && parts[3]) {
    const job = findImportJob(db, parts[2]);
    if (!job) return notFound(res);
    if (parts[3] === "original") {
      if (sendImportJobFile(res, job, "original")) return;
      return sendJson(res, 404, { error: "Original file was not saved for this job." });
    }
    if (parts[3] === "errors.csv") {
      if (sendImportJobFile(res, job, "errors")) return;
      const rows = (job.errors || []).map((error) => ({ error }));
      if (!rows.length) return sendJson(res, 404, { error: "This job has no errors." });
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=${safeImportFileName(job.errorFileName || "errors.csv")}`
      });
      return res.end(rowsToCsv(rows));
    }
  }

  if (req.method === "GET" && url.pathname === "/api/catalog/products") {
    const result = await scanCatalog({
      query: url.searchParams.get("q") || "",
      page: url.searchParams.get("page") || 1,
      limit: url.searchParams.get("limit") || 50,
      filters: catalogFilterParams(url.searchParams),
      db
    });
    return sendJson(res, 200, result);
  }

  if (req.method === "GET" && url.pathname === "/api/catalog/facets") {
    return sendJson(res, 200, await scanCatalogFacets());
  }

  if (req.method === "GET" && url.pathname === "/api/catalog/alternates") {
    const skus = String(url.searchParams.get("skus") || url.searchParams.get("sku") || "")
      .split(",")
      .map((sku) => sku.trim())
      .filter(Boolean)
      .slice(0, 100);
    const alternates = await findSourceCatalogAlternatesBySkus(skus, db);
    return sendJson(res, 200, { alternates });
  }
  if (req.method === "GET" && url.pathname === "/api/categories") {
    return sendJson(res, 200, publicCategories(db, url.searchParams.get("q") || "", url.searchParams.get("scope") || "source"));
  }

  if (req.method === "GET" && parts[0] === "api" && parts[1] === "categories" && parts[2] === "coverage" && parts[3]) {
    const issue = String(parts[3] || "").replace(/\.csv$/i, "");
    const rows = categoryCoverageRows(db, issue);
    const filename = `${coverageIssueLabel(issue)}.csv`;
    if (String(parts[3] || "").toLowerCase().endsWith(".csv") || url.searchParams.get("format") === "csv") {
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=${filename}`
      });
      return res.end(rowsToCsv(rows));
    }
    return sendJson(res, 200, { issue, label: coverageIssueLabel(issue), rows, total: rows.length, filename });
  }

  if (req.method === "POST" && url.pathname === "/api/categories/import-sku-csv") {
    const body = await parseBody(req);
    const records = parseCsv(body.csv || "");
    const inventoryBySku = inventoryBySkuMap(db);
    const overrides = sourceCatalogOverrideMap(db);
    const vendorMappings = vendorCategoryMappingMap(db);
    const now = new Date().toISOString();
    const dryRun = body.dryRun === true || String(body.dryRun).toLowerCase() === "true";
    const job = dryRun ? null : createImportJob(db, {
      section: "Categories",
      operation: "SKU category import",
      direction: "import",
      fileName: body.fileName || "sku-categories.csv",
      totalRows: records.length,
      message: `Importing ${records.length} SKU category row${records.length === 1 ? "" : "s"}.`
    });
    if (job) attachImportJobOriginalFile(job, body.csv || "", body.fileName || "sku-categories.csv");
    const seen = new Set();
    const rowInfos = [];
    const errorRows = [];
    let updatedProducts = 0;
    let updatedSourceOverrides = 0;
    let updatedVendorCategoryMappings = 0;
    let vendorCategoryConflicts = 0;
    let skipped = 0;
    const samples = [];
    for (const record of records) {
      const sku = sourceTextValue(record.sku || record.SKU || record.Sku || record["Variant SKU"] || record["variant sku"]);
      const category = formatCategoryName(record.category || record.Category || record.internalCategory || record["Internal Category"] || record["product category"] || record["Product Category"]);
      if (!sku || !category) {
        skipped += 1;
        errorRows.push(standardImportError({
          record,
          sku,
          category,
          field: !sku ? "sku" : "category",
          issue: "Missing SKU or category",
          rawValue: JSON.stringify(record)
        }));
        continue;
      }
      const key = sku.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rowInfos.push({ sku, key, category, record });
    }
    const sourceProducts = await findCatalogProductsBySkus(rowInfos.map((row) => row.sku), db);
    const sourceBySku = new Map(sourceProducts.map((product) => [String(product.sku || "").toLowerCase(), product]));
    for (const { sku, key, category, record } of rowInfos) {
      const existing = inventoryBySku.get(key);
      if (existing && !dryRun) {
        if (!existing.sourceCategory && existing.category && !existing.categoryVerified) existing.sourceCategory = existing.category;
        if (existing.category !== category) {
          existing.category = category;
          existing.mainCategory = category;
          existing.categoryVerified = true;
          existing.updatedAt = now;
          updatedProducts += 1;
        }
        existing.vendorCategory = existing.sourceCategory || existing.vendorCategory || "";
      } else if (existing) {
        updatedProducts += existing.category !== category ? 1 : 0;
      }
      if (!dryRun) overrides[key] = { ...(overrides[key] || { sku }), sku, category, categoryVerified: true, updatedAt: now };
      updatedSourceOverrides += 1;
      const sourceProduct = sourceBySku.get(key);
      const supplier = sourceTextValue(existing?.supplier || existing?.vendor || sourceProduct?.supplier || sourceProduct?.vendor);
      const vendorCategory = formatCategoryName(existing?.sourceCategory || existing?.vendorCategory || sourceProduct?.sourceCategory || sourceProduct?.vendorCategory || "");
      const mappingKey = vendorCategoryMappingKey(supplier, vendorCategory);
      if (mappingKey) {
        const currentMapping = vendorMappings[mappingKey];
        if (currentMapping && formatCategoryName(currentMapping.mainCategory).toLowerCase() !== category.toLowerCase()) {
          vendorCategoryConflicts += 1;
          errorRows.push(standardImportError({
            record,
            recordKey: sku,
            sku,
            supplier,
            category,
            field: "category",
            issue: "Vendor category mapping conflict",
            rawValue: vendorCategory,
            details: `Vendor category "${vendorCategory}" is already learned as "${currentMapping.mainCategory}".`,
            vendor_category: vendorCategory,
            existing_main_category: currentMapping.mainCategory,
            incoming_main_category: category
          }));
          if (!dryRun) {
            currentMapping.conflictCount = Number(currentMapping.conflictCount || 0) + 1;
            currentMapping.updatedAt = now;
          }
        } else {
          if (!dryRun) {
            vendorMappings[mappingKey] = {
              ...(currentMapping || {}),
              supplier,
              vendorCategory,
              mainCategory: category,
              categoryVerified: true,
              source: "sku-category-import",
              sampleSku: currentMapping?.sampleSku || sku,
              matchCount: Number(currentMapping?.matchCount || 0) + 1,
              updatedAt: now,
              createdAt: currentMapping?.createdAt || now
            };
          }
          updatedVendorCategoryMappings += currentMapping ? 0 : 1;
        }
      }
      if (samples.length < 10) samples.push({ sku, category, vendorCategory, supplier, inProducts: Boolean(existing) });
    }
    if (dryRun) {
      return sendJson(res, 200, {
        requested: records.length,
        changed: seen.size,
        updatedProducts,
        updatedSourceOverrides,
        updatedVendorCategoryMappings,
        vendorCategoryConflicts,
        skipped,
        samples,
        dryRun: true
      });
    }
    db.sourceCatalogOverrides = overrides;
    db.vendorCategoryMappings = vendorMappings;
    attachImportJobErrorsFile(job, errorRows);
    finishImportJob(job, {
      status: errorRows.length ? "warning" : "success",
      message: `Imported ${seen.size} SKU category mapping${seen.size === 1 ? "" : "s"}.`,
      totalRows: records.length,
      changed: seen.size,
      missingCount: skipped,
      errors: importErrorMessages(errorRows)
    });
    db.syncRuns = Array.isArray(db.syncRuns) ? db.syncRuns : [];
    db.syncRuns.unshift({
      id: crypto.randomUUID(),
      importJobId: job?.id,
      source: "CSV",
      type: "sku-category-import",
      status: errorRows.length ? "warning" : "success",
      fileName: body.fileName || "sku-categories.csv",
      message: `Imported ${seen.size} SKU category mapping${seen.size === 1 ? "" : "s"}.`,
      createdAt: now
    });
    catalogFacetCache = null;
    const normalized = normalizeDb(db);
    await writeDb(normalized);
    return sendJson(res, 200, {
      requested: records.length,
      changed: seen.size,
      updatedProducts,
      updatedSourceOverrides,
      updatedVendorCategoryMappings,
      vendorCategoryConflicts,
      skipped,
      samples,
      state: publicState(normalized),
      categories: publicCategories(normalized, "", "main")
    });
  }

  if (req.method === "POST" && url.pathname === "/api/categories/import-mapping-csv") {
    const body = await parseBody(req);
    const records = parseCsv(body.csv || "");
    const now = new Date().toISOString();
    const dryRun = body.dryRun === true || String(body.dryRun).toLowerCase() === "true";
    const job = dryRun ? null : createImportJob(db, {
      section: "Categories",
      operation: "Shopify category mapping import",
      direction: "import",
      fileName: body.fileName || "category-mapping.csv",
      totalRows: records.length,
      message: `Importing ${records.length} category mapping row${records.length === 1 ? "" : "s"}.`
    });
    if (job) attachImportJobOriginalFile(job, body.csv || "", body.fileName || "category-mapping.csv");
    let changed = 0;
    let skipped = 0;
    const errorRows = [];
    const samples = [];
    for (const record of records) {
      const categoryName = formatCategoryName(csvValue(record, ["category", "Category", "mainCategory", "Main Category", "internalCategory", "Internal Category", "product category", "Product Category"]));
      if (!categoryName) {
        skipped += 1;
        errorRows.push(standardImportError({
          record,
          field: "category",
          issue: "Missing category",
          rawValue: JSON.stringify(record)
        }));
        continue;
      }
      const shopifyCategoryId = csvValue(record, ["shopify_category_id", "shopifyCategoryId", "Shopify Category ID", "Shopify ID", "shopify id", "shopify_id"]);
      const shopifyCategoryPath = csvValue(record, ["shopify_category", "shopify_category_path", "shopifyCategory", "shopifyCategoryPath", "Shopify Category", "Shopify Category Path", "Shopify Path", "shopify path", "shopify", "Shopify", "SHOPIFY"]);
      const shopifyCategoryHandle = csvValue(record, ["shopify_category_handle", "shopifyCategoryHandle", "Shopify Category Handle", "shopify handle"]);
      const shopifyCollectionHandle = csvValue(record, ["collection_handle", "collectionHandle", "Collection Handle", "shopify_collection_handle"]);
      const googleCategoryId = csvValue(record, ["google_category_id", "googleCategoryId", "Google Category ID", "Google ID", "google id"]);
      const googleCategoryPath = csvValue(record, ["google_category_path", "googleCategoryPath", "Google Category Path", "Google Path", "google_product_category", "google product category"]);
      const notes = csvValue(record, ["notes", "Notes"]);
      const owner = csvValue(record, ["owner", "Owner"]);
      const status = csvValue(record, ["status", "Status"]);
      if (!shopifyCategoryId && !shopifyCategoryPath && !shopifyCollectionHandle && !googleCategoryId && !googleCategoryPath) {
        skipped += 1;
        errorRows.push(standardImportError({
          record,
          category: categoryName,
          field: "shopify_category",
          issue: "Missing Shopify/Google mapping",
          rawValue: JSON.stringify(record)
        }));
        continue;
      }
      let mapping = {
        categoryId: shopifyCategoryId,
        categoryPath: shopifyCategoryPath,
        categoryHandle: shopifyCategoryHandle,
        collectionHandle: shopifyCollectionHandle,
        googleCategory: (googleCategoryId || googleCategoryPath) ? {
          id: googleCategoryId,
          fullName: googleCategoryPath,
          breadcrumb: googleCategoryPath,
          taxonomy: "Google Product Taxonomy"
        } : null,
        notes
      };
      if (shopifyCategoryId || shopifyCategoryPath) mapping = enrichShopifyCategoryMapping(mapping);
      if (!dryRun) {
        const category = findOrCreateCategorySetting(db, categoryName);
        category.mappings.shopify = normalizeChannelCategoryMapping({ ...category.mappings.shopify, ...mapping });
        category.status = status || "mapped";
        if (owner) category.owner = owner;
        if (notes) category.notes = notes;
        category.updatedAt = now;
      }
      changed += 1;
      if (samples.length < 10) samples.push({ category: categoryName, shopifyCategoryId: mapping.categoryId || "", shopifyCategoryPath: mapping.categoryPath || "", googleCategory: mapping.googleCategory?.breadcrumb || "" });
    }
    if (dryRun) {
      return sendJson(res, 200, { requested: records.length, changed, skipped, samples, dryRun: true });
    }
    attachImportJobErrorsFile(job, errorRows);
    finishImportJob(job, {
      status: errorRows.length ? "warning" : "success",
      message: `Imported ${changed} category mapping${changed === 1 ? "" : "s"}.`,
      totalRows: records.length,
      changed,
      missingCount: skipped,
      errors: importErrorMessages(errorRows)
    });
    db.syncRuns = Array.isArray(db.syncRuns) ? db.syncRuns : [];
    db.syncRuns.unshift({
      id: crypto.randomUUID(),
      importJobId: job?.id,
      source: "CSV",
      type: "category-mapping-import",
      status: errorRows.length ? "warning" : "success",
      fileName: body.fileName || "category-mapping.csv",
      message: `Imported ${changed} category mapping${changed === 1 ? "" : "s"}.`,
      createdAt: now
    });
    const normalized = normalizeDb(db);
    await writeDb(normalized);
    return sendJson(res, 200, {
      requested: records.length,
      changed,
      skipped,
      samples,
      state: publicState(normalized),
      categories: publicCategories(normalized, "", "main")
    });
  }

  if (req.method === "GET" && url.pathname === "/api/channel-taxonomies/shopify/categories") {
    return sendJson(res, 200, searchShopifyTaxonomy(url.searchParams.get("q") || "", url.searchParams.get("limit") || 20));
  }

  if (req.method === "PATCH" && parts[0] === "api" && parts[1] === "categories" && parts[2]) {
    const body = await parseBody(req);
    const scope = body.scope || url.searchParams.get("scope") || "source";
    const source = findPublicCategory(db, parts[2], scope);
    if (!source) return notFound(res);
    db.categorySettings = normalizeCategorySettings(db.categorySettings);
    let category = db.categorySettings.find((row) => row.categoryId === source.id || row.id === source.id || formatCategoryName(row.name).toLowerCase() === formatCategoryName(source.name).toLowerCase());
    if (!category) {
      category = normalizeCategorySettings([{ categoryId: source.id, name: source.name }])[0];
      db.categorySettings.push(category);
    }
    for (const field of ["status", "owner", "notes"]) {
      if (body[field] !== undefined) category[field] = String(body[field] || "").trim();
    }
    if (body.channel && body.mapping && category.mappings[body.channel]) {
      let mapping = { ...body.mapping };
      if (body.channel === "shopify" && mapping.categoryId) {
        mapping = enrichShopifyCategoryMapping(mapping);
      }
      category.mappings[body.channel] = normalizeChannelCategoryMapping({ ...category.mappings[body.channel], ...mapping });
    }
    if (body.defaults && typeof body.defaults === "object") {
      category.defaults = normalizeCategorySettings([{ ...category, defaults: { ...category.defaults, ...body.defaults } }])[0].defaults;
    }
    if (body.requiredAttributes !== undefined) {
      category.requiredAttributes = Array.isArray(body.requiredAttributes) ? body.requiredAttributes : String(body.requiredAttributes || "").split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
    }
    category.updatedAt = new Date().toISOString();
    await writeDb(db);
    return sendJson(res, 200, publicCategories(db, url.searchParams.get("q") || "", scope));
  }

  if (req.method === "POST" && url.pathname === "/api/catalog/promote") {
    const body = await parseBody(req);
    const product = await findCatalogProductBySku(body.sku, db);
    if (!product) return notFound(res);
    const upserted = upsertInventoryProductFromCatalog(db, product);
    const normalized = normalizeDb(db);
    await writeDb(normalized);
    const promoted = normalized.inventory.find((item) => String(item.sku || "").toLowerCase() === String(product.sku || "").toLowerCase());
    return sendJson(res, 200, { item: promoted, state: publicState(normalized), existing: upserted.existing });
  }

  if (req.method === "POST" && url.pathname === "/api/catalog/promote-bulk") {
    const body = await parseBody(req);
    const skus = Array.isArray(body.skus) ? body.skus.slice(0, 5000) : [];
    const products = await findCatalogProductsBySkus(skus, db);
    for (const product of products) upsertInventoryProductFromCatalog(db, product);
    const normalized = normalizeDb(db);
    await writeDb(normalized);
    return sendJson(res, 200, { changed: products.length, state: publicState(normalized) });
  }

  if (req.method === 'POST' && url.pathname === '/api/catalog/promote-csv') {
    const body = await parseBody(req);
    const records = parseCsv(body.csv || '');
    const skusFromRecords = records.flatMap((record) => [
      record.sku,
      record.SKU,
      record.Sku,
      record['Variant SKU'],
      record['variant sku'],
      record['Vendor SKU'],
      record.vendorSku
    ]).filter(Boolean);
    const skus = skusFromRecords.length
      ? skusFromRecords
      : String(body.csv || '').split(/[\r\n,;\t]+/)
        .map((value) => value.trim())
        .filter(Boolean)
        .filter((value) => !['sku', 'variant sku', 'vendor sku'].includes(value.toLowerCase()));
    const uniqueSkus = [...new Set(skus.map((sku) => String(sku || '').trim()).filter(Boolean))].slice(0, 10000);
    const skuMeta = new Map();
    for (const record of records) {
      const sku = String(record.sku || record.SKU || record.Sku || record['Variant SKU'] || record['variant sku'] || record['Vendor SKU'] || record.vendorSku || '').trim();
      if (sku && !skuMeta.has(sku.toLowerCase())) skuMeta.set(sku.toLowerCase(), { record, row: csvRecordRow(record) });
    }
    if (!skuMeta.size) {
      String(body.csv || '').split(/\r?\n/).forEach((line, index) => {
        const sku = line.trim();
        if (sku && !['sku', 'variant sku', 'vendor sku'].includes(sku.toLowerCase()) && !skuMeta.has(sku.toLowerCase())) {
          skuMeta.set(sku.toLowerCase(), { row: index + 1, rawValue: line });
        }
      });
    }
    const job = createImportJob(db, {
      section: 'Source Catalog',
      operation: 'Add SKUs CSV to products',
      direction: 'import',
      fileName: body.fileName || 'source-skus.csv',
      totalRows: uniqueSkus.length,
      message: `Moving ${uniqueSkus.length} source SKU${uniqueSkus.length === 1 ? '' : 's'} into Products.`
    });
    attachImportJobOriginalFile(job, body.csv || '', body.fileName || 'source-skus.csv');
    const products = await findCatalogProductsBySkus(uniqueSkus, db);
    const found = new Set(products.map((product) => String(product.sku || '').toLowerCase()));
    for (const product of products) upsertInventoryProductFromCatalog(db, product);
    const missing = uniqueSkus.filter((sku) => !found.has(String(sku || '').toLowerCase()));
    const errorRows = missing.map((sku) => {
      const meta = skuMeta.get(String(sku || '').toLowerCase()) || {};
      return standardImportError({
        record: meta.record,
        row: meta.row,
        sku,
        field: 'sku',
        issue: 'SKU not found in source catalog',
        rawValue: meta.rawValue || sku
      });
    });
    attachImportJobErrorsFile(job, errorRows);
    finishImportJob(job, {
      status: missing.length ? 'warning' : 'success',
      message: `Added ${products.length} of ${uniqueSkus.length} source SKU${uniqueSkus.length === 1 ? '' : 's'} to Products.`,
      changed: products.length,
      totalRows: uniqueSkus.length,
      missingCount: missing.length,
      errors: importErrorMessages(errorRows)
    });
    const normalized = normalizeDb(db);
    await writeDb(normalized);
    return sendJson(res, 200, {
      requested: uniqueSkus.length,
      changed: products.length,
      missing: missing.slice(0, 100),
      job: normalized.importJobs.find((row) => row.id === job.id) || job,
      state: publicState(normalized)
    });
  }

  if (req.method === "POST" && url.pathname === "/api/catalog/bulk") {
    const body = await parseBody(req);
    const action = String(body.action || "");
    const skus = [...new Set((Array.isArray(body.skus) ? body.skus : []).map((sku) => String(sku || "").trim()).filter(Boolean))].slice(0, 25000);
    if (!skus.length) return sendJson(res, 400, { error: "Select source catalog products first." });
    if (action === "add-active") {
      const products = await findCatalogProductsBySkus(skus, db);
      for (const product of products) upsertInventoryProductFromCatalog(db, product);
      const normalized = normalizeDb(db);
      await writeDb(normalized);
      return sendJson(res, 200, { changed: products.length, state: publicState(normalized) });
    }
    const statusByAction = {
      "set-active": { status: "Active", active: true, deleted: false },
      "set-inactive": { status: "Inactive", active: false, deleted: false },
      "set-discontinued": { status: "Discontinued", active: false, deleted: false },
      delete: { status: "Deleted", active: false, deleted: true }
    };
    const patch = statusByAction[action];
    if (!patch) return sendJson(res, 400, { error: "Unsupported source catalog action." });
    const overrides = sourceCatalogOverrideMap(db);
    const now = new Date().toISOString();
    for (const sku of skus) {
      const key = sku.toLowerCase();
      overrides[key] = { ...(overrides[key] || { sku }), sku, ...patch, updatedAt: now };
    }
    const normalized = normalizeDb(db);
    await writeDb(normalized);
    return sendJson(res, 200, { changed: skus.length, state: publicState(normalized) });
  }

  if (req.method === "POST" && url.pathname === "/api/catalog/export") {
    const body = await parseBody(req);
    db.exportMappings = normalizeExportMappings(db.exportMappings);
    const template = db.exportMappings.find((row) => row.id === body.mappingId);
    if (!template) return sendJson(res, 404, { error: "Export mapping not found." });
    if (!(template.mappings || []).length) return sendJson(res, 400, { error: "Template has no mapped columns." });
    const skus = Array.isArray(body.skus)
      ? [...new Set(body.skus.map((sku) => String(sku || "").trim()).filter(Boolean))].slice(0, 100000)
      : [];
    let items = [];
    let matched = 0;
    let limited = false;
    if (skus.length) {
      items = await findCatalogProductsBySkus(skus, db);
      matched = items.length;
    } else {
      const result = await collectCatalogProductsForExport({
        query: body.query || "",
        filters: body.filters || {},
        limit: body.limit || 10000,
        db
      });
      items = result.items;
      matched = result.matched;
      limited = result.limited;
    }
    return sendJson(res, 200, {
      filename: mappedExportFilename(template),
      csv: mappedProductsCsv(db, template, items),
      count: items.length,
      matched,
      limited
    });
  }

  if (req.method === "POST" && url.pathname === "/api/inventory/bulk") {
    const body = await parseBody(req);
    const ids = new Set(Array.isArray(body.ids) ? body.ids : []);
    const action = String(body.action || "");
    let changed = 0;
    if (action === "delete") {
      const before = db.inventory.length;
      db.inventory = db.inventory.filter((item) => !ids.has(item.id));
      changed = before - db.inventory.length;
    } else {
      const statusByAction = {
        "set-active": "Active",
        "set-inactive": "Inactive",
        "set-discontinued": "Discontinued"
      };
      const status = statusByAction[action];
      if (!status) return sendJson(res, 400, { error: "Unsupported bulk action." });
      for (const item of db.inventory || []) {
        if (!ids.has(item.id)) continue;
        item.status = status;
        item.active = status === "Active";
        item.updatedAt = new Date().toISOString();
        changed += 1;
      }
    }
    const normalized = normalizeDb(db);
    await writeDb(normalized);
    return sendJson(res, 200, { changed, state: publicState(normalized) });
  }

  if (req.method === "POST" && url.pathname === "/api/temu/exchange-code") {
    const body = await parseBody(req);
    const result = await exchangeTemuCode(db, body.code);
    const normalized = normalizeDb(await readDb());
    return sendJson(res, 200, { ...result, state: publicState(normalized) });
  }

  if (req.method === "GET" && url.pathname === "/api/ebay/auth-url") {
    const authUrl = ebayConsentUrl(db);
    await writeDb(db);
    return sendJson(res, 200, { authUrl });
  }

  if (req.method === "GET" && url.pathname === "/api/export-mappings") {
    db.exportMappings = normalizeExportMappings(db.exportMappings);
    return sendJson(res, 200, { exportMappings: db.exportMappings });
  }

  if (req.method === "POST" && url.pathname === "/api/export-mappings") {
    const body = await parseBody(req);
    db.exportMappings = normalizeExportMappings(db.exportMappings);
    const template = normalizeExportMapping({
      name: body.name || `${body.source || "Custom"} Product Mapping`,
      source: body.source || "Custom",
      mode: body.mode || "both",
      mappings: body.mappings || [
        { externalColumn: "SKU", productField: "sku" },
        { externalColumn: "Title", productField: "title" },
        { externalColumn: "Price", productField: "price" },
        { externalColumn: "Quantity", productField: "available" }
      ],
      notes: body.notes || ""
    });
    db.exportMappings.unshift(template);
    await writeDb(db);
    return sendJson(res, 200, { template, exportMappings: db.exportMappings });
  }

  if (req.method === "PATCH" && parts[0] === "api" && parts[1] === "export-mappings" && parts[2]) {
    const body = await parseBody(req);
    db.exportMappings = normalizeExportMappings(db.exportMappings);
    const template = db.exportMappings.find((row) => row.id === parts[2]);
    if (!template) return notFound(res);
    for (const field of ["name", "source", "mode", "status", "notes"]) {
      if (body[field] !== undefined) template[field] = String(body[field] || "").trim();
    }
    if (body.mappings !== undefined) template.mappings = parseMappingRows(body.mappings).map(normalizeExportMappingRow).filter((row) => row.externalColumn);
    template.updatedAt = new Date().toISOString();
    await writeDb(db);
    db.exportMappings = normalizeExportMappings(db.exportMappings);
    return sendJson(res, 200, { template: normalizeExportMapping(template), exportMappings: db.exportMappings });
  }

  if (req.method === "DELETE" && parts[0] === "api" && parts[1] === "export-mappings" && parts[2]) {
    db.exportMappings = normalizeExportMappings(db.exportMappings);
    if (DEFAULT_EXPORT_MAPPINGS.some((defaults) => defaults.id === parts[2])) {
      return sendJson(res, 400, { error: "Built-in mappings can be deactivated or duplicated, but not deleted." });
    }
    const before = db.exportMappings.length;
    db.exportMappings = db.exportMappings.filter((row) => row.id !== parts[2]);
    if (db.exportMappings.length === before) return notFound(res);
    await writeDb(db);
    db.exportMappings = normalizeExportMappings(db.exportMappings);
    return sendJson(res, 200, { exportMappings: db.exportMappings });
  }

  if (req.method === "GET" && parts[0] === "api" && parts[1] === "export-mappings" && parts[2] && parts[3] === "export") {
    db.exportMappings = normalizeExportMappings(db.exportMappings);
    const template = db.exportMappings.find((row) => row.id === parts[2]);
    if (!template) return notFound(res);
    if (!(template.mappings || []).length) return sendJson(res, 400, { error: "Template has no mapped columns." });
    const skus = new Set(String(url.searchParams.get("skus") || "").split(",").map((sku) => sku.trim()).filter(Boolean).map((sku) => sku.toLowerCase()));
    const items = skus.size ? db.inventory.filter((item) => skus.has(String(item.sku || "").toLowerCase())) : db.inventory;
    const csv = mappedProductsCsv(db, template, items);
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=${mappedExportFilename(template)}`
    });
    return res.end(csv);
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "export-mappings" && parts[2] && parts[3] === "export") {
    const body = await parseBody(req);
    db.exportMappings = normalizeExportMappings(db.exportMappings);
    const template = db.exportMappings.find((row) => row.id === parts[2]);
    if (!template) return notFound(res);
    if (!(template.mappings || []).length) return sendJson(res, 400, { error: "Template has no mapped columns." });
    const skus = new Set((Array.isArray(body.skus) ? body.skus : []).map((sku) => String(sku || "").trim().toLowerCase()).filter(Boolean));
    const items = skus.size ? db.inventory.filter((item) => skus.has(String(item.sku || "").toLowerCase())) : db.inventory;
    return sendJson(res, 200, { filename: mappedExportFilename(template), csv: mappedProductsCsv(db, template, items), count: items.length });
  }

  if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'export-mappings' && parts[2] && parts[3] === 'import') {
    const body = await parseBody(req);
    db.exportMappings = normalizeExportMappings(db.exportMappings);
    const template = db.exportMappings.find((row) => row.id === parts[2]);
    if (!template) return notFound(res);
    const records = parseCsv(body.csv || '');
    const skuMapping = (template.mappings || []).find((mapping) => mapping.productField === 'sku');
    if (!skuMapping) return sendJson(res, 400, { error: 'Template needs a mapped SKU column before importing.' });
    const job = body.dryRun ? null : createImportJob(db, {
      section: 'Products',
      operation: `${template.name} import`,
      direction: 'import',
      fileName: body.fileName || `${template.source || 'products'}.csv`,
      totalRows: records.length,
      message: `Importing ${records.length} row${records.length === 1 ? '' : 's'} with ${template.name}.`
    });
    if (job) attachImportJobOriginalFile(job, body.csv || '', body.fileName || `${template.source || 'products'}.csv`);
    let changed = 0;
    let created = 0;
    const preview = [];
    const errorRows = [];
    for (const record of records) {
      const sku = String(record[skuMapping.externalColumn] || '').trim();
      if (!sku) {
        errorRows.push(standardImportError({
          record,
          field: skuMapping.externalColumn || 'sku',
          issue: 'Missing SKU',
          rawValue: JSON.stringify(record)
        }));
        continue;
      }
      const payload = mappedRecordToProductPayload(record, template);
      payload.sku = sku;
      const existing = db.inventory.find((item) => String(item.sku || '').toLowerCase() === sku.toLowerCase());
      if (body.dryRun) {
        preview.push({ sku, action: existing ? 'update' : 'create', fields: Object.keys(payload).filter((field) => field !== 'sku') });
        continue;
      }
      if (existing) {
        applyInventoryPatch(existing, payload);
        if (payload.brand !== undefined && payload.brandLocked === undefined) existing.brandLocked = true;
        existing.updatedAt = new Date().toISOString();
      } else {
        db.inventory.push({
          id: crypto.randomUUID(),
          title: payload.title || sku,
          qty: Number(payload.qty || 0),
          reserved: Number(payload.reserved || 0),
          reorderPoint: Number(payload.reorderPoint || 0),
          sources: {},
          updatedAt: new Date().toISOString(),
          brandLocked: payload.brand !== undefined ? true : Boolean(payload.brandLocked),
          ...payload
        });
        created += 1;
      }
      changed += 1;
    }
    if (body.dryRun) return sendJson(res, 200, { changed: preview.length, preview: preview.slice(0, 50) });
    const status = errorRows.length ? 'warning' : 'success';
    const message = `Updated ${changed} product row${changed === 1 ? '' : 's'} from ${template.name}${errorRows.length ? `; ${errorRows.length} row${errorRows.length === 1 ? '' : 's'} need review.` : '.'}`;
    attachImportJobErrorsFile(job, errorRows);
    db.syncRuns = Array.isArray(db.syncRuns) ? db.syncRuns : [];
    db.syncRuns.unshift({
      id: crypto.randomUUID(),
      importJobId: job.id,
      source: template.source || 'CSV',
      type: 'mapped-product-import',
      status,
      fileName: body.fileName || '',
      message,
      createdAt: new Date().toISOString()
    });
    finishImportJob(job, { status, message, changed, created, totalRows: records.length, missingCount: errorRows.length, errors: importErrorMessages(errorRows) });
    const normalized = normalizeDb(db);
    await writeDb(normalized);
    return sendJson(res, 200, { changed, created, job: normalized.importJobs.find((row) => row.id === job.id) || job, state: publicState(normalized) });
  }

  if (req.method === 'POST' && url.pathname === '/api/shopify/status-import') {
    const body = await parseBody(req);
    const records = parseCsv(body.csv || '');
    const maps = buildShopifyLookupMaps(db);
    const preview = [];
    const missing = [];
    const errorRows = [];
    const job = body.dryRun ? null : createImportJob(db, {
      section: 'Products',
      operation: 'Shopify status import',
      direction: 'import',
      fileName: body.fileName || 'shopify-status.csv',
      totalRows: records.length,
      message: `Updating Shopify IDs and live status from ${records.length} row${records.length === 1 ? '' : 's'}.`
    });
    if (job) attachImportJobOriginalFile(job, body.csv || '', body.fileName || 'shopify-status.csv');
    let changed = 0;
    for (const record of records) {
      const { item, payload, matchBy } = findProductForShopifyRecord(record, maps);
      const key = payload.sku || payload.handle || payload.shopifyId;
      if (!key) {
        errorRows.push(standardImportError({
          record,
          field: 'sku',
          issue: 'Missing Shopify match key',
          rawValue: JSON.stringify(record),
          details: 'Expected Variant SKU, Handle, or Shopify product ID.'
        }));
        continue;
      }
      if (!item) {
        missing.push(key);
        errorRows.push(standardImportError({
          record,
          recordKey: key,
          sku: payload.sku || '',
          field: payload.sku ? 'sku' : payload.handle ? 'handle' : 'shopifyId',
          issue: 'No matching product found',
          rawValue: key,
          details: matchBy ? `Tried ${matchBy}.` : 'No matching SKU, handle, or Shopify ID found.'
        }));
        if (preview.length < 50) preview.push({ sku: payload.sku || '', handle: payload.handle || '', action: 'missing', fields: [] });
        continue;
      }
      const fields = ['shopifyId', 'shopifyVariantId', 'shopifyHandle', 'shopifyStatus', 'shopifyPublished', 'shopifyPublishedAt', 'shopifyUpdatedAt', 'shopifySyncedAt']
        .filter((field) => payload[field] !== undefined && payload[field] !== '' && item[field] !== payload[field]);
      if (body.dryRun) {
        if (preview.length < 50) preview.push({ sku: item.sku, handle: payload.handle, action: fields.length ? 'update' : 'unchanged', matchBy, fields });
        if (fields.length) changed += 1;
        continue;
      }
      for (const field of fields) item[field] = payload[field];
      if (fields.length) {
        item.updatedAt = new Date().toISOString();
        changed += 1;
      }
    }
    if (body.dryRun) {
      return sendJson(res, 200, {
        changed,
        matched: records.length - missing.length,
        missing: missing.slice(0, 100),
        preview
      });
    }
    const issueCount = errorRows.length;
    const status = issueCount ? 'warning' : 'success';
    const message = `Updated Shopify status for ${changed} product row${changed === 1 ? '' : 's'}${issueCount ? `; ${issueCount} row${issueCount === 1 ? '' : 's'} need review.` : '.'}`;
    attachImportJobErrorsFile(job, errorRows);
    db.syncRuns = Array.isArray(db.syncRuns) ? db.syncRuns : [];
    db.syncRuns.unshift({
      id: crypto.randomUUID(),
      importJobId: job.id,
      source: 'Shopify',
      type: 'shopify-status-import',
      status,
      fileName: body.fileName || '',
      message,
      createdAt: new Date().toISOString()
    });
    finishImportJob(job, { status, message, changed, totalRows: records.length, missingCount: issueCount, errors: importErrorMessages(errorRows) });
    const normalized = normalizeDb(db);
    await writeDb(normalized);
    return sendJson(res, 200, { changed, missing: missing.slice(0, 100), job: normalized.importJobs.find((row) => row.id === job.id) || job, state: publicState(normalized) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "catalog-import-reviews" && parts[2] && ["accept", "reject"].includes(parts[3])) {
    const body = await parseBody(req);
    db.catalogImportReviews = normalizeCatalogImportReviews(db.catalogImportReviews);
    const review = db.catalogImportReviews.find((row) => row.id === parts[2]);
    if (!review) return notFound(res);
    if (review.status !== "pending") return sendJson(res, 400, { error: "This review has already been decided." });
    const item = db.inventory.find((row) => row.id === review.productId || String(row.sku || "").toLowerCase() === review.sku.toLowerCase());
    if (!item) return sendJson(res, 404, { error: "Product not found for this review." });
    if (parts[3] === "accept") {
      item[review.field] = review.incomingValue;
      if (review.field === "brand") item.brandLocked = true;
      if (["packageLength", "packageWidth", "packageHeight"].includes(review.field)) item.dimensionalWeight = calculateDimensionalWeight(item);
      item.updatedAt = new Date().toISOString();
      review.status = "accepted";
    } else {
      review.status = "rejected";
    }
    review.decisionNote = body.note || "";
    review.decidedAt = new Date().toISOString();
    review.updatedAt = review.decidedAt;
    const normalized = normalizeDb(db);
    await writeDb(normalized);
    return sendJson(res, 200, { review, state: publicState(normalized) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "catalog-import-reviews" && parts[2] === "bulk") {
    const body = await parseBody(req);
    const action = String(body.action || "");
    const ids = new Set(Array.isArray(body.ids) ? body.ids : []);
    if (!["accept", "reject"].includes(action)) return sendJson(res, 400, { error: "Unsupported review action." });
    db.catalogImportReviews = normalizeCatalogImportReviews(db.catalogImportReviews);
    let changed = 0;
    for (const review of db.catalogImportReviews) {
      if (!ids.has(review.id) || review.status !== "pending") continue;
      const item = db.inventory.find((row) => row.id === review.productId || String(row.sku || "").toLowerCase() === review.sku.toLowerCase());
      if (!item) continue;
      if (action === "accept") {
        item[review.field] = review.incomingValue;
        if (review.field === "brand") item.brandLocked = true;
        if (["packageLength", "packageWidth", "packageHeight"].includes(review.field)) item.dimensionalWeight = calculateDimensionalWeight(item);
        item.updatedAt = new Date().toISOString();
        review.status = "accepted";
      } else {
        review.status = "rejected";
      }
      review.decidedAt = new Date().toISOString();
      review.updatedAt = review.decidedAt;
      changed += 1;
    }
    const normalized = normalizeDb(db);
    await writeDb(normalized);
    return sendJson(res, 200, { changed, state: publicState(normalized) });
  }

  if (req.method === "GET" && url.pathname === "/api/export/inventory") {
    const headers = ["sku", "title", "marketplaceTitle", "price", "cost", "msrp", "qty", "reserved", "available", "reorderPoint", "brand", "category", "condition", "status", "barcode", "shortDescription", "longDescription", "images", "tags", "weightOz", "lengthIn", "widthIn", "heightIn", "vendor", "seoKeywords", "sources"];
    const rows = db.inventory.map((item) => [
      item.sku,
      item.title,
      item.marketplaceTitle,
      item.price,
      item.cost,
      item.msrp,
      item.qty,
      item.reserved,
      item.qty - item.reserved,
      item.reorderPoint,
      item.brand,
      item.category,
      item.condition,
      item.status,
      item.barcode,
      item.shortDescription,
      item.longDescription,
      (item.images || []).join("|"),
      (item.tags || []).join("|"),
      item.weightOz,
      item.lengthIn,
      item.widthIn,
      item.heightIn,
      item.vendor,
      item.seoKeywords,
      Object.entries(item.sources || {}).map(([source, id]) => `${source}:${id}`).join(";")
    ]);
    const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=inventory-export.csv"
    });
    return res.end(csv);
  }

  if (req.method === "GET" && parts[0] === "api" && parts[1] === "purchase-orders" && parts[3] === "export") {
    const po = (db.purchaseOrders || []).find((row) => row.id === parts[2]);
    if (!po) return notFound(res);
    const vendor = findVendorById(db, po.vendorId) || findVendorByName(db, po.supplier);
    const format = parts[4] || "csv";
    if (format === "csv") {
      const headers = ["poNumber", "vendor", "sku", "title", "qty", "estimatedUnitCost", "orderNumbers"];
      const rows = (po.items || []).map((item) => [
        po.poNumber,
        po.supplier,
        item.sku,
        item.title,
        item.qty,
        item.estimatedUnitCost,
        (item.orderNumbers || []).join("|")
      ]);
      const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=${po.poNumber}.csv`
      });
      return res.end(csv);
    }
    if (format === "pdf") {
      const htmlDoc = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(po.poNumber)}</title><style>body{font-family:Arial,sans-serif;padding:32px;color:#111}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px;text-align:left}.muted{color:#666}</style></head><body><h1>${escapeHtml(po.poNumber)}</h1><p class="muted">${escapeHtml(po.supplier || "")} / ${escapeHtml(po.status || "")}</p><p>Vendor: ${escapeHtml(vendor?.vendorNumber || "Unassigned")}</p><p>Estimated cost: ${Number(po.estimatedCost || 0).toFixed(2)}</p><table><thead><tr><th>SKU</th><th>Title</th><th>Qty</th><th>Est. unit cost</th><th>Orders</th></tr></thead><tbody>${(po.items || []).map((item) => `<tr><td>${escapeHtml(item.sku || "")}</td><td>${escapeHtml(item.title || "")}</td><td>${escapeHtml(item.qty || 0)}</td><td>${escapeHtml(Number(item.estimatedUnitCost || 0).toFixed(2))}</td><td>${escapeHtml((item.orderNumbers || []).join(", "))}</td></tr>`).join("")}</tbody></table></body></html>`;
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename=${po.poNumber}.html`
      });
      return res.end(htmlDoc);
    }
    return sendJson(res, 400, { error: "Unsupported export format." });
  }

  if (req.method === "GET" && parts[0] === "api" && parts[1] === "order-drafts" && parts[3] === "export") {
    const draft = (db.orderDrafts || []).find((row) => row.id === parts[2]);
    if (!draft) return notFound(res);
    const format = parts[4] || "pdf";
    if (format !== "pdf") return sendJson(res, 400, { error: "Unsupported export format." });
    const address = draft.shippingAddress || {};
    const items = Array.isArray(draft.items) ? draft.items : [];
    const subtotal = items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0);
    const htmlDoc = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(draft.draftNumber)}</title><style>body{font-family:Arial,sans-serif;padding:32px;color:#111}table{width:100%;border-collapse:collapse;margin-top:16px}td,th{border:1px solid #ddd;padding:8px;text-align:left}.muted{color:#666}dl{display:grid;grid-template-columns:180px 1fr;gap:8px 16px;margin-top:20px}</style></head><body><h1>${escapeHtml(draft.draftNumber)}</h1><p class="muted">Manual draft / ${escapeHtml(draft.source || "Manual")}</p><p><strong>${escapeHtml(draft.buyer || "Unknown customer")}</strong><br>${escapeHtml(draft.buyerEmail || "")}<br>${escapeHtml(draft.phone || "")}</p><table><thead><tr><th>SKU</th><th>Title</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>${items.map((item) => `<tr><td>${escapeHtml(item.sku || "")}</td><td>${escapeHtml(item.title || "")}</td><td>${escapeHtml(item.qty || 0)}</td><td>${escapeHtml(Number(item.price || 0).toFixed(2))}</td><td>${escapeHtml((Number(item.qty || 0) * Number(item.price || 0)).toFixed(2))}</td></tr>`).join("")}</tbody></table><dl><dt>Subtotal</dt><dd>${escapeHtml(subtotal.toFixed(2))}</dd><dt>External reference</dt><dd>${escapeHtml(draft.marketplaceOrderNumber || "N/A")}</dd><dt>Shipping</dt><dd>${escapeHtml([address.name, address.line1, address.line2, [address.city, address.state, address.postalCode].filter(Boolean).join(", "), address.country].filter(Boolean).join(" / "))}</dd><dt>Notes</dt><dd>${escapeHtml(draft.note || "None")}</dd></dl></body></html>`;
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename=${draft.draftNumber}.html`
    });
    return res.end(htmlDoc);
  }

  if (req.method === 'POST' && url.pathname === '/api/import/inventory') {
    const body = await parseBody(req);
    const records = parseCsv(body.csv || '');
    const job = createImportJob(db, {
      section: 'Inventory',
      operation: 'Inventory CSV import',
      direction: 'import',
      fileName: body.fileName || 'inventory.csv',
      totalRows: records.length,
      message: `Importing ${records.length} inventory row${records.length === 1 ? '' : 's'}.`
    });
    attachImportJobOriginalFile(job, body.csv || '', body.fileName || 'inventory.csv');
    let changed = 0;
    const errorRows = [];

    for (const record of records) {
      const sku = String(record.sku || record.SKU || '').trim();
      if (!sku) {
        errorRows.push(standardImportError({
          record,
          field: 'sku',
          issue: 'Missing SKU',
          rawValue: JSON.stringify(record)
        }));
        continue;
      }

      const existing = db.inventory.find((item) => item.sku.toLowerCase() === sku.toLowerCase());
      const qty = Number(record.qty ?? record.quantity ?? record.QTY);
      const title = String(record.title || record.name || existing?.title || sku).trim();
      const productFields = inventoryPayloadFromRecord(record);

      if (existing) {
        if (Number.isFinite(qty)) existing.qty = qty;
        existing.title = title;
        Object.assign(existing, productFields);
        if (productFields.brand !== undefined && productFields.brandLocked === undefined) existing.brandLocked = true;
        existing.updatedAt = new Date().toISOString();
      } else {
        db.inventory.push({
          id: crypto.randomUUID(),
          sku,
          title,
          ...productFields,
          brandLocked: productFields.brand !== undefined ? true : Boolean(productFields.brandLocked),
          qty: Number.isFinite(qty) ? qty : 0,
          reserved: 0,
          reorderPoint: Number(record.reorderPoint || 0),
          sources: {},
          updatedAt: new Date().toISOString()
        });
      }
      changed += 1;
    }

    const status = errorRows.length ? 'warning' : 'success';
    const message = `Updated ${changed} inventory row${changed === 1 ? '' : 's'} from CSV${errorRows.length ? `; ${errorRows.length} row${errorRows.length === 1 ? '' : 's'} need review.` : '.'}`;
    attachImportJobErrorsFile(job, errorRows);
    db.syncRuns = Array.isArray(db.syncRuns) ? db.syncRuns : [];
    db.syncRuns.unshift({
      id: crypto.randomUUID(),
      importJobId: job.id,
      source: 'CSV',
      type: 'inventory',
      status,
      fileName: body.fileName || '',
      message,
      createdAt: new Date().toISOString()
    });
    finishImportJob(job, { status, message, changed, totalRows: records.length, missingCount: errorRows.length, errors: importErrorMessages(errorRows) });
    const normalized = normalizeDb(db);
    await writeDb(normalized);
    return sendJson(res, 200, { changed, job: normalized.importJobs.find((row) => row.id === job.id) || job, state: publicState(normalized) });
  }

  if (req.method === "PATCH" && parts[0] === "api" && parts[1] === "inventory" && parts[2] && parts.length === 3) {
    const body = await parseBody(req);
    const item = db.inventory.find((row) => row.id === parts[2]);
    if (!item) return notFound(res);
    const qtyBefore = Number(item.qty || 0);
    const reservedBefore = Number(item.reserved || 0);
    applyInventoryPatch(item, body);
    if (body.brand !== undefined && body.brandLocked === undefined) item.brandLocked = true;
    item.updatedAt = new Date().toISOString();
    const qtyAfter = Number(item.qty || 0);
    const reservedAfter = Number(item.reserved || 0);
    if (qtyBefore !== qtyAfter || reservedBefore !== reservedAfter) {
      addInventoryLedger(db, item, {
        type: "manual_adjustment",
        source: "inventory",
        quantityChange: qtyAfter - qtyBefore,
        reservedChange: reservedAfter - reservedBefore,
        qtyBefore,
        qtyAfter,
        reservedBefore,
        reservedAfter,
        reason: body.reason || "Manual inventory edit",
        user: body.user || "Luis"
      });
    }
    await writeDb(db);
    return sendJson(res, 200, { item, summary: summarize(db) });
  }

  if (req.method === "PATCH" && parts[0] === "api" && parts[1] === "inventory" && parts[2] && parts[3] === "warehouse-stock" && parts[4]) {
    const body = await parseBody(req);
    const item = db.inventory.find((row) => row.id === parts[2]);
    if (!item) return notFound(res);
    const warehouse = (db.warehouses || []).find((row) => row.id === parts[4]);
    if (!warehouse) return notFound(res);
    const stockRow = ensureInventoryWarehouseStock(item, warehouse);
    const qtyBefore = Number(stockRow.qty || 0);
    const reservedBefore = Number(stockRow.reserved || 0);
    const reorderBefore = Number(stockRow.reorderPoint || 0);
    if (body.qty !== undefined && Number.isFinite(Number(body.qty))) stockRow.qty = Number(body.qty);
    if (body.reserved !== undefined && Number.isFinite(Number(body.reserved))) stockRow.reserved = Number(body.reserved);
    if (body.reorderPoint !== undefined && Number.isFinite(Number(body.reorderPoint))) stockRow.reorderPoint = Number(body.reorderPoint);
    if (body.locationBin !== undefined) stockRow.locationBin = String(body.locationBin || "").trim();
    stockRow.warehouseName = warehouse.name;
    stockRow.updatedAt = new Date().toISOString();
    syncInventoryTotalsFromWarehouses(item);
    item.updatedAt = new Date().toISOString();
    if (qtyBefore !== stockRow.qty || reservedBefore !== stockRow.reserved) {
      addInventoryLedger(db, item, {
        type: "warehouse_adjustment",
        source: "inventory",
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        locationBin: stockRow.locationBin || "",
        quantityChange: stockRow.qty - qtyBefore,
        reservedChange: stockRow.reserved - reservedBefore,
        qtyBefore,
        qtyAfter: stockRow.qty,
        reservedBefore,
        reservedAfter: stockRow.reserved,
        reason: body.reason || `Warehouse stock updated for ${warehouse.name}${reorderBefore !== stockRow.reorderPoint ? ` / reorder ${reorderBefore} -> ${stockRow.reorderPoint}` : ""}`,
        user: body.user || "Luis"
      });
    }
    await writeDb(db);
    return sendJson(res, 200, { item, warehouseStock: stockRow, summary: summarize(db), state: publicState(db) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "inventory" && parts[2] && parts[3] === "transfers") {
    const body = await parseBody(req);
    const item = db.inventory.find((row) => row.id === parts[2]);
    if (!item) return notFound(res);
    const fromWarehouse = (db.warehouses || []).find((row) => row.id === body.fromWarehouseId);
    const toWarehouse = (db.warehouses || []).find((row) => row.id === body.toWarehouseId);
    const qty = Number(body.qty || 0);
    if (!fromWarehouse || !toWarehouse) return sendJson(res, 400, { error: "Both warehouses are required." });
    if (fromWarehouse.id === toWarehouse.id) return sendJson(res, 400, { error: "Choose different source and destination warehouses." });
    if (!(qty > 0)) return sendJson(res, 400, { error: "Transfer quantity must be greater than zero." });
    const fromRow = ensureInventoryWarehouseStock(item, fromWarehouse);
    const toRow = ensureInventoryWarehouseStock(item, toWarehouse);
    const available = Number(fromRow.qty || 0) - Number(fromRow.reserved || 0);
    if (available < qty) return sendJson(res, 400, { error: `Only ${available} available in ${fromWarehouse.name}.` });
    const fromBefore = Number(fromRow.qty || 0);
    const toBefore = Number(toRow.qty || 0);
    fromRow.qty = Math.max(0, fromBefore - qty);
    toRow.qty = toBefore + qty;
    if (body.toLocationBin !== undefined) toRow.locationBin = String(body.toLocationBin || "").trim();
    fromRow.updatedAt = new Date().toISOString();
    toRow.updatedAt = new Date().toISOString();
    syncInventoryTotalsFromWarehouses(item);
    item.updatedAt = new Date().toISOString();
    addInventoryLedger(db, item, {
      type: "transfer_out",
      source: "inventory",
      warehouseId: fromWarehouse.id,
      warehouseName: fromWarehouse.name,
      locationBin: fromRow.locationBin || "",
      referenceNumber: `${fromWarehouse.code || fromWarehouse.name} -> ${toWarehouse.code || toWarehouse.name}`,
      quantityChange: -qty,
      qtyBefore: fromBefore,
      qtyAfter: fromRow.qty,
      reservedBefore: Number(fromRow.reserved || 0),
      reservedAfter: Number(fromRow.reserved || 0),
      reason: body.note || `Transferred to ${toWarehouse.name}`,
      user: body.user || "Luis"
    });
    addInventoryLedger(db, item, {
      type: "transfer_in",
      source: "inventory",
      warehouseId: toWarehouse.id,
      warehouseName: toWarehouse.name,
      locationBin: toRow.locationBin || "",
      referenceNumber: `${fromWarehouse.code || fromWarehouse.name} -> ${toWarehouse.code || toWarehouse.name}`,
      quantityChange: qty,
      qtyBefore: toBefore,
      qtyAfter: toRow.qty,
      reservedBefore: Number(toRow.reserved || 0),
      reservedAfter: Number(toRow.reserved || 0),
      reason: body.note || `Transferred from ${fromWarehouse.name}`,
      user: body.user || "Luis"
    });
    await writeDb(db);
    return sendJson(res, 200, { item, summary: summarize(db), state: publicState(db) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "orders" && parts[3] === "reserve") {
    const body = await parseBody(req);
    const order = db.orders.find((row) => row.id === parts[2]);
    if (!order) return notFound(res);
    const warehouse = (db.warehouses || []).find((row) => row.id === body.warehouseId) || findPreferredOrderWarehouse(db, order);
    if (!warehouse) return sendJson(res, 400, { error: "Warehouse is required." });
    const item = db.inventory.find((row) => row.sku === order.sku);
    if (!item) return sendJson(res, 400, { error: "Inventory item not found for this order." });
    const qty = Number(body.qty || order.qty || 0);
    if (!(qty > 0)) return sendJson(res, 400, { error: "Reservation quantity must be greater than zero." });
    const stockRow = ensureInventoryWarehouseStock(item, warehouse);
    const available = Number(stockRow.qty || 0) - Number(stockRow.reserved || 0);
    if (available < qty) return sendJson(res, 400, { error: `Only ${available} available in ${warehouse.name}.` });
    const reservedBefore = Number(stockRow.reserved || 0);
    stockRow.reserved = reservedBefore + qty;
    stockRow.updatedAt = new Date().toISOString();
    syncInventoryTotalsFromWarehouses(item);
    item.updatedAt = new Date().toISOString();
    order.reservationWarehouseId = warehouse.id;
    order.reservationWarehouseName = warehouse.name;
    order.reservedQty = qty;
    order.reservedAt = new Date().toISOString();
    addInventoryLedger(db, item, {
      type: "order_reservation",
      source: "order",
      referenceId: order.id,
      referenceNumber: order.orderNumber,
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      locationBin: stockRow.locationBin || "",
      quantityChange: 0,
      reservedChange: qty,
      qtyBefore: Number(stockRow.qty || 0),
      qtyAfter: Number(stockRow.qty || 0),
      reservedBefore,
      reservedAfter: stockRow.reserved,
      reason: body.note || `Reserved for ${order.orderNumber}`,
      user: body.user || "Luis"
    });
    addOrderTimeline(order, {
      type: "allocation",
      title: "Inventory reserved",
      message: `${qty} unit(s) reserved from ${warehouse.name}.${body.note ? ` ${body.note}` : ""}`,
      user: body.user || "Luis"
    });
    await writeDb(db);
    return sendJson(res, 200, { order, item, state: publicState(db) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "inventory" && parts[3] === "serials" && parts[5] === "action") {
    const body = await parseBody(req);
    const item = db.inventory.find((row) => row.id === parts[2]);
    if (!item) return notFound(res);
    item.serialUnits = Array.isArray(item.serialUnits) ? item.serialUnits : [];
    const serial = item.serialUnits.find((row) => row.id === parts[4]);
    if (!serial) return notFound(res);
    const action = String(body.action || "").toLowerCase();
    const nextStatus = {
      available: "available",
      reserve: "reserved",
      reserved: "reserved",
      sold: "sold",
      quarantine: "quarantine",
      return: "returned",
      returned: "returned"
    }[action];
    if (!nextStatus) return sendJson(res, 400, { error: "Unsupported serial action." });

    const previousStatus = serial.status || "available";
    serial.status = nextStatus;
    serial.updatedAt = new Date().toISOString();
    serial.statusNote = String(body.note || "").trim();
    if (body.locationBin !== undefined) serial.locationBin = String(body.locationBin || "").trim();

    addInventoryLedger(db, item, {
      type: "serial_status",
      source: "inventory",
      referenceId: serial.id,
      referenceNumber: serial.serialNumber,
      quantityChange: 0,
      reservedChange: 0,
      qtyBefore: Number(item.qty || 0),
      qtyAfter: Number(item.qty || 0),
      reservedBefore: Number(item.reserved || 0),
      reservedAfter: Number(item.reserved || 0),
      reason: `${serial.serialNumber} changed from ${previousStatus} to ${nextStatus}${serial.statusNote ? `: ${serial.statusNote}` : ""}`,
      serials: [serial],
      user: body.user || "Luis"
    });

    await writeDb(db);
    return sendJson(res, 200, { item, serial, state: publicState(db) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "inventory" && parts[3] === "shadows" && parts.length === 4) {
    const body = await parseBody(req);
    const item = db.inventory.find((row) => row.id === parts[2]);
    if (!item) return notFound(res);
    const shadowSku = String(body.shadowSku || "").trim();
    const marketplace = String(body.marketplace || body.company || "").trim();
    if (!shadowSku) return sendJson(res, 400, { error: "Shadow SKU is required." });
    if (!marketplace) return sendJson(res, 400, { error: "Marketplace is required." });
    const exists = db.inventory.some((product) => (product.shadowSkus || []).some((shadow) => String(shadow.shadowSku || "").toLowerCase() === shadowSku.toLowerCase()));
    if (exists) return sendJson(res, 400, { error: "Shadow SKU already exists." });

    item.shadowSkus = Array.isArray(item.shadowSkus) ? item.shadowSkus : [];
    const shadow = normalizeShadowSku(applyChannelDefaultsToShadow(db, {
      shadowSku,
      marketplace,
      price: body.price,
      handlingTimeDays: body.handlingTimeDays,
      safetyQty: body.safetyQty,
      maxSellableQty: body.maxSellableQty,
      inventoryPolicy: body.inventoryPolicy,
      shippingProfile: body.shippingProfile,
      shippingService: body.shippingService,
      shippingTemplateId: body.shippingTemplateId,
      freeShipping: body.freeShipping,
      marketplaceAttributes: body.marketplaceAttributes,
      contentOverrides: body.contentOverrides,
      status: body.status || "Draft",
      notes: body.notes || ""
    }, marketplace), item);
    item.shadowSkus.push(shadow);
    item.updatedAt = new Date().toISOString();
    await writeDb(db);
    return sendJson(res, 200, { item, shadow, state: publicState(db) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "inventory" && parts[3] === "shadows" && parts[5] === "sync") {
    const item = db.inventory.find((row) => row.id === parts[2]);
    if (!item) return notFound(res);
    const shadow = (item.shadowSkus || []).find((row) => row.id === parts[4]);
    if (!shadow) return notFound(res);
    const now = new Date().toISOString();
    const record = {
      id: crypto.randomUUID(),
      status: "queued",
      message: "Sync queued for marketplace connector.",
      createdAt: now,
      user: "Luis"
    };
    shadow.syncStatus = "Queued";
    shadow.lastSyncAt = now;
    shadow.syncHistory = Array.isArray(shadow.syncHistory) ? shadow.syncHistory : [];
    shadow.syncHistory.unshift(record);
    addShadowTimeline(shadow, {
      type: "sync",
      title: "Sync queued",
      message: `${shadow.shadowSku} queued for ${shadow.marketplace}.`,
      createdAt: now
    });
    await writeDb(db);
    return sendJson(res, 200, { item, shadow, state: publicState(db) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "inventory" && parts[3] === "shadows-bulk") {
    const body = await parseBody(req);
    const item = db.inventory.find((row) => row.id === parts[2]);
    if (!item) return notFound(res);
    const marketplaces = Array.isArray(body.marketplaces) ? body.marketplaces : parseTemplateList(body.marketplaces || "");
    item.shadowSkus = Array.isArray(item.shadowSkus) ? item.shadowSkus : [];
    const created = [];
    for (const marketplace of marketplaces) {
      const shadowSku = `${item.sku}-${marketplace}`;
      if (item.shadowSkus.some((shadow) => shadow.marketplace === marketplace || shadow.shadowSku === shadowSku)) continue;
      const shadow = normalizeShadowSku(applyChannelDefaultsToShadow(db, {
        shadowSku,
        marketplace,
        price: body.price ?? item.price,
        handlingTimeDays: body.handlingTimeDays ?? 2,
        status: "Draft"
      }, marketplace), item);
      item.shadowSkus.push(shadow);
      created.push(shadow);
    }
    item.updatedAt = new Date().toISOString();
    await writeDb(db);
    return sendJson(res, 200, { item, created, state: publicState(db) });
  }

  if (req.method === "PATCH" && parts[0] === "api" && parts[1] === "inventory" && parts[3] === "shadows" && parts[4]) {
    const body = await parseBody(req);
    const item = db.inventory.find((row) => row.id === parts[2]);
    if (!item) return notFound(res);
    const shadow = (item.shadowSkus || []).find((row) => row.id === parts[4]);
    if (!shadow) return notFound(res);
    applyShadowSkuPatch(shadow, body);
    item.updatedAt = new Date().toISOString();
    await writeDb(db);
    return sendJson(res, 200, { item, shadow, state: publicState(db) });
  }

  if (req.method === "PATCH" && parts[0] === "api" && parts[1] === "marketplace-templates" && parts[2]) {
    const body = await parseBody(req);
    db.marketplaceTemplates = normalizeMarketplaceTemplates(db.marketplaceTemplates);
  db.categorySettings = normalizeCategorySettings(db.categorySettings);
    const template = db.marketplaceTemplates.find((row) => row.id === parts[2]);
    if (!template) return notFound(res);
    const textFields = ["marketplace", "notes"];
    for (const field of textFields) {
      if (body[field] !== undefined) template[field] = String(body[field]).trim();
    }
    if (body.requiredAttributes !== undefined) template.requiredAttributes = parseTemplateList(body.requiredAttributes);
    if (body.fieldDefinitions !== undefined) {
      template.fieldDefinitions = parseTemplateFields(body.fieldDefinitions);
      template.requiredAttributes = template.fieldDefinitions.filter((field) => field.required !== false).map((field) => field.key);
      template.optionLists = Object.fromEntries(template.fieldDefinitions.filter((field) => field.options.length).map((field) => [field.key, field.options]));
    }
    if (body.categoryMappings !== undefined) {
      template.categoryMappings = String(body.categoryMappings || "")
        .split(/\r?\n/)
        .map((line) => {
          const [internalCategory = "", marketplaceCategory = "", marketplaceCategoryId = ""] = line.split("|").map((part) => part.trim());
          return internalCategory ? { id: crypto.randomUUID(), internalCategory, marketplaceCategory, marketplaceCategoryId } : null;
        })
        .filter(Boolean);
    }
    if (body.titleMaxLength !== undefined && Number.isFinite(Number(body.titleMaxLength))) template.titleMaxLength = Number(body.titleMaxLength);
    if (body.minImages !== undefined && Number.isFinite(Number(body.minImages))) template.minImages = Number(body.minImages);
    for (const field of ["requireShippingProfile", "requireHandlingTime", "requirePrice"]) {
      if (body[field] !== undefined) template[field] = body[field] === true || String(body[field]).toLowerCase() === "true";
    }
    template.updatedAt = new Date().toISOString();
    await writeDb(db);
    return sendJson(res, 200, { template, state: publicState(db) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "marketplace-templates" && parts[3] === "action") {
    const body = await parseBody(req);
    db.marketplaceTemplates = normalizeMarketplaceTemplates(db.marketplaceTemplates);
  db.categorySettings = normalizeCategorySettings(db.categorySettings);
    const template = db.marketplaceTemplates.find((row) => row.id === parts[2]);
    if (!template) return notFound(res);
    const action = String(body.action || "").toLowerCase();
    if (action === "duplicate") {
      const copy = normalizeMarketplaceTemplate({
        ...template,
        id: crypto.randomUUID(),
        marketplace: `${template.marketplace} Copy`,
        updatedAt: new Date().toISOString()
      });
      db.marketplaceTemplates.unshift(copy);
      await writeDb(db);
      return sendJson(res, 200, { template: copy, state: publicState(db) });
    }
    if (action === "reset") {
      const defaults = DEFAULT_MARKETPLACE_TEMPLATES.find((row) => row.marketplace === template.marketplace);
      if (!defaults) return sendJson(res, 400, { error: "No default exists for this template." });
      Object.assign(template, normalizeMarketplaceTemplate(defaults));
      await writeDb(db);
      return sendJson(res, 200, { template, state: publicState(db) });
    }
    if (["active", "inactive"].includes(action)) {
      template.status = action;
      template.updatedAt = new Date().toISOString();
      await writeDb(db);
      return sendJson(res, 200, { template, state: publicState(db) });
    }
    return sendJson(res, 400, { error: "Unsupported template action." });
  }

  if (req.method === "PATCH" && parts[0] === "api" && parts[1] === "channels" && parts[2]) {
    const body = await parseBody(req);
    const channel = (db.connections || []).find((row) => row.id === parts[2]);
    if (!channel) return notFound(res);
    for (const field of ["name", "status", "notes", "logoUrl", "logoDataUrl"]) {
      if (body[field] !== undefined) channel[field] = String(body[field]).trim();
    }
    if (body.connected !== undefined) channel.connected = body.connected === true || String(body.connected).toLowerCase() === "true";
    channel.settings = { ...(channel.settings || DEFAULT_CHANNEL_SETTINGS) };
    const settingFields = Object.keys(DEFAULT_CHANNEL_SETTINGS);
    for (const field of settingFields) {
      if (body[field] === undefined) continue;
      if (typeof DEFAULT_CHANNEL_SETTINGS[field] === "boolean") channel.settings[field] = body[field] === true || String(body[field]).toLowerCase() === "true";
      else if (typeof DEFAULT_CHANNEL_SETTINGS[field] === "number") channel.settings[field] = Number(body[field] || 0);
      else channel.settings[field] = String(body[field] || "");
    }
    const normalized = normalizeChannel(channel);
    Object.assign(channel, normalized);
    await writeDb(db);
    return sendJson(res, 200, { channel, state: publicState(db) });
  }

  if (req.method === "PATCH" && parts[0] === "api" && parts[1] === "orders" && parts[2]) {
    const body = await parseBody(req);
    const order = db.orders.find((row) => row.id === parts[2]);
    if (!order) return notFound(res);
    const changes = [];
    for (const field of ["total", "productCost", "marketplaceFees", "shippingCost", "refundAmount"]) {
      if (body[field] !== undefined && Number.isFinite(Number(body[field]))) {
        const oldValue = Number(order[field] || 0);
        const newValue = Number(body[field]);
        if (oldValue !== newValue) changes.push(`${field} changed from ${oldValue} to ${newValue}`);
        order[field] = newValue;
      }
    }
    for (const field of ["buyer", "source", "buyerEmail", "phone", "marketplaceOrderNumber", "shipBy", "notes"]) {
      if (body[field] !== undefined) {
        const oldValue = String(order[field] || "");
        const newValue = String(body[field] || "").trim();
        if (oldValue !== newValue) changes.push(`${field} changed from "${oldValue || "blank"}" to "${newValue || "blank"}"`);
        order[field] = newValue;
      }
    }
    order.updatedAt = new Date().toISOString();
    if (changes.length) {
      addOrderTimeline(order, {
        type: "edited",
        title: "Order edited",
        message: changes.join(", "),
        user: body.user || "Luis"
      });
    }
    await writeDb(db);
    return sendJson(res, 200, { order, state: publicState(db) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "order-drafts" && parts.length === 2) {
    const body = await parseBody(req);
    const draft = normalizeOrderDraft(db, {
      source: body.source,
      buyer: body.buyer,
      buyerEmail: body.buyerEmail,
      phone: body.phone,
      marketplaceOrderNumber: body.marketplaceOrderNumber,
      note: body.note,
      shippingAddress: body.shippingAddress,
      billingAddress: body.billingAddress,
      items: body.items,
      status: "draft"
    });
    if (!draft.buyer) return sendJson(res, 400, { error: "Customer name is required." });
    if (!draft.items.length) return sendJson(res, 400, { error: "Add at least one line item." });
    db.orderDrafts = Array.isArray(db.orderDrafts) ? db.orderDrafts : [];
    db.orderDrafts.unshift(draft);
    await writeDb(db);
    return sendJson(res, 200, { draft, state: publicState(db) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "order-drafts" && parts[2] && parts[3] === "duplicate") {
    const current = (db.orderDrafts || []).find((row) => row.id === parts[2]);
    if (!current) return notFound(res);
    const duplicate = normalizeOrderDraft(db, {
      ...current,
      id: crypto.randomUUID(),
      draftNumber: "",
      quoteGroupId: current.quoteGroupId || current.id,
      revisionNumber: nextDraftRevisionNumber(db, current.quoteGroupId || current.id),
      parentDraftId: current.id,
      marketplaceOrderNumber: "",
      note: current.note ? `${current.note} / Duplicated from ${current.draftNumber}` : `Duplicated from ${current.draftNumber}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    db.orderDrafts = Array.isArray(db.orderDrafts) ? db.orderDrafts : [];
    db.orderDrafts.unshift(duplicate);
    await writeDb(db);
    return sendJson(res, 200, { draft: duplicate, state: publicState(db) });
  }

  if (req.method === "PATCH" && parts[0] === "api" && parts[1] === "order-drafts" && parts[2]) {
    const body = await parseBody(req);
    const current = (db.orderDrafts || []).find((row) => row.id === parts[2]);
    if (!current) return notFound(res);
    const updated = normalizeOrderDraft(db, {
      ...current,
      source: body.source ?? current.source,
      buyer: body.buyer ?? current.buyer,
      buyerEmail: body.buyerEmail ?? current.buyerEmail,
      phone: body.phone ?? current.phone,
      marketplaceOrderNumber: body.marketplaceOrderNumber ?? current.marketplaceOrderNumber,
      note: body.note ?? current.note,
      shippingAddress: body.shippingAddress ?? current.shippingAddress,
      billingAddress: body.billingAddress ?? current.billingAddress,
      items: body.items ?? current.items,
      updatedAt: new Date().toISOString()
    });
    if (!updated.buyer) return sendJson(res, 400, { error: "Customer name is required." });
    if (!updated.items.length) return sendJson(res, 400, { error: "Add at least one line item." });
    Object.assign(current, updated);
    await writeDb(db);
    return sendJson(res, 200, { draft: current, state: publicState(db) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "order-drafts" && parts[3] === "convert") {
    const body = await parseBody(req);
    const index = (db.orderDrafts || []).findIndex((row) => row.id === parts[2]);
    if (index < 0) return notFound(res);
    const draft = db.orderDrafts[index];
    if (!draft.items?.length) return sendJson(res, 400, { error: "Draft has no line items." });
    const order = buildOrderFromDraft(db, draft, body.user || "Luis");
    db.orders.unshift(order);
    db.orderDrafts.splice(index, 1);
    normalizeCustomers(db);
    await writeDb(db);
    return sendJson(res, 200, { order, state: publicState(db) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "orders" && parts[2] && parts[3] === "duplicate-draft") {
    const order = db.orders.find((row) => row.id === parts[2]);
    if (!order) return notFound(res);
    const items = Array.isArray(order.items) && order.items.length
      ? order.items.map((item) => {
        const inventoryItem = (db.inventory || []).find((row) => row.sku === item.sku);
        return {
          sku: item.sku,
          title: item.title,
          qty: Number(item.qty || 1),
          price: Number(item.price || 0),
          cost: Number(inventoryItem?.cost || 0)
        };
      })
      : [{
        sku: order.sku,
        title: order.title,
        qty: Number(order.qty || 1),
        price: Number(order.total || 0) / Math.max(1, Number(order.qty || 1)),
        cost: Number((db.inventory || []).find((row) => row.sku === order.sku)?.cost || 0)
      }];
    const duplicate = normalizeOrderDraft(db, {
      buyer: order.buyer,
      source: order.source || "Manual",
      buyerEmail: order.buyerEmail || "",
      phone: order.phone || "",
      marketplaceOrderNumber: "",
      note: `Duplicated from ${order.orderNumber}`,
      shippingAddress: order.address || {},
      billingAddress: order.address || {},
      items,
      sourceOrderId: order.id,
      sourceOrderNumber: order.orderNumber,
      revisionNumber: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    db.orderDrafts = Array.isArray(db.orderDrafts) ? db.orderDrafts : [];
    db.orderDrafts.unshift(duplicate);
    await writeDb(db);
    return sendJson(res, 200, { draft: duplicate, state: publicState(db) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "orders" && parts[3] === "notes") {
    const body = await parseBody(req);
    const order = db.orders.find((row) => row.id === parts[2]);
    if (!order) return notFound(res);
    const note = String(body.note || "").trim();
    if (!note) return sendJson(res, 400, { error: "Note is required." });
    order.notes = order.notes ? `${order.notes}\n${note}` : note;
    order.updatedAt = new Date().toISOString();
    addOrderTimeline(order, {
      type: "note",
      title: "Note added",
      message: note,
      user: body.user || "Luis"
    });
    await writeDb(db);
    return sendJson(res, 200, { order, state: publicState(db) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "purchase-orders" && parts.length === 2) {
    const body = await parseBody(req);
    try {
      const po = createPurchaseOrderFromOrders(db, body.orderIds || [], {
        vendorId: body.vendorId,
        supplier: body.supplier,
        notes: body.notes,
        user: body.user || "Luis",
        forceDuplicate: body.forceDuplicate === true || String(body.forceDuplicate).toLowerCase() === "true"
      });
      await writeDb(db);
      return sendJson(res, 200, { purchaseOrder: po, state: publicState(db) });
    } catch (error) {
      if (error.code === "DUPLICATE_OPEN_PO") {
        return sendJson(res, 409, { error: error.message, duplicates: error.duplicates });
      }
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "purchase-orders" && parts[3] === "submit") {
    const body = await parseBody(req);
    const po = (db.purchaseOrders || []).find((row) => row.id === parts[2]);
    if (!po) return notFound(res);
    const vendor = findVendorById(db, po.vendorId) || findVendorByName(db, po.supplier);
    const settings = vendor?.submissionSettings || {};
    const method = String(body.method || settings.preferredMethod || "email").toLowerCase();
    const allowedMethods = new Set(["preferred", "api", "ftp", "email", "manual"]);
    if (!allowedMethods.has(method)) return sendJson(res, 400, { error: "Unsupported PO submission method." });
    const resolvedMethod = method === "preferred" ? String(settings.preferredMethod || "email").toLowerCase() : method;
    const requirements = {
      api: settings.apiEnabled && settings.apiBaseUrl,
      ftp: settings.ftpEnabled && settings.ftpHost,
      email: settings.emailEnabled !== false && settings.emailTo
    };
    if (["api", "ftp", "email"].includes(resolvedMethod) && !requirements[resolvedMethod]) {
      return sendJson(res, 400, { error: `Vendor ${resolvedMethod.toUpperCase()} submission settings are incomplete.` });
    }
    addPoSubmission(po, {
      method: resolvedMethod,
      status: "queued",
      poStatus: "submitted",
      message: `PO queued for ${resolvedMethod.toUpperCase()} submission with CSV${settings.attachPdf !== false ? " and PDF" : ""}.`,
      user: body.user || "Luis"
    });
    await writeDb(db);
    return sendJson(res, 200, { purchaseOrder: po, state: publicState(db) });
  }

  if (req.method === "PATCH" && parts[0] === "api" && parts[1] === "purchase-orders" && parts[2]) {
    const body = await parseBody(req);
    const po = (db.purchaseOrders || []).find((row) => row.id === parts[2]);
    if (!po) return notFound(res);
    if (body.vendorId !== undefined) {
      const vendor = findVendorById(db, body.vendorId);
      if (!vendor) return sendJson(res, 400, { error: "Vendor not found." });
      const previous = po.supplier || "Unassigned supplier";
      po.vendorId = vendor.id;
      po.supplier = vendor.name;
      addPoTimeline(po, {
        type: "edited",
        title: "PO vendor changed",
        message: `Vendor changed from ${previous} to ${vendor.name}.`,
        user: body.user || "Luis"
      });
    }
    if (body.warehouseId !== undefined) {
      const warehouse = (db.warehouses || []).find((row) => row.id === body.warehouseId);
      if (!warehouse) return sendJson(res, 400, { error: "Warehouse not found." });
      const previous = po.warehouseName || "Unassigned warehouse";
      po.warehouseId = warehouse.id;
      po.warehouseName = warehouse.name;
      addPoTimeline(po, {
        type: "edited",
        title: "PO warehouse changed",
        message: `Warehouse changed from ${previous} to ${warehouse.name}.`,
        user: body.user || "Luis"
      });
    }
    await writeDb(db);
    return sendJson(res, 200, { purchaseOrder: po, state: publicState(db) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "purchase-orders" && parts[3] === "action") {
    const body = await parseBody(req);
    const po = (db.purchaseOrders || []).find((row) => row.id === parts[2]);
    if (!po) return notFound(res);
    const action = String(body.action || "").toLowerCase();
    const nextStatus = {
      approve: "approved",
      hold: "hold",
      cancel: "canceled",
      received: "received",
      close: "closed",
      reopen: "draft"
    }[action];
    if (!nextStatus) return sendJson(res, 400, { error: "Unsupported PO action." });
    const previousStatus = po.status || "draft";
    po.status = nextStatus;
    addPoTimeline(po, {
      type: "status",
      title: `PO ${nextStatus}`,
      message: `Status changed from ${previousStatus} to ${nextStatus}.`,
      user: body.user || "Luis"
    });
    await writeDb(db);
    return sendJson(res, 200, { purchaseOrder: po, state: publicState(db) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "purchase-orders" && parts[3] === "receive") {
    const body = await parseBody(req);
    const po = (db.purchaseOrders || []).find((row) => row.id === parts[2]);
    if (!po) return notFound(res);
    const vendor = findVendorById(db, po.vendorId) || findVendorByName(db, po.supplier);
    const receivedLines = Array.isArray(body.items) ? body.items : [];
    const receivedAt = String(body.receivedAt || new Date().toISOString().slice(0, 10));
    const note = String(body.note || "").trim();
    const mode = String(body.mode || "final").toLowerCase() === "draft" ? "draft" : "final";
    const defaultLocationBin = String(body.defaultLocationBin || "").trim();
    const warehouse = (db.warehouses || []).find((row) => row.id === body.warehouseId || row.id === po.warehouseId) || null;
    const attachments = (Array.isArray(body.attachments) ? body.attachments : []).map((file) => normalizeReceiptAttachment(file, body.user || "Luis"));
    let totalReceived = 0;
    const receipt = {
      id: crypto.randomUUID(),
      receiptNumber: `${mode === "draft" ? "DRF" : "RCV"}-${String(((mode === "draft" ? po.receiptDrafts : po.receipts) || []).length + 1).padStart(4, "0")}`,
      status: mode,
      receivedAt,
      receivedBy: body.user || "Luis",
      note,
      defaultLocationBin,
      warehouseId: warehouse?.id || po.warehouseId || "",
      warehouseName: warehouse?.name || po.warehouseName || "",
      attachments,
      items: []
    };

    for (const line of receivedLines) {
      const sku = String(line.sku || "").trim();
      const qtyReceived = Number(line.qtyReceived || 0);
      if (!sku || !Number.isFinite(qtyReceived) || qtyReceived <= 0) continue;
      const product = db.inventory.find((item) => String(item.sku || "").toLowerCase() === sku.toLowerCase());
      const poLine = (po.items || []).find((item) => String(item.sku || "").toLowerCase() === sku.toLowerCase());
      const varianceStatus = String(line.varianceStatus || "none").toLowerCase();
      const varianceNote = String(line.varianceNote || "").trim();
      const locationBin = String(line.locationBin || defaultLocationBin || "").trim();
      const providedSerials = Array.isArray(line.serials) ? line.serials : [];
      const serials = [];
      for (let index = 0; index < qtyReceived; index += 1) {
        const serialInput = providedSerials[index] || {};
        const noSerial = serialInput.noSerial === true || String(serialInput.noSerial).toLowerCase() === "true";
        const manualSerial = String(serialInput.serialNumber || "").trim();
        const serialNumber = noSerial || !manualSerial ? generatedReceiptSerial(po, vendor, receivedAt, sku, index + 1) : manualSerial;
        const serialRecord = {
          id: crypto.randomUUID(),
          serialNumber,
          noSerial,
          status: "available",
          sku,
          productId: product?.id || "",
          poId: po.id,
          poNumber: po.poNumber,
          vendorId: vendor?.id || "",
          vendorCode: vendor?.vendorNumber || "",
          warehouseId: warehouse?.id || po.warehouseId || "",
          warehouseName: warehouse?.name || po.warehouseName || "",
          locationBin,
          receivedAt,
          createdAt: new Date().toISOString()
        };
        serials.push(serialRecord);
      }
      receipt.items.push({
        sku,
        title: product?.title || poLine?.title || sku,
        qtyReceived,
        orderedQty: Number(poLine?.qty || 0),
        receivedBefore: Number(poLine?.receivedQty || 0),
        varianceStatus,
        varianceNote,
        locationBin,
        serials
      });

      if (!product || mode === "draft") {
        totalReceived += qtyReceived;
        continue;
      }

      product.serialUnits = Array.isArray(product.serialUnits) ? product.serialUnits : [];
      serials.forEach((serialRecord) => product.serialUnits.push(serialRecord));
      const warehouseStockRow = warehouse ? ensureInventoryWarehouseStock(product, warehouse) : null;
      const qtyBefore = Number(warehouseStockRow?.qty ?? product.qty ?? 0);
      const reservedBefore = Number(warehouseStockRow?.reserved ?? product.reserved ?? 0);
      if (warehouseStockRow) {
        warehouseStockRow.qty = Number(warehouseStockRow.qty || 0) + qtyReceived;
        warehouseStockRow.locationBin = locationBin || warehouseStockRow.locationBin || "";
        warehouseStockRow.updatedAt = new Date().toISOString();
      }
      syncInventoryTotalsFromWarehouses(product);
      product.stockQty = Number(product.stockQty || 0) + qtyReceived;
      product.stockStatus = varianceStatus === "damaged" ? "Received with damage" : "Received";
      product.stockUpdatedAt = receivedAt;
      product.updatedAt = new Date().toISOString();
      if (poLine) {
        poLine.receivedQty = Number(poLine.receivedQty || 0) + qtyReceived;
        poLine.remainingQty = Math.max(0, Number(poLine.qty || 0) - Number(poLine.receivedQty || 0));
        poLine.lastReceivedAt = receivedAt;
        poLine.lastLocationBin = locationBin;
        poLine.lastVarianceStatus = varianceStatus;
        poLine.lastVarianceNote = varianceNote;
      }
      Object.assign(receipt.items[receipt.items.length - 1], {
        qtyBefore,
        qtyAfter: Number(warehouseStockRow?.qty ?? product.qty)
      });
      addInventoryLedger(db, product, {
        type: varianceStatus === "damaged" ? "po_receipt_damaged" : "po_receipt",
        source: "purchase_order",
        referenceId: po.id,
        referenceNumber: po.poNumber,
        warehouseId: warehouse?.id || po.warehouseId || "",
        warehouseName: warehouse?.name || po.warehouseName || "",
        locationBin,
        quantityChange: qtyReceived,
        qtyBefore,
        qtyAfter: Number(warehouseStockRow?.qty ?? product.qty),
        reservedBefore,
        reservedAfter: Number(warehouseStockRow?.reserved ?? product.reserved ?? 0),
        serials,
        reason: `${note || `Received on ${po.poNumber}`}${varianceStatus !== "none" ? ` / variance: ${varianceStatus}${varianceNote ? ` (${varianceNote})` : ""}` : ""}${locationBin ? ` / bin: ${locationBin}` : ""}`,
        user: body.user || "Luis"
      });
      totalReceived += qtyReceived;
    }

    if (!totalReceived) return sendJson(res, 400, { error: mode === "draft" ? "Enter at least one line to save a draft receipt." : "Enter at least one received quantity for a matching SKU." });
    if (mode === "draft") {
      po.receiptDrafts = Array.isArray(po.receiptDrafts) ? po.receiptDrafts : [];
      po.receiptDrafts.unshift(receipt);
      po.updatedAt = new Date().toISOString();
      addPoTimeline(po, {
        type: "draft",
        title: "Receipt draft saved",
        message: `${receipt.receiptNumber} saved with ${totalReceived} unit${totalReceived === 1 ? "" : "s"} planned${note ? `: ${note}` : "."}`,
        user: body.user || "Luis"
      });
      await writeDb(db);
      return sendJson(res, 200, { purchaseOrder: po, state: publicState(db) });
    }

    po.receipts = Array.isArray(po.receipts) ? po.receipts : [];
    po.receipts.unshift(receipt);
    po.receivedUnits = Number(po.receivedUnits || 0) + totalReceived;
    po.status = (po.items || []).every((item) => Number(item.receivedQty || 0) >= Number(item.qty || 0)) ? "received" : "partially_received";
    po.receivedAt = receivedAt;
    po.updatedAt = new Date().toISOString();
    addPoTimeline(po, {
      type: "received",
      title: po.status === "received" ? "PO received" : "PO partially received",
      message: `${totalReceived} unit${totalReceived === 1 ? "" : "s"} received${attachments.length ? ` / ${attachments.length} attachment${attachments.length === 1 ? "" : "s"}` : ""}${note ? `: ${note}` : "."}`,
      user: body.user || "Luis"
    });

    await writeDb(db);
    return sendJson(res, 200, { purchaseOrder: po, state: publicState(db) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "purchase-orders" && parts[3] === "returns") {
    const body = await parseBody(req);
    const po = (db.purchaseOrders || []).find((row) => row.id === parts[2]);
    if (!po) return notFound(res);
    po.returns = Array.isArray(po.returns) ? po.returns : [];
    const warehouse = (db.warehouses || []).find((item) => item.id === body.warehouseId || item.id === po.warehouseId) || null;
    const vendorReturn = {
      id: crypto.randomUUID(),
      returnNumber: `RTV-${String(po.returns.length + 1).padStart(4, "0")}`,
      status: "draft",
      warehouseId: warehouse?.id || po.warehouseId || "",
      warehouseName: warehouse?.name || po.warehouseName || "",
      reason: body.reason || "Vendor return created from PO.",
      items: Array.isArray(body.items) ? body.items : po.items || [],
      createdBy: body.user || "Luis",
      createdAt: new Date().toISOString()
    };
    po.returns.push(vendorReturn);
    addPoTimeline(po, {
      type: "return",
      title: "Vendor return created",
      message: `${vendorReturn.returnNumber} created for ${po.poNumber}.`,
      user: body.user || "Luis"
    });
    await writeDb(db);
    return sendJson(res, 200, { return: vendorReturn, purchaseOrder: po, state: publicState(db) });
  }

  if (req.method === "PATCH" && parts[0] === "api" && parts[1] === "customers" && parts[2]) {
    const body = await parseBody(req);
    const customer = (db.customers || []).find((row) => row.id === parts[2]);
    if (!customer) return notFound(res);
    updateCustomerProfile(customer, body);
    await writeDb(db);
    return sendJson(res, 200, { customer, state: publicState(db) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "customers" && parts[3] === "addresses") {
    const body = await parseBody(req);
    const customer = (db.customers || []).find((row) => row.id === parts[2]);
    if (!customer) return notFound(res);
    normalizeCustomerLists(customer);
    const type = String(body.type || "shipping").toLowerCase() === "billing" ? "billing" : "shipping";
    const key = type === "billing" ? "billingAddresses" : "shippingAddresses";
    const address = normalizeAddress({
      label: body.label || (type === "billing" ? `Billing ${customer[key].length + 1}` : `Shipping ${customer[key].length + 1}`),
      isDefault: customer[key].length === 0
    }, type);
    customer[key].push(address);
    if (key === "shippingAddresses") customer.defaultAddress = customer.shippingAddresses[0] || {};
    if (key === "billingAddresses") customer.billingAddress = customer.billingAddresses[0] || {};
    addCustomerTimeline(customer, {
      type: "address",
      title: `${type === "billing" ? "Billing" : "Shipping"} address added`,
      message: `${address.label} added.`
    });
    await writeDb(db);
    return sendJson(res, 200, { customer, state: publicState(db) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "customers") {
    const body = await parseBody(req);
    const name = String(body.name || "").trim();
    if (!name) return sendJson(res, 400, { error: "Customer name is required." });
    db.customers = db.customers || [];
    const customer = {
      id: crypto.randomUUID(),
      customerNumber: nextCustomerNumber(db),
      name,
      email: String(body.email || ""),
      phone: String(body.phone || ""),
      company: "",
      customerType: "Retail",
      status: "active",
      preferredChannel: "Email",
      taxExempt: false,
      marketingOptIn: false,
      tags: [],
      identities: [],
      marketplaceAccounts: [],
      shippingAddresses: [],
      billingAddresses: [],
      defaultAddress: {},
      billingAddress: {},
      totalOrders: 0,
      lifetimeValue: 0,
      repeatCustomer: false,
      notes: "",
      matchKey: `manual:${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    normalizeCustomerLists(customer);
    db.customers.unshift(customer);
    await writeDb(db);
    return sendJson(res, 200, { customer, state: publicState(db) });
  }

  if (req.method === "PATCH" && parts[0] === "api" && parts[1] === "brands" && parts[2]) {
    const body = await parseBody(req);
    const brand = (db.brands || []).find((row) => row.id === parts[2]);
    if (!brand) return notFound(res);
    const textFields = new Set(["name", "status", "category", "website", "logoUrl", "logoDataUrl", "mapPolicy", "warranty", "leadTimeNotes", "notes"]);
    for (const [field, value] of Object.entries(body)) {
      if (textFields.has(field)) brand[field] = String(value || "");
    }
    if (body.preferredVendorId !== undefined) {
      const preferred = body.preferredVendorId ? findVendorById(db, body.preferredVendorId) : null;
      if (body.preferredVendorId && !preferred) return sendJson(res, 400, { error: "Preferred vendor not found." });
      brand.preferredVendorId = preferred?.id || "";
      brand.vendorIds = Array.isArray(brand.vendorIds) ? brand.vendorIds : [];
      if (preferred && !brand.vendorIds.includes(preferred.id)) brand.vendorIds.push(preferred.id);
    }
    if (Array.isArray(body.vendorIds)) {
      brand.vendorIds = body.vendorIds.filter((id) => findVendorById(db, id));
      if (brand.preferredVendorId && !brand.vendorIds.includes(brand.preferredVendorId)) brand.preferredVendorId = brand.vendorIds[0] || "";
    }
    if (body.notes !== undefined) brand.notes = String(body.notes || "");
    brand.updatedAt = new Date().toISOString();
    await writeDb(db);
    return sendJson(res, 200, { brand, state: publicState(db) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "brands") {
    const body = await parseBody(req);
    const name = String(body.name || "").trim();
    if (!name) return sendJson(res, 400, { error: "Brand name is required." });
    db.brands = db.brands || [];
    const existing = db.brands.find((brand) => brand.name.toLowerCase() === name.toLowerCase());
    if (existing) return sendJson(res, 400, { error: "Brand already exists." });
    const brand = {
      id: crypto.randomUUID(),
      name,
      status: "active",
      vendorIds: [],
      preferredVendorId: "",
      logoUrl: "",
      logoDataUrl: "",
      category: "",
      website: "",
      mapPolicy: "",
      warranty: "",
      leadTimeNotes: "",
      notes: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.brands.unshift(brand);
    await writeDb(db);
    return sendJson(res, 200, { brand, state: publicState(db) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "brands" && parts[3] === "action") {
    const body = await parseBody(req);
    const brand = (db.brands || []).find((row) => row.id === parts[2]);
    if (!brand) return notFound(res);
    const action = String(body.action || "").toLowerCase();
    const nextStatus = { enable: "active", disable: "inactive", void: "void" }[action];
    if (!nextStatus) return sendJson(res, 400, { error: "Unsupported brand action." });
    brand.status = nextStatus;
    brand.updatedAt = new Date().toISOString();
    await writeDb(db);
    return sendJson(res, 200, { brand, state: publicState(db) });
  }

  if (req.method === "PATCH" && parts[0] === "api" && parts[1] === "vendors" && parts[2]) {
    const body = await parseBody(req);
    const vendor = findVendorById(db, parts[2]);
    if (!vendor) return notFound(res);

    const allowedFields = new Set(["name", "status", "type", "contactName", "email", "phone", "website", "paymentTerms", "leadTimeDays", "moq", "notes", "rating"]);
    const numericFields = new Set(["leadTimeDays", "moq", "rating"]);
    const submissionFields = new Set(["preferredMethod", "apiEnabled", "apiBaseUrl", "apiAuthType", "apiKeyReference", "ftpEnabled", "ftpHost", "ftpPort", "ftpUsername", "ftpPath", "emailEnabled", "emailTo", "emailCc", "emailSubjectTemplate", "attachCsv", "attachPdf"]);
    const booleanSubmissionFields = new Set(["apiEnabled", "ftpEnabled", "emailEnabled", "attachCsv", "attachPdf"]);
    const changes = [];
    for (const [field, rawValue] of Object.entries(body)) {
      if (field.startsWith("submissionSettings.")) {
        const key = field.split(".")[1];
        if (!submissionFields.has(key)) continue;
        vendor.submissionSettings = vendor.submissionSettings || {};
        const value = booleanSubmissionFields.has(key) ? Boolean(rawValue) : String(rawValue ?? "");
        if (vendor.submissionSettings[key] !== value) {
          changes.push(`${field} changed`);
          vendor.submissionSettings[key] = value;
        }
        continue;
      }
      if (!allowedFields.has(field)) continue;
      const value = numericFields.has(field) ? Number(rawValue || 0) : String(rawValue ?? "");
      if (vendor[field] !== value) {
        changes.push(`${field} changed from "${vendor[field] ?? ""}" to "${value}"`);
        vendor[field] = value;
      }
    }
    if (changes.length) {
      addVendorChange(vendor, {
        type: "edited",
        title: "Vendor profile edited",
        message: changes.join(", "),
        user: body.user || "Luis"
      });
    }

    await writeDb(db);
    return sendJson(res, 200, { vendor, state: publicState(db) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "vendors" && parts.length === 2) {
    const body = await parseBody(req);
    const name = String(body.name || "").trim();
    if (!name) return sendJson(res, 400, { error: "Vendor name is required." });
    db.vendors = db.vendors || [];
    const vendor = normalizeVendor(db, {
      id: crypto.randomUUID(),
      vendorNumber: nextVendorNumber(db),
      name,
      status: "active",
      type: String(body.type || "Supplier"),
      contactName: String(body.contactName || ""),
      email: String(body.email || ""),
      phone: String(body.phone || ""),
      website: String(body.website || ""),
      notes: String(body.notes || ""),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    db.vendors.unshift(vendor);
    await writeDb(db);
    return sendJson(res, 200, { vendor, state: publicState(db) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "vendors" && parts[3] === "files") {
    const body = await parseBody(req);
    const vendor = findVendorById(db, parts[2]);
    if (!vendor) return notFound(res);
    const type = String(body.type || "attachments");
    const allowed = new Set(["priceUpdates", "inventory", "productCatalog", "attachments"]);
    if (!allowed.has(type)) return sendJson(res, 400, { error: "Unsupported vendor file type." });
    vendor.fileFeeds = vendor.fileFeeds || { priceUpdates: [], inventory: [], productCatalog: [], attachments: [] };
    vendor.fileFeeds[type] = Array.isArray(vendor.fileFeeds[type]) ? vendor.fileFeeds[type] : [];
    const record = {
      id: crypto.randomUUID(),
      name: String(body.name || "Unnamed file"),
      source: String(body.source || "Manual upload"),
      size: Number(body.size || 0),
      mimeType: String(body.mimeType || ""),
      uploadedBy: body.user || "Luis",
      uploadedAt: new Date().toISOString()
    };
    vendor.fileFeeds[type].unshift(record);
    addVendorChange(vendor, {
      type: "file",
      title: "Vendor file uploaded",
      message: `${record.name} added to ${type}.`,
      user: body.user || "Luis"
    });
    await writeDb(db);
    return sendJson(res, 200, { file: record, vendor, state: publicState(db) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "vendors" && parts[3] === "action") {
    const body = await parseBody(req);
    const vendor = findVendorById(db, parts[2]);
    if (!vendor) return notFound(res);
    const action = String(body.action || "").toLowerCase();
    const nextStatus = { inactive: "inactive", active: "active" }[action];
    if (!nextStatus) return sendJson(res, 400, { error: "Unsupported vendor action." });

    if (vendor.status !== nextStatus) {
      const previousStatus = vendor.status;
      vendor.status = nextStatus;
      addVendorChange(vendor, {
        type: "status",
        title: `Vendor set as ${nextStatus}`,
        message: `Status changed from ${previousStatus} to ${nextStatus}.`,
        user: body.user || "Luis"
      });
    }

    await writeDb(db);
    return sendJson(res, 200, { vendor, state: publicState(db) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "orders" && parts[3] === "action") {
    const body = await parseBody(req);
    const order = db.orders.find((row) => row.id === parts[2]);
    if (!order) return notFound(res);

    const action = String(body.action || "").toLowerCase();
    const nextStatus = {
      approve: "approved",
      hold: "hold",
      cancel: "canceled"
    }[action];
    if (!nextStatus) return sendJson(res, 400, { error: "Unsupported order action." });

    order.status = nextStatus;
    order.actionedAt = new Date().toISOString();
    order.actionNote = body.note || "";
    if (action === "approve") order.approvedAt = order.actionedAt;
    if (action === "hold") order.holdAt = order.actionedAt;
    if (action === "cancel") order.canceledAt = order.actionedAt;
    addOrderTimeline(order, {
      type: "status",
      title: `Order ${nextStatus}`,
      message: body.note || `Status changed to ${nextStatus}.`,
      user: body.user || "Luis"
    });

    await writeDb(db);
    return sendJson(res, 200, { order, state: publicState(db) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "orders" && parts[3] === "fulfill") {
    const body = await parseBody(req);
    const order = db.orders.find((row) => row.id === parts[2]);
    if (!order) return notFound(res);

    const carrier = String(body.carrier || "").trim();
    const carrierName = String(body.carrierName || carrier).trim();
    const trackingNumber = String(body.trackingNumber || "").trim();
    const trackingUrl = String(body.trackingUrl || "").trim();
    const shipDate = String(body.shipDate || "").trim();
    const warehouse = (db.warehouses || []).find((row) => row.id === body.warehouseId) || findPreferredOrderWarehouse(db, order);
    if (!carrier) return sendJson(res, 400, { error: "Carrier is required." });
    if (!trackingNumber) return sendJson(res, 400, { error: "Tracking number is required." });
    if (carrier.toLowerCase() === "other" && !carrierName) return sendJson(res, 400, { error: "Carrier name is required for unsupported carriers." });
    if (carrier.toLowerCase() === "other" && !trackingUrl) return sendJson(res, 400, { error: "Tracking URL is required for unsupported carriers." });
    if (!shipDate) return sendJson(res, 400, { error: "Ship date is required." });
    if (!warehouse) return sendJson(res, 400, { error: "Warehouse is required." });

    const orderLines = Array.isArray(order.items) && order.items.length
      ? order.items
      : [{ sku: order.sku, title: order.title, qty: Number(order.qty || 1), price: Number(order.total || 0) }];
    const requestedLines = (Array.isArray(body.lines) ? body.lines : [])
      .map((line) => ({
        sku: String(line.sku || "").trim(),
        qty: Number(line.qty || 0),
        lineIndex: Number(line.lineIndex || 0)
      }))
      .filter((line) => line.sku && line.qty > 0);
    if (!requestedLines.length) return sendJson(res, 400, { error: "Select at least one line to fulfill." });
    order.fulfillmentLines = Array.isArray(order.fulfillmentLines) ? order.fulfillmentLines : [];
    const previousStatus = order.status || "new";
    let totalFulfilledNow = 0;

    for (const requestLine of requestedLines) {
      const orderLine = orderLines[requestLine.lineIndex] && String(orderLines[requestLine.lineIndex].sku || "").toLowerCase() === requestLine.sku.toLowerCase()
        ? orderLines[requestLine.lineIndex]
        : orderLines.find((line) => String(line.sku || "").toLowerCase() === requestLine.sku.toLowerCase());
      if (!orderLine) return sendJson(res, 400, { error: `Order line ${requestLine.sku} not found.` });
      const fulfillmentRow = order.fulfillmentLines.find((line) => Number(line.lineIndex || 0) === Number(requestLine.lineIndex || 0) && String(line.sku || "").toLowerCase() === requestLine.sku.toLowerCase())
        || order.fulfillmentLines.find((line) => String(line.sku || "").toLowerCase() === requestLine.sku.toLowerCase());
      const alreadyFulfilled = Number(fulfillmentRow?.qtyFulfilled || 0);
      const remaining = Math.max(0, Number(orderLine.qty || 0) - alreadyFulfilled);
      if (remaining <= 0) continue;
      if (requestLine.qty > remaining) return sendJson(res, 400, { error: `Cannot fulfill more than remaining qty for ${requestLine.sku}.` });

      const inventory = db.inventory.find((item) => String(item.sku || "").toLowerCase() === requestLine.sku.toLowerCase());
      if (inventory) {
        const stockRow = ensureInventoryWarehouseStock(inventory, warehouse);
        const qtyBefore = Number(stockRow.qty || 0);
        const reservedBefore = Number(stockRow.reserved || 0);
        if (qtyBefore < requestLine.qty) return sendJson(res, 400, { error: `Not enough stock in ${warehouse.name} to fulfill ${requestLine.sku}.` });
        stockRow.reserved = Math.max(0, Number(stockRow.reserved || 0) - requestLine.qty);
        stockRow.qty = Math.max(0, Number(stockRow.qty || 0) - requestLine.qty);
        stockRow.updatedAt = new Date().toISOString();
        syncInventoryTotalsFromWarehouses(inventory);
        inventory.updatedAt = new Date().toISOString();
        addInventoryLedger(db, inventory, {
          type: "order_fulfillment",
          source: "order",
          referenceId: order.id,
          referenceNumber: order.orderNumber,
          warehouseId: warehouse.id,
          warehouseName: warehouse.name,
          locationBin: stockRow.locationBin || "",
          quantityChange: Number(stockRow.qty || 0) - qtyBefore,
          reservedChange: Number(stockRow.reserved || 0) - reservedBefore,
          qtyBefore,
          qtyAfter: Number(stockRow.qty || 0),
          reservedBefore,
          reservedAfter: Number(stockRow.reserved || 0),
          reason: `Fulfilled ${requestLine.qty} of ${requestLine.sku} on ${order.orderNumber}`,
          user: body.user || "Luis"
        });
      }

      if (fulfillmentRow) fulfillmentRow.qtyFulfilled = alreadyFulfilled + requestLine.qty;
      else {
        order.fulfillmentLines.push({
          sku: requestLine.sku,
          lineIndex: requestLine.lineIndex,
          qtyFulfilled: requestLine.qty
        });
      }
      totalFulfilledNow += requestLine.qty;
    }

    const totalOrderedQty = orderLines.reduce((sum, line) => sum + Number(line.qty || 0), 0);
    const totalFulfilledQty = order.fulfillmentLines.reduce((sum, line) => sum + Number(line.qtyFulfilled || 0), 0);
    order.status = totalFulfilledQty >= totalOrderedQty ? "fulfilled" : "partial_fulfilled";
    order.fulfilledAt = order.status === "fulfilled" ? new Date().toISOString() : order.fulfilledAt || "";
    order.confirmedAt = order.confirmedAt || new Date().toISOString();
    order.shippingCarrier = carrier;
    order.carrierName = carrierName;
    order.shippingService = carrierName;
    order.trackingNumber = trackingNumber;
    order.trackingUrl = trackingUrl;
    order.shipDate = shipDate;
    order.fulfillmentWarehouseId = warehouse.id;
    order.fulfillmentWarehouseName = warehouse.name;
    order.updatedAt = new Date().toISOString();

    addOrderTimeline(order, {
      type: "status",
      title: order.status === "fulfilled" ? "Order fulfilled" : "Order partially fulfilled",
      message: `${carrierName} tracking ${trackingNumber} added for ship date ${shipDate} from ${warehouse.name}. ${totalFulfilledNow} unit${totalFulfilledNow === 1 ? "" : "s"} fulfilled.${previousStatus !== order.status ? ` Status moved from ${previousStatus} to ${order.status}.` : ""}`,
      user: body.user || "Luis"
    });

    await writeDb(db);
    return sendJson(res, 200, { order, state: publicState(db) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "orders" && parts[3] === "confirm") {
    const order = db.orders.find((row) => row.id === parts[2]);
    if (!order) return notFound(res);
    if (order.status !== "confirmed") {
      const previousStatus = order.status;
      order.status = "confirmed";
      order.confirmedAt = new Date().toISOString();
      const inventory = db.inventory.find((item) => item.sku === order.sku);
      if (inventory) {
        const qtyBefore = Number(inventory.qty || 0);
        const reservedBefore = Number(inventory.reserved || 0);
        inventory.reserved = Math.max(0, Number(inventory.reserved || 0) - Number(order.qty || 0));
        inventory.qty = Math.max(0, Number(inventory.qty || 0) - Number(order.qty || 0));
        inventory.updatedAt = new Date().toISOString();
        addInventoryLedger(db, inventory, {
          type: "order_confirm",
          source: "order",
          referenceId: order.id,
          referenceNumber: order.orderNumber,
          quantityChange: Number(inventory.qty || 0) - qtyBefore,
          reservedChange: Number(inventory.reserved || 0) - reservedBefore,
          qtyBefore,
          qtyAfter: Number(inventory.qty || 0),
          reservedBefore,
          reservedAfter: Number(inventory.reserved || 0),
          reason: `Confirmed ${order.orderNumber}`,
          user: "Luis"
        });
      }
      addOrderTimeline(order, {
        type: "status",
        title: "Order confirmed",
        message: `Status changed from ${previousStatus} to confirmed and inventory was updated.`,
        user: "Luis"
      });
    }
    await writeDb(db);
    return sendJson(res, 200, { order, state: publicState(db) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "orders" && parts[3] === "returns") {
    const body = await parseBody(req);
    const order = db.orders.find((row) => row.id === parts[2]);
    if (!order) return notFound(res);
    const warehouseValue = String(
      body.warehouseId ||
      body.warehouse?.id ||
      body.warehouse ||
      order.returnWarehouseId ||
      ""
    ).trim();
    const warehouse = (db.warehouses || []).find((item) =>
      item.id === warehouseValue ||
      String(item.code || "").trim().toLowerCase() === warehouseValue.toLowerCase() ||
      String(item.name || "").trim().toLowerCase() === warehouseValue.toLowerCase()
    );
    if (!warehouse) return sendJson(res, 400, { error: "Warehouse is required." });
    const orderItems = Array.isArray(order.items) && order.items.length ? order.items : [{ sku: order.sku, title: order.title, qty: order.qty || 1, price: order.total || 0 }];
    const items = (Array.isArray(body.items) ? body.items : orderItems)
      .map((item, index) => {
        const fallback = orderItems[index] || orderItems.find((line) => String(line.sku || "").toLowerCase() === String(item.sku || "").toLowerCase()) || {};
        return {
          sku: String(item.sku || fallback.sku || "").trim(),
          title: String(item.title || fallback.title || fallback.sku || "").trim(),
          qty: Number(item.qty || item.qtySelected || 0),
          price: Number(item.price ?? fallback.price ?? 0),
          cost: Number(item.cost ?? fallback.cost ?? 0),
          lineIndex: Number(item.lineIndex || index)
        };
      })
      .filter((item) => item.sku && item.qty > 0);
    if (!items.length) return sendJson(res, 400, { error: "Select at least one returned line item." });
    const attachments = (Array.isArray(body.attachments) ? body.attachments : []).map((file) => normalizeReturnAttachment(file, body.user || "Luis"));
    const record = {
      id: crypto.randomUUID(),
      returnNumber: nextReturnNumber(db),
      orderId: order.id,
      orderNumber: order.orderNumber,
      source: order.source,
      sku: order.sku || items[0]?.sku || "",
      qty: items.reduce((sum, item) => sum + Number(item.qty || 0), 0) || 1,
      items,
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      reason: String(body.reason || "Return created from order.").trim(),
      amount: Number(body.amount || order.total || 0),
      status: String(body.status || "requested"),
      condition: String(body.condition || "Unknown"),
      note: String(body.note || "").trim(),
      returnFee: Number(body.returnFee || 0),
      attachments,
      createdAt: String(body.createdAt || new Date().toISOString().slice(0, 10)),
      createdBy: body.user || "Luis",
      receivedAt: "",
      receivedBy: "",
      binLocation: "",
      inspectionStatus: "",
      inspectionCondition: "",
      inspectionNotes: "",
      disposition: "",
      resolutionNotes: "",
      resolvedAt: "",
      resolvedBy: "",
      restockedAt: ""
    };
    db.returns = Array.isArray(db.returns) ? db.returns : [];
    db.returns.unshift(record);
    order.returnWarehouseId = warehouse.id;
    order.returnWarehouseName = warehouse.name;
    addOrderTimeline(order, {
      type: "return",
      title: "Return created",
      message: `${record.returnNumber} created for ${warehouse.name}.${record.reason ? ` ${record.reason}` : ""}${attachments.length ? ` ${attachments.length} image${attachments.length === 1 ? "" : "s"} attached.` : ""}`,
      user: body.user || "Luis"
    });
    await writeDb(db);
    return sendJson(res, 200, { return: record, state: publicState(db) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "orders" && parts[3] === "refunds") {
    const body = await parseBody(req);
    const order = db.orders.find((row) => row.id === parts[2]);
    if (!order) return notFound(res);
    const orderItems = Array.isArray(order.items) && order.items.length
      ? order.items
      : [{ sku: order.sku, title: order.title, qty: Number(order.qty || 1), price: Number(order.total || 0) }];
    const items = (Array.isArray(body.items) ? body.items : [])
      .map((item, index) => {
        const fallback = orderItems[index] || orderItems.find((line) => String(line.sku || "").toLowerCase() === String(item.sku || "").toLowerCase()) || {};
        return {
          sku: String(item.sku || fallback.sku || "").trim(),
          title: String(item.title || fallback.title || fallback.sku || "").trim(),
          qty: Number(item.qty || 0),
          price: Number(item.price ?? fallback.price ?? 0),
          lineIndex: Number(item.lineIndex || index)
        };
      })
      .filter((item) => item.sku && item.qty > 0);
    if (!items.length) return sendJson(res, 400, { error: "Select at least one line item to refund." });
    const calculatedAmount = items.reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.qty || 0)), 0);
    const amount = Number(body.amount || calculatedAmount || 0);
    if (!(amount > 0)) return sendJson(res, 400, { error: "Refund amount must be greater than zero." });
    const refundedAt = String(body.refundedAt || new Date().toISOString().slice(0, 10)).trim();
    order.refunds = Array.isArray(order.refunds) ? order.refunds : [];
    const refund = {
      id: crypto.randomUUID(),
      amount,
      items: items.map((item) => ({
        sku: item.sku,
        title: item.title,
        qty: Number(item.qty || 0),
        price: Number(item.price || 0),
        lineIndex: Number(item.lineIndex || 0)
      })),
      refundedAt,
      method: String(body.method || "manual").trim(),
      reference: String(body.reference || "").trim(),
      reason: String(body.reason || "Order refund").trim(),
      note: String(body.note || "").trim(),
      createdAt: new Date().toISOString(),
      createdBy: body.user || "Luis"
    };
    order.refunds.unshift(refund);
    order.refundAmount = Number(order.refundAmount || 0) + amount;
    order.refundPendingAmount = Math.max(0, Number(order.refundPendingAmount || 0) - amount);
    order.refundRequired = order.refundPendingAmount > 0;
    order.updatedAt = new Date().toISOString();
    addOrderTimeline(order, {
      type: "refund",
      title: "Refund recorded",
      message: `$${amount.toFixed(2)} refunded on ${refundedAt} via ${refund.method}.${refund.reference ? ` Ref ${refund.reference}.` : ""}${refund.reason ? ` ${refund.reason}.` : ""}`,
      user: refund.createdBy
    });
    await writeDb(db);
    return sendJson(res, 200, { refund, order, state: publicState(db) });
  }

  if (req.method === "PATCH" && parts[0] === "api" && parts[1] === "returns" && parts[2]) {
    const body = await parseBody(req);
    const record = (db.returns || []).find((row) => row.id === parts[2]);
    if (!record) return notFound(res);
    const order = (db.orders || []).find((row) => row.id === record.orderId);
    const normalizedStatus = body.status !== undefined
      ? (["resolved", "done"].includes(String(body.status || "").trim().toLowerCase()) ? "done" : String(body.status || record.status).trim())
      : record.status;
    record.items = Array.isArray(record.items) ? record.items : [{ sku: record.sku, title: record.title || record.sku || "", qty: Number(record.qty || 1), lineIndex: 0 }];
    record.attachments = Array.isArray(record.attachments) ? record.attachments : [];
    if (body.status !== undefined) record.status = normalizedStatus;
    if (body.condition !== undefined) record.condition = String(body.condition || record.condition).trim();
    if (body.reason !== undefined) record.reason = String(body.reason || record.reason).trim();
    if (body.note !== undefined) record.note = String(body.note || record.note).trim();
    if (body.returnFee !== undefined) record.returnFee = Number(body.returnFee || 0);
    if (body.binLocation !== undefined) record.binLocation = String(body.binLocation || "").trim();
    if (body.receivedAt !== undefined) record.receivedAt = String(body.receivedAt || "").trim();
    if (body.receivedBy !== undefined) record.receivedBy = String(body.receivedBy || "").trim();
    if (body.inspectionStatus !== undefined) record.inspectionStatus = String(body.inspectionStatus || "").trim();
    if (body.inspectionCondition !== undefined) record.inspectionCondition = String(body.inspectionCondition || "").trim();
    if (body.inspectionNotes !== undefined) record.inspectionNotes = String(body.inspectionNotes || "").trim();
    if (body.disposition !== undefined) record.disposition = String(body.disposition || "").trim();
    if (body.resolutionNotes !== undefined) record.resolutionNotes = String(body.resolutionNotes || "").trim();
    if (Array.isArray(body.items)) {
      record.items = body.items.map((item, index) => ({
        sku: String(item.sku || "").trim(),
        title: String(item.title || item.sku || "").trim(),
        qty: Number(item.qty || item.qtySelected || 0),
        price: Number(item.price || 0),
        cost: Number(item.cost || 0),
        lineIndex: Number(item.lineIndex || index)
      })).filter((item) => item.sku && item.qty > 0);
      if (record.items.length) {
        record.sku = record.items[0].sku;
        record.qty = record.items.reduce((sum, item) => sum + Number(item.qty || 0), 0);
      }
    }
    if (Array.isArray(body.attachments) && body.attachments.length) {
      const nextAttachments = body.attachments.map((file) => normalizeReturnAttachment(file, body.user || "Luis"));
      const existing = new Map(record.attachments.map((file) => [file.id, file]));
      nextAttachments.forEach((file) => existing.set(file.id, file));
      record.attachments = Array.from(existing.values());
    }
    if (body.warehouseId) {
      const warehouse = (db.warehouses || []).find((item) => item.id === body.warehouseId);
      if (warehouse) {
        record.warehouseId = warehouse.id;
        record.warehouseName = warehouse.name;
      }
    }
    const actingUser = body.user || "Luis";
    if (record.status === "received" && !record.receivedAt) {
      record.receivedAt = new Date().toISOString().slice(0, 10);
    }
    if (record.status === "received" && !record.receivedBy) {
      record.receivedBy = actingUser;
    }
    if (record.status === "done" && !record.receivedAt) {
      record.receivedAt = new Date().toISOString().slice(0, 10);
    }
    if (record.status === "done" && !record.receivedBy) {
      record.receivedBy = actingUser;
    }
    let restocked = false;
    if (["resolved", "done"].includes(String(record.status || "").toLowerCase()) && record.disposition === "restock" && !record.restockedAt) {
      const warehouse = (db.warehouses || []).find((row) => row.id === record.warehouseId);
      for (const line of record.items) {
        const item = (db.inventory || []).find((row) => String(row.sku || "").toLowerCase() === String(line.sku || "").toLowerCase());
        if (!item) continue;
        const qtyBefore = Number(item.qty || 0);
        const reservedBefore = Number(item.reserved || 0);
        if (warehouse) {
          const stockRow = ensureInventoryWarehouseStock(item, warehouse);
          stockRow.qty = Number(stockRow.qty || 0) + Number(line.qty || 0);
          stockRow.locationBin = record.binLocation || stockRow.locationBin || defaultWarehouseBinCode(warehouse);
          stockRow.updatedAt = new Date().toISOString();
        }
        syncInventoryTotalsFromWarehouses(item);
        item.updatedAt = new Date().toISOString();
        addInventoryLedger(db, item, {
          type: "return_restock",
          source: "returns",
          referenceId: record.id,
          referenceNumber: record.returnNumber,
          quantityChange: Number(item.qty || 0) - qtyBefore,
          reservedChange: Number(item.reserved || 0) - reservedBefore,
          qtyBefore,
          qtyAfter: Number(item.qty || 0),
          reservedBefore,
          reservedAfter: Number(item.reserved || 0),
          reason: `Restocked ${line.qty} of ${line.sku} from ${record.returnNumber}`,
          warehouseId: record.warehouseId || "",
          warehouseName: record.warehouseName || "",
          locationBin: record.binLocation || "",
          user: actingUser
        });
        restocked = true;
      }
      record.restockedAt = new Date().toISOString();
    }
    const isFinalReturnStatus = ["resolved", "done"].includes(String(record.status || "").toLowerCase());
    record.resolvedAt = isFinalReturnStatus ? (record.resolvedAt || new Date().toISOString()) : record.resolvedAt || "";
    record.resolvedBy = isFinalReturnStatus ? (record.resolvedBy || actingUser) : record.resolvedBy || "";
    if (order) {
      const resolvedReturns = (db.returns || []).filter((item) => (item.orderId === order.id || item.orderNumber === order.orderNumber) && ["resolved", "done"].includes(String(item.status || "").toLowerCase()));
      const refundRequiredAmount = resolvedReturns.reduce((sum, item) => sum + Math.max(0, Number(item.amount || 0) - Number(item.returnFee || 0)), 0);
      order.refundRequired = refundRequiredAmount > Number(order.refundAmount || 0);
      order.refundPendingAmount = Math.max(0, refundRequiredAmount - Number(order.refundAmount || 0));
      addOrderTimeline(order, {
        type: "return",
        title: "Return updated",
        message: `${record.returnNumber} moved to ${record.status}.${record.disposition ? ` Disposition: ${record.disposition}.` : ""}${restocked ? " Inventory restocked." : ""}${order.refundPendingAmount > 0 ? ` Refund due: $${order.refundPendingAmount.toFixed(2)}.` : ""}`,
        user: actingUser
      });
    }
    await writeDb(db);
    return sendJson(res, 200, { return: record, state: publicState(db) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "warehouses") {
    const body = await parseBody(req);
    const name = String(body.name || "").trim();
    if (!name) return sendJson(res, 400, { error: "Warehouse name is required." });
    db.warehouses = db.warehouses || [];
    const warehouse = normalizeWarehouse({
      id: crypto.randomUUID(),
      code: String(body.code || nextWarehouseCode(db)).trim(),
      name,
      status: String(body.status || "active"),
      warehouseType: String(body.warehouseType || "Warehouse").trim(),
      contactName: String(body.contactName || "").trim(),
      managerName: String(body.managerName || "").trim(),
      phone: String(body.phone || "").trim(),
      email: String(body.email || "").trim(),
      timezone: String(body.timezone || "America/New_York").trim(),
      operatingHours: String(body.operatingHours || "").trim(),
      carrierCutoffTime: String(body.carrierCutoffTime || "").trim(),
      receivingInstructions: String(body.receivingInstructions || "").trim(),
      addressLine1: String(body.addressLine1 || "").trim(),
      addressLine2: String(body.addressLine2 || "").trim(),
      city: String(body.city || "").trim(),
      state: String(body.state || "").trim(),
      postalCode: String(body.postalCode || "").trim(),
      country: String(body.country || "US").trim(),
      isDefaultReceiving: Boolean(body.isDefaultReceiving),
      isDefaultReturns: Boolean(body.isDefaultReturns),
      requireAppointment: Boolean(body.requireAppointment),
      allowBlindReceipts: body.allowBlindReceipts === undefined ? true : Boolean(body.allowBlindReceipts),
      requireSerialScan: Boolean(body.requireSerialScan),
      requirePhotoForDamage: Boolean(body.requirePhotoForDamage),
      autoRouteReturns: Boolean(body.autoRouteReturns),
      bins: [],
      notes: String(body.notes || "").trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    if (warehouse.isDefaultReceiving) {
      db.warehouses.forEach((item) => { item.isDefaultReceiving = false; });
    }
    if (warehouse.isDefaultReturns) {
      db.warehouses.forEach((item) => { item.isDefaultReturns = false; });
    }
    db.warehouses.unshift(warehouse);
    await writeDb(db);
    return sendJson(res, 200, { warehouse, state: publicState(db) });
  }

  if (req.method === "PATCH" && parts[0] === "api" && parts[1] === "warehouses" && parts[2]) {
    const body = await parseBody(req);
    const warehouse = (db.warehouses || []).find((row) => row.id === parts[2]);
    if (!warehouse) return notFound(res);
    const fields = [
      "code",
      "name",
      "status",
      "warehouseType",
      "contactName",
      "managerName",
      "phone",
      "email",
      "timezone",
      "operatingHours",
      "carrierCutoffTime",
      "receivingInstructions",
      "addressLine1",
      "addressLine2",
      "city",
      "state",
      "postalCode",
      "country",
      "isDefaultReceiving",
      "isDefaultReturns",
      "requireAppointment",
      "allowBlindReceipts",
      "requireSerialScan",
      "requirePhotoForDamage",
      "autoRouteReturns",
      "notes"
    ];
    for (const field of fields) {
      if (body[field] === undefined) continue;
      if ([
        "isDefaultReceiving",
        "isDefaultReturns",
        "requireAppointment",
        "allowBlindReceipts",
        "requireSerialScan",
        "requirePhotoForDamage",
        "autoRouteReturns"
      ].includes(field)) {
        warehouse[field] = Boolean(body[field]);
      } else {
        warehouse[field] = String(body[field] ?? "").trim();
      }
    }
    if (body.isDefaultReceiving) {
      (db.warehouses || []).forEach((item) => {
        if (item.id !== warehouse.id) item.isDefaultReceiving = false;
      });
    }
    if (body.isDefaultReturns) {
      (db.warehouses || []).forEach((item) => {
        if (item.id !== warehouse.id) item.isDefaultReturns = false;
      });
    }
    warehouse.addressLine = formatWarehouseAddress(warehouse);
    warehouse.updatedAt = new Date().toISOString();
    await writeDb(db);
    return sendJson(res, 200, { warehouse, state: publicState(db) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "warehouses" && parts[2] && parts[3] === "bins") {
    const body = await parseBody(req);
    const warehouse = (db.warehouses || []).find((row) => row.id === parts[2]);
    if (!warehouse) return notFound(res);
    warehouse.bins = Array.isArray(warehouse.bins) ? warehouse.bins : [];
    const bin = normalizeWarehouseBin({
      id: crypto.randomUUID(),
      code: body.code,
      name: body.name,
      type: body.type,
      isDefault: body.isDefault,
      active: body.active === undefined ? true : body.active,
      notes: body.notes
    }, warehouse.bins.length);
    if (bin.isDefault) warehouse.bins.forEach((item) => { item.isDefault = false; });
    warehouse.bins.push(bin);
    warehouse.updatedAt = new Date().toISOString();
    await writeDb(db);
    return sendJson(res, 200, { warehouse, bin, state: publicState(db) });
  }

  if (req.method === "PATCH" && parts[0] === "api" && parts[1] === "warehouses" && parts[2] && parts[3] === "bins" && parts[4]) {
    const body = await parseBody(req);
    const warehouse = (db.warehouses || []).find((row) => row.id === parts[2]);
    if (!warehouse) return notFound(res);
    warehouse.bins = Array.isArray(warehouse.bins) ? warehouse.bins : [];
    const bin = warehouse.bins.find((item) => item.id === parts[4]);
    if (!bin) return notFound(res);
    const fields = ["code", "name", "type", "notes"];
    for (const field of fields) {
      if (body[field] !== undefined) bin[field] = String(body[field] ?? "").trim();
    }
    if (body.active !== undefined) bin.active = Boolean(body.active);
    if (body.isDefault !== undefined) {
      const nextDefault = Boolean(body.isDefault);
      if (nextDefault) warehouse.bins.forEach((item) => { item.isDefault = false; });
      bin.isDefault = nextDefault;
    }
    if (!warehouse.bins.some((item) => item.isDefault) && warehouse.bins.length) warehouse.bins[0].isDefault = true;
    warehouse.updatedAt = new Date().toISOString();
    await writeDb(db);
    return sendJson(res, 200, { warehouse, bin, state: publicState(db) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "sync" && parts[2]) {
    const source = decodeURIComponent(parts[2]);
    if (source === "Temu") {
      const result = await importTemuOrders(db);
      const connection = db.connections.find((item) => item.name === source);
      if (connection) {
        connection.connected = true;
        connection.lastSync = new Date().toISOString();
      }
      const message = `Imported ${result.created} new and updated ${result.updated} Temu order${result.fetched === 1 ? "" : "s"}.`;
      db.syncRuns.unshift({
        id: crypto.randomUUID(),
        source,
        type: "orders",
        status: result.errors.length ? "warning" : "success",
        message: result.errors.length ? `${message} ${result.errors.length} detail calls need review.` : message,
        createdAt: new Date().toISOString(),
        errors: result.errors.slice(0, 10)
      });
      await writeDb(db);
      const normalized = normalizeDb(db);
      return sendJson(res, 200, { added: result.created, updated: result.updated, state: publicState(normalized) });
    }

    if (source === "eBay") {
      const result = await importEbayOrders(db);
      const connection = db.connections.find((item) => item.name === source);
      if (connection) {
        connection.connected = true;
        connection.lastSync = new Date().toISOString();
      }
      const message = `Imported ${result.created} new and updated ${result.updated} eBay order${result.fetched === 1 ? "" : "s"}.`;
      db.syncRuns.unshift({
        id: crypto.randomUUID(),
        source,
        type: "orders",
        status: result.errors.length ? "warning" : "success",
        message: result.errors.length ? `${message} ${result.errors.length} order rows need review.` : message,
        createdAt: new Date().toISOString(),
        errors: result.errors.slice(0, 10)
      });
      await writeDb(db);
      const normalized = normalizeDb(db);
      return sendJson(res, 200, { added: result.created, updated: result.updated, state: publicState(normalized) });
    }

    const orders = demoOrdersFor(source);
    for (const order of orders) upsertOrder(db, order);
    const connection = db.connections.find((item) => item.name === source);
    if (connection) {
      connection.connected = true;
      connection.lastSync = new Date().toISOString();
    }
    db.syncRuns.unshift({
      id: crypto.randomUUID(),
      source,
      type: "orders",
      status: "success",
      message: `Downloaded ${orders.length} demo order from ${source}.`,
      createdAt: new Date().toISOString()
    });
    await writeDb(db);
    const normalized = normalizeDb(db);
    return sendJson(res, 200, { added: orders.length, state: publicState(normalized) });
  }

  return notFound(res);
}

async function handleTemuCallback(req, res) {
  const db = await readDb();
  const url = new URL(req.url, `http://${req.headers.host}`);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error") || url.searchParams.get("error_description");

  if (error) {
    return sendHtml(res, 400, `
      <!doctype html>
      <title>Temu Authorization Failed</title>
      <body style="font-family:system-ui;padding:32px">
        <h1>Temu authorization failed</h1>
        <p>${escapeHtml(error)}</p>
        <p><a href="/">Return to DataPlus</a></p>
      </body>
    `);
  }

  try {
    const result = await exchangeTemuCode(db, code);
    return sendHtml(res, 200, `
      <!doctype html>
      <title>Temu Connected</title>
      <body style="font-family:system-ui;padding:32px">
        <h1>Temu connected</h1>
        <p>Access token saved${result.mallId ? ` for mall ${escapeHtml(result.mallId)}` : ""}.</p>
        <p><a href="/">Return to DataPlus</a></p>
      </body>
    `);
  } catch (exchangeError) {
    return sendHtml(res, 500, `
      <!doctype html>
      <title>Temu Token Exchange Failed</title>
      <body style="font-family:system-ui;padding:32px">
        <h1>Temu token exchange failed</h1>
        <p>${escapeHtml(exchangeError.message)}</p>
        <p><a href="/">Return to DataPlus</a></p>
      </body>
    `);
  }
}

async function handleEbayStart(req, res) {
  try {
    if (postgres.isPostgresEnabled()) {
      const db = { connectorState: {} };
      const authUrl = ebayConsentUrl(db);
      res.writeHead(302, { Location: authUrl });
      res.end();
      return;
    }
    const db = await readDb();
    const authUrl = ebayConsentUrl(db);
    await writeDb(db);
    res.writeHead(302, { Location: authUrl });
    res.end();
  } catch (error) {
    return sendHtml(res, 400, `
      <!doctype html>
      <title>eBay Setup Needed</title>
      <body style="font-family:system-ui;padding:32px;line-height:1.5">
        <h1>eBay setup needed</h1>
        <p>${escapeHtml(error.message)}</p>
        <p>Add your eBay developer values to <code>.env</code>, restart DataPlus, then try Connect eBay again.</p>
        <p><a href="/">Return to DataPlus</a></p>
      </body>
    `);
  }
}

async function handleEbayCallback(req, res) {
  if (postgres.isPostgresEnabled()) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error") || url.searchParams.get("error_description");

    if (error) {
      return sendHtml(res, 400, `
        <!doctype html>
        <title>eBay Authorization Failed</title>
        <body style="font-family:system-ui;padding:32px">
          <h1>eBay authorization failed</h1>
          <p>${escapeHtml(error)}</p>
          <p><a href="/">Return to DataPlus</a></p>
        </body>
      `);
    }

    try {
      const result = await exchangeEbayCode({ connectorState: readConnectorStateSync() }, code, { connectorOnly: true });
      return sendHtml(res, 200, `
        <!doctype html>
        <title>eBay Connected</title>
        <body style="font-family:system-ui;padding:32px">
          <h1>eBay connected</h1>
          <p>Access token saved for ${escapeHtml(result.environment)}.</p>
          <p><a href="/">Return to DataPlus</a></p>
        </body>
      `);
    } catch (exchangeError) {
      return sendHtml(res, 500, `
        <!doctype html>
        <title>eBay Token Exchange Failed</title>
        <body style="font-family:system-ui;padding:32px">
          <h1>eBay token exchange failed</h1>
          <p>${escapeHtml(exchangeError.message)}</p>
          <p><a href="/">Return to DataPlus</a></p>
        </body>
      `);
    }
  }

  const db = await readDb();
  const url = new URL(req.url, `http://${req.headers.host}`);
  const code = url.searchParams.get("code");
  const stateToken = url.searchParams.get("state");
  const error = url.searchParams.get("error") || url.searchParams.get("error_description");

  if (error) {
    return sendHtml(res, 400, `
      <!doctype html>
      <title>eBay Authorization Failed</title>
      <body style="font-family:system-ui;padding:32px">
        <h1>eBay authorization failed</h1>
        <p>${escapeHtml(error)}</p>
        <p><a href="/">Return to DataPlus</a></p>
      </body>
    `);
  }

  if (db.connectorState?.ebayOauthState && stateToken !== db.connectorState.ebayOauthState) {
    return sendHtml(res, 400, `
      <!doctype html>
      <title>eBay Authorization Failed</title>
      <body style="font-family:system-ui;padding:32px">
        <h1>eBay authorization failed</h1>
        <p>The eBay callback state did not match. Start the connection again from DataPlus.</p>
        <p><a href="/">Return to DataPlus</a></p>
      </body>
    `);
  }

  try {
    const result = await exchangeEbayCode(db, code);
    return sendHtml(res, 200, `
      <!doctype html>
      <title>eBay Connected</title>
      <body style="font-family:system-ui;padding:32px">
        <h1>eBay connected</h1>
        <p>Access token saved for ${escapeHtml(result.environment)}.</p>
        <p><a href="/">Return to DataPlus</a></p>
      </body>
    `);
  } catch (exchangeError) {
    return sendHtml(res, 500, `
      <!doctype html>
      <title>eBay Token Exchange Failed</title>
      <body style="font-family:system-ui;padding:32px">
        <h1>eBay token exchange failed</h1>
        <p>${escapeHtml(exchangeError.message)}</p>
        <p><a href="/">Return to DataPlus</a></p>
      </body>
    `);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

ensureDb();

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/auth/temu/callback")) {
    handleTemuCallback(req, res).catch((error) => {
      sendHtml(res, 500, `<h1>Temu callback error</h1><p>${escapeHtml(error.message)}</p>`);
    });
  } else if (req.url.startsWith("/auth/ebay/start")) {
    handleEbayStart(req, res).catch((error) => {
      sendHtml(res, 500, `<h1>eBay auth start error</h1><p>${escapeHtml(error.message)}</p>`);
    });
  } else if (req.url.startsWith("/auth/ebay/callback")) {
    handleEbayCallback(req, res).catch((error) => {
      sendHtml(res, 500, `<h1>eBay callback error</h1><p>${escapeHtml(error.message)}</p>`);
    });
  } else if (req.url.startsWith("/api/")) {
    handleApi(req, res).catch((error) => {
      console.error(error);
      const status = error.message.includes("credentials missing") || error.message.includes("authorization code is required") || error.message.includes("refresh token is missing") ? 400 : 500;
      sendJson(res, status, { error: error.message });
    });
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, () => {
  console.log(`DataPlus is running at http://localhost:${PORT}`);
});
