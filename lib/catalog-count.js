const filterGroups = [
  ['supplier'], ['multipleSuppliers'], ['active'], ['hasStock'], ['hasImage'],
  ['toBeDiscontinued'], ['brand'], ['manufacturer'], ['category'], ['stockStatus'],
  ['stockQty'], ['inventoryAvailability'], ['lowStock'], ['replenishable'],
  ['createdFrom', 'createdTo'], ['creationSource'], ['warehouse'], ['hazardous'],
  ['verifiedBrand'], ['channelStatus', 'channelStatusAll'], ['shippingClass']
];

function catalogCountTimeoutMs(filters = {}) {
  const populated = value => Array.isArray(value)
    ? value.some(populated)
    : value !== undefined && value !== null && String(value).split('|').some(part => part.trim() !== '');
  // Count logical user filters, not date endpoints or internal supplier-scope lists.
  const count = filterGroups.filter(keys => keys.some(key => populated(filters[key]))).length;
  return count > 5 ? 30000 : count > 3 ? 20000 : 8000;
}

async function boundedCatalogCount(pool, sql, params, { preferBitmap = false, filters = {}, background = false } = {}) {
  const client = await pool.connect();
  try {
    await client.query('begin read only');
    const timeoutMs = background ? 120000 : catalogCountTimeoutMs(filters);
    await client.query(`set local statement_timeout = '${timeoutMs}ms'`);
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
module.exports = { boundedCatalogCount, catalogCountTimeoutMs };
