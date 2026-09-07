const test = require('node:test'), assert = require('node:assert/strict');
const { Pool } = require('pg');
const { reviewOrder } = require('../lib/order-data-review');
const connection = process.env.LEDGER_TEST_DATABASE_URL;
test('review batches are bounded, read-only, join local records, and exclude received demand', { skip: !connection }, async () => {
  const url = new URL(connection);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_ledger_test'));
  const admin = new Pool({ connectionString: connection }), schema = `review_test_${process.pid}`;
  await admin.query(`create schema ${schema}`); url.searchParams.set('options', `-c search_path=${schema}`);
  const previous = process.env.DATABASE_URL; process.env.DATABASE_URL = url.toString();
  const db = require('../db');
  try {
    await db.readOrderDataReviewBatch();
    const pool = db.getPool();
    await pool.query(`insert into order_records(order_id, order_number, source, status, raw)
      select 'o' || lpad(i::text, 3, '0'), (1000+i)::text, 'Temu', 'shipped', jsonb_build_object('operationalStatus', 'waiting_for_po', 'purchaseOrderIds', jsonb_build_array('active', 'received-demand')) from generate_series(1,101) i`);
    await pool.query(`insert into order_line_items(line_id, order_id, qty, sku, raw) values ('line1','o001',1,'SKU','{"fulfillmentStatus":"unfulfilled"}')`);
    await pool.query(`insert into purchase_order_records(po_id, po_number, status, raw) values ('active','PO1001','submitted','{}'), ('received-demand','PO1002','submitted','{}')`);
    await pool.query(`insert into purchase_order_line_items(line_id, po_id, qty, received_qty, remaining_qty, raw) values ('po-line1','received-demand',1,1,0,'{"orderId":"o001"}')`);
    await pool.query(`insert into entity_documents(collection, entity_id, data) values ('returns','r1','{}'), ('returns','r2','{"orderId":"o001"}'), ('returns','r3','{"orderNumber":"1001"}'), ('returns','r4','{"orderId":"missing","orderNumber":"1001"}')`);
    const before = (await pool.query('select md5(string_agg(raw::text || updated_at::text, order_id order by order_id)) as checksum from order_records')).rows[0].checksum;
    const first = await db.readOrderDataReviewBatch(); assert.equal(first.records.length, 100); assert.equal(first.next.after, 'o100');
    const selected = first.records.find(row => row.order.id === 'o001');
    assert.equal(selected.returns.length, 1);
    assert.deepEqual(selected.purchaseOrders.map(row => row.id), ['active']);
    assert.ok(reviewOrder(selected.order, selected).some(row => row.code === 'line_fulfillment_mismatch'));
    const second = await db.readOrderDataReviewBatch(first.next); assert.equal(second.records.length, 1); assert.equal(second.next.stage, 'returns');
    const returns = await db.readOrderDataReviewBatch(second.next); assert.equal(returns.next, null);
    assert.deepEqual(returns.records.map(row => row.orderExists), [false, true, true, false]);
    const after = (await pool.query('select md5(string_agg(raw::text || updated_at::text, order_id order by order_id)) as checksum from order_records')).rows[0].checksum;
    assert.equal(after, before);
    await assert.rejects(db.readOrderDataReviewBatch({ stage: 'invalid' }), /Invalid review cursor/);
  } finally {
    await db.closePool(); if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
    await admin.query(`drop schema ${schema} cascade`); await admin.end();
  }
});
