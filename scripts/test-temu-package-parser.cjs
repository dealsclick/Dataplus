const assert = require('node:assert/strict');
const { temuPackageRows } = require('../server');

const nested = {
  result: {
    result: {
      packages: [
        { packageSn: 'PKG-1', trackingNumber: 'TRACK-1', carrierName: 'USPS' },
        { packageSn: 'PKG-1', trackingNumber: 'TRACK-1', carrierName: 'USPS' },
        { wrapper: { packageSn: 'PKG-2', waybillNo: 'TRACK-2', shippingCompanyName: 'UPS' } }
      ]
    }
  }
};

const rows = temuPackageRows(nested);
assert.equal(rows.length, 2, 'nested package rows should be found once');
assert.deepEqual(rows.map((row) => row.packageSn).sort(), ['PKG-1', 'PKG-2']);

const large = { packages: Array.from({ length: 10_000 }, (_, index) => ({
  packageSn: `PKG-${index}`,
  trackingNumber: `TRACK-${index}`,
  payload: { notes: 'x'.repeat(128) }
})) };
const startedAt = Date.now();
const bounded = temuPackageRows(large);
assert.equal(bounded.length, 500, 'package row traversal must enforce its result limit');
assert.ok(Date.now() - startedAt < 2_000, 'package row traversal should remain linear and fast');

console.log('Temu package parser checks passed.');
