"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const WORKER_PATH = path.join(__dirname, "..", "scripts", "fulfillment-print-worker.cjs");
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OLD_SPACE_MB = 256;

async function removeDirectory(directory) {
  if (!directory) return;
  await fs.promises.rm(directory, { recursive: true, force: true }).catch(() => {});
}

async function buildLabelPacketIsolated(entries = [], options = {}) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dataplus-print-"));
  const requestPath = path.join(directory, "request.json");
  const outputPath = path.join(directory, "packet.pdf");
  const resultPath = path.join(directory, "result.json");
  const timeoutMs = Math.max(5_000, Number(process.env.DATAPLUS_PRINT_WORKER_TIMEOUT_MS || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
  const maxOldSpaceMb = Math.max(128, Number(process.env.DATAPLUS_PRINT_WORKER_MAX_OLD_SPACE_MB || DEFAULT_MAX_OLD_SPACE_MB) || DEFAULT_MAX_OLD_SPACE_MB);
  await fs.promises.writeFile(requestPath, JSON.stringify({ entries, options, outputPath, resultPath }));

  try {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [`--max-old-space-size=${maxOldSpaceMb}`, WORKER_PATH, requestPath], {
        cwd: path.join(__dirname, ".."),
        env: { ...process.env, NODE_OPTIONS: "" },
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true
      });
      let errorOutput = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(Object.assign(new Error(`Print packet generation exceeded ${Math.round(timeoutMs / 1000)} seconds.`), { code: "PRINT_WORKER_TIMEOUT" }));
      }, timeoutMs);
      child.stderr.on("data", (chunk) => {
        if (errorOutput.length < 16_384) errorOutput += chunk.toString("utf8").slice(0, 16_384 - errorOutput.length);
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(errorOutput.trim() || `Print packet worker exited with ${signal || code || "an unknown error"}.`));
      });
    });
    const [buffer, resultText] = await Promise.all([
      fs.promises.readFile(outputPath),
      fs.promises.readFile(resultPath, "utf8")
    ]);
    const result = JSON.parse(resultText);
    return { buffer, failures: Array.isArray(result.failures) ? result.failures : [] };
  } finally {
    await removeDirectory(directory);
  }
}

module.exports = { buildLabelPacketIsolated };
