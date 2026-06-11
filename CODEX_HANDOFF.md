# Codex Handoff: DataPlus

Last updated: 2026-06-10

## Resume Prompt

Use this when starting a new Codex thread:

> Read `CODEX_HANDOFF.md`, inspect the current git status, then continue DataPlus from the latest pushed state.

## Repository State

- Project path: `C:\Users\luis\Documents\codex\dataplus`
- Git branch: `master`
- Remote: `origin https://github.com/dealsclick/Dataplus.git`
- Latest pushed commit: `744d373 Add flexible product export profiles`
- Last checked status: clean, `master` synced with `origin/master`

## Run Locally

Start the app:

```powershell
npm start
```

Start the worker in another process:

```powershell
npm run worker
```

Local app URL:

```text
http://127.0.0.1:4173/
```

Current app browser URL when this handoff was created:

```text
http://127.0.0.1:4173/?format-check=1780240838429
```

## Recent Completed Work

- Fixed Matrixify / Shopify export issues around dimensions and weights.
- Added support for item dimensions and package dimensions as separate concepts.
- Added fallback system defaults for missing dims/weight:
  - Dimensions: `5 x 5 x 5`
  - Weight: `5 lb`
  - Marked as unverified/system default in UI/export logic.
- Added source visibility for dimensions/weight:
  - Data dump
  - Manual import
  - Manual entered
  - System default
- Fixed Shopify variant SKU formatting to use the actual SKU as the base.
- Fixed multi-pack Shopify variant weight logic so multi-piece variants can use package weight.
- Added compact/edit-mode improvements on product detail screens.
- Added System Settings page scaffolding for users, roles, and permissions.
- Fixed catalog select-all/export-all behavior so filtered result selection can represent more than the current page.
- Added custom product export modal from the Catalog page.
- Catalog export dropdown now includes `Custom export...`.
- Saved profile selections export directly; only `Custom export...` opens the modal.
- Custom export modal supports:
  - Saved profile export
  - One-time custom column export
  - Saving custom columns as a reusable profile
  - Searching available columns
  - Format type selection
- Custom export format types currently include:
  - Normal CSV
  - Shopify / Matrixify
  - eBay
  - Amazon
- Shopify / Matrixify format maps selected fields to Shopify-style headers and uses Shopify metafield formatting for dims/weight.
- Backend supports `formatType` on export mappings, including saved profiles and one-time transient custom exports.
- Large custom exports can run as background jobs because the transient template is included in the job payload.
- Added `public/about-us.html` in a DK Hardware-inspired style.
- Added Shopify inventory update support from the latest imported data dump:
  - Script: `scripts/shopify-inventory-update-from-dump.js`
  - Worker task: `shopify-inventory-update`
  - API: `POST /api/shopify/inventory-update`
  - Missing variant report API: `GET /api/shopify/inventory-missing-variants`
  - Shopify channel UI buttons: `Inventory dry run` and `Update inventory`
  - Shopify channel UI includes a Missing Variant Matches review panel with search and paging.
  - Reports are written to `outputs/shopify-inventory/` and attached to Jobs.
  - Reports include missing Shopify variant SKU match details.
- Added guarded Shopify inventory push settings:
  - Shopify channel setting: enable/disable DataPlus inventory push.
  - Shopify channel setting: selected DataPlus warehouse and fallback Shopify location GID.
  - Warehouse profile fields: Shopify location name, Shopify location GID, and allow-push toggle.
  - Live Shopify inventory apply is blocked until inventory push is enabled and a Shopify location is mapped.
- Added built-in `Inventory Only CSV` export mapping:
  - Available in the same product export dropdown/profile flow.
  - Exports SKU, title, vendor SKU, brand, qty, reserved, available, source stock qty, stock status, discontinued flag, Shopify ID, and Shopify variant ID.
- Added daily Shopify inventory scheduling support:
  - System Settings fields: enable daily Shopify inventory job, run time, mode (`dry-run` or `apply`), and require successful product dump.
  - Worker checks the schedule once per minute and queues the existing `shopify-inventory-update` job.
  - Scheduler avoids duplicate daily runs and tracks the last queued job/dump in `shopifyDailyInventorySchedule` state documents.
  - Apply mode still uses the same server-side guard requiring Shopify inventory push to be enabled and a mapped Shopify location.
- Fixed Shopify inventory missing-variant detection:
  - The updater now recognizes existing Shopify pack variant SKUs like `BASE-12PC`, `BASE-2PC`, etc.
  - It no longer reports a product missing just because the base DataPlus SKU variant is absent when Shopify has a valid pack variant.
  - Worker heartbeat now refreshes during long Shopify inventory checks so full dry runs are not stopped incorrectly.
- Added DataPlus-native system variant support:
  - Products now expose `systemVariants`, generated from current data-dump UOM/UOM qty.
  - Multi-unit dump items generate actual sell-unit variants like `BUS100012TRV-12PC`.
  - Single-unit items generate the base SKU as the actual sell-unit variant.
  - Shopify purchase variants now derive from DataPlus `systemVariants` instead of independently inventing variants.
  - Product UI card was renamed to `DataPlus Variants` and shows the variant source.
- Started product detail UI revamp for a denser operations layout:
  - Product title now shows the marketplace/title text instead of repeating `Product SKU`.
  - Product workspace tabs were shortened to compact labels.
  - Product detail header is compact and no longer sticks over page content while scrolling.
  - Home tab uses a wider three-column desktop layout: media/dimensions, core product data, purchasing/pricing/variants.
  - Product cards, inputs, dimension groups, tables, and image panels are tighter to reduce wasted white space.
- Started full system UI revamp toward an iPhone/iPad-style operations app:
  - Global typography now uses an Apple/SF-style system font stack with smaller base sizing.
  - Theme tokens moved to a higher-contrast neutral background, stronger text, blue accent, clearer muted text, and softer grouped panels.
  - Sidebar, topbar, buttons, inputs, cards, badges, tables, and modals received global compact styling.
  - Catalog product selection/export controls were compacted into a denser control row.
  - Empty product media placeholders now stay compact instead of creating a large blank image box.
- Started consolidating page actions into the system Actions menu:
  - Catalog Actions now includes grouped Export, Selection, and Tools actions.
  - Catalog export now opens the product export modal from Actions instead of showing an inline template dropdown.
  - The Actions button changes to an active selected-count state when product/source rows are selected.
  - Product detail header was simplified so export/template/shadow tools live in Actions instead of duplicating buttons in the page header.
  - Topbar command hierarchy now separates global export activity from page actions:
    - completed Exports render as a compact activity icon with a badge,
    - the contextual Actions button floats at the bottom-right as an icon-only FAB by default,
    - the Actions FAB expands to show selected count when bulk actions are available.
- Latest confirmed Shopify inventory job in this thread was a dry run only:
  - Location used by the script: `bk warehouse`, `gid://shopify/Location/108943900976`.
  - Report: `outputs/shopify-inventory/shopify-inventory-dry-run-2026-06-09T17-10-36-061Z.json`
  - Products loaded: 50,000
  - Matched variants checked: 36,613
  - Variants currently different from dump: 943
  - Missing Shopify variant matches: 14,297
  - No live Shopify inventory apply was run after this dry run.

## Important Files

- `public/app.js`
  - Main UI logic.
  - Catalog export modal state and rendering.
  - Product detail edit mode and dimension source display.
- `public/index.html`
  - Modal markup and app shell.
  - App script cache-bust query was updated for export modal changes.
- `public/styles.css`
  - Compact UI styles.
  - Export modal/layout/search/format preview styles.
- `server.js`
  - Export mapping normalization.
  - Custom export endpoint.
  - Shopify/Matrixify export formatting and dims/weight logic.
- `scripts/dataplus-worker.js`
  - Background job worker.
  - Supports transient custom export templates from job payload.
  - Runs Shopify inventory update jobs.
- `scripts/shopify-inventory-update-from-dump.js`
  - CLI + worker-invoked Shopify inventory updater.
  - Reads latest dump-backed stock, compares to Shopify location inventory, applies absolute available quantities, and writes JSON reports.
- `db.js`
  - Postgres helpers and product query/export support.
- `lib/data-quality.js`
  - Data quality/readiness logic extracted into a library.

## Verification Recently Run

Syntax checks:

```powershell
node --check public/app.js
node --check server.js
node --check scripts/dataplus-worker.js
node --check scripts/shopify-inventory-update-from-dump.js
```

Manual/API checks:

- Normal custom export produced plain headers.
- Shopify custom export produced Matrixify-style headers and JSON metafield values for dimensions/weight.
- Browser modal check confirmed:
  - `Custom export...` dropdown option exists.
  - Modal opens.
  - Column search works.
  - Format selector appears.
  - Shopify preview updates headers.
  - No browser console errors.
- Shopify inventory worker dry-run check queued through `/api/shopify/inventory-update` and completed successfully.
- Browser check confirmed the Shopify channel page shows `Inventory dry run` and `Update inventory`.
- Full Shopify inventory dry run after adding detailed missing rows generated:
  - Report: `outputs/shopify-inventory/shopify-inventory-dry-run-2026-06-09T17-10-36-061Z.json`
  - Products loaded: 50,000
  - Matched variants checked: 36,613
  - Variants currently different from dump: 943
  - Missing Shopify variant matches: 14,297
  - The missing variant API returns this full report.
- Shopify inventory live apply now has a server-side guard requiring the channel inventory-push toggle and a mapped Shopify location.
- API check confirmed `Inventory Only CSV` is returned from `/api/export-mappings` with 12 columns.
- API check confirmed daily Shopify inventory settings are present with safe defaults:
  - enabled: `false`
  - time: `06:00`
  - mode: `dry-run`
  - require successful dump: `true`
- Refreshed Shopify inventory dry run after pack-SKU matching fix:
  - Job: `b41d593a-0805-44d9-a2f1-6a705cf88eef`
  - Report: `outputs/shopify-inventory/shopify-inventory-dry-run-2026-06-09T18-50-15-710Z.json`
  - Missing variant rows: `0`
  - Variants prepared: `71,078`
  - Variants different from current Shopify location inventory: `32,804`
  - Dry run only; no live inventory apply was run.
- API check confirmed `BUS100012TRV` returns `systemVariants[0].sku = BUS100012TRV-12PC`, `source = data-dump`, and `uomQty = 12`.
- Browser check confirmed the product detail revamp at wide desktop:
  - `BUS100012TRV` opens with compact `Home / Shopify / eBay / Zoro / Inventory / Shipping / Pricing / Source / Search` tabs.
  - Header uses normal positioning instead of overlaying content.
  - Three-column product home layout renders with Gallery/Dimensions, General, Purchasing/Pricing/DataPlus Variants.
  - No syntax errors from `node --check public/app.js`, `node --check server.js`, or `node --check db.js`.
- Browser check confirmed the system UI revamp cache key loads:
  - CSS: `/styles.css?v=system-ui-revamp-20260610-1`.
  - Dashboard uses the Apple-style system font stack, compact sidebar, blue active states, and tighter metric cards.
  - Catalog controls use the updated compact styling; product export/selection area was reduced and de-overlapped.
  - Product detail page uses the new global theme; no-image product media panels now use compact empty-state sizing.
- Browser check confirmed the system Actions revamp cache keys load:
  - CSS/JS: `floating-actions-icon-20260610-1`.
  - Catalog no longer renders the inline product export template select.
  - Actions menu shows grouped Export/Selection/Tools items.
  - Selecting the current product page changes Actions to `100 selected / Bulk actions ready`.
  - Export products from Actions opens the existing product export modal with saved profile and choose-columns support.
  - Dashboard topbar now shows Exports as a compact icon-only activity tray with badge.
  - Actions renders in `#floating-actions-slot`, fixed bottom-right, with the menu opening upward.
  - Default Actions state is a compact circular icon; selected Catalog rows expand it to `100 selected / Bulk actions ready`.
- Started navigation menu revamp:
  - Sidebar narrowed to 232px with a compact sticky brand header.
  - Navigation rows are smaller, with softer iPad-style active states and a slim blue active indicator.
  - Active nav groups auto-open even when the global menu group toggle is collapsed.
  - Fixed Catalog child active logic so only the current tab, e.g. Products, is highlighted instead of all Catalog children.
  - Added sidebar icon-rail collapse mode, persisted in `localStorage` as `dataplus-sidebar-collapsed`.
  - Added a natural icon-only brand-area collapse toggle for switching between full labels and icon-only navigation.
  - Replaced the visible `Icon` / `Full` and `Show` / `Hide` text controls with SVG-only controls.
  - Collapsed mode narrows the sidebar to 68px, hides labels/child groups, keeps hover titles, and shifts the app shell left.
  - Added missing Lucide `activity` icon so SKU Changes renders correctly.
  - Fixed collapsed icon rail visibility by hiding labels with `font-size: 0` instead of transparent text, preserving SVG `currentColor`.

## Likely Next Work

- Build fix actions for the Shopify missing variant match report:
  - classify expected-vs-Shopify SKU mismatch causes,
  - optionally update Shopify variant SKU,
  - optionally adjust DataPlus expected pack quantity,
  - re-run dry run after fixes.
- Continue tightening the custom export modal UX.
- Add richer marketplace-specific column mappings beyond the first Shopify/eBay/Amazon pass.
- Add direct editing for export profile format type in Import / Export template editor.
- Review eBay/Amazon format mappings against real marketplace templates.
- Continue compacting the overall UI and adding edit-mode patterns across pages.
- Extend the product detail revamp into Catalog, Import/Export, Jobs, Channels, and System Settings with the same dense readability rules.
- Expand System Settings into real user profile and permission management.
- Re-test Matrixify exports with the latest real Shopify template files from Downloads.
- Turn on the daily Shopify inventory schedule from System Settings after confirming the desired run time and whether it should start as dry-run or apply.
- Decide whether each DataPlus warehouse should use separate Shopify locations or whether all dump stock should keep flowing into the existing `bk warehouse` location.

## Notes For Future Codex

- Do not assume the chat history exists. Use this file, then inspect code and git status.
- The user cares a lot about Shopify Matrixify compatibility, especially variant SKU, item/package dims, and package-vs-item weight.
- The user also wants the system to stay marketplace-flexible, not Shopify-only.
- Before changing export behavior, test both:
  - Normal CSV custom export
  - Shopify / Matrixify custom export
- If running the app locally, restart both server and worker after backend/worker changes.
