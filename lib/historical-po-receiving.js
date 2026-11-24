function text(value) {
  return String(value || "").trim();
}

function identifierKey(value, options = {}) {
  const normalized = text(value).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!normalized) return "";
  if (options.keepLeadingZeros !== true && /^\d+$/.test(normalized)) return normalized.replace(/^0+(?=\d)/, "");
  return normalized;
}

function unique(values = []) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function values(record = {}, names = []) {
  return names.flatMap((name) => Array.isArray(record?.[name]) ? record[name] : [record?.[name]]).filter(Boolean);
}

function typedProductIdentifiers(product = {}, types = []) {
  const accepted = new Set(types.map((value) => identifierKey(value, { keepLeadingZeros: true })));
  return (Array.isArray(product?.identifiers) ? product.identifiers : [])
    .filter((entry) => accepted.has(identifierKey(entry?.type, { keepLeadingZeros: true })))
    .map((entry) => entry?.value);
}

function sourceRecords(product = {}) {
  product = product || {};
  return [
    ...(Array.isArray(product?.sourceCatalogMatches) ? product.sourceCatalogMatches : []),
    ...(Array.isArray(product?.vendorOffers) ? product.vendorOffers : []),
  ];
}

function supplierIdentity(value) {
  return identifierKey(value, { keepLeadingZeros: true });
}

function recordSupplier(record = {}, product = {}) {
  record = record || {};
  product = product || {};
  return supplierIdentity(record.supplierName || record.supplier || record.vendorName || product.supplierName || product.supplier || product.vendorName);
}

function descriptor(record = {}, product = {}) {
  record = record || {};
  product = product || {};
  const supplier = recordSupplier(record, product);
  const sources = supplier
    ? sourceRecords(product).filter((entry) => supplierIdentity(entry?.supplierName || entry?.supplier || entry?.vendorName) === supplier)
    : [];
  const aliases = (Array.isArray(product?.aliases) ? product.aliases : [])
    .filter((entry) => entry?.active !== false)
    .flatMap((entry) => [entry?.aliasSku, entry?.sku, entry?.value]);
  const skuValues = [
    ...values(record, ["sku", "productId", "selectedSupplierSku", "sourceSku", "mappedSku", "originalSku"]),
    ...values(product, ["id", "sku"]),
    ...aliases,
  ];
  const upcValues = [
    ...values(record, ["upc", "barcode", "gtin", "ean", "selectedSupplierUpc"]),
    ...values(product, ["upc", "barcode", "gtin", "ean", "upcs", "barcodes"]),
    ...typedProductIdentifiers(product, ["upc", "gtin", "ean", "barcode"]),
    ...sources.flatMap((entry) => values(entry, ["barcode", "upc", "gtin", "ean"])),
  ];
  const supplierSkuValues = [
    ...values(record, ["vendorItemNumber", "vendorSku", "selectedVendorSku", "supplierSku", "sourceSku", "sourceItemNumber"]),
    ...values(product, ["vendorSku", "sourceSku"]),
    ...sources.flatMap((entry) => values(entry, ["sourceSku", "vendorSku", "internalSku"])),
  ];
  const mpnValues = [
    ...values(record, ["manufacturerSku", "manufacturerPartNumber", "mfrPartNumber", "mpn", "selectedManufacturerSku"]),
    ...values(product, ["manufacturerSku", "manufacturerPartNumber", "mfrPartNumber", "mpn"]),
    ...typedProductIdentifiers(product, ["mpn", "manufacturer part number", "manufacturer-part-number"]),
    ...sources.flatMap((entry) => values(entry, ["manufacturerSku", "manufacturerPartNumber", "mfrPartNumber", "mpn"])),
  ];
  return {
    record,
    product,
    productIds: new Set(unique(values(product, ["id", "productId"]).concat(values(record, ["productId"]))).map((value) => identifierKey(value, { keepLeadingZeros: true }))),
    skus: new Set(unique(skuValues).map(identifierKey).filter(Boolean)),
    upcs: new Set(unique(upcValues).map(identifierKey).filter(Boolean)),
    supplierSkus: new Set(unique(supplierSkuValues).map(identifierKey).filter(Boolean)),
    mpns: new Set(unique(mpnValues).map((value) => identifierKey(value, { keepLeadingZeros: true })).filter(Boolean)),
    titleTokens: titleTokens(record?.title || record?.description || product?.title || ""),
  };
}

function intersects(left = new Set(), right = new Set()) {
  for (const value of left) if (right.has(value)) return value;
  return "";
}

function titleTokens(value) {
  const ignored = new Set(["the", "and", "for", "with", "each", "pack", "set", "piece", "pieces", "pc", "pcs"]);
  return new Set(text(value).toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2 && !ignored.has(token)));
}

function titleSimilarity(left = new Set(), right = new Set()) {
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  return overlap / Math.max(1, Math.min(left.size, right.size));
}

function editDistance(leftValue, rightValue) {
  const left = text(leftValue);
  const right = text(rightValue);
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
    }
    for (let index = 0; index < current.length; index += 1) previous[index] = current[index];
  }
  return previous[right.length];
}

function nearMpn(left = new Set(), right = new Set(), leftTitle = new Set(), rightTitle = new Set()) {
  const titleScore = titleSimilarity(leftTitle, rightTitle);
  let best = null;
  for (const leftValue of left) {
    for (const rightValue of right) {
      const longest = Math.max(leftValue.length, rightValue.length);
      if (longest < 5) continue;
      const distance = editDistance(leftValue, rightValue);
      const sameStem = longest >= 7 && (leftValue.startsWith(rightValue) || rightValue.startsWith(leftValue));
      if (distance > 1 && !(sameStem && Math.abs(leftValue.length - rightValue.length) <= 2)) continue;
      if (titleScore < 0.35) continue;
      if (!best || distance < best.distance || (distance === best.distance && titleScore > best.titleScore)) {
        best = { left: leftValue, right: rightValue, distance, titleScore };
      }
    }
  }
  return best;
}

function expectedLineId(expected = {}, fallbackIndex = -1) {
  return text(expected.id || expected.lineId) || (Number.isInteger(Number(expected.lineIndex)) ? `index:${Number(expected.lineIndex)}` : `fallback:${fallbackIndex}`);
}

function scoreCandidate(actual, candidate, index) {
  const expected = candidate.record || {};
  const assignedId = text(actual.record?.receivingPurchaseOrderLineId || actual.record?.purchaseOrderLineId);
  const expectedId = text(expected.id || expected.lineId);
  const assignedIndex = Number(actual.record?.receivingPurchaseOrderLineIndex ?? actual.record?.purchaseOrderLineIndex);
  const candidateIndex = Number(expected.lineIndex ?? index);
  if (assignedId && expectedId && assignedId === expectedId) {
    return { score: 1000, basis: actual.record?.receivingSubstitution === true ? "saved_substitution" : "saved_assignment", reviewRequired: actual.record?.receivingSubstitution === true, evidence: assignedId };
  }
  if (actual.record?.receivingSubstitution === true && Number.isInteger(assignedIndex) && assignedIndex === candidateIndex) {
    return { score: 990, basis: "saved_substitution", reviewRequired: true, evidence: String(candidateIndex) };
  }
  const productId = intersects(actual.productIds, candidate.productIds);
  if (productId) return { score: 900, basis: "catalog_product", reviewRequired: false, evidence: productId };
  const sku = intersects(actual.skus, candidate.skus);
  if (sku) return { score: 850, basis: "sku_or_alias", reviewRequired: false, evidence: sku };
  const upc = intersects(actual.upcs, candidate.upcs);
  if (upc) return { score: 800, basis: "upc_gtin", reviewRequired: false, evidence: upc };
  const supplierSku = intersects(actual.supplierSkus, candidate.supplierSkus);
  if (supplierSku) return { score: 700, basis: "supplier_sku", reviewRequired: false, evidence: supplierSku };
  const mpn = intersects(actual.mpns, candidate.mpns);
  if (mpn) return { score: 600, basis: "normalized_mpn", reviewRequired: true, evidence: mpn };
  const near = nearMpn(actual.mpns, candidate.mpns, actual.titleTokens, candidate.titleTokens);
  if (near) return { score: 450 - near.distance, basis: "near_mpn", reviewRequired: true, evidence: `${near.left}~${near.right}`, near };
  return null;
}

function matchExpectedLine(actualDescriptor, expectedDescriptors = []) {
  const ranked = expectedDescriptors.map((candidate, index) => {
    const scored = scoreCandidate(actualDescriptor, candidate, index);
    return scored ? { ...scored, candidate, index } : null;
  }).filter(Boolean).sort((left, right) => right.score - left.score);
  if (!ranked.length) return { match: null, ambiguous: false, candidates: [] };
  const best = ranked[0];
  const tied = ranked.filter((candidate) => candidate.score === best.score);
  if (tied.length > 1) return { match: null, ambiguous: true, candidates: tied };
  return { match: best, ambiguous: false, candidates: ranked };
}

function lineOpenQuantity(line = {}) {
  return Math.max(0,
    Number(line.qty ?? line.quantity ?? 0)
      - Number(line.receivedQty ?? line.received ?? 0)
      - Number(line.reSourcedQty || 0)
      - Number(line.canceledQty || line.cancelledQty || 0)
      - Number(line.shortClosedQty || 0));
}

function allocateAuditLines(auditLines = [], expectedDescriptors = []) {
  const allocatedByExpected = new Map();
  const allocations = [];
  const extras = [];
  for (const actual of auditLines) {
    const countedQty = Math.max(0, Number(actual?.record?.countedQty ?? actual?.record?.qtyReceived ?? actual?.record?.qty ?? 0));
    if (!(countedQty > 0) || String(actual?.record?.reviewStatus || "").toLowerCase() === "excluded") continue;
    const result = matchExpectedLine(actual, expectedDescriptors);
    if (!result.match) {
      extras.push({ actual, countedQty, reason: result.ambiguous ? "ambiguous_identifier_match" : "no_ordered_line_match", candidates: result.candidates });
      continue;
    }
    const { candidate, basis, reviewRequired, evidence } = result.match;
    const key = expectedLineId(candidate.record, result.match.index);
    const multiplier = Math.max(1, Number(candidate.record?.inventoryMultiplier || 1));
    const expectedQty = Math.max(0, Number(candidate.record?.expectedQty ?? candidate.record?.quantity ?? candidate.record?.qty ?? 0));
    const alreadyAllocated = Number(allocatedByExpected.get(key) || 0);
    const available = Math.max(0, expectedQty - alreadyAllocated);
    const purchaseUnits = Math.floor(countedQty / multiplier);
    const allocatedPurchaseUnits = Math.min(available, purchaseUnits);
    const allocatedPhysicalUnits = allocatedPurchaseUnits * multiplier;
    if (allocatedPurchaseUnits > 0) {
      allocatedByExpected.set(key, alreadyAllocated + allocatedPurchaseUnits);
      allocations.push({ actual, expected: candidate, basis, evidence, reviewRequired, purchaseUnits: allocatedPurchaseUnits, physicalUnits: allocatedPhysicalUnits, multiplier });
    }
    const extraPhysicalUnits = Math.max(0, countedQty - allocatedPhysicalUnits);
    if (extraPhysicalUnits > 0) extras.push({ actual, countedQty: extraPhysicalUnits, reason: "quantity_above_ordered_line", matchedExpected: candidate, basis, reviewRequired: true });
  }
  return { allocations, extras, allocatedByExpected };
}

module.exports = {
  allocateAuditLines,
  descriptor,
  editDistance,
  expectedLineId,
  identifierKey,
  lineOpenQuantity,
  matchExpectedLine,
  nearMpn,
  titleSimilarity,
};
