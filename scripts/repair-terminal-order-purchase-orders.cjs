const crypto = require('node:crypto');
const postgres = require('../db');
const { reconcilePersistedTerminalOrders, terminalOrderWasFulfilledFromWarehouse } = require('../server');

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
  const legacyReasons = await postgres.getPool().query(`
    select po_id, raw->>'cancelReason' as cancel_reason
    from purchase_order_records
    where coalesce(raw->>'cancelReason', '') ~* '^All customer demand was (shipped|fulfilled|delivered|completed|done|closed)\\.$'
       or coalesce(raw->>'cancelReason', '') = 'All customer demand was canceled.'
  `);
  let reasonCorrections = 0;
  for (const row of legacyReasons.rows) {
    const po = await postgres.readPurchaseOrderByKey(row.po_id);
    if (!po) continue;
    const removedDemand = Array.isArray(po.removedDemand) ? po.removedDemand : [];
    const orderIds = [...new Set(removedDemand.map((line) => String(line.orderId || '').trim()).filter(Boolean))];
    const linkedOrders = (await Promise.all(orderIds.map((orderId) => postgres.readOrderByKey(orderId)))).filter(Boolean);
    const canceledReason = String(row.cancel_reason || '') === 'All customer demand was canceled.';
    const orderNumbers = [...new Set(removedDemand.map((line) => String(line.orderNumber || '').trim()).filter(Boolean))];
    const fulfilledFromWarehouse = !canceledReason && linkedOrders.some(terminalOrderWasFulfilledFromWarehouse);
    const nextReason = canceledReason
      ? orderNumbers.length === 1
        ? `Customer order ${orderNumbers[0]} was canceled; this purchase order is no longer required.`
        : 'All customer orders linked to this PO were canceled; no supplier purchase is required.'
      : fulfilledFromWarehouse
        ? 'Customer order was fulfilled from warehouse stock; dropship purchasing was no longer required.'
        : 'Customer order was fulfilled outside this purchase order; supplier purchasing was no longer required.';
    const now = new Date().toISOString();
    po.cancelReason = nextReason;
    po.timeline = Array.isArray(po.timeline) ? po.timeline : [];
    const correctionType = canceledReason ? 'cancellation_reason_reworded' : 'completion_reason_reworded';
    if (!po.timeline.some((entry) => String(entry.type || '') === correctionType)) {
      po.timeline.push({
        id: crypto.randomUUID(),
        type: correctionType,
        title: canceledReason ? 'Customer cancellation closed PO' : fulfilledFromWarehouse ? 'Warehouse fulfillment replaced dropship' : 'Completed order unlinked from PO',
        message: nextReason,
        user: 'Terminal order PO repair',
        createdAt: now
      });
    }
    po.updatedAt = now;
    await postgres.savePurchaseOrder(po);
    reasonCorrections += 1;
  }
  console.log(JSON.stringify({ candidates: orders.length, ...repaired, reasonCorrections }, null, 2));
}

main()
  .then(() => postgres.getPool()?.end())
  .catch(async (error) => {
    console.error(error);
    await postgres.getPool()?.end().catch(() => {});
    process.exitCode = 1;
  });
