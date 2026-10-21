const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const client = fs.readFileSync(path.join(root, "web/src/lib/client-api.ts"), "utf8");
const settings = fs.readFileSync(path.join(root, "web/src/components/settings-route.tsx"), "utf8");
const navigation = fs.readFileSync(path.join(root, "web/src/components/settings-navigation.ts"), "utf8");

assert.match(server, /SYSTEM_PERFORMANCE_RETENTION_MS = 60 \* 60_000/, "server metrics must expire after one hour");
assert.match(server, /SYSTEM_PERFORMANCE_MAX_SERVER_SAMPLES = 600/, "server metrics must have a hard sample cap");
assert.match(server, /SYSTEM_PERFORMANCE_MAX_CLIENT_SAMPLES = 300/, "browser metrics must have a hard sample cap");
assert.match(server, /!route\.startsWith\("\/api\/performance\/"\)/, "performance endpoints must not measure themselves");
assert.match(server, /workspace: systemPerformanceWorkspace\(route\)/, "raw API paths must be reduced to fixed workspaces");
assert.match(server, /databaseMs: Math\.round/, "server samples must include aggregate database time");
assert.match(server, /databaseQueries:/, "server samples must include database query counts");
assert.match(server, /databaseRows:/, "server samples must include aggregate database row counts");
assert.match(server, /memoryGrowthBytes:/, "server samples must include bounded request memory growth");
assert.match(server, /readOperationPerformanceSummary/, "the dashboard must report worker workload duration");
assert.doesNotMatch(server.slice(server.indexOf("function retainSystemPerformanceSample"), server.indexOf("const FULFILLMENT_PERFORMANCE_RETENTION_MS")), /writeState|saveState|insert into|update [a-z_]+ set/i, "normal telemetry retention must not write to the database");
assert.match(server, /pathname === "\/api\/performance\/client"[\s\S]*area: "overview", action: "view"/, "signed-in users must be able to submit anonymous browser timings");
assert.match(server, /pathname === "\/api\/performance\/diagnostics"[\s\S]*area: "settings\.operations", action: "view"/, "the dashboard must use settings view permission");

assert.match(client, /clientPerformanceQueue\.length >= 20/, "browser metrics must batch rather than send per request");
assert.match(client, /setTimeout\(\(\) => void flushClientPerformanceQueue\(\), 30_000\)/, "browser batches must have a quiet flush interval");
assert.match(client, /clientPerformanceQueue\.length > 100/, "the browser queue must stay bounded");
assert.match(client, /!path\.startsWith\("\/api\/performance\/"\)/, "browser telemetry must not recursively measure itself");
assert.doesNotMatch(client, /clientPerformanceQueue\.push\([^\n]*(path|body|query)/, "browser samples must not queue raw paths or request data");

assert.match(navigation, /id: "performance", label: "Performance"/, "Settings must expose a Performance section");
assert.match(settings, /System performance/, "Settings must render the system performance dashboard");
assert.match(settings, /Database p95/, "Settings must expose database timing");
assert.match(settings, /Worker lane duration/, "Settings must expose worker lane duration");
assert.match(settings, /No order, customer, SKU, tracking, request-body, or URL identifier data is retained/, "the privacy boundary must be visible to operators");

console.log("System performance telemetry checks passed.");
