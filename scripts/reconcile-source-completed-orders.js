const { Client } = require("pg");
const { normalizeSourceOrderCompletion } = require("../lib/source-order-completion");

async function main() {
  const apply = process.argv.includes("--apply");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let cursor = "";
  let scanned = 0;
  let changed = 0;
  const bySource = {};
  try {
    const returnsResult = await client.query("select data from entity_documents where collection = 'returns'");
    const relatedReturns = returnsResult.rows.map((row) => row.data);
    while (true) {
      await client.query("begin");
      await client.query("set local lock_timeout = '3s'");
      const { rows } = await client.query("select order_id, raw from order_records where order_id > $1 order by order_id limit 200 for update", [cursor]);
      if (!rows.length) { await client.query("commit"); break; }
      for (const row of rows) {
        scanned += 1;
        const order = row.raw || {};
        if (!normalizeSourceOrderCompletion(order, { relatedReturns: relatedReturns.filter((entry) => entry.orderId === row.order_id || (entry.orderNumber && String(entry.orderNumber) === String(order.orderNumber))) })) continue;
        changed += 1;
        bySource[order.source || "Unknown"] = (bySource[order.source || "Unknown"] || 0) + 1;
        if (apply) await client.query("update order_records set raw = $2::jsonb, updated_at = now() where order_id = $1", [row.order_id, JSON.stringify(order)]);
      }
      await client.query("commit");
      cursor = rows[rows.length - 1].order_id;
    }
    console.log(JSON.stringify({ apply, scanned, changed, bySource }));
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally { await client.end(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
