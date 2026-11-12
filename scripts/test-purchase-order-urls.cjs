const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { normalizedPurchaseOrderLookupNumber } = require("../db");

assert.equal(normalizedPurchaseOrderLookupNumber("PO#129883"), "PO#129883");
assert.equal(normalizedPurchaseOrderLookupNumber("PO-129883"), "PO#129883");
assert.equal(normalizedPurchaseOrderLookupNumber("po_129883"), "PO#129883");
assert.equal(normalizedPurchaseOrderLookupNumber("3083bd2a-afa1-4bcd-9b44-9bb76b9984b1"), "");

const urlHelper = fs.readFileSync(path.join(__dirname, "../web/src/lib/purchase-order-url.ts"), "utf8");
const detailWorkspace = fs.readFileSync(path.join(__dirname, "../web/src/components/purchasing-workspaces.tsx"), "utf8");
const warehouse = fs.readFileSync(path.join(__dirname, "../web/src/components/warehouse-route.tsx"), "utf8");

assert.match(urlHelper, /return `PO-\$\{internalNumber\[1\]\}`/, "canonical PO URLs should use a URL-safe PO-number key");
assert.match(detailWorkspace, /window\.history\.replaceState\(window\.history\.state, "", `\$\{canonicalPath\}/, "legacy PO detail URLs should be replaced after the PO loads");
assert.match(warehouse, /purchaseOrderUrl\(reference, audit\.linkedPurchaseOrderId\)/, "audit PO links should prefer the readable PO number");

console.log("PASS purchase-order URL normalization");
