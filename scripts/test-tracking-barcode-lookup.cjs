const assert = require('node:assert/strict');
const { canonicalTrackingValue, trackingLookupCandidates } = require('../lib/tracking-barcode');
const { findReturnReceipts } = require('../lib/return-receiving-lookup');

assert(trackingLookupCandidates(']C11Z999AA10123456784').includes('1Z999AA10123456784'));
assert(trackingLookupCandidates('4209801994055118901234567890').includes('94055118901234567890'));
assert(trackingLookupCandidates('(00) 123456789012345678').includes('123456789012345678'));
assert(trackingLookupCandidates('ABCD').includes('ABCD'));
assert(trackingLookupCandidates('JJD000225478000123456').includes('JJD000225478000123456'));
assert.equal(canonicalTrackingValue(']C11Z999AA10123456784'), '1Z999AA10123456784');
assert.equal(canonicalTrackingValue('4209801994055118901234567890'), '94055118901234567890');
assert.equal(canonicalTrackingValue('4201234567899405511890123456789012'), '9405511890123456789012');
assert.equal(canonicalTrackingValue('(00) 123456789012345678'), '123456789012345678');

const returns = [
  { id: 'ret-1', returnNumber: 'RMA-1', returnTracking: [{ trackingNumber: '94055118901234567890' }] },
  { id: 'ret-2', returnNumber: 'RMA-2', returnLabel: { trackingNumber: '1Z999AA10123456784' } },
];
assert.deepEqual(findReturnReceipts(returns, '4209801994055118901234567890').map(row => row.id), ['ret-1']);
assert.deepEqual(findReturnReceipts(returns, ']C11Z999AA10123456784').map(row => row.id), ['ret-2']);
assert.deepEqual(findReturnReceipts(returns, 'RMA-1').map(row => row.id), ['ret-1']);
console.log('tracking barcode lookup tests passed');
