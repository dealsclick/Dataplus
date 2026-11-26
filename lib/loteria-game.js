const crypto = require("crypto");

const WINNING_LINES = [
  [0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15],
  [0, 4, 8, 12], [1, 5, 9, 13], [2, 6, 10, 14], [3, 7, 11, 15],
  [0, 5, 10, 15], [3, 6, 9, 12]
];

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function shuffle(values, random = Math.random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function validDeck(cards) {
  if (!Array.isArray(cards)) return [];
  const seen = new Set();
  return cards.filter((card) => {
    const id = String(card?.id || "").trim();
    const nameEs = String(card?.nameEs || "").trim();
    if (!id || !nameEs || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).map((card) => ({
    id: String(card.id),
    nameEs: String(card.nameEs),
    nameEn: String(card.nameEn || card.nameEs),
    image: String(card.image || ""),
    symbol: String(card.symbol || "✦")
  }));
}

class LoteriaGame {
  constructor(cards, options = {}) {
    this.cards = validDeck(cards);
    this.random = options.random || Math.random;
    this.now = options.now || (() => Date.now());
    this.rooms = new Map();
    this.listeners = new Map();
  }

  createRoom(options = {}) {
    if (this.cards.length < 16) throw new Error("La baraja necesita al menos 16 cartas válidas y distintas.");
    let code;
    do code = String(Math.floor(1000 + this.random() * 9000)); while (this.rooms.has(code));
    const room = {
      code,
      hostToken: randomToken(),
      publicUrl: String(options.publicUrl || "").replace(/\/$/, ""),
      status: "lobby",
      round: 1,
      intervalSeconds: Math.max(3, Math.min(30, Number(options.intervalSeconds || 8))),
      countdownSeconds: 3,
      players: new Map(),
      deck: [],
      called: [],
      currentCardId: "",
      nextCallAt: null,
      pausedRemainingMs: null,
      winner: null,
      endedReason: "",
      createdAt: new Date(this.now()).toISOString()
    };
    this.rooms.set(code, room);
    return { code, hostToken: room.hostToken, state: this.snapshot(room) };
  }

  getRoom(code) {
    const room = this.rooms.get(String(code || "").toUpperCase());
    if (!room) throw Object.assign(new Error("No encontramos esa sala."), { statusCode: 404 });
    return room;
  }

  requireHost(room, token) {
    if (!token || token !== room.hostToken) throw Object.assign(new Error("El enlace privado del anfitrión no es válido."), { statusCode: 403 });
  }

  join(code, name, existingToken = "") {
    const room = this.getRoom(code);
    const cleanName = String(name || "").trim().slice(0, 28);
    if (!cleanName) throw Object.assign(new Error("Escribe tu nombre para entrar."), { statusCode: 400 });
    const existing = existingToken && room.players.get(existingToken);
    if (existing) {
      existing.connected = true;
      existing.name = cleanName;
      this.emit(room);
      return { playerToken: existing.token, state: this.snapshot(room, existing.token) };
    }
    const token = randomToken();
    const active = room.status === "lobby";
    const player = {
      token,
      id: randomToken(8),
      name: cleanName,
      board: active ? shuffle(this.cards, this.random).slice(0, 16).map((card) => card.id) : [],
      marks: new Set(),
      queued: !active,
      connected: true,
      joinedAt: new Date(this.now()).toISOString(),
      claimMessage: ""
    };
    room.players.set(token, player);
    this.emit(room);
    return { playerToken: token, state: this.snapshot(room, token) };
  }

  mark(code, playerToken, cardId) {
    const room = this.getRoom(code);
    const player = room.players.get(playerToken);
    if (!player) throw Object.assign(new Error("Vuelve a entrar a la sala."), { statusCode: 401 });
    if (player.queued || !player.board.length) throw Object.assign(new Error("Entraste durante la ronda. Tu tabla estará lista en la próxima."), { statusCode: 409 });
    if (!["playing", "paused", "countdown"].includes(room.status)) throw Object.assign(new Error("La ronda todavía no está activa."), { statusCode: 409 });
    if (!player.board.includes(cardId)) throw Object.assign(new Error("Esa carta no está en tu tabla."), { statusCode: 400 });
    if (!room.called.includes(cardId)) throw Object.assign(new Error("Esa carta todavía no ha sido cantada."), { statusCode: 409 });
    if (player.marks.has(cardId)) player.marks.delete(cardId); else player.marks.add(cardId);
    player.claimMessage = "";
    this.emit(room);
    return this.snapshot(room, playerToken);
  }

  claim(code, playerToken) {
    const room = this.getRoom(code);
    const player = room.players.get(playerToken);
    if (!player) throw Object.assign(new Error("Vuelve a entrar a la sala."), { statusCode: 401 });
    if (room.winner) return { valid: false, reason: "Otra persona ganó primero.", state: this.snapshot(room, playerToken) };
    if (!["playing", "paused"].includes(room.status)) return { valid: false, reason: "La ronda no está aceptando reclamos.", state: this.snapshot(room, playerToken) };
    if (player.queued || !player.board.length) return { valid: false, reason: "Tu tabla entra en la próxima ronda.", state: this.snapshot(room, playerToken) };
    const called = new Set(room.called);
    const line = WINNING_LINES.find((indexes) => indexes.every((index) => {
      const id = player.board[index];
      return player.marks.has(id) && called.has(id);
    }));
    if (!line) {
      player.claimMessage = "Aún no tienes una línea completa: las cuatro cartas deben estar marcadas y cantadas.";
      this.emit(room);
      return { valid: false, reason: player.claimMessage, state: this.snapshot(room, playerToken) };
    }
    room.winner = { playerId: player.id, name: player.name, line, cardIds: line.map((index) => player.board[index]) };
    room.status = "won";
    room.nextCallAt = null;
    player.claimMessage = "¡Lotería válida!";
    this.emit(room);
    return { valid: true, state: this.snapshot(room, playerToken) };
  }

  hostAction(code, hostToken, action, options = {}) {
    const room = this.getRoom(code);
    this.requireHost(room, hostToken);
    if (options.intervalSeconds !== undefined) room.intervalSeconds = Math.max(3, Math.min(30, Number(options.intervalSeconds) || 8));
    const now = this.now();
    if (action === "start") {
      if (room.status !== "lobby") throw Object.assign(new Error("Prepara una ronda nueva antes de iniciar."), { statusCode: 409 });
      if (this.cards.length < 16) throw Object.assign(new Error("La baraja necesita al menos 16 cartas válidas y distintas."), { statusCode: 409 });
      if (![...room.players.values()].some((player) => !player.queued)) throw Object.assign(new Error("Espera a que entre al menos un jugador."), { statusCode: 409 });
      room.deck = shuffle(this.cards.map((card) => card.id), this.random);
      room.called = [];
      room.currentCardId = "";
      room.winner = null;
      room.endedReason = "";
      room.status = "countdown";
      room.nextCallAt = now + room.countdownSeconds * 1000;
    } else if (action === "pause") {
      if (!["countdown", "playing"].includes(room.status)) throw Object.assign(new Error("La ronda no se puede pausar ahora."), { statusCode: 409 });
      room.pausedRemainingMs = Math.max(0, Number(room.nextCallAt || now) - now);
      room.status = "paused";
      room.nextCallAt = null;
    } else if (action === "resume") {
      if (room.status !== "paused") throw Object.assign(new Error("La ronda no está pausada."), { statusCode: 409 });
      room.status = room.called.length ? "playing" : "countdown";
      room.nextCallAt = now + Math.max(250, Number(room.pausedRemainingMs || 0));
      room.pausedRemainingMs = null;
    } else if (action === "new-round") {
      room.round += 1;
      room.status = "lobby";
      room.deck = [];
      room.called = [];
      room.currentCardId = "";
      room.nextCallAt = null;
      room.pausedRemainingMs = null;
      room.winner = null;
      room.endedReason = "";
      for (const player of room.players.values()) {
        player.board = shuffle(this.cards, this.random).slice(0, 16).map((card) => card.id);
        player.marks = new Set();
        player.queued = false;
        player.claimMessage = "";
      }
    } else {
      throw Object.assign(new Error("Acción del anfitrión no compatible."), { statusCode: 400 });
    }
    this.emit(room);
    return this.snapshot(room);
  }

  tick(now = this.now()) {
    for (const room of this.rooms.values()) {
      if (!["countdown", "playing"].includes(room.status) || !room.nextCallAt || now < room.nextCallAt) continue;
      if (!room.deck.length) {
        room.status = "ended";
        room.nextCallAt = null;
        room.endedReason = "La baraja terminó sin ganador.";
        this.emit(room);
        continue;
      }
      const cardId = room.deck.shift();
      room.called.push(cardId);
      room.currentCardId = cardId;
      room.status = "playing";
      room.nextCallAt = now + room.intervalSeconds * 1000;
      this.emit(room);
    }
  }

  snapshot(room, playerToken = "") {
    const byId = new Map(this.cards.map((card) => [card.id, card]));
    const player = playerToken ? room.players.get(playerToken) : null;
    const currentCard = byId.get(room.currentCardId) || null;
    return {
      code: room.code,
      status: room.status,
      round: room.round,
      intervalSeconds: room.intervalSeconds,
      countdownSeconds: room.countdownSeconds,
      publicUrl: room.publicUrl,
      joinUrl: `${room.publicUrl || ""}/loteria/${room.code}`,
      tvUrl: `${room.publicUrl || ""}/loteria/tv/${room.code}`,
      playerCount: room.players.size,
      players: [...room.players.values()].map((entry) => ({ id: entry.id, name: entry.name, queued: entry.queued, connected: entry.connected })),
      cards: this.cards,
      currentCard,
      recentCards: room.called.slice(-5).reverse().map((id) => byId.get(id)).filter(Boolean),
      calledCardIds: [...room.called],
      nextCallAt: room.nextCallAt,
      winner: room.winner,
      endedReason: room.endedReason,
      player: player ? {
        id: player.id,
        name: player.name,
        queued: player.queued,
        board: player.board.map((id) => byId.get(id)).filter(Boolean),
        marks: [...player.marks],
        claimMessage: player.claimMessage
      } : null
    };
  }

  subscribe(code, listener) {
    this.getRoom(code);
    const set = this.listeners.get(code) || new Set();
    set.add(listener);
    this.listeners.set(code, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.listeners.delete(code);
    };
  }

  emit(room) {
    for (const listener of this.listeners.get(room.code) || []) listener();
  }
}

module.exports = { LoteriaGame, WINNING_LINES, shuffle, validDeck };
