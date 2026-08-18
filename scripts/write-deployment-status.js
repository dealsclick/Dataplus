const { readDeploymentStatus, writeDeploymentStatus } = require("../lib/release-history");

const status = String(process.argv[2] || "unknown").trim().toLowerCase();
const revision = String(process.argv[3] || "").trim();
const startedAt = String(process.argv[4] || "").trim() || new Date().toISOString();
const previous = readDeploymentStatus() || {};
const now = new Date().toISOString();
const startedMs = Date.parse(startedAt);

const record = writeDeploymentStatus({
  environment: process.env.DATAPLUS_DEPLOY_ENVIRONMENT || "production",
  serviceUrl: process.env.DATAPLUS_PUBLIC_URL || "https://dataplusapp.duckdns.org",
  status,
  revision,
  shortRevision: revision.slice(0, 7),
  startedAt,
  deployedAt: status === "healthy" ? now : (previous.deployedAt || ""),
  failedAt: status === "failed" ? now : "",
  durationSeconds: Number.isFinite(startedMs) ? Math.max(0, Math.round((Date.now() - startedMs) / 1000)) : null
});

process.stdout.write(`${JSON.stringify(record)}\n`);
