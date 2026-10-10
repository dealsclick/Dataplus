const DEFAULT_WINDOW_HOURS = 24;
const MAX_PARCEL_WEIGHT_LB = 150;

function text(value) {
  return String(value || "").trim();
}

function token(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizedAddress(order = {}) {
  const address = order.address || order.shippingAddress || order.shipping_address || {};
  return {
    recipient: token(address.name || order.buyer || order.customerName),
    line1: token(address.line1 || address.address1 || order.shippingAddress1),
    line2: token(address.line2 || address.address2 || order.shippingAddress2),
    city: token(address.city || address.town || order.shippingCity),
    state: token(address.state || address.province || order.shippingState),
    postalCode: token(address.postalCode || address.zip || address.postcode || order.shippingPostalCode),
    country: token(address.countryCode || address.country || order.shippingCountry),
  };
}

function shipmentAddressKey(order = {}) {
  const address = normalizedAddress(order);
  if (!address.recipient || !address.line1 || !address.city || !address.state || !address.postalCode || !address.country) return "";
  return [address.recipient, address.line1, address.line2, address.city, address.state, address.postalCode, address.country].join("|");
}

function shipmentCustomerKey(order = {}) {
  const source = token(order.channelSource || order.source || "channel") || "channel";
  const explicit = text(
    order.customerId
      || order.customer_id
      || order.accountId
      || order.customerAccountId
      || order.external?.customerId
      || order.external?.accountId
      || order.external?.buyerId
  );
  if (explicit) return `${source}:account:${token(explicit)}`;
  const address = normalizedAddress(order);
  return address.recipient ? `${source}:delivery:${address.recipient}` : "";
}

function orderTimestamp(order = {}) {
  const value = order.orderDate || order.orderedAt || order.placedAt || order.createdAt || "";
  const timestamp = Date.parse(String(value));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function activeOriginWarehouseIds(order = {}) {
  const closed = new Set(["canceled", "cancelled", "closed", "fulfilled", "shipped", "delivered", "void", "voided", "rejected", "dismissed", "superseded"]);
  const routes = Array.isArray(order.fulfillmentRoutes) ? order.fulfillmentRoutes : [];
  if (routes.some((route) => String(route?.type || "").toLowerCase() === "drop_ship" && !closed.has(String(route?.status || "").toLowerCase()))) return [];
  return [...new Set(routes
    .filter((route) => ["warehouse", "purchase"].includes(String(route?.type || "").toLowerCase()))
    .filter((route) => !closed.has(String(route?.status || "").toLowerCase()))
    .map((route) => text(route?.warehouseId))
    .filter(Boolean))];
}

function paymentCleared(order = {}) {
  const status = text(order.financialStatus || order.paymentStatus).toLowerCase().replace(/[\s-]+/g, "_");
  if (["paid", "partially_paid", "authorized", "captured"].includes(status)) return true;
  return (Array.isArray(order.payments) ? order.payments : []).some((payment) => ["paid", "authorized", "captured"].includes(text(payment?.status).toLowerCase()));
}

function hasRecordedShipment(order = {}) {
  if (text(order.trackingNumber)) return true;
  return (Array.isArray(order.shipments) ? order.shipments : []).some((shipment) => {
    if (["voided", "canceled", "cancelled"].includes(text(shipment?.voidStatus || shipment?.status).toLowerCase())) return false;
    return Boolean(text(shipment?.trackingNumber)
      || text(shipment?.labelDocumentUrl)
      || text(shipment?.labelUrl)
      || (Array.isArray(shipment?.documents) && shipment.documents.some((document) => text(document?.documentId || document?.url))));
  });
}

function shipmentConsolidationEligibility(order = {}, options = {}) {
  const terminal = new Set(["canceled", "cancelled", "void", "voided", "deleted", "fulfilled", "shipped", "completed", "done", "closed", "refunded", "returned"]);
  const locked = new Set(["hold", "on_hold", "picked", "packed", "packing"]);
  const statuses = [order.status, order.operationalStatus, order.fulfillmentStatus, order.workflowStatus]
    .map((value) => text(value).toLowerCase().replace(/[\s-]+/g, "_"))
    .filter(Boolean);
  if (statuses.some((status) => terminal.has(status))) return { eligible: false, reason: "Order is already closed or fulfilled." };
  if (statuses.some((status) => locked.has(status))) return { eligible: false, reason: "Picked, packed, held, or packing orders cannot be combined." };
  if (!paymentCleared(order)) return { eligible: false, reason: "Payment has not cleared." };
  if (hasRecordedShipment(order)) return { eligible: false, reason: "A label, tracking number, or shipment is already recorded." };
  const addressKey = shipmentAddressKey(order);
  if (!addressKey) return { eligible: false, reason: "A complete recipient and delivery address is required." };
  const customerKey = shipmentCustomerKey(order);
  if (!customerKey) return { eligible: false, reason: "A verified customer or delivery identity is required." };
  const warehouseIds = activeOriginWarehouseIds(order);
  if (warehouseIds.length !== 1) return { eligible: false, reason: warehouseIds.length ? "Order lines are assigned to multiple warehouses." : "No open warehouse-bound fulfillment route is available." };
  const createdAt = orderTimestamp(order);
  if (createdAt === null) return { eligible: false, reason: "Order creation time is required." };
  return {
    eligible: true,
    addressKey,
    customerKey,
    warehouseId: warehouseIds[0],
    createdAt,
    windowHours: Math.max(1, Number(options.windowHours || DEFAULT_WINDOW_HOURS) || DEFAULT_WINDOW_HOURS),
    identitySource: customerKey.includes(":account:") ? "account" : "recipient_address",
  };
}

function shipmentConsolidationPair(left = {}, right = {}, options = {}) {
  const leftEligibility = shipmentConsolidationEligibility(left, options);
  const rightEligibility = shipmentConsolidationEligibility(right, options);
  if (!leftEligibility.eligible || !rightEligibility.eligible) return { eligible: false, reason: leftEligibility.reason || rightEligibility.reason };
  const sameGroup = text(left.shipmentGroupId) && text(left.shipmentGroupId) === text(right.shipmentGroupId);
  if (!sameGroup && leftEligibility.customerKey !== rightEligibility.customerKey) return { eligible: false, reason: "Customer identity does not match." };
  if (!sameGroup && leftEligibility.addressKey !== rightEligibility.addressKey) return { eligible: false, reason: "Delivery address does not match." };
  if (leftEligibility.warehouseId !== rightEligibility.warehouseId) return { eligible: false, reason: "Fulfillment warehouse does not match." };
  const windowMs = leftEligibility.windowHours * 60 * 60 * 1000;
  if (!sameGroup && Math.abs(leftEligibility.createdAt - rightEligibility.createdAt) > windowMs) return { eligible: false, reason: `Orders are outside the ${leftEligibility.windowHours}-hour consolidation window.` };
  return {
    eligible: true,
    sameGroup: Boolean(sameGroup),
    warehouseId: leftEligibility.warehouseId,
    identitySource: leftEligibility.identitySource === "account" && rightEligibility.identitySource === "account" ? "account" : "recipient_address",
    windowHours: leftEligibility.windowHours,
  };
}

function buildShipmentConsolidationIndex(orders = [], options = {}) {
  const result = new Map();
  const eligible = orders.map((order) => ({ order, eligibility: shipmentConsolidationEligibility(order, options) }))
    .filter((entry) => entry.eligibility.eligible);
  const buckets = new Map();
  for (const entry of eligible) {
    const key = [entry.eligibility.customerKey, entry.eligibility.addressKey, entry.eligibility.warehouseId].join("::");
    buckets.set(key, [...(buckets.get(key) || []), entry]);
  }
  for (const entries of buckets.values()) {
    entries.sort((left, right) => left.eligibility.createdAt - right.eligibility.createdAt);
    for (let index = 0; index < entries.length; index += 1) {
      const current = entries[index];
      const candidates = [];
      for (let otherIndex = 0; otherIndex < entries.length; otherIndex += 1) {
        if (index === otherIndex) continue;
        const other = entries[otherIndex];
        const pair = shipmentConsolidationPair(current.order, other.order, options);
        if (pair.eligible) candidates.push({
          orderId: text(other.order.id || other.order.orderId),
          orderNumber: text(other.order.orderNumber || other.order.id),
          orderDate: other.order.orderDate || other.order.orderedAt || other.order.createdAt || "",
          sameGroup: pair.sameGroup === true,
        });
      }
      if (candidates.length) result.set(text(current.order.id || current.order.orderId), {
        eligible: true,
        candidateCount: candidates.length,
        candidates,
        warehouseId: current.eligibility.warehouseId,
        identitySource: current.eligibility.identitySource,
        windowHours: current.eligibility.windowHours,
        shipmentGroupId: text(current.order.shipmentGroupId),
      });
    }
  }
  return result;
}

function assessConsolidatedPackages(rows = [], orderIds = []) {
  const wanted = new Set(orderIds.map(text).filter(Boolean));
  const uniquePackages = new Map();
  for (const row of rows) {
    const orderId = text(row.orderId);
    if (!wanted.has(orderId)) continue;
    const key = `${orderId}:${text(row.packageGroupKey || "combined")}`;
    if (!uniquePackages.has(key)) uniquePackages.set(key, row);
  }
  const packages = [...uniquePackages.values()];
  if (packages.some((row) => row.shipAlone === true)) return { allowed: false, reason: "At least one selected product is configured to ship alone." };
  if (packages.some((row) => row.restrictedShipping === true)) return { allowed: false, reason: "Restricted or hazardous items require separate shipping review." };
  const combinedWeight = packages.reduce((sum, row) => sum + Math.max(0, Number(row.labelReadiness?.weight || 0)), 0);
  if (combinedWeight > MAX_PARCEL_WEIGHT_LB) return { allowed: false, reason: `Combined weight exceeds the ${MAX_PARCEL_WEIGHT_LB} lb parcel limit.`, combinedWeight };
  const measurementsComplete = packages.length > 0 && packages.every((row) => {
    const readiness = row.labelReadiness || {};
    return Number(readiness.weight || 0) > 0 && Number(readiness.length || 0) > 0 && Number(readiness.width || 0) > 0 && Number(readiness.height || 0) > 0;
  });
  const combinedVolume = packages.reduce((sum, row) => {
    const readiness = row.labelReadiness || {};
    return sum + Math.max(0, Number(readiness.length || 0) * Number(readiness.width || 0) * Number(readiness.height || 0));
  }, 0);
  return { allowed: true, combinedWeight, combinedVolume, measurementsComplete, packageCount: packages.length, requiresPackageReview: true };
}

module.exports = {
  DEFAULT_WINDOW_HOURS,
  MAX_PARCEL_WEIGHT_LB,
  normalizedAddress,
  shipmentAddressKey,
  shipmentCustomerKey,
  shipmentConsolidationEligibility,
  shipmentConsolidationPair,
  buildShipmentConsolidationIndex,
  assessConsolidatedPackages,
};
