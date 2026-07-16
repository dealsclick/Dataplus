const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "outputs", "shopify-push");

function loadEnv() {
  const envFile = path.join(ROOT, ".env");
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

async function main() {
  loadEnv();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const result = await client.query(`
      with ess as (
        select
          p.sku,
          coalesce(p.title, p.marketplace_title, '') title,
          coalesce(nullif(p.category, ''), nullif(p.main_category, '')) as mapped_category,
          p.cost,
          p.price,
          p.qty,
          p.uom,
          p.uom_qty,
          p.to_be_discontinued,
          p.active,
          p.default_image,
          p.raw,
          s.shopify_id,
          coalesce(p.raw ->> 'vendorWebsitePrice', p.raw ->> 'vendor_website_price', p.raw -> 'productManagerFields' ->> 'vendor_website_price') as vendor_website_price,
          coalesce(p.raw ->> 'minimumAllowedPrice', p.raw ->> 'minimum_allowed_price', p.raw -> 'productManagerFields' ->> 'minimum_allowed_price') as min_allowed_price,
          coalesce(p.raw ->> 'longDescription', p.raw ->> 'description', p.raw ->> 'shortDescription') as description
        from products p
        left join shopify_product_statuses s on lower(s.sku) = lower(p.sku) and coalesce(s.shopify_id, '') <> ''
        where (
          p.supplier_code in ('USS', 'uss')
          or lower(coalesce(p.supplier, p.raw ->> 'supplier', p.raw ->> 'vendor', '')) like '%essendant%'
        )
      ),
      priced as (
        select *,
          coalesce(nullif(cost, 0), nullif(price, 0), 0) as sell_unit_cost,
          coalesce(nullif(min_allowed_price, '')::numeric, 0) as minimum_allowed,
          case
            when coalesce(nullif(vendor_website_price, '')::numeric, 0) > 0
              and coalesce(nullif(vendor_website_price, '')::numeric, 0) >= greatest(coalesce(nullif(cost, 0), nullif(price, 0), 0), coalesce(nullif(min_allowed_price, '')::numeric, 0))
              then coalesce(nullif(vendor_website_price, '')::numeric, 0)
            when coalesce(nullif(cost, 0), nullif(price, 0), 0) > 0
              then greatest(
                round((coalesce(nullif(cost, 0), nullif(price, 0), 0) * 1.35)::numeric, 2),
                coalesce(nullif(min_allowed_price, '')::numeric, 0)
              )
            else 0
          end as computed_price
        from ess
      )
      select sku, title, mapped_category, cost, price, computed_price, qty, uom, uom_qty
      from priced
      where coalesce(to_be_discontinued, false) = false
        and coalesce(active, true) = true
        and coalesce(qty, 0) > 0
        and mapped_category is not null
        and mapped_category <> ''
        and mapped_category <> 'Uncategorized'
        and computed_price > 0
        and default_image is not null
        and default_image <> ''
        and description is not null
        and description <> ''
        and shopify_id is null
        and computed_price <= greatest(coalesce(nullif(cost, 0), nullif(price, 0), 0) * 5, 1000)
        and not (
          (
            lower(mapped_category) like '%calendar%'
            or lower(mapped_category) like '%planner%'
            or lower(mapped_category) like '%dated%'
            or lower(title) like '%planner%'
            or lower(title) like '%calendar%'
          )
          and title ~* '(2024|2025)'
        )
      order by sku
    `);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const jsonPath = path.join(OUT_DIR, `essendant-shopify-push-candidates-${stamp}.json`);
    const csvPath = path.join(OUT_DIR, `essendant-shopify-push-candidates-${stamp}.csv`);
    const skus = result.rows.map((row) => row.sku);
    fs.writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), count: skus.length, skus, sample: result.rows.slice(0, 100) }, null, 2));
    fs.writeFileSync(csvPath, [
      "sku,title,mapped_category,cost,price,computed_price,qty,uom,uom_qty",
      ...result.rows.map((row) => [
        row.sku,
        row.title,
        row.mapped_category,
        row.cost,
        row.price,
        row.computed_price,
        row.qty,
        row.uom,
        row.uom_qty
      ].map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","))
    ].join("\n"));
    console.log(JSON.stringify({ count: skus.length, jsonPath, csvPath, sample: result.rows.slice(0, 5) }, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
