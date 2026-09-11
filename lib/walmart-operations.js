const { fail } = require('./walmart-client');
const { productIsMasterInactive } = require('./product-selling-status');
const { retiredSupplier } = require('./supplier-retirement');

function inventoryAmount(product, db, settings, packSize) {
  if (productIsMasterInactive(product) || retiredSupplier(product, db.vendors || []) || product.toBeDiscontinued === true || product.discontinued === true) return 0;
  const warehouse = (db.warehouses || []).find(w => w.id === settings.walmartWarehouseId);
  if (!warehouse || warehouse.isPhysical !== true || warehouse.active === false || warehouse.status === 'inactive' || warehouse.inventorySourceType === 'supplier_feed') throw fail('Map an active physical warehouse before publishing Walmart inventory.');
  const stock = (product.warehouseStock || []).filter(row => row.warehouseId === warehouse.id && row.isSellable !== false);
  const available = stock.reduce((sum, row) => sum + Math.max(0, Number(row.qty || 0) - Number(row.reserved || 0)), 0);
  const safety = Number(settings.walmartSafetyQty || 0), maximum = Number(settings.walmartMaxQuantity || 0);
  if (!Number.isFinite(available) || !Number.isFinite(packSize) || packSize < 1 || !Number.isFinite(safety) || safety < 0 || !Number.isFinite(maximum) || maximum < 0) throw fail('Invalid inventory or UOM quantities.');
  const quantity = Math.max(0, Math.floor(available / packSize) - Math.ceil(safety));
  return maximum > 0 ? Math.min(quantity, Math.floor(maximum)) : quantity;
}

function shipmentPayload(order, remote, shipmentId) {
  const shipment = (order.shipments || []).find(s => s.id === shipmentId);
  if (!shipment || !['fulfilled','shipped','completed'].includes(String(shipment.status).toLowerCase()) || !shipment.trackingNumber) throw fail('Choose a completed DataPlus shipment with tracking.');
  const shipDate = new Date(shipment.shipDate || shipment.shippedAt || shipment.createdAt).getTime();
  if (!Number.isFinite(shipDate) || shipDate > Date.now()) throw fail('Shipment date must be a valid past date.');
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
