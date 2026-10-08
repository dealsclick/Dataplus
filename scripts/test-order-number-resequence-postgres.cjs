const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");

const connection = process.env.LEDGER_TEST_DATABASE_URL;

test("internal order numbers resequence by order date without changing stable or channel identifiers", { skip: !connection }, async () => {
  const url = new URL(connection);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname.endsWith("_ledger_test"), "Use the isolated ledger test database only.");
  const schema = `resequence_test_${process.pid}`;
  const admin = new Pool({ connectionString: connection });
  await admin.query(`create schema ${schema}`);
  url.searchParams.set("options", `-c search_path=${schema}`);
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = url.toString();
  const db = require("../db");
  try {
    await db.initRelationalSchema();
    const pool = db.getPool();
    await pool.query("drop index if exists order_records_internal_number_unique_idx");
    await pool.query("drop index if exists order_records_order_number_unique_idx");
    await pool.query(`
      insert into order_records(order_id, order_number, internal_order_number, marketplace_order_id, source, status, order_date, raw) values
        ('order-oldest', '9002', '9002', 'PO-oldest', 'Temu', 'processing', '2026-01-01T09:00:00Z', '{"orderNumber":"9002","marketplaceOrderNumber":"PO-oldest"}'),
        ('order-duplicate-a', '9009', '9009', 'shopify-a', 'Shopify', 'processing', '2026-01-02T09:00:00Z', '{"orderNumber":"9009","marketplaceOrderNumber":"#1001"}'),
        ('order-duplicate-b', '9009', '9009', 'ebay-b', 'eBay', 'processing', '2026-01-03T09:00:00Z', '{"orderNumber":"9009","marketplaceOrderNumber":"12-345"}')
    `);
    await pool.query("insert into state_documents(doc_key, data) values ('returns', $1::jsonb)", [JSON.stringify({ records: [{ orderId: "order-oldest", orderNumber: "9002", channelOrderNumber: "PO-oldest" }, { orderNumbers: ["9009"] }] })]);
    await pool.query("insert into accounting_documents(doc_key, data) values ('order:order-oldest', $1::jsonb)", [JSON.stringify({ orderId: "order-oldest", orderNumber: "9002", memo: "historical #9002 stays unchanged" })]);
    await pool.query("insert into purchase_order_records(po_id, raw) values ('po-1', $1::jsonb)", [JSON.stringify({ orderId: "order-oldest", orderNumber: "9002" })]);
    await pool.query("insert into purchase_order_line_items(line_id, po_id, raw) values ('po-line-1', 'po-1', $1::jsonb)", [JSON.stringify({ orderId: "order-oldest", orderNumber: "9002" })]);

    const preview = await db.previewInternalOrderResequence({ startNumber: 1000 });
    assert.equal(preview.orderCount, 3);
    assert.deepEqual(preview.first.map((row) => row.orderId), ["order-oldest", "order-duplicate-a", "order-duplicate-b"]);
    await assert.rejects(db.applyInternalOrderResequence({ runId: "stale", startNumber: 1000, fingerprint: "stale" }), /changed since preview/);
    const result = await db.applyInternalOrderResequence({ runId: "resequence-test", startNumber: 1000, fingerprint: preview.fingerprint, requestedBy: "Test" });
    assert.equal(result.orderCount, 3);
    assert.equal(result.nextOrderNumber, "1003");
    const orders = (await pool.query("select order_id, order_number, internal_order_number, marketplace_order_id, raw from order_records order by order_date")).rows;
    assert.deepEqual(orders.map((row) => [row.order_id, row.order_number, row.internal_order_number]), [["order-oldest", "1000", "1000"], ["order-duplicate-a", "1001", "1001"], ["order-duplicate-b", "1002", "1002"]]);
    assert.deepEqual(orders.map((row) => row.marketplace_order_id), ["PO-oldest", "shopify-a", "ebay-b"]);
    assert.equal(orders[0].raw.marketplaceOrderNumber, "PO-oldest");
    const returns = (await pool.query("select data from state_documents where doc_key = 'returns'")).rows[0].data;
    assert.equal(returns.records[0].orderNumber, "1000");
    assert.equal(returns.records[0].channelOrderNumber, "PO-oldest");
    assert.equal(returns.records[1].orderNumbers[0], "9009");
    const accounting = (await pool.query("select data from accounting_documents where doc_key = 'order:order-oldest'")).rows[0].data;
    assert.equal(accounting.orderNumber, "1000");
    assert.equal(accounting.memo, "historical #9002 stays unchanged");
    assert.equal((await pool.query("select raw from purchase_order_records where po_id = 'po-1'")).rows[0].raw.orderNumber, "1000");
    assert.equal((await pool.query("select raw from purchase_order_line_items where line_id = 'po-line-1'")).rows[0].raw.orderNumber, "1000");
    assert.equal((await pool.query("select count(*)::int as count from order_number_resequence_mappings where run_id = 'resequence-test'")).rows[0].count, 3);
  } finally {
    await db.closePool();
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
    await admin.query(`drop schema ${schema} cascade`);
    await admin.end();
  }
});

test("duplicate-number repair preserves the active canonical order and protects future assignments", { skip: !connection }, async () => {
  const url = new URL(connection);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname.endsWith("_ledger_test"), "Use the isolated ledger test database only.");
  const schema = `duplicate_number_test_${process.pid}`;
  const admin = new Pool({ connectionString: connection });
  await admin.query(`create schema ${schema}`);
  url.searchParams.set("options", `-c search_path=${schema}`);
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = url.toString();
  const db = require("../db");
  try {
    await db.initRelationalSchema();
    const pool = db.getPool();
    await pool.query("drop index if exists order_records_internal_number_unique_idx");
    await pool.query("drop index if exists order_records_order_number_unique_idx");
    await pool.query(`
      insert into order_records(order_id, order_number, internal_order_number, marketplace_order_id, source, status, order_date, updated_at, raw) values
        ('order-shipped', '45009', '45009', 'PO-old', 'Temu', 'shipped', '2026-04-01T09:00:00Z', '2026-09-16T09:00:00Z', '{"orderNumber":"45009","internalOrderNumber":"45009","marketplaceOrderNumber":"PO-old"}'),
        ('order-ready', '45009', '45009', 'PO-current', 'Temu', 'ready', '2026-09-17T09:00:00Z', '2026-10-08T09:00:00Z', '{"orderNumber":"45009","internalOrderNumber":"45009","marketplaceOrderNumber":"PO-current"}'),
        ('order-unique', '50561', '50561', 'PO-unique', 'Temu', 'ready', '2026-10-08T10:00:00Z', '2026-10-08T10:00:00Z', '{"orderNumber":"50561","internalOrderNumber":"50561","marketplaceOrderNumber":"PO-unique"}')
    `);
    await pool.query("insert into state_documents(doc_key, data) values ('references', $1::jsonb)", [JSON.stringify({
      records: [{ orderId: "order-shipped", orderNumber: "45009" }, { orderId: "order-ready", orderNumber: "45009" }],
      orderNumbers: ["45009"]
    })]);

    const preview = await db.previewDuplicateInternalOrderNumberRepair();
    assert.equal(preview.duplicateGroups, 1);
    assert.equal(preview.affectedRecords, 2);
    assert.equal(preview.changedCount, 1);
    assert.equal(preview.startNumber, 50562);
    assert.equal(preview.first[0].orderId, "order-shipped");
    const result = await db.applyDuplicateInternalOrderNumberRepair({
      runId: "duplicate-number-repair-test",
      fingerprint: preview.fingerprint,
      requestedBy: "Test",
      backupManifestPath: "test-backup.dump"
    });
    assert.equal(result.changedCount, 1);
    const orders = (await pool.query("select order_id, order_number, internal_order_number, marketplace_order_id, raw from order_records order by order_id")).rows;
    assert.deepEqual(orders.map(row => [row.order_id, row.order_number]), [
      ["order-ready", "45009"],
      ["order-shipped", "50562"],
      ["order-unique", "50561"]
    ]);
    assert.equal(orders.find(row => row.order_id === "order-shipped").marketplace_order_id, "PO-old");
    assert.equal(orders.find(row => row.order_id === "order-shipped").raw.marketplaceOrderNumber, "PO-old");
    const references = (await pool.query("select data from state_documents where doc_key = 'references'")).rows[0].data;
    assert.equal(references.records[0].orderNumber, "50562");
    assert.equal(references.records[1].orderNumber, "45009");
    assert.equal(references.orderNumbers[0], "45009");
    await assert.rejects(pool.query(`
      insert into order_records(order_id, order_number, internal_order_number, status, raw)
      values ('future-collision', '45009', '45009', 'ready', '{}')
    `), /unique|duplicate/i);
  } finally {
    await db.closePool();
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
    await admin.query(`drop schema ${schema} cascade`);
    await admin.end();
  }
});
