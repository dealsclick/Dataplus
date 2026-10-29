const postgres = require('../db');

async function main() {
  const removed = await postgres.pruneRedundantNoopOperationJobs({
    workerTask: 'paid-order-routing',
    keepRecent: 100
  });
  console.log(`Removed ${removed.toLocaleString()} redundant no-change paid-order routing jobs.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await postgres.closePool();
  });
