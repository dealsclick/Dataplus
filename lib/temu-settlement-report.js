const crypto = require('crypto');
const fs = require('fs');

const REQUIRED_HEADERS = ['date_time', 'transaction_type', 'related_id', 'order_id', 'total', 'currency'];
const BATCH_SIZE = 500;

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function headerKey(value) {
  return clean(String(value ?? '').replace(/^\uFEFF/, ''), 160).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function money(value) {
  if (value == null || String(value).trim() === '') return 0;
  const text = String(value).trim();
  const negative = /^\(.*\)$/.test(text);
  const number = Number(text.replace(/[$,()]/g, ''));
  if (!Number.isFinite(number)) return 0;
  return Math.round((negative ? -number : number) * 100) / 100;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function reportTimestamp(value) {
  const text = clean(value, 40);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(text)) return `${text} America/New_York`;
  return text;
}

function normalizedRaw(raw = {}) {
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [headerKey(key), clean(value, 4000)]));
}

function rowFingerprint(row = {}) {
  const normalized = normalizedRaw(row);
  const ordered = Object.keys(normalized).sort().map(key => [key, normalized[key]]);
  return crypto.createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

function classifyTemuTransaction(raw = {}, occurrence = 1) {
  const row = normalizedRaw(raw);
  const transactionType = clean(row.transaction_type, 120) || 'Unknown';
  const type = transactionType.toLowerCase();
  const total = money(row.total);
  const serviceFee = money(row.service_fee);
  const serviceFeeTax = money(row.service_fee_tax);
  const grossBeforeServiceFees = roundMoney(total - serviceFee - serviceFeeTax);
  const fingerprint = rowFingerprint(row);
  const externalLineId = `temu-report:${fingerprint.slice(0, 40)}:${occurrence}`;
  let category = 'other';
  let feeType = 'other';
  let feeAmount = 0;
  let grossAmount = null;
  let refundAmount = 0;
  let shippingCostAmount = 0;
  let requiresOrder = Boolean(clean(row.order_id, 160));

  if (type === 'order payment') {
    category = 'order_payment';
    feeType = 'marketplace_service_fee';
    feeAmount = roundMoney(-(serviceFee + serviceFeeTax));
    grossAmount = grossBeforeServiceFees;
    requiresOrder = true;
  } else if (type === 'refund') {
    category = 'refund';
    feeType = 'marketplace_service_fee_refund';
    feeAmount = roundMoney(-(serviceFee + serviceFeeTax));
    grossAmount = grossBeforeServiceFees;
    refundAmount = Math.max(0, roundMoney(-grossBeforeServiceFees));
    requiresOrder = true;
  } else if (type.includes('shipping label for return purchase adjustment')) {
    category = 'return_shipping_adjustment';
    feeType = 'return_shipping_adjustment';
    shippingCostAmount = roundMoney(-total);
    requiresOrder = true;
  } else if (type.includes('shipping label for return purchase')) {
    category = type.includes('covered by platform') ? 'return_shipping_platform_covered' : 'return_shipping';
    feeType = category;
    shippingCostAmount = roundMoney(-total);
    requiresOrder = true;
  } else if (type.includes('shipping label purchase adjustment')) {
    category = 'shipping_adjustment';
    feeType = 'shipping_label_adjustment';
    shippingCostAmount = roundMoney(-total);
    requiresOrder = true;
  } else if (type.includes('shipping label purchase')) {
    category = type.includes('covered by platform') ? 'shipping_platform_covered' : 'shipping_label';
    feeType = category;
    shippingCostAmount = roundMoney(-total);
    requiresOrder = true;
  } else if (type === 'return shipping-pickup fee credit') {
    category = 'return_shipping_credit';
    feeType = 'return_shipping_pickup_credit';
    shippingCostAmount = roundMoney(-total);
    requiresOrder = true;
  } else if (type === 'chargeback processing fee') {
    category = 'chargeback_fee';
    feeType = 'chargeback_processing_fee';
    feeAmount = roundMoney(-total);
    requiresOrder = true;
  } else if (type === 'fraudulent fulfillment deduction') {
    category = 'fraudulent_fulfillment_deduction';
    feeType = 'fulfillment_deduction';
    feeAmount = roundMoney(-total);
    requiresOrder = true;
  } else if (type === 'platform reimbursement') {
    category = 'platform_reimbursement';
    feeType = 'platform_reimbursement';
    feeAmount = roundMoney(-total);
    requiresOrder = Boolean(clean(row.order_id, 160));
  } else if (type === 'advertising service fee') {
    category = 'advertising_fee';
    feeType = 'advertising_service_fee';
    feeAmount = roundMoney(-total);
    requiresOrder = false;
  } else if (type === 'transfer') {
    category = 'payout_transfer';
    feeType = 'cash_transfer';
    requiresOrder = false;
  } else if (type === 'transfer of funds unsuccessful') {
    category = 'payout_transfer_reversal';
    feeType = 'cash_transfer_reversal';
    requiresOrder = false;
  }

  return {
    row,
    fingerprint,
    occurrence,
    externalLineId,
    lineId: `TEMUFEE-${fingerprint.slice(0, 32)}-${occurrence}`,
    shippingLineId: `TEMUSHIP-${fingerprint.slice(0, 32)}-${occurrence}`,
    transactionType,
    category,
    feeType,
    feeAmount,
    grossAmount,
    refundAmount,
    shippingCostAmount,
    netAmount: total,
    transactionAmount: Math.abs(total),
    bookingEntry: total < 0 ? 'DEBIT' : 'CREDIT',
    orderReference: clean(row.order_id, 160),
    orderItemReference: clean(row.order_item_id, 160),
    relatedId: clean(row.related_id, 160),
    transactionAt: reportTimestamp(row.date_time),
    transactionDate: clean(row.date_time, 40).slice(0, 10) || null,
    currency: clean(row.currency, 8) || 'USD',
    destinationCity: clean(row.ship_city, 160),
    destinationState: clean(row.ship_state, 80),
    requiresOrder,
    isShipping: category.startsWith('shipping_') || category.startsWith('return_shipping'),
    isReturnShipping: category.startsWith('return_shipping')
  };
}

async function* csvRecords(filePath) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 128 * 1024 });
  let row = [];
  let field = '';
  let quoted = false;
  let pending = '';
  for await (const chunk of stream) {
    const data = pending + chunk;
    pending = '';
    for (let index = 0; index < data.length; index += 1) {
      const char = data[index];
      const next = data[index + 1];
      if (char === '"') {
        if (quoted) {
          if (index === data.length - 1) {
            pending = '"';
            break;
          }
          if (next === '"') {
            field += '"';
            index += 1;
          } else quoted = false;
        } else if (!field.length) quoted = true;
        else field += char;
      } else if (char === ',' && !quoted) {
        row.push(field);
        field = '';
      } else if ((char === '\r' || char === '\n') && !quoted) {
        if (char === '\r' && next === '\n') index += 1;
        row.push(field);
        field = '';
        if (row.some(value => value.trim())) yield row;
        row = [];
      } else field += char;
    }
  }
  if (pending === '"') quoted = false;
  if (quoted) throw Object.assign(new Error('The Temu CSV ends inside a quoted field.'), { statusCode: 400 });
  if (field.length || row.length) {
    row.push(field);
    if (row.some(value => value.trim())) yield row;
  }
}

async function* temuRows(filePath) {
  let headers = null;
  let rowNumber = 0;
  for await (const cells of csvRecords(filePath)) {
    rowNumber += 1;
    if (!headers) {
      headers = cells.map(headerKey);
      const missing = REQUIRED_HEADERS.filter(header => !headers.includes(header));
      if (missing.length) throw Object.assign(new Error(`This is not a supported Temu transaction report. Missing columns: ${missing.join(', ')}.`), { statusCode: 400 });
      continue;
    }
    const raw = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
    yield { rowNumber, raw };
  }
  if (!headers) throw Object.assign(new Error('The Temu CSV is empty.'), { statusCode: 400 });
}

function referenceKeys(row = {}) {
  return [row.order_id, row.order_number, row.internal_order_number, row.marketplace_order_id]
    .map(value => clean(value, 160).toLowerCase()).filter(Boolean);
}

async function orderMatches(client, references) {
  const values = [...new Set(references.map(value => clean(value, 160).toLowerCase()).filter(Boolean))];
  const matches = new Map();
  if (!values.length) return matches;
  const result = await client.query(`select order_id, order_number, internal_order_number, marketplace_order_id
    from order_records
    where (lower(coalesce(source,''))='temu' or lower(coalesce(channel_source,''))='temu')
      and (lower(order_id)=any($1::text[]) or lower(coalesce(order_number,''))=any($1::text[])
        or lower(coalesce(internal_order_number,''))=any($1::text[]) or lower(coalesce(marketplace_order_id,''))=any($1::text[]))`, [values]);
  for (const order of result.rows) {
    for (const key of referenceKeys(order)) {
      if (!matches.has(key)) matches.set(key, new Set());
      matches.get(key).add(order.order_id);
    }
  }
  return matches;
}

function shippingIdentifiers(value, output = new Set(), depth = 0) {
  if (depth > 5 || value == null) return output;
  if (Array.isArray(value)) {
    for (const entry of value) shippingIdentifiers(entry, output, depth + 1);
    return output;
  }
  if (typeof value !== 'object') return output;
  for (const [key, entry] of Object.entries(value)) {
    if (/tracking|package.?sn|package.?id|package.?number|shipment.?id/i.test(key) && ['string', 'number'].includes(typeof entry)) {
      const normalized = clean(entry, 160).toLowerCase();
      if (normalized) output.add(normalized);
    } else if (entry && typeof entry === 'object') shippingIdentifiers(entry, output, depth + 1);
  }
  return output;
}

async function shipmentMatches(client, orderIds) {
  const ids = [...new Set(orderIds.filter(Boolean))];
  const matches = new Map();
  if (!ids.length) return matches;
  const result = await client.query(`select order_id, shipment_id, tracking_number, raw
    from order_shipment_financials
    where order_id=any($1::text[]) and lower(coalesce(void_status,'')) not in ('void','voided','canceled','cancelled')`, [ids]);
  for (const row of result.rows) {
    if (!matches.has(row.order_id)) matches.set(row.order_id, []);
    const identifiers = shippingIdentifiers(row.raw || {});
    if (row.shipment_id) identifiers.add(String(row.shipment_id).toLowerCase());
    if (row.tracking_number) identifiers.add(String(row.tracking_number).toLowerCase());
    matches.get(row.order_id).push({ shipmentId: row.shipment_id, trackingNumber: row.tracking_number || '', identifiers });
  }
  return matches;
}

function looksLikeTracking(value) {
  return /^(1z[a-z0-9]{16}|\d{10,34}|gf[a-z0-9]{8,}|spx[a-z0-9]{6,}|sx[a-z0-9]{6,})$/i.test(clean(value, 160));
}

async function insertSyntheticShipments(client, rows) {
  if (!rows.length) return;
  await client.query(`insert into order_shipment_financials (
      order_id,shipment_id,order_number,tracking_number,provider,label_source,channel_source,destination_city,destination_state,
      currency,billing_status,purchased_at,raw,created_at,updated_at
    )
    select x.order_id,x.shipment_id,coalesce(o.order_number,o.internal_order_number,x.order_id),nullif(x.tracking_number,''),
      'temu','Temu settlement report','Temu',nullif(x.destination_city,''),nullif(x.destination_state,''),x.currency,
      'awaiting_reconciliation',x.purchased_at,x.raw,now(),now()
    from jsonb_to_recordset($1::jsonb) as x(order_id text,shipment_id text,tracking_number text,destination_city text,destination_state text,currency text,purchased_at timestamptz,raw jsonb)
    left join order_records o on o.order_id=x.order_id
    on conflict(order_id,shipment_id) do nothing`, [JSON.stringify(rows)]);
}

async function insertChannelLines(client, scope, settlementId, rows) {
  if (!rows.length) return [];
  const result = await client.query(`insert into channel_settlement_lines (
      tenant_id,company_id,line_id,settlement_id,external_line_id,channel,order_id,source_order_reference,
      transaction_type,fee_type,description,gross_amount,fee_amount,net_amount,payout_id,transaction_id,
      transaction_status,booking_entry,transaction_amount,currency,transaction_at,match_status,matched_at,matched_by,raw
    )
    select $1,$2,x.line_id,$3,x.external_line_id,'Temu',x.order_id,nullif(x.source_order_reference,''),
      x.transaction_type,x.fee_type,x.description,x.gross_amount,x.fee_amount,x.net_amount,nullif(x.payout_id,''),
      x.transaction_id,'RECONCILED',x.booking_entry,x.transaction_amount,x.currency,x.transaction_at,x.match_status,
      case when x.match_status='matched' then now() end,case when x.match_status='matched' then x.matched_by end,x.raw
    from jsonb_to_recordset($4::jsonb) as x(
      line_id text,external_line_id text,order_id text,source_order_reference text,transaction_type text,fee_type text,
      description text,gross_amount numeric,fee_amount numeric,net_amount numeric,payout_id text,transaction_id text,
      booking_entry text,transaction_amount numeric,currency text,transaction_at timestamptz,match_status text,matched_by text,raw jsonb
    )
    on conflict(tenant_id,company_id,line_id) do update set
      order_id=coalesce(channel_settlement_lines.order_id,excluded.order_id),
      match_status=case when excluded.order_id is not null then 'matched' else channel_settlement_lines.match_status end,
      matched_at=case when excluded.order_id is not null then now() else channel_settlement_lines.matched_at end,
      matched_by=case when excluded.order_id is not null then excluded.matched_by else channel_settlement_lines.matched_by end,
      updated_at=now()
    returning order_id,match_status`, [scope.tenantId, scope.companyId, settlementId, JSON.stringify(rows)]);
  return result.rows;
}

async function insertShippingLines(client, settlementId, rows) {
  if (!rows.length) return [];
  const result = await client.query(`insert into shipping_settlement_lines (
      line_id,settlement_id,tracking_number,order_id,shipment_id,fee_type,description,amount,currency,service_date,
      match_status,matched_at,matched_by,raw
    )
    select x.line_id,$1,nullif(x.tracking_number,''),x.order_id,x.shipment_id,x.fee_type,x.description,x.amount,
      x.currency,x.service_date,x.match_status,case when x.match_status='matched' then now() end,
      case when x.match_status='matched' then x.matched_by end,x.raw
    from jsonb_to_recordset($2::jsonb) as x(
      line_id text,tracking_number text,order_id text,shipment_id text,fee_type text,description text,amount numeric,
      currency text,service_date date,match_status text,matched_by text,raw jsonb
    )
    on conflict(line_id) do update set
      order_id=coalesce(shipping_settlement_lines.order_id,excluded.order_id),
      shipment_id=coalesce(shipping_settlement_lines.shipment_id,excluded.shipment_id),
      match_status=case when excluded.order_id is not null and excluded.shipment_id is not null then 'matched' else shipping_settlement_lines.match_status end,
      matched_at=case when excluded.order_id is not null and excluded.shipment_id is not null then now() else shipping_settlement_lines.matched_at end,
      matched_by=case when excluded.order_id is not null and excluded.shipment_id is not null then excluded.matched_by else shipping_settlement_lines.matched_by end,
      updated_at=now()
    returning order_id,shipment_id,match_status`, [settlementId, JSON.stringify(rows)]);
  return result.rows;
}

async function reconcileTemuOrders(client, scope, affectedOrderIds, settlementId, actor) {
  const orderIds = [...new Set(affectedOrderIds.filter(Boolean))];
  if (!orderIds.length) return [];
  await client.query(`insert into order_channel_financials (
      tenant_id,company_id,order_id,order_number,marketplace_order_id,channel,currency,fee_basis_amount,
      estimated_fee,estimate_source,policy_snapshot,actual_fee,settlement_id,reconciliation_status,reconciled_at,reconciled_by
    )
    select $1,$2,o.order_id,o.order_number,o.marketplace_order_id,'Temu',coalesce(max(l.currency),'USD'),
      coalesce(sum(l.gross_amount) filter(where lower(l.transaction_type)='order payment'),nullif(o.paid_amount,0),o.total,0),
      case when coalesce(o.marketplace_fees,0)<>0 then o.marketplace_fees when p.enabled then round((coalesce(nullif(o.paid_amount,0),o.total,0)*p.percent_rate/100+p.fixed_fee)::numeric,2) else 0 end,
      case when coalesce(o.marketplace_fees,0)<>0 then 'channel_import' when p.enabled then 'policy_estimate' else 'not_configured' end,
      jsonb_build_object('percentRate',coalesce(p.percent_rate,0),'fixedFee',coalesce(p.fixed_fee,0),'feeBasis',coalesce(p.fee_basis,'gross_order'),'sourceNote',coalesce(p.source_note,'')),
      coalesce(sum(l.fee_amount),0),$4,'reconciled',now(),$5
    from order_records o
    join channel_settlement_lines l on l.tenant_id=$1 and l.company_id=$2 and l.order_id=o.order_id
      and lower(l.channel)='temu' and l.match_status='matched'
    left join channel_fee_policies p on p.tenant_id=$1 and p.company_id=$2 and lower(p.channel)='temu'
    where o.order_id=any($3::text[])
    group by o.order_id,o.order_number,o.marketplace_order_id,o.paid_amount,o.total,o.marketplace_fees,
      p.enabled,p.percent_rate,p.fixed_fee,p.fee_basis,p.source_note
    on conflict(tenant_id,company_id,order_id,channel) do update set
      fee_basis_amount=excluded.fee_basis_amount,
      estimated_fee=coalesce(order_channel_financials.estimated_fee,excluded.estimated_fee),
      estimate_source=coalesce(nullif(order_channel_financials.estimate_source,''),excluded.estimate_source),
      policy_snapshot=case when order_channel_financials.estimated_fee is null then excluded.policy_snapshot else order_channel_financials.policy_snapshot end,
      actual_fee=excluded.actual_fee,settlement_id=excluded.settlement_id,reconciliation_status='reconciled',
      reconciled_at=now(),reconciled_by=excluded.reconciled_by,updated_at=now()`, [scope.tenantId, scope.companyId, orderIds, settlementId, actor]);

  await client.query(`with totals as (
      select line.order_id,line.shipment_id,coalesce(sum(line.amount),0) as actual_cost,max(line.settlement_id) as settlement_id
      from shipping_settlement_lines line
      join shipping_settlements settlement on settlement.settlement_id=line.settlement_id
      where lower(settlement.provider)='temu' and line.match_status='matched'
        and line.order_id=any($1::text[]) and line.shipment_id is not null
      group by line.order_id,line.shipment_id
    ) update order_shipment_financials financial set
      actual_shipping_cost=totals.actual_cost,actual_cost_source='temu_settlement_report',settlement_id=totals.settlement_id,
      billing_status='reconciled',billed_at=now(),reconciled_at=now(),reconciled_by=$2,updated_at=now()
    from totals where financial.order_id=totals.order_id and financial.shipment_id=totals.shipment_id`, [orderIds, actor]);
  return orderIds;
}

async function importTemuSettlementReport(options = {}) {
  const { pool, filePath, fileName, sourceHash, scope, actor, progress } = options;
  if (!pool || !filePath || !sourceHash || !scope?.tenantId || !scope?.companyId) throw new Error('Temu settlement import configuration is incomplete.');
  const client = await pool.connect();
  const existing = (await client.query(`select settlement_id,raw from channel_settlements where tenant_id=$1 and company_id=$2 and source_hash=$3`, [scope.tenantId, scope.companyId, sourceHash])).rows[0];
  const settlementId = existing?.settlement_id || `SET-TEMU-${crypto.randomUUID()}`;
  const shippingSettlementId = existing?.raw?.shippingSettlementId || `SHIP-TEMU-${crypto.randomUUID()}`;
  const externalSettlementId = `TEMU-REPORT-${sourceHash.slice(0, 12)}`;
  try {
    if (!existing) {
      await client.query(`insert into channel_settlements (
          tenant_id,company_id,settlement_id,channel,external_settlement_id,currency,status,source_type,source_file_name,
          source_api_reference,source_hash,imported_by,raw
        ) values($1,$2,$3,'Temu',$4,'USD','processing','csv',$5,'Temu Seller Center transaction report',$6,$7,$8)`, [
        scope.tenantId, scope.companyId, settlementId, externalSettlementId, clean(fileName, 240), sourceHash, actor,
        JSON.stringify({ format: 'temu_transaction_report', shippingSettlementId })
      ]);
      await client.query(`insert into shipping_settlements (
          settlement_id,provider_type,provider,invoice_number,currency,status,source_file_name,source_api_reference,imported_at,imported_by,raw
        ) values($1,'marketplace','Temu',$2,'USD','processing',$3,'Temu Seller Center transaction report',now(),$4,$5)
        on conflict(settlement_id) do nothing`, [shippingSettlementId, `TEMU-${sourceHash.slice(0, 24)}`, clean(fileName, 240), actor, JSON.stringify({ channelSettlementId: settlementId, sourceHash })]);
    }

    const occurrences = new Map();
    const typeCounts = {};
    const affectedOrderIds = new Set();
    let batch = [];
    let sourceRows = 0;
    let channelMatched = 0;
    let channelUnmatched = 0;
    let channelNotApplicable = 0;
    let shippingMatched = 0;
    let shippingUnmatched = 0;
    let minDate = '';
    let maxDate = '';
    let payoutAmount = 0;
    let lastTransferAt = null;

    const flush = async () => {
      if (!batch.length) return;
      const refs = batch.map(row => row.orderReference).filter(Boolean);
      const orderMap = await orderMatches(client, refs);
      const resolved = batch.map(row => {
        const candidates = orderMap.get(row.orderReference.toLowerCase()) || new Set();
        const orderId = candidates.size === 1 ? [...candidates][0] : null;
        const matchStatus = orderId ? 'matched' : row.requiresOrder ? 'unmatched' : 'not_applicable';
        if (orderId) affectedOrderIds.add(orderId);
        return { ...row, orderId, matchStatus };
      });
      const shipments = await shipmentMatches(client, resolved.map(row => row.orderId).filter(Boolean));
      const synthetic = new Map();
      for (const row of resolved.filter(value => value.isShipping && value.orderId)) {
        const candidates = shipments.get(row.orderId) || [];
        const related = row.relatedId.toLowerCase();
        const exact = related ? candidates.filter(candidate => candidate.identifiers.has(related)) : [];
        if (exact.length === 1) row.shipmentId = exact[0].shipmentId;
        else if (!row.isReturnShipping && candidates.length === 1) row.shipmentId = candidates[0].shipmentId;
        else if (!candidates.length) {
          const returnKey = crypto.createHash('sha1').update(row.relatedId || row.orderItemReference || row.orderId).digest('hex').slice(0, 12);
          row.shipmentId = row.isReturnShipping ? `temu-return-report:${row.orderId}:${returnKey}` : `temu-report:${row.orderId}`;
          if (!synthetic.has(row.shipmentId)) synthetic.set(row.shipmentId, {
            order_id: row.orderId,
            shipment_id: row.shipmentId,
            tracking_number: looksLikeTracking(row.relatedId) ? row.relatedId : '',
            destination_city: row.destinationCity,
            destination_state: row.destinationState,
            currency: row.currency,
            purchased_at: row.transactionAt,
            raw: { source: 'Temu settlement report', relatedId: row.relatedId }
          });
        } else if (row.isReturnShipping) {
          const returnKey = crypto.createHash('sha1').update(row.relatedId || row.orderItemReference || row.orderId).digest('hex').slice(0, 12);
          row.shipmentId = `temu-return-report:${row.orderId}:${returnKey}`;
          if (!synthetic.has(row.shipmentId)) synthetic.set(row.shipmentId, {
            order_id: row.orderId,
            shipment_id: row.shipmentId,
            tracking_number: looksLikeTracking(row.relatedId) ? row.relatedId : '',
            destination_city: row.destinationCity,
            destination_state: row.destinationState,
            currency: row.currency,
            purchased_at: row.transactionAt,
            raw: { source: 'Temu settlement report', direction: 'return', relatedId: row.relatedId }
          });
        }
        row.shippingMatchStatus = row.shipmentId ? 'matched' : 'unmatched';
      }
      await insertSyntheticShipments(client, [...synthetic.values()]);
      const channelRows = resolved.map(row => ({
        line_id: row.lineId,
        external_line_id: row.externalLineId,
        order_id: row.orderId,
        source_order_reference: row.orderReference,
        transaction_type: row.transactionType,
        fee_type: row.feeType,
        description: [row.transactionType, row.relatedId].filter(Boolean).join(' / '),
        gross_amount: row.grossAmount,
        fee_amount: row.feeAmount,
        net_amount: row.netAmount,
        payout_id: row.category.startsWith('payout_transfer') ? row.relatedId : '',
        transaction_id: row.externalLineId,
        booking_entry: row.bookingEntry,
        transaction_amount: row.transactionAmount,
        currency: row.currency,
        transaction_at: row.transactionAt,
        match_status: row.matchStatus,
        matched_by: actor,
        raw: { ...row.row, _dataplus: { category: row.category, relatedId: row.relatedId, refundAmount: row.refundAmount, shippingCostAmount: row.shippingCostAmount } }
      }));
      const insertedChannel = await insertChannelLines(client, scope, settlementId, channelRows);
      for (const row of insertedChannel) {
        if (row.match_status === 'matched') channelMatched += 1;
        else if (row.match_status === 'unmatched') channelUnmatched += 1;
        else channelNotApplicable += 1;
      }
      const shippingRows = resolved.filter(row => row.isShipping).map(row => ({
        line_id: row.shippingLineId,
        tracking_number: looksLikeTracking(row.relatedId) ? row.relatedId : '',
        order_id: row.orderId,
        shipment_id: row.shipmentId || null,
        fee_type: row.feeType,
        description: [row.transactionType, row.relatedId].filter(Boolean).join(' / '),
        amount: row.shippingCostAmount,
        currency: row.currency,
        service_date: row.transactionDate,
        match_status: row.orderId && row.shipmentId ? 'matched' : 'unmatched',
        matched_by: actor,
        raw: { ...row.row, _dataplus: { channelSettlementId: settlementId, category: row.category, externalLineId: row.externalLineId } }
      }));
      const insertedShipping = await insertShippingLines(client, shippingSettlementId, shippingRows);
      for (const row of insertedShipping) {
        if (row.match_status === 'matched') shippingMatched += 1;
        else shippingUnmatched += 1;
      }
      batch = [];
      if (progress) await progress({ sourceRows, channelMatched, channelUnmatched, shippingMatched, shippingUnmatched });
    };

    for await (const source of temuRows(filePath)) {
      const fingerprint = rowFingerprint(source.raw);
      const occurrence = (occurrences.get(fingerprint) || 0) + 1;
      occurrences.set(fingerprint, occurrence);
      const row = classifyTemuTransaction(source.raw, occurrence);
      sourceRows += 1;
      typeCounts[row.transactionType] = Number(typeCounts[row.transactionType] || 0) + 1;
      if (row.transactionDate && (!minDate || row.transactionDate < minDate)) minDate = row.transactionDate;
      if (row.transactionDate && (!maxDate || row.transactionDate > maxDate)) maxDate = row.transactionDate;
      if (row.category === 'payout_transfer' || row.category === 'payout_transfer_reversal') {
        payoutAmount = roundMoney(payoutAmount - row.netAmount);
        if (!lastTransferAt || String(row.transactionAt) > String(lastTransferAt)) lastTransferAt = row.transactionAt;
      }
      batch.push(row);
      if (batch.length >= BATCH_SIZE) await flush();
    }
    await flush();
    const changedOrderIds = await reconcileTemuOrders(client, scope, [...affectedOrderIds], settlementId, actor);
    const status = channelUnmatched || shippingUnmatched ? 'needs_review' : 'reconciled';
    const reportSummary = {
      sourceRows, channelMatched, channelUnmatched, channelNotApplicable, shippingMatched, shippingUnmatched,
      typeCounts, newRows: channelMatched + channelUnmatched + channelNotApplicable
    };
    await client.query(`update channel_settlements set
        period_start=$4,period_end=$5,payout_amount=$6,payout_date=$7,payout_status='STATEMENT_IMPORTED',
        payout_memo='Temu Seller Center transaction report imported; transfers are statement evidence and are not bank-confirmed payouts.',
        transaction_count=$8,status=$9,updated_at=now(),raw=coalesce(raw,'{}'::jsonb)||$10::jsonb
      where tenant_id=$1 and company_id=$2 and settlement_id=$3`, [
      scope.tenantId, scope.companyId, settlementId, minDate || null, maxDate || null, payoutAmount,
      lastTransferAt, sourceRows, status, JSON.stringify({ reportSummary, shippingSettlementId })
    ]);
    const shippingTotal = (await client.query(`select coalesce(sum(amount),0) as total,count(*)::int as lines,
      count(*) filter(where match_status='unmatched')::int as unmatched from shipping_settlement_lines where settlement_id=$1`, [shippingSettlementId])).rows[0];
    await client.query(`update shipping_settlements set period_start=$2,period_end=$3,issued_at=now(),total_amount=$4,
      status=$5,updated_at=now(),raw=coalesce(raw,'{}'::jsonb)||$6::jsonb where settlement_id=$1`, [
      shippingSettlementId, minDate || null, maxDate || null, shippingTotal.total,
      Number(shippingTotal.unmatched || 0) ? 'needs_review' : 'reconciled',
      JSON.stringify({ reportSummary, channelSettlementId: settlementId })
    ]);
    return { duplicate: Boolean(existing), settlementId, shippingSettlementId, status, reportSummary, changedOrderIds };
  } finally {
    client.release();
  }
}

module.exports = {
  REQUIRED_HEADERS,
  classifyTemuTransaction,
  csvRecords,
  temuRows,
  importTemuSettlementReport,
  _test: { headerKey, money, rowFingerprint, looksLikeTracking }
};
