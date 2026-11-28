const assert = require("assert");
const { WeddingPredictionsGame } = require("../lib/wedding-predictions-game");
const { createWeddingPredictionsHttp } = require("../lib/wedding-predictions-http");

let now = 1_000;
const game = new WeddingPredictionsGame({ random: () => 0.42, now: () => now });
const created = game.createRoom({ publicUrl: "https://games.example", coupleName: "Natalie & Byron" });
const guest = game.join(created.code, "Luis");
assert.strictEqual(guest.state.player.balance, 1000, "guests start with fake credits");
game.hostAction(created.code, created.hostToken, "create", {
  category: "Fashion",
  title: "Will someone break a heel?",
  description: "A snapped heel counts.",
  overLabel: "Yes",
  underLabel: "No",
});
assert.strictEqual(game.getRoom(created.code).markets[0].title, "Will someone break a heel?", "host can create a custom market");
const marketId = guest.state.markets[0].id;
const afterBet = game.placeBet(created.code, guest.playerToken, { marketId, outcome: "over", credits: 100 });
assert.strictEqual(afterBet.player.balance, 900, "placing a pick deducts credits");
assert.strictEqual(afterBet.player.positions.length, 1, "position is recorded");
assert(afterBet.markets.find((market) => market.id === marketId).prices.over > 50, "crowd price moves toward the selected outcome");
game.hostAction(created.code, created.hostToken, "lock", { marketId });
assert.throws(() => game.placeBet(created.code, guest.playerToken, { marketId, outcome: "under", credits: 10 }), /not accepting/i);
now += 5_000;
game.hostAction(created.code, created.hostToken, "resolve", { marketId, outcome: "over" });
const settled = game.snapshot(game.getRoom(created.code), guest.playerToken);
assert.strictEqual(settled.player.positions[0].won, true, "winning pick settles correctly");
assert(settled.player.balance > 900, "winner receives the fake-credit payout");

async function testHttpAdapter() {
  async function parseBody(req) { return req.testBody || {}; }
  function sendJson(res, status, value) { res.status = status; res.value = value; }
  const adapter = createWeddingPredictionsHttp({ parseBody, sendJson });
  const request = (method, url, testBody = {}, headers = {}) => ({ method, url, testBody, headers: { host: "games.example", ...headers }, socket: { encrypted: false } });
  const createResponse = {};
  await adapter.handle(request("POST", "/api/wedding-predictions/rooms", { coupleName: "Natalie & Byron" }), createResponse, new URL("http://games.example/api/wedding-predictions/rooms"));
  assert.strictEqual(createResponse.status, 201);
  const joinResponse = {};
  await adapter.handle(request("POST", `/api/wedding-predictions/rooms/${createResponse.value.code}/join`, { name: "Guest" }), joinResponse, new URL(`http://games.example/api/wedding-predictions/rooms/${createResponse.value.code}/join`));
  assert.strictEqual(joinResponse.value.state.player.name, "Guest");
}

testHttpAdapter()
  .then(() => console.log("Wedding predictions multiplayer lifecycle and HTTP adapter tests passed."))
  .catch((error) => { console.error(error); process.exitCode = 1; });

