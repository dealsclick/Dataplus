# Walmart bulk existing-catalog launch

Catalog > select rows (or all filtered results) > Actions > Launch against existing Walmart catalog queues `walmart-bulk-launch`. No extra review is required: eligible matches are submitted at saved prices. Selecting all filtered results requires an available exact catalog count. Nothing launches merely by deploying this feature.

The worker stages the selection in 500-record pages, indexes existing seller SKUs once (selections of 100 or fewer use exact SKU checks instead), checks UPC/GTIN using DEFAULT search, and caches results for 24 hours per account and identifier. It submits MP_ITEM_MATCH v4.2 feeds of up to 1,000 offers and below 24 MiB. Existing seller listings and prior submissions are skipped. No match is recorded as not_found and requires separate new-item setup; it never causes automatic MP_ITEM creation. Catalog item IDs and links are retained when returned, and the existing-offer assessment is available through catalog readiness filters. New-item readiness remains a separate check.

Default pacing is 120 catalog searches/minute, 40 seller-list pages/minute, and 15 match feeds/hour. Response allowance headers and HTTP 429 can reduce those rates. Long waits requeue the same job with a scheduled resume time and lower queue priority, releasing the worker for orders. Short search waits remain inside the bounded 100-product preparation chunk. At 200,000 uncached identifiers, search alone has a theoretical minimum of about 28 hours; 200 full feeds require about 13.3 hours of submission allowance. Actual elapsed time includes preparation, worker sharing, retries and Walmart processing. These are separate stages, not a completion-time guarantee.

Selection, seller cursor, per-product preparation, feed intents and feed IDs are durable in walmart_documents. Retry the same failed job to retain progress. Rate limits resume automatically. A known rejected HTTP 429 is retryable; an interrupted/ambiguous submission is marked needs_reconciliation and is never blindly replayed. Account changes invalidate the run. Disabled channels, inactive/discontinued/retired-source products, pricing floors, shipping restrictions, selling-pack confirmation and schema validation still apply.

Feed polling records per-SKU ingestion results. Bulk feeds deliberately do not issue thousands of individual publication checks inside the polling job. Publication remains UNVERIFIED until a seller-listing reconciliation or explicit product Refresh verifies it. Enable existing-listing linking in Walmart settings for scheduled seller reconciliation. Feed acceptance/ingestion never means the offer is live or has saleable inventory. Standalone Match UPC and two-route readiness inspection still use their existing SPEC workflow; use the direct bulk launch action for this large-volume path.

A dedicated worker task prevents old workers from processing new bulk jobs during deployment. They remain queued until the compatible worker is installed. Claim scheduling has a rollback-only local PostgreSQL test.

Validation:
- node scripts/test-walmart-marketplace.cjs (1,201 offers / two feeds, accepted-feed recovery, rejected-429 retry and existing launch gates)
- node scripts/test-walmart-bulk-launch.cjs (durable pacing, chunk resume, grouping, completion idempotence)
- node scripts/test-walmart-bulk-queue.cjs (local temporary PostgreSQL fixtures)
- npm run web:build

Walmart US references: https://developer.walmart.com/us-marketplace/docs/rate-limiting and https://developer.walmart.com/us-marketplace/docs/bulk-item-setup-1. Published quotas are ceilings; account responses govern actual allowance.
