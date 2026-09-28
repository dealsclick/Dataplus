# Supplier selling units

Vendor profile > Rules > Pricing and variation rules > Allowed selling units presents two independent permissions:

- Individual Each allows opening a supplier pack and selling one piece.
- Supplier-defined unit uses the largest valid UOM quantity, minimum quantity, or quantity increment. When all three are one, the supplier-defined unit is Each. When any is greater than one, it is one complete pack or case.

Checking both permissions allows Each and the supplier-defined pack when the calculated quantity is greater than one. At least one permission must remain enabled. The UI stores these combinations in the existing `variationRules.sellingUnitMode` field for compatibility: Individual only, Supplier UOM only, or Individual and case. Existing inherited rules remain visible until an operator makes an explicit selection.

Explicit Individual only or Individual and case permission allows breaking supplier purchasing multiples into individual sales. Existing rules and Supplier UOM only retain their minimum-quantity restrictions. The pack quantity follows the recorded UOM/purchasing multiple; no quantity is invented. For True Value's `EA`, `uom_qty=1`, `min_quantity=4`, Individual and case produces Each and a four-pack. Four ordered four-packs represent sixteen individual units. Supplier minimum quantity, units per sale, and customer order quantity remain distinct; raw feed values are not rewritten.

For a single Supplier UOM/case selling unit, marketplace inventory is the number of complete packs: `floor(available individual pieces / units per sale)`. Remainder pieces stay in local inventory but are not offered on the channel. For example, 753 pieces with a 12-unit MOQ/increment publishes 62 twelve-packs and retains 9 unsellable remainder pieces. A product with fewer pieces than its selling multiple publishes zero.

The setting is saved as `variationRules.sellingUnitMode`; it does not change supplier cost basis, stock allocation, or pricing floors. The primary supplier's policy is used, not an unapproved alternate supplier's policy. Minimum allowed price is a separate monetary restriction and is never bypassed by permission to sell individual units.

The product page displays the permitted units, their SKUs and units per sale. Shopify and eBay launch preparation uses these options. eBay uses a quantity variation listing only when supported by the category; otherwise it uses separate offers. Existing supplier defaults remain unchanged until an operator saves an explicit choice.

## Walmart

Walmart launches use one individual selling unit, individual cost/pricing, and no generated case or variation-group offer. Case-only suppliers are blocked. When the source quantity exceeds one, the operator must confirm that the catalog UPC/GTIN identifies the individual unit, not a shipping case. Bulk launch leaves these products for manual review. This is a DataPlus business rule, not a claim that Walmart prohibits every manufacturer multipack.

Existing Walmart listings without verified single-unit metadata must not be silently repriced or given positive individual-unit inventory when the source quantity exceeds one. Zero inventory remains allowed. Supplier policy changes invalidate launch previews.

## Existing listings

Saving a supplier rule does not publish products, delete variations, or immediately call marketplaces. Subsequent Shopify/eBay inventory syncs zero known disallowed purchase units. Legacy eBay single listings with ambiguous unit identity are zeroed for review when an explicit multi-unit supplier policy is applied; their price is preserved. Review existing listing identities before relaunching changed option sets. Walmart inventory updates similarly zero products whose supplier does not permit individual sales.

## Verification

- `node scripts/test-vendor-selling-units.cjs`
- `node scripts/test-ebay-purchase-units.cjs`
- `node scripts/test-walmart-selling-units.cjs`
- `node scripts/test-walmart-marketplace.cjs`
- `node scripts/test-inventory-safety.cjs`
- `node scripts/test-product-price-floors.cjs`

All fixtures are local and do not publish marketplace listings.
