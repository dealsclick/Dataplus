import { useEffect, useMemo, useState } from "react"
import { AlertCircle, CheckCircle2, Columns3, MoreHorizontal, PackageCheck, RefreshCw, RotateCcw, Search } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu"
import { Input } from "./ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table"
import { ReturnReceiving } from "./return-receiving"

type Row = Record<string, unknown>
type Queue = "all" | "new" | "in_process" | "needs_revision" | "complete"
type Column = "updated" | "customer" | "order" | "channel" | "warehouse" | "reason" | "amount" | "label" | "status" | "disposition"

const columnOptions: Array<{ id: Column; label: string }> = [
  { id: "updated", label: "Updated" },
  { id: "customer", label: "Customer" },
  { id: "order", label: "Order" },
  { id: "channel", label: "Channel" },
  { id: "warehouse", label: "Warehouse" },
  { id: "reason", label: "Reason" },
  { id: "amount", label: "Amount" },
  { id: "label", label: "Return label" },
  { id: "status", label: "Status" },
  { id: "disposition", label: "Disposition" },
]
const defaultColumns: Column[] = ["updated", "customer", "order", "channel", "warehouse", "amount", "label", "status", "disposition"]

function text(value: unknown) { return String(value || "").trim() }
function lower(value: unknown) { return text(value).toLowerCase() }
function dateLabel(value: unknown) {
  const date = new Date(text(value))
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
}
function moneyLabel(value: unknown) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0)) }
function returnHref(record: Row) {
  const slug = text(record.returnSlug || record.returnNumber || record.id).toLowerCase()
  return `/returns/${encodeURIComponent(slug)}`
}
function channelSync(record: Row) { return (record.channelSync || {}) as Row }
function returnLabel(record: Row) { return (record.returnLabel || {}) as Row }
function returnQueue(record: Row): Exclude<Queue, "all"> {
  const status = lower(record.status || record.returnStatus)
  const receiving = lower(record.receivingStatus)
  const inspection = lower(record.inspectionStatus)
  const sync = lower(channelSync(record).status || record.channelStatus)
  const complete = ["done", "closed", "complete", "completed", "refunded", "restocked", "canceled", "cancelled"].includes(status)
    || (Boolean(record.restockedAt) && ["done", "closed"].includes(receiving || status))
  if (complete) return "complete"
  const needsRevision = Boolean(record.refundAmountUnverified)
    || ["failed", "rejected", "error", "needs_review", "needs_revision"].some((value) => status.includes(value) || inspection.includes(value) || sync.includes(value))
    || !text(record.orderId || record.orderNumber)
    || !text(record.warehouseId || record.warehouseName)
  if (needsRevision) return "needs_revision"
  if (["", "new", "requested", "authorized", "pending"].includes(status) && !record.receivedAt && !receiving) return "new"
  return "in_process"
}
function queueLabel(queue: Exclude<Queue, "all">) {
  return queue === "new" ? "New" : queue === "in_process" ? "In process" : queue === "needs_revision" ? "Needs revision" : "Complete"
}
function statusTone(record: Row): "outline" | "secondary" | "warning" | "destructive" | "success" {
  const queue = returnQueue(record)
  return queue === "complete" ? "success" : queue === "needs_revision" ? "destructive" : queue === "in_process" ? "warning" : "secondary"
}
function customerName(record: Row) {
  const customer = (record.customer || {}) as Row
  return text(record.customerName || record.buyer || customer.name || record.customerEmail || record.buyerEmail) || "Customer not linked"
}
function labelState(record: Row) {
  const label = returnLabel(record)
  const document = (label.document || {}) as Row
  if (lower(label.voidStatus) === "voided") return "Voided"
  if (document.url || label.labelUrl) return "Purchased"
  return lower(record.returnLabelPolicy) === "merchant_provided" ? "Required" : "Customer ships"
}

export function ReturnsWorkspace({ records, warehouses, loading, busy, onUpdated, onSync, onTransactions }: {
  records: Row[]
  warehouses: Row[]
  loading: boolean
  busy: boolean
  onUpdated: () => Promise<void>
  onSync: () => Promise<void>
  onTransactions: (record: Row) => void
}) {
  const [queue, setQueue] = useState<Queue>("new")
  const [query, setQuery] = useState("")
  const [channel, setChannel] = useState("all")
  const [showReceiving, setShowReceiving] = useState(false)
  const [columns, setColumns] = useState<Set<Column>>(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem("dataplus:return-columns") || "[]") as Column[]
      return new Set(stored.length ? stored : defaultColumns)
    } catch { return new Set(defaultColumns) }
  })
  useEffect(() => { window.localStorage.setItem("dataplus:return-columns", JSON.stringify([...columns])) }, [columns])
  const counts = useMemo(() => ({
    all: records.length,
    new: records.filter((record) => returnQueue(record) === "new").length,
    in_process: records.filter((record) => returnQueue(record) === "in_process").length,
    needs_revision: records.filter((record) => returnQueue(record) === "needs_revision").length,
    complete: records.filter((record) => returnQueue(record) === "complete").length,
  }), [records])
  const channels = useMemo(() => [...new Set(records.map((record) => text(record.channelSource || record.salesChannel || record.source)).filter(Boolean))].sort(), [records])
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return records.filter((record) => queue === "all" || returnQueue(record) === queue)
      .filter((record) => channel === "all" || text(record.channelSource || record.salesChannel || record.source) === channel)
      .filter((record) => !term || [record.returnNumber, record.channelReturnId, record.orderNumber, record.channelOrderId, record.customerName, record.buyer, record.customerEmail, record.buyerEmail, record.reason, record.warehouseName, record.source, JSON.stringify(record.items || [])].some((value) => lower(value).includes(term)))
      .sort((left, right) => text(right.updatedAt || right.createdAt).localeCompare(text(left.updatedAt || left.createdAt)))
  }, [records, queue, channel, query])
  const show = (column: Column) => columns.has(column)
  const syncShopify = async (record: Row) => {
    try {
      const response = await fetch(`/api/returns/${encodeURIComponent(text(record.id))}/sync-shopify`, { method: "POST" })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Unable to send return to Shopify.")
      toast.success(result.message || "Return sent to Shopify.")
      await onUpdated()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to send return to Shopify.") }
  }
  const queueDefinitions: Array<{ id: Queue; label: string; description: string; icon: typeof RotateCcw }> = [
    { id: "all", label: "All returns", description: "Every saved RMA", icon: RotateCcw },
    { id: "new", label: "New", description: "New requests awaiting the first action", icon: RotateCcw },
    { id: "in_process", label: "In process", description: "Label, transit, receiving, inspection, or refund work is underway", icon: PackageCheck },
    { id: "needs_revision", label: "Needs revision", description: "Missing links, failed inspection, rejected sync, or unverified refund", icon: AlertCircle },
    { id: "complete", label: "Complete", description: "Closed, restocked, refunded, or canceled", icon: CheckCircle2 },
  ]
  const actionMenu = (record: Row) => {
    const linkedOrderId = text(record.orderId)
    return <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="ghost" title="Return actions"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="min-w-52"><DropdownMenuLabel>Return actions</DropdownMenuLabel><DropdownMenuItem asChild><a href={returnHref(record)}>Open RMA</a></DropdownMenuItem>{linkedOrderId && <DropdownMenuItem asChild><a href={`/orders/${encodeURIComponent(linkedOrderId)}?tab=returns`}>Open linked order</a></DropdownMenuItem>}<DropdownMenuItem asChild><a href={`/api/returns/${encodeURIComponent(text(record.id))}/pdf`} target="_blank" rel="noreferrer">Download RMA PDF</a></DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem asChild><a href={`${returnHref(record)}?tab=receiving`}>Receive or inspect</a></DropdownMenuItem><DropdownMenuItem onSelect={() => onTransactions(record)}>View transactions</DropdownMenuItem>{lower(record.source) === "shopify" && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => void syncShopify(record)}>Send to Shopify</DropdownMenuItem></>}</DropdownMenuContent></DropdownMenu>
  }
  return <div className="grid gap-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{queueDefinitions.map(({ id, label, description, icon: Icon }) => <button key={id} type="button" onClick={() => setQueue(id)} className={`rounded-md border p-3 text-left transition-colors ${queue === id ? "border-primary bg-primary/5" : "bg-card hover:bg-muted/40"}`}><div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 font-medium"><Icon className="size-4" />{label}</span><Badge variant={id === "needs_revision" && counts[id] ? "destructive" : id === "complete" ? "success" : queue === id ? "default" : "outline"}>{counts[id].toLocaleString()}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{description}</p></button>)}</div>
    <Card>
      <CardHeader className="gap-3 border-b">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-base">{queue === "all" ? "All returns" : queueLabel(queue)}</CardTitle><CardDescription>{filtered.length.toLocaleString()} return{filtered.length === 1 ? "" : "s"} in this queue.</CardDescription></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => void onSync()}>{busy ? <RefreshCw className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Sync channels</Button><Button size="sm" variant={showReceiving ? "secondary" : "outline"} onClick={() => setShowReceiving((value) => !value)}><PackageCheck className="size-4" /> Receive return</Button></div></div>
        <div className="flex flex-wrap gap-2"><div className="relative min-w-[220px] flex-1"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search RMA, order, customer, tracking, SKU, or reason" /></div><Select value={channel} onValueChange={setChannel}><SelectTrigger className="w-44"><SelectValue placeholder="All channels" /></SelectTrigger><SelectContent><SelectItem value="all">All channels</SelectItem>{channels.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select><DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="outline"><Columns3 className="size-4" /> Columns</Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="min-w-52"><DropdownMenuLabel>Visible columns</DropdownMenuLabel><DropdownMenuSeparator />{columnOptions.map(({ id, label }) => <DropdownMenuCheckboxItem key={id} checked={columns.has(id)} onCheckedChange={(checked) => setColumns((current) => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next })}>{label}</DropdownMenuCheckboxItem>)}<DropdownMenuSeparator /><DropdownMenuItem onSelect={() => setColumns(new Set(defaultColumns))}>Reset columns</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? <div className="grid gap-2 p-4"><div className="h-12 animate-pulse rounded bg-muted" /><div className="h-12 animate-pulse rounded bg-muted" /></div> : <>
          <div className="hidden overflow-x-auto md:block"><Table><TableHeader><TableRow><TableHead>Return</TableHead>{show("updated") && <TableHead>Updated</TableHead>}{show("customer") && <TableHead>Customer</TableHead>}{show("order") && <TableHead>Order</TableHead>}{show("channel") && <TableHead>Channel</TableHead>}{show("warehouse") && <TableHead>Warehouse</TableHead>}{show("reason") && <TableHead>Reason</TableHead>}{show("amount") && <TableHead>Amount</TableHead>}{show("label") && <TableHead>Label</TableHead>}{show("status") && <TableHead>Status</TableHead>}{show("disposition") && <TableHead>Disposition</TableHead>}<TableHead className="w-12" /></TableRow></TableHeader><TableBody>{filtered.map((record) => <TableRow key={text(record.id || record.returnNumber)}><TableCell><a className="font-medium text-primary hover:underline" href={returnHref(record)}>{text(record.returnNumber || record.channelReturnId || record.id)}</a></TableCell>{show("updated") && <TableCell className="whitespace-nowrap text-sm">{dateLabel(record.updatedAt || record.createdAt)}</TableCell>}{show("customer") && <TableCell className="max-w-56"><p className="truncate font-medium">{customerName(record)}</p><p className="truncate text-xs text-muted-foreground">{text(record.customerEmail || record.buyerEmail)}</p></TableCell>}{show("order") && <TableCell>{record.orderId ? <a className="text-primary hover:underline" href={`/orders/${encodeURIComponent(text(record.orderId))}`}>{text(record.orderNumber || record.orderId)}</a> : <span className="text-destructive">Not linked</span>}</TableCell>}{show("channel") && <TableCell>{text(record.channelSource || record.salesChannel || record.source) || "Local"}</TableCell>}{show("warehouse") && <TableCell>{text(record.warehouseName) || <span className="text-destructive">Not assigned</span>}</TableCell>}{show("reason") && <TableCell className="max-w-64"><p className="truncate" title={text(record.reason)}>{text(record.reason) || "-"}</p></TableCell>}{show("amount") && <TableCell>{record.refundAmountUnverified ? <span className="text-amber-600">Unverified</span> : moneyLabel(record.actualRefundAmount ?? record.amount)}</TableCell>}{show("label") && <TableCell><Badge variant={labelState(record) === "Voided" ? "destructive" : labelState(record) === "Purchased" ? "success" : "outline"}>{labelState(record)}</Badge></TableCell>}{show("status") && <TableCell><Badge variant={statusTone(record)}>{queueLabel(returnQueue(record))}</Badge><p className="mt-1 text-xs text-muted-foreground">{text(record.status || record.returnStatus || "requested").replaceAll("_", " ")}</p></TableCell>}{show("disposition") && <TableCell>{text(record.disposition || record.receivingStatus).replaceAll("_", " ") || "Pending"}</TableCell>}<TableCell>{actionMenu(record)}</TableCell></TableRow>)}{!filtered.length && <TableRow><TableCell colSpan={12} className="h-28 text-center text-muted-foreground">No returns match this queue and search.</TableCell></TableRow>}</TableBody></Table></div>
          <div className="grid gap-3 p-3 md:hidden">{filtered.map((record) => <Card key={text(record.id || record.returnNumber)}><CardContent className="grid gap-3 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><a className="font-semibold text-primary hover:underline" href={returnHref(record)}>{text(record.returnNumber || record.channelReturnId || record.id)}</a><p className="truncate text-sm text-muted-foreground">{customerName(record)}</p></div>{actionMenu(record)}</div><div className="flex flex-wrap gap-2"><Badge variant={statusTone(record)}>{queueLabel(returnQueue(record))}</Badge><Badge variant="outline">{text(record.channelSource || record.source) || "Local"}</Badge><Badge variant="outline">{labelState(record)}</Badge></div><div className="grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-muted-foreground">Order</p><p className="truncate font-medium">{text(record.orderNumber || record.orderId) || "Not linked"}</p></div><div><p className="text-xs text-muted-foreground">Amount</p><p className="font-medium">{record.refundAmountUnverified ? "Unverified" : moneyLabel(record.actualRefundAmount ?? record.amount)}</p></div><div><p className="text-xs text-muted-foreground">Warehouse</p><p className="truncate">{text(record.warehouseName) || "Not assigned"}</p></div><div><p className="text-xs text-muted-foreground">Updated</p><p>{dateLabel(record.updatedAt || record.createdAt)}</p></div></div></CardContent></Card>)}{!filtered.length && <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">No returns match this queue and search.</p>}</div>
        </>}
      </CardContent>
    </Card>
    {showReceiving && <Card><CardContent className="p-4"><ReturnReceiving warehouses={warehouses} onUpdated={onUpdated} /></CardContent></Card>}
  </div>
}
