#!/usr/bin/env node
const postgres = require("../db");

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const valueAfter = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const timeoutSeconds = Math.max(30, Number(valueAfter("--timeout-seconds", "300")) || 300);
const pollMilliseconds = 2000;

async function writeGate(paused, details = {}) {
  const client = await postgres.getPool().connect();
  try {
    await client.query("begin");
    await client.query("set local statement_timeout = '20s'");
    await client.query("set local lock_timeout = '5s'");
    await client.query(`
      insert into state_documents (doc_key, data, updated_at)
      values ('fulfillmentDeploymentGate', $1::jsonb, now())
      on conflict (doc_key) do update set data = excluded.data, updated_at = now()
    `, [JSON.stringify({
      paused,
      reason: paused ? "production_deployment" : "",
      ...details
    })]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function activeLabelPurchaseJobs(jobs = []) {
  return jobs.filter((job) => {
    const task = String(job.workerTask || job.raw?.workerTask || "");
    const status = String(job.status || "").toLowerCase();
    return task === "fulfillment-label-purchase" && ["queued", "running"].includes(status);
  });
}

async function readActiveLabelPurchaseJobs() {
  const result = await postgres.getPool().query(`
    select job_id as id, job_number, status, raw
    from operations_jobs
    where lower(status) in ('queued', 'running')
      and raw ->> 'workerTask' = 'fulfillment-label-purchase'
    order by created_at asc
  `);
  return result.rows.map((row) => ({
    ...(row.raw || {}),
    id: row.id,
    jobNumber: Number(row.job_number || row.raw?.jobNumber || 0) || undefined,
    status: row.status
  }));
}

async function main() {
  if (!postgres.isPostgresEnabled()) throw new Error("DATABASE_URL is required to coordinate label-purchase deployments.");
  if (hasFlag("--resume")) {
    console.log("Reopening label purchasing after deployment...");
    await writeGate(false, { resumedAt: new Date().toISOString() });
    console.log("Label purchasing resumed.");
    return;
  }
  if (!hasFlag("--pause")) throw new Error("Use --pause to drain purchases or --resume to reopen purchasing.");

  const pausedAt = new Date().toISOString();
  console.log(`Writing the label-purchase deployment gate at ${pausedAt}...`);
  await writeGate(true, { pausedAt });
  console.log(`New label purchases paused at ${pausedAt}. Waiting for active purchases to finish...`);
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const active = activeLabelPurchaseJobs(await readActiveLabelPurchaseJobs());
    if (!active.length) {
      console.log("Label-purchase drain complete; no queued or running purchase jobs remain.");
      return;
    }
    console.log(`Waiting for ${active.length} label-purchase job${active.length === 1 ? "" : "s"}: ${active.map((job) => job.jobNumber || job.id).join(", ")}`);
    await new Promise((resolve) => setTimeout(resolve, pollMilliseconds));
  }
  throw new Error(`Timed out after ${timeoutSeconds} seconds while waiting for label purchases to finish. Deployment remains blocked.`);
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(() => postgres.closePool());
