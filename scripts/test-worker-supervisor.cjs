"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  jobMemoryBudgetMb,
  processTreeRssBytes,
  readChildPids,
  readProcessRssBytes
} = require("./dataplus-worker-supervisor");

const workerSource = fs.readFileSync(path.join(__dirname, "dataplus-worker.js"), "utf8");
const dumpStart = workerSource.indexOf("async function runProductDumpImportJob(job)");
const dumpSpawn = workerSource.indexOf("const child = spawn(process.execPath", dumpStart);
assert.ok(dumpStart >= 0 && dumpSpawn > dumpStart, "product dump worker implementation must be present");
const dumpStartup = workerSource.slice(dumpStart, dumpSpawn);
assert.match(dumpStartup, /readStateField\("systemSettings"\)/, "product dump startup reads only its settings document");
assert.doesNotMatch(dumpStartup, /readDbFast\(/, "product dump startup must not load full application state before spawning the importer");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "dataplus-worker-proc-"));
function fakeProcess(pid, rssKb, children = []) {
  const dir = path.join(root, String(pid));
  const task = path.join(dir, "task", String(pid));
  fs.mkdirSync(task, { recursive: true });
  fs.writeFileSync(path.join(dir, "status"), `Name:\tnode\nVmRSS:\t${rssKb} kB\n`);
  fs.writeFileSync(path.join(task, "children"), children.join(" "));
}

try {
  fakeProcess(100, 1024, [101, 102]);
  fakeProcess(101, 2048, [103]);
  fakeProcess(102, 4096);
  fakeProcess(103, 8192);
  assert.strictEqual(readProcessRssBytes(100, root), 1024 * 1024);
  assert.deepStrictEqual(readChildPids(100, root), [101, 102]);
  assert.deepStrictEqual(readChildPids(102, root), []);
  assert.strictEqual(processTreeRssBytes(100, root), (1024 + 2048 + 4096 + 8192) * 1024);
  assert.strictEqual(jobMemoryBudgetMb("background", "fulfillment-rate-refresh", {}), 680);
  assert.strictEqual(jobMemoryBudgetMb("background", "product-dump-import", {}), 900);
  assert.strictEqual(jobMemoryBudgetMb("background", "product-dump-import", { DATAPLUS_PRODUCT_DUMP_JOB_RSS_MB: "880" }), 880);
  assert.strictEqual(jobMemoryBudgetMb("orders-ebay", "ebay-order-import", {}), 600);
  assert.strictEqual(jobMemoryBudgetMb("walmart", "walmart-orders", { DATAPLUS_WORKER_JOB_RSS_MB: "600" }), 600);
  assert.strictEqual(jobMemoryBudgetMb("manual", "postgres-backup", { DATAPLUS_WORKER_HEAVY_JOB_RSS_MB: "900" }), 900);
  console.log("Worker supervisor memory tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
