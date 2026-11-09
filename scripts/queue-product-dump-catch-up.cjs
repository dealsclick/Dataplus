#!/usr/bin/env node
'use strict';

const postgres = require('../db');
const dataplus = require('../server');

async function main() {
  if (!postgres.isPostgresEnabled()) throw new Error('Product datadump catch-up requires PostgreSQL.');
  const db = dataplus.normalizeDb(await dataplus.readDbFast({ skipInventory: true }));
  const result = await dataplus.queueProductDumpImportJob(db, {
    downloadFtp: true,
    discoveryOnly: true,
    syncMode: 'catalog',
    postImportInventoryMode: 'disabled',
    postImportPriceMode: 'disabled',
    batchSize: 1000
  }, {
    operation: 'Corrective full Product datadump discovery',
    requestedBy: 'DataPlus deployment'
  });
  process.stdout.write(`${JSON.stringify({
    queued: !result.duplicate,
    duplicate: result.duplicate,
    jobId: result.job?.id || '',
    jobNumber: result.job?.jobNumber || null,
    status: result.job?.status || '',
    message: result.duplicate ? 'A Product datadump import is already active.' : result.job?.message || ''
  }, null, 2)}\n`);
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(() => postgres.closePool());
