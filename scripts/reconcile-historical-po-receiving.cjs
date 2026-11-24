const crypto = require("node:crypto");
const db = require("../db");
const {
  allocateAuditLines,
  descriptor,
  expectedLineId,
  identifierKey,
  lineOpenQuantity,
  matchExpectedLine,
} = require("../lib/historical-po-receiving");

const APPLY = process.argv.includes("--apply");
const CONFIRM_NO_INVENTORY_CHANGE = process.argv.includes("--confirm-no-inventory-change");
const ACTOR = "DataPlus historical PO receiving reconciliation";
const VERSION = 1;

function text(value) {
  return String(value || "").trim();
}

function argument(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function isoDate(value) {
  const match = text(value).match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function nextUtcDate(dateValue, days = 1) {
  const parsed = new Date(`${dateValue}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function poBusinessDate(po = {}) {
  return isoDate(po.createdAt || po.orderedAt || po.orderDate || po.sentAt || po.placedAt || po.expectedAt);
}

function auditTime(audit = {}) {
  return text(audit.completedAt || audit.approvedAt || audit.updatedAt || audit.createdAt || audit.purchaseOrderLinkedAt);
}

function auditStartTime(audit = {}) {
  return text(audit.purchaseOrderLinkedAt || audit.createdAt || audit.updatedAt || audit.completedAt || audit.approvedAt);
}

function warehouseKey(value) {
  return identifierKey(value, { keepLeadingZeros: true });
}

function purchaseOrderLine(po = {}, expected = {}, fallbackIndex = -1) {
  const lines = Array.isArray(po.items) ? po.items : [];
  const id = text(expected.id || expected.lineId);
  if (id) {
    const byId = lines.find((line) => text(line.id || line.lineId) === id);
    if (byId) return byId;
  }
  const index = Number(expected.lineIndex);
  if (Number.isInteger(index) && index >= 0 && lines[index]) return lines[index];
  const key = identifierKey(expected.sku);
  const sameSku = key ? lines.filter((line) => identifierKey(line.sku) === key) : [];
  if (sameSku.length === 1) return sameSku[0];
  return fallbackIndex >= 0 ? lines[fallbackIndex] || null : null;
}

function receiptForAudit(po = {}, auditId = "") {
  return (Array.isArray(po.receipts) ? po.receipts : []).find((receipt) => text(receipt.sourceAuditId) === text(auditId)) || null;
}

function upsertTimeline(po, entry) {
  const rows = Array.isArray(po.timeline) ? po.timeline.filter((current) => text(current.id) !== text(entry.id)) : [];
  rows.push(entry);
  po.timeline = rows.slice(-250);
}

function upsertLifecycle(audit, entry) {
  const rows = Array.isArray(audit.lifecycleEvents) ? audit.lifecycleEvents.filter((current) => text(current.id) !== text(entry.id)) : [];
  rows.push(entry);
  audit.lifecycleEvents = rows.slice(-250);
}

async function loadAudits() {
  const audits = [];
  const pageSize = 100;
  for (let page = 1; ; page += 1) {
    const result = await db.listWarehouseAuditsPage({ page, pageSize, reason: "purchase_order_receipt" });
    const rows = Array.isArray(result) ? result : result.audits || [];
    for (const row of rows) {
      const audit = await db.readWarehouseAudit(row.id || row.auditId);
      if (audit?.reason === "purchase_order_receipt" && audit.linkedPurchaseOrderId) audits.push(audit);
    }
    if (!rows.length || rows.length < pageSize || page >= Number(result.totalPages || page)) break;
  }
  return audits;
}

async function loadOutboundScans(fromIso, throughIso) {
  const pool = db.getPool();
  if (!pool) return [];
  const result = await pool.query(`
    select scan.scan_id, scan.audit_id, scan.scanned_at, scan.order_matches, scan.live_item_scans,
      scan.tracking_number, session.warehouse_id, session.warehouse_name
    from outbound_audit_scans scan
    join outbound_audit_sessions session on session.audit_id = scan.audit_id
    where scan.scanned_at >= $1::timestamptz
      and scan.scanned_at < $2::timestamptz
      and jsonb_array_length(coalesce(scan.order_matches, '[]'::jsonb)) > 0
    order by scan.scanned_at, scan.scan_id
  `, [fromIso, throughIso]);
  return result.rows;
}

function outboundItems(scans = []) {
  const rows = [];
  for (const scan of scans) {
    const matches = Array.isArray(scan.order_matches) ? scan.order_matches : [];
    for (const match of matches) {
      const items = Array.isArray(match.itemScanItems) && match.itemScanItems.length
        ? match.itemScanItems
        : (Array.isArray(scan.live_item_scans) ? scan.live_item_scans.filter((item) => !item.orderId || text(item.orderId) === text(match.orderId)) : []);
      items.forEach((item, itemIndex) => {
        const quantity = Math.max(0, Number(item.qty || item.quantity || item.qtyFulfilled || 0));
        if (!(quantity > 0)) return;
        rows.push({
          key: `${scan.scan_id}:${text(match.orderId || match.orderNumber)}:${Number(item.lineIndex ?? itemIndex)}:${identifierKey(item.listingSku || item.sku)}`,
          scanId: text(scan.scan_id),
          outboundAuditId: text(scan.audit_id),
          scannedAt: scan.scanned_at?.toISOString?.() || text(scan.scanned_at),
          warehouseId: text(scan.warehouse_id),
          warehouseName: text(scan.warehouse_name),
          trackingNumber: text(scan.tracking_number),
          orderId: text(match.orderId),
          orderNumber: text(match.orderNumber),
          channelOrderNumber: text(match.channelOrderNumber),
          record: {
            ...item,
            sku: text(item.listingSku || item.sku),
            title: text(item.listingTitle || item.title),
            qty: quantity,
          },
          quantity,
        });
      });
    }
  }
  return rows;
}

function auditLineSummary(entry = {}) {
  const line = entry.actual?.record || {};
  return {
    auditLineId: text(line.id || line.productId || line.sku),
    sku: text(line.sku),
    title: text(line.title || line.productTitle),
    upc: text(line.upc || line.barcode || line.selectedSupplierUpc),
    supplierSku: text(line.selectedVendorSku || line.vendorSku || line.selectedSupplierSku),
    mpn: text(line.selectedManufacturerSku || line.manufacturerSku || line.mfrPartNumber || line.manufacturerPartNumber || line.mpn),
    quantity: Number(entry.countedQty || 0),
    reason: text(entry.reason),
  };
}

async function main() {
  if (!db.isPostgresEnabled()) throw new Error("DATABASE_URL is required.");
  if (APPLY && !CONFIRM_NO_INVENTORY_CHANGE) {
    throw new Error("Apply mode requires --confirm-no-inventory-change. This repair must never post or deduct physical inventory.");
  }
  const cutoff = argument("cutoff", "2026-11-23");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) throw new Error("Use --cutoff=YYYY-MM-DD.");
  const through = argument("through", nextUtcDate(new Date().toISOString().slice(0, 10), 1));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(through)) throw new Error("Use --through=YYYY-MM-DD.");
  const requestedPo = text(argument("po"));
  await db.initDatabase();

  const audits = await loadAudits();
  const candidatesByPo = new Map();
  for (const audit of audits) {
    const po = await db.readPurchaseOrderByKey(audit.linkedPurchaseOrderId);
    if (!po) continue;
    if (requestedPo && ![po.id, po.poNumber].some((value) => text(value).toLowerCase() === requestedPo.toLowerCase())) continue;
    const businessDate = poBusinessDate(po);
    if (!requestedPo && (!businessDate || businessDate >= cutoff)) continue;
    if (["canceled", "cancelled", "rejected", "superseded", "deleted"].includes(text(po.status).toLowerCase())) continue;
    if (["closed", "received", "completed"].includes(text(po.status).toLowerCase()) && !po.activeReceivingAudit?.auditId) continue;
    const current = candidatesByPo.get(String(po.id));
    const candidateScore = (receiptForAudit(po, audit.id) ? 1_000_000 : 0)
      + (Array.isArray(audit.lines) ? audit.lines.reduce((sum, line) => sum + Math.max(0, Number(line.countedQty || 0)), 0) : 0)
      + Math.floor((new Date(auditTime(audit) || 0).getTime() || 0) / 1_000_000_000);
    if (!current || candidateScore > current.score) candidatesByPo.set(String(po.id), { audit, po, businessDate, score: candidateScore });
  }
  const candidates = [...candidatesByPo.values()];
  candidates.sort((left, right) => left.businessDate.localeCompare(right.businessDate) || auditTime(left.audit).localeCompare(auditTime(right.audit)));

  const earliestEvidenceDate = candidates.map(({ audit, businessDate }) => isoDate(auditStartTime(audit)) || businessDate).filter(Boolean).sort()[0] || cutoff;
  const scans = await loadOutboundScans(`${earliestEvidenceDate}T00:00:00.000Z`, `${through}T00:00:00.000Z`);
  const outbound = outboundItems(scans);
  const consumedOutbound = new Map();
  const productCache = new Map();
  const product = async (key) => {
    const lookup = text(key).toLowerCase();
    if (!lookup) return null;
    if (!productCache.has(lookup)) productCache.set(lookup, db.readProductByKey(key).catch(() => null));
    return productCache.get(lookup);
  };
  const report = [];

  for (const { audit, po, businessDate } of candidates) {
    const reconciliation = po.historicalReceivingReconciliation && typeof po.historicalReceivingReconciliation === "object"
      ? po.historicalReceivingReconciliation : null;
    if (reconciliation?.version === VERSION && text(reconciliation.sourceAuditId) === text(audit.id)) {
      report.push({ poNumber: po.poNumber, auditNumber: audit.auditNumber, businessDate, action: "already_applied", reviewRequired: reconciliation.reviewRequired === true });
      continue;
    }

    const expectedRows = [];
    const auditExpected = Array.isArray(audit.purchaseOrderExpectedLines) ? audit.purchaseOrderExpectedLines : [];
    for (let lineIndex = 0; lineIndex < (po.items || []).length; lineIndex += 1) {
      const line = po.items[lineIndex];
      const openQty = lineOpenQuantity(line);
      if (!(openQty > 0)) continue;
      const expected = auditExpected.find((row) => text(row.id || row.lineId) && text(row.id || row.lineId) === text(line.id || line.lineId))
        || auditExpected.find((row) => Number(row.lineIndex) === lineIndex)
        || auditExpected.find((row) => identifierKey(row.sku) && identifierKey(row.sku) === identifierKey(line.sku))
        || {};
      const record = {
        ...line,
        ...expected,
        id: text(line.id || line.lineId || expected.id) || `po-line-${lineIndex}`,
        lineId: text(line.id || line.lineId || expected.lineId),
        lineIndex,
        sku: text(line.sku || expected.sku),
        title: text(line.title || expected.title || expected.description),
        expectedQty: openQty,
        inventoryMultiplier: Math.max(1, Number(expected.inventoryMultiplier || 1)),
      };
      const productRecord = await product(record.productId || record.sku);
      expectedRows.push({ ...descriptor(record, productRecord), poLine: line, poLineIndex: lineIndex, openQty, record });
    }

    const auditRows = [];
    for (const line of Array.isArray(audit.lines) ? audit.lines : []) {
      if (!(Number(line.countedQty || 0) > 0)) continue;
      auditRows.push(descriptor(line, await product(line.productId || line.sku)));
    }
    const receipt = receiptForAudit(po, audit.id);
    const recordedReceiptExtras = (Array.isArray(receipt?.items) ? receipt.items : []).filter((item) => item.extraItem === true || text(item.extraItemStatus) === "unexpected_on_selected_po");
    const direct = expectedRows.length
      ? allocateAuditLines(auditRows, expectedRows)
      : {
          allocations: [],
          extras: recordedReceiptExtras.map((item) => ({
            actual: { record: { ...item, countedQty: Number(item.qtyReceived || 0) } },
            countedQty: Number(item.qtyReceived || 0),
            reason: "recorded_extra_item",
          })),
          allocatedByExpected: new Map(),
        };
    const directByExpected = new Map();
    for (const allocation of direct.allocations) {
      const key = expectedLineId(allocation.expected.record, allocation.expected.poLineIndex);
      const current = directByExpected.get(key) || { purchaseUnits: 0, physicalUnits: 0, allocations: [] };
      current.purchaseUnits += allocation.purchaseUnits;
      current.physicalUnits += allocation.physicalUnits;
      current.allocations.push(allocation);
      directByExpected.set(key, current);
    }

    const hasDurableReceivingEvidence = auditRows.length > 0 || Boolean(receipt) || Number(po.receivedUnits || 0) > 0;
    if (!hasDurableReceivingEvidence) {
      report.push({ poNumber: po.poNumber, auditNumber: audit.auditNumber, businessDate, action: "left_open_no_receiving_evidence" });
      continue;
    }

    const outboundAttributions = [];
    const unsupported = [];
    const auditStart = new Date(auditStartTime(audit) || `${businessDate}T00:00:00.000Z`).getTime();
    const poWarehouse = warehouseKey(po.warehouseId || po.warehouseName || audit.warehouseId || audit.warehouseName);
    const tentativeOutboundUsage = new Map();
    for (const expected of expectedRows) {
      const key = expectedLineId(expected.record, expected.poLineIndex);
      const directUnits = Number(directByExpected.get(key)?.purchaseUnits || 0);
      let remaining = Math.max(0, expected.openQty - directUnits);
      if (!(remaining > 0)) continue;
      for (const evidence of outbound) {
        if (!(remaining > 0)) break;
        const scannedAt = new Date(evidence.scannedAt).getTime();
        if (!Number.isFinite(scannedAt) || scannedAt < auditStart) continue;
        const evidenceWarehouse = warehouseKey(evidence.warehouseId || evidence.warehouseName);
        if (poWarehouse && evidenceWarehouse && poWarehouse !== evidenceWarehouse) continue;
        const alreadyConsumed = Number(consumedOutbound.get(evidence.key) || 0) + Number(tentativeOutboundUsage.get(evidence.key) || 0);
        const availablePhysical = Math.max(0, evidence.quantity - alreadyConsumed);
        if (!(availablePhysical > 0)) continue;
        const actual = descriptor(evidence.record, await product(evidence.record.sku));
        const match = matchExpectedLine(actual, [expected]).match;
        if (!match) continue;
        const multiplier = Math.max(1, Number(expected.record.inventoryMultiplier || 1));
        const availablePurchaseUnits = Math.floor(availablePhysical / multiplier);
        if (!(availablePurchaseUnits > 0)) continue;
        const purchaseUnits = Math.min(remaining, availablePurchaseUnits);
        const physicalUnits = purchaseUnits * multiplier;
        tentativeOutboundUsage.set(evidence.key, Number(tentativeOutboundUsage.get(evidence.key) || 0) + physicalUnits);
        outboundAttributions.push({
          expectedKey: key,
          poLineIndex: expected.poLineIndex,
          sku: text(expected.record.sku),
          purchaseUnits,
          physicalUnits,
          matchBasis: match.basis,
          matchEvidence: match.evidence,
          orderId: evidence.orderId,
          orderNumber: evidence.orderNumber,
          channelOrderNumber: evidence.channelOrderNumber,
          scanId: evidence.scanId,
          outboundAuditId: evidence.outboundAuditId,
          trackingNumber: evidence.trackingNumber,
          scannedAt: evidence.scannedAt,
        });
        remaining -= purchaseUnits;
      }
      if (remaining > 0) unsupported.push({ sku: text(expected.record.sku), lineIndex: expected.poLineIndex, openQty: expected.openQty, directUnits, unsupportedUnits: remaining });
    }

    const reviewMatches = direct.allocations.filter((allocation) => allocation.reviewRequired).map((allocation) => ({
      auditLineId: text(allocation.actual.record?.id || allocation.actual.record?.sku),
      actualSku: text(allocation.actual.record?.sku),
      expectedSku: text(allocation.expected.record?.sku),
      basis: allocation.basis,
      evidence: allocation.evidence,
      quantity: allocation.purchaseUnits,
    }));
    const extras = direct.extras.map(auditLineSummary);
    const reviewReasons = unique([
      ...(extras.length ? ["extra_inventory"] : []),
      ...(reviewMatches.length ? ["identifier_match_review"] : []),
      ...(outboundAttributions.length ? ["outbound_shipment_evidence"] : []),
    ]);
    const detail = {
      poNumber: po.poNumber,
      auditNumber: audit.auditNumber,
      businessDate,
      previousStatus: po.status,
      action: unsupported.length ? "left_open_missing_receiving_evidence" : "close",
      reviewRequired: reviewReasons.length > 0,
      reviewReasons,
      directReceivedUnits: direct.allocations.reduce((sum, row) => sum + row.purchaseUnits, 0),
      outboundAttributedUnits: outboundAttributions.reduce((sum, row) => sum + row.purchaseUnits, 0),
      extraPhysicalUnits: extras.reduce((sum, row) => sum + row.quantity, 0),
      reviewMatches,
      outboundAttributions,
      extras,
      unsupported,
    };
    report.push(detail);
    if (unsupported.length) continue;
    for (const [key, quantity] of tentativeOutboundUsage) consumedOutbound.set(key, Number(consumedOutbound.get(key) || 0) + quantity);
    if (!APPLY) continue;

    const now = new Date().toISOString();
    for (const expected of expectedRows) {
      const line = expected.poLine;
      const openQty = lineOpenQuantity(line);
      if (!(openQty > 0)) continue;
      line.receivedQty = Number(line.receivedQty || 0) + openQty;
      line.remainingQty = lineOpenQuantity(line);
      line.lastReceivedAt = auditTime(audit) || now;
      line.lastVarianceStatus = "historical_reconciliation";
      line.historicalReceivingEvidence = {
        sourceAuditId: audit.id,
        sourceAuditNumber: audit.auditNumber,
        directUnits: Number(directByExpected.get(expectedLineId(expected.record, expected.poLineIndex))?.purchaseUnits || 0),
        outboundUnits: outboundAttributions.filter((row) => row.poLineIndex === expected.poLineIndex).reduce((sum, row) => sum + row.purchaseUnits, 0),
        physicalInventoryChanged: false,
        reconciledAt: now,
        reconciledBy: ACTOR,
      };
    }

    for (const allocation of direct.allocations) {
      const line = allocation.actual.record;
      const expected = allocation.expected.record;
      const actualSku = text(line.sku);
      const expectedSku = text(expected.sku);
      line.receivingPurchaseOrderLineId = text(expected.id || expected.lineId);
      line.receivingPurchaseOrderLineIndex = Number(expected.lineIndex);
      line.historicalPoResolutionAppliedAt = now;
      line.historicalPoResolutionBasis = allocation.basis;
      line.historicalPoResolutionEvidence = allocation.evidence;
      line.historicalPoResolutionReviewRequired = allocation.reviewRequired === true;
      if (actualSku && expectedSku && identifierKey(actualSku) !== identifierKey(expectedSku)) {
        line.receivingSubstitution = true;
        line.receivingSubstitutionActualSku = actualSku;
        line.receivingSubstitutionExpectedSku = expectedSku;
        line.receivingSubstitutionReason = `Historical PO receiving match by ${allocation.basis}; catalog products were not merged.`;
        line.reviewStatus = "unreviewed";
      }
    }
    for (const extra of direct.extras) {
      extra.actual.record.historicalExtraReviewRequired = true;
      extra.actual.record.historicalExtraReviewReason = extra.reason;
      extra.actual.record.historicalExtraReviewedAt = "";
    }

    const previousStatus = text(po.status || "receiving");
    po.receivedUnits = (po.items || []).reduce((sum, line) => sum + Math.max(0, Number(line.receivedQty || 0)), 0);
    po.extraReceivedUnits = Math.max(Number(po.extraReceivedUnits || 0), extras.reduce((sum, row) => sum + row.quantity, 0));
    po.closedFromStatus = previousStatus;
    po.closedFromWorkflowStage = text(po.workflowStage);
    po.status = "closed";
    po.workflowStage = "history";
    po.closedAt = po.closedAt || now;
    po.closedBy = po.closedBy || ACTOR;
    po.closeReason = "Historical receiving reconciled from warehouse audit and outbound shipment evidence without changing physical inventory.";
    po.receivedAt = po.receivedAt || isoDate(auditTime(audit) || now);
    po.lastReceiptAt = po.lastReceiptAt || auditTime(audit) || now;
    po.openEstimatedCost = 0;
    po.historicalReceivingReconciliation = {
      version: VERSION,
      sourceAuditId: audit.id,
      sourceAuditNumber: audit.auditNumber,
      cutoff,
      reviewRequired: reviewReasons.length > 0,
      reviewStatus: reviewReasons.length ? "pending" : "not_required",
      reviewReasons,
      directReceivedUnits: detail.directReceivedUnits,
      outboundAttributedUnits: detail.outboundAttributedUnits,
      extraPhysicalUnits: detail.extraPhysicalUnits,
      identifierMatches: reviewMatches,
      outboundAttributions,
      extraItems: extras,
      physicalInventoryChanged: false,
      reconciledAt: now,
      reconciledBy: ACTOR,
    };
    if (text(po.activeReceivingAudit?.auditId) === text(audit.id)) delete po.activeReceivingAudit;
    upsertTimeline(po, {
      id: `historical-po-receiving-${audit.id}`,
      type: "historical_receiving_reconciliation",
      title: reviewReasons.length ? "Historical PO closed with receiving review" : "Historical PO receiving reconciled",
      message: `${detail.directReceivedUnits} purchase unit(s) linked from ${audit.auditNumber || "the receiving audit"}; ${detail.outboundAttributedUnits} unit(s) supported by outbound shipment evidence; ${detail.extraPhysicalUnits} extra physical unit(s) retained for review. Physical inventory was not changed.`,
      user: ACTOR,
      createdAt: now,
    });

    if (!receipt) {
      po.receipts = Array.isArray(po.receipts) ? po.receipts : [];
      po.receipts.unshift({
        id: crypto.randomUUID(),
        receiptNumber: `RCV-HIST-${text(po.poNumber || po.id).replace(/\D/g, "") || po.receipts.length + 1}`,
        status: "final",
        receivedAt: isoDate(auditTime(audit) || now),
        receivedBy: ACTOR,
        receivedByUsers: [ACTOR],
        postedBy: ACTOR,
        sourceAuditId: audit.id,
        sourceAuditNumber: audit.auditNumber,
        warehouseId: po.warehouseId || audit.warehouseId || "",
        warehouseName: po.warehouseName || audit.warehouseName || "",
        historicalReconciliation: true,
        inventoryStatus: "historical_evidence_only",
        physicalInventoryChanged: false,
        reviewRequired: reviewReasons.length > 0,
        items: [
          ...expectedRows.map((expected) => ({
          sku: text(expected.record.sku),
          lineId: text(expected.record.id || expected.record.lineId),
          lineIndex: expected.poLineIndex,
          title: text(expected.record.title),
          qtyReceived: expected.openQty,
          inventoryQtyReceived: 0,
          inventoryStatus: "historical_evidence_only",
          historicalOutboundEvidenceQty: outboundAttributions.filter((row) => row.poLineIndex === expected.poLineIndex).reduce((sum, row) => sum + row.purchaseUnits, 0),
          physicalInventoryChanged: false,
          })),
          ...extras.map((extra) => ({
            sku: extra.sku,
            title: extra.title || extra.sku || "Extra item",
            qtyReceived: extra.quantity,
            inventoryQtyReceived: 0,
            inventoryStatus: "historical_evidence_only",
            extraItem: true,
            extraItemStatus: "unexpected_on_selected_po",
            varianceStatus: "extra_item",
            varianceNote: "Historical receiving audit item not ordered on this PO; review required.",
            sourceAuditLineId: extra.auditLineId,
            physicalInventoryChanged: false,
          })),
        ],
      });
    } else {
      receipt.historicalReceivingReconciliation = po.historicalReceivingReconciliation;
      receipt.physicalInventoryChangedByReconciliation = false;
      receipt.updatedAt = now;
    }

    audit.status = "completed";
    audit.completedAt = audit.completedAt || now;
    audit.approvedAt = audit.approvedAt || now;
    audit.approvedBy = audit.approvedBy || ACTOR;
    audit.historicalReceivingReconciliation = po.historicalReceivingReconciliation;
    audit.disposition = {
      ...(audit.disposition && typeof audit.disposition === "object" ? audit.disposition : {}),
      type: "purchase_order_receipt",
      label: "Historical PO receipt reconciled",
      purchaseOrderId: po.id,
      purchaseOrderNumber: po.poNumber,
      reviewRequired: reviewReasons.length > 0,
      physicalInventoryChanged: false,
      appliedAt: now,
      appliedBy: ACTOR,
    };
    upsertLifecycle(audit, {
      id: `historical-po-receiving-${po.id}`,
      type: "historical_po_receiving_reconciliation",
      at: now,
      user: ACTOR,
      purchaseOrderId: po.id,
      purchaseOrderNumber: po.poNumber,
      reviewRequired: reviewReasons.length > 0,
      physicalInventoryChanged: false,
    });
    audit.updatedAt = now;
    po.updatedAt = now;
    await db.saveWarehouseAudit(audit);
    await db.savePurchaseOrder(po);
    await db.updatePurchaseOrderReceivingProgress(po.id, null);
  }

  const summary = {
    mode: APPLY ? "apply" : "dry-run",
    cutoffExclusive: cutoff,
    outboundThroughExclusive: through,
    auditsChecked: audits.length,
    candidates: candidates.length,
    closeable: report.filter((row) => row.action === "close").length,
    applied: APPLY ? report.filter((row) => row.action === "close").length : 0,
    reviewRequired: report.filter((row) => row.reviewRequired === true).length,
    leftOpen: report.filter((row) => String(row.action).startsWith("left_open")).length,
    alreadyApplied: report.filter((row) => row.action === "already_applied").length,
    physicalInventoryChanged: false,
    report,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

function unique(values = []) {
  return [...new Set(values.map(text).filter(Boolean))];
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message || error}\n`);
    process.exitCode = 1;
  })
  .finally(() => db.closePool());
