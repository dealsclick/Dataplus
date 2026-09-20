-- Run outside a transaction. Match the catalog predicate exactly.
CREATE INDEX CONCURRENTLY IF NOT EXISTS products_walmart_live_page_idx ON products (sku)
WHERE coalesce(raw #>> '{walmartListing,sku}', '') <> ''
  AND upper(coalesce(raw #>> '{walmartListing,publishedStatus}', '')) = 'PUBLISHED'
  AND upper(coalesce(raw #>> '{walmartListing,lifecycleStatus}', '')) <> 'RETIRED'
  AND upper(coalesce(raw #>> '{walmartListing,ingestionStatus}', '')) NOT IN ('DATA_ERROR','SYSTEM_ERROR','TIMEOUT_ERROR');
