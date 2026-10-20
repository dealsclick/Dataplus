#!/usr/bin/env node
const postgres = require('../db');

const APPLY = process.argv.includes('--apply');
const orderArg = process.argv.find((arg) => arg.startsWith('--orders='));
const orderNumbers = [...new Set(String(orderArg?.split('=').slice(1).join('=') || '')
  .split(',').map((value) => value.trim()).filter(Boolean))];

function lineForRoute(order = {}, route = {}) {
  const items = Array.isArray(order.items) ? order.items : [];
  const lineIndex = Number(route.lineIndex);
  if (!Number.isInteger(lineIndex) || lineIndex < 0) return null;
  return items.find((item, itemIndex) => Number(item.lineIndex ?? itemIndex) === lineIndex) || null;
}

function repairOrder(order = {}) {
  const changes = [];
  const routes = Array.isArray(order.fulfillmentRoutes) ? order.fulfillmentRoutes : [];
  const nextRoutes = routes.map((route) => {
    const line = lineForRoute(order, route);
    if (!line) return route;
    const expectedSku = String(line.sku || line.mappedSku || line.originalSku || '').trim();
    const expectedTitle = String(line.title || line.name || '').trim();
    const expectedProductId = String(line.productId || '').trim();
    const changed = (expectedSku && expectedSku !== String(route.sku || '').trim())
      || (expectedTitle && expectedTitle !== String(route.title || '').trim())
      || (expectedProductId && expectedProductId !== String(route.productId || '').trim());
    if (!changed) return route;
    if (String(route.purchaseOrderId || '').trim()) {
      changes.push({ routeId: route.id || '', lineIndex: route.lineIndex, skipped: 'linked_purchase_order', currentSku: route.sku || '', expectedSku });
      return route;
    }
    changes.push({ routeId: route.id || '', lineIndex: route.lineIndex, currentSku: route.sku || '', expectedSku });
    return {
      ...route,
      ...(expectedSku ? { sku: expectedSku } : {}),
      ...(expectedTitle ? { title: expectedTitle } : {}),
      ...(expectedProductId ? { productId: expectedProductId } : {}),
      lineIdentityRepairedAt: new Date().toISOString(),
      lineIdentityRepairSource: 'authoritative_order_line'
    };
  });
  return { order: { ...order, fulfillmentRoutes: nextRoutes }, changes };
}

async function main() {
  if (!orderNumbers.length) throw new Error('Pass the internal order numbers with --orders=47996,49542.');
  const pool = postgres.getPool();
  if (!pool) throw new Error('DATABASE_URL is required.');
  await postgres.initRelationalSchema();
  const result = await pool.query(`
    select order_id, order_number, source, raw
    from order_records
    where order_number = any($1::text[])
    order by order_number
  `, [orderNumbers]);
  const repairs = result.rows.map((row) => {
    const repaired = repairOrder(row.raw || {});
    return { ...row, ...repaired };
  });
  const summary = repairs.map((row) => ({
    orderNumber: row.order_number,
    orderId: row.order_id,
    source: row.source,
    changes: row.changes
  }));
  console.log(JSON.stringify({ apply: APPLY, requested: orderNumbers.length, found: repairs.length, orders: summary }, null, 2));
  if (!APPLY) return;
  const actionable = repairs.filter((row) => row.changes.some((change) => !change.skipped));
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const row of actionable) {
      await client.query('update order_records set raw = $2::jsonb, updated_at = now() where order_id = $1', [row.order_id, JSON.stringify(row.order)]);
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  console.log(JSON.stringify({ updatedOrders: actionable.length, skippedRoutes: summary.flatMap((row) => row.changes).filter((change) => change.skipped).length }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => postgres.closePool().catch(() => {}));

