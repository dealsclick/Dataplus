-- Run with psql outside a transaction; never build this in an API request.
CREATE INDEX CONCURRENTLY IF NOT EXISTS product_dump_commercial_source_sku_lower_idx
ON product_dump_commercial_fields (lower(source_sku)) INCLUDE (minimum_allowed_price);
