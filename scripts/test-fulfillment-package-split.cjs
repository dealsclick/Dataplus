#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');
const { splitFulfillmentRoutes } = require('../lib/fulfillment-package-split');
const { resolvePackage } = require('../lib/fulfillment-operations');

function orderWithRoutes() {
  return {
    id: 'order-1',
    orderNumber: '10001',
    package: { packageWeight: 6, packageLength: 12, packageWidth: 10, packageHeight: 8 },
    fulfillmentRoutes: [
      { id: 'route-a', lineIndex: 0, sku: 'SKU-A', title: 'First', type: 'warehouse', status: 'ready_to_ship', qty: 2 },
      { id: 'route-b', lineIndex: 1, sku: 'SKU-B', title: 'Second', type: 'warehouse', status: 'ready_to_ship', qty: 1 }
    ]
  };
}

test('split creates the requested package groups without changing the unit total', () => {
  const order = orderWithRoutes();
  const result = splitFulfillmentRoutes(order, 2, { planId: 'plan-1', now: '2026-10-20T12:00:00.000Z', randomUUID: () => 'route-c' });
  assert.equal(result.labelCount, 2);
  assert.equal(result.packageGroups.length, 2);
  assert.equal(result.packageGroups.reduce((sum, group) => sum + group.units, 0), 3);
  assert.equal(order.fulfillmentRoutes.reduce((sum, route) => sum + route.qty, 0), 3);
  assert.deepEqual(new Set(order.fulfillmentRoutes.map((route) => route.shipmentPackageGroupId)), new Set(['split:plan-1:1', 'split:plan-1:2']));
  assert.equal(new Set(order.fulfillmentRoutes.map((route) => route.id)).size, order.fulfillmentRoutes.length);
  const packageWeights = new Map(order.fulfillmentRoutes.map((route) => [route.shipmentPackageGroupId, route.package.packageWeight]));
  assert.equal([...packageWeights.values()].reduce((sum, weight) => sum + weight, 0), 6);
});

test('an existing split can be resized and rejoined without duplicating quantity', () => {
  const order = {
    ...orderWithRoutes(),
    fulfillmentRoutes: [{ id: 'route-a', lineIndex: 0, sku: 'SKU-A', type: 'warehouse', status: 'ready_to_ship', qty: 4 }]
  };
  splitFulfillmentRoutes(order, 3, { planId: 'plan-1', randomUUID: (() => { let id = 0; return () => `route-new-${++id}`; })() });
  assert.equal(new Set(order.fulfillmentRoutes.map((route) => route.shipmentPackageGroupId)).size, 3);
  splitFulfillmentRoutes(order, 2, { planId: 'plan-2', randomUUID: () => 'route-resized' });
  assert.equal(order.fulfillmentRoutes.reduce((sum, route) => sum + route.qty, 0), 4);
  assert.equal(new Set(order.fulfillmentRoutes.map((route) => route.shipmentPackageGroupId)).size, 2);
  splitFulfillmentRoutes(order, 1);
  assert.equal(order.fulfillmentRoutes.length, 1);
  assert.equal(order.fulfillmentRoutes[0].qty, 4);
  assert.equal(order.fulfillmentRoutes[0].shipmentPackageGroupId, undefined);
  assert.equal(order.shipmentSplit, null);
});

test('split blocks unsafe fulfillment states', () => {
  assert.throws(() => splitFulfillmentRoutes(orderWithRoutes(), 4), /at most 3 labels/);
  const purchased = orderWithRoutes();
  purchased.shipments = [{ trackingNumber: 'TRACK-1' }];
  assert.throws(() => splitFulfillmentRoutes(purchased, 2), /Void the active shipping label/);
  const picking = orderWithRoutes();
  picking.fulfillmentRoutes[0].pickListId = 'pick-1';
  assert.throws(() => splitFulfillmentRoutes(picking, 2), /pick list or label batch/);
  const dropship = orderWithRoutes();
  dropship.fulfillmentRoutes[0].type = 'dropship';
  assert.throws(() => splitFulfillmentRoutes(dropship, 2), /Only warehouse fulfillment/);
});

test('shared split routes use the package saved for their package group', () => {
  const routes = [
    { id: 'route-a', sku: 'SKU-A', qty: 1, shipmentPackageGroupId: 'split:1', packageMeasurementSource: 'manual', package: { packageWeight: 3, packageLength: 10, packageWidth: 8, packageHeight: 6 } },
    { id: 'route-b', sku: 'SKU-B', qty: 1, shipmentPackageGroupId: 'split:1', packageMeasurementSource: 'manual', package: { packageWeight: 3, packageLength: 10, packageWidth: 8, packageHeight: 6 } }
  ];
  const resolved = resolvePackage({ package: { packageWeight: 9, packageLength: 20, packageWidth: 18, packageHeight: 16 } }, routes, []);
  assert.equal(resolved.package.packageWeight, 3);
  assert.deepEqual([resolved.package.packageLength, resolved.package.packageWidth, resolved.package.packageHeight], [10, 8, 6]);
});

test('un-grouped multi-line routes do not borrow one route package', () => {
  const routes = [
    { id: 'route-a', sku: 'SKU-A', qty: 1, packageMeasurementSource: 'manual', package: { packageWeight: 3, packageLength: 10, packageWidth: 8, packageHeight: 6 } },
    { id: 'route-b', sku: 'SKU-B', qty: 1 }
  ];
  const resolved = resolvePackage({ package: { packageWeight: 9, packageLength: 20, packageWidth: 18, packageHeight: 16 } }, routes, []);
  assert.equal(resolved.package.packageWeight, 9);
  assert.deepEqual([resolved.package.packageLength, resolved.package.packageWidth, resolved.package.packageHeight], [20, 18, 16]);
});
