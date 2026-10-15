const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const fulfillment = fs.readFileSync(path.join(root, "web", "src", "components", "fulfillment-route.tsx"), "utf8");
const settings = fs.readFileSync(path.join(root, "web", "src", "components", "settings-route.tsx"), "utf8");

assert.match(server, /FULFILLMENT_PERFORMANCE_RETENTION_MS = 60 \* 60_000/, "telemetry must expire after one hour");
assert.match(server, /FULFILLMENT_PERFORMANCE_MAX_SAMPLES = 240/, "telemetry must remain bounded in memory");
assert.match(server, /while \(bucket\.length > FULFILLMENT_PERFORMANCE_MAX_SAMPLES/, "old samples must be evicted");
assert.match(server, /sendFulfillmentConsoleResponse\(res, projection,[\s\S]*source: paged \? "paged_projection" : "projection"/, "projection responses must be timed without changing their source path");
assert.match(server, /sendFulfillmentConsoleResponse\(res, payload,[\s\S]*source: "snapshot_fallback"/, "the existing recovery fallback must remain timed and available");
assert.match(server, /Server-Timing[\s\S]*X-DataPlus-Payload-Bytes[\s\S]*X-DataPlus-Fulfillment-Source/, "request diagnostics must be available through response headers");
assert.match(server, /url\.pathname === "\/api\/fulfillment\/diagnostics"[\s\S]*fulfillmentPerformanceDiagnostics\(\)/, "operators must have a read-only diagnostics endpoint");
assert.match(server, /url\.pathname === "\/api\/fulfillment\/diagnostics\/client"[\s\S]*retainFulfillmentPerformanceSample\("client", sample\)/, "browser measurements must be recorded separately");

const serverSampleStart = server.indexOf("const sample = {", server.indexOf("function sendFulfillmentConsoleResponse"));
const serverSampleEnd = server.indexOf("retainFulfillmentPerformanceSample", serverSampleStart);
const clientSampleStart = server.indexOf("const sample = {", server.indexOf('url.pathname === "/api/fulfillment/diagnostics/client"'));
const clientSampleEnd = server.indexOf("retainFulfillmentPerformanceSample", clientSampleStart);
const storedSampleSchemas = `${server.slice(serverSampleStart, serverSampleEnd)}\n${server.slice(clientSampleStart, clientSampleEnd)}`;
assert.doesNotMatch(storedSampleSchemas, /orderId|orderNumber|customer|address|tracking|sku|labelData/i, "telemetry must not retain operational or customer identifiers");

assert.match(fulfillment, /apiCompletedAt = window\.performance\.now\(\)[\s\S]*requestAnimationFrame\(\(\) => window\.requestAnimationFrame/, "browser API and React commit timing must be measured separately");
assert.match(fulfillment, /reportFulfillmentClientPerformance\(\{[\s\S]*apiMs:[\s\S]*renderMs:[\s\S]*totalMs:/, "the browser must report only aggregate timing data");
assert.match(settings, /if \(activeTab === "fulfillment"\) void loadFulfillmentDiagnostics\(\)/, "diagnostics must load only when the Fulfillment settings tab is active");
assert.match(settings, /Fulfillment performance[\s\S]*Projection p95[\s\S]*Browser render p95/, "the settings panel must distinguish server and browser bottlenecks");
assert.match(settings, /Recent slow samples[\s\S]*Projection \/ render[\s\S]*row\.kind === "server" \? row\.readMs : row\.renderMs/, "slow samples must identify the stage responsible for the delay");

console.log("Fulfillment performance telemetry tests passed.");
