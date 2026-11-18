const assert = require("node:assert/strict");
const echoSync = require("../lib/echo-sync");

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

async function run() {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/token")) return response({ access_token: "token-1", token_type: "Bearer", expires_in: 86400, scope: new URLSearchParams(options.body).get("scope") });
    if (String(url).endsWith("/v2/shipments/statuses?id=0")) return response({ message: "Shipment was not found." }, 404);
    if (String(url).includes("/v2/availableloads")) return response({ resultSet: { total: 1 }, loads: [{ loadId: 123 }] });
    if (String(url).endsWith("/v2/rates")) return response({ rates: [{ carrier: "Test Freight", total: 100 }] });
    if (String(url).endsWith("/tracking")) return response({ events: [{ status: "In transit" }] });
    if (String(url).includes("/v2/shipments/")) return response({ ShipmentId: 12345678, Status: "In Transit" });
    return response({ quoteKey: "quote-1" });
  };
  const runtime = { fetchImpl, rateLimitMs: 0, timeoutMs: 1000 };

  const status = echoSync.publicStatus({ shipperUsername: "E123", shipperApiKey: "secret", pricingClientId: "pricing", pricingClientSecret: "secret", webhookSigningSecret: "signing" });
  assert.equal(status.shipperConfigured, true);
  assert.equal(status.pricingConfigured, true);
  assert.equal(status.webhookConfigured, true);
  assert.equal(JSON.stringify(status).includes("secret"), false);

  await echoSync.quoteLtl({ originZip: "10314" }, { shipperUsername: "E123", shipperApiKey: "shipper-key" }, runtime);
  assert.match(calls.at(-1).options.headers.Authorization, /^Basic /);
  assert.match(calls.at(-1).url, /\/v2\/rates$/);

  const verified = await echoSync.verifyCredentials({ shipperUsername: "E123", shipperApiKey: "shipper-key" }, runtime);
  assert.deepEqual(verified.checks, ["Shipper API authentication"]);
  assert.match(calls.at(-1).url, /\/v2\/shipments\/statuses\?id=0$/);

  await assert.rejects(
    () => echoSync.verifyShipperCredentials({ shipperUsername: "wrong", shipperApiKey: "wrong" }, { ...runtime, fetchImpl: async () => response({}, 401) }),
    /Echo ENumber/,
  );

  await assert.rejects(
    () => echoSync.verifyShipperCredentials({ shipperUsername: "E123", shipperApiKey: "shipper-key" }, { ...runtime, fetchImpl: async () => response({}, 500) }),
    /Shipper API returned HTTP 500/,
  );

  await echoSync.quoteFreight({ mode: "TL" }, { pricingClientId: "pricing-client-test", pricingClientSecret: "pricing-secret" }, runtime);
  assert.equal(new URLSearchParams(calls.find((call) => call.url.endsWith("/token")).options.body).get("scope"), "quotes:create");
  assert.match(calls.at(-1).url, /\/v2\/quotes$/);

  await echoSync.searchCapacity({ originCity: "Chicago" }, { offset: 0, limit: 24 }, { carrierClientId: "carrier-client-test", carrierClientSecret: "carrier-secret" }, runtime);
  assert.match(calls.at(-1).url, /\/v2\/availableloads\?offset=0&limit=30$/);
  assert.equal(calls.at(-1).options.headers.Authorization, "Bearer token-1");

  const tracking = await echoSync.shipmentTracking("12345678", { shipperUsername: "E123", shipperApiKey: "shipper-key" }, runtime);
  assert.equal(tracking.shipmentId, "12345678");
  assert.equal(tracking.tracking.events[0].status, "In transit");

  const body = Buffer.from('{"ediType":"214 Load Status Update","echoCustomerId":"E16452","loadId":57394717}');
  assert.equal(echoSync.verifyWebhook(body, "k4v2kdEU9+Lb+0YYpgKsLLHWFNB8i3w+j191ayygIPM=", "Echo-Example-Secret-2026"), true);
  assert.equal(echoSync.verifyWebhook(body, "invalid", "Echo-Example-Secret-2026"), false);
  assert.equal(echoSync.webhookId({ "x-echo-webhook-id": "wh_123" }, body), "wh_123");

  console.log("EchoSync API client tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
