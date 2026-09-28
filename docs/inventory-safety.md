# Inventory safety quantity

Vendor profile > Inventory > Inventory rules has a Safety quantity override.
Blank/null inherits the channel setting. Zero explicitly overrides the channel
reserve with zero. Values must be non-negative whole numbers.

Product edit > Replenishable has a Bypass safety quantity switch. Resolution is:
SKU bypass (zero), otherwise vendor override, otherwise existing channel safety.
Reserves replace rather than add to one another. Negative results clamp to zero.
Vendor overrides also apply to fixed/manual quantities. Existing channel fixed
quantity behavior is preserved when no vendor override exists.

Implemented consumers: Shopify inventory worker, warehouse mapping preview and
exports, eBay listing/sync configuration, and Walmart inventory calculation.
Existing quantity/UOM conversion conventions remain unchanged. Shopify's dump
worker subtracts before optional pack division; Walmart subtracts in selling units.
Unsupported channel workers are not enabled by this feature.

This changes outbound quantities only, never physical/source stock or reservations.
SKU bypass does not remove inactive, retirement, disabled-channel or shipping gates.
Saving does not launch products or immediately update a marketplace; the next
inventory operation uses the settings. Running jobs may retain their starting snapshot.

Run `node scripts/test-inventory-safety.cjs` and
`node scripts/test-product-selling-status.cjs` after modifying this behavior.
