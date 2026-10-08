#!/usr/bin/env node
const { recoverTemuFulfillmentBatch } = require("../server");

const batchReference = String(process.argv[2] || "").trim();
const retryUnpurchased = process.argv.includes("--retry-unpurchased");
if (!batchReference) {
  console.error("Usage: node scripts/recover-temu-label-batch.cjs BATCH-1006 [--retry-unpurchased]");
  process.exit(1);
}

recoverTemuFulfillmentBatch(batchReference, "DataPlus recovery", { retryUnpurchased })
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.failed.length ? 2 : 0);
  })
  .catch((error) => {
    console.error(error.stack || error.message || error);
    process.exit(1);
  });
