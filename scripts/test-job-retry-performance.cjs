const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const start = source.indexOf("const retryImportJobMatch");
const end = source.indexOf("if (req.method === \"POST\" && parts[0] === \"api\"", start);
const route = source.slice(start, end);

assert(start >= 0 && end > start, "primary import-job retry route must exist");
assert.match(route, /postgres\.readOperationJob\(retryJobId\)/, "retry reads the requested durable job directly");
assert.doesNotMatch(route, /readDbFast\(/, "retry must not load application state");
assert.doesNotMatch(route, /mergedImportJobsAsync\(/, "retry must not scan bounded job history");
assert.match(route, /sendJson\(res, 202, \{ queued: true, job: clientImportJob\(job\), message: job\.message \}\)/, "retry responds with the queued job without rebuilding job history");

console.log("Job retry uses a direct durable lookup and bounded response.");
