#!/usr/bin/env node
const crypto = require("node:crypto");
const db = require("../db");
const { queueWalmartReadinessJob } = require("../server");

function argument(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : fallback;
}

async function queueShopifyReadiness(supplier, selectionTotal) {
  const active = (await db.readOperationJobs(250)).find((job) =>
    ["queued", "running"].includes(String(job.status || "").toLowerCase())
    && job.workerTask === "shopify-product-create"
    && job.workerPayload?.dryRun === true
    && String(job.workerPayload?.filters?.supplier || "").trim().toLowerCase() === supplier.toLowerCase()
  );
  if (active) return { job: active, duplicate: true };
  const now = new Date().toISOString();
  const filters = { supplier };
  const batchSize = 500;
  const job = {
    id: crypto.randomUUID(),
    section: "Products",
    category: "Products",
    operation: `Shopify readiness check - ${supplier}`,
    direction: "sync",
    status: "queued",
    fileName: "shopify-product-create-dry-run.json",
    totalRows: selectionTotal,
    processedRows: 0,
    changed: 0,
    missingCount: 0,
    progressPercent: 0,
    phase: "queued",
    workerTask: "shopify-product-create",
    workerPayload: {
      skus: [],
      allFiltered: true,
      selectionTotal,
      query: "",
      filters,
      limit: batchSize,
      batchSize,
      dryRun: true,
      apply: false,
      allowDraftIncomplete: false
    },
    message: `Shopify readiness check queued for ${selectionTotal.toLocaleString()} ${supplier} products. Nothing will be published.`,
    createdAt: now,
    updatedAt: now
  };
  await db.upsertOperationJob(job);
  return { job: await db.readOperationJob(job.id), duplicate: false };
}

async function main() {
  const supplier = argument("supplier", "True Value");
  if (!supplier) throw new Error("Provide --supplier with a supplier name.");
  const filters = { supplier };
  const selectionTotal = await db.countProducts({ filters });
  if (!selectionTotal) throw new Error(`No catalog products matched supplier ${supplier}.`);

  const [walmart, shopify] = await Promise.all([
    queueWalmartReadinessJob("Luis", {
      skus: [],
      allFiltered: true,
      query: "",
      filters,
      selectionTotal
    }),
    queueShopifyReadiness(supplier, selectionTotal)
  ]);
  console.log(JSON.stringify({
    supplier,
    selectionTotal,
    walmart: {
      duplicate: walmart.duplicate === true,
      id: walmart.job?.id,
      jobNumber: walmart.job?.jobNumber,
      status: walmart.job?.status,
      message: walmart.message || walmart.job?.message
    },
    shopify: {
      duplicate: shopify.duplicate === true,
      id: shopify.job?.id,
      jobNumber: shopify.job?.jobNumber,
      status: shopify.job?.status,
      message: shopify.duplicate ? "This Shopify readiness check is already queued or running." : shopify.job?.message
    }
  }, null, 2));
}

main().then(async () => {
  await db.closePool();
  process.exit(0);
}).catch(async (error) => {
  console.error(error);
  await db.closePool();
  process.exit(1);
});
