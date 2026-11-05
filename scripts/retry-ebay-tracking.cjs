const postgres = require("../db");
const { readDbFast, syncDropshipShipmentToChannel } = require("../server");

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || "";
}

function text(value) {
  return String(value || "").trim();
}

function activeShipment(order = {}) {
  return (Array.isArray(order.shipments) ? order.shipments : [])
    .filter((shipment) => text(shipment.trackingNumber) && shipment.voidStatus !== "voided")
    .filter((shipment) => ["label_purchased", "fulfilled", "shipped", "in_transit", "delivered"].includes(text(shipment.status).toLowerCase()))
    .sort((left, right) => {
      const leftPending = ["failed", "pending"].includes(text(left.channelSync?.status).toLowerCase()) ? 1 : 0;
      const rightPending = ["failed", "pending"].includes(text(right.channelSync?.status).toLowerCase()) ? 1 : 0;
      return rightPending - leftPending || Date.parse(right.createdAt || right.updatedAt || 0) - Date.parse(left.createdAt || left.updatedAt || 0);
    })[0] || null;
}

async function main() {
  if (!postgres.isPostgresEnabled()) throw new Error("DATABASE_URL is required.");
  const orderKeys = [...new Set(argument("orders").split(",").map(text).filter(Boolean))];
  const apply = process.argv.includes("--apply");
  if (!orderKeys.length) throw new Error("Pass explicit DataPlus order numbers or IDs with --orders=88328,88353.");

  await postgres.initDatabase();
  const db = await readDbFast({ skipInventory: true });
  const report = [];
  for (const orderKey of orderKeys) {
    const order = await postgres.readOrderByKey(orderKey);
    if (!order) {
      report.push({ orderKey, status: "not_found" });
      continue;
    }
    if (text(order.source || order.channelSource).toLowerCase() !== "ebay") {
      report.push({ orderKey, orderNumber: order.orderNumber || order.id, status: "skipped", message: "Not an eBay order." });
      continue;
    }
    const shipment = activeShipment(order);
    if (!shipment) {
      report.push({ orderKey, orderNumber: order.orderNumber || order.id, status: "skipped", message: "No active purchased shipment with tracking." });
      continue;
    }
    const preview = {
      orderKey,
      orderNumber: order.orderNumber || order.id,
      marketplaceOrderId: order.ebayOrderId || order.marketplaceOrderId || order.marketplaceOrderNumber || "",
      shipmentId: shipment.id || "",
      shipmentStatus: shipment.status || "",
      trackingNumber: shipment.trackingNumber,
      previousStatus: shipment.channelSync?.status || "not_attempted"
    };
    if (!apply) {
      report.push({ ...preview, status: "ready" });
      continue;
    }
    const result = await syncDropshipShipmentToChannel(db, order, shipment, "eBay tracking repair");
    order.updatedAt = new Date().toISOString();
    await postgres.saveOrder(order);
    report.push({ ...preview, status: result.status || "unknown", message: result.error || shipment.channelSync?.message || "" });
  }

  process.stdout.write(`${JSON.stringify({ mode: apply ? "apply" : "dry-run", report }, null, 2)}\n`);
  if (apply && report.some((entry) => !["sent", "already_synced", "skipped"].includes(entry.status))) process.exitCode = 2;
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message || error}\n`);
    process.exitCode = 1;
  })
  .finally(() => postgres.closePool());
