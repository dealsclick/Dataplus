#!/usr/bin/env node
const crypto = require("node:crypto");
const db = require("../db");
const { selectEbayCategoryMappings, selectWalmartCategoryMappings } = require("../lib/bulk-category-mapping");

const dryRun = process.argv.includes("--dry-run");
const actor = "Luis approved all channel category suggestions";
const stamp = () => new Date().toISOString();
const walmartMappingKey = (category) => `walmart.mapping.${crypto.createHash("sha256").update(String(category || "").trim().toLowerCase()).digest("hex")}`;
const ebayMappingKey = (category) => crypto.createHash("sha1").update(`${String(category || "").trim().toLowerCase()}::ebay`).digest("hex");

async function categoryRecords() {
  const result = await db.getPool().query(`
    select entity_id, position, data
    from entity_documents
    where collection = 'categorySettings'
    order by position, entity_id
  `);
  return result.rows;
}

function ebayPlan(records) {
  const now = stamp();
  return selectEbayCategoryMappings(records).map(({ record, category, current, pending }) => {
    const mapping = {
      ...current,
      categoryId: pending.categoryId,
      categoryPath: pending.categoryPath || pending.fullName || pending.path || pending.name || "",
      categoryHandle: pending.categoryHandle || pending.handle || "",
      taxonomyVersion: pending.taxonomyVersion || pending.taxonomy || current.taxonomyVersion || "",
      categoryTreeVersion: pending.categoryTreeVersion || current.categoryTreeVersion || "",
      status: "mapped",
      decision: "approved",
      confidence: Number.isFinite(Number(pending.confidence)) ? Number(pending.confidence) : current.confidence,
      matchSource: "ebay-category-review-approved",
      matchedAt: now,
      reviewedBy: actor,
      reviewedAt: now,
      aiProvider: pending.provider || current.aiProvider || "",
      aiModel: pending.model || current.aiModel || "",
      aiRationale: pending.rationale || current.aiRationale || "",
      pendingSuggestion: null,
      locked: true,
      lockedAt: now,
      lockedBy: actor,
      unlockedAt: "",
      unlockedBy: "",
      history: [...(Array.isArray(current.history) ? current.history : []), {
        at: now,
        actor,
        action: "bulk-approve-suggestion",
        previousCategoryId: current.categoryId || null,
        categoryId: pending.categoryId
      }]
    };
    return {
      entityId: record.entity_id,
      category: {
        ...category,
        mappings: { ...(category.mappings || {}), ebay: mapping },
        status: "mapped",
        updatedBy: actor,
        updatedAt: now
      },
      mapping
    };
  });
}

function ebayIndexRows(plan) {
  return plan.map((row) => ({
    mapping_id: ebayMappingKey(row.category.name),
    category_id: row.category.categoryId || row.category.id || null,
    category_name: row.category.name,
    channel_category_id: row.mapping.categoryId,
    channel_category_path: row.mapping.categoryPath || null,
    channel_category_handle: row.mapping.categoryHandle || null,
    attribute_count: Array.isArray(row.mapping.attributes) ? row.mapping.attributes.length : 0,
    attribute_mapping_count: Array.isArray(row.mapping.attributeMappings) ? row.mapping.attributeMappings.length : 0,
    raw: row.mapping
  }));
}

async function applyEbayPlan(plan) {
  if (dryRun || !plan.length) return;
  const client = await db.getPool().connect();
  try {
    await client.query("begin");
    await client.query(`
      update entity_documents as target
      set data = incoming.data, updated_at = now()
      from jsonb_to_recordset($1::jsonb) as incoming(entity_id text, data jsonb)
      where target.collection = 'categorySettings' and target.entity_id = incoming.entity_id
    `, [JSON.stringify(plan.map((row) => ({ entity_id: row.entityId, data: row.category })))]);
    await client.query(`
      insert into category_channel_mappings (
        mapping_id, category_id, category_name, channel, channel_category_id,
        channel_category_path, channel_category_handle, status, attribute_count,
        attribute_mapping_count, raw, updated_at
      )
      select mapping_id, category_id, category_name, 'ebay', channel_category_id,
        channel_category_path, channel_category_handle, 'mapped', attribute_count,
        attribute_mapping_count, raw, now()
      from jsonb_to_recordset($1::jsonb) as incoming(
        mapping_id text, category_id text, category_name text, channel_category_id text,
        channel_category_path text, channel_category_handle text, attribute_count integer,
        attribute_mapping_count integer, raw jsonb
      )
      on conflict (mapping_id) do update set
        category_id = excluded.category_id,
        category_name = excluded.category_name,
        channel_category_id = excluded.channel_category_id,
        channel_category_path = excluded.channel_category_path,
        channel_category_handle = excluded.channel_category_handle,
        status = excluded.status,
        attribute_count = excluded.attribute_count,
        attribute_mapping_count = excluded.attribute_mapping_count,
        raw = excluded.raw,
        updated_at = now()
    `, [JSON.stringify(ebayIndexRows(plan))]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

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
  const client = await db.getPool().connect();
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
  const records = await categoryRecords();
  const ebay = ebayPlan(records);
  const walmart = await walmartPlan(records.map((row) => row.data));
  await applyEbayPlan(ebay);
  await applyWalmartPlan(walmart);
  console.log(JSON.stringify({
    dryRun,
    ebay: { mapped: ebay.length },
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
