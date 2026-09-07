import test from 'node:test';
import assert from 'node:assert/strict';
import { accountingDateBounds as bounds, accountingStatusLabel } from '../web/src/lib/accounting-filters.ts';
test('accounting defaults do not hide historical unfinished work', () => {
  assert.deepEqual(bounds('all'), { from: '', to: '' });
  assert.equal(accountingStatusLabel('draft'), 'Awaiting review');
  assert.equal(accountingStatusLabel('exported'), 'Awaiting import confirmation');
});
test('rolling ranges use inclusive local calendar days across year and DST boundaries', () => {
  assert.deepEqual(bounds('last7', new Date(2026, 0, 3)), { from: '2025-12-28', to: '2026-01-03' });
  assert.deepEqual(bounds('last30', new Date(2026, 2, 10)), { from: '2026-02-09', to: '2026-03-10' });
  assert.deepEqual(bounds('today', new Date(2026, 8, 7, 23, 59)), { from: '2026-09-07', to: '2026-09-07' });
});
test('quarter and year presets include leap days and previous-year quarters', () => {
  assert.deepEqual(bounds('lastQuarter', new Date(2026, 0, 7)), { from: '2025-10-01', to: '2025-12-31' });
  assert.deepEqual(bounds('lastQuarter', new Date(2024, 3, 1)), { from: '2024-01-01', to: '2024-03-31' });
  assert.deepEqual(bounds('ytd', new Date(2024, 1, 29)), { from: '2024-01-01', to: '2024-02-29' });
  assert.deepEqual(bounds('thisQuarter', new Date(2026, 8, 7)), { from: '2026-07-01', to: '2026-09-07' });
  assert.deepEqual(bounds('lastYear', new Date(2026, 8, 7)), { from: '2025-01-01', to: '2025-12-31' });
});
