const postgres = require("../db");
const { readOrderRoutingContext, refreshFulfillmentConsoleSnapshot, routeOrderForFulfillment } = require("../server");
const { ebayLiveOrderUsesCommittedStock } = require("../lib/ebay-live-order");

function text(value) {
  return String(value || "").trim();
}

function openSupplierReviewRoute(route = {}) {
  return ["purchase", "drop_ship"].includes(text(route.type).toLowerCase())
    && ["buyer_review", "exception", "blocked"].includes(text(route.status).toLowerCase())
    && !text(route.purchaseOrderId || route.purchaseOrderNumber);
}

function terminalOrder(order = {}) {
  const terminal = new Set(["canceled", "cancelled", "void", "deleted", "fulfilled", "shipped", "delivered", "returned", "refunded"]);
  return [order.status, order.fulfillmentStatus, order.operationalStatus]
    .map((value) => text(value).toLowerCase())
    .some((value) => terminal.has(value));
}

async function candidateOrderIds() {
  const result = await postgres.getPool().query(`
    select order_id
    from order_records
    where lower(coalesce(channel_source, source, '')) = 'ebay'
      and (
        coalesce(raw ->> 'isEbayLive', 'false') = 'true'
        or coalesce(raw -> 'ebayLive' ->> 'isLive', 'false') = 'true'
        or coalesce(raw -> 'external' ->> 'isEbayLive', 'false') = 'true'
        or lower(coalesce(raw ->> 'salesOrigin', raw -> 'external' ->> 'salesOrigin', '')) = 'ebay_live'
      )
      and (
        coalesce(paid_amount, 0) >= coalesce(total, 0)
        or lower(coalesce(raw ->> 'financialStatus', raw ->> 'paymentStatus', '')) = 'paid'
      )
      and (
        jsonb_array_length(coalesce(raw -> 'fulfillmentRoutes', '[]'::jsonb)) = 0
        or exists (
          select 1 from jsonb_array_elements(coalesce(raw -> 'workflowExceptions', '[]'::jsonb)) exception
          where exception ->> 'type' = 'supplier_assignment_required'
            and coalesce(exception ->> 'status', 'open') <> 'resolved'
        )
      )
    order by nullif(regexp_replace(order_number, '[^0-9]', '', 'g'), '')::bigint nulls last, order_number
  `);
  return result.rows.map((row) => text(row.order_id)).filter(Boolean);
}

async function main() {
  if (!postgres.isPostgresEnabled()) throw new Error("DATABASE_URL is required.");
  const apply = process.argv.includes("--apply");
  const user = "eBay Live fulfillment repair";
  const ids = await candidateOrderIds();
  const orders = ids.length ? await postgres.readOrdersByIds(ids) : [];
  const candidates = [];
  const skipped = [];
  for (const order of orders) {
    const lines = Array.isArray(order.items) ? order.items : [];
    const routes = Array.isArray(order.fulfillmentRoutes) ? order.fulfillmentRoutes : [];
    const missingRoutes = routes.length === 0;
    const committedPurchaseRoute = routes.find((route) => text(route.purchaseOrderId || route.purchaseOrderNumber));
    const reviewRoutes = (order.fulfillmentRoutes || []).filter(openSupplierReviewRoute);
    const unsafeRoute = reviewRoutes.find((route) => !ebayLiveOrderUsesCommittedStock(order, lines[Number(route.lineIndex)] || {}));
    if (terminalOrder(order) || committedPurchaseRoute || (!missingRoutes && !reviewRoutes.length) || unsafeRoute) {
      const reason = terminalOrder(order)
        ? "Order is already terminal"
        : committedPurchaseRoute
          ? "Order already has committed purchase-order routing"
          : !missingRoutes && !reviewRoutes.length
            ? "No uncommitted supplier-review route"
            : "Contains a non-Live supplier-review line";
      skipped.push({ orderNumber: order.orderNumber || order.id, reason });
      continue;
    }
    candidates.push(order);
  }

  const preview = {
    apply,
    candidateCount: candidates.length,
    skippedCount: skipped.length,
    orders: candidates.map((order) => ({
      orderId: order.id,
      orderNumber: order.orderNumber || order.id,
      skus: (order.items || []).map((line) => line.sku).filter(Boolean),
      reason: (order.fulfillmentRoutes || []).length ? "replace supplier-review route" : "create missing fulfillment route",
      routes: (order.fulfillmentRoutes || []).filter(openSupplierReviewRoute).map((route) => ({ id: route.id, type: route.type, status: route.status }))
    })),
    skipped
  };
  if (!apply || !candidates.length) {
    console.log(JSON.stringify(preview, null, 2));
    return;
  }

  const db = await readOrderRoutingContext({ includePurchaseRequirements: true, includeInventoryLedger: true });
  db.purchaseOrders = await postgres.listPurchaseOrders({ statuses: ["draft", "approved", "awaiting_approval", "ready_to_send"], limit: 500 }) || [];
  const repaired = [];
  for (const order of candidates) {
    const result = await routeOrderForFulfillment(db, order, { force: true, user });
    const liveRoutes = (result.routes || []).filter((route) => route.inventoryOrigin === "ebay_live_committed_stock");
    if (!liveRoutes.length) throw new Error(`Order ${order.orderNumber || order.id} did not create an eBay Live warehouse route.`);
    const products = [...new Map((result.touchedProducts || []).map((product) => [String(product.id || product.sku), product])).values()];
    if (products.length) {
      await postgres.upsertProductsFromState(products);
      await postgres.upsertInventoryLevelsFromProducts(products);
    }
    await postgres.savePurchaseOrderMutation({
      purchaseOrders: result.autoPurchaseOrders || [],
      orders: [order],
      state: { purchaseRequirements: db.purchaseRequirements || [], sequence: db.sequence || {} }
    });
    repaired.push({
      orderId: order.id,
      orderNumber: order.orderNumber || order.id,
      routes: liveRoutes.map((route) => ({ sku: route.sku, qty: route.qty, warehouseId: route.warehouseId, warehouseName: route.warehouseName }))
    });
  }
  await postgres.writeStateDocuments({ inventoryLedger: db.inventoryLedger || [] });
  await refreshFulfillmentConsoleSnapshot();
  console.log(JSON.stringify({ ...preview, applied: true, repairedCount: repaired.length, repaired }, null, 2));
}

main()
  .then(() => postgres.closePool())
  .catch(async (error) => {
    console.error(error.stack || error.message || error);
    await postgres.closePool().catch(() => {});
    process.exitCode = 1;
  });
