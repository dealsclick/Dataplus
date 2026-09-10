const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { zeroRequests, requireInventoryChannel, validateResponse, sendZeroRequest, tiktokSignature } = require('../lib/inactive-channel-inventory');
const { createInactiveChannelJob } = require('../lib/inactive-channel-job');
const inactive = { id: 'p1', sku: 'SKU', active: false, qty: 500, replenishable: true, channelInventoryLinks: {
  temu: [{ productId: '123', skuId: '456' }],
  whatnot: [{ listingId: 'listing1' }],
  tiktok: [{ productId: '123', skuId: '456', warehouseIds: ['w1', 'w2'] }]
} };
const before = JSON.stringify(inactive);
for (const key of ['temu', 'whatnot', 'tiktok']) {
  assert.deepEqual(zeroRequests({ ...inactive, active: true }, key), []);
  assert.throws(() => zeroRequests({ active: false }, key), /Missing/);
}
const temu = zeroRequests(inactive, 'temu');
assert.equal(temu.length, 2);
assert.deepEqual(temu.map(r => r.body.stockType), [0, 1]);
assert(temu.every(r => r.body.skuStockTargetList[0].stockTarget === 0));
assert.throws(() => zeroRequests({ ...inactive, channelInventoryLinks: { temu: [{ productId: '99999999999999999', skuId: 1 }] } }, 'temu'), /Invalid/);
const whatnot = zeroRequests(inactive, 'whatnot')[0];
assert.deepEqual(whatnot.body.variables.input, { id: 'listing1', inventoryLevel: { quantity: 0 } });
const tiktok = zeroRequests(inactive, 'tiktok')[0];
assert(tiktok.body.skus[0].inventory.every(i => i.quantity === 0 && i.backorder_quantity === 0));
assert.equal(tiktok.body.skus[0].inventory.length, 2);
assert.equal(JSON.stringify(inactive), before);
assert.throws(() => requireInventoryChannel({ name: 'Temu', settings: { channelEnabled: false, temuInventorySyncEnabled: true } }), /disabled/);
assert.throws(() => requireInventoryChannel({ name: 'Whatnot', settings: {} }), /Enable/);
assert.equal(requireInventoryChannel({ name: 'Temu', settings: { temuInventorySyncEnabled: true } }), 'temu');
validateResponse('temu', temu[0], { success: true, result: { operateResult: true, skuStockEditStatusInfoList: [{ skuId: 456, stockEditStatus: true }] } });
assert.throws(() => validateResponse('temu', temu[0], { success: true, result: { operateResult: true, skuStockEditStatusInfoList: [{ skuId: 456, stockEditStatus: false }] } }));
validateResponse('whatnot', whatnot, { data: { listingUpdate: { listing: { id: 'listing1', inventoryLevel: { quantity: 0 } }, userErrors: [] } } });
assert.throws(() => validateResponse('whatnot', whatnot, { data: { listingUpdate: { userErrors: [{ message: 'denied' }] } } }), /denied/);
assert.throws(() => validateResponse('tiktok', tiktok, { code: 1, message: 'missing warehouse' }), /missing warehouse/);
assert.equal(tiktokSignature('/path', { b: '2', a: '1', sign: 'ignored' }, '{}', 'secret'), tiktokSignature('/path', { a: '1', b: '2' }, '{}', 'secret'));

async function tests() {
  let requests = [];
  await sendZeroRequest('whatnot', whatnot, { settings: { whatnotApiEnvironment: 'production' } }, { env: { WHATNOT_ACCESS_TOKEN: 'test' }, fetchImpl: async (url, request) => {
    requests.push({ url, request });
    return { ok: true, json: async () => ({ data: { listingUpdate: { listing: { id: 'listing1', inventoryLevel: { quantity: 0 } }, userErrors: [] } } }) };
  } });
  assert.equal(requests[0].url, 'https://api.whatnot.com/seller-api/graphql');
  assert.equal(requests[0].request.redirect, 'error');
  await assert.rejects(sendZeroRequest('tiktok', tiktok, {}, { env: {}, fetchImpl: async () => { throw new Error('must not call'); } }), /TIKTOK_APP_KEY/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inactive-job-'));
  try {
    for (const mode of ['review', 'apply', 'reactivated', 'disabled', 'failure', 'stopped']) {
      const item = { ...inactive, active: mode === 'reactivated' };
      const channel = { id: 'ch', name: 'Temu', settings: { channelEnabled: mode !== 'disabled', temuInventorySyncEnabled: true } };
      let pages = 0, calls = 0, last = {};
      const postgres = {
        getPool: () => ({ query: async () => ({ rows: pages++ === 0 ? [{ product_id: 'p1', sku: 'SKU' }] : [] }) }),
        readOperationJob: async () => ({ status: mode === 'stopped' ? 'stopped' : 'running' }),
        readProductsByKeys: async () => [item],
        readStateField: async () => [channel]
      };
      const run = createInactiveChannelJob({ postgres, artifactsDir: dir, log: () => {}, pause: async () => {}, readDb: async () => ({}), persistJob: async (job, patch) => { last = { ...last, ...patch }; }, send: async () => { calls++; if (mode === 'failure') throw new Error('API rejected'); } });
      await run({ id: mode, workerPayload: { channel: 'Temu', channelId: 'ch', apply: mode !== 'review' } });
      assert.equal(calls, mode === 'apply' ? 2 : mode === 'failure' ? 1 : 0, mode);
      if (['disabled', 'failure'].includes(mode)) { assert.equal(last.status, 'warning'); assert.equal(last.missingCount, 1); }
      if (mode === 'apply') assert.equal(last.changed, 1);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  console.log('Inactive channel inventory tests passed (Temu, Whatnot, TikTok; no live API calls).');
}
tests().catch(error => { console.error(error); process.exitCode = 1; });
