# DataPlus Operations Wiki

DataPlus uses BookStack as the editable operations handbook. The wiki is a separate service on the production host and is routed at `https://dataplusapp.duckdns.org/wiki`.

## Run it

1. Generate two strong database passwords and set `BOOKSTACK_DB_ROOT_PASSWORD` and `BOOKSTACK_DB_PASSWORD` in the production `.env` file.
2. Start only the wiki profile:

   ```sh
   docker compose --profile wiki up -d bookstack-db bookstack
   ```

3. Configure Nginx with [`nginx-bookstack.conf`](./nginx-bookstack.conf), then validate and reload it.
4. Create the initial BookStack administrator and a least-privilege API automation account from BookStack's user settings. Keep its API token only in the production secrets store, never in this repository.

## Content model

- Shelf: `DataPlus Operations Handbook`
- Books: Orders, Fulfillment, Returns, Purchasing, Warehouse, Accounting, DataPlus reference
- Pages: one repeatable operating procedure per workflow, with owner, last reviewed date, prerequisites, steps, exception paths, and related DataPlus links.

The DataPlus automation account may create and update only this shelf. Policy and security pages remain owned by administrators.
