# Category Save Performance

Category mutation preparation uses `readStateFields` for category settings and vendor mappings, plus aggregated category product statistics. It must not call `readCategoryState`: that older helper loads all entity documents and aggregates every product into one JSON value. On the production catalog this exhausted web-process resources and caused site-wide 504 responses.

Keep `skipInventory:true` on the base PostgreSQL read and `fallbackToLegacy:false` on the category document read. Preserve saved mappings and aggregate counts without hydrating products. This change does not refresh product records or publish listings.

Run `node scripts/test-category-save-projection.cjs` when changing this loader.
