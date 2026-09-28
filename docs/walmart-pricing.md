# Walmart pricing enrichment

Walmart seller-listing reconciliation and an explicit product listing refresh request an independent `walmart-pricing` background job when the account-wide cache is older than one hour. Linking and listing verification remain usable when pricing is absent or the pricing endpoint fails. This does not change live prices, publish offers, or enable repricing.

The US `POST /v3/price/getPricingInsights` endpoint is a read operation despite its HTTP method. The worker downloads one page per turn, caches rows by exact seller SKU plus channel/environment/credential identity, and yields for at least 35 seconds between calls. HTTP 429 respects Retry-After with a minimum one-minute wait. Paging and progress survive job retry. Jobs remain visible in the channel activity ledger; missing results are not invented or treated as zero. Old cached observations keep their original timestamps and appear outdated after one hour.

The product Walmart listing card displays Buy Box item and total prices, the competitor benchmark, Walmart suggested price and Buy Box win rate, alongside existing listing status, own current price and clickable item ID. UPC-linked products use their reconciled seller SKU to retrieve the correct pricing cache. Competitor benchmark is distinct from Buy Box pricing and can reflect pricing outside Walmart. These seller-catalog insights do not guarantee coverage for unlisted products.

Validation: `node scripts/test-walmart-pricing.cjs`, `node scripts/test-walmart-marketplace.cjs`, `node scripts/test-walmart-reconciliation.cjs --sql`, `node scripts/test-walmart-bulk-queue.cjs`, and `npm run web:build`.

US documentation: https://developer.walmart.com/us-marketplace/docs/get-pricing-insights and https://developer.walmart.com/us-marketplace/docs/rate-limiting.
