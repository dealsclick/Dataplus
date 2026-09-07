import test from 'node:test';
import assert from 'node:assert/strict';
import { accountingReadiness } from '../web/src/lib/accounting-readiness.ts';

const source = (overrides = {}) => ({ id: 'one', key: 'order:label-cost', kind: 'Shipping label cost', amountMinor: null, certainty: 'unknown', capturedAt: '2026-09-06T12:00:00Z', ...overrides });
test('missing, pending and estimated amounts remain separate from reported zero', () => {
  const result = accountingReadiness([
    source(), source({ key: 'cogs', certainty: 'estimated', amountMinor: 502 }),
    source({ key: 'refund', certainty: 'pending', amountMinor: 299, postingPolicy: 'reference_only' }),
    source({ key: 'shipping-income', certainty: 'reported', amountMinor: 0 }),
  ]);
  assert.equal(result.findings.length, 3);
  assert.equal(result.reported, 1);
  assert.equal(result.findings[2].referenceOnly, true);
  assert.match(result.findings[1].message, /Estimate/);
});
test('replaced observations resolve warnings without modifying history', () => {
  const sources = [source(), source({ id: 'two', amountMinor: 229, certainty: 'reported' })];
  const before = JSON.stringify(sources);
  assert.equal(accountingReadiness(sources).findings.length, 0);
  assert.equal(JSON.stringify(sources), before);
  sources.push(source({ id: 'three' }));
  assert.equal(accountingReadiness(sources).findings.length, 1);
});
test('return review excludes other returns and order costs; empty is not ready', () => {
  const sources = [source(), source({ key: 'return:r1', returnId: 'r1' }), source({ key: 'return:r2', returnId: 'r2' })];
  assert.equal(accountingReadiness(sources, 'r1').findings.length, 1);
  assert.equal(accountingReadiness(sources, 'r3').captured, false);
  assert.equal(accountingReadiness([]).captured, false);
});
