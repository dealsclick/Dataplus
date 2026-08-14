const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const ftp = require("basic-ftp");
const ROOT = path.join(__dirname, "..");
const ENV_FILE = path.join(ROOT, ".env");
const DATA_DIR = path.join(ROOT, "data");

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

loadLocalEnv();

const postgres = require("../db");
const { createDataQualityEngine } = require("../lib/data-quality");
const dataplus = require("../server");

const WORKER_ID = process.env.DATAPLUS_WORKER_ID || `dataplus-worker-${crypto.randomUUID().slice(0, 8)}`;
const POLL_MS = Math.max(1000, Number(process.env.DATAPLUS_WORKER_POLL_MS || 5000) || 5000);
const HEARTBEAT_MS = Math.max(1000, Number(process.env.DATAPLUS_WORKER_HEARTBEAT_MS || POLL_MS) || POLL_MS);
const RUN_ONCE = ["1", "true", "yes"].includes(String(process.env.DATAPLUS_WORKER_ONCE || "").toLowerCase());
const SUPPORTED_TASKS = [
  "postgres-backup",
  "data-quality-scan",
  "source-search-index",
  "source-performance-indexes",
  "source-facets-refresh",
  "jobs-retention-cleanup",
  "mapped-product-export",
  "category-export",
  "source-catalog-import",
  "mapped-product-import",
  "shopify-status-import",
  "shopify-order-import",
  "shopify-sku-map-sync",
  "shopify-shipping-eligibility-sync",
  "shopify-variant-price-push",
  "shopify-product-create",
  "shopify-product-publication-update",
  "shopify-product-status-update",
  "shopify-existing-variant-link",
  "shopify-product-type-collections-sync",
  "shopify-taxonomy-push",
  "shopify-status-sync",
  "shopify-inventory-update",
  "ebay-category-auto-map",
  "ebay-taxonomy-sync",
  "ebay-catalog-sync",
  "ebay-account-settings-sync",
  "ebay-location-sync",
  "ebay-order-import",
  "ebay-price-inventory-sync",
  "ebay-listing-launch",
  "product-dump-import",
  "vendor-feed-import"
];
let lastHeartbeatAt = 0;
let lastScheduleCheckAt = 0;
let lastSkuMapScheduleCheckAt = 0;
let lastOrderImportScheduleCheckAt = 0;
let lastEbayOrderImportScheduleCheckAt = 0;
let lastEbayPriceInventoryScheduleCheckAt = 0;
let lastSupplierReminderScheduleCheckAt = 0;
let lastVendorFeedScheduleCheckAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function minutesSinceMidnight(date = new Date()) {
  return (date.getHours() * 60) + date.getMinutes();
}

function scheduledMinutes(value = "06:00") {
  const match = String(value || "06:00").match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return 360;
  return (Number(match[1]) * 60) + Number(match[2]);
}

function scheduleTimeValues(value = "") {
  const values = (Array.isArray(value) ? value : String(value || "").split(/[,;\s]+/))
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item) => /^([01]\d|2[0-3]):[0-5]\d$/.test(item));
  return [...new Set(values)].sort((a, b) => scheduledMinutes(a) - scheduledMinutes(b));
}

function dueChannelInventoryScheduleSlot(settings = {}, now = new Date()) {
  const nowMinutes = minutesSinceMidnight(now);
  if (String(settings.inventoryScheduleType || "times").toLowerCase() === "interval") {
    const everyHours = Math.max(1, Math.min(24, Number(settings.inventoryScheduleEveryHours || 12) || 12));
    const intervalMinutes = everyHours * 60;
    const slotStart = Math.floor(nowMinutes / intervalMinutes) * intervalMinutes;
    const hour = Math.floor(slotStart / 60);
    const minute = slotStart % 60;
    return nowMinutes >= slotStart ? `${pad2(hour)}:${pad2(minute)}` : "";
  }
  return scheduleTimeValues(settings.inventoryScheduleTimes || "03:00,13:00")
    .filter((time) => nowMinutes >= scheduledMinutes(time))
    .pop() || "";
}

function dueScheduleSlot(settings = {}, prefix = "inventorySchedule", now = new Date()) {
  const nowMinutes = minutesSinceMidnight(now);
  if (String(settings[`${prefix}Type`] || "times").toLowerCase() === "interval") {
    const everyHours = Math.max(1, Math.min(24, Number(settings[`${prefix}EveryHours`] || 12) || 12));
    const slotStart = Math.floor(nowMinutes / (everyHours * 60)) * everyHours * 60;
    return `${pad2(Math.floor(slotStart / 60))}:${pad2(slotStart % 60)}`;
  }
  return scheduleTimeValues(settings[`${prefix}Times`] || "04:00,16:00")
    .filter((time) => nowMinutes >= scheduledMinutes(time))
    .pop() || "";
}

function normalizeJobPatch(job, patch = {}) {
  const now = new Date().toISOString();
  return {
    ...job,
    ...patch,
    id: job.id,
    status: patch.status || job.status || "running",
    updatedAt: now,
    raw: { ...(job.raw || {}), ...patch, updatedAt: now }
  };
}

function formatCategoryName(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function categoryLookupKey(value = "") {
  return formatCategoryName(value).toLowerCase();
}

function buildWorkerQualityContext(stateDocs = {}) {
  const categorySettings = Array.isArray(stateDocs.categorySettings) ? stateDocs.categorySettings : [];
  const byName = new Map();
  const byId = new Map();
  for (const row of categorySettings) {
    const name = row.name || row.category || row.categoryPath || "";
    const nameKey = categoryLookupKey(name);
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, row);
    const idKey = String(row.categoryId || row.id || "").trim().toLowerCase();
    if (idKey && !byId.has(idKey)) byId.set(idKey, row);
  }
  const ebay = (Array.isArray(stateDocs.connections) ? stateDocs.connections : []).find((row) => String(row.name || "").toLowerCase() === "ebay") || {};
  return {
    ebaySettings: ebay.settings || {},
    categorySetting(product = {}) {
      const key = categoryLookupKey(product.category || product.mainCategory || "");
      return byName.get(key) || byId.get(key) || {};
    },
    categoryChannelMapping(product = {}, channel = "shopify") {
      return this.categorySetting(product)?.mappings?.[channel] || {};
    }
  };
}

function workerDataQualityEngine() {
  return createDataQualityEngine({
    productImageUrls,
    productIsCloseout,
    withShopifyStatus: (item = {}, statusMap = {}) => ({ ...item, ...(statusMap[String(item.sku || "").toLowerCase()] || {}) })
  });
}

function hasText(value, min = 1) {
  return String(value || "").replace(/<[^>]+>/g, " ").trim().length >= min;
}

function numberValue(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function firstText(...values) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function productImageUrls(item = {}) {
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

function productIsCloseout(item = {}) {
  const raw = item.raw && typeof item.raw === "object" ? item.raw : {};
  return item.toBeDiscontinued === true
    || raw.toBeDiscontinued === true
    || raw.to_be_discontinued === true
    || ["y", "yes", "true", "1"].includes(String(raw.toBeDiscontinued || raw.to_be_discontinued || item.to_be_discontinued || "").toLowerCase());
}

function daysSince(value = "") {
  const ms = new Date(value || 0).getTime();
  if (!Number.isFinite(ms) || !ms) return null;
  return Math.max(0, Math.floor((Date.now() - ms) / 86400000));
}

function dataQualityIssueKey(label = "") {
  return String(label || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function sourceCost(item = {}) {
  return numberValue(item.sourceCost ?? item.cost ?? item.raw?.sourceCost ?? item.raw?.cost ?? item.raw?.vendorCost, 0);
}

function sellPrice(item = {}) {
  return numberValue(item.websitePrice ?? item.shopifyPrice ?? item.price ?? item.raw?.websitePrice ?? item.raw?.shopifyPrice ?? item.raw?.price, 0);
}

function itemAvailable(item = {}) {
  const replenishable = item.replenishable === true
    || item.raw?.replenishable === true
    || ["true", "yes", "y", "1"].includes(String(item.replenishable ?? item.raw?.replenishable ?? "").trim().toLowerCase());
  if (replenishable) {
    const qty = numberValue(item.replenishableQty ?? item.raw?.replenishableQty, 0);
    return qty > 0 ? Math.max(1, Math.floor(qty)) : 1;
  }
  return numberValue(item.qty ?? item.stockQty ?? item.raw?.qty ?? item.raw?.stockQty, 0) - numberValue(item.reserved ?? item.raw?.reserved, 0);
}

function mergedShopifyStatus(item = {}, statusMap = {}) {
  const key = String(item.sku || "").toLowerCase();
  const status = statusMap[key] || {};
  return { ...item, ...(status || {}) };
}

function qualityRowForProduct(item = {}, statusMap = {}) {
  const product = mergedShopifyStatus(item, statusMap);
  const raw = product.raw && typeof product.raw === "object" ? product.raw : {};
  const title = firstText(product.marketplaceTitle, product.title, raw.marketplaceTitle, raw.title);
  const description = firstText(product.longDescription, product.shortDescription, raw.longDescription, raw.shortDescription, raw.description);
  const category = firstText(product.category, product.mainCategory, raw.category, raw.mainCategory);
  const brand = firstText(product.brand, raw.brand, product.manufacturer, raw.manufacturer);
  const vendor = firstText(product.vendor, product.supplier, raw.vendor, raw.supplier);
  const barcode = firstText(product.barcode, raw.barcode, raw.upc, raw.gtin);
  const price = sellPrice(product);
  const cost = sourceCost(product);
  const available = itemAvailable(product);
  const margin = price > 0 ? Math.round((((price - cost) / price) * 100) * 10) / 10 : 0;
  const shopifyId = firstText(product.shopifyId, raw.shopifyId);
  const shopifyStatus = firstText(product.shopifyStatus, raw.shopifyStatus);
  const shopifyPublished = product.shopifyPublished === true || raw.shopifyPublished === true;
  const shopifySyncedAt = firstText(product.shopifySyncedAt, raw.shopifySyncedAt);
  const staleDays = daysSince(shopifySyncedAt);
  const ebayListing = product.ebayListing && typeof product.ebayListing === "object" ? product.ebayListing : raw.ebayListing || {};
  const checks = [
    { type: "product", key: "title", label: "Title", ok: hasText(title, 8) },
    { type: "product", key: "description", label: "Description", ok: hasText(description, 40) },
    { type: "product", key: "image", label: "Image", ok: productImageUrls(product).length > 0 },
    { type: "category", key: "category", label: "Main category", ok: hasText(category) && product.categoryVerified !== false },
    { type: "product", key: "brand", label: "Brand", ok: hasText(brand) },
    { type: "pricing", key: "price", label: "Price", ok: price > 0 },
    { type: "pricing", key: "cost", label: "Cost", ok: cost > 0 },
    { type: "pricing", key: "margin", label: "Margin", ok: price > 0 && margin >= 10 },
    { type: "product", key: "vendor", label: "Vendor", ok: hasText(vendor) },
    { type: "inventory", key: "stock", label: "Stock", ok: available > 0 },
    { type: "product", key: "barcode", label: "UPC / barcode", ok: hasText(barcode) },
    { type: "product", key: "dimensions", label: "Weight / dimensions", ok: numberValue(product.weightOz ?? product.itemWeight ?? product.packageWeight ?? raw.weightOz ?? raw.itemWeight ?? raw.packageWeight, 0) > 0 },
    { type: "shopify", key: "shopify-gid", label: "Shopify GID", ok: hasText(shopifyId) },
    { type: "shopify", key: "shopify-status", label: "Shopify status", ok: hasText(shopifyStatus) },
    { type: "shopify", key: "shopify-published", label: "Shopify published", ok: shopifyPublished },
    { type: "freshness", key: "shopify-status-stale", label: "Shopify status freshness", ok: staleDays === null || staleDays <= 7 },
    { type: "ebay", key: "ebay-category", label: "eBay category", ok: hasText(ebayListing.categoryId || product.ebayCategoryId || raw.ebayCategoryId) },
    { type: "ebay", key: "ebay-price", label: "eBay price", ok: numberValue(ebayListing.price || product.ebayPrice || raw.ebayPrice, 0) > 0 || price > 0 },
    { type: "ebay", key: "ebay-quantity", label: "eBay quantity", ok: numberValue(ebayListing.quantity || product.ebayQuantity || raw.ebayQuantity, 0) > 0 || available > 0 }
  ];
  const productChecks = checks.filter((check) => ["product", "category", "inventory"].includes(check.type));
  const shopifyChecks = checks.filter((check) => check.type === "shopify" || check.type === "freshness");
  const ebayChecks = checks.filter((check) => check.type === "ebay");
  const scoreFor = (rows) => Math.round((rows.filter((check) => check.ok).length / Math.max(1, rows.length)) * 100);
  const failed = checks.filter((check) => !check.ok);
  const shopifyLive = hasText(shopifyId) && String(shopifyStatus || "").toLowerCase() === "active" && shopifyPublished;
  const ebayLive = hasText(ebayListing.listingId || product.ebayId || raw.ebayId);
  return {
    id: product.id || product.productId || product.sku,
    sku: product.sku || "",
    title,
    brand,
    vendor,
    category,
    productScore: scoreFor(productChecks),
    shopifyScore: scoreFor(shopifyChecks),
    ebayScore: scoreFor(ebayChecks),
    margin,
    ready: scoreFor(productChecks) >= 80,
    shopifyReady: shopifyChecks.filter((check) => !check.ok && !["shopify-gid", "shopify-status", "shopify-published", "shopify-status-stale"].includes(check.key)).length === 0,
    shopifyLive,
    ebayReady: ebayChecks.every((check) => check.ok),
    ebayLive,
    syncSource: firstText(product.shopifySyncSource, raw.shopifySyncSource, product.syncSource),
    staleDays,
    issues: [...new Set(failed.map((check) => check.label))],
    issueKeys: [...new Set(failed.map((check) => check.key || dataQualityIssueKey(check.label)))],
    issueTypes: [...new Set(failed.map((check) => check.type || "product"))],
    toBeDiscontinued: productIsCloseout(product),
    available
  };
}

function summarizeQualityRows(rows = []) {
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
    storage: "postgres-worker"
  };
}

async function persistJob(job, patch = {}) {
  const next = normalizeJobPatch(job, {
    workerId: WORKER_ID,
    workerLastSeenAt: new Date().toISOString(),
    processRssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    currentFile: patch.currentFile || job.currentFile || job.originalFileName || job.fileName || "",
    ...patch
  });
  await postgres.upsertOperationJob(next);
  return next;
}

async function writeHeartbeat(status = "idle", job = null, force = false) {
  const now = Date.now();
  if (!force && now - lastHeartbeatAt < HEARTBEAT_MS) return;
  lastHeartbeatAt = now;
  await postgres.writeStateDocuments({
    workerHeartbeat: {
      workerId: WORKER_ID,
      status,
      currentJobId: job?.id || "",
      currentTask: job?.workerTask || "",
      supportedTasks: SUPPORTED_TASKS,
      pollMs: POLL_MS,
      heartbeatMs: HEARTBEAT_MS,
      runOnce: RUN_ONCE,
      pid: process.pid,
      processRssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      lastSeenAt: new Date(now).toISOString()
    }
  });
}

function latestSuccessfulProductDumpJob(jobs = []) {
  return (jobs || [])
    .filter((job) => {
      const status = String(job.status || "").toLowerCase();
      return status === "success"
        && (String(job.workerTask || "").toLowerCase() === "product-dump-import" || /product dump/i.test(`${job.operation || ""} ${job.name || ""}`));
    })
    .sort((a, b) => new Date(b.finishedAt || b.updatedAt || b.createdAt || 0) - new Date(a.finishedAt || a.updatedAt || a.createdAt || 0))[0] || null;
}

async function checkScheduledShopifyInventoryUpdate(force = false) {
  const nowMs = Date.now();
  if (!force && nowMs - lastScheduleCheckAt < 60000) return false;
  lastScheduleCheckAt = nowMs;
  const docs = await postgres.readStateDocuments().catch(() => ({})) || {};
  const settings = dataplus.readSystemSettingsStore(docs.systemSettings || {});
  const stateDb = dataplus.normalizeDb(await dataplus.readDbFast({ skipInventory: true }));
  const channels = Array.isArray(stateDb.connections) ? stateDb.connections : [];
  const scheduledChannels = channels.filter((channel) => {
    const channelSettings = channel.settings || {};
    if (channelSettings.channelEnabled === false) return false;
    if (channelSettings.inventoryScheduleEnabled === true || String(channelSettings.inventoryScheduleEnabled).toLowerCase() === "true") return true;
    return String(channel.name || "").toLowerCase() === "shopify" && settings.shopifyDailyInventoryUpdateEnabled;
  });
  if (!scheduledChannels.length) return false;
  const now = new Date(nowMs);
  const today = localDateKey(now);
  const jobs = await postgres.readOperationJobs(500).catch(() => []) || [];
  const latestDump = latestSuccessfulProductDumpJob(jobs);
  const latestDumpFinishedAt = latestDump?.finishedAt || latestDump?.updatedAt || "";
  const scheduleState = docs.channelInventorySchedules && typeof docs.channelInventorySchedules === "object" ? docs.channelInventorySchedules : {};
  let queued = false;
  for (const channel of scheduledChannels) {
    const channelSettings = channel.settings || {};
    const isLegacyShopify = String(channel.name || "").toLowerCase() === "shopify" && !channelSettings.inventoryScheduleEnabled && settings.shopifyDailyInventoryUpdateEnabled;
    const dueSlot = isLegacyShopify
      ? (minutesSinceMidnight(now) >= scheduledMinutes(settings.shopifyDailyInventoryUpdateTime || "06:00") ? String(settings.shopifyDailyInventoryUpdateTime || "06:00") : "")
      : dueChannelInventoryScheduleSlot(channelSettings, now);
    if (!dueSlot) continue;
    const scheduleId = `${channel.id || channel.name || "channel"}:${today}:${dueSlot}`;
    const previous = scheduleState[scheduleId] || {};
    if (previous.lastRunDate === today || previous.lastQueuedDate === today) continue;
    const requireDump = isLegacyShopify ? settings.shopifyDailyInventoryRequireSuccessfulDump : channelSettings.inventoryScheduleRequireSuccessfulDump === true || String(channelSettings.inventoryScheduleRequireSuccessfulDump).toLowerCase() === "true";
    if (requireDump && !latestDump) {
      scheduleState[scheduleId] = {
        ...previous,
        lastCheckedAt: new Date(nowMs).toISOString(),
        lastSkipReason: "No successful product dump import has been found yet."
      };
      continue;
    }
    const apply = isLegacyShopify
      ? settings.shopifyDailyInventoryUpdateMode === "apply"
      : String(channelSettings.inventoryScheduleMode || "dry-run").toLowerCase() === "apply";
    try {
      const result = await dataplus.queueShopifyInventoryUpdateJob(stateDb, {
        apply,
        dryRun: !apply,
        warehouseId: channelSettings.shopifyInventoryWarehouseId || "",
        locationId: channelSettings.shopifyInventoryLocationId || ""
      }, {
        scheduled: true,
        scheduleKey: scheduleId,
        operation: apply ? `Scheduled ${channel.name || "channel"} inventory update` : `Scheduled ${channel.name || "channel"} inventory dry run`
      });
      scheduleState[scheduleId] = {
        ...previous,
        channelId: channel.id || "",
        channelName: channel.name || "",
        time: dueSlot,
        lastCheckedAt: new Date(nowMs).toISOString(),
        lastQueuedAt: result.duplicate ? (previous.lastQueuedAt || "") : new Date(nowMs).toISOString(),
        lastQueuedDate: result.duplicate ? (previous.lastQueuedDate || today) : today,
        lastRunDate: today,
        lastJobId: result.job?.id || "",
        lastMode: apply ? "apply" : "dry-run",
        lastDumpJobId: latestDump?.id || "",
        lastDumpFinishedAt: latestDumpFinishedAt,
        lastSkipReason: result.duplicate ? "An inventory job is already active for this schedule." : "",
        lastError: ""
      };
      queued = !result.duplicate || queued;
      console.log(`[${WORKER_ID}] ${result.duplicate ? "skipped duplicate" : "queued"} scheduled ${channel.name || "channel"} inventory ${apply ? "update" : "dry run"} for ${dueSlot} (${result.job?.id || "duplicate"})`);
    } catch (error) {
      scheduleState[scheduleId] = {
        ...previous,
        channelId: channel.id || "",
        channelName: channel.name || "",
        time: dueSlot,
        lastCheckedAt: new Date(nowMs).toISOString(),
        lastRunDate: today,
        lastAttemptedAt: new Date(nowMs).toISOString(),
        lastAttemptedDate: today,
        lastError: error.message || "Unable to queue scheduled inventory update."
      };
      console.error(`[${WORKER_ID}] scheduled ${channel.name || "channel"} inventory check failed:`, error.message || error);
    }
  }
  await postgres.writeStateDocuments({ channelInventorySchedules: scheduleState });
  return queued;
}

function vendorFeedLocalPath(feed = {}) {
  const safeId = String(feed.id || "vendor-feed").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "vendor-feed";
  const extension = String(feed.fileFormat || "").toLowerCase() === "csv" ? ".csv" : ".bson.gz";
  return path.join(DATA_DIR, "imports", "vendor-feeds", `${safeId}${extension}`);
}

async function checkScheduledVendorFeedImports(force = false) {
  const nowMs = Date.now();
  if (!force && nowMs - lastVendorFeedScheduleCheckAt < 60000) return false;
  lastVendorFeedScheduleCheckAt = nowMs;
  const docs = await postgres.readStateDocuments().catch(() => ({})) || {};
  const settings = dataplus.readSystemSettingsStore(docs.systemSettings || {});
  const feeds = [
    ...(Array.isArray(settings.dataSourceFeeds) ? settings.dataSourceFeeds : []).map((feed) => ({ ...feed, dataSourceFeed: true })),
    ...(Array.isArray(settings.vendorFeedSchedules) ? settings.vendorFeedSchedules : []).filter((feed) => String(feed.id || "") !== "product-datadump").map((feed) => ({ ...feed, dataSourceFeed: false }))
  ];
  const configuredFeeds = feeds.filter((feed) => feed.transport === "ftp" && ["bson-gzip", "csv"].includes(feed.fileFormat) && feed.ftpHost && feed.ftpUsername && feed.ftpPassword && feed.ftpRemotePath && (feed.fileFormat !== "csv" || feed.mappingProfile));
  if (!configuredFeeds.length) return false;
  const now = new Date(nowMs);
  const today = localDateKey(now);
  const scheduleState = docs.vendorFeedSchedules && typeof docs.vendorFeedSchedules === "object" ? docs.vendorFeedSchedules : {};
  const jobs = await postgres.readOperationJobs(500).catch(() => []) || [];
  let queued = false;
  for (const feed of configuredFeeds) {
    const scheduledJobs = feed.dataSourceFeed
      ? [
          {
            key: "refresh",
            enabled: feed.refreshEnabled === undefined ? Boolean(feed.enabled) : Boolean(feed.refreshEnabled),
            label: "refresh",
            syncMode: "reconciliation",
            schedule: { scheduleType: feed.refreshScheduleType || feed.scheduleType, scheduleTimes: feed.refreshScheduleTimes || feed.scheduleTimes, scheduleEveryHours: feed.refreshScheduleEveryHours || feed.scheduleEveryHours }
          },
          {
            key: "full",
            enabled: Boolean(feed.fullImportEnabled),
            label: "full catalog import",
            syncMode: "full",
            schedule: { scheduleType: feed.fullImportScheduleType, scheduleTimes: feed.fullImportScheduleTimes, scheduleEveryHours: feed.fullImportScheduleEveryHours }
          }
        ]
      : [{ key: "import", enabled: Boolean(feed.enabled), label: "import", syncMode: feed.syncMode || "split", schedule: feed }];
    for (const scheduledJob of scheduledJobs) {
      if (!scheduledJob.enabled) continue;
      const slot = dueScheduleSlot(scheduledJob.schedule, "schedule", now);
      if (!slot) continue;
      const stateKey = `${feed.id}:${scheduledJob.key}:${today}:${slot}`;
      const previous = scheduleState[stateKey] || {};
      if (previous.lastQueuedDate === today) continue;
      const duplicate = jobs.find((job) => ["queued", "running"].includes(String(job.status || "").toLowerCase())
        && ["product-dump-import", "vendor-feed-import"].includes(String(job.workerTask || ""))
        && String(job.workerPayload?.feedId || "") === String(feed.id || ""));
      if (duplicate) {
        scheduleState[stateKey] = { ...previous, lastCheckedAt: new Date(nowMs).toISOString(), lastQueuedDate: today, lastJobId: duplicate.id, lastSkipReason: "An import for this feed is already active." };
        continue;
      }
      const localPath = vendorFeedLocalPath(feed);
      const job = {
      id: crypto.randomUUID(),
      section: "Source Catalog",
      category: "Vendor feed",
      operation: `Scheduled ${feed.name} ${scheduledJob.label}`,
      direction: "import",
      status: "queued",
      fileName: path.basename(feed.ftpRemotePath || localPath),
      originalFileName: path.basename(feed.ftpRemotePath || localPath),
      totalRows: 0,
      processedRows: 0,
      progressPercent: 0,
      phase: "queued",
      workerTask: feed.fileFormat === "csv" ? "vendor-feed-import" : "product-dump-import",
      workerPayload: {
        path: localPath,
        downloadFtp: true,
        ftpHost: feed.ftpHost,
        ftpPort: Number(feed.ftpPort || 21),
        ftpUsername: feed.ftpUsername,
        ftpPassword: feed.ftpPassword,
        ftpRemotePath: feed.ftpRemotePath,
        feedId: feed.id,
        vendorId: feed.vendorId || "",
        vendorName: feed.vendorName || "",
        fileFormat: feed.fileFormat,
        importTarget: feed.importTarget || "source-catalog",
        mappingProfile: feed.mappingProfile || "source-catalog-standard",
        templateId: feed.mappingProfile || "",
        postImportInventoryMode: feed.postImportInventoryMode || "dry-run",
        postImportPriceMode: feed.postImportPriceMode || "dry-run",
        syncMode: scheduledJob.syncMode,
        postgresOnly: true,
        batchSize: 5000
      },
      message: `Scheduled ${scheduledJob.label} queued for ${feed.name}.`,
      createdAt: new Date(nowMs).toISOString(),
      updatedAt: new Date(nowMs).toISOString()
      };
      await postgres.upsertOperationJob(job);
      scheduleState[stateKey] = { ...previous, lastCheckedAt: new Date(nowMs).toISOString(), lastQueuedAt: new Date(nowMs).toISOString(), lastQueuedDate: today, lastJobId: job.id, lastSkipReason: "" };
      queued = true;
      console.log(`[${WORKER_ID}] queued scheduled ${scheduledJob.label} for ${feed.name} (${job.id})`);
    }
  }
  await postgres.writeStateDocuments({ vendorFeedSchedules: scheduleState });
  return queued;
}

async function checkScheduledShopifySkuPairAudit(force = false) {
  const nowMs = Date.now();
  if (!force && nowMs - lastSkuMapScheduleCheckAt < 60000) return false;
  lastSkuMapScheduleCheckAt = nowMs;
  const docs = await postgres.readStateDocuments().catch(() => ({})) || {};
  const stateDb = dataplus.normalizeDb(await dataplus.readDbFast({ skipInventory: true }));
  const channels = Array.isArray(stateDb.connections) ? stateDb.connections : [];
  const scheduledChannels = channels.filter((channel) => (
    String(channel.name || "").toLowerCase() === "shopify"
    && channel.settings?.channelEnabled !== false
    && (channel.settings?.shopifySkuMapScheduleEnabled === true || String(channel.settings?.shopifySkuMapScheduleEnabled).toLowerCase() === "true")
  ));
  if (!scheduledChannels.length) return false;
  const now = new Date(nowMs);
  const today = localDateKey(now);
  const scheduleState = docs.channelSkuMapSchedules && typeof docs.channelSkuMapSchedules === "object" ? docs.channelSkuMapSchedules : {};
  let queued = false;
  for (const channel of scheduledChannels) {
    const settings = channel.settings || {};
    const dueSlot = scheduleTimeValues(settings.shopifySkuMapScheduleTime || "02:00")
      .filter((time) => minutesSinceMidnight(now) >= scheduledMinutes(time))
      .pop() || "";
    if (!dueSlot) continue;
    const scheduleId = `${channel.id || channel.name || "shopify"}:${today}:${dueSlot}`;
    const previous = scheduleState[scheduleId] || {};
    if (previous.lastRunDate === today || previous.lastQueuedDate === today) continue;
    try {
      const result = await dataplus.queueShopifySkuMapSyncJob(stateDb, {}, {
        scheduled: true,
        scheduleKey: scheduleId,
        operation: "Scheduled Shopify SKU pair audit"
      });
      scheduleState[scheduleId] = {
        ...previous,
        channelId: channel.id || "",
        channelName: channel.name || "Shopify",
        time: dueSlot,
        lastCheckedAt: new Date(nowMs).toISOString(),
        lastQueuedAt: result.duplicate ? (previous.lastQueuedAt || "") : new Date(nowMs).toISOString(),
        lastQueuedDate: result.duplicate ? (previous.lastQueuedDate || today) : today,
        lastRunDate: today,
        lastJobId: result.job?.id || "",
        lastSkipReason: result.duplicate ? "A Shopify SKU pair audit is already active." : "",
        lastError: ""
      };
      queued = !result.duplicate || queued;
      console.log(`[${WORKER_ID}] ${result.duplicate ? "skipped duplicate" : "queued"} scheduled Shopify SKU pair audit for ${dueSlot} (${result.job?.id || "duplicate"})`);
    } catch (error) {
      scheduleState[scheduleId] = {
        ...previous,
        channelId: channel.id || "",
        channelName: channel.name || "Shopify",
        time: dueSlot,
        lastCheckedAt: new Date(nowMs).toISOString(),
        lastRunDate: today,
        lastAttemptedAt: new Date(nowMs).toISOString(),
        lastError: error.message || "Unable to queue scheduled Shopify SKU pair audit."
      };
      console.error(`[${WORKER_ID}] scheduled Shopify SKU pair audit failed:`, error.message || error);
    }
  }
  await postgres.writeStateDocuments({ channelSkuMapSchedules: scheduleState });
  return queued;
}

async function checkScheduledShopifyOrderImport(force = false) {
  const nowMs = Date.now();
  if (!force && nowMs - lastOrderImportScheduleCheckAt < 60000) return false;
  lastOrderImportScheduleCheckAt = nowMs;
  const docs = await postgres.readStateDocuments().catch(() => ({})) || {};
  const stateDb = dataplus.normalizeDb(await dataplus.readDbFast({ skipInventory: true }));
  const channel = (stateDb.connections || []).find((entry) => String(entry.name || "").toLowerCase() === "shopify");
  const settings = channel?.settings || {};
  if (!channel || settings.channelEnabled === false || !settings.shopifyOrderImportEnabled || !settings.shopifyOrderImportScheduleEnabled) return false;
  const now = new Date(nowMs);
  const dueSlot = dueScheduleSlot(settings, "shopifyOrderImportSchedule", now);
  if (!dueSlot) return false;
  const today = localDateKey(now);
  const scheduleId = `${channel.id || "shopify"}:${today}:${dueSlot}`;
  const scheduleState = docs.channelOrderImportSchedules && typeof docs.channelOrderImportSchedules === "object" ? docs.channelOrderImportSchedules : {};
  const previous = scheduleState[scheduleId] || {};
  if (previous.lastRunDate === today || previous.lastAttemptedDate === today) return false;
  try {
    const result = await dataplus.queueShopifyOrderImportJob(stateDb, {
      limit: settings.shopifyOrderImportLimit,
      sources: settings.shopifyOrderImportSources || "Online Store, Shop",
      includeCanceled: Boolean(settings.shopifyOrderImportIncludeCanceled)
    }, { scheduled: true, scheduleKey: scheduleId, operation: "Scheduled Shopify order reconciliation" });
    scheduleState[scheduleId] = { ...previous, channelId: channel.id || "", channelName: channel.name || "Shopify", time: dueSlot, lastRunDate: today, lastAttemptedDate: today, lastRunAt: new Date(nowMs).toISOString(), lastJobId: result.job?.id || "", lastError: result.duplicate ? "A Shopify order import is already active." : "" };
    console.log(`[${WORKER_ID}] ${result.duplicate ? "skipped duplicate" : "queued"} scheduled Shopify order reconciliation for ${dueSlot} (${result.job?.id || "duplicate"})`);
    await postgres.writeStateDocuments({ channelOrderImportSchedules: scheduleState });
    return true;
  } catch (error) {
    scheduleState[scheduleId] = { ...previous, channelId: channel.id || "", channelName: channel.name || "Shopify", time: dueSlot, lastAttemptedDate: today, lastAttemptedAt: new Date(nowMs).toISOString(), lastError: error.message || "Unable to reconcile Shopify orders." };
    dataplus.appendChannelApiLog({ channel: "Shopify", transport: "Scheduler", method: "IMPORT", path: "shopify-orders", operation: "Scheduled Shopify order reconciliation", statusCode: 502, ok: false, message: error.message || "Unable to reconcile Shopify orders." });
    await postgres.writeStateDocuments({ channelOrderImportSchedules: scheduleState });
    console.error(`[${WORKER_ID}] scheduled Shopify order reconciliation failed:`, error.message || error);
    return false;
  }
}

async function checkScheduledEbayOrderImport(force = false) {
  const nowMs = Date.now();
  if (!force && nowMs - lastEbayOrderImportScheduleCheckAt < 60000) return false;
  lastEbayOrderImportScheduleCheckAt = nowMs;
  const docs = await postgres.readStateDocuments().catch(() => ({})) || {};
  const stateDb = dataplus.normalizeDb(await dataplus.readDbFast({ skipInventory: true }));
  const channel = (stateDb.connections || []).find((entry) => String(entry.name || "").toLowerCase() === "ebay");
  const settings = channel?.settings || {};
  if (!channel || settings.channelEnabled === false || !settings.ebayOrderImportEnabled || !settings.ebayOrderImportScheduleEnabled) return false;
  const now = new Date(nowMs);
  const dueSlot = dueScheduleSlot(settings, "ebayOrderImportSchedule", now);
  if (!dueSlot) return false;
  const today = localDateKey(now);
  const scheduleId = `${channel.id || "ebay"}:${today}:${dueSlot}`;
  const scheduleState = docs.channelEbayOrderImportSchedules && typeof docs.channelEbayOrderImportSchedules === "object" ? docs.channelEbayOrderImportSchedules : {};
  const previous = scheduleState[scheduleId] || {};
  if (previous.lastRunDate === today || previous.lastAttemptedDate === today) return false;
  try {
    const result = await dataplus.queueEbayOrderImportJob(stateDb, {
      lookbackDays: settings.ebayOrderImportLookbackDays,
      limit: settings.ebayOrderImportLimit,
      includeCanceled: Boolean(settings.ebayOrderImportIncludeCanceled)
    }, { scheduled: true, scheduleKey: scheduleId, operation: "Scheduled eBay order import" });
    scheduleState[scheduleId] = { ...previous, channelId: channel.id || "", channelName: channel.name || "eBay", time: dueSlot, lastRunDate: today, lastAttemptedDate: today, lastRunAt: new Date(nowMs).toISOString(), lastJobId: result.job?.id || "", lastError: result.duplicate ? "An eBay order import is already active." : "" };
    console.log(`[${WORKER_ID}] ${result.duplicate ? "skipped duplicate" : "queued"} scheduled eBay order import for ${dueSlot} (${result.job?.id || "duplicate"})`);
    await postgres.writeStateDocuments({ channelEbayOrderImportSchedules: scheduleState });
    return true;
  } catch (error) {
    scheduleState[scheduleId] = { ...previous, channelId: channel.id || "", channelName: channel.name || "eBay", time: dueSlot, lastAttemptedDate: today, lastAttemptedAt: new Date(nowMs).toISOString(), lastError: error.message || "Unable to import eBay orders." };
    dataplus.appendChannelApiLog({ channel: "eBay", transport: "Scheduler", method: "IMPORT", path: "ebay-orders", operation: "Scheduled eBay order import", statusCode: 502, ok: false, message: error.message || "Unable to import eBay orders." });
    await postgres.writeStateDocuments({ channelEbayOrderImportSchedules: scheduleState });
    console.error(`[${WORKER_ID}] scheduled eBay order import failed:`, error.message || error);
    return false;
  }
}

async function checkScheduledEbayPriceInventorySync(force = false) {
  const nowMs = Date.now();
  if (!force && nowMs - lastEbayPriceInventoryScheduleCheckAt < 60000) return false;
  lastEbayPriceInventoryScheduleCheckAt = nowMs;
  const docs = await postgres.readStateDocuments().catch(() => ({})) || {};
  const stateDb = dataplus.normalizeDb(await dataplus.readDbFast({ skipInventory: true }));
  const channel = (stateDb.connections || []).find((entry) => String(entry.name || "").toLowerCase() === "ebay");
  const settings = channel?.settings || {};
  if (!channel || settings.channelEnabled === false || !settings.ebayPriceInventorySyncScheduleEnabled) return false;
  if (settings.ebayInventoryUpdateEnabled === false && settings.ebayPriceUpdateEnabled === false) return false;
  const now = new Date(nowMs);
  const dueSlot = dueScheduleSlot(settings, "ebayPriceInventorySyncSchedule", now);
  if (!dueSlot) return false;
  const today = localDateKey(now);
  const scheduleId = `${channel.id || "ebay"}:${today}:${dueSlot}`;
  const scheduleState = docs.channelEbayPriceInventorySchedules && typeof docs.channelEbayPriceInventorySchedules === "object" ? docs.channelEbayPriceInventorySchedules : {};
  const previous = scheduleState[scheduleId] || {};
  if (previous.lastRunDate === today || previous.lastAttemptedDate === today) return false;
  try {
    const result = await dataplus.queueEbayPriceInventorySyncJob(stateDb, {
      limit: settings.ebayPriceInventorySyncLimit,
      updateInventory: settings.ebayInventoryUpdateEnabled !== false,
      updatePrice: settings.ebayPriceUpdateEnabled !== false
    }, { scheduled: true, scheduleKey: scheduleId, operation: "Scheduled eBay price and inventory sync" });
    scheduleState[scheduleId] = { ...previous, channelId: channel.id || "", channelName: channel.name || "eBay", time: dueSlot, lastRunDate: today, lastAttemptedDate: today, lastRunAt: new Date(nowMs).toISOString(), lastJobId: result.job?.id || "", lastError: result.duplicate ? "An eBay price and inventory sync is already active." : "" };
    console.log(`[${WORKER_ID}] ${result.duplicate ? "skipped duplicate" : "queued"} scheduled eBay price and inventory sync for ${dueSlot} (${result.job?.id || "duplicate"})`);
    await postgres.writeStateDocuments({ channelEbayPriceInventorySchedules: scheduleState });
    return true;
  } catch (error) {
    scheduleState[scheduleId] = { ...previous, channelId: channel.id || "", channelName: channel.name || "eBay", time: dueSlot, lastAttemptedDate: today, lastAttemptedAt: new Date(nowMs).toISOString(), lastError: error.message || "Unable to sync eBay price and inventory." };
    dataplus.appendChannelApiLog({ channel: "eBay", transport: "Scheduler", method: "SYNC", path: "ebay-price-inventory", operation: "Scheduled eBay price and inventory sync", statusCode: 502, ok: false, message: error.message || "Unable to sync eBay price and inventory." });
    await postgres.writeStateDocuments({ channelEbayPriceInventorySchedules: scheduleState });
    console.error(`[${WORKER_ID}] scheduled eBay price and inventory sync failed:`, error.message || error);
    return false;
  }
}

async function checkScheduledSupplierReminders(force = false) {
  const nowMs = Date.now();
  if (!force && nowMs - lastSupplierReminderScheduleCheckAt < 60000) return false;
  lastSupplierReminderScheduleCheckAt = nowMs;
  const docs = await postgres.readStateDocuments().catch(() => ({})) || {};
  const settings = dataplus.readSystemSettingsStore(docs.systemSettings || {});
  if (!settings.smtpReminderScheduleEnabled) return false;
  const now = new Date(nowMs);
  const dueTime = scheduledMinutes(settings.smtpReminderScheduleTime || "08:00");
  if (minutesSinceMidnight(now) < dueTime) return false;
  const today = localDateKey(now);
  const scheduleState = docs.supplierReminderSchedules && typeof docs.supplierReminderSchedules === "object" ? docs.supplierReminderSchedules : {};
  if (scheduleState[today]?.lastRunDate === today) return false;
  try {
    const response = await fetch("http://dataplus:4173/api/purchase-orders/reminders/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dryRun: false, user: "System" }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Unable to run supplier reminder schedule.");
    scheduleState[today] = { lastRunDate: today, lastRunAt: new Date(nowMs).toISOString(), sent: Number(result.sent || 0), skipped: Array.isArray(result.skipped) ? result.skipped.length : 0, failed: Array.isArray(result.failed) ? result.failed.length : 0 };
    await postgres.writeStateDocuments({ supplierReminderSchedules: scheduleState });
    console.log(`[${WORKER_ID}] ran scheduled supplier reminders: ${scheduleState[today].sent} sent`);
    return true;
  } catch (error) {
    scheduleState[today] = { lastAttemptedDate: today, lastAttemptedAt: new Date(nowMs).toISOString(), lastError: error.message || "Unable to run supplier reminder schedule." };
    await postgres.writeStateDocuments({ supplierReminderSchedules: scheduleState });
    console.error(`[${WORKER_ID}] scheduled supplier reminders failed:`, error.message || error);
    return false;
  }
}

async function runBackupJob(job) {
  const payload = job.workerPayload || {};
  let current = await persistJob(job, {
    status: "running",
    phase: "starting",
    message: "Worker is creating Postgres backup...",
    startedAt: job.startedAt || new Date().toISOString()
  });
  let lastPersist = 0;
  const progress = async (patch = {}) => {
    current = normalizeJobPatch(current, {
      ...patch,
      status: "running",
      progressPercent: patch.totalRows ? Math.min(99, Math.round((Number(patch.processedRows || 0) / Number(patch.totalRows || 1)) * 100)) : current.progressPercent,
      message: patch.message || current.message
    });
    if (Date.now() - lastPersist > 1000) {
      lastPersist = Date.now();
      await postgres.upsertOperationJob(current);
    }
  };
  const backup = await postgres.createPostgresBackup({
    outputDir: path.join(DATA_DIR, "backups"),
    includeSourceCatalog: payload.includeSourceCatalog === true,
    onProgress: (patch) => {
      progress(patch).catch((error) => console.error("Unable to persist backup progress:", error.message || error));
    }
  });
  current = await persistJob(current, {
    status: "success",
    phase: "complete",
    message: `Postgres backup complete: ${Number(backup.rows || 0).toLocaleString()} rows across ${Number(backup.tables?.length || 0).toLocaleString()} tables.`,
    details: `Backup folder: ${backup.backupDir}${backup.skippedTables?.length ? `. Skipped large tables by setting: ${backup.skippedTables.join(", ")}.` : ""}`,
    totalRows: backup.totalRows || backup.rows || 0,
    processedRows: backup.rows || backup.totalRows || 0,
    changed: backup.tables?.length || 0,
    progressPercent: 100,
    estimatedSecondsRemaining: 0,
    originalFilePath: backup.manifestPath,
    originalFileName: "manifest.json",
    fileName: "manifest.json",
    finishedAt: new Date().toISOString()
  });
  await postgres.upsertOperationArtifact(current, "original");
  return current;
}

async function runDataQualityScanJob(job) {
  let current = await persistJob(job, {
    status: "running",
    phase: "starting",
    message: "Worker is scanning product data quality...",
    startedAt: job.startedAt || new Date().toISOString()
  });
  const totalRows = await postgres.countProducts();
  const statusMap = await postgres.readShopifyStatusMap().catch(() => ({})) || {};
  const stateDocs = await postgres.readStateDocuments().catch(() => ({})) || {};
  const context = buildWorkerQualityContext(stateDocs);
  const quality = workerDataQualityEngine();
  const rows = [];
  const pageSize = Math.max(100, Math.min(5000, Number(job.workerPayload?.pageSize || 1000)));
  let lastPersist = 0;
  for (let page = 1; rows.length < totalRows || page === 1; page += 1) {
    const result = await postgres.listProducts({ page, limit: pageSize });
    const items = result?.inventory || result?.items || [];
    if (!items.length) break;
    for (const item of items) rows.push(quality.dataQualityRow(stateDocs, item, statusMap, context));
    current = normalizeJobPatch(current, {
      status: "running",
      phase: "scanning_products",
      totalRows,
      processedRows: rows.length,
      progressPercent: Math.min(99, Math.round((rows.length / Math.max(1, totalRows)) * 100)),
      message: `Scanned ${Number(rows.length).toLocaleString()} of ${Number(totalRows).toLocaleString()} products.`
    });
    if (Date.now() - lastPersist > 1000 || rows.length >= totalRows) {
      lastPersist = Date.now();
      await postgres.upsertOperationJob(current);
    }
    if (items.length < pageSize) break;
  }
  current = await persistJob(current, {
    status: "running",
    phase: "saving_snapshot",
    totalRows,
    processedRows: rows.length,
    progressPercent: 99,
    message: "Saving data quality snapshot..."
  });
  const summary = quality.summarizeQualityRows(rows, "postgres-worker");
  await postgres.replaceProductQualityRows(rows);
  await postgres.writeStateDocuments({ dataQualitySummary: summary });
  current = await persistJob(current, {
    status: "success",
    phase: "complete",
    message: `Data quality scan finished for ${Number(summary.total || 0).toLocaleString()} products.`,
    details: `${Number(summary.needsWork || 0).toLocaleString()} products need work. Worker scan used ${summary.storage}.`,
    totalRows: summary.total,
    processedRows: summary.total,
    changed: summary.needsWork,
    progressPercent: 100,
    estimatedSecondsRemaining: 0,
    finishedAt: new Date().toISOString()
  });
  return current;
}

async function runSourceSearchIndexJob(job) {
  let current = await persistJob(job, {
    status: "running",
    phase: "starting",
    message: "Worker is building source catalog keyword search index...",
    startedAt: job.startedAt || new Date().toISOString()
  });
  const status = await postgres.buildSourceCatalogSearchIndex({
    isCanceled: () => false,
    onProgress: (patch = {}) => {
      current = normalizeJobPatch(current, {
        ...patch,
        status: "running",
        message: patch.message || current.message
      });
      postgres.upsertOperationJob(current).catch((error) => console.error("Unable to persist index progress:", error.message || error));
    }
  });
  return persistJob(current, {
    status: status.ready ? "success" : "done_with_warnings",
    phase: "complete",
    message: status.ready ? "Source catalog keyword search index is ready." : "Source catalog search index finished, but Postgres did not mark it ready.",
    totalRows: status.totalRows || current.totalRows || 0,
    processedRows: status.processedRows || current.processedRows || 0,
    changed: 1,
    progressPercent: 100,
    estimatedSecondsRemaining: 0,
    details: "Built vendor_catalog_items_search_trgm_idx for broad source catalog keyword search.",
    finishedAt: new Date().toISOString()
  });
}

async function runSourcePerformanceIndexesJob(job) {
  let current = await persistJob(job, {
    status: "running",
    phase: "starting",
    message: "Worker is building source catalog performance indexes...",
    startedAt: job.startedAt || new Date().toISOString()
  });
  const result = await postgres.buildSourceCatalogPerformanceIndexes({
    isCanceled: () => false,
    onProgress: (patch = {}) => {
      current = normalizeJobPatch(current, {
        ...patch,
        status: "running",
        message: patch.message || current.message
      });
      postgres.upsertOperationJob(current).catch((error) => console.error("Unable to persist performance index progress:", error.message || error));
    }
  });
  return persistJob(current, {
    status: "success",
    phase: "complete",
    message: `Built ${result.indexes?.length || 0} source catalog performance indexes.`,
    totalRows: 7,
    processedRows: 7,
    changed: result.indexes?.length || 0,
    progressPercent: 100,
    estimatedSecondsRemaining: 0,
    finishedAt: new Date().toISOString()
  });
}

async function runSourceFacetsRefreshJob(job) {
  let current = await persistJob(job, {
    status: "running",
    phase: "starting",
    message: "Worker is refreshing source catalog facets...",
    startedAt: job.startedAt || new Date().toISOString()
  });
  const heartbeatTimer = setInterval(() => {
    writeHeartbeat("running", current).catch((error) => console.error("Unable to refresh facet refresh heartbeat:", error.message || error));
  }, 10000);
  try {
    const result = await postgres.refreshVendorCatalogFacets({
      isCanceled: () => false,
      onProgress: (patch = {}) => {
        current = normalizeJobPatch(current, {
          ...patch,
          status: "running",
          message: patch.message || current.message
        });
        postgres.upsertOperationJob(current).catch((error) => console.error("Unable to persist facet refresh progress:", error.message || error));
        writeHeartbeat("running", current).catch((error) => console.error("Unable to refresh facet refresh heartbeat:", error.message || error));
      }
    });
    return persistJob(current, {
      status: "success",
      phase: "complete",
      message: "Source catalog facets and supplier coverage refreshed.",
      totalRows: result.totalRows || current.totalRows || 5,
      processedRows: result.processedRows || result.totalRows || current.totalRows || 5,
      changed: 1,
      progressPercent: 100,
      estimatedSecondsRemaining: 0,
      finishedAt: new Date().toISOString()
    });
  } finally {
    clearInterval(heartbeatTimer);
  }
}

function workerExportPath(job, filename = "export.csv") {
  const safeName = dataplus.safeImportFileName(filename || job.fileName || "export.csv", "export.csv");
  const dir = path.join(dataplus.IMPORT_JOB_FILE_DIR, dataplus.safeImportFileName(job.id || crypto.randomUUID(), "export-job"));
  fs.mkdirSync(dir, { recursive: true });
  return { filename: safeName, filePath: path.join(dir, safeName) };
}

async function runMappedProductExportJob(job) {
  const payload = job.workerPayload || {};
  let current = await persistJob(job, {
    status: "running",
    phase: "starting",
    message: "Worker is building product export...",
    startedAt: job.startedAt || new Date().toISOString()
  });
  const db = dataplus.normalizeDb(await dataplus.readDbFast({ skipInventory: true }));
  db.exportMappings = await dataplus.readExportMappingsApiStore();
  const template = db.exportMappings.find((row) => row.id === payload.templateId) || payload.template;
  if (!template) throw new Error(`Export template not found: ${payload.templateId || "missing template id"}`);
  const filename = dataplus.mappedExportFilename(template, payload.dataFileName || payload.fileName || "");
  const target = workerExportPath(current, filename);
  let lastPersist = 0;
  const written = await dataplus.mappedProductsCsvPostgresFileAsync(db, template, target.filePath, {
    skus: Array.isArray(payload.skus) ? payload.skus : [],
    query: payload.query || "",
    filters: payload.filters || {},
    progress: (patch = {}) => {
      current = normalizeJobPatch(current, {
        ...patch,
        status: "running",
        progressPercent: patch.totalRows ? Math.min(99, Math.round((Number(patch.processedRows || 0) / Math.max(1, Number(patch.totalRows || 1))) * 100)) : current.progressPercent,
        message: patch.message || current.message || "Worker is building product export..."
      });
      if (Date.now() - lastPersist > 1000 || Number(current.progressPercent || 0) >= 99) {
        lastPersist = Date.now();
        postgres.upsertOperationJob(current).catch((error) => console.error("Unable to persist export progress:", error.message || error));
        writeHeartbeat("running", current).catch((error) => console.error("Unable to refresh export heartbeat:", error.message || error));
      }
    },
    isCanceled: () => false
  });
  current = await persistJob(current, {
    status: "success",
    phase: "complete",
    fileName: target.filename,
    originalFileName: target.filename,
    originalFilePath: written.filePath,
    message: `${target.filename} is ready with ${Number(written.outputRows || 0).toLocaleString()} row${Number(written.outputRows || 0) === 1 ? "" : "s"}.`,
    details: `${Number(written.outputRows || 0).toLocaleString()} CSV rows exported from ${Number(written.productCount || 0).toLocaleString()} product${Number(written.productCount || 0) === 1 ? "" : "s"}.`,
    totalRows: Number(written.productCount || payload.productTotal || 0) || 0,
    processedRows: Number(written.productCount || payload.productTotal || 0) || 0,
    changed: Number(written.outputRows || 0) || 0,
    progressPercent: 100,
    estimatedSecondsRemaining: 0,
    finishedAt: new Date().toISOString()
  });
  await postgres.upsertOperationArtifact(current, "original");
  return current;
}

async function runCategoryExportJob(job) {
  const payload = job.workerPayload || {};
  let current = await persistJob(job, {
    status: "running",
    phase: "starting",
    message: "Worker is building category export...",
    startedAt: job.startedAt || new Date().toISOString()
  });
  const db = dataplus.normalizeDb(await dataplus.readDbFast({ skipInventory: true }));
  const result = await dataplus.buildCategoryExportFile(db, payload.type || "", payload.options || {}, {
    jobId: current.id,
    progress: (patch = {}) => {
      current = normalizeJobPatch(current, { ...patch, status: "running", message: patch.message || current.message });
      postgres.upsertOperationJob(current).catch((error) => console.error("Unable to persist category export progress:", error.message || error));
      writeHeartbeat("running", current).catch((error) => console.error("Unable to refresh category export heartbeat:", error.message || error));
    },
    isCanceled: () => false
  });
  current = await persistJob(current, {
    status: "success",
    phase: "complete",
    fileName: result.filename,
    originalFileName: result.filename,
    originalFilePath: result.filePath,
    message: `${result.filename} is ready with ${Number(result.count || 0).toLocaleString()} row${Number(result.count || 0) === 1 ? "" : "s"}.`,
    totalRows: Number(result.count || 0) || 0,
    processedRows: Number(result.count || 0) || 0,
    changed: Number(result.count || 0) || 0,
    progressPercent: 100,
    estimatedSecondsRemaining: 0,
    finishedAt: new Date().toISOString()
  });
  await postgres.upsertOperationArtifact(current, "original");
  dataplus.attachExportManifestFile(current, dataplus.exportManifestPayload(current, result, {
    exportType: "category",
    categoryExportType: payload.type || "",
    options: payload.options || {}
  }));
  return current;
}

async function runJobsRetentionCleanupJob(job) {
  return dataplus.runJobsRetentionCleanupWorkerJob(job);
}

async function runMappedProductImportJob(job) {
  return dataplus.runMappedProductImportWorkerJob(job);
}

async function runSourceCatalogImportJob(job) {
  return dataplus.runSourceCatalogImportWorkerJob(job, job.workerPayload || {});
}

async function runShopifyStatusImportJob(job) {
  return dataplus.runShopifyStatusImportWorkerJob(job);
}

async function runShopifyOrderImportJob(job) {
  return dataplus.runShopifyOrderImportWorkerJob(job, job.workerPayload || {});
}

async function runShopifyStatusSyncJob(job) {
  return dataplus.runShopifyStatusSyncWorkerJob(job, job.workerPayload || {});
}

async function runShopifySkuMapSyncJob(job) {
  return dataplus.runShopifySkuMapSyncWorkerJob(job, job.workerPayload || {});
}

async function runShopifyShippingEligibilitySyncJob(job) {
  return dataplus.runShopifyShippingEligibilitySyncWorkerJob(job, job.workerPayload || {});
}

async function runShopifyVariantPricePushJob(job) {
  return dataplus.runShopifyVariantPricePushWorkerJob(job, job.workerPayload || {});
}

async function runShopifyProductCreateJob(job) {
  return dataplus.runShopifyProductCreateWorkerJob(job, job.workerPayload || {});
}

async function runShopifyProductStatusUpdateJob(job) {
  return dataplus.runShopifyProductStatusUpdateWorkerJob(job, job.workerPayload || {});
}

async function runShopifyProductPublicationJob(job) {
  return dataplus.runShopifyProductPublicationWorkerJob(job, job.workerPayload || {});
}

async function runShopifyExistingVariantLinkJob(job) {
  return dataplus.runShopifyExistingVariantLinkWorkerJob(job, job.workerPayload || {});
}

async function runShopifyProductTypeCollectionsSyncJob(job) {
  return dataplus.runShopifyProductTypeCollectionSyncWorkerJob(job, job.workerPayload || {});
}

async function runShopifyTaxonomyPushJob(job) {
  return dataplus.runShopifyTaxonomyPushWorkerJob(job, job.workerPayload || {});
}

async function runShopifyInventoryUpdateJob(job) {
  const payload = job.workerPayload || {};
  const apply = payload.apply !== false && payload.dryRun !== true;
  const args = ["scripts/shopify-inventory-update-from-dump.js"];
  if (apply) args.push("--apply");
  else args.push("--dry-run");
  if (payload.limit) args.push(`--limit=${Math.max(1, Number(payload.limit) || 1)}`);
  args.push(`--product-batch-size=${Math.max(1, Math.min(50, Number(payload.productBatchSize || 35) || 35))}`);
  args.push(`--batch-size=${Math.max(1, Math.min(250, Number(payload.batchSize || 100) || 100))}`);
  if (payload.locationId) args.push(`--location=${payload.locationId}`);
  if (["export", "divide"].includes(String(payload.packMode || "").toLowerCase())) args.push(`--pack-mode=${String(payload.packMode).toLowerCase()}`);

  let current = await persistJob(job, {
    status: "running",
    phase: apply ? "updating_shopify_inventory" : "checking_shopify_inventory",
    message: apply ? "Worker is updating Shopify inventory from the latest data dump..." : "Worker is checking Shopify inventory against the latest data dump...",
    startedAt: job.startedAt || new Date().toISOString()
  });
  dataplus.appendChannelApiLog?.({
    channel: "Shopify",
    transport: "Job",
    method: "RUN",
    path: "shopify-inventory-update",
    operation: apply ? "Inventory update started" : "Inventory dry run started",
    statusCode: 102,
    ok: true,
    jobId: current.id,
    message: `${current.message}${payload.warehouseName ? ` Warehouse ${payload.warehouseName}.` : ""}${payload.locationId ? ` Location ${payload.locationId}.` : ""}`
  });
  const stdout = [];
  const stderr = [];
  let lastPersist = 0;
  try {
    await new Promise((resolve, reject) => {
    const heartbeatTimer = setInterval(() => {
      writeHeartbeat("running", current).catch((error) => console.error("Unable to refresh Shopify inventory heartbeat:", error.message || error));
    }, Math.max(1000, Math.min(HEARTBEAT_MS, 5000)));
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: process.env,
      windowsHide: true
    });
    child.stdout.on("data", (chunk) => stdout.push(chunk.toString()));
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr.push(text);
      const checked = text.match(/Checked\s+(\d+)\/(\d+);\s+prepared\s+(\d+)/i);
      const applied = text.match(/Applied\s+(\d+)\/(\d+)/i);
      if (checked) {
        current = normalizeJobPatch(current, {
          status: "running",
          phase: "checking_shopify_inventory",
          processedRows: Number(checked[1]) || current.processedRows,
          totalRows: Number(checked[2]) || current.totalRows,
          changed: Number(checked[3]) || current.changed,
          progressPercent: Math.min(95, Math.round((Number(checked[1]) / Math.max(1, Number(checked[2]))) * 80)),
          message: `Checked ${Number(checked[1]).toLocaleString()} of ${Number(checked[2]).toLocaleString()} linked Shopify products.`
        });
      } else if (applied) {
        current = normalizeJobPatch(current, {
          status: "running",
          phase: "applying_shopify_inventory",
          processedRows: Number(applied[1]) || current.processedRows,
          totalRows: Number(applied[2]) || current.totalRows,
          progressPercent: 80 + Math.min(19, Math.round((Number(applied[1]) / Math.max(1, Number(applied[2]))) * 19)),
          message: `Applied ${Number(applied[1]).toLocaleString()} of ${Number(applied[2]).toLocaleString()} Shopify inventory updates.`
        });
      }
      if (Date.now() - lastPersist > 1500) {
        lastPersist = Date.now();
        postgres.upsertOperationJob(current).catch((error) => console.error("Unable to persist Shopify inventory progress:", error.message || error));
        writeHeartbeat("running", current).catch((error) => console.error("Unable to refresh Shopify inventory heartbeat:", error.message || error));
      }
    });
    child.on("error", (error) => {
      clearInterval(heartbeatTimer);
      reject(error);
    });
    child.on("close", (code) => {
      clearInterval(heartbeatTimer);
      if (code) reject(new Error(`Shopify inventory updater exited with code ${code}. ${stderr.join("").slice(-2000)}`));
      else resolve();
    });
    });
  } catch (error) {
    dataplus.appendChannelApiLog?.({
      channel: "Shopify",
      transport: "Job",
      method: "RUN",
      path: "shopify-inventory-update",
      operation: apply ? "Inventory update failed" : "Inventory dry run failed",
      statusCode: 500,
      ok: false,
      jobId: current.id,
      message: error.message || "Shopify inventory updater failed."
    });
    throw error;
  }

  const text = stdout.join("").trim();
  const report = text ? JSON.parse(text) : {};
  const reportPath = report.reportPath || "";
  current = await persistJob(current, {
    status: report.errors?.length ? "warning" : "success",
    phase: "complete",
    fileName: reportPath ? path.basename(reportPath) : "shopify-inventory-report.json",
    originalFileName: reportPath ? path.basename(reportPath) : "shopify-inventory-report.json",
    originalFilePath: reportPath,
    message: apply
      ? `Shopify inventory update applied ${Number(report.variantsApplied || 0).toLocaleString()} variant${Number(report.variantsApplied || 0) === 1 ? "" : "s"}.`
      : `Shopify inventory dry run found ${Number(report.variantsChanged || 0).toLocaleString()} variant${Number(report.variantsChanged || 0) === 1 ? "" : "s"} to update.`,
    details: `${Number(report.variantsPrepared || 0).toLocaleString()} matched variants checked at ${report.locationName || "Shopify location"}; ${Number(report.productsMissingVariants || 0).toLocaleString()} products are missing expected variant SKU matches. Shopify API recovery retried ${Number(report.shopifyRetryStats?.retries || 0).toLocaleString()} request${Number(report.shopifyRetryStats?.retries || 0) === 1 ? "" : "s"}, including ${Number(report.shopifyRetryStats?.throttles || 0).toLocaleString()} throttle response${Number(report.shopifyRetryStats?.throttles || 0) === 1 ? "" : "s"}, and waited ${Math.round(Number(report.shopifyRetryStats?.totalWaitMs || 0) / 1000).toLocaleString()} second${Math.round(Number(report.shopifyRetryStats?.totalWaitMs || 0) / 1000) === 1 ? "" : "s"}.`,
    totalRows: Number(report.productsLoaded || 0) || current.totalRows || 0,
    processedRows: Number(report.productsLoaded || 0) || current.processedRows || 0,
    changed: Number(report.variantsApplied || report.variantsChanged || 0) || 0,
    missingCount: Number(report.productsMissingVariants || 0) || 0,
    errors: Array.isArray(report.errors) ? report.errors.slice(0, 50).map((row) => typeof row === "string" ? row : JSON.stringify(row)) : [],
    progressPercent: 100,
    estimatedSecondsRemaining: 0,
    finishedAt: new Date().toISOString(),
    shopifyInventoryReport: report
  });
  dataplus.appendChannelApiLog?.({
    channel: "Shopify",
    transport: "Job",
    method: apply ? "SEND" : "CHECK",
    path: "shopify-inventory-update",
    operation: apply ? "Inventory update completed" : "Inventory dry run completed",
    statusCode: report.errors?.length ? 207 : 200,
    ok: !report.errors?.length,
    jobId: current.id,
    message: apply
      ? `Sent ${Number(report.variantsApplied || 0).toLocaleString()} Shopify inventory update${Number(report.variantsApplied || 0) === 1 ? "" : "s"} to ${report.locationName || payload.locationName || "Shopify location"}.`
      : `Prepared ${Number(report.variantsChanged || 0).toLocaleString()} Shopify inventory update${Number(report.variantsChanged || 0) === 1 ? "" : "s"} for review at ${report.locationName || payload.locationName || "Shopify location"}.`
  });
  if (reportPath && fs.existsSync(reportPath)) await postgres.upsertOperationArtifact(current, "original");
  return current;
}

async function runEbayCatalogSyncJob(job) {
  return dataplus.runEbayCatalogImportWorkerJob(job);
}

async function runEbayCategoryAutoMapJob(job) {
  return dataplus.runEbayCategoryAutoMapWorkerJob(job, job.workerPayload || {});
}

async function runEbayTaxonomySyncJob(job) {
  return dataplus.runEbayTaxonomySyncWorkerJob(job, job.workerPayload || {});
}

async function runEbayAccountSettingsSyncJob(job) {
  return dataplus.runEbayAccountSettingsSyncWorkerJob(job);
}

async function runEbayLocationSyncJob(job) {
  return dataplus.runEbayLocationWorkerJob(job, job.workerPayload || {});
}

async function runEbayOrderImportJob(job) {
  return dataplus.runEbayOrderImportWorkerJob(job, job.workerPayload || {});
}

async function runEbayPriceInventorySyncJob(job) {
  return dataplus.runEbayPriceInventorySyncWorkerJob(job, job.workerPayload || {});
}

async function runEbayListingLaunchJob(job) {
  return dataplus.runEbayListingLaunchWorkerJob(job, job.workerPayload || {});
}

async function downloadVendorFeedFile(payload = {}) {
  const destination = String(payload.path || "").trim();
  if (!destination) throw new Error("Vendor feed download path is missing.");
  if (!payload.ftpHost || !payload.ftpUsername || !payload.ftpPassword || !payload.ftpRemotePath) throw new Error("Vendor feed FTP credentials or remote path are incomplete.");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const client = new ftp.Client(30000);
  client.ftp.verbose = false;
  try {
    await client.access({
      host: String(payload.ftpHost),
      port: Number(payload.ftpPort || 21),
      user: String(payload.ftpUsername),
      password: String(payload.ftpPassword),
      secure: false
    });
    await client.downloadTo(destination, String(payload.ftpRemotePath));
  } finally {
    client.close();
  }
  return destination;
}

async function runVendorFeedImportJob(job) {
  const payload = job.workerPayload || {};
  let current = await persistJob(job, {
    status: "running",
    phase: "downloading_vendor_feed",
    currentFile: String(payload.ftpRemotePath || payload.path || ""),
    message: `Downloading ${payload.vendorName || "vendor"} CSV feed from FTP...`,
    startedAt: job.startedAt || new Date().toISOString()
  });
  const downloadedPath = await downloadVendorFeedFile(payload);
  current = await persistJob(current, {
    status: "running",
    phase: "mapping_vendor_feed",
    currentFile: downloadedPath,
    message: `Downloaded ${path.basename(downloadedPath)}. Applying ${payload.mappingProfile || "saved"} mapping...`,
    originalFilePath: downloadedPath,
    workerPayload: { ...payload, originalFilePath: downloadedPath, templateId: payload.templateId || payload.mappingProfile }
  });
  return dataplus.runMappedProductImportWorkerJob(current);
}

async function runProductDumpImportJob(job) {
  const payload = job.workerPayload || {};
  const currentDb = dataplus.normalizeDb(await dataplus.readDbFast({ skipInventory: true }));
  const settings = dataplus.readSystemSettingsStore(currentDb.systemSettings || {});
  const resourceProfile = dataplus.productDumpResourceProfile(settings);
  // The production Droplet has 8 GB RAM. Leave headroom for Postgres and the web app
  // while allowing BSON normalization enough working memory for the full supplier dump.
  const dumpNodeHeapMB = Math.max(1024, Math.min(4096, Number(process.env.PRODUCT_DUMP_NODE_MAX_OLD_SPACE_MB || resourceProfile.heapMb || 3072) || 3072));
  const dumpBatchSize = Math.max(25, Math.min(250, Number(payload.batchSize || resourceProfile.batchSize || 100) || 100));
  const syncMode = ["full", "split", "catalog", "reconciliation"].includes(String(payload.syncMode || "").toLowerCase())
    ? String(payload.syncMode).toLowerCase()
    : "split";
  const args = ["scripts/import-product-dump.js"];
  if (payload.path) args.push(String(payload.path));
  if (payload.downloadFtp === true) args.push("--ftp");
  args.push("--job-id", String(job.id));
  if (payload.postgresOnly !== false) args.push("--postgres-only");
  if (Number(payload.limit || 0) > 0) args.push("--limit", String(Number(payload.limit || 0)));
  args.push("--batch-size", String(dumpBatchSize));
  args.push("--sync-mode", syncMode);
  let current = await persistJob(job, {
    status: "running",
    phase: "importing_product_dump",
    currentFile: String(payload.path || payload.ftpRemotePath || "Product datadump"),
    message: payload.postgresOnly === false
      ? "Worker is importing the product dump..."
      : `Worker is streaming the product dump into PostgreSQL using the ${resourceProfile.label} resource profile...`,
    startedAt: job.startedAt || new Date().toISOString()
  });
  const output = [];
  const appendWorkerOutput = (stream, text = "") => {
    const timestamp = new Date().toISOString();
    const entries = String(text)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => ({ timestamp, stream, line }));
    if (!entries.length) return;
    const existing = Array.isArray(current.workerOutput) ? current.workerOutput : [];
    current = normalizeJobPatch(current, { workerOutput: [...existing, ...entries].slice(-400) });
  };
  let lastPersist = 0;
  await new Promise((resolve, reject) => {
    const heartbeatTimer = setInterval(() => {
      writeHeartbeat("running", current).catch((error) => console.error("Unable to refresh product dump heartbeat:", error.message || error));
    }, Math.max(1000, Math.min(HEARTBEAT_MS, 5000)));
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: {
        ...process.env,
        ...(payload.downloadFtp === true ? {
          PRODUCT_DUMP_FTP_HOST: String(payload.ftpHost || ""),
          PRODUCT_DUMP_FTP_PORT: String(payload.ftpPort || 21),
          PRODUCT_DUMP_FTP_USER: String(payload.ftpUsername || ""),
          PRODUCT_DUMP_FTP_PASSWORD: String(payload.ftpPassword || ""),
          PRODUCT_DUMP_FTP_REMOTE_PATH: String(payload.ftpRemotePath || "")
        } : {}),
        NODE_OPTIONS: `--max-old-space-size=${dumpNodeHeapMB}`
      },
      windowsHide: true
    });
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output.push(text);
      appendWorkerOutput("stdout", text);
      const lastLine = text.trim().split(/\r?\n/).filter(Boolean).pop();
      if (lastLine) {
        current = normalizeJobPatch(current, { status: "running", message: lastLine });
        postgres.upsertOperationJob(current).catch((error) => console.error("Unable to persist dump progress:", error.message || error));
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      output.push(text);
      appendWorkerOutput("stderr", text);
      const matches = [...text.matchAll(/Processed\s+(\d+)\s+records\s+\((\d+)\s+catalog products,\s+(\d+)\s+skipped\)/gi)];
      const match = matches[matches.length - 1];
      if (match) {
        const processedRows = Number(match[1]) || current.processedRows || 0;
        const changed = Number(match[2]) || current.changed || 0;
        const missingCount = Number(match[3]) || current.missingCount || 0;
        current = normalizeJobPatch(current, {
          status: "running",
          phase: "streaming_product_dump",
          processedRows,
          changed,
          missingCount,
          message: `Streamed ${processedRows.toLocaleString()} product dump records into PostgreSQL.`
        });
      }
      if (Date.now() - lastPersist > 1500) {
        lastPersist = Date.now();
        postgres.upsertOperationJob(current).catch((error) => console.error("Unable to persist dump progress:", error.message || error));
        writeHeartbeat("running", current).catch((error) => console.error("Unable to refresh product dump heartbeat:", error.message || error));
      }
    });
    child.on("error", (error) => {
      clearInterval(heartbeatTimer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearInterval(heartbeatTimer);
      if (signal || code !== 0) {
        const failure = signal
          ? `Product dump import was terminated by ${signal}. This usually indicates memory pressure; the worker heap is now limited to ${dumpNodeHeapMB} MB and uses ${dumpBatchSize}-record batches.`
          : `Product dump import exited with code ${code}. ${output.join("").slice(-2000)}`;
        reject(new Error(failure));
      }
      else resolve();
    });
  });
  const outputText = output.join("");
  const summaryMatch = outputText.match(/(?:Normalized|Imported)\s+(\d+)\s+catalog products\s+\((\d+)\s+skipped\)/i);
  const finalProcessedRows = summaryMatch ? Number(summaryMatch[1]) + Number(summaryMatch[2]) : current.processedRows;
  const finalChanged = summaryMatch ? Number(summaryMatch[1]) : current.changed;
  const finalMissing = summaryMatch ? Number(summaryMatch[2]) : current.missingCount;
  if (finalProcessedRows <= 0) {
    return persistJob(current, {
      status: "failed",
      phase: "failed",
      message: "Product dump import finished without processing any source records. No pricing, inventory, or source catalog products were updated.",
      details: outputText.split(/\r?\n/).filter(Boolean).slice(-8).join(" "),
      totalRows: 0,
      processedRows: 0,
      changed: 0,
      missingCount: 1,
      errors: ["The product datadump produced zero records. Check for an interrupted worker, a changed feed format, or an empty source file."],
      progressPercent: 0,
      estimatedSecondsRemaining: 0,
      finishedAt: new Date().toISOString()
    });
  }
  let analyzeResult = { tables: [] };
  let supplierCoverageResult = null;
  let supplierCoverageError = "";
  const shouldRefreshSupplierCoverage = payload.refreshSupplierCoverage === true || syncMode !== "reconciliation";
  if (payload.postgresOnly !== false && postgres.isPostgresEnabled()) {
    const postImportHeartbeatTimer = setInterval(() => {
      writeHeartbeat("running", current).catch((error) => console.error("Unable to refresh product dump post-import heartbeat:", error.message || error));
    }, Math.max(1000, Math.min(HEARTBEAT_MS, 5000)));
    try {
      current = await persistJob(current, {
        status: "running",
        phase: "refreshing_query_statistics",
        message: "Refreshing PostgreSQL planner statistics for the source catalog..."
      });
      try {
        analyzeResult = await postgres.analyzeCatalogTables({ vendorCatalog: true });
      } catch (error) {
        analyzeResult = { tables: [], error: error.message || "Planner statistics refresh failed." };
      }
      if (shouldRefreshSupplierCoverage) {
        current = await persistJob(current, {
          status: "running",
          phase: "rebuilding_supplier_coverage",
          message: "Matching supplier coverage and storing indexed catalog statuses..."
        });
        try {
          supplierCoverageResult = await postgres.refreshVendorSupplierCoverage({
            onProgress: (patch = {}) => {
              current = normalizeJobPatch(current, {
                ...patch,
                status: "running",
                phase: "rebuilding_supplier_coverage",
                message: patch.message || current.message
              });
              postgres.upsertOperationJob(current).catch((error) => console.error("Unable to persist supplier coverage progress:", error.message || error));
            }
          });
        } catch (error) {
          supplierCoverageError = error.message || "Supplier coverage status rebuild failed.";
        }
      }
    } finally {
      clearInterval(postImportHeartbeatTimer);
    }
  }
  const followOn = [];
  const inventoryMode = String(payload.postImportInventoryMode || "disabled").toLowerCase();
  const priceMode = String(payload.postImportPriceMode || "disabled").toLowerCase();
  if (["dry-run", "apply"].includes(inventoryMode) || ["dry-run", "apply"].includes(priceMode)) {
    const stateDb = dataplus.normalizeDb(await dataplus.readDbFast({ skipInventory: true }));
    if (["dry-run", "apply"].includes(inventoryMode)) {
      try {
        const result = await dataplus.queueShopifyInventoryUpdateJob(stateDb, { apply: inventoryMode === "apply", dryRun: inventoryMode !== "apply" }, { scheduled: true, operation: `Post-import Shopify inventory ${inventoryMode === "apply" ? "update" : "review"}`, sourceJobId: current.id });
        followOn.push(result.duplicate ? "Shopify inventory follow-on was already active." : `Shopify inventory ${inventoryMode === "apply" ? "update" : "dry run"} queued as Job ${result.job.id}.`);
      } catch (error) { followOn.push(`Shopify inventory follow-on skipped: ${error.message || error}`); }
    }
    if (["dry-run", "apply"].includes(priceMode)) {
      try {
        const result = await dataplus.queueShopifyVariantPricePushJob(stateDb, { apply: priceMode === "apply", dryRun: priceMode !== "apply" }, { scheduled: true, operation: `Post-import Shopify price ${priceMode === "apply" ? "push" : "review"}`, sourceJobId: current.id });
        followOn.push(result.duplicate ? "Shopify price follow-on was already active." : `Shopify price ${priceMode === "apply" ? "push" : "dry run"} queued as Job ${result.job.id}.`);
      } catch (error) { followOn.push(`Shopify price follow-on skipped: ${error.message || error}`); }
    }
  }
  return persistJob(current, {
    status: supplierCoverageError ? "warning" : "success",
    phase: supplierCoverageError ? "completed_with_warning" : "complete",
    message: supplierCoverageError ? "Product dump import finished, but supplier coverage needs review." : "Product dump import and supplier coverage rebuild finished.",
    details: [outputText.split(/\r?\n/).filter(Boolean).slice(-8).join(" "), analyzeResult.tables.length ? `Planner statistics refreshed for ${analyzeResult.tables.join(", ")}.` : "", analyzeResult.error ? `Planner statistics refresh skipped: ${analyzeResult.error}` : "", supplierCoverageResult ? `Stored supplier coverage for ${Number(supplierCoverageResult.productsUpdated || 0).toLocaleString()} approved products and ${Number(supplierCoverageResult.vendorItemsUpdated || 0).toLocaleString()} source records from ${Number(supplierCoverageResult.keys || 0).toLocaleString()} matched identities.` : "", !shouldRefreshSupplierCoverage ? "Supplier coverage was unchanged and skipped for this reconciliation-only refresh." : "", supplierCoverageError ? `Supplier coverage rebuild failed: ${supplierCoverageError}` : "", ...followOn].filter(Boolean).join(" "),
    totalRows: finalProcessedRows || current.totalRows || 0,
    processedRows: finalProcessedRows || current.processedRows || 0,
    changed: finalChanged || current.changed || 0,
    missingCount: finalMissing || current.missingCount || 0,
    progressPercent: 100,
    estimatedSecondsRemaining: 0,
    finishedAt: new Date().toISOString()
  });
}

async function runJob(job) {
  const task = String(job.workerTask || "").trim();
  const channelName = task.startsWith("shopify-") ? "Shopify" : task.startsWith("ebay-") ? "eBay" : "";
  if (channelName) {
    const stateDb = dataplus.normalizeDb(await dataplus.readDbFast({ skipInventory: true }));
    const channel = (stateDb.connections || []).find((entry) => String(entry?.name || "").trim().toLowerCase() === channelName.toLowerCase());
    if (channel?.settings?.channelEnabled === false) {
      return persistJob(job, {
        status: "stopped",
        phase: "stopped",
        message: `${channelName} is disabled. The queued ${task} job was stopped before it ran.`,
        details: "Re-enable the channel in Channel Settings before retrying this job.",
        finishedAt: new Date().toISOString()
      });
    }
  }
  if (task === "postgres-backup") return runBackupJob(job);
  if (task === "data-quality-scan") return runDataQualityScanJob(job);
  if (task === "source-search-index") return runSourceSearchIndexJob(job);
  if (task === "source-performance-indexes") return runSourcePerformanceIndexesJob(job);
  if (task === "source-facets-refresh") return runSourceFacetsRefreshJob(job);
  if (task === "jobs-retention-cleanup") return runJobsRetentionCleanupJob(job);
  if (task === "mapped-product-export") return runMappedProductExportJob(job);
  if (task === "category-export") return runCategoryExportJob(job);
  if (task === "source-catalog-import") return runSourceCatalogImportJob(job);
  if (task === "mapped-product-import") return runMappedProductImportJob(job);
  if (task === "shopify-status-import") return runShopifyStatusImportJob(job);
  if (task === "shopify-order-import") return runShopifyOrderImportJob(job);
  if (task === "shopify-sku-map-sync") return runShopifySkuMapSyncJob(job);
  if (task === "shopify-shipping-eligibility-sync") return runShopifyShippingEligibilitySyncJob(job);
  if (task === "shopify-variant-price-push") return runShopifyVariantPricePushJob(job);
  if (task === "shopify-product-create") return runShopifyProductCreateJob(job);
  if (task === "shopify-product-publication-update") return runShopifyProductPublicationJob(job);
  if (task === "shopify-product-status-update") return runShopifyProductStatusUpdateJob(job);
  if (task === "shopify-existing-variant-link") return runShopifyExistingVariantLinkJob(job);
  if (task === "shopify-product-type-collections-sync") return runShopifyProductTypeCollectionsSyncJob(job);
  if (task === "shopify-taxonomy-push") return runShopifyTaxonomyPushJob(job);
  if (task === "shopify-status-sync") return runShopifyStatusSyncJob(job);
  if (task === "shopify-inventory-update") return runShopifyInventoryUpdateJob(job);
  if (task === "ebay-category-auto-map") return runEbayCategoryAutoMapJob(job);
  if (task === "ebay-taxonomy-sync") return runEbayTaxonomySyncJob(job);
  if (task === "ebay-catalog-sync") return runEbayCatalogSyncJob(job);
  if (task === "ebay-account-settings-sync") return runEbayAccountSettingsSyncJob(job);
  if (task === "ebay-location-sync") return runEbayLocationSyncJob(job);
  if (task === "ebay-order-import") return runEbayOrderImportJob(job);
  if (task === "ebay-price-inventory-sync") return runEbayPriceInventorySyncJob(job);
  if (task === "ebay-listing-launch") return runEbayListingLaunchJob(job);
  if (task === "vendor-feed-import") return runVendorFeedImportJob(job);
  if (task === "product-dump-import") return runProductDumpImportJob(job);
  await persistJob(job, {
    status: "failed",
    phase: "failed",
    message: `No worker handler is registered for ${task || "unknown task"}.`,
    missingCount: 1,
    errors: [`No worker handler is registered for ${task || "unknown task"}.`],
    finishedAt: new Date().toISOString()
  });
  return null;
}

async function tick() {
  await writeHeartbeat("idle");
  await checkScheduledVendorFeedImports();
  await checkScheduledShopifyInventoryUpdate();
  await checkScheduledShopifySkuPairAudit();
  await checkScheduledShopifyOrderImport();
  await checkScheduledEbayOrderImport();
  await checkScheduledEbayPriceInventorySync();
  await checkScheduledSupplierReminders();
  const job = await postgres.claimQueuedOperationJob({ workerId: WORKER_ID, tasks: SUPPORTED_TASKS });
  if (!job) return false;
  await writeHeartbeat("running", job, true);
  console.log(`[${WORKER_ID}] claimed ${job.id} (${job.workerTask})`);
  try {
    await runJob(job);
    console.log(`[${WORKER_ID}] finished ${job.id}`);
  } catch (error) {
    console.error(`[${WORKER_ID}] failed ${job.id}:`, error.message || error);
    await persistJob(job, {
      status: /canceled|cancelled|stopped/i.test(String(error.message || "")) ? "stopped" : "failed",
      phase: "failed",
      message: error.message || "Worker job failed.",
      missingCount: 1,
      errors: [error.message || "Worker job failed."],
      finishedAt: new Date().toISOString()
    });
  }
  await writeHeartbeat("idle", null, true);
  return true;
}

async function main() {
  if (!postgres.isPostgresEnabled()) throw new Error("DATABASE_URL is required for the worker.");
  await postgres.initDatabase();
  await writeHeartbeat("starting", null, true);
  console.log(`[${WORKER_ID}] started. Supported tasks: ${SUPPORTED_TASKS.join(", ")}`);
  do {
    const worked = await tick();
    if (RUN_ONCE) break;
    if (!worked) await sleep(POLL_MS);
  } while (true);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (RUN_ONCE) {
      await writeHeartbeat("stopped", null, true).catch(() => {});
      await postgres.closePool();
    }
  });
