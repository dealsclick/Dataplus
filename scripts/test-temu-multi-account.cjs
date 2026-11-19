const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTemuCredentials } = require('../lib/temu-credentials');

const root = fs.mkdtempSync(path.join(process.env.DATAPLUS_TEST_TMP_DIR || os.tmpdir(), 'dataplus-temu-accounts-'));
try {
  const env = { DATAPLUS_CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 11).toString('base64') };
  const credentials = createTemuCredentials({ directory: root, env });
  credentials.updateTokens({ accessToken: 'token-shop-1', refreshToken: 'refresh-shop-1', mallId: 'mall-1', mallName: 'Temu Shop 1', expiredTime: 2_000_000_000 });
  credentials.updateTokens({ accessToken: 'token-shop-2', refreshToken: 'refresh-shop-2', mallId: 'mall-2', mallName: 'Temu Shop 2', expiredTime: 2_000_000_000 });
  assert.deepEqual(credentials.accounts().map(account => account.id).sort(), ['mall-1', 'mall-2']);
  assert.equal(credentials.status().activeAccountId, 'mall-2');
  credentials.setActiveAccount('mall-1');
  assert.equal(credentials.get().mallName, 'Temu Shop 1');
  credentials.updateTokens({ accessToken: 'token-shop-1-renewed', mallId: 'mall-1' }, 'mall-1');
  assert.equal(credentials.get('mall-1').accessToken, 'token-shop-1-renewed');
  assert.equal(credentials.get('mall-2').accessToken, 'token-shop-2');
  assert.throws(
    () => credentials.updateTokens({ accessToken: 'wrong-shop-token', mallId: 'mall-2' }, 'mall-1'),
    /different shop/i
  );
  assert.equal(credentials.get('mall-1').accessToken, 'token-shop-1-renewed');
  const stored = fs.readFileSync(path.join(root, 'temu-runtime-credentials.json'), 'utf8');
  assert.equal(stored.includes('token-shop-1'), false);
  assert.equal(stored.includes('token-shop-2'), false);
  const removedFirst = credentials.removeAccount('mall-1');
  assert.equal(removedFirst.removed.mallId, 'mall-1');
  assert.equal(removedFirst.activeAccountId, 'mall-2');
  assert.equal(credentials.get().accessToken, 'token-shop-2');
  const removedSecond = credentials.removeAccount('mall-2');
  assert.equal(removedSecond.activeAccountId, '');
  assert.equal(credentials.status().accounts.length, 0);
  assert.throws(() => credentials.removeAccount('mall-2'), /choose a connected temu shop/i);

  const legacyRoot = fs.mkdtempSync(path.join(root, 'legacy-'));
  const legacy = createTemuCredentials({ directory: legacyRoot, env });
  assert.equal(legacy.status({ accessToken: 'legacy-token', mallId: 'legacy-mall' }).activeAccountId, 'legacy-mall');
  assert.equal(legacy.get('', { accessToken: 'legacy-token', mallId: 'legacy-mall' }).accessToken, 'legacy-token');
  console.log('Temu multi-account credential tests passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
