#!/usr/bin/env node
const crypto = require("node:crypto");
const db = require("../db");

function argumentValue(name, fallback = "") {
  const prefix = `${name}=`;
  const inline = process.argv.find(value => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || fallback) : fallback;
}

async function main() {
  if (!db.isPostgresEnabled()) throw new Error("DATABASE_URL is required.");
  const preview = await db.previewDuplicateInternalOrderNumberRepair();
  console.log(JSON.stringify({ mode: "preview", ...preview }, null, 2));
  if (!process.argv.includes("--apply")) return;

  const backupManifestPath = argumentValue("--backup-manifest");
  if (!backupManifestPath) {
    throw new Error("Apply requires --backup-manifest with the verified backup path.");
  }
  if (!preview.changedCount) {
    console.log(JSON.stringify({ mode: "apply", changedCount: 0, message: "No duplicate internal order numbers remain." }, null, 2));
    return;
  }
  const result = await db.applyDuplicateInternalOrderNumberRepair({
    runId: `duplicate-order-number-repair-${crypto.randomUUID()}`,
    fingerprint: preview.fingerprint,
    requestedBy: argumentValue("--requested-by", "DataPlus maintenance"),
    backupManifestPath
  });
  console.log(JSON.stringify({ mode: "apply", ...result }, null, 2));
}

main()
  .catch(error => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  })
  .finally(() => db.closePool().catch(() => {}));
