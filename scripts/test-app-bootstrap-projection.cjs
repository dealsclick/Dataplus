const assert = require("node:assert/strict");

const { publicBootstrapSystemSettings, publicConnectionSummary } = require("../server");

const settings = publicBootstrapSystemSettings({
  systemUsers: [{ id: "user-1", name: "Test user" }],
  authPermissionTemplates: [{ id: "template-1", name: "Test template" }],
  authPermissionAuditLog: [{ id: "event-1", message: "Test event" }],
  systemBrandName: "DataPlus",
  returnDefaultCustomerRestockingPercent: 30,
});

assert.equal(Object.hasOwn(settings, "systemUsers"), false);
assert.equal(Object.hasOwn(settings, "authPermissionTemplates"), false);
assert.equal(Object.hasOwn(settings, "authPermissionAuditLog"), false);
assert.equal(Object.hasOwn(settings, "authPermissionAreas"), false);
assert.equal(settings.systemBrandName, "DataPlus");
assert.equal(settings.returnDefaultCustomerRestockingPercent, 30);

const connection = publicConnectionSummary({
  id: "channel-1",
  name: "Temu",
  connected: true,
  status: "active",
  logoDataUrl: "data:image/png;base64,large-image",
  settings: {
    channelEnabled: true,
    temuAppSecret: "must-not-leave-the-server",
    temuOrderImportEnabled: true,
  },
});

assert.deepEqual(connection.settings, { channelEnabled: true });
assert.equal(Object.hasOwn(connection, "logoDataUrl"), false);
assert.equal(JSON.stringify(connection).includes("must-not-leave-the-server"), false);

console.log("App bootstrap excludes workspace-only settings and channel configuration.");
