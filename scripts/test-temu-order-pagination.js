const test = require('node:test');
const assert = require('node:assert/strict');
const { temuOrderPages } = require('../lib/temu-order-pagination');
const base = { start: 0, end: 5, pageSize: 2, windowSeconds: 3, rowsOf: r => r.rows, totalOf: r => r.total, idOf: r => r.id };
const collect = async iterator => { const rows = []; for await (const page of iterator) rows.push(...page.rows); return rows; };

test('walks all pages in all windows, including short and empty windows', async () => {
  const calls = [];
  const rows = await collect(temuOrderPages({ ...base, end: 8, request: async p => {
    calls.push(p);
    const data = p.updateAtStart === 0 ? [{ id: 'A' }, { id: 'B' }, { id: 'C' }] : p.updateAtStart === 3 ? [] : [{ id: 'D' }];
    return { total: data.length, rows: data.slice((p.pageNumber - 1) * p.pageSize, p.pageNumber * p.pageSize) };
  } }));
  assert.deepEqual(rows.map(r => r.id), ['A', 'B', 'C', 'D']);
  assert.deepEqual(calls.map(p => [p.updateAtStart, p.updateAtEnd, p.pageNumber]), [[0, 2, 1], [0, 2, 2], [3, 5, 1], [6, 8, 1]]);
});

test('splits a search before its reported total reaches the Temu cap', async () => {
  const calls = [];
  const rows = await collect(temuOrderPages({ ...base, start: 0, end: 3, windowSeconds: 4, request: async p => {
    calls.push(p);
    return p.updateAtEnd - p.updateAtStart > 1 ? { total: 12000, rows: [{ id: 'unused' }] } : { total: 1, rows: [{ id: String(p.updateAtStart) }] };
  } }));
  assert.deepEqual(rows.map(r => r.id), ['0', '2']);
  assert.deepEqual(calls.map(p => [p.updateAtStart, p.updateAtEnd]), [[0, 3], [0, 1], [2, 3]]);
});

test('imports more than 10000 total results across independently paginated windows', async () => {
  const rows = await collect(temuOrderPages({ ...base, end: 1, windowSeconds: 1, pageSize: 100, request: async p => ({
    total: 6000, rows: Array.from({ length: 100 }, (_, i) => ({ id: `${p.updateAtStart}-${(p.pageNumber - 1) * 100 + i}` }))
  }) }));
  assert.equal(rows.length, 12000);
  assert.equal(new Set(rows.map(r => r.id)).size, 12000);
});

test('21008 after a successful page splits and deduplicates already emitted orders', async () => {
  const rows = await collect(temuOrderPages({ ...base, start: 0, end: 3, windowSeconds: 4, request: async p => {
    if (p.updateAtStart === 0 && p.updateAtEnd === 3) {
      if (p.pageNumber === 2) throw new Error('Temu errorCode:21008 Search result count exceeds maximum limit');
      return { total: NaN, rows: [{ id: 'A' }, { id: 'B' }] };
    }
    return { total: 2, rows: p.updateAtStart === 0 ? [{ id: 'A' }, { id: 'B' }] : [{ id: 'C' }, { id: 'D' }] };
  } }));
  assert.deepEqual(rows.map(r => r.id), ['A', 'B', 'C', 'D']);
});

test('overlapping results do not hide the rest of a later window', async () => {
  const rows = await collect(temuOrderPages({ ...base, request: async p => ({ total: 2, rows: [{ id: 'A' }, { id: p.updateAtStart ? 'C' : 'B' }] }) }));
  assert.deepEqual(rows.map(r => r.id), ['A', 'B', 'C']);
});

test('single-second overflow, other API errors, repeats and premature endings fail visibly', async () => {
  await assert.rejects(collect(temuOrderPages({ ...base, end: 0, request: async () => { throw new Error('21008'); } })), /one second/);
  await assert.rejects(collect(temuOrderPages({ ...base, request: async () => { throw new Error('permission denied'); } })), /permission/);
  await assert.rejects(collect(temuOrderPages({ ...base, request: async () => ({ total: 5, rows: [{ id: 'A' }, { id: 'B' }] }) })), /repeated/);
  await assert.rejects(collect(temuOrderPages({ ...base, request: async () => ({ total: 5, rows: [{ id: 'A' }] }) })), /ended early/);
});
