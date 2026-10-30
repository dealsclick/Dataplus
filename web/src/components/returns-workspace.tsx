import { useEffect, useState } from "react"
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
type Column = "reference" | "updated" | "customer" | "order" | "channel" | "warehouse" | "reason" | "amount" | "label" | "status" | "disposition"

const columnOptions: Array<{ id: Column; label: string }> = [
  { id: "order", label: "Order" },
  { id: "reference", label: "Channel reference" },
  { id: "updated", label: "Updated" },
  { id: "customer", label: "Customer" },
  { id: "channel", label: "Channel" },
  { id: "warehouse", label: "Warehouse" },
  { id: "reason", label: "Reason" },
  { id: "amount", label: "Amount" },
  { id: "label", label: "Return label" },
  { id: "status", label: "Status" },
  { id: "disposition", label: "Disposition" },
]
const defaultColumns: Column[] = ["order", "reference", "updated", "customer", "channel", "warehouse", "amount", "label", "status", "disposition"]

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
function channelReference(record: Row) { return text(record.channelReturnReference || record.channelReturnId || record.marketplaceReturnId) }
function labelState(record: Row) {
  const label = returnLabel(record)
  const document = (label.document || {}) as Row
  if (lower(label.voidStatus) === "voided") return "Voided"
  if (document.url || label.labelUrl) return "Purchased"
  return lower(record.returnLabelPolicy) === "merchant_provided" ? "Required" : "Customer ships"
}

export function ReturnsWorkspace({ warehouses, busy, refreshKey = 0, onTotalChange, onSync, onTransactions }: {
  warehouses: Row[]
  busy: boolean
  refreshKey?: number
  onTotalChange?: (total: number) => void
  onSync: () => Promise<void>
  onTransactions: (record: Row) => void
}) {
  const [records, setRecords] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [queue, setQueue] = useState<Queue>("all")
  const [query, setQuery] = useState("")
  const [channel, setChannel] = useState("all")
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [reloadToken, setReloadToken] = useState(0)
  const [counts, setCounts] = useState<Record<Queue, number>>({ all: 0, new: 0, in_process: 0, needs_revision: 0, complete: 0 })
  const [channels, setChannels] = useState<string[]>([])
  const [showReceiving, setShowReceiving] = useState(false)
  const [columns, setColumns] = useState<Set<Column>>(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem("dataplus:return-columns:v2") || "[]") as Column[]
      return new Set(stored.length ? stored : defaultColumns)
    } catch { return new Set(defaultColumns) }
  })
  useEffect(() => { window.localStorage.setItem("dataplus:return-columns:v2", JSON.stringify([...columns])) }, [columns])
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ queue, channel, page: String(page), pageSize: "25" })
        if (query.trim()) params.set("q", query.trim())
        const response = await fetch(`/api/returns/workspace?${params.toString()}`, { signal: controller.signal })
        const result = await response.json() as { returns?: Row[]; total?: number; counts?: Partial<Record<Queue, number>>; channels?: string[]; totalPages?: number }
        if (!response.ok) throw new Error(String((result as Row).error || "Unable to load returns."))
        const nextTotal = Number(result.total || 0)
        setRecords(result.returns || [])
        setTotal(nextTotal)
        setTotalPages(Math.max(1, Number(result.totalPages || 1)))
        setCounts({ all: 0, new: 0, in_process: 0, needs_revision: 0, complete: 0, ...(result.counts || {}) })
        setChannels(result.channels || [])
        onTotalChange?.(Number(result.counts?.all ?? nextTotal))
      } catch (error) {
        if ((error as Error).name !== "AbortError") toast.error(error instanceof Error ? error.message : "Unable to load returns.")
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, query.trim() ? 250 : 0)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [queue, channel, page, query, refreshKey, reloadToken, onTotalChange])
  const refreshReturns = async () => { setReloadToken((current) => current + 1) }
  const filtered = records
  const show = (column: Column) => columns.has(column)
  const syncShopify = async (record: Row) => {
    try {
      const response = await fetch(`/api/returns/${encodeURIComponent(text(record.id))}/sync-shopify`, { method: "POST" })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Unable to send return to Shopify.")
      toast.success(result.message || "Return sent to Shopify.")
      await refreshReturns()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to send return to Shopify.") }
  }
  const queueDefinitions: Array<{ id: Queue; label: string; description: string; icon: typeof RotateCcw }> = [
    { id: "all", label: "All returns", description: "Every DataPlus return", icon: RotateCcw },
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
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{queueDefinitions.map(({ id, label, description, icon: Icon }) => <button key={id} type="button" onClick={() => { setPage(1); setQueue(id) }} className={`rounded-md border p-3 text-left transition-colors ${queue === id ? "border-primary bg-primary/5" : "bg-card hover:bg-muted/40"}`}><div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 font-medium"><Icon className="size-4" />{label}</span><Badge variant={id === "needs_revision" && counts[id] ? "destructive" : id === "complete" ? "success" : queue === id ? "default" : "outline"}>{counts[id].toLocaleString()}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{description}</p></button>)}</div>
    <Card>
      <CardHeader className="gap-3 border-b">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-base">{queue === "all" ? "All returns" : queueLabel(queue)}</CardTitle><CardDescription>{total.toLocaleString()} return{total === 1 ? "" : "s"} in this queue.</CardDescription></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => void onSync().then(() => setReloadToken((current) => current + 1))}>{busy ? <RefreshCw className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Sync channels</Button><Button size="sm" variant={showReceiving ? "secondary" : "outline"} onClick={() => setShowReceiving((value) => !value)}><PackageCheck className="size-4" /> Receive return</Button></div></div>
        <div className="flex flex-wrap gap-2"><div className="relative min-w-[220px] flex-1"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" value={query} onChange={(event) => { setPage(1); setQuery(event.target.value) }} placeholder="Search DataPlus ID, channel reference, order, tracking, or SKU" /></div><Select value={channel} onValueChange={(value) => { setPage(1); setChannel(value) }}><SelectTrigger className="w-44"><SelectValue placeholder="All channels" /></SelectTrigger><SelectContent><SelectItem value="all">All channels</SelectItem>{channels.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select><DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="outline"><Columns3 className="size-4" /> Columns</Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="min-w-52"><DropdownMenuLabel>Visible columns</DropdownMenuLabel><DropdownMenuSeparator />{columnOptions.map(({ id, label }) => <DropdownMenuCheckboxItem key={id} checked={columns.has(id)} onCheckedChange={(checked) => setColumns((current) => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next })}>{label}</DropdownMenuCheckboxItem>)}<DropdownMenuSeparator /><DropdownMenuItem onSelect={() => setColumns(new Set(defaultColumns))}>Reset columns</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? <div className="grid gap-2 p-4"><div className="h-12 animate-pulse rounded bg-muted" /><div className="h-12 animate-pulse rounded bg-muted" /></div> : <>
          <div className="hidden overflow-x-auto md:block"><Table><TableHeader><TableRow><TableHead>DataPlus return ID</TableHead>{show("order") && <TableHead>Order</TableHead>}{show("reference") && <TableHead>Channel reference</TableHead>}{show("updated") && <TableHead>Updated</TableHead>}{show("customer") && <TableHead>Customer</TableHead>}{show("channel") && <TableHead>Channel</TableHead>}{show("warehouse") && <TableHead>Warehouse</TableHead>}{show("reason") && <TableHead>Reason</TableHead>}{show("amount") && <TableHead>Amount</TableHead>}{show("label") && <TableHead>Label</TableHead>}{show("status") && <TableHead>Status</TableHead>}{show("disposition") && <TableHead>Disposition</TableHead>}<TableHead className="w-12" /></TableRow></TableHeader><TableBody>{filtered.map((record) => <TableRow key={text(record.id || record.returnNumber)}><TableCell><a className="whitespace-nowrap font-medium text-primary hover:underline" href={returnHref(record)}>{text(record.returnNumber || record.id)}</a></TableCell>{show("order") && <TableCell>{record.orderId ? <a className="text-primary hover:underline" href={`/orders/${encodeURIComponent(text(record.orderId))}`}>{text(record.orderNumber || record.orderId)}</a> : <span className="text-destructive">Not linked</span>}</TableCell>}{show("reference") && <TableCell className="max-w-48"><p className="truncate font-mono text-xs" title={channelReference(record)}>{channelReference(record) || "-"}</p></TableCell>}{show("updated") && <TableCell className="whitespace-nowrap text-sm">{dateLabel(record.updatedAt || record.createdAt)}</TableCell>}{show("customer") && <TableCell className="max-w-56"><p className="truncate font-medium">{customerName(record)}</p></TableCell>}{show("channel") && <TableCell>{text(record.channelSource || record.salesChannel || record.source) || "Local"}</TableCell>}{show("warehouse") && <TableCell>{text(record.warehouseName) || <span className="text-destructive">Not assigned</span>}</TableCell>}{show("reason") && <TableCell className="max-w-64"><p className="truncate" title={text(record.reason)}>{text(record.reason) || "-"}</p></TableCell>}{show("amount") && <TableCell>{record.refundAmountUnverified ? <span className="text-amber-600">Unverified</span> : moneyLabel(record.actualRefundAmount ?? record.amount)}</TableCell>}{show("label") && <TableCell><Badge variant={labelState(record) === "Voided" ? "destructive" : labelState(record) === "Purchased" ? "success" : "outline"}>{labelState(record)}</Badge></TableCell>}{show("status") && <TableCell><Badge variant={statusTone(record)}>{queueLabel(returnQueue(record))}</Badge><p className="mt-1 text-xs text-muted-foreground">{text(record.status || record.returnStatus || "requested").replaceAll("_", " ")}</p></TableCell>}{show("disposition") && <TableCell>{text(record.disposition || record.receivingStatus).replaceAll("_", " ") || "Pending"}</TableCell>}<TableCell>{actionMenu(record)}</TableCell></TableRow>)}{!filtered.length && <TableRow><TableCell colSpan={13} className="h-28 text-center text-muted-foreground">No returns match this queue and search.</TableCell></TableRow>}</TableBody></Table></div>
          <div className="grid gap-3 p-3 md:hidden">{filtered.map((record) => <Card key={text(record.id || record.returnNumber)}><CardContent className="grid gap-3 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><a className="font-semibold text-primary hover:underline" href={returnHref(record)}>{text(record.returnNumber || record.id)}</a>{channelReference(record) && <p className="truncate font-mono text-xs text-muted-foreground">Channel ref: {channelReference(record)}</p>}<p className="truncate text-sm text-muted-foreground">{customerName(record)}</p></div>{actionMenu(record)}</div><div className="flex flex-wrap gap-2"><Badge variant={statusTone(record)}>{queueLabel(returnQueue(record))}</Badge><Badge variant="outline">{text(record.channelSource || record.source) || "Local"}</Badge><Badge variant="outline">{labelState(record)}</Badge></div><div className="grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-muted-foreground">Order</p><p className="truncate font-medium">{text(record.orderNumber || record.orderId) || "Not linked"}</p></div><div><p className="text-xs text-muted-foreground">Amount</p><p className="font-medium">{record.refundAmountUnverified ? "Unverified" : moneyLabel(record.actualRefundAmount ?? record.amount)}</p></div><div><p className="text-xs text-muted-foreground">Warehouse</p><p className="truncate">{text(record.warehouseName) || "Not assigned"}</p></div><div><p className="text-xs text-muted-foreground">Updated</p><p>{dateLabel(record.updatedAt || record.createdAt)}</p></div></div></CardContent></Card>)}{!filtered.length && <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">No returns match this queue and search.</p>}</div>
          {totalPages > 1 && <div className="flex items-center justify-between gap-3 border-t px-4 py-3"><p className="text-xs text-muted-foreground">Page {page.toLocaleString()} of {totalPages.toLocaleString()}</p><div className="flex gap-2"><Button size="sm" variant="outline" disabled={loading || page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button><Button size="sm" variant="outline" disabled={loading || page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next</Button></div></div>}
        </>}
      </CardContent>
    </Card>
    {showReceiving && <Card><CardContent className="p-4"><ReturnReceiving warehouses={warehouses} onUpdated={refreshReturns} /></CardContent></Card>}
  </div>
}
