const { withDataWarehouseStock, isDataWarehouseLocation } = require('./inventory-locations');
const { fail } = require('./walmart-client');
const { productIsMasterInactive } = require('./product-selling-status');
const { productChannelInactive } = require('./channel-selling-status');
const { retiredSupplier } = require('./supplier-retirement');
const { safetyVendor, resolveInventorySafety } = require('./inventory-safety');
const { replenishableSafeguard, resolveReplenishableInventory } = require('./replenishable-inventory');

function inventoryAmount(product, db, settings, packSize) {
  if (productIsMasterInactive(product) || productChannelInactive(product, 'walmart') || retiredSupplier(product, db.vendors || []) || product.toBeDiscontinued === true || product.discontinued === true) return 0;
  product = withDataWarehouseStock(product);
  const warehouse = (db.warehouses || []).find(w => w.id === settings.walmartWarehouseId);
  if (!warehouse || (!isDataWarehouseLocation(warehouse) && warehouse.isPhysical !== true) || warehouse.active === false || warehouse.status === 'inactive') throw fail('Map an active physical warehouse or supplier stock location before publishing Walmart inventory.');
  const stock = (product.warehouseStock || []).filter(row => row.warehouseId === warehouse.id && row.isSellable !== false);
  const available = stock.reduce((sum, row) => sum + Math.max(0, Number(row.qty || 0) - Number(row.reserved || 0)), 0);
  const vendor = safetyVendor(product, db.vendors || []);
  const replenishable = resolveReplenishableInventory(product, vendor, settings.defaultReplenishableQty ?? 1, { channel: 'walmart' });
  const replenishableGuard = replenishable.enabled ? replenishableSafeguard(product, vendor, settings) : { suspended: false };
  const safety = resolveInventorySafety(product, vendor, settings.walmartSafetyQty || settings.defaultSafetyQty || 0).quantity, maximum = Number(settings.walmartMaxQuantity || settings.defaultMaxSellableQty || 0);
  if (!Number.isFinite(available) || !Number.isFinite(packSize) || packSize < 1 || !Number.isFinite(safety) || safety < 0 || !Number.isFinite(maximum) || maximum < 0) throw fail('Invalid inventory or UOM quantities.');
  const quantity = replenishable.enabled
    ? replenishableGuard.suspended ? 0 : Math.max(0, Math.floor(replenishable.quantity / packSize))
    : Math.max(0, Math.floor(Math.max(0, available - safety) / packSize));
  return maximum > 0 ? Math.min(quantity, Math.floor(maximum)) : quantity;
}

function shipmentPayload(order, remote, shipmentId) {
  const shipment = (order.shipments || []).find(s => s.id === shipmentId);
  if (!shipment || !['fulfilled','shipped','completed'].includes(String(shipment.status).toLowerCase()) || !shipment.trackingNumber) throw fail('Choose a completed DataPlus shipment with tracking.');
  const orderDate = new Date(order.orderDate || order.orderedAt || order.createdAt).getTime();
  let shipDate = new Date(shipment.shipDate || shipment.shippedAt || shipment.createdAt).getTime();
  if (Number.isFinite(orderDate) && Number.isFinite(shipDate)) {
    const orderDay = new Date(orderDate).toISOString().slice(0, 10);
    const shipmentDay = new Date(shipDate).toISOString().slice(0, 10);
    if (orderDay === shipmentDay && shipDate <= orderDate) shipDate = Math.min(Date.now(), orderDate + 60_000);
  }
  if (!Number.isFinite(shipDate) || shipDate > Date.now()) throw fail('Shipment date must be a valid past date.');
  if (Number.isFinite(orderDate) && shipDate <= orderDate) throw fail('Shipment time must be after the Walmart order time.');
  const carrier = shipment.carrier || shipment.carrierName;
  if (!carrier || !shipment.service && !order.shippingService) throw fail('Shipment carrier and shipping service are required.');
  const lines = (shipment.lines || []).map(line => {
    const item = order.items?.[Number(line.lineIndex)];
    const lineNumber = String(item?.sourceLineId || item?.lineItemId || '');
    const source = remote.orderLines?.orderLine?.find(row => String(row.lineNumber) === lineNumber);
    const qty = Number(line.qtyFulfilled || line.qty);
    const acknowledged = (source?.orderLineStatuses?.orderLineStatus || []).filter(row => row.status === 'Acknowledged').reduce((sum, row) => sum + Number(row.statusQuantity?.amount || 0), 0);
    if (!source || !Number.isInteger(qty) || qty < 1 || qty > acknowledged) throw fail(`Line ${lineNumber || '?'} has insufficient acknowledged quantity on Walmart. Refresh the order before retrying.`);
    return { lineNumber, intentToCancelOverride: false, orderLineStatuses: { orderLineStatus: [{ status: 'Shipped', statusQuantity: { unitOfMeasurement: 'EACH', amount: String(qty) }, trackingInfo: { shipDateTime: shipDate, carrierName: { carrier }, methodCode: shipment.service || order.shippingService, trackingNumber: shipment.trackingNumber } }] } };
  });
  if (!lines.length || new Set(lines.map(l => l.lineNumber)).size !== lines.length) throw fail('Shipment must contain unique Walmart order lines.');
  return { orderShipment: { orderLines: { orderLine: lines } } };
}

module.exports = { inventoryAmount, shipmentPayload };
