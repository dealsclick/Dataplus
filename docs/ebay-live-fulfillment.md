# eBay Live fulfillment

## API source

eBay Live orders arrive through the existing Sell Fulfillment API order endpoints. DataPlus does not need a separate order-import endpoint. The line item payload can identify a Live sale with:

- `purchaseSource: EBAY_LIVE`
- `ebayLiveContext.eventId`
- `soldFormat`
- `combineShipping.shippingWindow.windowId`
- `combineShipping.shippingWindow.status`
- `combineShipping.shippingWindow.shippingWindowEndDate`

The implementation intentionally does not infer Live sales from titles such as `As seen on screen`. eBay's fields are the source of truth.

References:

- [Get order](https://developer.ebay.com/develop/api/sell/fulfillment_api/order/get)
- [Order fulfillment overview](https://developer.ebay.com/api-docs/sell/static/orders/order-fulfillment.html)
- [Handling unfulfilled line items](https://developer.ebay.com/api-docs/sell/static/orders/handling-unfulfilled-lineitems.html)

## Saved provenance

The eBay importer retains Live provenance on the order and line items. It stores the Live event ID, purchase source, sold format, and combine-shipping window. If eBay omits a seller SKU, the line remains fulfillable with the existing listing-ID fallback, but the original blank channel SKU and fallback source are retained for catalog review.

The order page and Fulfillment queue display an `eBay Live` badge. Fulfillment also shows the combine-window state when available.

## Combining Live orders

Operators can select two or more eBay Live orders in Fulfillment and choose **Combine Live orders**. The normal shipment-group workflow is reused so orders, payments, inventory lines, and channel references remain separate.

Safety rules remain mandatory:

1. Payment must be cleared.
2. Recipient and full delivery address must match exactly.
3. Fulfillment warehouse must match.
4. Picked, packed, held, shipped, or labeled orders are excluded.
5. Ship-alone, restricted, and hazardous items cannot be combined.
6. The final carton must remain within parcel weight, longest-side, and length-plus-girth limits.

When both orders have the same eBay combine-shipping window ID, that window can extend eligibility beyond DataPlus's normal 24-hour matching window. It never bypasses customer, address, warehouse, or shipment-state checks.

## Temporary and missing SKUs

Live items may use one-time listing titles and may not provide a seller SKU. Missing catalog measurements no longer block creation of a shipment group when the warehouse enters the final combined package weight and dimensions. The entered carton is saved on the primary order and is used for rate and label work. Catalog creation and alias review remain separate follow-up work.

## Historical orders

Existing eBay orders receive these fields the next time they are refreshed from the Fulfillment API. A historical order must not be tagged as Live from its title alone.
