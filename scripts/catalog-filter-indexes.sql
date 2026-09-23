-- Run with psql outside a transaction. CONCURRENTLY preserves catalog writes.
-- Predicates match listProducts exactly, including legacy status fallbacks.
CREATE INDEX CONCURRENTLY IF NOT EXISTS products_ebay_missing_page_idx ON products (sku)
WHERE NOT (coalesce(raw #>> '{ebayListing,listingId}', raw ->> 'ebayId', '') <> ''
  OR coalesce(raw #>> '{ebayListing,ebayStatus}', raw #>> '{ebayListing,status}', '') = 'Live')
AND NOT (coalesce(raw #>> '{ebayListing,offerId}', '') <> ''
  OR coalesce(raw #>> '{ebayListing,ebayStatus}', raw #>> '{ebayListing,status}', '') = 'Offer');

CREATE INDEX CONCURRENTLY IF NOT EXISTS products_ebay_offer_page_idx ON products (sku)
WHERE (coalesce(raw #>> '{ebayListing,offerId}', '') <> ''
  OR coalesce(raw #>> '{ebayListing,ebayStatus}', raw #>> '{ebayListing,status}', '') = 'Offer')
AND NOT (coalesce(raw #>> '{ebayListing,listingId}', raw ->> 'ebayId', '') <> ''
  OR coalesce(raw #>> '{ebayListing,ebayStatus}', raw #>> '{ebayListing,status}', '') = 'Live');

CREATE INDEX CONCURRENTLY IF NOT EXISTS products_ebay_verified_live_page_idx ON products (sku)
WHERE coalesce(raw #>> '{ebayListing,listingId}', raw ->> 'ebayId', '') <> ''
  AND coalesce(raw #>> '{ebayListing,liveVerifiedAt}', '') <> ''
  AND lower(coalesce(raw #>> '{ebayListing,liveState}', '')) = 'live'
  AND lower(coalesce(raw #>> '{ebayListing,ebayStatus}', raw #>> '{ebayListing,status}', '')) IN ('active', 'live', 'published');

CREATE INDEX CONCURRENTLY IF NOT EXISTS products_ebay_unverified_page_idx ON products (sku)
WHERE coalesce(raw #>> '{ebayListing,listingId}', raw ->> 'ebayId', '') <> ''
  AND NOT (
    coalesce(raw #>> '{ebayListing,liveVerifiedAt}', '') <> ''
    AND lower(coalesce(raw #>> '{ebayListing,liveState}', '')) = 'live'
    AND lower(coalesce(raw #>> '{ebayListing,ebayStatus}', raw #>> '{ebayListing,status}', '')) IN ('active', 'live', 'published')
  );

CREATE INDEX CONCURRENTLY IF NOT EXISTS products_ebay_offer_verified_page_idx ON products (sku)
WHERE coalesce(raw #>> '{ebayListing,listingId}', raw ->> 'ebayId', '') = ''
  AND (
    coalesce(raw #>> '{ebayListing,offerId}', '') <> ''
    OR coalesce(raw #>> '{ebayListing,ebayStatus}', raw #>> '{ebayListing,status}', '') = 'Offer'
  );

CREATE INDEX CONCURRENTLY IF NOT EXISTS products_ebay_missing_verified_page_idx ON products (sku)
WHERE coalesce(raw ->> 'ebayId', raw #>> '{ebayListing,listingId}', raw #>> '{ebayListing,offerId}', '') = ''
  AND lower(coalesce(raw #>> '{ebayListing,ebayStatus}', raw #>> '{ebayListing,status}', '')) NOT IN ('live', 'active', 'offer', 'draft', 'unpublished', 'published');

CREATE INDEX CONCURRENTLY IF NOT EXISTS products_creation_source_date_idx ON products
  (lower(coalesce(raw ->> 'createdSource', raw ->> 'creationSource', 'legacy catalog import')), created_at, sku);
CREATE INDEX CONCURRENTLY IF NOT EXISTS products_created_page_idx ON products (created_at, sku);

CREATE INDEX CONCURRENTLY IF NOT EXISTS category_channel_mapping_lookup_idx ON category_channel_mappings
  (lower(coalesce(channel, '')), lower(coalesce(category_name, '')))
  WHERE coalesce(channel_category_id, '') <> '' AND lower(coalesce(status, 'mapped')) NOT IN ('blocked', 'denied', 'missing');

ANALYZE products;
ANALYZE category_channel_mappings;

CREATE INDEX CONCURRENTLY IF NOT EXISTS walmart_mapping_catalog_lookup_idx ON walmart_documents
  (lower(btrim(data->>'category')))
  WHERE doc_key LIKE 'walmart.mapping.%' AND coalesce(data->>'productType','') <> ''
    AND coalesce(data->>'status','mapped') NOT IN ('blocked','denied','missing');
CREATE INDEX CONCURRENTLY IF NOT EXISTS products_walmart_linked_page_idx ON products (sku)
  WHERE coalesce(raw #>> '{walmartListing,sku}', '') <> '';
