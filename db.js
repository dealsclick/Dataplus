const { Pool } = require("pg");

let pool;

function getDatabaseUrl() {
  return process.env.DATABASE_URL || "";
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
      data jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);
  return true;
}

async function readState() {
  const client = getPool();
  if (!client) return null;
  await initDatabase();
  const result = await client.query("select data from app_state where id = 1");
  return result.rows[0]?.data || null;
}

async function writeState(data) {
  const client = getPool();
  if (!client) return false;
  await initDatabase();
  await client.query(
    `
      insert into app_state (id, data, updated_at)
      values (1, $1::jsonb, now())
      on conflict (id)
      do update set data = excluded.data, updated_at = now()
    `,
    [JSON.stringify(data)]
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
  isPostgresEnabled,
  readState,
  writeState
};
