# Channel pricing methods

Channel Rules exposes a shared pricing-method selector. Existing pricing rules is
the default and preserves legacy formulas, percentages, overrides and rounding.
Selecting Cost markup or Target gross margin uses the separate pricingPercent
field, initially 28, without rewriting legacy percentages. No production settings
are migrated and saving configuration does not create a repricing job. Existing
scheduled syncs may use newly selected rules on their next run.

- Markup: sell-unit cost * (1 + percentage / 100).
- Gross margin: sell-unit cost / (1 - percentage / 100).
- Explicit formulas round up to cents. eBay decorative rounding cannot reduce
  the calculated target. Gross margin excludes marketplace fees, shipping and
  overhead; it is not net profit.
- Shopify applies the selected formula before its freight allowance and protected
  price floor. The fast export uses the same formula.
- eBay channel defaults apply to inherited formulas; SKU-level policy/formula and
  manual-price overrides remain intact. Minimum prices and pack protections stay.
- Walmart keeps its catalog-price floor and protected minimums, individual-unit
  requirements, preview validation and explicit update workflow.
- Temu, Whatnot and TikTok expose configuration-only defaults where no automatic
  price calculation/sync integration exists. A saved setting is not a live sync.

Run scripts/test-channel-pricing-method.cjs,
scripts/test-shopify-freight-pricing.cjs and scripts/test-ebay-purchase-units.cjs.
