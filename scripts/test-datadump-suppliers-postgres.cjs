const assert = require("node:assert/strict");
const url = process.env.DATAPLUS_TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test") || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
  throw new Error("Use an isolated local database ending in _test.");
}
process.env.DATABASE_URL = url;
const db = require("../db");
async function main() {
  await db.initRelationalSchema();
  const pool = db.getPool();
  const existing = { id: "existing", name: "Existing", code: "OLD", retirement: { retiredAt: "2026-01-01" }, catalogSettings: { enabled: false } };
  await db.writeStateDocuments({ vendors: [existing] });
  const suppliers = [{ name: "D&H", code: "DH", rows: 25, exampleSku: "BUS00667C2GDH" }, { name: "Old alias", code: "OLD", rows: 1 }];
  assert.equal((await db.registerDatadumpSuppliers(suppliers, { dryRun: true })).length, 1);
  assert.equal((await pool.query("select count(*)::int as count from entity_documents where collection='vendors'")).rows[0].count, 1);
  const results = await Promise.all([db.registerDatadumpSuppliers(suppliers), db.registerDatadumpSuppliers(suppliers)]);
  assert.equal(results.flat().length, 1, "Concurrent imports register once");
  assert.equal((await db.registerDatadumpSuppliers(suppliers)).length, 0);
  const rows = (await pool.query("select data from entity_documents where collection='vendors'")).rows.map(row => row.data);
  assert.deepEqual(rows.find(row => row.id === "existing"), existing);
  assert.equal(rows.find(row => row.code === "DH").catalogSettings.enabled, false);
  await pool.query("delete from entity_documents where collection='vendors'");
  await pool.query("insert into state_documents(doc_key,data) values ('vendors',$1::jsonb) on conflict(doc_key) do update set data=excluded.data", [JSON.stringify([existing])]);
  await db.registerDatadumpSuppliers(suppliers);
  assert.equal((await pool.query("select count(*)::int as count from entity_documents where collection='vendors'")).rows[0].count, 2);
  assert.equal((await pool.query("select count(*)::int as count from state_documents where doc_key='vendors'")).rows[0].count, 0);
  console.log("PostgreSQL supplier dry-run, concurrent registration, retry, setting preservation and legacy materialization passed.");
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.closePool());
