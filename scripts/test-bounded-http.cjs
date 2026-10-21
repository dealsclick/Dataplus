const assert = require("node:assert/strict");
const http = require("node:http");
const zlib = require("node:zlib");
const { boundedCurlContent, boundedHttpContent, boundedJsonSubprocess } = require("../lib/bounded-http");

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
    if (req.url === "/invalid-json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("not json");
      return;
    }
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

    const curlResponse = await boundedCurlContent(`${baseUrl}/ok`, { maxResponseBytes: 64 * 1024 });
    assert.equal(curlResponse.statusCode, 200);
    assert.deepEqual(JSON.parse(curlResponse.content.toString("utf8")), { ok: true });

    const isolatedResponse = await boundedJsonSubprocess(`${baseUrl}/ok`, { maxResponseBytes: 64 * 1024 });
    assert.equal(isolatedResponse.statusCode, 200);
    assert.equal(isolatedResponse.json, true);
    assert.deepEqual(isolatedResponse.data, { ok: true });

    const invalidJson = await boundedJsonSubprocess(`${baseUrl}/invalid-json`, { maxResponseBytes: 64 * 1024 });
    assert.equal(invalidJson.json, false);
    assert.equal(invalidJson.textPreview, "not json");

    await rejectsWith(
      boundedHttpContent(`${baseUrl}/declared-too-large`, { maxResponseBytes: 64 * 1024 }),
      /Provider response exceeded the 1 MB safety limit/,
      "declared response sizes must be rejected before their bodies are read"
    );
    await rejectsWith(
      boundedCurlContent(`${baseUrl}/chunked-too-large`, { maxResponseBytes: 64 * 1024 }),
      /Provider response exceeded the 1 MB safety limit/,
      "the low-memory subprocess must stop chunked responses as soon as they cross the byte ceiling"
    );
    await rejectsWith(
      boundedCurlContent(`${baseUrl}/compressed`, { maxResponseBytes: 64 * 1024 }),
      /unsupported compressed content \(gzip\).*rejected before decompression/,
      "the low-memory subprocess must never decompress unexpected provider content"
    );
    await rejectsWith(
      boundedCurlContent(`${baseUrl}/slow`, { timeoutMs: 1_000 }),
      /Provider request timed out after 1000 ms/,
      "the low-memory subprocess must have a transport-level deadline"
    );
    await rejectsWith(
      boundedJsonSubprocess(`${baseUrl}/chunked-too-large`, { maxResponseBytes: 64 * 1024 }),
      /Isolated provider process exited.*Provider response exceeded the 1 MB safety limit/,
      "the JSON parser subprocess must fail without returning oversized provider data to the worker"
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
