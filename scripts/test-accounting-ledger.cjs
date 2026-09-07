const test = require('node:test');
const assert = require('node:assert/strict');
const l = require('../lib/accounting-ledger');
const { accountingPermission, createAccountingHandler } = require('../lib/accounting-http');
const order = { id: 'order-1', orderNumber: '1001', source: 'Temu', currency: 'USD', shippingCost: '2.29', external: { amount: { parentOrderMap: { estimatedRevenue: { amount: 849, currency: 'USD' }, estimatedRevenueDeduction: { amount: 0, currency: 'USD' } } } } };
const input = (extra = {}) => ({ requestId: 'request-1001', date: '2026-01-02', currency: 'USD', description: 'Reviewed sale', evidence: 'Statement S-1, line 20', lines: [{ account: 'marketplace_clearing', debit: '8.49' }, { account: 'sales', credit: '5.50' }, { account: 'shipping_income', credit: '2.99' }], ...extra });
function config() { const result = l.defaultConfig(); result.destinations[0].mappings = Object.fromEntries(Object.keys(l.ACCOUNTS).map(key => [key, key])); return result; }
function posted() { const state = l.emptyLedger(order.id); const record = l.createDraft(state, input(), 'reviewer', order); l.post(state, record.id, { confirm: true }, 'manager', config()); return { state, record }; }

test('money uses integer minor units, honors currency precision, rejects invalid amounts', () => {
  assert.equal(l.minor('0.10', 'USD') + l.minor('0.20', 'USD'), 30);
  assert.equal(l.minor('123', 'JPY'), 123);
  assert.equal(l.minor('1.234', 'KWD'), 1234);
  for (const value of ['-1', '1.001', '1e3', 'NaN', '', null, '99999999999999999999999']) assert.throws(() => l.minor(value));
  assert.throws(() => l.minor('1', 'XYZ'));
  assert.equal(l.decimal(299, 'USD'), '2.99');
});
test('journal lines balance and cannot use unknown accounts or mixed debit/credit lines', () => {
  assert.equal(l.validateLines(input().lines, 'USD').length, 3);
  assert.throws(() => l.validateLines([{ account: 'bank', debit: 1 }, { account: 'sales', credit: 2 }], 'USD'), /balance/);
  assert.throws(() => l.validateLines([{ account: 'bank', debit: 1, credit: 1 }, { account: 'sales', credit: 1 }], 'USD'));
  assert.throws(() => l.validateLines([{ account: 'constructor', debit: 1 }, { account: 'sales', credit: 1 }], 'USD'));
});
test('Temu snapshots preserve buyer vs seller amounts; missing stays unknown and no posting occurs', () => {
  const state = l.emptyLedger(order.id);
  const returned = { id: 'return-1', channelReturnId: 'CASE', external: { detail: { parentAfterSalesStatus: 5, refundSummary: { buyerTotalRefund: { amount: 2238, currency: 'USD' } } } } };
  l.observe(state, order, [returned], 'import');
  assert.equal(state.journals.length, 0);
  assert.equal(state.observations.find(row => row.returnId)?.amountMinor, 2238);
  assert.equal(state.observations.find(row => row.key.endsWith('seller-deduction')).amountMinor, 0);
  assert.equal(state.observations.find(row => row.key.endsWith('cogs')).amountMinor, null);
  assert.equal(l.observe(state, order, [returned], 'import').added, 0);
});
test('source changes append history, including values reverting to an older value and missing records', () => {
  const state = l.emptyLedger(order.id);
  l.observe(state, order, [], 'a');
  l.observe(state, { ...order, shippingCost: '3.00' }, [], 'a');
  l.observe(state, order, [], 'a');
  assert.equal(state.observations.filter(row => row.key.endsWith('label-cost')).length, 3);
  const shop = { id: 's', source: 'Shopify', total: '1', payments: [{ id: 'p1', status: 'success', amount: '1' }] };
  const other = l.emptyLedger('s'); l.observe(other, shop, [], 'a'); l.observe(other, { ...shop, payments: [] }, [], 'a');
  assert.equal(other.observations.findLast(row => row.key.endsWith('payment:p1')).certainty, 'unknown');
});
test('posting requires evidence, explicit review, an open date and no pending/stale sources', () => {
  const state = l.emptyLedger(order.id);
  assert.throws(() => l.createDraft(state, input({ evidence: '' }), 'a', order));
  assert.throws(() => l.createDraft(state, input({ date: '2026-02-30' }), 'a', order));
  l.observe(state, order, [], 'a');
  const source = state.observations.find(row => row.key.endsWith('label-cost'));
  const draft = l.createDraft(state, input({ sourceIds: [source.id] }), 'a', order);
  assert.throws(() => l.post(state, draft.id, {}, 'a', config()), /Confirm/);
  assert.throws(() => l.post(state, draft.id, { confirm: true }, 'a', { ...config(), closedThrough: '2026-02-01' }), /closed/);
  l.observe(state, { ...order, shippingCost: '3.00' }, [], 'a');
  assert.throws(() => l.post(state, draft.id, { confirm: true }, 'a', config()), /source changed/);
  const missing = state.observations.find(row => row.certainty === 'unknown');
  const bad = l.createDraft(state, input({ requestId: 'request-1002', sourceIds: [missing.id] }), 'a', order);
  assert.throws(() => l.post(state, bad.id, { confirm: true }, 'a', config()), /unknown/);
});
test('draft and export retries are idempotent; changed payloads cannot reuse request IDs', () => {
  const { state, record } = posted();
  assert.equal(l.createDraft(state, input(), 'a', order).id, record.id);
  assert.throws(() => l.createDraft(state, input({ description: 'different' }), 'a', order), /Request ID/);
  const body = { requestId: 'export-1001', destinationId: 'general', journalIds: [record.id] };
  const batch = l.exportBatch(state, body, 'a', config());
  assert.equal(l.exportBatch(state, body, 'a', config()).id, batch.id);
  assert.throws(() => l.exportBatch(state, { ...body, requestId: 'export-1002' }, 'a', config()), /already exported/);
  assert.equal(state.batches.length, 1);
});
test('immutable entries reverse without rewriting original history; reversals export separately', () => {
  const { state, record } = posted(), original = JSON.stringify(record);
  assert.throws(() => l.discard(state, record.id, 'a'), /immutable/);
  l.exportBatch(state, { requestId: 'export-1001', destinationId: 'general', journalIds: [record.id] }, 'a', config());
  const reverse = l.reverse(state, record.id, { requestId: 'reverse-1001', date: '2026-01-03', reason: 'Correction', confirm: true }, 'a', config());
  assert.equal(JSON.stringify(record), original);
  assert.equal(reverse.lines[0].creditMinor, 849);
  assert.equal(l.reverse(state, record.id, { requestId: 'reverse-1002' }, 'a', config()).id, reverse.id);
  assert.equal(l.exportBatch(state, { requestId: 'export-1002', destinationId: 'general', journalIds: [reverse.id] }, 'a', config()).entries.length, 1);
});
test('export snapshots account mappings and records confirmation separately from export', () => {
  const { state, record } = posted();
  assert.throws(() => l.exportBatch(state, { requestId: 'export-1001', destinationId: 'general', journalIds: [record.id] }, 'a', l.defaultConfig()), /Map all/);
  const cfg = config(); cfg.destinations[0].mappings.sales = '=HYPERLINK("bad")';
  const batch = l.exportBatch(state, { requestId: 'export-1001', destinationId: 'general', journalIds: [record.id] }, 'a', cfg);
  const csv = l.batchCsv(batch);
  assert.ok(csv.includes("'=HYPERLINK"));
  cfg.destinations[0].mappings.sales = 'Changed';
  assert.equal(l.batchCsv(batch), csv);
  assert.equal(batch.importedAt, undefined);
  l.confirmImport(state, batch.id, { reference: 'QBO-TEST' }, 'a');
  assert.equal(batch.importReference, 'QBO-TEST');
  assert.equal(l.batchCsv(batch), csv);
});
test('configuration has optimistic concurrency, persistent destination IDs and closed period protection', () => {
  const cfg = config();
  const next = l.updateConfig(cfg, { ...cfg, closedThrough: '2026-01-01' }, 'a');
  assert.equal(next.version, 1);
  assert.throws(() => l.updateConfig(next, cfg, 'a'), /changed/);
  assert.throws(() => l.updateConfig(next, { ...next, closedThrough: '' }, 'a'), /reopened/);
  assert.throws(() => l.updateConfig(next, { ...next, destinations: [{ id: 'other', name: 'New' }] }, 'a'), /Keep existing/);
});
test('duplicate source postings require an explicit adjustment; cross-order source references are rejected', () => {
  const state = l.emptyLedger(order.id); l.observe(state, order, [], 'a');
  const source = state.observations.find(row => row.key.endsWith('label-cost'));
  const first = l.createDraft(state, input({ sourceIds: [source.id] }), 'a', order); l.post(state, first.id, { confirm: true }, 'a', config());
  const second = l.createDraft(state, input({ requestId: 'request-1002', sourceIds: [source.id] }), 'a', order);
  assert.throws(() => l.post(state, second.id, { confirm: true }, 'a', config()), /already has/);
  const correction = l.createDraft(state, input({ requestId: 'request-1003', sourceIds: [source.id], adjusts: first.id }), 'a', order);
  assert.equal(l.post(state, correction.id, { confirm: true }, 'a', config()).status, 'posted');
  assert.throws(() => l.createDraft(state, input({ requestId: 'request-1004', sourceIds: ['other-order'] }), 'a', order));
});
test('accounting endpoints separate view, post, reversal, export and configuration permissions', async () => {
  assert.equal(accountingPermission('GET', '/api/accounting/orders/1'), 'view');
  assert.equal(accountingPermission('POST', '/api/accounting/orders/1/journals/j/post'), 'post');
  assert.equal(accountingPermission('POST', '/api/accounting/orders/1/journals/j/reverse'), 'reverse');
  assert.equal(accountingPermission('GET', '/api/accounting/orders/1/exports/b.csv'), 'export');
  assert.equal(accountingPermission('PUT', '/api/accounting/settings'), 'configure');
  let called = false, status;
  const handler = createAccountingHandler({ store: {}, can: () => false, readOrder: () => { called = true; }, sendJson: (_, code) => { status = code; } });
  await handler({ method: 'POST' }, {}, new URL('http://test/api/accounting/orders/1/journals/j/post'), { id: 'reader' });
  assert.equal(status, 403); assert.equal(called, false);
});

test('mixed source currencies remain unknown; aggregate and authorization records cannot be posted', () => {
  const state = l.emptyLedger('shopify');
  const source = { id: 'shopify', source: 'Shopify', currency: 'USD', total: 10, payments: [{ id: 'fx', currency: 'EUR', amount: 10, status: 'success' }, { id: 'auth', amount: 10, status: 'success', kind: 'authorization' }] };
  l.observe(state, source, [], 'a');
  assert.equal(state.observations.find(row => row.key.endsWith('payment:fx')).certainty, 'unknown');
  const auth = state.observations.find(row => row.key.endsWith('payment:auth'));
  const draft = l.createDraft(state, input({ sourceIds: [auth.id] }), 'a', source);
  assert.throws(() => l.post(state, draft.id, { confirm: true }, 'a', config()), /reference-only/);
});
test('an unexported original and its reversal must travel together to each destination', () => {
  const { state, record } = posted();
  const reversal = l.reverse(state, record.id, { requestId: 'reverse-1001', date: '2026-01-03', reason: 'test', confirm: true }, 'a', config());
  assert.throws(() => l.exportBatch(state, { requestId: 'export-1001', destinationId: 'general', journalIds: [record.id] }, 'a', config()), /Include the reversal/);
  assert.throws(() => l.exportBatch(state, { requestId: 'export-1002', destinationId: 'general', journalIds: [reversal.id] }, 'a', config()), /original journal/);
  assert.equal(l.exportBatch(state, { requestId: 'export-1003', destinationId: 'general', journalIds: [record.id, reversal.id] }, 'a', config()).entries.length, 2);
});
test('return journals can link a known return without treating buyer refund snapshots as seller debits', () => {
  const state = l.emptyLedger(order.id);
  l.observe(state, order, [{ id: 'r1', external: {} }], 'a');
  const draft = l.createDraft(state, input({ returnId: 'r1' }), 'a', order);
  assert.equal(l.post(state, draft.id, { confirm: true }, 'a', config()).returnId, 'r1');
  assert.throws(() => l.createDraft(state, input({ requestId: 'other-1001', returnId: 'other-order-return' }), 'a', order), /belong/);
});

test('retained export batches remain downloadable after the original source order is removed', async () => {
  const { state, record } = posted(), cfg = config();
  const batch = l.exportBatch(state, { requestId: 'export-1001', destinationId: 'general', journalIds: [record.id] }, 'a', cfg);
  let csv;
  const handler = createAccountingHandler({ store: { readOrder: async () => state, readConfig: async () => cfg }, readOrder: async () => null, can: () => true, sendJson: (_, status) => assert.fail(`Unexpected status ${status}`), sendCsv: (_, value) => { csv = value; } });
  await handler({ method: 'GET' }, {}, new URL(`http://test/api/accounting/orders/order-1/exports/${batch.id}.csv`), { id: 'a' });
  assert.equal(csv, l.batchCsv(batch));
});

test('overview requires view permission and reads only accounting summaries', async () => {
  let called = false, response;
  const options = {
    store: { overview: async args => { called = true; assert.deepEqual(args, { category: 'missing_cost', page: 2 }); return { total: 1 }; } },
    readOrder: () => assert.fail('Overview must not read orders'),
    can: () => false, sendJson: (_, status, body) => { response = { status, body }; },
  };
  const url = new URL('http://test/api/accounting/overview?category=missing_cost&page=2');
  await createAccountingHandler(options)({ method: 'GET' }, {}, url, { id: 'a' });
  assert.equal(response.status, 403); assert.equal(called, false);
  await createAccountingHandler({ ...options, can: (_, area, action) => area === 'orders.accounting' && action === 'view' })({ method: 'GET' }, {}, url, { id: 'a' });
  assert.equal(response.status, 200); assert.equal(response.body.total, 1);
});
