const assert = require('node:assert/strict');
const { evaluateFulfillmentIntervention: orderFulfillmentIntervention } = require('../lib/fulfillment-intervention');

const ago = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
const pendingRoute = { id: 'route-1', type: 'warehouse', status: 'allocated', qty: 1 };

assert.equal(orderFulfillmentIntervention({
  id: 'old-canceled',
  status: 'canceled',
  updatedAt: ago(13),
  fulfillmentRoutes: [pendingRoute],
  shipments: []
}), null, 'historical cancellations without tracking must not remain actionable');

assert.equal(orderFulfillmentIntervention({
  id: 'recent-canceled',
  status: 'canceled',
  cancelledAt: ago(1),
  fulfillmentRoutes: [pendingRoute],
  shipments: []
})?.kind, 'do_not_ship', 'recent cancellations with pending fulfillment work must be stopped');

assert.equal(orderFulfillmentIntervention({
  id: 'old-canceled-reimported',
  status: 'canceled',
  updatedAt: ago(0.1),
  orderDate: ago(13),
  fulfillmentRoutes: [pendingRoute],
  shipments: []
}), null, 'a routine reimport must not make an old cancellation actionable');

assert.equal(orderFulfillmentIntervention({
  id: 'recent-refund-in-transit',
  status: 'refunded',
  financialStatus: 'refunded',
  paidAmount: 25,
  refundedAt: ago(0.25),
  fulfillmentRoutes: [{ ...pendingRoute, status: 'shipped' }],
  shipments: [{ trackingNumber: 'TRACK1', trackingStatus: 'in_transit', shippedAt: ago(1) }]
})?.kind, 'recovery_required', 'recent paid refunds with carrier movement must require recovery');

assert.equal(orderFulfillmentIntervention({
  id: 'old-refund-in-transit',
  status: 'refunded',
  financialStatus: 'refunded',
  paidAmount: 25,
  refundedAt: ago(5),
  fulfillmentRoutes: [{ ...pendingRoute, status: 'shipped' }],
  shipments: [{ trackingNumber: 'TRACK2', trackingStatus: 'in_transit', shippedAt: ago(5) }]
})?.kind, 'recovery_required', 'an unresolved paid shipment remains recoverable while it is moving');

assert.equal(orderFulfillmentIntervention({
  id: 'unpaid-refund-in-transit',
  status: 'refunded',
  financialStatus: 'refunded',
  paidAmount: 0,
  total: 25,
  refundedAt: ago(0.25),
  fulfillmentRoutes: [{ ...pendingRoute, status: 'shipped' }],
  shipments: [{ trackingNumber: 'TRACK3', trackingStatus: 'in_transit', shippedAt: ago(1) }]
}), null, 'recovery requires evidence that the order was paid');

const legacyCanceledInTransit = orderFulfillmentIntervention({
  id: 'legacy-canceled-in-transit',
  status: 'canceled',
  financialStatus: 'voided',
  paidAmount: 240.99,
  shipments: [{ trackingNumber: '9234690238203611179932', status: 'fulfilled', shipDate: ago(9) }]
});
assert.equal(legacyCanceledInTransit?.kind, 'recovery_required', 'a paid canceled order with fulfilled tracking evidence requires recovery even when legacy imports omitted movement timestamps');
assert.equal(legacyCanceledInTransit?.reasonCode, 'canceled_after_shipment');

assert.equal(orderFulfillmentIntervention({
  id: 'historical-canceled-shipment',
  status: 'canceled',
  paidAmount: 25,
  shipments: [{ trackingNumber: 'OLD-TRACK', status: 'fulfilled', shippedAt: ago(45) }]
}), null, 'historical shipped cancellations do not flood the active recovery queue');

console.log('Fulfillment intervention window checks passed.');
