function hasShipmentCorrection(order) {
  return (order.shipments || []).some((shipment) => shipment.reopenedAt || shipment.trackingUpdatedAt || shipment.voidedAt || shipment.labelRefundStatus === "confirmed");
}

function preserveShipmentCorrections(incoming, existing) {
  if (!existing || !hasShipmentCorrection(existing)) return incoming;
  const result = { ...incoming };
  result.sourceShipmentSnapshot = { shipments: incoming.shipments || [], status: incoming.status, observedAt: incoming.importedAt || incoming.updatedAt };
  // Match source identity first, including tracking values that an operator replaced.
  const matched = new Set();
  result.shipments = (incoming.shipments || []).map((source) => {
    const local = (existing.shipments || []).find((row) => !matched.has(row) && (
      (source.id && source.id === row.id)
      || (source.remoteShipmentId && source.remoteShipmentId === row.remoteShipmentId)
      || (source.trackingNumber && [row.trackingNumber, ...(row.trackingHistory || []).map((entry) => entry.trackingNumber)].includes(source.trackingNumber))
      || (source.packageSnList || []).some((id) => (row.packageSnList || []).includes(id))
    ));
    if (!local) return source;
    matched.add(local);
    if (hasShipmentCorrection({ shipments: [local] })) return { ...local, sourceSnapshot: source === local ? local.sourceSnapshot : source };
    return { ...local, ...source, id: local.id };
  });
  result.shipments.push(...(existing.shipments || []).filter((row) => !matched.has(row)));
  result.trackingHistory = existing.trackingHistory || [];
  for (const key of ["trackingNumber", "trackingUrl", "shippingCarrier", "carrierName", "shippingService", "shippingCost"]) {
    result[key] = existing[key];
  }
  if (existing.shipmentCorrection?.active) {
    for (const key of ["shipmentCorrection", "status", "fulfillmentStatus", "fulfillmentStage", "fulfilledAt", "fulfillmentLines", "fulfillmentRoutes", "operationalStatus", "workflowStatus", "workflowExceptions"]) {
      result[key] = existing[key];
    }
    if (["canceled", "cancelled", "refunded"].includes(String(incoming.status || "").toLowerCase())) result.channelStatus = incoming.status;
    // Preserve quantity corrections without preventing source pricing/address refreshes.
    for (const key of ["items", "lineItems", "lines"]) {
      if (!Array.isArray(result[key]) || !Array.isArray(existing[key])) continue;
      result[key] = result[key].map((line, index) => {
        const old = existing[key][index];
        if (!old || String(old.sku || "") !== String(line.sku || "")) return line;
        return { ...line, fulfilledQty: old.fulfilledQty, fulfilledQuantity: old.fulfilledQuantity, remainingQty: old.remainingQty, fulfillmentStatus: old.fulfillmentStatus, status: old.status };
      });
    }
  }
  return result;
}

function shipmentReopenPlan(orderLines, shipment) {
  const quantities = new Map();
  for (const entry of shipment.lines || []) {
    const qty = Number(entry.qtyFulfilled ?? entry.qty ?? entry.qtyAllocated ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error("Shipment has an invalid fulfilled quantity. Refresh and review its package lines.");
    let index = entry.lineIndex === undefined || entry.lineIndex === null ? -1 : Number(entry.lineIndex);
    if (!Number.isInteger(index) || !orderLines[index] || String(orderLines[index].sku || "").toLowerCase() !== String(entry.sku || "").toLowerCase()) {
      const candidates = orderLines.map((line, i) => ({ line, i })).filter(({ line }) => String(line.sku || "").toLowerCase() === String(entry.sku || "").toLowerCase());
      if (candidates.length !== 1) throw new Error("Shipment lines are ambiguous. Match this package to an order line before reopening it.");
      index = candidates[0].i;
    }
    quantities.set(index, (quantities.get(index) || 0) + qty);
  }
  if (!quantities.size) throw new Error("This shipment has no linked quantities. Refresh its package details before reopening it.");
  for (const [index, qty] of quantities) {
    if (!Number.isFinite(Number(orderLines[index].qty)) || qty > Number(orderLines[index].qty || 0)) throw new Error("Shipment quantity exceeds the linked order line quantity.");
  }
  return [...quantities].map(([lineIndex, qty]) => ({ lineIndex, qty }));
}

module.exports = { hasShipmentCorrection, preserveShipmentCorrections, shipmentReopenPlan };
