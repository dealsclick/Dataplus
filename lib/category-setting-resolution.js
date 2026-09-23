function text(value) {
  return String(value || '').trim();
}

function categoryKey(row = {}) {
  return text(row.name || row.category).toLowerCase();
}

function channelMapping(row = {}, channel = 'ebay') {
  return row?.mappings?.[channel] || row?.[channel] || {};
}

function mappingScore(mapping = {}) {
  const categoryId = text(mapping.categoryId || mapping.ebayCategoryId);
  if (!categoryId) return mapping.pendingSuggestion?.categoryId ? 10 : 0;
  let score = 100;
  if (mapping.locked || mapping.protected) score += 50;
  if (['mapped', 'approved', 'auto_approved'].includes(text(mapping.status).toLowerCase())) score += 25;
  if (mapping.reviewedAt || mapping.reviewedBy) score += 10;
  if (mapping.categoryPath) score += 5;
  return score;
}

function preferredCategorySetting(rows = [], channel = 'ebay') {
  if (!rows.length) return null;
  const ranked = [...rows].sort((left, right) => {
    const score = mappingScore(channelMapping(right, channel)) - mappingScore(channelMapping(left, channel));
    if (score) return score;
    return text(right.updatedAt || right.createdAt).localeCompare(text(left.updatedAt || left.createdAt));
  });
  const base = ranked[0];
  const preferredMapping = channelMapping(base, channel);
  return {
    ...base,
    mappings: {
      ...(base.mappings || {}),
      [channel]: preferredMapping
    }
  };
}

function dedupeCategorySettings(rows = [], channel = 'ebay') {
  const grouped = new Map();
  for (const row of rows) {
    const key = categoryKey(row);
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return [...grouped.values()].map(group => preferredCategorySetting(group, channel)).filter(Boolean);
}

module.exports = { categoryKey, channelMapping, mappingScore, preferredCategorySetting, dedupeCategorySettings };
