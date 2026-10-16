# Channel fee estimates and settlement reconciliation

## Accounting rule

Marketplace and payment-processing fees are expenses. Customer-paid shipping is
revenue and carrier label/invoice cost is a separate shipping expense. None of
these amounts may be substituted for another.

DataPlus retains both stages of a channel fee:

- `estimated_fee` is the planning amount calculated from an editable channel
  policy or supplied by an order import.
- `actual_fee` is the sum of matched settlement lines for the order. When it is
  present, reporting and order P&L use it instead of the estimate.
- Estimate values and policy snapshots remain unchanged as audit evidence after
  reconciliation. Actual settlement data does not overwrite the estimate.

## Storage

- `channel_fee_policies`: company-scoped percentage and per-order estimates.
- `order_channel_financials`: one company/channel/order fee summary with the
  estimate, actual amount, variance source, settlement, and reconciliation state.
- `channel_settlements`: immutable import/API statement header and source hash.
- `channel_settlement_lines`: individual charges and credits, raw source data,
  exact order reference, match state, and matched order.

Completed channel payouts are separate accounting evidence from fee
reconciliation. An eBay payout retains the payout ID, payout date and status,
batch amount, bank reference, payout memo, attempted date, destination
instrument, and transaction count. Its order-linked transactions retain the
transaction ID, payout ID, transaction date and status, debit/credit booking
entry, and amount. A fee match alone must never be presented as proof that cash
reached the business; DataPlus marks an order **Payout confirmed** only when the
linked payout status is `SUCCEEDED`.

Accounting > Channel fees shows the same payout date, batch amount, bank
reference, destination instrument, and payout status in its permanent
settlement history so accounting can identify the deposit without opening each
order.

The initial policies are deliberately editable estimates:

- Walmart: 15% starter estimate. Referral rates vary by category.
- Shopify: 2.9% plus $0.30 starter estimate for a US online card. The actual
  Shopify Payments rate varies by plan, payment method, and card type.
- eBay: 13.6% plus $0.40 starter estimate for a common US category. Final value,
  store, category, promoted-listing, international, and performance fees vary.
- Temu: no invented default. Enter the seller's contracted rate or import the
  settlement to establish actual fees.

Saving a policy refreshes unreconciled order estimates. Reconciled actual fees
are never recalculated by policy changes.
Shopify subchannels such as Online Store and Draft Order are normalized to the
Shopify fee policy; the original source/subchannel remains unchanged on the order.

Future LINQ order inserts and relevant order updates create or refresh the fee
estimate automatically. This keeps an estimated marketplace fee available to
order P&L before a settlement arrives. Reconciliation replaces only the amount
used by P&L; it retains the original estimate and policy snapshot for variance
and audit review. Reconciliation also creates a missing historical estimate when
an older order receives its first matched settlement, including canceled orders
that must remain available for accounting evidence.

The order Finance tab reads the normalized channel and shipment financial
tables. It shows the estimate, the amount currently used by P&L, the settlement
date, import date, and external or internal settlement ID. Estimated carrier
label cost remains separate from customer-paid shipping revenue. Reconciled
carrier cost replaces the estimate only after an invoice or channel charge is
matched.

Settlement headers, lines, raw evidence, and order matches are permanent
accounting records. The Accounting page may show only the latest records for
speed, but it also displays the full retained count; limiting a UI result never
deletes or overwrites older settlements.

Initialize existing reportable orders after deployment:

```powershell
node scripts/backfill-channel-fee-estimates.cjs
```

## CSV import

Accounting > Channel fees accepts UTF-8 CSV with:

- One exact order reference column: `order_id`, `order_number`,
  `marketplace_order_id`, or `channel_order_id`.
- `fee_amount`, expressed as a positive expense or negative credit.
- Optional `transaction_id`, `fee_type`, `description`, `gross_amount`,
  `net_amount`, `currency`, and `transaction_date`.

The source file SHA-256 hash prevents duplicate imports. Matching is exact and
channel-bound. Ambiguous and unmatched lines remain in review; DataPlus never
fuzzy-posts financial evidence to an order.

## Channel adapters

The normalized import tables are the destination for future API adapters:

- Walmart: use the Payment Statement and Marketplace Reconciliation Report APIs.
  Import transaction-level commission, refund, tax, shipping, and adjustment
  rows; keep WFS settlement reports separate from seller-fulfilled referral fees.
  Report discovery accepts Walmart's documented `MMDDYYYY` values as well as
  year-first dates. A finalized report's `PaymentSummary` supplies the payout
  amount, posted date, deposit description, and completion evidence. Transaction
  keys and calculated net proceeds remain attached to matched orders. The
  Payment Statement endpoint supplies current-cycle processor and settlement
  context without replacing the finalized reconciliation report.
- Shopify Payments: use GraphQL `ShopifyPaymentsBalanceTransaction` and payouts.
  The balance transaction is the canonical movement and includes gross, fee,
  net, payout, and an associated order where Shopify supplies one. Non-Shopify
  payment providers require that provider's settlement file/API.
- eBay: use Sell Finances `getTransactions` and `getPayouts`. Preserve each fee
  type and credit rather than importing only the payout net. Follow each
  completed payout with `getPayout` so its bank reference, memo, destination,
  and final status remain available to Accounting. Retain zero-fee order
  transactions as payout evidence instead of discarding them.
- Temu: use the seller settlement/payment statement endpoint enabled for the
  account. Preserve the complete source response and map its order/package
  references. Keep CSV import available when API access is not granted.

API jobs should be idempotent by channel plus external settlement and transaction
ID, retain raw lines, import credits as signed values, and finish in review when
any line is unmatched. A payout amount is a cash movement, not the marketplace
fee itself.

## Automatic schedules

- Walmart runs a daily discovery at 6:30 AM America/New_York because Walmart
  publishes seller payment reports once per day. The job first reads available
  V1 reconciliation report dates, then imports only unseen dates from the recent
  45-day window. The report date is the external settlement identity.
- eBay runs a daily discovery at 7:00 AM America/New_York. eBay sellers may use
  daily, weekly, biweekly, or monthly payouts, so DataPlus polls daily but imports
  only completed payouts. The payout ID is the external settlement identity.
- Both jobs are enabled for production channels by the settlement-sync policy.
  They stop when the channel or its settlement-import setting is disabled.
- Reruns are safe. Existing report dates and payout IDs are recorded as already
  present, and no second fee is posted. Exact order matches reconcile
  automatically; unmatched fee lines remain visible for accounting review.
- eBay authorization must include the `sell.finances` OAuth scope. Existing
  connections created without it must be reconnected once; the scheduled job
  reports the permission error without changing any accounting amounts.
- eBay imports only `marketplaceFees` attached to payout transactions. Purchased
  shipping labels and payout net amounts are not treated as marketplace fees.
  Transaction amounts are displayed separately as order proceeds, while the
  payout header amount is labeled as the complete batch payout.
  Walmart imports commission/referral/marketplace-fee amount rows and excludes
  product price, tax, and customer-paid shipping rows.

Accounting > Channel fees displays the last run and has a Run now action for
Walmart and eBay. Channel settings contain the corresponding enable/disable
switches. Schedule state is stored in `channelSettlementSchedules`; financial
evidence remains in the relational settlement tables.

Official integration references:

- Walmart Payment Statement and Reconciliation Reports:
  https://developer.walmart.com/us-marketplace/docs/payment-statement-report
  and https://developer.walmart.com/global-marketplace/docs/generate-a-reconciliation-report
- Shopify Payments balance transactions and payouts:
  https://shopify.dev/docs/api/admin-graphql/latest/objects/ShopifyPaymentsBalanceTransaction
  and https://shopify.dev/docs/api/admin-graphql/latest/objects/ShopifyPaymentsPayout
- eBay Sell Finances API:
  https://developer.ebay.com/api-docs/sell/finances/overview.html

## Verification

1. Refresh estimates and confirm unreconciled orders receive policy snapshots.
2. Import a CSV with matched, unmatched, positive charge, and negative credit
   rows; then import the same file again and confirm it is rejected.
3. Confirm matched actual fees replace estimates in Sales reporting and Cost
   reconciliation and the order Finance/P&L tabs without changing customer-paid
   shipping revenue or carrier expense.
4. Change a policy and confirm reconciled orders retain their actual fee.
5. Confirm the order Finance tab shows settlement date, import date, and payout
   or settlement ID for every matched settlement attached to that order. For a
   successful eBay payout, also confirm the payout date/status, bank reference,
   destination instrument, order proceeds, batch payout, and transaction IDs.
6. Confirm new and updated reportable orders receive an estimate automatically,
   and canceled orders without an actual settlement do not remain in the queue.
7. Confirm the order P&L tab presents one income-statement table and does not
   show a second competing line-level profit calculation. Item detail should
   support COGS only.
8. Confirm Accounting > Channel fees distinguishes payout confirmation from fee
   reconciliation and shows retained bank evidence for completed payouts.
9. Confirm Walmart report discovery accepts `MMDDYYYY`, completed
   `PaymentSummary` rows show as paid out, and order transaction keys/net
   proceeds appear in Finance without treating payout totals as fees.

