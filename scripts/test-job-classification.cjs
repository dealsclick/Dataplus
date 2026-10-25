const test = require('node:test');
const assert = require('node:assert/strict');
const {
  operationJobChannel,
  operationJobChannelKey,
  operationJobTrigger,
} = require('../lib/job-classification');

test('job classification identifies marketplace channels from stable job metadata', () => {
  assert.equal(operationJobChannel({ workerTask: 'ebay-listing-launch' }), 'eBay');
  assert.equal(operationJobChannel({ workerPayload: { channelId: 'walmart-us' } }), 'Walmart');
  assert.equal(operationJobChannel({ operation: 'Shopify order reconciliation' }), 'Shopify');
  assert.equal(operationJobChannelKey({ fileName: 'temu-settlement.xlsx' }), 'temu');
  assert.equal(operationJobChannel({ operation: 'Universal datadump import' }), 'Internal');
});

test('job classification separates operator work from automated work', () => {
  assert.equal(operationJobTrigger({ operation: 'eBay listing launch', workerPayload: { actor: 'luis' } }), 'manual');
  assert.equal(operationJobTrigger({ operation: 'Scheduled eBay order import' }), 'automated');
  assert.equal(operationJobTrigger({ workerPayload: { scheduled: true, scheduleKey: 'ebay-orders' } }), 'automated');
  assert.equal(operationJobTrigger({ workerPayload: { actor: 'system:inventory', trigger: 'system' } }), 'automated');
  assert.equal(operationJobTrigger({ jobTrigger: 'manual', workerPayload: { scheduled: true } }), 'manual');
});
