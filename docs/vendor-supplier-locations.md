# Vendor supplier locations

Vendor supplier locations represent real upstream distribution or fulfillment centers. They are virtual supplier inventory sources, not DataPlus physical warehouses.

## Model

- A vendor with direct feeds or configured locations receives one system-managed aggregate `Virtual Supplier Feed` warehouse.
- Each configured supplier location receives one child virtual warehouse under that aggregate.
- Multiple feeds may contribute to the aggregate. A feed is not itself a warehouse.
- Child locations require explicit feed/API aliases in `sourceLocationIds`. An address or display name never activates inventory.
- Unmapped locations remain visible but are not sellable.
- Deactivated or removed locations are retained as inactive warehouse records so inventory and audit references are not lost.

## Vendor controls

Vendor profile > Inventory > Supplier locations supports:

- active/inactive status;
- stable supplier location code;
- address, timezone, priority, lead time, and cutoff;
- inventory and dropship eligibility;
- inventory freshness limit;
- optional location safety quantity override;
- one or more exact source location identifiers.

Changes are staged with the rest of the vendor edit and persisted through the vendor Save changes action.

## Inventory behavior

Supplier locations never support receiving, bins, physical audits, or transfers. They do not add units to a physical warehouse. Location inventory becomes eligible only after an importer matches an exact source location identifier. Existing aggregate inventory behavior remains unchanged for feeds that do not provide location-level quantities.

Run `node scripts/test-vendor-supplier-locations.cjs` after changing normalization or warehouse synchronization.
