const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "db.js"), "utf8");
const start = source.indexOf("async function readOperationalSummary()");
const end = source.indexOf("\nasync function closePool()", start);
const functionSource = source.slice(start, end);
const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const controllerStart = serverSource.indexOf("async function withOperationalSummary(");
const controllerEnd = serverSource.indexOf("\nfunction publicStateJson(", controllerStart);
const controllerSource = serverSource.slice(controllerStart, controllerEnd);

function loadSummaryReader(queryImpl) {
  const calls = [];
  let released = false;
  const client = {
    query: async (sql) => {
      calls.push(sql);
      return queryImpl(sql);
    },
    release: () => { released = true; }
  };
  const context = {
    getPool: () => ({ connect: async () => client }),
    initRelationalSchema: async () => {}
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource}\nthis.readOperationalSummary = readOperationalSummary;`, context);
  return { read: context.readOperationalSummary, calls, wasReleased: () => released };
}

test("operational summary uses relational inventory and a bounded transaction", async () => {
  const fixture = loadSummaryReader(async (sql) => {
    if (/with inventory_by_product/i.test(sql)) {
      return { rows: [{ inventoryCount: 10, openOrders: 2, lowStock: 3, reserved: 4 }] };
    }
    return { rows: [] };
  });
  const summary = await fixture.read();
  const summarySql = fixture.calls.find((sql) => /with inventory_by_product/i.test(sql));

  assert.equal(summary.inventoryCount, 10);
  assert.equal(summary.reserved, 4);
  assert.match(summarySql, /from inventory_levels/i);
  assert.doesNotMatch(summarySql, /raw\s*->>\s*'reserved'/i);
  assert.deepEqual(fixture.calls.slice(0, 2), ["begin", "set local statement_timeout = '10000ms'"]);
  assert.equal(fixture.calls.at(-1), "commit");
  assert.equal(fixture.wasReleased(), true);
});

test("operational summary timeout returns no override and releases the client", async () => {
  const fixture = loadSummaryReader(async (sql) => {
    if (/with inventory_by_product/i.test(sql)) {
      const error = new Error("statement timeout");
      error.code = "57014";
      throw error;
    }
    return { rows: [] };
  });

  assert.equal(await fixture.read(), null);
  assert.equal(fixture.calls.at(-1), "rollback");
  assert.equal(fixture.wasReleased(), true);
});

test("timed-out operational summaries cool down before retrying", async () => {
  let reads = 0;
  const context = {
    console,
    postgres: {
      isPostgresEnabled: () => true,
      readOperationalSummary: async () => {
        reads += 1;
        return null;
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(`
    let operationalSummaryCache = { value: null, refreshedAt: 0, retryAt: 0, pending: null };
    ${controllerSource}
    this.withOperationalSummary = withOperationalSummary;
    this.getCache = () => operationalSummaryCache;
  `, context);

  await context.withOperationalSummary({ inventory: [] });
  await new Promise((resolve) => setImmediate(resolve));
  const retryAt = context.getCache().retryAt;
  await context.withOperationalSummary({ inventory: [] });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(reads, 1);
  assert.ok(retryAt > Date.now() + 4 * 60_000);
});
