# Order intake and held jobs

Walmart order imports create missing purchase-order identities only. Existing orders, including ambiguous duplicates, are skipped before mapping and saving; local fulfillment and edits remain unchanged. Acknowledgment and tracking retain their separate reviewed workflows.

Scheduled intake stores an account-scoped completed-through checkpoint only after a fully successful production run. Later runs use a one-hour overlap to accommodate delayed visibility, skipping known IDs. Manual ranges do not advance the schedule checkpoint. Failed or stopped runs retain the previous checkpoint. Progress is persisted after every checked order, with separate imported and already-imported counts. The first successful run still scans the configured lookback.

The legacy `pricing-deployment-hold` task is not executable. It is displayed as stopped/review required, retaining its checkpoint and results. Retry is blocked because no resumable worker payload exists. An operator must review the original pricing run before preparing a replacement; never silently republish from this hold.
