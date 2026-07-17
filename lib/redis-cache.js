const { createClient } = require("redis");

const redisUrl = String(process.env.REDIS_URL || "").trim();
let client = null;
let connectPromise = null;
let unavailable = false;
let lastError = "";
let lastErrorAt = "";

function enabled() {
  return Boolean(redisUrl);
}

async function getClient() {
  if (!enabled() || unavailable) return null;
  if (client?.isReady) return client;
  if (connectPromise) return connectPromise;

  client = createClient({ url: redisUrl, socket: { reconnectStrategy: false } });
  client.on("error", (error) => {
    lastError = error?.message || "Redis connection error";
    lastErrorAt = new Date().toISOString();
  });
  connectPromise = client.connect()
    .then(() => client)
    .catch((error) => {
      unavailable = true;
      lastError = error?.message || "Unable to connect to Redis";
      lastErrorAt = new Date().toISOString();
      client = null;
      return null;
    })
    .finally(() => {
      connectPromise = null;
    });
  return connectPromise;
}

async function getJson(key) {
  try {
    const activeClient = await getClient();
    if (!activeClient) return null;
    const value = await activeClient.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    lastError = error?.message || "Unable to read Redis cache";
    lastErrorAt = new Date().toISOString();
    return null;
  }
}

async function setJson(key, value, ttlSeconds) {
  try {
    const activeClient = await getClient();
    if (!activeClient) return false;
    await activeClient.set(key, JSON.stringify(value), { EX: Math.max(1, Number(ttlSeconds || 60)) });
    return true;
  } catch (error) {
    lastError = error?.message || "Unable to write Redis cache";
    lastErrorAt = new Date().toISOString();
    return false;
  }
}

function status() {
  return {
    configured: enabled(),
    connected: Boolean(client?.isReady),
    unavailable,
    lastError,
    lastErrorAt
  };
}

module.exports = { getJson, setJson, status };
