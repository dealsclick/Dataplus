const db = require('../db');

const APPLY = process.argv.includes('--apply');
const ACTOR = 'DataPlus historical PO audit repair';

function text(value) {
  return String(value || '').trim();
}

function identifierKey(value) {
  const exact = text(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  return /^\d+$/.test(exact) ? exact.replace(/^0+(?=\d)/, '') : exact;
}

function identifierValues(record = {}, names = []) {
  return [...new Set(names.flatMap((name) => {
    const value = record?.[name];
    return Array.isArray(value) ? value : [value];
  }).map(identifierKey).filter(Boolean))];
}

function productUpcs(product = {}) {
  return identifierValues(product, ['upc', 'barcode', 'gtin', 'ean', 'upcs', 'barcodes']);
}

function lineUpcs(line = {}, product = {}) {
  return [...new Set([
    ...identifierValues(line, ['upc', 'barcode', 'gtin', 'selectedSupplierUpc']),
    ...productUpcs(product),
  ])];
}

function scaleContributors(contributors, quantity) {
  const rows = (Array.isArray(contributors) ? contributors : []).filter((entry) => text(entry.user));
  if (!rows.length) return [{ user: ACTOR, quantity }];
  const total = rows.reduce((sum, entry) => sum + Math.max(0, Number(entry.quantity || 0)), 0);
  let remaining = quantity;
  return rows.map((entry, index) => {
    const assigned = index === rows.length - 1
      ? remaining
      : Math.min(remaining, total > 0 ? quantity * Math.max(0, Number(entry.quantity || 0)) / total : 0);
    remaining -= assigned;
    return { ...entry, quantity: assigned };
  }).filter((entry) => entry.quantity > 0);
}

function receiptForAudit(po, auditId) {
  return (Array.isArray(po.receipts) ? po.receipts : []).find((receipt) => text(receipt.sourceAuditId) === text(auditId));
}

function purchaseOrderLine(po, expected) {
  const index = Number(expected.lineIndex);
  if (Number.isInteger(index) && index >= 0 && po.items?.[index]) return po.items[index];
  return (po.items || []).find((line) => text(line.id || line.lineId) === text(expected.id));
}

function recomputePoStatus(po) {
  const lines = Array.isArray(po.items) ? po.items : [];
  const openUnits = lines.reduce((sum, line) => sum + Math.max(0, Number(line.qty || 0) - Number(line.receivedQty || 0) - Number(line.shortClosedQty || 0)), 0);
  if (openUnits > 0) return Number(po.receivedUnits || 0) > 0 ? 'partially_received' : po.status;
  const allReceived = lines.every((line) => Number(line.receivedQty || 0) >= Number(line.qty || 0));
  return allReceived ? 'received' : 'closed';
}

async function loadAudits() {
  const audits = [];
  const pageSize = 100;
  for (let page = 1; ; page += 1) {
    const result = await db.listWarehouseAuditsPage({ page, pageSize, reason: 'purchase_order_receipt' });
    const rows = Array.isArray(result) ? result : result.audits || [];
    for (const row of rows) {
      const audit = await db.readWarehouseAudit(row.id || row.auditId);
      if (audit?.reason === 'purchase_order_receipt' && audit.linkedPurchaseOrderId) audits.push(audit);
    }
    if (!rows.length || rows.length < pageSize || page >= Number(result.totalPages || page)) break;
  }
  return audits;
}

async function main() {
  await db.initDatabase();
  const audits = await loadAudits();
  const productCache = new Map();
  const product = async (value) => {
    const lookup = text(value).toLowerCase();
    if (!lookup) return null;
    if (!productCache.has(lookup)) productCache.set(lookup, await db.readProductByKey(value));
    return productCache.get(lookup);
  };
  const report = [];

  for (const audit of audits) {
    const po = await db.readPurchaseOrderByKey(audit.linkedPurchaseOrderId);
    if (!po) continue;
    const expectedRows = [];
    for (const expected of audit.purchaseOrderExpectedLines || []) {
      const expectedProduct = await product(expected.sku);
      expectedRows.push({ expected, product: expectedProduct, upcs: lineUpcs(expected, expectedProduct) });
    }
    let auditChanged = false;
    let poChanged = false;
    const linkedReceipt = receiptForAudit(po, audit.id);
    let postedPhysicalUnitsReclassified = 0;
    let postedPurchaseUnitsReclassified = 0;

    for (const line of audit.lines || []) {
      if (Number(line.countedQty || 0) <= 0 || line.historicalPoResolutionAppliedAt) continue;
      const currentProduct = await product(line.productId || line.sku);
      const upcs = lineUpcs(line, currentProduct);
      const candidates = expectedRows.filter((row) => row.upcs.some((upc) => upcs.includes(upc)));
      if (candidates.length !== 1 || identifierKey(candidates[0].expected.sku) === identifierKey(line.sku)) continue;

      const { expected, product: expectedProduct } = candidates[0];
      const entry = {
        auditNumber: audit.auditNumber,
        poNumber: po.poNumber,
        lineId: line.id,
        barcode: line.barcode || line.upc,
        fromSku: line.sku,
        toSku: expected.sku,
        countedQty: Number(line.countedQty || 0),
        expectedQty: Number(expected.expectedQty || 0),
        receiptPosted: Boolean(linkedReceipt),
        action: '',
      };

      if (!linkedReceipt) {
        entry.action = 'relink_unposted_audit_line';
        if (APPLY) {
          line.resolvedFromSku = line.sku;
          line.sku = text(expected.sku);
          line.productId = text(expectedProduct?.id || line.productId);
          line.title = text(expected.title || expectedProduct?.title || line.title || expected.sku);
          line.expectedQty = Number(expected.expectedQty || 0);
          line.purchaseOrderLineId = text(expected.id);
          line.purchaseOrderLineIndex = Number(expected.lineIndex);
          line.historicalPoResolutionAppliedAt = new Date().toISOString();
          line.historicalPoResolutionBasis = 'exact_upc';
          auditChanged = true;
        }
        report.push(entry);
        continue;
      }

      const poLine = purchaseOrderLine(po, expected);
      const receiptItem = (linkedReceipt.items || []).find((item) => item.extraItem === true && identifierKey(item.sku) === identifierKey(line.sku));
      const physicalQty = Number(receiptItem?.inventoryQtyReceived || receiptItem?.qtyReceived || line.countedQty || 0);
      const purchaseQty = Number(expected.expectedQty || 0);
      const multiplier = purchaseQty > 0 ? physicalQty / purchaseQty : 0;
      const safePostedRepair = Boolean(
        poLine
        && receiptItem
        && Number(poLine.receivedQty || 0) === 0
        && Number.isInteger(multiplier)
        && multiplier >= 1
        && physicalQty === Number(line.countedQty || 0)
      );
      entry.inventoryMultiplier = multiplier;
      entry.action = safePostedRepair ? 'reclassify_posted_extra_without_inventory_change' : 'manual_review_required';
      report.push(entry);
      if (!APPLY || !safePostedRepair) continue;

      const now = new Date().toISOString();
      const contributors = scaleContributors(receiptItem.receivingContributors || line.receivingContributors, purchaseQty);
      line.resolvedFromSku = line.sku;
      line.physicalCountedQty = physicalQty;
      line.countedQty = purchaseQty;
      line.inventoryMultiplier = multiplier;
      line.sku = text(expected.sku);
      line.productId = text(expectedProduct?.id || line.productId);
      line.title = text(expected.title || expectedProduct?.title || line.title || expected.sku);
      line.expectedQty = purchaseQty;
      line.purchaseOrderLineId = text(expected.id || poLine.id || poLine.lineId);
      line.purchaseOrderLineIndex = Number(expected.lineIndex);
      line.receivingContributors = contributors;
      line.historicalPoResolutionAppliedAt = now;
      line.historicalPoResolutionBasis = 'exact_upc_pack_conversion';

      const receivedBefore = Number(poLine.receivedQty || 0);
      poLine.receivedQty = receivedBefore + purchaseQty;
      poLine.remainingQty = Math.max(0, Number(poLine.qty || 0) - Number(poLine.receivedQty || 0) - Number(poLine.shortClosedQty || 0));
      poLine.lastReceivedAt = linkedReceipt.receivedAt || now;
      poLine.lastLocationBin = receiptItem.locationBin || line.locationBin || '';
      poLine.lastVarianceStatus = 'none';
      poLine.lastVarianceNote = '';

      Object.assign(receiptItem, {
        sku: text(expected.sku),
        lineId: text(poLine.id || poLine.lineId || expected.id),
        lineIndex: Number(expected.lineIndex),
        routeId: text(poLine.routeId),
        orderId: text(poLine.orderId),
        title: text(expected.title || expectedProduct?.title || poLine.title || expected.sku),
        qtyReceived: purchaseQty,
        inventoryQtyReceived: physicalQty,
        inventoryMultiplier: multiplier,
        orderedQty: Number(poLine.qty || 0),
        receivedBefore,
        receivingContributors: contributors,
        receivedBy: contributors.map((row) => row.user).join(', '),
        extraItem: false,
        extraItemStatus: '',
        expectedPurchaseOrders: [],
        varianceStatus: 'none',
        varianceNote: `Reclassified from ${entry.fromSku} by exact UPC without changing physical inventory.`,
      });
      postedPhysicalUnitsReclassified += physicalQty;
      postedPurchaseUnitsReclassified += purchaseQty;
      auditChanged = true;
      poChanged = true;
    }

    if (APPLY && poChanged && linkedReceipt) {
      const now = new Date().toISOString();
      linkedReceipt.extraItemUnits = Math.max(0, Number(linkedReceipt.extraItemUnits || 0) - postedPhysicalUnitsReclassified);
      linkedReceipt.orderedReceivedUnits = Number(linkedReceipt.orderedReceivedUnits || 0) + postedPurchaseUnitsReclassified;
      linkedReceipt.updatedAt = now;
      po.extraReceivedUnits = Math.max(0, Number(po.extraReceivedUnits || 0) - postedPhysicalUnitsReclassified);
      po.receivedUnits = Number(po.receivedUnits || 0) + postedPurchaseUnitsReclassified;
      po.status = recomputePoStatus(po);
      po.workflowStage = po.status === 'received' || po.status === 'closed' ? 'history' : 'receiving';
      po.updatedAt = now;
      po.timeline = [...(Array.isArray(po.timeline) ? po.timeline : []), {
        id: `po-audit-resolution-${audit.id}`,
        type: 'receiving_correction',
        title: 'Historical receiving identifiers corrected',
        message: `${postedPhysicalUnitsReclassified} physical pieces were linked to ${postedPurchaseUnitsReclassified} ordered purchase units by exact UPC. Physical stock was not changed.`,
        at: now,
        user: ACTOR,
      }].slice(-250);
      delete po.activeReceivingAudit;

      audit.status = 'completed';
      audit.completedAt = audit.completedAt || now;
      audit.approvedAt = audit.approvedAt || now;
      audit.approvedBy = audit.approvedBy || ACTOR;
      audit.appliedLines = (audit.lines || []).filter((row) => Number(row.countedQty || 0) > 0).length;
      audit.disposition = {
        type: 'purchase_order_receipt',
        label: 'Received against DataPlus PO',
        purchaseOrderId: po.id,
        purchaseOrderNumber: po.poNumber,
        receiptId: linkedReceipt.id,
        receiptNumber: linkedReceipt.receiptNumber,
        allocatedQty: Number(linkedReceipt.allocation?.allocatedQty || 0),
        blockedQty: 0,
        note: 'Historical exact-UPC receiving resolution applied without changing physical inventory.',
        appliedAt: now,
        appliedBy: ACTOR,
      };
      audit.lifecycleEvents = [...(Array.isArray(audit.lifecycleEvents) ? audit.lifecycleEvents : []), {
        type: 'historical_po_receiving_resolution',
        at: now,
        user: ACTOR,
        purchaseOrderId: po.id,
        purchaseOrderNumber: po.poNumber,
        receiptId: linkedReceipt.id,
        receiptNumber: linkedReceipt.receiptNumber,
        physicalInventoryChanged: false,
      }].slice(-100);
      audit.updatedAt = now;
    }

    if (APPLY && auditChanged) await db.saveWarehouseAudit(audit);
    if (APPLY && poChanged) {
      await db.savePurchaseOrder(po);
      await db.updatePurchaseOrderReceivingProgress(po.id, null);
    }
  }

  const manualReview = report.filter((entry) => entry.action === 'manual_review_required');
  console.log(JSON.stringify({
    mode: APPLY ? 'apply' : 'dry-run',
    auditsChecked: audits.length,
    corrections: report.length,
    manualReview: manualReview.length,
    report,
  }, null, 2));
  if (manualReview.length) process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  })
  .finally(() => db.closePool());
