# Unified Category Channel Workspace

Category detail uses `CategoryMappingWorkspace` for Shopify, eBay and Walmart. The shared layout includes wrapped local/channel paths, cached search results, a draft indicator, requirements and one save footer. Selecting a search result never saves it. Save persists the mapping only; Save & update opens the existing reviewed local-product refresh flow for Shopify/eBay. Walmart retains its separate mapping API, schema defaults and explicit save; no unsupported product-refresh action is exposed.

Protected Shopify/eBay mappings cannot be replaced through search. Unlock and new AI review controls remain under Protection & review; existing pending suggestions are visible above taxonomy search without expanding anything. Taxonomy requirements are not shown for a replacement draft until it is saved. Channel-specific attributes and Shopify's Google reference remain intact. Mapping data and live marketplace listings are not changed by this UI release.

Walmart reads pending review results from its dedicated documents, including historical corrected suggestions. Category lists project pending proposals without counting them as approved mappings. The category tab shows confidence, rationale and warnings; Use suggestion selects a draft and Save explicitly approves through the taxonomy-validated Walmart endpoint. Unmatched results say No suggestion found. Existing approved mappings suppress older proposals. No new AI requests are made when viewing suggestions.

Page-selected Walmart bulk approvals use `/api/walmart/mapping/approve` with the exact proposal token shown to the user; normal saves require the GET mapping revision. Optimistic writes reject another user's edits, missing/changed suggestions and duplicate approvals. Approved mappings retain a bounded history and lock marker. The existing channel ledger records saves. Bulk progress remains visible after selection is cleared, with per-category errors. Walmart product refresh is not implemented and remains unavailable; approved mappings are used by future previews. No feeds are submitted by approval.

Shopify/eBay pending approvals require an explicit unlock for protected mappings and compare the displayed target and review timestamp. Wrong channels are rejected instead of falling through to eBay. Status labels distinguish Suggested, No match found, Not reviewed yet and Approved; repository matching is not attributed to David. Category detail constrains grid children and wraps long paths at narrow widths.

Verification: `node scripts/test-category-approval.cjs`, `node scripts/test-walmart-marketplace.cjs`, `node scripts/test-mapping-suggestions.cjs`, `node scripts/test-category-refresh-route.cjs`, and `node scripts/test-category-refresh-worker.cjs`. Approval/save checks use isolated in-memory fixtures, not speculative production approvals. Completion of new AI mapping remains dependent on provider quota; this UI fix does not resume a failed AI run or change billing/model settings.

Verify all three channels in light/dark mode at desktop and mobile widths. Confirm draft selection, discard, explicit save, lock enforcement, and long taxonomy-path wrapping. Do not resume marketplace jobs as part of a UI deployment.

The stored category summary index predates pending proposals. Read responses hydrate current saved mapping metadata from categorySettings, omitting bulky history and attribute arrays; no product statistics rebuild is needed. Compact projections must retain pendingSuggestion, confidence and lock state. This fixes review rows that previously showed Not mapped despite a saved proposal.
# Combined Taxonomy Picker

Single-category saves now read the indexed category summary and canonical setting only (plus channel connection context), then return one projected category. The editor merges that response instead of reloading the full category list. No order read or product-count aggregation belongs in the save request. This prevents catalog-size-dependent Shopify save timeouts. Regression: `scripts/test-category-save-targeted.cjs`.

Mapping saves invalidate response/requirements caches without scheduling a full product-statistics summary rebuild; current mappings are hydrated from canonical settings. Other category changes retain normal summary rebuilding.

Channel mapping profiles use a shared Search / browse dialog with lazy, paginated branches and debounced search. Results include full paths and can be expanded in place. Saved IDs have a green check; staged choices are amber. Use category only updates the editor draft; Save/Approve remains explicit. Cancel never writes. Protected Shopify/eBay mappings require unlocking before replacement.

Read-only endpoints: `/api/categories/taxonomy/{shopify|ebay|google}/tree` and `/api/walmart/taxonomy/tree`. They use cached taxonomy only, return at most 50 rows, and never call marketplaces, schedule jobs, or modify mappings. eBay permits only known leaf selections; synthetic ancestor nodes are navigation-only. Walmart selections are exact cached product types. Google currently browses cached Google references bundled with Shopify, not a complete independent Google taxonomy; the picker labels that limitation. Google reference choices save through the existing Shopify mapping workflow.

Run `node scripts/test-category-tree.cjs` for branch/search/selection and pagination checks.
