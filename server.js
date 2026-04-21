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
  return normalizeDb(db);
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
      attributes: item.attributes || {}
    };

    if (item.price === undefined || item.shortDescription === undefined || !Array.isArray(item.images)) changed = true;
    return { ...product, ...item, images: product.images, tags: product.tags };
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
    enriched.timeline = normalizeOrderTimeline(enriched);
    if (!order.internalOrderNumber || !order.customerId || !order.items || order.productCost === undefined || !order.address) changed = true;
    return enriched;
  });

  const customerResult = normalizeCustomers(db);
  if (customerResult.changed) changed = true;

  if (!Array.isArray(db.returns)) {
    db.returns = [
      {
        id: crypto.randomUUID(),
        orderNumber: "TT-90221",
        source: "TikTok Shop",
        sku: "DP-BEAUTY-014",
        reason: "Changed mind",
        amount: 19.99,
        status: "requested",
        createdAt: "2026-04-21T15:20:00.000Z"
      }
    ];
    changed = true;
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

  if (changed) writeDbSync(db);
  return db;
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

function nextOrderNumber(db) {
  db.sequence = db.sequence || {};
  db.sequence.order = Number(db.sequence.order || 1000) + 1;
  return `${ORDER_PREFIX}-${String(db.sequence.order).padStart(6, "0")}`;
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
        defaultAddress: order.address || {},
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
    customer.defaultAddress = customer.defaultAddress?.line1 ? customer.defaultAddress : order.address || {};
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
      if (body.length > 1_000_000) {
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
  return {
    inventoryCount: db.inventory.length,
    openOrders,
    lowStock,
    reserved,
    sales,
    profit,
    customerCount: customers.length,
    repeatCustomers: customers.filter((customer) => customer.repeatCustomer).length,
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
  const textFields = ["marketplaceTitle", "brand", "category", "condition", "status", "barcode", "shortDescription", "longDescription", "vendor", "seoKeywords"];
  const numberFields = ["price", "cost", "msrp", "weightOz", "lengthIn", "widthIn", "heightIn", "reorderPoint"];

  for (const field of textFields) {
    if (record[field] !== undefined) payload[field] = String(record[field]).trim();
  }
  for (const field of numberFields) {
    if (record[field] !== undefined && Number.isFinite(Number(record[field]))) payload[field] = Number(record[field]);
  }
  if (record.images !== undefined) payload.images = parseList(record.images);
  if (record.tags !== undefined) payload.tags = parseList(record.tags);
  return payload;
}

function applyInventoryPatch(item, body) {
  const textFields = ["sku", "title", "marketplaceTitle", "brand", "category", "condition", "status", "barcode", "shortDescription", "longDescription", "vendor", "seoKeywords"];
  const numberFields = ["qty", "reserved", "reorderPoint", "price", "cost", "msrp", "weightOz", "lengthIn", "widthIn", "heightIn"];

  for (const field of textFields) {
    if (body[field] !== undefined) item[field] = String(body[field]);
  }
  for (const field of numberFields) {
    if (body[field] !== undefined && Number.isFinite(Number(body[field]))) item[field] = Number(body[field]);
  }
  if (body.images !== undefined) item.images = parseList(body.images);
  if (body.tags !== undefined) item.tags = parseList(body.tags);
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

  if (req.method === "PATCH" && parts[0] === "api" && parts[1] === "inventory" && parts[2]) {
    const body = await parseBody(req);
    const item = db.inventory.find((row) => row.id === parts[2]);
    if (!item) return notFound(res);
    applyInventoryPatch(item, body);
    item.updatedAt = new Date().toISOString();
    await writeDb(db);
    return sendJson(res, 200, { item, summary: summarize(db) });
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
    order.updatedAt = new Date().toISOString();
    if (changes.length) {
      addOrderTimeline(order, {
        type: "edited",
        title: "Order financials edited",
        message: changes.join(", "),
        user: body.user || "Luis"
      });
    }
    await writeDb(db);
    return sendJson(res, 200, { order, state: publicState(db) });
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

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "orders" && parts[3] === "confirm") {
    const order = db.orders.find((row) => row.id === parts[2]);
    if (!order) return notFound(res);
    if (order.status !== "confirmed") {
      const previousStatus = order.status;
      order.status = "confirmed";
      order.confirmedAt = new Date().toISOString();
      const inventory = db.inventory.find((item) => item.sku === order.sku);
      if (inventory) {
        inventory.reserved = Math.max(0, Number(inventory.reserved || 0) - Number(order.qty || 0));
        inventory.qty = Math.max(0, Number(inventory.qty || 0) - Number(order.qty || 0));
        inventory.updatedAt = new Date().toISOString();
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
