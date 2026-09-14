const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8').replace(/\r\n/g, '\n');
function extract(name, next) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`\nasync function ${next}(`, start);
  assert(start >= 0 && end > start);
  return source.slice(start, end);
}
for (const [name, runner] of [['scheduleChannelCategoryMappingJob', 'runChannelCategoryMappingJob'], ['scheduleBulkCategoryMappingRefreshJob', 'runBulkCategoryMappingRefreshJob']]) {
  for (const enabled of [true, false]) {
    let timers = 0;
    vm.runInNewContext(`${extract(name, runner)}\n${name}('test', {});`, {
      postgres: { isPostgresEnabled: () => enabled },
      categoryMappingRefreshOptions: () => ({}), Date,
      categoryMappingJobTimers: new Map(), bulkCategoryMappingJobTimers: new Map(),
      setTimeout: () => { timers++; return {}; }, clearTimeout: () => {}
    });
    assert.equal(timers, enabled ? 0 : 1, `${name}: PostgreSQL must never start a web timer`);
  }
}
const worker = fs.readFileSync(path.join(__dirname, 'dataplus-worker.js'), 'utf8');
for (const task of ['category-mapping-refresh', 'category-mapping-bulk-refresh']) {
  assert(worker.includes(`"${task}",`));
  assert(worker.includes(`job.workerTask === "${task}"`));
}
const database = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
const claim = database.slice(database.indexOf('async function claimQueuedOperationJob('), database.indexOf('async function claimQueuedOperationJob(') + 4000);
assert(claim.includes("raw ->> 'scheduledFor'"));
assert(claim.includes("now() at time zone 'UTC'"));
assert(source.includes('if (!await categoryRefreshMayContinue(jobId)) return;'));
console.log('Category refresh worker scheduling tests passed.');
