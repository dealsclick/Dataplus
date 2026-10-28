\set ON_ERROR_STOP on

insert into product_shadow_skus (
  shadow_id,
  product_id,
  shadow_sku,
  marketplace_sku,
  channel_sku,
  marketplace,
  active,
  raw,
  created_at,
  updated_at
)
select
  coalesce(
    nullif(shadow.value ->> 'id', ''),
    md5(concat_ws(':', p.product_id, shadow.value ->> 'shadowSku', shadow.value ->> 'marketplace', shadow.ordinality::text))
  ),
  p.product_id,
  coalesce(nullif(shadow.value ->> 'shadowSku', ''), shadow.value ->> 'sku'),
  coalesce(nullif(shadow.value ->> 'marketplaceSku', ''), nullif(shadow.value ->> 'externalSku', '')),
  nullif(shadow.value ->> 'channelSku', ''),
  coalesce(nullif(shadow.value ->> 'marketplace', ''), nullif(shadow.value ->> 'channel', ''), nullif(shadow.value ->> 'company', '')),
  lower(coalesce(shadow.value ->> 'active', 'true')) <> 'false'
    and lower(coalesce(shadow.value ->> 'status', '')) not in ('deleted', 'inactive'),
  shadow.value,
  now(),
  now()
from products p
cross join lateral jsonb_array_elements(
  case
    when jsonb_typeof(p.raw -> 'shadowSkus') = 'array' then p.raw -> 'shadowSkus'
    else '[]'::jsonb
  end
) with ordinality shadow(value, ordinality)
where coalesce(nullif(shadow.value ->> 'shadowSku', ''), shadow.value ->> 'sku', '') <> ''
on conflict (shadow_id) do update set
  product_id = excluded.product_id,
  shadow_sku = excluded.shadow_sku,
  marketplace_sku = excluded.marketplace_sku,
  channel_sku = excluded.channel_sku,
  marketplace = excluded.marketplace,
  active = excluded.active,
  raw = excluded.raw,
  updated_at = now();

analyze product_shadow_skus;
