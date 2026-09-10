# Master inactive inventory protection

Catalog Inactive overrides channel selling quantity, not the inventory ledger.
The Temu, Whatnot, and TikTok Shop workers added here are **zero-only**: they
never publish a product or send positive inventory after reactivation.

## Operator workflow

1. Open Channels and select the channel.
2. Enable the channel and its inventory synchronization setting.
3. Choose Actions > Review inactive inventory and inspect the Jobs artifact.
4. Resolve missing credentials or exact listing links.
5. Choose Actions > Zero inactive inventory and confirm.
6. Review the job's per-SKU results. A warning means at least one SKU still
   needs attention. Retry creates a fresh pass; interrupted jobs retain a cursor.

The existing marketplace inventory coordinator also queues these workers
alongside Shopify/eBay work. This does not create a separate periodic schedule.
Disabled channels cannot receive API writes. Stock at local warehouses,
reservations, orders, prices, and publication flags remain unchanged.

## Linking and credentials

Existing saved flat channel IDs or channel Listing objects are accepted. Multiple
links can be represented by `channelInventoryLinks` arrays keyed by `temu`,
`whatnot`, and `tiktok`. Each entry uses:

| Channel | Required identifiers | Runtime credentials |
| --- | --- | --- |
| Temu | productId (goods ID), skuId | Existing Temu channel connection |
| Whatnot | listingId | WHATNOT_ACCESS_TOKEN; staging uses WHATNOT_STAGING_ACCESS_TOKEN |
| TikTok | productId, skuId, all warehouseIds | TIKTOK_APP_KEY, TIKTOK_APP_SECRET, TIKTOK_ACCESS_TOKEN, TIKTOK_SHOP_CIPHER |

No matching by title or brand is performed. Missing IDs must be fixed through
channel linking; this feature does not provide OAuth onboarding, automatic
listing discovery, or a new mapping editor. Credentials must never be stored in
product links or artifacts.

## API contracts

- Temu `bg.local.goods.stock.edit`: absolute `skuStockTargetList` target zero,
  separate ordinary (0) and presale (1) requests. Both need explicit per-SKU
  success. A failure in either pool leaves the SKU needing attention.
- Whatnot `listingUpdate`: only listing ID and inventoryLevel.quantity zero.
  The returned listing ID and quantity must match; GraphQL/user errors fail.
- TikTok Update Inventory: all saved warehouse IDs, quantity zero, backorder
  quantity zero. Success is recorded as API acceptance, not independent readback.

Official references verified September 10, 2026:

- [Temu API reference](https://partner.temu.com/documentation?menu_code=fb16b05f7a904765aac4af3a24b87d4a), Product > Manage Products > bg.local.goods.stock.edit
- [Whatnot schema](https://developers.whatnot.com/docs/schemagraphql)
- [Whatnot authentication](https://developers.whatnot.com/docs/getting-started/authentication)
- [TikTok Update Inventory](https://partner.tiktokshop.com/docv2/page/update-inventory-202309)
- [TikTok signing](https://partner.tiktokshop.com/docv2/page/sign-your-api-request)

Run `node scripts/test-inactive-channel-inventory.cjs`. These tests use mock
responses and never change live channel quantities. Production activation still
requires valid credentials, scopes, listing links, and enabled channel settings.
