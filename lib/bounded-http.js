const http = require("http");
const https = require("https");

const KIB = 1024;
const MIB = 1024 * KIB;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * MIB;
const MAX_RESPONSE_BYTES = 64 * MIB;

function boundedHttpContent(urlValue, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(String(urlValue));
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      reject(new Error(`Unsupported provider URL protocol: ${url.protocol || "unknown"}`));
      return;
    }

    const requestedMaximum = Number(options.maxResponseBytes);
    const maximumResponseBytes = Math.max(64 * KIB, Math.min(
      Number.isFinite(requestedMaximum) && requestedMaximum > 0 ? requestedMaximum : DEFAULT_MAX_RESPONSE_BYTES,
      MAX_RESPONSE_BYTES
    ));
    const requestedTimeout = Number(options.timeoutMs);
    const timeoutMs = Math.max(1_000, Math.min(
      Number.isFinite(requestedTimeout) && requestedTimeout > 0 ? requestedTimeout : 45_000,
      5 * 60_000
    ));
    const requestBody = options.body === undefined || options.body === null
      ? null
      : Buffer.isBuffer(options.body) ? options.body : Buffer.from(String(options.body));
    const headers = {
      ...(options.headers || {}),
      "accept-encoding": "identity",
      ...(requestBody ? { "content-length": String(requestBody.length) } : {})
    };
    const transport = url.protocol === "https:" ? https : http;
    const chunks = [];
    const signal = options.signal;
    let request = null;
    let response = null;
    let responseBytes = 0;
    let settled = false;

    const cleanup = () => signal?.removeEventListener?.("abort", onAbort);
    const finishError = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      response?.destroy?.();
      request?.destroy?.();
      reject(error);
    };
    const onAbort = () => finishError(signal?.reason instanceof Error
      ? signal.reason
      : new Error("Provider request was aborted."));

    request = transport.request(url, { method: options.method || "GET", headers }, (incoming) => {
      response = incoming;
      const encoding = String(incoming.headers["content-encoding"] || "identity").trim().toLowerCase();
      if (encoding && encoding !== "identity") {
        finishError(new Error(`Provider returned unsupported compressed content (${encoding}); the response was rejected before decompression.`));
        return;
      }
      const declaredBytes = Number(incoming.headers["content-length"] || 0);
      if (Number.isFinite(declaredBytes) && declaredBytes > maximumResponseBytes) {
        finishError(new Error(`Provider response exceeded the ${Math.ceil(maximumResponseBytes / MIB)} MB safety limit.`));
        return;
      }
      incoming.on("data", (chunk) => {
        if (settled) return;
        const content = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        responseBytes += content.length;
        if (responseBytes > maximumResponseBytes) {
          finishError(new Error(`Provider response exceeded the ${Math.ceil(maximumResponseBytes / MIB)} MB safety limit.`));
          return;
        }
        chunks.push(content);
      });
      incoming.on("error", finishError);
      incoming.on("end", () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({
          statusCode: Number(incoming.statusCode || 0),
          headers: incoming.headers,
          content: Buffer.concat(chunks, responseBytes)
        });
      });
    });
    request.on("error", finishError);
    request.setTimeout(timeoutMs, () => finishError(new Error(`Provider request timed out after ${timeoutMs} ms.`)));
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener?.("abort", onAbort, { once: true });
    request.end(requestBody || undefined);
  });
}

module.exports = { boundedHttpContent };
