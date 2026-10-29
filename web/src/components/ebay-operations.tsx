import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, BadgeDollarSign, BarChart3, CheckCircle2, Loader2, Megaphone, MessageSquare, RefreshCw, RotateCcw, ShieldAlert, XCircle } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api, dateLabel, numberLabel } from "@/lib/client-api"

type Json = Record<string, any>
type ModuleResult = { available?: boolean; rows?: Json[]; total?: number; error?: string; data?: Json | null }
type OperationsSnapshot = {
  generatedAt?: string
  capabilities?: Record<string, boolean>
  modules?: Record<string, ModuleResult>
}

const operationViews = [
  { key: "cancellations", label: "Cancellations" },
  { key: "returns", label: "Returns" },
  { key: "inquiries", label: "INR inquiries" },
  { key: "cases", label: "Cases" },
  { key: "paymentDisputes", label: "Payment disputes" },
]

function statusVariant(status: unknown): "default" | "secondary" | "destructive" | "outline" {
  const value = String(status || "").toLowerCase()
  if (/closed|complete|resolved|approved|received/.test(value)) return "secondary"
  if (/reject|denied|failed|lost|escalated/.test(value)) return "destructive"
  if (/open|pending|action|response/.test(value)) return "default"
  return "outline"
}

function money(value: unknown) {
  const row = value && typeof value === "object" ? value as Json : { value }
  const amount = Number(row.value || 0)
  return new Intl.NumberFormat("en-US", { style: "currency", currency: String(row.currency || "USD") }).format(amount)
}

function moduleSummary(module?: ModuleResult) {
  if (!module?.available) return "Unavailable"
  return `${numberLabel(module.total ?? module.rows?.length ?? 0)} found`
}

function actionLabel(action: string) {
  if (action === "approve") return "Approve cancellation"
  if (action === "reject") return "Reject cancellation"
  if (action === "mark-received") return "Mark return received"
  return "Accept payment dispute"
}

function trafficTotals(payload: Json | null | undefined) {
  const metricKeys = Array.isArray(payload?.header?.metrics) ? payload.header.metrics.map((row: Json) => String(row.key || "")) : []
  const totals: Record<string, number> = {}
  for (const record of Array.isArray(payload?.records) ? payload.records : []) {
    const values = Array.isArray(record.metricValues) ? record.metricValues : []
    metricKeys.forEach((key: string, index: number) => { totals[key] = Number(totals[key] || 0) + Number(values[index]?.value || 0) })
  }
  return totals
}

export function EbayOperations({ enabled, marketplaceId = "EBAY_US" }: { enabled: boolean; marketplaceId?: string }) {
  const [operations, setOperations] = useState<OperationsSnapshot | null>(null)
  const [performance, setPerformance] = useState<Json | null>(null)
  const [marketing, setMarketing] = useState<Json | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lookbackDays, setLookbackDays] = useState("90")
  const [operationView, setOperationView] = useState("cancellations")
  const [pendingAction, setPendingAction] = useState<{ action: string; row: Json } | null>(null)
  const [actionBusy, setActionBusy] = useState(false)

  const load = async (quiet = false, force = false) => {
    if (!quiet) setLoading(true)
    else setRefreshing(true)
    const results = await Promise.allSettled([
      api<OperationsSnapshot>(`/api/ebay/operations?lookbackDays=${lookbackDays}&limit=100&refresh=${force}`),
      api<Json>(`/api/ebay/performance?lookbackDays=30&marketplaceId=${encodeURIComponent(marketplaceId)}&refresh=${force}`),
      api<Json>(`/api/ebay/marketing/opportunities?limit=50&marketplaceId=${encodeURIComponent(marketplaceId)}&refresh=${force}`),
    ])
    if (results[0].status === "fulfilled") setOperations(results[0].value)
    else toast.error(results[0].reason instanceof Error ? results[0].reason.message : "eBay operations could not load.")
    if (results[1].status === "fulfilled") setPerformance(results[1].value)
    if (results[2].status === "fulfilled") setMarketing(results[2].value)
    setLoading(false)
    setRefreshing(false)
  }

  useEffect(() => {
    if (enabled) void load()
    else setLoading(false)
  }, [enabled, marketplaceId, lookbackDays])

  const selectedModule = operations?.modules?.[operationView]
  const selectedRows = useMemo(() => Array.isArray(selectedModule?.rows) ? selectedModule.rows : [], [selectedModule])
  const traffic = useMemo(() => trafficTotals(performance?.modules?.traffic?.data), [performance])

  const runAction = async () => {
    if (!pendingAction) return
    setActionBusy(true)
    const { action, row } = pendingAction
    let path = ""
    if (action === "approve" || action === "reject") path = `/api/ebay/cancellations/${encodeURIComponent(row.id)}/${action}`
    if (action === "mark-received") path = `/api/ebay/returns/${encodeURIComponent(row.id)}/mark-received`
    if (action === "accept-dispute") path = `/api/ebay/payment-disputes/${encodeURIComponent(row.id)}/accept`
    try {
      await api(path, {
        method: "POST",
        body: JSON.stringify({ confirm: true, orderId: row.orderId }),
      })
      toast.success(`${actionLabel(action)} submitted to eBay.`)
      setPendingAction(null)
      await load(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The eBay action failed.")
    } finally {
      setActionBusy(false)
    }
  }

  if (!enabled) return <Alert variant="destructive"><ShieldAlert className="size-4" /><AlertTitle>eBay is disabled</AlertTitle><AlertDescription>Enable the channel before loading or changing eBay operations.</AlertDescription></Alert>
  if (loading) return <Card><CardContent className="grid min-h-56 place-items-center"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading eBay operations</div></CardContent></Card>

  return <div className="grid gap-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold">eBay operations</h2>
        <p className="text-sm text-muted-foreground">Live customer requests, seller performance, and sales opportunities. One unavailable eBay service will not hide the others.</p>
      </div>
      <div className="flex items-center gap-2">
        <Select value={lookbackDays} onValueChange={setLookbackDays}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="30">Last 30 days</SelectItem><SelectItem value="90">Last 90 days</SelectItem><SelectItem value="180">Last 180 days</SelectItem><SelectItem value="365">Last year</SelectItem></SelectContent></Select>
        <Button size="icon" variant="outline" aria-label="Refresh eBay operations" onClick={() => void load(true, true)} disabled={refreshing}>{refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}</Button>
      </div>
    </div>

    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
      {operationViews.map(view => {
        const module = operations?.modules?.[view.key]
        return <button type="button" key={view.key} onClick={() => setOperationView(view.key)} className={`grid gap-1 rounded-md border p-3 text-left transition-colors hover:bg-muted/50 ${operationView === view.key ? "border-primary bg-muted/40" : ""}`}>
          <span className="flex items-center justify-between gap-2 text-sm font-medium">{view.label}{module?.available ? <CheckCircle2 className="size-4 text-emerald-600" /> : <AlertTriangle className="size-4 text-amber-600" />}</span>
          <span className="text-xs text-muted-foreground">{moduleSummary(module)}</span>
        </button>
      })}
    </div>

    {selectedModule?.available === false && <Alert><AlertTriangle className="size-4" /><AlertTitle>{operationViews.find(view => view.key === operationView)?.label} unavailable</AlertTitle><AlertDescription className="break-words">{selectedModule.error}</AlertDescription></Alert>}

    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">{operationViews.find(view => view.key === operationView)?.label}</CardTitle><CardDescription>{selectedRows.length ? `${numberLabel(selectedRows.length)} current records returned by eBay.` : "No records in this date range."}</CardDescription></CardHeader>
      <CardContent className="px-0 sm:px-6">
        <ScrollArea className="max-h-[34rem]">
          <Table>
            <TableHeader><TableRow><TableHead>eBay record</TableHead><TableHead>Order</TableHead><TableHead>Status</TableHead><TableHead>Reason / amount</TableHead><TableHead>Due</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
            <TableBody>{selectedRows.map(row => <TableRow key={`${row.type}-${row.id}`}>
              <TableCell><div className="font-medium">{row.id || "Unknown"}</div><div className="text-xs text-muted-foreground">{String(row.type || "record").replaceAll("_", " ")}</div></TableCell>
              <TableCell><div>{row.orderId || "No order ID"}</div>{row.localOrder ? row.localOrder.ambiguous ? <Badge variant="destructive">Multiple local matches</Badge> : <div className="text-xs text-muted-foreground">DataPlus {row.localOrder.orderNumber || row.localOrder.id} · {row.localOrder.fulfillmentStatus || row.localOrder.status || "Unknown"}</div> : <Badge variant="outline">Not linked locally</Badge>}</TableCell>
              <TableCell><Badge variant={statusVariant(row.status)}>{row.status || "Unknown"}</Badge></TableCell>
              <TableCell><div className="max-w-60 truncate" title={row.reason}>{row.reason || "Not supplied"}</div>{Number(row.amount?.value || 0) !== 0 && <div className="text-xs font-medium">{money(row.amount)}</div>}</TableCell>
              <TableCell>{row.respondBy ? dateLabel(row.respondBy) : "Not supplied"}</TableCell>
              <TableCell className="text-right"><div className="flex justify-end gap-1">
                {operationView === "cancellations" && <><Button size="sm" variant="outline" disabled={row.localOrder?.shipped} onClick={() => setPendingAction({ action: "approve", row })}>Approve</Button><Button size="sm" variant="outline" onClick={() => setPendingAction({ action: "reject", row })}>Reject</Button></>}
                {operationView === "returns" && <Button size="sm" variant="outline" onClick={() => setPendingAction({ action: "mark-received", row })}>Received</Button>}
                {operationView === "paymentDisputes" && <Button size="sm" variant="outline" onClick={() => setPendingAction({ action: "accept-dispute", row })}>Accept</Button>}
                {(operationView === "inquiries" || operationView === "cases") && <Button size="sm" variant="outline" onClick={() => window.location.assign("/messages?source=ebay")}><MessageSquare className="size-4" /> Messages</Button>}
              </div>{row.localOrder?.shipped && operationView === "cancellations" && <div className="pt-1 text-xs text-amber-600">Shipment activity: approval blocked</div>}</TableCell>
            </TableRow>)}{!selectedRows.length && <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">No eBay records match this view.</TableCell></TableRow>}</TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>

    <Tabs defaultValue="performance">
      <TabsList><TabsTrigger value="performance"><BarChart3 className="size-4" /> Performance</TabsTrigger><TabsTrigger value="marketing"><Megaphone className="size-4" /> Marketing</TabsTrigger><TabsTrigger value="access"><ShieldAlert className="size-4" /> API access</TabsTrigger></TabsList>
      <TabsContent value="performance" className="grid gap-3 md:grid-cols-2">
        <Card className="md:col-span-2"><CardHeader><CardTitle className="flex items-center justify-between text-sm">30-day listing traffic{performance?.modules?.traffic?.available ? <CheckCircle2 className="size-4 text-emerald-600" /> : <XCircle className="size-4 text-amber-600" />}</CardTitle><CardDescription>Daily buyer engagement returned by eBay Analytics.</CardDescription></CardHeader><CardContent>{performance?.modules?.traffic?.available ? <div className="grid grid-cols-2 gap-4 sm:grid-cols-4"><div><p className="text-xs text-muted-foreground">Impressions</p><p className="text-2xl font-semibold">{numberLabel(traffic.TOTAL_IMPRESSION_TOTAL)}</p></div><div><p className="text-xs text-muted-foreground">Listing views</p><p className="text-2xl font-semibold">{numberLabel(traffic.LISTING_VIEWS_TOTAL)}</p></div><div><p className="text-xs text-muted-foreground">Transactions</p><p className="text-2xl font-semibold">{numberLabel(traffic.TRANSACTION)}</p></div><div><p className="text-xs text-muted-foreground">Days returned</p><p className="text-2xl font-semibold">{numberLabel(performance.modules.traffic.data?.records?.length)}</p></div></div> : <p className="text-sm text-muted-foreground">{String(performance?.modules?.traffic?.error || "Analytics scope or traffic service unavailable")}</p>}</CardContent></Card>
        {[["sellerStandards", "Seller standards", "Current eBay seller-level evaluation."], ["serviceMetrics", "Service metrics", "Item-not-as-described customer service performance."]].map(([key, label, description]) => {
          const module = performance?.modules?.[key]
          return <Card key={key}><CardHeader><CardTitle className="flex items-center justify-between text-sm">{label}{module?.available ? <CheckCircle2 className="size-4 text-emerald-600" /> : <XCircle className="size-4 text-amber-600" />}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent><p className="text-sm font-medium">{module?.available ? "eBay response loaded" : "Unavailable"}</p><p className="break-words text-xs text-muted-foreground">{module?.available ? "Open the response details in channel logs for the full eBay evaluation." : String(module?.error || "Scope or service unavailable")}</p></CardContent></Card>
        })}
      </TabsContent>
      <TabsContent value="marketing" className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-3"><Card><CardHeader><CardTitle className="text-sm">Interested-buyer opportunities</CardTitle><CardDescription>Listings currently eligible for seller offers.</CardDescription></CardHeader><CardContent><p className="text-2xl font-semibold">{marketing?.available ? numberLabel(marketing.total) : "—"}</p><p className="text-xs text-muted-foreground">{marketing?.error || "Loaded from eBay Negotiation API"}</p></CardContent></Card><Card><CardHeader><CardTitle className="text-sm">Promoted Listings</CardTitle><CardDescription>Current DataPlus advertising default.</CardDescription></CardHeader><CardContent><p className="text-2xl font-semibold">{marketing?.promotedListings?.enabled ? `${marketing.promotedListings.ratePercent}%` : "Off"}</p><p className="truncate text-xs text-muted-foreground">{marketing?.promotedListings?.campaignName || "No campaign configured"}</p></CardContent></Card><Card><CardHeader><CardTitle className="text-sm">Offer protection</CardTitle><CardDescription>Offers remain review-only until cost and minimum margin are resolved for the listing SKU.</CardDescription></CardHeader><CardContent><Badge variant="secondary"><BadgeDollarSign className="mr-1 size-3" /> Margin guard required</Badge></CardContent></Card></div>
        {marketing?.available && Array.isArray(marketing.eligibleItems) && marketing.eligibleItems.length > 0 && <Card><CardHeader><CardTitle className="text-base">Eligible listings</CardTitle><CardDescription>Review these listings against DataPlus cost and margin before sending an offer.</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Listing</TableHead><TableHead>SKU</TableHead><TableHead>Title</TableHead><TableHead>Current price</TableHead></TableRow></TableHeader><TableBody>{marketing.eligibleItems.slice(0, 50).map((row: Json, index: number) => <TableRow key={String(row.listingId || row.itemId || index)}><TableCell>{row.listingId || row.itemId || "—"}</TableCell><TableCell>{row.sku || "—"}</TableCell><TableCell><div className="max-w-[32rem] truncate" title={row.title}>{row.title || "—"}</div></TableCell><TableCell>{money(row.currentPrice || row.price)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>}
      </TabsContent>
      <TabsContent value="access"><Card><CardHeader><CardTitle className="text-base">Authorized eBay capabilities</CardTitle><CardDescription>Reconnect the seller account after adding OAuth scopes in eBay Developer Portal.</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-2">{Object.entries(operations?.capabilities || {}).map(([key, available]) => <Badge key={key} variant={available ? "secondary" : "outline"}>{available ? <CheckCircle2 className="mr-1 size-3 text-emerald-600" /> : <AlertTriangle className="mr-1 size-3 text-amber-600" />}{key.replace(/([A-Z])/g, " $1")}</Badge>)}</CardContent></Card></TabsContent>
    </Tabs>

    <AlertDialog open={Boolean(pendingAction)} onOpenChange={open => { if (!open && !actionBusy) setPendingAction(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{pendingAction ? actionLabel(pendingAction.action) : "Confirm eBay action"}</AlertDialogTitle><AlertDialogDescription>This updates the live eBay record immediately. DataPlus will refresh this queue after eBay accepts the action.</AlertDialogDescription></AlertDialogHeader>
        <div className="rounded-md border bg-muted/40 p-3 text-sm"><div>eBay record: <strong>{pendingAction?.row.id}</strong></div><div>Order: <strong>{pendingAction?.row.orderId || "Unknown"}</strong></div></div>
        <AlertDialogFooter><AlertDialogCancel disabled={actionBusy}>Cancel</AlertDialogCancel><AlertDialogAction onClick={event => { event.preventDefault(); void runAction() }} disabled={actionBusy}>{actionBusy ? <Loader2 className="size-4 animate-spin" /> : pendingAction?.action === "reject" ? <XCircle className="size-4" /> : pendingAction?.action === "mark-received" ? <RotateCcw className="size-4" /> : <CheckCircle2 className="size-4" />} Confirm</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
}
