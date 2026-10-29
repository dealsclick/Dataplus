const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const helper = server.slice(
  server.indexOf('async function readChannelJobQueueState('),
  server.indexOf('async function queueTemuReturnImportJob(')
);

assert.match(helper, /skipOperationJobs: true/);
assert.match(helper, /skipOrders: true/);
assert.match(helper, /skipPurchaseOrders: true/);
assert.match(helper, /stateFieldsOnly: true/);

const routes = server.slice(
  server.indexOf('if (req.method === "POST" && url.pathname === "/api/temu/returns/import" && postgres.isPostgresEnabled())'),
  server.indexOf('if (req.method === "POST" && url.pathname === "/api/ebay/price-inventory/sync" && postgres.isPostgresEnabled())')
);
assert.equal((routes.match(/await readChannelJobQueueState\(\)/g) || []).length, 3);
const database = fs.readFileSync(path.join(__dirname, '../db.js'), 'utf8');

for (const workerName of [
  'runTemuReturnImportWorkerJob',
  'runShopifyReturnImportWorkerJob',
  'runEbayReturnImportWorkerJob'
]) {
  const start = server.indexOf(`async function ${workerName}(`);
  assert.ok(start >= 0, `${workerName} is present`);
  const next = server.indexOf('\nasync function ', start + 1);
  const worker = server.slice(start, next < 0 ? server.length : next);
  assert.match(worker, /readChannelJobQueueState\(\)/, `${workerName} uses lightweight channel state`);
}

const ebayReturnImportStart = server.indexOf('async function importEbayReturns(');
const ebayReturnImportEnd = server.indexOf('\nfunction parseList(', ebayReturnImportStart);
const ebayReturnImport = server.slice(ebayReturnImportStart, ebayReturnImportEnd);
assert.doesNotMatch(ebayReturnImport, /readStateField\("returns"\)/);
assert.match(ebayReturnImport, /postgres\.readImportedReturn\("eBay", returnId\)/);
assert.match(database, /async function readImportedReturn\(/);
assert.match(database, /readImportedReturn,/);
assert.match(database, /entity_documents_returns_number_uidx/);
const workspaceQuery = database.slice(database.indexOf('async function listReturnsWorkspace('), database.indexOf('async function saveOrder('));
assert.match(workspaceQuery, /count\(\*\) over\(\)::int as filtered_total/);
assert.doesNotMatch(workspaceQuery, /lower\(data::text\) like/);

const externalWorker = fs.readFileSync(path.join(__dirname, 'dataplus-worker.js'), 'utf8');
assert.match(externalWorker, /async function checkScheduledEbayReturnImport\(/);
assert.match(externalWorker, /queueEbayReturnImportJob\(stateDb/);
assert.match(externalWorker, /async function checkScheduledTemuReturnImport\(/);
assert.match(externalWorker, /queueTemuReturnImportJob\(stateDb/);
assert.match(externalWorker, /await checkScheduledEbayReturnImport\(\)/);
assert.match(externalWorker, /await checkScheduledTemuReturnImport\(\)/);
assert.match(server, /queueTemuReturnImportJob,/);
assert.match(server, /async function queueWalmartReturnImportJob\(options = \{\}\)/);
assert.match(server, /end - start > 730 \* 86400000/);
assert.match(server, /queueWalmartReturnImportJob,/);
assert.match(database, /"channelEbayReturnImportSchedules"/);
assert.match(database, /"channelTemuReturnImportSchedules"/);

console.log('PASS return imports queue and run without loading operational order state');
