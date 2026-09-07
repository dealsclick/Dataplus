const ledger = require('./accounting-ledger');

function accountingPermission(method, pathname) {
  if (/^GET$|^HEAD$/.test(method)) return pathname.endsWith('.csv') ? 'export' : 'view';
  if (pathname.endsWith('/settings')) return 'configure';
  if (pathname.endsWith('/post')) return 'post';
  if (pathname.endsWith('/reverse')) return 'reverse';
  if (/\/exports(\/|$)/.test(pathname)) return 'export';
  return 'create';
}
function createAccountingHandler({ store, readOrder, readReturns, enrichOrder, parseBody, sendJson, sendCsv, can }) {
  return async function handle(req, res, url, user) {
    const actor = `${user.id}:${user.name || user.username || 'User'}`;
    const parts = url.pathname.split('/').filter(Boolean), action = accountingPermission(req.method, url.pathname);
    if (!can(user, 'orders.accounting', action)) return sendJson(res, 403, { error: `Accounting ${action} permission is required.` });
    try {
      if (req.method === 'GET' && parts[2] === 'overview' && parts.length === 3) {
        return sendJson(res, 200, await store.overview({ category: url.searchParams.get('category') || '', page: Number(url.searchParams.get('page') || 1) }));
      }
      if (req.method === 'GET' && parts[2] === 'records' && parts.length === 3) {
        return sendJson(res, 200, await store.list({ kind: url.searchParams.get('kind') || 'journals', status: url.searchParams.get('status') || '', query: url.searchParams.get('q') || '', from: url.searchParams.get('from') || '', to: url.searchParams.get('to') || '', page: Number(url.searchParams.get('page') || 1) }));
      }
      if (parts[2] === 'settings' && parts.length === 3) {
        if (req.method === 'GET') return sendJson(res, 200, { config: await store.readConfig(), accounts: ledger.ACCOUNTS, currencies: ledger.SCALE, ledger: { observations: [], journals: [], batches: [], audit: [] }, can: { configure: can(user, 'orders.accounting', 'configure') } });
        if (req.method === 'PUT') {
          const body = await parseBody(req);
          return sendJson(res, 200, { config: await store.mutateConfig(current => ledger.updateConfig(current, body, actor)) });
        }
      }
      if (parts[2] !== 'orders' || !parts[3]) return sendJson(res, 404, { error: 'Accounting route not found.' });
      const key = decodeURIComponent(parts[3]);
      let order = await readOrder(key);
      const sourceMissing = !order;
      if (!order) {
        const retained = await store.readOrder(key);
        const original = retained.journals[0];
        if (!original) return sendJson(res, 404, { error: 'Order not found.' });
        order = { id: key, orderNumber: original.orderNumber, source: original.channel };
      }
      const orderId = String(order.id);
      if (req.method === 'GET' && parts.length === 4) return sendJson(res, 200, {
        ledger: await store.readOrder(orderId), config: await store.readConfig(), accounts: ledger.ACCOUNTS, currencies: ledger.SCALE,
        can: Object.fromEntries(['create', 'post', 'reverse', 'export', 'configure'].map(permission => [permission, can(user, 'orders.accounting', permission)]))
      });
      if (req.method === 'GET' && parts[4] === 'exports' && parts[5]?.endsWith('.csv') && parts.length === 6) {
        const state = await store.readOrder(orderId), batch = state.batches.find(row => row.id === parts[5].slice(0, -4));
        if (!batch) return sendJson(res, 404, { error: 'Batch not found.' });
        return sendCsv(res, ledger.batchCsv(batch), `${batch.id}.csv`);
      }
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });
      const body = await parseBody(req);
      // Capture only stored order data. Never call channel APIs or modify the source order.
      const needsSource = ['capture', 'journals'].includes(parts[4]) && (parts.length === 5 || parts[6] === 'post');
      if (needsSource && sourceMissing) return sendJson(res, 409, { error: 'The source order is no longer available. Retained journals can still be downloaded or reversed, but source capture and new posting are blocked.' });
      const relatedReturns = needsSource ? (await readReturns(order)).filter(record => record.orderId === orderId || (record.orderNumber && order.orderNumber && record.orderNumber === order.orderNumber)) : [];
      const enriched = needsSource ? await enrichOrder(order) : order;
      const result = await store.mutateOrder(orderId, (state, config) => {
        if (parts[4] === 'capture' && parts.length === 5) return ledger.observe(state, enriched, relatedReturns, actor);
        if (parts[4] === 'journals') {
          if (parts.length === 5) { ledger.observe(state, enriched, relatedReturns, actor); return ledger.createDraft(state, body, actor, order); }
          if (parts.length === 7 && parts[6] === 'post') { ledger.observe(state, enriched, relatedReturns, actor); return ledger.post(state, parts[5], body, actor, config); }
          if (parts.length === 7 && parts[6] === 'discard') return ledger.discard(state, parts[5], actor);
          if (parts.length === 7 && parts[6] === 'reverse') return ledger.reverse(state, parts[5], body, actor, config);
        }
        if (parts[4] === 'exports') {
          if (parts.length === 5) return ledger.exportBatch(state, body, actor, config);
          if (parts.length === 7 && parts[6] === 'confirm') return ledger.confirmImport(state, parts[5], body, actor);
        }
        ledger.fail('Accounting route not found.', 404);
      });
      return sendJson(res, 200, { result });
    } catch (error) { return sendJson(res, error.status || 500, { error: error.status ? error.message : 'Accounting operation failed. No partial journal or export was saved.' }); }
  };
}
module.exports = { createAccountingHandler, accountingPermission };
