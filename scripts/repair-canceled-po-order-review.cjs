const postgres = require("../db");

const TERMINAL_ORDER_STATUSES = new Set(["canceled", "cancelled", "void", "voided", "deleted", "refunded", "fulfilled", "completed", "complete", "done", "delivered"]);
const TERMINAL_ROUTE_STATUSES = new Set(["fulfilled", "shipped", "delivered", "closed"]);

function canceledPoReason(po) {
  const label = String(po.cancelReasonLabel || po.cancelReason || "Cancellation reason was not recorded").trim();
  const note = String(po.cancelReasonNote || "").trim();
  return `${po.poNumber || "Linked purchase order"} was canceled: ${label}${note ? ` (${note})` : ""}.`;
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (!postgres.isPostgresEnabled()) throw new Error("DATABASE_URL is required.");
  await postgres.initDatabase();
  const purchaseOrders = await postgres.listPurchaseOrders({ limit: 10000, includeDeleted: true });
  const canceled = (purchaseOrders || []).filter((po) => ["canceled", "cancelled"].includes(String(po.status || "").toLowerCase()));
  const orderIds = [...new Set(canceled.flatMap((po) => [
    ...(Array.isArray(po.orderIds) ? po.orderIds : []),
    ...(Array.isArray(po.items) ? po.items.map((line) => line?.orderId) : [])
  ]).map((value) => String(value || "").trim()).filter(Boolean))];
  const orders = orderIds.length ? await postgres.readOrdersByIds(orderIds) : [];
  const poById = new Map(canceled.map((po) => [String(po.id || ""), po]));
  let changed = 0;

  for (const order of orders || []) {
    const states = [order.status, order.operationalStatus, order.workflowStatus, order.fulfillmentStatus].map((value) => String(value || "").toLowerCase());
    if (states.some((value) => TERMINAL_ORDER_STATUSES.has(value))) continue;
    let orderChanged = false;
    for (const route of Array.isArray(order.fulfillmentRoutes) ? order.fulfillmentRoutes : []) {
      const po = poById.get(String(route.purchaseOrderId || ""));
      if (!po || TERMINAL_ROUTE_STATUSES.has(String(route.status || "").toLowerCase())) continue;
      const reason = canceledPoReason(po);
      const desiredLabel = po.cancelReasonLabel || po.cancelReason || "Cancellation reason was not recorded";
      if (String(route.status || "").toLowerCase() === "buyer_review"
        && route.reviewReason === reason
        && String(route.canceledPurchaseOrderId || "") === String(po.id || "")
        && route.purchaseOrderCancelReasonLabel === desiredLabel) continue;
      route.status = "buyer_review";
      route.reviewReason = reason;
      route.canceledPurchaseOrderId = po.id || "";
      route.canceledPurchaseOrderNumber = po.poNumber || "";
      route.purchaseOrderCancelReasonCode = po.cancelReasonCode || "";
      route.purchaseOrderCancelReasonLabel = desiredLabel;
      route.purchaseOrderCancelReasonNote = po.cancelReasonNote || "";
      route.updatedAt = new Date().toISOString();
      orderChanged = true;
    }
    if (!orderChanged) continue;
    order.operationalStatus = "buyer_review";
    order.workflowStatus = "buyer_review";
    order.workflowUpdatedAt = new Date().toISOString();
    order.updatedAt = order.workflowUpdatedAt;
    changed += 1;
    if (apply) await postgres.saveOrder(order);
  }

  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", canceledPurchaseOrders: canceled.length, linkedOrdersChecked: (orders || []).length, ordersMovedToReview: changed }, null, 2));
  await postgres.closePool();
}

main().catch(async (error) => {
  console.error(error);
  await postgres.closePool().catch(() => {});
  process.exitCode = 1;
});
