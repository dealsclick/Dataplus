const crypto = require("crypto");
const { fulfillmentItemMeasurements } = require("./fulfillment-operations");

const DISPUTE_REFERENCE_LIMIT = 50_000;
const DISPUTE_QUERY_CHUNK_SIZE = 1_000;
const DISPUTE_INSERT_CHUNK_SIZE = 250;

function chunks(values = [], size = DISPUTE_QUERY_CHUNK_SIZE) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function text(value) {
  return String(value ?? "").trim();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function timestamp(value) {
  return value?.toISOString?.() || value || "";
}

function normalizedPostalSuggestion(value, country = "") {
  const postalCode = text(value).toUpperCase();
  if (!postalCode) return "";
  if (text(country).toUpperCase() === "US") {
    const match = postalCode.match(/^\d{5}/);
    if (match) return match[0];
  }
  return postalCode;
}

function quoteEvidenceIsCurrent(row = {}, rawInput = row.raw) {
  if (!row.latest_run_id) return false;
  const raw = object(rawInput);
  const evidenceUpdatedAt = [
    object(raw.packageOverride).updatedAt,
    object(raw.catalogQuotePackage).capturedAt,
    object(raw.orderDestinationOverride).updatedAt,
  ].map((value) => Date.parse(text(value))).filter(Number.isFinite);
  if (!evidenceUpdatedAt.length) return true;
  const evidenceUpdatedMs = Math.max(...evidenceUpdatedAt);
  const quoteRequestedMs = Date.parse(timestamp(row.latest_run_requested_at));
  if (!Number.isFinite(quoteRequestedMs)) return true;
  return quoteRequestedMs >= evidenceUpdatedMs;
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function importBatchId(importGroupId, sequence) {
  if (!text(importGroupId) || !(Number(sequence) > 0)) return crypto.randomUUID();
  return `shipping-dispute-${crypto.createHash("sha256").update(`${text(importGroupId)}:${Number(sequence)}`).digest("hex").slice(0, 32)}`;
}

function normalizedHistoryKey(value) {
  return text(value).toLowerCase().replaceAll(/\s+/g, " ");
}

function disputeOrderHistoryKey(input = {}) {
  const channel = normalizedHistoryKey(input.channel);
  const channelOrderNumber = normalizedHistoryKey(input.channelOrderNumber);
  if (channel && channelOrderNumber) return `${channel}|${channelOrderNumber}`;
  const orderId = normalizedHistoryKey(input.orderId || input.orderNumber || input.inputReference);
  return orderId ? `dataplus|${orderId}` : "";
}

function disputeShipmentHistoryKey(orderKey, input = {}) {
  const trackingNumber = normalizedHistoryKey(input.trackingNumber);
  const shipmentId = normalizedHistoryKey(input.shipmentId);
  return `${text(orderKey)}|${trackingNumber ? `tracking:${trackingNumber}` : shipmentId ? `shipment:${shipmentId}` : "order"}`;
}

function chargeTransactionSignature(evidence = {}, transaction = {}) {
  const money = (value) => value === null || value === undefined || value === "" ? "" : Number(value).toFixed(4);
  return [
    normalizedHistoryKey(evidence.sourceReport || "temu_transaction_report"),
    normalizedHistoryKey(evidence.transactionType || "shipping label purchase adjustment"),
    normalizedHistoryKey(evidence.reference),
    normalizedHistoryKey(transaction.date),
    normalizedHistoryKey(transaction.relatedId),
    money(transaction.signedAmount),
    money(transaction.total),
    text(transaction.currency || evidence.currency || "USD").toUpperCase(),
  ].join("\u001f");
}

function chargeTransactionsWithFingerprints(evidence = {}) {
  const occurrences = new Map();
  return (Array.isArray(evidence.transactions) ? evidence.transactions : []).map((transaction) => {
    const signature = chargeTransactionSignature(evidence, transaction);
    const occurrence = (occurrences.get(signature) || 0) + 1;
    occurrences.set(signature, occurrence);
    return {
      ...transaction,
      fingerprint: crypto.createHash("md5").update(`${signature}\u001f${occurrence}`).digest("hex"),
      occurrence,
    };
  });
}

function historyClassificationLabel(value) {
  if (value === "exact_duplicate") return "Exact charge already imported";
  if (value === "previous_order_new_charge") return "New charge on a previously disputed order";
  if (value === "previous_order") return "Order already belongs to a previous dispute";
  return "New dispute order";
}

function normalizeReferenceEvidence(input = []) {
  const rows = Array.isArray(input)
    ? input
    : Object.entries(object(input)).map(([reference, evidence]) => ({ reference, ...object(evidence) }));
  const evidenceByReference = new Map();
  for (const row of rows) {
    const source = object(row);
    if (text(source.transactionType).toLowerCase() !== "shipping label purchase adjustment") continue;
    const reference = text(source.reference || source.orderId || source.orderNumber);
    if (!reference) continue;
    const transactions = (Array.isArray(source.transactions) ? source.transactions : []).map((transaction, index) => {
      const value = object(transaction);
      return {
        rowNumber: Math.max(0, Number(value.rowNumber || index + 1) || 0),
        date: text(value.date),
        relatedId: text(value.relatedId),
        signedAmount: numberOrNull(value.signedAmount ?? value.amount),
        total: numberOrNull(value.total),
        currency: text(value.currency || source.currency || "USD"),
      };
    }).filter((transaction) => transaction.signedAmount !== null && transaction.signedAmount < 0);
    if (!transactions.length) continue;
    const transactionTotal = transactions.reduce((sum, transaction) => sum + Number(transaction.signedAmount || 0), 0);
    const signedAmount = roundMoney(transactionTotal);
    const transactionDates = transactions.map((transaction) => transaction.date).filter(Boolean).sort();
    const relatedIds = [...new Set(transactions.map((transaction) => transaction.relatedId).map(text).filter(Boolean))];
    evidenceByReference.set(reference.toLowerCase(), {
      sourceReport: text(source.sourceReport || "temu_transaction_report"),
      transactionType: text(source.transactionType || "Shipping label purchase adjustment"),
      reference,
      signedAmount,
      expenseAmount: roundMoney(-signedAmount),
      currency: text(source.currency || transactions.find((transaction) => transaction.currency)?.currency || "USD"),
      transactionCount: transactions.length,
      chargeCount: transactions.length,
      firstDate: transactionDates[0] || "",
      lastDate: transactionDates.at(-1) || "",
      relatedIds,
      transactions,
    });
  }
  return evidenceByReference;
}

function batchRow(row = {}) {
  return {
    id: row.batch_id,
    batchId: row.batch_id,
    batchNumber: Number(row.batch_number || 0),
    displayId: row.batch_number ? `SD-${String(row.batch_number).padStart(5, "0")}` : "Shipping dispute",
    name: row.name || "",
    status: row.status || "draft",
    sourceFileName: row.source_file_name || "",
    totalItems: Number(row.total_items || 0),
    matchedItems: Number(row.matched_items || 0),
    quotedItems: Number(row.quoted_items || 0),
    failedItems: Number(row.failed_items || 0),
    createdBy: row.created_by || "",
    createdByName: row.created_by_name || "",
    notes: row.notes || "",
    lastQuotedAt: timestamp(row.last_quoted_at),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    raw: object(row.raw),
  };
}

function itemRow(row = {}) {
  const raw = object(row.raw);
  const currentQuoteEvidence = quoteEvidenceIsCurrent(row, raw);
  const disputeHistory = object(raw.disputeHistory);
  const reusedQuote = object(disputeHistory.reusedQuote);
  const reusedRates = Array.isArray(reusedQuote.quotes) ? reusedQuote.quotes : [];
  const orderLines = (Array.isArray(raw.orderLines) ? raw.orderLines : []).map((line) => ({
    id: text(line.id),
    lineIndex: Math.max(0, Number(line.lineIndex || 0)),
    sku: text(line.sku),
    mappedSku: text(line.mappedSku),
    originalSku: text(line.originalSku),
    catalogSku: text(line.catalogSku),
    title: text(line.title),
    image: text(line.image),
    brand: text(line.brand),
    supplier: text(line.supplier),
    quantity: numberOrNull(line.quantity),
  }));
  const skus = [...new Set((Array.isArray(raw.skus) ? raw.skus : orderLines.flatMap((line) => [line.mappedSku, line.sku, line.originalSku])).map(text).filter(Boolean))];
  const destination = {
    ...object(row.destination_address),
    city: row.destination_city || "",
    state: row.destination_state || "",
    postalCode: row.destination_postal_code || "",
    country: row.destination_country || "",
  };
  return {
    id: row.item_id,
    itemId: row.item_id,
    batchId: row.batch_id,
    inputReference: row.input_reference || "",
    inputPosition: Number(row.input_position || 0),
    matchStatus: row.match_status || "unmatched",
    status: row.status || "needs_review",
    orderId: row.order_id || "",
    shipmentId: row.shipment_id || "",
    orderNumber: row.order_number || "",
    channel: row.channel || "",
    channelOrderNumber: row.channel_order_number || "",
    trackingNumber: row.tracking_number || "",
    orderDate: timestamp(raw.orderDate || row.source_order_date || row.source_raw_order_date || row.source_order_created_at),
    shipDate: timestamp(raw.shipDate || row.source_shipped_at || row.source_raw_ship_date),
    warehouseId: row.warehouse_id || "",
    destination,
    addressQuoteBasis: destinationQuoteBasis(destination),
    package: {
      type: row.package_type || "box",
      weight: numberOrNull(row.package_weight),
      length: numberOrNull(row.package_length),
      width: numberOrNull(row.package_width),
      height: numberOrNull(row.package_height),
      weightUnit: row.weight_unit || "lb",
      dimensionUnit: row.dimension_unit || "in",
      source: row.package_measurement_source || "",
    },
    originalLabelCost: numberOrNull(row.original_label_cost),
    finalBilledCost: numberOrNull(row.final_billed_cost),
    billingDifference: numberOrNull(row.billing_difference),
    settlementId: row.settlement_id || "",
    settlementLineId: row.settlement_line_id || "",
    carrierInvoiceNumber: row.carrier_invoice_number || "",
    carrierBilledPackage: {
      weight: numberOrNull(row.carrier_billed_weight),
      length: numberOrNull(row.carrier_billed_length),
      width: numberOrNull(row.carrier_billed_width),
      height: numberOrNull(row.carrier_billed_height),
    },
    reviewReason: row.review_reason || "",
    quotedAt: timestamp(row.quoted_at),
    latestRun: currentQuoteEvidence ? {
      id: row.latest_run_id,
      status: row.latest_run_status || "",
      requestedAt: timestamp(row.latest_run_requested_at),
      completedAt: timestamp(row.latest_run_completed_at),
      requestSnapshot: object(row.latest_run_request_snapshot),
      providerStatus: object(row.latest_run_provider_status),
      error: row.latest_run_error || "",
      reused: false,
    } : reusedRates.length ? {
      id: text(reusedQuote.runId),
      status: text(reusedQuote.status || "complete"),
      requestedAt: timestamp(reusedQuote.requestedAt),
      completedAt: timestamp(reusedQuote.completedAt),
      requestSnapshot: object(reusedQuote.requestSnapshot),
      providerStatus: object(reusedQuote.providerStatus),
      error: text(reusedQuote.error),
      reused: true,
      sourceBatchId: text(reusedQuote.sourceBatchId),
      sourceBatchDisplayId: text(reusedQuote.sourceBatchDisplayId),
    } : null,
    quotes: currentQuoteEvidence && Array.isArray(row.quotes) ? row.quotes.map((quote) => ({
      rank: Number(quote.rank || 0),
      provider: quote.provider || "",
      carrier: quote.carrier || "",
      service: quote.service || "",
      amount: Number(quote.amount || 0),
      currency: quote.currency || "USD",
      deliveryDays: numberOrNull(quote.delivery_days),
      deliveryEstimate: quote.delivery_estimate || "",
      rateId: quote.rate_id || "",
      quotedAt: timestamp(quote.quoted_at),
      expiresAt: timestamp(quote.expires_at),
    })) : reusedRates.map((quote) => ({
      rank: Number(quote.rank || 0),
      provider: text(quote.provider),
      carrier: text(quote.carrier),
      service: text(quote.service),
      amount: Number(quote.amount || 0),
      currency: text(quote.currency || "USD"),
      deliveryDays: numberOrNull(quote.deliveryDays),
      deliveryEstimate: text(quote.deliveryEstimate),
      rateId: text(quote.rateId),
      quotedAt: timestamp(quote.quotedAt),
      expiresAt: timestamp(quote.expiresAt),
    })),
    adjustmentEvidence: Object.keys(object(raw.importEvidence)).length ? object(raw.importEvidence) : null,
    disputeHistory,
    orderLines,
    skus,
    raw,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

function orderLinesForDispute(rows = [], raw = {}) {
  const rawLines = [raw.lineItems, raw.items, raw.lines, raw.orderLines].find(Array.isArray) || [];
  const source = rows.length ? rows : rawLines;
  return source.map((line, index) => {
    const value = object(line);
    const lineRaw = object(value.raw);
    const images = Array.isArray(value.images) ? value.images : Array.isArray(lineRaw.images) ? lineRaw.images : [];
    const image = images.find((entry) => typeof entry === "string") || object(images[0]).url || object(images[0]).src;
    return {
      id: text(value.line_id || value.lineId || value.id),
      lineIndex: Math.max(0, Number(value.line_index ?? value.lineIndex ?? index) || 0),
      sku: text(value.sku || value.itemSku || value.sellerSku),
      mappedSku: text(value.mapped_sku || value.mappedSku || value.catalogSku),
      originalSku: text(value.original_sku || value.originalSku || value.channelSku),
      catalogSku: text(value.catalog_sku || value.catalogSku || lineRaw.catalogSku),
      title: text(value.title || value.name || value.productName || lineRaw.title || lineRaw.name),
      image: text(value.image || value.imageUrl || value.productImage || value.thumbnail || value.default_image || value.defaultImage || lineRaw.image || lineRaw.imageUrl || lineRaw.productImage || lineRaw.thumbnail || lineRaw.defaultImage || image),
      brand: text(value.brand || value.productBrand || lineRaw.brand || lineRaw.productBrand),
      supplier: text(value.supplier || value.vendor || value.supplierName || lineRaw.supplier || lineRaw.vendor || lineRaw.supplierName),
      quantity: numberOrNull(value.qty ?? value.quantity),
    };
  }).filter((line) => line.sku || line.mappedSku || line.originalSku || line.title);
}

function orderLineProductKeys(line = {}) {
  return [...new Set([line.catalogSku, line.mappedSku, line.sku, line.originalSku].map((value) => text(value).toLowerCase()).filter(Boolean))];
}

function productImage(metadata = {}) {
  const raw = object(metadata.raw);
  const images = Array.isArray(raw.images) ? raw.images : [];
  return text(metadata.default_image || raw.defaultImage || raw.imageUrl || raw.image || images.find((entry) => typeof entry === "string") || object(images[0]).url || object(images[0]).src);
}

function enrichOrderLinesWithProducts(lines = [], productsByKey = new Map()) {
  return lines.map((line) => {
    const product = orderLineProductKeys(line).map((key) => productsByKey.get(key)).find(Boolean) || {};
    return {
      ...line,
      catalogSku: text(line.catalogSku || product.sku),
      title: text(line.title || product.marketplace_title || product.title),
      image: text(line.image || productImage(product)),
      brand: text(line.brand || product.brand),
      supplier: text(line.supplier || product.supplier),
    };
  });
}

async function productMetadataForOrderLines(client, lines = []) {
  const keys = [...new Set(lines.flatMap(orderLineProductKeys))];
  if (!keys.length) return new Map();
  const products = new Map();
  for (const keyChunk of chunks(keys)) {
    const result = await client.query(`
      with requested(key) as (select distinct unnest($1::text[])), candidates as (
        select requested.key,1 as priority,product.product_id,product.sku,product.title,product.marketplace_title,
          product.brand,product.supplier,product.default_image,product.raw
        from requested join products product on lower(product.sku)=requested.key
        union all
        select requested.key,2 as priority,product.product_id,product.sku,product.title,product.marketplace_title,
          product.brand,product.supplier,product.default_image,product.raw
        from requested join products product on lower(product.product_id)=requested.key
        union all
        select requested.key,3 as priority,product.product_id,product.sku,product.title,product.marketplace_title,
          product.brand,product.supplier,product.default_image,product.raw
        from requested
        join product_aliases alias on lower(alias.alias_sku)=requested.key and alias.active=true
        join products product on product.product_id=alias.product_id
      )
      select distinct on (key) key,product_id,sku,title,marketplace_title,brand,supplier,default_image,raw
      from candidates order by key,priority,product_id
    `, [keyChunk]);
    for (const row of result.rows) products.set(text(row.key).toLowerCase(), row);
  }
  return products;
}

function positiveNumber(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return 0;
}

function productPackageMeasurements(metadataValue = {}) {
  const metadata = object(metadataValue);
  const product = { ...object(metadata.raw), ...metadata };
  const packageDimensions = [
    [product.packageLength, product.packageWidth, product.packageHeight],
    [product.package_length, product.package_width, product.package_height],
  ].map((values) => values.map(Number)).find((values) => values.every((value) => Number.isFinite(value) && value > 0));
  const packageWeight = positiveNumber(product.packageWeight, product.package_weight);
  const usePackageOverride = product.shippingPackageOverride === true
    || (product.shippingPackageOverride === undefined && product.packageDimensionsLocked === true);
  const itemMeasurements = fulfillmentItemMeasurements(product);
  const dimensions = usePackageOverride
    ? packageDimensions
    : itemMeasurements.dimensions
      ? [itemMeasurements.dimensions.length, itemMeasurements.dimensions.width, itemMeasurements.dimensions.height]
      : packageDimensions;
  const weight = usePackageOverride ? packageWeight : positiveNumber(itemMeasurements.weight, packageWeight);
  if (!dimensions || !weight) return null;
  return { length: dimensions[0], width: dimensions[1], height: dimensions[2], weight };
}

function bundledDimensions(measurements, quantity = 1) {
  const axes = [measurements.length, measurements.width, measurements.height].map(Number).sort((left, right) => right - left);
  axes[2] *= Math.max(1, Number(quantity || 0) || 1);
  axes.sort((left, right) => right - left);
  return { length: axes[0], width: axes[1], height: axes[2] };
}

function catalogQuotePackage(lines = [], productsByKey = new Map()) {
  const packages = lines.map((line) => {
    const metadata = orderLineProductKeys(line).map((key) => productsByKey.get(key)).find(Boolean);
    const measurements = productPackageMeasurements(metadata);
    if (!measurements) return null;
    const quantity = Math.max(1, Number(line.quantity || 0) || 1);
    return {
      sku: text(object(metadata).sku || line.catalogSku || line.mappedSku || line.sku || line.originalSku),
      quantity,
      weight: measurements.weight * quantity,
      dimensions: bundledDimensions(measurements, quantity),
    };
  });
  if (!packages.length || packages.some((entry) => !entry)) return null;
  const packageRows = packages.filter(Boolean);
  const combinedAxes = packageRows.length === 1
    ? [packageRows[0].dimensions.length, packageRows[0].dimensions.width, packageRows[0].dimensions.height]
    : [
      Math.max(...packageRows.map((entry) => entry.dimensions.length)),
      Math.max(...packageRows.map((entry) => entry.dimensions.width)),
      packageRows.reduce((sum, entry) => sum + entry.dimensions.height, 0),
    ];
  combinedAxes.sort((left, right) => right - left);
  const dimensions = { length: combinedAxes[0], width: combinedAxes[1], height: combinedAxes[2] };
  const productSkus = [...new Set(packageRows.map((entry) => entry.sku).filter(Boolean))];
  const isExactSingleSellUnit = packageRows.length === 1 && packageRows[0].quantity === 1;
  const parcel = {
    type: "box",
    weight: Number(packageRows.reduce((sum, entry) => sum + entry.weight, 0).toFixed(3)),
    length: Number(dimensions.length.toFixed(3)),
    width: Number(dimensions.width.toFixed(3)),
    height: Number(dimensions.height.toFixed(3)),
    weightUnit: "lb",
    dimensionUnit: "in",
    source: isExactSingleSellUnit ? "current_catalog_sku" : "current_catalog_order_estimate",
  };
  return {
    parcel,
    detailSource: isExactSingleSellUnit ? "stored_sku_package" : "combined_stored_sku_packages",
    inferred: !isExactSingleSellUnit,
    productSkus,
  };
}

function disputeSkus(lines = []) {
  return [...new Set(lines.flatMap((line) => [line.mappedSku, line.sku, line.originalSku]).map(text).filter(Boolean))];
}

function addressFromOrder(raw = {}) {
  const address = object(raw.shippingAddress || raw.address || raw.deliveryAddress || raw.shipTo || raw.customer?.shippingAddress);
  return {
    name: text(address.name || address.fullName || raw.buyer || raw.customerName),
    company: text(address.company || address.companyName),
    phone: text(address.phone || raw.phone),
    email: text(address.email || raw.buyerEmail),
    line1: text(address.line1 || address.address1 || address.addressLine1 || address.street1),
    line2: text(address.line2 || address.address2 || address.addressLine2 || address.street2),
    city: text(address.city || address.town),
    state: text(address.state || address.province || address.stateProvinceCode),
    postalCode: text(address.postalCode || address.postcode || address.zip || address.zipCode),
    country: text(address.country || address.countryCode || "US"),
  };
}

function packageFromSources(primary = {}, secondary = {}) {
  const first = object(primary);
  const second = object(secondary);
  const value = (...keys) => {
    for (const key of keys) {
      const candidate = first[key] ?? second[key];
      if (candidate !== undefined && candidate !== null && candidate !== "") return candidate;
    }
    return null;
  };
  return {
    type: text(value("package_type", "packageType", "type") || "box"),
    weight: numberOrNull(value("package_weight", "packageWeight", "weight", "weightPounds")),
    length: numberOrNull(value("package_length", "packageLength", "length", "lengthInches")),
    width: numberOrNull(value("package_width", "packageWidth", "width", "widthInches")),
    height: numberOrNull(value("package_height", "packageHeight", "height", "heightInches")),
    weightUnit: text(value("weight_unit", "weightUnit") || "lb"),
    dimensionUnit: text(value("dimension_unit", "dimensionUnit") || "in"),
    source: text(value("package_measurement_source", "packageMeasurementSource", "source")),
  };
}

function completePackage(parcel = {}) {
  return [parcel.weight, parcel.length, parcel.width, parcel.height].every((value) => Number(value) > 0);
}

function sameQuotePackage(left = {}, right = {}) {
  const equivalentNumber = (first, second) => Math.abs(Number(first || 0) - Number(second || 0)) < 0.001;
  return text(left.type || "box").toLowerCase() === text(right.type || "box").toLowerCase()
    && equivalentNumber(left.weight, right.weight)
    && equivalentNumber(left.length, right.length)
    && equivalentNumber(left.width, right.width)
    && equivalentNumber(left.height, right.height)
    && text(left.weightUnit || "lb").toLowerCase() === text(right.weightUnit || "lb").toLowerCase()
    && text(left.dimensionUnit || "in").toLowerCase() === text(right.dimensionUnit || "in").toLowerCase()
    && text(left.source).toLowerCase() === text(right.source).toLowerCase();
}

function completeDestination(address = {}) {
  return Boolean(address.line1 && address.city && address.state && address.postalCode && address.country);
}

function postalDestination(address = {}) {
  return Boolean(address.postalCode && address.country);
}

function destinationQuoteBasis(address = {}) {
  if (completeDestination(address)) return "full_address";
  if (postalDestination(address)) return "postal_code";
  return "missing";
}

function itemStatus(matchStatus, parcel, address) {
  if (matchStatus !== "matched") return matchStatus;
  if (!completePackage(parcel)) return "needs_package_data";
  if (!postalDestination(address)) return "needs_address_review";
  return "ready_to_quote";
}

function selectLowestRates(rates = [], limit = 5) {
  const selected = [];
  const seen = new Set();
  const maximum = Math.max(1, Math.min(5, Number(limit || 5)));
  for (const rate of [...rates].sort((left, right) => Number(left.amount || 0) - Number(right.amount || 0))) {
    const amount = Number(rate.amount);
    if (!(amount > 0)) continue;
    const key = [text(rate.provider).toLowerCase(), text(rate.carrier).toLowerCase(), text(rate.service).toLowerCase(), amount.toFixed(4)].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(rate);
    if (selected.length === maximum) break;
  }
  return selected;
}

function createShippingDisputeStore(poolGetter, options = {}) {
  const ensureSchema = options.ensureSchema || (async () => {});
  const historyBackfilledScopes = new Set();
  const pool = () => {
    const client = poolGetter();
    if (!client) throw Object.assign(new Error("Shipping disputes require PostgreSQL."), { status: 503 });
    return client;
  };

  async function syncShipmentHistoryForItem(client, itemIds) {
    const ids = (Array.isArray(itemIds) ? itemIds : [itemIds]).map(text).filter(Boolean);
    if (!ids.length) return;
    await client.query(`insert into shipping_dispute_shipment_history (
        history_id,tenant_id,company_id,order_key,shipment_key,batch_id,batch_number,item_id,source_file_name,
        input_reference,order_id,shipment_id,order_number,channel,channel_order_number,tracking_number,
        destination_snapshot,package_snapshot,quote_snapshot,status,created_at,updated_at
      )
      select item.item_id,batch.tenant_id,batch.company_id,
        case
          when nullif(trim(item.channel),'') is not null and nullif(trim(item.channel_order_number),'') is not null
            then lower(trim(item.channel)) || '|' || lower(trim(item.channel_order_number))
          else 'dataplus|' || lower(trim(coalesce(nullif(item.order_id,''),nullif(item.order_number,''),item.input_reference)))
        end as order_key,
        (case
          when nullif(trim(item.channel),'') is not null and nullif(trim(item.channel_order_number),'') is not null
            then lower(trim(item.channel)) || '|' || lower(trim(item.channel_order_number))
          else 'dataplus|' || lower(trim(coalesce(nullif(item.order_id,''),nullif(item.order_number,''),item.input_reference)))
        end) || '|' || case
          when nullif(trim(item.tracking_number),'') is not null then 'tracking:' || lower(trim(item.tracking_number))
          when nullif(trim(item.shipment_id),'') is not null then 'shipment:' || lower(trim(item.shipment_id))
          else 'order'
        end as shipment_key,
        batch.batch_id,batch.batch_number,item.item_id,batch.source_file_name,item.input_reference,item.order_id,item.shipment_id,
        item.order_number,item.channel,item.channel_order_number,item.tracking_number,
        coalesce(item.destination_address,'{}'::jsonb) || jsonb_build_object(
          'city',coalesce(item.destination_city,''),'state',coalesce(item.destination_state,''),
          'postalCode',coalesce(item.destination_postal_code,''),'country',coalesce(item.destination_country,'')),
        jsonb_build_object('type',coalesce(item.package_type,'box'),'weight',item.package_weight,'length',item.package_length,
          'width',item.package_width,'height',item.package_height,'weightUnit',coalesce(item.weight_unit,'lb'),
          'dimensionUnit',coalesce(item.dimension_unit,'in'),'source',coalesce(item.package_measurement_source,'')),
        case when latest.run_id is null then coalesce(item.raw#>'{disputeHistory,reusedQuote}','{}'::jsonb) else jsonb_build_object(
          'runId',latest.run_id,'status',latest.status,'requestedAt',latest.requested_at,'completedAt',latest.completed_at,
          'requestSnapshot',coalesce(latest.request_snapshot,'{}'::jsonb),'providerStatus',coalesce(latest.provider_status,'{}'::jsonb),
          'error',coalesce(latest.error_message,''),'sourceBatchId',batch.batch_id,
          'sourceBatchDisplayId','SD-' || lpad(batch.batch_number::text,5,'0'),'quotes',coalesce(quotes.rows,'[]'::jsonb)) end,
        item.status,item.created_at,now()
      from shipping_dispute_items item
      join shipping_dispute_batches batch on batch.batch_id=item.batch_id
      left join lateral (
        select * from shipping_dispute_quote_runs run where run.item_id=item.item_id
        order by exists(select 1 from shipping_dispute_quotes saved where saved.run_id=run.run_id) desc,
          run.requested_at desc,run.created_at desc limit 1
      ) latest on true
      left join lateral (
        select jsonb_agg(jsonb_build_object(
          'rank',quote.rank,'provider',quote.provider,'carrier',quote.carrier,'service',quote.service,'amount',quote.amount,
          'currency',quote.currency,'deliveryDays',quote.delivery_days,'deliveryEstimate',quote.delivery_estimate,
          'rateId',quote.rate_id,'quotedAt',quote.quoted_at,'expiresAt',quote.expires_at
        ) order by quote.rank) as rows from shipping_dispute_quotes quote where quote.run_id=latest.run_id
      ) quotes on true
      where item.item_id=any($1::text[])
      on conflict (tenant_id,company_id,item_id) do update set
        order_key=excluded.order_key,shipment_key=excluded.shipment_key,source_file_name=excluded.source_file_name,
        input_reference=excluded.input_reference,order_id=excluded.order_id,shipment_id=excluded.shipment_id,
        order_number=excluded.order_number,channel=excluded.channel,channel_order_number=excluded.channel_order_number,
        tracking_number=excluded.tracking_number,destination_snapshot=excluded.destination_snapshot,
        package_snapshot=excluded.package_snapshot,quote_snapshot=excluded.quote_snapshot,status=excluded.status,updated_at=now()`, [ids]);
  }

  async function backfillExistingDisputeHistory(client, scope = {}) {
    const tenantId = text(scope.tenantId);
    const companyId = text(scope.companyId);
    const items = (await client.query(`select item.item_id from shipping_dispute_items item
      join shipping_dispute_batches batch on batch.batch_id=item.batch_id
      left join shipping_dispute_shipment_history history
        on history.tenant_id=batch.tenant_id and history.company_id=batch.company_id and history.item_id=item.item_id
      where batch.tenant_id=$1 and batch.company_id=$2 and history.item_id is null
      order by item.created_at,item.item_id`, [tenantId, companyId])).rows;
    for (const itemChunk of chunks(items.map((row) => row.item_id), DISPUTE_INSERT_CHUNK_SIZE)) await syncShipmentHistoryForItem(client, itemChunk);

    const evidenceRows = (await client.query(`select distinct on (item.batch_id,lower(item.input_reference))
        item.batch_id,batch.batch_number,item.item_id,item.input_reference,item.raw
      from shipping_dispute_items item
      join shipping_dispute_batches batch on batch.batch_id=item.batch_id
      where batch.tenant_id=$1 and batch.company_id=$2 and item.raw ? 'importEvidence'
      order by item.batch_id,lower(item.input_reference),item.created_at,item.item_id`, [tenantId, companyId])).rows;
    const records = [];
    for (const row of evidenceRows) {
      const evidence = object(object(row.raw).importEvidence);
      for (const transaction of chargeTransactionsWithFingerprints(evidence)) records.push({
        tenant_id: tenantId, company_id: companyId, charge_fingerprint: transaction.fingerprint,
        source_report: text(evidence.sourceReport), transaction_type: text(evidence.transactionType),
        input_reference: text(evidence.reference || row.input_reference), transaction_date: text(transaction.date),
        related_id: text(transaction.relatedId), signed_amount: numberOrNull(transaction.signedAmount),
        total_amount: numberOrNull(transaction.total), currency: text(transaction.currency || evidence.currency || 'USD'),
        first_batch_id: row.batch_id, first_batch_number: Number(row.batch_number || 0), first_item_id: row.item_id,
        last_batch_id: row.batch_id, last_item_id: row.item_id, raw: transaction,
      });
    }
    for (const recordChunk of chunks(records, DISPUTE_INSERT_CHUNK_SIZE)) {
      await client.query(`insert into shipping_dispute_charge_history (
          tenant_id,company_id,charge_fingerprint,source_report,transaction_type,input_reference,transaction_date,
          related_id,signed_amount,total_amount,currency,first_batch_id,first_batch_number,first_item_id,last_batch_id,last_item_id,raw
        ) select tenant_id,company_id,charge_fingerprint,source_report,transaction_type,input_reference,transaction_date,
          related_id,signed_amount,total_amount,currency,first_batch_id,first_batch_number,first_item_id,last_batch_id,last_item_id,raw
        from jsonb_to_recordset($1::jsonb) as record(
          tenant_id text,company_id text,charge_fingerprint text,source_report text,transaction_type text,input_reference text,
          transaction_date text,related_id text,signed_amount numeric,total_amount numeric,currency text,first_batch_id text,
          first_batch_number bigint,first_item_id text,last_batch_id text,last_item_id text,raw jsonb
        ) on conflict (tenant_id,company_id,charge_fingerprint) do nothing`, [JSON.stringify(recordChunk)]);
    }
  }

  async function ensureExistingDisputeHistory(scope = {}) {
    const scopeKey = `${text(scope.tenantId)}:${text(scope.companyId)}`;
    if (historyBackfilledScopes.has(scopeKey)) return;
    const client = await pool().connect();
    try {
      await client.query("begin");
      await backfillExistingDisputeHistory(client, scope);
      await client.query("commit");
      historyBackfilledScopes.add(scopeKey);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  function reusableHistoryQuote(history = {}, parcel = {}, destination = {}) {
    const quote = object(history.quote_snapshot);
    const snapshot = object(quote.requestSnapshot);
    const quotedPackage = object(snapshot.package);
    const quotedDestination = object(snapshot.destination);
    const rates = Array.isArray(quote.quotes) ? quote.quotes : [];
    if (!rates.length || !sameQuotePackage({ ...parcel, source: "" }, { ...quotedPackage, source: "" })) return null;
    const postalMatches = normalizedPostalSuggestion(destination.postalCode, destination.country)
      === normalizedPostalSuggestion(quotedDestination.postalCode, quotedDestination.country);
    const countryMatches = text(destination.country || 'US').toUpperCase() === text(quotedDestination.country || 'US').toUpperCase();
    if (!postalMatches || !countryMatches) return null;
    return quote;
  }

  async function refreshBatch(batchId, client = pool()) {
    const counts = (await client.query(`
      select count(*)::int as total,
        count(*) filter (where match_status='matched')::int as matched,
        count(*) filter (where status='quoted')::int as quoted,
        count(*) filter (where status='quoting')::int as quoting,
        count(*) filter (where status='quote_failed')::int as failed,
        count(*) filter (where status='previously_disputed')::int as prior,
        count(*) filter (where status in ('unmatched','ambiguous','needs_package_data','needs_address_review'))::int as review
      from shipping_dispute_items where batch_id=$1
    `, [batchId])).rows[0] || {};
    const total = Number(counts.total || 0), quoted = Number(counts.quoted || 0), quoting = Number(counts.quoting || 0), failed = Number(counts.failed || 0), prior = Number(counts.prior || 0), review = Number(counts.review || 0);
    const status = quoting > 0
      ? "quoting"
      : (quoted || prior) && quoted + prior + failed + review >= total
        ? (failed || review ? "partial" : "ready")
        : review ? "needs_review" : "ready_to_quote";
    const result = await client.query(`update shipping_dispute_batches set
      total_items=$2,matched_items=$3,quoted_items=$4,failed_items=$5,status=$6,updated_at=now()
      where batch_id=$1 returning *`, [batchId, total, Number(counts.matched || 0), quoted, failed, status]);
    return result.rows[0];
  }

  async function recoverStaleQuoting(scope = {}, batchId) {
    await ensureSchema();
    const client = await pool().connect();
    try {
      await client.query("begin");
      const batch = (await client.query(`select status from shipping_dispute_batches
        where batch_id=$1 and tenant_id=$2 and company_id=$3 for update`, [batchId, text(scope.tenantId), text(scope.companyId)])).rows[0];
      if (!batch || batch.status !== "quoting") {
        await client.query("commit");
        return null;
      }
      const active = (await client.query(`select exists (
        select 1 from operations_jobs
        where lower(status) in ('queued','running')
          and coalesce(raw->>'workerTask','')='shipping-dispute-quotes'
          and coalesce(raw->'workerPayload'->>'batchId','')=$1
      ) as active`, [batchId])).rows[0]?.active;
      if (active) {
        await client.query("commit");
        return null;
      }
      await client.query(`update shipping_dispute_quote_runs run set
        status='failed',completed_at=now(),error_message=coalesce(nullif(error_message,''),'The quote job ended before this shipment completed.')
        from shipping_dispute_items item where run.item_id=item.item_id and item.batch_id=$1 and run.status='running'`, [batchId]);
      await client.query(`update shipping_dispute_items set
        status=case
          when match_status<>'matched' then match_status
          when package_weight is null or package_weight<=0 or package_length is null or package_length<=0
            or package_width is null or package_width<=0 or package_height is null or package_height<=0 then 'needs_package_data'
          when nullif(destination_postal_code,'') is null or nullif(destination_country,'') is null then 'needs_address_review'
          else 'ready_to_quote'
        end,
        review_reason=case
          when match_status='matched' and (package_weight is null or package_weight<=0 or package_length is null or package_length<=0
            or package_width is null or package_width<=0 or package_height is null or package_height<=0) then 'Current catalog SKU dimensions or weight are incomplete.'
          when match_status='matched' and (nullif(destination_postal_code,'') is null or nullif(destination_country,'') is null) then 'A destination ZIP or postal code is required.'
          else null
        end,
        updated_at=now()
        where batch_id=$1 and status='quoting'`, [batchId]);
      const refreshed = await refreshBatch(batchId, client);
      await client.query("commit");
      return refreshed;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function createBatch(scope = {}, input = {}, actor = {}) {
    await ensureSchema();
    let references = [...new Map((Array.isArray(input.references) ? input.references : [])
      .map((value) => text(value))
      .filter(Boolean)
      .map((value) => [value.toLowerCase(), value])).values()];
    const referenceEvidence = normalizeReferenceEvidence(input.referenceEvidence);
    const requestedImportMeta = object(input.importMeta);
    const isTemuChargeImport = text(requestedImportMeta.importType) === "temu_shipping_label_purchase_adjustment";
    if (isTemuChargeImport) {
      references = [...referenceEvidence.values()].map((evidence) => evidence.reference);
      if (!references.length) throw Object.assign(new Error("This Temu report does not contain any additional shipping charges. Only negative Shipping label purchase adjustment rows are eligible."), { status: 400 });
    }
    if (!references.length) throw Object.assign(new Error("Paste or upload at least one DataPlus or channel order number."), { status: 400 });
    if (references.length > DISPUTE_REFERENCE_LIMIT) throw Object.assign(new Error(`One dispute can contain at most ${DISPUTE_REFERENCE_LIMIT.toLocaleString()} unique order references.`), { status: 400 });
    const acceptedEvidence = [...referenceEvidence.values()];
    const acceptedTransactions = acceptedEvidence.flatMap((evidence) => evidence.transactions);
    const acceptedSignedAmount = roundMoney(acceptedEvidence.reduce((sum, evidence) => sum + evidence.signedAmount, 0));
    const requestedSummary = object(requestedImportMeta.summary);
    const normalizedSummary = isTemuChargeImport ? {
      transactionCount: acceptedTransactions.length,
      chargeCount: acceptedTransactions.length,
      orderCount: acceptedEvidence.length,
      ignoredRows: Math.max(0, Number(requestedSummary.ignoredRows || 0)),
      invalidRows: Math.max(0, Number(requestedSummary.invalidRows || 0)),
      signedAmount: acceptedSignedAmount,
      expenseAmount: roundMoney(-acceptedSignedAmount),
      firstDate: acceptedTransactions.map((transaction) => transaction.date).filter(Boolean).sort()[0] || "",
      lastDate: acceptedTransactions.map((transaction) => transaction.date).filter(Boolean).sort().at(-1) || "",
      currency: text(acceptedEvidence.find((evidence) => evidence.currency)?.currency || "USD"),
    } : requestedSummary;
    const batchRaw = {
      referenceCount: references.length,
      importType: text(requestedImportMeta.importType),
      importGroupId: text(requestedImportMeta.importGroupId),
      sequence: Math.max(0, Number(requestedImportMeta.sequence || 0)),
      totalBatches: Math.max(0, Number(requestedImportMeta.totalBatches || 0)),
      summary: normalizedSummary,
      sourceSummary: object(requestedImportMeta.sourceSummary),
    };
    const client = await pool().connect();
    try {
      await client.query("begin");
      const historyScopeKey = `${text(scope.tenantId)}:${text(scope.companyId)}`;
      if (!historyBackfilledScopes.has(historyScopeKey)) await backfillExistingDisputeHistory(client, scope);
      const importedChargeRecords = acceptedEvidence.flatMap((evidence) => chargeTransactionsWithFingerprints(evidence)
        .map((transaction) => ({ evidence, transaction })));
      const priorChargesByFingerprint = new Map();
      for (const fingerprintChunk of chunks(importedChargeRecords.map((entry) => entry.transaction.fingerprint))) {
        if (!fingerprintChunk.length) continue;
        const rows = (await client.query(`select * from shipping_dispute_charge_history
          where tenant_id=$1 and company_id=$2 and charge_fingerprint=any($3::text[])`, [
          text(scope.tenantId), text(scope.companyId), fingerprintChunk
        ])).rows;
        for (const row of rows) priorChargesByFingerprint.set(row.charge_fingerprint, row);
      }
      const chargeHistoryByReference = new Map();
      for (const evidence of acceptedEvidence) {
        const transactions = chargeTransactionsWithFingerprints(evidence);
        const duplicateTransactions = transactions.filter((transaction) => priorChargesByFingerprint.has(transaction.fingerprint));
        const newTransactions = transactions.filter((transaction) => !priorChargesByFingerprint.has(transaction.fingerprint));
        chargeHistoryByReference.set(evidence.reference.toLowerCase(), { transactions, duplicateTransactions, newTransactions });
      }
      batchRaw.historySummary = {
        newChargeCount: importedChargeRecords.filter((entry) => !priorChargesByFingerprint.has(entry.transaction.fingerprint)).length,
        duplicateChargeCount: importedChargeRecords.filter((entry) => priorChargesByFingerprint.has(entry.transaction.fingerprint)).length,
        newItemCount: 0,
        previousItemCount: 0,
        exactDuplicateItemCount: 0,
        reusedQuoteCount: 0,
      };
      if (isTemuChargeImport) {
        normalizedSummary.newChargeCount = batchRaw.historySummary.newChargeCount;
        normalizedSummary.duplicateChargeCount = batchRaw.historySummary.duplicateChargeCount;
        normalizedSummary.newExpenseAmount = roundMoney(-acceptedEvidence.reduce((sum, evidence) => {
          const history = chargeHistoryByReference.get(evidence.reference.toLowerCase());
          return sum + history.newTransactions.reduce((subtotal, transaction) => subtotal + Number(transaction.signedAmount || 0), 0);
        }, 0));
      }
      const batchId = batchRaw.importGroupId
        ? importBatchId(`${text(scope.tenantId)}:${text(scope.companyId)}:${batchRaw.importGroupId}`, batchRaw.sequence)
        : crypto.randomUUID();
      const batch = (await client.query(`insert into shipping_dispute_batches
        (batch_id,tenant_id,company_id,name,status,source_file_name,created_by,created_by_name,notes,raw)
        values($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9::jsonb)
        on conflict (batch_id) do nothing returning *`, [
        batchId, text(scope.tenantId), text(scope.companyId), text(input.name || "Shipping dispute"),
        text(input.sourceFileName), text(actor.id), text(actor.name), text(input.notes), JSON.stringify(batchRaw)
      ])).rows[0];
      if (!batch) {
        const existing = (await client.query(`select * from shipping_dispute_batches
          where batch_id=$1 and tenant_id=$2 and company_id=$3`, [batchId, text(scope.tenantId), text(scope.companyId)])).rows[0];
        if (!existing) throw Object.assign(new Error("This dispute import is already being created. Retry in a moment."), { status: 409 });
        await client.query("commit");
        historyBackfilledScopes.add(historyScopeKey);
        return { ...batchRow(existing), referenceCount: references.length, reused: true };
      }
      const positions = references.map((_, index) => index);
      const normalizedReferences = references.map((reference) => reference.toLowerCase());
      const referencePositions = new Map(normalizedReferences.map((reference, position) => [reference, position]));
      const matchRowsById = new Map();
      for (const referenceChunk of chunks(normalizedReferences)) {
        const result = await client.query(`
          select order_id,order_number,internal_order_number,marketplace_order_id,source,channel_source,order_date,raw,created_at
          from order_records
          where lower(order_id)=any($1::text[])
             or lower(coalesce(order_number,''))=any($1::text[])
             or lower(coalesce(internal_order_number,''))=any($1::text[])
             or lower(coalesce(marketplace_order_id,''))=any($1::text[])
             or lower(coalesce(raw->>'marketplaceOrderNumber',''))=any($1::text[])
             or lower(coalesce(raw->>'channelOrderNumber',''))=any($1::text[])
             or lower(coalesce(raw->>'externalOrderId',''))=any($1::text[])
             or lower(coalesce(raw->'external'->>'customerOrderId',''))=any($1::text[])
             or lower(coalesce(raw->'external'->>'purchaseOrderId',''))=any($1::text[])
             or lower(coalesce(raw->'external'->>'parentOrderSn',''))=any($1::text[])
          order by created_at desc nulls last,order_id
        `, [referenceChunk]);
        for (const row of result.rows) if (!matchRowsById.has(row.order_id)) matchRowsById.set(row.order_id, row);
      }
      const matchRows = [...matchRowsById.values()];
      const grouped = new Map(positions.map((position) => [position, []]));
      for (const row of matchRows) {
        const raw = object(row.raw);
        const identities = [
          row.order_id, row.order_number, row.internal_order_number, row.marketplace_order_id,
          raw.marketplaceOrderNumber, raw.channelOrderNumber, raw.externalOrderId,
          raw.external?.customerOrderId, raw.external?.purchaseOrderId, raw.external?.parentOrderSn,
        ];
        const matchedPositions = new Set(identities.map((value) => referencePositions.get(text(value).toLowerCase())).filter((position) => position !== undefined));
        for (const position of matchedPositions) grouped.get(position)?.push(row);
      }
      const orderIds = [...new Set([...grouped.values()].filter((rows) => rows.length === 1).map((rows) => rows[0].order_id))];
      const financialRows = [];
      for (const orderIdChunk of chunks(orderIds)) {
        const result = await client.query(`
          select financial.*,
            billed.line_id as settlement_line_id,
            billed.settlement_id as billed_settlement_id,
            billed.billed_weight as carrier_billed_weight,
            billed.billed_length as carrier_billed_length,
            billed.billed_width as carrier_billed_width,
            billed.billed_height as carrier_billed_height,
            settlement.invoice_number as settlement_invoice_number
          from order_shipment_financials financial
          left join lateral (
            select line.* from shipping_settlement_lines line
            where line.order_id=financial.order_id
              and (line.shipment_id=financial.shipment_id
                or (nullif(financial.tracking_number,'') is not null and lower(line.tracking_number)=lower(financial.tracking_number)))
            order by (line.shipment_id=financial.shipment_id) desc,
              (line.billed_weight is not null or line.billed_length is not null) desc,
              line.service_date desc nulls last,line.created_at desc
            limit 1
          ) billed on true
          left join shipping_settlements settlement on settlement.settlement_id=coalesce(nullif(financial.settlement_id,''),billed.settlement_id)
          where financial.order_id=any($1::text[])
          order by financial.order_id,financial.created_at,financial.shipment_id
        `, [orderIdChunk]);
        financialRows.push(...result.rows);
      }
      const financialByOrder = new Map(orderIds.map((id) => [id, []]));
      for (const row of financialRows) financialByOrder.get(row.order_id)?.push(row);
      const orderLineRows = [];
      for (const orderIdChunk of chunks(orderIds)) {
        const result = await client.query(`
          select line_id,order_id,line_index,sku,mapped_sku,original_sku,title,qty,raw
          from order_line_items where order_id=any($1::text[])
          order by order_id,line_index,line_id
        `, [orderIdChunk]);
        orderLineRows.push(...result.rows);
      }
      const orderLinesByOrder = new Map(orderIds.map((id) => [id, []]));
      for (const row of orderLineRows) orderLinesByOrder.get(row.order_id)?.push(row);
      const normalizedLinesByOrder = new Map();
      const matchedOrderIds = new Set(orderIds);
      for (const order of matchRows) {
        if (!matchedOrderIds.has(order.order_id) || normalizedLinesByOrder.has(order.order_id)) continue;
        normalizedLinesByOrder.set(order.order_id, orderLinesForDispute(orderLinesByOrder.get(order.order_id) || [], object(order.raw)));
      }
      const productMetadata = await productMetadataForOrderLines(client, [...normalizedLinesByOrder.values()].flat());
      for (const [orderId, lines] of normalizedLinesByOrder) normalizedLinesByOrder.set(orderId, enrichOrderLinesWithProducts(lines, productMetadata));
      const catalogPackagesByOrder = new Map();
      for (const [orderId, lines] of normalizedLinesByOrder) catalogPackagesByOrder.set(orderId, catalogQuotePackage(lines, productMetadata));

      const orderHistoryKeyByOrderId = new Map();
      for (const rows of grouped.values()) {
        if (rows.length !== 1) continue;
        const order = rows[0];
        const orderRaw = object(order.raw);
        const channelOrderNumber = text(orderRaw.marketplaceOrderNumber || orderRaw.channelOrderNumber || orderRaw.external?.purchaseOrderId || orderRaw.external?.parentOrderSn || order.marketplace_order_id);
        orderHistoryKeyByOrderId.set(order.order_id, disputeOrderHistoryKey({
          channel: text(order.source || order.channel_source || orderRaw.source), channelOrderNumber,
          orderId: order.order_id, orderNumber: order.order_number,
        }));
      }
      const previousHistoryByOrderKey = new Map();
      for (const orderKeyChunk of chunks([...new Set(orderHistoryKeyByOrderId.values())].filter(Boolean))) {
        const rows = (await client.query(`select * from shipping_dispute_shipment_history
          where tenant_id=$1 and company_id=$2 and order_key=any($3::text[])
          order by created_at desc,updated_at desc`, [text(scope.tenantId), text(scope.companyId), orderKeyChunk])).rows;
        for (const row of rows) {
          const entries = previousHistoryByOrderKey.get(row.order_key) || [];
          entries.push(row);
          previousHistoryByOrderKey.set(row.order_key, entries);
        }
      }

      const pendingItems = [];
      const firstItemByReference = new Map();
      const insertedItemIds = [];
      const flushItems = async () => {
        if (!pendingItems.length) return;
        const rows = pendingItems.splice(0, pendingItems.length);
        await client.query(`insert into shipping_dispute_items (
          item_id,batch_id,input_reference,input_position,match_status,status,order_id,shipment_id,order_number,channel,channel_order_number,
          tracking_number,warehouse_id,destination_city,destination_state,destination_postal_code,destination_country,destination_address,
          package_type,package_weight,package_length,package_width,package_height,weight_unit,dimension_unit,package_measurement_source,
          original_label_cost,final_billed_cost,billing_difference,settlement_id,settlement_line_id,carrier_invoice_number,
          carrier_billed_weight,carrier_billed_length,carrier_billed_width,carrier_billed_height,review_reason,raw
        ) select
          item_id,batch_id,input_reference,input_position,match_status,status,order_id,shipment_id,order_number,channel,channel_order_number,
          tracking_number,warehouse_id,destination_city,destination_state,destination_postal_code,destination_country,destination_address,
          package_type,package_weight,package_length,package_width,package_height,weight_unit,dimension_unit,package_measurement_source,
          original_label_cost,final_billed_cost,billing_difference,settlement_id,settlement_line_id,carrier_invoice_number,
          carrier_billed_weight,carrier_billed_length,carrier_billed_width,carrier_billed_height,review_reason,raw
        from jsonb_to_recordset($1::jsonb) as record(
          item_id text,batch_id text,input_reference text,input_position integer,match_status text,status text,order_id text,shipment_id text,
          order_number text,channel text,channel_order_number text,tracking_number text,warehouse_id text,destination_city text,destination_state text,
          destination_postal_code text,destination_country text,destination_address jsonb,package_type text,package_weight numeric,package_length numeric,
          package_width numeric,package_height numeric,weight_unit text,dimension_unit text,package_measurement_source text,original_label_cost numeric,
          final_billed_cost numeric,billing_difference numeric,settlement_id text,settlement_line_id text,carrier_invoice_number text,
          carrier_billed_weight numeric,carrier_billed_length numeric,carrier_billed_width numeric,carrier_billed_height numeric,review_reason text,raw jsonb
        )`, [JSON.stringify(rows)]);
      };
      const insertItem = async (entry) => {
        const itemId = crypto.randomUUID();
        pendingItems.push({
          item_id: itemId, batch_id: batchId, input_reference: entry.reference, input_position: entry.position,
          match_status: entry.matchStatus, status: entry.status, order_id: entry.orderId || null, shipment_id: entry.shipmentId || null,
          order_number: entry.orderNumber || null, channel: entry.channel || null, channel_order_number: entry.channelOrderNumber || null,
          tracking_number: entry.trackingNumber || null, warehouse_id: entry.warehouseId || null, destination_city: entry.address?.city || null,
          destination_state: entry.address?.state || null, destination_postal_code: entry.address?.postalCode || null,
          destination_country: entry.address?.country || null, destination_address: entry.address || {}, package_type: entry.parcel?.type || null,
          package_weight: entry.parcel?.weight, package_length: entry.parcel?.length, package_width: entry.parcel?.width,
          package_height: entry.parcel?.height, weight_unit: entry.parcel?.weightUnit || "lb", dimension_unit: entry.parcel?.dimensionUnit || "in",
          package_measurement_source: entry.parcel?.source || null, original_label_cost: entry.originalLabelCost,
          final_billed_cost: entry.finalBilledCost,
          billing_difference: entry.originalLabelCost != null && entry.finalBilledCost != null ? Number(entry.finalBilledCost) - Number(entry.originalLabelCost) : null,
          settlement_id: entry.settlementId || null, settlement_line_id: entry.settlementLineId || null,
          carrier_invoice_number: entry.invoiceNumber || null, carrier_billed_weight: entry.billedWeight,
          carrier_billed_length: entry.billedLength, carrier_billed_width: entry.billedWidth, carrier_billed_height: entry.billedHeight,
          review_reason: entry.reviewReason || null, raw: entry.raw || {},
        });
        insertedItemIds.push(itemId);
        if (!firstItemByReference.has(entry.reference.toLowerCase())) firstItemByReference.set(entry.reference.toLowerCase(), itemId);
        if (pendingItems.length >= DISPUTE_INSERT_CHUNK_SIZE) await flushItems();
        return itemId;
      };

      for (const [position, reference] of references.entries()) {
        const matches = grouped.get(position) || [];
        const importEvidence = referenceEvidence.get(reference.toLowerCase()) || null;
        const chargeHistory = chargeHistoryByReference.get(reference.toLowerCase()) || { transactions: [], duplicateTransactions: [], newTransactions: [] };
        const duplicateOnly = Boolean(chargeHistory.transactions.length) && chargeHistory.newTransactions.length === 0;
        const newSignedAmount = roundMoney(chargeHistory.newTransactions.reduce((sum, transaction) => sum + Number(transaction.signedAmount || 0), 0));
        const duplicateSignedAmount = roundMoney(chargeHistory.duplicateTransactions.reduce((sum, transaction) => sum + Number(transaction.signedAmount || 0), 0));
        const currentImportEvidence = importEvidence ? {
          ...importEvidence,
          newSignedAmount,
          newExpenseAmount: roundMoney(-newSignedAmount),
          duplicateSignedAmount,
          duplicateExpenseAmount: roundMoney(-duplicateSignedAmount),
        } : null;
        const chargeHistoryRaw = {
          newTransactionCount: chargeHistory.newTransactions.length,
          duplicateTransactionCount: chargeHistory.duplicateTransactions.length,
          previous: [...new Map(chargeHistory.duplicateTransactions.map((transaction) => {
            const prior = priorChargesByFingerprint.get(transaction.fingerprint) || {};
            return [prior.first_batch_id, {
              batchId: text(prior.first_batch_id),
              batchNumber: Number(prior.first_batch_number || 0),
              displayId: prior.first_batch_number ? `SD-${String(prior.first_batch_number).padStart(5, "0")}` : "Previous dispute",
              itemId: text(prior.first_item_id),
            }];
          }).filter(([batchId]) => batchId)).values()],
        };
        if (!matches.length) {
          const classification = duplicateOnly ? "exact_duplicate" : "new";
          if (classification === "exact_duplicate") batchRaw.historySummary.exactDuplicateItemCount += 1;
          else batchRaw.historySummary.newItemCount += 1;
          await insertItem({ reference, position, matchStatus: "unmatched", status: duplicateOnly ? "previously_disputed" : "unmatched", reviewReason: duplicateOnly ? historyClassificationLabel(classification) : "No DataPlus or channel order matched this reference.", raw: { importEvidence: currentImportEvidence, disputeHistory: { classification, label: historyClassificationLabel(classification), ...chargeHistoryRaw } } });
          continue;
        }
        if (matches.length > 1) {
          const classification = duplicateOnly ? "exact_duplicate" : "new";
          if (classification === "exact_duplicate") batchRaw.historySummary.exactDuplicateItemCount += 1;
          else batchRaw.historySummary.newItemCount += 1;
          await insertItem({ reference, position, matchStatus: "ambiguous", status: duplicateOnly ? "previously_disputed" : "ambiguous", reviewReason: duplicateOnly ? historyClassificationLabel(classification) : "This reference matches multiple orders.", raw: { importEvidence: currentImportEvidence, disputeHistory: { classification, label: historyClassificationLabel(classification), ...chargeHistoryRaw }, candidates: matches.map((row) => ({ orderId: row.order_id, orderNumber: row.order_number, channelOrderNumber: row.marketplace_order_id })) } });
          continue;
        }
        const order = matches[0], raw = object(order.raw), sourceAddress = addressFromOrder(raw);
        const orderLines = normalizedLinesByOrder.get(order.order_id) || [];
        const skus = disputeSkus(orderLines);
        const channelOrderNumber = text(raw.marketplaceOrderNumber || raw.channelOrderNumber || raw.external?.purchaseOrderId || raw.external?.parentOrderSn || order.marketplace_order_id);
        const orderKey = orderHistoryKeyByOrderId.get(order.order_id) || disputeOrderHistoryKey({ channel: text(order.source || order.channel_source || raw.source), channelOrderNumber, orderId: order.order_id, orderNumber: order.order_number });
        const priorOrderHistory = previousHistoryByOrderKey.get(orderKey) || [];
        const financials = financialByOrder.get(order.order_id) || [];
        const shipmentSources = financials.length ? financials : (Array.isArray(raw.shipments) && raw.shipments.length ? raw.shipments : [{}]);
        for (let shipmentIndex = 0; shipmentIndex < shipmentSources.length; shipmentIndex += 1) {
          const shipment = shipmentSources[shipmentIndex], shipmentRaw = object(shipment.raw || shipment);
          const historicalParcel = financials.length
            ? packageFromSources(shipment, shipmentRaw.package || raw.package)
            : packageFromSources(shipmentRaw.package || shipmentRaw, raw.package);
          historicalParcel.source = historicalParcel.source || (financials.length ? "label_purchase_snapshot" : text(raw.packageMeasurementSource || shipmentRaw.packageMeasurementSource || "current_order_record"));
          const catalogPackage = catalogPackagesByOrder.get(order.order_id);
          const trackingNumber = text(shipment.tracking_number || shipmentRaw.trackingNumber || raw.trackingNumber);
          const shipmentId = text(shipment.shipment_id || shipment.id);
          const shipmentKey = disputeShipmentHistoryKey(orderKey, { trackingNumber, shipmentId });
          const priorHistory = priorOrderHistory.find((entry) => entry.shipment_key === shipmentKey) || priorOrderHistory[0] || null;
          const priorAddress = object(priorHistory?.destination_snapshot);
          const priorParcel = object(priorHistory?.package_snapshot);
          const address = {
            ...priorAddress,
            ...Object.fromEntries(Object.entries(sourceAddress).filter(([, value]) => text(value))),
          };
          let parcel = catalogPackage?.parcel || historicalParcel;
          let reusedPackage = false;
          if (!completePackage(parcel) && completePackage(priorParcel)) {
            parcel = priorParcel;
            reusedPackage = true;
          }
          let classification = "new";
          if (duplicateOnly) classification = "exact_duplicate";
          else if (priorHistory && chargeHistory.newTransactions.length) classification = "previous_order_new_charge";
          else if (priorHistory) classification = "previous_order";
          const reusedQuote = classification !== "new" && priorHistory ? reusableHistoryQuote(priorHistory, parcel, address) : null;
          let status = itemStatus("matched", parcel, address);
          if (classification === "exact_duplicate" || classification === "previous_order") status = "previously_disputed";
          else if (reusedQuote) status = "quoted";
          if (classification === "new") batchRaw.historySummary.newItemCount += 1;
          else if (classification === "exact_duplicate") batchRaw.historySummary.exactDuplicateItemCount += 1;
          else batchRaw.historySummary.previousItemCount += 1;
          if (reusedQuote) batchRaw.historySummary.reusedQuoteCount += 1;
          const previous = priorHistory ? [{
            batchId: text(priorHistory.batch_id), batchNumber: Number(priorHistory.batch_number || 0),
            displayId: priorHistory.batch_number ? `SD-${String(priorHistory.batch_number).padStart(5, "0")}` : "Previous dispute",
            itemId: text(priorHistory.item_id), quotedAt: timestamp(object(priorHistory.quote_snapshot).completedAt), status: text(priorHistory.status),
          }] : chargeHistoryRaw.previous;
          await insertItem({
            reference, position, matchStatus: "matched", status, orderId: order.order_id,
            shipmentId, orderNumber: text(order.order_number || raw.orderNumber),
            channel: text(order.source || order.channel_source || raw.source), channelOrderNumber,
            trackingNumber,
            warehouseId: text(shipment.warehouse_id || shipmentRaw.warehouseId || raw.fulfillmentWarehouseId), address, parcel,
            originalLabelCost: numberOrNull(shipment.estimated_shipping_cost ?? shipmentRaw.shippingCost ?? shipmentRaw.labelCost),
            finalBilledCost: numberOrNull(shipment.actual_shipping_cost),
            settlementId: text(shipment.settlement_id || shipment.billed_settlement_id),
            settlementLineId: text(shipment.settlement_line_id), invoiceNumber: text(shipment.carrier_invoice_number || shipment.settlement_invoice_number),
            billedWeight: numberOrNull(shipment.carrier_billed_weight), billedLength: numberOrNull(shipment.carrier_billed_length),
            billedWidth: numberOrNull(shipment.carrier_billed_width), billedHeight: numberOrNull(shipment.carrier_billed_height),
            reviewReason: status === "needs_package_data" ? "Current catalog SKU dimensions or weight are incomplete." : status === "needs_address_review" ? "A destination ZIP or postal code is required." : ["exact_duplicate", "previous_order"].includes(classification) ? historyClassificationLabel(classification) : "",
            raw: {
              financialRecord: Boolean(financials.length), shipmentIndex, importEvidence: currentImportEvidence, orderLines, skus,
              orderDate: timestamp(order.order_date || raw.orderDate || raw.orderedAt || raw.createdAt || order.created_at),
              shipDate: timestamp(shipment.shipped_at || shipmentRaw.shippedAt || shipmentRaw.shipDate || raw.shippedAt || raw.shipDate),
              historicalPackage: historicalParcel,
              disputeHistory: {
                classification, label: historyClassificationLabel(classification), previous,
                newTransactionCount: chargeHistory.newTransactions.length,
                duplicateTransactionCount: chargeHistory.duplicateTransactions.length,
                reusedDestination: !completeDestination(sourceAddress) && completeDestination(address), reusedPackage,
                ...(reusedQuote ? { reusedQuote } : {}),
              },
              ...(catalogPackage ? { catalogQuotePackage: { ...catalogPackage, capturedAt: new Date().toISOString() } } : {}),
            }
          });
        }
      }
      await flushItems();
      const currentChargeRecords = importedChargeRecords.map((entry) => {
        const prior = priorChargesByFingerprint.get(entry.transaction.fingerprint);
        const itemId = firstItemByReference.get(entry.evidence.reference.toLowerCase()) || null;
        return {
          tenant_id: text(scope.tenantId), company_id: text(scope.companyId), charge_fingerprint: entry.transaction.fingerprint,
          source_report: text(entry.evidence.sourceReport), transaction_type: text(entry.evidence.transactionType),
          input_reference: text(entry.evidence.reference), transaction_date: text(entry.transaction.date), related_id: text(entry.transaction.relatedId),
          signed_amount: numberOrNull(entry.transaction.signedAmount), total_amount: numberOrNull(entry.transaction.total),
          currency: text(entry.transaction.currency || entry.evidence.currency || "USD"), first_batch_id: batchId,
          first_batch_number: Number(batch.batch_number || 0), first_item_id: itemId, last_batch_id: batchId, last_item_id: itemId,
          raw: { ...entry.transaction, duplicateOfBatchId: text(prior?.first_batch_id) },
        };
      });
      for (const chargeChunk of chunks(currentChargeRecords, DISPUTE_INSERT_CHUNK_SIZE)) {
        await client.query(`insert into shipping_dispute_charge_history (
            tenant_id,company_id,charge_fingerprint,source_report,transaction_type,input_reference,transaction_date,
            related_id,signed_amount,total_amount,currency,first_batch_id,first_batch_number,first_item_id,last_batch_id,last_item_id,raw
          ) select tenant_id,company_id,charge_fingerprint,source_report,transaction_type,input_reference,transaction_date,
            related_id,signed_amount,total_amount,currency,first_batch_id,first_batch_number,first_item_id,last_batch_id,last_item_id,raw
          from jsonb_to_recordset($1::jsonb) as record(
            tenant_id text,company_id text,charge_fingerprint text,source_report text,transaction_type text,input_reference text,
            transaction_date text,related_id text,signed_amount numeric,total_amount numeric,currency text,first_batch_id text,
            first_batch_number bigint,first_item_id text,last_batch_id text,last_item_id text,raw jsonb
          )
          on conflict (tenant_id,company_id,charge_fingerprint) do update set
            last_batch_id=excluded.last_batch_id,last_item_id=excluded.last_item_id,last_seen_at=now(),
            occurrence_count=shipping_dispute_charge_history.occurrence_count+1`, [JSON.stringify(chargeChunk)]);
      }
      for (const itemIdChunk of chunks(insertedItemIds, DISPUTE_INSERT_CHUNK_SIZE)) await syncShipmentHistoryForItem(client, itemIdChunk);
      await client.query("update shipping_dispute_batches set raw=$2::jsonb where batch_id=$1", [batchId, JSON.stringify(batchRaw)]);
      const refreshed = await refreshBatch(batchId, client);
      await client.query("commit");
      historyBackfilledScopes.add(historyScopeKey);
      return { ...batchRow({ ...batch, ...refreshed }), referenceCount: references.length };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function listBatches(scope = {}, options = {}) {
    await ensureSchema();
    await ensureExistingDisputeHistory(scope);
    const limit = Math.max(1, Math.min(100, Number(options.limit || 50)));
    const result = await pool().query(`select * from shipping_dispute_batches
      where tenant_id=$1 and company_id=$2 order by created_at desc limit $3`, [text(scope.tenantId), text(scope.companyId), limit]);
    return result.rows.map(batchRow);
  }

  async function deleteAllBatches(scope = {}) {
    await ensureSchema();
    const client = await pool().connect();
    try {
      await client.query("begin");
      await client.query("lock table shipping_dispute_batches in share row exclusive mode");
      const params = [text(scope.tenantId), text(scope.companyId)];
      const active = (await client.query(`select count(*)::int as count
        from shipping_dispute_batches batch
        where batch.tenant_id=$1 and batch.company_id=$2 and (
          batch.status='quoting' or exists (
            select 1 from shipping_dispute_items item
            join shipping_dispute_quote_runs run on run.item_id=item.item_id
            where item.batch_id=batch.batch_id and run.status='running'
          )
        )`, params)).rows[0];
      if (Number(active?.count || 0) > 0) {
        throw Object.assign(new Error("Wait for active shipping-dispute quote jobs to finish before resetting disputes."), { status: 409 });
      }
      const counts = (await client.query(`select
          count(distinct batch.batch_id)::int as batches,
          count(distinct item.item_id)::int as items,
          count(distinct run.run_id)::int as quote_runs,
          count(quote.run_id)::int as quotes
        from shipping_dispute_batches batch
        left join shipping_dispute_items item on item.batch_id=batch.batch_id
        left join shipping_dispute_quote_runs run on run.item_id=item.item_id
        left join shipping_dispute_quotes quote on quote.run_id=run.run_id
        where batch.tenant_id=$1 and batch.company_id=$2`, params)).rows[0] || {};
      await client.query("delete from shipping_dispute_batches where tenant_id=$1 and company_id=$2", params);
      await client.query("commit");
      return {
        batches: Number(counts.batches || 0),
        items: Number(counts.items || 0),
        quoteRuns: Number(counts.quote_runs || 0),
        quotes: Number(counts.quotes || 0),
        sequenceReset: false,
        historyRetained: true,
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function getBatch(scope = {}, batchId) {
    await ensureSchema();
    await recoverStaleQuoting(scope, batchId);
    const client = pool();
    let batch = (await client.query(`select * from shipping_dispute_batches where batch_id=$1 and tenant_id=$2 and company_id=$3`, [batchId, text(scope.tenantId), text(scope.companyId)])).rows[0];
    if (!batch) return null;
    const items = await client.query(`
      select item.*,
        latest.run_id as latest_run_id,latest.status as latest_run_status,latest.requested_at as latest_run_requested_at,
        latest.completed_at as latest_run_completed_at,latest.request_snapshot as latest_run_request_snapshot,
        latest.provider_status as latest_run_provider_status,latest.error_message as latest_run_error,
        coalesce(quotes.rows,'[]'::jsonb) as quotes
      from shipping_dispute_items item
      left join lateral (select * from shipping_dispute_quote_runs run where run.item_id=item.item_id order by requested_at desc,created_at desc limit 1) latest on true
      left join lateral (select jsonb_agg(jsonb_build_object(
        'rank',quote.rank,'provider',quote.provider,'carrier',quote.carrier,'service',quote.service,'amount',quote.amount,
        'currency',quote.currency,'delivery_days',quote.delivery_days,'delivery_estimate',quote.delivery_estimate,
        'rate_id',quote.rate_id,'quoted_at',quote.quoted_at,'expires_at',quote.expires_at
      ) order by quote.rank) as rows from shipping_dispute_quotes quote where quote.run_id=latest.run_id) quotes on true
      where item.batch_id=$1 order by item.input_position,item.created_at,item.item_id
    `, [batchId]);
    const matchedOrderIds = [...new Set(items.rows.map((row) => text(row.order_id)).filter(Boolean))];
    const orderMetadataRows = matchedOrderIds.length ? (await client.query(`
      select order_id,order_date,created_at,
        coalesce(nullif(raw->>'orderDate',''),nullif(raw->>'orderedAt',''),nullif(raw->>'createdAt','')) as raw_order_date,
        coalesce(nullif(raw->>'shippedAt',''),nullif(raw->>'shipDate','')) as raw_ship_date
      from order_records where order_id=any($1::text[])
    `, [matchedOrderIds])).rows : [];
    const orderMetadataById = new Map(orderMetadataRows.map((row) => [row.order_id, row]));
    const shipmentDateRows = matchedOrderIds.length ? (await client.query(`
      select order_id,shipment_id,tracking_number,shipped_at
      from order_shipment_financials
      where order_id=any($1::text[]) and shipped_at is not null
      order by shipped_at desc nulls last,created_at desc
    `, [matchedOrderIds])).rows : [];
    const shipmentDateByIdentity = new Map();
    const shipmentDateByOrder = new Map();
    for (const shipment of shipmentDateRows) {
      const orderId = text(shipment.order_id);
      const shippedAt = shipment.shipped_at;
      if (!shipmentDateByOrder.has(orderId)) shipmentDateByOrder.set(orderId, shippedAt);
      for (const identity of [shipment.shipment_id, shipment.tracking_number].map(text).filter(Boolean)) {
        const key = `${orderId}:${identity.toLowerCase()}`;
        if (!shipmentDateByIdentity.has(key)) shipmentDateByIdentity.set(key, shippedAt);
      }
    }
    for (const row of items.rows) {
      const orderId = text(row.order_id);
      const metadata = orderMetadataById.get(orderId) || {};
      row.source_order_date = metadata.order_date;
      row.source_order_created_at = metadata.created_at;
      row.source_raw_order_date = metadata.raw_order_date;
      row.source_raw_ship_date = metadata.raw_ship_date;
      const sourceShipmentDate = [row.shipment_id, row.tracking_number]
        .map((identity) => shipmentDateByIdentity.get(`${orderId}:${text(identity).toLowerCase()}`))
        .find(Boolean);
      row.source_shipped_at = sourceShipmentDate || shipmentDateByOrder.get(orderId) || null;
    }
    const missingLineOrderIds = [...new Set(items.rows
      .filter((row) => row.order_id && !orderLinesForDispute([], object(row.raw)).length)
      .map((row) => row.order_id))];
    const historicalLineRows = missingLineOrderIds.length ? (await client.query(`
      select line_id,order_id,line_index,sku,mapped_sku,original_sku,title,qty,raw
      from order_line_items where order_id=any($1::text[])
      order by order_id,line_index,line_id
    `, [missingLineOrderIds])).rows : [];
    const historicalLinesByOrder = new Map(missingLineOrderIds.map((id) => [id, []]));
    for (const row of historicalLineRows) historicalLinesByOrder.get(row.order_id)?.push(row);
    const preparedItems = items.rows.map((row) => {
      const raw = object(row.raw);
      const storedLines = orderLinesForDispute([], raw);
      const orderLines = storedLines.length || !row.order_id ? storedLines : orderLinesForDispute(historicalLinesByOrder.get(row.order_id) || []);
      return { row, raw, orderLines };
    });
    const productMetadata = await productMetadataForOrderLines(client, preparedItems.flatMap((item) => item.orderLines));
    const catalogUpdates = [];
    const hydratedItems = preparedItems.map(({ row, raw, orderLines }) => {
      const enrichedLines = enrichOrderLinesWithProducts(orderLines, productMetadata);
      let rowChanged = false;
      const currentSource = text(row.package_measurement_source);
      const canUseCatalog = row.match_status === "matched"
        && !["quoted", "quoting"].includes(row.status)
        && currentSource !== "manual_dispute_override";
      const catalogPackage = canUseCatalog ? catalogQuotePackage(enrichedLines, productMetadata) : null;
      if (catalogPackage && !sameQuotePackage(packageFromSources(row), catalogPackage.parcel)) {
        const nextRaw = {
          ...raw,
          orderLines: enrichedLines,
          skus: disputeSkus(enrichedLines),
          historicalPackage: object(raw.historicalPackage).source ? raw.historicalPackage : packageFromSources(row),
          catalogQuotePackage: { ...catalogPackage, capturedAt: new Date().toISOString() },
        };
        if (object(nextRaw.disputeHistory).reusedQuote) {
          nextRaw.disputeHistory = { ...object(nextRaw.disputeHistory) };
          delete nextRaw.disputeHistory.reusedQuote;
        }
        Object.assign(row, {
          package_type: catalogPackage.parcel.type,
          package_weight: catalogPackage.parcel.weight,
          package_length: catalogPackage.parcel.length,
          package_width: catalogPackage.parcel.width,
          package_height: catalogPackage.parcel.height,
          weight_unit: catalogPackage.parcel.weightUnit,
          dimension_unit: catalogPackage.parcel.dimensionUnit,
          package_measurement_source: catalogPackage.parcel.source,
          quoted_at: null,
          raw: nextRaw,
        });
        rowChanged = true;
      }
      const staleQuoteEvidence = Boolean(row.latest_run_id) && !quoteEvidenceIsCurrent(row, row.raw);
      if (staleQuoteEvidence) row.quoted_at = null;
      if (rowChanged || staleQuoteEvidence || ["needs_package_data", "needs_address_review", "ready_to_quote"].includes(row.status)) {
        const historyClassification = text(object(object(row.raw).disputeHistory).classification);
        const normalizedStatus = ["exact_duplicate", "previous_order"].includes(historyClassification)
          ? "previously_disputed"
          : itemStatus(row.match_status, packageFromSources(row), itemRow(row).destination);
        const normalizedReviewReason = normalizedStatus === "needs_package_data"
          ? "Current catalog SKU dimensions or weight are incomplete."
          : normalizedStatus === "needs_address_review"
            ? "A destination ZIP or postal code is required."
            : normalizedStatus === "previously_disputed"
              ? historyClassificationLabel(historyClassification)
            : "";
        if (normalizedStatus !== row.status || text(row.review_reason) !== normalizedReviewReason) {
          row.status = normalizedStatus;
          row.review_reason = normalizedReviewReason;
          rowChanged = true;
        }
      }
      if (rowChanged) {
        catalogUpdates.push({
          item_id: row.item_id,
          package_type: row.package_type,
          package_weight: row.package_weight,
          package_length: row.package_length,
          package_width: row.package_width,
          package_height: row.package_height,
          weight_unit: row.weight_unit,
          dimension_unit: row.dimension_unit,
          package_measurement_source: row.package_measurement_source,
          status: row.status,
          review_reason: row.review_reason,
          quoted_at: row.quoted_at,
          raw: row.raw,
        });
      }
      return itemRow({ ...row, raw: { ...object(row.raw), orderLines: enrichedLines, skus: disputeSkus(enrichedLines) } });
    });
    if (catalogUpdates.length) {
      for (const updateChunk of chunks(catalogUpdates, DISPUTE_INSERT_CHUNK_SIZE)) {
        await client.query(`with incoming as (
          select * from jsonb_to_recordset($1::jsonb) as record(
            item_id text,package_type text,package_weight numeric,package_length numeric,package_width numeric,package_height numeric,
            weight_unit text,dimension_unit text,package_measurement_source text,status text,review_reason text,quoted_at timestamptz,raw jsonb
          )
        ) update shipping_dispute_items item set
          package_type=incoming.package_type,package_weight=incoming.package_weight,package_length=incoming.package_length,
          package_width=incoming.package_width,package_height=incoming.package_height,weight_unit=incoming.weight_unit,
          dimension_unit=incoming.dimension_unit,package_measurement_source=incoming.package_measurement_source,status=incoming.status,
          review_reason=nullif(incoming.review_reason,''),quoted_at=incoming.quoted_at,raw=incoming.raw,updated_at=now()
        from incoming,shipping_dispute_batches scoped
        where item.item_id=incoming.item_id and item.batch_id=scoped.batch_id and scoped.batch_id=$2
          and scoped.tenant_id=$3 and scoped.company_id=$4`, [JSON.stringify(updateChunk), batchId, text(scope.tenantId), text(scope.companyId)]);
        await syncShipmentHistoryForItem(client, updateChunk.map((entry) => entry.item_id));
      }
      batch = await refreshBatch(batchId);
    }
    return { ...batchRow(batch), items: hydratedItems };
  }

  async function updateItemPackage(scope = {}, batchId, itemId, input = {}, actor = {}) {
    await ensureSchema();
    const parcel = packageFromSources(input.package || input);
    const reason = text(input.reason);
    if (!completePackage(parcel)) throw Object.assign(new Error("Enter positive weight, length, width, and height values."), { status: 400 });
    if (!reason) throw Object.assign(new Error("Explain why these dispute dimensions are being used."), { status: 400 });
    const result = await pool().query(`update shipping_dispute_items item set
      package_type=$1,package_weight=$2,package_length=$3,package_width=$4,package_height=$5,weight_unit=$6,dimension_unit=$7,
      package_measurement_source='manual_dispute_override',review_reason=$8,status=case
        when nullif(destination_postal_code,'') is null or nullif(destination_country,'') is null then 'needs_address_review'
        else 'ready_to_quote' end,
      quoted_at=null,raw=(coalesce(raw,'{}'::jsonb)#-'{disputeHistory,reusedQuote}')||jsonb_build_object('packageOverride',jsonb_build_object('reason',$8,'updatedBy',$9,'updatedAt',now())),updated_at=now()
      from shipping_dispute_batches batch where item.item_id=$10 and item.batch_id=batch.batch_id and batch.batch_id=$11 and batch.tenant_id=$12 and batch.company_id=$13 returning item.*`, [
      parcel.type, parcel.weight, parcel.length, parcel.width, parcel.height, parcel.weightUnit, parcel.dimensionUnit, reason, text(actor.name || actor.id), itemId, batchId, text(scope.tenantId), text(scope.companyId)
    ]);
    if (!result.rows[0]) return null;
    await syncShipmentHistoryForItem(pool(), itemId);
    await refreshBatch(batchId);
    return itemRow(result.rows[0]);
  }

  async function suggestItemPostalCode(scope = {}, batchId, itemId) {
    await ensureSchema();
    const current = (await pool().query(`select item.* from shipping_dispute_items item
      join shipping_dispute_batches batch on batch.batch_id=item.batch_id
      where item.item_id=$1 and batch.batch_id=$2 and batch.tenant_id=$3 and batch.company_id=$4`, [
      itemId, batchId, text(scope.tenantId), text(scope.companyId)
    ])).rows[0];
    if (!current) return null;

    const country = text(current.destination_country || "US").toUpperCase();
    const existingPostalCode = normalizedPostalSuggestion(current.destination_postal_code, country);
    if (existingPostalCode) {
      return {
        itemId,
        postalCode: existingPostalCode,
        country,
        city: text(current.destination_city),
        state: text(current.destination_state),
        source: "current_dispute_destination",
        status: "found",
        candidateCount: 1,
        evidenceCount: 1,
        message: "The dispute already has a destination ZIP.",
      };
    }

    const city = text(current.destination_city);
    const state = text(current.destination_state);
    if (!city || !state) {
      return { itemId, postalCode: "", country, city, state, source: "", status: "failed", candidateCount: 0, evidenceCount: 0, message: "City and state are required before DataPlus can suggest a ZIP." };
    }

    const evidenceRows = (await pool().query(`select destination_postal_code,destination_country,count(*)::int as evidence_count
      from shipping_dispute_items
      where batch_id=$1 and item_id<>$2
        and lower(trim(coalesce(destination_city,'')))=lower($3)
        and lower(trim(coalesce(destination_state,'')))=lower($4)
        and nullif(trim(coalesce(destination_postal_code,'')),'') is not null
        and ($5='' or lower(trim(coalesce(destination_country,'')))=lower($5))
      group by destination_postal_code,destination_country
      order by evidence_count desc,destination_postal_code
      limit 100`, [batchId, itemId, city, state, country])).rows;
    const candidates = new Map();
    for (const row of evidenceRows) {
      const candidateCountry = text(row.destination_country || country).toUpperCase();
      const postalCode = normalizedPostalSuggestion(row.destination_postal_code, candidateCountry);
      if (!postalCode) continue;
      const key = `${candidateCountry}:${postalCode}`;
      candidates.set(key, {
        postalCode,
        country: candidateCountry,
        evidenceCount: Number(candidates.get(key)?.evidenceCount || 0) + Number(row.evidence_count || 0),
      });
    }
    if (candidates.size !== 1) {
      return {
        itemId,
        postalCode: "",
        country,
        city,
        state,
        source: "",
        status: "not_found",
        candidateCount: candidates.size,
        evidenceCount: evidenceRows.reduce((sum, row) => sum + Number(row.evidence_count || 0), 0),
        message: candidates.size > 1
          ? `Multiple ZIP codes are stored for ${city}, ${state}; enter the destination ZIP manually.`
          : `No stored ZIP evidence was found for ${city}, ${state}.`,
      };
    }
    const suggestion = [...candidates.values()][0];
    return {
      itemId,
      postalCode: suggestion.postalCode,
      country: suggestion.country,
      city,
      state,
      source: "same_dispute_city_state_consensus",
      status: "found",
      candidateCount: 1,
      evidenceCount: suggestion.evidenceCount,
      message: `Suggested from ${suggestion.evidenceCount} other dispute shipment${suggestion.evidenceCount === 1 ? "" : "s"} for ${city}, ${state}.`,
    };
  }

  async function updateItemOrderDestination(scope = {}, batchId, itemId, input = {}, actor = {}) {
    await ensureSchema();
    const orderReference = text(input.orderReference);
    if (!orderReference) throw Object.assign(new Error("Enter a DataPlus or channel order number."), { status: 400 });
    const client = await pool().connect();
    try {
      await client.query("begin");
      const current = (await client.query(`select item.* from shipping_dispute_items item
        join shipping_dispute_batches batch on batch.batch_id=item.batch_id
        where item.item_id=$1 and batch.batch_id=$2 and batch.tenant_id=$3 and batch.company_id=$4
        for update of item`, [itemId, batchId, text(scope.tenantId), text(scope.companyId)])).rows[0];
      if (!current) {
        await client.query("rollback");
        return null;
      }
      const orderRows = (await client.query(`select order_id,order_number,internal_order_number,marketplace_order_id,
          source,channel_source,order_date,raw,created_at
        from order_records
        where tenant_id=$2 and company_id=$3 and (
          lower(order_id)=lower($1)
          or lower(coalesce(order_number,''))=lower($1)
          or lower(coalesce(internal_order_number,''))=lower($1)
          or lower(coalesce(marketplace_order_id,''))=lower($1)
          or lower(coalesce(channel_order_id,''))=lower($1)
          or lower(coalesce(raw->>'marketplaceOrderNumber',''))=lower($1)
          or lower(coalesce(raw->>'channelOrderNumber',''))=lower($1)
          or lower(coalesce(raw->>'externalOrderId',''))=lower($1)
          or lower(coalesce(raw->'external'->>'customerOrderId',''))=lower($1)
          or lower(coalesce(raw->'external'->>'purchaseOrderId',''))=lower($1)
          or lower(coalesce(raw->'external'->>'parentOrderSn',''))=lower($1)
        ) order by created_at desc nulls last,order_id limit 10`, [orderReference, text(scope.tenantId), text(scope.companyId)])).rows;
      const exactOrderRows = orderRows.filter((row) => text(row.order_id).toLowerCase() === orderReference.toLowerCase());
      const matches = exactOrderRows.length === 1 ? exactOrderRows : orderRows;
      if (!matches.length) throw Object.assign(new Error(`No order matched ${orderReference}. Enter the DataPlus order number or the exact channel order number.`), { status: 404 });
      if (matches.length > 1) throw Object.assign(new Error(`Order reference ${orderReference} matches multiple records. Enter the unique DataPlus order number.`), { status: 409 });

      const order = matches[0];
      const orderRaw = object(order.raw);
      const lineRows = (await client.query(`select line_id,order_id,line_index,sku,mapped_sku,original_sku,title,qty,raw
        from order_line_items where order_id=$1 order by line_index,line_id`, [order.order_id])).rows;
      const normalizedLines = orderLinesForDispute(lineRows, orderRaw);
      const productMetadata = await productMetadataForOrderLines(client, normalizedLines);
      const orderLines = enrichOrderLinesWithProducts(normalizedLines, productMetadata);
      const catalogPackage = catalogQuotePackage(orderLines, productMetadata);
      const financials = (await client.query(`select financial.*,
          billed.line_id as settlement_line_id,billed.settlement_id as billed_settlement_id,
          billed.billed_weight as carrier_billed_weight,billed.billed_length as carrier_billed_length,
          billed.billed_width as carrier_billed_width,billed.billed_height as carrier_billed_height,
          settlement.invoice_number as settlement_invoice_number
        from order_shipment_financials financial
        left join lateral (
          select line.* from shipping_settlement_lines line
          where line.order_id=financial.order_id and (
            line.shipment_id=financial.shipment_id
            or (nullif(financial.tracking_number,'') is not null and lower(line.tracking_number)=lower(financial.tracking_number))
          ) order by (line.shipment_id=financial.shipment_id) desc,
            (line.billed_weight is not null or line.billed_length is not null) desc,
            line.service_date desc nulls last,line.created_at desc limit 1
        ) billed on true
        left join shipping_settlements settlement on settlement.settlement_id=coalesce(nullif(financial.settlement_id,''),billed.settlement_id)
        where financial.order_id=$1 order by financial.created_at desc,financial.shipment_id`, [order.order_id])).rows;
      const currentRaw = object(current.raw);
      const relatedIds = Array.isArray(object(currentRaw.importEvidence).relatedIds) ? currentRaw.importEvidence.relatedIds : [];
      const preferredShipmentIds = new Set([current.shipment_id, current.tracking_number, ...relatedIds].map((value) => text(value).toLowerCase()).filter(Boolean));
      const rawShipments = Array.isArray(orderRaw.shipments) ? orderRaw.shipments : [];
      const shipmentSources = financials.length ? financials : rawShipments;
      const shipment = shipmentSources.find((candidate) => [candidate.shipment_id, candidate.id, candidate.tracking_number, candidate.trackingNumber]
        .map((value) => text(value).toLowerCase()).some((value) => value && preferredShipmentIds.has(value))) || shipmentSources[0] || {};
      const shipmentRaw = object(shipment.raw || shipment);
      const historicalParcel = financials.length
        ? packageFromSources(shipment, shipmentRaw.package || orderRaw.package)
        : packageFromSources(shipmentRaw.package || shipmentRaw, orderRaw.package);
      historicalParcel.source = historicalParcel.source || (financials.length ? "label_purchase_snapshot" : text(orderRaw.packageMeasurementSource || shipmentRaw.packageMeasurementSource || "current_order_record"));
      const orderChanged = text(current.order_id) !== text(order.order_id);
      const parcel = orderChanged ? (catalogPackage?.parcel || historicalParcel) : packageFromSources(current);
      const sourceAddress = addressFromOrder(orderRaw);
      const postalCode = text(input.postalCode || current.destination_postal_code || sourceAddress.postalCode).toUpperCase();
      const country = text(input.country || current.destination_country || sourceAddress.country || "US").toUpperCase();
      if (!postalCode || !/^[A-Z0-9][A-Z0-9 -]{1,19}$/.test(postalCode)) throw Object.assign(new Error("Enter a valid destination ZIP or postal code."), { status: 400 });
      if (!/^[A-Z]{2}$/.test(country)) throw Object.assign(new Error("Enter a two-letter destination country code."), { status: 400 });
      const address = { ...sourceAddress, postalCode, country };
      const status = itemStatus("matched", parcel, address);
      const reviewReason = status === "needs_package_data" ? "Current catalog SKU dimensions or weight are incomplete." : "";
      const changedAt = new Date().toISOString();
      const nextRaw = {
        ...currentRaw,
        orderLines,
        skus: disputeSkus(orderLines),
        orderDate: timestamp(order.order_date || orderRaw.orderDate || orderRaw.orderedAt || orderRaw.createdAt || order.created_at),
        shipDate: timestamp(shipment.shipped_at || shipmentRaw.shippedAt || shipmentRaw.shipDate || orderRaw.shippedAt || orderRaw.shipDate),
        historicalPackage: historicalParcel,
        orderDestinationOverride: {
          orderReference,
          postalCode,
          country,
          postalSource: text(input.postalSource || "manual"),
          postalCandidateCount: Math.max(0, Number(input.postalCandidateCount || 0) || 0),
          postalEvidenceCount: Math.max(0, Number(input.postalEvidenceCount || 0) || 0),
          postalLookupMessage: text(input.postalLookupMessage).slice(0, 500),
          updatedBy: text(actor.name || actor.id),
          updatedAt: changedAt,
        },
        ...(orderChanged && catalogPackage ? { catalogQuotePackage: { ...catalogPackage, capturedAt: changedAt } } : {}),
      };
      if (object(nextRaw.disputeHistory).reusedQuote) {
        nextRaw.disputeHistory = { ...object(nextRaw.disputeHistory) };
        delete nextRaw.disputeHistory.reusedQuote;
      }
      if (orderChanged) delete nextRaw.packageOverride;
      const useCurrentFinancialEvidence = !orderChanged;
      const update = {
        match_status: "matched",
        status,
        order_id: order.order_id,
        shipment_id: text(shipment.shipment_id || shipment.id),
        order_number: text(order.order_number || orderRaw.orderNumber || order.order_id),
        channel: text(order.source || order.channel_source || orderRaw.source),
        channel_order_number: text(orderRaw.marketplaceOrderNumber || orderRaw.channelOrderNumber || orderRaw.external?.purchaseOrderId || orderRaw.external?.parentOrderSn || order.marketplace_order_id),
        tracking_number: text(shipment.tracking_number || shipmentRaw.trackingNumber || orderRaw.trackingNumber),
        warehouse_id: text(shipment.warehouse_id || shipmentRaw.warehouseId || orderRaw.fulfillmentWarehouseId),
        destination_city: address.city,
        destination_state: address.state,
        destination_postal_code: address.postalCode,
        destination_country: address.country,
        destination_address: address,
        package_type: parcel.type,
        package_weight: parcel.weight,
        package_length: parcel.length,
        package_width: parcel.width,
        package_height: parcel.height,
        weight_unit: parcel.weightUnit,
        dimension_unit: parcel.dimensionUnit,
        package_measurement_source: parcel.source,
        original_label_cost: useCurrentFinancialEvidence ? numberOrNull(current.original_label_cost) : numberOrNull(shipment.estimated_shipping_cost ?? shipmentRaw.shippingCost ?? shipmentRaw.labelCost),
        final_billed_cost: useCurrentFinancialEvidence ? numberOrNull(current.final_billed_cost) : numberOrNull(shipment.actual_shipping_cost),
        settlement_id: useCurrentFinancialEvidence ? text(current.settlement_id) : text(shipment.settlement_id || shipment.billed_settlement_id),
        settlement_line_id: useCurrentFinancialEvidence ? text(current.settlement_line_id) : text(shipment.settlement_line_id),
        carrier_invoice_number: useCurrentFinancialEvidence ? text(current.carrier_invoice_number) : text(shipment.carrier_invoice_number || shipment.settlement_invoice_number),
        carrier_billed_weight: useCurrentFinancialEvidence ? numberOrNull(current.carrier_billed_weight) : numberOrNull(shipment.carrier_billed_weight),
        carrier_billed_length: useCurrentFinancialEvidence ? numberOrNull(current.carrier_billed_length) : numberOrNull(shipment.carrier_billed_length),
        carrier_billed_width: useCurrentFinancialEvidence ? numberOrNull(current.carrier_billed_width) : numberOrNull(shipment.carrier_billed_width),
        carrier_billed_height: useCurrentFinancialEvidence ? numberOrNull(current.carrier_billed_height) : numberOrNull(shipment.carrier_billed_height),
        review_reason: reviewReason,
        raw: nextRaw,
      };
      update.billing_difference = update.original_label_cost != null && update.final_billed_cost != null
        ? Number(update.final_billed_cost) - Number(update.original_label_cost)
        : null;
      const result = await client.query(`with incoming as (
          select * from jsonb_to_record($1::jsonb) as record(
            match_status text,status text,order_id text,shipment_id text,order_number text,channel text,channel_order_number text,
            tracking_number text,warehouse_id text,destination_city text,destination_state text,destination_postal_code text,
            destination_country text,destination_address jsonb,package_type text,package_weight numeric,package_length numeric,
            package_width numeric,package_height numeric,weight_unit text,dimension_unit text,package_measurement_source text,
            original_label_cost numeric,final_billed_cost numeric,billing_difference numeric,settlement_id text,settlement_line_id text,
            carrier_invoice_number text,carrier_billed_weight numeric,carrier_billed_length numeric,carrier_billed_width numeric,
            carrier_billed_height numeric,review_reason text,raw jsonb
          )
        ) update shipping_dispute_items item set
          match_status=incoming.match_status,status=incoming.status,order_id=incoming.order_id,shipment_id=incoming.shipment_id,
          order_number=incoming.order_number,channel=incoming.channel,channel_order_number=incoming.channel_order_number,
          tracking_number=incoming.tracking_number,warehouse_id=incoming.warehouse_id,destination_city=incoming.destination_city,
          destination_state=incoming.destination_state,destination_postal_code=incoming.destination_postal_code,
          destination_country=incoming.destination_country,destination_address=incoming.destination_address,
          package_type=incoming.package_type,package_weight=incoming.package_weight,package_length=incoming.package_length,
          package_width=incoming.package_width,package_height=incoming.package_height,weight_unit=incoming.weight_unit,
          dimension_unit=incoming.dimension_unit,package_measurement_source=incoming.package_measurement_source,
          original_label_cost=incoming.original_label_cost,final_billed_cost=incoming.final_billed_cost,
          billing_difference=incoming.billing_difference,settlement_id=incoming.settlement_id,settlement_line_id=incoming.settlement_line_id,
          carrier_invoice_number=incoming.carrier_invoice_number,carrier_billed_weight=incoming.carrier_billed_weight,
          carrier_billed_length=incoming.carrier_billed_length,carrier_billed_width=incoming.carrier_billed_width,
          carrier_billed_height=incoming.carrier_billed_height,review_reason=nullif(incoming.review_reason,''),
          quoted_at=null,raw=incoming.raw,updated_at=now()
        from incoming where item.item_id=$2 and item.batch_id=$3 returning item.*`, [JSON.stringify(update), itemId, batchId]);
      await syncShipmentHistoryForItem(client, itemId);
      await refreshBatch(batchId, client);
      await client.query("commit");
      return itemRow(result.rows[0]);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function markBatchQuoting(scope = {}, batchId, itemIds = []) {
    await ensureSchema();
    const selectedIds = [...new Set((Array.isArray(itemIds) ? itemIds : []).map(text).filter(Boolean))];
    const result = await pool().query(`with scoped as (
        select batch_id from shipping_dispute_batches
        where batch_id=$1 and tenant_id=$2 and company_id=$3
      ), marked as (
        update shipping_dispute_items item set status='quoting',updated_at=now()
        from scoped where item.batch_id=scoped.batch_id and item.match_status='matched'
          and (cardinality($4::text[])=0 or item.item_id=any($4::text[]))
          and (cardinality($4::text[])>0 or (
            item.status in ('ready_to_quote','quote_failed')
            and coalesce(item.raw#>>'{disputeHistory,classification}','new') not in ('exact_duplicate','previous_order')
          ))
          and item.package_weight>0 and item.package_length>0 and item.package_width>0 and item.package_height>0
          and nullif(item.destination_postal_code,'') is not null and nullif(item.destination_country,'') is not null
        returning item.item_id
      )
      update shipping_dispute_batches batch set status='quoting',updated_at=now()
      from scoped where batch.batch_id=scoped.batch_id returning batch.*`, [batchId, text(scope.tenantId), text(scope.companyId), selectedIds]);
    return result.rows[0] ? batchRow(result.rows[0]) : null;
  }

  async function getBatchSummary(scope = {}, batchId) {
    await ensureSchema();
    await recoverStaleQuoting(scope, batchId);
    const result = await pool().query(`select * from shipping_dispute_batches
      where batch_id=$1 and tenant_id=$2 and company_id=$3`, [batchId, text(scope.tenantId), text(scope.companyId)]);
    return result.rows[0] ? batchRow(result.rows[0]) : null;
  }

  async function quoteProgress(scope = {}, batchId) {
    await ensureSchema();
    await recoverStaleQuoting(scope, batchId);
    const result = await pool().query(`select job.job_id,job.job_number,job.status,job.message,
        job.total_rows,job.processed_rows,job.changed_rows,job.missing_rows,job.progress,
        job.created_at,job.started_at,job.ended_at,job.updated_at,
        coalesce(nullif(job.raw->'workerPayload'->>'requestGroupId',''),job.job_id) as request_group_id,
        coalesce(nullif(job.raw->'workerPayload'->>'chunkIndex','')::int,1) as chunk_index,
        coalesce(nullif(job.raw->'workerPayload'->>'totalChunks','')::int,1) as total_chunks,
        coalesce(nullif(job.raw->'workerPayload'->>'totalRequested','')::int,job.total_rows,0) as total_requested
      from operations_jobs job
      join shipping_dispute_batches batch on batch.batch_id=$1 and batch.tenant_id=$2 and batch.company_id=$3
      where job.category='Accounting' and job.raw->'workerPayload'->>'batchId'=$1
      order by job.created_at desc,job.job_id desc
      limit 1000`, [batchId, text(scope.tenantId), text(scope.companyId)]);
    if (!result.rows.length) {
      return {
        active: false, status: "idle", requestGroupId: "", totalChunks: 0, totalRequested: 0,
        completedChunks: 0, failedChunks: 0, processedRows: 0, quotedRows: 0, failedRows: 0,
        progressPercent: 0, updatedAt: "", stalled: false, currentChunk: null,
      };
    }
    const groups = new Map();
    for (const row of result.rows) {
      const groupId = text(row.request_group_id || row.job_id);
      const rows = groups.get(groupId) || [];
      rows.push(row);
      groups.set(groupId, rows);
    }
    const activeStatuses = new Set(["queued", "pending", "starting", "running"]);
    const summaries = [...groups.entries()].map(([requestGroupId, rows]) => {
      const sorted = [...rows].sort((left, right) => Number(left.chunk_index || 0) - Number(right.chunk_index || 0));
      const activeRows = sorted.filter((row) => activeStatuses.has(text(row.status).toLowerCase()));
      const running = activeRows.find((row) => text(row.status).toLowerCase() === "running");
      const current = running || activeRows[0] || sorted[sorted.length - 1];
      const totalRequested = Math.max(0, ...sorted.map((row) => Number(row.total_requested || 0)));
      const processedRows = sorted.reduce((sum, row) => sum + Number(row.processed_rows || 0), 0);
      const quotedRows = sorted.reduce((sum, row) => sum + Number(row.changed_rows || 0), 0);
      const failedRows = sorted.reduce((sum, row) => sum + Number(row.missing_rows || 0), 0);
      const failedChunks = sorted.filter((row) => ["failed", "stopped", "canceled", "cancelled"].includes(text(row.status).toLowerCase())).length;
      const completedChunks = sorted.filter((row) => ["success", "warning", "failed", "stopped", "canceled", "cancelled"].includes(text(row.status).toLowerCase())).length;
      const updatedAt = sorted.reduce((latest, row) => {
        const value = timestamp(row.updated_at);
        return !latest || value > latest ? value : latest;
      }, "");
      const statuses = sorted.map((row) => text(row.status).toLowerCase());
      const status = statuses.includes("running") ? "running"
        : statuses.some((value) => ["queued", "pending", "starting"].includes(value)) ? "queued"
          : failedChunks ? "failed"
            : statuses.includes("warning") ? "warning"
              : "success";
      const active = activeRows.length > 0;
      const staleMilliseconds = updatedAt ? Date.now() - new Date(updatedAt).getTime() : 0;
      return {
        active, status, requestGroupId,
        totalChunks: Math.max(1, ...sorted.map((row) => Number(row.total_chunks || 1))),
        totalRequested, completedChunks, failedChunks, processedRows, quotedRows, failedRows,
        progressPercent: totalRequested ? Math.min(100, Math.round((processedRows / totalRequested) * 100)) : 0,
        createdAt: timestamp(sorted[0]?.created_at), updatedAt,
        stalled: Boolean(active && staleMilliseconds > 5 * 60 * 1000),
        currentChunk: current ? {
          index: Number(current.chunk_index || 1),
          status: text(current.status || "queued").toLowerCase(),
          totalRows: Number(current.total_rows || 0),
          processedRows: Number(current.processed_rows || 0),
          quotedRows: Number(current.changed_rows || 0),
          failedRows: Number(current.missing_rows || 0),
          progressPercent: Number(current.progress || 0),
          jobNumber: Number(current.job_number || 0) || null,
          message: text(current.message),
        } : null,
      };
    });
    const hasActiveRequest = summaries.some((summary) => summary.active);
    const hasBulkHistory = !hasActiveRequest && summaries.some((summary) => summary.totalChunks > 1);
    summaries.sort((left, right) => {
      const activeOrder = Number(right.active) - Number(left.active);
      if (activeOrder) return activeOrder;
      if (left.active && right.active) {
        const sizeOrder = Number(right.totalRequested) - Number(left.totalRequested);
        if (sizeOrder) return sizeOrder;
      }
      if (hasBulkHistory) {
        const bulkOrder = Number(right.totalChunks > 1) - Number(left.totalChunks > 1);
        if (bulkOrder) return bulkOrder;
      }
      return String(right.createdAt).localeCompare(String(left.createdAt));
    });
    return summaries[0];
  }

  async function quoteItemIds(scope = {}, batchId, options = {}) {
    await ensureSchema();
    const selectedIds = [...new Set((Array.isArray(options.itemIds) ? options.itemIds : []).map(text).filter(Boolean))];
    const result = await pool().query(`select item.item_id
      from shipping_dispute_items item
      join shipping_dispute_batches batch on batch.batch_id=item.batch_id
      where batch.batch_id=$1 and batch.tenant_id=$2 and batch.company_id=$3
        and item.match_status='matched'
        and item.status<>'quoting'
        and (cardinality($4::text[])=0 or item.item_id=any($4::text[]))
        and (cardinality($4::text[])>0 or (
          item.status in ('ready_to_quote','quote_failed')
          and coalesce(item.raw#>>'{disputeHistory,classification}','new') not in ('exact_duplicate','previous_order')
        ))
        and item.package_weight>0 and item.package_length>0 and item.package_width>0 and item.package_height>0
        and nullif(item.destination_postal_code,'') is not null and nullif(item.destination_country,'') is not null
      order by item.input_position,item.item_id`, [batchId, text(scope.tenantId), text(scope.companyId), selectedIds]);
    return result.rows.map((row) => text(row.item_id)).filter(Boolean);
  }

  async function quoteItems(scope = {}, batchId, options = {}) {
    await ensureSchema();
    const selectedIds = [...new Set((Array.isArray(options.itemIds) ? options.itemIds : []).map(text).filter(Boolean))];
    const result = await pool().query(`select item.*
      from shipping_dispute_items item
      join shipping_dispute_batches batch on batch.batch_id=item.batch_id
      where batch.batch_id=$1 and batch.tenant_id=$2 and batch.company_id=$3
        and item.match_status='matched'
        and (cardinality($4::text[])=0 or item.item_id=any($4::text[]))
        and item.package_weight>0 and item.package_length>0 and item.package_width>0 and item.package_height>0
        and nullif(item.destination_postal_code,'') is not null and nullif(item.destination_country,'') is not null
      order by item.input_position,item.item_id`, [batchId, text(scope.tenantId), text(scope.companyId), selectedIds]);
    return result.rows.map(itemRow);
  }

  async function startRun(item, input = {}) {
    const snapshot = input.requestSnapshot || {};
    const serialized = JSON.stringify(snapshot);
    const runId = crypto.randomUUID();
    await pool().query(`insert into shipping_dispute_quote_runs
      (run_id,item_id,status,request_snapshot,request_hash,created_by) values($1,$2,'running',$3::jsonb,$4,$5)`, [
      runId, item.itemId, serialized, crypto.createHash("sha256").update(serialized).digest("hex"), text(input.createdBy)
    ]);
    return runId;
  }

  async function finishRun(batchId, itemId, runId, rates = [], input = {}) {
    const deduped = selectLowestRates(rates);
    const client = await pool().connect();
    try {
      await client.query("begin");
      for (let index = 0; index < deduped.length; index += 1) {
        const rate = deduped[index];
        await client.query(`insert into shipping_dispute_quotes
          (run_id,rank,provider,carrier,service,amount,currency,delivery_days,delivery_estimate,rate_id,quoted_at,expires_at,raw)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`, [
          runId, index + 1, text(rate.provider || "unknown"), text(rate.carrier), text(rate.service), Number(rate.amount), text(rate.currency || "USD"),
          numberOrNull(rate.deliveryDays), text(rate.deliveryEstimate), text(rate.id || rate.rateId), rate.quotedAt || new Date().toISOString(), rate.expiresAt || null,
          JSON.stringify({ warning: text(rate.warning), source: text(rate.rateSource) })
        ]);
      }
      const responseEvidence = JSON.stringify({ providerStatus: input.providerStatus || {}, selected: deduped.map((rate) => ({ provider: rate.provider, carrier: rate.carrier, service: rate.service, amount: rate.amount, currency: rate.currency })) });
      await client.query(`update shipping_dispute_quote_runs set status=$2,completed_at=now(),provider_status=$3::jsonb,response_hash=$4,error_message=$5 where run_id=$1`, [
        runId, deduped.length ? "complete" : "failed", JSON.stringify(input.providerStatus || {}), crypto.createHash("sha256").update(responseEvidence).digest("hex"), deduped.length ? null : text(input.error || "No valid comparison rates were returned.")
      ]);
      await client.query(`update shipping_dispute_items set status=$2,quoted_at=case when $2='quoted' then now() else quoted_at end,review_reason=$3,updated_at=now() where item_id=$1`, [
        itemId, deduped.length ? "quoted" : "quote_failed", deduped.length ? null : text(input.error || "No valid comparison rates were returned.")
      ]);
      await syncShipmentHistoryForItem(client, itemId);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    if (input.refreshBatch !== false) await refreshBatch(batchId);
    return deduped;
  }

  async function failRun(batchId, itemId, runId, error, providerStatus = {}, options = {}) {
    await pool().query(`update shipping_dispute_quote_runs set status='failed',completed_at=now(),provider_status=$2::jsonb,error_message=$3 where run_id=$1`, [runId, JSON.stringify(providerStatus), text(error)]);
    await pool().query("update shipping_dispute_items set status='quote_failed',review_reason=$2,updated_at=now() where item_id=$1", [itemId, text(error)]);
    await syncShipmentHistoryForItem(pool(), itemId);
    if (options.refreshBatch !== false) await refreshBatch(batchId);
  }

  async function refreshBatchSummary(batchId) {
    const row = await refreshBatch(batchId);
    return row ? batchRow(row) : null;
  }

  async function completeBatch(batchId) {
    await pool().query("update shipping_dispute_batches set status='ready_to_quote',last_quoted_at=now(),updated_at=now() where batch_id=$1", [batchId]);
    const row = await refreshBatch(batchId);
    return batchRow(row);
  }

  return {
    createBatch, listBatches, deleteAllBatches, getBatch, getBatchSummary, updateItemPackage, updateItemOrderDestination, suggestItemPostalCode,
    markBatchQuoting, quoteProgress, quoteItemIds, quoteItems, startRun, finishRun, failRun, refreshBatchSummary, completeBatch,
  };
}

module.exports = { createShippingDisputeStore, completePackage, completeDestination, postalDestination, destinationQuoteBasis, selectLowestRates, normalizeReferenceEvidence, normalizedPostalSuggestion, orderLinesForDispute, enrichOrderLinesWithProducts, catalogQuotePackage, disputeSkus, sameQuotePackage, quoteEvidenceIsCurrent, disputeOrderHistoryKey, disputeShipmentHistoryKey, chargeTransactionsWithFingerprints, historyClassificationLabel };
