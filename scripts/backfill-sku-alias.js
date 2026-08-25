#!/usr/bin/env node
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const postgres = require("../db");

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return String(process.argv[index + 1]).trim();
  const prefix = `--${name}=`;
  const entry = process.argv.find((arg) => arg.startsWith(prefix));
  return entry ? String(entry.slice(prefix.length)).trim() : fallback;
}

function updateLineObject(line = {}, fromSku, toSku, now, source) {
  const sku = String(line.sku || "").trim();
  const mappedSku = String(line.mappedSku || line.parentSku || "").trim();
  const changed = [sku, mappedSku].some((value) => value.toLowerCase() === fromSku.toLowerCase());
  if (!changed) return false;
  if (!line.originalSku) line.originalSku = fromSku;
  line.mappedFromSku = fromSku;
  line.sku = toSku;
  line.parentSku = toSku;
  line.skuMappingMode = "renamed-alias";
  line.skuMappedBy = source;
  line.skuMappedAt = line.skuMappedAt || now;
  return true;
}

function normalizeAliases(aliases) {
  return Array.isArray(aliases) ? aliases : [];
}

function addJsonAlias(product, fromSku, toSku, source, note, now) {
  product.aliases = normalizeAliases(product.aliases);
  const existing = product.aliases.find((alias) => String(alias.aliasSku || alias.sku || alias.value || "").trim().toLowerCase() === fromSku.toLowerCase());
  if (existing) {
    existing.active = true;
    existing.parentSku = toSku;
    existing.type = existing.type || "renamed";
    existing.source = existing.source || source;
    existing.updatedAt = now;
    return { created: false, updated: true };
  }
  product.aliases.push({
    id: crypto.createHash("sha1").update(`${product.id || toSku}:${fromSku}:renamed`).digest("hex"),
    parentSku: toSku,
    aliasSku: fromSku,
    source,
    type: "renamed",
    active: true,
    notes: note,
    createdAt: now,
    updatedAt: now
  });
  return { created: true, updated: false };
}

async function runJsonFallback({ fromSku, toSku, source, note, apply }) {
  const filePath = path.join(__dirname, "..", "data", "db.json");
  if (!fs.existsSync(filePath)) throw new Error("DATABASE_URL is not configured and data/db.json was not found.");
  const state = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const now = new Date().toISOString();
  const summary = {
    mode: "json",
    apply,
    fromSku,
    toSku,
    productId: "",
    aliasCreated: false,
    aliasUpdated: false,
    orderLinesMatched: 0,
    orderLinesUpdated: 0,
    ordersUpdated: 0,
    orderDocumentsUpdated: 0
  };
  const product = (state.inventory || []).find((item) => String(item.sku || "").trim().toLowerCase() === toSku.toLowerCase());
  if (!product) throw new Error(`Canonical product ${toSku} was not found in data/db.json.`);
  summary.productId = product.id || product.sku || "";
  const owner = (state.inventory || []).find((item) => normalizeAliases(item.aliases).some((alias) => String(alias.aliasSku || alias.sku || alias.value || "").trim().toLowerCase() === fromSku.toLowerCase() && alias.active !== false));
  if (owner && String(owner.id || owner.sku) !== String(product.id || product.sku)) {
    throw new Error(`Alias ${fromSku} already belongs to ${owner.sku || owner.id}.`);
  }
  for (const order of state.orders || []) {
    let changed = false;
    for (const line of Array.isArray(order.items) ? order.items : []) {
      const matched = [line.sku, line.mappedSku, line.parentSku, line.originalSku, line.mappedFromSku]
        .some((value) => String(value || "").trim().toLowerCase() === fromSku.toLowerCase());
      if (matched) summary.orderLinesMatched += 1;
      if (matched && apply) {
        changed = updateLineObject(line, fromSku, toSku, now, source) || changed;
        summary.orderLinesUpdated += 1;
      }
    }
    if (changed) {
      if (String(order.sku || "").trim().toLowerCase() === fromSku.toLowerCase()) order.sku = toSku;
      order.updatedAt = now;
      summary.ordersUpdated += 1;
    }
  }
  if (apply) {
    const aliasResult = addJsonAlias(product, fromSku, toSku, source, note, now);
    summary.aliasCreated = aliasResult.created;
    summary.aliasUpdated = aliasResult.updated;
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
  }
  return summary;
}

async function main() {
  const fromSku = argValue("from");
  const toSku = argValue("to");
  const source = argValue("source", "DataPlus SKU alias backfill");
  const note = argValue("note", `Backfilled SKU alias from ${fromSku} to ${toSku}`);
  const apply = process.argv.includes("--apply");

  if (!fromSku || !toSku) {
    throw new Error("Usage: node scripts/backfill-sku-alias.js --from OLD-SKU --to NEW-SKU [--apply]");
  }
  if (fromSku.toLowerCase() === toSku.toLowerCase()) {
    throw new Error("From and to SKU must be different.");
  }

  const databaseUrl = postgres.getDatabaseUrl();
  if (!databaseUrl) return runJsonFallback({ fromSku, toSku, source, note, apply });
  await postgres.initRelationalSchema();
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  const now = new Date().toISOString();
  const summary = {
    apply,
    fromSku,
    toSku,
    productId: "",
    aliasCreated: false,
    aliasUpdated: false,
    orderLinesMatched: 0,
    orderLinesUpdated: 0,
    ordersUpdated: 0,
    orderDocumentsUpdated: 0
  };

  try {
    await client.query("begin");
    const productResult = await client.query(
      "select product_id, sku from products where lower(sku) = lower($1) limit 1 for update",
      [toSku]
    );
    const product = productResult.rows[0];
    if (!product) throw new Error(`Canonical product ${toSku} was not found.`);
    summary.productId = product.product_id;

    const ownerResult = await client.query(
      "select product_id, alias_sku, active from product_aliases where lower(alias_sku) = lower($1) and active = true limit 1",
      [fromSku]
    );
    const owner = ownerResult.rows[0];
    if (owner && owner.product_id !== product.product_id) {
      throw new Error(`Alias ${fromSku} already belongs to product ${owner.product_id}.`);
    }
    summary.aliasUpdated = Boolean(owner && owner.product_id === product.product_id);
    summary.aliasCreated = !summary.aliasUpdated;

    const matchedLines = await client.query(
      `select line_id, order_id, line_index, sku, mapped_sku, original_sku, raw
       from order_line_items
       where lower(coalesce(sku, '')) = lower($1)
          or lower(coalesce(mapped_sku, '')) = lower($1)
          or lower(coalesce(original_sku, '')) = lower($1)
       order by order_id, line_index`,
      [fromSku]
    );
    summary.orderLinesMatched = matchedLines.rowCount;

    if (!apply) {
      await client.query("rollback");
      return summary;
    }

    const aliasId = crypto.createHash("sha1").update(`${product.product_id}:${fromSku}:renamed`).digest("hex");
    await client.query(
      `insert into product_aliases (
         alias_id, product_id, parent_sku, alias_sku, source, alias_type, active,
         raw, created_at, updated_at
       )
       values ($1, $2, $3, $4, $5, 'renamed', true, $6::jsonb, now(), now())
       on conflict (alias_id) do update set
         parent_sku = excluded.parent_sku,
         alias_sku = excluded.alias_sku,
         source = excluded.source,
         alias_type = excluded.alias_type,
         active = true,
         raw = product_aliases.raw || excluded.raw,
         updated_at = now()`,
      [aliasId, product.product_id, toSku, fromSku, source, JSON.stringify({ note, fromSku, toSku, source, appliedAt: now })]
    );

    for (const line of matchedLines.rows) {
      const raw = line.raw && typeof line.raw === "object" ? line.raw : {};
      updateLineObject(raw, fromSku, toSku, now, source);
      const result = await client.query(
        `update order_line_items
         set sku = case when lower(coalesce(sku, '')) = lower($2) then $3 else sku end,
             mapped_sku = $3,
             original_sku = coalesce(nullif(original_sku, ''), $2),
             raw = $4::jsonb
         where line_id = $1`,
        [line.line_id, fromSku, toSku, JSON.stringify(raw)]
      );
      summary.orderLinesUpdated += result.rowCount;
    }

    const orderIds = [...new Set(matchedLines.rows.map((line) => line.order_id).filter(Boolean))];
    for (const orderId of orderIds) {
      const orderResult = await client.query("select order_id, raw from order_records where order_id = $1 for update", [orderId]);
      const order = orderResult.rows[0];
      if (!order) continue;
      const raw = order.raw && typeof order.raw === "object" ? order.raw : {};
      let changed = false;
      if (String(raw.sku || "").trim().toLowerCase() === fromSku.toLowerCase()) {
        raw.sku = toSku;
        changed = true;
      }
      const items = Array.isArray(raw.items) ? raw.items : [];
      for (const item of items) changed = updateLineObject(item, fromSku, toSku, now, source) || changed;
      if (changed) {
        raw.updatedAt = now;
        await client.query("update order_records set raw = $2::jsonb, updated_at = now() where order_id = $1", [orderId, JSON.stringify(raw)]);
        summary.ordersUpdated += 1;
      }
    }

    const documentResult = await client.query("select entity_id, data from entity_documents where collection = 'orders' for update");
    for (const row of documentResult.rows) {
      const order = row.data && typeof row.data === "object" ? row.data : {};
      let changed = false;
      if (String(order.sku || "").trim().toLowerCase() === fromSku.toLowerCase()) {
        order.sku = toSku;
        changed = true;
      }
      for (const item of Array.isArray(order.items) ? order.items : []) {
        changed = updateLineObject(item, fromSku, toSku, now, source) || changed;
      }
      if (!changed) continue;
      order.updatedAt = now;
      await client.query(
        "update entity_documents set data = $2::jsonb, updated_at = now() where collection = 'orders' and entity_id = $1",
        [row.entity_id, JSON.stringify(order)]
      );
      summary.orderDocumentsUpdated += 1;
    }

    await client.query("commit");
    return summary;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main()
  .then((summary) => {
    console.log(JSON.stringify(summary, null, 2));
  })
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
