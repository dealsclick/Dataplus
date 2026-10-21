"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { once } = require("events");

const MIB = 1024 * 1024;
const DEFAULT_MAX_SCAN_BYTES = 64 * MIB;

function appendNdjsonRowSync(filePath, row) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`);
}

async function writeLine(stream, line) {
  if (stream.write(`${line}\n`)) return;
  await once(stream, "drain");
}

async function finishStream(stream) {
  const closed = stream.closed ? null : once(stream, "close");
  stream.end();
  await once(stream, "finish");
  if (closed) await closed;
}

async function closeReadStream(stream) {
  if (stream.closed) return;
  const closed = once(stream, "close");
  stream.destroy();
  await closed;
}

async function pruneNdjsonFile(filePath, options = {}) {
  let initial;
  try {
    initial = await fs.promises.stat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return { kept: 0, removed: 0, truncatedPrefix: false, skippedConcurrentWrite: false };
    throw error;
  }

  const cutoffMs = Number(options.cutoffMs || 0);
  const maximumScanBytes = Math.max(MIB, Math.min(
    Number(options.maxScanBytes || DEFAULT_MAX_SCAN_BYTES),
    256 * MIB
  ));
  const start = Math.max(0, initial.size - maximumScanBytes);
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const input = fs.createReadStream(filePath, { start });
  const output = fs.createWriteStream(temporaryPath, { flags: "wx" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let skipPartialLine = start > 0;
  let kept = 0;
  let removed = 0;

  try {
    for await (const line of lines) {
      if (skipPartialLine) {
        skipPartialLine = false;
        continue;
      }
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        const createdAt = Date.parse(row.createdAt || "");
        if (!Number.isFinite(createdAt) || (cutoffMs && createdAt < cutoffMs)) {
          removed += 1;
          continue;
        }
        await writeLine(output, line);
        kept += 1;
      } catch {
        removed += 1;
      }
    }
    await finishStream(output);
    lines.close();
    await closeReadStream(input);

    const current = await fs.promises.stat(filePath);
    if (current.size !== initial.size || current.mtimeMs !== initial.mtimeMs) {
      await fs.promises.rm(temporaryPath, { force: true });
      return { kept, removed, truncatedPrefix: start > 0, skippedConcurrentWrite: true };
    }

    const replacedPath = `${filePath}.${process.pid}.${Date.now()}.replaced`;
    await fs.promises.rename(filePath, replacedPath);
    try {
      await fs.promises.rename(temporaryPath, filePath);
      await fs.promises.rm(replacedPath, { force: true });
    } catch (error) {
      await fs.promises.rename(replacedPath, filePath).catch(() => {});
      throw error;
    }
    return { kept, removed, truncatedPrefix: start > 0, skippedConcurrentWrite: false };
  } catch (error) {
    input.destroy();
    output.destroy();
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  } finally {
    lines.close();
  }
}

module.exports = { appendNdjsonRowSync, pruneNdjsonFile, DEFAULT_MAX_SCAN_BYTES };
