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
  implementation.includes("order by product_id") && implementation.includes("limit $2"),
  "product matching and summaries use keyset batches"
);
assert(
  implementation.includes("order by vendor_id, source_sku") && implementation.includes("limit $3"),
  "vendor identities and summaries use composite keyset batches"
);
assert(
  implementation.includes("select * from unnest($1::text[], $2::text[])"),
  "vendor batch writes are restricted to the selected source records"
);
assert(
  !implementation.includes("create temporary table product_supplier_links_next as"),
  "the former full-catalog product-to-supplier join is not restored"
);
assert(
  implementation.includes("begin read write") && implementation.includes("set local statement_timeout to 0"),
  "completed staging tables replace live coverage atomically"
);
assert(
  implementation.includes("from product_supplier_links confirmed"),
  "review suggestions compare against the committed exact coverage table"
);
assert(
  workerSource.includes("queueSupplierCoverageRefreshJob(current)"),
  "the product datadump queues coverage as an independent follow-on job"
);
assert(
  !workerSource.includes("supplierCoverageResult = await postgres.refreshVendorSupplierCoverage"),
  "the product datadump no longer runs the full supplier rebuild inline"
);

console.log("supplier coverage batching checks passed");
