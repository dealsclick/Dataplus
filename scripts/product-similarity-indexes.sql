-- Apply with psql outside a transaction. CREATE INDEX CONCURRENTLY cannot run
-- inside a transaction block and must not be moved into request-time schema setup.

create index concurrently if not exists products_mfr_part_number_normalized_idx
  on products ((regexp_replace(lower(trim(coalesce(mfr_part_number, ''))), '[^a-z0-9]+', '', 'g')))
  where length(regexp_replace(lower(trim(coalesce(mfr_part_number, ''))), '[^a-z0-9]+', '', 'g')) >= 4;

create index concurrently if not exists products_vendor_sku_normalized_idx
  on products ((regexp_replace(lower(trim(coalesce(vendor_sku, ''))), '[^a-z0-9]+', '', 'g')))
  where length(regexp_replace(lower(trim(coalesce(vendor_sku, ''))), '[^a-z0-9]+', '', 'g')) >= 4;
