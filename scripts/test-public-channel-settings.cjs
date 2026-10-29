const assert = require("node:assert/strict");

const { publicChannelSettings, publicConnection } = require("../server");

const secretValues = ["app-key-value", "app-secret-value", "access-token-value", "webhook-token-value", "future-secret-value"];
const connection = publicConnection({
  id: "channel-test",
  name: "Temu",
  connected: true,
  settings: {
    channelEnabled: true,
    temuAppKey: secretValues[0],
    temuAppSecret: secretValues[1],
    temuAccessToken: secretValues[2],
    ebayWebhookVerificationToken: secretValues[3],
    futureProvider: { signingSecret: secretValues[4], region: "us-east" }
  }
});

assert.equal(connection.settings.channelEnabled, true);
assert.equal(connection.settings.temuAppKey, "");
assert.equal(connection.settings.temuAppKeyConfigured, true);
assert.equal(connection.settings.temuAppSecret, "");
assert.equal(connection.settings.temuAppSecretConfigured, true);
assert.equal(connection.settings.temuAccessToken, "");
assert.equal(connection.settings.temuAccessTokenConfigured, true);
assert.equal(connection.settings.ebayWebhookVerificationToken, "");
assert.equal(connection.settings.ebayWebhookVerificationTokenConfigured, true);
assert.equal(connection.settings.futureProvider.signingSecret, "");
assert.equal(connection.settings.futureProvider.signingSecretConfigured, true);
assert.equal(connection.settings.futureProvider.region, "us-east");

const serialized = JSON.stringify(connection);
for (const secret of secretValues) assert.equal(serialized.includes(secret), false);

const alreadyPublic = publicChannelSettings({ webhookSecretConfigured: true, tokenExpiresAt: "2026-10-29T00:00:00.000Z" });
assert.equal(alreadyPublic.webhookSecretConfigured, true);
assert.equal(alreadyPublic.tokenExpiresAt, "2026-10-29T00:00:00.000Z");

console.log("Public channel settings redact stored credentials.");
