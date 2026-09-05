// Temu Return and Refund Guide and the three endpoint schemas linked from it.
const statuses = {
  1: "Refund requested", 2: "Return shipped", 3: "Received by channel; awaiting review",
  4: "Refund processing", 5: "Refund completed", 6: "Canceled", 7: "Denied",
  8: "Return label required", 9: "Refund processing", 10: "Return requested", 11: "Platform reviewing"
};

function temuReturnRecord(detail, logistics, order, lines = []) {
  if (!detail.parentAfterSalesSn || !detail.parentOrderSn || !Array.isArray(detail.afterSalesList)) throw new Error("Incomplete Temu return detail.");
  const state = Number(detail.parentAfterSalesStatus);
  const lifecycle = [5, 6, 7].includes(state) ? "closed" : "requested";
  const timestamp = (value) => Number(value) > 0 ? new Date(Number(value)).toISOString() : "";
  const id = String(detail.parentAfterSalesSn);
  return {
    id: `temu-return-${id}`, returnNumber: id, source: "Temu", channel: "Temu", channelReturnId: id,
    orderId: order?.id || "", orderNumber: order?.orderNumber || "", channelOrderId: detail.parentOrderSn,
    status: lifecycle, channelLifecycleStatus: lifecycle, channelStatus: statuses[state] || `Unknown status ${state}`,
    channelStatusCode: state, returnType: Number(detail.afterSalesType) === 1 ? "refund_only" : "return_and_refund",
    createdAt: timestamp(detail.createAtMillis), channelUpdatedAt: timestamp(detail.lastUpdateAtMillis), updatedAt: new Date().toISOString(),
    // The published schema does not specify the integer amount unit. Keep buyer
    // refund data separate from seller proceeds until its denomination is verified.
    amount: null, actualRefundAmount: null, estimatedRefundAmount: null, refundAmountUnverified: true,
    refundStatus: state === 5 ? "completed_amount_unverified" : [4, 9].includes(state) ? "processing" : "not_confirmed",
    currency: detail.refundSummary?.buyerTotalRefund?.currency || order?.currency || "USD",
    reason: detail.afterSalesList.map((row) => row.afterSalesReasonDesc).filter(Boolean).join("; "),
    items: detail.afterSalesList.map((row) => {
      const matches = lines.filter((line) => String(line.temuOrderItemId || line.channelOrderItemId || line.orderSn || "") === String(row.orderSn || ""));
      const match = row.orderSn && matches.length === 1 ? matches[0] : null;
      return { channelLineId: row.afterSalesSn, channelOrderItemId: row.orderSn, sku: match?.sku || "", title: match?.title || "",
        sourceSkus: (row.afterSalesGoodsInfo?.productList || []).map((product) => product.extCode).filter(Boolean),
        qty: Number(row.applyAfterSalesGoodsNumber || 0), receivedQty: 0, reason: row.afterSalesReasonDesc || "" };
    }),
    returnTracking: [...new Map(logistics.filter((row) => row.trackingNumber).map((row) => [String(row.trackingNumber), {
      trackingNumber: String(row.trackingNumber), carrier: row.carrierName || "", channelWarehouseType: row.returnWarehouseType
    }])).values()],
    external: { parentOrderSn: detail.parentOrderSn, parentAfterSalesSn: id, detail, logistics },
    channelSync: { channel: "Temu", status: "synced", returnId: id }
  };
}

async function importTemuReturns({ request, save, progress, since, until = Date.now(), windowSeconds = 7 * 86400 }) {
  const start = Math.floor(Date.parse(since) / 1000), end = Math.floor(until / 1000);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || !Number.isInteger(windowSeconds) || windowSeconds < 1) throw new Error("Invalid Temu return import date range.");
  let imported = 0, scanned = 0, linked = 0;
  const seen = new Set(), errors = [];
  // Inclusive time windows and page pagination avoid a global row limit.
  for (let from = start; from <= end; from += windowSeconds) {
    const to = Math.min(end, from + windowSeconds - 1);
    const pages = new Set();
    let fetched = 0;
    for (let pageNo = 1; ; pageNo++) {
      const result = await request("bg.aftersales.parentaftersales.list.get", { createAtStart: from, createAtEnd: to, pageNo, pageSize: 200 });
      if (!Array.isArray(result?.data) || !Number.isInteger(Number(result.total)) || Number(result.total) < 0) throw new Error("Temu returned an incomplete return page.");
      const rows = result.data;
      if (rows.some((row) => !row.parentAfterSalesSn || !row.parentOrderSn)) throw new Error("Temu return page has missing identifiers.");
      const fingerprint = rows.map((row) => row.parentAfterSalesSn).sort().join(",");
      if (rows.length && pages.has(fingerprint)) throw new Error("Temu return pagination did not advance.");
      pages.add(fingerprint);
      if (!rows.length && fetched < Number(result.total)) throw new Error("Temu return pagination ended before its reported total.");
      for (const summary of rows) {
        const key = String(summary.parentAfterSalesSn);
        if (seen.has(key)) continue;
        seen.add(key); scanned++;
        try {
          const detail = await request("temu.aftersales.parentaftersales.detail.get", { parentAfterSalesSn: key, parentOrderSn: summary.parentOrderSn });
          if (detail?.parentAfterSalesSn !== key || detail?.parentOrderSn !== summary.parentOrderSn) throw new Error("Temu returned mismatched return identifiers.");
          let logistics = [];
          if (Number(detail.afterSalesType) !== 1) {
            const shipment = await request("bg.aftersales.parentreturnorder.get", { parentAfterSalesSn: key });
            if (!Array.isArray(shipment?.logisticsInfoList)) throw new Error("Temu return tracking response is incomplete.");
            logistics = shipment.logisticsInfoList;
          }
          const record = await save(detail, logistics);
          imported++; if (record.orderId) linked++;
        } catch (error) {
          if (error.channelDisabled) throw error;
          errors.push(`${key}: ${error.message}`);
        }
        await progress({ scanned, imported, linked, errors, windowEnd: to });
      }
      fetched += rows.length;
      if (fetched >= Number(result.total)) break;
    }
    await progress({ scanned, imported, linked, errors, windowEnd: to });
  }
  return { scanned, imported, linked, unlinked: imported - linked, errors };
}

module.exports = { importTemuReturns, temuReturnRecord };
