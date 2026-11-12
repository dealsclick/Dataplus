const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const start = source.indexOf("async function scheduledOrderRoutingCandidateIds");
const end = source.indexOf("\nasync function processScheduledOrderRouting", start);
assert(start >= 0 && end > start, "scheduled routing candidate scan must exist");

const calls = [];
const pages = [
  Array.from({ length: 250 }, (_, index) => ({ id: `already-routed-${index}`, needsRouting: false })),
  Array.from({ length: 30 }, (_, index) => ({ id: `older-live-${index}`, needsRouting: true }))
];
const context = {
  SCHEDULED_ORDER_ROUTING_LIMIT: 25,
  SCHEDULED_ORDER_ROUTING_SCAN_PAGE_SIZE: 250,
  postgres: {
    async listOrders(options) {
      calls.push(options);
      return {
        orders: pages[options.page - 1] || [],
        totalPages: pages.length
      };
    }
  },
  orderAutomaticHoldDecision() {
    return { hold: false };
  },
  orderRoutingPolicyDecision() {
    return { allowed: true };
  },
  orderNeedsAutomaticRouting(order) {
    return order.needsRouting === true;
  }
};

vm.createContext(context);
vm.runInContext(`${source.slice(start, end)}\nthis.scan = scheduledOrderRoutingCandidateIds;`, context);

(async () => {
  const candidateIds = await context.scan({}, {});
  assert.equal(calls.length, 2, "the scan must continue past a page without eligible orders");
  assert.deepEqual(
    { paginated: calls[0].paginated, summary: calls[0].summary, openWorkOnly: calls[0].openWorkOnly, sort: calls[0].sort },
    { paginated: true, summary: true, openWorkOnly: true, sort: "created-asc" }
  );
  assert.equal(candidateIds.length, 25, "one routing pass must remain bounded");
  assert.equal(candidateIds[0], "older-live-0", "older eligible work must be rescued after the first page");
  assert.equal(candidateIds[24], "older-live-24");
  console.log("Order routing candidate pagination checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
