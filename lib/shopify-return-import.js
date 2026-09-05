async function collectPages(fetchPage) {
  const rows = [];
  const seen = new Set();
  let after = null;
  do {
    const connection = await fetchPage(after);
    if (!connection || !Array.isArray(connection.nodes)) throw new Error("Shopify returned an incomplete connection.");
    rows.push(...connection.nodes);
    if (!connection.pageInfo?.hasNextPage) break;
    const cursor = connection.pageInfo.endCursor;
    if (!cursor || seen.has(cursor)) throw new Error("Shopify pagination did not advance.");
    seen.add(cursor); after = cursor;
  } while (true);
  return rows;
}

async function importShopifyReturns({ request, findOrder, save, progress, since }) {
  const page = "pageInfo { hasNextPage endCursor }";
  const connection = (id, type, field, fields) => collectPages(async (after) => {
    const result = await request(`query DataPlusReturnPage($id: ID!, $after: String) { node(id:$id) { ... on ${type} { ${field}(first:50, after:$after) { nodes { ${fields} } ${page} } } } }`, { id, after });
    return result.node?.[field];
  });
  let scanned = 0, imported = 0, skipped = 0;
  const errors = [];
  let after = null;
  const seen = new Set();
  do {
    const data = await request(`query DataPlusReturnOrders($after:String, $query:String!) { orders(first:50, after:$after, query:$query, sortKey:CREATED_AT) { nodes { id legacyResourceId } ${page} } }`, { after, query: `created_at:>=${since}` });
    if (!data.orders) throw new Error("Shopify orders were not returned. Check read_orders/read_all_orders permissions.");
    for (const source of data.orders.nodes) {
      const order = await findOrder(String(source.legacyResourceId), source.id);
      scanned++;
      if (!order) { skipped++; continue; }
      try {
        const returns = await connection(source.id, "Order", "returns", "id name status createdAt closedAt");
        for (const record of returns) {
          const lines = await connection(record.id, "Return", "returnLineItems", "id quantity ... on ReturnLineItem { returnReason returnReasonNote fulfillmentLineItem { lineItem { id sku title } } }");
          const refunds = await connection(record.id, "Return", "refunds", "id createdAt totalRefundedSet { shopMoney { amount currencyCode } }");
          for (const refund of refunds) refund.transactions = await connection(refund.id, "Refund", "transactions", "id kind status amountSet { shopMoney { amount currencyCode } }");
          const reverseOrders = await connection(record.id, "Return", "reverseFulfillmentOrders", "id");
          const tracking = [];
          for (const reverse of reverseOrders) {
            const deliveries = await connection(reverse.id, "ReverseFulfillmentOrder", "reverseDeliveries", "id deliverable { ... on ReverseDeliveryShippingDeliverable { tracking { carrierName number url } } }");
            for (const delivery of deliveries) {
              const row = delivery.deliverable?.tracking;
              if (row?.number) tracking.push({ trackingNumber: row.number, carrier: row.carrierName, trackingUrl: row.url });
            }
          }
          await save(order, { ...record, lines, refunds, returnTracking: tracking });
          imported++;
        }
      } catch (error) {
        if (/access|permission|scope|not defined|doesn't exist/i.test(error.message)) throw error;
        errors.push(`Order ${order.orderNumber}: ${error.message}`);
      }
      await progress({ scanned, imported, skipped });
    }
    if (!data.orders.pageInfo.hasNextPage) break;
    after = data.orders.pageInfo.endCursor;
    if (!after || seen.has(after)) throw new Error("Shopify order pagination did not advance.");
    seen.add(after);
  } while (true);
  return { scanned, imported, skipped, errors };
}

module.exports = { importShopifyReturns, collectPages };
