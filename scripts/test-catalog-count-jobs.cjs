const assert = require('node:assert/strict');
const { createCatalogCountJobs } = require('../lib/catalog-count-jobs');
const { boundedCatalogCount } = require('../lib/catalog-count');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function main() {
  let time = 0, calls = 0, finish;
  const jobs = createCatalogCountJobs({ capacity: 2, ttlMs: 100, now: () => time });
  const run = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  assert.equal(jobs.request('a', run).countStatus, 'running');
  jobs.request('a', run); await tick(); assert.equal(calls, 1);
  assert.equal(jobs.request('b', async () => ({ totalKnown: true, total: 0 })).countStatus, 'queued');
  assert.equal(jobs.request('c', run).countStatus, 'busy');
  finish({ totalKnown: true, total: 13, totalQty: 42 }); await tick(); await tick();
  assert.equal(jobs.request('a', run).total, 13);
  assert.equal(jobs.request('b', run).total, 0);
  time = 101;
  jobs.request('a', async () => ({ totalKnown: false })); await tick();
  assert.equal(jobs.request('a', run).countStatus, 'failed');
  jobs.request('a', async () => ({ totalKnown: true, total: 14 }), { retry: true }); await tick();
  assert.equal(jobs.request('a', run).total, 14);
  const sql = [];
  const pool = { connect: async () => ({ query: async query => { sql.push(query); return { rows: [{ total: 2 }] }; }, release() {} }) };
  await boundedCatalogCount(pool, 'count', [], { background: true });
  assert(sql.includes("set local statement_timeout = '120000ms'"));
  console.log('PASS catalog count deduplication, concurrency, capacity, zero, expiry, retry and bounded background timeout');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
