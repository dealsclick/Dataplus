const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
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
  "shopify-status-sync",
  "ebay-catalog-sync",
  "ebay-account-settings-sync",
  "ebay-location-sync",
  "product-dump-import"
];
let lastHeartbeatAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      lastSeenAt: new Date(now).toISOString()
    }
  });
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
  const result = await postgres.refreshVendorCatalogFacets({
    isCanceled: () => false,
    onProgress: (patch = {}) => {
      current = normalizeJobPatch(current, {
        ...patch,
        status: "running",
        message: patch.message || current.message
      });
      postgres.upsertOperationJob(current).catch((error) => console.error("Unable to persist facet refresh progress:", error.message || error));
    }
  });
  return persistJob(current, {
    status: "success",
    phase: "complete",
    message: "Source catalog facets refreshed.",
    totalRows: result.totalRows || current.totalRows || 4,
    processedRows: result.processedRows || result.totalRows || current.totalRows || 4,
    changed: 1,
    progressPercent: 100,
    estimatedSecondsRemaining: 0,
    finishedAt: new Date().toISOString()
  });
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

async function runShopifyStatusSyncJob(job) {
  return dataplus.runShopifyStatusSyncWorkerJob(job, job.workerPayload || {});
}

async function runEbayCatalogSyncJob(job) {
  return dataplus.runEbayCatalogImportWorkerJob(job);
}

async function runEbayAccountSettingsSyncJob(job) {
  return dataplus.runEbayAccountSettingsSyncWorkerJob(job);
}

async function runEbayLocationSyncJob(job) {
  return dataplus.runEbayLocationWorkerJob(job, job.workerPayload || {});
}

async function runProductDumpImportJob(job) {
  const payload = job.workerPayload || {};
  const args = ["scripts/import-product-dump.js"];
  if (payload.path) args.push(String(payload.path));
  let current = await persistJob(job, {
    status: "running",
    phase: "importing_product_dump",
    message: "Worker is importing the product dump...",
    startedAt: job.startedAt || new Date().toISOString()
  });
  const output = [];
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: process.env,
      windowsHide: true
    });
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output.push(text);
      const lastLine = text.trim().split(/\r?\n/).filter(Boolean).pop();
      if (lastLine) {
        current = normalizeJobPatch(current, { status: "running", message: lastLine });
        postgres.upsertOperationJob(current).catch((error) => console.error("Unable to persist dump progress:", error.message || error));
      }
    });
    child.stderr.on("data", (chunk) => output.push(chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code) reject(new Error(`Product dump import exited with code ${code}. ${output.join("").slice(-2000)}`));
      else resolve();
    });
  });
  return persistJob(current, {
    status: "success",
    phase: "complete",
    message: "Product dump import finished.",
    details: output.join("").split(/\r?\n/).filter(Boolean).slice(-8).join(" "),
    progressPercent: 100,
    estimatedSecondsRemaining: 0,
    finishedAt: new Date().toISOString()
  });
}

async function runJob(job) {
  const task = String(job.workerTask || "").trim();
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
  if (task === "shopify-status-sync") return runShopifyStatusSyncJob(job);
  if (task === "ebay-catalog-sync") return runEbayCatalogSyncJob(job);
  if (task === "ebay-account-settings-sync") return runEbayAccountSettingsSyncJob(job);
  if (task === "ebay-location-sync") return runEbayLocationSyncJob(job);
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
