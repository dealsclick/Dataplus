export type TransactionRecord = Record<string, unknown>
export type FinancialRow = { label: string; amount: number | null; currency: string; status: string; source: string }
export const object = (value: unknown): TransactionRecord => value && typeof value === "object" && !Array.isArray(value) ? value as TransactionRecord : {}
export const records = (value: unknown): TransactionRecord[] => Array.isArray(value) ? value.map(object) : []
export const numeric = (value: unknown): number | null => (typeof value !== "number" && typeof value !== "string") || String(value).trim() === "" || !Number.isFinite(Number(value)) ? null : Number(value)

// The verified Temu US money objects use integer cents. Other currencies stay unknown.
export function temuUsd(value: unknown): number | null {
  const money = object(value)
  const amount = numeric(money.amount)
  return money.currency === "USD" && amount !== null && Number.isSafeInteger(amount) ? amount / 100 : null
}

export function paymentEvents(order: TransactionRecord): TransactionRecord[] {
  return [
    ...records(order.payments).map(record => ({ ...record, type: String(record.kind || "Payment").replaceAll("_", " "), reference: record.reference || record.transactionId || record.id })),
    ...records(order.refunds).map(record => ({ ...record, type: "Refund" }))
  ].sort((a: TransactionRecord, b: TransactionRecord) => (Date.parse(String(b.refundedAt || b.createdAt)) || 0) - (Date.parse(String(a.refundedAt || a.createdAt)) || 0))
}

export function returnFinancialRows(record: TransactionRecord): FinancialRow[] {
  const currency = String(record.currency || "USD")
  if (String(record.source).toLowerCase() !== "temu") {
    const actual = numeric(record.actualRefundAmount)
    return [{ label: "Refund", amount: actual ?? numeric(record.estimatedRefundAmount), currency, status: actual !== null ? "Confirmed" : "Estimated", source: String(record.source || "Local") }]
  }
  const detail = object(object(record.external).detail)
  const summary = object(detail.refundSummary)
  const state = Number(detail.parentAfterSalesStatus ?? record.channelStatusCode)
  const status = state === 5 ? "Completed" : [6, 7].includes(state) ? "Not completed" : "Pending"
  return [
    ["Buyer refund including tax", "buyerTotalRefund"],
    ["Item refund excluding tax", "retailPriceRefundTaxExcl"],
    ["Shipping refund excluding tax", "shippingAmountRefundTaxExcl"],
    ["Refund tax", "taxTotalRefund"],
    ["Seller discount refund component", "discountFromSellerRefund"],
    ["Temu discount refund component", "discountFromTEMURefund"]
  ].map(([label, key]) => ({ label, amount: temuUsd(summary[key]), currency: String(object(summary[key]).currency || currency), status, source: `Temu return / ${key}` }))
}

export function orderFinancialGroups(order: TransactionRecord, pnl: TransactionRecord = {}) {
  const currency = String(order.currency || "USD")
  const row = (label: string, amount: number | null, status: string, source: string): FinancialRow => ({ label, amount, currency, status, source })
  if (String(order.source).toLowerCase() !== "temu") return [
    { title: "Order amounts", rows: [row("Order total", numeric(order.total), "Recorded", String(order.source || "Local"))] }
  ]
  const external = object(order.external)
  const amount = object(external.amount)
  const usd = (value: unknown) => currency === "USD" ? temuUsd(value) : null
  const parent = object(amount.parentOrderMap)
  // Do not infer monetary meaning by recursively searching arbitrary keys.
  const sales = object(amount.salesProceeds ?? parent.salesProceeds)
  const customer = object(amount.customerPaid ?? parent.customerPaid)
  const net = usd(parent.estimatedRevenue ?? sales.estimatedSettlementTotal)
  const deduction = usd(parent.estimatedRevenueDeduction ?? sales.estimatedDeduction)
  const cogs = currency === "USD" ? numeric(pnl.estimatedCogs) : null
  const label = currency === "USD" ? numeric(pnl.shippingLabelCost) : null
  return [
    { title: "Customer", rows: [
      row("Customer-paid balance after reported refunds", usd(customer.customerPaidTotal ?? parent.customerPaid), "Reported", "Temu order / customerPaid"),
      row("Buyer item refunds excluding tax", usd(parent.refundsTotal ?? customer.productRefundsTotal), "Reported", "Temu order / refundsTotal")
    ] },
    { title: "Seller proceeds", rows: [
      row("Proceeds before reported deduction", net !== null && deduction !== null ? Math.round((net + deduction) * 100) / 100 : null, "Derived estimate", "Net proceeds + estimated deduction"),
      row("Estimated seller deduction", deduction, "Estimated", "Temu order / estimatedRevenueDeduction"),
      row("Net estimated seller proceeds", net, "Estimated", "Temu order / estimatedRevenue"),
      row("Final settled seller deduction", null, "Not available", "Settlement statement required")
    ] },
    { title: "Costs and contribution", rows: [
      row("Product cost", cogs, "Estimated", "DataPlus / estimated COGS"),
      row("Shipping label cost", label, "Recorded estimate", "DataPlus / shipping label cost"),
      row("Estimated contribution before other fees", net !== null && cogs !== null && label !== null ? Math.round((net - cogs - label) * 100) / 100 : null, "Derived estimate", "Net seller proceeds - product cost - label cost")
    ] }
  ]
}
