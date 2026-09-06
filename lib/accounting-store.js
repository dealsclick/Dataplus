const { defaultConfig, emptyLedger, fail } = require('./accounting-ledger');

// Financial records are isolated from marketplace order upserts and broad state rewrites.
function createAccountingStore(getPool) {
  const pool = () => getPool() || fail('The shared ledger requires PostgreSQL. No file fallback is used for accounting.', 503);
  const configKey = 'accounting:configuration:v1';
  const orderKey = orderId => `accounting:order:v1:${orderId}`;
  async function read(key, fallback) {
    const result = await pool().query('select data from accounting_documents where doc_key = $1', [key]);
    return result.rows[0]?.data || fallback();
  }
  async function transact(key, fallback, work, includeConfig = false) {
    const client = await pool().connect();
    try {
      await client.query('begin');
      await client.query("set local lock_timeout = '5s'");
      let config;
      if (includeConfig) {
        await client.query('insert into accounting_documents(doc_key, data) values ($1, $2::jsonb) on conflict do nothing', [configKey, JSON.stringify(defaultConfig())]);
        config = (await client.query('select data from accounting_documents where doc_key = $1 for share', [configKey])).rows[0].data;
      }
      await client.query('insert into accounting_documents(doc_key, data) values ($1, $2::jsonb) on conflict do nothing', [key, JSON.stringify(fallback())]);
      const state = (await client.query('select data from accounting_documents where doc_key = $1 for update', [key])).rows[0].data;
      const result = await work(state, config);
      const encoded = JSON.stringify(state);
      if (Buffer.byteLength(encoded) > 10 * 1024 * 1024) fail('Ledger document exceeds the safe transaction size. Export history needs archival.', 409);
      await client.query('update accounting_documents set data = $2::jsonb, updated_at = now() where doc_key = $1', [key, encoded]);
      await client.query('commit');
      return result;
    } catch (error) { await client.query('rollback'); throw error; }
    finally { client.release(); }
  }
  return {
    readOrder: orderId => read(orderKey(orderId), () => emptyLedger(orderId)),
    readConfig: () => read(configKey, defaultConfig),
    mutateOrder: (orderId, work) => transact(orderKey(orderId), () => emptyLedger(orderId), work, true),
    mutateConfig: work => transact(configKey, defaultConfig, async state => {
      const next = await work(state); Object.assign(state, next); return state;
    })
  };
}
module.exports = { createAccountingStore };
