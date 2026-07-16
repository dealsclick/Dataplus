const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const ROOT = path.resolve(__dirname, "..");

function loadEnv() {
  const envFile = path.join(ROOT, ".env");
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

function fileSize(filePath) {
  try {
    return fs.existsSync(filePath) ? fs.statSync(filePath).size : null;
  } catch {
    return null;
  }
}

function artifactFor(jobId, kind, filePath, contentType, rowCount = 0) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return {
    artifactId: `${jobId}:${kind}:${crypto.createHash("sha1").update(filePath).digest("hex").slice(0, 16)}`,
    jobId,
    kind,
    fileName: path.basename(filePath),
    filePath,
    contentType,
    rowCount,
    byteSize: fileSize(filePath)
  };
}

async function upsertArtifact(client, artifact) {
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
    artifact.artifactId,
    artifact.jobId,
    artifact.kind,
    artifact.fileName,
    artifact.filePath,
    artifact.contentType,
    artifact.rowCount,
    artifact.byteSize,
    JSON.stringify({ artifact })
  ]);
}

async function main() {
  loadEnv();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  let jobs = 0;
  let artifacts = 0;
  try {
    const result = await client.query(`
      select job_id, output_path, raw
      from operations_jobs
      where name = 'Essendant Shopify push review'
      order by created_at desc
    `);
    for (const row of result.rows) {
      const raw = row.raw || {};
      const manifest = raw.exportManifest || {};
      const reviewCsvPath = row.output_path || raw.originalFilePath || manifest.reviewCsvPath || "";
      const reviewPath = manifest.reviewPath || "";
      const logPath = manifest.logPath || "";
      const candidatePath = raw.workerPayload?.candidatePath || "";
      const review = reviewPath && fs.existsSync(reviewPath) ? JSON.parse(fs.readFileSync(reviewPath, "utf8")) : {};
      const batchCount = Array.isArray(review.batches) ? review.batches.length : 0;
      const errorCount = Array.isArray(review.errors) ? review.errors.length : Number(row.raw?.missingCount || 0);
      const skuCount = Number(raw.totalRows || raw.workerPayload?.totalQueuedSkus || 0);
      const rows = [
        artifactFor(row.job_id, "original", reviewCsvPath, "text/csv", errorCount),
        artifactFor(row.job_id, "review-json", reviewPath, "application/json", batchCount),
        artifactFor(row.job_id, "run-log", logPath, "application/x-ndjson", batchCount),
        artifactFor(row.job_id, "candidates", candidatePath, "application/json", skuCount)
      ].filter(Boolean);
      if (!rows.length) continue;
      for (const artifact of rows) {
        await upsertArtifact(client, artifact);
        artifacts += 1;
      }
      jobs += 1;
    }
  } finally {
    client.release();
    await pool.end();
  }
  console.log(JSON.stringify({ jobs, artifacts }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
