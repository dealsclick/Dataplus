const crypto = require("crypto");

const STARTING_CREDITS = 1000;
const PAYOUT_PER_SHARE = 100;

const DEFAULT_MARKETS = [
  {
    id: "natalies-dad-speech-over-one-minute",
    category: "Speeches",
    title: "Will Natalie's dad's speech last over or under 1 minute?",
    description: "Time starts with the first spoken word and ends after the final toast.",
    overLabel: "Over 1 minute",
    underLabel: "Under 1 minute",
  },
  {
    id: "natalies-mom-speech-over-one-minute",
    category: "Speeches",
    title: "Will Natalie's mom's speech last over or under 1 minute?",
    description: "Time starts with the first spoken word and ends after the final toast.",
    overLabel: "Over 1 minute",
    underLabel: "Under 1 minute",
  },
  {
    id: "byrons-mom-speech-over-one-minute",
    category: "Speeches",
    title: "Will Byron's mom's speech last over or under 1 minute?",
    description: "Time starts with the first spoken word and ends after the final toast.",
    overLabel: "Over 1 minute",
    underLabel: "Under 1 minute",
  },
  {
    id: "byrons-dad-speech-over-one-minute",
    category: "Speeches",
    title: "Will Byron's dad's speech last over or under 1 minute?",
    description: "Time starts with the first spoken word and ends after the final toast.",
    overLabel: "Over 1 minute",
    underLabel: "Under 1 minute",
  },
  {
    id: "vows-happy-tears",
    category: "Ceremony",
    title: "Will Natalie or Byron cry during the vows?",
    description: "A visible happy tear from either newlywed counts.",
    overLabel: "Yes, tears",
    underLabel: "No tears",
  },
  {
    id: "first-dance-over-three-minutes",
    category: "Reception",
    title: "Will the first dance last over 3 minutes?",
    description: "Time runs from the first note until the couple leaves the dance floor.",
    overLabel: "Over 3 minutes",
    underLabel: "Under 3 minutes",
  },
  {
    id: "cake-smash",
    category: "Reception",
    title: "Will there be a cake smash?",
    description: "Frosting deliberately placed on either newlywed's face counts.",
    overLabel: "Yes, smash",
    underLabel: "No smash",
  },
  {
    id: "guest-trip-after-drinks",
    category: "Wild cards",
    title: "Will a guest trip on the dance floor after the bar opens?",
    description: "A clear stumble that ends on the floor counts. Keep names out of it—this is all in good fun.",
    overLabel: "Yes, a tumble",
    underLabel: "Everyone stays up",
  },
  {
    id: "broken-heel-or-shoe",
    category: "Fashion",
    title: "Will someone break a heel or dress shoe?",
    description: "A snapped heel, sole, or strap during the reception counts.",
    overLabel: "Yes, shoe down",
    underLabel: "All shoes survive",
  },
  {
    id: "dress-emergency",
    category: "Fashion",
    title: "Will there be a dress or outfit emergency?",
    description: "A rip, spill, stuck zipper, or safety-pin rescue counts.",
    overLabel: "Yes, emergency",
    underLabel: "No wardrobe drama",
  },
  {
    id: "newlywed-disagreement",
    category: "Wild cards",
    title: "Will the newlyweds have a visible disagreement?",
    description: "Only a playful or unmistakable public disagreement counts—private moments are off limits.",
    overLabel: "Yes, a moment",
    underLabel: "Harmony all night",
  },
];

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function cleanText(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function marketPrices(market) {
  const overPool = 500 + Number(market.pool.over || 0);
  const underPool = 500 + Number(market.pool.under || 0);
  const over = Math.max(10, Math.min(90, Math.round((overPool / (overPool + underPool)) * 100)));
  return { over, under: 100 - over };
}

class WeddingPredictionsGame {
  constructor(options = {}) {
    this.random = options.random || Math.random;
    this.now = options.now || (() => Date.now());
    this.rooms = new Map();
    this.listeners = new Map();
  }

  createRoom(options = {}) {
    let code;
    do code = String(Math.floor(1000 + this.random() * 9000)); while (this.rooms.has(code));
    const room = {
      code,
      hostToken: randomToken(),
      publicUrl: cleanText(options.publicUrl, 500).replace(/\/$/, ""),
      coupleName: cleanText(options.coupleName, 60) || "Natalie & Byron",
      eventDate: cleanText(options.eventDate, 30),
      players: new Map(),
      markets: DEFAULT_MARKETS.map((market) => ({ ...market, status: "open", result: "", pool: { over: 0, under: 0 }, resolvedAt: "" })),
      createdAt: new Date(this.now()).toISOString(),
    };
    this.rooms.set(code, room);
    return { code, hostToken: room.hostToken, state: this.snapshot(room) };
  }

  getRoom(code) {
    const room = this.rooms.get(String(code || "").toUpperCase());
    if (!room) throw Object.assign(new Error("We couldn't find that wedding room."), { statusCode: 404 });
    return room;
  }

  requireHost(room, token) {
    if (!token || token !== room.hostToken) throw Object.assign(new Error("That private host link is not valid."), { statusCode: 403 });
  }

  requirePlayer(room, token) {
    const player = room.players.get(String(token || ""));
    if (!player) throw Object.assign(new Error("Please join the room again."), { statusCode: 401 });
    return player;
  }

  join(code, name, existingToken = "") {
    const room = this.getRoom(code);
    const cleanName = cleanText(name, 28);
    if (!cleanName) throw Object.assign(new Error("Enter your name to join."), { statusCode: 400 });
    const existing = existingToken && room.players.get(existingToken);
    if (existing) {
      existing.name = cleanName;
      this.emit(room);
      return { playerToken: existing.token, state: this.snapshot(room, existing.token) };
    }
    const token = randomToken();
    room.players.set(token, {
      token,
      id: randomToken(8),
      name: cleanName,
      balance: STARTING_CREDITS,
      positions: [],
      joinedAt: new Date(this.now()).toISOString(),
    });
    this.emit(room);
    return { playerToken: token, state: this.snapshot(room, token) };
  }

  placeBet(code, playerToken, options = {}) {
    const room = this.getRoom(code);
    const player = this.requirePlayer(room, playerToken);
    const market = room.markets.find((entry) => entry.id === String(options.marketId || ""));
    if (!market) throw Object.assign(new Error("That market no longer exists."), { statusCode: 404 });
    if (market.status !== "open") throw Object.assign(new Error("This market is not accepting picks."), { statusCode: 409 });
    const outcome = String(options.outcome || "").toLowerCase();
    if (!["over", "under"].includes(outcome)) throw Object.assign(new Error("Choose one of the two outcomes."), { statusCode: 400 });
    const credits = Math.floor(Number(options.credits || 0));
    if (!Number.isFinite(credits) || credits < 10) throw Object.assign(new Error("The minimum pick is 10 credits."), { statusCode: 400 });
    if (credits > player.balance) throw Object.assign(new Error("You don't have enough wedding credits."), { statusCode: 409 });
    const price = marketPrices(market)[outcome];
    const shares = Math.round((credits / price) * 100) / 100;
    const position = {
      id: randomToken(8),
      marketId: market.id,
      outcome,
      credits,
      price,
      shares,
      potentialPayout: Math.round(shares * PAYOUT_PER_SHARE),
      placedAt: new Date(this.now()).toISOString(),
      settled: false,
      won: null,
      payout: 0,
    };
    player.balance -= credits;
    player.positions.push(position);
    market.pool[outcome] += credits;
    this.emit(room);
    return this.snapshot(room, playerToken);
  }

  hostAction(code, hostToken, action, options = {}) {
    const room = this.getRoom(code);
    this.requireHost(room, hostToken);
    if (action === "create") {
      const title = cleanText(options.title, 140);
      const overLabel = cleanText(options.overLabel, 40);
      const underLabel = cleanText(options.underLabel, 40);
      if (!title || !overLabel || !underLabel) throw Object.assign(new Error("Add a question and both answer labels."), { statusCode: 400 });
      const market = {
        id: `custom-${randomToken(8)}`,
        category: cleanText(options.category, 40) || "Wedding moments",
        title,
        description: cleanText(options.description, 240),
        overLabel,
        underLabel,
        status: "open",
        result: "",
        pool: { over: 0, under: 0 },
        resolvedAt: "",
      };
      room.markets.unshift(market);
      this.emit(room);
      return this.snapshot(room);
    }
    const market = room.markets.find((entry) => entry.id === String(options.marketId || ""));
    if (!market) throw Object.assign(new Error("Choose a valid market."), { statusCode: 404 });
    if (action === "lock") {
      if (market.status !== "open") throw Object.assign(new Error("Only an open market can be locked."), { statusCode: 409 });
      market.status = "locked";
    } else if (action === "reopen") {
      if (market.status !== "locked") throw Object.assign(new Error("Only a locked market can be reopened."), { statusCode: 409 });
      market.status = "open";
    } else if (action === "resolve") {
      if (market.status === "resolved") throw Object.assign(new Error("This market has already been settled."), { statusCode: 409 });
      const outcome = String(options.outcome || "").toLowerCase();
      if (!["over", "under"].includes(outcome)) throw Object.assign(new Error("Choose the winning outcome."), { statusCode: 400 });
      market.status = "resolved";
      market.result = outcome;
      market.resolvedAt = new Date(this.now()).toISOString();
      for (const player of room.players.values()) {
        for (const position of player.positions.filter((entry) => entry.marketId === market.id && !entry.settled)) {
          position.settled = true;
          position.won = position.outcome === outcome;
          position.payout = position.won ? position.potentialPayout : 0;
          player.balance += position.payout;
        }
      }
    } else {
      throw Object.assign(new Error("Unsupported host action."), { statusCode: 400 });
    }
    this.emit(room);
    return this.snapshot(room);
  }

  snapshot(room, playerToken = "") {
    const player = playerToken ? room.players.get(playerToken) : null;
    const markets = room.markets.map((market) => ({
      id: market.id,
      category: market.category,
      title: market.title,
      description: market.description,
      overLabel: market.overLabel,
      underLabel: market.underLabel,
      status: market.status,
      result: market.result,
      prices: marketPrices(market),
      volume: market.pool.over + market.pool.under,
      resolvedAt: market.resolvedAt,
    }));
    const leaders = [...room.players.values()]
      .map((entry) => ({ id: entry.id, name: entry.name, balance: entry.balance, picks: entry.positions.length }))
      .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
    return {
      code: room.code,
      coupleName: room.coupleName,
      eventDate: room.eventDate,
      joinUrl: `${room.publicUrl || ""}/games/wedding-predictions/${room.code}`,
      playerCount: room.players.size,
      totalVolume: markets.reduce((sum, market) => sum + market.volume, 0),
      markets,
      leaders,
      player: player ? {
        id: player.id,
        name: player.name,
        balance: player.balance,
        positions: player.positions.map((position) => ({ ...position })),
      } : null,
    };
  }

  subscribe(code, listener) {
    this.getRoom(code);
    const listeners = this.listeners.get(code) || new Set();
    listeners.add(listener);
    this.listeners.set(code, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(code);
    };
  }

  emit(room) {
    for (const listener of this.listeners.get(room.code) || []) listener();
  }
}

module.exports = { WeddingPredictionsGame, DEFAULT_MARKETS, STARTING_CREDITS, PAYOUT_PER_SHARE, marketPrices };

