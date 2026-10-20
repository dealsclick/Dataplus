const crypto = require('crypto');

const TERMINAL = new Set(['canceled', 'cancelled', 'closed', 'delivered', 'expired', 'fulfilled', 'shipped', 'superseded', 'void', 'voided']);
const SPLITTABLE_STAGES = new Set(['new', 'allocated', 'ready_to_ship', 'exception']);

function positiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}

function activeRoutes(order = {}) {
  return (Array.isArray(order.fulfillmentRoutes) ? order.fulfillmentRoutes : []).filter((route) => {
    const status = String(route.status || '').trim().toLowerCase();
    return !TERMINAL.has(status) && Number(route.qty ?? route.quantity ?? route.qtyAllocated ?? 0) > 0;
  });
}

function hasPurchasedLabel(order = {}) {
  return (Array.isArray(order.shipments) ? order.shipments : []).some((shipment) => {
    if (['voided', 'canceled', 'cancelled'].includes(String(shipment.voidStatus || shipment.status || '').toLowerCase())) return false;
    return Boolean(String(shipment.trackingNumber || '').trim()
      || String(shipment.labelPurchaseId || '').trim()
      || (Array.isArray(shipment.documents) && shipment.documents.some((document) => document.documentType === 'shipping_label' || document.documentId || document.id)));
  });
}

function clearSplitFields(route = {}) {
  const next = { ...route };
  for (const key of ['shipmentPackageGroupId', 'shipmentSplitPlanId', 'shipmentSplitPackageIndex', 'shipmentSplitPackageCount', 'shipmentSplitSourceRouteId']) delete next[key];
  return next;
}

function splitFulfillmentRoutes(order = {}, requestedLabelCount, options = {}) {
  const labelCount = Number(requestedLabelCount);
  if (!Number.isInteger(labelCount) || labelCount < 1 || labelCount > 20) throw new Error('Choose between 1 and 20 shipping labels.');
  if (hasPurchasedLabel(order)) throw new Error('Void the active shipping label before changing the shipment split.');
  const routes = activeRoutes(order);
  if (!routes.length) throw new Error('This order has no active fulfillment quantity to split.');
  if (routes.some((route) => String(route.type || '').toLowerCase() !== 'warehouse')) throw new Error('Only warehouse fulfillment can be split into multiple labels.');
  if (routes.some((route) => String(route.purchaseOrderId || '').trim())) throw new Error('A route linked to a purchase order cannot be split after purchasing has started.');
  if (routes.some((route) => !SPLITTABLE_STAGES.has(String(route.status || 'new').toLowerCase()))) throw new Error('Split the shipment before warehouse picking or packing begins.');
  if (routes.some((route) => route.pickListId || route.labelBatchId || route.trackingNumber)) throw new Error('Remove this order from its pick list or label batch before splitting it.');

  const grouped = new Map();
  for (const route of routes) {
    const sourceId = String(route.shipmentSplitSourceRouteId || route.id || '').trim();
    if (!sourceId) throw new Error('A fulfillment route is missing its identity.');
    const qty = Number(route.qty ?? route.quantity ?? route.qtyAllocated ?? 0);
    if (!Number.isInteger(qty) || qty <= 0) throw new Error('Shipment splitting requires whole-unit fulfillment quantities.');
    const current = grouped.get(sourceId) || { sourceId, qty: 0, template: route };
    current.qty += qty;
    if (String(route.id || '') === sourceId) current.template = route;
    grouped.set(sourceId, current);
  }
  const totalUnits = [...grouped.values()].reduce((sum, entry) => sum + entry.qty, 0);
  if (labelCount > totalUnits) throw new Error(`This order has ${totalUnits} routed unit${totalUnits === 1 ? '' : 's'}, so it can use at most ${totalUnits} labels.`);

  const now = options.now || new Date().toISOString();
  const planId = options.planId || crypto.randomUUID();
  const packages = Array.from({ length: labelCount }, (_, index) => ({ index, routes: [], units: 0 }));
  let packageCursor = 0;
  for (const entry of grouped.values()) {
    const quantities = Array(labelCount).fill(0);
    for (let unit = 0; unit < entry.qty; unit += 1) {
      quantities[packageCursor % labelCount] += 1;
      packageCursor += 1;
    }
    let keptOriginal = false;
    quantities.forEach((qty, packageIndex) => {
      if (!qty) return;
      const id = !keptOriginal ? entry.sourceId : (options.randomUUID ? options.randomUUID() : crypto.randomUUID());
      keptOriginal = true;
      const route = clearSplitFields(entry.template);
      delete route.shippingRateReview;
      delete route.labelPurchasedAt;
      delete route.labelSource;
      route.id = id;
      route.qty = qty;
      route.quantity = qty;
      route.updatedAt = now;
      if (labelCount > 1) {
        route.shipmentPackageGroupId = `split:${planId}:${packageIndex + 1}`;
        route.shipmentSplitPlanId = planId;
        route.shipmentSplitPackageIndex = packageIndex + 1;
        route.shipmentSplitPackageCount = labelCount;
        route.shipmentSplitSourceRouteId = entry.sourceId;
      }
      packages[packageIndex].routes.push(route);
      packages[packageIndex].units += qty;
    });
  }

  const savedPackage = order.package && typeof order.package === 'object' ? order.package : {};
  const savedWeight = positiveNumber(savedPackage.packageWeight, savedPackage.weightPounds, savedPackage.weight);
  if (labelCount > 1 && savedWeight) {
    packages.forEach((shipmentPackage) => {
      const packageInfo = { ...savedPackage, packageWeight: Number((savedWeight * shipmentPackage.units / totalUnits).toFixed(3)) };
      shipmentPackage.routes.forEach((route) => {
        route.package = packageInfo;
        route.packageMeasurementSource = 'manual';
      });
    });
  }

  const activeIds = new Set(routes.map((route) => String(route.id || '')));
  const untouched = (Array.isArray(order.fulfillmentRoutes) ? order.fulfillmentRoutes : []).filter((route) => !activeIds.has(String(route.id || '')));
  order.fulfillmentRoutes = [...untouched, ...packages.flatMap((shipmentPackage) => shipmentPackage.routes)];
  order.shipmentSplit = labelCount > 1 ? { planId, labelCount, totalUnits, updatedAt: now, updatedBy: options.actor || 'DataPlus' } : null;
  delete order.shippingRateReview;
  order.updatedAt = now;
  return { order, labelCount, totalUnits, packageGroups: packages.map((shipmentPackage) => ({ packageIndex: shipmentPackage.index + 1, units: shipmentPackage.units, routeIds: shipmentPackage.routes.map((route) => route.id) })) };
}

module.exports = { activeRoutes, hasPurchasedLabel, splitFulfillmentRoutes };

