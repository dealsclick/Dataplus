const fs = require('node:fs');
const path = require('node:path');
const { productIsMasterInactive } = require('./product-selling-status');
const { channelKey, requireInventoryChannel, zeroRequests, sendZeroRequest } = require('./inactive-channel-inventory');

function createInactiveChannelJob({ postgres, persistJob, artifactsDir, log, temuRequest, readDb, send = sendZeroRequest, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  return async function run(job) {
    const payload = job.workerPayload || {};
    const key = channelKey(payload.channel);
    if (!key) throw new Error('Unknown inactive inventory channel.');
    const apply = payload.apply === true;
    let processed = Number(job.processedRows || 0), changed = Number(job.changed || 0), failed = Number(job.missingCount || 0);
    let cursor = payload.inactiveInventoryCursor || '';
    const dir = path.join(artifactsDir, job.id);
    fs.mkdirSync(dir, { recursive: true });
    const report = path.join(dir, 'inactive-inventory.ndjson');
    fs.appendFileSync(report, '');
    const skus = Array.isArray(payload.skus) ? payload.skus : [];
    await persistJob(job, { status: 'running', phase: apply ? 'zeroing_inventory' : 'reviewing_inventory', startedAt: job.startedAt || new Date().toISOString(), originalFilePath: report, originalFileName: 'inactive-inventory.ndjson' });
    for (;;) {
      const current = await postgres.readOperationJob(job.id);
      if (current && ['stopped', 'canceled', 'cancelled'].includes(current.status)) return;
      const { rows } = await postgres.getPool().query(`select product_id,sku from products
        where product_id>$1 and ($2::text[]='{}' or sku=any($2::text[]))
        and (active=false or lower(trim(raw->>'active')) in ('false','0') or lower(trim(raw->>'status')) in ('inactive','disabled','deleted') or raw->>'deleted'='true')
        and (raw ? ($3 || 'Listing') or raw ? ($3 || 'ProductId') or raw ? ($3 || 'ListingId') or raw ? ($3 || 'Id') or raw->'channelInventoryLinks' ? $3)
        order by product_id limit 100`, [cursor, skus, key]);
      if (!rows.length) break;
      for (const row of rows) {
        const stop = await postgres.readOperationJob(job.id);
        if (stop && ['stopped', 'canceled', 'cancelled'].includes(stop.status)) return;
        let status = 'skipped', error = '';
        try {
          const item = (await postgres.readProductsByKeys([row.product_id]))[0];
          if (item && productIsMasterInactive(item)) {
            const requests = zeroRequests(item, key);
            for (const request of requests) {
              if (!apply) continue;
              const operation = await postgres.readOperationJob(job.id);
              if (operation && ['stopped', 'canceled', 'cancelled'].includes(operation.status)) return;
              // Re-read both switches and product status before every remote write.
              const db = await readDb();
              db.connections = await postgres.readStateField('connections') || [];
              const channel = db.connections.find(c => c.id === payload.channelId);
              if (requireInventoryChannel(channel) !== key) throw new Error('Channel identity changed.');
              const latest = (await postgres.readProductsByKeys([row.product_id]))[0];
              if (!latest || !productIsMasterInactive(latest)) throw new Error('Product was reactivated during this job; remaining updates skipped.');
              const latestRequests = zeroRequests(latest, key);
              if (!latestRequests.some(r => JSON.stringify(r) === JSON.stringify(request))) throw new Error('Listing mapping changed during this job; retry after review.');
              await pause(250);
              await send(key, request, channel, { temuRequest, db });
              log({ channel: payload.channel, transport: 'API', method: 'POST', path: request.path || request.type || 'listingUpdate', operation: 'Master inactive inventory zero', statusCode: 200, ok: true, jobId: job.id, message: `${row.sku}: zero inventory accepted.` });
            }
            status = apply ? 'zero_accepted' : 'ready_for_zero';
            changed += 1;
          }
        } catch (cause) {
          status = 'needs_attention'; error = String(cause.message || cause).slice(0, 1000); failed += 1;
          log({ channel: payload.channel, transport: 'Job', method: apply ? 'APPLY' : 'REVIEW', path: 'inactive-inventory', operation: 'Inactive inventory needs attention', statusCode: 422, ok: false, jobId: job.id, message: `${row.sku}: ${error}` });
        }
        fs.appendFileSync(report, JSON.stringify({ sku: row.sku, channel: payload.channel, targetQuantity: 0, status, error, at: new Date().toISOString() }) + '\n');
        processed += 1; cursor = row.product_id;
        await persistJob(job, { processedRows: processed, changed, missingCount: failed, workerPayload: { ...payload, inactiveInventoryCursor: cursor }, message: `${processed} checked; ${changed} ${apply ? 'zeroed' : 'ready'}; ${failed} need attention.` });
      }
    }
    await persistJob(job, { status: failed ? 'warning' : 'success', phase: 'complete', finishedAt: new Date().toISOString(), progressPercent: 100, totalRows: processed, processedRows: processed, changed, missingCount: failed,
      message: `${payload.channel}: ${changed} inactive SKUs ${apply ? 'accepted at zero inventory' : 'prepared for zero inventory (no live changes)'}, ${failed} need attention. Active products and local stock were not changed.` });
    if (postgres.upsertOperationArtifact) await postgres.upsertOperationArtifact(job, 'original');
  };
}
module.exports = { createInactiveChannelJob };
