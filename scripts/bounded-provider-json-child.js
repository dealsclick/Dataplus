"use strict";

const { boundedCurlContent } = require("../lib/bounded-http");

const MIB = 1024 * 1024;
const MAX_INPUT_BYTES = 8 * MIB;

async function readInput() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > MAX_INPUT_BYTES) throw new Error("Provider request payload exceeded the child-process safety limit.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
}

async function main() {
  const request = await readInput();
  const timeoutMs = Math.max(1_000, Number(request.timeoutMs || 45_000));
  const response = await boundedCurlContent(request.url, {
    method: request.method || "GET",
    headers: request.headers || {},
    body: request.body,
    maxResponseBytes: request.maxResponseBytes,
    timeoutMs,
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = response.content.toString("utf8");
  let data = null;
  let json = false;
  try {
    data = text ? JSON.parse(text) : {};
    json = true;
  } catch {
    data = null;
  }
  process.stdout.write(JSON.stringify({
    statusCode: response.statusCode,
    headers: response.headers,
    json,
    data,
    textPreview: json ? "" : text.slice(0, 2_000)
  }));
}

main().catch((error) => {
  process.stderr.write(String(error?.stack || error?.message || error).slice(0, 8_000));
  process.exitCode = 1;
});
