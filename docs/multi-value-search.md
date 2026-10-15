# Multi-value search

Operational search fields in Orders, Catalog, Fulfillment, Shipping Batches, and Purchasing accept up to 100 identifiers at once.

- Values may be separated by commas, semicolons, or line breaks.
- Pasting a column copied from a spreadsheet converts line breaks into a readable comma-separated query.
- The CSV action reads a local `.csv` file in the browser, lets the user choose the identifier column, previews and deduplicates its values, and applies them to the same search field. The file itself is not uploaded or stored.
- A single value keeps the existing fuzzy search behavior.
- Two or more values use match-any exact identifier behavior so unrelated partial matches are not mixed into the result.
- Supported identifiers include internal and channel order numbers, SKUs and aliases, UPCs, tracking numbers, purchase-order numbers, and batch numbers where those fields apply.
- Duplicate values and capitalization differences are normalized before filtering.
- Interactive paste and CSV searches are limited to 100 unique values. Larger CSV files show a warning and can be split into smaller lookups.

PostgreSQL applies multi-value order and catalog filters before pagination. Client-side queues use the same parsing rules for their cached projections, while Fulfillment's paged history sends the multi-value query to its projection endpoint.

Run `node scripts/test-multi-search.js` after changing the parser or delimiter rules.
