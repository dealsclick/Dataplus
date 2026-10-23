const postgres = require('../db');
const { _test } = require('../lib/temu-settlement-report');

const apply = process.argv.includes('--apply');

function positiveNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function activeShipmentCost(order = {}) {
  return (Array.isArray(order.shipments) ? order.shipments : []).reduce((total, shipment) => {
    if (['void', 'voided', 'canceled', 'cancelled'].includes(String(shipment?.voidStatus || shipment?.status || '').toLowerCase())) return total;
    return total + (positiveNumber(shipment?.shippingCost) || 0);
  }, 0);
}

function settlementRelatedId(row = {}) {
  const raw = row.raw && typeof row.raw === 'object' ? row.raw : {};
  return String(row.tracking_number || raw.related_id || raw.relatedId || raw._dataplus?.relatedId || '').trim();
}

async function retainedBatchCosts(pool) {
  const result = await pool.query(`
    select distinct on (batch_row.order_id, batch_row.shipment_id)
      batch_row.batch_id,
      batch.batch_number,
      batch_row.order_id,
      batch_row.shipment_id,
      coalesce(nullif(batch_row.shipping_cost, 0),
        case when batch_row.row_payload #>> '{selectedRate,amount}' ~ '^[0-9]+([.][0-9]+)?$'
          then (batch_row.row_payload #>> '{selectedRate,amount}')::numeric end) as shipping_cost,
      coalesce(batch_row.row_payload -> 'selectedRate', '{}'::jsonb) as selected_rate
    from fulfillment_label_batch_rows batch_row
    join fulfillment_label_batches batch on batch.batch_id = batch_row.batch_id
    join order_records order_record on order_record.order_id = batch_row.order_id
    left join order_shipment_financials financial
      on financial.order_id = batch_row.order_id and financial.shipment_id = batch_row.shipment_id
    where lower(coalesce(batch_row.status, '')) = 'purchased'
      and lower(coalesce(batch_row.channel, order_record.channel_source, order_record.source, '')) = 'temu'
      and batch_row.order_id is not null
      and batch_row.shipment_id is not null
      and coalesce(nullif(batch_row.shipping_cost, 0),
        case when batch_row.row_payload #>> '{selectedRate,amount}' ~ '^[0-9]+([.][0-9]+)?$'
          then (batch_row.row_payload #>> '{selectedRate,amount}')::numeric end) > 0
      and (
        coalesce(financial.estimated_shipping_cost, financial.quoted_cost, 0) <= 0
        or coalesce(financial.purchase_origin, 'unknown') <> 'dataplus'
        or coalesce(financial.batch_id, '') = ''
      )
    order by batch_row.order_id, batch_row.shipment_id, batch_row.updated_at desc nulls last
  `);
  return result.rows;
}

async function repairRetainedEstimates(pool) {
  const rows = await retainedBatchCosts(pool);
  const byOrder = new Map();
  for (const row of rows) {
    if (!byOrder.has(row.order_id)) byOrder.set(row.order_id, []);
    byOrder.get(row.order_id).push(row);
  }
  const totals = { candidates: rows.length, orders: byOrder.size, repairedShipments: 0, skippedShipments: 0 };
  for (const [orderId, orderRows] of byOrder) {
    const order = await postgres.readOrderByKey(orderId);
    if (!order) {
      totals.skippedShipments += orderRows.length;
      continue;
    }
    let changed = false;
    for (const row of orderRows) {
      const shipment = (Array.isArray(order.shipments) ? order.shipments : []).find(candidate => String(candidate?.id || '') === String(row.shipment_id || ''));
      const cost = positiveNumber(row.shipping_cost, row.selected_rate?.amount);
      if (!shipment || !cost) {
        totals.skippedShipments += 1;
        continue;
      }
      shipment.shippingCost = cost;
      shipment.quotedCost = cost;
      shipment.currency = String(row.selected_rate?.currency || shipment.currency || order.currency || 'USD').toUpperCase();
      shipment.selectedRate = { ...(shipment.selectedRate || {}), ...(row.selected_rate || {}), amount: cost, currency: shipment.currency };
      shipment.purchaseOrigin = 'dataplus';
      shipment.fulfillmentBatchId = String(row.batch_id || shipment.fulfillmentBatchId || '');
      shipment.fulfillmentBatchNumber = String(row.batch_number || shipment.fulfillmentBatchNumber || '');
      shipment.updatedAt = new Date().toISOString();
      changed = true;
      totals.repairedShipments += 1;
    }
    if (!changed) continue;
    const shipmentCost = activeShipmentCost(order);
    if (shipmentCost > 0 && !(Number(order.shippingCost) > 0)) order.shippingCost = Number(shipmentCost.toFixed(2));
    order.updatedAt = new Date().toISOString();
    if (apply) await postgres.saveOrder(order);
  }
  return totals;
}

async function unmatchedSettlementLines(pool) {
  const result = await pool.query(`
    select line.line_id, line.settlement_id, line.order_id, line.tracking_number, line.raw
    from shipping_settlement_lines line
    join shipping_settlements settlement on settlement.settlement_id = line.settlement_id
    where lower(coalesce(settlement.provider, '')) = 'temu'
      and line.order_id is not null
      and (line.shipment_id is null or line.match_status <> 'matched')
      and lower(coalesce(line.raw #>> '{_dataplus,category}', '')) not like 'return_shipping%'
    order by line.order_id, line.line_id
  `);
  return result.rows;
}

async function repairSettlementLinks(pool) {
  const rows = await unmatchedSettlementLines(pool);
  const orderCache = new Map();
  const relinks = [];
  for (const row of rows) {
    if (!orderCache.has(row.order_id)) orderCache.set(row.order_id, await postgres.readOrderByKey(row.order_id));
    const order = orderCache.get(row.order_id);
    const candidates = (Array.isArray(order?.shipments) ? order.shipments : []).map(shipment => _test.temuShipmentCandidate({
      shipmentId: shipment.id,
      trackingNumber: shipment.trackingNumber,
      raw: shipment
    }));
    const selected = _test.selectTemuShipmentCandidate(candidates, settlementRelatedId(row), {
      allowSingle: true,
      allowSharedPhysical: true
    });
    if (selected) relinks.push({ lineId: row.line_id, orderId: row.order_id, shipmentId: selected.shipmentId });
  }
  if (apply && relinks.length) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`
        update shipping_settlement_lines line set
          shipment_id = repair.shipment_id,
          match_status = 'matched',
          matched_at = now(),
          matched_by = 'system:temu-shipping-cost-repair',
          updated_at = now()
        from jsonb_to_recordset($1::jsonb) as repair(line_id text, order_id text, shipment_id text)
        where line.line_id = repair.line_id and line.order_id = repair.order_id
      `, [JSON.stringify(relinks.map(row => ({ line_id: row.lineId, order_id: row.orderId, shipment_id: row.shipmentId })))]);
      const orderIds = [...new Set(relinks.map(row => row.orderId))];
      await client.query(`
        with totals as (
          select line.order_id, line.shipment_id, coalesce(sum(line.amount), 0) as actual_cost,
            max(line.settlement_id) as settlement_id
          from shipping_settlement_lines line
          join shipping_settlements settlement on settlement.settlement_id = line.settlement_id
          where lower(coalesce(settlement.provider, '')) = 'temu'
            and line.match_status = 'matched'
            and line.order_id = any($1::text[])
            and line.shipment_id is not null
          group by line.order_id, line.shipment_id
        )
        update order_shipment_financials financial set
          actual_shipping_cost = totals.actual_cost,
          actual_cost_source = 'temu_settlement_report',
          settlement_id = totals.settlement_id,
          billing_status = 'reconciled',
          billed_at = now(),
          reconciled_at = now(),
          reconciled_by = 'system:temu-shipping-cost-repair',
          updated_at = now()
        from totals
        where financial.order_id = totals.order_id and financial.shipment_id = totals.shipment_id
      `, [orderIds]);
      await client.query(`
        update shipping_settlements settlement set
          status = case when exists (
            select 1 from shipping_settlement_lines line
            where line.settlement_id = settlement.settlement_id and line.match_status = 'unmatched'
          ) then 'needs_review' else 'reconciled' end,
          updated_at = now()
        where lower(coalesce(settlement.provider, '')) = 'temu'
      `);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  return { candidates: rows.length, relinked: relinks.length, unresolved: rows.length - relinks.length };
}

async function main() {
  if (!postgres.isPostgresEnabled()) throw new Error('DATABASE_URL is required.');
  await postgres.initRelationalSchema();
  const pool = postgres.getPool();
  const estimates = await repairRetainedEstimates(pool);
  const settlements = await repairSettlementLinks(pool);
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', estimates, settlements }, null, 2));
  await postgres.closePool();
}

main().catch(async error => {
  console.error(error);
  await postgres.closePool().catch(() => {});
  process.exitCode = 1;
});
