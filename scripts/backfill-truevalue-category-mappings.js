const fs = require("fs");
const { Pool } = require("pg");

function loadEnv() {
  if (!fs.existsSync(".env")) return;
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function categoryName(value) {
  return text(value).replace(/\s*>\s*/g, " > ").replace(/\s+/g, " ").trim();
}

function mappingKey(supplier, vendorCategory) {
  const supplierKey = text(supplier).toLowerCase();
  const categoryKey = categoryName(vendorCategory).toLowerCase();
  return supplierKey && categoryKey ? `${supplierKey}::${categoryKey}` : "";
}

async function main() {
  loadEnv();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const now = new Date().toISOString();
  const client = await pool.connect();
  try {
    const existingResult = await client.query("select data from state_documents where doc_key = 'vendorCategoryMappings' limit 1");
    const existing = existingResult.rows[0]?.data && typeof existingResult.rows[0].data === "object" ? existingResult.rows[0].data : {};
    const canonicalResult = await client.query(`
      select distinct
        coalesce(nullif(source_category, ''), nullif(raw ->> 'vendorCategory', ''), nullif(raw -> 'productManagerFields' ->> 'category', '')) as category_name
      from products
      where (
        lower(coalesce(supplier, raw ->> 'supplier', raw ->> 'vendor', '')) like '%true value%'
        or lower(coalesce(supplier_code, raw ->> 'supplierCode', raw ->> 'defaultSupplier', '')) = 'trv'
      )
        and coalesce(nullif(source_category, ''), nullif(raw ->> 'vendorCategory', ''), nullif(raw -> 'productManagerFields' ->> 'category', '')) is not null
    `);
    const canonicalByKey = new Map();
    for (const row of canonicalResult.rows) {
      const name = categoryName(row.category_name);
      if (name) canonicalByKey.set(name.toLowerCase(), name);
    }

    const sourceResult = await client.query(`
      with source_rows as (
        select
          coalesce(nullif(supplier, ''), nullif(raw ->> 'supplier', ''), nullif(raw ->> 'vendor', ''), nullif(supplier_code, ''), 'Unknown supplier') as supplier_name,
          coalesce(nullif(source_category, ''), nullif(raw ->> 'vendorCategory', ''), nullif(raw -> 'productManagerFields' ->> 'category', '')) as vendor_category,
          sku
        from products
        where not (
          lower(coalesce(supplier, raw ->> 'supplier', raw ->> 'vendor', '')) like '%true value%'
          or lower(coalesce(supplier_code, raw ->> 'supplierCode', raw ->> 'defaultSupplier', '')) = 'trv'
        )
      )
      select
        supplier_name as supplier,
        vendor_category,
        min(sku) as sample_sku,
        count(*)::int as match_count
      from source_rows
      where vendor_category is not null
      group by supplier_name, vendor_category
    `);

    const next = { ...existing };
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const samples = [];
    for (const row of sourceResult.rows) {
      const supplier = text(row.supplier);
      const vendorCategory = categoryName(row.vendor_category);
      const mainCategory = canonicalByKey.get(vendorCategory.toLowerCase());
      if (!supplier || !vendorCategory || !mainCategory) {
        skipped += 1;
        continue;
      }
      const key = mappingKey(supplier, vendorCategory);
      const previous = next[key];
      next[key] = {
        ...(previous || {}),
        supplier,
        vendorCategory,
        mainCategory,
        categoryVerified: true,
        source: "true-value-canonical-category",
        sampleSku: previous?.sampleSku || row.sample_sku || "",
        matchCount: Number(row.match_count || previous?.matchCount || 0),
        conflictCount: 0,
        updatedAt: now,
        createdAt: previous?.createdAt || now
      };
      if (previous) updated += 1;
      else created += 1;
      if (samples.length < 12) samples.push({ supplier, vendorCategory, mainCategory, matchCount: Number(row.match_count || 0) });
    }

    await client.query(`
      insert into state_documents (doc_key, data, updated_at)
      values ('vendorCategoryMappings', $1::jsonb, now())
      on conflict (doc_key) do update set data = excluded.data, updated_at = now()
    `, [JSON.stringify(next)]);

    console.log(JSON.stringify({
      canonicalTrueValueCategories: canonicalByKey.size,
      sourceCategories: sourceResult.rows.length,
      created,
      updated,
      skipped,
      totalMappings: Object.keys(next).length,
      samples
    }, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
