# Codex Handoff: DataPlus

Last updated: 2026-06-01

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

## Likely Next Work

- Continue tightening the custom export modal UX.
- Add richer marketplace-specific column mappings beyond the first Shopify/eBay/Amazon pass.
- Add direct editing for export profile format type in Import / Export template editor.
- Review eBay/Amazon format mappings against real marketplace templates.
- Continue compacting the overall UI and adding edit-mode patterns across pages.
- Expand System Settings into real user profile and permission management.
- Re-test Matrixify exports with the latest real Shopify template files from Downloads.

## Notes For Future Codex

- Do not assume the chat history exists. Use this file, then inspect code and git status.
- The user cares a lot about Shopify Matrixify compatibility, especially variant SKU, item/package dims, and package-vs-item weight.
- The user also wants the system to stay marketplace-flexible, not Shopify-only.
- Before changing export behavior, test both:
  - Normal CSV custom export
  - Shopify / Matrixify custom export
- If running the app locally, restart both server and worker after backend/worker changes.
