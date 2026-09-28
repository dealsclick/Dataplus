# Warehouse barcode lookup performance

Audit camera lookup and the following Next action both use `findBarcodeMatches`. Exact matches use existing barcode/UPC/GTIN indexes. When no exact product matches, the fallback normalizes punctuation and case across four fields. Without matching expression indexes, every unknown scan reads the entire managed catalog, twice across lookup and Next.

Apply `scripts/warehouse-scan-indexes.sql` with psql outside a transaction. It builds all four indexes concurrently, preserving online reads/writes and all existing matching and mutation behavior. It does not create products, count stock, or change barcode identities. Do not add these builds to request-time schema initialization.

Run `node scripts/test-warehouse-scan-indexes.cjs` on local PostgreSQL. It validates exact and normalized matches, source-only records, unknown codes, the letter-O/digit-0 distinction, and a plan using all four index branches instead of a sequential scan.

After deployment, verify `pg_index.indisvalid` for all four indexes, then measure the normalized lookup in a read-only transaction. A canceled concurrent index build can leave an invalid index; inspect it before retrying because IF NOT EXISTS does not rebuild an invalid index.

Audit scan and manual-item requests read only warehouse reference records, rather than loading the global inventory summary. The UI applies the saved audit returned by the mutation instead of refreshing all state after every scan or SKU creation. Run `node scripts/test-warehouse-scan-routes.cjs` to verify counts, bin assignment, creation provenance, and closed-audit protection on these lightweight paths.
