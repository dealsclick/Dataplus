const assert = require('assert');
const { exactEligibleOrderSourceProduct } = require('../server');

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

console.log('Order source recovery tests passed.');
