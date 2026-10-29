const crypto = require("crypto");

const VERSION = "v2";
const DEFAULT_TTL_MS = 10 * 60 * 1000;

function normalizeReturnTo(value) {
  const path = String(value || "").trim();
  if (!path || path.length > 1024 || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/channels";
  return path;
}

function required(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required to secure the eBay authorization request.`);
  return normalized;
}

function signingKey(options = {}) {
  const clientId = required(options.clientId, "eBay client ID");
  const clientSecret = required(options.clientSecret, "eBay client secret");
  const ruName = required(options.ruName, "eBay RuName");
  return crypto.createHash("sha256").update(`dataplus:ebay-oauth-state:${clientId}:${ruName}:${clientSecret}`).digest();
}

function sessionBinding(sessionToken) {
  return crypto.createHash("sha256").update(required(sessionToken, "DataPlus session")).digest("base64url");
}

function signatureFor(encodedPayload, options = {}) {
  return crypto.createHmac("sha256", signingKey(options))
    .update(`${encodedPayload}.${sessionBinding(options.sessionToken)}`)
    .digest("base64url");
}

function createState(options = {}) {
  const issuedAt = Number(options.now ?? Date.now());
  if (!Number.isFinite(issuedAt)) throw new Error("A valid eBay authorization timestamp is required.");
  const payload = {
    v: 2,
    i: Math.trunc(issuedAt),
    n: String(options.nonce || crypto.randomBytes(18).toString("base64url")),
    r: normalizeReturnTo(options.returnTo)
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${VERSION}.${encodedPayload}.${signatureFor(encodedPayload, options)}`;
}

function safeEqual(left, right) {
  const expected = Buffer.from(String(left || ""));
  const actual = Buffer.from(String(right || ""));
  return expected.length > 0 && expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function validateState(options = {}) {
  const state = String(options.state || "").trim();
  const parts = state.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) {
    throw new Error("The eBay callback state did not match. Start the connection again from DataPlus.");
  }
  const expectedSignature = signatureFor(parts[1], options);
  if (!safeEqual(expectedSignature, parts[2])) {
    throw new Error("The eBay callback state did not match this DataPlus session. Start the connection again from DataPlus.");
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("The eBay callback state could not be read. Start the connection again from DataPlus.");
  }
  const issuedAt = Number(payload?.i);
  const now = Number(options.now ?? Date.now());
  const ttlMs = Math.max(60_000, Number(options.ttlMs || DEFAULT_TTL_MS));
  if (payload?.v !== 2 || !payload?.n || !Number.isFinite(issuedAt) || issuedAt > now + 60_000 || issuedAt + ttlMs < now) {
    throw new Error("This eBay sign-in link expired. Start the connection again from DataPlus.");
  }
  return normalizeReturnTo(payload.r);
}

module.exports = {
  DEFAULT_TTL_MS,
  createState,
  normalizeReturnTo,
  validateState
};
