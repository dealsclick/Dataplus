const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { importProgress } = require('../lib/import-progress');
const connection = process.env.LEDGER_TEST_DATABASE_URL;
test('import dashboard filters and pagination retain safe date bounds without payload secrets', { skip: !connection }, async () => {
  const url = new URL(connection);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname.endsWith('_ledger_test'));
  const schema = `import_progress_test_${process.pid}`;
  const admin = new Pool({ connectionString: connection });
  await admin.query(`create schema ${schema}`);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = url.toString();
  const db = require('../db');
  try {
    await db.readOperationJobsPage({ importsOnly: true });
    for (let index = 0; index < 28; index++) {
      await db.upsertOperationJob({ id: `test-${index}`, operation: `Temu order import ${index}`, workerTask: index === 27 ? 'inventory-sync' : 'temu-order-import', status: index === 26 ? 'success' : 'running', startedAt: '2026-09-06T00:00:00Z', createdAt: '2026-09-06T00:00:00Z', message: 'Temu update window 2026-08-06 to 2026-08-12: 100 scanned, 90 new, 0 updated, 10 skipped.', workerPayload: { startDate: '2026-01-01', lookbackDays: 365, accessToken: 'must-not-leave-query' } });
    }
    const first = await db.readOperationJobsPage({ importsOnly: true, limit: 25 });
    const second = await db.readOperationJobsPage({ importsOnly: true, limit: 25, page: 2 });
    assert.equal(first.total, 27); assert.equal(first.jobs.length, 25); assert.equal(second.jobs.length, 2);
    assert.equal(new Set([...first.jobs, ...second.jobs].map(job => job.id)).size, 27);
    const running = first.jobs.find(job => job.status === 'running');
    assert.equal(importProgress(running).percent, 87);
    assert.equal(running.workerPayload.accessToken, undefined);
    assert.equal((await db.readOperationJobsPage({ importsOnly: true, activeOnly: true })).total, 26);
    assert.equal((await db.readOperationJobsPage({ importsOnly: true, query: 'not-found' })).total, 0);
  } finally {
    await db.closePool();
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
    await admin.query(`drop schema ${schema} cascade`); await admin.end();
  }
});
