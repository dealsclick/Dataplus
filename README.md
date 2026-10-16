# DataPlus

Local MVP for managing marketplace inventory and orders across Temu, eBay, Whatnot, TikTok Shop, and future channels.

## Changelog

### 2026-10-16

- Added a bounded eBay open-order status sweep to every scheduled order import. DataPlus now rechecks the oldest locally open eBay orders by exact marketplace order ID, imports any missing fulfillment and tracking records, records when eBay was last checked, and closes obsolete purchasing and fulfillment work when eBay already reports the order fulfilled. This supplements the fast last-modified cursor without requiring a full historical import.

### 2026-10-15

- Fulfillment print packets now restore missing order-level references from purchased batch evidence and refuse to return a partial PDF when the printable-label count differs from the purchased count. Temu import flushes re-read and merge current operational order state so a stale import page cannot erase labels purchased while that import was running.

### 2026-10-14

- Added bounded Fulfillment performance telemetry that separates projection/database read time, response serialization, payload size, API wait time, and browser commit time. System Settings > Fulfillment now shows one-hour p50/p95 diagnostics by queue, slow-sample thresholds, and projection refresh state without retaining order or customer data.
- Replaced normal Fulfillment console reads with an atomically published PostgreSQL projection split by queue. Returning to or refreshing Fulfillment now serves the last complete queue revision immediately while reconciliation runs in the background; label purchases, rate updates, and other actions no longer wait for the 50,000-order recovery snapshot to rebuild. The prior snapshot document is retained only as a rollout/recovery fallback when no projection is available.
- Added memory-only stale-while-refresh page-data caching for Catalog, Orders, Purchasing, and Reports. Returning to a recently viewed page now shows cached data immediately, refreshes it quietly, ignores obsolete responses, and invalidates affected entries after edits, purchases, imports, or status changes.
- Purchasing now loads only operationally active POs on entry and keeps exact status counts through compact database aggregates. Canceled, rejected, and completed PO records load only when their audit tabs are opened, so historical growth no longer expands the normal buyer workspace payload.
- Corrected the Fulfillment pending-shipment queue so completed or already recorded shipments no longer remain visible as work waiting to ship.
- Moved David's AI client out of the default application bundle and load it only when the David workspace is opened.
- Split the Catalog, Purchasing, and Fulfillment workspaces into lazy route bundles so the default shell and unrelated pages do not download their large UI implementations. Fulfillment and Shipping Batches share one on-demand module so their existing rates, label purchasing, print, tracking, and batch behavior remains together.
- Kept the main Orders queue eager while moving Order Detail, Return Detail, and the Returns workspace into on-demand bundles. Orders Data Review and Orders Tools remain independently lazy-loaded.
- Split Channels and System Settings into on-demand route bundles while preserving the existing marketplace credential, permission, save, and refresh callbacks. Walmart remains a nested on-demand bundle inside Channels.
- Reduced the default production JavaScript bundle from about 2.51 MB to 2.19 MB (about 599 KB to 536 KB gzip) by keeping the admin-heavy Channels and Settings implementations out of unrelated page loads.
- Moved the desktop and mobile Warehouse workspaces into one on-demand route bundle. Warehouse loads its roughly 246 KB bundle only when opened, and Fulfillment now follows the same route-level loading pattern in its own shared Fulfillment and Shipping Batches bundle.
- Preserved manually entered order and route package measurements in the compact Fulfillment snapshot. Items that are not yet in the catalog can save shipment-specific weight and dimensions and use them for rate requests; only the optional reusable catalog default requires a catalog product.
- Restored modal-first shipping-batch printing: selecting a batch opens its packet modal instead of silently invoking the browser print dialog. Clicking Print records the document action without a redundant follow-up confirmation. Print audit state remains separate from the operator-controlled Open/Closed warehouse status, where Closed explicitly confirms that physical labels were received and the batch was handled.
- Moved the shared browser API request and date, number, and currency formatting helpers out of `App.tsx` into `web/src/lib/client-api.ts`, preserving mutation-driven workspace cache invalidation.
- Preserved existing loading, error, navigation, and permission behavior across the new lazy route boundaries.

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

## Production deployment

Production runs on the DigitalOcean Droplet at `/root/dataplus` with Docker Compose. The GitHub Actions workflow in `.github/workflows/deploy-production.yml` deploys every push to `master` and can also be started manually from the Actions tab. It backs up the previously deployed server revision, checks out the exact GitHub commit in detached-HEAD mode, rebuilds the web and worker containers, and fails unless the app responds successfully on port `4173`. Deployments stop before checkout when production contains tracked local edits; production commits must be reconciled and pushed to GitHub instead of being accumulated only on the server.

Add these repository secrets in GitHub under **Settings > Secrets and variables > Actions**:

- `DEPLOY_HOST`: the Droplet public IP or hostname.
- `DEPLOY_USER`: normally `root` for the current Droplet.
- `DEPLOY_SSH_KEY`: the complete private SSH key used by GitHub Actions.
- `DEPLOY_KNOWN_HOSTS`: output of `ssh-keyscan -H YOUR_DROPLET_IP`.

The matching public key must be present in the Droplet user's `~/.ssh/authorized_keys`. Keep the private key and application `.env` only on the server or in GitHub Secrets; never commit them.

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
EBAY_APP_SCOPE="https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.inventory"
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

- Purchased-label PDFs use a targeted PostgreSQL read for the requested print job and batch. The viewer does not load the complete fulfillment batch history or rewrite queue state merely to open a packet. Packets are cached briefly by source revision and print options, while missing purchase evidence still follows the guarded recovery path for the affected batch only.
- Purchased Labels keeps print and pick-sheet commands in each row's Actions menu. Shipment rows use compact `Carrier | Service | Source` metadata, show only city/state for destination scanning, and distinguish a locally purchased label from marketplace shipment acknowledgement. The label packet dialog keeps its footer above the device safe area and gives warehouse handling state and print destination stronger visual emphasis.

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

Import the full product dump into the source catalog:

```powershell
npm run import:product-dump -- data/imports/products.bson.gz
```

In production, prefer the app button/API for full data-dump refreshes instead of the direct CLI command. Open Source Catalog or Jobs, run the product dump import, and keep the external worker online with `npm run worker`. The queued job uses the `product-dump-import` worker task and passes `--postgres-only`, so the BSON dump streams directly into PostgreSQL instead of building the huge local NDJSON and change-snapshot files in memory.

The streaming import writes the current vendor feed into:
- `vendor_feed_runs` for the refresh run record.
- `vendor_catalog_items` for the latest source catalog row by vendor/source SKU.
- `vendor_catalog_snapshots` for the feed-run snapshot.
- `product_change_events` for field-level cost, stock, price, status, and catalog changes.

This is the normal path for large dumps. It avoids the legacy JavaScript heap pressure that came from loading `data/catalog/change-snapshot.tsv` and writing full local artifacts during a multi-million-row import. Jobs shows progress as `Streamed <n> product dump records into PostgreSQL`; if the worker is offline, the job stays queued or shows waiting/stopped worker health until `npm run worker` is running again.

The direct CLI command is still useful for diagnostics and small test runs. Use `--limit` for samples. Limited non-Postgres test imports write `data/catalog/products.sample-<limit>.ndjson` so they do not replace the full source catalog. Only run the legacy artifact-producing path when you intentionally need to rebuild `data/catalog/products.ndjson`.

Rebuild the fast source catalog index after importing or replacing `data/catalog/products.ndjson`:

```powershell
npm run catalog:index
```

This creates `data/catalog/index`. It makes supplier filtering and SKU CSV promotion much faster for the legacy local catalog artifact. PostgreSQL source catalog screens primarily use `vendor_catalog_items` plus Postgres indexes/facets; use the app's source catalog optimization/facet refresh jobs after large database imports when filters or supplier lists look stale.

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
# In the app, queue the Source Catalog product dump import first.
npm run worker
npm run catalog:index
npm run import:shopify-taxonomy
npm start
```

For a normal large refresh, the practical order is:

1. Confirm `DATABASE_URL` is configured and Jobs > Job runner is set to `External worker`.
2. Start or verify the worker with `npm run worker`.
3. Queue the Source Catalog product dump import from the app.
4. Watch Jobs for the `product-dump-import` job and streamed row count.
5. After completion, refresh source catalog facets/indexes if filter lists look stale.
6. Run Shopify/Matrixify exports only after the dump import is complete, because the default worker processes one job at a time.

Only use `--inventory` when you intentionally want dump records added directly to the smaller active catalog:

```powershell
npm run import:product-dump -- data/imports/products.bson.gz --inventory --limit 1000
```

## Order-import SKU creation

Marketplace channels include a **Create SKU from order import** setting. It defaults on for every existing and new channel. When an operational Shopify, eBay, Temu, or Walmart order contains an SKU that does not resolve to a managed product or active alias, DataPlus creates one local Draft product before saving the order. The product records DataPlus-system provenance, the source channel/order, and an open catalog-attention reason. The order timeline and channel activity ledger record the creation, and import jobs report generated SKUs that need review. Historical reporting backfills do not create products.

System-created order-import products remain in Catalog > Readiness and show a warning on Product Detail until an operator explicitly selects **Mark reviewed**. They cannot be launched to Shopify, eBay, or Walmart while review is open. Complete the product identity, supplier, cost, content, and shipping fields, or deliberately link the imported SKU as an alias of the correct existing catalog product. Disabling the channel setting restores the blocking missing-SKU workflow for future imports without deleting products already created.

## External PO warehouse receipts

Use warehouse audit reason **External PO receipt** when physical inventory arrives against a PO created in the system being replaced. Select the supplier and enter the external PO number before counting. DataPlus posts inventory only through the normal reviewed audit completion, preserves receiving documents and the external reference, and reserves link fields so the audit can later be associated with the corresponding DataPlus PO without rewriting receipt history.

Vendors can be created from the Vendors page or directly beside the supplier picker for an External PO receipt. Both entry points use the same form and create an inactive, catalog-excluded profile. Creating from the receipt selects the new supplier immediately; complete and deliberately activate its full profile later. Duplicate supplier names and vendor codes are rejected case-insensitively.

## Next production steps

1. Add real marketplace API credentials and connector modules per source.
2. Replace JSON storage with PostgreSQL before DigitalOcean hosting.
3. Add order grouping, shipment purchase, label printing, and audit history.
4. Add authentication before exposing the app outside your local network.

## Fulfillment projection performance

Fulfillment queues are served from revisioned PostgreSQL projections. Routine order, package, rate, tracking, and shipping-label changes replace only the affected order rows and recalculate queue counts in one transaction. The scoped writer reads only the changed orders, their linked purchase orders, required products, and matching label batches. It does not rescan the 50,000-order recovery window.

The complete fulfillment rebuild remains a background integrity operation for startup, cold recovery, periodic reconciliation, and global configuration changes. All Shipments uses server-side projection pagination and applies its search and queue filters before selecting the requested shipment-group page, so completed history is not transferred to the browser on every visit.

Desktop print-agent polling is also targeted. Heartbeats read and update only the print-station collection; job polls claim one eligible queue entry under a PostgreSQL row lock; acknowledgements patch one queue entry; and document requests load only their print job and related batch. These high-frequency endpoints must not call the full fulfillment operations-state reader or rewrite the complete print queue.

Purchased-label packets open in a compact print dialog. Document mode, packing-slip orientation, destination, warehouse handling status, print count, and saved-PDF state remain visible without loading the PDF. Preview is opt-in; browser Print loads the packet in a temporary same-origin frame, opens the print dialog, records print/channel activity, and removes the frame afterward. Closing the warehouse batch remains a separate deliberate action.

Print packets retain the exact purchased document IDs present when each packet is created. If marketplace label generation finishes after that point, DataPlus automatically creates a separate open recovery batch and print packet for only those late labels. Recovery is idempotent and reuses the purchased documents; it does not buy labels again or alter the original packet. The recovery batch and print dialog identify the original batch with a compact `Recovered from BATCH-####` label.
