# Walmart Marketplace

## Implemented scope

The React Channels workspace includes Walmart US seller-fulfilled integration. Production requests use `https://marketplace.walmartapis.com/v3/` with `WM_MARKET: us`; new-item feeds use `WALMART_US`. The `global-marketplace` documentation path is not an API endpoint. Use the US seller documentation linked below.

Implemented features:

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
3. Verification stays on Connection. Continue through **Features → Shipping → Categories → Review** to choose capabilities. Unsaved field edits survive background refreshes; Save applies only changed fields. Order import does not require catalog launch. Connection verification checks authentication and order-read access; item-write permissions are checked when used.
4. Shipping has **Download Walmart shipping nodes**, which reads the US fulfillment-center API and caches nodes per credentials/environment. Map an active node to an active physical warehouse for inventory updates. Categories has **Download and cache Walmart categories**, a worker job with visible status/count/version/time and a preserved last-good cache. It requests Product Type taxonomy version 5.0 unless an explicit version override is saved. Manage mappings in **Catalog → Categories**, choose **Walmart**, and open a category's Walmart tab. Search the cached product types, load required attributes, then save verified defaults. The main list displays the saved mapping and supports mapped/missing filters. Channel setup shows these same records as a read-only summary. Both screens and launch preparation read the dedicated `walmart_documents` records; no mapping is copied into shared category documents. No speculative compliance values are generated.
5. Import an order date range. Dates are UTC and the UI's end date is inclusive. Scheduled imports recheck the selected creation-date window; they are not an updated-at cursor and do not refresh orders older than that window. Use a wider manual range for those orders.
6. Select products in **Catalog → Products**, then choose **Actions → Launch on Walmart by UPC**. Preview one SKU, fix validation issues and verify the selling pack. Then submit the reviewed item. Batch launch prepares up to 100 SKUs through a job; load the review using its job ID and deliberately submit ready rows. Multipacks needing confirmation use single-item review.
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

- [US seller onboarding and authentication](https://developer.walmart.com/us-marketplace/docs/get-started-as-a-seller)
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

Setup API references: [US fulfillment centers](https://developer.walmart.com/us-marketplace/docs/get-all-fulfillment-centers), [US product-type taxonomy](https://developer.walmart.com/us-marketplace/reference/gettaxonomyresponse).

## Catalog UPC matching

Select catalog rows across pages, or all filtered products, then choose Actions > Match on Walmart by UPC. There is no 100-product selection limit; the worker stages keys and processes bounded batches, with 100-row result pages. The same action is available inside the product Walmart section. Matching queues a read-only `walmart-match` job; results appear automatically in the dialog and remain available as a Jobs artifact. It uses the saved UPC/EAN/GTIN with US SPEC search and does not require pricing, category defaults, or launch enablement. The channel must be enabled. Results distinguish existing-item offers, full item setup, no returned match, and per-SKU errors. A match does not link the seller SKU or publish a listing. Review launch separately; selling-pack checks still apply. Upgrade the external worker before running this new job type.

## Existing seller listing reconciliation

The Channels > Walmart > Features automatic-linking setting schedules `walmart-reconcile`. The worker downloads a complete US seller-item snapshot before linking. It matches exact case-sensitive seller SKU first, then unique checksum-valid UPC/EAN/GTIN with equivalent leading-zero padding. It never matches titles or brands. A local SKU represented anywhere in the seller snapshot is reserved for the exact SKU match. Conflicting identifiers/links, duplicate remote UPCs, ambiguous local UPCs and unknown/multiple-unit selling packs are review results, not automatic links.

Run `scripts/walmart-reconciliation-index.sql` with psql outside a transaction during deployment. The job updates only local `walmartListing` metadata, retains other channel fields and never creates products or publishes remote changes. It uses row locks, fresh identity checks and account-bound link evidence. All results are in Jobs artifacts; the reconciliation report retains the latest 100 rows and the job artifact contains the full results. Listing verification and inventory/price operations use the linked seller SKU. Order imports use exact catalog SKUs first, then verified seller links, preserving remote SKU/source-line identity and manual mappings. Reconciled products cannot accidentally launch a second offer through the launch preview. Sandbox reconciliation is rejected.

The external worker must be upgraded before `walmart-reconcile` or large selection staging can run. Do not simply resume an older paused worker. Tests: `node scripts/test-walmart-reconciliation.cjs --sql` (connection-local TEMP fixtures on local PostgreSQL), `node scripts/test-walmart-marketplace.cjs`, `node scripts/test-product-selling-status.cjs`, `node scripts/test-status-inventory.cjs --sql`.

Single-product UPC searches use synchronous `POST /api/walmart/match/single` and return the result directly, without creating or waiting for a worker job. The shared US identifier lookup, channel/account checks and API activity logging still apply. Multiple products and all-filtered selections continue through the worker.

Product Walmart > Launch on Walmart and UPC results > Review launch open an in-place modal. POST `launch/form` loads the US schema and defaults without creating a submission token. Offer/content fields use schema-driven controls; final draft-07 validation remains server-side. SKU and identifiers remain catalog-owned. An explicit launch price must meet the current channel-calculated price floor; arbitrary JSON price/identity changes remain ignored. Editing invalidates the reviewed token in the UI. Submission still uses the existing user-bound expiring preview and worker workflow.

Walmart identifier handling restores one leading zero on digit-only 11-digit UPC values, then validates the existing check digit. Complete UPC/EAN/GTIN strings retain their leading zeros. Invalid check digits, all-zero placeholders, letters, scientific notation and shorter ambiguous values remain blocked. Lookup, launch and seller reconciliation use the same normalization; raw source/catalog identifiers are not rewritten. Reconciliation searches the equivalent 11-digit stored value as well as padded forms, retaining ambiguity and selling-pack checks.

## Automatic listing links and catalog actions

Channels > Walmart > Features has an explicit, default-off **Automatically link existing Walmart listings** switch. After saving, the worker queues an account-bound reconciliation on its next scheduler check and daily thereafter, independently of order-import scheduling. Sandbox and disabled channels never schedule it. Disabling the feature blocks queued reconciliation and is rechecked before per-product writes; saved links remain. Jobs retains progress and review artifacts. Matching remains exact seller SKU first, unique validated UPC/GTIN second.

Catalog has one selection Actions menu. **Match on Walmart by UPC** searches the selection; **Launch on Walmart by UPC** opens the product launch dialog for one SKU or the existing review workflow for up to 100 selected SKUs. No extra Walmart-only page Actions menu is shown. Product-page launch remains available in its Walmart section.

## Catalog status filters

Catalog > Channel includes Walmart live, linked, linked/not live, submitted/awaiting publication, submission error, ready for launch review, setup incomplete, and not linked/submitted. These filter PostgreSQL before paging, including exact count and all-filtered selection. Publication requires PUBLISHED, excludes retired listings and ingestion errors, and is the latest saved Walmart observation. Feed ingestion success alone never counts as live.

Ready for launch review is a conservative catalog precheck: active, not discontinued, title, positive catalog price, checksum-valid identifier (including restored leading zero), positive weight, image, and a saved Walmart category mapping. It excludes linked/submitted SKUs. It does not assert Walmart approval or current supplier/shipping/channel eligibility. UPC-match offers may qualify during actual review even without a category mapping. Final review validates current pricing, supplier/shipping eligibility, schema and selling pack. Apply catalog-filter-indexes.sql concurrently during rollout.

## Bulk launch readiness assessments

Catalog selection Actions > Check Walmart readiness uses the bounded Walmart match worker for selected or all-filtered SKUs; one SKU runs immediately. Each SKU receives two independent assessments: existing-offer setup (requires an unambiguous MP_ITEM_MATCH response) and full new-item setup (validates local content/category defaults against the pinned MP_ITEM schema even when a match exists). Missing defaults, pack confirmation, pricing, supplier/shipping gates and linked/submitted identities block readiness. Lookup failures are distinct from no match. Checks never mint preview tokens, link seller SKUs, submit feeds or change inventory.

Results are saved in dedicated walmart.readiness documents and shown on the product Walmart panel with blockers and checked time. The panel invalidates assessments when product, category mapping, supplier data, channel settings, credentials or taxonomy version change; assessments expire after 24 hours. Catalog last-check filters distinguish existing-offer/new-item ready and needs-attention, no offer match and lookup error. They are historical assessments limited to the last 24 hours and exclude products edited or linked/submitted since checking; changes to other configuration still require rechecking. These filters never authorize publication. The launch modal always creates a fresh, user-bound review before submission. The older coarse readiness filter is labeled Basic catalog checks passed.

## Saved catalog references

UPC matching and bulk readiness keep SPEC as the launch-route authority and use a separate DEFAULT identifier lookup to obtain the Walmart item ID. Only a single result with a positive numeric ID is saved; absent, malformed or ambiguous IDs are reported without inventing a link or altering launch readiness. A canonical Walmart product URL is built from that validated ID. Both single and batch checks save catalog evidence in walmart.catalog-match documents, separately from walmartListing. The product Walmart panel shows the checked time, item ID and catalog link. Changed SKU/identifier/account/environment or references older than 24 hours require rechecking and hide the old link. Existing linked item IDs also have a product-page link. No catalog lookup sets publication status, seller SKU, price or stock. Empty SPEC objects are valid no-match responses per the US API docs.

## Primary launch route

For an MP_ITEM_MATCH result, existing-offer readiness is the primary launch status. Walmart owns the existing item's category; missing local Walmart category mapping only appears inside the collapsed new-item fallback details and never blocks that offer. The launch modal explains this distinction. Catalog launch-route filters select existingOffer.ready, or newItem.ready only when existingOffer.not_found; lookup errors cannot imply new-item eligibility. The coarse incomplete filter excludes recently checked ready offers. The separate new-item fallback filter remains available for operators preparing full item setup.


### Direct existing-catalog launch
Catalog selection Actions > Launch against existing Walmart catalog and the product Walmart section submit eligible offers without a review screen. POST `/api/walmart/launch/existing` queues `walmart-existing-launch`; explicit selections and all-filtered selections are staged in bounded batches without the reviewed preview limit. GET on the same route returns user/account-bound paginated results; Jobs retains per-SKU results and the downloadable artifact.

The worker checks seller SKU presence, searches identifiers and submits only `MP_ITEM_MATCH` with calculated channel pricing and schema validation. No match records `not_found` (new-item setup required), never silently switches to full `MP_ITEM`. Inactive, shipping-blocked and unconfirmed multipack products remain blocked. Existing seller SKUs are skipped for linking. Product locks and durable product-level intents also protect reviewed launches against duplicate submissions. Unknown acceptance requires reconciliation and cannot be retried by creating another job. Submission does not establish publication or publish positive inventory.


Product Walmart details show the verified publication status, availability, seller price, lifecycle, unpublished reasons, and linked numeric item ID. Refresh Walmart status reads the US seller item and lag-time APIs without publishing. Item ID fallback searches the remote item's identifier and rejects ambiguous results. Lag time is cached for one hour; negative or missing values remain unknown. Successful feed ingestion also refreshes publication and price, without consuming lag-time quota. Account-scoped snapshots live in `walmart_documents`; last-check times remain visible.
