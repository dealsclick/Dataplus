const { WeddingPredictionsGame } = require("./wedding-predictions-game");

function createWeddingPredictionsHttp({ parseBody, sendJson }) {
  const game = new WeddingPredictionsGame();

  function publicBase(req) {
    const configured = String(process.env.WEDDING_PREDICTIONS_PUBLIC_URL || "").trim().replace(/\/$/, "");
    if (configured) return configured;
    const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
    const protocol = forwardedProto || (req.socket.encrypted ? "https" : "http");
    return `${protocol}://${req.headers.host}`;
  }

  function hostToken(req, body = {}) {
    return String(req.headers["x-wedding-host-token"] || body.hostToken || "");
  }

  async function handle(req, res, url) {
    if (!url.pathname.startsWith("/api/wedding-predictions/")) return false;
    const parts = url.pathname.split("/").filter(Boolean);
    try {
      if (req.method === "POST" && url.pathname === "/api/wedding-predictions/rooms") {
        const body = await parseBody(req);
        sendJson(res, 201, game.createRoom({ publicUrl: publicBase(req), coupleName: body.coupleName, eventDate: body.eventDate }));
        return true;
      }

      const code = String(parts[3] || "").toUpperCase();
      if (!code) {
        sendJson(res, 404, { error: "Wedding room not found." });
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
          "X-Accel-Buffering": "no",
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
      if (req.method === "POST" && parts[4] === "bet") {
        const body = await parseBody(req);
        sendJson(res, 200, game.placeBet(code, String(body.playerToken || ""), body));
        return true;
      }
      if (req.method === "POST" && parts[4] === "host") {
        const body = await parseBody(req);
        sendJson(res, 200, game.hostAction(code, hostToken(req, body), String(body.action || ""), body));
        return true;
      }
      sendJson(res, 404, { error: "Wedding prediction route not found." });
      return true;
    } catch (error) {
      sendJson(res, error.statusCode || 400, { error: error.message || "The wedding prediction action failed." });
      return true;
    }
  }

  return { game, handle };
}

module.exports = { createWeddingPredictionsHttp };

