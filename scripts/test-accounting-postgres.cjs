const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { createAccountingStore } = require('../lib/accounting-store');
const l = require('../lib/accounting-ledger');
const connectionString = process.env.LEDGER_TEST_DATABASE_URL;

test('PostgreSQL ledger locks, rollback, restart persistence and export concurrency', { skip: !connectionString }, async () => {
  const url = new URL(connectionString);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname.endsWith('_ledger_test'), 'Use an isolated local ledger test database only.');
  const schema = `ledger_test_${process.pid}`;
  const admin = new Pool({ connectionString });
  await admin.query(`create schema ${schema}`);
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}`, max: 10 });
  try {
    await pool.query("create table accounting_documents (doc_key text primary key, data jsonb not null, updated_at timestamptz not null default now())");
    const store = createAccountingStore(() => pool), order = { id: 'one', orderNumber: '1001', source: 'Temu' };
    const body = { requestId: 'concurrent-create', date: '2026-01-02', currency: 'USD', description: 'Sale', evidence: 'Test statement', lines: [{ account: 'bank', debit: '10' }, { account: 'sales', credit: '10' }] };
    const results = await Promise.all(Array.from({ length: 6 }, () => store.mutateOrder(order.id, state => l.createDraft(state, body, 'a', order))));
    assert.equal(new Set(results.map(row => row.id)).size, 1);
    assert.equal((await store.readOrder(order.id)).journals.length, 1);
    const entryId = results[0].id;
    await assert.rejects(store.mutateOrder(order.id, state => { state.journals = []; throw new Error('rollback'); }), /rollback/);
    assert.equal((await store.readOrder(order.id)).journals.length, 1);
    await store.mutateOrder(order.id, (state, config) => l.post(state, entryId, { confirm: true }, 'reviewer', config));
    await store.mutateConfig(config => l.updateConfig(config, { ...config, destinations: [{ id: 'general', name: 'Test export', mappings: { bank: '1000', sales: '4000' } }] }, 'manager'));
    const exports = await Promise.allSettled([1, 2].map(index => store.mutateOrder(order.id, (state, config) => l.exportBatch(state, { requestId: `export-test-${index}`, destinationId: 'general', journalIds: [entryId] }, 'exporter', config))));
    assert.equal(exports.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(exports.filter(row => row.status === 'rejected').length, 1);
    assert.equal((await store.readOrder(order.id)).batches.length, 1);
    const reopenedStore = createAccountingStore(() => pool);
    assert.equal((await reopenedStore.readOrder(order.id)).journals[0].status, 'posted');
    assert.equal((await reopenedStore.readConfig()).version, 1);
    const before = JSON.stringify(await store.readOrder(order.id));
    await assert.rejects(store.mutateOrder(order.id, (state, config) => { l.reverse(state, entryId, { requestId: 'reverse-test', date: '2026-01-03', reason: 'test', confirm: true }, 'a', config); throw new Error('rollback reversal'); }));
    assert.equal(JSON.stringify(await store.readOrder(order.id)), before);
  } finally {
    await pool.end(); await admin.query(`drop schema ${schema} cascade`); await admin.end();
  }
});
