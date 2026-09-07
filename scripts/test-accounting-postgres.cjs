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
    const listing = await store.list({ query: '1001', status: 'posted', from: '2026-01-01', to: '2026-01-31' });
    assert.equal(listing.total, 1);
    assert.equal(listing.rows[0].orderId, 'one');
    assert.equal(listing.rows[0].description, 'Sale');
    assert.equal((await store.list({ query: '%_' })).total, 0);
    assert.equal((await store.list({ kind: 'batches', status: 'exported' })).total, 1);
    assert.equal((await store.list({ kind: 'batches', status: 'imported' })).total, 0);
    const batch = (await store.readOrder(order.id)).batches[0];
    await store.mutateOrder(order.id, state => l.confirmImport(state, batch.id, { reference: 'Confirmed test import' }, 'a'));
    assert.equal((await store.list({ kind: 'batches', status: 'imported' })).total, 1);
    assert.equal((await store.list({ kind: 'batches', status: 'exported' })).total, 0);
    await store.mutateOrder('two', state => {
      for (let index = 0; index < 53; index++) l.createDraft(state, { ...body, requestId: `pagination-test-${index}` }, 'a', { id: 'two', orderNumber: '1002', source: 'eBay' });
    });
    const first = await store.list(), second = await store.list({ page: 2 });
    assert.equal(first.total, 54); assert.equal(first.rows.length, 50); assert.equal(second.rows.length, 4);
    assert.equal(new Set([...first.rows, ...second.rows].map(row => row.id)).size, 54);
    assert.equal((await store.list({ query: 'ebay' })).total, 53);
    assert.equal((await store.list({ status: 'draft' })).total, 53);
    await store.mutateOrder('one', state => {
      state.observations.push(
        { id: 'old', key: 'one:label-cost', kind: 'Shipping label cost', amountMinor: null, certainty: 'unknown' },
        { id: 'new', key: 'one:label-cost', kind: 'Shipping label cost', amountMinor: 0, certainty: 'reported' },
        { id: 'missing', key: 'one:cogs', kind: 'Estimated product cost', amountMinor: null, certainty: 'unknown' },
        { id: 'pending', key: 'one:return:r1', kind: 'Buyer refund', amountMinor: 200, certainty: 'pending', returnId: 'r1' },
        { id: 'estimate', key: 'one:seller-net', kind: 'Net proceeds', amountMinor: 500, certainty: 'estimated' }
      );
    });
    const snapshot = JSON.stringify(await store.readOrder('one'));
    const overview = await store.overview();
    assert.equal(overview.draftCount, 53);
    assert.equal(overview.unconfirmedBatchCount, 0);
    assert.equal(overview.ledgerCount, 2);
    assert.equal(overview.capturedLedgerCount, 1);
    assert.equal(overview.missingCostCount, 1);
    assert.equal(overview.pendingRefundCount, 1);
    assert.equal(overview.estimatedCount, 1);
    assert.equal(overview.total, 3);
    assert.equal((await store.overview({ category: 'missing_cost' })).rows[0].id, 'missing');
    assert.equal(JSON.stringify(await store.readOrder('one')), snapshot);
    await assert.rejects(store.overview({ category: 'bad' }), /Invalid accounting/);
    await assert.rejects(store.overview({ page: 0 }), /Invalid page/);
    await store.mutateOrder('two', state => {
      for (let index = 0; index < 51; index++) state.observations.push({ id: `estimate-${index}`, key: `two:estimate-${index}`, kind: 'Estimate', certainty: 'estimated', amountMinor: index });
      state.batches.push({ id: 'pending-export', entries: [] });
    });
    const overviewFirst = await store.overview(), overviewSecond = await store.overview({ page: 2 });
    assert.equal(overviewFirst.unconfirmedBatchCount, 1);
    assert.equal(overviewFirst.total, 54);
    assert.equal(overviewFirst.rows.length, 50);
    assert.equal(overviewSecond.rows.length, 4);
    assert.equal(new Set([...overviewFirst.rows, ...overviewSecond.rows].map(row => `${row.orderId}:${row.id}`)).size, 54);
    assert.equal((await store.list({ from: '2026-02-01' })).total, 0);
    await assert.rejects(store.list({ page: -1 }), /Invalid page/);
    await assert.rejects(store.list({ kind: "journals'); drop table accounting_documents" }), /Invalid ledger/);
    await assert.rejects(store.list({ from: 'invalid' }), /Invalid date/);
    await assert.rejects(store.list({ from: '2026-02-01', to: '2026-01-01' }), /Start date/);
  } finally {
    await pool.end(); await admin.query(`drop schema ${schema} cascade`); await admin.end();
  }
});
