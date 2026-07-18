# Legacy-to-React Parity Audit

Audited: 2026-07-18  
Sources compared: `public/index.html` + `public/app.js` (legacy) and `web/src/App.tsx` (React/shadcn UI).

## Decision rules

- **Keep** means the workflow belongs in the new product and should be rebuilt in React.
- **Consolidate** means the capability should exist once in the clearest ownership location instead of duplicating legacy screens.
- **Do not copy literally** means the legacy behavior is useful, but the new UI should use the existing table, sheet, dialog, tabs, and floating-action patterns.
- A generic read-only table is **not** considered parity for a legacy workflow that supported filtering, review, bulk action, mapping, import, export, or drill-in.

## Executive assessment

The React application has a sound shell, an improved product workspace, basic jobs, basic channel settings, the catalog navigation, and a substantial category profile. Its largest parity gap is that six catalog workspaces are currently rendered by the generic `CatalogResourcePage` table. This hides the workflows that made those pages useful in legacy.

The highest-value implementation order is:

1. Source Catalog and its filters/actions.
2. Dedicated Catalog workspaces: Import Review, SKU Changes, Vendor Category Mappings, Attributes, Attribute Groups, Readiness.
3. Catalog bulk operations, imports/exports, and saved-search behavior.
4. Operations modules currently absent from React navigation: Orders, Purchasing, Customers, Reports, Knowledge, and System Fields.
5. Complete channel and job operational controls.

## Platform navigation and modules

| Legacy module | React status | Missing capability | Recommendation |
| --- | --- | --- | --- |
| Dashboard | Partial | Legacy operational summaries, recent orders, sync log, richer exception links. | Keep a concise operational dashboard; link into Jobs and readiness instead of duplicating their tables. |
| Order Management: Orders | Missing | Queue tabs, smart filters, sorting, bulk actions, order detail, fulfillment, reservations, refunds, PO creation, marketplace links. | Build as a dedicated operational workspace after catalog parity. |
| Drafts | Missing | Manual order drafting, line editor, duplicate, convert to order, PDF export. | Keep as an Orders sub-route, not a top-level duplicate module. |
| Returns | Missing | Return workflow, receipt, attachments, refund linkage, status transitions and return detail. | Keep as an Orders sub-route with clear lifecycle states. |
| Customers | Missing | Customer list, profiles, addresses, linked order/draft/return history. | Keep as its own CRM-lite workspace, later phase. |
| Import / Export center | Missing | Import section navigation, field mapping editor, format mapping directory, marketplace templates, error artifacts. | Consolidate with Catalog Actions and Jobs: setup/templates under Catalog; execution and artifacts under Jobs. |
| Purchasing: POs | Missing | Purchase-order list/profile, vendor submission, receiving, serial capture, duplicate detection, linked orders. | Keep as a dedicated Purchasing workspace. |
| Purchasing: Brands | Missing | Brand profile, brand enable/disable/void actions. | Keep under Purchasing or Catalog Governance; do not create a second brand editor on Product. |
| Purchasing: Warehouses | Missing | Warehouse profiles, bins, transfer workflow, receiving/return defaults. | Keep under Inventory/Purchasing; product only shows stock by warehouse. |
| Reports | Missing | Operational reporting and exports. | Build from reusable report definitions, not a static dashboard copy. |
| Knowledge Base | Missing | Article navigation/editor/settings. | Defer until users actively need internal documentation. |
| System settings: Operations | Partial | Full system operation controls and health visibility. | Keep inside Settings as a tab, but expose active work in Jobs. |
| System settings: System Fields | Missing | Field registry, source-to-canonical mapping visibility, field filtering. | Keep as a Catalog Governance section. It is needed before broad import-template work. |

## Catalog workspace audit

### 1. Products - partial parity

Already present: paged product table, compact mode, configurable visible columns, product selection, Shopify/eBay state columns, alternates, product preview/edit sheet, dedicated product page, basic saved views, and a multi-select filter popover.

Missing or incomplete:

1. **Full smart-filter engine**: legacy supports saved user views, aliases, suggestion search, multiple operators, numeric comparisons (`>`, `<`, between), empty/not-empty, and richer active chips. React supports only multi-select “is any of” filters and a few fixed saved filters.
2. **Complete filter field set**: supplier, active, stock status, channel status, has stock, stock quantity comparison, hazardous, discontinued/closeout, verified brand, brand, and category must all be available from the primary Products table.
3. **Persistent table preferences**: visible columns, density, sort, and saved filters should be user preferences stored server-side, not just component state.
4. **Product drill-in behavior**: SKU should route to the dedicated product page; quick view should remain a separate hover/action affordance. This is a previously identified requirement and should be verified against every product table.
5. **Bulk workflow coverage**: import product CSV, Shopify status CSV, eBay catalog sync, select all filtered results, lifecycle updates, launch eligible eBay products, delete/hide with a review confirmation, load alternates, and Shopify-status sync.
6. **Exports**: product export profiles, field-selection mapping, template export, and completed-export notifications/artifacts.
7. **Sort contract**: all displayed sortable columns must be server-sorted for large datasets, with a stable secondary SKU sort.

Product-management recommendation: retain the single dedicated product page as the source of truth. The table should only perform bulk actions and quick preview; it should not gain inline editing.

### 2. Source Catalog - major gap and first implementation priority

Already present: latest-first paging, full text search, page selection, selected-SKU promotion to main catalog, basic row menu, and a small set of columns.

Missing or incomplete:

1. **Filtering**: supplier multi-select, product-membership (source only / already promoted), active state, stock status, stock quantity comparisons, hazardous, closeout/discontinued, brand, category, manufacturer, UOM, price/cost ranges, and channel-source fields.
2. **Facet loading**: counts and searchable values should load on demand when the filter drawer opens, never with the initial page request.
3. **Search health**: display source manifest/import time, result/scan count, partial-search state, keyword-index readiness/progress, and an action to build the search index.
4. **Maintenance actions**: build source performance indexes, refresh facets, run cost/inventory/closeout refresh, and show each resulting job.
5. **Import modes**: New + update, New only, Update existing only, plus a SKU-file import path.
6. **Bulk selection**: select page, select all filtered, clear selection, promote selected, promote all filtered after confirmation, set active/inactive/discontinued, and hide source records.
7. **Row detail**: a source detail sheet/page with raw feed fields, source usage by channel, promotion state, differences from the main product, and source images.
8. **Export**: source export profiles and mapping-aware CSV generation.
9. **Columns**: manufacturer, alternate suppliers, source status, source/main-product differences, channel source identifiers, and import timestamp.

Product-management recommendation: one Source Catalog workspace with a lazy facet drawer, a compact table, and a right-side detail sheet. Do not load raw product-manager fields until a row is opened.

### 3. Import Review - major gap

React currently renders a generic data-quality table. Legacy has a protected-change review workflow.

Missing:

1. Pending versus resolved review queues.
2. Summary counts: pending changes, affected SKUs, most changed field, resolved history.
3. Review field filters/chips.
4. Current value versus incoming dump value comparison.
5. Accept/reject per row with audit detail.
6. Accept/reject all pending with confirmation and job/audit output.
7. Unmapped eBay listing review and direct external listing link.
8. Link from a review row to the product or source item.

Recommendation: use a diff-focused data table with a detail sheet; do not reuse the Readiness table because the decisions and data are different.

### 4. SKU Changes - major gap

React currently shows a generic list only.

Missing:

1. Server filters by query, supplier, field, direction, change type, date, and active-catalog membership.
2. Field-specific change labels and normalized value formatting.
3. Product versus source catalog status indicator.
4. SKU change detail sheet showing old/new values, source, date, and linked product.
5. Export filtered changes.
6. Pagination and an explicit changed-field summary.

Recommendation: keep Import Review for decisions and SKU Changes for audit. They should share a diff component, not a route.

### 5. Categories - strong partial parity

Already present: Main/Source scopes, mapping/review/lifecycle/search/minimum-product filters, dedicated category page, core Shopify/eBay mapping, attributes, defaults, smart collection, lifecycle, data-table requirements, and category index rebuild.

Missing or incomplete:

1. Category coverage dashboard: mapped, missing, active uncategorized, source-only coverage, hazardous count, and reconciliation metrics.
2. Category actions: learn source mappings, auto-map Shopify, auto-map eBay, push Shopify taxonomy, and clearly report the job/result.
3. Category import: SKU-to-main-category import and channel-mapping import, with validation/dry run/result artifact.
4. Category exports beyond the current master-category mapping CSV.
5. Lazy SKU sample and “view all SKUs” action from the dedicated profile. The old table preview is intentionally **not** recommended because you explicitly asked for a table-first Categories index with no preview clutter.
6. Source-scope detail route should preserve `?scope=source` when opening a row.
7. Shopify collection deep link and collection sync state on the Shopify tab.
8. Mapping health must include all enabled channels, not only Shopify/eBay, even if a channel is not configured yet.
9. Create-main-category flow from an unmapped vendor category should verify the entire True Value source index before creation and record the decision source.

Recommendation: Categories is the governance home for main categories and channel taxonomy. Vendor mappings should remain a related workspace, not an extra category editor.

### 6. Vendor Category Mappings - major gap

React currently shows a generic read-only table.

Missing:

1. Supplier selector and mapping summary (total/mapped/unmapped).
2. Vendor category search, row pagination, sample SKU, SKU count, and mapped status.
3. Main-category typeahead with full paths, keyboard support, click-outside close, and lazy result loading.
4. Create “Add as main category” flow after checking main and True Value source categories.
5. Mapping-source choices: main catalog, Google taxonomy, Shopify taxonomy, eBay taxonomy; persist which source was used and why.
6. Accurate prefill suggestions and a review state for uncertain suggestions.
7. Bulk mapping, safe apply-to-SKU job, and map-back/learn-source-mapping job.
8. Vendor profile embedded mapping tab should use this same component/API rather than duplicating the flow.

Recommendation: build one reusable `VendorCategoryMappingTable` and mount it in the catalog page and vendor profile with a supplier prefilter.

### 7. Attributes and Attribute Groups - major gap

React currently shows generic read-only tables.

Missing:

1. Attribute filters: channel, category, group, required/mapped state, and query.
2. Attribute mapping dialog: source field, canonical field, fallback value, transform, enabled state, and notes.
3. Marketplace-required versus optional attribute grouping.
4. Shopify mapped attribute list and category-level required attributes.
5. Attribute group create/edit/delete, aliases, related attributes, count/statistics, and assignment to categories.
6. Channel attribute fallback controls and allowed-value handling.
7. Sync category attributes action and saved sync result.

Recommendation: centralize field transformation logic in System Fields; Attributes should configure usage, not define a second field registry.

### 8. Inventory - partial parity

Already present: basic inventory table and product inventory data on the product page.

Missing:

1. Dedicated inventory columns: on hand, reserved, available, reorder point, low-stock state, cost, vendor, warehouse summary.
2. Server filters for warehouse, availability, low stock, replenishable state, supplier, and status.
3. Inventory export configuration and artifact history.
4. Transfer-stock action and warehouse/bin drill-in.
5. A low-stock/replenishment queue.

Recommendation: Inventory should be inventory-first, not a second Products table. Keep product-level stock detail on the product page and warehouse operations here.

### 9. Templates - major gap

React currently provides four static downloads.

Missing:

1. Import/export mapping directory.
2. Mapping create/edit/duplicate/reset flows.
3. CSV header parser and suggested DataPlus field mapper.
4. Built-in export mappings and required Shopify status fields.
5. Marketplace templates and preview/validation against a sample shadow SKU.
6. Versioning and “last used” audit.

Recommendation: split into two tabs: `Data mappings` and `Marketplace templates`. Keep individual template actions in the universal floating Actions menu.

### 10. Readiness - major gap

React currently renders a generic data-quality list.

Missing:

1. Readiness summary: total, product ready, needs work, Shopify ready/live, eBay ready, closeouts, stale channel sync.
2. Server-side filters for query, issue, type, channel, and readiness status.
3. Scan-now action with job tracking and generated timestamp.
4. CSV export of filtered quality issues.
5. Clear explanations for each issue and a direct “Review product” action.
6. Channel-aware price/margin/stock checks and stale-sync detection.

Recommendation: use a single Readiness model as the source for product readiness badges, catalog readiness filters, and the dedicated queue. Do not compute separate conflicting readiness scores in multiple pages.

## Product detail audit

Already present in the complete workspace: overview, content, identifiers, pricing calculation, inventory ledger/warehouse table, shipping and compliance, dynamic channel tabs, UOM variants, alternate offers, aliases, shadows, source/audit values, category picker, and a tab-aware editor dialog.

Missing or incomplete:

1. **Product actions**: export product template, sync Shopify status, rename SKU, create one/all marketplace shadows, open inventory detail, and channel-safe publish/unpublish actions.
2. **eBay listing editor**: category taxonomy search, required aspects, policies, images, listing draft/readiness, launch/update actions, and listing links.
3. **Other channel detail**: Zoro/Varis data is present in legacy source fields but has no dedicated channel treatment in React. It should appear only when the corresponding channel is enabled.
4. **Source backfill** action and field-usage explanation for raw supplier fields.
5. **Image manager**: reorder/default/remove/add source image, not only a textarea of URLs.
6. **Bullet manager**: structured product highlights rather than a raw multiline field.
7. **Shipping calculation details**: dimensional-weight source, missing-dimension warnings, package-versus-item source badge, parcel/LTL reason, and a shipment rule preview.
8. **Brand guard**: locked/unlocked brand state and explanation before changing branded data.
9. **Replenishable precedence**: clearly show product override versus vendor default, quantity source, warehouse, and effective sellable quantity.
10. **Channel state history**: last push, last confirmed pull, error, retry link, and external channel admin link.

Recommendation: keep channel-specific fields on the relevant dynamic channel tab. Do not place channel fields in Overview or duplicate them in the editor’s Basic tab.

## Channels audit

React has a useful tab structure, but the full legacy channel profile behavior is not yet complete.

Missing or incomplete:

1. Shopify authentication lifecycle: scope explanation, request token/re-authenticate call to action, token health, last check, and actionable failures.
2. Shopify actions: SKU-map sync, status sync, closeout sync, shipping-profile import, status CSV import, link dry run/apply, product create dry run/apply, price dry run/apply, inventory dry run/apply.
3. Inventory schedule: editable enabled state, mode, first/second run, interval, warehouse, Shopify location, next run, and job link.
4. Imported shipping-profile dropdown, refresh/import state, permission explanation, and fallback behavior when `read_shipping` is absent.
5. Channel mappings, channel attribute mappings, variants, SKU state, logs, and error group drill-in should be dedicated tab contents, not static configuration summaries.
6. Channel logo storage/display: crop/fit preview, replacement/removal, server storage path, and consistent size constraints.
7. API logs: query/status/transport filters, error grouping by endpoint, and deep link from Jobs.
8. Settings edit lock: sections should be read-only until Edit, then Save/Cancel with an inline saved state. Avoid success modals for ordinary saves.

Recommendation: keep potentially destructive sync operations only in the channel `Actions` tab and the page-specific floating Actions menu. Keep connection and defaults in `Setup`; keep recurring behavior in `Rules`.

## Jobs and operations audit

Already present: queue/history and channel-log tabs, active job visibility, job filtering, paging, retry/stop actions, and a job detail panel.

Missing or incomplete:

1. Job action permissions/confirmation: stop only active work, retry only retryable work, and a visible reason when an action is unavailable.
2. Artifact center: original file, generated files, errors CSV, file size, download/open from job detail, and retention expiry.
3. API issue groups: channel/endpoint/reason grouping, links to logs, and the configured remediation action.
4. Job settings panel: external worker state, worker heartbeat, health, queue depth, automatic recovery state, retention days, backup trigger/status, source-catalog backup inclusion, and job cleanup preview.
5. Scheduling detail: per-channel schedules should be authored in Channel settings, then summarized read-only in Jobs with an “Open channel” link.
6. Duplicate-run control: a single row for the running job plus suppressed duplicate attempts folded into it, rather than many “already queued” rows.
7. Failure policy: retry classification, backoff, resumable checkpoints, auto-fix attempts, human-review queue, and per-row error artifacts.
8. Channel log subscription/refresh strategy and consistent time zone display.

Recommendation: Jobs is the audit and execution center. Channel settings owns configuration; Catalog owns data selection; Jobs owns progress, output, errors, and retry.

## Vendor, pricing, and inventory policy audit

Already present: vendor list/profile with Summary, Contact, Rules, Inventory, and Categories tabs; product-level pricing and replenishable values.

Missing or incomplete:

1. Vendor rule editor completeness: explicit pricing basis, markup tiers, minimum price, rounding, website-price override, UOM selling behavior, variations rules, Essendant UOM-only enforcement, and True Value each/case behavior.
2. Replenishable policy precedence: vendor default enable/quantity/warehouse; SKU opt-out/override; SKU quantity “use vendor default” toggle; audit log.
3. Vendor category table reuse and mapping job history.
4. Vendor contacts and address structured editing with payment-term dropdown and validated form fields.
5. Pricing simulation using a selected SKU before saving a rule.
6. Vendor rule change impact: count of affected SKUs and optional preview job.

Recommendation: maintain pricing and variation rules only on the vendor profile, with product pages showing computed results and a link back to the governing rule. This avoids conflicting rule editors.

## Cross-cutting implementation backlog

### Phase 0 - foundation and contracts

1. Define a route and feature ownership map for every legacy module before adding screens.
2. Add a capability matrix per API endpoint: read, edit, import, export, bulk action, job, artifact.
3. Create reusable primitives: server-paged data table, lazy facet filter drawer, saved-view manager, diff viewer, job-launch confirmation, artifact list, and entity activity timeline.
4. Add route-level loading/error/empty states and preserve URL query state for filter/share/deep links.
5. Add integration tests for navigation, filters, pagination, edit/save, action menu, and job artifact links.

### Phase 1 - catalog core

1. Rebuild Source Catalog as the first complete React data-table workspace.
2. Replace generic Import Review with protected-change workflow.
3. Replace generic SKU Changes with filtered audit workspace.
4. Rebuild Vendor Category Mappings as reusable mapping component.
5. Rebuild Attributes and Attribute Groups using the same category requirement schema.
6. Rebuild Readiness as a server-filtered remediation queue.
7. Complete Products smart filtering, saved views, bulk actions, exports, and preference persistence.
8. Complete category automation/import/export/coverage while retaining the table-first index decision.

### Phase 2 - channel and job reliability

1. Complete Shopify auth/scope recovery and shipping-profile import UX.
2. Complete channel action workflows with dry run/apply pattern and job links.
3. Move schedule authoring wholly to Channel settings; summarize in Jobs.
4. Complete job artifacts, issue groups, retry policy, resumability, deduplication, and retention controls.
5. Add channel push/pull activity timeline to SKU, channel, and job views.

### Phase 3 - operations modules

1. Orders, Drafts, Returns, Customers.
2. Purchasing: POs, Vendors, Brands, Warehouses, receiving.
3. Inventory transfer/replenishment queue.
4. Reports and Knowledge Base.
5. System Fields and import/export mapping center.

## Explicit non-goals and consolidations

1. Do not restore category SKU previews to the Categories index; keep lazy samples on the category profile.
2. Do not restore inline product editing in product or source tables; use quick view plus the dedicated product editor.
3. Do not duplicate vendor/category mapping logic in Catalog, Vendor, and Product. Build it once and prefilter it by context.
4. Do not put recurring schedule controls in both Jobs and Channels. Configure in Channels; observe in Jobs.
5. Do not expose all raw supplier fields in a default product page. Keep them in Source & history and load only when requested.
6. Do not create fixed channel tabs for disabled channels. Dynamic channel tabs are the correct React design.

## Definition of done for each migrated legacy workflow

1. It is reachable from the new sidebar and direct URL.
2. It has server-side pagination, filtering, loading, empty, error, and no-permission states.
3. It has a clear owning location for create/edit actions.
4. Destructive/bulk actions show scope and count before execution, create a job where appropriate, and link to its result.
5. Imports/exports expose their input/output artifacts from Jobs.
6. The corresponding legacy action is either implemented, intentionally consolidated, or explicitly retired in this document.
7. The workflow is covered by a focused end-to-end test.
