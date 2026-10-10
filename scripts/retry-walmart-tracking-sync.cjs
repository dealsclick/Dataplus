const path = require('node:path');
const postgres = require('../db');
const { createWalmartCredentials } = require('../lib/walmart-credentials');
const { createWalmartMarketplace } = require('../lib/walmart-marketplace');
const { normalizeShipmentCarrier } = require('../lib/shipping-carriers');

const apply = process.argv.includes('--apply');
const limitArgument = process.argv.find((value) => value.startsWith('--limit='));
const limit = Math.max(1, Math.min(250, Number(limitArgument?.split('=')[1] || 100) || 100));

async function main() {
  if (!postgres.isPostgresEnabled()) throw new Error('DATABASE_URL is required.');
  const pool = postgres.getPool();
  const candidates = await pool.query(`
    select distinct o.order_id, o.order_number, shipment.value ->> 'id' as shipment_id
    from order_records o
    cross join lateral jsonb_array_elements(coalesce(o.raw -> 'shipments', '[]'::jsonb)) shipment(value)
    where lower(coalesce(o.source, '')) = 'walmart'
      and lower(coalesce(o.status, '')) not in ('canceled', 'cancelled', 'void', 'deleted', 'archived')
      and lower(coalesce(shipment.value ->> 'status', '')) = 'label_purchased'
      and shipment.value #>> '{channelSync,status}' = 'failed'
      and shipment.value #>> '{channelSync,message}' ~* '^Tracking number format matches .+, not (Buy Shipping|Marketplace shipping label|Marketplace label|Veeqo|Veeqo label|Channel label|Shipping label)\\.$'
    order by o.order_number
    limit $1
  `, [limit]);

  console.log(`${candidates.rowCount} Walmart shipment sync candidate${candidates.rowCount === 1 ? '' : 's'} found.`);
  if (!apply || !candidates.rowCount) return;

  const marketplace = createWalmartMarketplace({
    postgres,
    credentials: createWalmartCredentials({ directory: process.env.DATA_DIR || path.join(process.cwd(), 'data') }),
    readConnections: () => postgres.readEntityDocumentCollectionFast('connections'),
    readDb: async () => ({}),
    log: () => {},
    shippingRestriction: () => ({ blocked: false }),
    priceFor: () => 0
  });
  let sent = 0;
  let failed = 0;
  for (const row of candidates.rows) {
    const order = await postgres.readOrderByKey(row.order_id);
    const shipment = (order?.shipments || []).find((entry) => String(entry.id || '') === String(row.shipment_id || ''));
    if (!order || !shipment) continue;
    try {
      await marketplace.syncTracking(order.id, shipment.id, 'maintenance:walmart-tracking-retry');
      const normalized = normalizeShipmentCarrier(shipment);
      shipment.carrier = normalized.carrier;
      shipment.carrierName = normalized.carrierName;
      shipment.trackingNumber = normalized.trackingNumber;
      shipment.service = normalized.service || shipment.service;
      shipment.channelSync = {
        status: 'sent',
        channel: 'Walmart',
        updatedAt: new Date().toISOString(),
        message: 'Walmart accepted the fulfillment and tracking update.'
      };
      order.shippingCarrier = normalized.carrierName || order.shippingCarrier;
      order.carrierName = normalized.carrierName || order.carrierName;
      order.updatedAt = new Date().toISOString();
      await postgres.saveOrder(order);
      sent += 1;
      console.log(`${row.order_number}: sent ${normalized.carrierName} ${normalized.trackingNumber}`);
    } catch (error) {
      shipment.channelSync = {
        ...(shipment.channelSync || {}),
        status: 'failed',
        channel: 'Walmart',
        updatedAt: new Date().toISOString(),
        message: error.message || 'Walmart fulfillment sync failed.'
      };
      order.updatedAt = new Date().toISOString();
      await postgres.saveOrder(order);
      failed += 1;
      console.error(`${row.order_number}: ${shipment.channelSync.message}`);
    }
  }
  console.log(`Complete: ${sent} sent; ${failed} failed.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => postgres.closePool());
