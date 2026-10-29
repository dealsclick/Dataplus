const crypto = require("node:crypto");

const VERSION = "v2";
const DEFAULT_TTL_MS = 10 * 60 * 1000;

function clean(value, limit = 4096) {
  return String(value ?? "").trim().slice(0, limit);
}

function normalizeReturnTo(value, fallback = "/channels") {
  const target = clean(value, 1024);
  const safeFallback = clean(fallback, 1024) || "/channels";
  if (!target || !target.startsWith("/") || target.startsWith("//") || target.includes("\\")) return safeFallback;
  return target;
}

function required(value, label, provider) {
  const normalized = clean(value);
  if (!normalized) throw new Error(`${label} is required to secure the ${provider} authorization request.`);
  return normalized;
}

function providerName(value) {
  return clean(value, 80) || "channel";
}

function signingKey(options = {}) {
  const provider = providerName(options.provider);
  const clientId = required(options.clientId, `${provider} client ID`, provider);
  const signingSecret = required(options.signingSecret, `${provider} signing secret`, provider);
  const redirectUri = required(options.redirectUri, `${provider} redirect URI`, provider);
  return crypto.createHash("sha256")
    .update(`dataplus:channel-oauth-state:${provider}:${clientId}:${redirectUri}:${signingSecret}`)
    .digest();
}

function sessionBinding(sessionToken, provider) {
  return crypto.createHash("sha256")
    .update(required(sessionToken, "DataPlus session", providerName(provider)))
    .digest("base64url");
}

function signatureFor(encodedPayload, options = {}) {
  return crypto.createHmac("sha256", signingKey(options))
    .update(`${encodedPayload}.${sessionBinding(options.sessionToken, options.provider)}`)
    .digest("base64url");
}

function safeEqual(left, right) {
  const expected = Buffer.from(String(left || ""));
  const actual = Buffer.from(String(right || ""));
  return expected.length > 0 && expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function createState(options = {}) {
  const provider = providerName(options.provider);
  const issuedAt = Number(options.now ?? Date.now());
  if (!Number.isFinite(issuedAt)) throw new Error(`A valid ${provider} authorization timestamp is required.`);
  const payload = {
    v: 2,
    p: provider,
    i: Math.trunc(issuedAt),
    n: clean(options.nonce, 96) || crypto.randomBytes(18).toString("base64url"),
    r: normalizeReturnTo(options.returnTo, options.defaultReturnTo),
    d: options.data && typeof options.data === "object" && !Array.isArray(options.data) ? options.data : undefined
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const state = `${VERSION}.${encodedPayload}.${signatureFor(encodedPayload, options)}`;
  if (state.length > 1500) throw new Error(`${provider} authorization state is too large.`);
  return state;
}

function validateState(options = {}) {
  const provider = providerName(options.provider);
  const state = clean(options.state, 2000);
  const parts = state.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) {
    throw new Error(`The ${provider} callback state did not match. Start the connection again from DataPlus.`);
  }
  if (!safeEqual(signatureFor(parts[1], options), parts[2])) {
    throw new Error(`The ${provider} callback state did not match this DataPlus session. Start the connection again from DataPlus.`);
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new Error(`The ${provider} callback state could not be read. Start the connection again from DataPlus.`);
  }
  const issuedAt = Number(payload?.i);
  const now = Number(options.now ?? Date.now());
  const ttlMs = Math.max(60_000, Number(options.ttlMs || DEFAULT_TTL_MS));
  if (payload?.v !== 2 || payload?.p !== provider || !payload?.n || !Number.isFinite(issuedAt) || issuedAt > now + 60_000 || issuedAt + ttlMs < now) {
    throw new Error(`This ${provider} sign-in link expired or is invalid. Start the connection again from DataPlus.`);
  }
  return {
    returnTo: normalizeReturnTo(payload.r, options.defaultReturnTo),
    data: payload.d && typeof payload.d === "object" && !Array.isArray(payload.d) ? payload.d : {},
    issuedAt,
    nonce: clean(payload.n, 96)
  };
}

module.exports = {
  DEFAULT_TTL_MS,
  VERSION,
  createState,
  normalizeReturnTo,
  validateState
};
