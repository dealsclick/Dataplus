const postgres = require("../db");

async function main() {
  if (!postgres.isPostgresEnabled()) throw new Error("DATABASE_URL is required.");
  await postgres.initRelationalSchema();
  console.log("DataPlus runtime schema is ready.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await postgres.closePool().catch(() => {});
  });
