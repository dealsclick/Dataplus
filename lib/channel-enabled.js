function explicitFalse(value) {
  return value === false || ["false", "0", "no", "off"].includes(String(value || "").trim().toLowerCase());
}

function channelIsEnabled(channel = {}) {
  if (!channel || typeof channel !== "object") return false;
  const status = String(channel.status || "").trim().toLowerCase();
  if (explicitFalse(channel.enabled) || explicitFalse(channel.active)) return false;
  if (["disabled", "inactive", "off"].includes(status)) return false;
  if (explicitFalse(channel.settings?.channelEnabled)) return false;
  return true;
}

module.exports = { channelIsEnabled };
