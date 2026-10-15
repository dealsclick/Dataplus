const postgres = require('../db');
const { createChannelFeeStore } = require('../lib/channel-fee-store');
const { LEGACY_TENANT, LEGACY_COMPANY } = require('../lib/company-workspaces');

async function main() {
  if (!postgres.isPostgresEnabled()) throw new Error('DATABASE_URL is required.');
  await postgres.initRelationalSchema();
  const store = createChannelFeeStore(() => postgres.getPool());
  const result = await store.refreshEstimates({ tenantId: LEGACY_TENANT, companyId: LEGACY_COMPANY }, 'system:channel-fee-backfill');
  console.log(JSON.stringify(result, null, 2));
  await postgres.closePool();
}

main().catch(async error => {
  console.error(error);
  await postgres.closePool().catch(() => {});
  process.exitCode = 1;
});
