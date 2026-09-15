# Structured datadump categories

DataWarehouse `mapped_category` can contain `level1`, `level2`, `level3`, and further numbered levels. `lib/datadump-category.js` joins nonempty string levels in numeric order with ` > `, retaining UNSPSC separately. It accepts objects, JSON strings, and the saved `productManagerFields.mapped_category` projection. The original object remains unchanged.

Imports and stored-record rehydration use this taxonomy when the conventional category field is absent. Parsing alone does not approve a main category or publish a product. Reusable vendor-category mappings govern future promotion.

For an explicitly authorized supplier repair, use:

```sh
node scripts/repair-datadump-categories.cjs --vendor=dh '--supplier=D&H'
node scripts/repair-datadump-categories.cjs --vendor=dh '--supplier=D&H' --apply
```

The first command previews saved commercial records. Apply fills missing source and main category projections in 500-record transactions, retains existing main-category choices and raw source evidence, and creates a visible operation job plus a local before-image audit under `outputs/category-repair-<job-id>`. It does not download or re-import the dump, change prices or quantities, or publish to a marketplace. Register reusable vendor mappings and rebuild the main category index after applying. Shopify taxonomy mapping remains a separate operation; uncertain matches must remain reviewable.

Validation: `node scripts/test-datadump-category.cjs` exercises raw objects, stored objects, serialized JSON, numeric level order, malformed fields, UNSPSC separation, existing-category precedence, and the actual importer.
