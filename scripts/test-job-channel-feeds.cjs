const assert = require('node:assert/strict');
const { jobChannelFeeds } = require('../lib/job-channel-feeds');
(async () => {
  const calls = [];
  const pool = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('starts_with')) return { rows: [{ feedId: 'feed-A' }, { feedId: 'feed-B' }] };
    if (sql.includes('itemsSucceeded')) return { rows: [{ feedId: 'feed-A', status: 'PROCESSED', succeeded: '22', processing: '5', failed: '0' }] };
    return { rows: [{ feedId: 'feed-A' }] };
  } };
  const result = await jobChannelFeeds({ id: 'job', workerTask: 'walmart-bulk-launch', workerPayload: { bulkRunId: 'run', environment: 'sandbox', tokens: ['preview'], credentialKey: 'private' } }, pool);
  assert.equal(result.length, 2);
  assert.equal(result[0].processing, '5');
  assert.equal(result[0].status, 'PROCESSED');
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.deepEqual(calls[0].params, ['walmart.bulk.run.feed.', 'job']);
  assert.ok(calls.at(-1).params[0].every(key => key.startsWith('walmart.feed.sandbox.')));
  const generic = await jobChannelFeeds({ id: 'other', channel: 'eBay', feedId: 'one', raw: { feedIds: ['one', 'two'] } }, { query() { throw Error('Unexpected query'); } });
  assert.deepEqual(generic.map(x => x.feedId).sort(), ['one','two']);
  assert.equal(generic[0].channel, 'eBay');
  assert.deepEqual(await jobChannelFeeds({ id: 'local' }, pool), []);
  console.log('Job channel feed projection tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
