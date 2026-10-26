const crypto = require('node:crypto');

const array = value => Array.isArray(value) ? value : [];
const text = value => String(value ?? '').trim();
const number = value => {
  const parsed = Number(String(value ?? '').replace(/[$,]/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
};
const iso = value => {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return new Date(numeric * 1000).toISOString();
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
};

function orderStatus(value = '') {
  const status = text(value).toUpperCase();
  if (status === 'CANCELLED') return 'canceled';
  if (['DELIVERED', 'COMPLETED'].includes(status)) return 'fulfilled';
  if (['AWAITING_COLLECTION', 'IN_TRANSIT', 'PARTIALLY_SHIPPING'].includes(status)) return 'shipped';
  if (status === 'UNPAID') return 'pending';
  return 'processing';
}

function addressParts(address = {}) {
  const levels = array(address.district_info);
  const find = (...patterns) => text(levels.find(row => patterns.some(pattern => pattern.test(text(row.address_level_name || row.address_level))))?.address_name);
  return {
    name: text(address.name || [address.first_name, address.last_name].filter(Boolean).join(' ')),
    line1: text(address.address_line1 || address.address_detail || address.full_address),
    line2: text(address.address_line2),
    line3: text(address.address_line3 || address.address_line4),
    city: text(address.post_town || find(/city/i, /town/i)),
    state: find(/state/i, /province/i),
    postalCode: text(address.postal_code),
    country: text(address.region_code || levels.find(row => row.iso_code)?.iso_code)
  };
}

function mapTikTokOrder(raw = {}) {
  const orderId = text(raw.id);
  if (!orderId) throw new Error('TikTok order is missing its order ID.');
  const rawLines = array(raw.line_items);
  if (!rawLines.length) throw new Error(`TikTok order ${orderId} has no line items.`);
  const items = rawLines.map((line, index) => {
    const lineId = text(line.id || line.sku_id || `${orderId}-${index + 1}`);
    const quantity = Math.max(1, number(line.quantity) || 1);
    return {
      id: lineId,
      lineItemId: lineId,
      sourceLineId: lineId,
      sku: text(line.seller_sku || line.sku_id),
      title: text(line.product_name || line.sku_name),
      qty: quantity,
      price: number(line.sale_price),
      tax: array(line.item_tax).reduce((sum, tax) => sum + number(tax.tax_amount), 0),
      originalPrice: number(line.original_price),
      platformDiscount: number(line.platform_discount),
      sellerDiscount: number(line.seller_discount),
      productId: text(line.product_id),
      marketplaceSkuId: text(line.sku_id),
      bundleComponents: array(line.combined_listing_skus).map(component => ({
        productId: text(component.product_id),
        marketplaceSkuId: text(component.sku_id),
        sellerSku: text(component.seller_sku),
        quantity: Math.max(1, number(component.sku_count) || 1)
      })),
      image: text(line.sku_image),
      displayStatus: text(line.display_status),
      packageId: text(line.package_id),
      trackingNumber: text(line.tracking_number),
      isDangerousGood: line.is_dangerous_good === true,
      cost: null
    };
  });
  const payment = raw.payment || {};
  const address = addressParts(raw.recipient_address || {});
  const packages = new Map();
  for (const line of items) {
    const key = line.packageId || line.trackingNumber;
    if (!key) continue;
    const shipment = packages.get(key) || {
      id: `tiktok-${orderId}-${key}`,
      source: 'TikTok Shop',
      provider: 'TikTok Shop',
      purchaseOrigin: 'external',
      status: raw.status === 'DELIVERED' ? 'delivered' : 'shipped',
      trackingStatus: raw.status === 'DELIVERED' ? 'delivered' : 'in_transit',
      trackingNumber: line.trackingNumber || text(raw.tracking_number),
      carrier: text(raw.shipping_provider),
      carrierName: text(raw.shipping_provider),
      service: text(raw.delivery_option_name),
      shippingService: text(raw.delivery_option_name),
      shipDate: iso(raw.rts_time || raw.collection_time),
      lines: [],
      channelSync: { status: 'synced', channel: 'TikTok Shop', provider: 'TikTok Shop', message: 'Shipment and tracking imported from TikTok Shop.' }
    };
    shipment.lines.push({ lineItemId: line.lineItemId, sku: line.sku, qty: line.qty, qtyFulfilled: line.qty });
    packages.set(key, shipment);
  }
  const shipments = [...packages.values()];
  const primaryShipment = shipments[0] || {};
  const status = orderStatus(raw.status);
  const total = number(payment.total_amount);
  const subtotal = number(payment.sub_total || payment.original_total_product_price) || items.reduce((sum, line) => sum + line.price * line.qty, 0);
  const createdAt = iso(raw.create_time) || new Date().toISOString();
  return {
    id: `tiktok-${orderId}`,
    source: 'TikTok Shop',
    channelSource: 'TikTok Shop',
    marketplaceOrderNumber: orderId,
    marketplaceOrderId: orderId,
    marketplaceReferences: [{ source: 'TikTok Shop', type: 'orderId', value: orderId, primary: true }],
    buyer: text(raw.buyer_nickname || address.name),
    buyerEmail: text(raw.buyer_email),
    phone: text(raw.recipient_address?.phone_number),
    address,
    status,
    financialStatus: status === 'pending' ? 'Pending' : status === 'canceled' ? 'Voided' : 'Paid',
    paymentStatus: status === 'pending' ? 'Pending' : status === 'canceled' ? 'Voided' : 'Paid',
    currency: text(payment.currency || rawLines[0]?.currency || 'USD'),
    subtotal,
    taxAmount: number(payment.tax || payment.product_tax || payment.shipping_fee_tax),
    shippingPaid: number(payment.shipping_fee || payment.original_shipping_fee),
    total: total || subtotal,
    paidAmount: status === 'pending' ? null : total || subtotal,
    productCost: null,
    items,
    shipments,
    trackingNumber: primaryShipment.trackingNumber || text(raw.tracking_number),
    shippingCarrier: primaryShipment.carrier || text(raw.shipping_provider),
    carrierName: primaryShipment.carrierName || text(raw.shipping_provider),
    shipDate: primaryShipment.shipDate || iso(raw.rts_time || raw.collection_time),
    shippingService: primaryShipment.service || text(raw.delivery_option_name),
    shipBy: iso(raw.shipping_due_time || raw.rts_sla_time),
    orderDate: createdAt,
    orderedAt: createdAt,
    createdAt,
    updatedAt: iso(raw.update_time) || new Date().toISOString(),
    sku: items[0].sku,
    title: items[0].title,
    qty: items.reduce((sum, line) => sum + line.qty, 0),
    external: {
      source: 'TikTok Shop',
      orderId,
      orderType: text(raw.order_type),
      shippingType: text(raw.shipping_type),
      fulfillmentType: text(raw.fulfillment_type),
      warehouseId: text(raw.warehouse_id),
      autoCombineGroupId: text(raw.auto_combine_group_id),
      splitOrCombineTag: text(raw.split_or_combine_tag),
      buyerRequestedCancellation: raw.is_buyer_request_cancel === true,
      cancellationInitiator: text(raw.cancellation_initiator),
      cancelReason: text(raw.cancel_reason),
      rawOrder: raw
    }
  };
}

function mapTikTokReturn(raw = {}, order = null) {
  const returnId = text(raw.return_id);
  if (!returnId) throw new Error('TikTok return is missing its return ID.');
  const lines = array(raw.return_line_items);
  if (!lines.length) throw new Error(`TikTok return ${returnId} has no line items.`);
  const lifecycle = text(raw.return_status).toLowerCase();
  const status = /cancel|reject|closed/.test(lifecycle)
    ? 'canceled'
    : /success|complete|refund_success|returned/.test(lifecycle)
      ? 'completed'
      : 'requested';
  const items = lines.map(line => {
    const sourceLineId = text(line.order_line_item_id);
    const orderLine = array(order?.items).find(item => [item.sourceLineId, item.lineItemId, item.id].map(text).includes(sourceLineId))
      || array(order?.items).find(item => text(item.sku).toLowerCase() === text(line.seller_sku).toLowerCase());
    return {
      channelLineId: text(line.return_line_item_id || sourceLineId),
      sourceLineId,
      sku: text(orderLine?.sku || line.seller_sku || line.sku_id),
      originalSku: text(line.seller_sku),
      title: text(line.product_name || line.sku_name || orderLine?.title),
      qty: Math.max(1, number(line.return_quantity || line.quantity) || 1),
      receivedQty: 0,
      reason: text(raw.return_reason),
      description: text(raw.return_reason_text),
      channelStatus: text(raw.return_status),
      refundAmount: number(line.refund_amount?.refund_total || line.refund_amount?.amount)
    };
  });
  const amount = number(raw.refund_amount?.refund_total || raw.partial_refund?.amount);
  return {
    id: `tiktok-return-${crypto.createHash('sha256').update(returnId).digest('hex').slice(0, 24)}`,
    returnNumber: returnId,
    orderId: text(order?.id),
    orderNumber: text(order?.orderNumber),
    source: 'TikTok Shop',
    channel: 'TikTok Shop',
    channelReturnId: returnId,
    marketplaceOrderId: text(raw.order_id),
    channelStatus: text(raw.return_status),
    channelLifecycleStatus: lifecycle,
    status,
    createdAt: iso(raw.create_time) || new Date().toISOString(),
    updatedAt: iso(raw.update_time) || new Date().toISOString(),
    returnType: text(raw.return_type),
    amount,
    actualRefundAmount: status === 'completed' ? amount : null,
    refundStatus: status === 'completed' ? 'confirmed' : 'pending',
    currency: text(raw.refund_amount?.currency || raw.partial_refund?.currency || order?.currency || 'USD'),
    reason: text(raw.return_reason),
    description: text(raw.return_reason_text),
    returnTracking: raw.return_tracking_number ? [{ trackingNumber: text(raw.return_tracking_number), carrier: text(raw.return_provider_name || raw.return_provider_id), service: text(raw.shipment_type) }] : [],
    items,
    external: { returnOrder: raw },
    channelSync: { channel: 'TikTok Shop', status: 'synced', returnId }
  };
}

function componentRows(transaction = {}, statementId = '') {
  const orderReference = text(transaction.order_id || transaction.associated_order_id || transaction.adjustment_order_id);
  const base = {
    payoutId: statementId,
    transactionId: text(transaction.id),
    transactionStatus: text(transaction.status),
    transactionType: text(transaction.type || 'settlement'),
    orderReference,
    orderReferences: [transaction.order_id, transaction.associated_order_id, transaction.adjustment_order_id].map(text).filter(Boolean),
    currency: text(transaction.currency),
    transactionAt: iso(transaction.order_create_time || transaction.estimated_release_time),
    raw: transaction
  };
  const grossAmount = number(transaction.revenue_amount);
  const netAmount = number(transaction.settlement_amount);
  const transactionAmount = netAmount;
  const bookingEntry = transactionAmount < 0 ? 'DEBIT' : 'CREDIT';
  const rows = [];
  const push = (prefix, key, category, amount) => {
    if (!amount) return false;
    rows.push({
      ...base,
      externalLineId: `${text(transaction.id)}:${prefix}:${key}`.slice(0, 160),
      feeType: key.slice(0, 120),
      description: `${category}: ${key.replace(/_/g, ' ')}`,
      feeAmount: amount,
      grossAmount,
      netAmount,
      transactionAmount,
      bookingEntry
    });
    return true;
  };
  const pushObject = (prefix, value, category) => {
    let contributed = false;
    for (const [key, amountValue] of Object.entries(value || {})) {
      if (amountValue && typeof amountValue === 'object') continue;
      const amount = number(amountValue);
      contributed = push(prefix, key, category, amount) || contributed;
    }
    return contributed;
  };
  const hasFeeRows = pushObject('fee', transaction.fee_tax_breakdown?.fee, 'Fee');
  const hasTaxRows = pushObject('tax', transaction.fee_tax_breakdown?.tax, 'Tax');
  const hasFeeBreakdown = hasFeeRows || hasTaxRows;
  if (!hasFeeBreakdown) push('fee', 'fee_tax_amount', 'Fee and tax', number(transaction.fee_tax_amount));
  const hasShippingBreakdown = pushObject('shipping', transaction.shipping_cost_breakdown, 'Shipping');
  if (!hasShippingBreakdown) push('shipping', 'shipping_cost_amount', 'Shipping', number(transaction.shipping_cost_amount));
  push('adjustment', 'adjustment_amount', 'Adjustment', number(transaction.adjustment_amount));
  if (!rows.length) {
    rows.push({
      ...base,
      externalLineId: `${text(transaction.id) || `transaction-${crypto.randomUUID()}`}:payout-evidence`.slice(0, 160),
      feeType: 'PAYOUT_EVIDENCE',
      description: `${text(transaction.type || 'TikTok settlement transaction')} payout evidence`,
      feeAmount: 0,
      grossAmount,
      netAmount,
      transactionAmount,
      bookingEntry
    });
  }
  return rows;
}

module.exports = { addressParts, componentRows, mapTikTokOrder, mapTikTokReturn, orderStatus };
