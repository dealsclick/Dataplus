const postgres = require("../db");
const { linkPurchasedShipmentToGroup } = require("../server");

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || "";
}

async function main() {
  if (!postgres.isPostgresEnabled()) throw new Error("DATABASE_URL is required.");
  const orderKey = argument("order");
  const apply = process.argv.includes("--apply");
  if (!orderKey) throw new Error("Pass the master order ID or number with --order=88353.");
  await postgres.initDatabase();
  const order = await postgres.readOrderByKey(orderKey);
  if (!order) throw new Error(`Order ${orderKey} was not found.`);
  const shipment = (order.shipments || []).find((candidate) => candidate.voidStatus !== "voided"
    && candidate.trackingNumber
    && (candidate.documents || []).some((document) => document.documentType === "shipping_label" || document.documentId));
  if (!shipment) throw new Error(`Order ${order.orderNumber || order.id} has no active purchased shipping label.`);
  const groupOrderIds = [...new Set([order.id, ...(order.shipmentGroupOrderIds || [])].map(String).filter(Boolean))];
  if (!order.shipmentGroupId || groupOrderIds.length < 2) throw new Error(`Order ${order.orderNumber || order.id} is not part of a multi-order shipment group.`);
  if (!apply) {
    process.stdout.write(`${JSON.stringify({ mode: "dry-run", orderNumber: order.orderNumber, shipmentGroupId: order.shipmentGroupId, groupOrderIds, trackingNumber: shipment.trackingNumber }, null, 2)}\n`);
    return;
  }
  const repairedAt = new Date().toISOString();
  const result = await linkPurchasedShipmentToGroup(order, shipment, "Shared shipment repair", { at: repairedAt });
  order.updatedAt = repairedAt;
  await postgres.saveOrder(order);
  process.stdout.write(`${JSON.stringify({
    mode: "apply",
    orderNumber: order.orderNumber,
    shipmentGroupId: result.groupId,
    trackingNumber: shipment.trackingNumber,
    linkedOrders: result.linked.map((entry) => ({ orderNumber: entry.order.orderNumber, shipmentId: entry.shipment.id, status: entry.shipment.status }))
  }, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message || error}\n`);
    process.exitCode = 1;
  })
  .finally(() => postgres.closePool());
