const assert = require('assert');
const { exactEligibleOrderSourceProduct, routingSupplierOffers } = require('../server');

const enabledDib = [{
  name: 'Do It Best',
  code: 'DIB',
  status: 'active',
  catalogSettings: { enabled: true, sourceCodes: ['DIB'] }
}];

const rows = [
  { sku: 'BUS51173DIB', supplier: 'Do It Best', supplierCode: 'DIB', active: true, title: 'Raindrip tubing' },
  { sku: 'BUSPPG51173MAR', vendorSku: '51173', supplier: 'Marcone', supplierCode: 'MAR', active: true, title: 'Unrelated vendor SKU' }
];

const exact = exactEligibleOrderSourceProduct(rows, 'BUS51173DIB', enabledDib);
assert.equal(exact?.sku, 'BUS51173DIB', 'exact source SKU should be selected');
assert.equal(exact?.supplierCode, 'DIB', 'selected source should retain its supplier');

assert.equal(
  exactEligibleOrderSourceProduct(rows, 'BUS51173DIB', [{ ...enabledDib[0], catalogSettings: { enabled: false, sourceCodes: ['DIB'] } }]),
  null,
  'excluded suppliers must not be promoted during order routing'
);

assert.equal(
  exactEligibleOrderSourceProduct([{ ...rows[0], active: false }], 'BUS51173DIB', enabledDib),
  null,
  'inactive source products must not be promoted'
);

assert.equal(
  exactEligibleOrderSourceProduct([{ ...rows[0], toBeDiscontinued: true }], 'BUS51173DIB', enabledDib),
  null,
  'discontinued source products must not be promoted'
);

const routedOffers = routingSupplierOffers({
  vendors: [
    { id: 'true-value', name: 'True Value', status: 'active' },
    { id: 'do-it-best', name: 'Do It Best', status: 'active' }
  ]
}, {
  sku: 'BUS717345TRV',
  vendorId: 'true-value',
  vendorSku: '717345',
  supplier: 'True Value',
  stockQty: 10,
  cost: 4.25,
  sourceCatalogMatches: [
    { vendorId: 'DIB', supplier: 'Do It Best', sourceSku: 'BUS51173DIB', vendorSku: '51173', qty: 630, cost: 3.728 }
  ]
}, {
  sku: 'BUS717345TRV',
  originalSku: 'BUS51173DIB',
  mappedFromSku: 'BUS51173DIB'
});
assert.equal(routedOffers[0]?.vendorName, 'Do It Best', 'the exact order source SKU should prefer its linked supplier');
assert.equal(routedOffers[0]?.vendorSku, '51173');
assert.equal(routedOffers[0]?.matchMethod, 'order_source_sku');

console.log('Order source recovery tests passed.');
