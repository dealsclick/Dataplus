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

module.exports = { nextOrderReturnNumber, returnNumberBase, returnOrderReference, returnSlugBase, returnsWithPublicSlugs };
