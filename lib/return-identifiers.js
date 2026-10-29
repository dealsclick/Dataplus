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

function normalizeSequentialReturnNumbers(records = [], migratedAt = new Date().toISOString()) {
  const rows = Array.isArray(records) ? records : [];
  const ordered = rows
    .slice()
    .sort((left, right) => String(left.createdAt || left.updatedAt || "").localeCompare(String(right.createdAt || right.updatedAt || "")) || String(left.id || "").localeCompare(String(right.id || "")));
  const desiredByRecord = new Map();
  ordered.forEach((record, index) => desiredByRecord.set(record, `RET-${String(index + 1).padStart(5, "0")}`));
  let changed = 0;
  const normalized = rows.map((record) => {
    const desired = desiredByRecord.get(record);
    if (!desired || desired === String(record.returnNumber || "").trim().toUpperCase()) return record;
    changed += 1;
    const previousReturnNumbers = [...new Set([
      ...(Array.isArray(record.previousReturnNumbers) ? record.previousReturnNumbers : []),
      record.returnNumber
    ].map((value) => String(value || "").trim()).filter(Boolean))];
    return {
      ...record,
      ...(record.legacyReturnNumber || !record.returnNumber ? {} : { legacyReturnNumber: record.returnNumber }),
      previousReturnNumbers,
      returnNumber: desired,
      returnNumberMigratedAt: migratedAt,
      returnNumberMigrationReason: "Global sequential DataPlus return identifiers"
    };
  });
  return { records: normalized, changed };
}

module.exports = { normalizeSequentialReturnNumbers, returnSlugBase, returnsWithPublicSlugs };
