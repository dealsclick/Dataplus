const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = fs.readFileSync(require('node:path').join(__dirname, '../server.js'), 'utf8');
const marker = source.indexOf('parts[3] === "clear-bin"');
const route = source.slice(source.lastIndexOf('  if (', marker), source.indexOf('\n  if (', marker));
const helpers = source.slice(source.indexOf('function hashWarehouseAuditAdminPin('), source.indexOf('function davidToolEnabled('));
async function run(overrides = {}, status = 'in_progress', role = 'Admin') {
  const body = { reason: 'Moving to another count area', locationBin: 'A-01', adminPin: '123456', adminUserId: 'admin', ...overrides };
  const settings = { warehouseAuditAdminPinSalt: 'test-salt', warehouseAuditAdminPinHash: crypto.scryptSync('123456', 'test-salt', 32).toString('hex'), systemUsers: [{ id: 'admin', name: 'Approver', role }] };
  const audit = { id: 'audit', status, lines: [{ sku: 'SKU', countedQty: 7, locationBin: 'A-01' }], unknownBarcodes: [{ barcode: 'UPC', count: 3, locationBin: 'A-01' }] };
  let saved;
  const context = { Buffer, crypto, normalizeSystemSettings: x => x, req: { method: 'POST' }, res: {}, parts: ['api', 'warehouse-audits', 'audit', 'clear-bin'], parseBody: async () => body, readSystemSettingsStore: () => settings, dbCache: {}, authUser: { id: 'counter', name: 'Counter' }, postgres: { isPostgresEnabled: () => true, readStateField: async () => [audit], writeStateDocuments: async value => { saved = value; } }, sendJson: (_, status, data) => ({ status, data }), notFound: () => ({ status: 404 }) };
  const response = await vm.runInNewContext(`${helpers}\n(async () => {${route}})()`, context);
  return { response, saved, audit };
}
(async () => {
  for (const [body, status, role, expected] of [[{ reason: '' }, 'in_progress', 'Admin', 400], [{ adminPin: '' }, 'in_progress', 'Admin', 403], [{ adminPin: 'bad' }, 'in_progress', 'Admin', 403], [{}, 'completed', 'Admin', 400], [{}, 'locked', 'Admin', 400], [{}, 'in_progress', 'Warehouse', 403]]) {
    const result = await run(body, status, role); assert.equal(result.response.status, expected); assert.equal(result.saved, undefined);
  }
  const result = await run(); assert.equal(result.response.status, 200);
  const event = result.audit.lifecycleEvents[0]; assert.equal(event.reason, 'Moving to another count area'); assert.equal(event.approvedById, 'admin'); assert.equal(event.user, 'Counter'); assert.equal(event.locationBin, 'A-01');
  assert.equal(result.audit.lines[0].countedQty, 7); assert.equal(result.audit.unknownBarcodes[0].count, 3); assert.ok(!JSON.stringify(result.saved).includes('123456'));
  console.log('Clear-bin approval: reason, PIN, role, closed-audit guards, audit event, and preserved counts passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
