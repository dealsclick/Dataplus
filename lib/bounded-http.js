const http = require("http");
const https = require("https");
const { spawn } = require("child_process");
const path = require("path");

const KIB = 1024;
const MIB = 1024 * KIB;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * MIB;
const MAX_RESPONSE_BYTES = 64 * MIB;

function normalizedResponseLimit(value) {
  const requestedMaximum = Number(value);
  return Math.max(64 * KIB, Math.min(
    Number.isFinite(requestedMaximum) && requestedMaximum > 0 ? requestedMaximum : DEFAULT_MAX_RESPONSE_BYTES,
    MAX_RESPONSE_BYTES
  ));
}

function normalizedTimeout(value) {
  const requestedTimeout = Number(value);
  return Math.max(1_000, Math.min(
    Number.isFinite(requestedTimeout) && requestedTimeout > 0 ? requestedTimeout : 45_000,
    5 * 60_000
  ));
}

function boundedHttpContent(urlValue, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(String(urlValue));
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      reject(new Error(`Unsupported provider URL protocol: ${url.protocol || "unknown"}`));
      return;
    }

    const maximumResponseBytes = normalizedResponseLimit(options.maxResponseBytes);
    const timeoutMs = normalizedTimeout(options.timeoutMs);
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

function parseCurlResponse(output, maximumResponseBytes) {
  let offset = 0;
  let statusCode = 0;
  let headers = {};
  while (output.subarray(offset, offset + 5).toString("latin1") === "HTTP/") {
    const headerEnd = output.indexOf("\r\n\r\n", offset, "latin1");
    if (headerEnd < 0 || headerEnd - offset > 64 * KIB) throw new Error("Provider returned malformed or oversized HTTP headers.");
    const lines = output.subarray(offset, headerEnd).toString("latin1").split("\r\n");
    const match = lines.shift()?.match(/^HTTP\/\S+\s+(\d{3})/i);
    if (!match) throw new Error("Provider returned an invalid HTTP status line.");
    statusCode = Number(match[1]);
    headers = {};
    for (const line of lines) {
      const separator = line.indexOf(":");
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim().toLowerCase();
      const value = line.slice(separator + 1).trim();
      headers[key] = headers[key] ? `${headers[key]}, ${value}` : value;
    }
    offset = headerEnd + 4;
  }
  if (!statusCode) throw new Error("Provider response did not include HTTP headers.");
  const encoding = String(headers["content-encoding"] || "identity").trim().toLowerCase();
  if (encoding && encoding !== "identity") {
    throw new Error(`Provider returned unsupported compressed content (${encoding}); the response was rejected before decompression.`);
  }
  const content = output.subarray(offset);
  if (content.length > maximumResponseBytes) {
    throw new Error(`Provider response exceeded the ${Math.ceil(maximumResponseBytes / MIB)} MB safety limit.`);
  }
  return { statusCode, headers, content };
}

function boundedCurlContent(urlValue, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(String(urlValue));
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      reject(new Error(`Unsupported provider URL protocol: ${url.protocol || "unknown"}`));
      return;
    }
    const maximumResponseBytes = normalizedResponseLimit(options.maxResponseBytes);
    const timeoutMs = normalizedTimeout(options.timeoutMs);
    const requestBody = options.body === undefined || options.body === null
      ? null
      : Buffer.isBuffer(options.body) ? options.body : Buffer.from(String(options.body));
    const curlBinary = String(options.curlBinary || process.env.DATAPLUS_PROVIDER_CURL_BIN || (process.platform === "win32" ? "curl.exe" : "curl"));
    const args = [
      "--silent", "--show-error", "--no-buffer", "--http1.1",
      "--proto", "=http,https",
      "--max-filesize", String(maximumResponseBytes),
      "--connect-timeout", String(Math.min(10, Math.ceil(timeoutMs / 1000))),
      "--max-time", String(Math.ceil(timeoutMs / 1000)),
      "--request", String(options.method || "GET").toUpperCase(),
      "--dump-header", "-", "--output", "-",
      "--header", "Accept-Encoding: identity",
      "--header", "Expect:"
    ];
    for (const [key, value] of Object.entries(options.headers || {})) {
      const normalizedKey = String(key).trim().toLowerCase();
      if (!normalizedKey || normalizedKey === "accept-encoding" || normalizedKey === "content-length") continue;
      args.push("--header", `${key}: ${String(value)}`);
    }
    if (requestBody) args.push("--data-binary", "@-");
    args.push("--url", url.toString());

    const output = [];
    const errors = [];
    const maximumOutputBytes = maximumResponseBytes + 64 * KIB;
    let outputBytes = 0;
    let errorBytes = 0;
    let settled = false;
    const signal = options.signal;
    const child = spawn(curlBinary, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const cleanup = () => {
      clearTimeout(guardTimer);
      signal?.removeEventListener?.("abort", onAbort);
    };
    const finishError = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      child.kill("SIGKILL");
      reject(error);
    };
    const onAbort = () => finishError(signal?.reason instanceof Error
      ? signal.reason
      : new Error("Provider request was aborted."));
    const guardTimer = setTimeout(
      () => finishError(new Error(`Provider request timed out after ${timeoutMs} ms.`)),
      timeoutMs + 2_000
    );
    guardTimer.unref?.();
    child.on("error", (error) => finishError(new Error(`Low-memory provider transport could not start: ${error.message || error}`)));
    child.stdout.on("data", (chunk) => {
      if (settled) return;
      outputBytes += chunk.length;
      if (outputBytes > maximumOutputBytes) {
        finishError(new Error(`Provider response exceeded the ${Math.ceil(maximumResponseBytes / MIB)} MB safety limit.`));
        return;
      }
      output.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (errorBytes >= 16 * KIB) return;
      const remaining = 16 * KIB - errorBytes;
      const value = chunk.subarray(0, remaining);
      errorBytes += value.length;
      errors.push(value);
    });
    child.on("close", (code, childSignal) => {
      if (settled) return;
      if (code === 63) {
        finishError(new Error(`Provider response exceeded the ${Math.ceil(maximumResponseBytes / MIB)} MB safety limit.`));
        return;
      }
      if (code === 28) {
        finishError(new Error(`Provider request timed out after ${timeoutMs} ms.`));
        return;
      }
      if (code !== 0) {
        const detail = Buffer.concat(errors, errorBytes).toString("utf8").trim().slice(-500);
        finishError(new Error(`Low-memory provider transport exited with ${childSignal || `code ${code}`}.${detail ? ` ${detail}` : ""}`));
        return;
      }
      try {
        const response = parseCurlResponse(Buffer.concat(output, outputBytes), maximumResponseBytes);
        settled = true;
        cleanup();
        resolve(response);
      } catch (error) {
        finishError(error);
      }
    });
    child.stdin.on("error", () => {});
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener?.("abort", onAbort, { once: true });
    child.stdin.end(requestBody || undefined);
  });
}

function boundedJsonSubprocess(urlValue, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(String(urlValue));
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      reject(new Error(`Unsupported provider URL protocol: ${url.protocol || "unknown"}`));
      return;
    }
    const maximumResponseBytes = normalizedResponseLimit(options.maxResponseBytes);
    const timeoutMs = normalizedTimeout(options.timeoutMs);
    const descriptor = JSON.stringify({
      url: url.toString(),
      method: String(options.method || "GET").toUpperCase(),
      headers: options.headers || {},
      body: options.body === undefined || options.body === null
        ? null
        : Buffer.isBuffer(options.body) ? options.body.toString("utf8") : String(options.body),
      maxResponseBytes: maximumResponseBytes,
      timeoutMs
    });
    if (Buffer.byteLength(descriptor) > 8 * MIB) {
      reject(new Error("Provider request payload exceeded the 8 MB subprocess safety limit."));
      return;
    }

    const helper = path.join(__dirname, "..", "scripts", "bounded-provider-json-child.js");
    const child = spawn(process.execPath, ["--max-old-space-size=96", "--max-semi-space-size=8", helper], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const output = [];
    const errors = [];
    const maximumOutputBytes = Math.min(16 * MIB, (maximumResponseBytes * 8) + 256 * KIB);
    let outputBytes = 0;
    let errorBytes = 0;
    let settled = false;
    const signal = options.signal;
    const cleanup = () => {
      clearTimeout(guardTimer);
      signal?.removeEventListener?.("abort", onAbort);
    };
    const finishError = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      child.kill("SIGKILL");
      reject(error);
    };
    const onAbort = () => finishError(signal?.reason instanceof Error
      ? signal.reason
      : new Error("Provider request was aborted."));
    const guardTimer = setTimeout(
      () => finishError(new Error(`Provider request timed out after ${timeoutMs} ms.`)),
      timeoutMs + 4_000
    );
    guardTimer.unref?.();
    child.on("error", (error) => finishError(new Error(`Isolated provider process could not start: ${error.message || error}`)));
    child.stdout.on("data", (chunk) => {
      if (settled) return;
      outputBytes += chunk.length;
      if (outputBytes > maximumOutputBytes) {
        finishError(new Error("Isolated provider response exceeded the parent-process safety limit."));
        return;
      }
      output.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (errorBytes >= 32 * KIB) return;
      const remaining = 32 * KIB - errorBytes;
      const value = chunk.subarray(0, remaining);
      errorBytes += value.length;
      errors.push(value);
    });
    child.on("close", (code, childSignal) => {
      if (settled) return;
      if (code !== 0) {
        const detail = Buffer.concat(errors, errorBytes).toString("utf8").trim().slice(-1_000);
        finishError(new Error(`Isolated provider process exited with ${childSignal || `code ${code}`}.${detail ? ` ${detail}` : ""}`));
        return;
      }
      try {
        const envelope = JSON.parse(Buffer.concat(output, outputBytes).toString("utf8"));
        settled = true;
        cleanup();
        resolve(envelope);
      } catch (error) {
        finishError(new Error(`Isolated provider process returned invalid output: ${error.message || error}`));
      }
    });
    child.stdin.on("error", () => {});
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener?.("abort", onAbort, { once: true });
    child.stdin.end(descriptor);
  });
}

module.exports = { boundedCurlContent, boundedHttpContent, boundedJsonSubprocess, parseCurlResponse };
