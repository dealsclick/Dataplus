const { fail } = require('./walmart-client');
const XLSX = require('xlsx');
const key = s => String(s).replace(/^\uFEFF/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
function parseReport(buffer) {
  let csv = buffer;
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    const zip = XLSX.CFB.read(buffer, { type: 'buffer' });
    const files = zip.FileIndex.filter(f => /\.csv$/i.test(f.name));
    if (files.length !== 1) throw fail('Walmart report must contain one CSV file.');
    csv = Buffer.from(files[0].content);
  }
  if (csv.length > 256 * 1024 * 1024) throw fail('Walmart item report exceeds the import size limit.');
  const book = XLSX.read(csv.toString('utf8'), { type: 'string', raw: true });
  const table = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, raw: true, defval: '' });
  const headers = (table.shift() || []).map(key);
  const column = (...names) => names.map(key).map(n => headers.indexOf(n)).find(i => i >= 0);
  const sku = column('SKU'), status = column('Publish Status', 'Published Status');
  if (sku === undefined || status === undefined) throw fail('Walmart report is missing SKU or Publish Status. No links applied.');
  return table.filter(row => row.some(v => String(v).trim())).map(row => {
    const get = (...names) => String(row[column(...names)] ?? '').trim();
    const url = get('Item Page URL'), id = get('Item ID') || url.match(/\/(\d+)(?:[?#].*)?$/)?.[1] || '';
    const price = get('Price'), lag = get('Fulfillment Lag Time');
    return { sku: get('SKU'), upc: get('UPC'), gtin: get('GTIN'), wpid: get('WPID'), itemId: id,
      itemPageUrl: /^https:\/\/(www\.)?walmart\.com\//i.test(url) ? url : '',
      publishedStatus: get('Publish Status', 'Published Status').toUpperCase() || 'UNVERIFIED', lifecycleStatus: get('Lifecycle Status'),
      price: price !== '' && Number.isFinite(Number(price)) ? { amount: Number(price), currency: get('Currency') || 'USD' } : null,
      fulfillmentLagTime: lag !== '' && Number.isInteger(Number(lag)) && Number(lag) >= 0 ? Number(lag) : null,
      unpublishedReasons: [get('Status Change Reason', 'Unpublished Reason')].filter(Boolean), source: 'item-report' };
  });
}
async function itemReport({client, job, read, write, check, persist, pause = ms => new Promise(r => setTimeout(r, ms)), fetchImpl = fetch}) {
  const doc = `walmart.item-report.${job.id}`;
  let state = await read(doc);
  if (!state?.requestId) {
    await check();
    const response = await client.request('/v3/reports/reportRequests?reportType=ITEM&reportVersion=v6', { method: 'POST', body: {}, jobId: job.id });
    if (!response.requestId) throw fail('Walmart returned no item report request ID.');
    state = { requestId: response.requestId, requestedAt: new Date().toISOString() };
    await write(doc, state);
  }
  for (let attempt = 0; attempt < 60; attempt++) {
    await check();
    const result = await client.request(`/v3/reports/reportRequests/${encodeURIComponent(state.requestId)}`, {jobId: job.id});
    const status = result.requestStatus || result.status;
    await persist({phase: 'item-report', message: `Walmart Item Report ${status}; waiting for seller listing snapshot.`});
    if (status === 'READY') {
      const download = await client.request(`/v3/reports/downloadReport?requestId=${encodeURIComponent(state.requestId)}`, {jobId: job.id});
      const url = new URL(download.downloadURL || download.downloadUrl);
      if (url.protocol !== 'https:' || url.username || url.password || !/(^|\.)(walmart\.com|walmartapis\.com|walmartimages\.com|blob\.core\.windows\.net|amazonaws\.com)$/.test(url.hostname)) throw fail('Unsupported Walmart report download host.');
      await check();
      const response = await fetchImpl(url, {redirect:'error', signal:AbortSignal.timeout(120000)});
      if (!response.ok) throw fail(`Walmart report download HTTP ${response.status}.`);
      let size = 0; const chunks = [];
      for await (const chunk of response.body) { size += chunk.length; if (size > 64 * 1024 * 1024) throw fail('Walmart report download exceeds size limit.'); chunks.push(chunk); }
      const rows = parseReport(Buffer.concat(chunks));
      await check(); await write(doc, {...state, status:'READY', downloadedAt:new Date().toISOString(), count:rows.length});
      return rows;
    }
    if (['ERROR','FAILED','CANCELLED','CANCELED'].includes(status)) throw fail(`Walmart Item Report ${status}.`);
    await pause(30000);
  }
  throw fail('Walmart Item Report is still generating. Retry this job to reuse the saved request.');
}
module.exports = {parseReport, itemReport};
