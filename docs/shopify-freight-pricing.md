# Shopify pricing and freight

Shopify merchandise pricing uses a 28% cost markup, retaining supplier website
price precedence, vendor UOM rules, minimum-price protection and the existing
generated multipack discount. LTL adds the channel's `shopifyLtlFreightAllowance`
(default $250) once per selling unit after merchandise pricing. This allowance
does not apply to Ground or Shipping review products. It is not a freight quote.

Product creation and shipping eligibility sync write `custom.shipping_class`,
`custom.shipping_method`, `custom.shipping_class_reason`, and
`custom.freight_price_allowance`. Products without measurements retain the
Shipping review classification. The allowance is stored separately from cost.

The shipping eligibility API remains POST `/api/shopify/shipping-eligibility/sync`.
Its apply jobs now refresh classification metafields before tags and profile
assignment and surface failed metafield writes as per-product errors.

Rollout must verify a zero-charge delivery profile for freight-included products,
then apply pricing and profile changes together before enabling LTL selling.
The existing `shopifyFreightShippingRate` describes checkout freight; it is not
the product-price allowance. Do not imply changing that local setting updates
Shopify's actual delivery rates. Multi-item shipment consolidation requires a
separate shipping calculation; the product-price allowance is per selling unit.
