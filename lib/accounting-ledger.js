const crypto = require('node:crypto');

const ACCOUNTS = Object.freeze({
  marketplace_clearing: 'Marketplace clearing', bank: 'Bank', inventory: 'Inventory',
  accounts_payable: 'Accounts payable', sales: 'Product sales', shipping_income: 'Shipping income',
  sales_returns: 'Sales returns', tax_payable: 'Tax payable', cogs: 'Cost of goods sold',
  shipping_expense: 'Shipping label expense', marketplace_fees: 'Marketplace fees'
});
const SCALE = Object.freeze({ USD: 2, CAD: 2, EUR: 2, GBP: 2, AUD: 2, NZD: 2, JPY: 0, KWD: 3 });
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const rows = value => Array.isArray(value) ? value : [];
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id = prefix => `${prefix}-${crypto.randomUUID()}`;
const today = () => new Date().toISOString().slice(0, 10);

function minor(value, currency = 'USD') {
  if (!Object.hasOwn(SCALE, currency)) fail('Unsupported currency; configure a verified currency precision first.');
  const raw = String(value ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) fail('Amounts must be non-negative decimal numbers.');
  const [whole, fraction = ''] = raw.split('.');
  const scale = SCALE[currency];
  if (fraction.length > scale && /[1-9]/.test(fraction.slice(scale))) fail(`Amounts in ${currency} allow ${scale} decimal places.`);
  const amount = BigInt(whole) * (10n ** BigInt(scale)) + BigInt(fraction.slice(0, scale).padEnd(scale, '0') || '0');
  if (amount > 1000000000000n) fail('Amount exceeds the ledger limit.');
  return Number(amount);
}
function decimal(amount, currency) {
  if (!Number.isSafeInteger(amount) || amount < 0 || !Object.hasOwn(SCALE, currency)) fail('Invalid stored ledger amount.');
  const scale = SCALE[currency], str = String(amount).padStart(scale + 1, '0');
  return scale ? `${str.slice(0, -scale)}.${str.slice(-scale)}` : str;
}
function date(value) {
  const valueText = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valueText) || !Number.isFinite(Date.parse(valueText)) || new Date(valueText).toISOString().slice(0, 10) !== valueText) fail('A valid journal date is required.');
  return valueText;
}
function validateLines(lines, currency) {
  if (!Array.isArray(lines) || lines.length < 2 || lines.length > 100) fail('A journal requires 2 to 100 lines.');
  let debit = 0, credit = 0;
  const result = lines.map(line => {
    if (!Object.hasOwn(ACCOUNTS, line.account)) fail('Choose a valid internal account for every line.');
    const dr = minor(line.debit || '0', currency), cr = minor(line.credit || '0', currency);
    if ((dr > 0) === (cr > 0)) fail('Each line needs either a debit or a credit, not both.');
    debit += dr; credit += cr;
    return { account: line.account, debitMinor: dr, creditMinor: cr, description: text(line.description) };
  });
  if (!Number.isSafeInteger(debit) || debit !== credit) fail('Journal debits and credits must balance exactly.');
  return result;
}
function defaultConfig() {
  return { version: 0, closedThrough: '', destinations: [{ id: 'general', name: 'General accounting CSV', mappings: {} }], audit: [] };
}
function emptyLedger(orderId) { return { version: 1, orderId, observations: [], journals: [], batches: [], audit: [] }; }
function audit(ledger, action, actor, reference) {
  ledger.audit.push({ id: id('AUD'), action, actor: text(actor, 150), reference, at: new Date().toISOString() });
}
function updateConfig(current, body, actor) {
  if (body.version !== current.version) fail('Accounting settings changed. Reload before saving.', 409);
  const closedThrough = body.closedThrough ? date(body.closedThrough) : '';
  if (current.closedThrough && closedThrough < current.closedThrough) fail('Closed accounting periods cannot be reopened here.');
  if (closedThrough > today()) fail('Cannot close a future accounting period.');
  if (!Array.isArray(body.destinations) || !body.destinations.length || body.destinations.length > 10) fail('Configure 1 to 10 export destinations.');
  const ids = new Set();
  const destinations = body.destinations.map(destination => {
    const key = text(destination.id, 40), name = text(destination.name, 100);
    if (!/^[a-z0-9_-]+$/.test(key) || !name || ids.has(key)) fail('Destination IDs must be unique and use lowercase letters, digits, underscores or hyphens.');
    ids.add(key);
    return { id: key, name, mappings: Object.fromEntries(Object.keys(ACCOUNTS).map(account => [account, text(object(destination.mappings)[account], 150)])) };
  });
  // Destination identity is retained so removing/recreating it cannot reset duplicate protection.
  if (current.destinations.some(destination => !ids.has(destination.id))) fail('Keep existing destinations; their IDs preserve export history.');
  return { version: current.version + 1, closedThrough, destinations, audit: [...current.audit, { action: 'settings_updated', actor, at: new Date().toISOString(), previousVersion: current.version, before: { closedThrough: current.closedThrough, destinations: current.destinations } }] };
}

function sourceObservations(order, returns = []) {
  const result = [], currency = text(order.currency || 'USD', 3), channel = text(order.source || 'Local');
  const add = (key, kind, value, certainty, sourcePath, reference = {}) => {
    let amountMinor = null;
    try { amountMinor = minor(value, currency); } catch { /* Missing or unsupported values stay unknown. */ }
    result.push({ key: `${order.id}:${key}`, kind, amountMinor, currency, certainty: amountMinor === null ? 'unknown' : certainty, sourcePath, channel, orderNumber: String(order.orderNumber || order.id), ...reference });
  };
  if (channel.toLowerCase() === 'temu') {
    const amount = object(object(order.external).amount), parent = object(amount.parentOrderMap);
    const sales = object(amount.salesProceeds || parent.salesProceeds);
    const major = value => value?.currency === 'USD' && currency === 'USD' && typeof value.amount !== 'boolean' && String(value.amount ?? '').trim() !== '' && Number.isSafeInteger(Number(value.amount)) && Number(value.amount) >= 0 ? decimal(Number(value.amount), 'USD') : undefined;
    add('seller-net', 'Net seller proceeds (already net of deductions)', major(parent.estimatedRevenue || sales.estimatedSettlementTotal), 'estimated', 'external.amount / estimatedRevenue', { postingPolicy: 'reference_only' });
    add('seller-deduction', 'Seller deduction', major(parent.estimatedRevenueDeduction || sales.estimatedDeduction), 'estimated', 'external.amount / estimatedRevenueDeduction', { postingPolicy: 'reference_only' });
    add('base-price', 'Base-price proceeds', major(parent.basePriceTotal), 'reported', 'external.amount.parentOrderMap.basePriceTotal');
    add('shipping-income', 'Shipping proceeds', major(parent.shippingAmountTotal), 'reported', 'external.amount.parentOrderMap.shippingAmountTotal');
    for (const record of returns) {
      const detail = object(object(record.external).detail), summary = object(detail.refundSummary);
      const state = Number(detail.parentAfterSalesStatus ?? record.channelStatusCode);
      add(`return:${record.channelReturnId || record.id}`, 'Buyer refund including tax (not a seller deduction)', major(summary.buyerTotalRefund), state === 5 ? 'reported' : 'pending', 'return.external.detail.refundSummary.buyerTotalRefund', { returnId: record.id, returnReference: record.channelReturnId || record.returnNumber, sourceStatus: state, postingPolicy: 'reference_only' });
    }
  } else {
    add('order-total', 'Order total snapshot', order.total, 'reported', 'order.total', { postingPolicy: 'reference_only' });
    for (const payment of rows(order.payments)) {
      const ref = payment.transactionId || payment.id;
      if (ref) add(`payment:${ref}`, `Payment ${payment.kind || ''}`.trim(), payment.currency && payment.currency !== currency ? undefined : payment.amount, /^(success|completed|paid|captured)$/i.test(payment.status || '') ? 'reported' : 'pending', 'order.payments', { sourceReference: String(ref), occurredAt: payment.createdAt || '', sourceCurrency: payment.currency || currency, ...(/authorization|void|refund/i.test(payment.kind || '') ? { postingPolicy: 'reference_only' } : {}) });
    }
    for (const refund of rows(order.refunds)) {
      const ref = refund.reference || refund.id;
      if (ref) add(`refund:${ref}`, 'Recorded refund', refund.currency && refund.currency !== currency ? undefined : refund.amount, 'reported', 'order.refunds', { sourceReference: String(ref), occurredAt: refund.refundedAt || refund.createdAt || '', sourceCurrency: refund.currency || currency });
    }
    for (const record of returns) add(`return:${record.channelReturnId || record.id}`, 'Return refund snapshot', record.currency && record.currency !== currency ? undefined : record.actualRefundAmount, record.refundAmountUnverified ? 'unknown' : 'reported', 'return.actualRefundAmount', { returnId: record.id, returnReference: record.channelReturnId || record.returnNumber, postingPolicy: 'reference_only' });
  }
  add('label-cost', 'Shipping label cost', order.shippingCost, 'reported', 'order.shippingCost');
  add('cogs', 'Estimated product cost', object(order.profitLoss).estimatedCogs, 'estimated', 'order.profitLoss.estimatedCogs');
  return result;
}
function observe(ledger, order, returns, actor) {
  let added = 0;
  const current = sourceObservations(order, returns);
  const latest = [...new Map(ledger.observations.map(row => [row.key, row])).values()];
  for (const previous of latest) {
    if (!current.some(row => row.key === previous.key)) {
      const { id: previousId, fingerprint, capturedAt, ...removed } = previous;
      current.push({ ...removed, amountMinor: null, certainty: 'unknown', sourceStatus: 'removed_from_source' });
    }
  }
  for (const observation of current) {
    const fingerprint = digest(observation);
    if (ledger.observations.findLast(row => row.key === observation.key)?.fingerprint === fingerprint) continue;
    ledger.observations.push({ ...observation, id: id('OBS'), fingerprint, capturedAt: new Date().toISOString() }); added++;
  }
  if (ledger.observations.length > 5000) fail('This order requires ledger history archival before further capture.', 409);
  if (added) audit(ledger, 'source_captured', actor, String(added));
  return { added };
}
function journal(ledger, journalId) {
  return ledger.journals.find(row => row.id === journalId) || fail('Journal not found.', 404);
}
function requestKey(body) {
  const key = text(body.requestId, 100);
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(key)) fail('A stable request ID is required.');
  return key;
}
function createDraft(ledger, body, actor, order) {
  const requestId = requestKey(body), requestHash = digest(body);
  const prior = ledger.journals.find(row => row.requestId === requestId);
  if (prior) { if (prior.requestHash !== requestHash) fail('Request ID was already used for a different journal.', 409); return prior; }
  const currency = text(body.currency, 3).toUpperCase(), description = text(body.description, 1000), evidence = text(body.evidence, 2000);
  if (!description || !evidence) fail('Describe the event and provide its supporting reference or review evidence.');
  const sourceIds = [...new Set(rows(body.sourceIds).map(String))];
  if (sourceIds.length > 100 || sourceIds.some(key => !ledger.observations.some(row => row.id === key))) fail('Source observation not found. Capture sources again.');
  const adjusts = body.adjusts ? journal(ledger, body.adjusts) : null;
  if (adjusts && adjusts.status !== 'posted') fail('Only posted entries can be adjusted.');
  if (body.returnId && !ledger.observations.some(row => row.returnId === body.returnId)) fail('Return reference must belong to this order.');
  const record = { id: id('DPJ'), requestId, requestHash, orderId: ledger.orderId, orderNumber: String(order.orderNumber || order.id), channel: text(order.source), returnId: text(body.returnId), date: date(body.date), currency, description, evidence, sourceIds, adjusts: adjusts?.id || '', lines: validateLines(body.lines, currency), status: 'draft', createdAt: new Date().toISOString(), createdBy: actor };
  ledger.journals.push(record); audit(ledger, 'draft_created', actor, record.id);
  return record;
}
function post(ledger, journalId, body, actor, config) {
  const record = journal(ledger, journalId);
  if (record.status === 'posted') return record;
  if (record.status !== 'draft') fail('Only draft entries can be posted.', 409);
  if (body.confirm !== true) fail('Confirm that accounts, source amounts, and supporting evidence were reviewed.');
  if (record.date > today() || (config.closedThrough && record.date <= config.closedThrough)) fail('Journal date is in a closed or future period.');
  for (const sourceId of record.sourceIds) {
    const source = ledger.observations.find(row => row.id === sourceId);
    const latest = ledger.observations.findLast(row => row.key === source.key);
    if (latest.id !== source.id) fail('The source changed. Discard this draft and review the latest observation.', 409);
    if (source.currency !== record.currency) fail('Journal and source currencies differ. Currency conversion requires a separately documented manual adjustment.');
    if (['pending', 'unknown'].includes(source.certainty)) fail('Pending or unknown source amounts cannot be posted.');
    if (source.postingPolicy === 'reference_only') fail('Aggregate balances and buyer refund snapshots are reference-only. Use a separately evidenced journal for the actual accounting event.');
    const previous = ledger.journals.find(row => row.status === 'posted' && row.id !== record.id && row.sourceIds.some(key => ledger.observations.find(item => item.id === key)?.key === source.key));
    if (previous && previous.id !== record.adjusts) fail('This source already has a posted journal. Create an explicit adjustment linked to that journal instead.', 409);
  }
  record.status = 'posted'; record.postedAt = new Date().toISOString(); record.postedBy = actor;
  audit(ledger, 'journal_posted', actor, record.id); return record;
}
function discard(ledger, journalId, actor) {
  const record = journal(ledger, journalId);
  if (record.status !== 'draft') fail('Posted journals are immutable. Use a reversal or adjustment.', 409);
  record.status = 'discarded'; audit(ledger, 'draft_discarded', actor, record.id); return record;
}
function reverse(ledger, journalId, body, actor, config) {
  const original = journal(ledger, journalId);
  const existing = ledger.journals.find(row => row.reverses === original.id);
  if (existing) return existing;
  if (original.status !== 'posted' || original.reverses) fail('Only an original posted journal can be reversed.');
  if (!text(body.reason) || body.confirm !== true) fail('A reason and explicit reversal confirmation are required.');
  const reversalRequest = requestKey(body);
  if (ledger.journals.some(row => row.requestId === reversalRequest)) fail('Request ID already belongs to another journal.', 409);
  const reversalDate = date(body.date);
  if (reversalDate > today() || reversalDate < original.date || (config.closedThrough && reversalDate <= config.closedThrough)) fail('Choose an open reversal date on or after the original journal date.');
  const record = { ...original, id: id('DPJ'), requestId: reversalRequest, requestHash: digest(body), description: `Reversal: ${original.description}`, evidence: text(body.reason, 2000), sourceIds: [], adjusts: '', reverses: original.id, lines: original.lines.map(line => ({ ...line, debitMinor: line.creditMinor, creditMinor: line.debitMinor })), createdBy: actor, postedBy: actor, createdAt: new Date().toISOString(), postedAt: new Date().toISOString(), date: reversalDate };
  ledger.journals.push(record); audit(ledger, 'journal_reversed', actor, record.id); return record;
}
function csvCell(value) {
  let valueText = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(valueText) || /^[\t\r\n]/.test(valueText)) valueText = `'${valueText}`;
  return `"${valueText.replaceAll('"', '""')}"`;
}
function batchCsv(batch) {
  const data = [['Batch ID', 'Journal ID', 'Date', 'Account key', 'Account name', 'Debit', 'Credit', 'Currency', 'Order ID', 'Order number', 'Channel', 'Return ID', 'Source observation IDs', 'Description', 'Evidence', 'Reverses', 'Adjusts']];
  for (const entry of batch.entries) for (const line of entry.lines) data.push([batch.id, entry.id, entry.date, line.account, batch.mappings[line.account], decimal(line.debitMinor, entry.currency), decimal(line.creditMinor, entry.currency), entry.currency, entry.orderId, entry.orderNumber, entry.channel, entry.returnId, entry.sourceIds.join(';'), line.description || entry.description, entry.evidence, entry.reverses || '', entry.adjusts || '']);
  return data.map(row => row.map(csvCell).join(',')).join('\r\n');
}
function exportBatch(ledger, body, actor, config) {
  const requestId = requestKey(body), requestHash = digest(body);
  const prior = ledger.batches.find(batch => batch.requestId === requestId);
  if (prior) { if (prior.requestHash !== requestHash) fail('Request ID already belongs to a different export.', 409); return prior; }
  const destination = config.destinations.find(row => row.id === body.destinationId);
  if (!destination) fail('Configure an export destination first.');
  const selected = [...new Set(rows(body.journalIds).map(String))];
  if (!selected.length || selected.length > 500) fail('Select 1 to 500 posted entries.');
  const entries = selected.map(key => journal(ledger, key));
  const previouslyExported = journalId => ledger.batches.some(batch => batch.destinationId === destination.id && batch.entries.some(entry => entry.id === journalId));
  for (const record of entries) {
    if (record.status !== 'posted') fail('Only posted entries can be exported.');
    if (ledger.batches.some(batch => batch.destinationId === destination.id && batch.entries.some(entry => entry.id === record.id))) fail('An entry was already exported to this destination. Download its original batch instead.', 409);
    if (record.lines.some(line => !destination.mappings[line.account])) fail('Map all used accounts before exporting.');
    const originalId = record.reverses || record.adjusts;
    if (originalId && !selected.includes(originalId) && !previouslyExported(originalId)) fail('Include the original journal or export it first to this destination.');
    const reversal = ledger.journals.find(entry => entry.reverses === record.id);
    if (reversal && !selected.includes(reversal.id) && !previouslyExported(reversal.id)) fail('Include the reversal with the original journal in this export.');
  }
  const batch = { id: id('EXP'), requestId, requestHash, destinationId: destination.id, destinationName: destination.name, mappingVersion: config.version, mappings: structuredClone(destination.mappings), entries: structuredClone(entries), createdAt: new Date().toISOString(), createdBy: actor, status: 'exported' };
  batch.checksum = digest(batchCsv(batch));
  ledger.batches.push(batch); audit(ledger, 'batch_exported', actor, batch.id); return batch;
}
function confirmImport(ledger, batchId, body, actor) {
  const batch = ledger.batches.find(row => row.id === batchId) || fail('Export batch not found.', 404);
  if (!text(body.reference)) fail('Enter the accounting system import reference.');
  if (batch.importedAt) {
    if (batch.importReference !== text(body.reference)) fail('This batch already has a different confirmed import reference.', 409);
    return batch;
  }
  batch.importedAt = new Date().toISOString(); batch.importedBy = actor; batch.importReference = text(body.reference);
  audit(ledger, 'import_confirmed', actor, batch.id); return batch;
}
module.exports = { ACCOUNTS, SCALE, minor, decimal, validateLines, defaultConfig, emptyLedger, updateConfig, sourceObservations, observe, createDraft, post, discard, reverse, exportBatch, batchCsv, confirmImport, fail };
