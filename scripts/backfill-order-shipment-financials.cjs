const postgres = require("../db");
const { shipmentFinancialRecords, orderShippingRevenueRecord } = require("../lib/order-payload-retention");

const apply = process.argv.includes("--apply");
const batchSizeArg = process.argv.find((value) => value.startsWith("--batch-size="));
const batchSize = Math.max(10, Math.min(500, Number(batchSizeArg?.split("=")[1] || 100)));

async function upsertFinancialRows(client, rows) {
  const uniqueRows = [...new Map(rows.map((row) => [`${row.orderId}:${row.shipmentId}`, row])).values()];
  if (!uniqueRows.length) return;
  await client.query(`
    insert into order_shipment_financials (
      order_id, shipment_id, order_number, tracking_number, provider, label_source, carrier, service,
      currency, channel_source, destination_city, destination_state, destination_postal_code,
      destination_country, quoted_cost, estimated_shipping_cost, refunded_cost, billing_status, batch_id,
      print_job_id, shipment_group_id, master_order_id, master_shipment_id, shared_label,
      warehouse_id, package_weight, package_length, package_width, package_height,
      purchased_at, shipped_at, void_status, raw, updated_at
    )
    select order_id, shipment_id, order_number, tracking_number, provider, label_source, carrier, service,
      currency, channel_source, destination_city, destination_state, destination_postal_code,
      destination_country, quoted_cost, estimated_shipping_cost, refunded_cost, billing_status, batch_id,
      print_job_id, shipment_group_id, master_order_id, master_shipment_id, shared_label,
      warehouse_id, package_weight, package_length, package_width, package_height,
      purchased_at, shipped_at, void_status, raw, now()
    from jsonb_to_recordset($1::jsonb) as x(
      order_id text, shipment_id text, order_number text, tracking_number text, provider text,
      label_source text, carrier text, service text, currency text, channel_source text,
      destination_city text, destination_state text, destination_postal_code text,
      destination_country text, quoted_cost numeric, estimated_shipping_cost numeric, refunded_cost numeric,
      billing_status text, batch_id text, print_job_id text, shipment_group_id text,
      master_order_id text, master_shipment_id text, shared_label boolean, warehouse_id text, package_weight numeric,
      package_length numeric, package_width numeric, package_height numeric, purchased_at timestamptz,
      shipped_at timestamptz, void_status text, raw jsonb
    )
    on conflict (order_id, shipment_id) do update set
      order_number = excluded.order_number,
      tracking_number = excluded.tracking_number,
      provider = excluded.provider,
      label_source = excluded.label_source,
      carrier = excluded.carrier,
      service = excluded.service,
      currency = excluded.currency,
      channel_source = excluded.channel_source,
      destination_city = excluded.destination_city,
      destination_state = excluded.destination_state,
      destination_postal_code = excluded.destination_postal_code,
      destination_country = excluded.destination_country,
      quoted_cost = coalesce(excluded.quoted_cost, order_shipment_financials.quoted_cost),
      estimated_shipping_cost = coalesce(excluded.estimated_shipping_cost, order_shipment_financials.estimated_shipping_cost),
      refunded_cost = greatest(coalesce(excluded.refunded_cost, 0), order_shipment_financials.refunded_cost),
      billing_status = case when order_shipment_financials.actual_shipping_cost is not null
        then order_shipment_financials.billing_status else excluded.billing_status end,
      batch_id = coalesce(nullif(excluded.batch_id, ''), order_shipment_financials.batch_id),
      print_job_id = coalesce(nullif(excluded.print_job_id, ''), order_shipment_financials.print_job_id),
      shipment_group_id = coalesce(nullif(excluded.shipment_group_id, ''), order_shipment_financials.shipment_group_id),
      master_order_id = coalesce(nullif(excluded.master_order_id, ''), order_shipment_financials.master_order_id),
      master_shipment_id = coalesce(nullif(excluded.master_shipment_id, ''), order_shipment_financials.master_shipment_id),
      shared_label = excluded.shared_label,
      warehouse_id = coalesce(nullif(excluded.warehouse_id, ''), order_shipment_financials.warehouse_id),
      package_weight = coalesce(excluded.package_weight, order_shipment_financials.package_weight),
      package_length = coalesce(excluded.package_length, order_shipment_financials.package_length),
      package_width = coalesce(excluded.package_width, order_shipment_financials.package_width),
      package_height = coalesce(excluded.package_height, order_shipment_financials.package_height),
      purchased_at = coalesce(excluded.purchased_at, order_shipment_financials.purchased_at),
      shipped_at = coalesce(excluded.shipped_at, order_shipment_financials.shipped_at),
      void_status = excluded.void_status,
      raw = excluded.raw,
      updated_at = now()
  `, [JSON.stringify(uniqueRows.map((row) => ({
    order_id: row.orderId,
    shipment_id: row.shipmentId,
    order_number: row.orderNumber,
    tracking_number: row.trackingNumber,
    provider: row.provider,
    label_source: row.labelSource,
    carrier: row.carrier,
    service: row.service,
    currency: row.currency,
    channel_source: row.channelSource,
    destination_city: row.destinationCity,
    destination_state: row.destinationState,
    destination_postal_code: row.destinationPostalCode,
    destination_country: row.destinationCountry,
    quoted_cost: row.quotedCost,
    estimated_shipping_cost: row.estimatedShippingCost,
    refunded_cost: row.refundedCost,
    billing_status: row.billingStatus,
    batch_id: row.batchId,
    print_job_id: row.printJobId,
    shipment_group_id: row.shipmentGroupId,
    master_order_id: row.masterOrderId,
    master_shipment_id: row.masterShipmentId,
    shared_label: row.sharedLabel,
    warehouse_id: row.warehouseId,
    package_weight: row.packageWeight,
    package_length: row.packageLength,
    package_width: row.packageWidth,
    package_height: row.packageHeight,
    purchased_at: row.purchasedAt,
    shipped_at: row.shippedAt,
    void_status: row.voidStatus,
    raw: row.raw
  })))]);
}

async function upsertShippingRevenue(client, rows) {
  if (!rows.length) return;
  await client.query(`
    insert into order_shipping_revenue (
      order_id, order_number, channel_source, currency, customer_shipping_paid,
      source_field, collected_at, raw, updated_at
    )
    select order_id, order_number, channel_source, currency, customer_shipping_paid,
      source_field, collected_at, raw, now()
    from jsonb_to_recordset($1::jsonb) as x(
      order_id text, order_number text, channel_source text, currency text,
      customer_shipping_paid numeric, source_field text, collected_at timestamptz, raw jsonb
    )
    on conflict (order_id) do update set
      order_number = excluded.order_number,
      channel_source = excluded.channel_source,
      currency = excluded.currency,
      customer_shipping_paid = excluded.customer_shipping_paid,
      source_field = excluded.source_field,
      collected_at = excluded.collected_at,
      raw = excluded.raw,
      updated_at = now()
  `, [JSON.stringify(rows.map((row) => ({
    order_id: row.orderId, order_number: row.orderNumber, channel_source: row.channelSource,
    currency: row.currency, customer_shipping_paid: row.customerShippingPaid,
    source_field: row.sourceField, collected_at: row.collectedAt, raw: row.raw
  })))]);
}

async function main() {
  if (!postgres.isPostgresEnabled()) throw new Error("DATABASE_URL is required.");
  await postgres.initRelationalSchema();
  const pool = postgres.getPool();
  let cursor = "";
  const totals = { orders: 0, shipments: 0, withEstimatedCost: 0, withTracking: 0, shippingRevenueRows: 0 };
  while (true) {
    const result = await pool.query(`
      select order_id, raw
      from order_records
      where order_id > $1
      order by order_id
      limit $2
    `, [cursor, batchSize]);
    if (!result.rows.length) break;
    const sourceOrders = result.rows.map((row) => ({ ...(row.raw || {}), id: row.raw?.id || row.order_id }));
    const financials = sourceOrders.flatMap((order) => shipmentFinancialRecords(order));
    const revenueRows = sourceOrders.map((order) => orderShippingRevenueRecord(order)).filter(Boolean);
    totals.orders += result.rows.length;
    totals.shipments += financials.length;
    totals.withEstimatedCost += financials.filter((row) => row.estimatedShippingCost !== null).length;
    totals.withTracking += financials.filter((row) => row.trackingNumber).length;
    totals.shippingRevenueRows += revenueRows.length;
    if (apply) {
      await upsertFinancialRows(pool, financials);
      await upsertShippingRevenue(pool, revenueRows);
    }
    cursor = result.rows[result.rows.length - 1].order_id;
    process.stdout.write(`\r${apply ? "Applied" : "Reviewed"} ${totals.orders.toLocaleString()} orders`);
  }
  process.stdout.write("\n");
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...totals }, null, 2));
  await postgres.closePool();
}

main().catch(async (error) => {
  console.error(error);
  await postgres.closePool().catch(() => {});
  process.exitCode = 1;
});
