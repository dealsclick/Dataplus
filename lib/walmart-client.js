const crypto = require('crypto');

const ORIGINS = { production: 'https://marketplace.walmartapis.com', sandbox: 'https://sandbox.walmartapis.com' };
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

function createWalmartClient({ channel, credentials, log = () => {}, env = process.env, fetchImpl = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let token = '', expires = 0, pending;
  async function context(operation) {
    const current = await channel();
    if (!current || current.settings?.channelEnabled !== true) throw fail('Enable Walmart Marketplace in Channels first.', 409);
    if (operation && current.settings?.[operation] !== true) throw fail(`Enable Walmart ${operation.replace(/^walmart/, '')} in channel Rules first.`, 409);
    const environment = current.settings?.walmartEnvironment === 'sandbox' ? 'sandbox' : 'production';
    const prefix = environment === 'sandbox' ? 'WALMART_SANDBOX_' : 'WALMART_';
    const saved = credentials ? await credentials(environment) : null;
    const clientId = saved ? saved.clientId : env[`${prefix}CLIENT_ID`], secret = saved ? saved.clientSecret : env[`${prefix}CLIENT_SECRET`];
    const channelTypeId = saved ? saved.channelTypeId : env.WALMART_CHANNEL_TYPE;
    if (!clientId || !secret) throw fail(`Configure ${prefix}CLIENT_ID and ${prefix}CLIENT_SECRET on the server.`, 409);
    return { current, origin: ORIGINS[environment], clientId, secret, channelTypeId };
  }
  const headers = (ctx) => ({ Accept: 'application/json', 'WM_SVC.NAME': 'Walmart Marketplace', 'WM_MARKET': 'us', 'WM_QOS.CORRELATION_ID': crypto.randomUUID(), ...(ctx?.channelTypeId ? { 'WM_CONSUMER.CHANNEL.TYPE': ctx.channelTypeId } : {}) });
  let tokenKey = '';
  async function access(ctx) {
    if (pending) { await pending; return access(ctx); }
    const key = crypto.createHash('sha256').update(JSON.stringify([ctx.origin, ctx.clientId, ctx.secret, ctx.channelTypeId])).digest('hex');
    if (key !== tokenKey) { token = ''; expires = 0; tokenKey = key; }
    if (token && expires > Date.now()) return token;
    pending = (async () => {
      const response = await fetchImpl(`${ctx.origin}/v3/token`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000), headers: { ...headers(ctx), Authorization: `Basic ${Buffer.from(`${ctx.clientId}:${ctx.secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
      log({ channel: 'Walmart', transport: 'API', method: 'POST', path: '/v3/token', operation: 'Walmart authorization', statusCode: response.status, ok: response.ok });
      if (!response.ok) throw fail(`Walmart authorization HTTP ${response.status}. Check credentials and seller API access.`, 502);
      const data = await response.json();
      if (!data.access_token) throw fail('Walmart returned no access token.', 502);
      token = data.access_token; expires = Date.now() + Math.max(0, Number(data.expires_in || 900) - 60) * 1000;
      return token;
    })().finally(() => { pending = null; });
    return pending;
  }
  async function request(path, { method = 'GET', body, gate, jobId, correlationId, retryReads = true, onResponse } = {}) {
    if (!path.startsWith('/v3/') || path.includes('://') || path.includes('\\')) throw fail('Invalid Walmart API path.');
    const requestHeaders = { ...headers(), ...(correlationId ? { 'WM_QOS.CORRELATION_ID': correlationId } : {}) };
    let expectedContext;
    for (let attempt = 0; attempt < 4; attempt++) {
      const ctx = await context(gate);
      const contextId = JSON.stringify([ctx.current.id, ctx.origin, ctx.clientId, ctx.secret, ctx.channelTypeId]);
      if (expectedContext && expectedContext !== contextId) throw fail('Walmart environment changed during the request.', 409);
      expectedContext = contextId;
      const accessToken = await access(ctx);
      const latest = await context(gate);
      if (JSON.stringify([latest.current.id, latest.origin, latest.clientId, latest.secret, latest.channelTypeId]) !== expectedContext) throw fail('Walmart environment changed during authorization.', 409);
      let response;
      try {
        response = await fetchImpl(ctx.origin + path, { method, redirect: 'error', signal: AbortSignal.timeout(45000), headers: { ...requestHeaders, ...(ctx.channelTypeId ? { 'WM_CONSUMER.CHANNEL.TYPE': ctx.channelTypeId } : {}), ...(ctx.origin === ORIGINS.sandbox ? { WM_SANDBOX: 'v2' } : {}), 'WM_SEC.ACCESS_TOKEN': accessToken, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      } catch {
        log({ channel: 'Walmart', transport: 'API', method, path: path.split('?')[0], operation: 'Walmart API', statusCode: 502, ok: false, jobId, message: 'Network failure; writes may have been accepted. Reconcile before retry.' });
        throw fail('Walmart network failure. For writes, reconcile the feed before retrying; acceptance is unknown.', 502);
      }
      if (onResponse) await onResponse(response);
      log({ channel: 'Walmart', transport: 'API', method, path: path.split('?')[0], operation: 'Walmart API', statusCode: response.status, ok: response.ok, jobId });
      if (response.status === 401 && attempt === 0) { token = ''; expires = 0; continue; }
      // Never replay an ambiguous remote write. Only reads retry transient failures.
      if (retryReads && method === 'GET' && (response.status === 429 || response.status >= 500) && attempt < 3) {
        await pause(Math.min(30000, Math.max(1000 * 2 ** attempt, Number(response.headers.get('retry-after') || 0) * 1000))); continue;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.errors?.length || data.errors?.error?.length) {
        const errors = data.errors?.error || data.errors || data.error || [];
        let details = (Array.isArray(errors) ? errors : [errors]).map(e => [e.code, e.field, e.description || e.info].filter(Boolean).join(': ')).join('; ').slice(0, 1500);
        for (const secret of [ctx.clientId, ctx.secret, accessToken]) if (secret) details = details.split(secret).join('[redacted]');
        throw Object.assign(fail(`Walmart HTTP ${response.status}${details ? `: ${details}` : '. Review permissions, input, or API availability.'}`, 502), { upstreamStatus: response.status });
      }
      return data;
    }
    throw fail('Walmart request retry limit reached.', 502);
  }
  return { request };
}

function identifier(product) {
  const gtin = String(product.gtin || product.raw?.gtin || '').trim();
  const upc = String(product.upc || product.barcode || product.raw?.upc || '').trim();
  const source = gtin || upc;
  // Numeric imports commonly drop the leading zero of a UPC-A. Keep the
  // supplied check digit and validate after padding; never invent other digits.
  const value = /^\d{11}$/.test(source) ? `0${source}` : source;
  const kind = value.length === 14 ? 'gtin' : value.length === 12 ? 'upc' : value.length === 13 ? 'ean' : '';
  if (!kind || !/^\d+$/.test(value) || /^0+$/.test(value)) throw fail('A valid 12-digit UPC, 13-digit EAN, or 14-digit GTIN is required. Preserve leading zeros.');
  const digits = value.split('').map(Number);
  const sum = digits.slice(0, -1).reverse().reduce((n, d, i) => n + d * (i % 2 === 0 ? 3 : 1), 0);
  if ((10 - sum % 10) % 10 !== digits.at(-1)) throw fail('Product identifier check digit is invalid.');
  return { kind, value, productIdType: kind.toUpperCase() };
}

function taxonomyRows(data) {
  return (data.itemTaxonomy || []).flatMap(category => (category.productTypeGroup || []).flatMap(group => (group.productType || []).map(type => ({ category: category.category, group: group.productTypeGroupName, productType: type.productTypeName, description: type.description || '', path: [category.category, group.productTypeGroupName, type.productTypeName].join(' > ') }))));
}

function mapOrder(raw) {
  if (!raw.purchaseOrderId || !raw.orderLines?.orderLine?.length) throw fail('Walmart order is missing its purchase order ID or lines.');
  const items = raw.orderLines.orderLine.map(line => {
    const qty = Number(line.orderLineQuantity?.amount);
    if (!line.lineNumber || !Number.isFinite(qty) || qty <= 0) throw fail('Walmart order contains an invalid line ID or quantity.');
    const charges = line.charges?.charge || [];
    const amount = type => charges.filter(c => c.chargeType === type).reduce((sum, c) => sum + Number(c.chargeAmount?.amount || 0), 0);
    const statuses = line.orderLineStatuses?.orderLineStatus || [];
    const statusQty = status => statuses.filter(s => s.status === status).reduce((n, s) => n + Number(s.statusQuantity?.amount || 0), 0);
    const fulfilledQty = statusQty('Shipped') + statusQty('Delivered'), canceledQty = statusQty('Cancelled');
    if (![fulfilledQty, canceledQty, amount('PRODUCT'), amount('SHIPPING')].every(Number.isFinite) || fulfilledQty + canceledQty > qty || fulfilledQty < 0 || canceledQty < 0) throw fail('Walmart line has invalid money or status quantities.');
    return { id: String(line.lineNumber), lineItemId: String(line.lineNumber), sourceLineId: String(line.lineNumber), sku: line.item?.sku || '', title: line.item?.productName || '', qty, price: amount('PRODUCT') / qty, tax: charges.reduce((sum, c) => sum + Number(c.tax?.taxAmount?.amount || 0), 0), shippingPaid: amount('SHIPPING'), fulfilledQty, fulfilledQuantity: fulfilledQty, canceledQty, remainingQty: Math.max(0, qty - fulfilledQty - canceledQty), walmartStatuses: statuses, cost: null };
  });
  if (new Set(items.map(i => i.id)).size !== items.length) throw fail('Walmart order contains duplicate line IDs.');
  const terminal = items.every(i => i.remainingQty === 0);
  const status = items.every(i => i.canceledQty === i.qty) ? 'canceled' : terminal ? 'fulfilled' : 'processing';
  const subtotal = items.reduce((n, i) => n + i.price * i.qty, 0), taxAmount = items.reduce((n, i) => n + i.tax, 0), shippingPaid = items.reduce((n, i) => n + i.shippingPaid, 0);
  const address = raw.shippingInfo?.postalAddress || {};
  const date = new Date(raw.orderDate).toISOString();
  const shipments = items.flatMap((item, lineIndex) => item.walmartStatuses.filter(s => s.trackingInfo?.trackingNumber).map(s => ({ id: `walmart-${raw.purchaseOrderId}-${item.id}-${s.trackingInfo.trackingNumber}`, source: 'Walmart', provider: 'Walmart', status: 'fulfilled', trackingNumber: s.trackingInfo.trackingNumber, carrier: s.trackingInfo.carrierName?.carrier || '', shipDate: s.trackingInfo.shipDateTime, lines: [{ lineIndex, sku: item.sku, qty: Number(s.statusQuantity?.amount), qtyFulfilled: Number(s.statusQuantity?.amount) }], channelSync: { status: 'synced', provider: 'Walmart' } })));
  return { id: `walmart-${raw.purchaseOrderId}`, source: 'Walmart', marketplaceOrderNumber: String(raw.purchaseOrderId), marketplaceOrderId: String(raw.purchaseOrderId), marketplaceReferences: [{ source: 'Walmart', type: 'purchaseOrderId', value: String(raw.purchaseOrderId), primary: true }, { source: 'Walmart', type: 'customerOrderId', value: String(raw.customerOrderId || '') }], buyer: address.name || '', buyerEmail: raw.customerEmailId || '', phone: raw.shippingInfo?.phone || '', address: { name: address.name || '', line1: address.address1 || '', line2: address.address2 || '', city: address.city || '', state: address.state || '', postalCode: address.postalCode || '', country: address.country || '' }, status, financialStatus: status === 'fulfilled' ? 'Paid' : status === 'canceled' ? 'Voided' : 'Authorized', paymentStatus: status === 'fulfilled' ? 'Paid' : status === 'canceled' ? 'Voided' : 'Authorized', currency: raw.orderLines.orderLine[0].charges?.charge?.[0]?.chargeAmount?.currency || 'USD', subtotal, taxAmount, shippingPaid, total: subtotal + taxAmount + shippingPaid, paidAmount: status === 'fulfilled' ? subtotal + taxAmount + shippingPaid : null, productCost: null, items, shipments, sku: items[0].sku, title: items[0].title, qty: items.reduce((n, i) => n + i.qty, 0), shippingService: raw.shippingInfo?.methodCode || '', shipBy: raw.shippingInfo?.estimatedShipDate ? new Date(raw.shippingInfo.estimatedShipDate).toISOString() : '', orderDate: date, orderedAt: date, createdAt: date, updatedAt: new Date().toISOString(), external: { source: 'Walmart', purchaseOrderId: raw.purchaseOrderId, customerOrderId: raw.customerOrderId, orderType: raw.orderType || '', originalCustomerOrderId: raw.originalCustomerOrderID || '' } };
}

function mergeOrderLines(incoming, existing = []) {
  return incoming.map(line => {
    const old = existing?.find(item => String(item.sourceLineId || item.lineItemId || item.id) === line.sourceLineId);
    return { ...old, ...line, ...(old ? { mappedSku: old.skuMappedAt ? old.mappedSku : line.mappedSku || old.mappedSku, productId: old.skuMappedAt ? old.productId : line.productId || old.productId, cost: old.cost, ...(old.skuMappedAt ? { sku: old.sku, originalSku: line.sku } : {}) } : {}) };
  });
}

module.exports = { createWalmartClient, identifier, taxonomyRows, mapOrder, mergeOrderLines, fail };
