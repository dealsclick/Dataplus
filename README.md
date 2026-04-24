# DataPlus

Local MVP for managing marketplace inventory and orders across Temu, eBay, Whatnot, TikTok Shop, and future channels.

## Run locally

```powershell
npm.cmd start
```

Open `http://localhost:4173`.

## PostgreSQL

The app can use PostgreSQL when `DATABASE_URL` is present in `.env`.

```env
DATABASE_URL=postgres://postgres:data_plus_123@localhost:5432/dataplus
```

Migrate the current JSON state into PostgreSQL:

```powershell
npm run db:migrate
```

For safety, the app still writes a JSON backup to `data/db.json` after each save.

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

The product catalog can import a gzipped Mongo-style BSON dump from a local file:

```powershell
npm run import:product-dump -- data/imports/products.bson.gz
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
PRODUCT_DUMP_FTP_HOST=159.89.90.169
PRODUCT_DUMP_FTP_PORT=21
PRODUCT_DUMP_FTP_USER=datawarehouse
PRODUCT_DUMP_FTP_PASSWORD=your_product_dump_ftp_password
PRODUCT_DUMP_FTP_REMOTE_PATH=/dump/datawarehouse/products.bson.gz
PRODUCT_DUMP_LOCAL_PATH=data/imports/products.bson.gz
```

Then run:

```powershell
npm run import:product-dump -- --ftp
```

Products are merged by SKU. Existing products keep local shadow SKUs, serial units, warehouse stock, and other operational history while product dump fields refresh catalog details.

## Next production steps

1. Add real marketplace API credentials and connector modules per source.
2. Replace JSON storage with PostgreSQL before DigitalOcean hosting.
3. Add order grouping, shipment purchase, label printing, and audit history.
4. Add authentication before exposing the app outside your local network.
