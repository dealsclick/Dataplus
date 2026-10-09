const assert = require('node:assert/strict');
const { orderVisibleInAllShipments } = require('../lib/fulfillment-shipment-visibility');

const now = Date.parse('2026-10-09T12:00:00Z');
const daysAgo = (days) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();

assert.equal(orderVisibleInAllShipments({
  status: 'processing',
  fulfillmentRoutes: [{ status: 'allocated', qty: 1 }]
}, now), true, 'active warehouse work remains visible');

assert.equal(orderVisibleInAllShipments({
  status: 'closed',
  channelStatus: 'canceled',
  fulfillmentRoutes: [{ status: 'closed', qty: 1 }]
}, now), false, 'channel-canceled closure is never shipment history');

assert.equal(orderVisibleInAllShipments({
  status: 'canceled',
  cancelledAt: daysAgo(1),
  shipments: []
}, now), false, 'recent cancellation without shipment is excluded');

assert.equal(orderVisibleInAllShipments({
  status: 'closed',
  fulfillmentRoutes: [{ status: 'shipped', qty: 1 }],
  shipments: [{ status: 'shipped', trackingNumber: 'TRACK1', shippedAt: daysAgo(2) }]
}, now), true, 'recent successful shipment remains visible');

assert.equal(orderVisibleInAllShipments({
  status: 'fulfilled',
  fulfillmentRoutes: [{ status: 'shipped', qty: 1 }],
  shipments: [{ status: 'delivered', trackingNumber: 'TRACK2', shippedAt: daysAgo(45) }]
}, now), false, 'old terminal shipment history is excluded');

assert.equal(orderVisibleInAllShipments({
  status: 'refunded',
  paidAmount: 25,
  shipments: [{ status: 'in_transit', trackingNumber: 'TRACK3', shippedAt: daysAgo(1) }]
}, now), false, 'refunded shipments belong in recovery, not All Shipments');

console.log('Fulfillment All Shipments visibility checks passed.');
