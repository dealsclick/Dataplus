-- Run with psql outside a transaction. These expressions must match
-- findBarcodeMatches in db.js. Keep all four: one unindexed OR branch can
-- cause an unknown scan to read the entire managed catalog.
CREATE INDEX CONCURRENTLY IF NOT EXISTS products_scan_barcode_normalized_idx
  ON products ((lower(regexp_replace(coalesce(barcode, ''), '[^0-9A-Za-z]', '', 'g'))));
CREATE INDEX CONCURRENTLY IF NOT EXISTS products_scan_upc_normalized_idx
  ON products ((lower(regexp_replace(coalesce(raw ->> 'upc', ''), '[^0-9A-Za-z]', '', 'g'))));
CREATE INDEX CONCURRENTLY IF NOT EXISTS products_scan_gtin_normalized_idx
  ON products ((lower(regexp_replace(coalesce(raw ->> 'gtin', ''), '[^0-9A-Za-z]', '', 'g'))));
CREATE INDEX CONCURRENTLY IF NOT EXISTS products_scan_upc_code_normalized_idx
  ON products ((lower(regexp_replace(coalesce(raw ->> 'upcCode', ''), '[^0-9A-Za-z]', '', 'g'))));
