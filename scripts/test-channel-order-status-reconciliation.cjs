const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const walmart = fs.readFileSync(path.join(__dirname, '../lib/walmart-marketplace.js'), 'utf8');
const { orderFulfillmentIntervention, reconcileTerminalOrderPurchasing } = require('../server');
const { walmartStatusReconciliationCandidates } = require('../lib/walmart-marketplace');

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
assert.equal(canceledOrder.fulfillmentDisposition.kind, 'do_not_ship');
assert.equal(canceledOrder.fulfillmentDisposition.reasonCode, 'canceled_at_channel');

const canceledAfterShipment = {
  id: 'order-canceled-after-shipment',
  orderNumber: 'TEST-RECOVERY-1',
  status: 'canceled',
  shippedAt: '2026-10-08T12:00:00.000Z',
  shipments: [{ status: 'in_transit', trackingNumber: '1ZTEST', carrier: 'UPS' }],
  fulfillmentRoutes: []
};
reconcileTerminalOrderPurchasing({ purchaseOrders: [], purchaseRequirements: [] }, canceledAfterShipment, { user: 'Walmart order import' });
assert.equal(canceledAfterShipment.fulfillmentDisposition.kind, 'recovery_required');
assert.equal(canceledAfterShipment.fulfillmentDisposition.reasonCode, 'canceled_after_shipment');
assert.equal(canceledAfterShipment.workflowExceptions.some((entry) => entry.type === 'channel_canceled_after_shipment'), true);

const refundedAfterDelivery = {
  id: 'order-refunded-after-delivery',
  orderNumber: 'TEST-RECOVERY-2',
  status: 'delivered',
  financialStatus: 'fully_refunded',
  shipments: [{ status: 'delivered', trackingStatus: 'delivered', trackingNumber: '9400TEST', carrier: 'USPS' }],
  fulfillmentRoutes: []
};
reconcileTerminalOrderPurchasing({ purchaseOrders: [], purchaseRequirements: [] }, refundedAfterDelivery, { user: 'Walmart order import' });
assert.equal(refundedAfterDelivery.fulfillmentDisposition.kind, 'recovery_required');
assert.equal(refundedAfterDelivery.fulfillmentDisposition.reasonCode, 'refunded_after_delivery_no_return');
assert.equal(refundedAfterDelivery.workflowExceptions.some((entry) => entry.type === 'channel_refunded_after_shipment'), true);

assert.deepEqual(orderFulfillmentIntervention({
  status: 'refunded',
  financialStatus: 'refunded',
  trackingNumber: 'UNUSED-LABEL',
  shipments: [{ status: 'label_purchased', trackingNumber: 'UNUSED-LABEL' }]
}), {
  kind: 'do_not_ship',
  sourceReason: 'refunded',
  reasonCode: 'refunded_with_unshipped_label',
  reasonLabel: 'Refunded; label must be voided',
  action: 'Do not ship. Void the unused label and release warehouse work.',
  shipmentState: 'label_created',
  trackingNumber: 'UNUSED-LABEL',
  carrier: '',
  hasReturn: false
});
assert.equal(orderFulfillmentIntervention({ status: 'processing', total: 100, refundAmount: 10, refunds: [{ amount: 10 }] }), null);

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
const sweepNow = Date.parse('2026-10-09T12:00:00.000Z');
assert.deepEqual(walmartStatusReconciliationCandidates([
  { source: 'Walmart', status: 'fulfilled', marketplaceOrderNumber: 'WMT-SHIPPED', orderDate: '2026-10-08T12:00:00.000Z' },
  { source: 'Walmart', status: 'processing', marketplaceOrderNumber: 'WMT-OPEN', orderDate: '2026-10-08T12:00:00.000Z' },
  { source: 'Walmart', status: 'canceled', marketplaceOrderNumber: 'WMT-CANCELED', orderDate: '2026-10-08T12:00:00.000Z' },
  { source: 'Walmart', status: 'delivered', marketplaceOrderNumber: 'WMT-OLD', orderDate: '2026-01-01T12:00:00.000Z' }
], { now: sweepNow, lookbackDays: 90 }), ['WMT-OPEN', 'WMT-SHIPPED']);

console.log('PASS channel order status guards: do-not-ship recovery, Shopify cancellations, eBay modified polling, Walmart post-shipment sweep');
