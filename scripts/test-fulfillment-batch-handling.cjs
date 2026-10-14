const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { normalizeBatchHandlingStatus, setBatchHandlingStatus } = require("../lib/fulfillment-batch-handling")

const batch = { id: "batch-1", batchNumber: "BATCH-1001", rows: [{ status: "purchased" }] }
assert.equal(normalizeBatchHandlingStatus(batch), "open", "legacy batches default to Open")

const closed = setBatchHandlingStatus(batch, "closed", { actor: "Luis", now: new Date("2026-10-14T17:00:00Z") })
assert.equal(closed.changed, true)
assert.equal(batch.warehouseStatus, "closed")
assert.equal(batch.warehouseClosedBy, "Luis")
assert.equal(batch.warehouseStatusHistory[0].previousStatus, "open")

const reopened = setBatchHandlingStatus(batch, "open", { actor: "Maria", now: new Date("2026-10-14T17:05:00Z") })
assert.equal(reopened.changed, true)
assert.equal(batch.warehouseStatus, "open")
assert.equal(batch.warehouseReopenedBy, "Maria")
assert.equal(batch.warehouseStatusHistory.length, 2)
assert.throws(() => setBatchHandlingStatus(batch, "printed"), /Open or Closed/)

const root = path.resolve(__dirname, "..")
const server = fs.readFileSync(path.join(root, "server.js"), "utf8")
assert.match(server, /label-batches" && parts\[3\] && parts\[4\] === "handling-status"/, "batch status API must exist")
assert.match(server, /at least one label has been purchased/, "empty batches cannot be closed")

console.log("Fulfillment batch handling status remains independent, explicit, and auditable.")
