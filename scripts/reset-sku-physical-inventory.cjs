const crypto = require('node:crypto');
const postgres = require('../db');
const { readDbFast, routeOrderForFulfillment } = require('../server');

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

function isPhysicalWarehouse(warehouse = {}) {
  const type = normalized(warehouse.warehouseType || warehouse.type);
  const sourceType = normalized(warehouse.inventorySourceType);
  return warehouse.isPhysical !== false
    && !['supplier dropship', 'virtual supplier feed', 'supplier feed'].includes(type)
    && !['supplier_feed', 'supplier', 'dropship', 'virtual'].includes(sourceType);
}

function activeWarehouseRoute(route = {}, sku = '') {
  return normalized(route.type) === 'warehouse'
    && normalized(route.sku) === normalized(sku)
    && !['fulfilled', 'shipped', 'delivered', 'canceled', 'cancelled', 'closed'].includes(normalized(route.status));
}

function orderNumber(order = {}) {
  return order.orderNumber || order.internalOrderNumber || order.marketplaceOrderId || order.id;
}

function releaseOrderAllocations(order, sku, now, reason) {
  let released = 0;
  for (const allocation of Array.isArray(order.inventoryAllocations) ? order.inventoryAllocations : []) {
    if (allocation.status === 'released' || normalized(allocation.sku || allocation.productId) !== normalized(sku)) continue;
    released += Number(allocation.qty || 0);
    allocation.status = 'released';
    allocation.releasedAt = now;
    allocation.releaseReason = reason;
  }
  if (released) {
    order.reservedQty = (order.inventoryAllocations || [])
      .filter((allocation) => allocation.status !== 'released')
      .reduce((sum, allocation) => sum + Number(allocation.qty || 0), 0);
  }
  return released;
}

async function main() {
  if (!postgres.isPostgresEnabled()) throw new Error('DATABASE_URL is required.');
  const sku = option('sku');
  const reason = option('reason', 'Testing');
  const note = option('note', 'Full physical reset requested after test receiving.');
  const user = option('user', 'Physical inventory reset');
  const apply = process.argv.includes('--apply');
  if (!sku) throw new Error('--sku is required.');

  const [item, orders, warehouses] = await Promise.all([
    postgres.readProductByKey(sku),
    postgres.listOrders({ sku, limit: 5000 }),
    postgres.readStateField('warehouses')
  ]);
  if (!item || normalized(item.sku) !== normalized(sku)) throw new Error(`${sku} was not found as a primary product.`);
  const physicalIds = new Set((warehouses || []).filter(isPhysicalWarehouse).map((warehouse) => String(warehouse.id || '')));
  const physicalRows = (item.warehouseStock || []).filter((row) => physicalIds.has(String(row.warehouseId || '')));
  const impactedOrders = (orders || []).map((order) => {
    const routes = (order.fulfillmentRoutes || []).filter((route) => activeWarehouseRoute(route, item.sku));
    const allocations = (order.inventoryAllocations || []).filter((allocation) => allocation.status !== 'released'
      && normalized(allocation.sku || allocation.productId) === normalized(item.sku));
    return { order, routes, allocations };
  }).filter((entry) => entry.routes.length || entry.allocations.length);

  const preview = {
    apply,
    sku: item.sku,
    reason,
    note,
    physicalOnHandBefore: physicalRows.reduce((sum, row) => sum + Number(row.qty || 0), 0),
    physicalReservedBefore: physicalRows.reduce((sum, row) => sum + Number(row.reserved || 0), 0),
    supplierFeedQtyPreserved: (item.warehouseStock || []).filter((row) => !physicalIds.has(String(row.warehouseId || '')))
      .reduce((sum, row) => sum + Number(row.qty || 0), 0),
    physicalLocations: physicalRows.filter((row) => Number(row.qty || 0) || Number(row.reserved || 0)).map((row) => ({
      warehouseId: row.warehouseId,
      warehouseName: (warehouses || []).find((warehouse) => String(warehouse.id) === String(row.warehouseId))?.name || row.warehouseName,
      onHand: Number(row.qty || 0),
      reserved: Number(row.reserved || 0)
    })),
    impactedOrders: impactedOrders.map(({ order, routes, allocations }) => ({
      id: order.id,
      orderNumber: orderNumber(order),
      status: order.status,
      routes: routes.map((route) => ({ id: route.id, status: route.status, sellQty: Number(route.qty || 0), inventoryQty: Number(route.inventoryQty || route.qty || 0), warehouseName: route.warehouseName })),
      allocations: allocations.map((allocation) => ({ id: allocation.id, qty: Number(allocation.qty || 0), warehouseName: allocation.warehouseName }))
    }))
  };
  if (!apply) {
    console.log(JSON.stringify(preview, null, 2));
    return;
  }

  const db = await readDbFast({ skipInventory: true });
  const [inventoryLedger, purchaseRequirements, purchaseOrders] = await Promise.all([
    postgres.readStateField('inventoryLedger').catch(() => []),
    postgres.readStateField('purchaseRequirements').catch(() => []),
    postgres.listPurchaseOrders({ limit: 10000 })
  ]);
  db.inventoryLedger = inventoryLedger || [];
  db.purchaseRequirements = purchaseRequirements || [];
  db.purchaseOrders = purchaseOrders || [];
  const now = new Date().toISOString();
  const removedRouteIds = new Set();

  for (const row of physicalRows) {
    const warehouse = (warehouses || []).find((entry) => String(entry.id) === String(row.warehouseId));
    const qtyBefore = Number(row.qty || 0);
    const reservedBefore = Number(row.reserved || 0);
    if (!qtyBefore && !reservedBefore) continue;
    row.qty = 0;
    row.available = 0;
    row.reserved = 0;
    row.committed = 0;
    row.updatedAt = now;
    db.inventoryLedger.push({
      id: crypto.randomUUID(),
      type: 'warehouse_adjustment',
      source: 'inventory_adjustment',
      sku: item.sku,
      productId: item.id,
      warehouseId: row.warehouseId || '',
      warehouseName: warehouse?.name || row.warehouseName || '',
      locationBin: row.locationBin || '',
      quantityChange: -qtyBefore,
      reservedChange: -reservedBefore,
      qtyBefore,
      qtyAfter: 0,
      reservedBefore,
      reservedAfter: 0,
      reason: `${reason}: ${note}`,
      user,
      createdAt: now
    });
  }
  item.qty = (item.warehouseStock || []).reduce((sum, row) => sum + Number(row.qty || 0), 0);
  item.reserved = (item.warehouseStock || []).reduce((sum, row) => sum + Number(row.reserved || 0), 0);
  item.available = (item.warehouseStock || []).reduce((sum, row) => sum + Math.max(0, Number(row.qty || 0) - Number(row.reserved || 0)), 0);
  item.updatedAt = now;
  await postgres.upsertProductsFromState([item]);
  await postgres.upsertInventoryLevelsFromProducts([item]);

  for (const entry of impactedOrders) {
    for (const route of entry.routes) removedRouteIds.add(String(route.id || ''));
    entry.order.fulfillmentRoutes = (entry.order.fulfillmentRoutes || []).filter((route) => !removedRouteIds.has(String(route.id || '')));
    releaseOrderAllocations(entry.order, item.sku, now, `${reason}: ${note}`);
    entry.order.routingLastResult = '';
    entry.order.routingAttemptCount = 0;
    entry.order.updatedAt = now;
  }
  db.purchaseRequirements = db.purchaseRequirements.filter((entry) => !removedRouteIds.has(String(entry.routeId || '')));

  const rerouted = [];
  const touchedProducts = new Map();
  const autoPurchaseOrders = new Map();
  for (const entry of impactedOrders) {
    const result = await routeOrderForFulfillment(db, entry.order, { force: true, user });
    for (const product of result.touchedProducts || []) touchedProducts.set(product.id || product.sku, product);
    for (const po of result.autoPurchaseOrders || []) autoPurchaseOrders.set(po.id, po);
    await postgres.saveOrder(entry.order);
    rerouted.push({
      orderId: entry.order.id,
      orderNumber: orderNumber(entry.order),
      routes: (result.routes || []).map((route) => ({
        type: route.type,
        status: route.status,
        sku: route.sku,
        sellQty: Number(route.qty || 0),
        inventoryQty: Number(route.inventoryQty || 0),
        inventoryMultiplier: Number(route.inventoryMultiplier || 1),
        vendorId: route.vendorId || '',
        vendorName: route.vendorName || '',
        warehouseName: route.warehouseName || ''
      }))
    });
  }
  if (touchedProducts.size) {
    await postgres.upsertProductsFromState([...touchedProducts.values()]);
    await postgres.upsertInventoryLevelsFromProducts([...touchedProducts.values()]);
  }
  for (const po of autoPurchaseOrders.values()) await postgres.savePurchaseOrder(po);
  await postgres.writeStateDocuments({
    inventoryLedger: db.inventoryLedger,
    purchaseRequirements: db.purchaseRequirements,
    sequence: db.sequence || {}
  });

  const verified = await postgres.readProductByKey(item.sku);
  console.log(JSON.stringify({
    ...preview,
    applied: true,
    physicalOnHandAfter: (verified.warehouseStock || []).filter((row) => physicalIds.has(String(row.warehouseId || ''))).reduce((sum, row) => sum + Number(row.qty || 0), 0),
    physicalReservedAfter: (verified.warehouseStock || []).filter((row) => physicalIds.has(String(row.warehouseId || ''))).reduce((sum, row) => sum + Number(row.reserved || 0), 0),
    supplierFeedQtyAfter: (verified.warehouseStock || []).filter((row) => !physicalIds.has(String(row.warehouseId || ''))).reduce((sum, row) => sum + Number(row.qty || 0), 0),
    rerouted
  }, null, 2));
}

main()
  .then(() => postgres.closePool())
  .catch(async (error) => {
    console.error(error.stack || error.message || error);
    await postgres.closePool().catch(() => {});
    process.exitCode = 1;
  });
