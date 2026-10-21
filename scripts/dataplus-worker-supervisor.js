"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const WORKER_SCRIPT = path.join(__dirname, "dataplus-worker.js");
const MIB = 1024 * 1024;
const DEFAULT_RESTART_DELAY_MS = 750;
const DEFAULT_POST_JOB_EXIT_TIMEOUT_MS = 20_000;
const MEMORY_POLL_MS = 200;
const HEAVY_TASKS = new Set([
  "product-dump-import", "vendor-feed-import", "source-catalog-import", "mapped-product-import",
  "source-facets-refresh", "data-quality-scan", "source-search-index", "source-performance-indexes",
  "postgres-backup", "walmart-bulk-launch", "walmart-existing-launch", "walmart-feed",
  "ebay-catalog-sync", "ebay-taxonomy-sync", "shopify-status-import", "category-mapping-bulk-refresh"
]);

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function laneDefaultBudgetMb(lane = "manual") {
  if (["orders-shopify", "orders-ebay"].includes(lane)) return 480;
  if (lane === "orders-temu") return 1000;
  if (["background", "walmart"].includes(lane)) return 680;
  return 1100;
}

function laneHeavyBudgetMb(lane = "manual") {
  if (["orders-shopify", "orders-ebay"].includes(lane)) return 560;
  if (lane === "orders-temu") return 1200;
  if (["background", "walmart"].includes(lane)) return 820;
  return 1280;
}

function jobMemoryBudgetMb(lane, task = "", env = process.env) {
  const heavy = HEAVY_TASKS.has(String(task || ""));
  return Math.floor(positiveNumber(
    heavy ? env.DATAPLUS_WORKER_HEAVY_JOB_RSS_MB : env.DATAPLUS_WORKER_JOB_RSS_MB,
    heavy ? laneHeavyBudgetMb(lane) : laneDefaultBudgetMb(lane)
  ));
}

function readProcessRssBytes(pid, procRoot = "/proc") {
  try {
    const status = fs.readFileSync(path.join(procRoot, String(pid), "status"), "utf8");
    const match = status.match(/^VmRSS:\s+(\d+)\s+kB$/mi);
    return match ? Number(match[1]) * 1024 : 0;
  } catch {
    return 0;
  }
}

function readChildPids(pid, procRoot = "/proc") {
  try {
    const value = fs.readFileSync(path.join(procRoot, String(pid), "task", String(pid), "children"), "utf8");
    return value.trim().split(/\s+/).map(Number).filter((childPid) => Number.isInteger(childPid) && childPid > 0);
  } catch {
    return [];
  }
}

function processTreeRssBytes(rootPid, procRoot = "/proc") {
  const pending = [Number(rootPid)];
  const visited = new Set();
  let total = 0;
  while (pending.length) {
    const pid = pending.pop();
    if (!Number.isInteger(pid) || pid <= 0 || visited.has(pid)) continue;
    visited.add(pid);
    total += readProcessRssBytes(pid, procRoot);
    pending.push(...readChildPids(pid, procRoot));
  }
  return total;
}

function terminateProcessTree(child) {
  if (!child?.pid) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
    else child.kill("SIGKILL");
  } catch {
    try { child.kill("SIGKILL"); } catch { /* Process already exited. */ }
  }
}

async function markInterruptedJob(claim, incident = {}) {
  if (!claim?.jobId || !claim?.workerId || !process.env.DATABASE_URL) return false;
  const { Client } = require("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const observedMb = Math.max(0, Math.ceil(Number(incident.observedBytes || 0) / MIB));
  const budgetMb = Math.max(0, Number(incident.budgetMb || 0));
  const memoryStopped = incident.reason === "memory_limit";
  const message = memoryStopped
    ? `Worker memory guard stopped ${claim.task || "the job"} at ${observedMb} MB before the ${budgetMb} MB job budget could endanger the worker lane.`
    : `The isolated worker process exited before ${claim.task || "the job"} completion could be confirmed.`;
  const details = memoryStopped
    ? "No automatic retry was attempted because the job may contain marketplace or carrier side effects. Review the provider status, then retry or use the existing recovery action only when needed."
    : `Exit ${incident.signal || incident.code || "unknown"}. No automatic retry was attempted; review the job before retrying.`;
  const now = new Date().toISOString();
  const patch = {
    status: "warning",
    phase: "worker_interrupted",
    message,
    details,
    workerHealth: memoryStopped ? "memory_guard_stopped" : "worker_process_exited",
    finishedAt: now,
    memoryGuard: {
      triggered: memoryStopped,
      observedMb,
      budgetMb,
      lane: claim.lane || "",
      task: claim.task || "",
      recordedAt: now
    },
    errors: [message]
  };
  try {
    await client.connect();
    const result = await client.query(`
      update operations_jobs
      set status = 'warning',
          message = $3,
          missing_rows = greatest(coalesce(missing_rows, 0), 1),
          ended_at = now(),
          updated_at = now(),
          raw = coalesce(raw, '{}'::jsonb) || $4::jsonb
      where job_id = $1
        and lower(status) = 'running'
        and coalesce(raw ->> 'workerId', '') = $2
    `, [String(claim.jobId), String(claim.workerId), message, JSON.stringify(patch)]);
    return result.rowCount > 0;
  } catch (error) {
    console.error(`[worker-supervisor] unable to record interrupted job ${claim.jobId}: ${error.message || error}`);
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function supervise() {
  const lane = String(process.env.DATAPLUS_WORKER_LANE || "all");
  const restartDelayMs = Math.max(250, positiveNumber(process.env.DATAPLUS_WORKER_RESTART_DELAY_MS, DEFAULT_RESTART_DELAY_MS));
  const postJobExitTimeoutMs = Math.max(1_000, positiveNumber(
    process.env.DATAPLUS_WORKER_POST_JOB_EXIT_TIMEOUT_MS,
    DEFAULT_POST_JOB_EXIT_TIMEOUT_MS
  ));
  let stopping = false;
  let child = null;

  const stop = () => {
    stopping = true;
    if (!child?.pid) return;
    try {
      if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
      else child.kill("SIGTERM");
    } catch { /* Process already exited. */ }
    const forceTimer = setTimeout(() => terminateProcessTree(child), 55_000);
    forceTimer.unref?.();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  while (!stopping) {
    const workerId = `dataplus-${lane}-${crypto.randomUUID().slice(0, 8)}`;
    let claim = null;
    let completed = false;
    let jobFinished = false;
    let memoryIncident = null;
    let postJobTimer = null;
    child = spawn(process.execPath, [WORKER_SCRIPT], {
      cwd: ROOT,
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        DATAPLUS_WORKER_ID: workerId,
        DATAPLUS_WORKER_EXIT_AFTER_JOB: "1",
        DATAPLUS_WORKER_SUPERVISED: "1"
      },
      stdio: ["ignore", "inherit", "inherit", "ipc"]
    });
    child.on("message", (message = {}) => {
      if (message.type === "dataplus-worker-claimed") {
        claim = {
          jobId: String(message.jobId || ""),
          task: String(message.task || ""),
          workerId,
          lane
        };
      }
      if (message.type === "dataplus-worker-job-finished" && String(message.jobId || "") === claim?.jobId) {
        jobFinished = true;
        try {
          child.send({ type: "dataplus-worker-job-finished-ack", jobId: claim.jobId });
        } catch { /* The hard exit timer still protects the lane. */ }
        if (!postJobTimer) {
          postJobTimer = setTimeout(() => {
            if (!child?.pid || child.exitCode !== null || child.signalCode || completed) return;
            console.warn(`[worker-supervisor] recycling ${lane} worker after ${claim?.task || "job"} completed because post-job drains exceeded ${postJobExitTimeoutMs} ms.`);
            terminateProcessTree(child);
          }, postJobExitTimeoutMs);
          postJobTimer.unref?.();
        }
      }
      if (message.type === "dataplus-worker-completed" && String(message.jobId || "") === claim?.jobId) completed = true;
    });

    const memoryTimer = process.platform === "linux" ? setInterval(() => {
      if (memoryIncident || !child?.pid || child.exitCode !== null || child.signalCode) return;
      const observedBytes = processTreeRssBytes(child.pid);
      const budgetMb = jobMemoryBudgetMb(lane, claim?.task || "");
      if (observedBytes < budgetMb * MIB) return;
      memoryIncident = { reason: "memory_limit", observedBytes, budgetMb };
      console.error(`[worker-supervisor] stopping ${claim?.task || "worker startup"} in ${lane}: process tree RSS ${Math.ceil(observedBytes / MIB)} MB reached the ${budgetMb} MB budget.`);
      terminateProcessTree(child);
    }, MEMORY_POLL_MS) : null;
    memoryTimer?.unref?.();

    const result = await new Promise((resolve) => {
      child.once("error", (error) => resolve({ code: null, signal: "spawn_error", error }));
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    if (memoryTimer) clearInterval(memoryTimer);
    if (postJobTimer) clearTimeout(postJobTimer);
    child = null;

    if (!stopping && claim && !completed) {
      await markInterruptedJob(claim, memoryIncident || {
        reason: jobFinished ? "post_job_timeout" : "process_exit",
        code: result.code,
        signal: result.signal || result.error?.message || ""
      });
    }
    if (!stopping) await sleep(memoryIncident ? Math.max(5_000, restartDelayMs) : restartDelayMs);
  }
}

if (require.main === module) {
  supervise().catch((error) => {
    console.error(`[worker-supervisor] fatal: ${error.stack || error.message || error}`);
    process.exitCode = 1;
  });
}

module.exports = {
  HEAVY_TASKS,
  jobMemoryBudgetMb,
  laneDefaultBudgetMb,
  laneHeavyBudgetMb,
  markInterruptedJob,
  processTreeRssBytes,
  readChildPids,
  readProcessRssBytes,
  terminateProcessTree
};
