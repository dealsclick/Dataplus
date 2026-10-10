const DEFAULT_WINDOW_HOURS = 24;
const MAX_PARCEL_WEIGHT_LB = 150;
const DEFAULT_DIMENSIONAL_DIVISOR = 139;

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
  const verified = text(
    order.customerId
      || order.customer_id
      || order.accountId
      || order.customerAccountId
  );
  if (verified) return `customer:account:${token(verified)}`;
  const channelIdentity = text(
    order.external?.customerId
      || order.external?.accountId
      || order.external?.buyerId
  );
  if (channelIdentity) return `${source}:account:${token(channelIdentity)}`;
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

function positive(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function dimensionPermutations(item = {}) {
  const values = [positive(item.length), positive(item.width), positive(item.height)];
  if (values.some((value) => !value)) return [];
  return [...new Map([
    [values[0], values[1], values[2]],
    [values[0], values[2], values[1]],
    [values[1], values[0], values[2]],
    [values[1], values[2], values[0]],
    [values[2], values[0], values[1]],
    [values[2], values[1], values[0]],
  ].map((dimensions) => [dimensions.join("x"), dimensions])).values()];
}

function normalizeCartons(packages = [], options = {}) {
  const defaultMaxWeight = positive(options.maxParcelWeight) || MAX_PARCEL_WEIGHT_LB;
  return (Array.isArray(packages) ? packages : []).map((entry, index) => {
    const length = positive(entry?.length);
    const width = positive(entry?.width);
    const height = positive(entry?.height);
    const innerLength = positive(entry?.innerLength) || length;
    const innerWidth = positive(entry?.innerWidth) || width;
    const innerHeight = positive(entry?.innerHeight) || height;
    const packageType = text(entry?.packageType || "box").toLowerCase();
    return {
      id: text(entry?.id) || `package-${index + 1}`,
      name: text(entry?.name) || `Package ${index + 1}`,
      packageType,
      length,
      width,
      height,
      innerLength,
      innerWidth,
      innerHeight,
      tareWeight: positive(entry?.weight),
      maxWeight: positive(entry?.maxWeight) || defaultMaxWeight,
      flexibleOnly: entry?.flexibleOnly === true || ["poly_mailer", "envelope"].includes(packageType),
      volume: innerLength * innerWidth * innerHeight,
    };
  }).filter((entry) => entry.length && entry.width && entry.height && entry.innerLength && entry.innerWidth && entry.innerHeight)
    .filter((entry) => Math.max(entry.length, entry.width, entry.height) <= 108)
    .filter((entry) => {
      const sorted = [entry.length, entry.width, entry.height].sort((left, right) => right - left);
      return sorted[0] + 2 * (sorted[1] + sorted[2]) <= 165;
    })
    .sort((left, right) => left.volume - right.volume || left.tareWeight - right.tareWeight || left.name.localeCompare(right.name));
}

function cartonizationItems(rows = [], orderIds = []) {
  const wanted = new Set((orderIds || []).map(text).filter(Boolean));
  const byPackage = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const orderId = text(row?.orderId);
    if (!wanted.has(orderId)) continue;
    const packageGroupKey = text(row?.packageGroupKey || "combined") || "combined";
    const key = `${orderId}:${packageGroupKey}`;
    const readiness = row?.labelReadiness || {};
    const existing = byPackage.get(key);
    if (existing) {
      const sku = text(row?.catalogSku || row?.sku);
      if (sku && !existing.skus.includes(sku)) existing.skus.push(sku);
      existing.flexible = existing.flexible && row?.flexibleShipping === true;
      continue;
    }
    byPackage.set(key, {
      id: key,
      orderId,
      orderNumber: text(row?.orderNumber || orderId),
      packageGroupKey,
      skus: [text(row?.catalogSku || row?.sku)].filter(Boolean),
      length: positive(readiness.length),
      width: positive(readiness.width),
      height: positive(readiness.height),
      weight: positive(readiness.weight),
      flexible: row?.flexibleShipping === true,
      shipAlone: row?.shipAlone === true,
      restricted: row?.restrictedShipping === true,
      measurementSource: text(row?.packageSource || "saved measurements"),
    });
  }
  return [...byPackage.values()];
}

function packItemsInCarton(items = [], carton = {}) {
  if (!items.length) return null;
  if (carton.flexibleOnly && items.some((item) => item.flexible !== true)) return null;
  const itemWeight = items.reduce((sum, item) => sum + positive(item.weight), 0);
  if (!itemWeight || itemWeight + carton.tareWeight > carton.maxWeight) return null;
  const sortedItems = [...items].sort((left, right) => {
    const leftVolume = positive(left.length) * positive(left.width) * positive(left.height);
    const rightVolume = positive(right.length) * positive(right.width) * positive(right.height);
    return rightVolume - leftVolume || positive(right.weight) - positive(left.weight) || text(left.id).localeCompare(text(right.id));
  });
  const spaces = [{ x: 0, y: 0, z: 0, length: carton.innerLength, width: carton.innerWidth, height: carton.innerHeight }];
  const placements = [];
  for (const item of sortedItems) {
    let choice = null;
    for (let spaceIndex = 0; spaceIndex < spaces.length; spaceIndex += 1) {
      const space = spaces[spaceIndex];
      for (const [length, width, height] of dimensionPermutations(item)) {
        if (length > space.length || width > space.width || height > space.height) continue;
        const waste = space.length * space.width * space.height - length * width * height;
        const score = [waste, Math.max(space.length - length, space.width - width, space.height - height), spaceIndex];
        if (!choice || score[0] < choice.score[0] || (score[0] === choice.score[0] && score[1] < choice.score[1])) {
          choice = { spaceIndex, space, length, width, height, score };
        }
      }
    }
    if (!choice) return null;
    const { space, spaceIndex, length, width, height } = choice;
    spaces.splice(spaceIndex, 1);
    const splitSpaces = [
      { x: space.x + length, y: space.y, z: space.z, length: space.length - length, width: space.width, height: space.height },
      { x: space.x, y: space.y + width, z: space.z, length, width: space.width - width, height: space.height },
      { x: space.x, y: space.y, z: space.z + height, length, width, height: space.height - height },
    ].filter((entry) => entry.length > 0 && entry.width > 0 && entry.height > 0);
    spaces.push(...splitSpaces);
    placements.push({ itemId: item.id, orderId: item.orderId, orderNumber: item.orderNumber, skus: item.skus, x: space.x, y: space.y, z: space.z, length, width, height, weight: item.weight });
  }
  return { placements, itemWeight };
}

function cartonResult(carton, packed, divisor) {
  const physicalWeight = Number((packed.itemWeight + carton.tareWeight).toFixed(3));
  const dimensionalWeight = Number(((carton.length * carton.width * carton.height) / divisor).toFixed(3));
  return {
    packageId: carton.id,
    packageName: carton.name,
    packageType: carton.packageType,
    length: carton.length,
    width: carton.width,
    height: carton.height,
    tareWeight: carton.tareWeight,
    itemWeight: Number(packed.itemWeight.toFixed(3)),
    physicalWeight,
    dimensionalWeight,
    billableWeight: Math.max(physicalWeight, dimensionalWeight),
    placements: packed.placements,
  };
}

function cartonizeShipment(rows = [], orderIds = [], packages = [], options = {}) {
  const divisor = positive(options.dimensionalDivisor) || DEFAULT_DIMENSIONAL_DIVISOR;
  const items = cartonizationItems(rows, orderIds);
  if (!items.length) return { status: "blocked", reason: "No shipment items were available for cartonization.", items: [], cartons: [], divisor };
  if (items.some((item) => item.shipAlone)) return { status: "blocked", reason: "At least one item is configured to ship alone.", items, cartons: [], divisor };
  if (items.some((item) => item.restricted)) return { status: "blocked", reason: "Restricted or hazardous items require manual package review.", items, cartons: [], divisor };
  const incomplete = items.filter((item) => !item.length || !item.width || !item.height || !item.weight);
  if (incomplete.length) return { status: "blocked", reason: `${incomplete.length} package measurement${incomplete.length === 1 ? " is" : "s are"} incomplete.`, items, cartons: [], divisor, incompleteItemIds: incomplete.map((item) => item.id) };
  const cartons = normalizeCartons(packages, options);
  if (!cartons.length) return { status: "blocked", reason: "Configure at least one complete box in Package presets.", items, cartons: [], divisor };

  for (const carton of cartons) {
    const packed = packItemsInCarton(items, carton);
    if (packed) return {
      status: "single_carton",
      reason: "All selected orders fit in one configured package.",
      items,
      cartons: [cartonResult(carton, packed, divisor)],
      divisor,
      requiresConfirmation: true,
    };
  }

  const remaining = [...items].sort((left, right) => (right.length * right.width * right.height) - (left.length * left.width * left.height));
  const plan = [];
  while (remaining.length) {
    let best = null;
    for (const carton of cartons) {
      const selected = [];
      let packed = null;
      for (const item of remaining) {
        const candidate = packItemsInCarton([...selected, item], carton);
        if (candidate) {
          selected.push(item);
          packed = candidate;
        }
      }
      if (!selected.length || !packed) continue;
      const candidate = { carton, selected, packed };
      if (!best || selected.length > best.selected.length || (selected.length === best.selected.length && carton.volume < best.carton.volume)) best = candidate;
    }
    if (!best) return {
      status: "manual_review",
      reason: `${remaining.length} item${remaining.length === 1 ? " does" : "s do"} not fit any configured package. Add the required carton or enter a custom package.`,
      items,
      cartons: plan,
      unresolvedItemIds: remaining.map((item) => item.id),
      divisor,
      requiresConfirmation: true,
    };
    plan.push(cartonResult(best.carton, best.packed, divisor));
    const packedIds = new Set(best.selected.map((item) => item.id));
    for (let index = remaining.length - 1; index >= 0; index -= 1) if (packedIds.has(remaining[index].id)) remaining.splice(index, 1);
  }
  return {
    status: "split_required",
    reason: `The selected orders require ${plan.length} packages with the configured carton catalog.`,
    items,
    cartons: plan,
    divisor,
    requiresConfirmation: true,
  };
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
  cartonizationItems,
  cartonizeShipment,
};
