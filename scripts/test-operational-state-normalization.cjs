const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const db = fs.readFileSync(path.join(root, "db.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const worker = fs.readFileSync(path.join(root, "scripts", "dataplus-worker.js"), "utf8");
const workerSupervisor = fs.readFileSync(path.join(root, "scripts", "dataplus-worker-supervisor.js"), "utf8");

for (const table of [
  "app_users",
  "auth_permission_templates",
  "auth_permission_audit_events",
  "auth_sessions",
  "warehouse_audits",
  "warehouse_audit_lines",
  "warehouse_audit_media"
]) {
  assert.match(db, new RegExp(`create table if not exists ${table}\\b`, "i"), `${table} must be schema-managed`);
}

assert.match(db, /if \(field === "warehouseAudits"\) return readWarehouseAudits\(\)/, "warehouse audits must bypass state_documents");
assert.match(db, /readWarehouseAuditMedia/, "warehouse audit media must have a targeted reader");
assert.match(db, /payload\.id = payload\.id \|\| row\.line_id/, "migrated warehouse lines must retain their relational media identity");
assert.match(db, /readOperationalIdentitySettings/, "identity settings must be reconstructed from relational tables");
assert.match(db, /replaceOperationalIdentitySettings/, "identity settings must be written to relational tables");
assert.match(db, /readShopifyStatusMapForSkus/, "Shopify status reads must support targeted SKU queries");
assert.match(db, /async function readExpiredOperationJobArtifactBatch/, "artifact retention must page compact PostgreSQL job rows");
assert.match(db, /as completed_cursor/, "artifact retention cursors must preserve PostgreSQL microsecond precision");
assert.match(db, /async function expireOperationJobArtifacts/, "expired artifact metadata must be cleared transactionally");
assert.match(db, /async function readExistingOperationJobIds/, "orphan detection must use compact PostgreSQL identity reads");

const shopifyReader = server.slice(server.indexOf("function readShopifyStatusMapSync"), server.indexOf("function writeShopifyStatusMapSync"));
assert.match(shopifyReader, /if \(postgres\.isPostgresEnabled\(\)\) return shopifyStatusMapCache\.data \|\| \{\}/, "PostgreSQL mode must not parse the Shopify JSON compatibility file");

const shopifyWriter = server.slice(server.indexOf("function writeShopifyStatusMapSync"), server.indexOf("function shopifyStatusForSku"));
const postgresBranch = shopifyWriter.slice(0, shopifyWriter.indexOf("} else {"));
assert.doesNotMatch(postgresBranch, /writeFileSync\(SHOPIFY_STATUS_FILE/, "PostgreSQL Shopify writes must not rewrite the compatibility file");

assert.match(server, /function authSessionStorageKey[\s\S]*createHash\("sha256"\)/, "session tokens must be hashed before storage");
assert.match(server, /await hydrateAuthSessionsStore\(\)/, "API requests must wait for the session store to hydrate");
assert.match(server, /readWarehouseAuditMedia\(decodeURIComponent\(parts\[2\]\)/, "warehouse images must use a targeted authenticated route");
assert.doesNotMatch(server, /writeStateField\("fulfillmentConsoleSnapshot"/, "production must not recreate the retired fulfillment snapshot document");
assert.match(db, /delete from state_documents where doc_key = 'fulfillmentConsoleSnapshot'/, "migration must remove the retired fulfillment snapshot document");
assert.match(server, /setInterval\(scheduleJobsRetentionCleanup, 6 \* 60 \* 60_000\)/, "artifact cleanup must be checked on a bounded schedule");
assert.match(server, /async function pruneExpiredPostgresImportJobArtifacts/, "PostgreSQL artifact retention must use its bounded cleanup path");
assert.match(server, /await fs\.promises\.opendir\(current\)/, "artifact directory counting must iterate instead of recursively materializing filenames");
const retentionWorker = server.slice(server.indexOf("async function runJobsRetentionCleanupWorkerJob"), server.indexOf("async function queueJobsRetentionCleanupJob"));
assert.match(retentionWorker, /postgres\.isPostgresEnabled\(\)[\s\S]*cleanupPostgresImportJobArtifacts/, "production retention must bypass full application state hydration");
assert.match(worker, /WORKER_POST_JOB_DRAIN_TIMEOUT_MS/, "worker post-job drains must have a bounded timeout");
assert.match(worker, /drainAfterJob\("fulfillment projection drain"/, "fulfillment projection draining must not block the worker indefinitely");
assert.match(worker, /drainAfterJob\("channel activity log drain"/, "channel activity draining must not block the worker indefinitely");
assert.match(worker, /dataplus-worker-job-finished/, "the worker must tell its supervisor when the primary job is committed");
assert.match(worker, /await sendSupervisorMessage\(\{ type: "dataplus-worker-job-finished"/, "the worker must flush the completion notice before post-job drains begin");
assert.match(worker, /const acknowledgementType = `\$\{String\(message\.type \|\| ""\)\}-ack`/, "completed workers must wait for an explicit supervisor acknowledgement");
assert.match(worker, /setTimeout\(\(\) => finish\(false\), 1_000\)/, "a delayed IPC acknowledgement must not hold the completed worker forever");
assert.match(worker, /skipping deferred drains before disposable child exit/, "an unreachable supervisor must not leave the worker lane blocked");
assert.match(workerSupervisor, /DATAPLUS_WORKER_POST_JOB_EXIT_TIMEOUT_MS/, "the supervisor must enforce a hard post-job exit timeout");
assert.match(workerSupervisor, /dataplus-worker-job-finished-ack/, "the supervisor must acknowledge a durable job completion before deferred drains");
assert.match(workerSupervisor, /post-job drains exceeded/, "the hard timeout must explain why the disposable child was recycled");
const postJobTimer = workerSupervisor.slice(workerSupervisor.indexOf("postJobTimer = setTimeout"), workerSupervisor.indexOf("postJobTimer.unref"));
assert.doesNotMatch(postJobTimer, /\|\| completed/, "a completed signal must not exempt a child that failed to exit from the hard timeout");
assert.match(db, /workerTask', ''\) = 'fulfillment-label-purchase'[\s\S]*then 120/, "label purchases must outrank background refresh jobs");

console.log("Operational state normalization checks passed.");
