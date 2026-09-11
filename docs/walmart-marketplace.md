# Walmart Marketplace

## Implemented scope

The React Channels workspace includes Walmart US seller-fulfilled integration:

- Runtime client-credentials authentication, expiring token cache, request timeouts, read retries, and API activity logging.
- Manual and scheduled paginated order imports with stable purchase-order/source-line identity, internal numbering, cancellation/shipment quantities, and preservation of local operational work.
- Versioned taxonomy refresh and deliberate master-category to Walmart product-type mappings with offer/content defaults.
- UPC, EAN and GTIN checksum validation and Walmart SPEC search. Existing catalog items use `MP_ITEM_MATCH`; full-item setup uses `MP_ITEM` and the mapped product type. Leading zeros are preserved. Multipack identity must be explicitly confirmed.
- JSON Schema draft-07 validation, including required fields, enums, formats and conditional requirements. Per-item attributes may fill gaps without changing SKU, identifier or calculated price.
- Single-item and bounded 100-SKU batch launch review. User-bound previews expire in 30 minutes. Product, mapping, rules, environment and supplier/shipping eligibility are checked again at execution.
- Durable feed submission intent, feed ID retention and paginated item-level ingestion results. Interrupted writes are not automatically replayed. Seller-item status checks distinguish ingestion from publication.
- Reviewed single-SKU price and physical-inventory updates. Physical warehouse and ship node must be explicitly mapped. Inventory uses available physical units divided by pack size, minus safety stock, with an optional cap; inactive/discontinued/retired suppliers or blocked shipping send zero.
- Reviewed order acknowledgment and upload of completed DataPlus shipments. Tracking requires exact source line identities and sufficient remotely acknowledged quantity. These actions can notify customers through Walmart.
- Worker jobs, progress, stop checks, duplicate prevention, downloadable NDJSON artifacts and the existing channel activity ledger.

## Setup

1. Deploy the API and worker from the same revision and run the normal database initialization. It creates the dedicated `walmart_documents` table. This table is intentionally excluded from general application-state reads/writes and other marketplaces' category mappings.
Run `scripts/register-walmart-channel.sql` against the existing operational PostgreSQL database to register the disabled channel in an existing installation. It preserves existing channel settings and records registration in the activity ledger.

2. Open **Channels → Walmart → Connection** and enter Client ID and Client secret. Select Direct seller, or Walmart-assigned channel ID and enter the Consumer Channel Type supplied during onboarding. Save credentials, then **Enable and verify connection**. The secret stays masked, blank preserves it, and a changed client ID requires its matching secret. Credentials are stored in the shared server-only `data/walmart-runtime-credentials.json` file with restricted permissions, outside channel settings and job payloads. Server and worker read changes without restarting. Environment variables remain a fallback when no UI credentials are saved for that environment.
3. Successful verification opens **Initial catalog launch**. Review Rules, explicitly enable launch previews, then enter the first SKU. Saving credentials or verifying access does not publish products. Connection verification checks authentication and order-read access; item-write permissions are checked when used. Production and sandbox credentials remain separate. Credential changes invalidate verified status and queued jobs.
4. Enter the current item spec version from Walmart's developer portal. Refresh taxonomy through Actions. Search a product type, load requirements, and save verified defaults for the exact master-category name. No speculative compliance values are generated.
5. Import an order date range. Dates are UTC and the UI's end date is inclusive. Scheduled imports recheck the selected creation-date window; they are not an updated-at cursor and do not refresh orders older than that window. Use a wider manual range for those orders.
6. Preview one SKU, fix validation issues and verify the selling pack. Then submit the reviewed item. Batch launch prepares up to 100 SKUs through a job; load the review using its job ID and deliberately submit ready rows. Multipacks needing confirmation use single-item review.
7. Load the submission by SKU and check its feed. A successful submission job only means a feed ID was obtained. Processing/compliance review remains pending until Walmart finishes; item ingestion success still does not certify publication.
8. Set a physical warehouse and Walmart ship node before reviewing inventory. Price and inventory updates are separate from launch. Order acknowledgment and tracking also require separate operation previews and confirmation.

## Sandbox and isolation

Select sandbox and configure `WALMART_SANDBOX_CLIENT_ID` / `WALMART_SANDBOX_CLIENT_SECRET` on both processes. Sandbox requests use `sandbox.walmartapis.com` with `WM_SANDBOX: v2`. Sandbox order imports only validate and report; they never create fulfillment orders. Scheduled order imports and operational order updates are production-only. Queued jobs fail if the channel/environment changes before execution.

This integration uses the existing legacy operational authorization boundary: only the original operational company has access. It does not enable Walmart operations for setup/reporting companies or unrelated tenants.

## Operational limits

This is not a claim of support for every Walmart API. The following remain outside this implementation:

- WFS, international markets, returns/refunds, cancellation uploads, promotions/repricers, settlement reconciliation, shipping-label purchase and webhooks.
- Positive supplier-feed inventory, multi-ship-node allocation, periodic price/inventory synchronization for active products. The status-inventory coordinator supports Walmart zero-only protection for exactly linked seller SKUs, rechecking every reported ship node and surfacing incomplete zeroing as needs-attention.
- Catalog-wide automatic category approval, automatic retries of ambiguous mutations, and automatic listing publication verification. Feed ingestion polling is automatic (15 minutes, with backoff up to four hours) unless disabled in Rules.
- A visual editor for every possible Walmart schema construct. Category controls support required fields, enums, numbers, booleans and nested objects; arrays and complex conditional structures use the advanced JSON editor. Every launch still receives full server-side schema validation.

Unshipped orders retain an `Authorized` financial state rather than inventing captured payment. The generic paid-order automation may require operator review for these orders. Source costs remain unknown unless existing line cost evidence is available.

Existing local operational edits survive import, but source quantities and statuses are refreshed. Inventory publication does not change local stock. Imported seller orders are not automatically acknowledged. A feed submission or an item-ingestion success must never be presented as proof that a listing is live.

If a preview shows `submitting` after a timeout/restart, inspect Walmart Seller Center/feeds and the recorded correlation ID before taking further action. Do not blindly resubmit. Review data stays in `walmart_documents`; job artifacts follow the normal artifact retention process. Review-document retention/compaction is a follow-up maintenance concern.

## Verification

```powershell
node scripts/test-walmart-marketplace.cjs
node scripts/test-status-inventory.cjs --sql
node scripts/test-product-selling-status.cjs
npm run web:build
git diff --check
```

The automated suite uses mocked HTTP and persistence, never live seller credentials or production fixtures. It covers identifiers, money/partial quantities, conditional schemas, channel gates, token caching, pagination, repeated imports, mutation replay prevention, stale previews, sandbox separation, physical inventory/UOM and tracking quantity limits. Live seller certification still requires a configured account and reviewed sandbox/production checks.

## References

- [Marketplace introduction and authentication](https://developer.walmart.com/global-marketplace/docs/introduction-to-walmart-marketplace-apis)
- [All orders](https://developer.walmart.com/us-marketplace/docs/get-all-orders)
- [Item search and SPEC matching](https://developer.walmart.com/us-marketplace/docs/item-search-for-the-walmart-catalog)
- [Offer setup by match](https://developer.walmart.com/us-marketplace/docs/create-an-offer-for-an-existing-walmart-item)
- [Taxonomy structure](https://developer.walmart.com/us-marketplace/docs/understanding-the-requirements-for-listing-an-item)
- [Get item setup requirements](https://developer.walmart.com/us-marketplace/docs/get-item-setup-requirements)
- [Feed item status](https://developer.walmart.com/us-marketplace/docs/feed-item-status-api)
- [Inventory update](https://developer.walmart.com/us-marketplace/reference/updateinventoryforanitem)
- [Price update](https://developer.walmart.com/us-marketplace/reference/updateprice)
- [Order acknowledgment](https://developer.walmart.com/us-marketplace/reference/acknowledgeorders)
- [Shipment upload](https://developer.walmart.com/us-marketplace/reference/shippingupdates)
