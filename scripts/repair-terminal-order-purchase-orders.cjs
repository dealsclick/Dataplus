const postgres = require('../db');
const { reconcilePersistedTerminalOrders } = require('../server');

const TERMINAL_STATUSES = [
  'canceled', 'cancelled', 'void', 'voided', 'refunded',
  'shipped', 'fulfilled', 'delivered', 'completed', 'complete', 'done', 'closed'
];

async function main() {
  if (!postgres.isPostgresEnabled()) throw new Error('DATABASE_URL is required.');
  const result = await postgres.getPool().query(`
    select order_id
    from order_records
    where lower(coalesce(status, '')) = any($1::text[])
      and (
        case when jsonb_typeof(raw->'fulfillmentRoutes') = 'array' then jsonb_array_length(raw->'fulfillmentRoutes') else 0 end > 0
        or case when jsonb_typeof(raw->'purchaseOrderIds') = 'array' then jsonb_array_length(raw->'purchaseOrderIds') else 0 end > 0
        or nullif(raw->>'purchaseOrderId', '') is not null
      )
    order by updated_at asc, order_id asc
  `, [TERMINAL_STATUSES]);
  const orders = [];
  for (let index = 0; index < result.rows.length; index += 250) {
    const rows = result.rows.slice(index, index + 250);
    const loaded = await Promise.all(rows.map((row) => postgres.readOrderByKey(row.order_id)));
    orders.push(...loaded.filter(Boolean));
  }
  const repaired = await reconcilePersistedTerminalOrders(orders, { user: 'Terminal order PO repair' });
  console.log(JSON.stringify({ candidates: orders.length, ...repaired }, null, 2));
}

main()
  .then(() => postgres.getPool()?.end())
  .catch(async (error) => {
    console.error(error);
    await postgres.getPool()?.end().catch(() => {});
    process.exitCode = 1;
  });
