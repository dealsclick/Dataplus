const fs = require("fs");
const path = require("path");
const { LoteriaGame } = require("./loteria-game");

function loadDeck(root) {
  const deckPath = process.env.LOTERIA_DECK_FILE
    ? path.resolve(process.env.LOTERIA_DECK_FILE)
    : path.join(root, "web", "public", "loteria", "deck.json");
  const parsed = JSON.parse(fs.readFileSync(deckPath, "utf8"));
  return parsed.cards || [];
}

function createLoteriaHttp({ root, parseBody, sendJson }) {
  const game = new LoteriaGame(loadDeck(root));
  const timer = setInterval(() => game.tick(), 200);
  timer.unref?.();

  function publicBase(req) {
    const configured = String(process.env.LOTERIA_PUBLIC_URL || "").trim().replace(/\/$/, "");
    if (configured) return configured;
    const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
    const protocol = forwardedProto || (req.socket.encrypted ? "https" : "http");
    return `${protocol}://${req.headers.host}`;
  }

  function hostToken(req, body = {}) {
    return String(req.headers["x-loteria-host-token"] || body.hostToken || "");
  }

  async function handle(req, res, url) {
    if (!url.pathname.startsWith("/api/loteria/")) return false;
    const parts = url.pathname.split("/").filter(Boolean);
    try {
      if (req.method === "POST" && url.pathname === "/api/loteria/rooms") {
        const body = await parseBody(req);
        const created = game.createRoom({ publicUrl: publicBase(req), intervalSeconds: body.intervalSeconds });
        sendJson(res, 201, created);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/loteria/rooms") {
        sendJson(res, 200, { rooms: game.listRooms() });
        return true;
      }

      const code = String(parts[3] || "").toUpperCase();
      if (!code) {
        sendJson(res, 404, { error: "Sala no encontrada." });
        return true;
      }

      if (req.method === "GET" && parts.length === 4) {
        const room = game.getRoom(code);
        sendJson(res, 200, game.snapshot(room, url.searchParams.get("playerToken") || ""));
        return true;
      }

      if (req.method === "GET" && parts[4] === "events") {
        const playerToken = url.searchParams.get("playerToken") || "";
        const room = game.getRoom(code);
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no"
        });
        const write = () => res.write(`event: state\ndata: ${JSON.stringify(game.snapshot(room, playerToken))}\n\n`);
        write();
        const unsubscribe = game.subscribe(code, write);
        const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
        ping.unref?.();
        req.on("close", () => { clearInterval(ping); unsubscribe(); });
        return true;
      }

      if (req.method === "POST" && parts[4] === "join") {
        const body = await parseBody(req);
        sendJson(res, 200, game.join(code, body.name, body.playerToken));
        return true;
      }

      if (req.method === "POST" && parts[4] === "mark") {
        const body = await parseBody(req);
        sendJson(res, 200, game.mark(code, String(body.playerToken || ""), String(body.cardId || "")));
        return true;
      }

      if (req.method === "POST" && parts[4] === "claim") {
        const body = await parseBody(req);
        sendJson(res, 200, game.claim(code, String(body.playerToken || "")));
        return true;
      }

      if (req.method === "POST" && parts[4] === "host") {
        const body = await parseBody(req);
        const state = game.hostAction(code, hostToken(req, body), String(body.action || ""), body);
        sendJson(res, 200, state);
        return true;
      }

      sendJson(res, 404, { error: "Ruta de Lotería no encontrada." });
      return true;
    } catch (error) {
      sendJson(res, error.statusCode || 400, { error: error.message || "No se pudo completar la acción." });
      return true;
    }
  }

  return { game, handle };
}

module.exports = { createLoteriaHttp, loadDeck };
