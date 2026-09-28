const crypto = require('crypto');
const { identifier, fail } = require('./walmart-client');
function gtin(value) {
  if (typeof value !== 'string' || /^0+$/.test(value)) return '';
  try { return identifier({ upc: value.trim() }).value.padStart(14, '0'); } catch { return ''; }
}
function identifiers(item) {
  return [...new Set([item.gtin, item.upc, item.barcode, item.raw?.gtin, item.raw?.upc].map(gtin).filter(Boolean))];
}
function variants(id) { return [id, ...(id.startsWith('0') ? [id.slice(1)] : []), ...(id.startsWith('00') ? [id.slice(2)] : []), ...(id.startsWith('000') ? [id.slice(3)] : [])]; }
function chooseMatch(remote, skuRows, upcRows, remoteIdentifierCount = 1, skuAlternates = []) {
  const exact = skuRows.filter(row => row.sku === remote.sku);
  const ids = identifiers(remote);
  if (!remote.sku || ids.length > 1 || String(remote.isDuplicate).toLowerCase() === 'true' || remote.bundles?.length) return { status: 'review', reason: 'Walmart identity is missing, conflicting, or a duplicate/virtual pack.' };
  if (exact.length > 1) return { status: 'review', reason: 'Multiple exact SKU candidates.' };
  if (exact.length === 1) {
    const localIds = identifiers(exact[0]);
    if (ids.length && localIds.length && !localIds.includes(ids[0])) return { status: 'review', reason: 'Exact SKU has a conflicting UPC/GTIN.', candidates: exact.map(row => row.sku) };
    return { status: 'matched', basis: 'sku', product: exact[0] };
  }
  if (skuAlternates.length) {
    const matches = [...new Map(skuAlternates.map(row => [row.id, row])).values()];
    if (matches.length !== 1) return { status: 'review', reason: 'Seller SKU matches multiple supplier SKUs or aliases.' };
    const p = matches[0], localIds = identifiers(p);
    if (ids.length && localIds.length && !localIds.includes(ids[0])) return { status: 'review', reason: 'Supplier SKU or alias has a conflicting UPC/GTIN.' };
    if (Number(p.uomQty) !== 1 || p.identityPackConflict) return { status: 'review', reason: 'Supplier SKU or alias requires selling-pack confirmation.' };
    return { status: 'matched', basis: p.identityBasis, product: p, identifier: ids[0] || '' };
  }
  if (!ids.length) return { status: 'unmatched', reason: 'No exact SKU and no valid UPC/GTIN.' };
  const matches = upcRows.filter(row => identifiers(row).includes(ids[0]));
  if (!matches.length) return { status: 'unmatched', reason: 'No catalog SKU or UPC/GTIN match.' };
  if (matches.length !== 1 || remoteIdentifierCount !== 1) return { status: 'review', reason: 'UPC/GTIN is shared by multiple catalog products or seller listings.', candidates: matches.map(row => row.sku).slice(0, 10) };
  const p = matches[0];
  if (Number(p.uomQty) !== 1) return { status: 'review', reason: 'UPC match requires selling-pack confirmation.', candidates: [p.sku] };
  return { status: 'matched', basis: 'upc', product: p, identifier: ids[0] };
}
const projection = `product_id as id, sku, barcode, uom_qty as "uomQty", raw->>'upc' as upc, raw->>'gtin' as gtin, raw->'walmartListing' as "walmartListing"`;
async function candidates(db, remote) {
  const exact = (await db.query(`select ${projection} from products where sku=$1`, [remote.sku])).rows;
  if (exact.length) return { exact, fallback: [] };
  const alternateRows = (await db.query(`select ${projection},
    case when lower(vendor_sku)=lower($1) then 'vendor-sku' else 'alias' end as "identityBasis",
    exists(select 1 from product_aliases a where a.product_id=products.product_id and a.active=true
      and lower(a.alias_sku)=lower($1) and (a.alias_type<>'direct' or coalesce(a.raw->>'uomQty','1')<>'1')) as "identityPackConflict"
    from products where product_id in
      (select product_id from products where lower(vendor_sku)=lower($1)
       union select product_id from product_aliases where active=true and lower(alias_sku)=lower($1)) limit 11`, [remote.sku])).rows;
  if (alternateRows.length) return { exact, fallback: [], alternateRows };
  const ids = identifiers(remote);
  if (ids.length !== 1) return { exact, fallback: [] };
  const fallback = (await db.query(`select ${projection} from products where barcode=any($1::text[]) or raw->>'upc'=any($1::text[]) or raw->>'gtin'=any($1::text[]) limit 11`, [variants(ids[0])])).rows;
  return { exact, fallback };
}
async function reconcileItem(pool, remote, context) {
  const db = await pool.connect();
  try {
    await db.query('begin');
    await db.query("set local statement_timeout='8s'");
    await db.query("select pg_advisory_xact_lock(hashtext('walmart:seller-reconciliation'))");
    const { exact, fallback, alternateRows } = await candidates(db, remote);
    let decision = chooseMatch(remote, exact, fallback, context.identifierCount, alternateRows);
    if (decision.status !== 'matched') { await db.query('rollback'); return decision; }
    const locked = (await db.query(`select ${projection} from products where product_id=$1 for update`, [decision.product.id])).rows[0];
    if (!locked) throw fail('Catalog product changed during reconciliation.');
    const freshCandidates = await candidates(db, remote);
    decision = chooseMatch(remote, freshCandidates.exact, freshCandidates.fallback, context.identifierCount, freshCandidates.alternateRows);
    if (decision.product && decision.product.id !== locked.id) throw fail('Catalog identity changed during reconciliation.');
    if (decision.status !== 'matched') { await db.query('rollback'); return decision; }
    if (decision.basis !== 'sku' && context.sellerSkus.has(locked.sku)) { await db.query('rollback'); return { status: 'review', reason: 'Catalog SKU is reserved for an exact seller SKU match.' }; }
    const prior = locked.walmartListing || {};
    if (prior.sku && (prior.sku !== remote.sku || prior.environment && prior.environment !== 'production') || prior.itemId && remote.itemId && String(prior.itemId) !== String(remote.itemId) || prior.credentialKey && prior.credentialKey !== context.credentialKey) {
      await db.query('rollback'); return { status: 'review', reason: 'Catalog product already has a conflicting Walmart link.', candidates: [locked.sku] };
    }
    const owners = (await db.query("select product_id from products where raw->'walmartListing'->>'sku'=$1 and product_id<>$2 limit 1", [remote.sku, locked.id])).rows;
    if (owners.length) { await db.query('rollback'); return { status: 'review', reason: 'This Walmart seller SKU is already linked to another product.' }; }
    // Recheck the persisted switch and credentials immediately before the local write.
    await context.check();
    const listing = { sku: remote.sku, itemId: String(remote.itemId || remote.itemid || prior.itemId || ''), wpid: String(remote.wpid || prior.wpid || ''), publishedStatus: remote.publishedStatus || 'UNVERIFIED', lifecycleStatus: remote.lifecycleStatus || '', price: remote.price, itemPageUrl: remote.itemPageUrl || prior.itemPageUrl || '', availability: remote.availability || '', unpublishedReasons: remote.unpublishedReasons || [], fulfillmentLagTime: remote.fulfillmentLagTime ?? null, source: remote.source || 'seller-api', environment: 'production', matchMethod: decision.basis, matchedIdentifier: decision.identifier || identifiers(remote)[0] || '', reconciled: true, productId: locked.id, channelId: context.channelId, credentialKey: context.credentialKey, linkedBy: context.actor, linkedAt: prior.linkedAt || new Date().toISOString(), checkedAt: new Date().toISOString() };
    await db.query("update products set raw=jsonb_set(coalesce(raw,'{}'::jsonb),'{walmartListing}',coalesce(raw->'walmartListing','{}'::jsonb)||$2::jsonb),updated_at=now() where product_id=$1", [locked.id, JSON.stringify(listing)]);
    await db.query('commit');
    return { listing, status: 'linked', basis: decision.basis, catalogSku: locked.sku, sellerSku: remote.sku, productId: locked.id, publishedStatus: listing.publishedStatus, identifier: listing.matchedIdentifier };
  } catch (error) { await db.query('rollback'); throw error; } finally { db.release(); }
}
async function resolveOrderLinks(pool, order, context) {
  const skus = [...new Set((order.items || []).map(line => line.sku).filter(Boolean))];
  if (!skus.length) return order;
  const products = (await pool.query(`select ${projection} from products where sku=any($1::text[]) or raw->'walmartListing'->>'sku'=any($1::text[])`, [skus])).rows;
  const items = order.items.map(line => {
    const exact = products.filter(p => p.sku === line.sku);
    const linked = products.filter(p => { const link = p.walmartListing; return link?.sku === line.sku && link.reconciled && link.productId === p.id && link.channelId === context.channelId && link.credentialKey === context.credentialKey && link.environment === 'production'; });
    const matches = exact.length ? exact : linked;
    if (matches.length !== 1) return line;
    const p = matches[0];
    return { ...line, sku: p.sku, originalSku: line.sku, walmartSellerSku: line.sku, mappedSku: p.sku, productId: p.id, skuMappingSource: exact.length ? 'exact-sku' : 'walmart-reconciliation' };
  });
  return { ...order, items, sku: items[0]?.sku || order.sku, shipments: (order.shipments || []).map(shipment => ({ ...shipment, lines: (shipment.lines || []).map(line => ({ ...line, sku: items[line.lineIndex]?.sku || line.sku })) })) };
}
const pageKey = (jobId, page) => `walmart.reconcile.page.${jobId}.${page}`;
async function runReconciliation({ client, job, write, read, check, persist, record, pool, invalidate, reportRows }) {
  const payload = job.workerPayload;
  if (payload.environment !== 'production') throw fail('Seller listing reconciliation requires the production account.');
  const counts = new Map(), sellerSkus = new Set(), pages = new Set();
  let cursor = '*', page = 0, total = 0;
  if (reportRows) {
    for (const row of reportRows) {
      if (!row.sku || sellerSkus.has(row.sku)) throw fail('Walmart report contains missing or duplicate SKUs. No links applied.');
      sellerSkus.add(row.sku);
      for (const id of identifiers(row)) counts.set(id, (counts.get(id) || 0) + 1);
    }
    for (let offset = 0; offset < reportRows.length; offset += 500) await write(pageKey(job.id, page++), {rows:reportRows.slice(offset,offset+500)});
    total = reportRows.length; cursor = '';
  }
  while (cursor) {
    await check();
    const data = await client.request(`/v3/items?${new URLSearchParams({ nextCursor: cursor, limit: '200' })}`, { jobId: job.id });
    const items = data.ItemResponse || data.itemResponse;
    if (!Array.isArray(items)) throw fail('Walmart returned an invalid seller-item page.');
    if (!items.length) break;
    const hash = crypto.createHash('sha256').update(JSON.stringify(items)).digest('hex');
    if (pages.has(hash)) throw fail('Walmart repeated a seller-item page. No new links were applied.');
    pages.add(hash);
    const rows = items.map(item => ({ sku: item.sku, gtin: item.gtin, upc: item.upc, itemId: item.itemId || item.itemid, wpid: item.wpid, publishedStatus: item.publishedStatus, lifecycleStatus: item.lifecycleStatus, price: item.price, isDuplicate: item.isDuplicate, bundles: item.bundles?.length ? [true] : [] }));
    for (const row of rows) {
      if (!row.sku || typeof row.sku !== 'string' || sellerSkus.has(row.sku)) throw fail('Walmart returned a missing or repeated seller SKU. No new links were applied.');
      sellerSkus.add(row.sku);
      for (const id of identifiers(row)) counts.set(id, (counts.get(id) || 0) + 1);
    }
    await write(pageKey(job.id, page++), { rows }); total += rows.length;
    await persist({ phase: 'download-listings', totalRows: total, message: `${total} Walmart seller listings downloaded; no links applied yet.` });
    cursor = data.nextCursor || '';
    const reported = Number(data.totalItems ?? data.totalCount);
    if (!cursor && Number.isFinite(reported) && total < reported) throw fail('Walmart ended pagination before all seller listings were downloaded. No new links were applied.');
  }
  let processed = 0, linked = 0, review = 0, unmatched = 0;
  await write(`walmart.reconcile.${job.id}`, { actor: payload.actor, total, processed, linked, review, unmatched, complete: false, rows: [] });
  let recent = [];
  try {
    for (let i = 0; i < page; i++) {
      for (const remote of (await read(pageKey(job.id, i))).rows) {
        await check();
        let result;
        try { result = await reconcileItem(pool, remote, { ...payload, check, sellerSkus, identifierCount: counts.get(identifiers(remote)[0]) || 0 }); }
        catch (error) { if (error.statusCode === 499) throw error; result = { status: 'review', reason: error.message }; }
        processed++; if (result.status === 'linked') linked++; else if (result.status === 'unmatched') unmatched++; else review++;
        if (result.listing) await write(`walmart.listing-status.production.${crypto.createHash('sha256').update(JSON.stringify(result.productId)).digest('hex')}`, result.listing);
        const { listing: snapshot, ...publicResult } = result;
        const row = { sellerSku: remote.sku, ...publicResult }; record(row);
        recent.push(row); if (recent.length > 100) recent.shift();
        if (processed % 50 === 0 || processed === total) {
          await write(`walmart.reconcile.${job.id}`, { actor: payload.actor, total, processed, linked, review, unmatched, complete: processed === total, rows: recent });
          await persist({ phase: 'link-listings', processedRows: processed, totalRows: total, progressPercent: Math.round(processed / Math.max(total, 1) * 100), message: `${linked} linked; ${review} need review; ${unmatched} unmatched (${processed}/${total}).` });
        }
      }
    }
    if (!total) await write(`walmart.reconcile.${job.id}`, { actor: payload.actor, total: 0, processed: 0, linked: 0, review: 0, unmatched: 0, complete: true, rows: [] });
  } finally {
    await write(`walmart.reconcile.${job.id}`, { actor: payload.actor, total, processed, linked, review, unmatched, complete: processed === total, rows: recent });
    if (invalidate) await invalidate();
  }
  return { review, message: `${linked} Walmart listings linked; ${review} need review; ${unmatched} unmatched.` };
}
module.exports = { gtin, identifiers, variants, chooseMatch, reconcileItem, runReconciliation, resolveOrderLinks };
