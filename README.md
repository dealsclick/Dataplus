# DataPlus

Local MVP for managing marketplace inventory and orders across Temu, eBay, Whatnot, TikTok Shop, and future channels.

## Changelog

### 2026-05-13

- Added eBay listing operations for product SKUs, including draft mapping, offer creation, publishing, category search, item specifics, pricing defaults, quantity planning, and bulk launch for eBay-ready products.
- Expanded eBay channel setup with seller account sync, merchant location creation, business policy selection, marketplace/currency defaults, listing format, condition, image, and best-offer settings.
- Added eBay catalog import to pull live offers/listings back into DataPlus, map them to products where possible, and queue unmatched catalog reviews.
- Upgraded order management with queue views, order actions for void/done/delete, financial exclusion for voided orders, better reportable-order handling, and SKU mapping tools for marketplace order lines.
- Added product SKU operations for renaming SKUs, creating shadow SKUs, backfilling source catalog data, and preserving aliases from mapped marketplace order lines.
- Expanded catalog and category management with table/card views, eBay taxonomy mapping, channel category refresh, attribute mapping, Matrixify smart collection/menu review tools, and bulk category workflows.
- Improved import/export operations with saved import job files, original/error downloads, mapped CSV templates, Shopify status import, and export mapping sidecar storage.
- Improved startup and state payload performance by ignoring generated `outputs/`, trimming oversized public state payloads, compacting eBay listing data, and caching local JSON reads in memory.

## Run locally

```powershell
npm.cmd start
```

Open `http://localhost:4173`.

## Run with Docker

Docker keeps the app and Node dependencies isolated. Your local `data` folder is mounted into the container, so product catalog files, jobs, imports, and `data/db.json` stay on your PC.

1. Install Docker Desktop for Windows and start it.
2. Open PowerShell in this project folder:

```powershell
cd C:\Users\luis\Documents\codex\dataplus
```

3. Build and start DataPlus:

```powershell
docker compose up --build -d
```

4. Open:

```text
http://localhost:4200
```

Useful Docker commands:

```powershell
docker compose logs -f
docker compose restart
docker compose down
docker compose up -d
```

The Docker port mapping is `4200:4173`, so your browser uses port `4200` and the app inside Docker uses port `4173`.

When `DATABASE_URL` points at `localhost` or `127.0.0.1`, the Docker setup routes it to your Windows host automatically so the container can use the same local PostgreSQL database as the app on your PC.

To open DataPlus from another device on your home network, find your PC's local IP address:

```powershell
ipconfig
```

Then use:

```text
http://YOUR-PC-IP:4200
```

To temporarily expose DataPlus publicly for free with a Cloudflare quick tunnel:

```powershell
docker compose --profile public up -d cloudflared
docker compose logs --tail 80 cloudflared
```

The logs will show a `trycloudflare.com` URL. This URL can change when the tunnel restarts and has no uptime guarantee.

To turn off public access:

```powershell
docker compose stop cloudflared
```

Public access is risky until authentication is added.

## PostgreSQL

The app can use PostgreSQL when `DATABASE_URL` is present in `.env`. PostgreSQL is the intended storage path for a large catalog because it avoids rewriting the full `data/db.json` file for one product/job update.

```env
DATABASE_URL=postgres://postgres:data_plus_123@localhost:5432/dataplus
```

Check the current database connection from the running app:

```text
http://localhost:4173/api/system/database
```

Create/update the relational catalog operations schema and migrate current products into PostgreSQL:

```powershell
npm run db:migrate
```

By default this migrates products, vendors, identifiers, vendor offer snapshots, jobs, and the remaining app state documents into PostgreSQL. It intentionally does not write the old whole-app `app_state` JSON snapshot because that can hit Node string-size limits on large catalogs. If you need the old legacy snapshot for a one-time test, run:

```powershell
npm run db:migrate -- --legacy-app-state
```

During the transition, `data/db.json` remains a fallback/backup. Runtime reads and writes prefer PostgreSQL when `DATABASE_URL` is configured.

Large app modules are split into `entity_documents` rows by collection, so categories, orders, POs, vendors, brands, warehouses, templates, and channel connections can change without rewriting one large JSON document.

Marketplace-critical lookup data is also normalized:
- `product_aliases` powers SKU alias lookup for future imports and mapped marketplace SKUs.
- `category_channel_mappings` tracks each master category's channel mapping status and attributes by marketplace.
- `order_records` / `order_line_items` and `purchase_order_records` / `purchase_order_line_items` make queues, reporting, committed/reserved/incoming inventory, and PO status queryable without scanning app JSON.
- `shopify_product_statuses`, `product_quality_rows`, and `product_change_events` power channel filters, readiness queues, and SKU/cost/stock change tracking directly from PostgreSQL.

Operational jobs are stored in `operations_jobs` with artifacts in `operation_artifacts`. Exports, large source catalog imports, data-quality scans, source catalog index/facet rebuilds, and PostgreSQL backups are cancelable from Jobs and report progress/ETA.

Use `GET /api/system/readiness` to confirm Postgres source-of-truth health, row counts, job mode, quality snapshot size, Shopify status rows, and API log retention. Use Jobs > Backup Postgres to create a background backup of operational tables. By default the huge source catalog tables are skipped; turn on `DATAPLUS_BACKUP_INCLUDE_SOURCE_CATALOG=true` or the matching system setting only when you want a full source-catalog backup too.

For long-running production work, switch Jobs > Job runner to `External worker`, then run:

```powershell
npm run worker
```

External worker tasks include `postgres-backup`, `data-quality-scan`, mapped product exports such as Shopify/Matrixify templates, category exports, source catalog imports, source catalog search-index builds, source catalog performance-index builds, source catalog facet refreshes, mapped CSV product imports, Shopify status CSV imports, Shopify status API syncs, eBay catalog/account/location syncs, and product dump imports. The worker claims queued tasks from PostgreSQL, updates progress in `operations_jobs`, and writes artifacts/results back to Jobs so the web server request does not have to stay alive. Data quality worker scans can be toggled from Jobs with `Run quality scans on worker`; automatic post-import scans can be toggled separately.

For local verification or scheduled maintenance runs, use one pass of the worker:

```powershell
npm run worker:once
```

External-worker jobs are intentionally not cleaned up as abandoned server jobs. If the web server restarts, queued worker jobs stay queued until a worker claims them, and running worker jobs keep their last persisted progress in Jobs. Failed, stopped, and completed worker jobs can be retried from the job profile; the retry creates a fresh queued job with the same saved worker payload and original file reference when one exists.

## Temu order import

Create a local `.env` file in this folder with your Temu Open Platform credentials:

```env
TEMU_ENDPOINT=https://openapi-b-us.temu.com/openapi/router
TEMU_APP_KEY=your_temu_app_key
TEMU_APP_SECRET=your_temu_app_secret
TEMU_ORDER_PAGE_SIZE=50
```

Restart the app after saving `.env`.

Configure this local callback URL in the Temu app while testing locally:

```text
http://localhost:4181/auth/temu/callback
```

After the seller authorizes the app, Temu redirects back with `?code=...`. The app exchanges that code with `bg.open.accesstoken.create`, saves the returned access token locally, and then `Sources` > `Temu` > `Sync orders` can import orders.

If the redirect lands somewhere else, copy the `code` value and paste it into the Temu source card's authorization code field.

The first Temu import looks back 90 days. Later imports overlap the previous run by 1 hour and upsert orders by Temu parent order number.

## eBay order import

Create or update your local `.env` file with your eBay Developer Program keys:

```env
EBAY_ENVIRONMENT=production
EBAY_CLIENT_ID=your_ebay_client_id
EBAY_CLIENT_SECRET=your_ebay_client_secret
EBAY_RUNAME=your_ebay_redirect_uri_name
EBAY_SCOPE=https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.account.readonly
EBAY_APP_SCOPE=https://api.ebay.com/oauth/api_scope
EBAY_MARKETPLACE_ID=EBAY_US
EBAY_CURRENCY=USD
EBAY_MERCHANT_LOCATION_KEY=your_ebay_inventory_location_key
EBAY_PAYMENT_POLICY_ID=your_ebay_payment_policy_id
EBAY_RETURN_POLICY_ID=your_ebay_return_policy_id
EBAY_FULFILLMENT_POLICY_ID=your_ebay_fulfillment_policy_id
EBAY_ORDER_LOOKBACK_DAYS=90
EBAY_ORDER_PAGE_SIZE=50
```

In the eBay developer portal, configure the RuName accept URL to point at your running local app:

```text
http://localhost:4200/auth/ebay/callback
```

Restart DataPlus after saving `.env`, then open `Channels` > `eBay` > `Connect eBay`. After authorizing, use `Sync orders` to import real eBay seller orders into the Orders workspace.

The first eBay import starts at Jan 1 of the current eBay server year. Later imports overlap the previous run by 1 hour and use eBay's last modified date filter, but never before Jan 1, so order imports stay year-to-date and updated orders are upserted instead of duplicated.

## MVP included

- Dashboard for open orders, low stock, reserved units, and sync history.
- Orders workspace with selectable order details, buyer info, shipping info, items, and estimated profit.
- Internal order numbers separate from marketplace order reference numbers.
- Customer profiles generated from imported orders, including repeat-customer tracking and order history.
- Editable order profit and loss fields for gross sales, product cost, marketplace fees, shipping, and refunds.
- Source cards for marketplace sync flows.
- Demo order downloads for each source.
- Order confirmation that decrements inventory and reserved quantity.
- Inventory table with inline quantity edits.
- Product launch workspace with price, cost, title, images, descriptions, brand, category, barcode, tags, dimensions, and shipping weight.
- CSV import for inventory updates.
- CSV export for inventory.
- High-level reports for profit and loss, sales performance, product performance, returns, and cancellations.
- JSON file storage in `data/db.json`.

## Inventory CSV format

At minimum:

```csv
sku,title,qty
DP-HOME-001,Kitchen Storage Set,25
```

Optional columns: `reorderPoint`, `quantity`, `name`.

## Product BSON dump import

The product catalog can import a gzipped Mongo-style BSON dump from a local file. Full imports write to `data/catalog/products.ndjson` so the app does not try to load hundreds of thousands of products into the operational inventory JSON.

```powershell
npm run import:product-dump -- data/imports/products.bson.gz
```

To intentionally import records into the smaller operational inventory table instead, add `--inventory`. Use this only with a limit or curated file:

```powershell
npm run import:product-dump -- data/imports/products.bson.gz --inventory --limit 1000
```

Preview an import without changing the catalog:

```powershell
npm run import:product-dump -- data/imports/products.bson.gz --dry-run
```

Inspect source keys and mapped DataPlus fields before importing:

```powershell
npm run import:product-dump -- data/imports/products.bson.gz --inspect --limit 3
```

If you already downloaded the FTP file, inspect or import the local file path instead of adding `--ftp` again. The FTP dump can be large, and `--ftp` downloads a fresh copy before running the requested action.

To download the FTP dump first, add these values to `.env`:

```env
PRODUCT_DUMP_FTP_HOST=your_ftp_host
PRODUCT_DUMP_FTP_PORT=21
PRODUCT_DUMP_FTP_USER=your_ftp_username
PRODUCT_DUMP_FTP_PASSWORD=your_product_dump_ftp_password
PRODUCT_DUMP_FTP_REMOTE_PATH=/dump/datawarehouse/products.bson.gz
PRODUCT_DUMP_LOCAL_PATH=data/imports/products.bson.gz
```

Then run:

```powershell
npm run import:product-dump -- --ftp
```

Products are merged by SKU. Existing products keep local shadow SKUs, serial units, warehouse stock, and other operational history while product dump fields refresh catalog details.

## Command reference

Use these commands from the project folder:

```powershell
cd C:\Users\luis\Documents\codex\dataplus
```

Start the local app:

```powershell
npm start
```

Import the full product dump into the offline source catalog:

```powershell
npm run import:product-dump -- data/imports/products.bson.gz
```

When PostgreSQL is configured, this import also normalizes vendor feed data into `vendor_feed_runs`, `vendor_catalog_items`, `vendor_catalog_snapshots`, and `product_change_events`. The NDJSON catalog remains as a backup/search artifact. Limited test imports write `data/catalog/products.sample-<limit>.ndjson` so they do not replace the full source catalog.

Rebuild the fast source catalog index after importing or replacing `data/catalog/products.ndjson`:

```powershell
npm run catalog:index
```

This creates `data/catalog/index`. It makes supplier filtering and SKU CSV promotion much faster. The index should be refreshed after every full product dump import.

Refresh Shopify taxonomy, Shopify category attributes, and Shopify-to-Google category mappings:

```powershell
npm run import:shopify-taxonomy
```

This writes `data/channel-taxonomies/shopify/taxonomy-index.json`. Run it when Shopify updates its product taxonomy or when you want the latest Shopify/Google category mappings.

Migrate JSON state into PostgreSQL:

```powershell
npm run db:migrate
```

Use this when setting up or refreshing PostgreSQL from `data/db.json`.

Common full refresh order:

```powershell
npm run import:product-dump -- data/imports/products.bson.gz
npm run catalog:index
npm run import:shopify-taxonomy
npm start
```

Only use `--inventory` when you intentionally want dump records added directly to the smaller active catalog:

```powershell
npm run import:product-dump -- data/imports/products.bson.gz --inventory --limit 1000
```

## Next production steps

1. Add real marketplace API credentials and connector modules per source.
2. Replace JSON storage with PostgreSQL before DigitalOcean hosting.
3. Add order grouping, shipment purchase, label printing, and audit history.
4. Add authentication before exposing the app outside your local network.
