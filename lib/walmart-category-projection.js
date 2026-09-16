// Read projection only: Walmart mappings remain in walmart_documents.
function walmartReview(mapping, review) {
  if (mapping?.productType) return null;
  const candidate = mapping?.pendingSuggestion || review?.suggestion;
  if (!candidate && !review) return null;
  return {
    categoryId: candidate?.productType || candidate?.categoryId || '',
    categoryPath: candidate?.path || candidate?.categoryPath || '',
    taxonomyVersion: candidate?.version || candidate?.taxonomyVersion || '',
    confidence: review?.confidence ?? candidate?.confidence ?? null,
    rationale: review?.rationale || candidate?.rationale || '',
    warnings: review?.warnings || candidate?.warnings || [],
    reviewedAt: review?.correctedAt || review?.at || mapping?.reviewCorrectedAt || '',
    action: candidate ? 'suggest' : 'no_match'
  };
}

function projectWalmartCategories(rows, mappings, reviews = []) {
  const byName = new Map(mappings.map(mapping => [String(mapping.category || '').trim().toLowerCase(), mapping]));
  // Callers supply reviews newest first; retain the latest result per category.
  const latest = new Map();
  for (const review of reviews) {
    const key = String(review.category || '').trim().toLowerCase();
    if (!latest.has(key)) latest.set(key, review);
  }
  return rows.map(row => {
    const saved = byName.get(String(row.name || '').trim().toLowerCase());
    const pending = walmartReview(saved, latest.get(String(row.name || '').trim().toLowerCase()));
    const mapping = saved?.productType ? {
      categoryId: saved.productType, categoryPath: saved.path || saved.productType,
      taxonomyVersion: saved.version, status: 'mapped', matchSource: 'manual',
      reviewedBy: saved.approvedBy, reviewedAt: saved.updatedAt, updatedAt: saved.updatedAt
    } : pending ? { status: 'needs_review', pendingSuggestion: pending } : {};
    const mappings = { ...row.mappings, walmart: mapping };
    return { ...row, mappings, mappingCount: Object.values(mappings).filter(value => value?.categoryId).length };
  });
}
module.exports = { projectWalmartCategories, walmartReview };
