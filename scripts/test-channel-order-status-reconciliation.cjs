const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const walmart = fs.readFileSync(path.join(__dirname, '../lib/walmart-marketplace.js'), 'utf8');
const { reconcileTerminalOrderPurchasing } = require('../server');

const shopifyImport = server.slice(
  server.indexOf('async function importShopifyOrders('),
  server.indexOf('function shopifyOrderWebhookQuery(')
);
assert.match(shopifyImport, /order\.cancelledAt && !includeCanceled/);
assert.match(shopifyImport, /postgres\.readOrderByKey\(order\.id\)/);
assert.match(shopifyImport, /existingById\.set\(order\.id, existing\)/);
assert.match(server, /ORDERS_CANCELLED/);

const ebayImport = server.slice(
  server.indexOf('async function importEbayOrders('),
  server.indexOf('function ebayReturnId(')
);
assert.match(ebayImport, /lastmodifieddate/);
assert.match(ebayImport, /reconcileTerminalOrderPurchasing/);

const ebayWorker = server.slice(
  server.indexOf('async function runEbayOrderImportWorkerJob('),
  server.indexOf('async function queueTemuReturnImportJob(')
);
assert.match(ebayWorker, /reconcilePersistedTerminalOrders\(importableOrders, \{ user: "eBay order import" \}\)/);

const purchasingReconciliation = server.slice(
  server.indexOf('function fulfillmentRouteHasPurchaseOrder('),
  server.indexOf('function committedSummary(')
);
assert.match(purchasingReconciliation, /route\.purchaseOrderId/);
assert.match(purchasingReconciliation, /route\.purchaseOrderNumber/);
assert.match(purchasingReconciliation, /if \(!fulfillmentRouteHasPurchaseOrder\(route\)\) continue/);
assert.doesNotMatch(purchasingReconciliation, /if \(route\.type !== "purchase"\) continue/);

const dropshipRouteId = 'route-dropship-canceled';
const dropshipPo = {
  id: 'po-dropship-canceled',
  poNumber: 'PO#TEST',
  status: 'ready_to_send',
  workflowStage: 'ready_to_send',
  orderIds: ['order-canceled'],
  orderNumbers: ['TEST-1'],
  items: [{ routeId: dropshipRouteId, orderId: 'order-canceled', sku: 'SKU-1', qty: 1, unitCost: 5 }]
};
const canceledOrder = {
  id: 'order-canceled',
  orderNumber: 'TEST-1',
  status: 'canceled',
  fulfillmentRoutes: [{
    id: dropshipRouteId,
    type: 'drop_ship',
    status: 'waiting_for_po',
    purchaseOrderId: dropshipPo.id,
    purchaseOrderNumber: dropshipPo.poNumber
  }]
};
const dropshipResult = reconcileTerminalOrderPurchasing({ purchaseOrders: [dropshipPo], purchaseRequirements: [] }, canceledOrder, { user: 'test' });
assert.equal(dropshipResult.changed, true);
assert.equal(dropshipResult.purchaseOrders.length, 1);
assert.equal(canceledOrder.fulfillmentRoutes[0].status, 'canceled');
assert.equal(dropshipPo.status, 'canceled');
assert.equal(dropshipPo.items.length, 0);
assert.equal(dropshipPo.cancelReason, 'Customer order TEST-1 was canceled; this purchase order is no longer required.');

const warehouseRouteId = 'route-warehouse-fulfilled';
const replacedDropshipRouteId = 'route-dropship-replaced';
const replacedDropshipPo = {
  id: 'po-dropship-replaced',
  poNumber: 'PO#WAREHOUSE',
  status: 'ready_to_send',
  workflowStage: 'ready_to_send',
  orderIds: ['order-warehouse-fulfilled'],
  orderNumbers: ['TEST-2'],
  items: [{ routeId: replacedDropshipRouteId, orderId: 'order-warehouse-fulfilled', sku: 'SKU-2', qty: 1, unitCost: 8 }]
};
const warehouseFulfilledOrder = {
  id: 'order-warehouse-fulfilled',
  orderNumber: 'TEST-2',
  status: 'shipped',
  fulfillmentRoutes: [
    { id: warehouseRouteId, type: 'warehouse', status: 'shipped', sku: 'SKU-2', qty: 1 },
    { id: replacedDropshipRouteId, type: 'drop_ship', status: 'waiting_for_po', purchaseOrderId: replacedDropshipPo.id, purchaseOrderNumber: replacedDropshipPo.poNumber }
  ]
};
reconcileTerminalOrderPurchasing({ purchaseOrders: [replacedDropshipPo], purchaseRequirements: [] }, warehouseFulfilledOrder, { user: 'test' });
assert.equal(replacedDropshipPo.status, 'canceled');
assert.equal(replacedDropshipPo.cancelReason, 'Customer order was fulfilled from warehouse stock; dropship purchasing was no longer required.');
assert.equal(replacedDropshipPo.timeline.at(-1)?.title, 'Warehouse fulfillment replaced dropship');

assert.match(walmart, /existing orders refreshed/);
assert.match(walmart, /walmart\.orderStatusSweep/);
assert.match(walmart, /client\.request\(`\/v3\/orders\/\$\{encodeURIComponent\(id\)\}`/);
assert.match(walmart, /reconcileExisting: true/);

console.log('PASS channel order status guards: Shopify cancellations, eBay modified polling, Walmart existing-order sweep');
