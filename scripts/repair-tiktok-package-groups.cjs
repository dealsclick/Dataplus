const postgres = require('../db');
const { applyTikTokPackageGroup } = require('../lib/tiktok-mappers');

function text(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function packageIds(order = {}) {
  const fromItems = (Array.isArray(order.items) ? order.items : []).map((item) => text(item.packageId));
  const fromExternal = Array.isArray(order.external?.packageIds) ? order.external.packageIds.map(text) : [];
  return [...new Set([...fromItems, ...fromExternal].filter(Boolean))];
}

async function main() {
  if (!postgres.isPostgresEnabled()) throw new Error('DATABASE_URL is required.');
  const apply = process.argv.includes('--apply');
  const packageFilter = text(process.argv.find((value) => value.startsWith('--package='))?.slice('--package='.length));
  await postgres.initDatabase();
  const pool = postgres.getPool();
  const client = await pool.connect();
  try {
    const result = await client.query(`
      select order_id, order_number, raw
      from order_records
      where lower(coalesce(source, channel_source, '')) in ('tiktok', 'tiktok shop')
      order by created_at asc, order_id asc
    `);
    const groups = new Map();
    for (const row of result.rows) {
      const order = row.raw && typeof row.raw === 'object' ? row.raw : {};
      for (const packageId of packageIds(order)) {
        if (packageFilter && packageId !== packageFilter) continue;
        if (!groups.has(packageId)) groups.set(packageId, []);
        groups.get(packageId).push({ ...row, raw: order });
      }
    }

    const repairs = [];
    for (const [packageId, rows] of groups) {
      if (rows.length < 2) continue;
      const sortedRows = [...rows].sort((left, right) => text(left.raw.marketplaceOrderId).localeCompare(text(right.raw.marketplaceOrderId)));
      const orderIds = sortedRows.map((row) => text(row.raw.marketplaceOrderId || row.raw.external?.orderId)).filter(Boolean);
      if (orderIds.length < 2) continue;
      const shipment = sortedRows.flatMap((row) => Array.isArray(row.raw.shipments) ? row.raw.shipments : []).find((entry) => text(entry.trackingNumber));
      const group = {
        packageId,
        orderIds,
        packageStatus: text(sortedRows[0].raw.external?.packageStatus),
        splitOrCombineTag: 'COMBINE',
        trackingNumber: text(shipment?.trackingNumber),
        checkedAt: new Date().toISOString()
      };
      repairs.push({ packageId, orderIds, dataPlusOrders: sortedRows.map((row) => text(row.order_number || row.order_id)), trackingNumber: group.trackingNumber });
      if (!apply) continue;
      await client.query('begin');
      try {
        for (const row of sortedRows) {
          const updated = applyTikTokPackageGroup(row.raw, group);
          await client.query('update order_records set raw = $2::jsonb, updated_at = now() where order_id = $1', [row.order_id, JSON.stringify(updated)]);
        }
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    }
    process.stdout.write(`${JSON.stringify({ mode: apply ? 'apply' : 'dry-run', packageFilter, scanned: result.rows.length, repairedGroups: repairs.length, repairs }, null, 2)}\n`);
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message || error}\n`);
    process.exitCode = 1;
  })
  .finally(() => postgres.closePool());
