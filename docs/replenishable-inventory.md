# Replenishable inventory

Replenishable inventory is a marketplace quantity policy. It never creates or changes physical warehouse stock.

## Quantity source

An enabled SKU resolves its target in this order:

1. Vendor replenishable rule and quantity when the SKU follows vendor rules.
2. SKU replenishable quantity when one is saved.
3. The selected channel's default replenishable quantity.

The policy can be limited to selected channels. An empty channel scope on an older record means all configured channels for backward compatibility. Replenishable quantity bypasses safety quantity, then the channel maximum sellable quantity caps the result.

## Safeguards

Replenishable inventory is sent as zero when the product is inactive or discontinued, the selected channel or SKU-channel status is inactive, the vendor is inactive or retired, the vendor explicitly reports the SKU unavailable, the latest known vendor inventory timestamp exceeds the channel limit, or the configured sales-velocity ceiling is exceeded. A missing feed timestamp is visible for review but does not block by itself.

The channel Rules tab controls safeguard behavior, feed age, velocity ceiling, default target, and maximum target. Shopify also has one dedicated replenishable location. Normal Shopify SKUs continue using the ordinary warehouse mapping.

When a Shopify location selection changes, the worker will not silently zero inventory at the previous location. A SKU with quantity remaining there is reported for location-migration review and skipped until an operator resolves that inventory.

## Operations

Catalog filters expose replenishable state, source, suspension, and channel scope. Selected rows support bulk enable/disable and source/channel selection. The product Replenishable tab previews physical availability, quantity source, target, maximum, final channel quantity, Shopify location, and last marketplace quantity observed.

Changing a rule saves local policy only. It does not publish a new listing. The next enabled channel inventory sync applies the policy and writes its normal job artifact.
