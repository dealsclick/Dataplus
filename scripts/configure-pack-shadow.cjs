const crypto = require('node:crypto');
const postgres = require('../db');
const {
  cancelPurchaseOrder,
  purchaseOrderHasSupplierCommitment,
  readDbFast,
  routeOrderForFulfillment
} = require('../server');

function option(name, fallback = '') {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')
    ? process.argv[index + 1]
    : fallback;
}

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

function orderLines(order = {}) {
  if (Array.isArray(order.items)) return order.items;
  if (Array.isArray(order.lineItems)) return order.lineItems;
  if (Array.isArray(order.lines)) return order.lines;
  return [];
}

function aliasValue(alias = {}) {
  return String(alias.aliasSku || alias.sku || alias.value || '').trim();
}

function hasSupplierCommitment(po = {}) {
  return purchaseOrderHasSupplierCommitment(po);
}

function matchingLineIndexes(order, marketplaceSku, oldParentSku) {
  const wanted = new Set([marketplaceSku, oldParentSku].map(normalized).filter(Boolean));
  const matches = [];
  orderLines(order).forEach((line, index) => {
    const values = [
      line.sku, line.originalSku, line.sourceSku, line.marketplaceSku,
      line.channelSku, line.externalSku, line.mappedSku, line.parentSku,
      line.productId, line.productID
    ].map(normalized).filter(Boolean);
    if (values.some((value) => wanted.has(value))) matches.push(index);
  });
  return matches;
}

async function inspectOrder(orderKey, marketplaceSku, oldParentSku) {
  const order = await postgres.readOrderByKey(orderKey);
  if (!order) throw new Error(`Order ${orderKey} was not found.`);
  const lineIndexes = matchingLineIndexes(order, marketplaceSku, oldParentSku);
  if (!lineIndexes.length) throw new Error(`Order ${orderKey} has no line matching ${marketplaceSku}.`);
  const routes = (Array.isArray(order.fulfillmentRoutes) ? order.fulfillmentRoutes : [])
    .filter((route) => lineIndexes.includes(Number(route.lineIndex)));
  const poKeys = [...new Set(routes.flatMap((route) => [route.purchaseOrderId, route.purchaseOrderNumber]).filter(Boolean))];
  const purchaseOrders = [];
  for (const key of poKeys) {
    const po = await postgres.readPurchaseOrderByKey(key);
    if (po && !purchaseOrders.some((entry) => String(entry.id) === String(po.id))) purchaseOrders.push(po);
  }
  return { order, lineIndexes, routes, purchaseOrders };
}

function relationPreview(parent, existingOwner, input) {
  return {
    parent: parent.sku,
    shadowSku: input.shadowSku,
    marketplaceSku: input.marketplaceSku,
    marketplace: input.marketplace,
    unitsPerPack: input.unitsPerPack,
    existingOwner: existingOwner?.sku || null,
    existingOwnerTitle: existingOwner?.title || null,
    parentOnHand: Number(parent.qty || 0),
    availablePacks: Math.floor(Number(parent.available ?? parent.qty ?? 0) / input.unitsPerPack)
  };
}

function prepareRelationship(parent, existingOwner, input) {
  const now = new Date().toISOString();
  const relationshipKeys = new Set([input.shadowSku, input.marketplaceSku].map(normalized));
  const changed = [];
  if (existingOwner && String(existingOwner.id || existingOwner.sku) !== String(parent.id || parent.sku)) {
    existingOwner.aliases = (Array.isArray(existingOwner.aliases) ? existingOwner.aliases : [])
      .filter((alias) => !relationshipKeys.has(normalized(aliasValue(alias))));
    existingOwner.shadowSkus = (Array.isArray(existingOwner.shadowSkus) ? existingOwner.shadowSkus : [])
      .filter((shadow) => ![shadow.shadowSku, shadow.marketplaceSku, shadow.channelSku].some((value) => relationshipKeys.has(normalized(value))));
    existingOwner.updatedAt = now;
    changed.push(existingOwner);
  }

  parent.aliases = (Array.isArray(parent.aliases) ? parent.aliases : [])
    .filter((alias) => !relationshipKeys.has(normalized(aliasValue(alias))));
  parent.shadowSkus = (Array.isArray(parent.shadowSkus) ? parent.shadowSkus : [])
    .filter((shadow) => ![shadow.shadowSku, shadow.marketplaceSku, shadow.channelSku].some((value) => relationshipKeys.has(normalized(value))));
  const shadowId = crypto.randomUUID();
  const shadow = {
    id: shadowId,
    parentSku: parent.sku,
    shadowSku: input.shadowSku,
    marketplaceSku: input.marketplaceSku,
    channelSku: input.marketplaceSku,
    marketplace: input.marketplace,
    company: input.marketplace,
    unitsPerPack: input.unitsPerPack,
    inventoryMultiplier: input.unitsPerPack,
    inventoryTrackingMode: 'piece',
    status: 'Active',
    notes: input.note,
    createdAt: now,
    updatedAt: now
  };
  parent.shadowSkus.push(shadow);
  for (const aliasSku of [input.shadowSku, input.marketplaceSku]) {
    parent.aliases.push({
      id: crypto.randomUUID(),
      aliasSku,
      parentSku: parent.sku,
      source: input.marketplace,
      marketplace: input.marketplace,
      type: 'shadow',
      active: true,
      shadowId,
      uomQty: input.unitsPerPack,
      unitsPerPack: input.unitsPerPack,
      inventoryMultiplier: input.unitsPerPack,
      notes: input.note,
      createdAt: now,
      updatedAt: now
    });
  }
  parent.inventoryTrackingMode = 'piece';
  parent.inventoryBaseUnit = 'each';
  parent.updatedAt = now;
  changed.push(parent);
  return { changed, shadow };
}

async function repairOrder(context, input) {
  const { order, lineIndexes, routes, purchaseOrders } = context;
  const terminalRoute = routes.find((route) => ['fulfilled', 'shipped', 'delivered', 'closed'].includes(normalized(route.status)));
  if (terminalRoute) throw new Error(`Order ${order.orderNumber || order.id} already has terminal fulfillment work and was not changed.`);
  const committed = purchaseOrders.find(hasSupplierCommitment);
  if (committed) throw new Error(`${committed.poNumber || committed.id} has supplier commitment evidence and was not changed.`);

  const now = new Date().toISOString();
  const routeIds = new Set(routes.map((route) => String(route.id || '')).filter(Boolean));
  const poIds = new Set(purchaseOrders.map((po) => String(po.id || '')).filter(Boolean));
  const poNumbers = new Set(purchaseOrders.map((po) => String(po.poNumber || '')).filter(Boolean));
  for (const po of purchaseOrders) {
    cancelPurchaseOrder(po, [order], {
      reasonCode: 'wrong_sku',
      reasonNote: `Corrected ${input.marketplaceSku} to ${input.shadowSku}, a ${input.unitsPerPack}-piece shadow of ${input.parentSku}.`,
      user: input.user
    });
    await postgres.savePurchaseOrder(po);
  }

  order.fulfillmentRoutes = (Array.isArray(order.fulfillmentRoutes) ? order.fulfillmentRoutes : [])
    .filter((route) => !routeIds.has(String(route.id || '')));
  order.purchaseOrderIds = (Array.isArray(order.purchaseOrderIds) ? order.purchaseOrderIds : [])
    .filter((value) => !poIds.has(String(value || '')));
  order.purchaseOrderNumbers = (Array.isArray(order.purchaseOrderNumbers) ? order.purchaseOrderNumbers : [])
    .filter((value) => !poNumbers.has(String(value || '')));
  for (const index of lineIndexes) {
    const line = orderLines(order)[index];
    line.originalSku = line.originalSku || input.marketplaceSku;
    line.sourceSku = line.sourceSku || input.marketplaceSku;
    line.marketplaceSku = input.marketplaceSku;
    line.sku = input.marketplaceSku;
    line.status = 'unfulfilled';
    delete line.mappedSku;
    delete line.parentSku;
    delete line.shadowSku;
    delete line.shadowId;
    delete line.inventoryMultiplier;
    delete line.purchaseOrderId;
    delete line.purchaseOrderNumber;
    delete line.purchaseGroupId;
  }
  order.hasPurchaseOrder = false;
  order.routingLastResult = '';
  order.routingAttemptCount = 0;
  order.updatedAt = now;

  const db = await readDbFast({ skipInventory: true });
  const [inventoryLedger, purchaseRequirements, purchaseOrdersState] = await Promise.all([
    postgres.readStateField('inventoryLedger').catch(() => []),
    postgres.readStateField('purchaseRequirements').catch(() => []),
    postgres.listPurchaseOrders({ limit: 10000 })
  ]);
  db.inventoryLedger = inventoryLedger || [];
  db.purchaseRequirements = (purchaseRequirements || []).filter((entry) => !routeIds.has(String(entry.routeId || '')));
  db.purchaseOrders = purchaseOrdersState || [];
  const result = await routeOrderForFulfillment(db, order, { force: true, user: input.user });
  const touchedProducts = [...new Map((result.touchedProducts || []).map((product) => [product.id || product.sku, product])).values()];
  if (touchedProducts.length) {
    await postgres.upsertProductsFromState(touchedProducts);
    await postgres.upsertInventoryLevelsFromProducts(touchedProducts);
  }
  for (const po of result.autoPurchaseOrders || []) await postgres.savePurchaseOrder(po);
  await postgres.writeStateDocuments({
    inventoryLedger: db.inventoryLedger || [],
    purchaseRequirements: db.purchaseRequirements || [],
    sequence: db.sequence || {}
  });
  await postgres.saveOrder(order);
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    canceledPurchaseOrders: purchaseOrders.map((po) => po.poNumber || po.id),
    routes: (result.routes || []).map((route) => ({
      type: route.type,
      status: route.status,
      sku: route.sku,
      sellQty: route.qty,
      inventoryQty: route.inventoryQty,
      inventoryMultiplier: route.inventoryMultiplier,
      warehouse: route.warehouseName || route.vendorName || ''
    }))
  };
}

async function main() {
  if (!postgres.isPostgresEnabled()) throw new Error('DATABASE_URL is required.');
  const input = {
    parentSku: option('parent'),
    shadowSku: option('shadow'),
    marketplaceSku: option('marketplace-sku'),
    marketplace: option('marketplace', 'Temu'),
    unitsPerPack: Number(option('units', '1')),
    orderKey: option('order'),
    note: option('note', 'Marketplace multipack shares the parent piece inventory.'),
    user: option('user', 'Pack shadow repair')
  };
  if (!input.parentSku || !input.shadowSku || !input.marketplaceSku) throw new Error('--parent, --shadow, and --marketplace-sku are required.');
  if (!Number.isInteger(input.unitsPerPack) || input.unitsPerPack < 1) throw new Error('--units must be a whole number of at least 1.');
  const apply = process.argv.includes('--apply');
  const parent = await postgres.readProductByKey(input.parentSku);
  if (!parent || normalized(parent.sku) !== normalized(input.parentSku)) throw new Error(`Parent SKU ${input.parentSku} was not found as a primary product.`);
  const existingOwner = await postgres.readProductByKey(input.marketplaceSku);
  const oldParentSku = existingOwner && String(existingOwner.id || existingOwner.sku) !== String(parent.id || parent.sku) ? existingOwner.sku : '';
  const orderContext = input.orderKey ? await inspectOrder(input.orderKey, input.marketplaceSku, oldParentSku) : null;
  const preview = {
    apply,
    relationship: relationPreview(parent, existingOwner, input),
    order: orderContext ? {
      id: orderContext.order.id,
      orderNumber: orderContext.order.orderNumber,
      marketplaceOrderId: orderContext.order.marketplaceOrderId,
      status: orderContext.order.status,
      matchingLines: orderContext.lineIndexes.map((index) => ({ index, ...orderLines(orderContext.order)[index] })),
      routes: orderContext.routes.map((route) => ({ id: route.id, type: route.type, status: route.status, sku: route.sku, purchaseOrderNumber: route.purchaseOrderNumber })),
      purchaseOrders: orderContext.purchaseOrders.map((po) => ({ id: po.id, poNumber: po.poNumber, status: po.status, committed: hasSupplierCommitment(po) }))
    } : null
  };
  if (!apply) {
    console.log(JSON.stringify(preview, null, 2));
    return;
  }

  if (orderContext) {
    const committed = orderContext.purchaseOrders.find(hasSupplierCommitment);
    if (committed) throw new Error(`${committed.poNumber || committed.id} has supplier commitment evidence; relationship and order were not changed.`);
  }
  const relationship = prepareRelationship(parent, existingOwner, input);
  await postgres.upsertProductsFromState(relationship.changed);
  const repairedOrder = orderContext ? await repairOrder(orderContext, input) : null;
  const verified = await postgres.readProductByKey(input.marketplaceSku);
  console.log(JSON.stringify({
    ...preview,
    applied: true,
    resolvedParent: verified?.sku || null,
    alias: (verified?.aliases || []).find((alias) => normalized(aliasValue(alias)) === normalized(input.marketplaceSku)) || null,
    shadow: (verified?.shadowSkus || []).find((shadow) => normalized(shadow.marketplaceSku) === normalized(input.marketplaceSku)) || null,
    repairedOrder
  }, null, 2));
}

main()
  .then(() => postgres.closePool())
  .catch(async (error) => {
    console.error(error.stack || error.message || error);
    await postgres.closePool().catch(() => {});
    process.exitCode = 1;
  });
