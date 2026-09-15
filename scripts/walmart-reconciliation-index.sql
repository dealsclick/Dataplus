-- Run outside a transaction, before enabling reconciliation.
CREATE INDEX CONCURRENTLY IF NOT EXISTS products_walmart_seller_sku_idx ON products ((raw->'walmartListing'->>'sku'));
