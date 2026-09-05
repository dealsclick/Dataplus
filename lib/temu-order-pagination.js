// Temu limits the size of a search, not just the size of each response page.
async function* temuOrderPages({ request, start, end, pageSize, rowsOf, totalOf, idOf, onWindow = async () => {}, windowSeconds = 7 * 86400, searchLimit = 10000 }) {
  if (![start, end, pageSize, windowSeconds, searchLimit].every(Number.isInteger) || start > end || pageSize < 1 || windowSeconds < 1 || searchLimit < 1) throw new Error('Invalid Temu order search range.');
  const seenOrders = new Set();
  async function* range(from, to) {
    await onWindow({ from, to });
    let fetched = 0;
    const seenPages = new Set();
    const split = async function* () {
      if (from === to) throw new Error(`Temu search limit exceeded within one second (${from}); cannot safely complete this window.`);
      const mid = from + Math.floor((to - from) / 2);
      yield* range(from, mid);
      yield* range(mid + 1, to);
    };
    for (let pageNumber = 1; ; pageNumber++) {
      let response;
      try {
        response = await request({ updateAtStart: from, updateAtEnd: to, pageNumber, pageSize });
      } catch (error) {
        if (/\b21008\b|Search result count exceeds maximum limit/i.test(error.message)) { yield* split(); return; }
        throw error;
      }
      const total = totalOf(response);
      if (Number.isFinite(total) && total >= searchLimit) { yield* split(); return; }
      const rows = rowsOf(response);
      if (!Array.isArray(rows)) throw new Error('Temu returned an invalid order page.');
      const ids = rows.map(idOf);
      if (ids.some(id => !id)) throw new Error('Temu order page contains a missing parent order number.');
      const fingerprint = ids.slice().sort().join(',');
      if (rows.length && seenPages.has(fingerprint)) throw new Error('Temu order pagination repeated a page.');
      seenPages.add(fingerprint);
      fetched += rows.length;
      const unique = rows.filter((row) => {
        const id = idOf(row);
        if (seenOrders.has(id)) return false;
        seenOrders.add(id); return true;
      });
      if (unique.length) yield { response, rows: unique, from, to };
      if (rows.length < pageSize) {
        if (Number.isFinite(total) && fetched < total) throw new Error(`Temu order window ended early: ${fetched} of ${total} results.`);
        return;
      }
      if (Number.isFinite(total) && fetched >= total) return;
    }
  }
  for (let from = start; from <= end; from += windowSeconds) {
    yield* range(from, Math.min(end, from + windowSeconds - 1));
  }
}

module.exports = { temuOrderPages };
