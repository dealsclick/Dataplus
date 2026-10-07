#!/usr/bin/env node
const { recoverTemuFulfillmentBatch } = require("../server");

const batchReference = String(process.argv[2] || "").trim();
if (!batchReference) {
  console.error("Usage: node scripts/recover-temu-label-batch.cjs BATCH-1006");
  process.exit(1);
}

recoverTemuFulfillmentBatch(batchReference)
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.failed.length ? 2 : 0);
  })
  .catch((error) => {
    console.error(error.stack || error.message || error);
    process.exit(1);
  });
