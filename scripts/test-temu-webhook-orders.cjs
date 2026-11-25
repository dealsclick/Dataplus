const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { acceptTemuOrderEvent } = require('../lib/temu-order-webhooks');

function db(settings = {}) {
  return {
    connections: [{
      name: 'Temu',
      settings: {
        channelEnabled: true,
        temuWebhookEnabled: true,
        orderDownloadEnabled: true,
        temuOrderImportEnabled: true,
        ...settings
      }
    }]
  };
}

(async () => {
  let queued = [];
  let remembered = [];
  const queue = async (_db, body, options) => {
    queued.push({ body, options });
    return { job: { id: `job-${body.accountId}` } };
  };
  const remember = async (id, value) => remembered.push({ id, value });

  let result = await acceptTemuOrderEvent({
    db: db({ temuWebhookEnabled: false }), eventId: 'disabled', eventType: 'order', orderIds: ['one'], accountIds: ['shop-a'],
    seen: async () => false, remember, queue
  });
  assert.equal(result.disposition, 'disabled');
  assert.equal(queued.length, 0);

  result = await acceptTemuOrderEvent({
    db: db(), eventId: 'duplicate', eventType: 'order', orderIds: ['one'], accountIds: ['shop-a'],
    seen: async () => true, remember, queue
  });
  assert.equal(result.disposition, 'duplicate');
  assert.equal(queued.length, 0);

  result = await acceptTemuOrderEvent({
    db: db(), eventId: 'missing', eventType: 'shipment', orderIds: [], accountIds: ['shop-a'],
    seen: async () => false, remember, queue
  });
  assert.equal(result.disposition, 'no_order_id');
  assert.equal(queued.length, 0, 'Events without order IDs must not start a broad scan.');

  result = await acceptTemuOrderEvent({
    db: db(), eventId: 'event-1', eventType: 'order_status', orderIds: [' one ', 'one', 'two'], accountIds: ['shop-a', 'shop-b'],
    seen: async () => false, remember, queue
  });
  assert.equal(result.disposition, 'queued');
  assert.deepEqual(result.jobIds, ['job-shop-a', 'job-shop-b']);
  assert.equal(queued.length, 2);
  assert.deepEqual(queued[0].body.parentOrderSnList, ['one', 'two']);
  assert.equal(queued[0].body.mode, 'status');
  assert.equal(queued[0].body.webhookEventId, 'event-1');
  assert.equal(queued[0].options.allowQueuedTargeted, true);
  assert.equal(remembered.length, 1);
  assert.deepEqual(remembered[0].value.jobIds, ['job-shop-a', 'job-shop-b']);

  remembered = [];
  await assert.rejects(acceptTemuOrderEvent({
    db: db(), eventId: 'event-failed', eventType: 'order', orderIds: ['three'], accountIds: ['shop-a'],
    seen: async () => false, remember,
    queue: async () => { throw new Error('database unavailable'); }
  }), /database unavailable/);
  assert.equal(remembered.length, 0, 'A failed queue must remain retryable.');

  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const queueBody = source.slice(source.indexOf('async function queueTemuOrderImportJob('), source.indexOf('function getEbayConfig('));
  const webhookBody = source.slice(source.indexOf('if (req.method === "POST" && url.pathname === "/api/webhooks/temu")'), source.indexOf('if (req.method === "GET" && url.pathname === "/api/auth/session")'));
  assert(queueBody.includes('options.allowQueuedTargeted === true && targetedOrderRequest'));
  assert(queueBody.includes('prerequisiteJobId: activeImport?.id || ""'));
  assert(!webhookBody.includes('sendJson(res, 200, { success: true, accepted: true, eventType, parentOrderSnList, message: "Temu webhook accepted." })'));
  assert(webhookBody.includes('return sendJson(res, 503'));
  assert(webhookBody.includes('postgres.readStateFields(["connections", "connectorState", "systemSettings"])'));
  console.log('PASS Temu webhooks: targeted durable queue, retryable failures, no broad identifier-free scans');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
