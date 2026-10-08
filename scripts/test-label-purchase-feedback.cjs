const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "web", "src", "App.tsx"), "utf8");
const purchaseStart = source.indexOf("const buySelectedLabels = async");
const progressStart = source.indexOf("setLabelPurchaseProgress({ active: true", purchaseStart);
const modalOpen = source.indexOf("setBatchOpen(true)", purchaseStart);

assert(purchaseStart >= 0, "bulk label purchase handler must exist");
assert(modalOpen > purchaseStart && modalOpen < progressStart, "the progress dialog must open before label purchase begins");
assert.match(source, /labelPurchaseProgress\?\.active \? `Purchased \$\{labelPurchaseProgress\.purchased\}\/\$\{labelPurchaseProgress\.total\}`/, "the bulk action must show live purchase counts");
assert.match(source, /labelPurchaseProgress \? "Purchasing shipping labels" : "Create shipping batch"/, "the dialog title must describe active purchasing");

console.log("Label purchase feedback tests passed.");
