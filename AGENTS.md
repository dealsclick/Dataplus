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

New SKUs must retain creation date, created by, creation source, and source detail. Examples include manual by user, DataWarehouse/DataPlus import, vendor FTP/API import, warehouse audit creation, and marketplace import.

### Pricing and UOM

- Pricing must use the vendor pricing rules and the product's UOM/package quantity.
- Cost basis and sell-unit calculations must be visible when possible.
- Never price a multi-pack below its comparable single-unit price when that would create a pricing inversion.
- Discontinued products must not be launched or pushed to a marketplace.
- Essendant rule: do not create Shopify variations; follow the vendor UOM only.
- True Value and other vendors may support individual and case-pack variants when the vendor rules allow it.
- Marketplace-specific formulas are configured in the channel settings, not hardcoded into a page.

## Vendor profile rules

Vendor profile settings are the reusable source of truth for imports, pricing, UOM/variation behavior, inventory/replenishment, purchasing, category mapping, and channel actions.

### Vendor status versus catalog inclusion

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

DataWarehouse's universal Product Datadump is a third-party universal source, not a vendor profile. It may contain many suppliers.

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

Automatic marketplace inventory apply jobs must stop when the newest universal datadump attempt failed or is still incomplete. A prior successful dump is not sufficient when a newer attempt failed; dry runs may continue for diagnosis, but stale supplier quantities must never be republished automatically.

## Channels and marketplace rules

Each marketplace channel has a master enable/disable switch. When a channel is disabled, all channel operations must be blocked: product launch, price updates, inventory updates, order import, status/fulfillment sync, webhooks, and marketplace notifications.

When enabled, individual settings govern each operation.

Every channel-related action belongs in the channel activity ledger, including API calls, settings changes, manual and scheduled jobs, webhooks, imports, launches, inventory and price updates, order actions, and fulfillment changes. Lightweight channel activity metadata is retained for 365 days. Large downloadable artifacts such as CSV exports and error files are retained for 7 days, while their parent activity and job records remain visible after file expiration.

### Shopify

Shopify supports product launch/linking, status and publication checks, price sync, inventory sync, order import, order webhooks, fulfillment/tracking sync, returns/refunds, shipping profiles, delivery quotes, shipping-label readiness, label purchase/void flows, collections, taxonomy, and channel-specific product fields.

Shopify warehouse mappings are configured under the channel Rules tab. Each DataPlus inventory location maps independently to a Shopify location and can be changed without code or environment edits. The default supplier-feed mapping is `DataWarehouse` to Shopify `zSi Warehouse` (`gid://shopify/Location/108946260272`). This mapping controls where imported supplier availability is published; it does not convert supplier-feed stock into physical warehouse stock.

Shopify order imports must be filtered to native Shopify sources requested by the business, including Online Store, Shop, Draft-created orders, and POS. Do not import marketplace orders merely because eBay, Temu, or another marketplace is connected into Shopify.

Shopify API scope/auth failures must be visible as actionable errors. Do not claim a successful connection means every scope is available.

### eBay

eBay supports connection/authentication, health verification, order imports with configurable lookback, SKU/listing synchronization, price/inventory synchronization, fulfillment reconciliation, listing launch, lifecycle operations, catalog import, business-policy sync, compliance audit, and marketplace-specific product fields.

The complete eBay marketplace category tree is persisted locally per marketplace and refreshed through a background job. Category mapping searches use this local index first; the channel settings show the tree version, category count, last refresh, and downloadable JSON/CSV job artifacts.

eBay product settings must support channel defaults with per-SKU overrides for:

- Default quantity versus actual inventory.
- Default pricing formula versus manual eBay price.
- Profit/margin visibility.
- Category and item specifics.
- Product identifiers.
- Payment, return, fulfillment/shipping policies.
- Listing format, condition, images, best offer, dispatch time, and out-of-stock behavior.

If a SKU exists on eBay, show a View on eBay action when a listing URL is available.

When eBay accepts an inventory item/offer but rejects the final publish step, preserve the offer ID as a prepared-not-live record and store a structured publish-block code, field, raw error, suggested fix, retryable flag, and timestamp. For package errors, DataPlus should prefer actual package/item weight when present and otherwise send calculated dimensional weight from complete package dimensions. Normalize legacy or local package labels such as box, MailingBoxes, poly mailer, envelope, and tube into supported eBay package type enum values before sending.

eBay price/inventory sync must treat Inventory API `SKU not found` rows as per-SKU relink warnings, not as a fatal batch failure. Mark the SKU's eBay listing metadata with `inventoryApiSkuMissing` and `syncStatus: needs_relink` so operators know it is on eBay but cannot be updated through the Inventory API SKU currently saved in DataPlus. Catalog must include both Product Catalog filters for eBay sync warnings/needs relink and an eBay Sync Warnings review view separate from eBay Launch Blockers; it should show listing IDs, offer IDs, latest sync errors, relink warnings, retry actions, clear relink instructions, and a deliberate clear-after-review action so users can distinguish "live on eBay" from "live but DataPlus cannot sync it."

### Other channels

Temu, TikTok Shop, Whatnot, and future channels must follow the same shape: master channel gate, connection/settings tab, rules tab, mappings, product fields, import/export/sync actions, jobs, and channel logs. Do not force all marketplaces into Shopify's workflow.

### Marketplace status presentation

Catalog channel icons represent marketplace presence and state:

- Gray: channel is not enabled for the SKU.
- Green: SKU/listing is present and healthy/live.
- Red/amber: present but has an issue, is unpublished, or needs attention.
- The channel icon should link to the marketplace listing when available.
- Use a small status tooltip/popover with explicit actions such as Filter and View source/store. Do not let hover status open image zoom.

## Categories and taxonomy

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
