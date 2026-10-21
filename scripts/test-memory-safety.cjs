const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const compose = fs.readFileSync(path.join(root, "docker-compose.yml"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const worker = fs.readFileSync(path.join(root, "scripts", "dataplus-worker.js"), "utf8");

assert.match(compose, /dataplus:\s+[\s\S]*?mem_limit: 1536m[\s\S]*?DATAPLUS_WEB_MAX_OLD_SPACE_MB:-1024/);
assert.match(compose, /postgres:\s+[\s\S]*?mem_limit: 3072m[\s\S]*?shared_buffers=1GB/);
assert.match(compose, /redis:\s+[\s\S]*?mem_limit: 512m[\s\S]*?--maxmemory[\s\S]*?384mb/);
assert.match(compose, /cloudflared:[\s\S]*?mem_limit: 256m/);
assert.match(compose, /worker-orders-temu:[\s\S]*?max-old-space-size=1280[\s\S]*?mem_limit: 1792m/);
assert.match(server, /workerTask: "paid-order-routing"/);
assert.match(server, /async function runPaidOrderRoutingWorkerJob/);
assert.match(worker, /"paid-order-routing"/);
assert.match(worker, /runPaidOrderRoutingWorkerJob/);
assert.match(server, /runtimeMemory: \{/);

console.log("Memory safety checks passed.");
