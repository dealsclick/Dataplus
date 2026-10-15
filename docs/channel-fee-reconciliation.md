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
- Shopify Payments: use GraphQL `ShopifyPaymentsBalanceTransaction` and payouts.
  The balance transaction is the canonical movement and includes gross, fee,
  net, payout, and an associated order where Shopify supplies one. Non-Shopify
  payment providers require that provider's settlement file/API.
- eBay: use Sell Finances `getTransactions` and `getPayouts`. Preserve each fee
  type and credit rather than importing only the payout net.
- Temu: use the seller settlement/payment statement endpoint enabled for the
  account. Preserve the complete source response and map its order/package
  references. Keep CSV import available when API access is not granted.

API jobs should be idempotent by channel plus external settlement and transaction
ID, retain raw lines, import credits as signed values, and finish in review when
any line is unmatched. A payout amount is a cash movement, not the marketplace
fee itself.

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
   reconciliation without changing customer shipping or carrier expense.
4. Change a policy and confirm reconciled orders retain their actual fee.

