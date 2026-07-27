# Products Catalog: Legacy Parity Audit

Audited: 2026-07-27

Compared the legacy Products workspace in `public/index.html` and `public/app.js` with the React Products route in `web/src/App.tsx`. This list is intentionally limited to the approved Products catalog, not Source Catalog, Categories, Inventory, or product detail.

## Restored in this change

- Shopify launch is available from the Products action dock for a review dry run and guarded live creation batch.
- Selected rows expose **Review Shopify launch** and **Launch Shopify**.
- Each product row exposes the same two actions. A discontinued or already-linked product cannot be launched from the row menu.
- The live action confirms scope and relies on the existing worker readiness checks to skip incomplete, linked, or discontinued SKUs.

## Present in React

- Server-paged catalog, search, selectable rows, select-all-filtered mode, density, persisted visible columns, and server sorting for the current supported fields.
- Shopify and eBay status, readiness, stock, pricing, category, media, supplier, manufacturer, UOM, shipping, alternate vendors, and lifecycle columns.
- Filters for supplier, brand, manufacturer, category, creation source, stock state, active state, discontinued state, Shopify/eBay state, and created-date range.
- Bulk active/inactive/discontinued/delete actions, eBay launch, Shopify dry run/live launch, and product quick preview.
- Product detail route, Shopify readiness/review/create actions, price push, edit dialog, category assignment, media, pricing, inventory, shipping, channels, identifiers, and provenance.

## Still missing or incomplete

### Highest priority

1. **Saved filters and table preferences stored per user.** Current density and columns use local browser storage; legacy-style named saved searches are still static presets.
2. **Full filter operators.** Add equals/not-equals, contains, empty/not-empty, numeric comparisons and ranges for price, cost, stock, readiness, and dates. Preserve chips and shareable URLs.
3. **Product export workspace.** React needs the legacy field mapping/profile chooser, selected-versus-filtered scope, async job artifact, and completed-export notice.
4. **Import controls from Products.** Restore product CSV import and Shopify status CSV import as routed dialogs with mapping, import mode, validation report, and Jobs link.
5. **Shopify status sync scope.** Make row, selection, filtered set, and full-catalog sync scope explicit instead of only offering the global operation.

### Important operational parity

6. **Shopify existing-variant link workflow from Products.** Offer dry run and apply for the current filters, with a result report showing the matched parent SKU and variant.
7. **Review results inline.** Shopify/eBay create, link, status, and price jobs should deep-link from a product to the exact report row and resolution reason.
8. **Readiness filters.** Add missing-field filtering such as no image, no verified main category, no package dimensions, no price, and no taxonomy mapping.
9. **Row action consistency.** Add open detail, quick view, copy SKU, export one product, sync Shopify status, create marketplace shadow, and inventory detail. Keep mutations inside the action menu.
10. **Column parity.** Finish the optional Created column currently registered in the column chooser, add last Shopify sync, category verification, hazardous, and price-update timestamp.

### Quality and scale

11. **Stable sort contract.** Every visible sortable column needs server ordering and SKU as the secondary deterministic sort.
12. **Batch guards.** Before live creation, show selected/eligible/skipped counts and a link to dry-run results rather than relying only on a browser confirmation.
13. **Product history.** Surface import, pricing, inventory, category, channel, and user edits in a compact audit timeline.
14. **Accessibility and keyboard workflow.** Keyboard row selection, accessible bulk-action announcements, and command-bar actions for frequent catalog work.

## Deliberate consolidation

- Shopify channel-wide operations, credentials, location mapping, shipping profiles, and schedules stay under **Channels > Shopify**. Products exposes per-SKU or selected-SKU actions only.
- Raw source-feed edits remain in **Source Catalog**; Products remains the approved sellable catalog.
- Full product editing stays on the product page/dialog rather than adding fragile inline-table edits.
