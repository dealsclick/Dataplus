#!/usr/bin/env node
const postgres = require('../db');
const { hydrateOrdersLocalCosts } = require('../server');

function option(name, fallback = '') {
  const prefix = `--${name}=`;
  const match = process.argv.find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

async function main() {
  if (!postgres.isPostgresEnabled()) throw new Error('DATABASE_URL is required.');
  const apply = process.argv.includes('--apply');
  const batchSize = Math.max(1, Math.min(1000, Number(option('batch-size', 250)) || 250));
  const maxOrders = Math.max(1, Number(option('limit', 50000)) || 50000);
  let cursor = '';
  let scanned = 0;
  let changedOrders = 0;
  let changedLines = 0;

  while (scanned < maxOrders) {
    const page = await postgres.readOrderCostBackfillBatch({ after: cursor, limit: Math.min(batchSize, maxOrders - scanned) });
    if (!page.orders.length) break;
    const result = await hydrateOrdersLocalCosts(page.orders);
    const changedIds = new Set(result.changedOrderIds || []);
    const changed = result.orders.filter((order) => changedIds.has(order.id));
    if (apply && changed.length) await postgres.upsertOrdersFromState(changed, { replace: false, batchSize });
    scanned += page.orders.length;
    changedOrders += result.changedOrders;
    changedLines += result.changedLines;
    cursor = page.next || '';
    process.stdout.write(`${apply ? 'Applied' : 'Reviewed'} ${scanned} candidate orders; ${changedOrders} orders / ${changedLines} lines resolved.\n`);
    if (!cursor) break;
  }

  process.stdout.write(JSON.stringify({ apply, scanned, changedOrders, changedLines }, null, 2) + '\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => postgres.closePool().catch(() => {}));
