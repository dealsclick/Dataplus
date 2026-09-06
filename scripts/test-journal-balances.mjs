import test from 'node:test';
import assert from 'node:assert/strict';
import { journalBalances } from '../web/src/lib/journal-balances.ts';
test('draft balance preview uses exact currency precision and rejects invalid or two-sided lines', () => {
  assert.equal(journalBalances([{ debit: '0.10', credit: '' }, { debit: '0.20', credit: '' }, { debit: '', credit: '0.30' }], 2).balanced, true);
  assert.equal(journalBalances([{ debit: '1.001', credit: '' }, { debit: '', credit: '1' }], 2), null);
  assert.equal(journalBalances([{ debit: '1.234', credit: '' }, { debit: '', credit: '1.234' }], 3).balanced, true);
  assert.equal(journalBalances([{ debit: '1', credit: '1' }, { debit: '', credit: '' }], 2).balanced, false);
});
