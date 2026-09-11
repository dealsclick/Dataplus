# Datadump supplier discovery

PostgreSQL datadump jobs with discovery enabled observe supplier names and feed codes before checking product eligibility. At the end of the discovery scan, missing supplier profiles are registered with catalog participation disabled. Existing profiles, inactive/retired status, catalog settings and operational records are preserved. A supplier profile is not evidence that its products were imported.

The job's `discovery.ndjson` includes supplier row counts, example SKUs and newly registered profiles. Dry runs report profiles that would be registered without saving them. After an operator reviews a supplier in Vendors and enables catalog participation, the next discovery run can insert eligible new SKUs. Identifier candidates still require review. This does not publish marketplace listings.

To investigate a missing supplier, audit the exact file used by the relevant job. A MongoDB document does not prove that the downloaded export contains that document.

```powershell
node scripts/audit-datadump-suppliers.cjs --source data/imports/products.bson.gz --output outputs/datadump-supplier-audit.json --sku BUS00667C2GDH
```

The audit reads the entire file without database access or FTP downloads. Its report includes file size/modification time, supplier counts and exact SKU matches. Check the job download time and export freshness if the supplier or SKU is absent. Compare against the deployed file; a workstation copy may be stale.

Vendor profile > Actions > Refresh catalog from stored records previews the number of saved supplier source rows and queues a `vendor-catalog-refresh` worker job. It reads that supplier's indexed records in 500-row keyset batches, inserts only missing eligible catalog identities and leaves existing catalog content and live channels unchanged. The supplier must be active, not retired, and catalog-enabled; new-SKU creation must also be enabled. Stop/retry and per-SKU NDJSON review results are available in Jobs. Source mappings and supplier eligibility are rechecked while running.

Older lean source rows may lack the original `active` flag. These are review results, not assumed active. New imports retain that flag. A missing-status row cannot be safely activated from the saved evidence alone. The action does not rerun the global supplier-coverage rebuild.

Validation:

```powershell
node scripts/test-datadump-suppliers.cjs
node scripts/test-product-dump-discovery.cjs
node scripts/test-vendor-catalog-refresh.cjs
# DATAPLUS_TEST_DATABASE_URL must identify an isolated local database ending in _test.
node scripts/test-datadump-suppliers-postgres.cjs
node scripts/test-vendor-catalog-refresh-postgres.cjs
```
