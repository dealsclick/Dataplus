#!/usr/bin/env node
'use strict';

const postgres = require('../db');
const dataplus = require('../server');

async function main() {
  if (!postgres.isPostgresEnabled()) throw new Error('Product datadump catch-up requires PostgreSQL.');
  const db = dataplus.normalizeDb(await dataplus.readDbFast({ skipInventory: true }));
  const result = await dataplus.queueProductDumpPipeline(db, {
    downloadFtp: true,
    background: true,
    syncMode: 'catalog',
    postImportInventoryMode: 'disabled',
    postImportPriceMode: 'disabled',
    batchSize: 1000
  }, {
    creationOperation: 'Corrective Product datadump SKU creation',
    refreshOperation: 'Corrective Product datadump price & inventory refresh',
    requestedBy: 'DataPlus deployment'
  });
  process.stdout.write(`${JSON.stringify({
    queued: !result.duplicate,
    duplicate: result.duplicate,
    jobId: result.job?.id || '',
    jobNumber: result.job?.jobNumber || null,
    creationJobId: result.creationJob?.id || '',
    creationJobNumber: result.creationJob?.jobNumber || null,
    refreshJobId: result.refreshJob?.id || '',
    refreshJobNumber: result.refreshJob?.jobNumber || null,
    status: result.job?.status || '',
    message: result.duplicate ? 'The Product datadump stages are already active.' : 'SKU creation and the dependent commercial refresh are queued separately.'
  }, null, 2)}\n`);
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(() => postgres.closePool());
