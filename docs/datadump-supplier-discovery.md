# Datadump supplier discovery

PostgreSQL datadump jobs with discovery enabled observe supplier names and feed codes before checking product eligibility. At the end of the discovery scan, missing supplier profiles are registered with catalog participation disabled. Existing profiles, inactive/retired status, catalog settings and operational records are preserved. A supplier profile is not evidence that its products were imported.

The job's `discovery.ndjson` includes supplier row counts, example SKUs and newly registered profiles. Dry runs report profiles that would be registered without saving them. After an operator reviews a supplier in Vendors and enables catalog participation, the next discovery run can insert eligible new SKUs. Identifier candidates still require review. This does not publish marketplace listings.

To investigate a missing supplier, audit the exact file used by the relevant job. A MongoDB document does not prove that the downloaded export contains that document.

```powershell
node scripts/audit-datadump-suppliers.cjs --source data/imports/products.bson.gz --output outputs/datadump-supplier-audit.json --sku BUS00667C2GDH
```

The audit reads the entire file without database access or FTP downloads. Its report includes file size/modification time, supplier counts and exact SKU matches. Check the job download time and export freshness if the supplier or SKU is absent. Compare against the deployed file; a workstation copy may be stale.

Validation:

```powershell
node scripts/test-datadump-suppliers.cjs
node scripts/test-product-dump-discovery.cjs
# DATAPLUS_TEST_DATABASE_URL must identify an isolated local database ending in _test.
node scripts/test-datadump-suppliers-postgres.cjs
```
