const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "outputs", "shopify-push");
const API_URL = process.env.DATAPLUS_URL || "http://localhost:4173";
const BATCH_SIZE = Number(process.env.SHOPIFY_PUSH_BATCH_SIZE || 500);
const POLL_MS = Number(process.env.SHOPIFY_PUSH_POLL_MS || 10000);
const MAX_QUEUE_ATTEMPTS = Math.max(1, Number(process.env.SHOPIFY_PUSH_QUEUE_ATTEMPTS || 3) || 3);
const MAX_CONSECUTIVE_HARD_FAILURES = Math.max(1, Number(process.env.SHOPIFY_PUSH_MAX_HARD_FAILURES || 3) || 3);

function loadEnv() {
  const envFile = path.join(ROOT, ".env");
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function latestCandidateFile() {
  return fs.readdirSync(OUT_DIR)
    .filter((file) => /^essendant-shopify-push-candidates-.*\.json$/.test(file))
    .map((file) => ({ file: path.join(OUT_DIR, file), mtime: fs.statSync(path.join(OUT_DIR, file)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0]?.file;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appendLog(logPath, entry) {
  fs.appendFileSync(logPath, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

function csvValue(value) {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeReview(reviewPath, reviewCsvPath, review) {
  fs.writeFileSync(reviewPath, JSON.stringify(review, null, 2));
  const rows = [
    ["offset", "job_id", "status", "sku", "error", "message"],
    ...review.errors.map((row) => [
      row.absoluteOffset,
      row.jobId,
      row.status,
      row.sku,
      row.error,
      row.message
    ])
  ];
  fs.writeFileSync(reviewCsvPath, `${rows.map((row) => row.map(csvValue).join(",")).join("\n")}\n`);
}

function fileSize(filePath) {
  try {
    return fs.existsSync(filePath) ? fs.statSync(filePath).size : null;
  } catch {
    return null;
  }
}

function reviewJobPayload({ runJobId, status, message, candidatePath, start, skus, review, logPath, reviewCsvPath, reviewPath, stamp }) {
  const now = new Date().toISOString();
  const finished = ["success", "warning", "failed", "stopped"].includes(String(status || "").toLowerCase());
  return {
    id: runJobId,
    section: "Products",
    operation: "Essendant Shopify push review",
    direction: "sync",
    status,
    fileName: path.basename(reviewCsvPath),
    originalFileName: path.basename(reviewCsvPath),
    originalFilePath: reviewCsvPath,
    filePath: reviewCsvPath,
    totalRows: skus.length,
    processedRows: review.batches.reduce((sum, batch) => sum + Number(batch.processed || 0), 0),
    progressPercent: skus.length ? Math.min(100, Math.round((review.batches.reduce((sum, batch) => sum + Number(batch.count || 0), 0) / skus.length) * 100)) : 100,
    changed: review.batches.reduce((sum, batch) => sum + Number(batch.changed || 0), 0),
    missingCount: review.errors.length,
    phase: finished ? "complete" : "running",
    message,
    details: `Candidate file: ${candidatePath}. Run log: ${logPath}. Review JSON: ${reviewPath}.`,
    errors: review.errors.map((row) => row.error).filter(Boolean).slice(0, 50),
    rowLabel: "SKUs",
    workerTask: "essendant-shopify-push-batches",
    workerPayload: { candidatePath, start, batchSize: BATCH_SIZE, totalQueuedSkus: skus.length },
    artifacts: [
      {
        kind: "original",
        fileName: path.basename(reviewCsvPath),
        filePath: reviewCsvPath,
        contentType: "text/csv",
        rowCount: review.errors.length,
        byteSize: fileSize(reviewCsvPath)
      },
      {
        kind: "review-json",
        fileName: path.basename(reviewPath),
        filePath: reviewPath,
        contentType: "application/json",
        rowCount: review.batches.length,
        byteSize: fileSize(reviewPath)
      },
      {
        kind: "run-log",
        fileName: path.basename(logPath),
        filePath: logPath,
        contentType: "application/x-ndjson",
        rowCount: review.batches.length,
        byteSize: fileSize(logPath)
      },
      {
        kind: "candidates",
        fileName: path.basename(candidatePath),
        filePath: candidatePath,
        contentType: "application/json",
        rowCount: skus.length,
        byteSize: fileSize(candidatePath)
      }
    ],
    exportManifest: {
      runStamp: stamp,
      logPath,
      reviewPath,
      reviewCsvPath,
      batches: review.batches.length,
      errors: review.errors.length
    },
    createdAt: review.createdAt,
    startedAt: review.createdAt,
    finishedAt: finished ? now : "",
    updatedAt: now
  };
}

async function upsertReviewJob(client, payload) {
  const raw = JSON.stringify(payload);
  await client.query(`
    insert into operations_jobs (
      job_id, job_type, category, status, name, message, total_rows, processed_rows,
      changed_rows, missing_rows, progress, eta_seconds, source, output_path,
      error_path, created_at, started_at, ended_at, raw, updated_at
    )
    values (
      $1, 'script', $2, $3, $4, $5, $6::int, $7::int, $8::int, $9::int, $10::numeric,
      0, 'Essendant', $11, null, $12::timestamptz, $13::timestamptz, $14::timestamptz, $15::jsonb, now()
    )
    on conflict (job_id) do update set
      status = excluded.status,
      message = excluded.message,
      total_rows = excluded.total_rows,
      processed_rows = excluded.processed_rows,
      changed_rows = excluded.changed_rows,
      missing_rows = excluded.missing_rows,
      progress = excluded.progress,
      output_path = excluded.output_path,
      ended_at = coalesce(excluded.ended_at, operations_jobs.ended_at),
      raw = operations_jobs.raw || excluded.raw,
      updated_at = now()
  `, [
    payload.id,
    payload.section,
    payload.status,
    payload.operation,
    payload.message,
    payload.totalRows,
    payload.processedRows,
    payload.changed,
    payload.missingCount,
    payload.progressPercent,
    payload.originalFilePath,
    payload.createdAt,
    payload.startedAt,
    payload.finishedAt || null,
    raw
  ]);
  for (const artifact of payload.artifacts || []) {
    const artifactId = `${payload.id}:${artifact.kind}:${crypto.createHash("sha1").update(artifact.filePath).digest("hex").slice(0, 16)}`;
    await client.query(`
      insert into operation_artifacts (
        artifact_id, job_id, artifact_kind, file_name, file_path, content_type,
        row_count, byte_size, raw, updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7::int, $8::bigint, $9::jsonb, now())
      on conflict (artifact_id) do update set
        file_name = excluded.file_name,
        file_path = excluded.file_path,
        content_type = excluded.content_type,
        row_count = excluded.row_count,
        byte_size = excluded.byte_size,
        raw = operation_artifacts.raw || excluded.raw,
        updated_at = now()
    `, [
      artifactId,
      payload.id,
      artifact.kind,
      artifact.fileName,
      artifact.filePath,
      artifact.contentType,
      artifact.rowCount,
      artifact.byteSize,
      JSON.stringify({ artifact, reviewPath: payload.exportManifest.reviewPath, logPath: payload.exportManifest.logPath })
    ]);
  }
}

function jobRaw(job = {}) {
  return job.raw && typeof job.raw === "object" ? job.raw : {};
}

function jobErrors(job = {}) {
  const raw = jobRaw(job);
  const errors = Array.isArray(raw.errors) ? raw.errors : [];
  if (errors.length) return errors.map((error) => typeof error === "string" ? error : error?.message || JSON.stringify(error));
  return [];
}

function errorSku(error = "") {
  return String(error || "").match(/^([A-Z0-9_-]+):/)?.[1] || "";
}

async function postProductCreate(skus) {
  const response = await fetch(`${API_URL}/api/shopify/product-create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      skus,
      dryRun: false,
      apply: true,
      allowDraftIncomplete: false
    })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Queue request failed (${response.status}): ${text}`);
  return JSON.parse(text);
}

async function postProductCreateWithRetry(skus, absoluteOffset, logPath) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_QUEUE_ATTEMPTS; attempt += 1) {
    try {
      if (attempt > 1) appendLog(logPath, { event: "queue_retry", absoluteOffset, attempt, count: skus.length });
      return await postProductCreate(skus);
    } catch (error) {
      lastError = error;
      appendLog(logPath, { event: "queue_failed", absoluteOffset, attempt, error: error.message || String(error) });
      if (attempt < MAX_QUEUE_ATTEMPTS) await sleep(Math.min(60000, POLL_MS * attempt));
    }
  }
  throw lastError;
}

async function waitForJob(client, jobId) {
  for (;;) {
    const result = await client.query(`
      select job_id, status, message, processed_rows, total_rows, changed_rows, missing_rows, progress, output_path, error_path, raw
      from operations_jobs
      where job_id = $1
    `, [jobId]);
    const row = result.rows[0];
    if (!row) throw new Error(`Job ${jobId} was not found.`);
    const status = String(row.status || "");
    if (["success", "warning", "failed", "stopped"].includes(status)) return row;
    await sleep(POLL_MS);
  }
}

async function main() {
  loadEnv();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const candidatePath = path.resolve(argValue("--candidates", latestCandidateFile() || ""));
  const start = Math.max(0, Number(argValue("--start", "0")) || 0);
  const limit = Math.max(0, Number(argValue("--limit", "0")) || 0);
  if (!candidatePath || !fs.existsSync(candidatePath)) throw new Error("Candidate file was not found.");

  const candidate = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
  const allSkus = Array.isArray(candidate.skus) ? candidate.skus : [];
  const skus = limit > 0 ? allSkus.slice(start, start + limit) : allSkus.slice(start);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = path.join(OUT_DIR, `essendant-shopify-push-run-${stamp}.jsonl`);
  const reviewPath = path.join(OUT_DIR, `essendant-shopify-push-review-${stamp}.json`);
  const reviewCsvPath = path.join(OUT_DIR, `essendant-shopify-push-review-${stamp}.csv`);
  const runJobId = `essendant-shopify-push-review-${stamp}`;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const review = {
    createdAt: new Date().toISOString(),
    candidatePath,
    start,
    batchSize: BATCH_SIZE,
    totalQueuedSkus: skus.length,
    batches: [],
    errors: [],
    stoppedEarly: false
  };

  appendLog(logPath, { event: "start", candidatePath, start, batchSize: BATCH_SIZE, totalQueuedSkus: skus.length, reviewPath, reviewCsvPath });
  writeReview(reviewPath, reviewCsvPath, review);
  const client = await pool.connect();
  try {
    await upsertReviewJob(client, reviewJobPayload({
      runJobId,
      status: "running",
      message: `Essendant Shopify push batch run started for ${skus.length.toLocaleString()} SKU${skus.length === 1 ? "" : "s"}.`,
      candidatePath,
      start,
      skus,
      review,
      logPath,
      reviewCsvPath,
      reviewPath,
      stamp
    }));
    let consecutiveHardFailures = 0;
    for (let offset = 0; offset < skus.length; offset += BATCH_SIZE) {
      const batch = skus.slice(offset, offset + BATCH_SIZE);
      const absoluteOffset = start + offset;
      appendLog(logPath, { event: "queue_batch", absoluteOffset, count: batch.length, firstSku: batch[0], lastSku: batch[batch.length - 1] });
      const queued = await postProductCreateWithRetry(batch, absoluteOffset, logPath);
      const jobId = queued?.job?.id;
      if (!jobId) throw new Error(`No job id returned for offset ${absoluteOffset}.`);
      appendLog(logPath, { event: "job_queued", absoluteOffset, jobId });
      const job = await waitForJob(client, jobId);
      const errors = jobErrors(job);
      const status = String(job.status || "");
      const batchReview = {
        absoluteOffset,
        count: batch.length,
        jobId,
        status,
        processed: Number(job.processed_rows || 0),
        changed: Number(job.changed_rows || 0),
        missing: Number(job.missing_rows || 0),
        errorCount: errors.length,
        outputPath: job.output_path || "",
        errorPath: job.error_path || ""
      };
      review.batches.push(batchReview);
      for (const error of errors) {
        review.errors.push({
          absoluteOffset,
          jobId,
          status,
          sku: errorSku(error),
          error,
          message: job.message || ""
        });
      }
      if (!errors.length && ["failed", "stopped"].includes(status)) {
        review.errors.push({
          absoluteOffset,
          jobId,
          status,
          sku: "",
          error: job.message || `Job ended with ${status}.`,
          message: job.message || ""
        });
      }
      writeReview(reviewPath, reviewCsvPath, review);
      await upsertReviewJob(client, reviewJobPayload({
        runJobId,
        status: "running",
        message: `Essendant Shopify push review has ${review.batches.length.toLocaleString()} batch${review.batches.length === 1 ? "" : "es"} recorded and ${review.errors.length.toLocaleString()} issue${review.errors.length === 1 ? "" : "s"} for review.`,
        candidatePath,
        start,
        skus,
        review,
        logPath,
        reviewCsvPath,
        reviewPath,
        stamp
      }));
      appendLog(logPath, {
        event: "job_done",
        absoluteOffset,
        jobId,
        status,
        message: job.message,
        processed: job.processed_rows,
        changed: job.changed_rows,
        missing: job.missing_rows,
        outputPath: job.output_path,
        errorPath: job.error_path,
        errors: errors.slice(0, 5)
      });
      if (["failed", "stopped"].includes(status)) {
        consecutiveHardFailures += 1;
        appendLog(logPath, { event: "hard_failure_bypassed", absoluteOffset, jobId, status, consecutiveHardFailures });
      } else {
        consecutiveHardFailures = 0;
      }
      if (consecutiveHardFailures >= MAX_CONSECUTIVE_HARD_FAILURES) {
        review.stoppedEarly = true;
        writeReview(reviewPath, reviewCsvPath, review);
        await upsertReviewJob(client, reviewJobPayload({
          runJobId,
          status: "stopped",
          message: `Essendant Shopify push stopped after ${consecutiveHardFailures.toLocaleString()} consecutive hard failure${consecutiveHardFailures === 1 ? "" : "s"}. Open the review CSV for details.`,
          candidatePath,
          start,
          skus,
          review,
          logPath,
          reviewCsvPath,
          reviewPath,
          stamp
        }));
        appendLog(logPath, { event: "stop_after_hard_failures", consecutiveHardFailures });
        process.exitCode = 1;
        break;
      }
    }
    if (!review.stoppedEarly) {
      await upsertReviewJob(client, reviewJobPayload({
        runJobId,
        status: review.errors.length ? "warning" : "success",
        message: review.errors.length
          ? `Essendant Shopify push completed with ${review.errors.length.toLocaleString()} issue${review.errors.length === 1 ? "" : "s"} for review.`
          : "Essendant Shopify push completed with no review issues.",
        candidatePath,
        start,
        skus,
        review,
        logPath,
        reviewCsvPath,
        reviewPath,
        stamp
      }));
    }
  } finally {
    client.release();
    await pool.end();
  }
  appendLog(logPath, { event: "finish", batches: review.batches.length, errors: review.errors.length, stoppedEarly: review.stoppedEarly });
  console.log(JSON.stringify({ logPath, reviewPath, reviewCsvPath, batches: review.batches.length, errors: review.errors.length, stoppedEarly: review.stoppedEarly }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
