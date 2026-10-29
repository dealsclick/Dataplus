const assert = require("node:assert/strict");

const { publicBootstrapSystemSettings, publicConnectionSummary, publicVendorReferenceSummary } = require("../server");

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

const vendor = publicVendorReferenceSummary({
  id: "vendor-1",
  name: "Example Supplier",
  code: "EX",
  status: "active",
  type: "Distributor",
  supplierLocations: [{ id: "location-1", name: "Large nested record" }],
  pricingRules: { markup: 25 },
  submissionSettings: { apiSecret: "must-stay-server-side" },
});

assert.deepEqual(vendor, {
  id: "vendor-1",
  name: "Example Supplier",
  code: "EX",
  status: "active",
  type: "Distributor",
  retirement: null,
});
assert.equal(JSON.stringify(vendor).includes("must-stay-server-side"), false);

console.log("App bootstrap and compact references exclude workspace-only configuration.");
