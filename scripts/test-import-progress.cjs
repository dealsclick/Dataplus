const test = require('node:test');
const assert = require('node:assert/strict');
const { importProgress } = require('../lib/import-progress');
const job = { workerTask: 'temu-order-import', status: 'running', startedAt: '2026-09-06T00:00:00Z', workerPayload: { startDate: '2026-01-01', lookbackDays: 365 }, message: 'Temu update window 2026-08-06 to 2026-08-12: 28,152 scanned, 25,197 new, 0 updated, 2,955 skipped.', totalRows: 0 };
test('Temu unknown totals use completed date coverage, never order percentage', () => {
  const progress = importProgress(job);
  assert.equal(progress.basis, 'date_coverage'); assert.equal(progress.percent, 87);
  assert.equal(progress.scanned, 28152); assert.equal(progress.created, 25197); assert.equal(progress.skipped, 2955); assert.equal(progress.total, null);
  assert.equal(importProgress({ ...job, message: job.message.replace('2026-08-06', '2026-08-10') }).percent, 89);
});
test('date coverage honors lookback bounds, rejects missing range and does not advance with wall time', () => {
  assert.equal(importProgress({ ...job, workerPayload: {} }).percent, null);
  assert.equal(importProgress({ ...job, workerPayload: { ...job.workerPayload, forceLookback: false } }).percent, null);
  assert.equal(importProgress({ ...job, workerPayload: { ...job.workerPayload, lookbackDays: 7 } }).percent, 0);
  assert.equal(importProgress({ ...job, startedAt: 'invalid' }).percent, null);
  assert.equal(importProgress({ ...job, updatedAt: '2030-01-01' }).percent, 87);
});
test('unknown totals stay unknown; success alone reaches 100 and failures retain partial progress', () => {
  assert.equal(importProgress({ status: 'running', totalRows: 0 }).percent, null);
  assert.equal(importProgress({ status: 'running', totalRows: 100, processedRows: 20 }).percent, 20);
  assert.equal(importProgress({ status: 'running', totalRows: 100, processedRows: 120 }).percent, 99);
  assert.equal(importProgress({ status: 'success' }).percent, 100);
  assert.equal(importProgress({ status: 'warning' }).percent, null);
  assert.equal(importProgress({ status: 'warning', phase: 'complete' }).percent, 100);
  assert.equal(importProgress({ ...job, status: 'failed' }).percent, 87);
});
test('latest persisted counters take precedence over an older window message; missing does not mean skipped on other channels', () => {
  const progress = importProgress({ ...job, processedRows: 30000, created: 26000, changed: 26500, missingCount: 3500, errorCount: 4 });
  assert.equal(progress.scanned, 30000); assert.equal(progress.created, 26000); assert.equal(progress.updated, 500); assert.equal(progress.skipped, 3500); assert.equal(progress.errorCount, 4);
  assert.equal(importProgress({ workerTask: 'ebay-order-import', missingCount: 5 }).skipped, null);
});
