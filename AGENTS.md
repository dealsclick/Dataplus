# DataPlus AI Development Guide

This repository is a production-oriented React application for catalog, marketplace, order, purchasing, inventory, warehouse, and automation workflows.

## Non-negotiable scope rule

The active application is the **new React application** under `web/`.

- Build and modify the new UI in `web/src/`.
- Use the shared backend in `server.js` and supporting modules under `lib/` and `scripts/` when an API or worker change is required.
- Do **not** add new features to `public/app.js`, `public/index.html`, or other legacy UI files.
- Do not copy a legacy screen into the new app without first checking whether the new React app already has a cleaner equivalent.
- The old UI is retained only as a fallback/reference during migration. It is not the destination for new work.
- Before editing, confirm the target component is imported by `web/src/App.tsx` and is reachable through the new app router.

## Organization and company migration

- Manual channels are company-owned sources configured on Channels or while choosing the source in Orders > Tools. They require no API credentials and never create marketplace sync jobs. New file uploads require a registered enabled channel ID; the server resolves its stable source key within the authorized company. Disabling blocks upload, preview, and confirmation, while existing reporting history and rollback remain accessible. Existing import sources are registered during migration without changing order identities. This does not change reporting imports into operational fulfillment orders.

- **Orders > Tools** at `/orders/tools` uses the full App shell without legacy state/job polling. Imports use the active session company shown in the top-bar company switcher. Query parameters never change company selection. Company-specific shortcuts authorize and select the company before opening Tools. Shipping-cost updates remain unsupported.

- Company setup is under Settings > Companies (`/settings?tab=companies`); `/organization` redirects there. APIs remain under `/api/organization`.
- A tenant is an organization containing multiple companies. Tenant membership and company access are separate from existing operation permissions. Never equate company IDs across tenants.
- Initialization is explicit and idempotent. It registers LINQ USA dba Dealsclick as the owner of existing operational data, creates BuySupply in setup/reporting mode, and preserves existing active staff access to LINQ. Only the initializing master admin becomes the organization owner; owners explicitly grant other company access.
- This is an incremental foundation, not completed SaaS isolation. Existing tables, authentication, workers, webhook/OAuth connections, and caches still serve LINQ only. Do not provision unrelated customer tenants or enable new-company operations until those paths are migrated and isolation-tested.
- New company records must never pass through global app_state, accounting, legacy jobs, or marketplace workers. Authenticated legacy API calls require LINQ access and reject another selected company. Do not bypass this boundary to make an unfinished screen work.
- The shared catalog is currently an allowlisted read projection of LINQ product identity/content for the original tenant only. Never expose raw product data, costs, supplier-account fields, prices, availability, or channel metadata through that projection. Other tenants cannot use this catalog bridge.
- Company SKU selections, vendor accounts, and negotiated costs use composite tenant/company keys. They do not update LINQ operational prices or historical sale costs. Cost UOM must be explicit; null is unknown and zero is a valid cost.
- Company setup mutation APIs currently require organization-owner access; members can view only their assigned companies. Access revocation is checked on each request.
- The company **Manual orders** module is available to LINQ, BuySupply, and future companies. It imports CSV/XLSX/XLS line exports into company-owned reporting records, never the live fulfillment/order-routing tables. Owners upload, map, preview, confirm, and roll back batches; members can view only assigned-company reports and history. Source identity is company + source system + source order + stable source line ID (SKU fallback only when unique in that order). Identical reimports skip; changed identities require review and rollback, never silent overwrite. Missing historical costs stay null; current catalog costs never fill them. Confirmation is bound to the saved preview token. Reported source profit is audit evidence, not the calculated margin.
- Run `node scripts/test-company-workspaces.cjs` with `COMPANY_TEST_DATABASE_URL` pointing to an isolated local database ending in `_company_test` when changing these boundaries. Never run isolation fixtures against production.

## Repository layout

- `web/src/App.tsx`: current React application, routes, page components, shared UI composition, and client API calls.
- `web/src/components/ui/`: shadcn/ui primitives and app-level component wrappers.
- `web/src/index.css`: current theme tokens, typography, layout, and responsive styles.
- `server.js`: HTTP API, PostgreSQL/JSON compatibility path, cache invalidation, marketplace actions, and worker job creation.
- `lib/`: backend services such as database access, data quality, marketplace integrations, and shared helpers.
- `scripts/dataplus-worker.js`: external worker for long-running jobs.
- `scripts/`: imports, indexes, maintenance, backups, and repair operations.
- `data/`: local development data and import state. Production source of truth is PostgreSQL when `DATABASE_URL` is configured.
- `outputs/`: generated reports and job artifacts. Do not treat generated output as source code.
- `public/`: legacy UI only. Do not extend it.
- `Dockerfile` and `docker-compose.yml`: container build and runtime configuration.

## Development and verification

Order batch persistence must use a checked-out PostgreSQL client for BEGIN, every write, COMMIT/ROLLBACK, and release. Validate duplicate order/line identities before destructive writes: identical snapshots may collapse; conflicting snapshots must fail with the identity for review. Earlier import batches may already be committed, so never blindly replay failed imports. Run `node scripts/test-order-batch.cjs` when changing this path.

Mapping-only saves and mapping lock changes use targeted category context and skip catalog statistics rebuilds. Web shutdown drains in-flight HTTP requests for up to 55 seconds; Compose allows 65 seconds and starts Node directly for signal delivery. This is not zero-downtime deployment or worker-job draining. Check active jobs before restarting workers. Run `node scripts/test-http-drain.cjs` and `node scripts/test-category-save-targeted.cjs` for these safeguards.

The current DigitalOcean production baseline is a Basic Premium Intel Droplet with 8 shared vCPUs, 16 GB RAM, and a 480 GB NVMe disk. `docker-compose.yml` is tuned for that host: PostgreSQL uses 2 GB shared buffers, a 10 GB effective cache estimate, 16 MB work memory, 512 MB maintenance memory, and 2 GB shared memory; the manual, background, and orders workers are capped at 2.5, 2.0, and 1.5 CPUs respectively with 3 GB memory ceilings. Preserve enough unreserved capacity for PostgreSQL, the web process, Redis, BookStack, and the operating system. Recheck live CPU, memory, query latency, and cgroup usage before increasing concurrency or these limits again. A larger host does not make single-threaded or marketplace-rate-limited jobs parallel automatically.

The new React entry point initializes Sentry browser error reporting through `web/src/monitoring.ts`. Reporting defaults to production builds; local verification is opt-in. Keep automatic personal-data collection, session replay, tracing, and logs disabled unless deliberately configured. Never expose Sentry auth tokens in `VITE_*` variables. See `docs/sentry.md` for build-time settings and verification; backend and worker instrumentation are separate.

Sentry source-map uploads are opt-in through the private build environment (`SENTRY_AUTH_TOKEN` and `SENTRY_PROJECT`, organization `buysupply` by default). Docker builds use the optional `docker-compose.sentry.yml` BuildKit secret; never pass the token as a build argument or runtime environment setting. Uploaded maps are removed from the served build, and ordinary builds without a token do not generate maps.

Run the new app locally:

```powershell
npm start
```

Build the React app:

```powershell
npm run web:build
```

The React build runs TypeScript first and then Vite. A native Tailwind compiler error on Windows can be an environment/dependency issue; run the TypeScript check directly from `web` to separate code errors from native build errors:

```powershell
cd web
.\node_modules\.bin\tsc.cmd -b --pretty false
```

Before finishing a change:

1. Run the TypeScript check.
2. Run `git diff --check`.
3. Verify the relevant API route exists in `server.js`.
4. Test the route in the new UI, not the legacy fallback.
5. Check desktop and narrow mobile layouts when the change touches tables, dialogs, camera/scanner flows, or fixed action areas.
6. Do not include unrelated `.agents/`, `skills-lock.json`, generated output, database files, or user changes in a commit.

## New UI design system rules

Category profile channel tabs show saved-mapping indicators (green check or red missing icon with accessible labels); draft selections never mark a channel saved. Overview lists saved channel mappings, including Google, in a wrapping table. Protected category pickers offer an explicit Unlock to edit action using the existing audited lock endpoint, preserve search/tree state, and stay read-only on failure. Google shares Shopify mapping protection. Unlocking never selects or saves a replacement automatically.

- Use the existing shadcn/ui primitives and patterns in `web/src/components/ui/`.
- Prefer `Button`, `DropdownMenu`, `Command`, `Dialog`, `AlertDialog`, `Tabs`, `Table`, `Sheet` only where appropriate, `ScrollArea`, `Collapsible`, `Tooltip`, `HoverCard`, `Popover`, `Calendar`, `DatePicker`, and `ResizablePanelGroup` over one-off controls.
- Use a consistent compact operations style: clear labels, dense tables, readable status badges, stable column widths, and predictable spacing.
- Use color to communicate state, not as decoration: green for ready/success/live, amber for review/warning, red for failed/blocked/not found, gray for disabled/not configured, and blue for primary actions or active navigation.
- Active tabs must have visible contrast in both light and dark modes.
- Use one contextual Actions command menu per page for page-level operations. Do not scatter duplicate action buttons across the page.
- Table bulk actions belong in the selection toolbar that appears when rows are selected. Row-specific actions belong in the row action menu.
- Detail-page actions belong near the page header or in the page Actions menu. Do not reintroduce the old floating action button unless a future product decision explicitly requires it.
- Do not use inline edits for complex product/order/vendor records. Use organized dialogs with tabs and an explicit Edit/Save flow.
- Product and marketplace images are clickable previews. Avoid making channel status icons open image zoom; channel icons should navigate to the listing when a listing URL exists.
- Every modal must be responsive. On mobile, use full-width/full-height or a drawer-style layout when the content requires it; keep primary actions visible above the device safe area.
- Never allow long labels, taxonomy paths, supplier names, or action groups to overflow their containers.

## Navigation and major workspaces

The new app is organized around these workspaces:

- Overview/dashboard
- Orders and order detail
- Fulfillment
- Purchasing and purchase-order detail
- Warehouse, receiving, bins, pick lists, and warehouse audits
- Catalog/products
- Vendors and vendor profile detail
- Brands
- Categories and vendor-category mappings
- Channels and channel detail/settings
- Jobs/operations
- AI assistant David
- System Settings
- Releases and Changes under System Settings, generated from repository history during deployment

Catalog sub-navigation includes Products, Import Review, SKU Changes, Categories, Vendor Mappings, Attributes, Attribute Groups, Inventory, Templates, and Readiness. The old separate Source Catalog UI is being unified into the new Catalog workspace; preserve source/provenance filters without restoring a separate legacy-only product screen.

## Catalog and product rules

The catalog is the approved operational product system. A product can have source records, marketplace records, aliases, variants, identifiers, and multiple supplier relationships.

### Product identity and supplier matching

Match and retain supplier coverage in this order:

1. Exact UPC/GTIN/identifier match.
2. Exact vendor SKU, source SKU, internal SKU, or approved explicit alias match.
3. Exact manufacturer part number match as a reviewable candidate unless another confirmed identifier also links the records.
4. Close match only as a reviewable suggestion; never silently merge it.

Brand is descriptive context only. It must never create, reject, or increase confidence in a supplier-product match because multiple suppliers may carry the same brands and supplier feeds may contain inconsistent brand text. Show every potential identifier-based supplier candidate with the matched UPC, MPN, vendor SKU, source SKU, and match basis so an operator can approve or reject uncertain relationships.

Products may belong to multiple suppliers. Show supplier coverage in the catalog and on the product detail page. Do not use a generic “Load alternates” workflow as the primary relationship model.

Supplier names are canonical display values. Feed codes such as `DIB`, `RZ`, `MAR`, and `MSC` are source identifiers that must map to the canonical supplier profile when known. Do not create duplicate supplier profiles just because a feed uses a code.

### Product detail

The React product editor saves through `PATCH /api/inventory/:sku?response=item`. This returns the persisted product without running the catalog-wide operational summary. Keep all validation, inventory ledger updates, inactive-inventory safeguards, and cache invalidation before confirmation. A client timeout is an uncertain result, not proof the save failed. Run `node scripts/test-product-save-response.cjs` when changing this path.

The product detail page should remain a complete workspace with organized tabs/sections for:

- Overview: SKU, title, supplier coverage, brand, manufacturer, identifiers, UOM, main category, vendor category, status, and creation provenance.
- Content: short/long descriptions, bullets, SEO, tags, and media.
- Commerce/pricing: cost, sell-unit cost, system price, live marketplace price, price formula, margins, last price update, and price source.
- Shipping: item and package dimensions, weight, dimensional weight, shipping classification, and ground/parcel/freight eligibility.
- Channels: per-channel listing identity, detected marketplace presence, status, published state, live price, live quantity, mapped category, and marketplace-specific fields.
- Inventory: quick availability by warehouse, reserved/allocated quantity, replenishable state, movement summary, and a link to full SKU inventory detail.
- Suppliers: all matched supplier records and the matching method.
- Variants, identifiers, aliases, changes/audit history, and complete data view where available.

SKU links open the full product page. A separate quick-view control may open a compact preview, but it must not replace the SKU link.

### Product provenance

Shipping classification rules live in System Settings > Catalog > Shipping classification. Selling classes are FedEx Ground eligible (`parcel`) and LTL (`ltl`), with missing/incomplete measurements retained as a review state. Ground defaults and maximum configurable ceilings are 108 in longest side, 165 in length plus girth, and 150 lb actual weight; exact limits are inclusive. Small/large parcel size and dimensional weight never block selling within these limits. Legacy oversize switches and overrides must not reintroduce a large-parcel selling block; re-evaluate old overrides against current measurements. Supplier freight requirements and deliberate LTL overrides remain respected. Ground overrides cannot bypass carrier limits or missing measurements. Do not mix partial package and item dimensions. Per-SKU overrides require a reason and timestamp. Channel LTL and missing-measurement controls remain independent. Ground eligibility does not imply free shipping: preserve separate paid/free shipping rules. Saving rules changes local classification and future sync decisions, not live listings immediately. Do not automatically publish newly eligible SKUs. Run scripts/test-shipping-classification.js when changing these rules.

Catalog creation dates use the Creation date calendar filter with explicit From/To selection and Apply/Clear actions. The end date is inclusive. Applying creation dates selects managed products; source-only records do not have product creation provenance. The Creation source filter includes Internal universal datadump for discovery-created products.

Catalog filtering selects a materialized page of IDs and sort keys before projecting product JSON/images. Preserve exact filtered counts, inclusive creation dates, and SKU tie-breaking. Apply `scripts/catalog-filter-indexes.sql` with psql outside a transaction during deployment; its concurrent partial eBay indexes and category lookup expression must match `listProducts` predicates. Do not build these large indexes synchronously in API requests. React catalog loads cancel superseded requests and ignore stale responses. Run `node scripts/test-catalog-filter-query.cjs` against local PostgreSQL (rollback-only fixtures) when changing this path.

The managed catalog loads rows before requesting exact totals through `countOnly=true`. HTTP requests enqueue/poll deduplicated in-process count work (one active query, bounded queue, 120-second read-only DB timeout). The UI polls queued/running work, cancels obsolete polling, retries transient network errors and offers Retry count after failure. Never show a failed count as zero or a full-catalog fallback. All-filtered selection requires a known count; rows and page selection remain usable. Successful counts are cached briefly; failures are not cached as totals. Apply `scripts/catalog-walmart-live-index.sql` concurrently outside a transaction and verify validity before deployment. Run `scripts/test-catalog-count-jobs.cjs` and `scripts/test-catalog-filter-query.cjs` for this path.

New SKUs must retain creation date, created by, creation source, and source detail. Examples include manual by user, DataWarehouse/DataPlus import, vendor FTP/API import, warehouse audit creation, and marketplace import.

### Pricing and UOM

- Supplier selling-unit permissions are configured in Vendor profile > Rules as `variationRules.sellingUnitMode`: existing defaults, supplier UOM only, individual only, case only, or individual and case. Explicit choices govern product-page options and Shopify/eBay launch units without changing source cost basis, UOM, or stock allocation. Supplier-specific UOM-only rules below remain the default unless deliberately overridden. Explicit Individual only or Individual and case permission overrides supplier purchasing minimums as an individual-selling restriction; inherited and supplier-UOM modes retain the restriction. Recorded purchasing multiples still define pack quantities (four four-packs consume sixteen units), and monetary minimum allowed prices remain enforced. Walmart is individual-only: block case-only suppliers, require individual UPC/GTIN confirmation for case-based sources, and never silently reprice an existing unverified case listing as an individual unit. See `docs/vendor-selling-units.md`; run the supplier-unit, eBay purchase-unit, Walmart selling-unit and pricing regression tests when changing this path.
- For an explicit supplier-UOM or case-only policy with one multi-unit eBay selling option, datadump inventory is individual-piece availability and eBay quantity is complete packs: `floor(available pieces / units per sale)`. Never export the piece count as the number of cases, and never advertise remainder pieces as a complete pack.

- Catalog Inactive is a master marketplace selling block. Shopify/eBay inventory sync and Shopify exports must send zero regardless of physical stock, replenishment, fixed/manual quantity or pack size; launches are blocked. Preserve local stock, reservations, supplier evidence and listing identities. PostgreSQL active-to-inactive updates atomically create a `status-inventory` job, including bulk/import writes. Supplier inactive/retired transitions create the same job scoped to primary-source products. See `docs/status-inventory.md` for safeguards and exceptions. Disabled channels, unmapped Shopify locations, untracked Shopify inventory and unsupported channel workers require explicit operator attention; never report them as successfully zeroed. Reactivation does not publish products. Run `node scripts/test-product-selling-status.cjs` and `node scripts/test-status-inventory.cjs --sql` when changing this gate; the latter uses rollback-only fixtures on local PostgreSQL.

- Pricing must use the vendor pricing rules and the product's UOM/package quantity.
- Cost basis and sell-unit calculations must be visible when possible.
- Never price a multi-pack below its comparable single-unit price when that would create a pricing inversion.
- Discontinued products must not be launched or pushed to a marketplace.
- Essendant rule: do not create Shopify variations; follow the vendor UOM only.
- True Value and other vendors may support individual and case-pack variants when the vendor rules allow it.
- Marketplace-specific formulas are configured in the channel settings, not hardcoded into a page.
- Every selling channel enforces the higher of its configured formula price or the quantity-adjusted MAP, LAP, and source minimum allowed price. Channel formula settings include formula mode, markup, minimum margin, absolute channel minimum, and rounding. Saving settings does not reprice live listings; reviewed launch or price-sync actions apply them.

## Vendor profile rules

Vendor `inventoryRules.safetyQty` overrides channel safety quantity; null/blank
inherits, and explicit zero is an override. Product `bypassSafetyQty` disables only
the safety reserve, never selling blocks. Keep outbound quantity consumers aligned
with `lib/inventory-safety.js`; do not mutate source stock. See
`docs/inventory-safety.md` and run `scripts/test-inventory-safety.cjs`.

Vendor profile settings are the reusable source of truth for imports, pricing, UOM/variation behavior, inventory/replenishment, purchasing, category mapping, and channel actions.

### Vendor status versus catalog inclusion

Vendor profile > Actions > Retire supplier is an explicit, preview-first PostgreSQL workflow. POST `/api/vendors/:id/retirement/preview` returns a user-bound 30-minute review; `/apply` requires the exact supplier name and a reason. Normalization must preserve `retirement`. A supplier guard and durable `supplier-retirement` job are persisted together. Ordinary edits cannot reactivate a retired supplier. The worker records primary-source product suppression in bounded batches without deleting products, source evidence, physical stock, orders, or POs. Feed schedules, replenishment, purchase demand, Shopify/eBay launch and quantity decisions honor retirement. Unverified alternate suppliers are review candidates, never automatic replacements. Shopify retirement zeroing is limited to supplier-feed locations; unknown or physical targets produce review errors. Local completion is a warning with channel sync still required: this workflow does not claim that live listings were updated. Operators separately run reviewed inventory syncs and resolve unsupported/disabled channels and open purchasing/customer orders. Run `node scripts/test-supplier-retirement.cjs` when modifying this workflow.

These are separate controls:

- **Vendor status**: Active or Inactive. It is changed in the new React vendor profile header using the Vendor status dropdown and saves through `PATCH /api/vendors/:id`.
- **Catalog inclusion**: Include supplier in catalog or not. It is configured under the vendor's Catalog & data section.
- **Marketplace coverage**: Separate from both status and catalog inclusion; it indicates detected channel records and listing coverage.

Do not collapse these meanings into one field. Future workflows should honor inactive vendors as unavailable for new sourcing, feed participation, purchasing, or launch preparation unless an explicit override is being performed.

Vendor profiles must support:

- Canonical name and feed/source codes.
- Contacts, address, payment terms, lead time, MOQ, notes, and product count.
- Pricing rules and minimum-price protection.
- Variation/UOM rules.
- Replenishable inventory default and quantity.
- Purchase-order automation, approval, budget, and overdue-reminder rules.
- Category mappings and “add as main category” workflow.
- Vendor-owned scheduled feed connection and status.
- FTP/API/email source configuration where applicable.
- Vendor-level enable/disable and catalog inclusion.

## Feed and DataWarehouse rules

DataWarehouse's universal Product Datadump comes from the business's internal system over FTP, not a vendor profile. It may contain many suppliers. FTP access alone does not imply access to its export generator.

PostgreSQL datadump jobs run catalog discovery before the existing source refresh by default (`discoverFirst: false` explicitly disables it). Discovery creates only new identities for active, catalog-enabled suppliers, honors the new-SKU creation switch, skips discontinued items, and defers possible identifier matches to the job's discovery artifact. It uses insert-only product writes, preserves existing listings and edits, and commits bounded batches so new products appear during the scan. Jobs show cumulative discovery counts and retain `discovery.ndjson` under the normal artifact retention policy. Discovery is not a completed inventory refresh and must not release downstream marketplace updates. The reconciliation phase still updates existing source rows only; discovery inserts new eligible source rows first. Benchmark with `--postgres-only --discover-first --discovery-only --dry-run --limit N` before changing resource limits. Import batches are capped at 1,000; do not assume a configured 5,000-row request is honored.

After a successful datadump creates new managed SKUs, DataPlus queues readiness checks for enabled eBay and Walmart channels scoped to that import's job ID. Shopify readiness is recalculated from the saved catalog records without an external API job. These checks are review-only and must never publish listings automatically. Catalog readiness summaries show exact totals across the active filters, not marketplace presence on the visible page.

Datadump discovery observes supplier identities before SKU eligibility filtering and registers missing profiles with catalog participation disabled for review. Existing supplier settings remain unchanged. Supplier counts and registrations are included in `discovery.ndjson`; dry runs do not save profiles. Use `scripts/audit-datadump-suppliers.cjs` against the exact job input to diagnose missing suppliers or SKUs. See `docs/datadump-supplier-discovery.md`.

Vendor profile > Actions > Refresh catalog from stored records queues `vendor-catalog-refresh` through `/api/vendors/:id/catalog-refresh`. This supplier-scoped PostgreSQL job inserts missing eligible identities only, preserves existing products, does not publish or sync channels, and produces per-SKU review results. Missing saved active status requires review; lean imports now retain active status. Recheck supplier eligibility/mapping between bounded batches. Run `scripts/test-vendor-catalog-refresh.cjs` and the isolated-local `scripts/test-vendor-catalog-refresh-postgres.cjs` when changing this path.

Treat its operations as distinct modes:

1. **Full import**: discover new records, update source/catalog records, and apply approved product changes.
2. **Refresh import**: focus on changed inventory, cost/price, active/discontinued status, and other changed fields.

Only changed SKUs should receive downstream changes. Use stable source keys, hashes/change detection, and idempotent upserts. Do not rewrite every product or create duplicate supplier/product records.

For each feed, preserve:

- Source/feed name and supplier mapping.
- FTP/API connection settings.
- File path and file format.
- DataPlus mapping profile.
- Import target.
- Full-import schedule and refresh schedule.
- Inventory update mode: disabled, dry-run, or apply.
- Price update mode: disabled, dry-run, or apply.
- Notes, last run, last job, and test-connection result.

Vendor-specific feeds are configured from the vendor profile and displayed in the scheduled feed registry. The universal DataWarehouse feed is configured under System Settings/Data sources and must not be represented as a vendor-owned feed.

Each canonical vendor with one or more mapped direct feeds has exactly one system-managed warehouse of type **Virtual Supplier Feed**. The warehouse is keyed to the vendor, aggregates all of that vendor's direct-feed IDs, follows the vendor's active/inactive status, and cannot be used for physical receiving, audits, bins, or transfers. Do not create one warehouse per feed or treat the universal DataWarehouse feed as vendor-owned.

Every long-running import must create a job with a visible numeric reference, progress, phase, worker, status, notes, artifacts, and retry/stop behavior. Full and refresh runs must not overlap for the same feed.

Jobs search and status filters are persistent while polling. A slower background response must never replace newer search results. Show each job once in the main result list; use a compact table on desktop and a detailed stacked row on mobile rather than a second duplicate active-job list.

Automatic marketplace inventory apply jobs must stop when the newest universal datadump attempt failed or is still incomplete, except Walmart. Walmart intentionally publishes the current persisted quantity in its configured inventory location regardless of datadump job status. A prior successful dump is not sufficient for other channels when a newer attempt failed; dry runs may continue for diagnosis, but stale supplier quantities must never be republished automatically outside this deliberate Walmart exception.

## Channels and marketplace rules

Category mapping profiles share a cached search-and-expand taxonomy picker. Branches/search results are paginated (50 rows); selecting a result stages a draft only, with Save/Approve required. Saved IDs display a green check; unsaved choices are amber. Never permit synthetic ancestor IDs or non-leaf eBay categories as selections. Google browsing currently covers Shopify's cached Google references and must disclose that it is not the full Google tree. Keep browse APIs read-only under the existing company/auth boundaries. Run `node scripts/test-category-tree.cjs` when changing this workflow.

Each marketplace channel has a master enable/disable switch. When a channel is disabled, all channel operations must be blocked: product launch, price updates, inventory updates, order import, status/fulfillment sync, webhooks, and marketplace notifications.

When enabled, individual settings govern each operation.

Every channel-related action belongs in the channel activity ledger, including API calls, settings changes, manual and scheduled jobs, webhooks, imports, launches, inventory and price updates, order actions, and fulfillment changes. Lightweight channel activity metadata is retained for 365 days. Large downloadable artifacts such as CSV exports and error files are retained for 7 days, while their parent activity and job records remain visible after file expiration.

Cross-channel inventory fan-out jobs use the destination channel in each child job title and file name. Preserve the originating order/import workflow as an `after <trigger>` context; never reuse the source channel's operation title for another channel's worker.

Partial relational projections are never authoritative replacements for operational orders or purchase orders. Generic state saves and channel tools must merge these records by stable ID. A full replacement requires an explicit replacement option, a current backup, and a deliberate migration or recovery procedure; limited reads such as `orderLimit` or `purchaseOrderLimit` must never delete records omitted from that read.

### Shopify

Shopify supports product launch/linking, status and publication checks, price sync, inventory sync, order import, order webhooks, fulfillment/tracking sync, returns/refunds, shipping profiles, delivery quotes, shipping-label readiness, label purchase/void flows, collections, taxonomy, and channel-specific product fields.

Shopify warehouse mappings are configured under the channel Rules tab. Each DataPlus inventory location maps independently to a Shopify location and can be changed without code or environment edits. The default supplier-feed mapping is `DataWarehouse` to Shopify `zSi Warehouse` (`gid://shopify/Location/108946260272`). This mapping controls where imported supplier availability is published; it does not convert supplier-feed stock into physical warehouse stock.

Shopify order imports must be filtered to native Shopify sources requested by the business, including Online Store, Shop, Draft-created orders, and POS. Do not import marketplace orders merely because eBay, Temu, or another marketplace is connected into Shopify.

Shopify API scope/auth failures must be visible as actionable errors. Do not claim a successful connection means every scope is available.

### eBay

Multi-option eBay launches reuse Shopify's vendor purchase-unit rules and cost basis, with eBay-specific prices. Group only when eBay metadata confirms a supported quantity variation; otherwise use separate child offers. Metadata failures must block, not cause fallback. Persist child identities/checkpoints, sync and zero every child, and preserve units-per-purchase in order matching. Existing single listings and changed variant identities require reviewed migration. The selected inventory behavior matches Shopify's default export mode (same imported available quantity for each option, after safety). See `docs/ebay-purchase-units.md` and run `scripts/test-ebay-purchase-units.cjs`. Never publish automatically as part of this change.

eBay launch workers must load authoritative category documents for the candidate
category names before checking readiness or blocked mappings. General lean state
does not include categorySettings. Preserve saved/locked mappings; never rebuild
them during launch. Catalog-selected jobs retain their query/filter snapshot and
revalidate exact product IDs, reporting stale selections as skipped. The catalog
eBay launch-candidate filter is a local prefilter, not eBay acceptance or full
item-specific validation. Run scripts/test-ebay-launch-readiness.cjs and the local
rollback-only scripts/test-catalog-filter-query.cjs when changing these paths.
Exact product-key lookups must bind only the SQL parameters present when
marketplace-ID matching is disabled. Run scripts/test-product-key-query.cjs
against local PostgreSQL after changing this lookup; fixtures use temporary
tables and rollback, never production.

eBay supports connection/authentication, health verification, order imports with configurable lookback, SKU/listing synchronization, price/inventory synchronization, fulfillment reconciliation, listing launch, lifecycle operations, catalog import, business-policy sync, compliance audit, and marketplace-specific product fields.

The eBay offers and live-status sync is a channel-owned scheduled reconciliation, enabled by default once daily at 02:00 server-local time and configurable in eBay Setup. The external worker checks schedules every minute, deduplicates queued/running `ebay-catalog-sync` jobs, and records scheduler outcomes in Jobs and the channel activity ledger. A manual Run now action starts the same workflow. Only a complete, uncapped GetMyeBaySelling feed may demote locally linked listings that are absent from eBay; failed, partial, or capped feeds preserve their prior live state.

Catalog eBay readiness has two deliberately different filters. Basic launch candidates use a fast local database precheck and must never be described as guaranteed publishable. Validated ready to launch contains only non-live SKUs that passed the same full launch validator used by the worker within the previous 24 hours. A review-mode listing job persists the assessment without publishing; launch still revalidates immediately before calling eBay because inventory, settings, mappings, and marketplace requirements may change.

The complete eBay marketplace category tree is persisted locally per marketplace and refreshed through a background job. Category mapping searches use this local index first; the channel settings show the tree version, category count, last refresh, and downloadable JSON/CSV job artifacts.

eBay product settings must support channel defaults with per-SKU overrides for:

- Default quantity versus actual inventory.
- Default pricing formula versus manual eBay price.
- Profit/margin visibility.
- Category and item specifics.
- Product identifiers.
- Payment, return, fulfillment/shipping policies.
- Listing format, condition, images, best offer, dispatch time, and out-of-stock behavior.

eBay launch pricing is always protected: use the higher of the calculated/manual eBay price or the quantity-adjusted imported MAP, LAP, and minimum allowed price. SKU or brand pricing modes must not bypass this eBay floor. An all-filtered launch snapshots the complete matching selection and processes it under one durable job in bounded checkpoints; the checkpoint size is not a total launch cap. Persist listing identities after each checkpoint so a stopped or retried large launch does not lose completed work. Honor eBay `Retry-After` responses and use bounded exponential backoff for throttled requests instead of immediately failing the remaining launch selection.

If a SKU exists on eBay, show a View on eBay action when a listing URL is available.

An eBay listing ID is historical identity, not proof that a listing is currently live. Count and filter a SKU as live only when a successful eBay publish response, a current Inventory API offer response, or a completed `GetMyeBaySelling` active-listing feed records an active/published remote status, `liveState: live`, `liveVerifiedAt`, and the verification source. A complete uncapped active-listing feed may mark previously stored listing IDs absent from the feed as not active; failed, disabled, incomplete, or capped feeds must never demote listings. Keep ended/unverified listing and offer IDs for audit, relinking, and direct marketplace lookup. eBay catalog-sync jobs must display the `GetMyeBaySelling` phase, page progress, completion state, and reconciliation count.

When eBay accepts an inventory item/offer but rejects the final publish step, preserve the offer ID as a prepared-not-live record and store a structured publish-block code, field, raw error, suggested fix, retryable flag, and timestamp. For package errors, DataPlus should prefer actual package/item weight when present and otherwise send calculated dimensional weight from complete package dimensions. Normalize legacy or local package labels such as box, MailingBoxes, poly mailer, envelope, and tube into supported eBay package type enum values before sending.

eBay's 24-hour validated-ready filter is a versioned DataPlus preflight result, not a cached shortcut around launch validation. A current preflight must verify the mapped category is a leaf in the cached marketplace taxonomy, load current category aspects and check required item specifics, reject malformed GTINs, require usable package weight or complete dimensions, and apply known limits from the selected fulfillment policy. Launch always repeats the same validator. Changing the validator version invalidates older ready assessments immediately.

eBay price/inventory sync must treat Inventory API `SKU not found` rows as per-SKU relink warnings, not as a fatal batch failure. Mark the SKU's eBay listing metadata with `inventoryApiSkuMissing` and `syncStatus: needs_relink` so operators know it is on eBay but cannot be updated through the Inventory API SKU currently saved in DataPlus. Catalog must include both Product Catalog filters for eBay sync warnings/needs relink and an eBay Sync Warnings review view separate from eBay Launch Blockers; it should show listing IDs, offer IDs, latest sync errors, relink warnings, retry actions, clear relink instructions, and a deliberate clear-after-review action so users can distinguish "live on eBay" from "live but DataPlus cannot sync it."

eBay UPC normalization may restore leading zeroes lost when numeric supplier feeds ingest UPCs, but only when the resulting 12-digit UPC passes the GS1 check digit. Readiness and publish payloads must use the same normalized value; invalid identifiers remain launch blockers.

eBay inventory jobs must hydrate current inventory-location rows before calculating quantity. The sellable basis combines supplier-feed/DataWarehouse and physical on-hand inventory, subtracts reservations once, then applies vendor/channel/SKU safety and maximum-quantity rules. Do not rely on a stale aggregate product quantity when inventory-location rows exist. A relink-only result completes with warnings rather than reporting the entire job as failed.

### Walmart Marketplace

Walmart lives in the new React Channels workspace (`WalmartChannel`, reachable from `App.tsx`) and `/api/walmart/*`. It starts disabled and is currently scoped to the existing LINQ operational boundary, US seller-fulfilled orders, and shared server-only runtime credentials entered in the Connection tab (environment credentials remain a fallback). Never store credentials in channel settings or return saved secrets to the browser. Credential writes require channels.settings credentials permission. Each environment has separate credentials; blank secrets preserve the saved value, changing client ID requires a new secret, and credential changes invalidate verification and queued work. Direct seller mode omits the optional channel header; assigned mode sends only the onboarding ID entered by the operator. Verification leads into a deliberate first-launch checklist and never submits listings automatically. Sandbox imports validate without creating operational orders. Walmart jobs run through the external worker (`walmart-orders`, `walmart-taxonomy`, `walmart-preview`, `walmart-launch`, `walmart-feed`, `walmart-update`). Dedicated `walmart_documents` hold mappings, versioned schemas, user-bound previews, submission intents and status, never general `app_state` or existing category mapping documents.

Catalog Walmart launch review has two explicit levels: basic launch candidates are fast local prechecks, while validated-ready results come from the full existing-offer and new-item readiness check and remain filterable for 24 hours unless product, supplier, mapping, credentials, taxonomy, or channel settings change. Bulk launch must revalidate before submission, materialize the selected catalog scope, and split eligible existing-catalog offers into restart-safe feeds of no more than 1,000 items. A submitted feed is awaiting Walmart ingestion and must never be labeled live until later status reconciliation confirms publication.

Positive stock is not a Walmart offer-creation requirement. Zero-stock and out-of-stock products may pass readiness and be created when their catalog, identifier, pricing, shipping, supplier, and schema requirements are valid. Launch payloads must not include positive inventory; Walmart inventory is sent later through the separate inventory-sync workflow and its channel rules.

Order intake creates missing purchase-order identities only, skipping existing identities before mapping or saving. Successful scheduled production runs advance an account-scoped creation-date checkpoint with a one-hour overlap; failed/stopped runs do not advance it. Manual ranges do not advance scheduled checkpoints. Persist progress after each checked order. Existing-order updates, acknowledgment and tracking remain separate actions. See `docs/order-intake-progress.md`. Tracking uses completed local shipments and rechecks remote acknowledged quantities. Unshipped orders are authorized, not evidence of captured payment.

Launch uses identifier search in SPEC format: `MP_ITEM_MATCH` for existing items or `MP_ITEM` with an approved master-category/product-type mapping and pinned Walmart schema. Validate draft-07 requirements, including conditionals; never invent compliance attributes. Multipacks require explicit confirmation that the identifier represents the selling pack. Single and up-to-100-SKU batch previews expire after 30 minutes and bind user, product, mapping, rules and environment. Persist intent before submission; interrupted/ambiguous writes must be reconciled, never blindly retried. Feed acceptance/ingestion is distinct from publication.

Reviewed inventory updates use one explicitly mapped active physical warehouse and Walmart ship node, subtract reservations/safety stock, and respect selling UOM and caps. Inactive/discontinued/retired-source or shipping-blocked products send zero. Supplier-feed positive stock is not implemented. The status-inventory worker zeroes every reported Walmart ship node for exactly linked seller SKUs; it rechecks switches, status and identity before each write and reports partial failures as needs-attention. Disabled channels and remaining supplier physical stock require review. Submitted feeds are polled with backoff; listing verification remains separate from ingestion. Reviewed price updates use channel rules and sell-unit cost. Run `node scripts/test-walmart-marketplace.cjs` for this integration. See `docs/walmart-marketplace.md` for setup, rollout limits and verification.

### Other channels

Temu order intake, status reconciliation and enrichment are separate jobs with independent configurable schedules and checkpoints. Intake only creates missing paid orders after an exact PostgreSQL identity check; status/enrichment never create orders or replace commerce/SKU mappings. New schedules default off. Preserve changed-only writes, bounded resume cursors, cancellation/channel guards and the shared single-active-job guard. Do not restore the old final full-order rewrite. See `docs/temu-order-jobs.md` and run `scripts/test-temu-order-phases.cjs` plus the Temu pagination/return-linking and source-completion tests for changes.

- Temu, Whatnot, and TikTok Shop have `inactive-inventory-*` worker jobs for master-inactive SKUs only. Channels > Actions provides Review inactive inventory and Zero inactive inventory; the marketplace inventory coordinator also queues these jobs. This is zero-only protection, not positive-stock sync, listing creation, OAuth onboarding, or automatic relinking. Jobs process bounded keyset batches, recheck catalog status and channel switches before each write, and expose per-SKU NDJSON results in Jobs. A partial failure is needs-attention, never a successful zero. No local stock is changed.
- These jobs require existing exact listing links: `channelInventoryLinks.temu` entries use productId (goods ID) and skuId; Whatnot uses listingId; TikTok uses productId, skuId, and all warehouseIds. Existing flat channel ProductId/SkuId/ListingId fields or channel Listing objects are accepted as single-link fallbacks, never inferred from titles. Temu clears ordinary and presale stock separately. Whatnot uses runtime `WHATNOT_ACCESS_TOKEN` or `WHATNOT_STAGING_ACCESS_TOKEN` according to channel environment. TikTok uses runtime `TIKTOK_APP_KEY`, `TIKTOK_APP_SECRET`, `TIKTOK_ACCESS_TOKEN`, `TIKTOK_SHOP_CIPHER`. Credentials remain server-only; no remote endpoints are user supplied. Enable the master channel switch and inventory sync before apply. Run `node scripts/test-inactive-channel-inventory.cjs` when changing these workers.

Temu, TikTok Shop, Whatnot, and future channels must follow the same shape: master channel gate, connection/settings tab, rules tab, mappings, product fields, import/export/sync actions, jobs, and channel logs. Do not force all marketplaces into Shopify's workflow.

### Marketplace status presentation

Catalog channel icons represent marketplace presence and state:

- Gray: channel is not enabled for the SKU.
- Green: SKU/listing is present and healthy/live.
- Red/amber: present but has an issue, is unpublished, or needs attention.
- The channel icon should link to the marketplace listing when available.
- Use a small status tooltip/popover with explicit actions such as Filter and View source/store. Do not let hover status open image zoom.

## Categories and taxonomy

General `writeRelationalState` saves must exclude both `categorySettings` and `ebayTaxonomyIndexes` entirely, including nonempty stale snapshots; only dedicated category/taxonomy writers may change them. Both Shopify auto-map and David review must preserve locked suggestions as well as approved/blocked/denied decisions. Locked suggestions remain pending, not approved; deliberate operator unlock/edit is required to reconsider them. The dedicated `category-mappings-protected-20260911.dump` backup is preserved outside normal rotating backup names, with an immutable DigitalOcean copy and a matching local outputs copy. Do not clear its immutable flag or remove it without explicit user authorization.

David background review can accept a per-job `autoApproveThreshold` down to 40% without changing global settings. Shopify review enriches approved mappings and pending suggestions with the bundled Google crosswalk where available; never invent a missing Google category. Existing mapped, locked, denied and blocked decisions are preserved. PostgreSQL review writes only the current category after reloading its saved decision, not a bulk stale snapshot. Run `node scripts/test-shopify-review-threshold.cjs` for these decisions.

The eBay local taxonomy auto-map job accepts an explicit per-run approval threshold down to 40%; this does not change the David review threshold. Locked, blocked and denied mappings are preserved even when refreshing old suggestions. Below-threshold and no-match results persist review records; approval does not turn a low confidence score into a high-confidence label. Mapping-only jobs must set `refreshAffectedProducts:false` and never publish listings.

PostgreSQL category document saves are upsert-only unless a deliberate deletion supplies `__replaceEntityCollections: ["categorySettings"]`. Empty or partial general state must not delete saved categories or the category mapping projection. Review saves persist only changed categories. General relational state saves exclude `ebayTaxonomyIndexes`; the dedicated taxonomy writer owns it. Run `node scripts/test-category-persistence.cjs` when changing these persistence boundaries.

The system category/master category is the canonical internal category. Vendor categories map into it. Channel taxonomies map from the master category.

- Main category is required for launch readiness where the channel requires it.
- Vendor category mappings are reusable for future imports.
- Shopify and Google taxonomy use the same taxonomy source in this application.
- eBay taxonomy and item specifics are separate channel mappings.
- Mappings must be editable and searchable, with full breadcrumb paths visible.
- “Map all to eBay”/similar bulk actions must be explicit, reviewable, and job-backed.
- Bulk eBay category mapping uses the locally cached eBay taxonomy. Matches at or above the configured automatic-approval threshold (75% by default) may be saved and locked automatically; lower-confidence matches must be persisted as approval suggestions. The job may refresh affected local SKU/channel metadata as a second phase, but it must not publish or change live marketplace listings.
- Category attributes and required channel fields belong in the category/channel mapping model, not scattered duplicate product fields.
- Do not silently replace an approved manual mapping with an AI suggestion.
- After a channel category mapping is saved, let the user keep the mapping only, refresh affected DataPlus records immediately, or snooze the refresh until a visible future time.
- Category refresh scope is explicit: existing SKU records, local channel records, or both. Every refresh is a durable job visible in Jobs and must survive an application restart.
- A category refresh updates DataPlus metadata and readiness only. It must not publish products or alter a live marketplace listing without a separate confirmed channel action.
- Single-category affected-product refresh requests must load the category workflow projection before resolving category IDs; inventory-less general state cannot resolve all master categories. Refresh jobs persist per-batch processed counts and skip repeated full-product totals. Run `node scripts/test-category-refresh-route.cjs` when changing this route.
- David can review all unlocked main-category mappings in a background worker using the locally cached Shopify/Google and eBay taxonomies.
- The configurable automatic approval threshold defaults to 75%. Suggestions at or above the threshold are applied and locked; lower-confidence or no-match results stay in the category approval queue.
- Background review must skip locked mappings and preserve approved manual mappings. Unlocking a mapping explicitly allows it to be reviewed or replaced again.
- Background category-review jobs must expose progress and auto-approved, pending-review, skipped, and error artifacts in Jobs.

## Orders, fulfillment, and purchasing

Orders have internal numbers separate from marketplace references. Preserve internal numbering rules: orders begin at the configured internal sequence (currently 1000), drafts use the draft sequence, and POs use the PO sequence (currently starting at PO#1001).

### Order workflow

The operational order queue is:

1. Processing: payment cleared and ready for inventory/work review.
2. Ready to ship: all required items are available or received and can be fulfilled.
3. Waiting for PO: one or more items require purchasing.
4. Shipped/fulfilled: shipment and tracking completed.
5. Hold, canceled, returned, or other exception states as applicable.

Order detail must include customer, billing, shipping, payments, line items, SKU/product match, supplier, cost, profit/loss, fulfillment, shipment/labels, POs, returns, documents, notes, channel, and activity timeline.

Use the order Actions command menu for refresh, cancel, archive/delete where allowed, fulfillment, refunds, returns, shipping quotes/labels, notifications, and PO creation. Cancellations must distinguish local-only from local plus channel notification.

Order routing is line-level and source-aware:

- Only available inventory in an active physical fulfillment warehouse may be reserved and released to fulfillment.
- Supplier-feed and DataWarehouse availability are sourcing signals. They create pooled purchase requirements and must never make an order ready to ship by themselves.
- Mixed orders retain one customer order while using separate fulfillment routes for physical-stock lines and supplier-purchase lines. The operational state is `split_fulfillment` until all routes are ready or completed.
- A route backed by physical stock enters fulfillment for pick, pack, and ship. A supplier route remains `waiting_for_po` until purchased inventory is received into a physical destination.
- True supplier drop shipping is a separate vendor-level permission and must not be inferred merely because a supplier reports stock.
- When automatic routing is enabled, newly imported or paid orders are evaluated by the background order-routing scheduler and recorded as visible Jobs work. Blocking sourcing exceptions pause automatic retries until an operator resolves the exception or manually reruns routing.
- Partial PO receipts immediately release only the received quantity for physical allocation. The unreceived balance remains attached to the supplier purchase route and linked customer order.

### Fulfillment and warehouse

Fulfillment is the operational workspace for pick lists, batches, scanning, packing, shipping labels, and shipment status. A pick list has its own ID and line-level picked status. Labels can be created only after required package data is complete and the relevant items are picked/selected.

Warehouse supports receiving, bins/locations, stock movement, audits, manual receiving, and inventory detail per SKU. Warehouse audits are independent records with warehouse, bin, user, scan lines, review status, photos, unknown UPC handling, and a final apply/review step.

Warehouse type is a controlled setting, not free text. Supported types are Physical Warehouse, Distribution Center, Fulfillment Center, Retail Store / Pickup, Returns Center, Cross-Dock, Overflow Storage, 3PL / Partner Warehouse, Transfer / In Transit, and Virtual Inventory Source. Physical types can support bins, receiving, and audits; transfer and virtual types cannot. The DataWarehouse supplier-feed location is a protected virtual source and its type cannot be changed from the UI.

Each warehouse has a dedicated workspace with Overview, Bins, Settings, and Activity views. Warehouse settings and bin changes must create warehouse-local activity events, while the Activity view also combines that history with inventory movements, receipts, and audits for the same location. Virtual supplier locations such as DataWarehouse do not use physical bins, receiving, or warehouse audits.

`DataWarehouse` is a virtual supplier-feed location, not a physical warehouse. All availability imported from the universal Product Datadump belongs to this location. Physical warehouse stock may only be created by a warehouse audit, PO receipt, return receipt, transfer, or explicit manual adjustment. Supplier-feed availability must never be allocated to orders as physical on-hand stock.

Inventory quantities must preserve their source and must never be blended silently:

- Physical stock comes only from warehouse receipts, transfers, audits, and adjustments tied to a warehouse/location.
- Supplier-feed availability is sourcing availability, not physical on-hand stock.
- Marketplace quantities are channel snapshots, not warehouse stock.
- Order allocations reserve physical warehouse stock and must show the order, warehouse, quantity, user/system actor, timestamp, and reason.
- Channel UOM variants such as `-12PC` must resolve to the base catalog SKU with the correct unit multiplier when calculating demand.
- Every receipt, adjustment, transfer, allocation, release, and fulfillment must append an inventory-ledger entry with before/after balances and provenance.

Audit scanner rules:

- Use the back camera by default where available, with a camera-switch control.
- Barcode scan should immediately look up the catalog and give visible feedback, vibration/sound according to user settings, and be ready for the next scan.
- Matched scans show a thumbnail, green check, clickable SKU, and preview/image enlargement.
- Unknown scans show a compact red X/Not Found state and allow manual SKU creation without forcing AI lookup.
- Manual SKU creation can use multiple photos and AI suggestions after all selected photos are present.
- Current bin/location is selected from a dropdown and is applied to new scan lines and created SKUs.
- Audit counts must be editable to correct overscans before submission.

## Purchase orders

The Purchasing workspace presents the buyer lifecycle as **Unassigned Orders -> Draft POs -> Ready to Send -> Sent -> Receiving -> History**. **Unassigned Orders** means a paid customer-order line has no safe supplier assignment yet. **Draft POs** are numbered documents that already exist and collect eligible customer demand until cutoff. At cutoff, the document moves to **Ready to Send**. **Needs approval** is a status inside Ready to Send, never a separate queue or purchase-order document status. Only records with approval completed or not required may be submitted. Raw line-level purchase requirements are audit records that support troubleshooting; they must not be presented as the primary buyer queue after they have been attached to a PO.

Purchase requirements are grouped by supplier. One customer order may link to multiple supplier POs. Show linked POs inside the order with PO number, supplier, status, date placed, expected date, items, quantities, and total.

PO line views must show the catalog SKU, manufacturer part number, vendor part number, and vendor SKU when available. Show the selected supplier as the primary value; when other eligible suppliers carry the same item, add a compact alternate count whose hover preview compares supplier inventory, vendor SKU, and unit cost. This comparison is informational. A buyer must use the explicit **Re-source open quantities** workflow to move unreceived demand to another supplier.

PO creation is available from:

- Bulk order selection.
- An individual order's Actions menu.
- Purchasing workspace.

Auto-PO creation is controlled by supplier profile rules and must respect approval thresholds, budgets, supplier status, and duplicate prevention.

Every eligible supplier purchase route immediately opens or appends to one numbered **Draft PO** per canonical supplier and physical receiving warehouse. Appends are idempotent: a customer-order route may appear only once in the draft. The same draft keeps collecting new orders and SKU quantities until it is submitted, placed, approved, rejected, canceled, or otherwise frozen; later demand then opens the next numbered draft.

Supplier profiles may define multiple weekly cutoff-to-delivery windows in their configured timezone. They also support supplier closure or holiday dates, temporary schedule overrides, buyer cutoff alerts, and a preview that includes unsaved settings. Each purchase requirement, route, and Draft PO stores the selected cutoff date/time and expected delivery date so the buyer can see whether the cutoff is upcoming or has passed. Vendors without a weekly calendar use the daily cutoff fallback. True Value's default calendar is Tuesday 4:00 PM for Wednesday delivery and Friday 4:00 PM for Monday delivery; orders received after Friday cutoff or over the weekend roll to Tuesday cutoff and Wednesday delivery.

The selected supplier cutoff automatically moves an open Draft PO into Ready to Send. Cutoff does not delay draft creation and does not bypass approval or submit the PO. Buyers control submission unless the supplier profile has an explicit auto-submit rule. Purchasing groups Draft POs by canonical supplier, and `/purchasing/waiting-for-po/:supplierKey` shows each numbered draft with its linked customer orders, SKUs, quantities, images, destination, cutoff state, expected delivery, cost, and review state.

PO receiving posts stock to the PO's physical destination warehouse, appends inventory provenance, and reroutes linked customer orders. Received lines may then reserve the new physical stock and move into fulfillment. Supplier POs must never use a virtual supplier-feed warehouse as their receiving destination.

PO re-sourcing moves only open, unreceived quantities to a linked replacement PO. Draft or unsubmitted originals may be superseded immediately. Submitted, acknowledged, or partially received POs require the buyer to confirm that the supplier-side order was canceled or adjusted before DataPlus creates the replacement.

Received quantities always remain on the original PO. Original and replacement POs, fulfillment routes, purchase requirements, and customer orders must retain bidirectional audit links. Superseded, canceled, rejected, closed, and deleted POs are excluded from the default active queue but remain available in PO History; do not physically delete them merely to reduce queue clutter.

## Jobs and workers

Jobs are the audit trail for imports, exports, syncs, scans, index rebuilds, backups, and marketplace actions.

- Jobs page has tabs for View all/queue and history, channel logs, and scheduled jobs.
- Scheduled tab lists every schedule and links to the owning settings page.
- Job detail is a new React page/side panel with numeric job ID, status, progress, rows, phase, worker, timestamps, status message, live worker output, operator notes, artifacts, CSV downloads, retry, and stop controls.
- Keep lightweight channel activity metadata for 365 days. Keep large downloadable job artifacts for 7 days, and preserve the parent job/activity record after artifact deletion.
- A queued/running duplicate for the same feed/channel operation should be prevented or reported as already queued.
- If a worker restarts, persist progress and mark the job for retry/review rather than silently losing it.
- Errors should be collected per row where possible, with an error CSV and a clear distinction between auto-fixable and human-review errors.
- Jobs should run in an external worker for large imports and marketplace syncs; do not hold a browser request open for a large task.
- Channel shipping protection uses the catalog shipping classification (`parcel`, `oversize_parcel`, `ltl`) to prevent unsafe selling. When enabled on a channel, LTL and oversize parcel SKUs can be forced to zero inventory for live listings, and blocked from launch when not already live; missing measurements are optional because they can affect broad catalog coverage.

## Releases and change history

- System Settings includes a Releases tab backed by `GET /api/system/releases`.
- `scripts/generate-release-history.js` generates `generated/release-history.json` from the complete Git history before a production container is rebuilt. The generated JSON is runtime data and must not be committed or edited by hand.
- Release history is grouped into human-readable daily releases while preserving the individual commits beneath each release for troubleshooting and auditability.
- Development may read Git history directly; production reads the generated manifest because `.git` is intentionally excluded from the image.
- Every production deployment must regenerate this manifest after pulling the target revision and before `docker compose build`.
- `scripts/write-deployment-status.js` records the live production revision, health, timestamps, and deployment duration in `generated/deployment-status.json`. This is runtime state and must not be committed or edited by hand.
- Commit messages should be concise, user-meaningful summaries because they become release titles in the application. Add a commit body when operators need rollout notes, migration context, or follow-up instructions.
- Preserve searchable commit IDs, timestamps, authors, affected files, change areas, tags, and repository links so operators can trace a release back to source.

## AI assistant David

Walmart category approvals support page-selected bulk approval through `/api/walmart/mapping/approve`, using the saved proposal token. Normal Walmart mapping saves require the revision returned by GET mapping. Both reject stale edits, validate cached taxonomy, retain approval history and never publish listings. Category selections show cumulative save progress and individual failures. Unsupported Walmart product refresh remains hidden. Shopify/eBay pending approval rejects wrong-channel and changed-proposal submissions; locked mappings require an explicit unlock. Display cached repository matches as such, not as David output. Run `scripts/test-category-approval.cjs`, `scripts/test-walmart-marketplace.cjs`, and category-refresh regression tests when changing this flow.

Pending category suggestions belong visibly above taxonomy search in channel mapping tabs, never inside collapsed protection controls. Shopify includes the Google reference. Walmart review documents remain in `walmart_documents`; normalize both `suggestion.categoryId` and historical `pendingSuggestion.productType` formats for display. Approved mappings take precedence over historical reviews. Use suggestion only selects a draft; explicit Save approves Walmart mappings through its dedicated API. Unmatched results must say No suggestion found. Do not send Walmart approvals to generic Shopify/eBay AI endpoints. Run `node scripts/test-mapping-suggestions.cjs` for this display contract.

David is the system AI assistant. AI integration settings must show provider status, token/usage information when available, model/configuration, and enabled scopes.

AI actions must be scope-gated, logged, and confirmation-based for mutations. Examples include:

- Search catalog by UPC and explain matching context.
- Suggest product data from uploaded photos.
- Review category mappings and propose marketplace taxonomy matches.
- Prepare a Shopify/eBay launch plan for a SKU or selection.
- Diagnose jobs and explain errors.

David must not silently publish products, change pricing, modify inventory, create POs, send marketplace notifications, or change categories without an explicit confirmation and the relevant enabled action scope.

The configured category auto-approval threshold is a standing category-mapping policy and is the only exception to per-record category confirmation. It applies only to background taxonomy review, only to unlocked mappings, and every automatic decision must be logged and locked for later inspection.

## Caching, indexing, and performance

Single-category PATCH saves use `readCategoryReviewContext` and return `{ category, scope }`. They must never load full application state, aggregate catalog statistics, or return every category. React merges the saved row without replacing the category list or unrelated channel projections. Run `node scripts/test-category-save-targeted.cjs` when changing this path.

The catalog is large. Prefer PostgreSQL queries and indexed views over loading the entire catalog into the browser.

- Use PostgreSQL as the source of truth when configured.
- Use Redis/cache invalidation for repeated catalog facets, attribute data, taxonomy data, and stable marketplace summaries.
- Keep catalog filters server-side and indexed.
- Use stored/indexed supplier coverage and multi-supplier status; do not calculate it live for every row.
- Use paginated queries and bounded page sizes.
- Keep expensive category/taxonomy data lazy-loaded until the user opens the relevant tab.
- Invalidate affected cache keys after product, vendor, category, channel, feed, or marketplace changes.

## Data safety and change discipline

- Never change pricing, inventory, listing status, or vendor participation in bulk without a dry-run/review path unless the user explicitly asks for an apply run.
- Respect discontinued and inactive rules before marketplace pushes.
- Preserve source values and change provenance; do not overwrite source data with a derived display value.
- Keep local-only and channel-notification actions distinct.
- Do not expose secrets or write API tokens into the UI, logs, CSVs, or commits.
- Do not alter database state with ad hoc scripts unless the operation is idempotent, logged, and reviewed.
- Do not edit the legacy UI to solve a new-version bug.
- When a new feature is added, update this file if it changes a workflow, setting, route, or safety rule.

Tools pages belong to their parent workspace. `/orders/tools` contains only order tools and order templates; future catalog tools belong on a separate Catalog > Tools page. Do not add a global top-level Tools navigation item.

Company management belongs in System Settings > Companies (`/settings?tab=companies`), with a visible Add new company section for organization owners. Creation starts empty, shares product information, retains the current session company, and offers an explicit switch to the new company's Orders workspace. Duplicate names are checked case-insensitively within the organization. The old `/organization` route redirects there. The Companies tab uses the shared settings navigation but loads company APIs independently of LINQ operational polling. Opening company settings does not change the session company; Open LINQ operations explicitly selects LINQ.

Companies uses the main App shell so the permission-filtered sidebar, account controls, and theme remain consistent. Its company-settings mode skips automatic legacy state/jobs polling; leaving that mode loads the destination workspace normally. The initialization panel is explicitly one-time and disappears after initialization.

Company access belongs in Settings > Users on the selected user profile, not Companies settings. Membership endpoints require user-permission management rights and organization-owner access; owner membership cannot be removed here. The top-bar searchable switcher lists only authorized companies, persists selection server-side, reloads on switching, and notifies other browser tabs via storage events. Reporting companies open Order Tools, never LINQ operational orders. Company settings and Order Tools both retain the full sidebar.

New-company Orders uses `lib/company-operations-http.js` after action permission checks and before the legacy API guard. This scoped adapter supports standard manual drafts/orders, order views, and empty company-owned channel/warehouse registries. It must never fall through into LINQ for unknown routes. Company switching opens standard Orders; file imports remain optional in Orders > Tools. Operational state mutations are transactional, audited, and company-keyed. Full company channel/fulfillment/purchasing migration is still pending.

Walmart bulk readiness is under Catalog selection Actions > Check Walmart readiness. It saves separate existing-offer and new-item schema assessments in walmart_documents, without preview tokens or publication. Product details show blockers and invalidate changed/expired evidence; catalog last-check filters are historical, expire after 24 hours and exclude edited/linked/submitted products. Always revalidate at launch; never treat a catalog match or saved readiness assessment as a live seller listing or publication authorization.

Walmart catalog references use a separate DEFAULT identifier lookup alongside SPEC readiness. Save validated item IDs and canonical product URLs in walmart.catalog-match documents, never as seller ownership/live evidence. Hide references after identifier/account/environment changes or 24 hours. Lookup metadata failures do not create a listing or invent an ID; preserve separate readiness and reference-result messages.

For Walmart existing-catalog matches, existing-offer readiness controls the primary launch status. Missing local category mapping is only a new-item fallback requirement, never an offer launch blocker. Keep fallback warnings collapsed and separate. Combined launch-route filters must not treat a failed identifier lookup as permission to create a new item.

## Mobile warehouse workspace

`/warehouse/mobile` is the dedicated phone/scanner entry point in the new React app. It retains authentication and the active session company, skips unrelated state/job polling, and never changes company selection from the URL. It offers PO receiving, manual stock receipts, audit creation/history/detail, bin search/edit, and access to returns, fulfillment, and inventory. Existing operation permissions and backend company guards remain authoritative; PO access still requires purchasing view/receiving permissions (the warehouse role alone does not grant these).

PO scans add one unit to a local count using exact line identifiers or identifiers from the managed catalog identity. Ambiguous matches require manual line selection; scans never finalize inventory. Counts start at zero, are capped at remaining quantities, and preserve the existing draft/final receipt and canceled-demand hold review. Mobile receiving warns before discarding an unsaved count. Audit links and new audit creation retain the mobile URL. Phone tables use labeled rows and dialogs retain accessible actions above the safe area. Run `node scripts/test-mobile-warehouse.cjs` when changing scanner identity projection.

Warehouse scan performance: apply `scripts/warehouse-scan-indexes.sql` outside a transaction when provisioning or upgrading production. The four concurrent expression indexes match every normalized OR branch in `findBarcodeMatches`; omitting any branch can make unknown barcodes scan the full managed catalog. Keep exact/source matching and O/0 distinctions unchanged. Run `node scripts/test-warehouse-scan-indexes.cjs` against local PostgreSQL; it uses rollback-only temporary tables and verifies the indexed query plan. Never build these large indexes synchronously in an API request.

Unmatched warehouse audit rows retain a three-dot Create SKU action while the audit is in progress. It reopens the existing form on mobile or desktop with the saved barcode, count, and bin; Skip for now preserves the scanned row. Creation resolves the selected original barcode/bin row even if the destination bin is edited. Completed audits and rows with a created SKU do not offer this action.
Password changes: new accounts and administrator resets give users 14 days to choose a permanent password; existing reset requirements without a deadline start their grace period on the next successful sign-in. Store the deadline independently of profile edits and logins. Authenticated users can change only their own password without operation or company permissions, with current-password verification for self-service. Other-user resets retain user-account password permission checks.

Audit phone rows use a compact two-column layout; unmatched rows show only barcode, bin, count, and status/actions. Import/eBay tools sit in a collapsed section below the count list, and optional SKU attributes are collapsed without discarding entered values. Audit purpose and export remain in the Actions menu.

Audit stock-import/eBay tools open in a dialog from Actions on desktop (768px and wider). They are omitted from the dedicated mobile warehouse workspace and narrow screens; scanner/photo capture and SKU creation remain available on phones.

Audit More > Clear bin clears only the local scanner selection, never counted stock. POST /api/warehouse-audits/:id/clear-bin requires the existing warehouse-audit administrator verification, a reason, and an in-progress audit; it records the original bin, requester, approver, and time in lifecycleEvents without saving the PIN. The bin selector cannot bypass the approval dialog to clear a selection.

Audit More > Share audit link uses native sharing when available and otherwise copies the audit URL, with a selectable-link dialog if clipboard access fails. Links preserve the mobile/desktop audit route and never change company selection or bypass sign-in and audit permissions.

The audit camera shows the active bin and permits choosing another active warehouse bin without leaving the scanner. Edit audit item supports quantity and bin changes through the existing line count endpoint; a bin-only edit updates expected quantity and records old/new bins, rejects destination row collisions, and never moves live inventory. Run scripts/test-warehouse-item-bin.cjs when changing this flow.

Mobile PO receiving is search-first: no purchase orders or purchasing-work data load until a user submits a PO/supplier search. GET /api/purchasing/receiving-search returns up to 20 open PO summaries plus hasMore, without loading lines, demand, orders, or buyer alerts. Blank searches return no rows; superseded browser searches are canceled and ignored.

The audit register uses compact summary cards in the mobile workspace and on narrow screens, with counter/reviewer/dates under Details. Status badges use blue for in progress, amber for review, green for completed, and red for locked; row actions live in the icon-bearing three-dot menu and retain administrator PIN checks.

Audit IDs are the primary register links; Open audit is a backup row-menu action. Register and combined known/unresolved item lists default to latest-added first, with oldest-first and identifier sorting. Item chronology uses firstScannedAt/scannedAt, not later edits or recounts. Camera lookup, save success, and error feedback share the in-flow panel above the preview; camera scans do not emit duplicate bottom toasts, and failed saves retain the scan for retry. Run scripts/test-warehouse-audit-display.cjs when changing sorting.

Audit register cards show createdBy without expanding Details. Audit item photos have an explicit preview dialog; underlined SKU links open product details and the eye button offers quick view. Matched and unmatched rows support persistent notes through POST /api/warehouse-audits/:id/item-notes, requiring audit permission and in-progress status, preserving counts/bins and recording the authenticated author plus note history. Closed audit notes remain readable. Camera Done closes scanning and returns to the same audit. Run scripts/test-warehouse-item-notes.cjs for note changes.

Audit More > Print bin labels opens BinLabelDialog for every configured bin in the current warehouse, including labeled inactive bins. Print only the selected bins with exact-code Code 128 barcodes on Letter paper; presets range from full-page signs to 1.5 x 1 inch labels (50 per sheet with half-inch margins), with copy counts and adjustable margins/gaps. Reject oversized jobs, invalid geometry, unsupported codes, and barcodes too dense for the selected size. Labels are generated locally; printing never mutates bins or stock. Run scripts/test-bin-labels.cjs and verify barcode decoding and print-page boundaries when changing this flow. Enlarged audit item photos close on click/tap or the dialog close control.

Catalog stock sources show physical warehouse stock separately from timestamped universal-datadump supplier stock, including legacy datadump products without inventory-level rows. Never infer supplier stock from aggregate quantity or replace an explicit zero source row. Walmart inventory can use an active physical or supplier-feed location and publishes the current persisted location quantity without consulting datadump job status. Safety reserves, selling-unit validation, inactive/discontinued guards and quantity caps still apply. Existing-listing reconciliation supports unique supplier SKUs and active direct aliases in addition to catalog SKU/UPC matches; conflicting identifiers, ambiguous matches and unconfirmed packs remain review-only. Catalog Walmart identity projections exclude account fingerprints. Run scripts/test-catalog-stock-sources.cjs, scripts/test-walmart-selling-units.cjs and scripts/test-walmart-reconciliation.cjs --sql for these paths.
