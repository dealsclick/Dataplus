// Read projection only: Walmart mappings remain in walmart_documents.
function projectWalmartCategories(rows, mappings) {
  const byName = new Map(mappings.map(mapping => [String(mapping.category || '').trim().toLowerCase(), mapping]));
  return rows.map(row => {
    const saved = byName.get(String(row.name || '').trim().toLowerCase());
    const mapping = saved?.productType ? {
      categoryId: saved.productType, categoryPath: saved.path || saved.productType,
      taxonomyVersion: saved.version, status: 'mapped', matchSource: 'manual',
      reviewedBy: saved.approvedBy, reviewedAt: saved.updatedAt, updatedAt: saved.updatedAt
    } : {};
    const mappings = { ...row.mappings, walmart: mapping };
    return { ...row, mappings, mappingCount: Object.values(mappings).filter(value => value?.categoryId).length };
  });
}
module.exports = { projectWalmartCategories };
