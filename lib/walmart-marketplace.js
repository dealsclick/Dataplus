const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const { createWalmartClient, identifier, taxonomyRows, mapOrder, fail } = require('./walmart-client');
const { productIsMasterInactive } = require('./product-selling-status');
const { retiredSupplier, retirementPhysicalQty } = require('./supplier-retirement');
const { inventoryAmount, shipmentPayload } = require('./walmart-operations');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const stamp = () => new Date().toISOString();
const mappingKey = category => `walmart.mapping.${digest(String(category).trim().toLowerCase())}`;

function validatePayload(schema, payload) {
  if (!schema || typeof schema !== 'object') throw fail('Walmart returned no item schema. Refresh the product type requirements.');
  const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  validate(payload);
  return (validate.errors || []).slice(0, 100).map(e => ({ field: `${e.instancePath || '/'}${e.params.missingProperty ? `/${e.params.missingProperty}` : ''}`, message: e.message, params: e.params }));
}

function createWalmartMarketplace(deps) {
  const { postgres, readDb, log, createJob, persistJob, findActive, artifactsDir, saveOrder, priceFor, shippingRestriction } = deps;
  // Marketplace review documents must never enter general app_state snapshots.
  const read = async key => key === 'connections' ? postgres.readStateField(key) : (await postgres.getPool().query('select data from walmart_documents where doc_key=$1', [key])).rows[0]?.data;
  const write = (key, value) => postgres.getPool().query('insert into walmart_documents(doc_key,data,updated_at) values($1,$2::jsonb,now()) on conflict(doc_key) do update set data=excluded.data,updated_at=now()', [key, JSON.stringify(value)]);
  async function channel() {
    // Read persisted switches at every request, including inside a running worker.
    const rows = await read('connections') || [];
    return rows.find(c => c.name === 'Walmart');
  }
  const client = createWalmartClient({ channel, log, ...(deps.credentials ? { credentials: environment => deps.credentials.get(environment) } : {}), ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) });
  async function enabled(gate) {
    const c = await channel();
    if (!c || c.settings?.channelEnabled !== true) throw fail('Enable Walmart Marketplace in Channels first.', 409);
    if (gate && c.settings?.[gate] !== true) throw fail(`Enable ${gate.replace(/^walmart/, 'Walmart ')} in Rules first.`, 409);
    return c;
  }
  async function lock(key, fn) {
    const db = await postgres.getPool().connect();
    try { await db.query('select pg_advisory_lock(hashtext($1))', [`walmart:${key}`]); return await fn(); }
    finally { await db.query('select pg_advisory_unlock(hashtext($1))', [`walmart:${key}`]); db.release(); }
  }
  async function settings() { return (await channel())?.settings || {}; }
  async function credentialKey() { return deps.credentials ? deps.credentials.fingerprint((await settings()).walmartEnvironment || 'production') : 'environment'; }
  async function connectionStatus() {
    const c = await channel(), environment = c?.settings?.walmartEnvironment || 'production';
    const saved = await read(`walmart.connection.${environment}`);
    return { verified: Boolean(saved?.verified && saved.channelId === c?.id && saved.credentialKey === await credentialKey()), verifiedAt: saved?.verifiedAt || '', message: saved?.message || '' };
  }
  async function requireVerified() {
    if (deps.credentials && !(await connectionStatus()).verified) throw fail('Verify the Walmart connection before preparing a launch.', 409);
  }

  async function product(key) {
    const p = await postgres.readProductByKey(key);
    if (!p) throw fail('Catalog SKU not found.', 404);
    return p;
  }
  async function saveIncomingOrder(order) {
    const c = await channel();
    const mapped = await require('./walmart-reconciliation').resolveOrderLinks(postgres.getPool(), order, { channelId: c.id, credentialKey: await credentialKey() });
    return saveOrder(mapped);
  }
  async function sellerSku(p) {
    const link = p.walmartListing;
    if (!link?.sku) return p.sku;
    if (link.sku === p.sku && !link.reconciled) return p.sku;
    const c = await channel();
    if (!link.reconciled || link.productId !== p.id || link.channelId !== c.id || link.environment !== (c.settings.walmartEnvironment || 'production') || link.credentialKey !== await credentialKey()) throw fail('Walmart link belongs to a different account or product. Reconcile listings again before syncing.');
    return link.sku;
  }
  function launchGate(p, db, s) {
    if (productIsMasterInactive(p) || p.discontinued === true || p.toBeDiscontinued === true || ['true','1'].includes(String(p.toBeDiscontinued || p.raw?.to_be_discontinued).toLowerCase())) throw fail('Inactive or discontinued products cannot launch.');
    if (retiredSupplier(p, db.vendors || [])) throw fail('Supplier is inactive or retired. Review sourcing before launch.');
    const restriction = shippingRestriction(p, s, 'launch');
    if (restriction.blocked) throw fail(restriction.reason);
  }
  async function spec(feedType, version, productType) {
    await enabled();
    const key = `walmart.spec.${digest([feedType, version, productType])}`;
    const cached = await read(key);
    if (cached?.schema) return cached.schema;
    const response = await client.request('/v3/items/spec', { method: 'POST', body: { feedType, version, ...(productType ? { productTypes: [productType] } : {}) } });
    if (!response.schema || response.errors?.length) throw fail('Walmart did not return complete requirements for this product type/version.');
    await write(key, { schema: response.schema, at: stamp() });
    return response.schema;
  }
  async function lookupProduct(sku, jobId) {
    const p = await product(sku);
    const id = identifier(p);
    const result = await client.request(`/v3/items/walmart/search?${new URLSearchParams({ [id.kind]: id.value, responseFormat: 'SPEC' })}`, { jobId });
    if (!result || typeof result !== 'object' || result.errors || (result.items !== undefined && !Array.isArray(result.items))) throw fail('Walmart returned an invalid search response.');
    if (result.items?.length > 1) throw fail('Walmart returned multiple identifier matches; review required.');
    const match = result.items?.[0];
    if (match && !['MP_ITEM_MATCH', 'MP_ITEM'].includes(match.feedType)) throw fail('Walmart returned an unrecognized match result.');
    return { sku: p.sku, title: p.title || '', identifier: id, status: match?.feedType === 'MP_ITEM_MATCH' ? 'matched' : match ? 'full_setup' : 'not_found', feedType: match?.feedType || '', productType: match?.productType || '', version: match?.version || '', packReviewRequired: Boolean(deps.packSize && deps.packSize(p) > 1) };
  }
  async function prepare(key, overrides = {}, actor, formOnly = false) {
    await requireVerified();
    const c = await enabled('walmartLaunchEnabled'), s = c.settings;
    const p = await product(key), db = await readDb();
    launchGate(p, db, s);
    if (p.walmartListing?.reconciled) throw fail('This product is already linked to a Walmart seller listing. Use listing verification, price or inventory actions.');
    const id = identifier(p), category = String(p.category || p.mainCategory || '').trim();
    const mapping = category ? await read(mappingKey(category)) : null;
    const search = await client.request(`/v3/items/walmart/search?${new URLSearchParams({ [id.kind]: id.value, responseFormat: 'SPEC' })}`);
    if (!search || typeof search !== 'object' || search.errors || (search.items !== undefined && !Array.isArray(search.items)) || search.items?.length > 1) throw fail('Walmart returned an invalid or ambiguous identifier match. Review the identifier.');
    const match = search.items?.[0];
    const feedType = match?.feedType === 'MP_ITEM_MATCH' ? 'MP_ITEM_MATCH' : 'MP_ITEM';
    if (!formOnly && deps.packSize && deps.packSize(p) > 1 && overrides.confirmIdentifierPack !== true) throw fail(`This SKU sells ${deps.packSize(p)} units per pack. Confirm that its UPC/GTIN identifies this exact selling pack before launch.`);
    if (feedType === 'MP_ITEM' && !mapping?.productType) throw fail(`Map the master category “${category || '(missing)'}” to a Walmart product type first.`);
    if (feedType === 'MP_ITEM' && mapping.version !== (s.walmartSpecVersion || (await read('walmart.taxonomy'))?.version)) throw fail('The category mapping uses an older spec version. Refresh the taxonomy and review the mapping.');
    const version = feedType === 'MP_ITEM_MATCH' ? String(match.version || match.itemSpecPayload?.MPItemFeedHeader?.version || '') : String(s.walmartSpecVersion || mapping?.version || '');
    if (!version) throw fail('Set the current Walmart item spec version under Rules.');
    const productType = feedType === 'MP_ITEM' ? mapping.productType : '';
    const payload = structuredClone(match?.feedType === feedType && (feedType === 'MP_ITEM_MATCH' || match.productType === productType) ? match.itemSpecPayload : { MPItemFeedHeader: { businessUnit: 'WALMART_US', locale: 'en', version }, MPItem: [{ Orderable: {}, Visible: { [productType]: {} } }] });
    payload.MPItemFeedHeader = { ...payload.MPItemFeedHeader, version };
    const item = payload.MPItem?.[0];
    if (!item) throw fail('Walmart search returned an invalid item setup payload.');
    const offer = feedType === 'MP_ITEM_MATCH' ? (item.Item ||= {}) : (item.Orderable ||= {});
    Object.assign(offer, object(mapping?.orderable), object(overrides.orderable));
    const minimumPrice = Number(priceFor(p, db, s));
    const price = overrides.price === undefined ? minimumPrice : Number(overrides.price);
    if (!Number.isFinite(minimumPrice) || !(minimumPrice > 0) || price < minimumPrice) throw fail(`Price must be at least $${minimumPrice.toFixed(2)} under current Walmart pricing rules.`);
    if (!(price > 0) || !Number.isFinite(price)) throw fail('A valid sell-unit price is required. Review cost and pricing rules.');
    // Identity stays catalog-owned. Explicit launch prices must meet the channel pricing floor.
    Object.assign(offer, { sku: p.sku, productIdentifiers: { productIdType: id.productIdType, productId: id.value }, price });
    if (!offer.condition) offer.condition = 'New';
    const weight = Number(p.packageWeight || p.itemWeight || 0);
    if (weight > 0 && !offer.ShippingWeight) offer.ShippingWeight = weight;
    if (feedType === 'MP_ITEM') {
      offer.specProductType = productType;
      const image = p.images?.[0];
      item.Visible = { [productType]: { productName: p.title || '', shortDescription: p.shortDescription || p.description || '', brand: p.brand || '', ...(typeof image === 'string' ? { mainImageUrl: image } : image?.url ? { mainImageUrl: image.url } : {}), ...object(item.Visible?.[productType]), ...object(mapping.visible), ...object(overrides.visible) } };
    }
    // New offers carry no positive inventory. Inventory is a separate deliberate workflow.
    delete offer.quantity; delete offer.inventory;
    const schema = await spec(feedType, version, productType);
    const errors = validatePayload(schema, payload);
    if (formOnly) return { sku: p.sku, title: p.title || '', category, feedType, productType, version, price, minimumPrice, identifier: id, payload, schema, errors, packSize: deps.packSize ? deps.packSize(p) : 1, environment: s.walmartEnvironment || 'production' };
    const preview = { token: crypto.randomUUID(), actor, productId: p.id, sku: p.sku, category, feedType, productType, version, price, identifier: id, identifierPackConfirmed: overrides.confirmIdentifierPack === true, payload, errors, createdAt: stamp(), expiresAt: Date.now() + 30 * 60000, fingerprint: digest([p, mapping, s, await credentialKey()]), channelId: c.id, environment: s.walmartEnvironment || 'production', state: 'preview' };
    await write(`walmart.preview.${preview.token}`, preview);
    log({ channel: 'Walmart', transport: 'Review', method: 'PREVIEW', path: 'launch', operation: 'Walmart launch preview', statusCode: errors.length ? 422 : 200, ok: !errors.length, message: `${p.sku}: ${feedType}; ${errors.length} validation errors.` });
    return preview;
  }
  async function operationPlan(kind, key, shipmentId) {
    const gate = { inventory: 'walmartInventoryEnabled', price: 'walmartPriceEnabled', acknowledge: 'walmartOrderUpdatesEnabled', tracking: 'walmartOrderUpdatesEnabled' }[kind];
    if (!gate) throw fail('Unsupported Walmart operation.');
    const c = await enabled(gate), s = c.settings, db = await readDb();
    let path, body, source;
    if (kind === 'inventory' || kind === 'price') {
      const p = await product(key), remoteSku = await sellerSku(p);
      const remote = await client.request(`/v3/items/${encodeURIComponent(remoteSku)}?productIdType=SKU`);
      const item = (remote.ItemResponse || remote.itemResponse || []).find(row => row.sku === remoteSku);
      if (!item) throw fail('Walmart did not return an exact seller SKU. Verify or relink the listing first.');
      if (kind === 'inventory') {
        if (!s.walmartShipNode) throw fail('Set the Walmart ship node under Rules.');
        const blocked = shippingRestriction(p, s, 'inventory').blocked;
        const amount = blocked ? 0 : inventoryAmount(p, db, s, deps.packSize(p));
        path = `/v3/inventory?${new URLSearchParams({ sku: remoteSku, shipNode: s.walmartShipNode })}`;
        body = { sku: remoteSku, quantity: { unit: 'EACH', amount } };
      } else {
        launchGate(p, db, s);
        path = '/v3/price'; body = { sku: remoteSku, pricing: [{ currentPrice: { currency: 'USD', amount: priceFor(p, db, s) } }] };
      }
      source = [p, s, db.warehouses, db.vendors];
    } else {
      const order = await postgres.readOrderByKey(key);
      if (!order || order.source !== 'Walmart') throw fail('Choose an imported Walmart order.');
      if (s.walmartEnvironment === 'sandbox') throw fail('Operational order updates require production. Sandbox orders are never imported into operations.');
      const id = order.marketplaceOrderId;
      const response = await client.request(`/v3/orders/${encodeURIComponent(id)}`);
      const remote = response.order || response;
      if (String(remote.purchaseOrderId) !== String(id)) throw fail('Walmart returned a different purchase order.');
      if (kind === 'acknowledge') {
        const statuses = (remote.orderLines?.orderLine || []).flatMap(line => line.orderLineStatuses?.orderLineStatus || []);
        if (!statuses.length || statuses.some(row => !['Created','Acknowledged'].includes(row.status))) throw fail('Only open, unshipped and uncanceled orders can be acknowledged.');
        path = `/v3/orders/${encodeURIComponent(id)}/acknowledge`;
      } else { path = `/v3/orders/${encodeURIComponent(id)}/shipping`; body = shipmentPayload(order, remote, shipmentId); }
      source = [order, s, remote];
    }
    return { kind, key, shipmentId, gate, path, body, method: ['inventory','price'].includes(kind) ? 'PUT' : 'POST', fingerprint: digest([source, await credentialKey()]), environment: s.walmartEnvironment || 'production', channelId: c.id };
  }
  async function zeroInactive(key, jobId) {
    const c = await enabled('walmartInventoryEnabled');
    if (c.settings.walmartEnvironment === 'sandbox') throw fail('Production inventory protection cannot run against sandbox.');
    const p = await product(key);
    const remoteSku = await sellerSku(p);
    if (!p.walmartListing || p.walmartListing.sku !== remoteSku) throw fail('Walmart seller SKU is not linked. Verify the listing before retrying protection.');
    const inventories = await client.request(`/v3/inventories/${encodeURIComponent(remoteSku)}`, { jobId });
    const nodes = inventories.nodes || inventories.inventories?.nodes;
    if (inventories.sku && inventories.sku !== remoteSku || !Array.isArray(nodes) || !nodes.length || nodes.some(n => !n.shipNode)) throw fail('Walmart did not return all inventory ship nodes. Review zeroing manually.');
    for (const shipNode of [...new Set(nodes.map(n => String(n.shipNode)))]) {
      const job = await postgres.readOperationJob(jobId);
      if (['stopped','canceled','cancelled'].includes(job?.status)) throw fail('Inventory protection stopped.', 499);
      const latest = await product(key), db = await readDb();
      const supplierBlocked = retiredSupplier(latest, db.vendors || []) && retirementPhysicalQty(latest) <= 0;
      if (!productIsMasterInactive(latest) && !supplierBlocked) throw fail('Product or supplier was reactivated. Inventory protection requires review.');
      if (latest.sku !== p.sku || await sellerSku(latest) !== remoteSku) throw fail('Walmart listing identity changed.');
      const current = await enabled('walmartInventoryEnabled');
      if (current.id !== c.id || current.settings.walmartEnvironment === 'sandbox') throw fail('Walmart channel changed.');
      const result = await client.request(`/v3/inventory?${new URLSearchParams({ sku: remoteSku, shipNode })}`, { method: 'PUT', body: { sku: remoteSku, quantity: { unit: 'EACH', amount: 0 } }, gate: 'walmartInventoryEnabled', jobId });
      if (result.sku !== remoteSku || Number(result.quantity?.amount) !== 0) throw fail(`Walmart did not acknowledge zero at ship node ${shipNode}.`);
    }
  }
  async function mappings() {
    if (!postgres.isPostgresEnabled()) return [];
    const result = await postgres.getPool().query("select data from walmart_documents where doc_key like 'walmart.mapping.%' order by data->>'category'");
    return result.rows.map(row => row.data);
  }
  async function projectCategories(rows) {
    return require('./walmart-category-projection').projectWalmartCategories(rows, await mappings());
  }
  async function shipNodes(refresh = false) {
    const c = await channel(), environment = c?.settings?.walmartEnvironment || 'production';
    const key = await credentialKey(), docKey = `walmart.shipNodes.${environment}`;
    if (!refresh) {
      const cached = await read(docKey);
      return cached?.credentialKey === key && cached.channelId === c.id ? { rows: cached.rows, updatedAt: cached.updatedAt } : { rows: [], updatedAt: null };
    }
    await enabled();
    const data = await client.request('/v3/settings/shipping/shipnodes');
    if (!Array.isArray(data) || data.some(row => !row.shipNode || typeof row.shipNode !== 'string')) throw fail('Walmart returned an invalid shipping-node response. The previous cache was preserved.');
    if (key !== await credentialKey() || (await channel()).id !== c.id) throw fail('Connection changed during download. Try again.');
    await enabled();
    const rows = data.map(row => ({ id: row.shipNode, name: String(row.shipNodeName || row.shipNode), status: String(row.status || 'UNKNOWN'), type: String(row.nodeType || ''), city: String(row.postalAddress?.city || ''), state: String(row.postalAddress?.state || '') }));
    const updatedAt = stamp();
    await write(docKey, { rows, updatedAt, credentialKey: key, channelId: c.id });
    log({ channel: 'Walmart', transport: 'Settings', method: 'CACHE', path: 'ship-nodes', operation: 'Download Walmart shipping nodes', statusCode: 200, ok: true, message: `${rows.length} shipping nodes cached.` });
    return { rows, updatedAt, message: rows.length ? `${rows.length} Walmart shipping nodes downloaded.` : 'Walmart returned no fulfillment centers. Add a fulfillment center in Seller Center, then download again.' };
  }
  async function queue(operation, payload) {
    return lock('queue', async () => {
      await enabled(operation === 'orders' ? 'walmartOrdersEnabled' : operation === 'launch' ? 'walmartLaunchEnabled' : undefined);
      const workerTask = `walmart-${operation}`;
      const existing = await findActive(workerTask);
      if (existing && ['match', 'reconcile'].includes(operation) && (existing.workerPayload?.actor !== payload.actor || digest([existing.workerPayload?.skus, existing.workerPayload?.allFiltered, existing.workerPayload?.query, existing.workerPayload?.filters]) !== digest([payload.skus, payload.allFiltered, payload.query, payload.filters]))) throw fail('Another Walmart UPC match is queued or running. Wait for it to finish, then match this selection.', 409);
      if (existing && operation === 'launch' && digest([...(existing.workerPayload?.tokens || [existing.workerPayload?.token])].sort()) !== digest([...(payload.tokens || [payload.token])].sort())) throw fail('Another Walmart launch is queued or running. Wait for it to finish before submitting this item.', 409);
      if (existing) return { duplicate: true, job: existing, message: 'This Walmart operation is already queued or running.' };
      const c = await channel();
      const job = await createJob({ section: operation === 'orders' ? 'Operations' : 'Products', category: operation === 'orders' ? 'Orders' : 'Channels', operation: `Walmart ${operation}`, direction: operation === 'orders' ? 'import' : 'sync', status: 'queued', phase: 'queued', workerTask, workerPayload: { ...payload, credentialKey: await credentialKey(), channelId: c.id, environment: c.settings.walmartEnvironment || 'production' }, fileName: `walmart-${operation}.ndjson`, message: `Walmart ${operation} queued.` });
      if (operation === 'taxonomy') await write('walmart.taxonomyJob', { id: job.id });
      log({ channel: 'Walmart', transport: 'Job', method: 'QUEUE', path: operation, operation: job.operation, statusCode: 202, ok: true, jobId: job.id });
      return { job, message: job.message };
    });
  }
  async function run(job) {
    const payload = job.workerPayload || {}, operation = job.workerTask.replace('walmart-', '');
    const report = path.join(artifactsDir, `${job.id}-walmart.ndjson`);
    fs.mkdirSync(artifactsDir, { recursive: true });
    let processed = 0, failed = 0, pending = false;
    const record = row => { fs.appendFileSync(report, JSON.stringify({ ...row, at: stamp() }) + '\n'); processed++; if (row.error) failed++; };
    const check = async () => {
      if (payload.credentialKey && payload.credentialKey !== await credentialKey()) throw fail('Walmart credentials changed after this job was queued. Review and queue it again.');
      const current = await postgres.readOperationJob(job.id);
      if (['stopping', 'stopped', 'canceled', 'cancelled'].includes(current?.status)) throw fail('Job stopped.', 499);
      if (operation === 'launch') await requireVerified();
      const c = await enabled(operation === 'orders' ? 'walmartOrdersEnabled' : operation === 'launch' ? 'walmartLaunchEnabled' : undefined);
      if (c.id !== payload.channelId || (c.settings.walmartEnvironment || 'production') !== payload.environment) throw fail('Walmart channel/environment changed after queuing. Queue a new job.');
    };
    await persistJob(job, { status: 'running', startedAt: stamp(), phase: operation, originalFilePath: report, originalFileName: `walmart-${operation}.ndjson` });
    try {
      await check();
      if (operation === 'reconcile') {
        const result = await require('./walmart-reconciliation').runReconciliation({ client, job, write, read, check, persist: patch => persistJob(job, patch), record, pool: postgres.getPool(), invalidate: deps.invalidateListings });
        failed = result.review;
        await persistJob(job, { status: failed ? 'warning' : 'success', phase: 'complete', finishedAt: stamp(), processedRows: processed, totalRows: processed, missingCount: failed, progressPercent: 100, message: result.message });
        return;
      } else if (operation === 'orders') {
        let next = `/v3/orders?${new URLSearchParams({ createdStartDate: payload.startDate, createdEndDate: payload.endDate, shipNodeType: 'SellerFulfilled', limit: '100' })}`;
        const seen = new Set();
        while (next) {
          await check();
          if (seen.has(next)) throw fail('Walmart repeated an order cursor; import stopped to avoid a loop.');
          seen.add(next);
          const response = await client.request(next, { gate: 'walmartOrdersEnabled', jobId: job.id });
          if (!response.list?.elements) throw fail('Walmart returned an invalid order page.');
          for (const raw of response.list.elements.order || []) {
            await check();
            try { const order = mapOrder(raw); if (payload.environment === 'production') await saveIncomingOrder(order); record({ orderId: order.marketplaceOrderId, status: payload.environment === 'production' ? 'imported' : 'sandbox_validated_not_imported' }); }
            catch (error) { record({ orderId: raw.purchaseOrderId, error: error.message }); }
          }
          const cursor = response.list.meta?.nextCursor;
          if (cursor && !String(cursor).startsWith('?')) throw fail('Unexpected Walmart order cursor format.');
          if (cursor) { const params = new URLSearchParams(cursor.slice(1)); params.set('shipNodeType', 'SellerFulfilled'); next = `/v3/orders?${params}`; } else next = '';
          await persistJob(job, { processedRows: processed, missingCount: failed, message: `${processed} orders processed; ${failed} need attention.` });
        }
      } else if (operation === 'taxonomy') {
        const s = await settings();
        const requestedVersion = s.walmartSpecVersion || '5.0';
        const data = await client.request(`/v3/items/taxonomy?${new URLSearchParams({ feedType: 'MP_ITEM', version: requestedVersion })}`, { jobId: job.id });
        const rows = taxonomyRows(data);
        if (!rows.length) throw fail('Walmart returned an empty taxonomy; the saved taxonomy was preserved.');
        await check();
        await write('walmart.taxonomy', { version: String(data.version || requestedVersion), rows, updatedAt: stamp() });
        for (const row of rows) record(row);
      } else if (operation === 'update') {
        await lock(`update:${payload.token}`, async () => {
          const preview = await read(`walmart.update.${payload.token}`);
          if (!preview || preview.state !== 'preview' || preview.expiresAt < Date.now()) throw fail('Update preview is expired or already used. Reconcile before retrying.');
          const plan = await operationPlan(preview.kind, preview.key, preview.shipmentId);
          if (plan.fingerprint !== preview.fingerprint) throw fail('Order, stock, or rules changed. Create a new preview.');
          await check();
          await write(`walmart.update.${payload.token}`, { ...preview, state: 'submitting', jobId: job.id });
          const response = await client.request(plan.path, { method: plan.method, body: plan.body, gate: plan.gate, jobId: job.id });
          if (plan.kind === 'price' && response.ItemPriceResponse?.sku !== plan.body.sku) throw fail('Walmart did not confirm the price SKU. Reconcile before retrying.');
          if (plan.kind === 'inventory' && (response.sku !== plan.body.sku || Number(response.quantity?.amount) !== plan.body.quantity.amount)) throw fail('Walmart did not confirm the requested inventory. Reconcile before retrying.');
          if (['acknowledge','tracking'].includes(plan.kind)) await saveIncomingOrder(mapOrder(response.order || response));
          await write(`walmart.update.${payload.token}`, { ...preview, state: 'accepted', jobId: job.id });
          record({ operation: plan.kind, key: plan.key, status: 'accepted' });
        });
      } else if (operation === 'match') {
        let total = 0, selectionPages = 0;
        if (payload.allFiltered) {
          const seen = new Set();
          for (let page = 1; ; page++) {
            await check();
            const result = await deps.matchSelectionPage(payload, page);
            const keys = result.keys.filter(key => { if (seen.has(key)) return false; seen.add(key); return true; });
            if (!result.keys.length) break;
            await write(`walmart.match.selection.${job.id}.${selectionPages++}`, { keys }); total += keys.length;
            await persistJob(job, { phase: 'select-products', totalRows: total, message: `${total} selected catalog records staged for UPC matching.` });
            if (result.hasMore === false || result.keys.length < 500) break;
          }
        } else {
          for (let i = 0; i < payload.skus.length; i += 500) { const keys = payload.skus.slice(i, i + 500); await write(`walmart.match.selection.${job.id}.${selectionPages++}`, { keys }); total += keys.length; }
        }
        let rows = [], matchedCount = 0, resultPage = 0;
        for (let page = 0; page < selectionPages; page++) {
        for (const sku of (await read(`walmart.match.selection.${job.id}.${page}`)).keys) {
          await check();
          let row;
          try {
            row = await lookupProduct(sku, job.id);
          } catch (error) { row = { sku, status: 'error', error: error.message }; }
          await check();
          rows.push(row); record(row); if (row.status === 'matched') matchedCount++;
          await write(`walmart.match.results.${job.id}.${resultPage}`, { rows });
          await write(`walmart.match.${job.id}`, { actor: payload.actor, jobId: job.id, total, processed, matchedCount, complete: false, updatedAt: stamp() });
          await persistJob(job, { processedRows: processed, totalRows: total, progressPercent: Math.round(processed / Math.max(total, 1) * 100), message: `${processed}/${total} Walmart UPC lookups completed.` });
          if (rows.length === 100) { rows = []; resultPage++; }
        }
        }
        await write(`walmart.match.${job.id}`, { actor: payload.actor, jobId: job.id, total, processed, matchedCount, complete: true, updatedAt: stamp() });
      } else if (operation === 'preview') {
        const rows = [];
        for (const sku of payload.skus) {
          await check();
          try { const preview = await prepare(sku, {}, payload.actor); rows.push({ sku, token: preview.token, price: preview.price, feedType: preview.feedType, errors: preview.errors }); }
          catch (error) { rows.push({ sku, errors: [{ field: '/', message: error.message }] }); }
          record(rows.at(-1));
          await write(`walmart.batch.${job.id}`, { actor: payload.actor, rows, jobId: job.id, complete: false });
          await persistJob(job, { processedRows: processed, totalRows: payload.skus.length, message: `${processed}/${payload.skus.length} Walmart launch previews prepared.` });
        }
        failed = rows.filter(row => row.errors.length).length;
        await write(`walmart.batch.${job.id}`, { actor: payload.actor, rows, jobId: job.id, complete: true });
      } else if (operation === 'launch') {
        for (const token of payload.tokens || [payload.token]) {
        await check();
        try { await lock(`preview:${token}`, async () => {
          const preview = await read(`walmart.preview.${token}`);
          if (!preview || preview.errors?.length || preview.expiresAt < Date.now()) throw fail('Launch preview is invalid or expired. Create a new preview.');
          if (preview.state !== 'preview') throw fail(`This preview is ${preview.state}. Reconcile its feed before creating another launch.`);
          const c = await enabled('walmartLaunchEnabled'), p = await product(preview.productId), db = await readDb();
          const mapping = preview.category ? await read(mappingKey(preview.category)) : null;
          if (preview.fingerprint !== digest([p, mapping, c.settings, await credentialKey()])) throw fail('Product, mapping, or channel rules changed. Create a new preview.');
          launchGate(p, db, c.settings);
          await check();
          const correlationId = crypto.randomUUID();
          // Durable intent precedes the remote mutation; interrupted writes are never blindly replayed.
          await write(`walmart.preview.${token}`, { ...preview, state: 'submitting', correlationId, jobId: job.id });
          const response = await client.request(`/v3/feeds?feedType=${preview.feedType}`, { method: 'POST', body: preview.payload, gate: 'walmartLaunchEnabled', jobId: job.id, correlationId });
          if (!response.feedId) throw fail('Walmart returned no feed ID. Acceptance unknown; reconcile before retrying.');
          const submission = { sku: p.sku, productId: p.id, feedId: response.feedId, feedType: preview.feedType, status: 'submitted', jobId: job.id, correlationId, at: stamp() };
          await write(`walmart.preview.${token}`, { ...preview, ...submission, state: 'submitted' });
          await write(`walmart.listing.${payload.environment}.${digest(p.id)}`, submission);
          await write(`walmart.pendingFeed.${digest([payload.environment, response.feedId])}`, { ...submission, environment: payload.environment, nextCheckAt: Date.now() + 15 * 60000, attempts: 0, complete: false });
          if (payload.environment === 'production' && deps.saveListing) await deps.saveListing(p.id, { ...submission, environment: 'production', publishedStatus: 'UNVERIFIED' });
          record(submission);
        }); } catch (error) { if (error.statusCode === 499) throw error; record({ token, error: error.message }); }
        await persistJob(job, { processedRows: processed, missingCount: failed });
        }
      } else if (operation === 'feed') {
        let offset = 0;
        for (;;) {
          await check();
          const data = await client.request(`/v3/feeds/${encodeURIComponent(payload.feedId)}?includeDetails=true&offset=${offset}&limit=50`, { jobId: job.id });
          if (!['RECEIVED','INPROGRESS','PROCESSED','ERROR'].includes(data.feedStatus)) throw fail('Walmart returned an unrecognized feed status. Recheck before assuming completion.');
          const rows = data.itemDetails?.itemIngestionStatus || [];
          pending ||= ['RECEIVED', 'INPROGRESS'].includes(data.feedStatus) || Number(data.itemsProcessing) > 0;
          for (const row of rows) {
            pending ||= ['INPROGRESS','RECEIVED'].includes(row.ingestionStatus);
            const error = ['DATA_ERROR','SYSTEM_ERROR','TIMEOUT_ERROR'].includes(row.ingestionStatus) ? JSON.stringify(row.ingestionErrors || row) : '';
            record({ ...row, feedId: payload.feedId, feedStatus: data.feedStatus, error });
            if (payload.environment === 'production' && deps.saveListing && row.sku) {
              const p = await postgres.readProductByKey(row.sku);
              if (p?.sku === row.sku && p.walmartListing?.feedId === payload.feedId) await deps.saveListing(p.id, { ingestionStatus: row.ingestionStatus, ingestionErrors: row.ingestionErrors || [], pendingStatusDescription: row.pendingStatusDescription || '', ...(row.itemid ? { itemId: row.itemid } : {}), ...(row.wpid ? { wpid: row.wpid } : {}), checkedAt: stamp() });
            }
          }
          await write(`walmart.feed.${payload.environment}.${digest(payload.feedId)}`, { feedId: payload.feedId, feedStatus: data.feedStatus, itemsFailed: data.itemsFailed, itemsProcessing: data.itemsProcessing, itemsSucceeded: data.itemsSucceeded, checkedAt: stamp(), jobId: job.id });
          if (data.feedStatus === 'ERROR' || Number(data.itemsFailed) > 0) failed = Math.max(1, failed);
          offset += rows.length;
          if (rows.length < 50 || offset >= Number(data.itemsReceived || Infinity)) break;
        }
        const pendingKey = `walmart.pendingFeed.${digest([payload.environment, payload.feedId])}`;
        const tracker = await read(pendingKey);
        if (tracker) await write(pendingKey, { ...tracker, complete: !pending, attempts: Number(tracker.attempts || 0) + 1, nextCheckAt: Date.now() + Math.min(240, 15 * 2 ** Number(tracker.attempts || 0)) * 60000 });
      } else throw fail('Unsupported Walmart job.');
      await persistJob(job, { status: failed || pending ? 'warning' : 'success', phase: 'complete', finishedAt: stamp(), processedRows: processed, totalRows: processed, missingCount: failed, progressPercent: 100, message: operation === 'launch' ? `${processed - failed} feeds submitted; ${failed} need attention. Check feed results and seller item status to verify publication.` : pending ? `Walmart is still processing this feed. Check again later. ${failed} failures reported.` : `${processed} records processed; ${failed} need attention.` });
    } catch (error) {
      if (error.statusCode === 499) return;
      record({ error: error.message });
      await persistJob(job, { status: 'failed', phase: 'failed', finishedAt: stamp(), message: error.message, missingCount: failed });
    } finally {
      if (fs.existsSync(report) && postgres.upsertOperationArtifact) await postgres.upsertOperationArtifact(job, 'original');
      log({ channel: 'Walmart', transport: 'Job', method: 'RUN', path: operation, operation: job.operation, statusCode: failed ? 422 : 200, ok: !failed, jobId: job.id, message: job.message });
    }
  }
  async function handle(req, res, url, actor, sendJson, parseBody) {
    if (!url.pathname.startsWith('/api/walmart/')) return false;
    try {
      if (!postgres.isPostgresEnabled()) throw fail('Walmart requires PostgreSQL and the external DataPlus worker.', 409);
      const action = url.pathname.slice('/api/walmart/'.length);
      const body = req.method === 'GET' ? {} : await parseBody(req);
      let result;
      if (req.method === 'GET' && action === 'status') {
        const s = await settings();
        const prefix = s.walmartEnvironment === 'sandbox' ? 'WALMART_SANDBOX_' : 'WALMART_';
        const taxonomy = await read('walmart.taxonomy');
        const taxonomyJobId = (await read('walmart.taxonomyJob'))?.id;
        const taxonomyJob = taxonomyJobId ? await postgres.readOperationJob(taxonomyJobId) : null;
        result = { ...(deps.credentials ? deps.credentials.status(s.walmartEnvironment || 'production') : { configured: Boolean(process.env[`${prefix}CLIENT_ID`] && process.env[`${prefix}CLIENT_SECRET`]) }), shipNodes: await shipNodes(), connection: await connectionStatus(), environment: s.walmartEnvironment || 'production', schedule: await read('walmart.orderSchedule'), taxonomy: { job: taxonomyJob ? { id: taxonomyJob.id, jobNumber: taxonomyJob.jobNumber, status: taxonomyJob.status, message: taxonomyJob.message } : null, version: taxonomy?.version, count: taxonomy?.rows?.length || 0, updatedAt: taxonomy?.updatedAt } };
      } else if (req.method === 'GET' && action === 'ship-nodes') result = await shipNodes();
      else if (req.method === 'POST' && action === 'ship-nodes/refresh') result = await lock('ship-nodes', () => shipNodes(true));
      else if (req.method === 'POST' && action === 'credentials') {
        if (!deps.credentials) throw fail('Credential storage is unavailable.');
        result = await lock('credentials', async () => {
          const c = await channel(), environment = c?.settings?.walmartEnvironment || 'production';
          if (body.environment !== environment) throw fail('Environment changed. Reload the connection form before saving.');
          const credentials = deps.credentials.save(environment, body);
          await write(`walmart.connection.${environment}`, { verified: false, message: 'Credentials updated. Verify the connection again.' });
          if (deps.saveConnectionStatus) await deps.saveConnectionStatus(c.id, { connected: false, status: 'inactive' });
          log({ channel: 'Walmart', transport: 'configuration', method: 'SAVE', path: 'credentials', operation: 'Update Walmart credentials', statusCode: 200, ok: true, message: `${environment} credentials saved by ${actor}; secrets masked.` });
          return { ...credentials, message: 'Credentials saved securely. Verify the connection to continue.' };
        });
      } else if (req.method === 'POST' && action === 'connection/verify') {
        result = await lock('credentials', async () => {
          const c = await enabled(), environment = c.settings.walmartEnvironment || 'production', key = await credentialKey();
          try {
            await client.request('/v3/orders?limit=1&shipNodeType=SellerFulfilled');
            if (key !== await credentialKey() || (await channel()).id !== c.id) throw fail('Connection changed during verification. Try again.');
            const connection = { verified: true, verifiedAt: stamp(), credentialKey: key, channelId: c.id, message: 'Authentication and order-read access verified. Item-write permissions are checked during launch.' };
            await write(`walmart.connection.${environment}`, connection);
            if (deps.saveConnectionStatus) await deps.saveConnectionStatus(c.id, { connected: true, status: 'active' });
            return { connection: { verified: true, verifiedAt: connection.verifiedAt }, message: connection.message };
          } catch (error) {
            await write(`walmart.connection.${environment}`, { verified: false, message: error.message });
            if (deps.saveConnectionStatus) await deps.saveConnectionStatus(c.id, { connected: false, status: 'inactive' });
            throw error;
          }
        });
      } else if (req.method === 'POST' && action === 'orders/import') {
        const start = new Date(body.startDate), end = new Date(body.endDate || Date.now());
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end - start > 180 * 86400000) throw fail('Choose a valid order date range of at most 180 days.');
        result = await queue('orders', { startDate: start.toISOString(), endDate: end.toISOString() });
      } else if (req.method === 'POST' && action === 'operations/preview') {
        const plan = await operationPlan(body.kind, body.key, body.shipmentId);
        const preview = { ...plan, token: crypto.randomUUID(), actor, state: 'preview', expiresAt: Date.now() + 30 * 60000 };
        await write(`walmart.update.${preview.token}`, preview); result = preview;
      } else if (req.method === 'POST' && action === 'operations/apply') {
        const preview = await read(`walmart.update.${body.token}`);
        if (!preview || preview.actor !== actor || preview.state !== 'preview' || preview.expiresAt < Date.now()) throw fail('A valid update preview owned by your user is required.');
        result = await queue('update', { token: preview.token });
      } else if (req.method === 'POST' && action === 'taxonomy/refresh') result = await queue('taxonomy', {});
      else if (req.method === 'GET' && action === 'taxonomy') {
        const taxonomy = await read('walmart.taxonomy');
        const q = (url.searchParams.get('q') || '').toLowerCase();
        const matched = (taxonomy?.rows || []).filter(r => r.path.toLowerCase().includes(q));
        const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
        result = { version: taxonomy?.version, updatedAt: taxonomy?.updatedAt, total: matched.length, rows: matched.slice(offset, offset + 100) };
      } else if (req.method === 'GET' && action === 'mappings') result = { mappings: await mappings() };
      else if (req.method === 'GET' && action === 'mapping') result = { mapping: await read(mappingKey(url.searchParams.get('category') || '')) || null };
      else if (req.method === 'POST' && action === 'mapping') {
        await enabled();
        const taxonomy = await read('walmart.taxonomy'), s = await settings();
        const row = taxonomy?.rows?.find(r => r.productType === body.productType);
        if (!body.category?.trim() || !row || taxonomy.version !== (s.walmartSpecVersion || taxonomy.version)) throw fail('Choose a master category and a product type from the current Walmart taxonomy.');
        const mapping = { category: body.category.trim(), productType: row.productType, path: row.path, version: taxonomy.version, orderable: object(body.orderable), visible: object(body.visible), approvedBy: actor, updatedAt: stamp() };
        await write(mappingKey(mapping.category), mapping);
        log({ channel: 'Walmart', transport: 'Settings', method: 'SAVE', path: 'mapping', operation: 'Walmart category mapping', statusCode: 200, ok: true, message: `${mapping.category} → ${mapping.productType}` });
        result = { mapping, message: 'Walmart category mapping saved.' };
      } else if (req.method === 'POST' && action === 'spec') {
        const s = await settings(); result = { schema: await spec('MP_ITEM', s.walmartSpecVersion || (await read('walmart.taxonomy'))?.version || '5.0', body.productType) };
      } else if (req.method === 'POST' && action === 'reconcile') {
        await enabled();
        if ((await settings()).walmartEnvironment === 'sandbox') throw fail('Seller listing reconciliation requires production.');
        result = await queue('reconcile', { actor });
      } else if (req.method === 'GET' && action === 'reconcile') {
        const job = await postgres.readOperationJob(url.searchParams.get('jobId'));
        if (!job || job.workerTask !== 'walmart-reconcile' || job.workerPayload?.actor !== actor) throw fail('Your reconciliation job was not found.', 404);
        const batch = await read(`walmart.reconcile.${job.id}`);
        result = { ...(batch || { rows: [], total: job.totalRows || 0, processed: 0, complete: false }), jobId: job.id, jobNumber: job.jobNumber, status: job.status, message: job.message };
      } else if (req.method === 'POST' && action === 'match/single') {
        const sku = typeof body.sku === 'string' ? body.sku.trim() : '';
        if (!sku || sku.length > 500) throw fail('Choose one catalog SKU for lookup.');
        const c = await enabled(), key = await credentialKey(), environment = c.settings.walmartEnvironment || 'production';
        const row = await lookupProduct(sku);
        const current = await enabled();
        if (current.id !== c.id || (current.settings.walmartEnvironment || 'production') !== environment || await credentialKey() !== key) throw fail('Walmart connection changed during lookup. Try again.', 409);
        result = { rows: [row], total: 1, processed: 1, matchedCount: row.status === 'matched' ? 1 : 0, complete: true, status: 'success', message: 'Lookup complete.' };
      } else if (req.method === 'POST' && action === 'match') {
        const skus = [...new Set((Array.isArray(body.skus) ? body.skus : []).map(sku => String(sku).trim()).filter(Boolean))];
        if (!skus.length && body.allFiltered !== true) throw fail('Select catalog products for UPC matching.');
        if (skus.some(key => key.length > 500)) throw fail('Invalid catalog product key.');
        await enabled();
        result = await queue('match', { skus, actor, ...(body.allFiltered === true ? { allFiltered: true, query: String(body.query || '').slice(0, 500), filters: object(body.filters) } : {}) });
      } else if (req.method === 'GET' && action === 'match') {
        await enabled();
        const job = await postgres.readOperationJob(url.searchParams.get('jobId'));
        if (!job || job.workerTask !== 'walmart-match' || job.workerPayload?.actor !== actor) throw fail('Your Walmart match job was not found.', 404);
        const s = await settings();
        if (job.workerPayload.environment !== (s.walmartEnvironment || 'production') || job.workerPayload.credentialKey !== await credentialKey()) throw fail('The Walmart account or environment changed. Run a new match.', 409);
        const batch = await read(`walmart.match.${job.id}`);
        const offset = Math.max(0, Math.floor((Number(url.searchParams.get('offset')) || 0) / 100) * 100);
        const page = await read(`walmart.match.results.${job.id}.${offset / 100}`);
        result = { ...(batch || { total: job.totalRows || job.workerPayload.skus.length, complete: false }), rows: page?.rows || batch?.rows?.slice(offset, offset + 100) || [], offset, jobId: job.id, jobNumber: job.jobNumber, status: job.status, message: job.message };
      } else if (req.method === 'POST' && action === 'launch/form') result = await prepare(body.sku, {}, actor, true);
      else if (req.method === 'POST' && action === 'launch/preview') result = await prepare(body.sku, body, actor);
      else if (req.method === 'POST' && action === 'launch/batch-preview') {
        const skus = [...new Set((Array.isArray(body.skus) ? body.skus : []).map(sku => String(sku).trim()).filter(Boolean))];
        if (!skus.length || skus.length > 100) throw fail('Select between 1 and 100 catalog SKUs per batch.');
        await enabled('walmartLaunchEnabled');
        result = await queue('preview', { skus, actor });
      } else if (req.method === 'GET' && action === 'launch/batch') {
        const batch = await read(`walmart.batch.${url.searchParams.get('jobId')}`);
        if (!batch || batch.actor !== actor) throw fail('Your batch preview was not found or has not started.', 404);
        result = batch;
      }
      else if (req.method === 'POST' && action === 'launch/apply') {
        const tokens = [...new Set(Array.isArray(body.tokens) ? body.tokens : [body.token])];
        if (!tokens.length || tokens.length > 100) throw fail('Select 1–100 reviewed previews.');
        for (const token of tokens) {
          const preview = await read(`walmart.preview.${String(token)}`);
          if (!preview || preview.actor !== actor || preview.state !== 'preview' || preview.expiresAt < Date.now() || preview.errors?.length) throw fail('A valid launch preview owned by your user is required for each selected SKU.');
        }
        result = await queue('launch', { tokens });
      } else if (req.method === 'POST' && action === 'feeds/refresh') {
        if (!body.feedId || String(body.feedId).length > 200) throw fail('Enter a Walmart feed ID.');
        result = await queue('feed', { feedId: String(body.feedId) });
      } else if (req.method === 'GET' && action === 'listing') {
        const p = await product(url.searchParams.get('sku'));
        const environment = (await settings()).walmartEnvironment || 'production';
        const submission = await read(`walmart.listing.${environment}.${digest(p.id)}`);
        result = { submission, feed: submission?.feedId ? await read(`walmart.feed.${environment}.${digest(submission.feedId)}`) : null };
      } else if (req.method === 'POST' && action === 'listing/verify') {
        const p = await product(body.sku), remoteSku = await sellerSku(p);
        result = await client.request(`/v3/items/${encodeURIComponent(remoteSku)}?productIdType=SKU`);
        const item = (result.ItemResponse || result.itemResponse || []).find(row => row.sku === remoteSku);
        if (!item) throw fail('Walmart did not return this exact seller SKU.');
        if ((await settings()).walmartEnvironment !== 'sandbox' && deps.saveListing) await deps.saveListing(p.id, { sku: remoteSku, publishedStatus: item.publishedStatus || 'UNVERIFIED', lifecycleStatus: item.lifecycleStatus || '', itemId: item.itemId || item.itemid || '', wpid: item.wpid || '', price: item.price, checkedAt: stamp(), environment: 'production' });
      } else throw fail('Walmart route not found.', 404);
      sendJson(res, result?.job ? 202 : 200, result);
    } catch (error) { sendJson(res, error.statusCode || 500, { error: error.message }); }
    return true;
  }
  let lastScheduleCheck = 0;
  async function schedule() {
    if (Date.now() - lastScheduleCheck < 60000) return;
    lastScheduleCheck = Date.now();
    const c = await channel(), s = c?.settings || {};
    if (!s.channelEnabled) return;
    if (s.walmartFeedPollingEnabled !== false) {
      const pending = await postgres.getPool().query("select data from walmart_documents where doc_key like 'walmart.pendingFeed.%' and data->>'complete'='false' and (data->>'nextCheckAt')::numeric <= $1 and data->>'environment'=$2 order by updated_at limit 1", [Date.now(), s.walmartEnvironment || 'production']);
      if (pending.rows[0]) {
        const tracker = pending.rows[0].data;
        const queued = await queue('feed', { feedId: tracker.feedId });
        if (!queued.duplicate) await write(`walmart.pendingFeed.${digest([tracker.environment, tracker.feedId])}`, { ...tracker, nextCheckAt: Date.now() + 15 * 60000, lastJobId: queued.job.id });
      }
    }
    if (!s.walmartOrdersEnabled || s.walmartOrderScheduleEnabled !== true || s.walmartEnvironment === 'sandbox') return;
    await lock('schedule', async () => {
      const previous = await read('walmart.orderSchedule');
      const hours = Math.max(1, Math.min(24, Number(s.walmartOrderScheduleHours || 1) || 1));
      if (previous?.queuedAt && Date.now() - new Date(previous.queuedAt).getTime() < hours * 3600000) return;
      const days = Math.max(1, Math.min(180, Number(s.walmartOrderLookbackDays || 30) || 30));
      const result = await queue('orders', { startDate: new Date(Date.now() - days * 86400000).toISOString(), endDate: stamp(), scheduled: true });
      if (!result.duplicate) await write('walmart.orderSchedule', { queuedAt: stamp(), jobId: result.job.id, lookbackDays: days, intervalHours: hours });
    });
  }
  return { handle, run, prepare, queue, schedule, operationPlan, zeroInactive, projectCategories };
}

module.exports = { createWalmartMarketplace, validatePayload, mappingKey };
