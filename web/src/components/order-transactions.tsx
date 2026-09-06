import { Badge } from "./ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table"
import { orderFinancialGroups, returnFinancialRows, paymentEvents, numeric } from "../lib/order-transactions"
import type { FinancialRow, TransactionRecord } from "../lib/order-transactions"
import { AccountingLedger } from "./accounting-ledger"

function money(value: number | null, currency: string) {
  if (value === null) return "Not available"
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value) } catch { return "Unsupported currency" }
}
function date(value: unknown) {
  const parsed = new Date(String(value || ""))
  return Number.isNaN(parsed.getTime()) ? "Not provided" : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(parsed)
}
function AmountTable({ rows }: { rows: FinancialRow[] }) {
  return <div className="min-w-0"><Table className="w-full table-fixed"><TableHeader><TableRow><TableHead>Amount</TableHead><TableHead className="hidden w-40 sm:table-cell">Status</TableHead><TableHead className="w-28 text-right sm:w-36">Value</TableHead></TableRow></TableHeader><TableBody>{rows.map(row => <TableRow key={row.label}><TableCell className="whitespace-normal [overflow-wrap:anywhere]"><p>{row.label}</p><p className="mt-1 text-xs text-muted-foreground">{row.source}</p><Badge className="mt-1 sm:hidden" variant="outline">{row.amount === null ? "Not available" : row.status}</Badge></TableCell><TableCell className="hidden sm:table-cell"><Badge variant="outline">{row.amount === null ? "Not available" : row.status}</Badge></TableCell><TableCell className="whitespace-normal text-right tabular-nums">{money(row.amount, row.currency)}</TableCell></TableRow>)}</TableBody></Table></div>
}
function ReportedReturnTransactions({ record }: { record: TransactionRecord }) {
  return <section className="grid min-w-0 gap-3">
    <div className="flex flex-wrap justify-between gap-2 text-sm"><span className="break-all">{String(record.channelReturnId || record.returnNumber || "Return")}</span><span className="text-muted-foreground">Channel update: {date(record.channelUpdatedAt || record.updatedAt)}</span></div>
    <AmountTable rows={returnFinancialRows(record)} />
    {String(record.source).toLowerCase() === "temu" && <p className="text-sm text-muted-foreground">Buyer-side refund amounts. Seller deductions are reported at order level; final deductions require a settlement statement.</p>}
    {record.orderId ? <a className="text-sm text-primary underline" href={`/orders/${encodeURIComponent(String(record.orderId))}?tab=transactions`}>View order transactions</a> : <p className="text-sm text-muted-foreground">No linked order. Seller proceeds are unavailable.</p>}
  </section>
}
function ReportedOrderTransactions({ order, pnl = {}, returns = [] }: { order: TransactionRecord; pnl?: TransactionRecord; returns?: TransactionRecord[] }) {
  const events = paymentEvents(order)
  const uniqueReturns = [...new Map(returns.map(r => [`${r.source}:${r.channelReturnId || r.id}`, r])).values()]
  return <section className="grid min-w-0 gap-6">
    {orderFinancialGroups(order, pnl).map(group => <section key={group.title} className="min-w-0"><h3 className="mb-2 text-sm font-semibold">{group.title}</h3><AmountTable rows={group.rows} /></section>)}
    {String(order.source).toLowerCase() === "temu" && <p className="text-sm text-muted-foreground">Net seller proceeds already include Temu's estimated deduction. Buyer refunds are not deducted again. Final settlement and other fees are not confirmed.</p>}
    <section className="min-w-0"><h3 className="mb-2 text-sm font-semibold">Return and refund cases</h3>{uniqueReturns.length ? <div className="overflow-x-auto"><Table className="min-w-[560px]"><TableHeader><TableRow><TableHead>Reference</TableHead><TableHead>Channel update</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Buyer refund</TableHead></TableRow></TableHeader><TableBody>{uniqueReturns.map(record => { const refund = returnFinancialRows(record)[0]; return <TableRow key={String(record.channelReturnId || record.id)}><TableCell className="whitespace-normal break-all">{String(record.channelReturnId || record.returnNumber || record.id)}</TableCell><TableCell>{date(record.channelUpdatedAt || record.updatedAt)}</TableCell><TableCell><Badge variant="outline">{refund.status}</Badge></TableCell><TableCell className="text-right">{money(refund.amount, refund.currency)}</TableCell></TableRow> })}</TableBody></Table></div> : <p className="text-sm text-muted-foreground">No linked return or refund cases.</p>}</section>
    <section className="min-w-0"><h3 className="mb-2 text-sm font-semibold">Recorded payment and refund events</h3>{events.length ? <div className="overflow-x-auto"><Table className="min-w-[540px]"><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Reference</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader><TableBody>{events.map((event, i) => <TableRow key={`${String(event.id || event.reference)}:${i}`}><TableCell>{date(event.refundedAt || event.createdAt)}</TableCell><TableCell>{String(event.type)}</TableCell><TableCell className="whitespace-normal break-all">{String(event.reference || event.id || "Not provided")}</TableCell><TableCell>{String(event.status || "Recorded")}</TableCell><TableCell className="text-right">{money(numeric(event.amount), String(event.currency || order.currency || "USD"))}</TableCell></TableRow>)}</TableBody></Table></div> : <p className="text-sm text-muted-foreground">No separate payment or refund events recorded. Channel balances above are snapshots, not settlement transactions.</p>}</section>
  </section>
}

export function OrderTransactions(props: { order: TransactionRecord; pnl?: TransactionRecord; returns?: TransactionRecord[] }) {
  return <AccountingLedger orderId={String(props.order.id || props.order.orderNumber)} currency={String(props.order.currency || "USD")} reported={<ReportedOrderTransactions {...props} />} />
}

export function ReturnTransactions({ record }: { record: TransactionRecord }) {
  const reported = <ReportedReturnTransactions record={record} />
  return record.orderId ? <AccountingLedger orderId={String(record.orderId)} returnId={String(record.id)} currency={String(record.currency || "USD")} reported={reported} /> : reported
}
