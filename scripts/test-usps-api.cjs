const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { createCarrierCredentials } = require("../lib/carrier-credentials");
const usps = require("../lib/usps-api");

async function run() {
  const directory = fs.mkdtempSync(path.join(__dirname, ".usps-credentials-"));
  const originalFetch = global.fetch;
  try {
    const credentials = createCarrierCredentials({ directory, env: {} });
    assert.equal(credentials.uspsStatus().configured, false);
    const saved = credentials.saveUsps("production", {
      clientId: "consumer-key",
      clientSecret: "consumer-secret",
      crid: "1234567890",
      mid: "987654321",
      accountType: "EPS",
      accountNumber: "2468013579",
      webhookAdminEmail: "shipping@example.com",
    });
    assert.equal(saved.configured, true);
    assert.equal(saved.cridConfigured, true);
    assert.equal(saved.midConfigured, true);
    assert.equal(saved.accountEnding, "3579");
    assert.equal(saved.webhookSecretConfigured, true);
    assert.equal(Object.prototype.hasOwnProperty.call(saved, "clientSecret"), false);
    const runtime = credentials.getUsps("production");
    assert.equal(runtime.clientSecret, "consumer-secret");
    assert.equal(runtime.webhookSecret.length, 32);
    assert.equal(usps.config({}, runtime).baseUrl, "https://apis.usps.com");

    global.fetch = async (url, options) => {
      assert.equal(url, "https://apis.usps.com/oauth2/v3/token");
      assert.deepEqual(JSON.parse(options.body), { grant_type: "client_credentials", client_id: "consumer-key", client_secret: "consumer-secret" });
      return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: "hidden-token", expires_in: 3600, scope: "addresses prices tracking", token_type: "Bearer" }) };
    };
    const verified = await usps.verifyCredentials(runtime, {});
    assert.equal(verified.environment, "production");
    assert.equal(verified.expiresIn, 3600);
    assert.equal(verified.capabilities.find((row) => row.id === "tracking").status, "ready");
    assert.equal(Object.prototype.hasOwnProperty.call(verified, "accessToken"), false);

    global.fetch = async (url, options) => {
      assert.equal(url, "https://apis.usps.com/prices/v3/total-rates/search");
      const body = JSON.parse(options.body);
      assert.equal(body.originZIPCode, "10303");
      assert.equal(body.destinationZIPCode, "92377");
      assert.equal(body.priceType, "CONTRACT");
      assert.deepEqual(body.mailClasses, ["USPS_GROUND_ADVANTAGE", "PRIORITY_MAIL", "PRIORITY_MAIL_EXPRESS"]);
      return { ok: true, status: 200, text: async () => JSON.stringify({ rateOptions: [{ totalPrice: 7.42, rates: [{ mailClass: "USPS_GROUND_ADVANTAGE", SKU: "GROUND", priceType: "CONTRACT", rateIndicator: "SP" }] }, { totalPrice: 14.2, rates: [{ mailClass: "PRIORITY_MAIL", SKU: "PRIORITY", priceType: "CONTRACT" }] }] }) };
    };
    const rates = await usps.shopRates({
      from: { postalCode: "10303" },
      to: { postalCode: "92377" },
      package: { weight: 2, length: 12, width: 9, height: 5, weightUnit: "lb", dimensionUnit: "in" },
    }, {}, runtime);
    assert.equal(rates.rates.length, 2);
    assert.equal(rates.rates[0].provider, "usps_direct");
    assert.equal(rates.rates[0].service, "USPS Ground Advantage");

    const trackingPayload = [{
      trackingNumber: "9400111899223856928499",
      uniqueTrackingID: "unique-id",
      mailingDate: "2026-10-28",
      status: "Delivered, Front Door/Porch",
      statusSummary: "Your item was delivered.",
      mailClass: "USPS Ground Advantage",
      servicesEligibility: { proofOfDeliveryEnabled: true, RREEnabled: false },
      trackingEvents: [{ eventType: "Delivered, Front Door/Porch", GMTTimestamp: "2026-10-30T16:00:00Z", eventCity: "STATEN ISLAND", eventState: "NY", eventZIPCode: "10303", recipientName: "J SMITH", veriPoint: true }],
    }];
    const tracking = usps.parseTrackingResponse(trackingPayload, "9400111899223856928499");
    assert.equal(tracking.status, "delivered");
    assert.equal(tracking.physicalScan, true);
    assert.equal(tracking.deliveryEvidence.proofOfDeliveryAvailable, true);
    assert.equal(tracking.deliveryEvidence.receivedBy, "J SMITH");
    assert.equal(tracking.uniqueTrackingID, "unique-id");

    const notification = { timestamp: "2026-10-30T16:00:00Z", payload: JSON.stringify({ trackingNumber: "9400111899223856928499" }) };
    const hmac = crypto.createHmac("sha256", runtime.webhookSecret).update(`${notification.timestamp}${notification.payload}`).digest("base64");
    assert.equal(usps.verifyTrackingNotification(notification, hmac, runtime.webhookSecret), true);
    assert.equal(usps.verifyTrackingNotification(notification, Buffer.from("wrong").toString("base64"), runtime.webhookSecret), false);

    const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
    const ui = fs.readFileSync(path.join(__dirname, "..", "web", "src", "components", "carrier-provider-settings.tsx"), "utf8");
    assert.match(server, /\/api\/shipping-providers\/usps\/credentials/);
    assert.match(server, /\/api\/shipping-providers\/usps\/test/);
    assert.match(server, /\/api\/webhooks\/usps\/tracking/);
    assert.match(server, /refreshUspsShipmentTracking/);
    assert.match(ui, /Configure USPS/);
    assert.match(ui, /USPS Ship/);
    console.log("USPS API integration tests passed.");
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
