const postgres = require("../db");
const { compactOrderForStorage, shipmentTrackingRecords } = require("../lib/order-payload-retention");

const apply = process.argv.includes("--apply");
const batchSizeArg = process.argv.find((value) => value.startsWith("--batch-size="));
const batchSize = Math.max(10, Math.min(500, Number(batchSizeArg?.split("=")[1] || 100)));

async function insertTrackingRows(client, rows) {
  const uniqueRows = [...new Map(rows.map((row) => [`${row.orderId}:${row.shipmentId}`, row])).values()];
  if (!uniqueRows.length) return;
  await client.query(`
    insert into order_shipment_tracking (
      order_id, shipment_id, provider, shipment_status, tracking_status, tracking_number,
      tracking_checked_at, tracking_pending_since, next_check_at, monitoring_complete,
      remote_shipment_id, veeqo_order_id, allocation_id, veeqo_shipment_id, rate_source,
      void_status, package_sns, has_label, updated_at
    )
    select order_id, shipment_id, provider, shipment_status, tracking_status, tracking_number,
      tracking_checked_at, tracking_pending_since, next_check_at, monitoring_complete,
      remote_shipment_id, veeqo_order_id, allocation_id, veeqo_shipment_id, rate_source,
      void_status, package_sns, has_label, now()
    from (
      select distinct on (order_id, shipment_id) *
      from jsonb_to_recordset($1::jsonb) with ordinality as x(
        order_id text, shipment_id text, provider text, shipment_status text, tracking_status text,
        tracking_number text, tracking_checked_at timestamptz, tracking_pending_since timestamptz,
        next_check_at timestamptz, monitoring_complete boolean, remote_shipment_id text,
        veeqo_order_id text, allocation_id text, veeqo_shipment_id text, rate_source text,
        void_status text, package_sns jsonb, has_label boolean, row_number bigint
      )
      order by order_id, shipment_id, row_number desc
    ) deduplicated
    on conflict (order_id, shipment_id) do update set
      provider = excluded.provider,
      shipment_status = excluded.shipment_status,
      tracking_status = excluded.tracking_status,
      tracking_number = excluded.tracking_number,
      tracking_checked_at = excluded.tracking_checked_at,
      tracking_pending_since = excluded.tracking_pending_since,
      next_check_at = excluded.next_check_at,
      monitoring_complete = excluded.monitoring_complete,
      remote_shipment_id = excluded.remote_shipment_id,
      veeqo_order_id = excluded.veeqo_order_id,
      allocation_id = excluded.allocation_id,
      veeqo_shipment_id = excluded.veeqo_shipment_id,
      rate_source = excluded.rate_source,
      void_status = excluded.void_status,
      package_sns = excluded.package_sns,
      has_label = excluded.has_label,
      updated_at = now()
  `, [JSON.stringify(uniqueRows.map((row) => ({
    order_id: row.orderId,
    shipment_id: row.shipmentId,
    provider: row.provider,
    shipment_status: row.shipmentStatus,
    tracking_status: row.trackingStatus,
    tracking_number: row.trackingNumber,
    tracking_checked_at: row.trackingCheckedAt,
    tracking_pending_since: row.trackingPendingSince,
    next_check_at: row.nextCheckAt,
    monitoring_complete: row.monitoringComplete,
    remote_shipment_id: row.remoteShipmentId,
    veeqo_order_id: row.veeqoOrderId,
    allocation_id: row.allocationId,
    veeqo_shipment_id: row.veeqoShipmentId,
    rate_source: row.rateSource,
    void_status: row.voidStatus,
    package_sns: row.packageSns,
    has_label: row.hasLabel
  })))]);
}

async function main() {
  if (!postgres.isPostgresEnabled()) throw new Error("DATABASE_URL is required.");
  await postgres.initRelationalSchema();
  const pool = postgres.getPool();
  let cursor = "";
  const totals = { orders: 0, changedOrders: 0, archives: 0, originalBytes: 0, compressedBytes: 0, shipments: 0 };
  while (true) {
    const result = await pool.query(`
      select order_id, raw
      from order_records
      where order_id > $1
      order by order_id
      limit $2
    `, [cursor, batchSize]);
    if (!result.rows.length) break;
    const prepared = result.rows.map((row) => {
      const source = { ...(row.raw || {}), id: row.raw?.id || row.order_id };
      const compacted = compactOrderForStorage(source);
      return {
        orderId: row.order_id,
        raw: compacted.order,
        changed: JSON.stringify(source) !== JSON.stringify(compacted.order),
        archives: compacted.archives,
        tracking: shipmentTrackingRecords(compacted.order)
      };
    });
    totals.orders += prepared.length;
    totals.changedOrders += prepared.filter((entry) => entry.changed).length;
    totals.archives += prepared.reduce((sum, entry) => sum + entry.archives.length, 0);
    totals.originalBytes += prepared.flatMap((entry) => entry.archives).reduce((sum, entry) => sum + entry.originalBytes, 0);
    totals.compressedBytes += prepared.flatMap((entry) => entry.archives).reduce((sum, entry) => sum + entry.compressedBytes, 0);
    totals.shipments += prepared.reduce((sum, entry) => sum + entry.tracking.length, 0);
    if (apply) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        for (const entry of prepared) {
          for (const archive of entry.archives) {
            await client.query(`
              insert into order_payload_archives (
                order_id, payload_kind, sha256, compression, payload, original_bytes, compressed_bytes
              ) values ($1, $2, $3, $4, $5, $6, $7)
              on conflict (order_id, payload_kind, sha256) do nothing
            `, [archive.orderId, archive.kind, archive.sha256, archive.compression, archive.payload, archive.originalBytes, archive.compressedBytes]);
          }
          if (entry.changed) await client.query("update order_records set raw = $2::jsonb where order_id = $1", [entry.orderId, JSON.stringify(entry.raw)]);
        }
        const orderIds = prepared.map((entry) => entry.orderId);
        await client.query("delete from order_shipment_tracking where order_id = any($1::text[])", [orderIds]);
        await insertTrackingRows(client, prepared.flatMap((entry) => entry.tracking));
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
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
