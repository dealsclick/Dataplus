# Shared Accounting Ledger

## Scope

The new React order and linked-return Transactions tabs expose Reported amounts,
Ledger entries, Export history, and Account mappings. Reported amounts are channel
snapshots, not booked accounting entries. No financial posting happens on import,
page load, refund receipt, or stock movement.

This first release supports per-order, reviewed journals and general journal CSV
exports. It does not connect to accounting software, automatically import settlement
statements, match bank deposits, convert currencies, or post historical orders.
Account mappings and recognition policies should be reviewed by the company's
accountant before using exports in real books. The CSV is a documented interchange
format, not a claim of native import compatibility with every accounting package.

## Workflow

1. Capture saved source amounts in Ledger actions. This reads local saved data;
   it does not call a marketplace. Changed amounts append observation versions.
2. Create a balanced draft with an event description, date, currency, internal
   accounts, and supporting evidence. Source links are optional for an explicitly
   documented manual event. Return journals retain their linked return ID.
3. Review and post. Posting validates exact balance, current observations, currency,
   closed periods, and duplicate source use. Estimates require explicit human
   review; they are never automatically booked. Unknown/pending observations cannot
   be posted. Temu net proceeds, estimated deductions, and buyer refund snapshots
   are reference-only, preventing an aggregate balance from being mistaken for a
   separate seller debit. An actual deduction requires a separately evidenced journal.
4. Configure destination account mappings. These are company-wide, versioned,
   and preserve old versions in their audit history and export snapshots.
5. Select posted journals and create an export batch. Download the existing batch
   again to retry an external import. A different request cannot export the same
   journal to the same destination again.
6. After importing externally, record the receiving system's reference. Exported
   and import-confirmed are separate states. DataPlus does not verify external
   software automatically.

Posted lines are immutable. A reversal is a new opposite journal with a link to
the original; an adjustment is a separately reviewed draft linked to the original.
Reversing a journal does not undo a channel refund or a warehouse movement.
Period closure is forward-only through this interface.
Original entries and their reversals must be exported together unless the original
was already exported to that destination. Existing entry and batch history remains
available through the canonical order-ID API even if the source order is removed.

The order Actions menu now opens the ledger Export history view. The old
`/api/orders/accounting-export.csv` route remains a legacy operational summary for
existing consumers; it is not a reviewed journal export and is not used by the new UI.

## Storage and API

`accounting_documents` is a separate PostgreSQL table with a primary key. It is
not loaded into generic app state and is not overwritten by channel order upserts.
One document stores the bounded ledger history for each internal order ID; a
separate document stores global mappings and period closure. Document writes use
`BEGIN`, `SELECT FOR UPDATE`, and `COMMIT` on the same connection. Posting and
exports take a shared configuration lock. Failed validation rolls back the whole
operation. PostgreSQL is mandatory; there is no JSON-file accounting fallback.

The initial per-order limits are 100 journal lines, 100 linked observations per
journal, 500 entries per export, 5,000 source-history observations, and a 10 MiB
document-size guard. Reaching a limit fails explicitly; history is never silently
trimmed. Cross-order payout reconciliation and company-wide batch paging need a
normalized ledger query index before being added at larger scale.

- `GET /api/accounting/orders/:orderId`: ledger, accounts, settings, permissions.
- `POST /api/accounting/orders/:orderId/capture`: capture saved observations.
- `POST /api/accounting/orders/:orderId/journals`: create an idempotent draft.
- `POST /api/accounting/orders/:orderId/journals/:id/post`: reviewed posting.
- `POST /api/accounting/orders/:orderId/journals/:id/discard`: discard a draft.
- `POST /api/accounting/orders/:orderId/journals/:id/reverse`: append a reversal.
- `POST /api/accounting/orders/:orderId/exports`: freeze a mapped export batch.
- `GET /api/accounting/orders/:orderId/exports/:id.csv`: repeatable CSV download.
- `POST /api/accounting/orders/:orderId/exports/:id/confirm`: external import reference.
- `GET/PUT /api/accounting/settings`: versioned destination mappings and period close.

Permission area `orders.accounting` has separate view, create, post, reverse,
export, and configure actions. Existing parent permission inheritance applies.
Actor, timestamp, references, entry status, mapping version, export checksum, and
external import acknowledgement are retained. Money uses safe integer minor units;
supported precisions are explicit, with no automatic FX conversion.

## CSV Contract

UTF-8 CSV, quoted cells, CRLF records, one row per journal line. Text cells that
could be spreadsheet formulas are escaped. Columns:

Batch ID, Journal ID, Date, Account key, Account name, Debit, Credit, Currency,
Order ID, Order number, Channel, Return ID, Source observation IDs, Description,
Evidence, Reverses, Adjusts.

Debit/Credit contain non-negative decimal amounts; a journal balances within its
own currency. Exports never combine currencies into one total. The saved batch
includes its account mappings and immutable entry copies, so later configuration
changes do not alter previously downloaded bytes.

## Verification

```
node --test --test-isolation=none scripts/test-accounting-ledger.cjs
```

For real PostgreSQL lock/rollback tests, set `LEDGER_TEST_DATABASE_URL` to an
isolated localhost database whose name ends in `_ledger_test`, then run
`scripts/test-accounting-postgres.cjs` with the Node test runner. It creates and
drops a process-specific schema only. It refuses non-local or non-test databases.

Reference connector contracts for future adapters:
- https://quickbooks.intuit.com/learn-support/en-us/help-article/import-export-data-files/import-journal-entries-quickbooks-online/L4tQBwbs7_US_en_US
- https://developer.xero.com/documentation/api/accounting/manualjournals/

## Accounting Workspace

The React `/accounting` page is the central workspace, available from the Operations sidebar to users with `orders.accounting.view`. It lists journals and export batches across all order ledgers with server-side search, status/date filters, total counts, and 50-row pagination. There is no overall record cap. Account mappings and period closing are available without selecting an order.

`GET /api/accounting/records` accepts `kind=journals|batches`, `q`, `status`, `from`, `to`, and `page`. It returns only compact record summaries, never entire ledger documents. It reads the accounting table only and does not trigger order imports or channel API requests. Dates refer to journal dates or export creation dates. The list is not a consolidated trial balance or cross-order export batch generator.

Open an order ledger directly at `/accounting?order=<internal-id-or-number>`. Existing Transactions tabs link here and remain available as contextual views of the same records.
