const SUPERUSER_FEATURES = Object.freeze([
  Object.freeze({
    key: "user_activity_audit",
    label: "User activity and audit",
    description: "Review page visits, exports, sign-ins, and security-relevant activity across DataPlus.",
    defaultAudience: "superuser"
  })
]);

function isSuperuser(user = {}, superuserId = process.env.DATAPLUS_SUPERUSER_USER_ID || "owner") {
  return Boolean(user && String(user.id || "") === String(superuserId || "owner"));
}

function isAdministrator(user = {}) {
  return Boolean(user?.isMasterAdmin === true || /(^|\s)admin($|\s)/i.test(String(user?.role || "")));
}

function normalizedFeatureSettings(rows = []) {
  const saved = new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.featureKey || row.feature_key || ""), row]));
  return SUPERUSER_FEATURES.map((feature) => {
    const row = saved.get(feature.key) || {};
    const audience = ["superuser", "admins"].includes(String(row.audience || "")) ? String(row.audience) : feature.defaultAudience;
    return { ...feature, enabled: row.enabled !== false, audience, updatedAt: row.updatedAt || row.updated_at || "", updatedBy: row.updatedBy || row.updated_by || "" };
  });
}

function featureAccessForUser(user = {}, rows = []) {
  if (isSuperuser(user)) return SUPERUSER_FEATURES.map((feature) => feature.key);
  if (!isAdministrator(user)) return [];
  return normalizedFeatureSettings(rows)
    .filter((feature) => feature.enabled && feature.audience === "admins")
    .map((feature) => feature.key);
}

module.exports = { SUPERUSER_FEATURES, isSuperuser, isAdministrator, normalizedFeatureSettings, featureAccessForUser };
