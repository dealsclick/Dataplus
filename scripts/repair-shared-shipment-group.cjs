const postgres = require("../db");
const { drainFulfillmentConsoleProjectionPatches, linkPurchasedShipmentToGroup } = require("../server");

function text(value) {
  return String(value || "").trim();
}

async function main() {
  if (!postgres.isPostgresEnabled()) throw new Error("DATABASE_URL is required.");
  const orderKey = text(process.argv.slice(2).find((value) => !value.startsWith("--")));
  const apply = process.argv.includes("--apply");
  if (!orderKey) throw new Error("Usage: node scripts/repair-shared-shipment-group.cjs <order number or ID> [--apply]");

  const order = await postgres.readOrderByKey(orderKey);
  if (!order) throw new Error(`Order ${orderKey} was not found.`);
  const groupId = text(order.shipmentGroupId);
  const memberIds = [...new Set([order.id, ...(order.shipmentGroupOrderIds || [])].map(text).filter(Boolean))];
  if (!groupId || memberIds.length < 2) throw new Error(`Order ${order.orderNumber || order.id} is not part of a multi-order shipment group.`);
  const shipment = (order.shipments || []).find((entry) => text(entry.trackingNumber) && entry.voidStatus !== "voided");
  if (!shipment) throw new Error(`Order ${order.orderNumber || order.id} has no active purchased shipment with tracking.`);

  const members = await postgres.readOrdersByIds(memberIds);
  const preview = {
    apply,
    groupId,
    masterOrder: order.orderNumber || order.id,
    trackingNumber: shipment.trackingNumber,
    members: members.map((member) => ({
      orderId: member.id,
      orderNumber: member.orderNumber || member.id,
      trackingNumber: member.trackingNumber || "",
      linked: (member.shipments || []).some((entry) => text(entry.masterShipmentId) === text(shipment.id)),
    })),
  };
  if (!apply) {
    console.log(JSON.stringify(preview, null, 2));
    return;
  }

  const result = await linkPurchasedShipmentToGroup(order, shipment, "Shared shipment repair");
  order.updatedAt = new Date().toISOString();
  await postgres.saveOrder(order);
  await drainFulfillmentConsoleProjectionPatches();
  console.log(JSON.stringify({
    ...preview,
    applied: true,
    linkedOrders: result.linked.map((entry) => entry.order.orderNumber || entry.order.id),
  }, null, 2));
}

main()
  .then(() => postgres.closePool())
  .catch(async (error) => {
    console.error(error.stack || error.message || error);
    await postgres.closePool().catch(() => {});
    process.exitCode = 1;
  });
