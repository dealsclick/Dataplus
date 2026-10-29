const assert = require("node:assert/strict");
const test = require("node:test");
const { createState, validateState } = require("../lib/channel-oauth-state");

const credentials = {
  provider: "Temu",
  clientId: "app-key",
  signingSecret: "app-secret",
  redirectUri: "https://dataplus.example/auth/temu/callback",
  sessionToken: "signed-in-browser-session"
};

test("channel OAuth state survives restarts and retains callback context", () => {
  const state = createState({
    ...credentials,
    returnTo: "/channels?channel=Temu",
    data: { actorId: "user-1" },
    now: 1_000_000,
    nonce: "one"
  });
  const result = validateState({ ...credentials, state, now: 1_100_000 });
  assert.equal(result.returnTo, "/channels?channel=Temu");
  assert.equal(result.data.actorId, "user-1");
});

test("parallel channel authorization windows validate independently", () => {
  const first = createState({ ...credentials, returnTo: "/channels/temu", now: 1_000_000, nonce: "first" });
  const second = createState({ ...credentials, returnTo: "/channels/temu?tab=orders", now: 1_000_100, nonce: "second" });
  assert.equal(validateState({ ...credentials, state: first, now: 1_200_000 }).returnTo, "/channels/temu");
  assert.equal(validateState({ ...credentials, state: second, now: 1_200_000 }).returnTo, "/channels/temu?tab=orders");
});

test("channel OAuth state is bound to the provider and DataPlus session", () => {
  const state = createState({ ...credentials, now: 1_000_000 });
  assert.throws(
    () => validateState({ ...credentials, sessionToken: "another-session", state, now: 1_100_000 }),
    /did not match this DataPlus session/
  );
  assert.throws(
    () => validateState({ ...credentials, provider: "Veeqo", state, now: 1_100_000 }),
    /did not match|invalid/
  );
});

test("expired and modified channel OAuth states are rejected", () => {
  const state = createState({ ...credentials, now: 1_000_000 });
  assert.throws(() => validateState({ ...credentials, state, now: 1_700_001 }), /expired/);
  assert.throws(() => validateState({ ...credentials, state: `${state.slice(0, -1)}x`, now: 1_100_000 }), /did not match/);
});
