const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('server.js', 'utf8');
const publicUser = source.slice(source.indexOf('function publicSystemUser('), source.indexOf('function readAuthSessions('));
const gate = source.slice(source.indexOf('  const ownPasswordMatch ='), source.indexOf('  if (url.pathname.startsWith("/api/accounting/")) {'));
const handler = source.slice(source.indexOf('  const resetPasswordMatch ='), source.indexOf('  if (req.method === "GET" && url.pathname === "/api/system/database")'));
const now = Date.parse('2026-09-18T12:00:00Z');
class Clock extends Date { static now() { return now; } }
async function run({ target = 'self', allowed = false, currentPassword = 'old-password', due = '', pending = true } = {}) {
  const settings = { systemUsers: [{ id: target, name: target, mustChangePassword: pending, passwordChangeDueAt: due, passwordHash: 'old', permissions: {} }] };
  let companyChecks = 0;
  const ctx = {
    Date: Clock, req: { method: 'POST' }, res: {}, url: { pathname: `/api/users/${target}/password` }, parts: [], authUser: { id: 'self' },
    authRequirementForRequest: () => ({ area: 'users.accounts', action: 'passwords' }), userCan: (_, area, action) => allowed && action === 'passwords',
    companyOperationsHandler: async () => { companyChecks++; return false; }, postgres: { isPostgresEnabled: () => true }, companySelection: () => 'other-company', companyStore: { legacyAccess: async () => { companyChecks++; } },
    sendJson: (_, status, body) => ({ status, body }), parseBody: async () => ({ password: 'new-password', currentPassword, mustChangePassword: false }),
    sourceTextValue: v => String(v || ''), dbCache: {}, readSystemSettingsStore: () => settings, writeSystemSettingsStore: v => v,
    verifyUserPassword: (_, value) => value === 'old-password', hashUserPassword: () => ({ hash: 'new', salt: 'salt' }),
    appendAuthPermissionAudit: () => {}, permissionEnabledCount: () => 0, revokeAuthSessionsForUser: () => {}, normalizeAuthPermissions: v => v || {},
    publicStateJsonCache: null, notFound: () => ({ status: 404 }),
  };
  vm.createContext(ctx);
  vm.runInContext(publicUser, ctx);
  const result = await vm.runInContext(`(async () => { ${gate}\n${handler} })()`, ctx);
  return { result, companyChecks, user: settings.systemUsers[0], publicUser: ctx.publicSystemUser };
}
(async () => {
  const own = await run();
  assert.equal(own.result.status, 200);
  assert.equal(own.companyChecks, 0, 'Own password must not require company access');
  assert.equal(own.user.mustChangePassword, false);
  assert.equal(own.user.passwordChangeDueAt, '');
  assert.equal(own.result.body.users, undefined, 'Self-service must not expose other users');
  assert.equal((await run({ currentPassword: 'wrong' })).result.status, 401);
  assert.equal((await run({ target: 'someone-else' })).result.status, 403);
  const admin = await run({ target: 'someone-else', allowed: true });
  assert.equal(admin.result.status, 200);
  assert.equal(admin.companyChecks, 2);
  assert.equal(Date.parse(admin.user.passwordChangeDueAt), now + 14 * 86400000);
  assert.equal(admin.user.mustChangePassword, true, 'Admin cannot force immediate change or disable grace policy');
  const project = own.publicUser;
  assert.equal(project({ mustChangePassword: true, passwordChangeDueAt: new Date(now + 1).toISOString() }).passwordChangeRequired, false);
  assert.equal(project({ mustChangePassword: true, passwordChangeDueAt: new Date(now).toISOString() }).passwordChangeRequired, true);
  assert.equal(project({ mustChangePassword: false, passwordChangeDueAt: new Date(now - 1).toISOString() }).passwordChangeRequired, false);
  assert.equal(project({ mustChangePassword: true }).passwordChangeRequired, false);
  // Legacy pending resets receive one deadline on sign-in; later logins retain it.
  const loginUpdate = source.split('\n').find(line => line.includes('current.systemUsers =') && line.includes('lastLoginAt:') && line.includes('passwordChangeDueAt:'));
  assert(loginUpdate);
  const login = { Date: Clock, user: { id: 'self' }, current: { systemUsers: [{ id: 'self', mustChangePassword: true }] } };
  vm.createContext(login);
  vm.runInContext(loginUpdate, login);
  const deadline = login.current.systemUsers[0].passwordChangeDueAt;
  assert.equal(Date.parse(deadline), now + 14 * 86400000);
  login.current.systemUsers[0].passwordChangeDueAt = new Date(now - 1).toISOString();
  vm.runInContext(loginUpdate, login);
  assert.equal(Date.parse(login.current.systemUsers[0].passwordChangeDueAt), now - 1, 'Signing in must not extend the deadline');
  console.log('Password grace period and self-service authorization checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
