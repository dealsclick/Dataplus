# Category Save Performance

Category mutation preparation uses `readStateFields` for category settings and vendor mappings, plus aggregated category product statistics. It must not call `readCategoryState`: that older helper loads all entity documents and aggregates every product into one JSON value. On the production catalog this exhausted web-process resources and caused site-wide 504 responses.

Keep `skipInventory:true` on the base PostgreSQL read and `fallbackToLegacy:false` on the category document read. Preserve saved mappings and aggregate counts without hydrating products. This change does not refresh product records or publish listings.

Run `node scripts/test-category-save-projection.cjs` when changing this loader.

PostgreSQL single and bulk affected-product refreshes use the external worker tasks `category-mapping-refresh` and `category-mapping-bulk-refresh`. Web timers are disabled for both paths, including startup recovery. Scheduling returns a job acknowledgment without a full app-state response. The worker claim respects the canonical UTC `scheduledFor` timestamp. Existing queued timer jobs are converted to worker tasks; interrupted running jobs are not silently replayed.

Refreshes use 100-product batches and check saved job status before writes. Pausing the external worker also pauses these refreshes. Deploy the updated worker before resuming category work; an older paused worker cannot claim the new task names. Run `node scripts/test-category-refresh-worker.cjs` and `node scripts/test-category-refresh-route.cjs`.
