CREATE INDEX CONCURRENTLY IF NOT EXISTS product_supplier_links_source_sku_lower_idx
  ON product_supplier_links (lower(source_sku))
  WHERE nullif(btrim(source_sku), '') IS NOT NULL;
