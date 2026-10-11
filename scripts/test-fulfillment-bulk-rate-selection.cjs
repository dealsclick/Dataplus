const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "web", "src", "App.tsx"), "utf8");

assert.match(source, /selectedRateReadyPackageEntries = \[\.\.\.selectedPackageGroups\.entries\(\)\]\.filter\(\(\[, packageRows\]\) => packageRows\.every\(\(row\) => readinessFor\(row\)\.ready === true\)\)/, "bulk rate eligibility must require every row in a package to be ready");
assert.match(source, /await refreshRatesForRows\(selectedRateReadyRows\)/, "bulk rate refresh must submit only ready package rows");
assert.match(source, /selectedRateSkippedCount > 0[\s\S]*skipping \$\{selectedRateSkippedCount\}/, "bulk rate refresh must tell the operator how many shipments were skipped");
assert.match(source, /disabled=\{busy \|\| rateRefreshProgress\.active \|\| !selectedRateReadyRows\.length\}/, "bulk rate refresh must remain enabled when any selected shipment is ready");
assert.doesNotMatch(source, /!allSelectedReady/, "one unready shipment must not disable bulk rate refresh");

console.log("Fulfillment bulk rate selection tests passed.");
