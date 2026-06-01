const fs = require("fs");
const path = require("path");
const {
  closePool,
  cleanupLegacyMigratedVendorOffers,
  databaseHealth,
  initRelationalSchema,
  readState,
  upsertCategoryChannelMappingsFromState,
  upsertOperationJob,
  upsertOrdersFromState,
  upsertPurchaseOrdersFromState,
  upsertProductsFromState,
  writeStateDocuments,
  writeLegacyState
} = require("../db");

const ROOT = path.join(__dirname, "..");
const ENV_FILE = path.join(ROOT, ".env");
const DB_FILE = path.join(ROOT, "data", "db.json");
const IMPORT_JOBS_FILE = path.join(ROOT, "data", "import-jobs.json");
const PRODUCT_SOURCE_ENRICHMENT_FILE = path.join(ROOT, "data", "product-source-enrichment.json");

function loadLocalEnv() {
  if (!fs.existsSync(ENV_FILE)) return;
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function readJsonFile(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function withSourceEnrichment(item, enrichmentMap) {
  const key = String(item?.sku || "").trim().toLowerCase();
  const enrichment = key ? enrichmentMap[key] : null;
  if (!enrichment) return item;
  return {
    ...item,
    ...enrichment,
    id: item.id || enrichment.id,
    sku: item.sku || enrichment.sku,
    aliases: item.aliases || enrichment.aliases,
    shadowSkus: item.shadowSkus || enrichment.shadowSkus,
    ebayListing: item.ebayListing || enrichment.ebayListing,
    shopifyId: item.shopifyId || enrichment.shopifyId,
    shopifyVariantId: item.shopifyVariantId || enrichment.shopifyVariantId,
    shopifyHandle: item.shopifyHandle || enrichment.shopifyHandle,
    shopifyStatus: item.shopifyStatus || enrichment.shopifyStatus,
    shopifyPublished: item.shopifyPublished ?? enrichment.shopifyPublished
  };
}

async function main() {
  loadLocalEnv();
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing from .env");
  }
  if (!fs.existsSync(DB_FILE)) {
    throw new Error(`JSON database not found at ${DB_FILE}`);
  }

  await initRelationalSchema();
  const before = await databaseHealth();
  if (!before.connected) {
    throw new Error(before.error || `${before.message || "Postgres is not connected."} Update DATABASE_URL in .env with the real local Postgres password/database.`);
  }
  console.log(`Connected to Postgres database "${before.database || "unknown"}".`);

  const db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  const enrichmentMap = readJsonFile(PRODUCT_SOURCE_ENRICHMENT_FILE, {});
  const inventory = (Array.isArray(db.inventory) ? db.inventory : [])
    .map((item) => withSourceEnrichment(item, enrichmentMap));

  const cleanedOffers = await cleanupLegacyMigratedVendorOffers();
  if (cleanedOffers) console.log(`Removed ${cleanedOffers} legacy duplicate vendor offer snapshots before rebuilding migrated offers.`);
  const result = await upsertProductsFromState(inventory);
  console.log(`Migrated ${result.products} products, ${result.vendors} vendors, ${result.identifiers} identifiers, ${result.aliases || 0} aliases, and ${result.offers} vendor offer snapshots.`);
  await writeStateDocuments(db);
  const categoryMappingResult = await upsertCategoryChannelMappingsFromState(db.categorySettings || []);
  const orderResult = await upsertOrdersFromState(db.orders || []);
  const purchaseOrderResult = await upsertPurchaseOrdersFromState(db.purchaseOrders || []);
  console.log("Migrated app settings, channels, categories, orders, jobs, vendors, brands, warehouses, and other state documents.");
  console.log(`Migrated ${categoryMappingResult.mappings || 0} category channel mappings.`);
  console.log(`Migrated ${orderResult.orders || 0} orders / ${orderResult.lines || 0} order lines.`);
  console.log(`Migrated ${purchaseOrderResult.purchaseOrders || 0} purchase orders / ${purchaseOrderResult.lines || 0} purchase order lines.`);

  const jobStore = readJsonFile(IMPORT_JOBS_FILE, []);
  const jobs = [
    ...(Array.isArray(db.importJobs) ? db.importJobs : []),
    ...(Array.isArray(jobStore) ? jobStore : jobStore.importJobs || [])
  ];
  const seenJobIds = new Set();
  let migratedJobs = 0;
  for (const job of jobs) {
    const id = String(job?.id || "").trim();
    if (!id || seenJobIds.has(id)) continue;
    seenJobIds.add(id);
    if (await upsertOperationJob(job)) migratedJobs += 1;
  }
  console.log(`Migrated ${migratedJobs} operation jobs.`);

  if (process.argv.includes("--legacy-app-state")) {
    const existing = await readState();
    if (existing && process.argv.includes("--no-overwrite")) {
      console.log("Skipped legacy app_state write because --no-overwrite was used.");
    } else {
      await writeLegacyState(db);
      console.log("Also wrote legacy app_state JSON snapshot.");
    }
  } else {
    console.log("Skipped legacy app_state JSON write. Use --legacy-app-state only if you need the old whole-JSON Postgres snapshot.");
  }

  const after = await databaseHealth();
  console.log(`Postgres now has ${after.products || 0} products, ${after.vendors || 0} vendors, ${after.vendorOffers || 0} vendor offers, ${after.productAliases || 0} aliases, ${after.categoryChannelMappings || 0} category channel mappings, and ${after.jobs || 0} jobs.`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
