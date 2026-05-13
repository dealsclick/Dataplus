const { Pool } = require("pg");

let pool;

function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL || "";
  if (!databaseUrl || process.env.DATAPLUS_DOCKER !== "1") return databaseUrl;
  try {
    const url = new URL(databaseUrl);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      url.hostname = "host.docker.internal";
      return url.toString();
    }
  } catch {
    return databaseUrl;
  }
  return databaseUrl;
}

function isPostgresEnabled() {
  return Boolean(getDatabaseUrl());
}

function getPool() {
  if (!isPostgresEnabled()) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: getDatabaseUrl()
    });
  }
  return pool;
}

async function initDatabase() {
  const client = getPool();
  if (!client) return false;
  await client.query(`
    create table if not exists app_state (
      id integer primary key default 1 check (id = 1),
      data json not null,
      updated_at timestamptz not null default now()
    )
  `);
  const column = await client.query(`
    select data_type
    from information_schema.columns
    where table_name = 'app_state' and column_name = 'data'
  `);
  if (column.rows[0]?.data_type === "jsonb") {
    await client.query("alter table app_state alter column data type json using data::json");
  }
  return true;
}

async function readState() {
  const client = getPool();
  if (!client) return null;
  await initDatabase();
  const result = await client.query("select data from app_state where id = 1");
  return result.rows[0]?.data || null;
}

async function readStateField(field) {
  const client = getPool();
  if (!client) return undefined;
  await initDatabase();
  const result = await client.query("select data -> $1 as value from app_state where id = 1", [field]);
  return result.rows[0]?.value;
}

async function readCategoryState() {
  const client = getPool();
  if (!client) return null;
  await initDatabase();
  const result = await client.query(`
    select json_build_object(
      'inventory', coalesce((
        select json_agg(json_build_object(
          'sku', item ->> 'sku',
          'title', item ->> 'title',
          'marketplaceTitle', item ->> 'marketplaceTitle',
          'category', item ->> 'category',
          'mainCategory', item ->> 'mainCategory',
          'sourceCategory', item ->> 'sourceCategory',
          'vendorCategory', item ->> 'vendorCategory',
          'categoryVerified', item -> 'categoryVerified',
          'active', item -> 'active',
          'stockQty', item -> 'stockQty',
          'qty', item -> 'qty',
          'hazardous', item -> 'hazardous',
          'supplier', item ->> 'supplier',
          'vendor', item ->> 'vendor',
          'brand', item ->> 'brand'
        ))
        from json_array_elements(data -> 'inventory') item
      ), '[]'::json),
      'categorySettings', coalesce(data -> 'categorySettings', '[]'::json),
      'vendorCategoryMappings', coalesce(data -> 'vendorCategoryMappings', '{}'::json)
    ) as data
    from app_state
    where id = 1
  `);
  return result.rows[0]?.data || null;
}

async function writeState(data) {
  const client = getPool();
  if (!client) return false;
  await initDatabase();
  await client.query(
    `
      insert into app_state (id, data, updated_at)
      values (1, $1::json, now())
      on conflict (id)
      do update set data = excluded.data, updated_at = now()
    `,
    [JSON.stringify(data)]
  );
  return true;
}

async function writeStateField(field, value) {
  const client = getPool();
  if (!client) return false;
  await initDatabase();
  await client.query(
    `
      update app_state
      set data = jsonb_set(data::jsonb, $1::text[], $2::jsonb, true)::json,
          updated_at = now()
      where id = 1
    `,
    [[field], JSON.stringify(value)]
  );
  return true;
}

async function closePool() {
  if (pool) await pool.end();
  pool = null;
}

module.exports = {
  closePool,
  getDatabaseUrl,
  initDatabase,
  readCategoryState,
  isPostgresEnabled,
  readState,
  readStateField,
  writeStateField,
  writeState
};
