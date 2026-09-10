async function boundedCatalogCount(pool, sql, params) {
  const client = await pool.connect();
  try {
    await client.query('begin read only');
    await client.query("set local statement_timeout = '8000ms'");
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
