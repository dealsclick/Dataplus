const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { LoteriaGame } = require("../lib/loteria-game");
const { createLoteriaHttp } = require("../lib/loteria-http");

const deck = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "web", "public", "loteria", "deck.json"), "utf8")).cards;
let now = 1_000;
const game = new LoteriaGame(deck, { random: () => 0.42, now: () => now });
assert.equal(game.cards.find((card) => card.id === "cosecha")?.originalImage, "/loteria/cards/originals/la-cosecha.jpg", "deck retains optional original photo paths");
const configuredGame = new LoteriaGame(deck, { random: () => 0.21, now: () => now });
const configured = configuredGame.createRoom({ publicUrl: "https://game.example", intervalSeconds: 8 });
assert.equal(configured.state.tvUrl, `https://game.example/tv/${configured.code}`, "room exposes the short TV URL");
const selectedCardIds = configuredGame.cards.slice(0, 16).map((card) => card.id);
assert.throws(() => configuredGame.hostAction(configured.code, configured.hostToken, "set-cards", { enabledCardIds: selectedCardIds.slice(0, 15) }), /at least 16|al menos 16/i, "host cannot enable fewer than 16 cards");
const configuredState = configuredGame.hostAction(configured.code, configured.hostToken, "set-cards", { enabledCardIds: selectedCardIds });
assert.deepStrictEqual(configuredState.enabledCardIds, selectedCardIds, "host selection is authoritative");
const renamedState = configuredGame.hostAction(configured.code, configured.hostToken, "set-card-name", { cardId: selectedCardIds[0], nameEs: "La Carta Familiar", nameEn: "The Family Card" });
assert.equal(renamedState.cards.find((card) => card.id === selectedCardIds[0]).nameEs, "La Carta Familiar", "host can rename a card for the room");
const configuredPlayer = configuredGame.join(configured.code, "Deck Tester");
assert.equal(configuredPlayer.state.player.board.find((card) => card.id === selectedCardIds[0])?.nameEs, "La Carta Familiar", "room card names reach player boards");
assert(configuredPlayer.state.player.board.every((card) => selectedCardIds.includes(card.id)), "boards only contain enabled cards");
configuredGame.hostAction(configured.code, configured.hostToken, "start");
assert.throws(() => configuredGame.hostAction(configured.code, configured.hostToken, "set-cards", { enabledCardIds: selectedCardIds }), /before|antes/i, "cards cannot change after the round starts");
assert.throws(() => configuredGame.hostAction(configured.code, configured.hostToken, "set-card-name", { cardId: selectedCardIds[0], nameEs: "Muy tarde" }), /before|antes/i, "card names cannot change after the round starts");
const created = game.createRoom({ publicUrl: "https://game.example", intervalSeconds: 8 });
const first = game.join(created.code, "Ana");
const second = game.join(created.code, "Beto");
const boardBeforeRefresh = first.state.player.board.map((card) => card.id);
const reconnected = game.join(created.code, "Ana", first.playerToken);
assert.deepStrictEqual(reconnected.state.player.board.map((card) => card.id), boardBeforeRefresh, "reconnect keeps the board");

game.hostAction(created.code, created.hostToken, "start");
const room = game.getRoom(created.code);
const winningIds = boardBeforeRefresh.slice(0, 4);
room.deck = [...winningIds, ...room.deck.filter((id) => !winningIds.includes(id))];

now += 3_000;
game.tick(now);
assert.strictEqual(room.called.length, 1, "first automatic call happens after countdown");
game.hostAction(created.code, created.hostToken, "pause");
now += 20_000;
game.tick(now);
assert.strictEqual(room.called.length, 1, "pause stops automatic calls");
game.hostAction(created.code, created.hostToken, "resume");

for (let index = 1; index < 4; index += 1) {
  now += 8_000;
  game.tick(now);
}
assert.deepStrictEqual(room.called.slice(0, 4), winningIds, "deck calls each configured card once");
for (const cardId of winningIds) game.mark(created.code, first.playerToken, cardId);

const invalid = game.claim(created.code, second.playerToken);
assert.strictEqual(invalid.valid, false, "invalid claim does not stop the round");
assert.strictEqual(room.status, "playing");
const winner = game.claim(created.code, first.playerToken);
assert.strictEqual(winner.valid, true, "a complete called and marked line wins");
assert.strictEqual(room.status, "won");
assert.strictEqual(room.winner.name, "Ana");
assert.strictEqual(game.claim(created.code, second.playerToken).valid, false, "only the first valid claim can win");

game.hostAction(created.code, created.hostToken, "new-round");
assert.strictEqual(room.status, "lobby");
assert.strictEqual(room.players.get(first.playerToken).marks.size, 0);
assert.strictEqual(room.players.get(first.playerToken).board.length, 16);

game.hostAction(created.code, created.hostToken, "start");
const late = game.join(created.code, "Carla");
assert.strictEqual(late.state.player.queued, true, "late arrivals wait for the next round");
assert.strictEqual(late.state.player.board.length, 0);
game.hostAction(created.code, created.hostToken, "new-round");
assert.strictEqual(room.players.get(late.playerToken).queued, false);
assert.strictEqual(room.players.get(late.playerToken).board.length, 16);

game.hostAction(created.code, created.hostToken, "start");
room.deck = [room.players.get(first.playerToken).board[0]];
now += 3_000;
game.tick(now);
assert.strictEqual(room.status, "playing", "the last card keeps one final claim interval open");
now += room.intervalSeconds * 1000 - 1;
game.tick(now);
assert.strictEqual(room.status, "playing", "the room stays claimable for the full final interval");
now += 1;
game.tick(now);
assert.strictEqual(room.status, "ended", "the round ends after the final claim interval");

async function testHttpAdapter() {
  async function parseBody(req) { return req.testBody || {}; }
  function sendJson(res, status, value) {
    res.status = status;
    res.value = value;
  }
  const adapter = createLoteriaHttp({ root: path.join(__dirname, ".."), parseBody, sendJson });
  const response = () => ({});
  const request = (method, url, testBody = {}) => ({ method, url, testBody, headers: { host: "game.example" }, socket: { encrypted: false } });
  const createResponse = response();
  await adapter.handle(request("POST", "/api/loteria/rooms", { intervalSeconds: 7 }), createResponse, new URL("http://game.example/api/loteria/rooms"));
  assert.strictEqual(createResponse.status, 201);
  const createdRoom = createResponse.value;
  const stateResponse = response();
  await adapter.handle(request("GET", `/api/loteria/rooms/${createdRoom.code}`), stateResponse, new URL(`http://game.example/api/loteria/rooms/${createdRoom.code}`));
  assert.strictEqual(stateResponse.status, 200, "room state route resolves the numeric code segment");
  const joinResponse = response();
  await adapter.handle(request("POST", `/api/loteria/rooms/${createdRoom.code}/join`, { name: "HTTP Player" }), joinResponse, new URL(`http://game.example/api/loteria/rooms/${createdRoom.code}/join`));
  assert.strictEqual(joinResponse.status, 200, "join route resolves the action after the code");
  assert.strictEqual(joinResponse.value.state.player.name, "HTTP Player");
}

testHttpAdapter()
  .then(() => console.log("Lotería multiplayer lifecycle and HTTP adapter tests passed."))
  .catch((error) => { console.error(error); process.exitCode = 1; });
