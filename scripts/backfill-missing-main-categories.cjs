const { Pool } = require("pg");
const postgres = require("../db");

async function missingCount(pool) {
  const result = await pool.query(`
    select count(*)::int as count
    from products
    where nullif(btrim(main_category), '') is null
      and coalesce(
        nullif(btrim(source_category), ''),
        nullif(btrim(raw ->> 'vendorCategory'), ''),
        nullif(btrim(raw ->> 'sourceCategory'), '')
      ) is not null
  `);
  return Number(result.rows[0]?.count || 0);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const apply = process.argv.includes("--apply");
  const batchArgument = process.argv.find((value) => value.startsWith("--batch-size="));
  const batchSize = Math.max(1, Math.min(10000, Number(batchArgument?.split("=")[1] || 5000)));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const before = await missingCount(pool);
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", repairableProducts: before, batchSize }));
  if (!apply || before === 0) {
    await pool.end();
    return;
  }

  let updatedProducts = 0;
  while (true) {
    const result = await postgres.backfillMissingMainCategoriesFromVendor({ batchSize });
    updatedProducts += result.updatedProducts;
    console.log(JSON.stringify({ updatedProducts, remainingProducts: result.remainingProducts }));
    if (!result.updatedProducts || !result.remainingProducts) break;
  }
  await pool.query("delete from category_summary_index where scope = 'main'");
  const remainingProducts = await missingCount(pool);
  await pool.end();
  console.log(JSON.stringify({ complete: remainingProducts === 0, updatedProducts, remainingProducts, categoryIndexInvalidated: true }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
