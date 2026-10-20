#!/usr/bin/env node
process.env.DATAPLUS_DISABLE_POSTGRES = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fulfillmentShipmentHistoryFallbackRows,
  reconcileFulfillmentRouteLineIdentity
} = require('../server');

function multiLineOrder() {
  return {
    id: 'walmart-order-1',
    orderNumber: '55303',
    source: 'Walmart',
    buyer: 'Customer',
    orderDate: new Date().toISOString(),
    items: [
      { lineIndex: 0, sku: 'SKU-A', title: 'First item', productId: 'product-a', qty: 1 },
      { lineIndex: 1, sku: 'SKU-B', title: 'Second item', productId: 'product-b', qty: 2 }
    ],
    shipments: [
      { id: 'shipment-a', trackingNumber: 'TRACK-1', status: 'delivered', updatedAt: new Date().toISOString(), lines: [{ lineIndex: 0, sku: 'SKU-A', qty: 1 }] },
      { id: 'shipment-b', trackingNumber: 'TRACK-1', status: 'delivered', updatedAt: new Date().toISOString(), lines: [{ lineIndex: 1, sku: 'SKU-B', qty: 2 }] }
    ]
  };
}

const products = [
  { id: 'product-a', sku: 'SKU-A', title: 'First item' },
  { id: 'product-b', sku: 'SKU-B', title: 'Second item' }
];

test('shipment history keeps every order line that shares a tracking number', () => {
  const rows = fulfillmentShipmentHistoryFallbackRows([multiLineOrder()], [], products);
  assert.deepEqual(rows.map((row) => row.sku).sort(), ['SKU-A', 'SKU-B']);
  assert.deepEqual(rows.map((row) => row.lineIndex).sort(), [0, 1]);
});

test('shipment fallback excludes only the routed line instead of the whole order', () => {
  const order = multiLineOrder();
  const routed = [{ orderId: order.id, lineIndex: 0, sku: 'SKU-A', status: 'delivered', shippedAt: new Date().toISOString() }];
  const rows = fulfillmentShipmentHistoryFallbackRows([order], routed, products);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sku, 'SKU-B');
  assert.equal(rows[0].lineIndex, 1);
});

test('saved route identity follows its authoritative order line', () => {
  const order = multiLineOrder();
  order.fulfillmentRoutes = [
    { id: 'route-a', lineIndex: 0, sku: 'SKU-B', title: 'Second item', productId: 'product-b', status: 'closed' },
    { id: 'route-b', lineIndex: 1, sku: 'SKU-B', title: 'Second item', productId: 'product-b', status: 'closed' }
  ];
  reconcileFulfillmentRouteLineIdentity(order);
  assert.deepEqual(order.fulfillmentRoutes.map((route) => route.sku), ['SKU-A', 'SKU-B']);
  assert.deepEqual(order.fulfillmentRoutes.map((route) => route.productId), ['product-a', 'product-b']);
});

