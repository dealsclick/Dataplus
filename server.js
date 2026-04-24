const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const postgres = require("./db");

const PORT = process.env.PORT || 4173;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const ENV_FILE = path.join(ROOT, ".env");

const SOURCES = ["Temu", "eBay", "Whatnot", "TikTok Shop"];
const ORDER_PREFIX = "DP";

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
  if (postgres.isPostgresEnabled()) await postgres.writeState(db);
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function writeDbSync(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
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

function normalizeDb(db) {
  let changed = false;
  db.sequence = db.sequence || {};
  db.sequence.order = Number(db.sequence.order || 1000);
  db.sequence.po = Number(db.sequence.po || 2000);
  db.sequence.vendor = Number(db.sequence.vendor || 3000);
  db.sequence.draft = Number(db.sequence.draft || 0);
  db.inventoryLedger = Array.isArray(db.inventoryLedger) ? db.inventoryLedger : [];
  db.marketplaceTemplates = normalizeMarketplaceTemplates(db.marketplaceTemplates);
  db.connections = (db.connections || SOURCES.map((name) => ({ id: crypto.randomUUID(), name }))).map(normalizeChannel);

  db.inventory = (db.inventory || []).map((item) => {
    const defaults = PRODUCT_DEFAULTS[item.sku] || {};
    const product = {
      price: Number(item.price ?? defaults.price ?? 0),
      cost: Number(item.cost ?? defaults.cost ?? 0),
      msrp: Number(item.msrp ?? defaults.msrp ?? 0),
      brand: item.brand ?? defaults.brand ?? "",
      category: item.category ?? defaults.category ?? "",
      condition: item.condition ?? defaults.condition ?? "New",
      status: item.status ?? defaults.status ?? "Draft",
      barcode: item.barcode ?? defaults.barcode ?? "",
      shortDescription: item.shortDescription ?? defaults.shortDescription ?? "",
      longDescription: item.longDescription ?? defaults.longDescription ?? "",
      images: Array.isArray(item.images) ? item.images : defaults.images || [],
      tags: Array.isArray(item.tags) ? item.tags : defaults.tags || [],
      weightOz: Number(item.weightOz ?? defaults.weightOz ?? 0),
      lengthIn: Number(item.lengthIn ?? defaults.lengthIn ?? 0),
      widthIn: Number(item.widthIn ?? defaults.widthIn ?? 0),
      heightIn: Number(item.heightIn ?? defaults.heightIn ?? 0),
      vendor: item.vendor ?? defaults.vendor ?? "",
      marketplaceTitle: item.marketplaceTitle ?? defaults.marketplaceTitle ?? item.title,
      seoKeywords: item.seoKeywords ?? defaults.seoKeywords ?? "",
      externalId: item.externalId ?? item._id ?? "",
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
      stockQty: Number(item.stockQty ?? item.stock_qty ?? item.qty ?? 0),
      stockStatus: item.stockStatus ?? item.stock_status ?? "",
      stockUpdatedAt: item.stockUpdatedAt ?? item.stock_updated_at ?? "",
      ctechId: item.ctechId ?? item.ctech_id ?? "",
      ctechIdLastExport: item.ctechIdLastExport ?? item.ctech_id_last_export ?? "",
      fobPrice: Number(item.fobPrice ?? item.fob_price ?? 0),
      wildcardSearch: item.wildcardSearch ?? "",
      serialUnits: Array.isArray(item.serialUnits) ? item.serialUnits : [],
      warehouseStock: Array.isArray(item.warehouseStock) ? item.warehouseStock : [],
      shadowSkus: Array.isArray(item.shadowSkus) ? item.shadowSkus.map((shadow) => normalizeShadowSku(shadow, item)) : [],
      attributes: item.attributes || {}
    };

    const merged = { ...product, ...item, images: product.images, tags: product.tags, serialUnits: product.serialUnits, warehouseStock: product.warehouseStock, shadowSkus: product.shadowSkus };
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
  const existing = new Map((db.brands || []).map((brand) => [String(brand.name || "").toLowerCase(), brand]));
  for (const item of db.inventory || []) {
    const name = String(item.brand || "").trim();
    if (!name) continue;
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
      if (body.length > 5_000_000) {
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
  const text = String(value ?? "");
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
  return rows.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
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

function publicState(db) {
  const safeDb = {
    ...db,
    connectorState: {
      temuAuthorized: Boolean(db.connectorState?.temuAccessToken),
      temuMallId: db.connectorState?.temuMallId || "",
      temuLastOrderSync: db.connectorState?.temuLastOrderSync || null
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
    productCost: existing.productCost || incoming.productCost,
    marketplaceFees: existing.marketplaceFees || incoming.marketplaceFees,
    shippingCost: existing.shippingCost || incoming.shippingCost,
    refundAmount: existing.refundAmount || incoming.refundAmount
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

function parseList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || "")
    .split(/[|,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function inventoryPayloadFromRecord(record) {
  const payload = {};
  const textFields = ["marketplaceTitle", "brand", "category", "condition", "status", "barcode", "shortDescription", "longDescription", "vendor", "seoKeywords", "externalId", "defaultImage", "manufacturer", "mfrPartNumber", "vendorSku", "supplier", "supplierCode", "unspsc", "uom", "uomQty", "minQuantity", "quantityIncrements", "sdsUrl", "stockStatus", "stockUpdatedAt", "ctechId", "ctechIdLastExport", "wildcardSearch"];
  const numberFields = ["price", "cost", "msrp", "weightOz", "lengthIn", "widthIn", "heightIn", "reorderPoint", "itemHeight", "itemLength", "itemWeight", "itemWidth", "packageHeight", "packageLength", "packageWeight", "packageWidth", "stockQty", "fobPrice"];

  for (const field of textFields) {
    if (record[field] !== undefined) payload[field] = String(record[field]).trim();
  }
  for (const field of numberFields) {
    if (record[field] !== undefined && Number.isFinite(Number(record[field]))) payload[field] = Number(record[field]);
  }
  if (record.hazardous !== undefined) payload.hazardous = record.hazardous === true || String(record.hazardous).toLowerCase() === "true";
  if (record.images !== undefined) payload.images = parseList(record.images);
  if (record.tags !== undefined) payload.tags = parseList(record.tags);
  return payload;
}

function applyInventoryPatch(item, body) {
  const textFields = ["sku", "title", "marketplaceTitle", "brand", "category", "condition", "status", "barcode", "shortDescription", "longDescription", "vendor", "seoKeywords", "externalId", "defaultImage", "manufacturer", "mfrPartNumber", "vendorSku", "supplier", "supplierCode", "unspsc", "uom", "uomQty", "minQuantity", "quantityIncrements", "sdsUrl", "stockStatus", "stockUpdatedAt", "ctechId", "ctechIdLastExport", "wildcardSearch"];
  const numberFields = ["qty", "reserved", "reorderPoint", "price", "cost", "msrp", "weightOz", "lengthIn", "widthIn", "heightIn", "itemHeight", "itemLength", "itemWeight", "itemWidth", "packageHeight", "packageLength", "packageWeight", "packageWidth", "stockQty", "fobPrice"];

  for (const field of textFields) {
    if (body[field] !== undefined) item[field] = String(body[field]);
  }
  for (const field of numberFields) {
    if (body[field] !== undefined && Number.isFinite(Number(body[field]))) item[field] = Number(body[field]);
  }
  if (body.hazardous !== undefined) item.hazardous = body.hazardous === true || String(body.hazardous).toLowerCase() === "true";
  if (body.images !== undefined) item.images = parseList(body.images);
  if (body.tags !== undefined) item.tags = parseList(body.tags);
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

async function handleApi(req, res) {
  const db = await readDb();
  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split("/").filter(Boolean);

  if (req.method === "GET" && url.pathname === "/api/state") {
    return sendJson(res, 200, publicState(db));
  }

  if (req.method === "POST" && url.pathname === "/api/temu/exchange-code") {
    const body = await parseBody(req);
    const result = await exchangeTemuCode(db, body.code);
    const normalized = normalizeDb(await readDb());
    return sendJson(res, 200, { ...result, state: publicState(normalized) });
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

  if (req.method === "POST" && url.pathname === "/api/import/inventory") {
    const body = await parseBody(req);
    const records = parseCsv(body.csv || "");
    let changed = 0;

    for (const record of records) {
      const sku = String(record.sku || record.SKU || "").trim();
      if (!sku) continue;

      const existing = db.inventory.find((item) => item.sku.toLowerCase() === sku.toLowerCase());
      const qty = Number(record.qty ?? record.quantity ?? record.QTY);
      const title = String(record.title || record.name || existing?.title || sku).trim();
      const productFields = inventoryPayloadFromRecord(record);

      if (existing) {
        if (Number.isFinite(qty)) existing.qty = qty;
        existing.title = title;
        Object.assign(existing, productFields);
        existing.updatedAt = new Date().toISOString();
      } else {
        db.inventory.push({
          id: crypto.randomUUID(),
          sku,
          title,
          ...productFields,
          qty: Number.isFinite(qty) ? qty : 0,
          reserved: 0,
          reorderPoint: Number(record.reorderPoint || 0),
          sources: {},
          updatedAt: new Date().toISOString()
        });
      }
      changed += 1;
    }

    db.syncRuns.unshift({
      id: crypto.randomUUID(),
      source: "CSV",
      type: "inventory",
      status: "success",
      message: `Updated ${changed} inventory row${changed === 1 ? "" : "s"} from CSV.`,
      createdAt: new Date().toISOString()
    });
    await writeDb(db);
    return sendJson(res, 200, { changed, state: publicState(db) });
  }

  if (req.method === "PATCH" && parts[0] === "api" && parts[1] === "inventory" && parts[2] && parts.length === 3) {
    const body = await parseBody(req);
    const item = db.inventory.find((row) => row.id === parts[2]);
    if (!item) return notFound(res);
    const qtyBefore = Number(item.qty || 0);
    const reservedBefore = Number(item.reserved || 0);
    applyInventoryPatch(item, body);
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
        const serialNumber = noSerial || !manualSerial ? generatedSerial(po, vendor, receivedAt, index + 1) : manualSerial;
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
  } else if (req.url.startsWith("/api/")) {
    handleApi(req, res).catch((error) => {
      const status = error.message.includes("credentials missing") || error.message.includes("authorization code is required") ? 400 : 500;
      sendJson(res, status, { error: error.message });
    });
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, () => {
  console.log(`DataPlus is running at http://localhost:${PORT}`);
});
