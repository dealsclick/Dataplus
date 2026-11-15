const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "db.js"), "utf8");
const workerSource = fs.readFileSync(path.join(__dirname, "dataplus-worker.js"), "utf8");
const start = source.indexOf("async function refreshVendorSupplierCoverage");
const end = source.indexOf("async function readSupplierIndexStatus", start);

assert(start >= 0 && end > start, "supplier coverage rebuild function is present");
const implementation = source.slice(start, end);

assert(
  implementation.includes("SUPPLIER_COVERAGE_BATCH_SIZE"),
  "supplier coverage uses a configurable bounded batch size"
);
assert(
  implementation.includes("SUPPLIER_COVERAGE_BATCH_TIMEOUT_MS")
    && implementation.includes("SUPPLIER_COVERAGE_KEY_BATCH_SIZE"),
  "individual source and identity-key batches have bounded execution settings"
);
assert(
  implementation.includes("SUPPLIER_COVERAGE_MAX_IDENTITY_MATCHES")
    && implementation.includes("coverage.identity_count <= $2"),
  "high-frequency placeholder identifiers cannot create unbounded supplier joins"
);
assert(
  implementation.includes("validVendorBarcodeSql") && implementation.includes("validProductBarcodeSql"),
  "obvious placeholder UPC values are excluded from automatic matching"
);
assert(
  implementation.includes("product_id > $1")
    && implementation.includes("order by product_id")
    && implementation.includes("hasCursor ? 2 : 1"),
  "product matching and summaries use keyset batches"
);
assert(
  implementation.includes("(vendor_id, source_sku) > ($1, $2)")
    && implementation.includes("order by vendor_id, source_sku")
    && implementation.includes("hasCursor ? 3 : 1"),
  "vendor identities and summaries use composite keyset batches"
);
assert(
  implementation.includes("select * from unnest($1::text[], $2::text[])"),
  "vendor batch writes are restricted to the selected source records"
);
assert(
  implementation.includes("supplier_coverage_rebuild_state")
    && implementation.includes("supplier_coverage_vendor_identity_stage")
    && implementation.includes("supplier_coverage_link_stage"),
  "supplier coverage uses durable staging tables and a durable checkpoint"
);
assert(
  implementation.includes("processed_work_rows = processed_work_rows +")
    && implementation.includes("last_vendor_source_sku")
    && implementation.includes("last_summary_product_id"),
  "batch data and restart cursors are checkpointed together"
);
assert(
  implementation.includes("pg_try_advisory_lock")
    && implementation.includes("pg_advisory_unlock")
    && implementation.includes("begin read write")
    && implementation.includes("set local statement_timeout to 0"),
  "one resumable rebuild publishes completed staging tables atomically"
);
assert(
  !implementation.includes("create temporary table")
    && !implementation.includes("product_supplier_links_next")
    && !implementation.includes("vendor_supplier_identity_next"),
  "restart-sensitive temporary supplier rebuild tables are not used"
);
assert(
  workerSource.includes('payload.refreshSupplierCoverage === true')
    && workerSource.includes('trigger: "explicit-product-dump-reconciliation"'),
  "a product datadump queues full coverage only when reconciliation is explicitly requested"
);
assert(
  workerSource.includes("checkScheduledSupplierCoverageRefresh")
    && workerSource.includes('trigger: "weekly-full-reconciliation"'),
  "the full supplier reconciliation is owned by the weekly scheduler"
);
assert(
  !workerSource.includes("supplierCoverageResult = await postgres.refreshVendorSupplierCoverage"),
  "the product datadump no longer runs the full supplier rebuild inline"
);
assert(
  workerSource.includes("runId: String(job.workerPayload?.sourceJobId || job.id || \"\")"),
  "the worker reuses the source job as the durable rebuild generation"
);

console.log("supplier coverage batching checks passed");
