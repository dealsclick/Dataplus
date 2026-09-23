const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { acceptTemuOrderEvent } = require('../lib/temu-order-webhooks');
const db = { connections: [{ name: 'Temu', settings: { channelEnabled: true, temuWebhookEnabled: true, temuOrderImportEnabled: true } }] };
const base = { db, eventId: 'event-1', eventType: 'Order change', orderIds: ['PO-123-4567'], seen: async () => false, remember: async () => {} };
test('webhook saves exact order IDs before remembering delivery', async () => {
  const calls = [];
  const result = await acceptTemuOrderEvent({ ...base,
    queue: async (_, body, options) => { calls.push('saved'); assert.deepEqual(body.parentOrderSnList, base.orderIds); assert.equal(body.webhookEventId, base.eventId); assert.equal(options.forceLookback, false); return { job: { id: 'J' } }; },
    remember: async () => { calls.push('remembered'); }
  });
  assert.equal(result.jobId, 'J'); assert.deepEqual(calls, ['saved', 'remembered']);
});
test('failed persistence remains retryable; missing IDs never trigger a scan', async () => {
  let remembered = false, queued = false;
  await assert.rejects(acceptTemuOrderEvent({ ...base, queue: async () => { throw Error('save failed'); }, remember: async () => { remembered = true; } }), /save failed/);
  assert.equal(remembered, false);
  assert.equal((await acceptTemuOrderEvent({ ...base, orderIds: [], queue: async () => { queued = true; } })).disposition, 'no_order_id');
  assert.equal(queued, false);
});
test('duplicate and disabled events do not queue work', async () => {
  const queue = async () => { throw Error('unexpected queue'); };
  assert.equal((await acceptTemuOrderEvent({ ...base, seen: async () => true, queue })).disposition, 'duplicate');
  assert.equal((await acceptTemuOrderEvent({ ...base, db: { connections: [] }, queue })).disposition, 'disabled');
});
const source = fs.readFileSync(require.resolve('../server'), 'utf8');
function load(name, end, deps) {
  const code = source.slice(source.indexOf(`async function ${name}(`), source.indexOf(end, source.indexOf(`async function ${name}(`)));
  return vm.runInNewContext(code + `\n${name}`, { require: name => require('../' + name.replace('./', '')), ...deps });
}
test('targeted event queues behind unrelated active import and preserves explicit incremental mode', async () => {
  const saved = [];
  const queue = load('queueTemuOrderImportJob', 'function getEbayConfig(', {
    requireEnabledChannel: () => db.connections[0], DEFAULT_CHANNEL_SETTINGS: {},
    findActiveImportJobByWorkerTask: async () => ({ id: 'unrelated' }),
    findActiveDuplicateImportJob: async () => null,
    shouldRunJobsInline: () => false, createImportJob: (_, attrs) => ({ id: 'targeted', ...attrs }),
    upsertImportJobStore: () => {}, appendChannelApiLog: () => {},
    postgres: { isPostgresEnabled: () => true, upsertOperationJob: async j => saved.push(j) }
  });
  const targeted = await queue({}, { parentOrderSnList: ['PO-123-4567'], webhookEventId: 'new-event' }, { forceLookback: false });
  assert.equal(targeted.job.id, 'targeted'); assert.equal(saved.length, 1);
  assert.equal(targeted.workerPayload.forceLookback, false);
  assert.equal(targeted.workerPayload.webhookEventId, 'new-event');
  assert.equal(targeted.job.totalRows, 1);
  const scheduled = await queue({}, {}, { scheduled: true });
  assert.equal(scheduled.job.id, 'unrelated');
  assert.equal(scheduled.workerPayload.fetchAll, true);
});
test('Temu reported total controls progress rather than the configured 5000 cap', async () => {
  for (const count of [0, 2]) {
    const progress = [];
    const run = load('importTemuOrders', 'async function queueTemuOrderImportJob(', {
      temuChannelSettings: () => ({}), unixStartOfDay: () => 0, getTemuConfig: () => ({ pageSize: 50 }),
      chunkTemuList: () => [], temuRequest: async () => ({ total: count, rows: Array.from({ length: count }, (_, i) => ({ id: String(i), status: 'canceled' })) }),
      temuPayload: x => x, firstArrayFrom: r => r.rows, valueAt: (r, keys, fallback) => { for (const k of keys) if (r[k] !== undefined) return r[k]; return fallback; },
      extractTemuOrderSn: r => r.id, mapTemuStatus: s => s, temuOrderStatusImpliesPaid: () => false
    });
    const result = await run({ orders: [], connections: [] }, { limit: 5000, progress: async p => progress.push(p) });
    assert.equal(result.fetched, count); assert.equal(progress.at(-1).totalRows, count);
  }
});
