const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { createCarrierCredentials } = require("../lib/carrier-credentials");
const upsRating = require("../lib/ups-rating");

async function run() {
  const directory = fs.mkdtempSync(path.join(__dirname, ".carrier-credentials-"));
  const originalFetch = global.fetch;
  try {
  const credentials = createCarrierCredentials({ directory, env: {} });
  assert.equal(credentials.status().configured, false);
  assert.throws(() => credentials.saveUps("production", { clientId: "client", clientSecret: "secret", accountNumber: "short" }), /6-character/);

  const saved = credentials.saveUps("production", { clientId: "client-id", clientSecret: "secret-value", accountNumber: "6E27E5" });
  assert.equal(saved.configured, true);
  assert.equal(saved.environment, "production");
  assert.equal(saved.accountEnding, "27E5");
  assert.equal(saved.secretConfigured, true);
  assert.equal(Object.prototype.hasOwnProperty.call(saved, "clientSecret"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(saved.environments.production, "clientSecret"), false);

  const runtime = credentials.getUps("production");
  assert.equal(runtime.clientSecret, "secret-value");
  assert.equal(runtime.accountNumber, "6E27E5");
  const config = upsRating.config({}, runtime);
  assert.equal(config.configured, true);
  assert.equal(config.environment, "production");
  assert.equal(config.baseUrl, "https://onlinetools.ups.com");
  global.fetch = async (url, options) => {
    assert.equal(url, "https://onlinetools.ups.com/security/v1/oauth/token");
    assert.equal(options.headers["x-merchant-id"], "6E27E5");
    assert.match(options.headers.authorization, /^Basic /);
    assert.equal(options.body, "grant_type=client_credentials");
    return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: "must-not-be-returned", expires_in: "3600", status: "approved" }) };
  };
  const verification = await upsRating.verifyCredentials(runtime, {});
  assert.equal(verification.environment, "production");
  assert.equal(verification.expiresIn, 3600);
  assert.equal(Object.prototype.hasOwnProperty.call(verification, "accessToken"), false);

  credentials.recordUpsTest("production", { ok: true, message: "Verified." });
  assert.equal(credentials.status().lastTestStatus, "verified");
  assert.equal(credentials.status().lastTestMessage, "Verified.");
  credentials.recordUpsTest("test", { ok: false, message: "Rejected." });
  assert.equal(credentials.status().environment, "production");

  credentials.saveUps("test", { clientId: "test-client", clientSecret: "test-secret", accountNumber: "ABC123" });
  assert.equal(credentials.status().environment, "test");
  assert.equal(upsRating.config({}, credentials.getUps()).baseUrl, "https://wwwcie.ups.com");
  assert.equal(upsRating.config({ UPS_TEST_MODE: "true", UPS_CLIENT_ID: "legacy", UPS_CLIENT_SECRET: "secret", UPS_ACCOUNT_NUMBER: "ABC123" }).configured, true);

  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const ui = fs.readFileSync(path.join(__dirname, "..", "web", "src", "components", "carrier-provider-settings.tsx"), "utf8");
  assert.match(server, /\/api\/shipping-providers\/ups\/credentials/);
  assert.match(server, /\/api\/shipping-providers\/ups\/test/);
  assert.match(server, /method === "GET" \? "settings" : "settings\.security"/);
  assert.match(ui, /Verify and save/);
  for (const provider of ["FedEx", "USPS", "DHL Express", "OnTrac", "Amazon Shipping"]) assert.match(server, new RegExp(provider));
  assert.match(ui, /plannedProviderOrder/);

  console.log("Carrier credential tests passed.");
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
