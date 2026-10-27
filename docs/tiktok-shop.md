# TikTok Shop integration

DataPlus has a dedicated TikTok Shop channel workspace, signed API client, encrypted runtime credentials, PostgreSQL documents, and background jobs. The integration is currently limited to the LINQ operational company while tenant isolation is completed.

## Security and authorization

- Set `DATAPLUS_CREDENTIALS_ENCRYPTION_KEY` to a stable 32-byte base64 value or 64-character hex value before saving credentials in the UI.
- TikTok app secrets, access tokens, and refresh tokens are encrypted with AES-256-GCM and never returned to the browser.
- Environment variables are supported as a server-only fallback. Never use `VITE_*` variables for TikTok credentials.
- DataPlus refreshes the seller access token when it is within five minutes of expiration and a refresh token is available.
- Every request is signed over the exact versioned API path, sorted common parameters, and request body.
- The channel master switch and the operation-specific feature switch are checked before queueing and during each job page.

## Available operations

| Area | DataPlus behavior | API version |
| --- | --- | --- |
| Shops and permissions | Verify authorization, read granted permissions, and select one shop | Authorization/Seller `202309` |
| Orders | Page by update time, preserve multi-line source identity, and import historical orders without operational routing | Order search `202309` |
| Returns | Import reverse orders and map exact order line IDs before SKU fallback | Return/Refund `202602` |
| Statements | Import statement transactions as channel-fee ledger rows with source evidence | Finance `202309` and `202501` |
| Catalog | Reconcile TikTok products to exact seller SKUs and retain remote status | Product search `202502` |
| Product launch | Validate each SKU, submit eligible unlinked products independently, and retain per-SKU failures | Product `202309` |
| Inventory and price | Update linked SKU IDs only when the computed payload changed | Product `202309` |
| Buyer messages | Synchronize conversations and message history, mark read, and reply from the shared Messages workspace | Customer Service `202309`, `202601`, and `202606` |
| Shipping | Query services, require a user-owned preview, create a package once, and retrieve shipping documents | Fulfillment `202309` and package create `202512` |
| LIVE analytics | Import seller LIVE sessions, sales, traffic, engagement, and per-session product performance | Analytics `202609` and `202512` |
| LIVE order attribution | Mark imported orders and lines attributed to `LIVE` or `PRE_LIVE` content without changing fulfillment behavior | Affiliate Seller `202410` |
| Commerce analytics | Save shop, product, SKU, and video performance by bounded date windows | Analytics `202509` |
| Affiliate and promotions | Read available collaboration, creator, activity, coupon, and engagement-template data without blocking other scopes | Affiliate Seller through `202508`, Promotion `202309`/`202406` |
| Webhooks | Verify the raw-body HMAC, deduplicate in PostgreSQL, and queue targeted source reconciliation | Event `202309`; inventory event type `71` |

LIVE analytics and LIVE order attribution are separate permissions. Analytics provides session and product performance. Seller affiliate order access provides the content type, content ID, and creator attribution needed to identify a TikTok LIVE order. DataPlus does not infer LIVE origin from an SKU, order time, or title when TikTok does not provide attribution.

TikTok also exposes creator-authorized LIVE-room product-management APIs. Those APIs require a creator access token, which is different from the seller token configured in DataPlus. The current channel page reports that capability but does not allow seller credentials to pin, unpin, add, or remove a creator's LIVE products.

Product launch remains deliberately bounded and reports incomplete category, TikTok-hosted image, package, weight, price, warehouse, freight, or inactive-product data as row-level review results. Existing linked listings are maintained by the dedicated price and inventory jobs instead of being resent through a create payload.

Webhook subscriptions are configured from Channels > TikTok Shop > Webhooks. TikTok signs `app_key + raw request body` with the app secret using HMAC-SHA256. DataPlus verifies the signature before parsing operational intent, inserts each event identity once, preserves inventory snapshots as evidence, and re-reads authoritative source records before changing local channel metadata.

## Jobs and isolation

Orders and returns run in `orders-tiktok`. Other manual TikTok work runs in the manual lane, while scheduled imports and webhook recovery run as background work. Jobs produce NDJSON evidence and retain normal retry/stop behavior.

Historical order imports set the DataPlus historical isolation fields. They do not route fulfillment, reserve inventory, create purchase demand, buy labels, or advance another channel's checkpoint. Existing channel orders are refreshed by TikTok Shop identity rather than duplicated.

## Setup

1. Create a seller-developed custom app in TikTok Shop Partner Center and authorize the LINQ shop.
2. Request only the scopes needed for the enabled features.
3. Configure the encryption key in the deployment secret store.
4. Open Channels > TikTok Shop, save the app key, app secret, seller access token, and refresh token.
5. Enable the channel, verify the connection, and select the authorized shop if more than one is returned.
6. Enable individual features and schedules deliberately.
7. Request Analytics access before enabling LIVE analytics. Request Seller Affiliate Collaboration access before enabling LIVE order attribution; Affiliate APIs are not enabled for every app by default.
8. Run a small development-shop import and inspect Jobs and channel activity before enabling production schedules.

Official references:

- <https://partner.tiktokshop.com/docv2/page/common-parameters>
- <https://partner.tiktokshop.com/docv2/page/api-versioning>
- <https://partner.tiktokshop.com/docv2/page/order-api-overview>
- <https://partner.tiktokshop.com/docv2/page/71ztxsw4>
- <https://partner.tiktokshop.com/docv2/page/10lt0djm>
