# Channel minimum-price rules

Channel settings contain `mapPricingMode`: `protected` (default) or `calculated`.
Brand profiles expose the same choice plus `inherit`. SKU channel tabs expose an
independent override per connection ID, also with `inherit`. Resolution is SKU,
then exact normalized brand name, then channel, then protected. Brand matching
here is only for commercial policy, never product identity matching.

Protected prices use the maximum of the complete calculated total, MAP, LAP and
the source minimum allowed price. Calculated mode skips these advertised-price
floors; it does not remove channel cost or shipping calculations. Source evidence
is retained. No existing brand or SKU is automatically opted out.

For Shopify, calculated price is selling-unit cost times (1 + channel markup / 100)
plus the channel LTL allowance once for an LTL variant. Defaults are 28% and $250.
Freight is included before comparison with the floor, never added again to a
winning floor. Missing positive cost returns zero for review. Source floors are
converted to the variant quantity using vendor cost/UOM basis.

Shopify, eBay and Walmart calculators enforce the resolved rule. eBay applies the
floor after rounding and explicit/manual price selection. Walmart retains its
own markup/margin formula. Other channels do not expose a control until their
price writer supports enforcement.

Brand editor: Commercial. Channel editor: Rules/pricing. Product: channel tab,
Edit pricing rule. Saving affects future price calculations and syncs; it never
publishes a product. Inactive, discontinued, supplier and shipping gates remain
independent. SKU changes retain an actor/time history and channel activity entry.

GET/PATCH `/api/inventory/:sku/pricing-rule/:connectionId` returns the effective
rule and its source; PATCH requires product edit permission. Brand PATCH and
channel PATCH validate the mode. No datadump reimport is required.

Verification: `node scripts/test-channel-price-policy.cjs`,
`node scripts/test-shopify-freight-pricing.cjs`,
`node scripts/test-product-price-floors.cjs`, and the React TypeScript/build checks.
