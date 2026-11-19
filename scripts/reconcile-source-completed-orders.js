const { Client } = require("pg");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeSourceOrderCompletion } = require("../lib/source-order-completion");

async function main() {
  const apply = process.argv.includes("--apply");
  const marker = path.join(__dirname, "../data/migrations/source-order-completion-v1.json");
  if (process.argv.includes("--once") && fs.existsSync(marker)) {
    console.log(fs.readFileSync(marker, "utf8"));
    return;
  }
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
      const lineResult = await client.query(`
        select order_id, line_id, line_index, qty, line_fulfillment_status, line_fulfilled_qty, line_remaining_qty
        from order_line_items
        where order_id = any($1::text[])
        order by order_id, line_index
      `, [rows.map((row) => row.order_id)]);
      const linesByOrder = new Map();
      for (const line of lineResult.rows) {
        if (!linesByOrder.has(line.order_id)) linesByOrder.set(line.order_id, []);
        linesByOrder.get(line.order_id).push({
          lineId: line.line_id,
          lineIndex: Number(line.line_index || 0),
          qty: Number(line.qty || 0),
          fulfillmentStatus: line.line_fulfillment_status || "",
          fulfilledQty: Number(line.line_fulfilled_qty || 0),
          remainingQty: line.line_remaining_qty == null ? Number(line.qty || 0) : Number(line.line_remaining_qty)
        });
      }
      for (const row of rows) {
        scanned += 1;
        const order = row.raw || {};
        const retainedRawItems = Array.isArray(order.items) ? order.items : null;
        const relationalLines = linesByOrder.get(row.order_id) || [];
        if (relationalLines.length) order.items = relationalLines;
        if (!normalizeSourceOrderCompletion(order, { relatedReturns: relatedReturns.filter((entry) => entry.orderId === row.order_id || (entry.orderNumber && String(entry.orderNumber) === String(order.orderNumber))) })) continue;
        changed += 1;
        bySource[order.source || "Unknown"] = (bySource[order.source || "Unknown"] || 0) + 1;
        if (apply) {
          for (const line of relationalLines) {
            await client.query(`
              update order_line_items
              set line_fulfillment_status = $3,
                  line_fulfilled_qty = $4,
                  line_remaining_qty = $5,
                  updated_at = now()
              where order_id = $1 and line_id = $2
            `, [row.order_id, line.lineId, line.fulfillmentStatus, line.fulfilledQty, line.remainingQty]);
          }
          if (retainedRawItems) order.items = retainedRawItems;
          else delete order.items;
          await client.query("update order_records set raw = $2::jsonb, updated_at = now() where order_id = $1", [row.order_id, JSON.stringify(order)]);
        }
      }
      await client.query("commit");
      cursor = rows[rows.length - 1].order_id;
    }
    const summary = { apply, scanned, changed, bySource, completedAt: new Date().toISOString() };
    if (apply) {
      fs.mkdirSync(path.dirname(marker), { recursive: true });
      fs.writeFileSync(marker, JSON.stringify(summary, null, 2));
    }
    console.log(JSON.stringify(summary));
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally { await client.end(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
