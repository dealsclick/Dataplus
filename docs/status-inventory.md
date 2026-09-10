# Automatic Status Inventory Protection

PostgreSQL updates that change a catalog SKU to master inactive, or a supplier to inactive/retired, create a numbered Jobs record in the same transaction. A rolled-back status change cannot leave a queued job. Repeated inactive saves do not enqueue duplicates. Existing inactive records are not backfilled on deployment. JSON-only mode does not provide this automation.

The `status-inventory` worker processes primary-source products in keyset batches of 100. Each SKU/channel result is recorded in the channel ledger and a downloadable NDJSON artifact. Queued/running means pending; success means the linked-channel requests were accepted, not independent storefront verification. Warning means one or more channel actions still need attention. Disabled channels are never bypassed.

## Rules

- Master inactive: zero all exact linked channel SKUs regardless of local stock. Never modify local stock, reservations, orders, costs, listing identity or publication status.
- Supplier inactive/retired: suppress that primary source. Existing supplier guards now also recognize ordinary inactive suppliers. Catalog inclusion alone is not supplier deactivation.
- Alternate supplier relationships require review before automatic zeroing. No automatic source replacement or changes to approved alternate relationships.
- Supplier-only Shopify updates zero mapped supplier-feed locations. Physical or unmapped locations are preserved and reported for review. Master-inactive updates inspect every linked variant's locations, not just the default supplier location.
- Supplier-only eBay/Temu/Whatnot/TikTok updates zero only when there is no verified physical stock. Physical-stock allocation requires review; these jobs never publish positive stock.
- Shopify exact SKU and existing numeric pack SKU conventions are supported. Untracked inventory, continue-selling policy, missing matches, and more than 100 locations per variant require attention. Variants are paginated.
- eBay requires a working Inventory API SKU; listing IDs alone may require relinking. Missing/partial API acknowledgments are errors.
- Temu, Whatnot and TikTok use the existing exact-link zero adapters and their credential requirements.
- Unsupported links, disabled channels, missing credentials and sourcing exceptions are not automatically retried forever. Resolve the issue and Retry the Jobs record. Retry starts at the beginning; restart recovery resumes after the last completed product. Repeated zero writes are safe absolute assignments.
- Fresh status, supplier and channel switches are checked before writes. Reactivation cancels protection for that record with a review result; it never queues publication or positive inventory.

## Verification

`node scripts/test-status-inventory.cjs --sql` tests mocked marketplace writes plus transactional trigger fixtures. It connects explicitly to localhost PostgreSQL, creates an isolated schema inside a transaction and rolls it back. No marketplace calls are made by tests.

Implementation: `lib/status-inventory-schema.js`, `lib/status-inventory.js`, worker registration in `scripts/dataplus-worker.js`, server adapter in `server.js`.

API references: [Shopify quantity mutation](https://shopify.dev/docs/api/admin-graphql/latest/mutations/inventorysetquantities) and [eBay inventory/offer quantity behavior](https://www.developer.ebay.com/api-docs/sell/static/inventory/bulk-updates.html).
