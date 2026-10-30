const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalTrackingValue, trackingLookupCandidates } = require('../lib/tracking-barcode');
const { findReturnReceipts } = require('../lib/return-receiving-lookup');

assert(trackingLookupCandidates(']C11Z999AA10123456784').includes('1Z999AA10123456784'));
assert(trackingLookupCandidates('4209801994055118901234567890').includes('94055118901234567890'));
assert(trackingLookupCandidates('(00) 123456789012345678').includes('123456789012345678'));
assert(trackingLookupCandidates('ABCD').includes('ABCD'));
assert(trackingLookupCandidates('JJD000225478000123456').includes('JJD000225478000123456'));
assert(trackingLookupCandidates(']C1SPXBDL011972610090001070').includes('SPXBDL011972610090001070'));
assert(trackingLookupCandidates('https://www.ups.com/track?tracknum=1Z999AA10123456784').includes('1Z999AA10123456784'));
assert(trackingLookupCandidates('https://carrier.test/track/94055118901234567890').includes('94055118901234567890'));
assert.equal(canonicalTrackingValue(']C11Z999AA10123456784'), '1Z999AA10123456784');
assert.equal(canonicalTrackingValue('4209801994055118901234567890'), '94055118901234567890');
assert.equal(canonicalTrackingValue('4201234567899405511890123456789012'), '9405511890123456789012');
assert.equal(canonicalTrackingValue('(00) 123456789012345678'), '123456789012345678');
assert.equal(canonicalTrackingValue('https://www.ups.com/track?tracknum=1Z999AA10123456784'), '1Z999AA10123456784');

const returns = [
  { id: 'ret-1', returnNumber: 'RMA-1', returnTracking: [{ trackingNumber: '94055118901234567890' }] },
  { id: 'ret-2', returnNumber: 'RMA-2', returnLabel: { trackingNumber: '1Z999AA10123456784' } },
];
assert.deepEqual(findReturnReceipts(returns, '4209801994055118901234567890').map(row => row.id), ['ret-1']);
assert.deepEqual(findReturnReceipts(returns, ']C11Z999AA10123456784').map(row => row.id), ['ret-2']);
assert.deepEqual(findReturnReceipts(returns, 'RMA-1').map(row => row.id), ['ret-1']);

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
assert.match(serverSource, /parts\[2\] !== "tracking-lookup"[\s\S]*readOrderByKey\(parts\[2\]\)/, 'tracking lookup must bypass the generic order-detail route');
assert.match(serverSource, /url\.pathname === "\/api\/orders\/tracking-lookup"[\s\S]*readOrdersByTrackingCandidates\(candidates/, 'tracking lookup must resolve normalized candidates through the relational tracking index');
const returnReceivingSource = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'components', 'return-receiving.tsx'), 'utf8');
assert.match(returnReceivingSource, /TrackingCameraLookup[\s\S]*scope="returns"/, 'return receiving must use the shared tracking scanner');
assert.doesNotMatch(returnReceivingSource, /BrowserMultiFormatReader|decodeFromConstraints/, 'return receiving must not create a separate camera scanner');
const returnsWorkspaceSource = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'components', 'returns-workspace.tsx'), 'utf8');
assert.match(returnsWorkspaceSource, /TrackingCameraLookup scope="all" label="Scan tracking"/, 'the main returns toolbar must expose tracking scans for both returns and linked orders');
console.log('tracking barcode lookup tests passed');
