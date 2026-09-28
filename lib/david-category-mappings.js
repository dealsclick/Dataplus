// Allowlisted, read-only mapping context. Never send category defaults or raw documents to AI.
function categoryMappingsForDavid(row = {}) {
  const mappings = {};
  for (const [channel, value] of Object.entries(row.mappings || {})) {
    if (!value || typeof value !== 'object') continue;
    mappings[channel] = {
      categoryId: String(value.categoryId || ''), categoryPath: String(value.categoryPath || ''),
      status: String(value.status || ''), matchSource: String(value.matchSource || ''),
      taxonomyVersion: String(value.taxonomyVersion || ''), updatedAt: String(value.updatedAt || value.reviewedAt || '')
    };
    if (channel === 'shopify' && value.googleCategory?.id) mappings.google = {
      categoryId: String(value.googleCategory.id), categoryPath: String(value.googleCategory.breadcrumb || value.googleCategory.fullName || ''),
      status: 'linked_reference', matchSource: 'shopify_taxonomy'
    };
  }
  return mappings;
}
function davidMappingSearch(rows, query = '', offset = 0, limit = 25) {
  const stop = new Set('a an the all any are as be by can category categories channel channels david do does for from has have how i in is it mapped mapping mappings me my of on please saved show tell that these this to us what which with you'.split(' '));
  const tokens = [...new Set(String(query).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])].filter(token => !stop.has(token));
  const counts = {};
  const ranked = rows.map(row => {
    const mappings = categoryMappingsForDavid(row);
    for (const [channel, mapping] of Object.entries(mappings)) {
      counts[channel] ||= { mapped: 0, unmapped: 0 };
      counts[channel][mapping.categoryId ? 'mapped' : 'unmapped']++;
    }
    const text = `${row.name} ${Object.entries(mappings).filter(([, value]) => value.categoryId).map(([key, value]) => `${key} ${value.categoryId} ${value.categoryPath}`).join(' ')}`.toLowerCase();
    return { id: row.id || row.categoryId, name: row.name, mappings, score: tokens.filter(token => text.includes(token)).length };
  }).filter(row => !tokens.length || row.score > 0).sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)));
  const start = Math.max(0, Math.floor(Number(offset) || 0));
  const size = Math.max(1, Math.min(100, Math.floor(Number(limit) || 25)));
  return { source: 'saved_main_category_mappings', totalCategories: rows.length, channelCounts: counts, totalMatches: ranked.length, offset: start, hasMore: start + size < ranked.length, categories: ranked.slice(start, start + size).map(({ score, ...row }) => row) };
}
module.exports = { categoryMappingsForDavid, davidMappingSearch };
