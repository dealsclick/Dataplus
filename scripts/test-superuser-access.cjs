const assert = require("assert");
const { isSuperuser, normalizedFeatureSettings, featureAccessForUser } = require("../lib/superuser-access");

assert.equal(isSuperuser({ id: "owner", role: "Master Admin" }), true);
assert.equal(isSuperuser({ id: "admin-1", role: "Master Admin", isMasterAdmin: true }), false);
assert.deepEqual(featureAccessForUser({ id: "operator", role: "Operator" }, [{ featureKey: "user_activity_audit", audience: "admins" }]), []);
assert.deepEqual(featureAccessForUser({ id: "admin-1", role: "Admin" }, []), []);
assert.deepEqual(featureAccessForUser({ id: "admin-1", role: "Admin" }, [{ featureKey: "user_activity_audit", audience: "admins", enabled: true }]), ["user_activity_audit"]);
assert.deepEqual(featureAccessForUser({ id: "owner", role: "Master Admin" }, [{ featureKey: "user_activity_audit", enabled: false }]), ["user_activity_audit"]);
assert.equal(normalizedFeatureSettings([])[0].audience, "superuser");

console.log("superuser access tests passed");
