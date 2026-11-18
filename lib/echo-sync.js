const crypto = require("node:crypto");

const DEFAULT_URLS = Object.freeze({
  auth: "https://auth.echo.com",
  pricing: "https://customerapi.echo.com",
  shipper: "https://restapi.echo.com",
  carrier: "https://carrierapi.echo.com",
});

const tokenCache = new Map();
let requestQueue = Promise.resolve();
let nextRequestAt = 0;

function clean(value) {
  return String(value ?? "").trim();
}

function endpointUrl(base, path, query = {}) {
  const url = new URL(path, `${clean(base).replace(/\/+$/, "")}/`);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && clean(value) !== "") url.searchParams.set(key, String(value));
  });
  return url;
}

function safeErrorMessage(payload, status) {
  return clean(payload?.message || payload?.error?.message || payload?.error || payload?.title)
    || `EchoSync request failed with HTTP ${status}.`;
}

function publicStatus(credentials = {}) {
  const shipperConfigured = Boolean(clean(credentials.shipperUsername) && clean(credentials.shipperApiKey));
  const pricingConfigured = Boolean(clean(credentials.pricingClientId) && clean(credentials.pricingClientSecret));
  const carrierConfigured = Boolean(clean(credentials.carrierClientId) && clean(credentials.carrierClientSecret));
  const webhookConfigured = Boolean(clean(credentials.webhookSigningSecret));
  return {
    id: "echosync",
    name: "EchoSync Freight",
    available: true,
    configured: shipperConfigured || pricingConfigured || carrierConfigured,
    shipperConfigured,
    pricingConfigured,
    carrierConfigured,
    webhookConfigured,
    shipperUsername: clean(credentials.shipperUsername),
    pricingClientId: clean(credentials.pricingClientId),
    carrierClientId: clean(credentials.carrierClientId),
    updatedAt: clean(credentials.updatedAt),
    lastTestedAt: clean(credentials.lastTestedAt),
    lastTestStatus: clean(credentials.lastTestStatus),
    lastTestMessage: clean(credentials.lastTestMessage),
    lastVerifiedAt: clean(credentials.lastVerifiedAt),
    lastTokenScopes: clean(credentials.lastTokenScope).split(/\s+/).filter(Boolean),
    lastTokenLifetimeSeconds: Math.max(0, Number(credentials.lastTokenExpiresIn || 0) || 0),
    capabilities: [
      { id: "ltl-rates", label: "LTL freight rates", status: shipperConfigured ? "ready" : "needs_credentials", detail: "Echo Shipper API negotiated LTL rates." },
      { id: "freight-quotes", label: "TL and partial quotes", status: pricingConfigured ? "ready" : "needs_credentials", detail: "Echo Pricing API V2 truckload and partial-load quotes." },
      { id: "tracking", label: "Shipment tracking", status: shipperConfigured ? "ready" : "needs_credentials", detail: "Echo load status and tracking events by Shipment ID." },
      { id: "capacity", label: "Carrier capacity matching", status: carrierConfigured ? "ready" : "optional", detail: "Optional carrier-side available-load search using loads:read." },
      { id: "webhooks", label: "Signed webhooks", status: webhookConfigured ? "ready" : "needs_setup", detail: "HMAC-SHA256 tracking and available-load event intake." },
    ],
  };
}

function basicAuthorization(username, password) {
  return `Basic ${Buffer.from(`${clean(username)}:${clean(password)}`, "utf8").toString("base64")}`;
}

function schedule(operation, delayMs = 334) {
  const run = requestQueue.catch(() => {}).then(async () => {
    const wait = Math.max(0, nextRequestAt - Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    nextRequestAt = Date.now() + Math.max(0, delayMs);
    return operation();
  });
  requestQueue = run;
  return run;
}

async function requestJson(url, options = {}, runtime = {}) {
  const fetchImpl = runtime.fetchImpl || fetch;
  const response = await schedule(() => fetchImpl(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(Number(runtime.timeoutMs || 30000)),
  }), Number(runtime.rateLimitMs ?? 334));
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text }; }
  if (!response.ok) {
    const authenticationMessage = response.status === 401 || response.status === 403
      ? `EchoSync authentication was rejected (HTTP ${response.status}). Confirm the Echo credential set and API access with your Echo account team.`
      : "";
    const error = new Error(authenticationMessage || safeErrorMessage(payload, response.status));
    error.statusCode = response.status;
    error.response = payload;
    throw error;
  }
  return payload;
}

async function verifyShipperCredentials(credentials = {}, runtime = {}) {
  requireShipper(credentials);
  const fetchImpl = runtime.fetchImpl || fetch;
  // Echo requires at least one shipment ID on this endpoint. A known-invalid ID
  // verifies Basic Auth without reading or changing a customer's shipment.
  const url = endpointUrl(runtime.shipperBaseUrl || DEFAULT_URLS.shipper, "/v2/shipments/statuses", { id: "0" });
  const response = await schedule(() => fetchImpl(url, {
    method: "GET",
    headers: { Authorization: basicAuthorization(credentials.shipperUsername, credentials.shipperApiKey), Accept: "application/json" },
    signal: AbortSignal.timeout(Number(runtime.timeoutMs || 30000)),
  }), Number(runtime.rateLimitMs ?? 334));
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text }; }
  if (response.status === 401 || response.status === 403) {
    const error = new Error(`EchoSync rejected the Shipper UserName or API Key (HTTP ${response.status}). Confirm that UserName is the Echo ENumber and that the key has Shipper API access.`);
    error.statusCode = response.status;
    error.response = payload;
    throw error;
  }
  if (!(response.ok || response.status === 400 || response.status === 404 || response.status === 422)) {
    const message = response.status >= 500 && !clean(payload?.message)
      ? `EchoSync Shipper API returned HTTP ${response.status} while verifying credentials. No shipment data was changed. Retry once, then contact Echo Integrations API support if it continues.`
      : safeErrorMessage(payload, response.status);
    const error = new Error(message);
    error.statusCode = response.status;
    error.response = payload;
    throw error;
  }
  return { ok: true, statusCode: response.status };
}

async function accessToken(credentials, scope, runtime = {}) {
  const clientId = clean(credentials.clientId);
  const clientSecret = clean(credentials.clientSecret);
  if (!clientId || !clientSecret) throw new Error("EchoSync OAuth Client ID and Client Secret are required.");
  const key = crypto.createHash("sha256").update(`${clientId}\u0000${scope}`).digest("hex");
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached;
  const form = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials", scope });
  const payload = await requestJson(endpointUrl(runtime.authBaseUrl || DEFAULT_URLS.auth, "/token"), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form.toString(),
  }, runtime);
  const token = clean(payload.access_token);
  if (!token) throw new Error("EchoSync authorization did not return an access token.");
  const expiresIn = Math.max(60, Number(payload.expires_in || 86400) || 86400);
  const result = { token, tokenType: clean(payload.token_type || "Bearer"), scope: clean(payload.scope || scope), expiresIn, expiresAt: Date.now() + expiresIn * 1000 };
  tokenCache.set(key, result);
  return result;
}

function requireShipper(credentials = {}) {
  if (!clean(credentials.shipperUsername) || !clean(credentials.shipperApiKey)) throw new Error("Save EchoSync Shipper UserName and API Key first.");
}

function requirePricing(credentials = {}) {
  if (!clean(credentials.pricingClientId) || !clean(credentials.pricingClientSecret)) throw new Error("Save EchoSync Pricing OAuth credentials first.");
}

function requireCarrier(credentials = {}) {
  if (!clean(credentials.carrierClientId) || !clean(credentials.carrierClientSecret)) throw new Error("Save EchoSync Carrier OAuth credentials first.");
}

async function quoteLtl(payload, credentials = {}, runtime = {}) {
  requireShipper(credentials);
  return requestJson(endpointUrl(runtime.shipperBaseUrl || DEFAULT_URLS.shipper, "/v2/rates"), {
    method: "POST",
    headers: { Authorization: basicAuthorization(credentials.shipperUsername, credentials.shipperApiKey), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload || {}),
  }, runtime);
}

async function quoteFreight(payload, credentials = {}, runtime = {}) {
  requirePricing(credentials);
  const token = await accessToken({ clientId: credentials.pricingClientId, clientSecret: credentials.pricingClientSecret }, "quotes:create", runtime);
  return requestJson(endpointUrl(runtime.pricingBaseUrl || DEFAULT_URLS.pricing, "/v2/quotes"), {
    method: "POST",
    headers: { Authorization: `${token.tokenType} ${token.token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload || {}),
  }, runtime);
}

async function shipmentTracking(shipmentId, credentials = {}, runtime = {}) {
  requireShipper(credentials);
  const id = clean(shipmentId);
  if (!/^\d{1,20}$/.test(id)) throw new Error("Enter a valid Echo Shipment ID.");
  const headers = { Authorization: basicAuthorization(credentials.shipperUsername, credentials.shipperApiKey), Accept: "application/json" };
  const base = runtime.shipperBaseUrl || DEFAULT_URLS.shipper;
  const [shipment, tracking] = await Promise.all([
    requestJson(endpointUrl(base, `/v2/shipments/${encodeURIComponent(id)}`), { headers }, runtime),
    requestJson(endpointUrl(base, `/v2/shipments/${encodeURIComponent(id)}/tracking`), { headers }, runtime),
  ]);
  return { shipmentId: id, shipment, tracking };
}

async function searchCapacity(payload, query = {}, credentials = {}, runtime = {}) {
  requireCarrier(credentials);
  const offset = Math.max(0, Number(query.offset || 0) || 0);
  const requestedLimit = Number(query.limit || 50) || 50;
  const limit = Math.min(100, Math.max(10, Math.ceil(requestedLimit / 10) * 10));
  const token = await accessToken({ clientId: credentials.carrierClientId, clientSecret: credentials.carrierClientSecret }, "loads:read", runtime);
  return requestJson(endpointUrl(runtime.carrierBaseUrl || DEFAULT_URLS.carrier, "/v2/availableloads", { offset, limit }), {
    method: "POST",
    headers: { Authorization: `${token.tokenType} ${token.token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload || {}),
  }, runtime);
}

async function verifyCredentials(credentials = {}, runtime = {}) {
  const checks = [];
  let token = null;
  if (clean(credentials.shipperUsername) && clean(credentials.shipperApiKey)) {
    await verifyShipperCredentials(credentials, runtime);
    checks.push("Shipper API authentication");
  }
  if (clean(credentials.pricingClientId) && clean(credentials.pricingClientSecret)) {
    token = await accessToken({ clientId: credentials.pricingClientId, clientSecret: credentials.pricingClientSecret }, "quotes:create", runtime);
    checks.push("Pricing OAuth");
  }
  if (clean(credentials.carrierClientId) && clean(credentials.carrierClientSecret)) {
    const carrierToken = await accessToken({ clientId: credentials.carrierClientId, clientSecret: credentials.carrierClientSecret }, "loads:read", runtime);
    token ||= carrierToken;
    checks.push("Carrier OAuth");
  }
  if (!checks.length) throw new Error("Enter at least one EchoSync credential set.");
  return { ok: true, checks, scope: token?.scope || "", expiresIn: token?.expiresIn || 0, tokenStatus: token ? "issued" : "not_requested" };
}

function verifyWebhook(rawBody, signature, signingSecret) {
  if (!Buffer.isBuffer(rawBody) || !clean(signature) || !clean(signingSecret)) return false;
  const expected = crypto.createHmac("sha256", signingSecret).update(rawBody).digest();
  let supplied;
  try { supplied = Buffer.from(clean(signature), "base64"); } catch { return false; }
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function webhookId(headers = {}, rawBody = Buffer.alloc(0)) {
  return clean(headers["x-echo-webhook-id"] || headers["X-Echo-Webhook-Id"])
    || crypto.createHash("sha256").update(rawBody).digest("hex");
}

module.exports = {
  DEFAULT_URLS,
  accessToken,
  publicStatus,
  quoteFreight,
  quoteLtl,
  searchCapacity,
  shipmentTracking,
  verifyCredentials,
  verifyShipperCredentials,
  verifyWebhook,
  webhookId,
};
