#!/usr/bin/env node
const crypto = require("node:crypto");
const db = require("../db");
const { readDbFast, applyCategorySuggestionsAtConfidence } = require("../server");
const { selectWalmartCategoryMappings } = require("../lib/bulk-category-mapping");

const dryRun = process.argv.includes("--dry-run");
const actor = "Luis approved all channel category suggestions";
const stamp = () => new Date().toISOString();
const walmartMappingKey = (category) => `walmart.mapping.${crypto.createHash("sha256").update(String(category || "").trim().toLowerCase()).digest("hex")}`;

async function walmartPlan(categorySettings) {
  const pool = db.getPool();
  const [taxonomyResult, reviewResult, mappingResult] = await Promise.all([
    pool.query("select data from walmart_documents where doc_key='walmart.taxonomy'"),
    pool.query("select distinct on (lower(btrim(data->>'category'))) data from walmart_documents where doc_key like 'walmart.category-review.%' order by lower(btrim(data->>'category')), updated_at desc, doc_key desc"),
    pool.query("select data from walmart_documents where doc_key like 'walmart.mapping.%'")
  ]);
  const taxonomy = taxonomyResult.rows[0]?.data || {};
  if (!Array.isArray(taxonomy.rows) || !taxonomy.rows.length) throw new Error("Walmart taxonomy cache is empty.");
  return {
    version: taxonomy.version || "",
    ...selectWalmartCategoryMappings(
      categorySettings.map((row) => row.name),
      taxonomy.rows,
      reviewResult.rows.map((row) => row.data),
      mappingResult.rows.map((row) => row.data)
    )
  };
}

async function applyWalmartPlan(plan) {
  if (dryRun || !plan.selected.length) return;
  const pool = db.getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const row of plan.selected) {
      const now = stamp();
      const mapping = {
        category: row.category,
        productType: row.productType,
        path: row.path,
        version: plan.version,
        orderable: {},
        visible: {},
        approvedBy: actor,
        updatedAt: now,
        status: "mapped",
        locked: true,
        confidence: row.confidence,
        matchSource: row.matchSource,
        history: [{ at: now, actor, action: "bulk-approve-suggestion", previousProductType: null, productType: row.productType }]
      };
      await client.query(
        "insert into walmart_documents(doc_key,data,updated_at) values($1,$2::jsonb,now()) on conflict(doc_key) do nothing",
        [walmartMappingKey(row.category), JSON.stringify(mapping)]
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const state = await readDbFast({ skipInventory: true });
  state.categorySettings = await db.readStateField("categorySettings") || [];
  const ebay = await applyCategorySuggestionsAtConfidence(state, {
    minimumConfidence: 0.0001,
    channels: ["ebay"],
    reviewedBy: actor,
    dryRun
  });
  const walmart = await walmartPlan(state.categorySettings);
  await applyWalmartPlan(walmart);
  console.log(JSON.stringify({
    dryRun,
    ebay: { changed: ebay.changed, eligible: ebay.results[0]?.categories?.length || 0, skipped: ebay.results[0]?.skipped || [] },
    walmart: {
      version: walmart.version,
      mapped: walmart.selected.length,
      savedSuggestions: walmart.selected.filter((row) => row.matchSource === "saved-review-suggestion").length,
      exactMatches: walmart.selected.filter((row) => row.matchSource !== "saved-review-suggestion").length,
      remaining: walmart.missing.length,
      missing: walmart.missing.slice(0, 100)
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
