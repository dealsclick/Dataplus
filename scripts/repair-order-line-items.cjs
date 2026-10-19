#!/usr/bin/env node
const postgres = require('../db');

const APPLY = process.argv.includes('--apply');
const batchSizeArg = process.argv.find((arg) => arg.startsWith('--batch-size='));
const batchSize = Math.max(1, Math.min(1000, Number(batchSizeArg?.split('=')[1] || 250)));

async function mismatchedOrders(pool) {
  return (await pool.query(`
    select o.order_id, o.order_number, o.source, o.raw,
      jsonb_array_length(o.raw->'items')::int as expected_lines,
      count(li.line_id)::int as saved_lines
    from order_records o
    left join order_line_items li on li.order_id = o.order_id
    where jsonb_typeof(o.raw->'items') = 'array'
      and jsonb_array_length(o.raw->'items') > 0
    group by o.order_id
    having count(li.line_id)::int <> jsonb_array_length(o.raw->'items')::int
    order by o.created_at, o.order_id
  `)).rows;
}

async function replaceLines(pool, rows) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const orderIds = rows.map((row) => row.order_id);
    const lines = rows.flatMap((row) => postgres.orderLineRecordsFromState({
      ...(row.raw || {}),
      id: row.raw?.id || row.raw?.orderId || row.order_id
    }));
    await client.query('delete from order_line_items where order_id = any($1::text[])', [orderIds]);
    if (lines.length) {
      await client.query(`
        insert into order_line_items (
          line_id, order_id, line_index, sku, mapped_sku, original_sku, title, qty, price, cost, raw
        )
        select line_id, order_id, line_index, sku, mapped_sku, original_sku, title, qty, price, cost, raw
        from jsonb_to_recordset($1::jsonb) as x(
          line_id text, order_id text, line_index integer, sku text, mapped_sku text,
          original_sku text, title text, qty numeric, price numeric, cost numeric, raw jsonb
        )
      `, [JSON.stringify(lines)]);
    }
    await client.query('commit');
    return lines.length;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const pool = postgres.getPool();
  if (!pool) throw new Error('DATABASE_URL is required.');
  await postgres.initRelationalSchema();
  const rows = await mismatchedOrders(pool);
  const expectedLines = rows.reduce((sum, row) => sum + Number(row.expected_lines || 0), 0);
  console.log(JSON.stringify({ apply: APPLY, mismatchedOrders: rows.length, expectedLines, sample: rows.slice(0, 20).map((row) => ({ orderId: row.order_id, orderNumber: row.order_number, source: row.source, expected: row.expected_lines, saved: row.saved_lines })) }, null, 2));
  if (!APPLY || !rows.length) return;
  let repairedOrders = 0;
  let rebuiltLines = 0;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    rebuiltLines += await replaceLines(pool, batch);
    repairedOrders += batch.length;
    console.log(`Repaired ${repairedOrders}/${rows.length} orders (${rebuiltLines} lines).`);
  }
  const remaining = await mismatchedOrders(pool);
  if (remaining.length) throw new Error(`${remaining.length} orders still have mismatched line projections.`);
  console.log(JSON.stringify({ repairedOrders, rebuiltLines, remaining: 0 }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => postgres.closePool().catch(() => {}));
