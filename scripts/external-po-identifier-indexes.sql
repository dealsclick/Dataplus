-- Run with psql outside a transaction. These expression indexes keep external
-- purchase-order MPN matching responsive when punctuation differs by source.
create index concurrently if not exists products_mfr_part_number_compact_idx
  on products ((regexp_replace(lower(coalesce(mfr_part_number, '')), '[^a-z0-9]', '', 'g')));

create index concurrently if not exists vendor_catalog_items_vendor_mpn_compact_idx
  on vendor_catalog_items (vendor_id, (regexp_replace(lower(coalesce(mfr_part_number, '')), '[^a-z0-9]', '', 'g')));

create index concurrently if not exists vendor_catalog_items_vendor_sku_compact_idx
  on vendor_catalog_items (vendor_id, (regexp_replace(lower(coalesce(vendor_sku, '')), '[^a-z0-9]', '', 'g')));

create index concurrently if not exists vendor_catalog_items_source_sku_compact_idx
  on vendor_catalog_items (vendor_id, (regexp_replace(lower(coalesce(source_sku, '')), '[^a-z0-9]', '', 'g')));

create index concurrently if not exists vendor_offers_vendor_sku_compact_idx
  on vendor_offers (vendor_id, (regexp_replace(lower(coalesce(vendor_sku, '')), '[^a-z0-9]', '', 'g')));
