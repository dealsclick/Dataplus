-- Run with psql outside a transaction. These indexes keep identifier-first
-- product, order, and purchase-order lookups responsive as the tables grow.
CREATE INDEX CONCURRENTLY IF NOT EXISTS products_sku_lower_pattern_idx
  ON products (lower(sku) text_pattern_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS products_vendor_sku_lower_pattern_idx
  ON products (lower(vendor_sku) text_pattern_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS products_barcode_lower_pattern_idx
  ON products (lower(barcode) text_pattern_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS products_mfr_part_number_lower_pattern_idx
  ON products (lower(mfr_part_number) text_pattern_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS product_aliases_alias_lower_pattern_idx
  ON product_aliases (lower(alias_sku) text_pattern_ops)
  WHERE active = true;
CREATE INDEX CONCURRENTLY IF NOT EXISTS order_records_order_number_lower_pattern_idx
  ON order_records (lower(order_number) text_pattern_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS order_records_internal_number_lower_pattern_idx
  ON order_records (lower(internal_order_number) text_pattern_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS order_records_marketplace_order_lower_pattern_idx
  ON order_records (lower(marketplace_order_id) text_pattern_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS purchase_order_records_number_lower_pattern_idx
  ON purchase_order_records (lower(po_number) text_pattern_ops);
