const crypto = require("crypto");

function text(value) {
  return String(value ?? "").trim();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function timestamp(value) {
  return value?.toISOString?.() || value || "";
}

function batchRow(row = {}) {
  return {
    id: row.batch_id,
    batchId: row.batch_id,
    batchNumber: Number(row.batch_number || 0),
    displayId: row.batch_number ? `SD-${String(row.batch_number).padStart(5, "0")}` : "Shipping dispute",
    name: row.name || "",
    status: row.status || "draft",
    sourceFileName: row.source_file_name || "",
    totalItems: Number(row.total_items || 0),
    matchedItems: Number(row.matched_items || 0),
    quotedItems: Number(row.quoted_items || 0),
    failedItems: Number(row.failed_items || 0),
    createdBy: row.created_by || "",
    createdByName: row.created_by_name || "",
    notes: row.notes || "",
    lastQuotedAt: timestamp(row.last_quoted_at),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

function itemRow(row = {}) {
  return {
    id: row.item_id,
    itemId: row.item_id,
    batchId: row.batch_id,
    inputReference: row.input_reference || "",
    inputPosition: Number(row.input_position || 0),
    matchStatus: row.match_status || "unmatched",
    status: row.status || "needs_review",
    orderId: row.order_id || "",
    shipmentId: row.shipment_id || "",
    orderNumber: row.order_number || "",
    channel: row.channel || "",
    channelOrderNumber: row.channel_order_number || "",
    trackingNumber: row.tracking_number || "",
    warehouseId: row.warehouse_id || "",
    destination: {
      ...object(row.destination_address),
      city: row.destination_city || "",
      state: row.destination_state || "",
      postalCode: row.destination_postal_code || "",
      country: row.destination_country || "",
    },
    package: {
      type: row.package_type || "box",
      weight: numberOrNull(row.package_weight),
      length: numberOrNull(row.package_length),
      width: numberOrNull(row.package_width),
      height: numberOrNull(row.package_height),
      weightUnit: row.weight_unit || "lb",
      dimensionUnit: row.dimension_unit || "in",
      source: row.package_measurement_source || "",
    },
    originalLabelCost: numberOrNull(row.original_label_cost),
    finalBilledCost: numberOrNull(row.final_billed_cost),
    billingDifference: numberOrNull(row.billing_difference),
    settlementId: row.settlement_id || "",
    settlementLineId: row.settlement_line_id || "",
    carrierInvoiceNumber: row.carrier_invoice_number || "",
    carrierBilledPackage: {
      weight: numberOrNull(row.carrier_billed_weight),
      length: numberOrNull(row.carrier_billed_length),
      width: numberOrNull(row.carrier_billed_width),
      height: numberOrNull(row.carrier_billed_height),
    },
    reviewReason: row.review_reason || "",
    quotedAt: timestamp(row.quoted_at),
    latestRun: row.latest_run_id ? {
      id: row.latest_run_id,
      status: row.latest_run_status || "",
      requestedAt: timestamp(row.latest_run_requested_at),
      completedAt: timestamp(row.latest_run_completed_at),
      providerStatus: object(row.latest_run_provider_status),
      error: row.latest_run_error || "",
    } : null,
    quotes: Array.isArray(row.quotes) ? row.quotes.map((quote) => ({
      rank: Number(quote.rank || 0),
      provider: quote.provider || "",
      carrier: quote.carrier || "",
      service: quote.service || "",
      amount: Number(quote.amount || 0),
      currency: quote.currency || "USD",
      deliveryDays: numberOrNull(quote.delivery_days),
      deliveryEstimate: quote.delivery_estimate || "",
      rateId: quote.rate_id || "",
      quotedAt: timestamp(quote.quoted_at),
      expiresAt: timestamp(quote.expires_at),
    })) : [],
    raw: object(row.raw),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

function addressFromOrder(raw = {}) {
  const address = object(raw.shippingAddress || raw.address || raw.deliveryAddress || raw.shipTo || raw.customer?.shippingAddress);
  return {
    name: text(address.name || address.fullName || raw.buyer || raw.customerName),
    company: text(address.company || address.companyName),
    phone: text(address.phone || raw.phone),
    email: text(address.email || raw.buyerEmail),
    line1: text(address.line1 || address.address1 || address.addressLine1 || address.street1),
    line2: text(address.line2 || address.address2 || address.addressLine2 || address.street2),
    city: text(address.city || address.town),
    state: text(address.state || address.province || address.stateProvinceCode),
    postalCode: text(address.postalCode || address.postcode || address.zip || address.zipCode),
    country: text(address.country || address.countryCode || "US"),
  };
}

function packageFromSources(primary = {}, secondary = {}) {
  const first = object(primary);
  const second = object(secondary);
  const value = (...keys) => {
    for (const key of keys) {
      const candidate = first[key] ?? second[key];
      if (candidate !== undefined && candidate !== null && candidate !== "") return candidate;
    }
    return null;
  };
  return {
    type: text(value("package_type", "packageType", "type") || "box"),
    weight: numberOrNull(value("package_weight", "packageWeight", "weight", "weightPounds")),
    length: numberOrNull(value("package_length", "packageLength", "length", "lengthInches")),
    width: numberOrNull(value("package_width", "packageWidth", "width", "widthInches")),
    height: numberOrNull(value("package_height", "packageHeight", "height", "heightInches")),
    weightUnit: text(value("weight_unit", "weightUnit") || "lb"),
    dimensionUnit: text(value("dimension_unit", "dimensionUnit") || "in"),
    source: text(value("package_measurement_source", "packageMeasurementSource", "source")),
  };
}

function completePackage(parcel = {}) {
  return [parcel.weight, parcel.length, parcel.width, parcel.height].every((value) => Number(value) > 0);
}

function completeDestination(address = {}) {
  return Boolean(address.line1 && address.city && address.state && address.postalCode && address.country);
}

function itemStatus(matchStatus, parcel, address) {
  if (matchStatus !== "matched") return matchStatus;
  if (!completePackage(parcel)) return "needs_package_data";
  if (!completeDestination(address)) return "needs_address_review";
  return "ready_to_quote";
}

function selectLowestRates(rates = [], limit = 5) {
  const selected = [];
  const seen = new Set();
  const maximum = Math.max(1, Math.min(5, Number(limit || 5)));
  for (const rate of [...rates].sort((left, right) => Number(left.amount || 0) - Number(right.amount || 0))) {
    const amount = Number(rate.amount);
    if (!(amount > 0)) continue;
    const key = [text(rate.provider).toLowerCase(), text(rate.carrier).toLowerCase(), text(rate.service).toLowerCase(), amount.toFixed(4)].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(rate);
    if (selected.length === maximum) break;
  }
  return selected;
}

function createShippingDisputeStore(poolGetter, options = {}) {
  const ensureSchema = options.ensureSchema || (async () => {});
  const pool = () => {
    const client = poolGetter();
    if (!client) throw Object.assign(new Error("Shipping disputes require PostgreSQL."), { status: 503 });
    return client;
  };

  async function refreshBatch(batchId, client = pool()) {
    const counts = (await client.query(`
      select count(*)::int as total,
        count(*) filter (where match_status='matched')::int as matched,
        count(*) filter (where status='quoted')::int as quoted,
        count(*) filter (where status='quote_failed')::int as failed,
        count(*) filter (where status in ('unmatched','ambiguous','needs_package_data','needs_address_review'))::int as review
      from shipping_dispute_items where batch_id=$1
    `, [batchId])).rows[0] || {};
    const total = Number(counts.total || 0), quoted = Number(counts.quoted || 0), failed = Number(counts.failed || 0), review = Number(counts.review || 0);
    const current = (await client.query("select status from shipping_dispute_batches where batch_id=$1", [batchId])).rows[0]?.status;
    const status = current === "quoting" && quoted + failed < Math.max(1, total - review)
      ? "quoting"
      : quoted && quoted + failed + review >= total
        ? (failed || review ? "partial" : "ready")
        : review ? "needs_review" : "ready_to_quote";
    const result = await client.query(`update shipping_dispute_batches set
      total_items=$2,matched_items=$3,quoted_items=$4,failed_items=$5,status=$6,updated_at=now()
      where batch_id=$1 returning *`, [batchId, total, Number(counts.matched || 0), quoted, failed, status]);
    return result.rows[0];
  }

  async function createBatch(scope = {}, input = {}, actor = {}) {
    await ensureSchema();
    const references = [...new Map((Array.isArray(input.references) ? input.references : [])
      .map((value) => text(value))
      .filter(Boolean)
      .map((value) => [value.toLowerCase(), value])).values()];
    if (!references.length) throw Object.assign(new Error("Paste or upload at least one DataPlus or channel order number."), { status: 400 });
    if (references.length > 1000) throw Object.assign(new Error("Create dispute batches with at most 1,000 unique order references."), { status: 400 });
    const client = await pool().connect();
    try {
      await client.query("begin");
      const batchId = crypto.randomUUID();
      const batch = (await client.query(`insert into shipping_dispute_batches
        (batch_id,tenant_id,company_id,name,status,source_file_name,created_by,created_by_name,notes,raw)
        values($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9::jsonb) returning *`, [
        batchId, text(scope.tenantId), text(scope.companyId), text(input.name || "Shipping dispute"),
        text(input.sourceFileName), text(actor.id), text(actor.name), text(input.notes), JSON.stringify({ referenceCount: references.length })
      ])).rows[0];
      const positions = references.map((_, index) => index);
      const normalizedReferences = references.map((reference) => reference.toLowerCase());
      const referencePositions = new Map(normalizedReferences.map((reference, position) => [reference, position]));
      const matchRows = (await client.query(`
        select order_id,order_number,internal_order_number,marketplace_order_id,source,channel_source,raw,created_at
        from order_records
        where lower(order_id)=any($1::text[])
           or lower(coalesce(order_number,''))=any($1::text[])
           or lower(coalesce(internal_order_number,''))=any($1::text[])
           or lower(coalesce(marketplace_order_id,''))=any($1::text[])
           or lower(coalesce(raw->>'marketplaceOrderNumber',''))=any($1::text[])
           or lower(coalesce(raw->>'channelOrderNumber',''))=any($1::text[])
           or lower(coalesce(raw->>'externalOrderId',''))=any($1::text[])
           or lower(coalesce(raw->'external'->>'customerOrderId',''))=any($1::text[])
           or lower(coalesce(raw->'external'->>'purchaseOrderId',''))=any($1::text[])
           or lower(coalesce(raw->'external'->>'parentOrderSn',''))=any($1::text[])
        order by created_at desc nulls last,order_id
      `, [normalizedReferences])).rows;
      const grouped = new Map(positions.map((position) => [position, []]));
      for (const row of matchRows) {
        const raw = object(row.raw);
        const identities = [
          row.order_id, row.order_number, row.internal_order_number, row.marketplace_order_id,
          raw.marketplaceOrderNumber, raw.channelOrderNumber, raw.externalOrderId,
          raw.external?.customerOrderId, raw.external?.purchaseOrderId, raw.external?.parentOrderSn,
        ];
        const matchedPositions = new Set(identities.map((value) => referencePositions.get(text(value).toLowerCase())).filter((position) => position !== undefined));
        for (const position of matchedPositions) grouped.get(position)?.push(row);
      }
      const orderIds = [...new Set([...grouped.values()].filter((rows) => rows.length === 1).map((rows) => rows[0].order_id))];
      const financialRows = orderIds.length ? (await client.query(`
        select financial.*,
          billed.line_id as settlement_line_id,
          billed.settlement_id as billed_settlement_id,
          billed.billed_weight as carrier_billed_weight,
          billed.billed_length as carrier_billed_length,
          billed.billed_width as carrier_billed_width,
          billed.billed_height as carrier_billed_height,
          settlement.invoice_number as settlement_invoice_number
        from order_shipment_financials financial
        left join lateral (
          select line.* from shipping_settlement_lines line
          where line.order_id=financial.order_id
            and (line.shipment_id=financial.shipment_id
              or (nullif(financial.tracking_number,'') is not null and lower(line.tracking_number)=lower(financial.tracking_number)))
          order by (line.shipment_id=financial.shipment_id) desc,
            (line.billed_weight is not null or line.billed_length is not null) desc,
            line.service_date desc nulls last,line.created_at desc
          limit 1
        ) billed on true
        left join shipping_settlements settlement on settlement.settlement_id=coalesce(nullif(financial.settlement_id,''),billed.settlement_id)
        where financial.order_id=any($1::text[])
        order by financial.order_id,financial.created_at,financial.shipment_id
      `, [orderIds])).rows : [];
      const financialByOrder = new Map(orderIds.map((id) => [id, []]));
      for (const row of financialRows) financialByOrder.get(row.order_id)?.push(row);

      const insertItem = async (entry) => client.query(`insert into shipping_dispute_items (
        item_id,batch_id,input_reference,input_position,match_status,status,order_id,shipment_id,order_number,channel,channel_order_number,
        tracking_number,warehouse_id,destination_city,destination_state,destination_postal_code,destination_country,destination_address,
        package_type,package_weight,package_length,package_width,package_height,weight_unit,dimension_unit,package_measurement_source,
        original_label_cost,final_billed_cost,billing_difference,settlement_id,settlement_line_id,carrier_invoice_number,
        carrier_billed_weight,carrier_billed_length,carrier_billed_width,carrier_billed_height,review_reason,raw
      ) values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20,$21,$22,$23,$24,$25,$26,
        $27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38::jsonb
      )`, [
        crypto.randomUUID(), batchId, entry.reference, entry.position, entry.matchStatus, entry.status, entry.orderId || null,
        entry.shipmentId || null, entry.orderNumber || null, entry.channel || null, entry.channelOrderNumber || null,
        entry.trackingNumber || null, entry.warehouseId || null, entry.address?.city || null, entry.address?.state || null,
        entry.address?.postalCode || null, entry.address?.country || null, JSON.stringify(entry.address || {}), entry.parcel?.type || null,
        entry.parcel?.weight, entry.parcel?.length, entry.parcel?.width, entry.parcel?.height, entry.parcel?.weightUnit || "lb",
        entry.parcel?.dimensionUnit || "in", entry.parcel?.source || null, entry.originalLabelCost, entry.finalBilledCost,
        entry.originalLabelCost != null && entry.finalBilledCost != null ? Number(entry.finalBilledCost) - Number(entry.originalLabelCost) : null,
        entry.settlementId || null, entry.settlementLineId || null, entry.invoiceNumber || null, entry.billedWeight, entry.billedLength,
        entry.billedWidth, entry.billedHeight, entry.reviewReason || null, JSON.stringify(entry.raw || {})
      ]);

      for (const [position, reference] of references.entries()) {
        const matches = grouped.get(position) || [];
        if (!matches.length) {
          await insertItem({ reference, position, matchStatus: "unmatched", status: "unmatched", reviewReason: "No DataPlus or channel order matched this reference." });
          continue;
        }
        if (matches.length > 1) {
          await insertItem({ reference, position, matchStatus: "ambiguous", status: "ambiguous", reviewReason: "This reference matches multiple orders.", raw: { candidates: matches.map((row) => ({ orderId: row.order_id, orderNumber: row.order_number, channelOrderNumber: row.marketplace_order_id })) } });
          continue;
        }
        const order = matches[0], raw = object(order.raw), address = addressFromOrder(raw);
        const channelOrderNumber = text(raw.marketplaceOrderNumber || raw.channelOrderNumber || raw.external?.purchaseOrderId || raw.external?.parentOrderSn || order.marketplace_order_id);
        const financials = financialByOrder.get(order.order_id) || [];
        const shipmentSources = financials.length ? financials : (Array.isArray(raw.shipments) && raw.shipments.length ? raw.shipments : [{}]);
        for (let shipmentIndex = 0; shipmentIndex < shipmentSources.length; shipmentIndex += 1) {
          const shipment = shipmentSources[shipmentIndex], shipmentRaw = object(shipment.raw || shipment);
          const parcel = financials.length
            ? packageFromSources(shipment, shipmentRaw.package || raw.package)
            : packageFromSources(shipmentRaw.package || shipmentRaw, raw.package);
          parcel.source = parcel.source || (financials.length ? "label_purchase_snapshot" : text(raw.packageMeasurementSource || shipmentRaw.packageMeasurementSource || "current_order_record"));
          const status = itemStatus("matched", parcel, address);
          await insertItem({
            reference, position, matchStatus: "matched", status, orderId: order.order_id,
            shipmentId: text(shipment.shipment_id || shipment.id), orderNumber: text(order.order_number || raw.orderNumber),
            channel: text(order.source || order.channel_source || raw.source), channelOrderNumber,
            trackingNumber: text(shipment.tracking_number || shipmentRaw.trackingNumber || raw.trackingNumber),
            warehouseId: text(shipment.warehouse_id || shipmentRaw.warehouseId || raw.fulfillmentWarehouseId), address, parcel,
            originalLabelCost: numberOrNull(shipment.estimated_shipping_cost ?? shipmentRaw.shippingCost ?? shipmentRaw.labelCost),
            finalBilledCost: numberOrNull(shipment.actual_shipping_cost),
            settlementId: text(shipment.settlement_id || shipment.billed_settlement_id),
            settlementLineId: text(shipment.settlement_line_id), invoiceNumber: text(shipment.carrier_invoice_number || shipment.settlement_invoice_number),
            billedWeight: numberOrNull(shipment.carrier_billed_weight), billedLength: numberOrNull(shipment.carrier_billed_length),
            billedWidth: numberOrNull(shipment.carrier_billed_width), billedHeight: numberOrNull(shipment.carrier_billed_height),
            reviewReason: status === "needs_package_data" ? "Historical purchase dimensions or weight are incomplete." : status === "needs_address_review" ? "The shipment address is incomplete." : "",
            raw: { financialRecord: Boolean(financials.length), shipmentIndex }
          });
        }
      }
      const refreshed = await refreshBatch(batchId, client);
      await client.query("commit");
      return { ...batchRow({ ...batch, ...refreshed }), referenceCount: references.length };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function listBatches(scope = {}, options = {}) {
    await ensureSchema();
    const limit = Math.max(1, Math.min(100, Number(options.limit || 50)));
    const result = await pool().query(`select * from shipping_dispute_batches
      where tenant_id=$1 and company_id=$2 order by created_at desc limit $3`, [text(scope.tenantId), text(scope.companyId), limit]);
    return result.rows.map(batchRow);
  }

  async function getBatch(scope = {}, batchId) {
    await ensureSchema();
    const client = pool();
    const batch = (await client.query(`select * from shipping_dispute_batches where batch_id=$1 and tenant_id=$2 and company_id=$3`, [batchId, text(scope.tenantId), text(scope.companyId)])).rows[0];
    if (!batch) return null;
    const items = await client.query(`
      select item.*,
        latest.run_id as latest_run_id,latest.status as latest_run_status,latest.requested_at as latest_run_requested_at,
        latest.completed_at as latest_run_completed_at,latest.provider_status as latest_run_provider_status,latest.error_message as latest_run_error,
        coalesce(quotes.rows,'[]'::jsonb) as quotes
      from shipping_dispute_items item
      left join lateral (select * from shipping_dispute_quote_runs run where run.item_id=item.item_id order by requested_at desc,created_at desc limit 1) latest on true
      left join lateral (select jsonb_agg(jsonb_build_object(
        'rank',quote.rank,'provider',quote.provider,'carrier',quote.carrier,'service',quote.service,'amount',quote.amount,
        'currency',quote.currency,'delivery_days',quote.delivery_days,'delivery_estimate',quote.delivery_estimate,
        'rate_id',quote.rate_id,'quoted_at',quote.quoted_at,'expires_at',quote.expires_at
      ) order by quote.rank) as rows from shipping_dispute_quotes quote where quote.run_id=latest.run_id) quotes on true
      where item.batch_id=$1 order by item.input_position,item.created_at,item.item_id
    `, [batchId]);
    return { ...batchRow(batch), items: items.rows.map(itemRow) };
  }

  async function updateItemPackage(scope = {}, batchId, itemId, input = {}, actor = {}) {
    await ensureSchema();
    const parcel = packageFromSources(input.package || input);
    const reason = text(input.reason);
    if (!completePackage(parcel)) throw Object.assign(new Error("Enter positive weight, length, width, and height values."), { status: 400 });
    if (!reason) throw Object.assign(new Error("Explain why these dispute dimensions are being used."), { status: 400 });
    const result = await pool().query(`update shipping_dispute_items item set
      package_type=$1,package_weight=$2,package_length=$3,package_width=$4,package_height=$5,weight_unit=$6,dimension_unit=$7,
      package_measurement_source='manual_dispute_override',review_reason=$8,status=case
        when nullif(destination_address->>'line1','') is null or nullif(destination_city,'') is null or nullif(destination_state,'') is null
          or nullif(destination_postal_code,'') is null or nullif(destination_country,'') is null then 'needs_address_review'
        else 'ready_to_quote' end,
      raw=coalesce(raw,'{}'::jsonb)||jsonb_build_object('packageOverride',jsonb_build_object('reason',$8,'updatedBy',$9,'updatedAt',now())),updated_at=now()
      from shipping_dispute_batches batch where item.item_id=$10 and item.batch_id=batch.batch_id and batch.batch_id=$11 and batch.tenant_id=$12 and batch.company_id=$13 returning item.*`, [
      parcel.type, parcel.weight, parcel.length, parcel.width, parcel.height, parcel.weightUnit, parcel.dimensionUnit, reason, text(actor.name || actor.id), itemId, batchId, text(scope.tenantId), text(scope.companyId)
    ]);
    if (!result.rows[0]) return null;
    await refreshBatch(batchId);
    return itemRow(result.rows[0]);
  }

  async function markBatchQuoting(scope = {}, batchId) {
    await ensureSchema();
    const result = await pool().query(`with scoped as (
        select batch_id from shipping_dispute_batches
        where batch_id=$1 and tenant_id=$2 and company_id=$3
      ), marked as (
        update shipping_dispute_items item set status='quoting',updated_at=now()
        from scoped where item.batch_id=scoped.batch_id and item.match_status='matched'
          and item.package_weight>0 and item.package_length>0 and item.package_width>0 and item.package_height>0
          and nullif(item.destination_address->>'line1','') is not null
          and nullif(item.destination_city,'') is not null and nullif(item.destination_state,'') is not null
          and nullif(item.destination_postal_code,'') is not null and nullif(item.destination_country,'') is not null
        returning item.item_id
      )
      update shipping_dispute_batches batch set status='quoting',updated_at=now()
      from scoped where batch.batch_id=scoped.batch_id returning batch.*`, [batchId, text(scope.tenantId), text(scope.companyId)]);
    return result.rows[0] ? batchRow(result.rows[0]) : null;
  }

  async function quoteItems(scope = {}, batchId) {
    const batch = await getBatch(scope, batchId);
    if (!batch) return null;
    return batch.items.filter((item) => item.matchStatus === "matched" && completePackage(item.package) && completeDestination(item.destination));
  }

  async function startRun(item, input = {}) {
    const snapshot = input.requestSnapshot || {};
    const serialized = JSON.stringify(snapshot);
    const runId = crypto.randomUUID();
    await pool().query(`insert into shipping_dispute_quote_runs
      (run_id,item_id,status,request_snapshot,request_hash,created_by) values($1,$2,'running',$3::jsonb,$4,$5)`, [
      runId, item.itemId, serialized, crypto.createHash("sha256").update(serialized).digest("hex"), text(input.createdBy)
    ]);
    return runId;
  }

  async function finishRun(batchId, itemId, runId, rates = [], input = {}) {
    const deduped = selectLowestRates(rates);
    const client = await pool().connect();
    try {
      await client.query("begin");
      for (let index = 0; index < deduped.length; index += 1) {
        const rate = deduped[index];
        await client.query(`insert into shipping_dispute_quotes
          (run_id,rank,provider,carrier,service,amount,currency,delivery_days,delivery_estimate,rate_id,quoted_at,expires_at,raw)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`, [
          runId, index + 1, text(rate.provider || "unknown"), text(rate.carrier), text(rate.service), Number(rate.amount), text(rate.currency || "USD"),
          numberOrNull(rate.deliveryDays), text(rate.deliveryEstimate), text(rate.id || rate.rateId), rate.quotedAt || new Date().toISOString(), rate.expiresAt || null,
          JSON.stringify({ warning: text(rate.warning), source: text(rate.rateSource) })
        ]);
      }
      const responseEvidence = JSON.stringify({ providerStatus: input.providerStatus || {}, selected: deduped.map((rate) => ({ provider: rate.provider, carrier: rate.carrier, service: rate.service, amount: rate.amount, currency: rate.currency })) });
      await client.query(`update shipping_dispute_quote_runs set status=$2,completed_at=now(),provider_status=$3::jsonb,response_hash=$4,error_message=$5 where run_id=$1`, [
        runId, deduped.length ? "complete" : "failed", JSON.stringify(input.providerStatus || {}), crypto.createHash("sha256").update(responseEvidence).digest("hex"), deduped.length ? null : text(input.error || "No valid comparison rates were returned.")
      ]);
      await client.query(`update shipping_dispute_items set status=$2,quoted_at=case when $2='quoted' then now() else quoted_at end,review_reason=$3,updated_at=now() where item_id=$1`, [
        itemId, deduped.length ? "quoted" : "quote_failed", deduped.length ? null : text(input.error || "No valid comparison rates were returned.")
      ]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    await refreshBatch(batchId);
    return deduped;
  }

  async function failRun(batchId, itemId, runId, error, providerStatus = {}) {
    await pool().query(`update shipping_dispute_quote_runs set status='failed',completed_at=now(),provider_status=$2::jsonb,error_message=$3 where run_id=$1`, [runId, JSON.stringify(providerStatus), text(error)]);
    await pool().query("update shipping_dispute_items set status='quote_failed',review_reason=$2,updated_at=now() where item_id=$1", [itemId, text(error)]);
    await refreshBatch(batchId);
  }

  async function completeBatch(batchId) {
    const row = await refreshBatch(batchId);
    await pool().query("update shipping_dispute_batches set last_quoted_at=now(),updated_at=now() where batch_id=$1", [batchId]);
    return batchRow(row);
  }

  return { createBatch, listBatches, getBatch, updateItemPackage, markBatchQuoting, quoteItems, startRun, finishRun, failRun, completeBatch };
}

module.exports = { createShippingDisputeStore, completePackage, completeDestination, selectLowestRates };
