function normalizeMentionHandle(value = "") {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

function extractMentionHandles(text = "") {
  const handles = [];
  const seen = new Set();
  const pattern = /(^|[\s([{])@([a-z0-9][a-z0-9._-]{0,63})/gi;
  for (const match of String(text || "").matchAll(pattern)) {
    const handle = normalizeMentionHandle(match[2]);
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    handles.push(handle);
  }
  return handles;
}

function resolveMentionedUsers(text = "", users = []) {
  const usersByHandle = new Map();
  for (const user of users || []) {
    if (String(user?.status || "active").toLowerCase() !== "active") continue;
    const handle = normalizeMentionHandle(user?.username);
    if (handle && !usersByHandle.has(handle)) usersByHandle.set(handle, user);
  }
  return extractMentionHandles(text).map((handle) => usersByHandle.get(handle)).filter(Boolean);
}

module.exports = { extractMentionHandles, normalizeMentionHandle, resolveMentionedUsers };
