const assert = require("node:assert/strict");
const test = require("node:test");
const { createState, validateState } = require("../lib/ebay-oauth-state");

const credentials = {
  clientId: "client-id",
  clientSecret: "client-secret",
  ruName: "DataPlus-DataPlus-PRD-abcdef",
  sessionToken: "signed-in-browser-session"
};

test("eBay OAuth state survives process boundaries without stored connector state", () => {
  const state = createState({ ...credentials, returnTo: "/channels/ebay?tab=setup", now: 1_000_000, nonce: "one" });
  assert.equal(validateState({ ...credentials, state, now: 1_100_000 }), "/channels/ebay?tab=setup");
});

test("parallel eBay authorization windows validate independently", () => {
  const first = createState({ ...credentials, returnTo: "/channels/ebay?tab=setup", now: 1_000_000, nonce: "first" });
  const second = createState({ ...credentials, returnTo: "/channels/ebay?tab=operations", now: 1_000_100, nonce: "second" });
  assert.equal(validateState({ ...credentials, state: first, now: 1_200_000 }), "/channels/ebay?tab=setup");
  assert.equal(validateState({ ...credentials, state: second, now: 1_200_000 }), "/channels/ebay?tab=operations");
});

test("eBay OAuth state is bound to the DataPlus browser session", () => {
  const state = createState({ ...credentials, returnTo: "/channels", now: 1_000_000 });
  assert.throws(
    () => validateState({ ...credentials, sessionToken: "another-session", state, now: 1_100_000 }),
    /did not match this DataPlus session/
  );
});

test("expired and modified eBay OAuth states are rejected", () => {
  const state = createState({ ...credentials, returnTo: "/channels", now: 1_000_000 });
  assert.throws(() => validateState({ ...credentials, state, now: 1_700_001 }), /expired/);
  assert.throws(() => validateState({ ...credentials, state: `${state.slice(0, -1)}x`, now: 1_100_000 }), /did not match/);
});
