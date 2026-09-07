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
    async overview({ category = '', page = 1 } = {}) {
      if (!['', 'missing_cost', 'pending_refund', 'estimated'].includes(category)) fail('Invalid accounting review category.');
      if (!Number.isSafeInteger(page) || page < 1 || page > 100000) fail('Invalid page.');
      const result = await pool().query(`
        with documents as (
          select data from accounting_documents where doc_key like 'accounting:order:v1:%'
        ), latest as (
          select d.data->>'orderId' as "orderId", o.value as source
          from documents d cross join lateral (
            select distinct on (value->>'key') value
            from jsonb_array_elements(coalesce(d.data->'observations', '[]')) with ordinality
            order by value->>'key', ordinality desc
          ) o
        ), findings as (
          select "orderId", source->>'id' as id, source->>'orderNumber' as "orderNumber",
            source->>'kind' as kind, source->>'channel' as channel,
            source->>'capturedAt' as "capturedAt", source->>'returnId' as "returnId",
            case
              when source->>'key' in ("orderId" || ':label-cost', "orderId" || ':cogs')
                and (source->>'amountMinor' is null or source->>'certainty' = 'unknown') then 'missing_cost'
              when source->>'certainty' = 'pending' and (source->>'kind' ilike '%refund%' or source->>'returnId' is not null) then 'pending_refund'
              when source->>'certainty' = 'estimated' then 'estimated'
            end as category
          from latest
        ), filtered as (select * from findings where category is not null and ($1 = '' or category = $1)),
        page_rows as (select * from filtered order by "capturedAt" desc, "orderId", id limit 50 offset $2)
        select
          (select count(*)::int from documents) as "ledgerCount",
          (select count(*)::int from documents where jsonb_array_length(coalesce(data->'observations', '[]')) > 0) as "capturedLedgerCount",
          (select count(*)::int from documents d cross join lateral jsonb_array_elements(coalesce(d.data->'journals', '[]')) j where j->>'status' = 'draft') as "draftCount",
          (select count(*)::int from documents d cross join lateral jsonb_array_elements(coalesce(d.data->'batches', '[]')) b where b->>'importedAt' is null) as "unconfirmedBatchCount",
          (select count(*)::int from findings where category = 'missing_cost') as "missingCostCount",
          (select count(*)::int from findings where category = 'pending_refund') as "pendingRefundCount",
          (select count(*)::int from findings where category = 'estimated') as "estimatedCount",
          (select count(*)::int from filtered) as total,
          coalesce((select jsonb_agg(page_rows) from page_rows), '[]'::jsonb) as rows
      `, [category, (page - 1) * 50]);
      return { ...result.rows[0], page, pageSize: 50 };
    },
    async list({ kind = 'journals', status = '', query = '', from = '', to = '', page = 1 } = {}) {
      if (!['journals', 'batches'].includes(kind)) fail('Invalid ledger view.');
      if (!Number.isSafeInteger(page) || page < 1 || page > 100000) fail('Invalid page.');
      for (const date of [from, to]) if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)))) fail('Invalid date filter.');
      if (from && to && from > to) fail('Start date must precede end date.');
      if (!['', 'draft', 'posted', 'discarded', 'exported', 'imported'].includes(status)) fail('Invalid status.');
      const result = await pool().query(`
        with records as (
          select d.data->>'orderId' as "orderId", r->>'id' as id,
            coalesce(r->>'orderNumber', r->'entries'->0->>'orderNumber', d.data->>'orderId') as "orderNumber",
            coalesce(r->>'channel', r->'entries'->0->>'channel', '') as channel,
            coalesce(r->>'date', left(r->>'createdAt', 10)) as date,
            coalesce(r->>'description', r->>'destinationName', '') as description,
            case when $1 = 'batches' then case when r->>'importedAt' is null then 'exported' else 'imported' end else r->>'status' end as status,
            coalesce(r->>'currency', (select string_agg(distinct e->>'currency', ', ' order by e->>'currency') from jsonb_array_elements(coalesce(r->'entries', '[]'::jsonb)) e), '') as currency,
            r->>'checksum' as checksum
          from accounting_documents d
          cross join lateral jsonb_array_elements(coalesce(d.data->$1, '[]'::jsonb)) r
          where d.doc_key like 'accounting:order:v1:%'
        ), filtered as (
          select * from records where ($2 = '' or status = $2)
            and ($3 = '' or position(lower($3) in lower(concat_ws(' ', id, "orderNumber", "orderId", channel, description))) > 0)
            and ($4 = '' or date >= $4) and ($5 = '' or date <= $5)
        ), page_rows as (select * from filtered order by date desc, "orderId", id limit 50 offset $6)
        select (select count(*) from filtered)::int as total,
          coalesce((select jsonb_agg(page_rows) from page_rows), '[]'::jsonb) as rows
      `, [kind, status, String(query).slice(0, 200), from, to, (page - 1) * 50]);
      return { ...result.rows[0], page, pageSize: 50 };
    },
    readOrder: orderId => read(orderKey(orderId), () => emptyLedger(orderId)),
    readConfig: () => read(configKey, defaultConfig),
    mutateOrder: (orderId, work) => transact(orderKey(orderId), () => emptyLedger(orderId), work, true),
    mutateConfig: work => transact(configKey, defaultConfig, async state => {
      const next = await work(state); Object.assign(state, next); return state;
    })
  };
}
module.exports = { createAccountingStore };
