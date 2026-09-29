const postgres = require("../db");
const { normalizeOrderBasedReturnNumbers } = require("../lib/return-identifiers");

async function main() {
  if (!postgres.isPostgresEnabled()) throw new Error("DATABASE_URL is required.");
  const records = await postgres.readStateField("returns") || [];
  const result = normalizeOrderBasedReturnNumbers(records);
  console.log(JSON.stringify({ records: records.length, changed: result.changed, apply: process.argv.includes("--apply") }, null, 2));
  if (result.changed && process.argv.includes("--apply")) await postgres.writeStateDocuments({ returns: result.records });
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
