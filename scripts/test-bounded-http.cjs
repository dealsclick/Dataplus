const assert = require("node:assert/strict");
const http = require("node:http");
const zlib = require("node:zlib");
const { boundedHttpContent } = require("../lib/bounded-http");

async function rejectsWith(promise, pattern, message) {
  await assert.rejects(promise, pattern, message);
}

async function main() {
  const server = http.createServer((req, res) => {
    if (req.url === "/ok") {
      assert.equal(req.headers["accept-encoding"], "identity");
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
      return;
    }
    if (req.url === "/declared-too-large") {
      res.writeHead(200, { "content-length": String(64 * 1024 + 1) });
      res.end();
      return;
    }
    if (req.url === "/chunked-too-large") {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.write(Buffer.alloc(48 * 1024));
      res.end(Buffer.alloc(48 * 1024));
      return;
    }
    if (req.url === "/compressed") {
      const body = zlib.gzipSync(Buffer.from('{"ok":true}'));
      res.writeHead(200, { "content-encoding": "gzip", "content-length": String(body.length) });
      res.end(body);
      return;
    }
    if (req.url === "/slow") return;
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await boundedHttpContent(`${baseUrl}/ok`, { maxResponseBytes: 64 * 1024 });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.content.toString("utf8")), { ok: true });

    await rejectsWith(
      boundedHttpContent(`${baseUrl}/declared-too-large`, { maxResponseBytes: 64 * 1024 }),
      /Provider response exceeded the 1 MB safety limit/,
      "declared response sizes must be rejected before their bodies are read"
    );
    await rejectsWith(
      boundedHttpContent(`${baseUrl}/chunked-too-large`, { maxResponseBytes: 64 * 1024 }),
      /Provider response exceeded the 1 MB safety limit/,
      "chunked responses must be stopped as soon as they cross the byte ceiling"
    );
    await rejectsWith(
      boundedHttpContent(`${baseUrl}/compressed`, { maxResponseBytes: 64 * 1024 }),
      /unsupported compressed content \(gzip\).*rejected before decompression/,
      "compressed responses must never reach an automatic decompressor"
    );
    await rejectsWith(
      boundedHttpContent(`${baseUrl}/slow`, { timeoutMs: 1_000 }),
      /Provider request timed out after 1000 ms/,
      "provider requests must have a transport-level deadline"
    );
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log("Bounded provider HTTP checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
