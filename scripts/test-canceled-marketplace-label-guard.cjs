const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { storedMarketplaceCancellation, verifyOperationsAdminPin } = require("../server");

test("recognizes saved marketplace cancellation without treating local void as a marketplace cancellation", () => {
  assert.equal(storedMarketplaceCancellation({ source: "Temu", marketplaceStatus: "canceled" }).canceled, true);
  assert.equal(storedMarketplaceCancellation({ source: "Temu", external: { parentOrderStatus: 3 } }).canceled, true);
  assert.equal(storedMarketplaceCancellation({ source: "Temu", status: "void" }).canceled, false);
});

test("operations PIN authorizes a canceled-marketplace label override", () => {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync("4826", salt, 32).toString("hex");
  const settings = { warehouseAuditAdminPinSalt: salt, warehouseAuditAdminPinHash: hash };
  assert.equal(verifyOperationsAdminPin(settings, { adminPin: "4826" }).authorized, true);
  assert.match(verifyOperationsAdminPin(settings, { adminPin: "1111" }).error, /incorrect/i);
});

test("override stays blocked until an operations PIN is configured", () => {
  assert.match(verifyOperationsAdminPin({}, { adminPin: "4826" }).error, /System Settings/i);
});
