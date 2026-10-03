#!/usr/bin/env node
const db = require("../db");
const { readDbFast, applyCategorySuggestionsAtConfidence } = require("../server");

function argumentValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function main() {
  const minimumConfidence = Number(argumentValue("--minimum-confidence", "0.6"));
  if (!Number.isFinite(minimumConfidence) || minimumConfidence < 0 || minimumConfidence > 1) {
    throw new Error("--minimum-confidence must be between 0 and 1.");
  }
  const dryRun = process.argv.includes("--dry-run");
  const state = await readDbFast({ skipInventory: true });
  const result = await applyCategorySuggestionsAtConfidence(state, {
    minimumConfidence,
    channels: ["shopify", "ebay"],
    reviewedBy: "Luis approved confidence threshold",
    dryRun
  });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.closePool());
