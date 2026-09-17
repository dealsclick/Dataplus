# Temu Order Jobs

Temu orders have three independent operations in the React channel workspace:

| Job | Task | Scope |
| --- | --- | --- |
| New order intake | `temu-order-import` | Exact PostgreSQL identity lookup first; only missing paid orders fetch details, amount and shipping address. Missing amount responses defer creation rather than inventing a zero total. |
| Status reconciliation | `temu-order-status` | Existing orders only; detail/status requests without amount, address, package or label requests. Preserves commerce, SKU mappings and local work. Includes cancellations of existing orders. |
| Enrichment | `temu-order-enrichment` | Existing orders only; address, package, tracking, label and customization data. Does not create orders or replace prices, quantities or order status. Blind-order repair uses this mode. |

All operations reuse `POST /api/temu/orders/import` with `mode`. The existing `/api/temu/orders/refresh-statuses` route explicitly selects status mode. Webhook targeted refreshes default to status mode. Missing mode on ordinary imports now means intake, not a full reconciliation.

Setup retains the existing intake schedule and adds independent interval schedules, limits and lookback settings for status and enrichment. New schedules default off; enable them deliberately. Existing intake schedules no longer refresh existing orders. Configure status reconciliation before relying on scheduled status updates. Manual enrichment is available in channel Actions. Neither worker startup nor deployment queues a historical replay.

Each mode has its own connector checkpoint and resume cursor. A successful capped scheduled batch resumes within its fixed time window on the next scheduled run. Errors do not advance the checkpoint/cursor. Full-window completion records that phase's timestamp. Manual runs use their requested window; scheduled runs use the saved phase cursor or timestamp with an hour overlap. Progress is reported per scanned order, and changed orders are persisted during the scan. There is no final rewrite of the loaded order collection.

Jobs retain the existing single-active-Temu-order-job guard across all three task names. They are separate jobs, not concurrent writes to the same order. Busy schedule slots remain retryable. Channel/download switches and job cancellation are checked before each order and before writes. Existing return linkage and source-completion reconciliation remain in place; enrichment does not initiate sell-through inventory updates.

API requests within an order remain sequential. This release reduces the number of calls per phase; it does not claim a measured speedup or raise API concurrency. Large historical backfills still use the existing paginated full-import path. Customization and other enrichment must be reviewed before fulfillment when relevant.

Verify with `node scripts/test-temu-order-phases.cjs`, `node scripts/test-temu-order-pagination.js`, `node scripts/test-temu-return-linking.js`, `node scripts/test-source-order-completion.js`, and `node scripts/test-order-batch.cjs`.
# Intake duplicate handling

Intake checks whether any exact channel order identity already exists before fetching details. Multiple existing local matches count as already imported, never as permission to create another order or modify an arbitrary match. Status and enrichment still reject ambiguous identities. Intake retains an overlapping update-time window so delayed payment orders are not missed; older orders can appear in scan counts but are not downloaded again. Successful scans advance the intake checkpoint.
