async function boundedCatalogCount(pool, sql, params, { preferBitmap = false } = {}) {
  const client = await pool.connect();
  try {
    await client.query('begin read only');
    await client.query("set local statement_timeout = '8000ms'");
    // Broad eBay partial indexes have poor selectivity estimates. Reading their heap
    // rows in physical order avoids random I/O across nearly the entire catalog.
    // This setting is transaction-local; paginated SKU queries keep their ordered scans.
    if (preferBitmap) await client.query('set local enable_indexscan = off');
    const result = await client.query(sql, params);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    if (error.code === '57014') return { rows: [], timedOut: true };
    throw error;
  } finally {
    client.release();
  }
}
module.exports = { boundedCatalogCount };
