const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../db.js"), "utf8");
const start = source.indexOf("async function quickSearchOperations(");
const end = source.indexOf("\nfunction normalizedPurchaseOrderLookupNumber", start);
assert.ok(start >= 0 && end > start, "quickSearchOperations must exist");

const purchaseQueries = [];
const query = async (sql, params) => {
  if (sql.includes("from purchase_order_records")) {
    purchaseQueries.push({ sql, params });
    return { rows: [{ po_id: "po-1", po_number: "PO#100", ctech_id: "D188882", match_label: "CTech PO number" }] };
  }
  return { rows: [] };
};
const quickSearchOperations = vm.runInNewContext(`(${source.slice(start, end)})`, {
  getPool: () => ({ query }),
  initRelationalSchema: async () => {},
  nullableString: (value) => String(value || "").trim() || null
});

(async () => {
  const result = await quickSearchOperations("CTech PO D188882", { limit: 6 });
  assert.equal(result.purchaseOrders[0].ctech_id, "D188882");
  assert.equal(purchaseQueries.length, 1);
  assert.deepEqual(Array.from(purchaseQueries[0].params), ["ctechpod188882", "d188882", "ctechpod188882%", "d188882%", 6]);
  assert.match(purchaseQueries[0].sql, /nullif\(po\.raw->>'ctechId', ''\)/);
  assert.match(purchaseQueries[0].sql, /nullif\(po\.raw->>'externalPoNumber', ''\)/);
  assert.match(purchaseQueries[0].sql, /externalPlacement,externalPoNumber/);

  purchaseQueries.length = 0;
  await quickSearchOperations("D188882", { limit: 6 });
  assert.deepEqual(Array.from(purchaseQueries[0].params), ["d188882", "d188882", "d188882%", "d188882%", 6]);
  console.log("CTech PO quick-search tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
