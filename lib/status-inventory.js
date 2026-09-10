const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { productIsMasterInactive } = require('./product-selling-status');
const { supplierTokens, supplierUnavailable, retiredSupplier, retirementPhysicalQty } = require('./supplier-retirement');
const { requireInventoryChannel, zeroRequests, sendZeroRequest } = require('./inactive-channel-inventory');

function linked(item, key) {
  if (key === 'shopify') return !!item.shopifyId;
  if (key === 'ebay') return !!(item.ebayListing?.listingId || item.ebayListing?.offerId);
  return !!(item[`${key}Listing`] || item[`${key}ProductId`] || item[`${key}ListingId`] || item.channelInventoryLinks?.[key]?.length);
}
function protection(item, vendors, alternateCount = 0) {
  if (productIsMasterInactive(item)) return 'master';
  if (!retiredSupplier(item, vendors)) return '';
  if (alternateCount) throw new Error('Supplier disabled: alternate supplier relationships require review; no automatic source replacement.');
  return 'supplier';
}
function requireChannel(channel, key) {
  if (!channel || channel.settings?.channelEnabled === false) throw new Error('Channel is disabled or missing. Enable it before retrying.');
  const settings = channel.settings || {};
  if (settings.inventoryUpdateEnabled === false) throw new Error('Channel inventory updates are disabled.');
  if (key === 'shopify' && settings.shopifyInventoryPushEnabled !== true) throw new Error('Shopify inventory push is disabled.');
  if (key === 'ebay' && settings.ebayInventoryUpdateEnabled === false) throw new Error('eBay inventory updates are disabled.');
  if (!['shopify', 'ebay'].includes(key)) requireInventoryChannel(channel);
}

const SHOPIFY_READ = `query StatusInventory($id: ID!, $after: String) {
  product(id: $id) { variants(first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { id sku inventoryPolicy inventoryItem { id tracked inventoryLevels(first: 100) {
      pageInfo { hasNextPage } nodes { location { id } quantities(names: ["available"]) { name quantity } }
    } } }
  } }
}`;
const SHOPIFY_ZERO = `mutation StatusInventoryZero($input: InventorySetQuantitiesInput!, $key: String!) {
  inventorySetQuantities(input: $input) @idempotent(key: $key) {
    inventoryAdjustmentGroup { changes { name quantityAfterChange } }
    userErrors { message }
  }
}`;

function createStatusInventoryWorker({ postgres, persistJob, artifactsDir, readDb, log, ebayRequest, shopify, temuRequest, send = sendZeroRequest }) {
  return async function run(job) {
    const payload = job.workerPayload || {};
    const dir = path.join(artifactsDir, job.id);
    fs.mkdirSync(dir, { recursive: true });
    const report = path.join(dir, 'status-inventory.ndjson');
    let cursor = payload.cursor || '', processed = Number(job.processedRows || 0), failures = Number(job.missingCount || 0);
    await persistJob(job, { status: 'running', phase: 'protecting_channel_inventory', originalFilePath: report,
      originalFileName: 'status-inventory.ndjson', startedAt: job.startedAt || new Date().toISOString(), message: 'Applying status-change inventory protection; local stock is unchanged.' });
    async function stopped() {
      const current = await postgres.readOperationJob(job.id);
      if (['stopped', 'canceled', 'cancelled'].includes(current?.status)) throw new Error('Status inventory job stopped. Retry to finish channel protection.');
    }
    async function fresh(id, key) {
      await stopped();
      const item = (await postgres.readProductsByKeys([id]))[0];
      if (!item) throw new Error('Product no longer exists; review the live listing.');
      const db = await readDb();
      db.vendors = await postgres.readStateField('vendors') || [];
      db.connections = await postgres.readStateField('connections') || [];
      const channel = db.connections.find(c => String(c.name).toLowerCase() === ({ tiktok: 'tiktok shop' }[key] || key));
      requireChannel(channel, key);
      const vendor = retiredSupplier(item, db.vendors);
      const alternates = vendor && !productIsMasterInactive(item)
        ? (await postgres.getPool().query('select count(*)::int as n from product_supplier_links where product_id=$1 and not(lower(vendor_id)=any($2::text[]))', [id, supplierTokens(vendor)])).rows[0].n : 0;
      const mode = protection(item, db.vendors, alternates);
      if (!mode) throw new Error('Status or supplier changed; no inventory was republished. Review before retrying.');
      return { item, db, channel, mode };
    }
    for (;;) {
      await stopped();
      const vendors = await postgres.readStateField('vendors') || [];
      const vendor = vendors.find(v => v.id === payload.vendorId);
      if (payload.vendorId && !supplierUnavailable(vendor)) throw new Error('Supplier is no longer disabled; remaining updates require review.');
      const tokens = vendor ? supplierTokens(vendor) : [];
      const { rows } = await postgres.getPool().query(`select product_id from products p where product_id>$1 and
        (($2::text<>'' and product_id=$2) or ($3::text<>'' and
          (lower(coalesce(supplier,''))=any($4::text[]) or lower(coalesce(supplier_code,''))=any($4::text[])
          or lower(coalesce(raw->>'vendorId',''))=any($4::text[]) or lower(coalesce(raw->>'vendor',''))=any($4::text[]))))
        order by product_id limit 100`, [cursor, payload.productId || '', payload.vendorId || '', tokens]);
      if (!rows.length) break;
      for (const row of rows) {
        await stopped();
        const item = (await postgres.readProductsByKeys([row.product_id]))[0];
        for (const key of ['shopify', 'ebay', 'temu', 'whatnot', 'tiktok']) {
          if (!item || !linked(item, key)) continue;
          let error = '';
          try {
            const state = await fresh(row.product_id, key);
            if (key === 'shopify') {
              const productId = String(state.item.shopifyId).startsWith('gid://') ? state.item.shopifyId : `gid://shopify/Product/${state.item.shopifyId}`;
              let after = null, matched = 0;
              do {
                const data = await shopify(SHOPIFY_READ, { id: productId, after }, { jobId: job.id });
                const variants = data.product?.variants;
                if (!variants) throw new Error('Shopify product not found; relink the product.');
                for (const variant of variants.nodes || []) {
                  // Only exact SKU or established numeric pack variants belong to this catalog record.
                  const base = String(variant.sku || '').replace(/-\d+PC$/i, '');
                  if (![String(variant.sku), base].some(s => s.toLowerCase() === String(item.sku).toLowerCase())) continue;
                  matched++;
                  if (!variant.inventoryItem?.tracked || variant.inventoryPolicy === 'CONTINUE') throw new Error('Shopify permits untracked or continue-selling inventory. Disable that policy before retrying.');
                  if (variant.inventoryItem.inventoryLevels?.pageInfo?.hasNextPage) throw new Error('More than 100 Shopify locations; explicit location review required.');
                  const levels = variant.inventoryItem.inventoryLevels?.nodes || [];
                  if (!levels.length) throw new Error('Shopify inventory locations are missing.');
                  for (const level of levels) {
                    const latest = await fresh(row.product_id, key);
                    if (latest.item.shopifyId !== state.item.shopifyId) throw new Error('Shopify link changed; retry after review.');
                    if (latest.mode === 'supplier') {
                      const mappings = latest.channel.settings.warehouseMappings || latest.channel.settings.shopifyWarehouseMappings || [];
                      const warehouses = await postgres.readStateField('warehouses') || [];
                      const mapped = mappings.filter(m => m.enabled !== false && m.destinationLocationId === level.location.id);
                      const safe = mapped.length && mapped.every(m => m.sourceWarehouseId === 'datawarehouse' || warehouses.some(w => w.id === m.sourceWarehouseId && w.inventorySourceType === 'supplier_feed'));
                      if (!safe) throw new Error('Supplier disabled: physical or unmapped Shopify location preserved; review location sourcing.');
                    }
                    const result = await shopify(SHOPIFY_ZERO, { key: crypto.randomUUID(), input: { name: 'available', reason: 'correction',
                      referenceDocumentUri: `dataplus://status-inventory/${job.id}`, quantities: [{ inventoryItemId: variant.inventoryItem.id, locationId: level.location.id, quantity: 0, changeFromQuantity: null }] } }, { jobId: job.id });
                    const ack = result.inventorySetQuantities;
                    if (!ack?.inventoryAdjustmentGroup || ack.userErrors?.length) throw new Error(ack?.userErrors?.map(e => e.message).join('; ') || 'Shopify did not acknowledge zero inventory.');
                  }
                }
                after = variants.pageInfo?.hasNextPage ? variants.pageInfo.endCursor : null;
              } while (after);
              if (!matched) throw new Error('No exact Shopify SKU variants matched; relink before retrying.');
            } else {
              const latest = await fresh(row.product_id, key);
              if (latest.mode === 'supplier' && retirementPhysicalQty(latest.item) > 0) throw new Error('Supplier disabled: verified physical stock remains; review channel allocation instead of zeroing physical availability.');
              if (key === 'ebay') {
                const listing = latest.item.ebayListing || {};
                const sku = listing.merchantSku || latest.item.sku;
                if (listing.inventoryApiSkuMissing) throw new Error('eBay listing needs relinking before inventory can be zeroed.');
                const result = await ebayRequest(latest.db, '/sell/inventory/v1/bulk_update_price_quantity', { method: 'POST', body: { requests: [{ sku, shipToLocationAvailability: { quantity: 0 } }] }, jobId: job.id });
                const ack = result.responses?.find(r => r.sku === sku);
                if (!ack || Number(ack.statusCode) < 200 || Number(ack.statusCode) >= 300 || ack.errors?.length) throw new Error(ack?.errors?.map(e => e.message).join('; ') || 'eBay did not acknowledge zero inventory; check listing linkage.');
              } else {
                const requests = zeroRequests({ ...latest.item, active: false }, key);
                for (const request of requests) {
                  const current = await fresh(row.product_id, key);
                  if (current.mode === 'supplier' && retirementPhysicalQty(current.item) > 0) throw new Error('Physical stock changed; review required.');
                  if (!zeroRequests({ ...current.item, active: false }, key).some(r => JSON.stringify(r) === JSON.stringify(request))) throw new Error('Channel link changed; retry after review.');
                  await new Promise(resolve => setTimeout(resolve, 250));
                  await send(key, request, current.channel, { db: current.db, temuRequest });
                }
              }
            }
          } catch (cause) { error = String(cause.message || cause).slice(0, 1500); failures++; }
          const result = { sku: item.sku, channel: key, status: error ? 'needs_attention' : 'zero_accepted', error, at: new Date().toISOString() };
          fs.appendFileSync(report, JSON.stringify(result) + '\n');
          log({ channel: { shopify: 'Shopify', ebay: 'eBay', temu: 'Temu', whatnot: 'Whatnot', tiktok: 'TikTok Shop' }[key], transport: 'Job', method: 'APPLY', path: 'status-inventory', operation: 'Automatic status inventory protection', jobId: job.id, ok: !error, statusCode: error ? 422 : 200, message: `${item.sku}: ${error || 'Zero inventory accepted by channel.'}` });
        }
        cursor = row.product_id; processed++;
        await persistJob(job, { processedRows: processed, missingCount: failures, workerPayload: { ...payload, cursor }, message: `${processed} products checked; ${failures} channel results need attention. Local inventory unchanged.` });
      }
    }
    if (!processed && payload.productId) failures++;
    await persistJob(job, { status: failures ? 'warning' : 'success', phase: failures ? 'needs_attention' : 'complete', processedRows: processed,
      totalRows: processed, missingCount: failures, progressPercent: 100, finishedAt: new Date().toISOString(),
      message: `Automatic inventory protection finished: ${processed} products checked, ${failures} channel results need attention. See artifact for channel acknowledgments; local stock and listings retained.` });
    if (postgres.upsertOperationArtifact && fs.existsSync(report)) await postgres.upsertOperationArtifact(job, 'original');
  };
}
module.exports = { createStatusInventoryWorker, protection, linked, requireChannel };
