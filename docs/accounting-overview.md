# Accounting Overview

The default Accounting view summarizes all saved accounting ledgers, across all
dates. Draft and unconfirmed-export counts link to filtered journal and batch
lists. Source warning counts filter a paginated review table with order-ledger
links. Counts are records, not currency totals or unique orders.

GET `/api/accounting/overview` requires Accounting view permission. It reads only
`accounting_documents`, never channels, order imports, inventory or order queues.
No schema migration is required. Review rows use the last appended observation
for each source key, matching the order-level source review.

- Missing costs: unavailable/unverified label cost or product cost observations.
- Pending refunds: pending refund or return-linked observations.
- Estimates: observations explicitly marked estimated, including reference-only
  estimates. These are not final settlement amounts.
- Export confirmation: recorded external-import acknowledgement, not download.

Coverage is the number of ledgers with captured observations, not all channel
orders. Missing observations on orders without captured accounting data cannot
be inferred from this dashboard. Refresh is explicit; it never starts an import
or captures additional source amounts. Updates are not deployed during the
ongoing Temu import.

Customer-paid shipping revenue is stored in `order_shipping_revenue` and never
treated as carrier expense. Shipment expense is stored separately in
`order_shipment_financials`; see `docs/shipping-cost-reconciliation.md`. Sales
P&L prefers reconciled `actual_shipping_cost` and otherwise uses the label's
`estimated_shipping_cost` less recorded label refunds. Future carrier invoices
and channel settlements will be retained in `shipping_settlements` and
`shipping_settlement_lines` before matching and reconciliation.
