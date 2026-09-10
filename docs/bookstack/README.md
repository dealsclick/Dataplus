# DataPlus Operations Wiki

DataPlus uses BookStack as the editable operations handbook. The wiki is a separate service on the production host and is routed at `https://dataplusapp.duckdns.org/wiki`.

## Run it

1. Generate two strong database passwords plus a BookStack application key, then set `BOOKSTACK_DB_ROOT_PASSWORD`, `BOOKSTACK_DB_PASSWORD`, and `BOOKSTACK_APP_KEY` in the production `.env` file. Generate the application key with the BookStack container's `appkey` command; do not reuse the database passwords.
2. Start only the wiki profile:

   ```sh
   docker compose --profile wiki up -d bookstack-db bookstack
   ```

3. Configure Nginx with [`nginx-bookstack.conf`](./nginx-bookstack.conf), then validate and reload it.
4. Create the initial BookStack administrator and a least-privilege API automation account from BookStack's user settings. Keep its API token only in the production secrets store, never in this repository.

## Email delivery

BookStack sends invitations and password resets to DataPlus's internal SMTP relay at `dataplus:2525`. The relay is private to the Docker network and uses the shared provider configured in DataPlus under **System Settings > Email**.

For Resend, choose **Resend** in that screen, enter the Resend API key, select a verified sender address, save, and send a test email. The same configuration is used for DataPlus operational messages and BookStack; do not add the Resend key to the BookStack container.

## Content model

- Shelf: `DataPlus Operations Handbook`
- Books: Orders, Fulfillment, Returns, Purchasing, Warehouse, Accounting, DataPlus reference
- Pages: one repeatable operating procedure per workflow, with owner, last reviewed date, prerequisites, steps, exception paths, and related DataPlus links.

The DataPlus automation account may create and update only this shelf. Policy and security pages remain owned by administrators.
