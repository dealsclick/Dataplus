const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const database = fs.readFileSync(path.join(root, "db.js"), "utf8");

const handlerStart = server.indexOf("async function handleFulfillmentPrintAgentApi");
const handlerEnd = server.indexOf("async function readFulfillmentShippingContext", handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, "print-agent handler must remain discoverable");
const handler = server.slice(handlerStart, handlerEnd);

assert.doesNotMatch(handler, /readFulfillmentOperationsState\s*\(/, "agent polling must not load every batch and print job");
assert.match(handler, /readStateField\("fulfillmentPrintStations"\)/, "agent authentication should load only the small station collection");
assert.match(handler, /claimFulfillmentPrintJob\(/, "job polling must use the atomic targeted claim");
assert.match(handler, /mutateStateArrayItem\("fulfillmentPrintQueue"/, "status acknowledgement must update one print job");
assert.match(handler, /readFulfillmentPrintPacketState\(parts\[4\]\)/, "document generation must load only its job and batch");
assert.match(handler, /targetedState: true/, "packet reconciliation must preserve targeted queue writes");
assert.match(handler, /shipmentPrintAppliedCount/, "a failed post-print side effect must remain retryable without double-counting the print");
assert.doesNotMatch(handler, /writeStateDocuments\(\{\s*fulfillmentPrintQueue/, "agent polling must not rewrite the full print queue");

const claimStart = database.indexOf("async function claimFulfillmentPrintJob");
const claimEnd = database.indexOf("async function replaceStateArrayItem", claimStart);
assert.ok(claimStart >= 0 && claimEnd > claimStart, "atomic print-job claim helper must remain discoverable");
const claim = database.slice(claimStart, claimEnd);
assert.match(claim, /for update/, "claims must serialize on the durable queue row");
assert.match(claim, /limit 1/, "a poll may claim at most one print job");
assert.match(claim, /jsonb_set/, "claims must patch one queue element");
assert.doesNotMatch(claim, /select data from state_documents where doc_key/, "claims must not transfer the complete queue document");

console.log("PASS print-agent polling uses targeted atomic queue operations");
