const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const { createWalmartClient, identifier, taxonomyRows, mapOrder, fail } = require('./walmart-client');
const { productIsMasterInactive } = require('./product-selling-status');
const { productChannelInactive } = require('./channel-selling-status');
const { retirementPhysicalQty } = require('./supplier-retirement');
const { walmartSupplierBlock } = require('./walmart-supplier');
const { launchShippingItem, walmartLaunchShippingReview } = require('./walmart-launch-shipping');
const { inventoryAmount, shipmentPayload, walmartCancelableLines, walmartCancellationPayload } = require('./walmart-operations');
const { walmartReturnRows, walmartReturnNextCursor, walmartReturnRecord } = require('./walmart-returns');
const { reconcileOrderReturns } = require('./return-workflow');
const { verifyWalmartWebhook, walmartWebhookEnvelope, walmartWebhookEventTypes, walmartWebhookSubscriptionRows, sanitizeWalmartSubscriptions } = require('./walmart-webhooks');
const { walmartReview, mappingRevision } = require('./walmart-category-projection');
const { launchStatus } = require('./walmart-launch-reconciliation');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const stamp = () => new Date().toISOString();
const mappingKey = category => `walmart.mapping.${digest(String(category).trim().toLowerCase())}`;
const WALMART_READINESS_CONCURRENCY = 4;
const WALMART_READINESS_BATCH_SIZE = 25;
const WALMART_READINESS_REMOTE_LIMIT = 5000;

function historicalOrder(order, jobId) {
  const status = String(order.status || order.fulfillmentStatus || '').trim().toLowerCase();
  const terminal = ['canceled', 'cancelled', 'void', 'voided', 'deleted', 'refunded', 'returned', 'closed', 'shipped', 'fulfilled', 'completed', 'delivered'].includes(status);
  return {
    ...order,
    historicalBackfill: true,
    historicalBackfillImportedAt: stamp(),
    historicalBackfillJobId: String(jobId || ''),
    historicalBackfillChannel: 'Walmart',
    excludedFromOperationalQueues: terminal,
    historicalReviewRequired: !terminal,
    historicalReviewReason: terminal ? '' : 'Historical import found this order open at Walmart. Review it before releasing operational work.',
    ...(!terminal ? { operationalStatus: 'on_hold', workflowStatus: 'on_hold' } : {})
  };
}

function walmartStatusReconciliationCandidates(orders = [], options = {}) {
  const now = Number(options.now || Date.now());
  const lookbackDays = Math.max(90, Math.min(180, Number(options.lookbackDays || 90) || 90));
  const cutoff = now - lookbackDays * 86400000;
  const excluded = new Set(['canceled', 'cancelled', 'void', 'voided', 'deleted']);
  const ranked = orders
    .filter(order => String(order.source || '').trim().toLowerCase() === 'walmart')
    .filter(order => !excluded.has(String(order.status || order.fulfillmentStatus || '').trim().toLowerCase()))
    .filter(order => {
      const orderedAt = Date.parse(order.orderDate || order.orderedAt || order.createdAt || '');
      return !Number.isFinite(orderedAt) || orderedAt >= cutoff;
    })
    .map(order => {
      const id = String(order.marketplaceOrderNumber || order.marketplaceOrderId || order.external?.purchaseOrderId || '').trim();
      const status = String(order.status || order.fulfillmentStatus || '').trim().toLowerCase();
      const hasTracking = Boolean(String(order.trackingNumber || '').trim() || (order.shipments || []).some(shipment => String(shipment?.trackingNumber || '').trim()));
      const orderedAt = Date.parse(order.orderDate || order.orderedAt || order.createdAt || '');
      const active = !['fulfilled', 'shipped', 'completed', 'delivered'].includes(status);
      return { id, priority: active && !hasTracking ? 0 : active ? 1 : !hasTracking ? 2 : 3, orderedAt: Number.isFinite(orderedAt) ? orderedAt : 0 };
    })
    .filter(row => row.id)
    .sort((left, right) => left.priority - right.priority || right.orderedAt - left.orderedAt || left.id.localeCompare(right.id));
  const seen = new Set();
  return ranked.filter(row => !seen.has(row.id) && seen.add(row.id)).map(row => row.id);
}

async function walmartStatusReconciliationCandidatesFromDatabase(pool, options = {}) {
  const lookbackDays = Math.max(90, Math.min(180, Number(options.lookbackDays || 90) || 90));
  const result = await pool.query(`
    with candidates as (
      select distinct on (purchase_order_id)
        purchase_order_id,
        case
          when status not in ('fulfilled', 'shipped', 'completed', 'delivered') and not has_tracking then 0
          when status not in ('fulfilled', 'shipped', 'completed', 'delivered') then 1
          when not has_tracking then 2
          else 3
        end as priority,
        ordered_at
      from (
        select
          coalesce(nullif(btrim(marketplace_order_id), ''), nullif(btrim(raw->'external'->>'purchaseOrderId'), '')) as purchase_order_id,
          lower(coalesce(status, raw->>'fulfillmentStatus', '')) as status,
          coalesce(order_date, created_at) as ordered_at,
          (nullif(btrim(tracking_number), '') is not null or exists (
            select 1
            from order_shipment_tracking tracking
            where tracking.order_id = orders.order_id
              and nullif(btrim(tracking.tracking_number), '') is not null
          )) as has_tracking
        from order_records orders
        where lower(coalesce(source, '')) = 'walmart'
          and lower(coalesce(status, raw->>'fulfillmentStatus', '')) not in ('canceled', 'cancelled', 'void', 'voided', 'deleted')
          and coalesce(order_date, created_at) >= now() - make_interval(days => $1)
      ) eligible
      where purchase_order_id is not null
      order by purchase_order_id, priority, ordered_at desc
    )
    select purchase_order_id
    from candidates
    order by priority, ordered_at desc, purchase_order_id
  `, [lookbackDays]);
  return result.rows.map(row => String(row.purchase_order_id || '').trim()).filter(Boolean);
}

async function mapConcurrent(values, limit, fn) {
  const rows = new Array(values.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), values.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= values.length) return;
      rows[index] = await fn(values[index], index);
    }
  });
  await Promise.all(workers);
  return rows;
}

function validatePayload(schema, payload) {
  if (!schema || typeof schema !== 'object') throw fail('Walmart returned no item schema. Refresh the product type requirements.');
  const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: true, multipleOfPrecision: 8 });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  validate(payload);
  return (validate.errors || []).slice(0, 100).map(e => ({ field: `${e.instancePath || '/'}${e.params.missingProperty ? `/${e.params.missingProperty}` : ''}`, message: e.message, params: e.params }));
}

function createWalmartMarketplace(deps) {
  const readinessConcurrency = Math.max(1, Math.floor(Number(deps.readinessConcurrency) || WALMART_READINESS_CONCURRENCY));
  const readinessBatchSize = Math.max(1, Math.floor(Number(deps.readinessBatchSize) || WALMART_READINESS_BATCH_SIZE));
  const readinessRemoteLimit = Math.max(1, Math.floor(Number(deps.readinessRemoteLimit) || WALMART_READINESS_REMOTE_LIMIT));
  const { postgres, readDb, log, createJob, persistJob, findActive, artifactsDir, saveOrder, priceFor, shippingRestriction } = deps;
  // Marketplace review documents must never enter general app_state snapshots.
  const read = async key => key === 'connections'
    ? (deps.readConnections ? deps.readConnections() : postgres.readStateField(key))
    : (await postgres.getPool().query('select data from walmart_documents where doc_key=$1', [key])).rows[0]?.data;
  const write = (key, value) => postgres.getPool().query('insert into walmart_documents(doc_key,data,updated_at) values($1,$2::jsonb,now()) on conflict(doc_key) do update set data=excluded.data,updated_at=now()', [key, JSON.stringify(value)]);
  async function channel() {
    // Read persisted switches at every request, including inside a running worker.
    const rows = await read('connections') || [];
    return rows.find(c => c.name === 'Walmart');
  }
  const client = createWalmartClient({ channel, log, ...(deps.credentials ? { credentials: environment => deps.credentials.get(environment) } : {}), ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) });
  const readinessLookupInFlight = new Map();
  let readinessRateLimitedUntil = 0;
  async function enabled(gate) {
    const c = await channel();
    if (!c || c.settings?.channelEnabled !== true) throw fail('Enable Walmart Marketplace in Channels first.', 409);
    const gateEnabled = gate === 'walmartSettlementImportEnabled' ? c.settings?.[gate] !== false : c.settings?.[gate] === true;
    if (gate && !gateEnabled) throw fail(`Enable ${gate.replace(/^walmart/, 'Walmart ')} in Rules first.`, 409);
    return c;
  }
  async function lock(key, fn) {
    const db = await postgres.getPool().connect();
    try { await db.query('select pg_advisory_lock(hashtext($1))', [`walmart:${key}`]); return await fn(); }
    finally { await db.query('select pg_advisory_unlock(hashtext($1))', [`walmart:${key}`]); db.release(); }
  }
  async function settings() { return (await channel())?.settings || {}; }
  async function operationalContext() {
    const db = deps.readOperationalContext ? await deps.readOperationalContext() : await readDb();
    return {
      vendors: Array.isArray(db?.vendors) ? db.vendors : [],
      warehouses: Array.isArray(db?.warehouses) ? db.warehouses : []
    };
  }
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
  async function saveIncomingOrder(order, options = {}) {
    const c = await channel();
    const mapped = await require('./walmart-reconciliation').resolveOrderLinks(postgres.getPool(), order, { channelId: c.id, credentialKey: await credentialKey() });
    return saveOrder(mapped, options);
  }
  async function refreshOrder(key) {
    await enabled('walmartOrdersEnabled');
    const s = await settings();
    if (s.walmartEnvironment === 'sandbox') throw fail('Operational Walmart order refresh requires production.', 409);
    const local = await postgres.readOrderByKey(String(key || '').trim());
    if (!local || String(local.source || '').trim().toLowerCase() !== 'walmart') throw fail('Choose an imported Walmart order.', 404);
    const purchaseOrderId = String(local.marketplaceOrderNumber || local.marketplaceOrderId || local.external?.purchaseOrderId || '').trim();
    if (!purchaseOrderId) throw fail('This order has no Walmart purchase order ID.', 409);
    const response = await client.request(`/v3/orders/${encodeURIComponent(purchaseOrderId)}`, { gate: 'walmartOrdersEnabled' });
    const raw = response.order || response;
    if (String(raw.purchaseOrderId || '').trim() !== purchaseOrderId) throw fail('Walmart returned a different purchase order.', 502);
    await saveIncomingOrder(mapOrder(raw), { existingRefresh: true });
    const order = await postgres.readOrderByKey(local.id);
    return { order, message: order?.trackingNumber || order?.shipments?.some(shipment => shipment.trackingNumber) ? 'Walmart status and tracking refreshed.' : 'Walmart status refreshed; Walmart did not return tracking for this order.' };
  }
  async function saveWalmartReturn(raw) {
    const returnLines = Array.isArray(raw.returnOrderLines) ? raw.returnOrderLines : Array.isArray(raw.returnOrderLines?.returnOrderLine) ? raw.returnOrderLines.returnOrderLine : [];
    const purchaseOrderId = String(returnLines.find(line => line.purchaseOrderId)?.purchaseOrderId || raw.purchaseOrderId || raw.sellerOrderId || '').trim();
    const customerOrderId = String(raw.customerOrderId || '').trim();
    const order = (purchaseOrderId && await postgres.readChannelOrderForReturn('Walmart', { orderId: purchaseOrderId }))
      || (customerOrderId && await postgres.readChannelOrderForReturn('Walmart', { orderId: customerOrderId })) || null;
    const saved = await postgres.upsertImportedReturn(walmartReturnRecord(raw, order));
    if (order) {
      reconcileOrderReturns(order, [saved]);
      await postgres.saveOrder(order);
    }
    return { saved, order, purchaseOrderId, customerOrderId };
  }
  async function saveWalmartOrderEvent(purchaseOrderId, event) {
    const order = await postgres.readChannelOrderForReturn('Walmart', { orderId: purchaseOrderId });
    if (!order) return null;
    const subEventType = String(event.subEventType || event.eventType || '').trim().toUpperCase();
    const summary = { eventId: event.eventId, eventType: event.eventType, subEventType, receivedAt: event.receivedAt || stamp() };
    const external = { ...(order.external || {}), walmartLastOrderEvent: summary };
    if (subEventType === 'INTENT_TO_CANCEL') external.walmartCancellationRequest = { ...summary, status: 'pending' };
    else if (['PO_LINE_AUTOCANCELLED', 'FRAUD_CANCEL'].includes(subEventType)) external.walmartCancellationRequest = { ...summary, status: 'canceled' };
    order.external = external;
    await postgres.saveOrder(order);
    return order;
  }
  function publicWebhookEndpoint(req) {
    const configured = String(process.env.APPLICATION_URL || process.env.SHOPIFY_APP_URL || '').trim();
    let origin = '';
    if (configured) {
      try { origin = new URL(configured).origin; } catch { throw fail('APPLICATION_URL must be a valid public HTTPS URL before configuring Walmart webhooks.', 409); }
    }
    if (!origin && req) {
      const forwardedProto = String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
      const forwardedHost = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '').split(',')[0].trim();
      if (forwardedProto === 'https' && /^[a-z0-9.-]+(?::\d+)?$/i.test(forwardedHost)) origin = `https://${forwardedHost}`;
    }
    if (!/^https:\/\//i.test(origin)) throw fail('A public HTTPS application URL is required before configuring Walmart webhooks.', 409);
    return `${origin.replace(/\/+$/, '')}/api/webhooks/walmart`;
  }
  async function webhookStatus(loadRemote = false, req = null) {
    const s = await settings(), environment = s.walmartEnvironment || 'production';
    const local = await read(`walmart.webhookStatus.${environment}`) || {};
    let subscriptions = local.subscriptions || null, error = '';
    if (loadRemote && s.channelEnabled === true) {
      try { subscriptions = sanitizeWalmartSubscriptions(await client.request('/v3/webhooks/subscriptions')); }
      catch (caught) { error = caught.message; }
    }
    let endpoint = local.endpoint || '';
    if (!endpoint && req) { try { endpoint = publicWebhookEndpoint(req); } catch {} }
    return { enabled: s.walmartWebhooksEnabled === true, endpoint, configured: Boolean(deps.credentials?.status(environment).webhookSecretConfigured), eventTypes: local.eventTypes || [], subscriptions, lastReceivedAt: local.lastReceivedAt || '', lastEventType: local.lastEventType || '', setupAt: local.setupAt || '', error };
  }
  async function setupWebhooks(req, actor) {
    const c = await enabled('walmartWebhooksEnabled');
    await requireVerified();
    if (!deps.credentials) throw fail('Walmart credential storage is unavailable.', 503);
    const environment = c.settings.walmartEnvironment || 'production';
    if (environment !== 'production') throw fail('Operational Walmart webhooks require production.', 409);
    const endpoint = publicWebhookEndpoint(req);
    const secret = deps.credentials.ensureWebhookSecret(environment);
    const available = await client.request('/v3/webhooks/eventTypes');
    const eventTypes = walmartWebhookEventTypes(available);
    if (!eventTypes.some(row => row.eventType === 'ORDER_UPDATES' || row.eventType === 'PO_CREATED')) throw fail('Walmart did not offer order event notifications to this account.', 409);
    if (!eventTypes.some(row => row.eventType.startsWith('RETURN_'))) throw fail('Walmart did not offer return event notifications to this account.', 409);
    const current = await client.request('/v3/webhooks/subscriptions');
    const currentRows = walmartWebhookSubscriptionRows(current);
    const missing = eventTypes.filter(row => !currentRows.some(subscription => subscription.eventType === row.eventType && subscription.eventUrl === endpoint && subscription.status !== 'INACTIVE'));
    let created = null;
    if (missing.length) {
      const events = missing.map(row => ({ ...row, eventUrl: endpoint, status: 'ACTIVE', headers: { 'content-type': 'application/json' }, authDetails: { authMethod: 'HMAC', authHeaderName: 'X-DataPlus-Walmart-Signature', clientSecret: secret } }));
      for (const event of events) await client.request('/v3/webhooks/test', { method: 'POST', body: event });
      created = await client.request('/v3/webhooks/subscriptions', { method: 'POST', body: { events } });
    }
    const subscriptions = sanitizeWalmartSubscriptions(created || current);
    const status = { endpoint, eventTypes, subscriptions, setupAt: stamp(), setupBy: actor };
    await write(`walmart.webhookStatus.${environment}`, status);
    log({ channel: 'Walmart', transport: 'webhook', method: 'POST', path: '/v3/webhooks/subscriptions', operation: 'Configure Walmart webhooks', statusCode: 200, ok: true, message: `${missing.length} Walmart webhook subscription(s) created; secrets redacted.` });
    return { ...status, configured: true, created: missing.length, message: missing.length ? `${missing.length} Walmart webhook subscription(s) tested and created.` : 'Walmart order and return webhook subscriptions are already active.' };
  }
  async function receiveWebhook(rawBody, payload, signature) {
    const c = await channel(), s = c?.settings || {}, environment = s.walmartEnvironment || 'production';
    const secret = deps.credentials?.webhookSecret(environment) || '';
    if (secret && !verifyWalmartWebhook(rawBody, signature, secret)) throw fail('Invalid Walmart webhook signature.', 401);
    if (!c || s.channelEnabled !== true || s.walmartWebhooksEnabled !== true) return { accepted: true, disabled: true, message: 'Walmart webhook received while processing is disabled.' };
    if (!verifyWalmartWebhook(rawBody, signature, secret)) throw fail('Invalid Walmart webhook signature.', 401);
    const event = walmartWebhookEnvelope(payload, rawBody);
    const docKey = `walmart.webhook.event.${digest(event.eventId)}`;
    const stored = await postgres.getPool().query(`insert into walmart_documents(doc_key,data,updated_at) values($1,$2::jsonb,now()) on conflict(doc_key) do nothing returning doc_key`, [docKey, JSON.stringify({ ...event, payload, kind: 'event', status: event.supported ? 'pending' : 'ignored', receivedAt: stamp(), attempts: 0, environment, channelId: c.id, credentialKey: await credentialKey() })]);
    if (!stored.rows.length) return { accepted: true, duplicate: true, eventId: event.eventId, eventType: event.eventType };
    const prior = await read(`walmart.webhookStatus.${environment}`) || {};
    await write(`walmart.webhookStatus.${environment}`, { ...prior, lastReceivedAt: stamp(), lastEventType: event.eventType });
    if (event.supported) await queue('webhook', { actor: 'system:walmart-webhook' });
    return { accepted: true, eventId: event.eventId, eventType: event.eventType, supported: event.supported };
  }
  async function cancellationPreview(body, actor) {
    await enabled('walmartCancellationEnabled');
    const s = await settings();
    if (s.walmartEnvironment !== 'production') throw fail('Operational Walmart cancellations require production.', 409);
    const local = await postgres.readOrderByKey(String(body.orderId || '').trim());
    if (!local || String(local.source || '').trim().toLowerCase() !== 'walmart') throw fail('Choose an imported Walmart order.', 404);
    const purchaseOrderId = String(local.marketplaceOrderNumber || local.marketplaceOrderId || local.external?.purchaseOrderId || '').trim();
    if (!purchaseOrderId) throw fail('This order has no Walmart purchase order ID.', 409);
    const response = await client.request(`/v3/orders/${encodeURIComponent(purchaseOrderId)}`, { gate: 'walmartCancellationEnabled' });
    const remote = response.order || response;
    if (String(remote.purchaseOrderId || '').trim() !== purchaseOrderId) throw fail('Walmart returned a different purchase order.', 502);
    const availableLines = walmartCancelableLines(remote);
    if (!Array.isArray(body.lines) || !body.lines.length) return { orderId: local.id, purchaseOrderId, availableLines, message: availableLines.some(line => line.cancellableQuantity > 0) ? 'Choose the Walmart lines and quantities to cancel.' : 'No Walmart lines remain cancellable.' };
    const cancellation = walmartCancellationPayload(remote, body.lines, String(body.reason || ''));
    const preview = { token: crypto.randomUUID(), actor, state: 'preview', orderId: local.id, purchaseOrderId, reason: String(body.reason || ''), lines: body.lines, body: cancellation, fingerprint: digest([remote, cancellation, await credentialKey()]), expiresAt: Date.now() + 15 * 60000, createdAt: stamp() };
    await write(`walmart.cancel.${preview.token}`, preview);
    return { token: preview.token, orderId: local.id, purchaseOrderId, availableLines, lines: body.lines, reason: preview.reason, expiresAt: preview.expiresAt, message: 'Cancellation reviewed against the latest Walmart order. Confirm to submit.' };
  }
  async function cancellationApply(token, actor) {
    return lock(`cancel:${token}`, async () => {
      const key = `walmart.cancel.${String(token || '')}`, preview = await read(key);
      if (!preview || preview.actor !== actor || preview.state !== 'preview' || preview.expiresAt < Date.now()) throw fail('A valid cancellation preview owned by your user is required.', 409);
      await enabled('walmartCancellationEnabled');
      const response = await client.request(`/v3/orders/${encodeURIComponent(preview.purchaseOrderId)}`, { gate: 'walmartCancellationEnabled' });
      const remote = response.order || response;
      const cancellation = walmartCancellationPayload(remote, preview.lines, preview.reason);
      if (preview.fingerprint !== digest([remote, cancellation, await credentialKey()])) throw fail('The Walmart order changed after review. Create a new cancellation preview.', 409);
      await write(key, { ...preview, state: 'submitting', submittedAt: stamp() });
      try {
        await client.request(`/v3/orders/${encodeURIComponent(preview.purchaseOrderId)}/cancel`, { method: 'POST', body: cancellation, gate: 'walmartCancellationEnabled' });
        const refreshed = await client.request(`/v3/orders/${encodeURIComponent(preview.purchaseOrderId)}`, { gate: 'walmartCancellationEnabled' });
        await saveIncomingOrder(mapOrder(refreshed.order || refreshed), { existingRefresh: true });
        const accepted = await postgres.readOrderByKey(preview.orderId);
        if (accepted) {
          accepted.external = { ...(accepted.external || {}), walmartCancellationRequest: { eventType: 'DATAPLUS_CANCELLATION', subEventType: 'SELLER_CANCELLED', status: 'accepted', receivedAt: stamp() } };
          await postgres.saveOrder(accepted);
        }
        await write(key, { ...preview, state: 'accepted', submittedAt: stamp(), completedAt: stamp() });
        return { order: await postgres.readOrderByKey(preview.orderId), message: 'Walmart accepted the reviewed line cancellation and DataPlus refreshed the order.' };
      } catch (error) {
        await write(key, { ...preview, state: 'needs_reconciliation', submittedAt: stamp(), error: error.message });
        throw error;
      }
    });
  }
  async function sellerSku(p) {
    const link = p.walmartListing;
    if (!link?.sku) return p.sku;
    if (link.sku === p.sku && !link.reconciled) return p.sku;
    const c = await channel();
    if (!link.reconciled || link.productId !== p.id || link.channelId !== c.id || link.environment !== (c.settings.walmartEnvironment || 'production') || link.credentialKey !== await credentialKey()) throw fail('Walmart link belongs to a different account or product. Reconcile listings again before syncing.');
    return link.sku;
  }
  function sellingUnit(p, db) {
    const policy = deps.sellingUnits?.(p, db);
    if (!policy) {
      const quantity = Math.max(1, Number(deps.packSize?.(p, db) || 1));
      return { quantity, policy: null };
    }
    if (policy.individual) return { quantity: 1, policy };
    const quantity = Number(policy.sourceQty || 0);
    if (policy.cases && Number.isSafeInteger(quantity) && quantity > 1) return { quantity, policy };
    throw fail('Supplier selling-unit rules allow no sellable Walmart unit.');
  }
  function verifiedListingUnit(p) {
    const saved = Number(p.walmartListing?.sellingUnitQty || 0);
    if (saved > 0) return saved;
    return Number(deps.sourcePackSize?.(p) || 1) <= 1 ? 1 : 0;
  }
  function launchGate(p, db, s) {
    const unit = sellingUnit(p, db);
    if (p.catalogAttentionRequired === true || p.raw?.catalogAttentionRequired === true) throw fail('System-created SKU needs catalog review before launch.');
    if (productIsMasterInactive(p) || productChannelInactive(p, 'walmart') || p.discontinued === true || p.toBeDiscontinued === true || ['true','1'].includes(String(p.toBeDiscontinued || p.raw?.to_be_discontinued).toLowerCase())) throw fail('Inactive or discontinued products cannot launch.');
    if (walmartSupplierBlock(p, db.vendors || [])) throw fail('Supplier is inactive or retired. Review sourcing before launch.');
    const sourcePackQty = Number(deps.sourcePackSize?.(p) || 1);
    const shippingReview = walmartLaunchShippingReview(p, {
      sellingUnitQty: unit.quantity,
      sourcePackQty
    });
    if (shippingReview.blocked) throw fail(shippingReview.reason);
    const restriction = shippingRestriction(launchShippingItem(p, unit.quantity, sourcePackQty), s, 'launch');
    if (restriction.blocked) throw fail(restriction.reason);
    return unit;
  }
  async function launchFingerprint(p, mapping, settings, db) {
    const values = [p, mapping, settings, await credentialKey()];
    if (deps.sellingUnits) values.push(deps.sellingUnits(p, db));
    return digest(values);
  }
  async function spec(feedType, version, productType) {
    await enabled();
    if (feedType === 'MP_ITEM_MATCH' && version === '4.2') return require('./walmart-match-schema');
    const key = `walmart.spec.${digest([feedType, version, productType])}`;
    const cached = await read(key);
    if (cached?.schema) return cached.schema;
    const response = await client.request('/v3/items/spec', { method: 'POST', body: { feedType, version, ...(productType ? { productTypes: [productType] } : {}) } });
    if (!response.schema || response.errors?.length) throw fail('Walmart did not return complete requirements for this product type/version.');
    await write(key, { schema: response.schema, at: stamp() });
    return response.schema;
  }
  async function matchIdentity(p) {
    const c = await enabled();
    return digest([p.id, p.sku, p.gtin, p.upc, p.barcode, c.id, c.settings.walmartEnvironment || 'production', await credentialKey()]);
  }
  function walmartCandidate(item, index = 0) {
    const rawItemId = item?.itemId ?? item?.itemid ?? item?.usItemId;
    const itemId = (typeof rawItemId === 'string' || Number.isSafeInteger(rawItemId)) && /^[1-9][0-9]*$/.test(String(rawItemId).trim()) ? String(rawItemId).trim() : '';
    const wpid = String(item?.wpid || item?.WPID || '').trim();
    const title = String(item?.productName || item?.itemName || item?.title || item?.name || '').trim();
    const brand = String(item?.brand || item?.brandName || '').trim();
    const productType = String(item?.productType || item?.category || '').trim();
    const imageUrl = String(item?.imageUrl || item?.mainImageUrl || item?.images?.[0]?.url || '').trim();
    const candidateKey = itemId ? `item:${itemId}` : wpid ? `wpid:${wpid}` : `candidate:${digest([title, brand, productType, index])}`;
    return { candidateKey, itemId, wpid, title, brand, productType, imageUrl: /^https:\/\//i.test(imageUrl) ? imageUrl : '', productUrl: itemId ? `https://www.walmart.com/ip/${itemId}` : '' };
  }
  const walmartCandidates = items => (items || []).map(walmartCandidate);
  async function catalogSelection(p) {
    const saved = await read(`walmart.catalog-selection.${p.id}`);
    if (!saved?.candidate?.candidateKey || saved.identity !== await matchIdentity(p)) return null;
    return saved;
  }
  function selectedCandidate(candidates, selection) {
    return selection?.candidate?.candidateKey ? candidates.find(candidate => candidate.candidateKey === selection.candidate.candidateKey) || null : null;
  }
  function resolveCatalogCandidate(reference, items, selection) {
    const candidates = reference?.candidates?.length ? reference.candidates : walmartCandidates(items);
    return { candidates, chosen: selection ? selectedCandidate(candidates, selection) : candidates.length === 1 ? candidates[0] : null };
  }
  function existingMatch(candidate) {
    return { feedType: 'MP_ITEM_MATCH', version: '4.2', itemId: candidate.itemId, wpid: candidate.wpid, itemSpecPayload: { MPItemFeedHeader: { processMode: 'REPLACE', subset: 'EXTERNAL', locale: 'en', sellingChannel: 'mpsetupbymatch', version: '4.2' }, MPItem: [{ Item: {} }] } };
  }
  async function catalogReference(id, match, jobId) {
    if (!match) return { itemId: '', productUrl: '', referenceStatus: 'not_found' };
    try {
      const result = await client.request(`/v3/items/walmart/search?${new URLSearchParams({ [id.kind]: id.value, responseFormat: 'DEFAULT' })}`, { jobId });
      if (!result || result.errors || !Array.isArray(result.items)) throw fail('Catalog identifier lookup returned an invalid result.');
      const candidates = walmartCandidates(result.items);
      if (candidates.length > 1) return { itemId: '', productUrl: '', referenceStatus: 'ambiguous', referenceMessage: `${candidates.length} Walmart catalog items use this identifier. Select the correct item.`, candidates };
      const itemId = candidates[0]?.itemId || '';
      if (!/^[1-9][0-9]*$/.test(itemId)) return { itemId: '', productUrl: '', referenceStatus: 'unavailable', referenceMessage: 'Walmart did not return a usable item ID. Match readiness remains separate.' };
      return { itemId, productUrl: `https://www.walmart.com/ip/${itemId}`, referenceStatus: 'found', candidates };
    } catch (error) { return { itemId: '', productUrl: '', referenceStatus: 'error', referenceMessage: `Item ID lookup failed: ${error.message}` }; }
  }
  async function readinessLookup(id, jobId, { useCache = false, allowRemote = true } = {}) {
    const c = await enabled();
    const environment = c.settings.walmartEnvironment || 'production';
    const account = await credentialKey();
    const normalized = id.value.padStart(14, '0');
    const key = `walmart.readiness-lookup.${digest([c.id, environment, account, id.kind, normalized])}`;
    if (useCache) {
      const cached = await read(key);
      if (cached?.expiresAt > Date.now() && cached.search && cached.reference) return { ...cached, cacheHit: true, remoteChecked: false };
      if (readinessLookupInFlight.has(key)) return { ...(await readinessLookupInFlight.get(key)), cacheHit: true, remoteChecked: false };
    }
    if (!allowRemote) return { remotePending: true, cacheHit: false, remoteChecked: false };
    const lookup = (async () => {
      const search = await client.request(`/v3/items/walmart/search?${new URLSearchParams({ [id.kind]: id.value, responseFormat: 'SPEC' })}`, { jobId });
      if (!search || typeof search !== 'object' || search.errors || (search.items !== undefined && !Array.isArray(search.items)) || (search.items || []).some(item => !['MP_ITEM_MATCH', 'MP_ITEM'].includes(item.feedType))) throw fail('Identifier lookup was invalid. Run the check again.');
      search.items ||= [];
      const reference = await catalogReference(id, search.items[0], jobId);
      const result = { search, reference, checkedAt: stamp(), expiresAt: Date.now() + 86400000 };
      if (useCache) await write(key, result);
      return result;
    })();
    if (useCache) readinessLookupInFlight.set(key, lookup);
    try { return { ...(await lookup), cacheHit: false, remoteChecked: true }; }
    finally { if (useCache) readinessLookupInFlight.delete(key); }
  }
  async function saveCatalogMatch(p, identity, row) {
    if (identity !== await matchIdentity(await product(p.id))) throw fail('Product identifier or Walmart account changed during lookup. Check again.', 409);
    // Catalog evidence is deliberately separate from seller listing ownership/publication.
    await write(`walmart.catalog-match.${p.id}`, { ...row, checkedAt: stamp(), identity });
  }
  async function pricingContext() {
    const c = await enabled();
    return { channelId: c.id, environment: c.settings.walmartEnvironment || 'production', credentialKey: await credentialKey() };
  }
  async function pricingFor(p) {
    const pricing = require('./walmart-pricing'), context = await pricingContext();
    const saved = await read(pricing.rowKey(context, await sellerSku(p)));
    return saved ? { ...saved, stale: Date.now() - Date.parse(saved.checkedAt) >= 3600000 } : null;
  }
  async function queuePricing() {
    const pricing = require('./walmart-pricing'), context = await pricingContext();
    const sync = await read(`${pricing.prefix(context)}.sync`);
    if (sync?.checkedAt && Date.now() - Date.parse(sync.checkedAt) < 3600000) return;
    return queue('pricing', {});
  }
  async function verifyListing(key, { includeLag = true, jobId } = {}) {
    const p = await product(key), remoteSku = await sellerSku(p), c = await enabled();
    const account = await credentialKey(), environment = c.settings.walmartEnvironment || 'production';
    const identity = await matchIdentity(p);
    const data = await client.request(`/v3/items/${encodeURIComponent(remoteSku)}?productIdType=SKU`, { jobId });
    const item = (data.ItemResponse || data.itemResponse || []).find(row => row.sku === remoteSku);
    if (!item) throw fail('Walmart did not return this exact seller SKU.');
    const snapshotKey = `walmart.listing-status.${environment}.${digest(p.id)}`;
    const previous = await read(snapshotKey);
    const sameAccount = previous?.credentialKey === account && previous?.channelId === c.id && previous?.sku === remoteSku;
    const snapshot = { sku: remoteSku, productId: p.id, channelId: c.id, credentialKey: account, environment,
      publishedStatus: item.publishedStatus || 'UNVERIFIED', lifecycleStatus: item.lifecycleStatus || '', availability: item.availability || '',
      price: item.price || null, unpublishedReasons: item.unpublishedReasons?.reason || [], wpid: item.wpid || '', checkedAt: stamp(),
      fulfillmentLagTime: sameAccount ? previous.fulfillmentLagTime ?? null : null, fulfillmentCheckedAt: sameAccount ? previous.fulfillmentCheckedAt || '' : '',
      fulfillmentError: sameAccount ? previous.fulfillmentError || '' : '', itemId: '', itemIdMessage: '' };
    const rawId = item.itemId || item.itemid;
    if ((typeof rawId === 'string' || Number.isSafeInteger(rawId)) && /^[1-9][0-9]*$/.test(String(rawId))) snapshot.itemId = String(rawId);
    else if (sameAccount && previous.wpid && previous.wpid === snapshot.wpid && previous.itemId) snapshot.itemId = previous.itemId;
    else {
      try { const ref = await catalogReference(identifier(item), item, jobId); snapshot.itemId = ref.itemId; snapshot.itemIdMessage = ref.referenceMessage || ''; }
      catch (error) { snapshot.itemIdMessage = error.message; }
    }
    // Walmart lag-time reads have a small hourly allowance. Cache this independently of price/status.
    if (includeLag && (!sameAccount || !previous.fulfillmentCheckedAt || Date.now() - Date.parse(previous.fulfillmentCheckedAt) >= 3600000)) {
      try {
        const lag = await client.request(`/v3/lagtime?sku=${encodeURIComponent(remoteSku)}`, { jobId });
        if (lag.sku !== remoteSku) throw fail('Walmart returned lag time for a different seller SKU.');
        snapshot.fulfillmentLagTime = Number.isInteger(lag.fulfillmentLagTime) && lag.fulfillmentLagTime >= 0 ? lag.fulfillmentLagTime : null;
        snapshot.fulfillmentCheckedAt = stamp(); snapshot.fulfillmentError = '';
      } catch (error) { snapshot.fulfillmentError = error.message; }
    }
    await enabled();
    if (account !== await credentialKey() || identity !== await matchIdentity(await product(p.id)) || remoteSku !== await sellerSku(await product(p.id))) throw fail('Walmart account or product identity changed during verification.', 409);
    await write(snapshotKey, snapshot);
    if (environment === 'production' && deps.saveListing) await deps.saveListing(p.id, snapshot);
    const { credentialKey: hidden, ...result } = snapshot;
    result.launchStatus = launchStatus({ ...(p.walmartListing || {}), ...snapshot });
    result.pricingInsights = await pricingFor(p);
    if (includeLag) { try { await queuePricing(); } catch (error) { result.pricingMessage = `Pricing refresh unavailable: ${error.message}`; } }
    return result;
  }
  async function lookupProduct(sku, jobId) {
    const p = await product(sku);
    const identity = await matchIdentity(p);
    const id = identifier(p);
    const result = await client.request(`/v3/items/walmart/search?${new URLSearchParams({ [id.kind]: id.value, responseFormat: 'SPEC' })}`, { jobId });
    if (!result || typeof result !== 'object' || result.errors || (result.items !== undefined && !Array.isArray(result.items))) throw fail('Walmart returned an invalid search response.');
    if ((result.items || []).some(item => !['MP_ITEM_MATCH', 'MP_ITEM'].includes(item.feedType))) throw fail('Walmart returned an unrecognized match result.');
    const reference = await catalogReference(id, result.items?.[0], jobId);
    const selection = await catalogSelection(p);
    const resolved = resolveCatalogCandidate(reference, result.items || [], selection), chosen = resolved.chosen;
    if (selection || result.items?.length > 1 || reference.referenceStatus === 'ambiguous') {
      if (!chosen) {
        const row = { sku: p.sku, productId: p.id, title: p.title || '', identifier: id, status: 'ambiguous', ...reference, candidates: resolved.candidates, checkedAt: stamp() };
        await saveCatalogMatch(p, identity, row);
        return row;
      }
      result.items = [existingMatch(chosen)];
      Object.assign(reference, chosen, { referenceStatus: resolved.candidates.length > 1 ? 'selected' : 'found', selectedCandidate: resolved.candidates.length > 1 ? chosen : undefined, candidates: resolved.candidates });
    }
    const match = result.items?.[0];
    if (match && !['MP_ITEM_MATCH', 'MP_ITEM'].includes(match.feedType)) throw fail('Walmart returned an unrecognized match result.');
    const row = { sku: p.sku, title: p.title || '', identifier: id, status: match?.feedType === 'MP_ITEM_MATCH' ? 'matched' : match ? 'full_setup' : 'not_found', feedType: match?.feedType || '', productType: match?.productType || '', version: match?.version || '', packReviewRequired: Boolean(deps.packSize && deps.packSize(p) > 1), ...reference, checkedAt: stamp() };
    await saveCatalogMatch(p, identity, row);
    return row;
  }
  async function prepare(key, overrides = {}, actor, formOnly = false, inspection = null) {
    await requireVerified();
    const c = await enabled('walmartLaunchEnabled'), s = c.settings;
    const p = inspection?.product || await product(key), db = inspection?.db || await operationalContext();
    const unit = launchGate(p, db, s);
    const requiresIndividualIdentifierReview = Boolean(unit.quantity === 1 && deps.sellingUnits && deps.sourcePackSize?.(p) > 1);
    if (!formOnly && requiresIndividualIdentifierReview && overrides.confirmIndividualIdentifier !== true) throw fail('Confirm the UPC/GTIN identifies one individual selling unit, not the supplier case, before Walmart launch.');
    if (p.walmartListing?.reconciled || (inspection && (p.walmartListing?.sku || p.walmartListing?.feedId))) throw fail('This product is already linked or submitted to Walmart. Verify its listing before launching again.');
    const id = identifier(p), category = String(p.category || p.mainCategory || '').trim();
    const mapping = category ? await read(mappingKey(category)) : null;
    let search = inspection?.search || await client.request(`/v3/items/walmart/search?${new URLSearchParams({ [id.kind]: id.value, responseFormat: 'SPEC' })}`);
    if (!search || typeof search !== 'object' || search.errors || (search.items !== undefined && !Array.isArray(search.items))) throw fail('Walmart returned an invalid identifier match. Review the identifier.');
    const selection = await catalogSelection(p);
    if (selection || search.items?.length > 1) {
      const reference = await catalogReference(id, search.items[0] || existingMatch(selection?.candidate || {}));
      const chosen = resolveCatalogCandidate(reference, search.items, selection).chosen;
      if (!chosen) throw fail(selection ? 'Walmart no longer returns the selected catalog item for this identifier. Run Match on Walmart by UPC again.' : 'Walmart returned multiple identifier matches. Select the correct catalog item in the Walmart product tab before launching.', 409);
      search = { ...search, items: [existingMatch(chosen)] };
    }
    const match = search.items?.[0];
    if (match && !['MP_ITEM_MATCH', 'MP_ITEM'].includes(match.feedType)) throw fail('Walmart returned an unrecognized match result.');
    const feedType = inspection?.newItem ? 'MP_ITEM' : match?.feedType === 'MP_ITEM_MATCH' ? 'MP_ITEM_MATCH' : 'MP_ITEM';
    if (inspection?.existingOnly && feedType !== 'MP_ITEM_MATCH') throw Object.assign(fail('New-item setup required: no existing Walmart offer match.'), { resultStatus: 'not_found' });
    if (!formOnly && unit.quantity > 1 && !unit.policy && overrides.confirmIdentifierPack !== true) throw fail(`This SKU sells ${unit.quantity} units per pack. Confirm that its UPC/GTIN identifies this exact selling pack before launch.`);
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
    const minimumPrice = Number(priceFor(p, db, s, unit.quantity));
    const price = overrides.price === undefined ? minimumPrice : Number(overrides.price);
    if (!Number.isFinite(minimumPrice) || !(minimumPrice > 0) || price < minimumPrice) throw fail(`Price must be at least $${minimumPrice.toFixed(2)} under current Walmart pricing rules.`);
    if (!(price > 0) || !Number.isFinite(price)) throw fail('A valid sell-unit price is required. Review cost and pricing rules.');
    // Identity stays catalog-owned. Explicit launch prices must meet the channel pricing floor.
    Object.assign(offer, { sku: p.sku, productIdentifiers: { productIdType: id.productIdType, productId: id.value }, price });
    delete offer.multipackQuantity;
    if (offer.variantGroupId) throw fail('Walmart supplier sell units cannot be submitted as variation groups.');
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
    if (formOnly) return { sku: p.sku, title: p.title || '', category, feedType, productType, version, price, minimumPrice, identifier: id, payload, schema, errors, packSize: unit.quantity, sellingUnitQty: unit.quantity, requiresIndividualIdentifierReview, environment: s.walmartEnvironment || 'production' };
    const preview = { token: crypto.randomUUID(), actor, productId: p.id, sku: p.sku, category, feedType, productType, version, price, identifier: id, sellingUnitQty: unit.quantity, individualIdentifierConfirmed: overrides.confirmIndividualIdentifier === true, identifierPackConfirmed: overrides.confirmIdentifierPack === true || Boolean(unit.policy && unit.quantity > 1), payload, errors, createdAt: stamp(), expiresAt: Date.now() + 30 * 60000, fingerprint: await launchFingerprint(p, mapping, s, db), channelId: c.id, environment: s.walmartEnvironment || 'production', state: 'preview' };
    await write(`walmart.preview.${preview.token}`, preview);
    log({ channel: 'Walmart', transport: 'Review', method: 'PREVIEW', path: 'launch', operation: 'Walmart launch preview', statusCode: errors.length ? 422 : 200, ok: !errors.length, message: `${p.sku}: ${feedType}; ${errors.length} validation errors.` });
    return preview;
  }
  async function readinessFingerprint(p, dbOverride) {
    const c = await channel(), db = dbOverride || await operationalContext();
    const category = String(p.category || p.mainCategory || '').trim();
    const selection = await catalogSelection(p);
    return digest([p, category ? await read(mappingKey(category)) : null, c, await credentialKey(), db.vendors, (await read('walmart.taxonomy'))?.version, selection?.candidate?.candidateKey || '']);
  }
  async function checkReadiness(key, jobId, options = {}) {
    const c = await enabled();
    const p = await product(key), db = options.db || await operationalContext(), fingerprint = await readinessFingerprint(p, db), identity = await matchIdentity(p);
    if (options.useCache) {
      const saved = await read(`walmart.readiness.${p.id}`);
      if (saved?.expiresAt > Date.now() && saved.fingerprint === fingerprint && (options.allowRemote === false || saved.status !== 'remote_pending')) {
        return { ...saved, cacheHit: true, remoteChecked: false };
      }
    }
    const blocked = error => ({ status: 'blocked', errors: [{ field: '/', message: error.message }] });
    let id, localError;
    try {
      id = identifier(p);
      const unit = launchGate(p, db, c.settings);
      const price = Number(priceFor(p, db, c.settings, unit.quantity));
      if (!Number.isFinite(price) || !(price > 0)) throw fail('A valid Walmart price is required before remote validation.');
    } catch (error) { localError = error; }
    if (localError) {
      const localBlock = blocked(localError);
      const row = { sku: p.sku, productId: p.id, title: p.title || '', identifier: id || null, status: 'blocked', error: localError.message, referenceStatus: 'not_checked', itemId: '', productUrl: '', existingOffer: localBlock, newItem: localBlock, checkedAt: stamp(), expiresAt: Date.now() + 86400000, fingerprint, localOnly: true, remoteChecked: false };
      await write(`walmart.readiness.${p.id}`, row);
      return row;
    }
    let search, reference, lookupError, lookupMeta = {};
    try {
      const allowRemote = options.allowRemote !== false && Date.now() >= readinessRateLimitedUntil;
      const lookup = await readinessLookup(id, jobId, { useCache: options.useCache === true, allowRemote });
      if (lookup.remotePending) {
        const pending = { status: 'unchecked', errors: [{ field: '/identifier', message: 'Remote Walmart validation is pending. Narrow the selection and run readiness again.' }] };
        const row = { sku: p.sku, productId: p.id, title: p.title || '', identifier: id, status: 'remote_pending', referenceStatus: 'not_checked', itemId: '', productUrl: '', existingOffer: pending, newItem: pending, checkedAt: stamp(), expiresAt: Date.now() + 86400000, fingerprint, localOnly: true, cacheHit: false, remoteChecked: false };
        await write(`walmart.readiness.${p.id}`, row);
        return row;
      }
      search = lookup.search;
      reference = lookup.reference;
      lookupMeta = { cacheHit: lookup.cacheHit, remoteChecked: lookup.remoteChecked };
    } catch (error) {
      lookupError = error;
      lookupMeta = { remoteChecked: options.allowRemote !== false };
      if (Number(error.upstreamStatus || 0) === 429) readinessRateLimitedUntil = Date.now() + 15 * 60 * 1000;
    }
    let unresolvedAmbiguity = false;
    const selection = lookupError ? null : await catalogSelection(p);
    if (!lookupError && (selection || search.items.length > 1 || reference.referenceStatus === 'ambiguous')) {
      const resolved = resolveCatalogCandidate(reference, search.items, selection), chosen = resolved.chosen;
      if (chosen) {
        search = { ...search, items: [existingMatch(chosen)] };
        reference = { ...reference, ...chosen, candidates: resolved.candidates, referenceStatus: resolved.candidates.length > 1 ? 'selected' : 'found', selectedCandidate: resolved.candidates.length > 1 ? chosen : undefined };
      } else { reference = { ...reference, candidates: resolved.candidates }; unresolvedAmbiguity = true; }
    }
    const matched = !lookupError && !unresolvedAmbiguity && search.items[0]?.feedType === 'MP_ITEM_MATCH';
    const inspect = async newItem => {
      try {
        // Inspection never writes a preview token and cannot authorize a launch.
        const form = await prepare(p.id, {}, undefined, true, { search: newItem ? { items: [] } : search, newItem, product: p, db });
        const errors = [...form.errors];
        if (form.packSize > 1) errors.push({ field: '/sellingPack', message: `Confirm the identifier represents the exact ${form.packSize}-unit selling pack during launch review.` });
        if (form.requiresIndividualIdentifierReview) errors.push({ field: '/individualIdentifier', message: 'Confirm this identifier represents one individual unit, not the supplier case, in launch review.' });
        return { status: errors.length ? 'blocked' : 'ready', errors, price: form.price, productType: form.productType, version: form.version };
      } catch (error) { return blocked(error); }
    };
    const existingOffer = lookupError ? { ...blocked(lookupError), status: 'error' } : unresolvedAmbiguity ? { status: 'needs_selection', errors: [{ field: '/identifier', message: 'Multiple Walmart catalog items use this identifier. Select the correct item in the Walmart product tab.' }] } : matched ? await inspect(false) : { status: 'not_found', errors: [{ field: '/identifier', message: 'No existing-item offer match was returned by Walmart.' }] };
    const newItem = await inspect(true);
    reference = lookupError ? { itemId: '', productUrl: '', referenceStatus: 'error' } : reference;
    await enabled();
    if (fingerprint !== await readinessFingerprint(await product(p.id), db)) throw fail('Product, mapping, supplier or Walmart settings changed during the check. Check again.', 409);
    const row = { sku: p.sku, productId: p.id, title: p.title || '', identifier: id, status: lookupError ? 'error' : unresolvedAmbiguity ? 'ambiguous' : matched ? 'matched' : search.items.length ? 'full_setup' : 'not_found', ...(lookupError ? { error: lookupError.message } : {}), ...reference, existingOffer, newItem, checkedAt: stamp(), expiresAt: Date.now() + 86400000, fingerprint, ...lookupMeta };
    if (!lookupError) await saveCatalogMatch(p, identity, row);
    await write(`walmart.readiness.${p.id}`, row);
    log({ channel: 'Walmart', transport: 'Review', method: 'CHECK', path: 'readiness', operation: 'Walmart readiness check', statusCode: 200, ok: true, jobId, message: `${p.sku}: existing offer ${existingOffer.status}; new item ${newItem.status}.` });
    return row;
  }
  async function operationPlan(kind, key, shipmentId, dbOverride) {
    const gate = { inventory: 'walmartInventoryEnabled', price: 'walmartPriceEnabled', acknowledge: 'walmartOrderUpdatesEnabled', tracking: 'walmartOrderUpdatesEnabled' }[kind];
    if (!gate && kind !== 'retire') throw fail('Unsupported Walmart operation.');
    const c = await enabled(gate), s = c.settings, db = kind === 'retire' ? dbOverride : dbOverride || await operationalContext();
    let path, body, source;
    if (kind === 'inventory' || kind === 'price' || kind === 'retire') {
      const p = await product(key), remoteSku = await sellerSku(p);
      if (kind === 'retire') {
        await requireVerified();
        if (s.walmartEnvironment === 'sandbox') throw fail('Walmart item retirement is available only in production.');
        if (!p.walmartListing?.sku) throw fail('This product is not linked to a Walmart seller SKU. Refresh or reconcile Walmart listings first.');
      }
      const remote = await client.request(`/v3/items/${encodeURIComponent(remoteSku)}?productIdType=SKU`);
      const item = (remote.ItemResponse || remote.itemResponse || []).find(row => row.sku === remoteSku);
      if (!item) throw fail('Walmart did not return an exact seller SKU. Verify or relink the listing first.');
      if (kind === 'retire') {
        if (String(item.lifecycleStatus || '').toUpperCase() === 'RETIRED') throw fail('This Walmart seller SKU is already retired.', 409);
        path = `/v3/items/${encodeURIComponent(remoteSku)}`;
        source = [p, item, c.id, s.walmartEnvironment || 'production'];
        return { kind, key, productId: p.id, sellerSku: remoteSku, gate: null, path, method: 'DELETE', fingerprint: digest([source, await credentialKey()]), environment: s.walmartEnvironment || 'production', channelId: c.id };
      } else if (kind === 'inventory') {
        if (!s.walmartShipNode) throw fail('Set the Walmart ship node under Rules.');
        const blocked = shippingRestriction(p, s, 'inventory').blocked;
        let unit;
        try { unit = sellingUnit(p, db); }
        catch (error) {
          if (!blocked && inventoryAmount(p, db, s, 1) !== 0) throw error;
          unit = { quantity: 1 };
        }
        const amount = blocked ? 0 : inventoryAmount(p, db, s, unit.quantity);
        if (amount > 0 && verifiedListingUnit(p) !== unit.quantity) throw fail(`Existing Walmart selling unit is unverified. Confirm that the listing represents ${unit.quantity} unit${unit.quantity === 1 ? '' : 's'} before sending positive inventory.`);
        path = `/v3/inventory?${new URLSearchParams({ sku: remoteSku, shipNode: s.walmartShipNode })}`;
        body = { sku: remoteSku, quantity: { unit: 'EACH', amount } };
      } else {
        const unit = launchGate(p, db, s);
        if (verifiedListingUnit(p) !== unit.quantity) throw fail(`Existing Walmart selling unit is unverified. Confirm that the listing represents ${unit.quantity} unit${unit.quantity === 1 ? '' : 's'} before applying pricing.`);
        path = '/v3/price'; body = { sku: remoteSku, pricing: [{ currentPrice: { currency: 'USD', amount: priceFor(p, db, s, unit.quantity) } }] };
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
  async function createOperationPreview(kind, key, shipmentId, actor, options = {}) {
    const plan = await operationPlan(kind, key, shipmentId);
    const reason = String(options.reason || '').trim();
    if (plan.kind === 'retire') {
      if (reason.length < 5 || reason.length > 500) throw fail('Enter a retirement reason between 5 and 500 characters.');
      if (String(options.confirmSku || '').trim() !== plan.sellerSku) throw fail(`Enter the exact Walmart seller SKU (${plan.sellerSku}) to confirm permanent retirement.`);
    }
    const preview = { ...plan, ...(plan.kind === 'retire' ? { reason } : {}), token: crypto.randomUUID(), actor, state: 'preview', expiresAt: Date.now() + 30 * 60000 };
    await write(`walmart.update.${preview.token}`, preview);
    return preview;
  }
  async function applyOperationPreviews(tokens, actor) {
    const normalizedTokens = [...new Set((Array.isArray(tokens) ? tokens : [tokens]).map(value => String(value || '').trim()).filter(Boolean))];
    if (!normalizedTokens.length) throw fail('At least one valid update preview is required.');
    const previews = [];
    for (const token of normalizedTokens) {
      const preview = await read(`walmart.update.${token}`);
      if (!preview || preview.actor !== actor || preview.state !== 'preview' || preview.expiresAt < Date.now()) throw fail('A valid update preview owned by your user is required.');
      previews.push(preview);
    }
    const kinds = [...new Set(previews.map(preview => preview.kind))];
    if (kinds.length !== 1) throw fail('Update previews from different Walmart actions cannot be combined.');
    return queue(kinds[0] === 'retire' ? 'retire' : 'update', normalizedTokens.length === 1 ? { token: normalizedTokens[0], actor } : { tokens: normalizedTokens, actor });
  }
  async function syncTracking(key, shipmentId, jobId) {
    return lock(`tracking:${key}:${shipmentId}`, async () => {
      let plan;
      try {
        plan = await operationPlan('tracking', key, shipmentId);
      } catch (error) {
        if (!/insufficient acknowledged quantity/i.test(String(error?.message || ''))) throw error;
        const acknowledgement = await operationPlan('acknowledge', key);
        await client.request(acknowledgement.path, { method: acknowledgement.method, body: acknowledgement.body, gate: acknowledgement.gate, jobId });
        plan = await operationPlan('tracking', key, shipmentId);
      }
      const response = await client.request(plan.path, { method: plan.method, body: plan.body, gate: plan.gate, jobId });
      log({ channel: 'Walmart', transport: 'HTTP', method: plan.method, path: plan.path, operation: 'Send dropship tracking', statusCode: 200, ok: true, entityType: 'order', entityId: key, jobId, message: 'Walmart accepted the dropship fulfillment and tracking update.' });
      return response;
    });
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
      const latest = await product(key), db = await operationalContext();
      const supplierBlocked = walmartSupplierBlock(latest, db.vendors || []) && retirementPhysicalQty(latest) <= 0;
      if (!productIsMasterInactive(latest) && !productChannelInactive(latest, 'walmart') && !supplierBlocked) throw fail('Product, channel, or supplier was reactivated. Inventory protection requires review.');
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
    return require('./walmart-category-projection').projectWalmartCategories(rows, await mappings(), await categoryReviews(rows.map(row => row.name)));
  }
  async function categoryReviews(categories) {
    if (!postgres.isPostgresEnabled() || !categories.length) return [];
    const result = await postgres.getPool().query("select distinct on (lower(btrim(data->>'category'))) data from walmart_documents where doc_key like 'walmart.category-review.%' and lower(btrim(data->>'category')) = any($1::text[]) order by lower(btrim(data->>'category')), updated_at desc, doc_key desc", [categories.map(value => String(value || '').trim().toLowerCase())]);
    return result.rows.map(row => row.data);
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
      if (operation === 'retire' && Array.isArray(payload.items)) {
        if (!payload.items.length || payload.items.length > 10000) throw fail('Bulk Walmart retirement requires between 1 and 10,000 reviewed items.');
        if (String(payload.reason || '').trim().length < 5 || String(payload.reason || '').trim().length > 500) throw fail('Bulk Walmart retirement requires a reason between 5 and 500 characters.');
        if (!String(payload.actor || '').trim() || !Number.isFinite(Date.parse(payload.approvedAt))) throw fail('Bulk Walmart retirement requires a recorded approval and operator.');
        if (payload.items.some(item => !String(item?.key || '').trim() || !String(item?.sellerSku || '').trim())) throw fail('Every bulk retirement item requires its approved product key and linked seller SKU.');
      }
      await enabled(operation === 'orders' ? 'walmartOrdersEnabled' : operation === 'returns' ? 'walmartReturnsEnabled' : operation === 'webhook' ? 'walmartWebhooksEnabled' : operation === 'settlements' ? 'walmartSettlementImportEnabled' : ['launch', 'existing-launch', 'launch-reconcile'].includes(operation) ? 'walmartLaunchEnabled' : operation === 'reconcile' ? 'walmartLinkExistingEnabled' : operation === 'inventory-sync' ? 'walmartInventoryEnabled' : undefined);
      const workerTask = operation === 'existing-launch' ? 'walmart-bulk-launch' : `walmart-${operation}`;
      if (operation === 'existing-launch') payload = { ...payload, bulkRunId: payload.bulkRunId || crypto.randomUUID() };
      if (operation === 'launch-reconcile') {
        const request = await read(`walmart.launch-reconciliation-request.${payload.bulkRunId}`);
        const requestedJob = request?.jobId ? await postgres.readOperationJob(request.jobId) : null;
        if (requestedJob && !['failed', 'stopped', 'canceled', 'cancelled'].includes(requestedJob.status)) return { duplicate: true, job: requestedJob, message: 'This Walmart launch reconciliation is already queued or complete.' };
      }
      const existing = await findActive(workerTask);
      const sameSelection = existing && (operation === 'launch-reconcile'
        ? existing.workerPayload?.bulkRunId === payload.bulkRunId
        : existing.workerPayload?.actor === payload.actor
          && digest([existing.workerPayload?.readiness, existing.workerPayload?.skus, existing.workerPayload?.allFiltered, existing.workerPayload?.query, existing.workerPayload?.filters])
            === digest([payload.readiness, payload.skus, payload.allFiltered, payload.query, payload.filters]));
      if (existing && ['match', 'reconcile', 'existing-launch'].includes(operation) && !sameSelection && !(operation === 'match' && payload.readiness === true)) throw fail('Another Walmart operation of this type is queued or running. Wait for it to finish before starting a different selection.', 409);
      if (existing && operation === 'launch' && digest([...(existing.workerPayload?.tokens || [existing.workerPayload?.token])].sort()) !== digest([...(payload.tokens || [payload.token])].sort())) throw fail('Another Walmart launch is queued or running. Wait for it to finish before submitting this item.', 409);
      const existingRetirementSelection = existing?.workerPayload?.items?.map(item => [item.key, item.sellerSku]) || existing?.workerPayload?.tokens || [existing?.workerPayload?.token];
      const requestedRetirementSelection = payload.items?.map(item => [item.key, item.sellerSku]) || payload.tokens || [payload.token];
      if (existing && operation === 'retire' && digest(existingRetirementSelection) !== digest(requestedRetirementSelection)) throw fail('Another Walmart item retirement is queued or running. Wait for it to finish before retiring a different item.', 409);
      if (existing && (operation === 'launch-reconcile' ? sameSelection : sameSelection || !(operation === 'match' && payload.readiness === true))) return { duplicate: true, job: existing, message: 'This Walmart operation is already queued or running.' };
      const c = await channel();
      const retirementCount = Array.isArray(payload.items) ? payload.items.length : Array.isArray(payload.tokens) ? payload.tokens.length : operation === 'retire' ? 1 : 0;
      const operationLabel = payload.readiness ? 'Walmart readiness check' : operation === 'feed' ? 'Walmart feed status check' : operation === 'launch-reconcile' ? 'Walmart launch reconciliation' : operation === 'settlements' ? 'Walmart reconciliation report import' : operation === 'returns' ? 'Walmart return import' : operation === 'webhook' ? 'Walmart event processing' : operation === 'retire' && retirementCount > 1 ? 'Walmart bulk item retirement' : operation === 'retire' ? 'Walmart item retirement' : `Walmart ${operation}`;
      const accounting = operation === 'settlements';
      const job = await createJob({ section: accounting ? 'Accounting' : ['orders', 'returns', 'webhook'].includes(operation) ? 'Operations' : 'Products', category: accounting ? 'Channel settlements' : operation === 'orders' ? 'Orders' : operation === 'returns' ? 'Returns' : operation === 'webhook' ? 'Channel events' : 'Channels', operation: operationLabel, direction: ['orders', 'returns', 'settlements'].includes(operation) ? 'import' : 'sync', status: 'queued', phase: 'queued', totalRows: retirementCount || undefined, workerTask, workerPayload: { ...payload, credentialKey: await credentialKey(), channelId: c.id, environment: c.settings.walmartEnvironment || 'production' }, fileName: `walmart-${operation}.ndjson`, message: `${operationLabel} queued${retirementCount ? ` for ${retirementCount} item${retirementCount === 1 ? '' : 's'}` : ''}.` });
      if (operation === 'launch-reconcile') await write(`walmart.launch-reconciliation-request.${payload.bulkRunId}`, { jobId: job.id, bulkRunId: payload.bulkRunId, launchJobId: payload.launchJobId, queuedAt: stamp() });
      if (['existing-launch', 'launch-reconcile', 'pricing'].includes(operation)) await persistJob(job, { queuePriority: operation === 'pricing' ? 25 : 30 });
      if (operation === 'taxonomy') await write('walmart.taxonomyJob', { id: job.id });
      log({ channel: 'Walmart', transport: 'Job', method: 'QUEUE', path: operation, operation: job.operation, statusCode: 202, ok: true, jobId: job.id });
      return { job, message: job.message };
    });
  }
  async function submitLaunch(token, job, check) {
    const payload = job.workerPayload;
    const initial = await read(`walmart.preview.${token}`);
    if (!initial) throw fail('Launch preparation not found.');
    return lock('launch-write', () => lock(`launch-product:${payload.environment}:${initial.productId}`, async () => {
      const preview = await read(`walmart.preview.${token}`);
      if (!preview || preview.errors?.length || preview.expiresAt < Date.now()) throw fail('Launch preview is invalid or expired. Create a new preview.');
      if (preview.state !== 'preview') throw fail(`This preview is ${preview.state}. Reconcile its feed before creating another launch.`);
      const c = await enabled('walmartLaunchEnabled'), p = await product(preview.productId), db = await operationalContext();
      const mapping = preview.category ? await read(mappingKey(preview.category)) : null;
      if (preview.fingerprint !== await launchFingerprint(p, mapping, c.settings, db)) throw fail('Product, supplier selling units, mapping, or channel rules changed. Create a new preview.');
      const intentKey = `walmart.launch-intent.${payload.environment}.${digest(p.id)}`;
      const prior = await read(intentKey);
      if (prior || await read(`walmart.listing.${payload.environment}.${digest(p.id)}`) || (payload.environment === 'production' && (p.walmartListing?.sku || p.walmartListing?.feedId))) throw Object.assign(fail('Already linked, submitted, or awaiting reconciliation. Verify the existing listing/feed.'), { resultStatus: prior?.state === 'submitting' ? 'needs_reconciliation' : 'skipped' });
      launchGate(p, db, c.settings);
      await check();
      const correlationId = crypto.randomUUID();
      // Durable intent precedes the remote mutation; interrupted writes are never blindly replayed.
      await write(`walmart.preview.${token}`, { ...preview, state: 'submitting', correlationId, jobId: job.id });
      await write(intentKey, { state: 'submitting', token, productId: p.id, sku: p.sku, jobId: job.id, correlationId, at: stamp() });
      const response = await client.request(`/v3/feeds?feedType=${preview.feedType}`, { method: 'POST', body: preview.payload, gate: 'walmartLaunchEnabled', jobId: job.id, correlationId });
      if (!response.feedId) throw fail('Walmart returned no feed ID. Acceptance unknown; reconcile before retrying.');
      const submission = { sku: p.sku, productId: p.id, sellingUnitQty: preview.sellingUnitQty, feedId: response.feedId, feedType: preview.feedType, status: 'submitted', jobId: job.id, correlationId, at: stamp() };
      await write(`walmart.preview.${token}`, { ...preview, ...submission, state: 'submitted' });
      await write(`walmart.listing.${payload.environment}.${digest(p.id)}`, submission);
      await write(`walmart.pendingFeed.${digest([payload.environment, response.feedId])}`, { ...submission, environment: payload.environment, nextCheckAt: Date.now() + 15 * 60000, attempts: 0, complete: false });
      if (payload.environment === 'production' && deps.saveListing) await deps.saveListing(p.id, { ...submission, environment: 'production', publishedStatus: 'UNVERIFIED' });
      await write(intentKey, { ...submission, state: 'submitted' });
      return submission;
    }));
  }
  async function prepareBulkOffer(key, sellerExists, request, launchDb) {
    const p = await product(key), c = await enabled('walmartLaunchEnabled');
    const environment = c.settings.walmartEnvironment || 'production';
    const prior = await read(`walmart.launch-intent.${environment}.${digest(p.id)}`);
    if (prior || await read(`walmart.listing.${environment}.${digest(p.id)}`) || p.walmartListing?.sku || p.walmartListing?.feedId || await sellerExists(p.sku)) return { sku: p.sku, status: prior?.state === 'submitting' ? 'needs_reconciliation' : 'skipped', message: 'Seller listing or launch intent already exists.' };
    const db = await launchDb();
    try { launchGate(p, db, c.settings); } catch (error) { error.sku = p.sku; throw error; }
    const id = identifier(p), account = await credentialKey(), identity = await matchIdentity(p);
    const fingerprint = await readinessFingerprint(p, db);
    const assessment = async (status, existingOffer, reference = {}) => {
      if (fingerprint !== await readinessFingerprint(await product(p.id), db)) {
        const error = fail('Product or Walmart settings changed during lookup. Run a fresh readiness check for this SKU.', 409);
        error.bulkRowConflict = true;
        error.sku = p.sku;
        throw error;
      }
      const previous = await read(`walmart.readiness.${p.id}`);
      const row = { sku: p.sku, productId: p.id, identifier: id, status, ...reference, existingOffer, newItem: previous?.fingerprint === fingerprint && previous.expiresAt > Date.now() ? previous.newItem : { status: 'unchecked', errors: [{ field: '/', message: 'New-item requirements have not been checked. Run Check Walmart readiness before creating a new catalog item.' }] }, checkedAt: stamp(), expiresAt: Date.now() + 86400000, fingerprint };
      await saveCatalogMatch(p, identity, row);
      await write(`walmart.readiness.${p.id}`, row);
    };
    const cacheKey = `walmart.bulk.match.${digest([c.id, environment, account, id.value.padStart(14,'0')])}`;
    let cached = await read(cacheKey);
    if (!cached || cached.expiresAt < Date.now()) {
      const data = await request(`/v3/items/walmart/search?${new URLSearchParams({ [id.kind]: id.value, responseFormat: 'DEFAULT' })}`);
      if (!data || typeof data !== 'object' || data.errors || (data.items !== undefined && !Array.isArray(data.items))) throw fail('Invalid Walmart catalog search response.', 502);
      const items = data.items || [];
      cached = { items, checkedAt: stamp(), expiresAt: Date.now() + 86400000 };
      await write(cacheKey, cached);
    }
    if (!cached.items.length) {
      await assessment('not_found', { status: 'not_found', errors: [{ field: '/identifier', message: 'No Walmart catalog match.' }] });
      return { sku: p.sku, status: 'not_found', message: 'New-item setup required: no Walmart catalog match.' };
    }
    const candidates = walmartCandidates(cached.items);
    const selection = await catalogSelection(p);
    const chosen = cached.items.length === 1 ? candidates[0] : selectedCandidate(candidates, selection);
    if (cached.items.length !== 1 && !chosen) {
      await assessment('ambiguous', { status: 'needs_selection', errors: [{ field: '/identifier', message: 'Multiple Walmart catalog items use this identifier. Select the correct item in the Walmart product tab.' }] }, { referenceStatus: 'ambiguous', referenceMessage: `${candidates.length} Walmart catalog items use this identifier. Select the correct item.`, candidates });
      return { sku: p.sku, status: 'blocked', error: 'Multiple Walmart catalog matches require an explicit selection in the Walmart product tab.' };
    }
    const remoteIndex = Math.max(0, candidates.findIndex(candidate => candidate.candidateKey === chosen.candidateKey));
    const remote = cached.items[remoteIndex];
    if (remote.upc || remote.gtin) {
      if (identifier(remote).value.padStart(14,'0') !== id.value.padStart(14,'0')) throw fail('Walmart returned a conflicting product identifier.');
    }
    const version = '4.2';
    const header = { processMode: 'REPLACE', subset: 'EXTERNAL', locale: 'en', sellingChannel: 'mpsetupbymatch', version };
    const match = { feedType: 'MP_ITEM_MATCH', version, itemSpecPayload: { MPItemFeedHeader: header, MPItem: [{ Item: {} }] } };
    const preview = await prepare(p.id, {}, undefined, false, { existingOnly: true, search: { items: [match] }, product: p, db });
    const itemId = chosen.itemId;
    await assessment('matched', { status: preview.errors.length ? 'blocked' : 'ready', errors: preview.errors }, { ...chosen, candidates, selectedCandidate: cached.items.length > 1 ? chosen : undefined, referenceStatus: cached.items.length > 1 ? 'selected' : itemId ? 'found' : 'unavailable' });
    if (preview.errors.length) throw fail(preview.errors.map(e => `${e.field}: ${e.message}`).join('; '));
    return { sku: p.sku, productId: p.id, token: preview.token, status: 'prepared', version, header: preview.payload.MPItemFeedHeader, item: preview.payload.MPItem[0] };
  }
  async function submitBulkOffers(batchKey, rows, request, job, check, launchDb) {
    return lock('launch-write', async () => {
      await check();
      const environment = job.workerPayload.environment;
      let batch = await read(batchKey);
      if (batch?.state === 'submitting') return rows.map(row => batch.results?.[row.productId] || ({ sku: row.sku, status: 'needs_reconciliation', error: 'Feed acceptance is unknown. Reconcile before retrying.', correlationId: batch.correlationId }));
      if (batch?.state !== 'submitted') {
        const accepted = [], results = {};
        for (const row of rows) {
          await check();
          const preview = await read(`walmart.preview.${row.token}`);
          const p = await product(row.productId), c = await enabled('walmartLaunchEnabled');
          const prior = await read(`walmart.launch-intent.${environment}.${digest(p.id)}`);
          if (prior && prior.batchKey !== batchKey || await read(`walmart.listing.${environment}.${digest(p.id)}`) || p.walmartListing?.sku || p.walmartListing?.feedId) { results[p.id] = { sku: p.sku, status: 'skipped', message: 'Already linked or submitted.' }; continue; }
          try {
            const db = await launchDb();
            const mapping = preview?.category ? await read(mappingKey(preview.category)) : null;
            if (!preview || preview.feedType !== 'MP_ITEM_MATCH' || preview.errors?.length || preview.fingerprint !== await launchFingerprint(p, mapping, c.settings, db)) throw fail('Product, supplier or channel settings changed during preparation. Run a fresh launch for this SKU.');
            try { launchGate(p, db, c.settings); } catch (error) { error.sku = p.sku; throw error; }
            accepted.push({ ...row, sku: p.sku, sellingUnitQty: preview.sellingUnitQty, item: preview.payload.MPItem[0] });
          } catch (error) { results[p.id] = { sku: p.sku, status: 'blocked', error: error.message }; }
        }
        if (!accepted.length) return rows.map(row => results[row.productId]);
        const body = { MPItemFeedHeader: rows[0].header, MPItem: accepted.map(row => row.item) };
        if (Buffer.byteLength(JSON.stringify(body)) >= 25 * 1024 * 1024 || accepted.length > 1000) throw fail('Bulk feed exceeds the configured size limit.');
        const errors = validatePayload(await spec('MP_ITEM_MATCH', rows[0].version, ''), body);
        if (errors.length) return rows.map(row => results[row.productId] || { sku: row.sku, status: 'blocked', error: `Bulk schema validation: ${errors.map(e=>e.message).join('; ')}` });
        batch = { state: 'prepared', correlationId: batch?.correlationId || crypto.randomUUID(), accepted, results, environment, jobId: job.id };
        await write(batchKey, batch);
        let response;
        try {
          response = await request('/v3/feeds?feedType=MP_ITEM_MATCH', { method: 'POST', body, gate: 'walmartLaunchEnabled', correlationId: batch.correlationId, beforeSend: async () => {
            await check();
            // All product intents and the feed intent are durable before the network write.
            for (const row of accepted) await write(`walmart.launch-intent.${environment}.${digest(row.productId)}`, { state: 'submitting', batchKey, jobId: job.id, sku: row.sku, productId: row.productId, correlationId: batch.correlationId, at: stamp() });
            batch.state = 'submitting'; await write(batchKey, batch);
          } });
          if (!response.feedId) throw fail('Walmart returned no feed ID; acceptance is unknown.');
        } catch (error) {
          if (error.bulkPause) {
            if (error.rejected) { batch.state = 'throttled'; await write(batchKey, batch); }
            throw error;
          }
          if (error.statusCode === 499) throw error;
          return rows.map(row => results[row.productId] || { sku: row.sku, status: 'needs_reconciliation', error: error.message, correlationId: batch.correlationId });
        }
        batch = { ...batch, state: 'submitted', feedId: response.feedId, submittedAt: stamp() };
        await write(batchKey, batch);
      }
      // A restart after acceptance only repeats local persistence, never the Walmart POST.
      for (const row of batch.accepted) {
        await check();
        const submission = { sku: row.sku, productId: row.productId, sellingUnitQty: row.sellingUnitQty, feedId: batch.feedId, feedType: 'MP_ITEM_MATCH', status: 'submitted', jobId: job.id, batchKey, correlationId: batch.correlationId, at: batch.submittedAt };
        await write(`walmart.listing.${environment}.${digest(row.productId)}`, submission);
        await write(`walmart.launch-intent.${environment}.${digest(row.productId)}`, { ...submission, state: 'submitted' });
        if (environment === 'production' && deps.saveListing) await deps.saveListing(row.productId, { ...submission, environment, publishedStatus: 'UNVERIFIED' });
        batch.results[row.productId] = submission;
      }
      await write(`walmart.pendingFeed.${digest([environment, batch.feedId])}`, { feedId: batch.feedId, environment, nextCheckAt: Date.now() + 15 * 60000, attempts: 0, complete: false, bulk: true, credentialKey: job.workerPayload.credentialKey, channelId: job.workerPayload.channelId });
      return rows.map(row => batch.results[row.productId]);
    });
  }
  async function retryBulkRejectedOffers(rows, context, job, check, request) {
    const { classifyIngestion } = require('./walmart-launch-reconciliation');
    const groups = new Map();
    for (const row of rows) {
      await check();
      const p = await product(row.productId);
      const listing = p.walmartListing || {};
      if (p.sku !== row.sku || listing.feedId !== row.feedId || !classifyIngestion(listing).retryable || listing.automaticRetryAt) continue;
      const key = digest([row.version, row.header]);
      if (!groups.has(key)) groups.set(key, { version: row.version, header: row.header, rows: [] });
      groups.get(key).rows.push(row);
    }
    const retried = [];
    for (const group of groups.values()) {
      for (let offset = 0; offset < group.rows.length; offset += 1000) {
        const chunk = group.rows.slice(offset, offset + 1000);
        const body = { MPItemFeedHeader: group.header, MPItem: chunk.map(row => row.item) };
        const errors = validatePayload(await spec('MP_ITEM_MATCH', group.version, ''), body);
        if (errors.length) throw fail(`Automatic retry payload is no longer valid: ${errors.map(error => error.message).join('; ')}`);
        const correlationId = crypto.randomUUID();
        const response = await request('/v3/feeds?feedType=MP_ITEM_MATCH', { method: 'POST', body, gate: 'walmartLaunchEnabled', correlationId });
        if (!response.feedId) throw fail('Walmart returned no feed ID for the controlled retry; acceptance is unknown.');
        const automaticRetryAt = stamp();
        await write(`walmart.pendingFeed.${digest([job.workerPayload.environment, response.feedId])}`, { feedId: response.feedId, environment: job.workerPayload.environment, nextCheckAt: Date.now() + 15 * 60000, attempts: 0, complete: false, bulk: true, bulkRunId: context.runId, launchReconciliationJobId: job.id, credentialKey: job.workerPayload.credentialKey, channelId: job.workerPayload.channelId });
        for (const row of chunk) {
          const submission = { sku: row.sku, productId: row.productId, sellingUnitQty: row.sellingUnitQty, feedId: response.feedId, feedType: 'MP_ITEM_MATCH', status: 'submitted', jobId: job.id, batchKey: row.batchKey, correlationId, at: automaticRetryAt, automaticRetryAt, retrySourceFeedId: row.feedId, reconciliationJobId: context.reconciliationJobId };
          await write(`walmart.listing.${job.workerPayload.environment}.${digest(row.productId)}`, submission);
          await write(`walmart.launch-intent.${job.workerPayload.environment}.${digest(row.productId)}`, { ...submission, state: 'submitted' });
          if (deps.saveListing) await deps.saveListing(row.productId, { ...submission, environment: 'production', publishedStatus: 'UNVERIFIED', ingestionStatus: 'RECEIVED', ingestionErrors: [] });
          retried.push(submission);
        }
      }
    }
    return retried;
  }
  async function run(job) {
    const payload = job.workerPayload || {}, operation = job.workerTask === 'walmart-bulk-launch' ? 'existing-launch' : job.workerTask.replace('walmart-', '');
    const report = path.join(artifactsDir, `${job.id}-walmart.ndjson`);
    fs.mkdirSync(artifactsDir, { recursive: true });
    let processed = 0, failed = 0, pending = false;
    const record = row => { fs.appendFileSync(report, JSON.stringify({ ...row, at: stamp() }) + '\n'); processed++; if (row.error) failed++; };
    const check = async () => {
      if (payload.credentialKey && payload.credentialKey !== await credentialKey()) throw fail('Walmart credentials changed after this job was queued. Review and queue it again.');
      const current = await postgres.readOperationJob(job.id);
      if (['stopping', 'stopped', 'canceled', 'cancelled'].includes(current?.status)) throw fail('Job stopped.', 499);
      if (['launch', 'existing-launch', 'launch-reconcile'].includes(operation)) await requireVerified();
      const c = await enabled(operation === 'orders' ? 'walmartOrdersEnabled' : operation === 'returns' ? 'walmartReturnsEnabled' : operation === 'webhook' ? 'walmartWebhooksEnabled' : operation === 'settlements' ? 'walmartSettlementImportEnabled' : ['launch', 'existing-launch', 'launch-reconcile'].includes(operation) ? 'walmartLaunchEnabled' : operation === 'reconcile' ? 'walmartLinkExistingEnabled' : operation === 'inventory-sync' ? 'walmartInventoryEnabled' : undefined);
      if (c.id !== payload.channelId || (c.settings.walmartEnvironment || 'production') !== payload.environment) throw fail('Walmart channel/environment changed after queuing. Queue a new job.');
    };
    await persistJob(job, { status: 'running', startedAt: stamp(), phase: operation, originalFilePath: report, originalFileName: `walmart-${operation}.ndjson` });
    try {
      await check();
      if (operation === 'existing-launch') {
        const { runBulkLaunch, createBulkRequester } = require('./walmart-bulk-launch');
        const request = createBulkRequester({ client, read, write, lock, account: [payload.channelId, payload.environment, payload.credentialKey], check, jobId: job.id });
        let launchDbPromise;
        const launchDb = () => launchDbPromise ||= operationalContext();
        await runBulkLaunch({ job, read, write, check, record, request,
          identity: digest([payload.channelId, payload.environment, payload.credentialKey, payload.actor, payload.skus, payload.allFiltered, payload.query, payload.filters]),
          persist: patch => persistJob(job, patch),
          selectionPage: async page => payload.allFiltered ? deps.matchSelectionPage(payload, page + 1) : { keys: payload.skus.slice(page * 500, (page + 1) * 500), hasMore: (page + 1) * 500 < payload.skus.length },
          prepare: (key, sellerExists, req) => prepareBulkOffer(key, sellerExists, req, launchDb),
          submit: (key, rows, req) => submitBulkOffers(key, rows, req, job, check, launchDb),
          onComplete: state => state.outcomes.submitted ? queue('launch-reconcile', { bulkRunId: state.runId, launchJobId: job.id, actor: payload.actor, retryAttempt: true }) : null });
        return;
      } else if (operation === 'launch-reconcile') {
        const { runLaunchReconciliation } = require('./walmart-launch-reconciliation');
        const { createBulkRequester } = require('./walmart-bulk-launch');
        const request = createBulkRequester({ client, read, write, lock, account: [payload.channelId, payload.environment, payload.credentialKey], check, jobId: job.id });
        await runLaunchReconciliation({ job, pool: postgres.getPool(), read, write, check, record,
          persist: patch => persistJob(job, patch),
          getReportRows: () => require('./walmart-item-report').itemReport({ client, job, read, write, check, persist: patch => persistJob(job, patch) }),
          retry: (rows, context) => retryBulkRejectedOffers(rows, context, job, check, request),
          saveVerified: async (row, remote) => {
            const snapshot = { ...remote, sku: row.sku, productId: row.productId, channelId: payload.channelId, credentialKey: payload.credentialKey, environment: 'production', reconciled: true, source: 'launch-reconciliation', launchReconciliationJobId: job.id, checkedAt: stamp() };
            await write(`walmart.listing-status.production.${digest(row.productId)}`, snapshot);
            if (deps.saveListing) await deps.saveListing(row.productId, snapshot);
          },
          queueInventory: async keys => {
            try { return await queue('inventory-sync', { keys, actor: 'system:walmart-launch-reconciliation', sourceJobId: job.id, bulkRunId: payload.bulkRunId }); }
            catch (error) { if (error.statusCode === 409) return { message: error.message }; throw error; }
          } });
        return;
      } else if (operation === 'pricing') {
        await require('./walmart-pricing').runPricing({ job, client, read, write, lock, check, persist: patch => persistJob(job, patch) });
        return;
      } else if (operation === 'reconcile') {
        try { await queuePricing(); } catch (error) { record({ status: 'pricing_unavailable', message: error.message }); }
        const reportRows = await require('./walmart-item-report').itemReport({ client, job, read, write, check, persist: patch => persistJob(job, patch) });
        const result = await require('./walmart-reconciliation').runReconciliation({ reportRows, client, job, write, read, check, persist: patch => persistJob(job, patch), record, pool: postgres.getPool(), invalidate: deps.invalidateListings });
        failed = result.review;
        await persistJob(job, { status: failed ? 'warning' : 'success', phase: 'complete', finishedAt: stamp(), processedRows: processed, totalRows: processed, missingCount: failed, progressPercent: 100, message: result.message });
        return;
      } else if (operation === 'webhook') {
        if (payload.environment !== 'production') throw fail('Operational Walmart webhooks require production.');
        let matched = 0, unmatched = 0, eventFailures = 0;
        for (;;) {
          await check();
          const pendingEvents = await postgres.getPool().query(`select doc_key,data from walmart_documents where data->>'kind'='event' and data->>'status'='pending' and data->>'environment'=$1 and data->>'channelId'=$2 and data->>'credentialKey'=$3 and coalesce(nullif(data->>'nextAttemptAt','')::timestamptz,now())<=now() order by updated_at limit 100`, [payload.environment, payload.channelId, payload.credentialKey]);
          if (!pendingEvents.rows.length) break;
          for (const row of pendingEvents.rows) {
            await check();
            const event = row.data || {};
            try {
              if (event.eventType === 'ORDER_UPDATES' || ['PO_CREATED', 'PO_LINE_AUTOCANCELLED', 'INTENT_TO_CANCEL', 'FRAUD_CANCEL'].includes(event.eventType)) {
                if (!event.purchaseOrderIds?.length) throw fail('Walmart order event contained no purchase order ID.');
                for (const purchaseOrderId of event.purchaseOrderIds) {
                  const response = await client.request(`/v3/orders/${encodeURIComponent(purchaseOrderId)}`, { gate: 'walmartOrdersEnabled', jobId: job.id });
                  const raw = response.order || response;
                  if (String(raw.purchaseOrderId || '').trim() !== purchaseOrderId) throw fail('Walmart returned a different purchase order for an event.');
                  const exists = await postgres.readChannelOrderForReturn('Walmart', { orderId: purchaseOrderId, existsOnly: true });
                  await saveIncomingOrder(mapOrder(raw), { existingRefresh: exists });
                  await saveWalmartOrderEvent(purchaseOrderId, event);
                  matched++;
                }
              } else if (String(event.eventType || '').startsWith('RETURN_')) {
                const returnRows = [...(event.returnRows || [])];
                for (const returnOrderId of event.returnOrderIds || []) {
                  const response = await client.request(`/v3/returns?${new URLSearchParams({ returnOrderId, replacementInfo: 'true' })}`, { gate: 'walmartReturnsEnabled', jobId: job.id });
                  returnRows.push(...walmartReturnRows(response));
                }
                const uniqueReturns = [...new Map(returnRows.map(raw => [String(raw.returnOrderId || ''), raw]).filter(([id]) => id)).values()];
                if (!uniqueReturns.length) throw fail('Walmart return event contained no retrievable return order.');
                for (const raw of uniqueReturns) {
                  const result = await saveWalmartReturn(raw);
                  if (result.order) matched++; else unmatched++;
                }
              }
              const { payload: rawPayload, ...metadata } = event;
              await write(row.doc_key, { ...metadata, status: 'processed', processedAt: stamp(), nextAttemptAt: '', attempts: Number(event.attempts || 0) + 1 });
              record({ eventId: event.eventId, eventType: event.eventType, status: 'processed' });
            } catch (error) {
              eventFailures++;
              const { payload: rawPayload, ...metadata } = event;
              const attempts = Number(event.attempts || 0) + 1;
              const terminal = attempts >= 5;
              const retryDelayMinutes = [1, 5, 15, 45][Math.min(attempts - 1, 3)];
              await write(row.doc_key, { ...metadata, status: terminal ? 'failed' : 'pending', failedAt: terminal ? stamp() : '', nextAttemptAt: terminal ? '' : new Date(Date.now() + retryDelayMinutes * 60000).toISOString(), attempts, error: error.message });
              record({ eventId: event.eventId, eventType: event.eventType, status: terminal ? 'failed' : 'retry_scheduled', attempts, error: error.message });
            }
          }
          await persistJob(job, { processedRows: processed, changed: matched, missingCount: unmatched + eventFailures, message: `${processed} Walmart events processed; ${matched} records refreshed; ${unmatched} returns unmatched; ${eventFailures} failed.` });
        }
        if (typeof deps.invalidateOrders === 'function') await deps.invalidateOrders();
        await persistJob(job, { status: eventFailures || unmatched ? 'warning' : 'success', phase: 'complete', finishedAt: stamp(), processedRows: processed, totalRows: processed, changed: matched, missingCount: unmatched + eventFailures, progressPercent: 100, message: `${processed} Walmart events processed; ${matched} records refreshed; ${unmatched} returns unmatched; ${eventFailures} failed.` });
        return;
      } else if (operation === 'returns') {
        if (payload.environment !== 'production') throw fail('Operational Walmart return imports require production.');
        let next = `/v3/returns?${new URLSearchParams({ returnLastModifiedStartDate: payload.startDate, returnLastModifiedEndDate: payload.endDate, replacementInfo: 'true', limit: '200' })}`;
        const seen = new Set();
        let matched = 0, unmatched = 0;
        await persistJob(job, { phase: 'fetching_returns', message: 'Fetching Walmart returns and matching them to imported order lines.' });
        while (next) {
          await check();
          if (seen.has(next)) throw fail('Walmart repeated a return cursor; import stopped to avoid a loop.');
          seen.add(next);
          const response = await client.request(next, { gate: 'walmartReturnsEnabled', jobId: job.id });
          const rows = walmartReturnRows(response);
          for (const raw of rows) {
            await check();
            try {
              const result = await saveWalmartReturn(raw);
              if (result.order) matched++; else unmatched++;
              record({ returnId: result.saved.channelReturnId, purchaseOrderId: result.purchaseOrderId, customerOrderId: result.customerOrderId, orderId: result.order?.id || null, status: result.order ? 'matched' : 'unmatched' });
            } catch (error) { record({ returnId: raw.returnOrderId, error: error.message }); }
          }
          const cursor = walmartReturnNextCursor(response);
          next = cursor ? `/v3/returns${cursor}` : '';
          await persistJob(job, { processedRows: processed, changed: matched, missingCount: failed + unmatched, message: `${processed} Walmart returns processed; ${matched} matched, ${unmatched} unmatched, ${failed} failed.` });
        }
        if (typeof deps.invalidateOrders === 'function') await deps.invalidateOrders();
        await persistJob(job, { status: failed || unmatched ? 'warning' : 'success', phase: 'complete', finishedAt: stamp(), processedRows: processed, totalRows: processed, changed: matched, missingCount: failed + unmatched, progressPercent: 100, message: `${processed} Walmart returns processed; ${matched} matched, ${unmatched} unmatched, ${failed} failed.` });
        return;
      } else if (operation === 'settlements') {
        if (!deps.feeStore || !deps.settlementScope) throw fail('Walmart settlement storage is unavailable.', 503);
        const { isoDate, walmartReportFiles, walmartPayoutSummary, walmartFeeRows } = require('./channel-settlement-sync');
        const reportHeaders = { WM_GLOBAL_VERSION: '3.1', WM_MARKET: 'us' };
        const available = await client.request('/v3/report/reconreport/availableReconFiles?reportVersion=v1', { jobId: job.id, headers: reportHeaders });
        let paymentStatement = null;
        try {
          paymentStatement = await client.request('/v3/report/payment/statement', { jobId: job.id, headers: reportHeaders });
        } catch (error) {
          await persistJob(job, { message: `Walmart report dates loaded. Current payment statement was unavailable: ${error.message}` });
        }
        const cutoff = Date.now() - Math.max(7, Math.min(90, Number(payload.lookbackDays || 45) || 45)) * 86400000;
        const dates = walmartReportFiles(available).filter(file => {
          const parsed = Date.parse(`${file.isoDate}T00:00:00Z`);
          return Number.isFinite(parsed) && parsed >= cutoff;
        });
        await persistJob(job, { phase: 'importing_reconciliation_reports', totalRows: dates.length, message: `${dates.length} recent Walmart reconciliation report${dates.length === 1 ? '' : 's'} available.` });
        let imported = 0, enriched = 0, duplicates = 0, matched = 0, unmatched = 0;
        for (const reportFile of dates) {
          await check();
          const reportDate = reportFile.reportDate;
          let offset = 0; const reportRows = [], seenOffsets = new Set();
          for (;;) {
            if (seenOffsets.has(offset)) throw fail(`Walmart repeated offset ${offset} for reconciliation report ${reportDate}.`, 502);
            seenOffsets.add(offset);
            const data = await client.request(`/v3/report/reconreport/reconFileJson?${new URLSearchParams({ reportDate, offset: String(offset), noOfRecords: '1000', reportVersion: 'v1' })}`, { jobId: job.id, headers: reportHeaders });
            const page = Array.isArray(data.reportData) ? data.reportData : [];
            reportRows.push(...page);
            const nextOffset = Number(data.nextOffset);
            if (!page.length || !Number.isFinite(nextOffset) || nextOffset <= offset) break;
            offset = nextOffset;
          }
          for (const row of reportRows) record({ reportDate, ...row });
          const payout = walmartPayoutSummary(reportRows, reportFile, paymentStatement || {});
          const rows = walmartFeeRows(reportRows).map(row => ({ ...row, payoutId: reportFile.canonicalDate }));
          const result = await deps.feeStore.importApiSettlement(deps.settlementScope, {
            channel: 'Walmart', externalSettlementId: reportFile.canonicalDate, currency: reportRows.find(row => row.Currency)?.Currency || 'USD',
            periodStart: isoDate(reportRows.find(row => row['Period Start Date'])?.['Period Start Date']),
            periodEnd: isoDate(reportRows.find(row => row['Period End Date'])?.['Period End Date']),
            payoutAmount: payout.payoutAmount, payoutDate: payout.payoutDate, payoutStatus: payout.payoutStatus,
            bankReference: payout.bankReference, payoutMemo: payout.payoutMemo, payoutInstrument: payout.payoutInstrument,
            transactionCount: payout.transactionCount, sourceApiReference: `/v3/report/reconreport/reconFileJson?reportDate=${reportDate}`,
            fileName: `walmart-reconciliation-${reportFile.canonicalDate}.json`, rows,
            raw: { ...payout.raw, reportDate, canonicalReportDate: reportFile.canonicalDate, sourceRows: reportRows.length, feeLines: rows.length }
          });
          if (result.duplicate) duplicates += 1;
          else {
            if (result.enriched) enriched += 1; else imported += 1;
            matched += result.matched; unmatched += result.unmatched;
          }
          await persistJob(job, { processedRows: imported + enriched + duplicates, changed: imported + enriched, missingCount: unmatched, progressPercent: Math.round((imported + enriched + duplicates) / Math.max(1, dates.length) * 100), message: `${imported + enriched + duplicates}/${dates.length} reports checked; ${imported} imported; ${enriched} enriched; ${duplicates} unchanged; ${unmatched} fee lines need review.` });
        }
        const finishedAt = stamp(), message = `${dates.length} Walmart reconciliation reports checked; ${imported} imported; ${enriched} enriched; ${duplicates} unchanged; ${matched} fee lines matched; ${unmatched} need review.`;
        await persistJob(job, { status: unmatched ? 'warning' : 'success', phase: 'complete', finishedAt, processedRows: dates.length, totalRows: dates.length, changed: imported + enriched, missingCount: unmatched, progressPercent: 100, message });
        const schedules = await postgres.readStateField('channelSettlementSchedules').catch(() => ({})) || {};
        await postgres.writeStateDocuments({ channelSettlementSchedules: { ...schedules, walmart: { ...(schedules.walmart || {}), enabled: true, cadence: 'Daily report discovery', scheduleTime: '06:30', timezone: 'America/New_York', lastCompletedAt: finishedAt, lastJobId: job.id, lastStatus: unmatched ? 'warning' : 'success', lastMessage: message, lastError: '' } } });
        return;
      } else if (operation === 'orders') {
        let imported = 0, refreshed = 0, skipped = 0;
        const progress = () => persistJob(job, { processedRows: processed, created: imported, changed: imported + refreshed, missingCount: failed, lastProgressAt: stamp(), message: `${processed} checked; ${imported} new orders imported; ${refreshed} existing orders refreshed; ${skipped} sandbox orders validated; ${failed} need attention.` });
        await persistJob(job, { phase: 'fetching_orders', message: 'Fetching Walmart orders and reconciling existing order statuses.' });
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
            try {
              const id = String(raw.purchaseOrderId || '').trim();
              if (!id) throw fail('Walmart order is missing its purchase order ID.');
              const exists = payload.environment === 'production'
                && await postgres.readChannelOrderForReturn('Walmart', { orderId: id, existsOnly: true });
              const order = payload.historicalBackfill ? historicalOrder(mapOrder(raw), job.id) : mapOrder(raw);
              if (payload.environment === 'production') {
                if (payload.historicalBackfill && exists) skipped++;
                else {
                  await saveIncomingOrder(order, { existingRefresh: exists, historicalBackfill: payload.historicalBackfill === true });
                  if (exists) refreshed++; else imported++;
                }
              } else skipped++;
              record({ orderId: id, status: payload.environment === 'production' ? payload.historicalBackfill && exists ? 'already_imported' : exists ? 'refreshed' : 'imported' : 'sandbox_validated_not_imported' });
            }
            catch (error) { record({ orderId: raw.purchaseOrderId, error: error.message }); }
            await progress();
          }
          const cursor = response.list.meta?.nextCursor;
          if (cursor && !String(cursor).startsWith('?')) throw fail('Unexpected Walmart order cursor format.');
          if (cursor) { const params = new URLSearchParams(cursor.slice(1)); params.set('shipNodeType', 'SellerFulfilled'); next = `/v3/orders?${params}`; } else next = '';
          await progress();
        }
        if (payload.reconcileExisting && !payload.historicalBackfill && payload.environment === 'production') {
          const candidates = await walmartStatusReconciliationCandidatesFromDatabase(postgres.getPool(), { lookbackDays: 90 });
          const cursorKey = `walmart.orderStatusSweep.${digest([payload.channelId, payload.environment, payload.credentialKey])}`;
          const priorSweep = await read(cursorKey) || {};
          const offset = candidates.length ? Math.max(0, Number(priorSweep.offset || 0) || 0) % candidates.length : 0;
          const count = Math.min(100, candidates.length);
          const selected = Array.from({ length: count }, (_, index) => candidates[(offset + index) % candidates.length]);
          for (const id of selected) {
            await check();
            try {
              const response = await client.request(`/v3/orders/${encodeURIComponent(id)}`, { gate: 'walmartOrdersEnabled', jobId: job.id });
              const raw = response.order || response;
              if (String(raw.purchaseOrderId || '').trim() !== id) throw fail('Walmart returned a different purchase order during status reconciliation.');
              await saveIncomingOrder(mapOrder(raw), { existingRefresh: true });
              refreshed++;
              record({ orderId: id, status: 'status_refreshed' });
            } catch (error) {
              record({ orderId: id, status: 'status_refresh_failed', error: error.message });
            }
            await progress();
          }
          await write(cursorKey, { offset: candidates.length ? (offset + count) % candidates.length : 0, candidateCount: candidates.length, checkedAt: stamp(), jobId: job.id });
        }
        await check();
        if (!failed && payload.scheduled && payload.environment === 'production' && Number.isFinite(Date.parse(payload.endDate))) {
          await write(`walmart.orderIntake.${digest([payload.channelId, payload.environment, payload.credentialKey])}`, { completedThrough: payload.endDate, jobId: job.id });
        }
        await persistJob(job, { status: failed ? 'warning' : 'success', phase: 'complete', finishedAt: stamp(), processedRows: processed, totalRows: processed, created: imported, changed: imported + refreshed, missingCount: failed, progressPercent: 100, message: `${processed} checked; ${imported} new orders imported; ${refreshed} existing orders refreshed; ${skipped} sandbox orders validated; ${failed} need attention.` });
        return;
      } else if (operation === 'taxonomy') {
        const s = await settings();
        const requestedVersion = s.walmartSpecVersion || '5.0';
        const data = await client.request(`/v3/items/taxonomy?${new URLSearchParams({ feedType: 'MP_ITEM', version: requestedVersion })}`, { jobId: job.id });
        const rows = taxonomyRows(data);
        if (!rows.length) throw fail('Walmart returned an empty taxonomy; the saved taxonomy was preserved.');
        await check();
        await write('walmart.taxonomy', { version: String(data.version || requestedVersion), rows, updatedAt: stamp() });
        for (const row of rows) record(row);
      } else if (operation === 'inventory-sync') {
        let after = String(payload.inventoryAfter || ''), inventoryDb = null;
        let sent = Math.max(0, Number(payload.inventoryAccepted || 0) || 0);
        let blocked = Math.max(0, Number(payload.inventoryBlocked || 0) || 0);
        let keyOffset = Math.max(0, Number(payload.inventoryKeyOffset || 0) || 0);
        const configured = await settings();
        const targetedKeys = Array.isArray(payload.keys) ? [...new Set(payload.keys.map(String).filter(Boolean))].slice(0, 10000) : null;
        for (;;) {
          await check();
          const page = targetedKeys
            ? { keys: targetedKeys.slice(keyOffset, keyOffset + 100), hasMore: keyOffset + 100 < targetedKeys.length }
            : await deps.listWalmartPublishedProductKeys({ after, limit: 100 });
          if (!page.keys.length) break;
          inventoryDb = await operationalContext();
          const pageStartOffset = keyOffset;
          for (let index = 0; index < page.keys.length; index++) {
            await check();
            const key = page.keys[index];
            try {
              const plan = await operationPlan('inventory', key, undefined, inventoryDb);
              const response = await client.request(plan.path, { method: plan.method, body: plan.body, gate: plan.gate, jobId: job.id });
              if (response.sku !== plan.body.sku || Number(response.quantity?.amount) !== plan.body.quantity.amount) throw fail('Walmart did not confirm the requested inventory. Reconcile before retrying.');
              sent++;
              record({ sku: plan.body.sku, productId: key, quantity: plan.body.quantity.amount, shipNode: configured.walmartShipNode, status: 'accepted' });
            } catch (error) {
              if (error.statusCode === 499) throw error;
              blocked++;
              record({ productId: key, status: 'blocked', error: error.message });
            }
            if (targetedKeys) keyOffset = pageStartOffset + index + 1;
            else after = key;
            Object.assign(payload, {
              inventoryAfter: after,
              inventoryKeyOffset: keyOffset,
              inventoryAccepted: sent,
              inventoryBlocked: blocked
            });
            await persistJob(job, {
              phase: 'sync-inventory',
              workerPayload: payload,
              processedRows: sent + blocked,
              totalRows: sent + blocked,
              progressPercent: 0,
              lastProgressAt: stamp(),
              message: `${sent} inventory updates accepted; ${blocked} need attention. Progress checkpoint saved.`
            });
            await new Promise(resolve => setTimeout(resolve, 150));
          }
          inventoryDb = null;
          if (!page.hasMore) break;
        }
        failed = blocked;
        await persistJob(job, { status: blocked ? 'warning' : 'success', phase: 'complete', finishedAt: stamp(), processedRows: sent + blocked, totalRows: sent + blocked, missingCount: blocked, progressPercent: 100, workerPayload: { ...payload, inventoryComplete: true }, message: `${sent} Walmart inventory updates accepted; ${blocked} need attention.` });
        return;
      } else if (operation === 'update' || operation === 'retire') {
        const directItems = operation === 'retire' && Array.isArray(payload.items) ? payload.items : [];
        const work = directItems.length ? directItems.map(item => ({ item })) : (payload.tokens || [payload.token]).map(token => ({ token }));
        const saveRetirement = async (plan, response, actor, reason) => {
          const retiredAt = stamp();
          const retirement = { sku: plan.sellerSku, productId: plan.productId, channelId: plan.channelId, environment: plan.environment, status: 'retired', publishedStatus: 'RETIRED', lifecycleStatus: 'RETIRED', availability: 'NOT_AVAILABLE', retiredAt, retiredBy: actor, retireReason: reason, retireJobId: job.id, checkedAt: retiredAt, responseMessage: String(response.message || response.Message || '').slice(0, 500) };
          await write(`walmart.retirement.${plan.environment}.${digest(plan.productId)}`, retirement);
          await write(`walmart.listing-status.${plan.environment}.${digest(plan.productId)}`, { ...retirement, credentialKey: await credentialKey() });
          if (plan.environment === 'production' && deps.saveListing) await deps.saveListing(plan.productId, retirement);
        };
        await persistJob(job, { totalRows: work.length, processedRows: 0, phase: operation === 'retire' ? 'retiring-items' : 'applying-update' });
        for (const entry of work) {
          await check();
          try {
            await lock(directItems.length ? `retire-product:${entry.item.key}` : `update:${entry.token}`, async () => {
              if (directItems.length) {
                const plan = await operationPlan('retire', entry.item.key);
                if (plan.sellerSku !== entry.item.sellerSku) throw fail('The linked Walmart seller SKU changed after approval. Review this item again.');
                await check();
                const response = await client.request(plan.path, { method: plan.method, jobId: job.id });
                await saveRetirement(plan, response, payload.actor, payload.reason);
                record({ operation: 'retire', key: plan.key, sku: plan.sellerSku, status: 'accepted' });
                return;
              }
              const preview = await read(`walmart.update.${entry.token}`);
              if (!preview || preview.state !== 'preview' || preview.expiresAt < Date.now()) throw fail('Update preview is expired or already used. Reconcile before retrying.');
              const plan = await operationPlan(preview.kind, preview.key, preview.shipmentId);
              if (plan.fingerprint !== preview.fingerprint) throw fail('Order, stock, or rules changed. Create a new preview.');
              await check();
              await write(`walmart.update.${entry.token}`, { ...preview, state: 'submitting', jobId: job.id });
              const response = await client.request(plan.path, { method: plan.method, body: plan.body, gate: plan.gate, jobId: job.id });
              if (plan.kind === 'price' && response.ItemPriceResponse?.sku !== plan.body.sku) throw fail('Walmart did not confirm the price SKU. Reconcile before retrying.');
              if (plan.kind === 'inventory' && (response.sku !== plan.body.sku || Number(response.quantity?.amount) !== plan.body.quantity.amount)) throw fail('Walmart did not confirm the requested inventory. Reconcile before retrying.');
              if (['acknowledge','tracking'].includes(plan.kind)) await saveIncomingOrder(mapOrder(response.order || response));
              if (plan.kind === 'retire') await saveRetirement(plan, response, preview.actor, preview.reason);
              await write(`walmart.update.${entry.token}`, { ...preview, state: 'accepted', jobId: job.id });
              record({ operation: plan.kind, key: plan.key, status: 'accepted' });
            });
          } catch (error) {
            if (error.statusCode === 499) throw error;
            failed++;
            record({ token: entry.token, key: entry.item?.key, sku: entry.item?.sellerSku, status: 'failed', error: error.message });
          }
          await persistJob(job, { processedRows: processed, totalRows: work.length, missingCount: failed, progressPercent: Number((processed / Math.max(work.length, 1) * 100).toFixed(2)), message: `${processed - failed}/${work.length} Walmart item${work.length === 1 ? '' : 's'} retired; ${failed} need attention.` });
        }
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
        const readinessDb = payload.readiness ? await operationalContext() : null;
        let rows = [], matchedCount = 0, resultPage = 0, remoteChecked = 0, cacheHits = 0, remotePending = 0, locallyBlocked = 0;
        const outcomes = {};
        for (let page = 0; page < selectionPages; page++) {
          const keys = (await read(`walmart.match.selection.${job.id}.${page}`)).keys;
          for (let offset = 0; offset < keys.length; offset += payload.readiness ? readinessBatchSize : 1) {
            await check();
            const batch = keys.slice(offset, offset + (payload.readiness ? readinessBatchSize : 1));
            const remainingRemote = payload.readiness && payload.allFiltered ? Math.max(0, readinessRemoteLimit - remoteChecked) : Number.POSITIVE_INFINITY;
            const batchRows = await mapConcurrent(batch, payload.readiness ? readinessConcurrency : 1, async (sku, index) => {
              try {
                return payload.readiness
                  ? await checkReadiness(sku, job.id, { useCache: true, allowRemote: index < remainingRemote, db: readinessDb })
                  : await lookupProduct(sku, job.id);
              } catch (error) {
                if (error.statusCode === 499) throw error;
                return { sku, status: error.resultStatus || 'error', error: error.message };
              }
            });
            await check();
            for (const row of batchRows) {
              rows.push(row); record(row); outcomes[row.status] = (outcomes[row.status] || 0) + 1;
              if (row.status === 'matched') matchedCount++;
              if (row.remoteChecked) remoteChecked++;
              if (row.cacheHit) cacheHits++;
              if (row.status === 'remote_pending') remotePending++;
              if (row.localOnly && row.status === 'blocked') locallyBlocked++;
              if (rows.length === 100) { await write(`walmart.match.results.${job.id}.${resultPage++}`, { rows }); rows = []; }
            }
            const elapsedSeconds = Math.max(1, (Date.now() - Date.parse(job.startedAt || job.createdAt || stamp())) / 1000);
            const rowsPerSecond = processed / elapsedSeconds;
            const estimatedSecondsRemaining = rowsPerSecond > 0 ? Math.round((total - processed) / rowsPerSecond) : 0;
            const message = payload.readiness
              ? `${processed}/${total} locally screened; ${remoteChecked} Walmart lookups, ${cacheHits} cached, ${remotePending} awaiting a narrower remote check.`
              : `${processed}/${total} Walmart UPC lookups completed.`;
            await write(`walmart.match.${job.id}`, { actor: payload.actor, jobId: job.id, total, processed, matchedCount, outcomes, remoteChecked, cacheHits, remotePending, locallyBlocked, complete: false, updatedAt: stamp() });
            await persistJob(job, { phase: payload.readiness ? 'local-screen-and-bounded-lookup' : 'lookup', processedRows: processed, totalRows: total, progressPercent: Number((processed / Math.max(total, 1) * 100).toFixed(2)), rowsPerSecond, estimatedSecondsRemaining, lastProgressAt: stamp(), message });
          }
        }
        if (rows.length) await write(`walmart.match.results.${job.id}.${resultPage}`, { rows });
        const message = payload.readiness
          ? `${processed} locally screened; ${remoteChecked} Walmart lookups, ${cacheHits} cached, ${locallyBlocked} locally blocked, ${remotePending} awaiting a narrower remote check.`
          : `${processed} Walmart UPC lookups completed.`;
        await write(`walmart.match.${job.id}`, { actor: payload.actor, jobId: job.id, total, processed, matchedCount, outcomes, remoteChecked, cacheHits, remotePending, locallyBlocked, complete: true, updatedAt: stamp() });
        await persistJob(job, { status: remotePending || failed ? 'warning' : 'success', phase: 'complete', finishedAt: stamp(), processedRows: processed, totalRows: total, missingCount: failed + remotePending, progressPercent: 100, estimatedSecondsRemaining: 0, message });
        return;
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
          record(await submitLaunch(token, job, check));
        }); } catch (error) { if (error.statusCode === 499) throw error; record({ token, error: error.message }); }
        await persistJob(job, { processedRows: processed, missingCount: failed });
        }
      } else if (operation === 'feed') {
        const feedTracker = await read(`walmart.pendingFeed.${digest([payload.environment, payload.feedId])}`);
        let offset = 0, finalFeedStatus = '';
        for (;;) {
          await check();
          const data = await client.request(`/v3/feeds/${encodeURIComponent(payload.feedId)}?includeDetails=true&offset=${offset}&limit=50`, { jobId: job.id });
          if (!['RECEIVED','INPROGRESS','PROCESSED','ERROR'].includes(data.feedStatus)) throw fail('Walmart returned an unrecognized feed status. Recheck before assuming completion.');
          finalFeedStatus = data.feedStatus;
          const rows = data.itemDetails?.itemIngestionStatus || [];
          const terminal = ['PROCESSED', 'ERROR'].includes(data.feedStatus);
          // Walmart can retain a non-zero itemsProcessing count after the feed is terminal.
          pending = !terminal && (['RECEIVED', 'INPROGRESS'].includes(data.feedStatus) || Number(data.itemsProcessing) > 0);
          for (const row of rows) {
            if (!terminal) pending ||= ['INPROGRESS','RECEIVED'].includes(row.ingestionStatus);
            const error = ['DATA_ERROR','SYSTEM_ERROR','TIMEOUT_ERROR'].includes(row.ingestionStatus) ? JSON.stringify(row.ingestionErrors || row) : '';
            record({ ...row, feedId: payload.feedId, feedStatus: data.feedStatus, error });
            if (payload.environment === 'production' && deps.saveListing && row.sku) {
              const p = await postgres.readProductByKey(row.sku);
              if (p?.sku === row.sku && p.walmartListing?.feedId === payload.feedId) await deps.saveListing(p.id, { ingestionStatus: row.ingestionStatus, ingestionErrors: row.ingestionErrors || [], pendingStatusDescription: row.pendingStatusDescription || '', ...(row.itemid ? { itemId: row.itemid } : {}), ...(row.wpid ? { wpid: row.wpid } : {}), checkedAt: stamp() });
              if (p?.sku === row.sku && p.walmartListing?.feedId === payload.feedId && row.ingestionStatus === 'SUCCESS' && !feedTracker?.bulk) {
                try { await verifyListing(p.id, { includeLag: false, jobId: job.id }); }
                catch (error) { record({ sku: row.sku, status: 'verification_pending', error: error.message }); }
              }
            }
          }
          await write(`walmart.feed.${payload.environment}.${digest(payload.feedId)}`, { feedId: payload.feedId, feedStatus: data.feedStatus, itemsFailed: data.itemsFailed, itemsProcessing: data.itemsProcessing, itemsSucceeded: data.itemsSucceeded, checkedAt: stamp(), jobId: job.id });
          if (data.feedStatus === 'ERROR' || Number(data.itemsFailed) > 0) failed = Math.max(1, failed);
          offset += rows.length;
          if (rows.length < 50 || offset >= Number(data.itemsReceived || Infinity)) break;
        }
        const pendingKey = `walmart.pendingFeed.${digest([payload.environment, payload.feedId])}`;
        const tracker = await read(pendingKey);
        if (tracker) await write(pendingKey, {
          ...tracker,
          complete: !pending,
          attempts: Number(tracker.attempts || 0) + 1,
          nextCheckAt: pending ? Date.now() + Math.min(240, 15 * 2 ** Number(tracker.attempts || 0)) * 60000 : null,
          ...(pending ? {} : { completedAt: stamp(), terminalStatus: finalFeedStatus === 'ERROR' ? 'ERROR' : failed ? 'PROCESSED_WITH_ERRORS' : 'PROCESSED', lastError: '' })
        });
      } else throw fail('Unsupported Walmart job.');
      await persistJob(job, { status: failed || pending ? 'warning' : 'success', phase: 'complete', finishedAt: stamp(), processedRows: processed, totalRows: processed, missingCount: failed, progressPercent: 100, message: operation === 'launch' ? `${processed - failed} feeds submitted; ${failed} need attention. Check feed results and seller item status to verify publication.` : operation === 'feed' && pending ? `Status check complete. Walmart is still processing the existing feed; no products were submitted by this job. ${failed} failures reported.` : operation === 'feed' ? `Status check complete for the existing Walmart feed. No products were submitted by this job. ${processed} records checked; ${failed} need attention.` : `${processed} records processed; ${failed} need attention.` });
    } catch (error) {
      if (error.statusCode === 499) {
        await persistJob(job, { status: 'stopped', phase: 'stopped', finishedAt: stamp(), processedRows: processed, totalRows: job.totalRows || processed, progressPercent: Number(job.progressPercent || 0), estimatedSecondsRemaining: 0, message: 'Job stopped by an operator.' });
        return;
      }
      if (operation === 'feed' && error.upstreamStatus === 404) {
        const pendingKey = `walmart.pendingFeed.${digest([payload.environment, payload.feedId])}`;
        const tracker = await read(pendingKey);
        record({ feedId: payload.feedId, status: 'retired', error: error.message });
        if (tracker) await write(pendingKey, {
          ...tracker,
          complete: true,
          nextCheckAt: null,
          attempts: Number(tracker.attempts || 0) + 1,
          terminalStatus: 'NOT_FOUND',
          retiredAt: stamp(),
          lastError: error.message,
          retirementReason: 'Walmart no longer retains status data for this feed. Automatic polling was closed.'
        });
        await persistJob(job, {
          status: 'warning', phase: 'complete', finishedAt: stamp(), processedRows: processed,
          totalRows: processed, missingCount: failed, progressPercent: 100,
          message: 'Walmart no longer retains this feed status. The stale tracker was closed and will not be polled again.'
        });
        return;
      }
      record({ error: error.message });
      if (operation === 'settlements') {
        const schedules = await postgres.readStateField('channelSettlementSchedules').catch(() => ({})) || {};
        await postgres.writeStateDocuments({ channelSettlementSchedules: { ...schedules, walmart: { ...(schedules.walmart || {}), lastCompletedAt: stamp(), lastJobId: job.id, lastStatus: 'failed', lastMessage: error.message, lastError: error.message } } }).catch(() => {});
      }
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
        result = { ...(deps.credentials ? deps.credentials.status(s.walmartEnvironment || 'production') : { configured: Boolean(process.env[`${prefix}CLIENT_ID`] && process.env[`${prefix}CLIENT_SECRET`]) }), shipNodes: await shipNodes(), connection: await connectionStatus(), environment: s.walmartEnvironment || 'production', schedule: await read('walmart.orderSchedule'), returnSchedule: await read('walmart.returnSchedule'), settlementSchedule: await read('walmart.settlementSchedule'), webhook: await webhookStatus(false, req), inventorySchedule: await read('walmart.inventorySchedule'), launchReconciliation: await read('walmart.launch-reconciliation.latest'), taxonomy: { job: taxonomyJob ? { id: taxonomyJob.id, jobNumber: taxonomyJob.jobNumber, status: taxonomyJob.status, message: taxonomyJob.message } : null, version: taxonomy?.version, count: taxonomy?.rows?.length || 0, updatedAt: taxonomy?.updatedAt } };
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
        result = await queue('orders', { startDate: start.toISOString(), endDate: end.toISOString(), historicalBackfill: body.historicalBackfill === true, reconcileExisting: body.historicalBackfill !== true && body.reconcileExisting === true });
      } else if (req.method === 'POST' && action === 'returns/import') {
        const end = new Date(body.endDate || Date.now());
        const lookbackDays = Math.max(1, Math.min(730, Math.floor(Number(body.lookbackDays || 30)) || 30));
        const start = new Date(body.startDate || (end.getTime() - lookbackDays * 86400000));
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end - start > 730 * 86400000) throw fail('Choose a valid return date range of at most two years.');
        result = await queue('returns', { startDate: start.toISOString(), endDate: end.toISOString() });
      } else if (req.method === 'POST' && action === 'settlements/import') {
        const lookbackDays = Math.max(7, Math.min(90, Number(body.lookbackDays || 90) || 90));
        result = await queue('settlements', { lookbackDays, actor });
      } else if (req.method === 'GET' && action === 'webhooks/status') {
        result = await webhookStatus(true, req);
      } else if (req.method === 'POST' && action === 'webhooks/setup') {
        result = await setupWebhooks(req, actor);
      } else if (req.method === 'POST' && action === 'orders/cancel/preview') {
        result = await cancellationPreview(body, actor);
      } else if (req.method === 'POST' && action === 'orders/cancel/apply') {
        result = await cancellationApply(body.token, actor);
      } else if (req.method === 'POST' && /^orders\/[^/]+\/refresh$/.test(action)) {
        result = await refreshOrder(decodeURIComponent(action.slice('orders/'.length, -'/refresh'.length)));
      } else if (req.method === 'POST' && action === 'operations/preview') {
        result = await createOperationPreview(body.kind, body.key, body.shipmentId, actor, { reason: body.reason, confirmSku: body.confirmSku });
      } else if (req.method === 'POST' && action === 'operations/apply') {
        result = await applyOperationPreviews(body.tokens || body.token, actor);
      } else if (req.method === 'POST' && action === 'taxonomy/refresh') result = await queue('taxonomy', {});
      else if (req.method === 'GET' && action === 'taxonomy/tree') {
        const taxonomy = await read('walmart.taxonomy');
        if (!taxonomy?.rows?.length) throw fail('No cached taxonomy is available. Refresh Walmart taxonomy in channel settings.', 409);
        const { categoryTree, treePage } = require('./category-tree');
        result = treePage(categoryTree(taxonomy.rows, 'walmart', { version: taxonomy.version, updatedAt: taxonomy.updatedAt, source: 'Cached Walmart product types' }), Object.fromEntries(url.searchParams));
      }
      else if (req.method === 'GET' && action === 'taxonomy') {
        const taxonomy = await read('walmart.taxonomy');
        const q = (url.searchParams.get('q') || '').toLowerCase();
        const matched = (taxonomy?.rows || []).filter(r => r.path.toLowerCase().includes(q));
        const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
        result = { version: taxonomy?.version, updatedAt: taxonomy?.updatedAt, total: matched.length, rows: matched.slice(offset, offset + 100) };
      } else if (req.method === 'GET' && action === 'mappings') result = { mappings: (await mappings()).filter(mapping => mapping.productType) };
      else if (req.method === 'GET' && action === 'mapping') {
        const category = url.searchParams.get('category') || '';
        const mapping = await read(mappingKey(category)) || null;
        const [review] = await categoryReviews([category]);
        result = { mapping, revision: mappingRevision(mapping), suggestion: walmartReview(mapping, review) };
      }
      else if (req.method === 'POST' && ['mapping', 'mapping/approve'].includes(action)) {
        await enabled();
        const category = String(body.category || '').trim();
        if (!category) throw fail('Choose a master category.');
        const current = await read(mappingKey(category)) || null;
        let productType = body.productType;
        let suggestionVersion = '';
        if (action === 'mapping/approve') {
          const [review] = await categoryReviews([category]);
          const suggestion = walmartReview(current, review);
          if (!suggestion?.categoryId || !body.approvalToken || suggestion.approvalToken !== body.approvalToken) throw fail('This suggestion changed or was already approved. Reload before approving.', 409);
          productType = suggestion.categoryId;
          suggestionVersion = suggestion.taxonomyVersion;
        } else if (!body.revision || body.revision !== mappingRevision(current)) {
          throw fail('The saved mapping changed. Reload before saving your selection.', 409);
        }
        const taxonomy = await read('walmart.taxonomy'), s = await settings();
        if (suggestionVersion && suggestionVersion !== taxonomy?.version) throw fail('The taxonomy version changed. Search the current taxonomy before saving.', 409);
        const row = taxonomy?.rows?.find(r => r.productType === productType);
        if (!row || taxonomy.version !== (s.walmartSpecVersion || taxonomy.version)) throw fail('Choose a master category and a product type from the current Walmart taxonomy.');
        const mapping = { category, productType: row.productType, path: row.path, version: taxonomy.version, orderable: action === 'mapping/approve' ? {} : object(body.orderable), visible: action === 'mapping/approve' ? {} : object(body.visible), approvedBy: actor, updatedAt: stamp(), status: 'mapped', locked: true,
          history: [...(current?.history || []), { at: stamp(), actor, action: action === 'mapping/approve' ? 'approve-suggestion' : 'save-mapping', previousProductType: current?.productType || null, productType: row.productType }].slice(-100) };
        const stored = await postgres.getPool().query('insert into walmart_documents(doc_key,data,updated_at) values($1,$2::jsonb,now()) on conflict(doc_key) do update set data=excluded.data,updated_at=now() where walmart_documents.data = $3::jsonb returning doc_key', [mappingKey(category), JSON.stringify(mapping), JSON.stringify(current)]);
        if (!stored.rows.length) throw fail('Another user changed this mapping. Reload before saving.', 409);
        log({ channel: 'Walmart', transport: 'Settings', method: 'SAVE', path: 'mapping', operation: 'Walmart category mapping', statusCode: 200, ok: true, message: `${mapping.category} → ${mapping.productType}` });
        result = { mapping, revision: mappingRevision(mapping), message: 'Walmart category mapping approved and saved.' };
      } else if (req.method === 'POST' && action === 'spec') {
        const s = await settings(); result = { schema: await spec('MP_ITEM', s.walmartSpecVersion || (await read('walmart.taxonomy'))?.version || '5.0', body.productType) };
      } else if (req.method === 'POST' && action === 'reconcile') {
        await enabled('walmartLinkExistingEnabled');
        if ((await settings()).walmartEnvironment === 'sandbox') throw fail('Seller listing reconciliation requires production.');
        result = await queue('reconcile', { actor });
      } else if (req.method === 'GET' && action === 'reconcile') {
        const job = await postgres.readOperationJob(url.searchParams.get('jobId'));
        if (!job || job.workerTask !== 'walmart-reconcile' || job.workerPayload?.actor !== actor) throw fail('Your reconciliation job was not found.', 404);
        const batch = await read(`walmart.reconcile.${job.id}`);
        result = { ...(batch || { rows: [], total: job.totalRows || 0, processed: 0, complete: false }), jobId: job.id, jobNumber: job.jobNumber, status: job.status, message: job.message };
      } else if (req.method === 'POST' && action === 'catalog-match/select') {
        await enabled();
        const sku = typeof body.sku === 'string' ? body.sku.trim() : '';
        const candidateKey = typeof body.candidateKey === 'string' ? body.candidateKey.trim() : '';
        if (!sku || !candidateKey) throw fail('Choose a saved Walmart catalog candidate.', 400);
        const p = await product(sku), identity = await matchIdentity(p);
        const saved = await read(`walmart.catalog-match.${p.id}`);
        if (!saved || saved.identity !== identity || Date.now() - Date.parse(saved.checkedAt) >= 86400000) throw fail('The saved Walmart candidates are outdated. Run Match on Walmart by UPC again.', 409);
        const candidate = (saved.candidates || []).find(row => row.candidateKey === candidateKey);
        if (!candidate) throw fail('That Walmart catalog candidate is no longer available. Run the match again.', 409);
        await write(`walmart.catalog-selection.${p.id}`, { productId: p.id, sku: p.sku, identity, candidate, selectedBy: actor, selectedAt: stamp() });
        const readiness = await checkReadiness(p.id);
        if (readiness.status !== 'matched') throw fail('The selected Walmart item could not be revalidated. Run the match again.', 409);
        result = { candidate, readiness, message: 'Walmart catalog item selected and launch readiness refreshed.' };
      } else if (req.method === 'GET' && action === 'catalog-match') {
        await enabled();
        const p = await product(url.searchParams.get('sku'));
        const saved = await read(`walmart.catalog-match.${p.id}`);
        let stale = Boolean(saved && Date.parse(saved.checkedAt) < Date.now() - 86400000);
        if (saved) { try { stale ||= saved.identity !== await matchIdentity(p); } catch { stale = true; } }
        const selection = stale ? null : await catalogSelection(p);
        result = saved ? { sku: saved.sku, status: saved.status, identifier: saved.identifier, itemId: stale ? '' : saved.itemId, productUrl: stale ? '' : saved.productUrl, referenceStatus: saved.referenceStatus, referenceMessage: saved.referenceMessage, candidates: stale ? [] : saved.candidates || [], selectedCandidate: stale ? null : saved.selectedCandidate || selection?.candidate || null, checkedAt: saved.checkedAt, stale } : { sku: p.sku, status: 'unchecked', candidates: [], selectedCandidate: null };
      } else if (req.method === 'GET' && action === 'readiness') {
        await enabled();
        const p = await product(url.searchParams.get('sku'));
        const saved = await read(`walmart.readiness.${p.id}`);
        const stale = Boolean(saved && (saved.expiresAt < Date.now() || saved.fingerprint !== await readinessFingerprint(p)));
        result = saved ? { ...saved, fingerprint: undefined, stale } : { sku: p.sku, status: 'unchecked' };
      } else if (req.method === 'POST' && action === 'match/single') {
        const sku = typeof body.sku === 'string' ? body.sku.trim() : '';
        if (!sku || sku.length > 500) throw fail('Choose one catalog SKU for lookup.');
        const c = await enabled(), key = await credentialKey(), environment = c.settings.walmartEnvironment || 'production';
        const row = body.readiness === true ? await checkReadiness(sku) : await lookupProduct(sku);
        const current = await enabled();
        if (current.id !== c.id || (current.settings.walmartEnvironment || 'production') !== environment || await credentialKey() !== key) throw fail('Walmart connection changed during lookup. Try again.', 409);
        result = { rows: [row], total: 1, processed: 1, matchedCount: row.status === 'matched' ? 1 : 0, complete: true, status: 'success', message: 'Lookup complete.' };
      } else if (req.method === 'POST' && ['match', 'launch/existing'].includes(action)) {
        const skus = [...new Set((Array.isArray(body.skus) ? body.skus : []).map(sku => String(sku).trim()).filter(Boolean))];
        if (!skus.length && body.allFiltered !== true) throw fail('Select catalog products for UPC matching.');
        if (skus.some(key => key.length > 500)) throw fail('Invalid catalog product key.');
        await enabled();
        result = await queue(action === 'launch/existing' ? 'existing-launch' : 'match', { skus, actor, readiness: body.readiness === true, ...(body.allFiltered === true ? { allFiltered: true, query: String(body.query || '').slice(0, 500), filters: object(body.filters) } : {}) });
      } else if (req.method === 'GET' && ['match', 'launch/existing'].includes(action)) {
        await enabled();
        const job = await postgres.readOperationJob(url.searchParams.get('jobId'));
        if (!job || !(action === 'launch/existing' ? ['walmart-existing-launch', 'walmart-bulk-launch'] : ['walmart-match']).includes(job.workerTask) || job.workerPayload?.actor !== actor) throw fail('Your Walmart match job was not found.', 404);
        const s = await settings();
        if (job.workerPayload.environment !== (s.walmartEnvironment || 'production') || job.workerPayload.credentialKey !== await credentialKey()) throw fail('The Walmart account or environment changed. Run a new match.', 409);
        const batch = await read(`walmart.match.${job.id}`);
        const offset = Math.max(0, Math.floor((Number(url.searchParams.get('offset')) || 0) / 100) * 100);
        let page = await read(`walmart.match.results.${job.id}.${offset / 100}`);
        if (action === 'launch/existing' && (job.workerPayload.bulkRunId || batch?.runId)) {
          const rows = [];
          for (let index = offset; index < Math.min(offset + 100, batch?.total || 0); index++) {
            const row = await read(`walmart.bulk.${job.workerPayload.bulkRunId || job.id}.item.${index}`);
            if (row) rows.push({ sku: row.sku, status: row.status, error: row.error, message: row.message, feedId: row.feedId });
          }
          page = { rows };
        }
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
      } else if (req.method === 'GET' && action === 'listing/details') {
        const p = await product(url.searchParams.get('sku')), c = await enabled();
        const snapshot = await read(`walmart.listing-status.${c.settings.walmartEnvironment || 'production'}.${digest(p.id)}`);
        if (snapshot && snapshot.credentialKey === await credentialKey() && snapshot.channelId === c.id && snapshot.sku === await sellerSku(p)) {
          const { credentialKey: hidden, ...visible } = snapshot; result = visible;
        } else result = { sku: p.sku, publishedStatus: 'UNVERIFIED' };
        result.launchStatus = launchStatus({ ...(p.walmartListing || {}), ...result });
        result.pricingInsights = await pricingFor(p);
      } else if (req.method === 'POST' && action === 'listing/verify') {
        result = await verifyListing(body.sku);
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
        if (!tracker.credentialKey || (tracker.credentialKey === await credentialKey() && tracker.channelId === c.id)) {
          const queued = await queue('feed', { feedId: tracker.feedId });
          if (!queued.duplicate) await write(`walmart.pendingFeed.${digest([tracker.environment, tracker.feedId])}`, { ...tracker, nextCheckAt: Date.now() + 15 * 60000, lastJobId: queued.job.id });
        } else await write(`walmart.pendingFeed.${digest([tracker.environment, tracker.feedId])}`, { ...tracker, nextCheckAt: Date.now() + 86400000, message: 'Paused: Walmart account changed.' });
      }
    }
    if (s.walmartLinkExistingEnabled === true && s.walmartEnvironment !== 'sandbox') {
      await lock('link-schedule', async () => {
        const account = await credentialKey();
        const previous = await read('walmart.linkSchedule');
        if (previous?.credentialKey === account && previous.channelId === c.id && Date.now() - new Date(previous.queuedAt).getTime() < 86400000) return;
        const result = await queue('reconcile', { actor: 'system:walmart-listing-links', scheduled: true });
        if (!result.duplicate) await write('walmart.linkSchedule', { queuedAt: stamp(), jobId: result.job.id, credentialKey: account, channelId: c.id });
      });
    }
    if (s.walmartInventoryEnabled === true && s.walmartInventoryScheduleEnabled !== false && s.walmartEnvironment === 'production') {
      await lock('inventory-schedule', async () => {
        const previous = await read('walmart.inventorySchedule');
        const hours = Math.max(1, Math.min(24, Number(s.walmartInventoryScheduleHours || 12) || 12));
        const previousJob = previous?.jobId
          ? await postgres.readOperationJob(previous.jobId).catch(() => null)
          : null;
        const previousStatus = String(previousJob?.status || '').trim().toLowerCase();
        const retryIncomplete = ['warning', 'failed', 'stopped', 'canceled', 'cancelled'].includes(previousStatus);
        if (previous?.queuedAt && !retryIncomplete && Date.now() - new Date(previous.queuedAt).getTime() < hours * 3600000) return;
        const freshness = deps.inventoryFreshness ? await deps.inventoryFreshness() : { safe: true };
        if (!freshness.safe) {
          const jobLabel = freshness.jobNumber ? `Job ${freshness.jobNumber}` : 'The latest product datadump';
          await write('walmart.inventorySchedule', {
            ...previous,
            intervalHours: hours,
            credentialKey: await credentialKey(),
            channelId: c.id,
            blockedAt: stamp(),
            blockedByJobId: freshness.jobId || '',
            blockedByJobNumber: freshness.jobNumber || 0,
            blockedStatus: freshness.status || 'not complete',
            lastSkipReason: `${jobLabel} is ${freshness.status || 'not complete'}. Automatic Walmart inventory is paused so stale supplier quantities are not published.`
          });
          return;
        }
        const result = await queue('inventory-sync', { scheduled: true });
        if (!result.duplicate) await write('walmart.inventorySchedule', { queuedAt: stamp(), jobId: result.job.id, intervalHours: hours, credentialKey: await credentialKey(), channelId: c.id, blockedAt: '', blockedByJobId: '', blockedByJobNumber: 0, blockedStatus: '', lastSkipReason: '' });
      });
    }
    if (s.walmartSettlementImportEnabled !== false && s.walmartEnvironment === 'production') {
      await lock('settlement-schedule', async () => {
        const previous = await read('walmart.settlementSchedule');
        const now = new Date(), today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        if ((now.getHours() * 60 + now.getMinutes()) < 390 || previous?.runDate === today) return;
        const result = await queue('settlements', { scheduled: true, lookbackDays: 45 });
        await write('walmart.settlementSchedule', { queuedAt: stamp(), runDate: today, jobId: result.job.id, cadence: 'daily' });
      });
    }
    if (s.walmartReturnsEnabled === true && s.walmartReturnScheduleEnabled === true && s.walmartEnvironment === 'production') {
      await lock('return-schedule', async () => {
        const previous = await read('walmart.returnSchedule');
        const hours = Math.max(1, Math.min(24, Number(s.walmartReturnScheduleHours || 2) || 2));
        if (previous?.queuedAt && Date.now() - new Date(previous.queuedAt).getTime() < hours * 3600000) return;
        const days = Math.max(1, Math.min(180, Number(s.walmartReturnLookbackDays || 30) || 30));
        const result = await queue('returns', { startDate: new Date(Date.now() - days * 86400000).toISOString(), endDate: stamp(), scheduled: true });
        if (!result.duplicate) await write('walmart.returnSchedule', { queuedAt: stamp(), jobId: result.job.id, lookbackDays: days, intervalHours: hours });
      });
    }
    if (s.channelEnabled === true && s.walmartWebhooksEnabled === true && s.walmartEnvironment === 'production') {
      await lock('webhook-recovery', async () => {
        const pending = await postgres.getPool().query(`select 1 from walmart_documents where data->>'kind'='event' and data->>'status'='pending' and data->>'environment'=$1 and data->>'channelId'=$2 and coalesce(nullif(data->>'nextAttemptAt','')::timestamptz,now())<=now() limit 1`, [s.walmartEnvironment, c.id]);
        if (pending.rows.length) await queue('webhook', { actor: 'system:walmart-webhook-recovery' });
      });
    }
    if (!s.walmartOrdersEnabled || s.walmartOrderScheduleEnabled !== true || s.walmartEnvironment === 'sandbox') return;
    await lock('schedule', async () => {
      const previous = await read('walmart.orderSchedule');
      const hours = Math.max(1, Math.min(24, Number(s.walmartOrderScheduleHours || 1) || 1));
      if (previous?.queuedAt && Date.now() - new Date(previous.queuedAt).getTime() < hours * 3600000) return;
      const days = Math.max(1, Math.min(180, Number(s.walmartOrderLookbackDays || 30) || 30));
      const checkpoint = await read(`walmart.orderIntake.${digest([c.id, s.walmartEnvironment || 'production', await credentialKey()])}`);
      const completed = Date.parse(checkpoint?.completedThrough);
      const start = Number.isFinite(completed) ? Math.min(Date.now(), completed) - 3600000 : Date.now() - days * 86400000;
      const result = await queue('orders', { startDate: new Date(start).toISOString(), endDate: stamp(), scheduled: true, reconcileExisting: true });
      if (!result.duplicate) await write('walmart.orderSchedule', { queuedAt: stamp(), jobId: result.job.id, lookbackDays: days, intervalHours: hours });
    });
  }
  return { handle, run, prepare, queue, schedule, refreshOrder, receiveWebhook, verifyListing, operationPlan, createOperationPreview, applyOperationPreviews, syncTracking, zeroInactive, projectCategories };
}

module.exports = { createWalmartMarketplace, validatePayload, mappingKey, walmartStatusReconciliationCandidates, walmartStatusReconciliationCandidatesFromDatabase };
