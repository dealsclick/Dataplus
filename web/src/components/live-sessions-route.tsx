import { useEffect, useMemo, useState } from "react"
import { AlertCircle, AlertTriangle, ArrowLeft, Boxes, CheckCircle2, ClipboardCheck, CopyPlus, ExternalLink, Loader2, MoreHorizontal, PackagePlus, Play, RadioTower, RefreshCw, Rocket, ScanBarcode, Search, ShoppingBag, Trash2, Warehouse, XCircle } from "lucide-react"
import { toast } from "sonner"
import { Field, MetricCard, PageHeader } from "./app-ui"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MobileTables, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Progress } from "@/components/ui/progress"
import { Textarea } from "@/components/ui/textarea"
import { api, dateLabel, moneyLabel, numberLabel } from "../lib/client-api"
import { warehouseAuditUrl } from "../lib/warehouse-audit-url"

type WarehouseReference = { id?: string; name?: string; code?: string; isPhysical?: boolean; allowAudits?: boolean; inventorySourceType?: string }
type SourceReference = { id: string; number?: string; label: string; warehouseId?: string; warehouseName?: string; status?: string; liveChannel?: string; itemCount?: number; remainingUnits?: number; orderedUnits?: number; receivedUnits?: number }
type ChannelAccount = { channel: string; id: string; name: string; shopId?: string; shopCode?: string; connected?: boolean; active?: boolean }
type TikTokCreator = { id: string; label?: string; username?: string; creatorUserOpenId?: string; userType?: string; permissions?: string[]; grantedScopes?: string[]; configured?: boolean }
type ReferenceData = { scope?: { tenantId?: string; companyId?: string; companyName?: string }; warehouses?: WarehouseReference[]; purchaseOrders?: SourceReference[]; audits?: SourceReference[]; previousSessions?: SourceReference[]; channelAccounts?: ChannelAccount[]; tiktokCreators?: TikTokCreator[] }
type LiveSessionAudit = { id?: string; auditNumber?: string; status?: string; url?: string; mobileUrl?: string; lines?: Array<Record<string, unknown>>; unknownBarcodes?: Array<Record<string, unknown>> }
type LiveSessionItem = {
  id?: string; sourceLineId?: string; productId?: string; sku?: string; catalogSku?: string; merchantSku?: string; title?: string; image?: string
  upc?: string; manufacturerSku?: string; supplierSku?: string; unitCost?: number; salePrice?: number; orderedQty?: number; receivedQty?: number; incomingQty?: number
  sourceAvailableQty?: number; requestedQty?: number; reservedQty?: number; soldQty?: number; shippedQty?: number; releasedQty?: number; remainingQty?: number
  sourceCommittedQty?: number; allocatableQty?: number; shortageQty?: number; linkedOrderIds?: string[]; lastMatchMode?: string
  launch?: { status?: string; channel?: string; accountId?: string; accountName?: string; shopId?: string; merchantSkuBase?: string; merchantSkuSource?: string; merchantSkuDate?: string; merchantSku?: string; quantity?: number; blockers?: string[]; error?: string; jobId?: string; jobNumber?: number; listingId?: string; offerId?: string; listingUrl?: string; requestId?: string; reviewedAt?: string; queuedAt?: string; updatedAt?: string }
  tiktokLiveSync?: { productId?: string; status?: string; addedStatus?: string; creatorId?: string; creatorName?: string; error?: string; syncedAt?: string }
}
type LiveSession = {
  id: string; sessionNumber?: string; title?: string; status?: string; sourceType?: string; sourceId?: string; sourceNumber?: string; sourceLabel?: string
  sourcePurchaseOrderId?: string; sourcePurchaseOrderNumber?: string; parentSessionId?: string; parentSessionNumber?: string; channel?: string; channelLabel?: string
  channelAccountId?: string; channelAccountName?: string; channelShopId?: string; companyName?: string; warehouseId?: string; warehouseName?: string; itemCount?: number
  scheduledStartAt?: string; scheduledEndAt?: string; scheduleTimeZone?: string; channelEventId?: string
  receivedUnits?: number; incomingUnits?: number; availableUnits?: number; reservedUnits?: number; soldUnits?: number; shippedUnits?: number; releasedUnits?: number
  remainingUnits?: number; shortageUnits?: number; scannedSkus?: number; scannedUnits?: number; unknownBarcodes?: number; items?: LiveSessionItem[]; notes?: string
  launch?: { status?: string; readyItems?: number; blockedItems?: number; queuedItems?: number; submittedItems?: number; liveItems?: number; failedItems?: number; jobId?: string; jobNumber?: number; jobStatus?: string; jobPhase?: string; processedItems?: number; totalItems?: number; changedItems?: number; missingItems?: number; progressPercent?: number; merchantSkuDate?: string; message?: string; reviewedAt?: string; queuedAt?: string; updatedAt?: string }
  tiktokCreatorId?: string; tiktokCreatorName?: string; tiktokLiveSync?: { status?: string; creatorId?: string; creatorName?: string; requestedCount?: number; syncedCount?: number; failedCount?: number; warning?: string; syncedAt?: string }
  createdAt?: string; createdBy?: string; updatedAt?: string; reconciledAt?: string; audit?: LiveSessionAudit | null
}
type QuickProduct = { id?: string; sku: string; title?: string; image?: string; qty?: number; cost?: number; barcode?: string; mfrPartNumber?: string; vendorSku?: string }
type DraftItem = LiveSessionItem & { requestedQty: number; sourceAvailableQty: number; selected?: boolean; salePrice?: number }
type SourcePreviewSummary = { sourceUnits?: number; committedUnits?: number; availableUnits?: number; availableItems?: number; exhaustedItems?: number }

const destinations = [
  { value: "unassigned", label: "Not assigned yet" },
  { value: "ebay_live", label: "eBay Live" },
  { value: "tiktok_live", label: "TikTok Live" },
  { value: "whatnot_live", label: "Whatnot" },
]
const sources = [
  { value: "purchase_order", label: "Purchase order" },
  { value: "warehouse_audit", label: "Warehouse audit" },
  { value: "previous_session", label: "Previous session remainder" },
  { value: "manual_skus", label: "Manual SKUs" },
  { value: "extra_items", label: "Scan extra items" },
]

function suggestedLivePrice(unitCost = 0) {
  return Math.max(1, Math.ceil((Math.max(0, Number(unitCost || 0)) / 0.8) * 100) / 100)
}

function statusLabel(status = "") {
  return ({ counting: "Counting", review: "Review", ready: "Ready", live: "Live", completed: "Completed", canceled: "Canceled", draft: "Draft" } as Record<string, string>)[status] || "Draft"
}

function statusClass(status = "") {
  if (["ready", "live", "completed"].includes(status)) return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
  if (status === "review") return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
  if (status === "counting") return "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300"
  if (status === "canceled") return "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
  return ""
}

function launchLabel(status = "") {
  return ({ not_reviewed: "Not reviewed", blocked: "Blocked", ready: "Ready", queued: "Queued", publishing: "Publishing", scheduled: "Scheduled", submitted: "Submitted", live: "Live", complete: "Complete", failed: "Failed" } as Record<string, string>)[status] || "Not reviewed"
}

function launchClass(status = "") {
  if (["live", "complete"].includes(status)) return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
  if (status === "ready") return "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300"
  if (["queued", "publishing", "scheduled", "submitted"].includes(status)) return "border-cyan-500/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
  if (status === "blocked") return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
  if (status === "failed") return "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
  return ""
}

function launchStatusDetail(item: LiveSessionItem, launch: NonNullable<LiveSession["launch"]>) {
  const status = String(item.launch?.status || "not_reviewed")
  if (item.tiktokLiveSync?.status === "synced") return `Verified in TikTok LIVE preparation for ${item.tiktokLiveSync.creatorName || "the official LIVE account"}`
  if (item.tiktokLiveSync?.status === "failed" || item.tiktokLiveSync?.status === "not_verified") return item.tiktokLiveSync.error || "TikTok did not verify this product in the LIVE preparation list"
  if (status === "queued") return `Waiting in Job #${item.launch?.jobNumber || launch.jobNumber || item.launch?.jobId || launch.jobId || "queue"}`
  if (status === "publishing") return launch.jobPhase ? `eBay is processing this SKU: ${launch.jobPhase.replace(/_/g, " ")}` : "eBay is processing this SKU"
  if (status === "scheduled") return "Listing accepted and scheduled by eBay"
  if (status === "submitted") return "Offer submitted to eBay"
  if (status === "live") return "Listing is live on eBay"
  if (status === "ready") return "Ready to queue after review"
  if (status === "blocked") return "Action required before publishing"
  if (status === "failed") return "Launch failed and can be retried"
  return "Run readiness review"
}

function detailKeyFromPath() {
  const match = window.location.pathname.match(/^\/live-sessions\/([^/]+)\/?$/)
  return match ? decodeURIComponent(match[1]) : ""
}

function defaultsFromUrl() {
  const params = new URLSearchParams(window.location.search)
  const sourceType = String(params.get("sourceType") || "extra_items")
  return { sourceType: sources.some((option) => option.value === sourceType) ? sourceType : "extra_items", sourceId: String(params.get("sourceId") || "") }
}

function auditScanUrl(session: LiveSession) {
  if (!session.audit) return ""
  return window.matchMedia("(max-width: 767px)").matches ? String(session.audit.mobileUrl || session.audit.url || "") : String(session.audit.url || session.audit.mobileUrl || "")
}

function sourceHref(session: LiveSession) {
  if (session.sourcePurchaseOrderId || session.sourceType === "purchase_order") return `/purchase-orders/${encodeURIComponent(String(session.sourcePurchaseOrderId || session.sourceId || ""))}`
  if (session.audit?.url) return session.audit.url
  if (session.sourceType === "warehouse_audit") return `/warehouse/audits/${encodeURIComponent(String(session.sourceNumber || session.sourceId || ""))}`
  if (session.parentSessionId || session.sourceType === "previous_session") return `/live-sessions/${encodeURIComponent(String(session.parentSessionNumber || session.parentSessionId || session.sourceId || ""))}`
  return ""
}

function metric(item: LiveSessionItem, key: keyof LiveSessionItem) { return Number(item[key] || 0) }

function localDateTimeValue(value = "") {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function isoDateTimeValue(value = "") {
  if (!value) return ""
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "" : date.toISOString()
}

function browserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York"
}

function ItemIdentity({ item }: { item: LiveSessionItem }) {
  return <div className="flex min-w-64 items-center gap-3">
    {item.image ? <img src={item.image} alt="" className="size-10 rounded border object-contain" /> : <span className="grid size-10 shrink-0 place-items-center rounded border bg-muted"><Boxes className="size-4 text-muted-foreground" /></span>}
    <div className="min-w-0"><a className="font-mono text-xs font-medium text-primary hover:underline" href={`/products/${encodeURIComponent(String(item.sku || ""))}`}>{item.sku || "Unknown SKU"}</a><p className="max-w-80 truncate font-medium" title={item.title}>{item.title || "Untitled item"}</p><p className="text-xs text-muted-foreground">UPC {item.upc || "-"} · MPN {item.manufacturerSku || "-"}</p></div>
  </div>
}

function SessionDetail({ session, loading, error, references, onReload }: { session: LiveSession | null; loading: boolean; error: string; references: ReferenceData; onReload: () => Promise<void> }) {
  const [working, setWorking] = useState("")
  const [confirmAction, setConfirmAction] = useState<"complete" | "cancel" | "">("")
  const [editOpen, setEditOpen] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [edit, setEdit] = useState({ title: "", channel: "unassigned", channelAccountId: "", tiktokCreatorId: "", scheduledStartAt: "", scheduledEndAt: "", scheduleTimeZone: browserTimeZone(), channelEventId: "", notes: "" })

  useEffect(() => {
    if (session) setEdit({ title: session.title || "", channel: session.channel || "unassigned", channelAccountId: session.channelAccountId || "", tiktokCreatorId: session.tiktokCreatorId || "", scheduledStartAt: localDateTimeValue(session.scheduledStartAt), scheduledEndAt: localDateTimeValue(session.scheduledEndAt), scheduleTimeZone: session.scheduleTimeZone || browserTimeZone(), channelEventId: session.channelEventId || "", notes: session.notes || "" })
  }, [session])

  const pollingLaunch = Boolean(session?.launch?.jobId) && ["queued", "publishing", "running", "starting"].includes(String(session?.launch?.status || session?.launch?.jobStatus || "").toLowerCase())
  useEffect(() => {
    if (!session?.id || !session.launch?.jobId || !pollingLaunch) return
    let refreshing = false
    const timer = window.setInterval(async () => {
      if (refreshing) return
      refreshing = true
      try {
        await api(`/api/live-sessions/${encodeURIComponent(session.id)}/launch/status`, { method: "POST", body: "{}" })
        await onReload()
      } catch {
        // The manual refresh control remains available if a transient poll fails.
      } finally { refreshing = false }
    }, 8000)
    return () => window.clearInterval(timer)
  }, [onReload, pollingLaunch, session?.id, session?.launch?.jobId])

  if (loading) return <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading live session...</div>
  if (!session || error) return <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Live session not found</AlertTitle><AlertDescription>{error || "This session could not be loaded."}</AlertDescription></Alert>

  const runAction = async (action: "ready" | "start" | "reconcile" | "accept_available" | "complete" | "cancel") => {
    if (working) return
    setWorking(action)
    try {
      const result = await api<{ message?: string }>(`/api/live-sessions/${encodeURIComponent(session.id)}/actions`, { method: "POST", body: JSON.stringify({ action }) })
      toast.success(result.message || "Live session updated.")
      await onReload()
    } catch (actionError) { toast.error(actionError instanceof Error ? actionError.message : "Unable to update the live session.") }
    finally { setWorking(""); setConfirmAction("") }
  }

  const saveEdit = async () => {
    if (working) return
    setWorking("save")
    try {
      const result = await api<{ message?: string }>(`/api/live-sessions/${encodeURIComponent(session.id)}`, { method: "PATCH", body: JSON.stringify({ ...edit, channel: edit.channel === "unassigned" ? "" : edit.channel, scheduledStartAt: isoDateTimeValue(edit.scheduledStartAt), scheduledEndAt: isoDateTimeValue(edit.scheduledEndAt) }) })
      toast.success(result.message || "Live session updated.")
      setEditOpen(false)
      await onReload()
    } catch (editError) { toast.error(editError instanceof Error ? editError.message : "Unable to update the live session.") }
    finally { setWorking("") }
  }

  const reviewLaunch = async () => {
    if (working) return
    setWorking("launch-review")
    try {
      const result = await api<{ message?: string }>(`/api/live-sessions/${encodeURIComponent(session.id)}/launch/readiness`, { method: "POST", body: "{}" })
      toast.success(result.message || "Channel readiness reviewed.")
      await onReload()
    } catch (launchError) { toast.error(launchError instanceof Error ? launchError.message : "Unable to review channel readiness.") }
    finally { setWorking("") }
  }

  const publishLaunch = async (itemIds: string[] = [], retryFailed = false) => {
    if (working) return
    setWorking(retryFailed ? "launch-retry" : "launch-publish")
    try {
      const result = await api<{ message?: string }>(`/api/live-sessions/${encodeURIComponent(session.id)}/launch`, { method: "POST", body: JSON.stringify({ itemIds, retryFailed }) })
      toast.success(result.message || "Channel launch queued.")
      setPublishOpen(false)
      await onReload()
    } catch (launchError) { toast.error(launchError instanceof Error ? launchError.message : "Unable to publish session inventory.") }
    finally { setWorking("") }
  }

  const refreshLaunch = async () => {
    if (working) return
    setWorking("launch-refresh")
    try {
      const result = await api<{ message?: string }>(`/api/live-sessions/${encodeURIComponent(session.id)}/launch/status`, { method: "POST", body: "{}" })
      toast.success(result.message || "Launch results refreshed.")
      await onReload()
    } catch (launchError) { toast.error(launchError instanceof Error ? launchError.message : "Unable to refresh launch results.") }
    finally { setWorking("") }
  }

  const syncTikTokLive = async () => {
    if (working) return
    setWorking("tiktok-live-sync")
    try {
      const result = await api<{ message?: string }>(`/api/live-sessions/${encodeURIComponent(session.id)}/tiktok-live/sync`, { method: "POST", body: JSON.stringify({ creatorId: edit.tiktokCreatorId || session.tiktokCreatorId || "" }) })
      toast.success(result.message || "TikTok LIVE products synchronized.")
      await onReload()
    } catch (syncError) { toast.error(syncError instanceof Error ? syncError.message : "Unable to synchronize TikTok LIVE products.") }
    finally { setWorking("") }
  }

  const items = session.items || []
  const active = !["completed", "canceled"].includes(String(session.status || ""))
  const accounts = (references.channelAccounts || []).filter((account) => account.channel === edit.channel)
  const tiktokCreators = references.tiktokCreators || []
  const scanUrl = auditScanUrl(session)
  const sourceLink = sourceHref(session)
  const launch = session.launch || {}
  const readyLaunchItems = items.filter((item) => item.launch?.status === "ready")
  const failedLaunchItems = items.filter((item) => item.launch?.status === "failed")
  const launchRunning = ["queued", "publishing", "running"].includes(String(launch.status || launch.jobStatus || ""))
  return <div className="grid gap-5">
    <PageHeader eyebrow="Live sessions" title={`${session.sessionNumber || "Session"} · ${session.title || "Live inventory"}`} description={`${session.companyName || references.scope?.companyName || "Company"} · ${session.sourceLabel || "Live inventory"} · ${session.warehouseName || "Warehouse"}`} action={<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => window.location.assign("/live-sessions")}><ArrowLeft className="size-4" /> Sessions</Button>{scanUrl && <Button onClick={() => window.location.assign(scanUrl)}><ScanBarcode className="size-4" /> Scan items</Button>}<DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline"><MoreHorizontal className="size-4" /> Actions</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => setEditOpen(true)} disabled={!active}>Edit session</DropdownMenuItem>{session.status === "draft" && <DropdownMenuItem onClick={() => void runAction("ready")}><CheckCircle2 className="size-4" /> Mark ready</DropdownMenuItem>}{["draft", "ready"].includes(String(session.status)) && <DropdownMenuItem onClick={() => void runAction("start")}><Play className="size-4" /> Start session</DropdownMenuItem>}<DropdownMenuItem onClick={() => void runAction("reconcile")} disabled={!session.channel}><RefreshCw className="size-4" /> Reconcile sales</DropdownMenuItem>{Number(session.remainingUnits || 0) > 0 && <DropdownMenuItem onClick={() => window.location.assign(`/live-sessions?sourceType=previous_session&sourceId=${encodeURIComponent(session.id)}`)}><CopyPlus className="size-4" /> Session from remaining</DropdownMenuItem>}{active && <><DropdownMenuSeparator /><DropdownMenuItem onClick={() => setConfirmAction("complete")}><ClipboardCheck className="size-4" /> Complete and release</DropdownMenuItem><DropdownMenuItem className="text-destructive" onClick={() => setConfirmAction("cancel")}><XCircle className="size-4" /> Cancel and release</DropdownMenuItem></>}</DropdownMenuContent></DropdownMenu></div>} />
    {Number(session.shortageUnits || 0) > 0 && <Alert className="border-amber-500/40 bg-amber-500/5"><AlertTriangle className="size-4" /><AlertTitle>{numberLabel(session.shortageUnits)} shortage unit(s)</AlertTitle><AlertDescription className="flex flex-wrap items-center justify-between gap-3"><span>Every unreserved unit from the original source was used first. Replenish that source or continue with only the units DataPlus reserved.</span><span className="flex flex-wrap gap-2">{sourceLink && <Button size="sm" variant="outline" asChild><a href={sourceLink}>Open original source</a></Button>}<Button size="sm" variant="outline" disabled={Boolean(working)} onClick={() => void runAction("accept_available")}>Use reserved quantities</Button></span></AlertDescription></Alert>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><MetricCard label="Reserved" value={numberLabel(session.reservedUnits)} icon={Boxes} /><MetricCard label="Received" value={numberLabel(session.receivedUnits)} icon={Warehouse} /><MetricCard label="Sold" value={numberLabel(session.soldUnits)} icon={ShoppingBag} /><MetricCard label="Shipped" value={numberLabel(session.shippedUnits)} icon={ScanBarcode} /><MetricCard label="Remaining" value={numberLabel(session.remainingUnits)} icon={RadioTower} /><MetricCard label="Status" value={statusLabel(session.status)} icon={CheckCircle2} /></div>
    {session.channel === "tiktok_live" && <Card>
      <CardHeader className="border-b"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><RadioTower className="size-4" /> TikTok LIVE preparation</CardTitle><CardDescription>Select the shop's official TikTok account used to go LIVE. DataPlus adds published products and verifies that TikTok returns them in the LIVE or pre-LIVE product list.</CardDescription></div>{session.tiktokLiveSync?.status && <Badge variant={session.tiktokLiveSync.status === "synced" ? "success" : "warning"}>{session.tiktokLiveSync.status === "synced" ? "Synced" : "Needs review"}</Badge>}</div></CardHeader>
      <CardContent className="grid gap-4 p-5 sm:grid-cols-[minmax(16rem,28rem)_auto] sm:items-end">
        <Field label="Official TikTok LIVE account"><Select value={edit.tiktokCreatorId || "unassigned"} onValueChange={(tiktokCreatorId) => setEdit((current) => ({ ...current, tiktokCreatorId: tiktokCreatorId === "unassigned" ? "" : tiktokCreatorId }))}><SelectTrigger><SelectValue placeholder="Choose the shop's LIVE account" /></SelectTrigger><SelectContent><SelectItem value="unassigned">Choose official LIVE account</SelectItem>{tiktokCreators.map((creator) => <SelectItem key={creator.id} value={creator.id}>{creator.username ? `@${creator.username}` : creator.label || creator.id}</SelectItem>)}</SelectContent></Select></Field>
        <Button className="sm:justify-self-start" disabled={Boolean(working) || !(edit.tiktokCreatorId || session.tiktokCreatorId) || !items.some((item) => Boolean(item.launch?.listingId))} onClick={() => void syncTikTokLive()}>{working === "tiktok-live-sync" ? <Loader2 className="size-4 animate-spin" /> : <RadioTower className="size-4" />} Sync products to TikTok LIVE</Button>
        {!tiktokCreators.length && <Alert className="sm:col-span-2"><AlertTriangle className="size-4" /><AlertTitle>Authorize the official LIVE account for automation</AlertTitle><AlertDescription>Your seller connection, products, orders, inventory, and session tracking still work without this optional authorization. Open Channels, TikTok Shop, Connection only when DataPlus should control the LIVE product list.</AlertDescription></Alert>}
        {tiktokCreators.length > 0 && !items.some((item) => Boolean(item.launch?.listingId)) && <Alert className="sm:col-span-2"><AlertTriangle className="size-4" /><AlertTitle>Publish products first</AlertTitle><AlertDescription>Run the channel readiness review, publish the ready products to TikTok Shop, and refresh the launch results before syncing the creator's LIVE list.</AlertDescription></Alert>}
        {session.tiktokLiveSync?.syncedAt && <p className="text-xs text-muted-foreground sm:col-span-2">{numberLabel(session.tiktokLiveSync.syncedCount)} of {numberLabel(session.tiktokLiveSync.requestedCount)} verified for {session.tiktokLiveSync.creatorName || "the official LIVE account"} on {dateLabel(session.tiktokLiveSync.syncedAt)}.{session.tiktokLiveSync.warning ? ` ${session.tiktokLiveSync.warning}` : ""}</p>}
      </CardContent>
    </Card>}
    <Card><CardHeader className="border-b"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><Rocket className="size-4" /> Channel launch</CardTitle><CardDescription>eBay Live merchant SKUs use MPN-LV-MM-DD-YY when an MPN exists, otherwise DataPlus SKU-LV-MM-DD-YY. Published quantity is limited to remaining reserved inventory for this session.</CardDescription></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={Boolean(working) || launchRunning} onClick={() => void reviewLaunch()}>{working === "launch-review" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Review readiness</Button>{launch.jobId && <Button size="sm" variant="outline" disabled={Boolean(working)} onClick={() => void refreshLaunch()}>{working === "launch-refresh" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh results</Button>}<Button size="sm" disabled={Boolean(working) || launchRunning || !readyLaunchItems.length} onClick={() => setPublishOpen(true)}><Rocket className="size-4" /> Publish ready ({readyLaunchItems.length})</Button></div></div></CardHeader><CardContent className="grid gap-4 p-5"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{session.channelLabel || "Channel not selected"}</Badge><Badge variant="outline">{session.channelAccountName || "Shop not selected"}{session.channelShopId ? ` (${session.channelShopId})` : ""}</Badge>{session.scheduledStartAt && <Badge variant="outline">Starts {dateLabel(session.scheduledStartAt)}</Badge>}{session.scheduledEndAt && <Badge variant="outline">Ends {dateLabel(session.scheduledEndAt)}</Badge>}{session.channelEventId && <Badge variant="outline">Event {session.channelEventId}</Badge>}{launch.merchantSkuDate && <Badge variant="outline">SKU date {launch.merchantSkuDate}</Badge>}<Badge variant="outline" className={launchClass(String(launch.status || "not_reviewed"))}>{launchLabel(String(launch.status || "not_reviewed"))}</Badge>{pollingLaunch && <Badge variant="outline" className="border-cyan-500/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"><RefreshCw className="mr-1 size-3 animate-spin" /> Auto-refreshing</Badge>}{launch.jobId && <Button asChild size="sm" variant="ghost"><a href={`/jobs/${encodeURIComponent(String(launch.jobId))}`}>Job #{launch.jobNumber || launch.jobId}<ExternalLink className="size-3.5" /></a></Button>}</div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6"><MetricCard label="Ready" value={numberLabel(launch.readyItems ?? readyLaunchItems.length)} icon={CheckCircle2} /><MetricCard label="Blocked" value={numberLabel(launch.blockedItems)} icon={AlertTriangle} /><MetricCard label="Queued" value={numberLabel(launch.queuedItems)} icon={Loader2} /><MetricCard label="Submitted" value={numberLabel(launch.submittedItems)} icon={Rocket} /><MetricCard label="Live" value={numberLabel(launch.liveItems)} icon={RadioTower} /><MetricCard label="Failed" value={numberLabel(launch.failedItems ?? failedLaunchItems.length)} icon={AlertCircle} /></div>{launch.jobId && <div className="grid gap-2 rounded-md border bg-muted/20 p-3"><div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="font-medium">{launch.jobPhase ? launch.jobPhase.replace(/_/g, " ") : launchLabel(String(launch.jobStatus || launch.status || "queued"))}</span><span className="text-muted-foreground">{numberLabel(launch.processedItems)} of {numberLabel(launch.totalItems)} processed{launch.updatedAt ? ` · Checked ${dateLabel(launch.updatedAt)}` : ""}</span></div><Progress value={Number(launch.progressPercent || 0)} className="h-2" />{launch.message && <p className="text-sm text-muted-foreground">{launch.message}</p>}</div>}{!session.channel && <Alert><AlertTriangle className="size-4" /><AlertTitle>Choose a live channel</AlertTitle><AlertDescription>Edit this session and select eBay Live or TikTok Live before reviewing launch readiness.</AlertDescription></Alert>}{session.channel === "whatnot_live" && <Alert><AlertTriangle className="size-4" /><AlertTitle>Whatnot publishing is not connected</AlertTitle><AlertDescription>The session inventory remains reserved and traceable, but DataPlus will not claim that these products were published.</AlertDescription></Alert>}{!launch.jobId && launch.message && <p className="text-sm text-muted-foreground">{launch.message}</p>}</CardContent></Card>
    <Card><CardHeader className="border-b"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-base">Session inventory</CardTitle><CardDescription>{session.channelLabel || "Destination not assigned"}{session.channelAccountName ? ` · ${session.channelAccountName}${session.channelShopId ? ` (${session.channelShopId})` : ""}` : ""}</CardDescription></div><div className="flex flex-wrap gap-2"><Badge variant="outline" className={statusClass(session.status)}>{statusLabel(session.status)}</Badge>{sourceLink && <Button asChild size="sm" variant="outline"><a href={sourceLink}>Open source</a></Button>}</div></div></CardHeader><CardContent className="p-0">{items.length ? <MobileTables><Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Merchant SKU</TableHead><TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Sale price</TableHead><TableHead className="text-right">Received</TableHead><TableHead className="text-right">Source</TableHead><TableHead className="text-right">Requested</TableHead><TableHead className="text-right">Reserved</TableHead><TableHead className="text-right">Short</TableHead><TableHead className="text-right">Sold</TableHead><TableHead className="text-right">Shipped</TableHead><TableHead className="text-right">Released</TableHead><TableHead className="text-right">Remaining</TableHead><TableHead>Inventory</TableHead><TableHead>Channel launch</TableHead></TableRow></TableHeader><TableBody>{items.map((item, index) => <TableRow key={String(item.id || `${item.sku}-${index}`)} className={metric(item, "shortageQty") > 0 ? "bg-amber-500/5" : ""}><TableCell><ItemIdentity item={item} /></TableCell><TableCell><p className="font-mono text-xs font-medium">{item.launch?.merchantSku || item.merchantSku || item.manufacturerSku || "-"}</p>{item.launch?.merchantSkuBase && item.launch.merchantSkuBase !== item.launch.merchantSku && <p className="mt-1 text-xs text-muted-foreground">{item.launch.merchantSkuSource === "dataplus_sku" ? "DataPlus SKU" : "MPN"} {item.launch.merchantSkuBase}</p>}</TableCell><TableCell className="text-right">{moneyLabel(Number(item.unitCost || 0))}</TableCell><TableCell className="text-right font-medium">{moneyLabel(Number(item.salePrice || 1))}</TableCell><TableCell className="text-right">{numberLabel(item.receivedQty)}</TableCell><TableCell className="text-right">{numberLabel(item.sourceAvailableQty)}</TableCell><TableCell className="text-right">{numberLabel(item.requestedQty)}</TableCell><TableCell className="text-right font-medium">{numberLabel(item.reservedQty)}</TableCell><TableCell className="text-right text-amber-700 dark:text-amber-300">{numberLabel(item.shortageQty)}</TableCell><TableCell className="text-right">{numberLabel(item.soldQty)}</TableCell><TableCell className="text-right">{numberLabel(item.shippedQty)}</TableCell><TableCell className="text-right">{numberLabel(item.releasedQty)}</TableCell><TableCell className="text-right font-medium">{numberLabel(item.remainingQty)}</TableCell><TableCell>{metric(item, "shortageQty") > 0 ? <Badge variant="warning">Short {numberLabel(item.shortageQty)}</Badge> : metric(item, "remainingQty") > 0 ? <Badge variant="success">Available</Badge> : <Badge variant="outline">Allocated</Badge>}</TableCell><TableCell><div className="grid min-w-56 gap-1.5"><span><Badge variant="outline" className={launchClass(String(item.launch?.status || "not_reviewed"))}>{launchLabel(String(item.launch?.status || "not_reviewed"))}</Badge>{Number(item.launch?.quantity || 0) > 0 && <span className="ml-2 text-xs text-muted-foreground">{numberLabel(item.launch?.quantity)} unit(s)</span>}</span><p className="max-w-80 text-xs text-muted-foreground">{launchStatusDetail(item, launch)}</p>{item.launch?.blockers?.[0] && <p className="max-w-80 text-xs text-amber-700 dark:text-amber-300" title={item.launch.blockers.join(" ")}>{item.launch.blockers[0]}</p>}{item.launch?.error && <p className="max-w-80 text-xs text-destructive" title={item.launch.error}>{item.launch.error}</p>}{(item.launch?.listingId || item.launch?.offerId) && <p className="max-w-80 truncate font-mono text-[11px] text-muted-foreground" title={[item.launch.listingId, item.launch.offerId].filter(Boolean).join(" · ")}>{item.launch.listingId ? `Listing ${item.launch.listingId}` : ""}{item.launch.listingId && item.launch.offerId ? " · " : ""}{item.launch.offerId ? `Offer ${item.launch.offerId}` : ""}</p>}{item.launch?.updatedAt && <p className="text-[11px] text-muted-foreground">Updated {dateLabel(item.launch.updatedAt)}</p>}<span className="flex flex-wrap gap-1">{item.launch?.listingUrl && <Button asChild size="sm" variant="ghost"><a href={item.launch.listingUrl} target="_blank" rel="noreferrer">Open listing<ExternalLink className="size-3.5" /></a></Button>}{item.launch?.status === "blocked" && <Button asChild size="sm" variant="ghost"><a href={`/products/${encodeURIComponent(String(item.sku || ""))}`}>Fix product</a></Button>}{item.launch?.status === "failed" && <Button size="sm" variant="outline" disabled={Boolean(working)} onClick={() => void publishLaunch([String(item.id || "")], true)}><RefreshCw className="size-3.5" /> Retry</Button>}</span></div></TableCell></TableRow>)}</TableBody></Table></MobileTables> : <div className="flex min-h-48 flex-col items-center justify-center gap-3 px-5 py-10 text-center"><ScanBarcode className="size-8 text-muted-foreground" /><div><p className="font-medium">No session items yet</p><p className="mt-1 text-sm text-muted-foreground">Scan the linked audit or add inventory from a source.</p></div>{scanUrl && <Button onClick={() => window.location.assign(scanUrl)}>Start scanning</Button>}</div>}</CardContent></Card>
    {session.notes && <Card><CardHeader><CardTitle className="text-sm">Session notes</CardTitle><CardDescription className="whitespace-pre-wrap">{session.notes}</CardDescription></CardHeader></Card>}
    <Dialog open={editOpen} onOpenChange={setEditOpen}><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>Edit live session</DialogTitle><DialogDescription>Set the launch destination, schedule, and marketplace event without changing reserved quantities.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><Field label="Session name"><Input value={edit.title} onChange={(event) => setEdit((current) => ({ ...current, title: event.target.value }))} /></Field><Field label="Live channel"><Select value={edit.channel} onValueChange={(channel) => setEdit((current) => ({ ...current, channel, channelAccountId: "" }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{destinations.map((destination) => <SelectItem key={destination.value} value={destination.value}>{destination.label}</SelectItem>)}</SelectContent></Select></Field><Field label="Seller account / shop"><Select value={edit.channelAccountId || "unassigned"} onValueChange={(channelAccountId) => setEdit((current) => ({ ...current, channelAccountId: channelAccountId === "unassigned" ? "" : channelAccountId }))}><SelectTrigger><SelectValue placeholder="Choose a connected shop" /></SelectTrigger><SelectContent><SelectItem value="unassigned">No shop selected</SelectItem>{accounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}{account.shopId ? ` (${account.shopId})` : ""}</SelectItem>)}</SelectContent></Select></Field><Field label="Time zone"><Input value={edit.scheduleTimeZone} onChange={(event) => setEdit((current) => ({ ...current, scheduleTimeZone: event.target.value }))} placeholder="America/New_York" /></Field><Field label="Scheduled start"><Input type="datetime-local" value={edit.scheduledStartAt} onChange={(event) => setEdit((current) => ({ ...current, scheduledStartAt: event.target.value }))} /></Field><Field label="Scheduled end"><Input type="datetime-local" value={edit.scheduledEndAt} onChange={(event) => setEdit((current) => ({ ...current, scheduledEndAt: event.target.value }))} /></Field>{edit.channel === "ebay_live" && <div className="sm:col-span-2"><Field label="eBay Live event ID"><Input value={edit.channelEventId} onChange={(event) => setEdit((current) => ({ ...current, channelEventId: event.target.value }))} placeholder="Paste the eBay Live event ID" /></Field></div>}<div className="sm:col-span-2"><Field label="Notes"><Textarea value={edit.notes} onChange={(event) => setEdit((current) => ({ ...current, notes: event.target.value }))} /></Field></div></div><DialogFooter><Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button><Button onClick={() => void saveEdit()} disabled={working === "save"}>{working === "save" && <Loader2 className="size-4 animate-spin" />} Save session</Button></DialogFooter></DialogContent></Dialog>
    <AlertDialog open={publishOpen} onOpenChange={setPublishOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Publish {readyLaunchItems.length} ready item(s)?</AlertDialogTitle><AlertDialogDescription>DataPlus will publish each eBay merchant SKU as MPN-LV-MM-DD-YY, or DataPlus SKU-LV-MM-DD-YY when no MPN exists, and only the remaining reserved quantity to {session.channelAccountName || "the selected seller account"}. The original MPN remains attached for matching. The job will retain per-SKU listing IDs, failures, and retry evidence.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void publishLaunch()} disabled={working === "launch-publish"}>{working === "launch-publish" && <Loader2 className="size-4 animate-spin" />} Publish ready items</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={Boolean(confirmAction)} onOpenChange={(open) => !open && setConfirmAction("")}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirmAction === "cancel" ? "Cancel this live session?" : "Complete this live session?"}</AlertDialogTitle><AlertDialogDescription>Unused reserved quantities will be released for another session. Sold and shipped evidence remains attached for reporting.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep open</AlertDialogCancel><AlertDialogAction onClick={() => void runAction(confirmAction || "complete")} className={confirmAction === "cancel" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}>{confirmAction === "cancel" ? "Cancel session" : "Complete session"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>
}

export function LiveSessionsRoute({ warehouses = [], operatorName = "Warehouse user" }: { warehouses?: WarehouseReference[]; operatorName?: string }) {
  const detailKey = detailKeyFromPath()
  const urlDefaults = useMemo(defaultsFromUrl, [])
  const [sessions, setSessions] = useState<LiveSession[]>([])
  const [selectedSession, setSelectedSession] = useState<LiveSession | null>(null)
  const [references, setReferences] = useState<ReferenceData>({})
  const [referencesLoading, setReferencesLoading] = useState(false)
  const [referencesLoaded, setReferencesLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [createOpen, setCreateOpen] = useState(Boolean(urlDefaults.sourceId))
  const [creating, setCreating] = useState(false)
  const [loadingSource, setLoadingSource] = useState(false)
  const [draftItems, setDraftItems] = useState<DraftItem[]>([])
  const [manualQuery, setManualQuery] = useState("")
  const [manualResults, setManualResults] = useState<QuickProduct[]>([])
  const [manualSearching, setManualSearching] = useState(false)
  const [sourceSummary, setSourceSummary] = useState<SourcePreviewSummary | null>(null)
  const [draft, setDraft] = useState({ title: "", sourceType: urlDefaults.sourceType, sourceId: urlDefaults.sourceId, warehouseId: "", channel: "unassigned", channelAccountId: "", tiktokCreatorId: "", scheduledStartAt: "", scheduledEndAt: "", scheduleTimeZone: browserTimeZone(), channelEventId: "", notes: "" })
  const referenceWarehouses = references.warehouses || warehouses
  const physicalWarehouses = useMemo(() => referenceWarehouses.filter((warehouse) => warehouse.isPhysical !== false && warehouse.inventorySourceType !== "supplier_feed" && warehouse.allowAudits !== false), [referenceWarehouses])

  const loadReferences = async () => {
    if (referencesLoaded || referencesLoading) return
    setReferencesLoading(true)
    try {
      const referenceParams = new URLSearchParams()
      if (urlDefaults.sourceId) referenceParams.set("sourceId", urlDefaults.sourceId)
      if (urlDefaults.sourceType) referenceParams.set("sourceType", urlDefaults.sourceType)
      const refs = await api<ReferenceData>(`/api/live-sessions/references${referenceParams.size ? `?${referenceParams}` : ""}`)
      setReferences(refs)
      setReferencesLoaded(true)
    } catch (loadError) {
      toast.error(loadError instanceof Error ? loadError.message : "Unable to load live-session setup options.")
    } finally { setReferencesLoading(false) }
  }

  const load = async () => {
    setLoading(true); setError("")
    try {
      if (detailKey) {
        const result = await api<{ session?: LiveSession }>(`/api/live-sessions/${encodeURIComponent(detailKey)}`)
        setSelectedSession(result.session || null)
      } else {
        const result = await api<{ sessions?: LiveSession[] }>("/api/live-sessions")
        setSessions(result.sessions || [])
      }
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Unable to load live sessions.") }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [detailKey])
  useEffect(() => { if (detailKey || createOpen) void loadReferences() }, [detailKey, createOpen, referencesLoaded])
  useEffect(() => { if (!draft.warehouseId && physicalWarehouses[0]?.id) setDraft((current) => ({ ...current, warehouseId: String(physicalWarehouses[0]?.id || "") })) }, [physicalWarehouses, draft.warehouseId])
  useEffect(() => { setSourceSummary(null) }, [draft.sourceType])

  const sourceReferences = draft.sourceType === "purchase_order" ? references.purchaseOrders || [] : draft.sourceType === "warehouse_audit" ? references.audits || [] : draft.sourceType === "previous_session" ? references.previousSessions || [] : []
  const selectedAccounts = (references.channelAccounts || []).filter((account) => account.channel === draft.channel)
  const tiktokCreators = references.tiktokCreators || []
  useEffect(() => {
    if (selectedAccounts.length === 1 && !draft.channelAccountId) setDraft((current) => ({ ...current, channelAccountId: selectedAccounts[0].id }))
    if (draft.channel === "tiktok_live" && tiktokCreators.length === 1 && !draft.tiktokCreatorId) setDraft((current) => ({ ...current, tiktokCreatorId: tiktokCreators[0].id }))
  }, [draft.channel, draft.channelAccountId, draft.tiktokCreatorId, selectedAccounts.length, selectedAccounts[0]?.id, tiktokCreators.length, tiktokCreators[0]?.id])

  const selectSource = async (sourceId: string, sourceType = draft.sourceType) => {
    setDraft((current) => ({ ...current, sourceId })); setDraftItems([]); setSourceSummary(null)
    if (!sourceId || !["purchase_order", "warehouse_audit", "previous_session"].includes(sourceType)) return
    setLoadingSource(true)
    try {
      const params = new URLSearchParams({ sourceType, sourceId })
      const result = await api<{ source?: { warehouseId?: string; channel?: string; channelAccountId?: string }; items?: DraftItem[]; summary?: SourcePreviewSummary }>(`/api/live-sessions/source-preview?${params}`)
      const source = result.source || {}
      setDraftItems((result.items || []).filter((item) => Number(item.allocatableQty || 0) > 0).map((item) => ({
        ...item,
        selected: false,
        requestedQty: 0,
        salePrice: Number(item.salePrice || 1)
      })))
      setSourceSummary(result.summary || null)
      setDraft((current) => {
        const channel = String(source.channel || current.channel || "unassigned") || "unassigned"
        return {
          ...current,
          warehouseId: String(source.warehouseId || current.warehouseId),
          channel,
          channelAccountId: String(source.channelAccountId || (channel === current.channel ? current.channelAccountId : "") || "")
        }
      })
    } catch (sourceError) { toast.error(sourceError instanceof Error ? sourceError.message : "Unable to load the inventory source.") }
    finally { setLoadingSource(false) }
  }

  useEffect(() => { if (urlDefaults.sourceId && draft.sourceId === urlDefaults.sourceId && !draftItems.length) void selectSource(urlDefaults.sourceId, draft.sourceType) }, [references.purchaseOrders?.length, references.audits?.length, references.previousSessions?.length])
  useEffect(() => {
    if (draft.sourceType !== "manual_skus" || manualQuery.trim().length < 2) { setManualResults([]); return }
    const controller = new AbortController(); const timer = window.setTimeout(async () => {
      setManualSearching(true)
      try { const result = await api<{ products?: QuickProduct[] }>(`/api/quick-search/products?q=${encodeURIComponent(manualQuery.trim())}&limit=10`, { signal: controller.signal }); setManualResults(result.products || []) }
      catch (searchError) { if (!controller.signal.aborted) toast.error(searchError instanceof Error ? searchError.message : "Unable to search products.") }
      finally { if (!controller.signal.aborted) setManualSearching(false) }
    }, 250)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [manualQuery, draft.sourceType])

  const addManualProduct = (product: QuickProduct) => {
    if (draftItems.some((item) => item.sku === product.sku)) return
    const available = Math.max(0, Number(product.qty || 0))
    setDraftItems((current) => [...current, { id: product.id || product.sku, productId: product.id, sku: product.sku, title: product.title || product.sku, image: product.image, upc: product.barcode, manufacturerSku: product.mfrPartNumber, supplierSku: product.vendorSku, unitCost: product.cost, sourceAvailableQty: available, selected: true, requestedQty: Math.min(1, available), salePrice: 1 }])
    setManualQuery(""); setManualResults([])
  }

  const create = async (): Promise<void> => {
    if (creating) return
    if (["purchase_order", "warehouse_audit", "previous_session"].includes(draft.sourceType) && !draft.sourceId) { toast.error("Choose an inventory source."); return }
    if (["purchase_order", "warehouse_audit", "previous_session"].includes(draft.sourceType) && !draftItems.length) { toast.error("This source has no unreserved inventory left for another session."); return }
    if (draft.sourceType === "manual_skus" && !draftItems.length) { toast.error("Add at least one SKU."); return }
    if (draft.sourceType !== "extra_items" && !draftItems.some((item) => item.selected !== false && item.requestedQty > 0)) { toast.error("Select at least one item and enter the quantity to reserve."); return }
    if (["extra_items", "manual_skus"].includes(draft.sourceType) && !draft.warehouseId) { toast.error("Choose a warehouse."); return }
    setCreating(true)
    try {
      const result = await api<{ message?: string; auditUrl?: string; mobileAuditUrl?: string; sessionUrl?: string }>("/api/live-sessions", { method: "POST", body: JSON.stringify({ ...draft, channel: draft.channel === "unassigned" ? "" : draft.channel, scheduledStartAt: isoDateTimeValue(draft.scheduledStartAt), scheduledEndAt: isoDateTimeValue(draft.scheduledEndAt), user: operatorName, items: draftItems.filter((item) => item.selected !== false && item.requestedQty > 0).map((item) => ({ id: item.id, sourceLineId: item.sourceLineId, productId: item.productId, sku: item.sku, requestedQty: item.requestedQty, salePrice: Math.max(0.01, Number(item.salePrice || 1)) })) }) })
      toast.success(result.message || "Live session created.")
      const scannerUrl = window.matchMedia("(max-width: 767px)").matches ? result.mobileAuditUrl : result.auditUrl
      window.location.assign(scannerUrl || result.sessionUrl || "/live-sessions")
    } catch (createError) { toast.error(createError instanceof Error ? createError.message : "Unable to create the live session.") }
    finally { setCreating(false) }
  }

  if (detailKey) return <SessionDetail session={selectedSession} loading={loading} error={error} references={references} onReload={load} />
  const active = sessions.filter((session) => !["completed", "canceled"].includes(String(session.status))).length
  const reserved = sessions.reduce((sum, session) => sum + Number(session.reservedUnits || session.scannedUnits || 0), 0)
  const sold = sessions.reduce((sum, session) => sum + Number(session.soldUnits || 0), 0)
  const shortages = sessions.reduce((sum, session) => sum + Number(session.shortageUnits || 0), 0)

  return <div className="grid gap-5">
    <PageHeader eyebrow="Warehouse / Live sessions" title="Live Sessions" description="Reserve inventory once, split a PO across multiple launches, and reconcile sold and shipped quantities without deducting physical stock twice." action={<Button onClick={() => setCreateOpen(true)}><PackagePlus className="size-4" /> Create session</Button>} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Active sessions" value={active} icon={RadioTower} /><MetricCard label="Reserved units" value={reserved} icon={Boxes} /><MetricCard label="Sold units" value={sold} icon={ShoppingBag} /><MetricCard label="Shortage units" value={shortages} icon={AlertTriangle} /></div>
    {error && <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Live sessions could not load</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    <Card><CardHeader className="border-b"><CardTitle className="text-base">Sessions</CardTitle><CardDescription>Every quantity stays traceable to the PO, audit, previous session, or warehouse stock that supplied it.</CardDescription></CardHeader><CardContent className="p-0">{loading ? <div className="flex min-h-52 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading live sessions...</div> : sessions.length ? <MobileTables><Table><TableHeader><TableRow><TableHead>Session</TableHead><TableHead>Source</TableHead><TableHead>Destination</TableHead><TableHead className="text-right">Reserved</TableHead><TableHead className="text-right">Sold</TableHead><TableHead className="text-right">Shipped</TableHead><TableHead className="text-right">Remaining</TableHead><TableHead>Status</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader><TableBody>{sessions.map((session) => <TableRow key={session.id}><TableCell><a className="font-medium text-primary hover:underline" href={`/live-sessions/${encodeURIComponent(String(session.sessionNumber || session.id))}`}>{session.sessionNumber || "Session"}</a><p className="max-w-72 truncate text-xs text-muted-foreground">{session.title || "Live inventory"}</p></TableCell><TableCell><p>{session.sourceLabel || "Live inventory"}</p><p className="text-xs text-muted-foreground">{session.warehouseName || "-"}</p></TableCell><TableCell><p>{session.channelLabel || "Not assigned"}</p><p className="text-xs text-muted-foreground">{session.channelAccountName || "No shop selected"}</p></TableCell><TableCell className="text-right font-medium">{numberLabel(session.reservedUnits || session.scannedUnits)}</TableCell><TableCell className="text-right">{numberLabel(session.soldUnits)}</TableCell><TableCell className="text-right">{numberLabel(session.shippedUnits)}</TableCell><TableCell className="text-right">{numberLabel(session.remainingUnits)}</TableCell><TableCell><Badge variant="outline" className={statusClass(session.status)}>{statusLabel(session.status)}</Badge>{Number(session.shortageUnits || 0) > 0 && <Badge variant="warning" className="ml-1">Short {numberLabel(session.shortageUnits)}</Badge>}</TableCell><TableCell>{dateLabel(session.updatedAt || session.createdAt)}</TableCell></TableRow>)}</TableBody></Table></MobileTables> : <div className="flex min-h-52 flex-col items-center justify-center gap-3 px-5 py-10 text-center"><RadioTower className="size-8 text-muted-foreground" /><div><p className="font-medium">No live sessions yet</p><p className="mt-1 max-w-md text-sm text-muted-foreground">Create one from a live-purpose PO, inventory audit, previous unsold inventory, manual SKUs, or a new scan.</p></div><Button onClick={() => setCreateOpen(true)}><PackagePlus className="size-4" /> Create session</Button></div>}</CardContent></Card>
    <CreateDialog open={createOpen} onOpenChange={setCreateOpen} draft={draft} setDraft={setDraft} sourceReferences={sourceReferences} selectSource={selectSource} physicalWarehouses={physicalWarehouses} selectedAccounts={selectedAccounts} loadingReferences={referencesLoading || !referencesLoaded} loadingSource={loadingSource} sourceSummary={sourceSummary} draftItems={draftItems} setDraftItems={setDraftItems} manualQuery={manualQuery} setManualQuery={setManualQuery} manualResults={manualResults} manualSearching={manualSearching} addManualProduct={addManualProduct} references={references} creating={creating} create={create} />
  </div>
}

type DraftState = { title: string; sourceType: string; sourceId: string; warehouseId: string; channel: string; channelAccountId: string; tiktokCreatorId: string; scheduledStartAt: string; scheduledEndAt: string; scheduleTimeZone: string; channelEventId: string; notes: string }
function CreateDialog(props: {
  open: boolean; onOpenChange: (open: boolean) => void; draft: DraftState; setDraft: React.Dispatch<React.SetStateAction<DraftState>>; sourceReferences: SourceReference[]
  selectSource: (sourceId: string) => Promise<void>; physicalWarehouses: WarehouseReference[]; selectedAccounts: ChannelAccount[]; loadingReferences: boolean; loadingSource: boolean; sourceSummary: SourcePreviewSummary | null
  draftItems: DraftItem[]; setDraftItems: React.Dispatch<React.SetStateAction<DraftItem[]>>; manualQuery: string; setManualQuery: (value: string) => void
  manualResults: QuickProduct[]; manualSearching: boolean; addManualProduct: (product: QuickProduct) => void; references: ReferenceData; creating: boolean; create: () => Promise<void>
}) {
  const { draft, setDraft } = props
  const selectedSource = props.sourceReferences.find((source) => source.id === draft.sourceId)
  const selectedAuditUrl = draft.sourceType === "warehouse_audit" && selectedSource
    ? warehouseAuditUrl(selectedSource.number, selectedSource.id)
    : ""
  return <Dialog open={props.open} onOpenChange={props.onOpenChange}><DialogContent className="flex h-[min(92vh,900px)] max-w-[calc(100vw-1rem)] flex-col overflow-hidden p-0 sm:max-w-6xl"><DialogHeader className="border-b px-6 py-5"><DialogTitle>Create live session</DialogTitle><DialogDescription>{props.references.scope?.companyName || "Selected company"} · Choose the physical source first, then reserve only the units planned for this launch.</DialogDescription></DialogHeader><div className="min-h-0 flex-1 overflow-y-auto px-6 py-5"><div className="grid gap-5">
    {props.loadingReferences ? <div className="flex min-h-32 items-center justify-center gap-2 rounded-md border bg-muted/20 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading setup options...</div> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><Field label="Inventory source"><Select value={draft.sourceType} onValueChange={(sourceType) => { setDraft((current) => ({ ...current, sourceType, sourceId: "" })); props.setDraftItems([]) }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{sources.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></Field>{["purchase_order", "warehouse_audit", "previous_session"].includes(draft.sourceType) && <Field label={draft.sourceType === "purchase_order" ? "Purchase order (past 7 days)" : sources.find((option) => option.value === draft.sourceType)?.label || "Source"}><div className="flex min-w-0 gap-2"><Select value={draft.sourceId} onValueChange={(sourceId) => void props.selectSource(sourceId)}><SelectTrigger className="min-w-0 flex-1"><SelectValue placeholder="Choose source" /></SelectTrigger><SelectContent>{props.sourceReferences.length ? props.sourceReferences.map((source) => <SelectItem key={source.id} value={source.id}>{source.label}{source.remainingUnits ? ` · ${numberLabel(source.remainingUnits)} left` : ""}</SelectItem>) : <SelectItem value="no-sources" disabled>{draft.sourceType === "purchase_order" ? "No POs found in the past 7 days" : "No sources found"}</SelectItem>}</SelectContent></Select>{selectedAuditUrl && <Button asChild type="button" size="icon" variant="outline" title="Open warehouse audit"><a href={selectedAuditUrl} target="_blank" rel="noreferrer" aria-label="Open selected warehouse audit"><ExternalLink className="size-4" /></a></Button>}</div></Field>}{["extra_items", "manual_skus"].includes(draft.sourceType) && <Field label="Warehouse"><Select value={draft.warehouseId} onValueChange={(warehouseId) => setDraft((current) => ({ ...current, warehouseId }))}><SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger><SelectContent>{props.physicalWarehouses.map((warehouse) => <SelectItem key={String(warehouse.id || warehouse.name)} value={String(warehouse.id || "")}>{String(warehouse.name || "Warehouse")}{warehouse.code ? ` (${warehouse.code})` : ""}</SelectItem>)}</SelectContent></Select></Field>}<Field label="Session name"><Input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Friday tool launch" /></Field><Field label="Live channel"><Select value={draft.channel} onValueChange={(channel) => setDraft((current) => ({ ...current, channel, channelAccountId: "", tiktokCreatorId: channel === "tiktok_live" && (props.references.tiktokCreators || []).length === 1 ? String(props.references.tiktokCreators?.[0]?.id || "") : "" }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{destinations.map((destination) => <SelectItem key={destination.value} value={destination.value}>{destination.label}</SelectItem>)}</SelectContent></Select></Field><Field label="Seller account / shop"><Select value={draft.channelAccountId || "unassigned"} onValueChange={(channelAccountId) => setDraft((current) => ({ ...current, channelAccountId: channelAccountId === "unassigned" ? "" : channelAccountId }))}><SelectTrigger><SelectValue placeholder="Choose shop" /></SelectTrigger><SelectContent><SelectItem value="unassigned">Select later</SelectItem>{props.selectedAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}</SelectContent></Select></Field>{draft.channel === "tiktok_live" && <Field label="Streamer showcase"><Select value={draft.tiktokCreatorId || "unassigned"} onValueChange={(tiktokCreatorId) => setDraft((current) => ({ ...current, tiktokCreatorId: tiktokCreatorId === "unassigned" ? "" : tiktokCreatorId }))}><SelectTrigger><SelectValue placeholder="Choose official account" /></SelectTrigger><SelectContent><SelectItem value="unassigned">Select later</SelectItem>{(props.references.tiktokCreators || []).map((creator) => <SelectItem key={creator.id} value={creator.id}>{creator.username ? `@${creator.username}` : creator.label || creator.id}</SelectItem>)}</SelectContent></Select></Field>}<Field label="Scheduled start"><Input type="datetime-local" value={draft.scheduledStartAt} onChange={(event) => setDraft((current) => ({ ...current, scheduledStartAt: event.target.value }))} /></Field><Field label="Scheduled end"><Input type="datetime-local" value={draft.scheduledEndAt} onChange={(event) => setDraft((current) => ({ ...current, scheduledEndAt: event.target.value }))} /></Field><Field label="Time zone"><Input value={draft.scheduleTimeZone} onChange={(event) => setDraft((current) => ({ ...current, scheduleTimeZone: event.target.value }))} placeholder="America/New_York" /></Field>{draft.channel === "ebay_live" && <Field label="eBay Live event ID"><Input value={draft.channelEventId} onChange={(event) => setDraft((current) => ({ ...current, channelEventId: event.target.value }))} placeholder="Paste event ID" /></Field>}</div>}
    {draft.sourceType === "extra_items" && <Alert className="border-blue-500/30 bg-blue-500/5"><ScanBarcode className="size-4" /><AlertTitle>A linked audit will open</AlertTitle><AlertDescription>Creating the session does not add physical inventory; posting the audit remains the stock event.</AlertDescription></Alert>}
    {props.sourceSummary && ["purchase_order", "warehouse_audit", "previous_session"].includes(draft.sourceType) && <Alert className={Number(props.sourceSummary.availableUnits || 0) > 0 ? "border-blue-500/30 bg-blue-500/5" : "border-amber-500/40 bg-amber-500/5"}><Boxes className="size-4" /><AlertTitle>{numberLabel(props.sourceSummary.availableUnits)} unreserved unit(s) available</AlertTitle><AlertDescription>{numberLabel(props.sourceSummary.sourceUnits)} source unit(s) were found; {numberLabel(props.sourceSummary.committedUnits)} are already reserved or sold through other sessions.{Number(props.sourceSummary.exhaustedItems || 0) > 0 ? ` ${numberLabel(props.sourceSummary.exhaustedItems)} fully assigned SKU(s) are omitted below.` : ""}</AlertDescription></Alert>}
    {draft.sourceType === "manual_skus" && <div className="grid gap-2"><Label htmlFor="live-manual-search">Add catalog SKUs</Label><div className="relative"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input id="live-manual-search" className="pl-9" value={props.manualQuery} onChange={(event) => props.setManualQuery(event.target.value)} placeholder="Search SKU, UPC, MPN, or title" />{props.manualSearching && <Loader2 className="absolute right-3 top-2.5 size-4 animate-spin text-muted-foreground" />}</div>{props.manualResults.length > 0 && <div className="divide-y rounded-md border">{props.manualResults.map((product) => <button type="button" key={product.id || product.sku} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted" onClick={() => props.addManualProduct(product)}>{product.image ? <img src={product.image} alt="" className="size-9 rounded border object-contain" /> : <span className="grid size-9 place-items-center rounded border bg-muted"><Boxes className="size-4" /></span>}<span className="min-w-0 flex-1"><span className="block font-mono text-xs text-primary">{product.sku}</span><span className="block truncate text-sm font-medium">{product.title || product.sku}</span></span><Badge variant="outline">{numberLabel(product.qty)} available</Badge></button>)}</div>}</div>}
    {props.loadingSource && <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading source inventory...</div>}
    {!props.loadingSource && props.draftItems.length > 0 && <Card><CardHeader className="border-b"><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle className="text-sm">Inventory allocation</CardTitle><CardDescription>Select only the items for this session. Quantities are rechecked atomically when saved; the sale price is carried into the channel launch.</CardDescription></div><div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" onClick={() => props.setDraftItems((current) => current.map((item) => ({ ...item, selected: true, requestedQty: item.requestedQty > 0 ? item.requestedQty : Number(item.allocatableQty ?? item.sourceAvailableQty ?? 0) })))}>Select all</Button><Button size="sm" variant="ghost" onClick={() => props.setDraftItems((current) => current.map((item) => ({ ...item, selected: false, requestedQty: 0 })))}>Clear</Button><Badge variant="outline">{numberLabel(props.draftItems.filter((item) => item.selected !== false).reduce((sum, item) => sum + Number(item.requestedQty || 0), 0))} requested</Badge></div></div></CardHeader><CardContent className="p-0"><MobileTables><Table><TableHeader><TableRow><TableHead className="w-12">Use</TableHead><TableHead>Item</TableHead><TableHead className="text-right">Source</TableHead><TableHead className="text-right">In sessions</TableHead><TableHead className="text-right">Available</TableHead><TableHead className="w-28">Reserve</TableHead><TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Suggested</TableHead><TableHead className="w-32">Sale price</TableHead>{draft.sourceType === "manual_skus" && <TableHead className="w-14" />}</TableRow></TableHeader><TableBody>{props.draftItems.map((item, index) => { const selected = item.selected !== false; const suggested = suggestedLivePrice(item.unitCost); return <TableRow key={String(item.id || `${item.sku}-${index}`)} className={selected ? "bg-blue-500/5" : "opacity-70"}><TableCell><Checkbox checked={selected} onCheckedChange={(checked) => props.setDraftItems((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, selected: checked === true, requestedQty: checked === true ? (row.requestedQty > 0 ? row.requestedQty : Number(row.allocatableQty ?? row.sourceAvailableQty ?? 0)) : 0 } : row))} aria-label={`Use ${item.sku || item.title || "item"}`} /></TableCell><TableCell><ItemIdentity item={item} /></TableCell><TableCell className="text-right tabular-nums">{numberLabel(item.sourceAvailableQty)}</TableCell><TableCell className="text-right tabular-nums text-muted-foreground">{numberLabel(item.sourceCommittedQty)}</TableCell><TableCell className="text-right font-medium tabular-nums">{numberLabel(item.allocatableQty ?? item.sourceAvailableQty)}</TableCell><TableCell><Input type="number" min={0} max={Number(item.allocatableQty ?? item.sourceAvailableQty ?? 0)} step={1} value={item.requestedQty} disabled={!selected} onChange={(event) => props.setDraftItems((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, requestedQty: Math.max(0, Math.min(Number(row.allocatableQty ?? row.sourceAvailableQty ?? 0), Number(event.target.value || 0))) } : row))} /></TableCell><TableCell className="text-right font-medium">{moneyLabel(Number(item.unitCost || 0))}</TableCell><TableCell className="text-right"><button type="button" className="font-medium text-emerald-700 hover:underline dark:text-emerald-300" onClick={() => props.setDraftItems((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, salePrice: suggested } : row))} title="Use suggested price">{moneyLabel(suggested)}</button><p className="text-[11px] text-muted-foreground">20%+ markup</p></TableCell><TableCell><Input type="number" min={0.01} step={0.01} value={Number(item.salePrice || 1)} disabled={!selected} onChange={(event) => props.setDraftItems((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, salePrice: Math.max(0.01, Number(event.target.value || 1)) } : row))} /></TableCell>{draft.sourceType === "manual_skus" && <TableCell><Button size="icon" variant="ghost" onClick={() => props.setDraftItems((current) => current.filter((_, rowIndex) => rowIndex !== index))} aria-label={`Remove ${item.sku}`}><Trash2 className="size-4" /></Button></TableCell>}</TableRow> })}</TableBody></Table></MobileTables></CardContent></Card>}
    <Field label="Notes"><Textarea value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Optional launch, handling, or sourcing notes" /></Field>
  </div></div><DialogFooter className="border-t px-6 py-4"><Button variant="outline" onClick={() => props.onOpenChange(false)}>Cancel</Button><Button disabled={props.creating || props.loadingReferences || props.loadingSource || (["purchase_order", "warehouse_audit", "previous_session"].includes(draft.sourceType) && Boolean(draft.sourceId) && !props.draftItems.length)} onClick={() => void props.create()}>{props.creating ? <Loader2 className="size-4 animate-spin" /> : draft.sourceType === "extra_items" ? <ScanBarcode className="size-4" /> : <PackagePlus className="size-4" />} {draft.sourceType === "extra_items" ? "Create and scan" : "Create session"}</Button></DialogFooter></DialogContent></Dialog>
}
