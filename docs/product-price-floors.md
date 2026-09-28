# Source minimum prices

Datadump imports recognize minimum_allowed_price, MAP/map_price/mapPrice/
minimum_advertised_price and LAP/lap_price/lapPrice/lowest_advertised_price,
including saved original, raw and productManagerFields objects. LAP means lowest
advertised price, as confirmed by the operator. The highest positive value is
the effective minimum. Preserve MAP and LAP evidence in commercial raw fields;
the existing numeric minimum_allowed_price column stores the effective floor.

Shopify compares the complete calculated price (including freight) with the source
floor and uses whichever is higher. Do not add freight again on top of a winning
MAP/LAP price. Scale the floor using the vendor's pricing cost basis: each-unit
minimums multiply by variant quantity; source sell-unit minimums use the source
UOM quantity. Zero/missing
minimums do not lower a positive source floor. Enforcement at the final variant
boundary prevents optional vendor minimum-price switches bypassing source floors.

The bounded source fallback also preserves the higher of saved product and source
minimums. Existing stored minimums need no full re-import to enforce. The audit
script reads the exact saved BSON dump without modifying catalog data.

Tests: scripts/test-product-price-floors.cjs and
scripts/test-shopify-freight-pricing.cjs.
