const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repair = fs.readFileSync(path.join(__dirname, 'repair-temu-shipping-costs.cjs'), 'utf8');
const deploy = fs.readFileSync(path.join(__dirname, 'deploy-production.sh'), 'utf8');

assert.match(repair, /fulfillment_label_batch_rows/);
assert.match(repair, /batch_row\.shipment_id/);
assert.match(repair, /financial\.estimated_shipping_cost/);
assert.match(repair, /financial\.purchase_origin/);
assert.match(repair, /financial\.batch_id/);
assert.match(repair, /selectTemuShipmentCandidate/);
assert.match(repair, /actual_shipping_cost = totals\.actual_cost/);
assert.match(repair, /not like 'return_shipping%'/);
assert.match(deploy, /repair-temu-shipping-costs\.cjs --apply/);

console.log('Temu shipping-cost repair safeguards passed.');
