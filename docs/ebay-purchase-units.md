# eBay Purchase Units

eBay uses `systemProductVariants` and the same vendor variation eligibility and
cost basis as Shopify. Channel markup and MAP/LAP protection remain eBay-specific.
Each and pack prices are calculated independently; no pack may price below its
equivalent Each total. A scalar manual price is rejected as ambiguous.

For multi-option products, the launch checks eBay listing-structure metadata and
taxonomy aspect constraints. A supported quantity aspect produces one inventory
item group. A confirmed unsupported category/quantity aspect produces separate
listings. Failed metadata requests block preparation, never trigger fallback.
Metadata is cached only within the current work database/job.

## Inventory and Identity

- The business selected Shopify's existing `export` stock behavior: both options
  receive the imported available quantity after channel/vendor safety rules.
  This is shared availability, not reserved stock allocated between options.
  It does not eliminate overselling risk between marketplace syncs.
- Variant SKUs follow the vendor-generated Shopify identities: base SKU for Each,
  `-4PC` for a four-pack. Aliases support indexed product lookup. Inventory/order
  matching retains the units-per-purchase multiplier.
- Child offers/listings are persisted in `ebayListing.variants`. Each accepted
  offer and publish result is checkpointed. Retries reuse saved identities and
  skip already-confirmed live children.
- Price/inventory sync and master-status zeroing address every child offer.
  Missing or failed acknowledgments are errors, not success.
- Catalog reconciliation updates the matched child without replacing the parent
  SKU with a pack SKU. The catalog displays how many options are live.

## Guardrails

Existing single listings require a deliberate migration; no automatic replacement
or duplicate launch. Changed variant identities, marketplace/category/structure,
custom parent SKUs, disconnected inventory and ambiguous manual prices require
review. Best Offer is blocked until per-option acceptance pricing is supported.
Generated selling units never reuse a source GTIN for a different unit count.
Required identifiers must be resolved before launch; unavailable identifiers are
used only when explicitly configured. Source package measurements are retained,
not guessed or reduced for Each.

Saving settings does not publish. The explicit launch action performs remote
writes. Readiness and the eBay workspace display option prices and quantities.
API behavior is covered with mock transport tests, not live publication tests.

Run `node scripts/test-ebay-purchase-units.cjs`, the inventory-safety,
status-inventory, product-selling-status and eBay-launch-readiness regressions,
plus the React TypeScript check when changing this workflow.

`node scripts/preview-ebay-purchase-units.mjs` serves an isolated UI fixture at
`http://127.0.0.1:5199/__ebay-preview` (`?dark` for dark mode). Its API responses are
synthetic and it cannot publish products. The workspace preview was checked at
desktop width and 390px mobile width before deployment.
