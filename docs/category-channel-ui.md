# Unified Category Channel Workspace

Category detail uses `CategoryMappingWorkspace` for Shopify, eBay and Walmart. The shared layout includes wrapped local/channel paths, cached search results, a draft indicator, requirements and one save footer. Selecting a search result never saves it. Save persists the mapping only; Save & update opens the existing reviewed local-product refresh flow for Shopify/eBay. Walmart retains its separate mapping API, schema defaults and explicit save; no unsupported product-refresh action is exposed.

Protected Shopify/eBay mappings cannot be replaced through search. Their unlock and suggestion/AI review controls remain under Protection & review. Taxonomy requirements are not shown for a replacement draft until it is saved. Channel-specific attributes and Shopify's Google reference remain intact. Mapping data and live marketplace listings are not changed by this UI release.

Verify all three channels in light/dark mode at desktop and mobile widths. Confirm draft selection, discard, explicit save, lock enforcement, and long taxonomy-path wrapping. Do not resume marketplace jobs as part of a UI deployment.
