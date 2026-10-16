const crypto = require('crypto');
const XLSX = require('xlsx');

const DEFAULT_POLICIES = [
  { channel: 'Walmart', percentRate: 15, fixedFee: 0, sourceNote: 'Starter estimate; Walmart referral fees vary by product category.' },
  { channel: 'Shopify', percentRate: 2.9, fixedFee: 0.30, sourceNote: 'Starter US online-card estimate; actual Shopify Payments rates vary by plan and card type.' },
  { channel: 'eBay', percentRate: 13.6, fixedFee: 0.40, sourceNote: 'Starter estimate for a common US category; eBay fees vary by category, store, promotions, and order value.' },
  { channel: 'Temu', percentRate: 0, fixedFee: 0, sourceNote: 'Configuration required; use the contracted seller rate or imported settlement fees.' }
];

function clean(value, max = 240) { return String(value ?? '').trim().slice(0, max); }
function money(value) {
  if (value === '' || value == null) return null;
  const parsed = Number(String(value).replace(/[$,()]/g, match => match === '(' ? '-' : match === ')' ? '' : ''));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}
function parseCsv(text = '') {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i], next = text[i + 1];
    if (char === '"' && quoted && next === '"') { field += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(field); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(field); if (row.some(cell => cell.trim())) rows.push(row); row = []; field = '';
    } else field += char;
  }
  row.push(field); if (row.some(cell => cell.trim())) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map(value => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  return rows.slice(1).map(cells => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])));
}
function first(row, names) { for (const name of names) if (row[name] != null && clean(row[name])) return row[name]; return ''; }
function normalizedHeader(value) { return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); }
function parseWorkbook(base64 = '') {
  const workbook = XLSX.read(Buffer.from(String(base64), 'base64'), { type: 'buffer', cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  if (matrix.length < 2) return [];
  const headers = matrix[0].map(normalizedHeader);
  return matrix.slice(1).filter(cells => cells.some(cell => clean(cell))).map(cells => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])));
}
function temuShippingType(value) {
  const type = clean(value, 160).toLowerCase();
  const map = {
    'shipping label purchase': { feeType: 'outbound_label_purchase', outbound: true, adjustment: false },
    'shipping label purchase adjustment': { feeType: 'outbound_label_adjustment', outbound: true, adjustment: true },
    'shipping label for return purchase': { feeType: 'return_label_purchase', outbound: false, adjustment: false },
    'shipping label for return purchase adjustment': { feeType: 'return_label_adjustment', outbound: false, adjustment: true },
    'shipping label for return purchase covered by platform': { feeType: 'return_label_platform_credit', outbound: false, adjustment: false },
    'shipping label for return purchase adjustment covered by platform': { feeType: 'return_label_platform_adjustment', outbound: false, adjustment: true }
  };
  return map[type] || null;
}
function normalizeTemuShippingRows(rows = []) {
  const occurrences = new Map();
  return rows.flatMap((row) => {
    const transactionType = clean(first(row, ['transaction_type', 'type']), 160);
    const classification = temuShippingType(transactionType);
    if (!classification) return [];
    const orderReference = clean(first(row, ['order_id', 'order_number', 'channel_order_id', 'marketplace_order_id']), 160);
    const trackingNumber = clean(first(row, ['related_id', 'tracking_number', 'tracking']), 160);
    const sourceAmount = money(first(row, ['total', 'other', 'others', 'amount']));
    if (sourceAmount == null) return [];
    const transactionAt = clean(first(row, ['date_time', 'date', 'transaction_date']), 64);
    const fingerprint = [transactionAt, transactionType, orderReference, trackingNumber, sourceAmount, clean(first(row, ['currency']), 8)].join('|');
    const occurrence = (occurrences.get(fingerprint) || 0) + 1;
    occurrences.set(fingerprint, occurrence);
    return [{
      ...classification,
      transactionType,
      orderReference,
      trackingNumber,
      transactionAt,
      currency: clean(first(row, ['currency']), 8) || 'USD',
      amount: Math.round(-sourceAmount * 100) / 100,
      externalLineId: `temu:${crypto.createHash('sha256').update(`${fingerprint}|${occurrence}`).digest('hex')}`,
      raw: row
    }];
  });
}
function isTemuDetailedReport(channel, rows = []) {
  if (clean(channel).toLowerCase() !== 'temu' || !rows.length) return false;
  const keys = new Set(Object.keys(rows[0] || {}));
  return keys.has('transaction_type') && keys.has('related_id') && keys.has('order_id') && (keys.has('total') || keys.has('others'));
}
function isTemuAdjustmentSummary(channel, rows = []) {
  if (clean(channel).toLowerCase() !== 'temu' || !rows.length) return false;
  const keys = new Set(Object.keys(rows[0] || {}));
  return keys.has('transaction_type') && keys.has('order_id') && !keys.has('related_id')
    && rows.some(row => temuShippingType(first(row, ['transaction_type', 'type'])) && /^DO\d+$/i.test(clean(first(row, ['order_id']))));
}

function createChannelFeeStore(getPool, options = {}) {
  const pool = () => {
    const value = getPool();
    if (!value) throw Object.assign(new Error('Channel fee reconciliation requires PostgreSQL.'), { status: 503 });
    return value;
  };
  const notifyOrdersChanged = async orderIds => {
    const ids = [...new Set((orderIds || []).map(value => clean(value, 160)).filter(Boolean))];
    if (ids.length && typeof options.onOrdersChanged === 'function') {
      try { await options.onOrdersChanged(ids); }
      catch (error) { console.warn(`Unable to invalidate ${ids.length} order financial cache entr${ids.length === 1 ? 'y' : 'ies'}: ${error.message}`); }
    }
  };
  async function seed(scope) {
    for (const policy of DEFAULT_POLICIES) {
      await pool().query(`insert into channel_fee_policies
        (tenant_id, company_id, channel, percent_rate, fixed_fee, source_note)
        values ($1,$2,$3,$4,$5,$6) on conflict do nothing`,
      [scope.tenantId, scope.companyId, policy.channel, policy.percentRate, policy.fixedFee, policy.sourceNote]);
    }
  }
  async function scheduleStatus() {
    const result = await pool().query("select data from state_documents where doc_key='channelSettlementSchedules'").catch(() => ({ rows: [] }));
    const saved = result.rows[0]?.data && typeof result.rows[0].data === 'object' ? result.rows[0].data : {};
    const connections = (await pool().query("select data from entity_documents where collection='connections' and lower(data->>'name') in ('walmart','ebay','shopify')").catch(() => ({ rows: [] }))).rows.map(row => row.data);
    const configured = channel => connections.find(row => clean(row?.name, 80).toLowerCase() === channel.toLowerCase());
    const enabled = (channel, field) => {
      const connection = configured(channel), settings = connection?.settings || {};
      return Boolean(connection) && settings.channelEnabled === true && settings[field] !== false;
    };
    return [
      { channel: 'Walmart', cadence: 'Daily report discovery', scheduleTime: '06:30', timezone: 'America/New_York', ...saved.walmart, enabled: enabled('Walmart', 'walmartSettlementImportEnabled') },
      { channel: 'eBay', cadence: 'Daily payout discovery', scheduleTime: '07:00', timezone: 'America/New_York', ...saved.ebay, enabled: enabled('eBay', 'ebaySettlementImportEnabled') },
      { channel: 'Shopify', cadence: 'Daily Shopify Payments payout discovery', scheduleTime: '07:30', timezone: 'America/New_York', ...saved.shopify, enabled: enabled('Shopify', 'shopifySettlementImportEnabled') }
    ];
  }
  async function refreshEstimates(scope, actor) {
    await seed(scope);
    const channelSql = `case lower(coalesce(o.source,''))
      when 'shopify' then 'Shopify' when 'ebay' then 'eBay' when 'temu' then 'Temu' when 'walmart' then 'Walmart'
      else coalesce(nullif(o.channel_source,''),nullif(o.source,''),'Unclassified') end`;
    await pool().query(`delete from order_channel_financials f using order_records o
      where f.tenant_id=$1 and f.company_id=$2 and f.order_id=o.order_id and f.actual_fee is null
        and lower(f.channel) <> lower(${channelSql})`, [scope.tenantId, scope.companyId]);
    const result = await pool().query(`
      insert into order_channel_financials (
        tenant_id, company_id, order_id, order_number, marketplace_order_id, channel,
        currency, fee_basis_amount, estimated_fee, estimate_source, policy_snapshot, updated_at
      )
      select $1, $2, o.order_id, o.order_number, o.marketplace_order_id,
        ${channelSql},
        coalesce(nullif(o.raw->>'currency',''), 'USD'),
        coalesce(nullif(o.paid_amount,0), o.total, 0),
        case when coalesce(o.marketplace_fees,0) <> 0 then o.marketplace_fees
          when p.enabled then round((coalesce(nullif(o.paid_amount,0),o.total,0) * p.percent_rate / 100 + p.fixed_fee)::numeric, 2)
          else 0 end,
        case when coalesce(o.marketplace_fees,0) <> 0 then 'channel_import' when p.enabled then 'policy_estimate' else 'not_configured' end,
        jsonb_build_object('percentRate',coalesce(p.percent_rate,0),'fixedFee',coalesce(p.fixed_fee,0),'feeBasis',coalesce(p.fee_basis,'gross_order'),'sourceNote',coalesce(p.source_note,'')),
        now()
      from order_records o
      left join channel_fee_policies p on p.tenant_id=$1 and p.company_id=$2
        and lower(p.channel)=lower(${channelSql})
      where (o.reportable=true and lower(coalesce(o.status,'')) not in ('deleted','canceled','cancelled','void','voided'))
        or exists (
          select 1 from order_channel_financials existing
          where existing.tenant_id=$1 and existing.company_id=$2 and existing.order_id=o.order_id
            and lower(existing.channel)=lower(${channelSql})
            and existing.actual_fee is not null and existing.estimated_fee is null
        )
      on conflict (tenant_id, company_id, order_id, channel) do update set
        order_number=excluded.order_number, marketplace_order_id=excluded.marketplace_order_id,
        currency=excluded.currency, fee_basis_amount=excluded.fee_basis_amount,
        estimated_fee=case when order_channel_financials.actual_fee is null or order_channel_financials.estimated_fee is null then excluded.estimated_fee else order_channel_financials.estimated_fee end,
        estimate_source=case when order_channel_financials.actual_fee is null or order_channel_financials.estimated_fee is null then excluded.estimate_source else order_channel_financials.estimate_source end,
        policy_snapshot=case when order_channel_financials.actual_fee is null or order_channel_financials.estimated_fee is null then excluded.policy_snapshot else order_channel_financials.policy_snapshot end,
        updated_at=now()
      where order_channel_financials.actual_fee is null or order_channel_financials.estimated_fee is null
      returning order_id`, [scope.tenantId, scope.companyId]);
    const orderIds = result.rows.map(row => row.order_id);
    await notifyOrdersChanged(orderIds);
    return { updated: result.rowCount, actor };
  }
  async function overview(scope, { channel = '', status = '', page = 1 } = {}) {
    await seed(scope);
    const safePage = Math.max(1, Math.min(100000, Number(page) || 1));
    const policies = (await pool().query(`select channel, enabled, percent_rate as "percentRate", fixed_fee as "fixedFee", fee_basis as "feeBasis", source_note as "sourceNote", updated_at as "updatedAt" from channel_fee_policies where tenant_id=$1 and company_id=$2 order by channel`, [scope.tenantId, scope.companyId])).rows;
    const result = await pool().query(`with filtered as (
      select f.*, coalesce(f.actual_fee, f.estimated_fee, 0) as effective_fee,
        coalesce(f.actual_fee,0)-coalesce(f.estimated_fee,0) as variance
      from order_channel_financials f
      where f.tenant_id=$1 and f.company_id=$2
        and ($3='' or lower(f.channel)=lower($3))
        and ($4='' or f.reconciliation_status=$4)
    ), page_rows as (
      select *, count(*) over() as total_count from filtered order by updated_at desc, order_number desc limit 50 offset $5
    ) select * from page_rows`, [scope.tenantId, scope.companyId, clean(channel), clean(status), (safePage - 1) * 50]);
    const summary = (await pool().query(`select count(*)::int as orders,
      coalesce(sum(estimated_fee),0) as estimated,
      coalesce(sum(actual_fee) filter(where actual_fee is not null),0) as actual,
      count(*) filter(where actual_fee is not null)::int as reconciled,
      (select count(*)::int from channel_settlement_lines l where l.tenant_id=$1 and l.company_id=$2 and l.match_status='unmatched') as attention
      from order_channel_financials where tenant_id=$1 and company_id=$2`, [scope.tenantId, scope.companyId])).rows[0];
    const settlementResult = await pool().query(`select s.settlement_id as "settlementId", s.channel, s.external_settlement_id as "externalSettlementId", s.period_start as "periodStart", s.period_end as "periodEnd", s.status, s.source_file_name as "sourceFileName", s.imported_at as "importedAt", s.payout_amount as "payoutAmount", s.payout_date as "payoutDate", s.payout_status as "payoutStatus", s.bank_reference as "bankReference", s.payout_instrument as "payoutInstrument", s.raw, count(l.line_id)::int as lines, count(l.line_id) filter(where l.match_status='unmatched')::int as unmatched, count(*) over()::int as "totalCount" from channel_settlements s left join channel_settlement_lines l on l.tenant_id=s.tenant_id and l.company_id=s.company_id and l.settlement_id=s.settlement_id where s.tenant_id=$1 and s.company_id=$2 group by s.tenant_id,s.company_id,s.settlement_id order by s.imported_at desc limit 25`, [scope.tenantId, scope.companyId]);
    const settlements = settlementResult.rows.map((row) => {
      const rawPayout = row.raw?.payoutDetail || row.raw?.payout || {};
      return {
        ...row,
        payoutAmount: row.payoutAmount ?? rawPayout.amount?.value ?? null,
        payoutDate: row.payoutDate || rawPayout.payoutDate || null,
        payoutStatus: row.payoutStatus || rawPayout.payoutStatus || null,
        bankReference: row.bankReference || rawPayout.bankReference || null,
        payoutInstrument: row.payoutInstrument || rawPayout.payoutInstrument || null,
        raw: undefined
      };
    });
    const settlementTotal = Number(settlements[0]?.totalCount || 0);
    const shippingSettlementResult = await pool().query(`select s.settlement_id as "settlementId", s.provider, s.invoice_number as "invoiceNumber", s.currency, s.period_start as "periodStart", s.period_end as "periodEnd", s.total_amount as "totalAmount", s.status, s.source_file_name as "sourceFileName", s.imported_at as "importedAt", count(l.line_id)::int as lines, count(l.line_id) filter(where l.match_status='unmatched')::int as unmatched from shipping_settlements s left join shipping_settlement_lines l on l.settlement_id=s.settlement_id group by s.settlement_id order by s.imported_at desc limit 25`);
    const shippingSummary = (await pool().query(`select coalesce(sum(actual_shipping_cost) filter(where actual_shipping_cost is not null),0) as actual, count(*) filter(where actual_shipping_cost is not null)::int as reconciled, (select count(*)::int from shipping_settlement_lines where match_status='unmatched') as attention from order_shipment_financials where lower(coalesce(void_status,'')) not in ('void','voided')`)).rows[0] || {};
    return { policies, summary, settlements, settlementTotal, shippingSettlements: shippingSettlementResult.rows, shippingSummary, schedules: await scheduleStatus(), rows: result.rows, total: Number(result.rows[0]?.total_count || 0), page: safePage, pageSize: 50 };
  }
  async function reconcileOrders(client, scope, channel, settlementId, actor) {
    const result = await client.query(`insert into order_channel_financials (
        tenant_id,company_id,order_id,order_number,marketplace_order_id,channel,currency,
        fee_basis_amount,estimated_fee,estimate_source,policy_snapshot,
        actual_fee,settlement_id,reconciliation_status,reconciled_at,reconciled_by
      )
      select $1,$2,o.order_id,o.order_number,o.marketplace_order_id,$4,max(lines.currency),
        coalesce(nullif(o.paid_amount,0),o.total,0),
        case when coalesce(o.marketplace_fees,0) <> 0 then o.marketplace_fees
          when p.enabled then round((coalesce(nullif(o.paid_amount,0),o.total,0) * p.percent_rate / 100 + p.fixed_fee)::numeric, 2)
          else 0 end,
        case when coalesce(o.marketplace_fees,0) <> 0 then 'channel_import' when p.enabled then 'policy_estimate' else 'not_configured' end,
        jsonb_build_object('percentRate',coalesce(p.percent_rate,0),'fixedFee',coalesce(p.fixed_fee,0),'feeBasis',coalesce(p.fee_basis,'gross_order'),'sourceNote',coalesce(p.source_note,'')),
        sum(lines.fee_amount),$3,'reconciled',now(),$5
      from channel_settlement_lines lines join order_records o on o.order_id=lines.order_id
      left join channel_fee_policies p on p.tenant_id=$1 and p.company_id=$2 and lower(p.channel)=lower($4)
      where lines.tenant_id=$1 and lines.company_id=$2 and lower(lines.channel)=lower($4) and lines.match_status='matched'
        and lines.order_id in (select order_id from channel_settlement_lines where tenant_id=$1 and company_id=$2 and settlement_id=$3 and order_id is not null)
      group by o.order_id,o.order_number,o.marketplace_order_id,o.paid_amount,o.total,o.marketplace_fees,
        p.enabled,p.percent_rate,p.fixed_fee,p.fee_basis,p.source_note
      on conflict(tenant_id,company_id,order_id,channel) do update set
        fee_basis_amount=excluded.fee_basis_amount,
        estimated_fee=coalesce(order_channel_financials.estimated_fee,excluded.estimated_fee),
        estimate_source=coalesce(nullif(order_channel_financials.estimate_source,''),excluded.estimate_source),
        policy_snapshot=case when order_channel_financials.estimated_fee is null then excluded.policy_snapshot else order_channel_financials.policy_snapshot end,
        actual_fee=excluded.actual_fee,settlement_id=excluded.settlement_id,reconciliation_status='reconciled',reconciled_at=now(),reconciled_by=excluded.reconciled_by,updated_at=now()
      returning order_id`, [scope.tenantId,scope.companyId,settlementId,channel,actor]);
    return result.rows.map(row => row.order_id);
  }
  async function savePolicy(scope, input, actor) {
    const channel = clean(input.channel, 80); if (!channel) throw Object.assign(new Error('Select a channel.'), { status: 400 });
    const percentRate = Number(input.percentRate), fixedFee = Number(input.fixedFee);
    if (!Number.isFinite(percentRate) || percentRate < 0 || percentRate > 100 || !Number.isFinite(fixedFee) || fixedFee < 0) throw Object.assign(new Error('Enter valid non-negative fee rates.'), { status: 400 });
    const row = (await pool().query(`insert into channel_fee_policies (tenant_id,company_id,channel,enabled,percent_rate,fixed_fee,fee_basis,source_note,updated_at,updated_by) values($1,$2,$3,$4,$5,$6,'gross_order',$7,now(),$8) on conflict(tenant_id,company_id,channel) do update set enabled=excluded.enabled,percent_rate=excluded.percent_rate,fixed_fee=excluded.fixed_fee,source_note=excluded.source_note,updated_at=now(),updated_by=excluded.updated_by returning channel,enabled,percent_rate as "percentRate",fixed_fee as "fixedFee",fee_basis as "feeBasis",source_note as "sourceNote"`, [scope.tenantId, scope.companyId, channel, input.enabled !== false, percentRate, fixedFee, clean(input.sourceNote, 500), actor])).rows[0];
    return row;
  }
  async function importSettlement(scope, input, actor) {
    const channel = clean(input.channel, 80), csvText = String(input.csvText || ''), workbookBase64 = String(input.workbookBase64 || '');
    if (!channel || (!csvText && !workbookBase64)) throw Object.assign(new Error('Select a channel and settlement file.'), { status: 400 });
    const rows = workbookBase64 ? parseWorkbook(workbookBase64) : parseCsv(csvText);
    if (!rows.length) throw Object.assign(new Error('The settlement file has no data rows.'), { status: 400 });
    if (isTemuDetailedReport(channel, rows)) return importTemuShippingSettlement(scope, input, actor, rows, workbookBase64 ? Buffer.from(workbookBase64, 'base64') : Buffer.from(csvText));
    if (isTemuAdjustmentSummary(channel, rows)) throw Object.assign(new Error('This is Temu\'s compact Transactions export. Its DO financial IDs cannot identify the operational orders. Export the detailed Reports workbook, which includes Related ID and PO- order columns.'), { status: 400 });
    if (rows.length > 25000) throw Object.assign(new Error('Settlement imports are limited to 25,000 lines.'), { status: 413 });
    const externalId = clean(input.externalSettlementId || input.settlementId, 160);
    const settlementId = `SET-${crypto.randomUUID()}`;
    const hash = crypto.createHash('sha256').update(csvText).digest('hex');
    const client = await pool().connect(); let matched = 0, unmatched = 0;
    try {
      await client.query('begin');
      if ((await client.query('select 1 from channel_settlements where tenant_id=$1 and company_id=$2 and source_hash=$3', [scope.tenantId, scope.companyId, hash])).rowCount) throw Object.assign(new Error('This exact settlement file was already imported.'), { status: 409 });
      await client.query(`insert into channel_settlements (tenant_id,company_id,settlement_id,channel,external_settlement_id,currency,period_start,period_end,status,source_file_name,source_hash,imported_by,raw) values($1,$2,$3,$4,$5,$6,$7,$8,'imported',$9,$10,$11,$12)`, [scope.tenantId,scope.companyId,settlementId,channel,externalId,clean(input.currency || 'USD',8),input.periodStart || null,input.periodEnd || null,clean(input.fileName,240),hash,actor,JSON.stringify({ rowCount: rows.length })]);
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index], reference = clean(first(row,['order_id','order_number','channel_order_id','marketplace_order_id','order']),160);
        const feeAmount = money(first(row,['fee_amount','marketplace_fee','fee','amount']));
        if (feeAmount == null) throw Object.assign(new Error(`Settlement row ${index + 2} has no valid fee amount.`), { status: 400 });
        const order = reference ? (await client.query(`select order_id from order_records where lower(coalesce(channel_source,source,''))=lower($1) and (lower(order_id)=lower($2) or lower(coalesce(order_number,''))=lower($2) or lower(coalesce(internal_order_number,''))=lower($2) or lower(coalesce(marketplace_order_id,''))=lower($2)) order by updated_at desc limit 2`, [channel, reference])).rows : [];
        const orderId = order.length === 1 ? order[0].order_id : null, matchStatus = orderId ? 'matched' : 'unmatched';
        if (orderId) matched += 1; else unmatched += 1;
        const lineId = `FEE-${crypto.randomUUID()}`;
        await client.query(`insert into channel_settlement_lines (tenant_id,company_id,line_id,settlement_id,external_line_id,channel,order_id,source_order_reference,transaction_type,fee_type,description,gross_amount,fee_amount,net_amount,currency,transaction_at,match_status,matched_at,matched_by,raw) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,case when $7::text is null then null else now() end,case when $7::text is null then null else $18 end,$19)`, [scope.tenantId,scope.companyId,lineId,settlementId,clean(first(row,['external_line_id','transaction_id','line_id']),160) || `row-${index+2}`,channel,orderId,reference,clean(first(row,['transaction_type','type']),80)||'fee',clean(first(row,['fee_type','fee_name','charge_type']),120)||'marketplace_fee',clean(first(row,['description','memo']),500),money(first(row,['gross_amount','gross'])),feeAmount,money(first(row,['net_amount','net'])),clean(first(row,['currency']),8)||clean(input.currency||'USD',8),clean(first(row,['transaction_at','transaction_date','date']),64)||null,matchStatus,actor,JSON.stringify(row)]);
      }
      const changedOrderIds = await reconcileOrders(client, scope, channel, settlementId, actor);
      await client.query(`update channel_settlements set status=$4 where tenant_id=$1 and company_id=$2 and settlement_id=$3`, [scope.tenantId,scope.companyId,settlementId,unmatched ? 'needs_review' : 'reconciled']);
      await client.query('commit');
      await notifyOrdersChanged(changedOrderIds);
      return { settlementId, rows: rows.length, matched, unmatched };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }
  async function importTemuShippingSettlement(scope, input, actor, sourceRows, sourceBuffer) {
    if (sourceRows.length > 100000) throw Object.assign(new Error('Temu settlement imports are limited to 100,000 source rows.'), { status: 413 });
    const rows = normalizeTemuShippingRows(sourceRows);
    if (!rows.length) throw Object.assign(new Error('No Temu shipping-label transactions were found in this report.'), { status: 400 });
    const hash = crypto.createHash('sha256').update(sourceBuffer).digest('hex');
    const settlementId = `SHIP-${crypto.randomUUID()}`;
    const dates = rows.map(row => row.transactionAt.slice(0, 10)).filter(Boolean).sort();
    const externalId = clean(input.externalSettlementId || input.settlementId, 160) || `TEMU-${dates[0] || 'unknown'}-${dates.at(-1) || 'unknown'}-${hash.slice(0, 8)}`;
    const client = await pool().connect();
    let matched = 0, unmatched = 0, inserted = 0, duplicates = 0;
    try {
      await client.query('begin');
      if ((await client.query('select 1 from shipping_settlements where source_hash=$1', [hash])).rowCount) throw Object.assign(new Error('This exact Temu settlement file was already imported.'), { status: 409 });
      await client.query(`insert into shipping_settlements (settlement_id,provider_type,provider,invoice_number,currency,period_start,period_end,total_amount,status,source_file_name,source_hash,imported_at,imported_by,raw) values($1,'channel','Temu',$2,$3,$4,$5,$6,'importing',$7,$8,now(),$9,$10)`, [settlementId, externalId, rows[0]?.currency || 'USD', dates[0] || null, dates.at(-1) || null, rows.reduce((sum, row) => sum + row.amount, 0), clean(input.fileName, 240), hash, actor, JSON.stringify({ sourceRows: sourceRows.length, shippingRows: rows.length })]);
      const references = [...new Set(rows.map(row => row.orderReference.toLowerCase()).filter(Boolean))];
      const referenceSet = new Set(references);
      const orderIdsByReference = new Map();
      for (let offset = 0; offset < references.length; offset += 1000) {
        const found = (await client.query(`select order_id,order_number,internal_order_number,marketplace_order_id from order_records where (lower(coalesce(source,''))='temu' or lower(coalesce(channel_source,''))='temu') and (lower(order_id)=any($1::text[]) or lower(coalesce(order_number,''))=any($1::text[]) or lower(coalesce(internal_order_number,''))=any($1::text[]) or lower(coalesce(marketplace_order_id,''))=any($1::text[]))`, [references.slice(offset, offset + 1000)])).rows;
        for (const order of found) for (const value of [order.order_id, order.order_number, order.internal_order_number, order.marketplace_order_id]) {
          const key = clean(value, 160).toLowerCase();
          if (key && referenceSet.has(key)) orderIdsByReference.set(key, [...new Set([...(orderIdsByReference.get(key) || []), order.order_id])]);
        }
      }
      const orderIds = [...new Set([...orderIdsByReference.values()].flat())];
      const shipmentsByOrder = new Map();
      for (let offset = 0; offset < orderIds.length; offset += 1000) {
        const found = (await client.query(`select order_id,shipment_id,tracking_number from order_shipment_financials where order_id=any($1::text[]) and lower(coalesce(void_status,'')) not in ('void','voided') order by updated_at desc`, [orderIds.slice(offset, offset + 1000)])).rows;
        for (const shipment of found) shipmentsByOrder.set(shipment.order_id, [...(shipmentsByOrder.get(shipment.order_id) || []), shipment]);
      }
      const prepared = rows.map(row => {
        const orderMatches = orderIdsByReference.get(row.orderReference.toLowerCase()) || [];
        const orderId = orderMatches.length === 1 ? orderMatches[0] : null;
        let shipmentId = null;
        if (orderId && row.outbound) {
          const shipments = shipmentsByOrder.get(orderId) || [];
          const exact = shipments.filter(shipment => clean(shipment.tracking_number).toLowerCase() === row.trackingNumber.toLowerCase());
          if (exact.length === 1) shipmentId = exact[0].shipment_id;
          else if (shipments.length === 1) shipmentId = shipments[0].shipment_id;
        }
        const matchStatus = orderId && (shipmentId || !row.outbound) ? 'matched' : 'unmatched';
        return { line_id: `SHIPLINE-${crypto.randomUUID()}`, settlement_id: settlementId, external_line_id: row.externalLineId, tracking_number: row.trackingNumber, order_id: orderId, shipment_id: shipmentId, fee_type: row.feeType, transaction_type: row.transactionType, description: row.transactionType, amount: row.amount, currency: row.currency, service_date: row.transactionAt.slice(0, 10) || null, match_status: matchStatus, matched_by: matchStatus === 'matched' ? actor : null, raw: row.raw };
      });
      for (let offset = 0; offset < prepared.length; offset += 1000) {
        const result = await client.query(`insert into shipping_settlement_lines (line_id,settlement_id,external_line_id,tracking_number,order_id,shipment_id,fee_type,transaction_type,description,amount,currency,service_date,match_status,matched_at,matched_by,raw) select line_id,settlement_id,external_line_id,tracking_number,order_id,shipment_id,fee_type,transaction_type,description,amount,currency,service_date,match_status,case when match_status='matched' then now() else null end,matched_by,raw from jsonb_to_recordset($1::jsonb) as x(line_id text,settlement_id text,external_line_id text,tracking_number text,order_id text,shipment_id text,fee_type text,transaction_type text,description text,amount numeric,currency text,service_date date,match_status text,matched_by text,raw jsonb) on conflict (external_line_id) where nullif(external_line_id,'') is not null do nothing returning external_line_id,order_id,shipment_id,match_status`, [JSON.stringify(prepared.slice(offset, offset + 1000))]);
        inserted += result.rowCount;
        for (const saved of result.rows) {
          if (saved.match_status === 'matched') matched += 1; else unmatched += 1;
        }
      }
      duplicates = rows.length - inserted;
      const changedOrderIds = inserted ? (await client.query(`with targets as (select distinct order_id,shipment_id from shipping_settlement_lines where settlement_id=$1 and order_id is not null and shipment_id is not null), totals as (select l.order_id,l.shipment_id,coalesce(sum(l.amount),0) as amount,bool_or(l.fee_type='outbound_label_purchase') as has_purchase,bool_or(l.fee_type='outbound_label_adjustment') as has_adjustment from shipping_settlement_lines l join targets t on t.order_id=l.order_id and t.shipment_id=l.shipment_id where l.match_status='matched' and l.fee_type in ('outbound_label_purchase','outbound_label_adjustment') group by l.order_id,l.shipment_id) update order_shipment_financials f set actual_shipping_cost=greatest(0,round(((case when totals.has_purchase then 0 else coalesce(f.estimated_shipping_cost,0) end)+totals.amount)::numeric,2)),actual_cost_source='temu_settlement_adjustment',settlement_id=$1,billing_status='reconciled',billed_at=now(),reconciled_at=now(),reconciled_by=$2,updated_at=now() from totals where totals.has_adjustment and f.order_id=totals.order_id and f.shipment_id=totals.shipment_id returning f.order_id`, [settlementId, actor])).rows.map(row => row.order_id) : [];
      await client.query(`update shipping_settlements set status=$2 where settlement_id=$1`, [settlementId, unmatched ? 'needs_review' : 'reconciled']);
      await client.query('commit');
      await notifyOrdersChanged(changedOrderIds);
      return { settlementId, rows: inserted, matched, unmatched, duplicates, shippingRows: rows.length, sourceRows: sourceRows.length, kind: 'shipping_settlement' };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }
  async function importApiSettlement(scope, input, actor = 'system:channel-settlement-sync') {
    const channel = clean(input.channel, 80), externalId = clean(input.externalSettlementId, 160);
    const rows = Array.isArray(input.rows) ? input.rows : [];
    if (!channel || !externalId) throw Object.assign(new Error('API settlements require a channel and external settlement ID.'), { status: 400 });
    if (rows.length > 50000) throw Object.assign(new Error('API settlements are limited to 50,000 fee lines.'), { status: 413 });
    const client = await pool().connect();
    try {
      await client.query('begin');
      const prior = (await client.query(`select settlement_id from channel_settlements where tenant_id=$1 and company_id=$2 and lower(channel)=lower($3) and lower(external_settlement_id)=lower($4)`, [scope.tenantId, scope.companyId, channel, externalId])).rows[0];
      const settlementId = prior?.settlement_id || `SET-${crypto.randomUUID()}`;
      const sourceHash = crypto.createHash('sha256').update(JSON.stringify([channel, externalId, rows])).digest('hex');
      if (prior) {
        await client.query(`update channel_settlements set
          currency=$4,period_start=$5,period_end=$6,payout_amount=$7,payout_date=$8,payout_status=$9,
          bank_reference=$10,payout_memo=$11,last_attempted_payout_date=$12,payout_instrument=$13,transaction_count=$14,
          source_file_name=$15,source_api_reference=$16,raw=$17
          where tenant_id=$1 and company_id=$2 and settlement_id=$3`, [
          scope.tenantId, scope.companyId, settlementId, clean(input.currency || 'USD', 8), input.periodStart || null,
          input.periodEnd || null, money(input.payoutAmount), input.payoutDate || null, clean(input.payoutStatus, 80),
          clean(input.bankReference, 240), clean(input.payoutMemo, 500), input.lastAttemptedPayoutDate || null,
          JSON.stringify(input.payoutInstrument || {}), Number.isFinite(Number(input.transactionCount)) ? Number(input.transactionCount) : null,
          clean(input.fileName || `${channel}-${externalId}.json`, 240), clean(input.sourceApiReference, 500), JSON.stringify(input.raw || {})
        ]);
      } else await client.query(`insert into channel_settlements (
          tenant_id,company_id,settlement_id,channel,external_settlement_id,currency,period_start,period_end,payout_amount,
          payout_date,payout_status,bank_reference,payout_memo,last_attempted_payout_date,payout_instrument,transaction_count,
          status,source_type,source_file_name,source_api_reference,source_hash,imported_by,raw
        ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'imported','api',$17,$18,$19,$20,$21)`, [
          scope.tenantId, scope.companyId, settlementId, channel, externalId, clean(input.currency || 'USD', 8),
          input.periodStart || null, input.periodEnd || null, money(input.payoutAmount), input.payoutDate || null,
          clean(input.payoutStatus, 80), clean(input.bankReference, 240), clean(input.payoutMemo, 500),
          input.lastAttemptedPayoutDate || null, JSON.stringify(input.payoutInstrument || {}),
          Number.isFinite(Number(input.transactionCount)) ? Number(input.transactionCount) : null,
          clean(input.fileName || `${channel}-${externalId}.json`, 240), clean(input.sourceApiReference, 500), sourceHash, actor,
          JSON.stringify(input.raw || {})
        ]);
      const existingLineIds = prior ? new Set((await client.query(`select external_line_id from channel_settlement_lines where tenant_id=$1 and company_id=$2 and settlement_id=$3`, [scope.tenantId, scope.companyId, settlementId])).rows.map(row => row.external_line_id)) : new Set();
      const representedTransactions = [...new Set(rows.filter(row => clean(row.feeType, 120) !== 'PAYOUT_EVIDENCE').map(row => clean(row.transactionId, 160)).filter(Boolean))];
      if (prior && representedTransactions.length) await client.query(`delete from channel_settlement_lines where tenant_id=$1 and company_id=$2 and settlement_id=$3 and fee_type='PAYOUT_EVIDENCE' and transaction_id=any($4::text[])`, [scope.tenantId, scope.companyId, settlementId, representedTransactions]);
      let inserted = 0, rematched = 0;
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index] || {}, reference = clean(row.orderReference || row.orderId || row.orderNumber || row.marketplaceOrderId, 160);
        const references = [...new Set([reference, ...(Array.isArray(row.orderReferences) ? row.orderReferences : [])].map(value => clean(value, 160)).filter(Boolean))];
        const feeAmount = money(row.feeAmount);
        if (feeAmount == null) throw Object.assign(new Error(`API settlement row ${index + 1} has no valid fee amount.`), { status: 400 });
        const externalLineId = clean(row.externalLineId || `row-${index + 1}`, 160);
        const matches = references.length ? (await client.query(`select distinct order_id from order_records where (lower(coalesce(source,''))=lower($1) or lower(coalesce(channel_source,''))=lower($1)) and (lower(order_id)=any($2::text[]) or lower(coalesce(order_number,''))=any($2::text[]) or lower(coalesce(internal_order_number,''))=any($2::text[]) or lower(coalesce(marketplace_order_id,''))=any($2::text[])) order by order_id limit 2`, [channel, references.map(value => value.toLowerCase())])).rows : [];
        const orderId = matches.length === 1 ? matches[0].order_id : null, matchStatus = orderId ? 'matched' : 'unmatched';
        if (existingLineIds.has(externalLineId)) {
          if (orderId) {
            const repaired = await client.query(`update channel_settlement_lines set order_id=$4,match_status='matched',matched_at=now(),matched_by=$5 where tenant_id=$1 and company_id=$2 and settlement_id=$3 and external_line_id=$6 and (order_id is null or match_status<>'matched')`, [scope.tenantId, scope.companyId, settlementId, orderId, actor, externalLineId]);
            rematched += repaired.rowCount;
          }
          continue;
        }
        await client.query(`insert into channel_settlement_lines (
            tenant_id,company_id,line_id,settlement_id,external_line_id,channel,order_id,source_order_reference,
            transaction_type,fee_type,description,gross_amount,fee_amount,net_amount,payout_id,transaction_id,
            transaction_status,booking_entry,transaction_amount,currency,transaction_at,match_status,matched_at,matched_by,raw
          ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,case when $7::text is null then null else now() end,case when $7::text is null then null else $23 end,$24)`, [
            scope.tenantId, scope.companyId, `FEE-${crypto.randomUUID()}`, settlementId,
            externalLineId, channel, orderId, reference,
            clean(row.transactionType, 80) || 'fee', clean(row.feeType, 120) || 'marketplace_fee', clean(row.description, 500),
            money(row.grossAmount), feeAmount, money(row.netAmount), clean(row.payoutId || externalId, 160),
            clean(row.transactionId, 160), clean(row.transactionStatus, 80), clean(row.bookingEntry, 24), money(row.transactionAmount),
            clean(row.currency || input.currency || 'USD', 8), row.transactionAt || null, matchStatus, actor, JSON.stringify(row.raw || row)
          ]);
        existingLineIds.add(externalLineId); inserted += 1;
      }
      const changedOrderIds = await reconcileOrders(client, scope, channel, settlementId, actor);
      const counts = (await client.query(`select count(*) filter(where match_status='matched')::int as matched,count(*) filter(where match_status='unmatched')::int as unmatched from channel_settlement_lines where tenant_id=$1 and company_id=$2 and settlement_id=$3`, [scope.tenantId, scope.companyId, settlementId])).rows[0];
      const matched = Number(counts?.matched || 0), unmatched = Number(counts?.unmatched || 0);
      await client.query(`update channel_settlements set status=$4 where tenant_id=$1 and company_id=$2 and settlement_id=$3`, [scope.tenantId, scope.companyId, settlementId, unmatched ? 'needs_review' : 'reconciled']);
      await client.query('commit');
      await notifyOrdersChanged(changedOrderIds);
      return { duplicate: Boolean(prior) && inserted === 0 && rematched === 0, enriched: Boolean(prior) && (inserted > 0 || rematched > 0), rematched, settlementId, rows: inserted, matched, unmatched };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }
  return { overview, refreshEstimates, savePolicy, importSettlement, importApiSettlement };
}

module.exports = { createChannelFeeStore, DEFAULT_POLICIES, _test: { parseCsv, parseWorkbook, money, temuShippingType, normalizeTemuShippingRows, isTemuDetailedReport, isTemuAdjustmentSummary } };
