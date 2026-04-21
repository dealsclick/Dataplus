const fs = require("fs");
const path = require("path");
const { initDatabase, readState, writeState, closePool } = require("../db");

const ROOT = path.join(__dirname, "..");
const ENV_FILE = path.join(ROOT, ".env");
const DB_FILE = path.join(ROOT, "data", "db.json");

function loadLocalEnv() {
  if (!fs.existsSync(ENV_FILE)) return;
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

async function main() {
  loadLocalEnv();
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing from .env");
  }
  if (!fs.existsSync(DB_FILE)) {
    throw new Error(`JSON database not found at ${DB_FILE}`);
  }

  await initDatabase();
  const existing = await readState();
  if (existing && process.argv.includes("--no-overwrite")) {
    console.log("Postgres already has app_state. Skipping because --no-overwrite was used.");
    return;
  }

  const json = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  await writeState(json);
  console.log(`Migrated ${json.orders?.length || 0} orders, ${json.inventory?.length || 0} products, and ${json.customers?.length || 0} customers to Postgres.`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
