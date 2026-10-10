const postgres = require('../db');

const apply = process.argv.includes('--apply');
const orderArgument = process.argv.find((value) => value.startsWith('--orders='));
const orderNumbers = String(orderArgument?.split('=')[1] || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

function text(value) {
  return String(value || '').trim();
}

async function veeqoDelete(remoteShipmentId, settings) {
  const baseUrl = text(settings.veeqoApiBaseUrl || 'https://api.veeqo.com').replace(/\/+$/, '');
  const accessToken = text(settings.veeqoAccessToken || process.env.VEEQO_ACCESS_TOKEN);
  const apiKey = text(settings.veeqoApiKey || process.env.VEEQO_API_KEY);
  const tokenType = text(settings.veeqoTokenType || 'bearer').toLowerCase();
  if (!accessToken && !apiKey) throw new Error('Veeqo credentials are not configured.');
  const response = await fetch(`${baseUrl}/shipping/api/v1/shipments/${encodeURIComponent(remoteShipmentId)}`, {
    method: 'DELETE',
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `${tokenType === 'bearer' ? 'Bearer' : tokenType} ${accessToken}` } : { 'x-api-key': apiKey })
    },
    signal: AbortSignal.timeout(20000)
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Veeqo HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ''}`);
}

function appendAudit(order, shipment, walmartShipment, now) {
  order.shippingEvents = Array.isArray(order.shippingEvents) ? order.shippingEvents : [];
  order.shippingEvents.unshift({
    id: `shipping-event-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    provider: 'veeqo',
    action: 'void_label',
    status: 'voided',
    message: 'Veeqo confirmed duplicate label cancellation. Refund is pending; label cost is retained.',
    details: {
      shipmentId: shipment.id,
      remoteShipmentId: shipment.remoteShipmentId,
      supersededByShipmentId: walmartShipment.id,
      supersededByTrackingNumber: walmartShipment.trackingNumber
    },
    createdAt: now
  });
  order.timeline = Array.isArray(order.timeline) ? order.timeline : [];
  order.timeline.unshift({
    id: `timeline-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: 'shipping_label',
    title: 'Duplicate Veeqo label voided',
    message: `Veeqo confirmed cancellation of ${shipment.trackingNumber}. Walmart shipment ${walmartShipment.trackingNumber} remains active. Refund is pending.`,
    user: 'Maintenance: Walmart duplicate-label cleanup',
    createdAt: now
  });
}

async function main() {
  if (!postgres.isPostgresEnabled()) throw new Error('DATABASE_URL is required.');
  if (!orderNumbers.length) throw new Error('Pass an explicit comma-separated --orders list.');
  const pool = postgres.getPool();
  const candidates = await pool.query(`
    select order_id, order_number
    from order_records
    where order_number = any($1::text[])
    order by order_number
  `, [orderNumbers]);
  if (candidates.rowCount !== orderNumbers.length) {
    const found = new Set(candidates.rows.map((row) => text(row.order_number)));
    throw new Error(`Orders not found: ${orderNumbers.filter((value) => !found.has(value)).join(', ')}`);
  }
  const settings = await postgres.readStateField('systemSettings') || {};
  let voided = 0;
  let failed = 0;
  for (const row of candidates.rows) {
    const order = await postgres.readOrderByKey(row.order_id);
    const shipments = Array.isArray(order?.shipments) ? order.shipments : [];
    const localShipment = shipments.find((shipment) =>
      text(shipment.provider || shipment.labelProvider).toLowerCase() === 'veeqo'
      && text(shipment.channelSync?.status).toLowerCase() === 'superseded'
      && text(shipment.remoteShipmentId)
      && text(shipment.voidStatus).toLowerCase() !== 'voided');
    const walmartShipment = shipments.find((shipment) =>
      text(shipment.provider).toLowerCase() === 'walmart'
      && text(shipment.trackingNumber)
      && text(shipment.trackingNumber) !== text(localShipment?.trackingNumber)
      && ['label_purchased', 'shipped', 'in_transit', 'delivered'].includes(text(shipment.status).toLowerCase()));
    if (text(order?.source).toLowerCase() !== 'walmart' || !localShipment || !walmartShipment) {
      throw new Error(`${row.order_number}: guarded duplicate-label checks did not pass.`);
    }
    console.log(`${row.order_number}: Veeqo ${localShipment.trackingNumber} -> Walmart ${walmartShipment.trackingNumber}${apply ? '' : ' (dry run)'}`);
    if (!apply) continue;
    try {
      await veeqoDelete(localShipment.remoteShipmentId, settings);
      const now = new Date().toISOString();
      localShipment.voidStatus = 'voided';
      localShipment.voidedAt = now;
      localShipment.labelRefundStatus = 'pending';
      localShipment.voidReason = 'Duplicate local label superseded by a different Walmart shipment.';
      localShipment.voidedBy = 'Maintenance: Walmart duplicate-label cleanup';
      appendAudit(order, localShipment, walmartShipment, now);
      order.updatedAt = now;
      await postgres.saveOrder(order);
      voided += 1;
      console.log(`${row.order_number}: void confirmed; refund pending.`);
    } catch (error) {
      localShipment.voidStatus = 'failed';
      localShipment.voidError = error.message || String(error);
      order.updatedAt = new Date().toISOString();
      await postgres.saveOrder(order);
      failed += 1;
      console.error(`${row.order_number}: ${localShipment.voidError}`);
    }
  }
  console.log(`Complete: ${voided} voided; ${failed} failed; ${candidates.rowCount - voided - failed} dry-run.`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => postgres.closePool());
