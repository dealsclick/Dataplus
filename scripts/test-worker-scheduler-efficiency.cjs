const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'dataplus-worker.js'), 'utf8');

assert.match(source, /async function readSchedulerState[\s\S]*postgres\.readStateFields/);

for (const name of [
  'checkScheduledShopifyInventoryUpdate',
  'checkScheduledShopifySkuPairAudit',
  'checkScheduledShopifyOrderImport',
  'checkScheduledEbayOrderImport',
  'checkScheduledEbayCatalogSync',
  'checkScheduledEbayPriceInventorySync'
]) {
  const start = source.indexOf(`async function ${name}`);
  const end = source.indexOf('\nasync function ', start + 1);
  const body = source.slice(start, end < 0 ? source.length : end);
  assert(start >= 0, `${name} must exist`);
  assert.doesNotMatch(body, /readDbFast\(/, `${name} must not hydrate the full operational database`);
  assert.match(body, /readSchedulerState\(/, `${name} must use the lightweight scheduler state reader`);
}

const temuStart = source.indexOf('async function checkScheduledTemuOrderImport');
const temuEnd = source.indexOf('\nasync function ', temuStart + 1);
const temuBody = source.slice(temuStart, temuEnd);
assert.doesNotMatch(temuBody, /readDbFast\(/, 'Temu schedule checks must not hydrate the full operational database');
assert.match(temuBody, /hasActiveOperationTask\(/, 'Temu must check for an active import before loading order rows');
assert.match(temuBody, /mode === 'status'[\s\S]*postgres\.listOrders/, 'Temu may load orders only for a due status sweep');

console.log('Worker scheduler efficiency checks passed.');
