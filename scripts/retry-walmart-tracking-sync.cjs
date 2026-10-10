const path = require('node:path');
const postgres = require('../db');
const { createWalmartCredentials } = require('../lib/walmart-credentials');
const { createWalmartMarketplace } = require('../lib/walmart-marketplace');
const { createWalmartClient, mapOrder } = require('../lib/walmart-client');
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
      and lower(regexp_replace(coalesce(shipment.value ->> 'carrierName', shipment.value ->> 'carrier', ''), '[^a-z0-9]+', '', 'g'))
        = any(array['buyshipping','marketplaceshippinglabel','marketplacelabel','veeqo','veeqolabel','channellabel','shippinglabel'])
      and nullif(shipment.value ->> 'trackingNumber', '') is not null
    order by o.order_number
    limit $1
  `, [limit]);

  console.log(`${candidates.rowCount} Walmart shipment sync candidate${candidates.rowCount === 1 ? '' : 's'} found.`);
  if (!apply || !candidates.rowCount) return;

  const credentials = createWalmartCredentials({ directory: process.env.DATA_DIR || path.join(process.cwd(), 'data') });
  const readConnections = () => postgres.readEntityDocumentCollectionFast('connections');
  const channel = async () => (await readConnections()).find((entry) => entry.name === 'Walmart');
  const marketplace = createWalmartMarketplace({
    postgres,
    credentials,
    readConnections,
    readDb: async () => ({}),
    log: () => {},
    shippingRestriction: () => ({ blocked: false }),
    priceFor: () => 0
  });
  const client = createWalmartClient({ channel, credentials: (environment) => credentials.get(environment), log: () => {} });
  let sent = 0;
  let confirmed = 0;
  let superseded = 0;
  let failed = 0;
  for (const row of candidates.rows) {
    const order = await postgres.readOrderByKey(row.order_id);
    const shipment = (order?.shipments || []).find((entry) => String(entry.id || '') === String(row.shipment_id || ''));
    if (!order || !shipment) continue;
    try {
      const response = await client.request(`/v3/orders/${encodeURIComponent(order.marketplaceOrderId)}`);
      const remote = mapOrder(response.order || response);
      const remoteShipment = (remote.shipments || []).find((entry) => entry.trackingNumber === shipment.trackingNumber);
      const alternateRemoteShipment = (remote.shipments || [])[0];
      if (remoteShipment || alternateRemoteShipment) {
        const normalized = normalizeShipmentCarrier({
          ...shipment,
          carrier: remoteShipment ? remoteShipment.carrier : shipment.carrier,
          carrierName: remoteShipment ? remoteShipment.carrierName : shipment.carrierName
        });
        shipment.carrier = normalized.carrier;
        shipment.carrierName = normalized.carrierName;
        shipment.trackingNumber = normalized.trackingNumber;
        shipment.channelSync = remoteShipment ? {
          status: 'synced',
          channel: 'Walmart',
          updatedAt: new Date().toISOString(),
          message: 'Walmart already confirms this fulfillment and tracking number.'
        } : {
          status: 'superseded',
          channel: 'Walmart',
          updatedAt: new Date().toISOString(),
          message: `Walmart already shipped this order with ${alternateRemoteShipment.carrierName || alternateRemoteShipment.carrier || 'carrier'} tracking ${alternateRemoteShipment.trackingNumber}. This local label was not sent to Walmart.`
        };
        order.updatedAt = new Date().toISOString();
        await postgres.saveOrder(order);
        if (remoteShipment) {
          confirmed += 1;
          console.log(`${row.order_number}: Walmart confirms ${normalized.trackingNumber}`);
        } else {
          superseded += 1;
          console.log(`${row.order_number}: superseded by ${alternateRemoteShipment.trackingNumber}`);
        }
        continue;
      }
      if (remote.status === 'canceled') throw new Error('Walmart canceled this order before the local label could be submitted.');
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
  console.log(`Complete: ${sent} sent; ${confirmed} already confirmed; ${superseded} superseded; ${failed} failed.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => postgres.closePool());
