function returnOrderReference(order = {}) {
  const raw = String(
    order.orderNumber
    || order.internalOrderNumber
    || order.displayOrderNumber
    || order.channelOrderNumber
    || order.marketplaceOrderNumber
    || ""
  ).trim().replace(/^#+/, "");
  return raw
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function returnNumberBase(order = {}) {
  const reference = returnOrderReference(order);
  return reference ? `RET-${reference}` : "";
}

function nextOrderReturnNumber(records = [], order = {}) {
  const base = returnNumberBase(order);
  if (!base) return "";
  const used = new Set((Array.isArray(records) ? records : []).map((record) => String(record?.returnNumber || "").trim().toUpperCase()).filter(Boolean));
  if (!used.has(base)) return base;
  let sequence = 2;
  while (used.has(`${base}-${sequence}`)) sequence += 1;
  return `${base}-${sequence}`;
}

function returnSlugBase(record = {}) {
  const source = String(record.returnNumber || record.channelReturnId || record.id || "return").trim();
  const slug = source
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return slug || "return";
}

function returnsWithPublicSlugs(records = []) {
  const rows = Array.isArray(records) ? records : [];
  const groups = new Map();
  for (const record of rows) {
    const base = returnSlugBase(record);
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(record);
  }
  const slugByRecord = new Map();
  for (const [base, matches] of groups.entries()) {
    matches
      .slice()
      .sort((left, right) => String(right.createdAt || right.updatedAt || "").localeCompare(String(left.createdAt || left.updatedAt || "")) || String(left.id || "").localeCompare(String(right.id || "")))
      .forEach((record, index) => slugByRecord.set(record, index ? `${base}-${index + 1}` : base));
  }
  return rows.map((record) => ({ ...record, returnSlug: slugByRecord.get(record) || returnSlugBase(record) }));
}

function normalizeOrderBasedReturnNumbers(records = [], migratedAt = new Date().toISOString()) {
  const rows = Array.isArray(records) ? records : [];
  const counts = new Map();
  for (const record of rows) {
    const value = String(record?.returnNumber || "").trim().toUpperCase();
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  }
  const candidates = rows
    .filter((record) => {
      const current = String(record?.returnNumber || "").trim().toUpperCase();
      return returnNumberBase({ orderNumber: record?.orderNumber }) && (/^RET-\d{5}$/i.test(current) || (counts.get(current) || 0) > 1);
    })
    .slice()
    .sort((left, right) => String(left.createdAt || left.updatedAt || "").localeCompare(String(right.createdAt || right.updatedAt || "")) || String(left.id || "").localeCompare(String(right.id || "")));
  const desiredById = new Map();
  const used = new Set(rows.filter((record) => !candidates.includes(record)).map((record) => String(record?.returnNumber || "").trim().toUpperCase()).filter(Boolean));
  for (const record of candidates) {
    const base = returnNumberBase({ orderNumber: record.orderNumber });
    let desired = base;
    let sequence = 2;
    while (used.has(desired)) desired = `${base}-${sequence++}`;
    used.add(desired);
    desiredById.set(record.id, desired);
  }
  let changed = 0;
  const normalized = rows.map((record) => {
    const desired = desiredById.get(record.id);
    if (!desired || desired === String(record.returnNumber || "").trim().toUpperCase()) return record;
    changed += 1;
    return {
      ...record,
      legacyReturnNumber: record.legacyReturnNumber || record.returnNumber || "",
      returnNumber: desired,
      returnNumberMigratedAt: migratedAt,
      returnNumberMigrationReason: "Order-based unique RMA identifiers"
    };
  });
  return { records: normalized, changed };
}

module.exports = { nextOrderReturnNumber, normalizeOrderBasedReturnNumbers, returnNumberBase, returnOrderReference, returnSlugBase, returnsWithPublicSlugs };
