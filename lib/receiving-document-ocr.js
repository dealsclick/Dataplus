const RECEIVING_FIELDS = [
  "vendorItemNumber",
  "manufacturerSku",
  "upc",
  "description",
  "quantity",
  "poNumber",
  "cartonNumber"
];

const TRUE_VALUE_COLUMNS = {
  cartonNumber: { label: "CTN NO", startPercent: 12, endPercent: 20 },
  vendorItemNumber: { label: "ITEM NO", startPercent: 31, endPercent: 38 },
  manufacturerSku: { label: "MFR MODEL#", startPercent: 38, endPercent: 46 },
  upc: { label: "UPC", startPercent: 45, endPercent: 55 },
  description: { label: "DESCRIPTION", startPercent: 53, endPercent: 72 },
  quantity: { label: "CTN QTY", startPercent: 76, endPercent: 82 },
  poNumber: { label: "P/O NO", startPercent: 81, endPercent: 92 }
};

function boundedPercent(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : fallback;
}

function normalizeColumns(columns, defaults = {}) {
  return Object.fromEntries(RECEIVING_FIELDS.map((field) => {
    const fallback = defaults[field] || {};
    const source = columns?.[field] && typeof columns[field] === "object" ? columns[field] : {};
    const startPercent = boundedPercent(source.startPercent, Number(fallback.startPercent || 0));
    const endPercent = boundedPercent(source.endPercent, Number(fallback.endPercent || 100));
    return [field, {
      label: String(source.label || fallback.label || field).trim(),
      startPercent: Math.min(startPercent, endPercent),
      endPercent: Math.max(startPercent, endPercent)
    }];
  }));
}

function defaultReceivingDocumentTemplate(vendor = {}) {
  const identity = `${vendor.name || ""} ${vendor.code || ""}`.toLowerCase();
  const trueValue = /true\s*value|tv\s*hardware|\btrv\b/.test(identity);
  return {
    enabled: true,
    name: trueValue ? "True Value carton cross reference" : "Packing slip columns",
    templateKey: trueValue ? "true-value-carton-cross-reference-v1" : `supplier-${String(vendor.id || vendor.code || "packing-slip").toLowerCase()}-v1`,
    engine: "tesseract",
    language: "eng",
    pageSegmentationMode: trueValue ? 6 : 4,
    minimumConfidence: 45,
    aiFallbackEnabled: true,
    documentMarkers: trueValue ? ["TV HARDWARE DIST LLC", "CARTON CROSS REFERENCE"] : [],
    columns: normalizeColumns({}, trueValue ? TRUE_VALUE_COLUMNS : {})
  };
}

function normalizeReceivingDocumentTemplate(template, vendor = {}) {
  const fallback = defaultReceivingDocumentTemplate(vendor);
  const source = template && typeof template === "object" ? template : {};
  return {
    enabled: source.enabled !== false,
    name: String(source.name || fallback.name).trim().slice(0, 120),
    templateKey: String(source.templateKey || fallback.templateKey).trim().slice(0, 160),
    engine: "tesseract",
    language: String(source.language || "eng").trim().slice(0, 20) || "eng",
    pageSegmentationMode: Math.max(3, Math.min(13, Number(source.pageSegmentationMode || fallback.pageSegmentationMode) || fallback.pageSegmentationMode)),
    minimumConfidence: Math.max(0, Math.min(100, Number(source.minimumConfidence ?? fallback.minimumConfidence) || 0)),
    aiFallbackEnabled: source.aiFallbackEnabled !== false,
    documentMarkers: [...new Set((Array.isArray(source.documentMarkers) ? source.documentMarkers : String(source.documentMarkers || "").split(/[|\n]/)).map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 20),
    columns: normalizeColumns(source.columns, fallback.columns)
  };
}

function parseTesseractTsv(tsv) {
  const rows = String(tsv || "").split(/\r?\n/);
  const headers = rows.shift()?.split("\t") || [];
  const index = Object.fromEntries(headers.map((name, position) => [name, position]));
  return rows.map((row) => {
    const values = row.split("\t");
    const text = String(values[index.text] || "").trim();
    return {
      level: Number(values[index.level] || 0),
      text,
      confidence: Number(values[index.conf] || -1),
      left: Number(values[index.left] || 0),
      top: Number(values[index.top] || 0),
      width: Number(values[index.width] || 0),
      height: Number(values[index.height] || 0),
      page: Number(values[index.page_num] || 1),
      block: Number(values[index.block_num] || 0),
      paragraph: Number(values[index.par_num] || 0),
      line: Number(values[index.line_num] || 0)
    };
  }).filter((row) => row.level > 0);
}

function compactDigits(value) {
  return String(value || "").replace(/[^0-9]/g, "");
}

function mappedValue(words, mapping, pageWidth) {
  const start = (Number(mapping.startPercent || 0) / 100) * pageWidth;
  const end = (Number(mapping.endPercent || 100) / 100) * pageWidth;
  return words.filter((word) => {
    const center = word.left + word.width / 2;
    return center >= start && center < end;
  }).map((word) => word.text).join(" ").replace(/\s+/g, " ").trim();
}

function extractMappedLines(tsv, templateInput, vendor = {}) {
  const template = normalizeReceivingDocumentTemplate(templateInput, vendor);
  const records = parseTesseractTsv(tsv);
  const words = records.filter((word) => word.text && word.confidence >= 0);
  const pageWidths = new Map();
  for (const row of records.filter((record) => record.level === 1)) pageWidths.set(row.page, Math.max(1, row.width));
  for (const word of words) pageWidths.set(word.page, Math.max(pageWidths.get(word.page) || 0, word.left + word.width));
  const lineGroups = new Map();
  for (const word of words) {
    const key = `${word.page}:${word.block}:${word.paragraph}:${word.line}`;
    if (!lineGroups.has(key)) lineGroups.set(key, []);
    lineGroups.get(key).push(word);
  }
  const lines = [];
  for (const lineWords of lineGroups.values()) {
    lineWords.sort((left, right) => left.left - right.left);
    const pageWidth = pageWidths.get(lineWords[0].page) || 1;
    const mapped = Object.fromEntries(RECEIVING_FIELDS.map((field) => [field, mappedValue(lineWords, template.columns[field], pageWidth)]));
    const upc = compactDigits(mapped.upc);
    const vendorItemNumber = mapped.vendorItemNumber.replace(/\s+/g, " ").trim();
    const quantityMatch = String(mapped.quantity || "").match(/\b(\d{1,5})\b/);
    const quantity = quantityMatch ? Number(quantityMatch[1]) : 0;
    if (!vendorItemNumber || !/\d/.test(vendorItemNumber) || upc.length < 8 || quantity <= 0) continue;
    const confidences = lineWords.map((word) => word.confidence).filter((value) => value >= 0);
    const confidence = confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : 0;
    lines.push({
      vendorItemNumber,
      manufacturerSku: mapped.manufacturerSku.trim(),
      upc,
      description: mapped.description.trim(),
      quantity,
      poNumber: mapped.poNumber.replace(/\s+/g, "").trim(),
      cartonNumber: mapped.cartonNumber.replace(/\s+/g, "").trim(),
      confidence: Math.round(confidence * 10) / 10
    });
  }
  const allText = words.map((word) => word.text).join(" ");
  const markerMatches = template.documentMarkers.filter((marker) => allText.toLowerCase().includes(marker.toLowerCase()));
  const averageConfidence = lines.length ? lines.reduce((sum, line) => sum + line.confidence, 0) / lines.length : 0;
  const warnings = [];
  if (!lines.length) warnings.push("No complete mapped rows were found. Check the supplier column ranges or use David fallback.");
  if (template.documentMarkers.length && !markerMatches.length) warnings.push("The expected supplier document markers were not recognized.");
  if (averageConfidence < template.minimumConfidence) warnings.push(`OCR confidence ${Math.round(averageConfidence)}% is below the supplier minimum of ${template.minimumConfidence}%.`);
  return {
    supplierName: String(vendor.name || ""),
    documentNumber: "",
    pageNumbers: [...new Set(words.map((word) => String(word.page)))],
    lines,
    warnings,
    averageConfidence: Math.round(averageConfidence * 10) / 10,
    markerMatches
  };
}

function identifierKeys(value) {
  const key = String(value || "").replace(/[^0-9a-z]/gi, "").toLowerCase();
  if (!key) return [];
  const withoutLeadingZeros = /^\d+$/.test(key) ? key.replace(/^0+(?=\d)/, "") : key;
  return [...new Set([key, withoutLeadingZeros].filter(Boolean))];
}

function buildReceivingReview(audit, extracted, metadata = {}) {
  const scannedLines = Array.isArray(audit.lines) ? audit.lines : [];
  const grouped = new Map();
  for (const line of Array.isArray(extracted.lines) ? extracted.lines : []) {
    const identity = identifierKeys(line.upc)[0] || identifierKeys(line.vendorItemNumber)[0] || identifierKeys(line.manufacturerSku)[0] || String(line.description || "").toLowerCase();
    if (!identity) continue;
    const existing = grouped.get(identity);
    if (!existing) grouped.set(identity, { ...line, quantity: Math.max(0, Number(line.quantity || 0)), sourceRowCount: 1 });
    else {
      existing.quantity += Math.max(0, Number(line.quantity || 0));
      existing.sourceRowCount += 1;
      existing.cartonNumber = [...new Set([existing.cartonNumber, line.cartonNumber].map((value) => String(value || "").trim()).filter(Boolean))].join(", ");
      existing.poNumber = [...new Set([existing.poNumber, line.poNumber].map((value) => String(value || "").trim()).filter(Boolean))].join(", ");
      existing.confidence = Math.min(Number(existing.confidence ?? 100), Number(line.confidence ?? 100));
    }
  }
  const lines = [...grouped.values()].map((line, index) => {
    const identifiers = new Set([line.upc, line.vendorItemNumber, line.manufacturerSku].flatMap(identifierKeys));
    const matches = scannedLines.filter((scan) => [scan.barcode, scan.upc, scan.sku, scan.vendorSku, scan.selectedSupplierSku, scan.selectedVendorSku, scan.manufacturerSku, scan.selectedManufacturerSku].flatMap(identifierKeys).some((value) => identifiers.has(value)));
    const countedQty = matches.reduce((sum, scan) => sum + Number(scan.countedQty || 0), 0);
    const expectedQty = Math.max(0, Number(line.quantity || 0));
    return { id: `${index + 1}`, ...line, expectedQty, countedQty, variance: countedQty - expectedQty, matchedAuditSkus: [...new Set(matches.map((scan) => scan.sku).filter(Boolean))], status: !matches.length ? "not_scanned" : countedQty === expectedQty ? "matched" : "variance" };
  });
  return {
    supplierName: String(extracted.supplierName || audit.supplierName || ""),
    templateKey: String(metadata.templateKey || "generic-packing-slip-v1"),
    documentNumber: String(extracted.documentNumber || ""),
    pageNumbers: extracted.pageNumbers || [],
    documentsAnalyzed: metadata.documentsAnalyzed || [],
    documentCount: Number(metadata.documentCount || 0),
    lines,
    warnings: extracted.warnings || [],
    averageConfidence: Number(extracted.averageConfidence || 0),
    analyzedAt: new Date().toISOString(),
    analyzedBy: String(metadata.analyzedBy || "OCR"),
    provider: String(metadata.provider || "local-ocr"),
    model: String(metadata.model || "tesseract")
  };
}

module.exports = {
  RECEIVING_FIELDS,
  TRUE_VALUE_COLUMNS,
  defaultReceivingDocumentTemplate,
  normalizeReceivingDocumentTemplate,
  parseTesseractTsv,
  extractMappedLines,
  buildReceivingReview
};
