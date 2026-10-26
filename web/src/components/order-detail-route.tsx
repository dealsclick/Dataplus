import { useEffect, useRef, useState } from "react"
import { AlertCircle, AlertTriangle, Ban, Boxes, CheckCircle2, ExternalLink, FileText, Loader2, Pencil, RefreshCw, RotateCcw, Search, Truck } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { OrderReturnDetails, ReturnReceiptFields } from "./order-return-details"
import { OrderTransactions } from "./order-transactions"
import { OrderNotesPanel } from "./order-notes-panel"
import { EbayLiveMark, ebayLiveEventIds, isEbayLiveOrder } from "./ebay-live-mark"
import { api, dateLabel, moneyLabel, numberLabel } from "../lib/client-api"
import {
  channelOrderNumberFor,
  channelOrderUrlFor,
  CustomerNotificationPanel,
  Detail,
  detectTrackingCarrier,
  enabledCarrierNames,
  enabledCarrierServices,
  Field,
  fulfillmentPackageDefaults,
  FulfillmentStagePanel,
  getOrderRoutingState,
  HistoryBackButton,
  LinkedPurchaseOrdersTable,
  OrderActionsMenu,
  OrderActivityTimeline,
  OrderChannelHeaderReferences,
  OrderChannelPanel,
  OrderCustomerInformationCard,
  OrderCustomerPanel,
  OrderDocumentsPanel,
  OrderFinancePanel,
  OrderFulfillmentItemRows,
  orderAttentionItems,
  orderFulfillmentRateReview,
  orderHasBlockingException,
  orderHref,
  OrderItemsProfitLoss,
  OrderLineActionPanel,
  OrderOperationsPanel,
  OrderRefundSyncPanel,
  OrderReturnSyncPanel,
  OrderReturnsPanel,
  orderStateLabel,
  orderUrlKey,
  PageHeader,
  ReturnLabelPanel,
  rmaHref,
  shipmentDisplayValue,
  ShipmentGroupPanel,
  ShippingLabelReadinessPanel,
  ShopifyDeliveryQuotePanel,
  ShopifyPaymentCapturePanel,
  ToggleField,
  trackingUrlForShipment,
  UniversalShippingLabelDialog,
  useFulfillmentCarriers,
  walmartOrderIdentifiers,
} from "../App"

export { OrderDetailWorkspace, RmaDetailPage }

function RmaDetailPage() {
  const returnId = decodeURIComponent((window.location.pathname.split("/")[2] || "").trim())
  const [record, setRecord] = useState<Record<string, unknown> | null>(null)
  const [order, setOrder] = useState<Record<string, unknown> | null>(null)
  const [warehouses, setWarehouses] = useState<Array<Record<string, unknown>>>([])
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [approvalNote, setApprovalNote] = useState("")
  const resetDraft = (next: Record<string, unknown>) => setDraft({
    warehouseId: String(next.warehouseId || ""), status: String(next.receivingStatus || (next.status === "closed" ? "done" : next.status) || "requested"),
    condition: String(next.condition || "Unknown"), disposition: String(next.disposition || "quarantine"), binLocation: String(next.binLocation || ""),
    inspectionStatus: String(next.inspectionStatus || "pending"), inspectionCondition: String(next.inspectionCondition || ""), inspectionNotes: String(next.inspectionNotes || ""),
    resolutionNotes: String(next.resolutionNotes || ""), returnFee: String(next.returnFee || ""), note: String(next.note || ""),
    ...Object.fromEntries((Array.isArray(next.items) ? next.items as Array<Record<string, unknown>> : []).map((line, index) => [`received-${index}`, String(line.receivedQty || 0)])),
  })
  const load = async () => {
    setLoading(true)
    try {
      const result = await api<{ return?: Record<string, unknown>; order?: Record<string, unknown> | null; warehouses?: Array<Record<string, unknown>> }>(`/api/returns/${encodeURIComponent(returnId)}`)
      setRecord(result.return || null); setOrder(result.order || null); setWarehouses(result.warehouses || [])
      if (result.return) {
        resetDraft(result.return)
        const canonicalPath = rmaHref(result.return)
        if (window.location.pathname !== canonicalPath) window.history.replaceState({}, "", canonicalPath)
      }
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load this RMA.") } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [returnId])
  const save = async () => {
    if (!record) return
    setSaving(true)
    try {
      const items = (Array.isArray(record.items) ? record.items as Array<Record<string, unknown>> : []).map((line, index) => ({ ...line, receivedQty: Number(draft[`received-${index}`] ?? line.receivedQty ?? 0) }))
      const result = await api<{ return?: Record<string, unknown> }>(`/api/returns/${encodeURIComponent(String(record.id || ""))}`, { method: "PATCH", body: JSON.stringify({ ...draft, returnFee: Number(draft.returnFee || 0), items }) })
      if (String((result.return?.allocationReview as Record<string, unknown> | undefined)?.status || "") === "pending") await api(`/api/returns/${encodeURIComponent(String(record.id || ""))}/allocate-open-orders`, { method: "POST" })
      await load(); toast.success("RMA updated.")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update this RMA.") } finally { setSaving(false) }
  }
  const addEvidence = async (files: FileList | null) => {
    if (!record || !files?.length) return
    const existing = Array.isArray(record.attachments) ? record.attachments.length : 0
    if (existing + files.length > 8) return toast.error("An RMA can contain up to 8 evidence files.")
    setSaving(true)
    try {
      const attachments: Array<Record<string, unknown>> = []
      for (const file of Array.from(files)) {
        if (!["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error("Use PNG, JPEG, WebP, or PDF files up to 5 MB each.")
        const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || "")); reader.onerror = () => reject(new Error("Unable to read the selected evidence.")); reader.readAsDataURL(file) })
        attachments.push({ id: crypto.randomUUID(), name: file.name, size: file.size, mimeType: file.type, dataUrl, stage: "review", source: "RMA detail" })
      }
      await api(`/api/returns/${encodeURIComponent(String(record.id || ""))}`, { method: "PATCH", body: JSON.stringify({ attachments }) })
      await load(); toast.success(`${attachments.length} evidence file${attachments.length === 1 ? "" : "s"} added.`)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to add return evidence.") } finally { setSaving(false) }
  }
  const decideApproval = async (action: "approve" | "reject" | "request_revision") => {
    if (!record) return
    setSaving(true)
    try {
      const result = await api<{ message?: string }>(`/api/returns/${encodeURIComponent(String(record.id || ""))}/approval`, { method: "POST", body: JSON.stringify({ action, note: approvalNote.trim() }) })
      setApprovalNote("")
      await load()
      toast.success(result.message || "Return review updated.")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update return approval.") } finally { setSaving(false) }
  }
  if (loading) return <div className="grid gap-4"><Skeleton className="h-20" /><Skeleton className="h-40" /><Skeleton className="h-72" /></div>
  if (!record) return <div className="grid gap-4"><PageHeader eyebrow="Orders / Returns" title="RMA not found" description="This return may have been removed or the link is incorrect." action={<HistoryBackButton fallback="/returns" label="Back to returns" />} /></div>
  const orderKey = String(order?.id || record.orderId || record.orderNumber || "")
  const returnNumber = String(record.returnNumber || record.channelReturnId || record.id || "RMA")
  const attachments = Array.isArray(record.attachments) ? record.attachments as Array<Record<string, unknown>> : []
  const activity: Array<Record<string, unknown>> = [
    { id: "created", title: "RMA created", message: String(record.reason || "Return requested"), createdAt: record.createdAt, user: record.createdBy },
    ...(Array.isArray(record.receiptHistory) ? record.receiptHistory as Array<Record<string, unknown>> : []).map((entry) => ({ ...entry, title: "Return received", message: `${String(entry.condition || "Condition not recorded")} / ${String(entry.disposition || "Disposition pending")}`, createdAt: entry.at })),
    ...(Array.isArray(record.customerDeliveryHistory) ? record.customerDeliveryHistory as Array<Record<string, unknown>> : []).map((entry) => ({ ...entry, title: "RMA sent to customer", message: String(entry.recipient || ""), createdAt: entry.sentAt || entry.failedAt, user: entry.sentBy })),
    ...(Array.isArray(record.returnLabelHistory) ? record.returnLabelHistory as Array<Record<string, unknown>> : []).map((entry) => ({ ...entry, title: "Previous return label", message: `${String(entry.carrierName || entry.carrier || "Carrier")} ${String(entry.trackingNumber || "")}`, createdAt: entry.voidedAt || entry.purchasedAt, user: entry.voidedBy || entry.purchasedBy })),
    ...(Array.isArray(record.approvalHistory) ? record.approvalHistory as Array<Record<string, unknown>> : []).map((entry) => ({ ...entry, title: `Manager ${String(entry.action || "review").replace(/_/g, " ")}`, message: String(entry.note || "Return approval updated"), createdAt: entry.at, user: entry.by })),
  ].filter((entry) => entry.createdAt).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  const requestedTab = new URLSearchParams(window.location.search).get("tab") || "overview"
  const initialTab = ["overview", "receiving", "evidence", "transactions", "activity"].includes(requestedTab) ? requestedTab : "overview"
  return <div className="grid gap-5">
    <PageHeader eyebrow="Orders / Return authorization" title={returnNumber} description={`Order ${String(record.orderNumber || order?.orderNumber || "Unlinked")} / ${String(record.source || order?.source || "Local")}`} action={<div className="flex flex-wrap gap-2"><HistoryBackButton fallback="/returns" label="Back" />{orderKey && <Button size="sm" variant="outline" asChild><a href={`/orders/${encodeURIComponent(orderKey)}?tab=returns`}>Open order</a></Button>}<Button size="sm" variant="outline" disabled={loading} onClick={() => void load()}><RefreshCw className="size-4" /> Refresh</Button></div>} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Detail label="RMA status" value={String(record.status || "requested").replace(/_/g, " ")} /><Detail label="Receiving" value={String(record.receivingStatus || (record.receivedAt ? "Received" : "Not received")).replace(/_/g, " ")} /><Detail label="Refund value" value={record.refundAmountUnverified ? "Awaiting verification" : moneyLabel(Number(record.actualRefundAmount ?? record.amount ?? 0))} /><Detail label="Return warehouse" value={String(record.warehouseName || "Not assigned")} /><Detail label="Shipping" value={record.returnLabelPolicy === "merchant_provided" ? "Prepaid label" : "Customer paid"} /></div>
    {String(record.approvalStatus || "") === "pending" && <Card className="border-amber-500/40"><CardHeader><CardTitle className="text-sm">Manager approval required</CardTitle><CardDescription>{String(record.managerReviewReason || "Review this policy exception before customer service continues processing the return.")}</CardDescription></CardHeader><CardContent className="grid gap-3"><Field label="Manager decision note"><Textarea value={approvalNote} onChange={(event) => setApprovalNote(event.target.value)} placeholder="Explain the approval, rejection, or requested revision." /></Field><div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={saving} onClick={() => void decideApproval("request_revision")}>Request revision</Button><Button variant="destructive" disabled={saving} onClick={() => void decideApproval("reject")}>Reject</Button><Button disabled={saving} onClick={() => void decideApproval("approve")}><CheckCircle2 className="size-4" /> Approve and continue</Button></div></CardContent></Card>}
    <Card><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-medium">Return documents and shipping</p><p className="text-sm text-muted-foreground">Print, send, track, void, replace, or reconcile the label from this RMA.</p></div><ReturnLabelPanel record={record} onUpdated={load} /></CardContent></Card>
    <Tabs defaultValue={initialTab}><TabsList><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="receiving">Receiving</TabsTrigger><TabsTrigger value="evidence">Evidence ({Array.isArray(record.attachments) ? record.attachments.length : 0})</TabsTrigger><TabsTrigger value="transactions">Transactions</TabsTrigger><TabsTrigger value="activity">Activity ({activity.length})</TabsTrigger></TabsList>
      <TabsContent value="overview" className="grid gap-4 pt-4">{order ? <OrderCustomerInformationCard order={order} /> : <Card><CardHeader><CardTitle className="text-sm">Customer information</CardTitle><CardDescription>This RMA is not linked to an order with customer details.</CardDescription></CardHeader></Card>}<Card><CardHeader><CardTitle className="text-sm">Return summary</CardTitle><CardDescription>Customer request, authorized lines, channel status, and return destination.</CardDescription></CardHeader><CardContent><OrderReturnDetails record={record} trackingUrl={trackingUrlForShipment} /></CardContent></Card></TabsContent>
      <TabsContent value="receiving" className="grid gap-4 pt-4"><Card><CardHeader><CardTitle className="text-sm">Receiving and disposition</CardTitle><CardDescription>Record physical receipt, inspection, final disposition, and any restock approval.</CardDescription></CardHeader><CardContent className="grid gap-4"><div className="grid gap-4 sm:grid-cols-2"><Field label="Return status"><Select value={draft.status || "requested"} onValueChange={(status) => setDraft({ ...draft, status })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="needs_revision">Needs revision</SelectItem><SelectItem value="requested">Requested</SelectItem><SelectItem value="in_process">In process</SelectItem><SelectItem value="received">Received</SelectItem><SelectItem value="inspection">In inspection</SelectItem><SelectItem value="done">Closed</SelectItem></SelectContent></Select></Field><Field label="Disposition"><Select value={draft.disposition || "quarantine"} onValueChange={(disposition) => setDraft({ ...draft, disposition })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending_local_receipt">Awaiting decision</SelectItem><SelectItem value="restock">Restock inventory</SelectItem><SelectItem value="quarantine">Quarantine</SelectItem><SelectItem value="return_to_vendor">Return to vendor</SelectItem><SelectItem value="dispose">Dispose</SelectItem></SelectContent></Select></Field><Field label="Received condition"><Input value={draft.condition || ""} onChange={(event) => setDraft({ ...draft, condition: event.target.value })} /></Field><Field label="Bin location"><Input value={draft.binLocation || ""} onChange={(event) => setDraft({ ...draft, binLocation: event.target.value })} /></Field><Field label="Inspection status"><Select value={draft.inspectionStatus || "pending"} onValueChange={(inspectionStatus) => setDraft({ ...draft, inspectionStatus })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending">Pending</SelectItem><SelectItem value="passed">Passed</SelectItem><SelectItem value="failed">Failed</SelectItem></SelectContent></Select></Field><Field label="Inspection condition"><Input value={draft.inspectionCondition || ""} onChange={(event) => setDraft({ ...draft, inspectionCondition: event.target.value })} /></Field><Field label="Return fee"><Input type="number" min="0" step="0.01" value={draft.returnFee || ""} onChange={(event) => setDraft({ ...draft, returnFee: event.target.value })} /></Field></div><ReturnReceiptFields record={record} warehouses={warehouses} draft={draft} setDraft={setDraft} /><Field label="Internal note"><Textarea value={draft.note || ""} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></Field><Field label="Inspection notes"><Textarea value={draft.inspectionNotes || ""} onChange={(event) => setDraft({ ...draft, inspectionNotes: event.target.value })} /></Field><Field label="Resolution notes"><Textarea value={draft.resolutionNotes || ""} onChange={(event) => setDraft({ ...draft, resolutionNotes: event.target.value })} /></Field><div className="flex justify-end"><Button disabled={saving} onClick={() => void save()}>{saving && <Loader2 className="size-4 animate-spin" />} Save RMA</Button></div></CardContent></Card></TabsContent>
      <TabsContent value="evidence" className="grid gap-4 pt-4"><Card><CardHeader><CardTitle className="text-sm">Return evidence</CardTitle><CardDescription>PNG, JPEG, WebP, or PDF files. Each file can be up to 5 MB; each RMA can retain up to eight files.</CardDescription></CardHeader><CardContent className="grid gap-4"><Input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" multiple disabled={saving} onChange={(event) => { void addEvidence(event.target.files); event.target.value = "" }} />{attachments.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{attachments.map((file, index) => { const href = String(file.dataUrl || file.url || ""); const image = String(file.mimeType || "").startsWith("image/"); return <a key={String(file.id || index)} href={href} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-3 rounded-md border p-3 hover:bg-muted/40">{image ? <img src={href} alt={String(file.name || "Return evidence")} className="size-16 shrink-0 rounded object-cover" /> : <span className="grid size-16 shrink-0 place-items-center rounded bg-muted"><FileText className="size-6" /></span>}<span className="min-w-0"><span className="block truncate font-medium">{String(file.name || "Evidence")}</span><span className="block text-xs text-muted-foreground">{String(file.mimeType || "Attachment")} / {dateLabel(String(file.uploadedAt || ""))}</span></span></a> })}</div> : <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">No evidence is attached to this RMA.</p>}</CardContent></Card></TabsContent>
      <TabsContent value="transactions" className="pt-4"><Card><CardContent className="p-4"><OrderReturnDetails record={record} trackingUrl={trackingUrlForShipment} defaultTab="transactions" /></CardContent></Card></TabsContent>
      <TabsContent value="activity" className="grid gap-3 pt-4">{activity.map((entry, index) => <Card key={String(entry.id || index)}><CardContent className="flex flex-wrap items-start justify-between gap-3 p-4 text-sm"><div><p className="font-medium">{String(entry.title)}</p><p className="mt-1 text-muted-foreground">{String(entry.message || "")}</p>{Boolean(entry.user) && <p className="mt-1 text-xs text-muted-foreground">By {String(entry.user)}</p>}</div><span className="text-xs text-muted-foreground">{dateLabel(String(entry.createdAt || ""))}</span></CardContent></Card>)}{!activity.length && <Card><CardContent className="p-5 text-sm text-muted-foreground">No RMA activity has been recorded.</CardContent></Card>}</TabsContent>
    </Tabs>
  </div>
}


function OrderDetailWorkspace() {
  const fulfillmentCarriers = useFulfillmentCarriers()
  const orderId = decodeURIComponent((window.location.pathname.split("/")[2] || "").trim())
  const [order, setOrder] = useState<Record<string, unknown> | null>(null)
  const [warehouses, setWarehouses] = useState<Array<Record<string, unknown>>>([])
  const [fulfillmentSettings, setFulfillmentSettings] = useState<Record<string, unknown>>({})
  const [customerSummary, setCustomerSummary] = useState<Record<string, unknown>>({})
  const [relatedReturns, setRelatedReturns] = useState<Array<Record<string, unknown>>>([])
  const initialDetailTab = new URLSearchParams(window.location.search).get("tab") || "notes"
  const [detailTab, setDetailTab] = useState(["returns", "transactions"].includes(initialDetailTab) ? initialDetailTab : "notes")
  const [loading, setLoading] = useState(true)
  const [fulfillOpen, setFulfillOpen] = useState(false)
  const [labelWorkflow, setLabelWorkflow] = useState(false)
  const [shippingLabelOpen, setShippingLabelOpen] = useState(false)
  const [trackingEditOpen, setTrackingEditOpen] = useState(false)
  const [trackingEditShipment, setTrackingEditShipment] = useState<Record<string, unknown> | null>(null)
  const [trackingEditDraft, setTrackingEditDraft] = useState({ carrier: "UPS", carrierName: "UPS", service: "", trackingNumber: "", trackingUrl: "", carrierPhone: "", shippingCost: "" })
  const [skuEditLine, setSkuEditLine] = useState<{ line: Record<string, unknown>; index: number } | null>(null)
  const [skuEditValue, setSkuEditValue] = useState("")
  const [skuEditReason, setSkuEditReason] = useState("")
  const [skuEditResults, setSkuEditResults] = useState<Array<Record<string, unknown>>>([])
  const [skuEditSearching, setSkuEditSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [warehouseId, setWarehouseId] = useState("")
  const [carrier, setCarrier] = useState("UPS")
  const [carrierName, setCarrierName] = useState("UPS")
  const [service, setService] = useState("")
  const [trackingNumber, setTrackingNumber] = useState("")
  const [trackingUrl, setTrackingUrl] = useState("")
  const [carrierPhone, setCarrierPhone] = useState("")
  const [shipDate, setShipDate] = useState(new Date().toISOString().slice(0, 10))
  const [shippingCost, setShippingCost] = useState("")
  const [packageWeight, setPackageWeight] = useState("")
  const [packageLength, setPackageLength] = useState("")
  const [packageWidth, setPackageWidth] = useState("")
  const [packageHeight, setPackageHeight] = useState("")
  const [notifyCustomer, setNotifyCustomer] = useState(false)
  const [lineQty, setLineQty] = useState<Record<number, number>>({})
  const [restoreDismissal, setRestoreDismissal] = useState<Record<string, unknown> | null>(null)
  const [restoreMode, setRestoreMode] = useState("new_po")
  const [restorePoReference, setRestorePoReference] = useState("")
  const [walmartCancelOpen, setWalmartCancelOpen] = useState(false)
  const [walmartCancelLoading, setWalmartCancelLoading] = useState(false)
  const [walmartCancelPlan, setWalmartCancelPlan] = useState<Record<string, unknown> | null>(null)
  const [walmartCancelReview, setWalmartCancelReview] = useState<Record<string, unknown> | null>(null)
  const [walmartCancelReason, setWalmartCancelReason] = useState("CUSTOMER_REQUESTED_SELLER_TO_CANCEL")
  const [walmartCancelQuantities, setWalmartCancelQuantities] = useState<Record<string, number>>({})
  const createPurchaseOrdersRequestIdRef = useRef("")
  const restorePurchaseDemandRequestIdRef = useRef("")
  const openSkuEditor = (line: Record<string, unknown>, index: number) => {
    setSkuEditLine({ line, index })
    setSkuEditValue(String(line.sku || ""))
    setSkuEditReason("")
    setSkuEditResults([])
  }
  const saveSkuCorrection = async () => {
    if (!skuEditLine || !skuEditValue.trim() || !skuEditReason.trim()) return
    setSaving(true)
    try {
      const result = await api<{ message?: string }>(`/api/orders/${encodeURIComponent(orderId)}/items/${skuEditLine.index}/sku`, {
        method: "PATCH",
        body: JSON.stringify({ sku: skuEditValue.trim(), reason: skuEditReason.trim() || "Manual SKU correction from order detail" }),
      })
      setSkuEditLine(null)
      await load()
      toast.success(result.message || "Order SKU updated.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update the order SKU.")
    } finally {
      setSaving(false)
    }
  }
  async function load() {
    setLoading(true)
    try {
      const result = await api<{ order?: Record<string, unknown>; warehouses?: Array<Record<string, unknown>>; fulfillmentSettings?: Record<string, unknown>; customerSummary?: Record<string, unknown>; relatedReturns?: Array<Record<string, unknown>> }>(`/api/orders/${encodeURIComponent(orderId)}`)
      const nextOrder = result.order || null
      setOrder(nextOrder)
      if (nextOrder) {
        const canonicalKey = orderUrlKey(nextOrder)
        if (canonicalKey && canonicalKey !== orderId) window.history.replaceState({}, "", orderHref(nextOrder) + window.location.search)
      }
      setWarehouses(result.warehouses || [])
      setFulfillmentSettings(result.fulfillmentSettings || {})
      setCustomerSummary(result.customerSummary || {})
      setRelatedReturns(result.relatedReturns || [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load order.")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    const query = skuEditValue.trim()
    if (!skuEditLine || query.length < 2) {
      setSkuEditResults([])
      setSkuEditSearching(false)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setSkuEditSearching(true)
      api<{ inventory?: Array<Record<string, unknown>> }>(`/api/inventory?q=${encodeURIComponent(query)}&limit=8&fastPage=1`)
        .then((result) => { if (!cancelled) setSkuEditResults(result.inventory || []) })
        .catch(() => { if (!cancelled) setSkuEditResults([]) })
        .finally(() => { if (!cancelled) setSkuEditSearching(false) })
    }, 180)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [skuEditValue, skuEditLine])
  async function refreshOrder() {
    if (!isWalmartOrder) return load()
    setLoading(true)
    try {
      const result = await api<{ order?: Record<string, unknown>; message?: string }>(`/api/walmart/orders/${encodeURIComponent(String(order?.id || orderId))}/refresh`, { method: "POST" })
      if (result.order) setOrder(result.order)
      await load()
      toast.success(result.message || "Walmart order status and tracking refreshed.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to refresh this order from Walmart.")
    } finally {
      setLoading(false)
    }
  }
  async function openWalmartCancellation() {
    setWalmartCancelOpen(true)
    setWalmartCancelLoading(true)
    setWalmartCancelPlan(null)
    setWalmartCancelReview(null)
    try {
      const result = await api<Record<string, unknown>>("/api/walmart/orders/cancel/preview", { method: "POST", body: JSON.stringify({ orderId: String(order?.id || orderId) }) })
      setWalmartCancelPlan(result)
      setWalmartCancelQuantities({})
    } catch (error) {
      setWalmartCancelOpen(false)
      toast.error(error instanceof Error ? error.message : "Unable to load cancellable Walmart lines.")
    } finally { setWalmartCancelLoading(false) }
  }
  async function reviewWalmartCancellation() {
    const selected = ((walmartCancelPlan?.availableLines || []) as Array<Record<string, unknown>>).map(line => ({ lineNumber: String(line.lineNumber || ""), quantity: Number(walmartCancelQuantities[String(line.lineNumber || "")] || 0) })).filter(line => line.quantity > 0)
    if (!selected.length) return toast.error("Choose at least one Walmart line quantity to cancel.")
    setWalmartCancelLoading(true)
    try {
      const result = await api<Record<string, unknown>>("/api/walmart/orders/cancel/preview", { method: "POST", body: JSON.stringify({ orderId: String(order?.id || orderId), reason: walmartCancelReason, lines: selected }) })
      setWalmartCancelReview(result)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to review the Walmart cancellation.") }
    finally { setWalmartCancelLoading(false) }
  }
  async function applyWalmartCancellation() {
    if (!walmartCancelReview?.token) return
    setWalmartCancelLoading(true)
    try {
      const result = await api<{ order?: Record<string, unknown>; message?: string }>("/api/walmart/orders/cancel/apply", { method: "POST", body: JSON.stringify({ token: walmartCancelReview.token }) })
      if (result.order) setOrder(result.order)
      setWalmartCancelOpen(false)
      setWalmartCancelReview(null)
      await load()
      toast.success(result.message || "Walmart cancellation submitted.")
      window.dispatchEvent(new CustomEvent("dataplus:order-updated"))
    } catch (error) { toast.error(error instanceof Error ? error.message : "Walmart cancellation could not be confirmed. Refresh the order before retrying.") }
    finally { setWalmartCancelLoading(false) }
  }
  useEffect(() => { void load() }, [orderId])
  useEffect(() => { const refresh = () => void load(); window.addEventListener("dataplus:order-updated", refresh); return () => window.removeEventListener("dataplus:order-updated", refresh) }, [orderId])
  const lines = Array.isArray(order?.items) ? order.items as Array<Record<string, unknown>> : []
  const fulfilled = Array.isArray(order?.fulfillmentLines) ? order.fulfillmentLines as Array<Record<string, unknown>> : []
  const shipments = Array.isArray(order?.shipments) ? order.shipments as Array<Record<string, unknown>> : []
  const payments = Array.isArray(order?.payments) ? order.payments as Array<Record<string, unknown>> : []
  const events = Array.isArray(order?.workflowHistory) ? order.workflowHistory as Array<Record<string, unknown>> : []
  const timelineEvents = Array.isArray(order?.timeline) ? order.timeline as Array<Record<string, unknown>> : []
  const documents = Array.isArray(order?.documents) ? order.documents as Array<Record<string, unknown>> : []
  const orderNotes = Array.isArray(order?.orderNotes) ? order.orderNotes as Array<Record<string, unknown>> : []
  const shippingActivity = Array.isArray(order?.shippingRateActivity) ? order.shippingRateActivity as Array<Record<string, unknown>> : []
  const purchaseOrderIds = Array.isArray(order?.purchaseOrderIds) ? order.purchaseOrderIds.map(String) : []
  const purchaseOrderNumbers = Array.isArray(order?.purchaseOrderNumbers) ? order.purchaseOrderNumbers.map(String) : []
  const linkedPurchaseOrders = Array.isArray(order?.linkedPurchaseOrders) ? order.linkedPurchaseOrders as Array<Record<string, unknown>> : []
  const fulfillmentRoutes = Array.isArray(order?.fulfillmentRoutes) ? order.fulfillmentRoutes as Array<Record<string, unknown>> : []
  const savedPurchaseDismissals = (Array.isArray(order?.purchaseDemandDismissals) ? order.purchaseDemandDismissals as Array<Record<string, unknown>> : []).filter((entry) => entry.active !== false)
  const savedDismissalIds = new Set(savedPurchaseDismissals.map((entry) => String(entry.id || "")))
  const activePurchaseDismissals = [
    ...savedPurchaseDismissals,
    ...fulfillmentRoutes.filter((route) => String(route.status || "").toLowerCase() === "closed" && String(route.resolutionCode || "").toLowerCase() === "purchasing_dismissed" && !route.dismissalRestoredAt && !savedDismissalIds.has(String(route.purchasingDismissalId || route.id || ""))).map((route) => ({
      id: String(route.purchasingDismissalId || route.id || ""), lineIndex: route.lineIndex, sku: route.sku, title: route.title, qty: route.qty,
      vendorName: route.vendorName, reason: route.reviewReason, dismissedAt: route.resolvedAt, dismissedBy: route.resolvedBy
    }))
  ]
  const purchaseRoutes = fulfillmentRoutes.filter((route) => ["purchase", "drop_ship", "dropship", "supplier_dropship"].includes(String(route.type || "").toLowerCase()))
  const dropshipRoutes = fulfillmentRoutes.filter((route) => ["drop_ship", "dropship", "supplier_dropship"].includes(String(route.type || "").toLowerCase()) && Boolean(route.purchaseOrderId))
  const dropshipPurchaseOrderIds = [...new Set(dropshipRoutes.map((route) => String(route.purchaseOrderId || "")).filter(Boolean))]
  const supplierDropshipFulfillment = lines.length > 0 && dropshipPurchaseOrderIds.length === 1 && lines.every((line, index) => {
    const sku = String(line.sku || "").trim().toLowerCase()
    return dropshipRoutes.some((route) => Number(route.lineIndex ?? -1) === index || (sku && String(route.sku || "").trim().toLowerCase() === sku))
  })
  const supplierDropshipPurchaseOrder = linkedPurchaseOrders.find((purchaseOrder) => String(purchaseOrder.id || "") === dropshipPurchaseOrderIds[0])
  const hasPurchaseOrders = linkedPurchaseOrders.length > 0 || purchaseOrderIds.length > 0 || purchaseOrderNumbers.length > 0 || purchaseRoutes.some((route) => Boolean(route.purchaseOrderId))
  const shopifyAdminUrl = String(order?.shopifyAdminUrl || "")
  const orderReferences = Array.isArray(order?.marketplaceReferences) ? order.marketplaceReferences as Array<Record<string, unknown>> : []
  const isWalmartOrder = String(order?.source || order?.channelSource || "").trim().toLowerCase() === "walmart"
  const isEbayLive = isEbayLiveOrder(order)
  const liveEventIds = ebayLiveEventIds(order)
  const channelOrderNumber = order && !isWalmartOrder ? channelOrderNumberFor(order, orderReferences) : ""
  const walmartIdentifiers = order ? walmartOrderIdentifiers(order, orderReferences) : { purchaseOrderId: "", channelOrderId: "" }
  const channelOrderUrl = order ? channelOrderUrlFor(order, isWalmartOrder ? walmartIdentifiers.purchaseOrderId : channelOrderNumber, shopifyAdminUrl) : ""
  const pnl = (order?.profitLoss || {}) as Record<string, unknown>
  const trackingCarrierOptions = enabledCarrierNames(fulfillmentCarriers)
  const shipmentServiceOptions = enabledCarrierServices(fulfillmentCarriers, carrier, service)
  const trackingEditServiceOptions = enabledCarrierServices(fulfillmentCarriers, trackingEditDraft.carrier, trackingEditDraft.service)
  const openTrackingEditor = (shipment: Record<string, unknown>) => {
    const currentCarrier = shipmentDisplayValue(shipment, "carrierName", "carrier", "shippingCarrier", "shippingCompanyName")
    const matchedCarrier = trackingCarrierOptions.find((option) => option.toLowerCase() === currentCarrier.toLowerCase())
    const currentTracking = shipmentDisplayValue(shipment, "trackingNumber", "trackingNo", "trackingCode")
    const currentUrl = trackingUrlForShipment(shipment, currentCarrier, currentTracking)
    setTrackingEditShipment(shipment)
    setTrackingEditDraft({
      carrier: matchedCarrier || (currentCarrier ? "Other" : "UPS"),
      carrierName: currentCarrier || matchedCarrier || "UPS",
      service: shipmentDisplayValue(shipment, "service", "shippingService", "shipLogisticsType"),
      trackingNumber: currentTracking,
      trackingUrl: currentUrl,
      carrierPhone: String(shipment.carrierPhone || ""),
      shippingCost: Number(shipment.shippingCost || 0) > 0 ? String(Number(shipment.shippingCost || 0)) : ""
    })
    setTrackingEditOpen(true)
  }
  const updateTrackingDraft = (field: keyof typeof trackingEditDraft, value: string) => {
    setTrackingEditDraft((draft) => {
      const next = { ...draft, [field]: value }
      if (field === "trackingNumber") {
        const detected = detectTrackingCarrier(value)
        if (detected && detected.toLowerCase() !== draft.carrier.toLowerCase() && trackingCarrierOptions.includes(detected)) {
          next.carrier = detected
          next.carrierName = detected
          next.service = ""
        }
      }
      if (field === "carrier" && value !== "Other") { next.carrierName = value; next.carrierPhone = ""; next.service = enabledCarrierServices(fulfillmentCarriers, value)[0] || "" }
      if (field === "carrier" && value === "Other") next.carrierName = ""
      if (field === "carrier" || field === "trackingNumber") next.trackingUrl = ""
      return next
    })
  }
  async function saveTrackingEdit() {
    if (!trackingEditShipment) return
    setSaving(true)
    try {
      const result = await api<{ order?: Record<string, unknown>; message?: string }>(`/api/orders/${encodeURIComponent(orderId)}/shipments/${encodeURIComponent(String(trackingEditShipment.id || ""))}/tracking`, {
        method: "PATCH",
        body: JSON.stringify({ ...trackingEditDraft, shippingCost: trackingEditDraft.shippingCost ? Number(trackingEditDraft.shippingCost) : undefined, user: "Luis" })
      })
      setOrder(result.order || order)
      setTrackingEditOpen(false)
      toast.success(result.message || "Tracking updated.")
      window.dispatchEvent(new CustomEvent("dataplus:order-updated"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update tracking.")
    } finally {
      setSaving(false)
    }
  }
  async function unshipShipment(shipment: Record<string, unknown>) {
    const reason = window.prompt("Why are you reopening this shipment?", "Reopen fulfillment so this order can be shipped in DataPlus")
    if (reason === null) return
    setSaving(true)
    try {
      const result = await api<{ order?: Record<string, unknown>; message?: string }>(`/api/orders/${encodeURIComponent(orderId)}/shipments/${encodeURIComponent(String(shipment.id || ""))}/unship`, { method: "POST", body: JSON.stringify({ reason, user: "Luis" }) })
      setOrder(result.order || order)
      toast.success(result.message || "Shipment reopened.")
      window.dispatchEvent(new CustomEvent("dataplus:order-updated"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to reopen this shipment.")
    } finally {
      setSaving(false)
    }
  }
  const trackingEditHistory = Array.isArray(trackingEditShipment?.trackingHistory) ? trackingEditShipment.trackingHistory as Array<Record<string, unknown>> : []
  const vendorHrefForOrderLine = (line: Record<string, unknown>, index: number) => {
    const local = (line.localProduct || {}) as Record<string, unknown>
    const directVendorId = String(line.vendorId || line.supplierId || local.vendorId || local.supplierId || "").trim()
    if (directVendorId) return `/vendors/${encodeURIComponent(directVendorId)}`
    const lineSku = String(line.sku || "").trim().toLowerCase()
    const route = purchaseRoutes.find((candidate) => Number(candidate.lineIndex ?? -1) === index)
      || purchaseRoutes.find((candidate) => lineSku && String(candidate.sku || "").trim().toLowerCase() === lineSku)
    const routeVendorId = String(route?.vendorId || route?.supplierId || "").trim()
    return routeVendorId ? `/vendors/${encodeURIComponent(routeVendorId)}` : ""
  }
  const remaining = (line: Record<string, unknown>, index: number) => {
    const shipped = fulfilled.find((entry) => Number(entry.lineIndex || 0) === index && String(entry.sku || "").toLowerCase() === String(line.sku || "").toLowerCase())
    const quantity = Number(line.qty || 0)
    const lineRemaining = Number(line.remainingQty ?? line.remainingQuantity ?? line.unfulfilledQuantity)
    if (Number.isFinite(lineRemaining) && lineRemaining >= 0) return Math.min(quantity, lineRemaining)
    const lineFulfilled = Number(line.fulfilledQty ?? line.fulfilledQuantity ?? 0)
    const lineStatus = String(line.fulfillmentStatus || line.status || "").toLowerCase()
    if (["fulfilled", "shipped", "completed", "complete", "done", "closed"].some((status) => lineStatus.includes(status))) return 0
    return Math.max(0, quantity - Math.max(Number(shipped?.qtyFulfilled || 0), lineFulfilled))
  }
  const shipmentPackageDefaults = (quantities: Record<number, number>) => {
    return fulfillmentPackageDefaults(lines, (_line, index) => Number(quantities[index] || 0))
  }
  const applyShipmentPackageDefaults = (quantities: Record<number, number>) => {
    const defaults = shipmentPackageDefaults(quantities)
    setPackageWeight(defaults.weight)
    setPackageLength(defaults.length)
    setPackageWidth(defaults.width)
    setPackageHeight(defaults.height)
  }
  const openFulfill = (allRemaining = true) => {
    const quantities = Object.fromEntries(lines.map((line, index) => [index, allRemaining ? remaining(line, index) : 0]))
    setLabelWorkflow(false)
    setWarehouseId(String(order?.fulfillmentWarehouseId || warehouses[0]?.id || ""))
    setService(enabledCarrierServices(fulfillmentCarriers, carrier)[0] || "")
    setShippingCost("")
    applyShipmentPackageDefaults(quantities)
    setNotifyCustomer(false)
    setLineQty(quantities)
    setFulfillOpen(true)
  }
  const updateShipmentQuantity = (index: number, value: number) => {
    const quantity = Math.max(0, Math.min(remaining(lines[index], index), value))
    const quantities = { ...lineQty, [index]: quantity }
    setLineQty(quantities)
    applyShipmentPackageDefaults(quantities)
  }
  useEffect(() => {
    const handleDetailAction = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action
      if (action === "fulfill-all") openFulfill(true)
      if (action === "fulfill-partial") openFulfill(false)
      if (action === "create-rma") {
        setDetailTab("returns")
        window.setTimeout(() => window.dispatchEvent(new CustomEvent("dataplus:order-create-rma")), 0)
      }
    }
    window.addEventListener("dataplus:order-detail-action", handleDetailAction)
    return () => window.removeEventListener("dataplus:order-detail-action", handleDetailAction)
  }, [order, warehouses, lines])
  async function saveFulfillment() {
    const selectedLines = lines.map((line, index) => ({ sku: String(line.sku || ""), lineIndex: index, qty: Number(lineQty[index] || 0) })).filter((line) => line.sku && line.qty > 0)
    if (!selectedLines.length) return toast.error("Choose at least one quantity to ship.")
    setSaving(true)
    try {
      const result = await api<{ order?: Record<string, unknown>; message?: string; inventoryAdjusted?: boolean }>(`/api/orders/${encodeURIComponent(orderId)}/fulfill`, { method: "POST", body: JSON.stringify({ warehouseId, carrier, carrierName, service, trackingNumber, trackingUrl, carrierPhone, shipDate, shippingCost: Number(shippingCost || 0), packageWeight: Number(packageWeight || 0), packageLength: Number(packageLength || 0), packageWidth: Number(packageWidth || 0), packageHeight: Number(packageHeight || 0), notifyCustomer, lines: selectedLines }) })
      setOrder(result.order || order)
      setFulfillOpen(false)
      toast.success(result.message || (result.inventoryAdjusted === false ? "Supplier tracking recorded. Physical inventory was not changed." : "Shipment recorded and local inventory updated."))
      window.dispatchEvent(new CustomEvent("dataplus:order-updated"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to record shipment.")
    } finally {
      setSaving(false)
    }
  }
  async function runOrderAction(action: string, body: Record<string, unknown> = {}) {
    setSaving(true)
    try {
      const path = action === "sync-address"
        ? `/api/orders/${encodeURIComponent(String(order?.id || orderId))}/sync-shopify-address`
        : `/api/orders/${encodeURIComponent(String(order?.id || orderId))}/action`
      const result = await api<{ order?: Record<string, unknown>; message?: string }>(path, { method: "POST", body: JSON.stringify(action === "sync-address" ? body : { action, ...body }) })
      setOrder(result.order || order)
      toast.success(result.message || `Order ${action} completed.`)
      window.dispatchEvent(new CustomEvent("dataplus:order-updated"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Order action failed.")
    } finally {
      setSaving(false)
    }
  }
  async function createPurchaseOrders() {
    setSaving(true)
    const requestId = createPurchaseOrdersRequestIdRef.current || crypto.randomUUID()
    createPurchaseOrdersRequestIdRef.current = requestId
    try {
      const result = await api<{ orders?: Array<Record<string, unknown>>; message?: string }>(`/api/orders/${encodeURIComponent(String(order?.id || orderId))}/purchase-orders`, { method: "POST", body: JSON.stringify({ requestId, user: "Luis" }) })
      const updated = (result.orders || []).find((candidate) => String(candidate.id || "") === String(order?.id || orderId))
      setOrder(updated || order)
      createPurchaseOrdersRequestIdRef.current = ""
      await load()
      toast.success(result.message || "Supplier purchase order created.")
      window.dispatchEvent(new CustomEvent("dataplus:order-updated"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to create supplier purchase order.")
    } finally {
      setSaving(false)
    }
  }
  async function restoreDismissedPurchaseDemand() {
    if (!restoreDismissal) return
    if (restoreMode === "existing_po" && !restorePoReference.trim()) return toast.error("Enter the existing PO number.")
    setSaving(true)
    const requestId = restorePurchaseDemandRequestIdRef.current || crypto.randomUUID()
    restorePurchaseDemandRequestIdRef.current = requestId
    try {
      const result = await api<{ order?: Record<string, unknown>; message?: string }>(`/api/orders/${encodeURIComponent(String(order?.id || orderId))}/purchasing-dismissals/${encodeURIComponent(String(restoreDismissal.id || ""))}/restore`, {
        method: "POST",
        body: JSON.stringify({ requestId, mode: restoreMode, purchaseOrderId: restorePoReference.trim(), user: "Luis" })
      })
      setOrder(result.order || order)
      restorePurchaseDemandRequestIdRef.current = ""
      setRestoreDismissal(null)
      setRestorePoReference("")
      toast.success(result.message || "Dismissed item restored to purchasing.")
      await load()
      window.dispatchEvent(new CustomEvent("dataplus:order-updated"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to restore the dismissed item.")
    } finally {
      setSaving(false)
    }
  }
  async function refreshRouting() {
    const exceptions = Array.isArray(order?.workflowExceptions) ? order.workflowExceptions as Array<Record<string, unknown>> : []
    const inventoryReviewed = exceptions.some((entry) => entry.type === "shipment_inventory_review" && entry.status !== "resolved")
    const reason = inventoryReviewed ? window.prompt("Record your inventory review for the reopened shipment. Receive or adjust physical stock first if needed; routing will use current availability.") : ""
    if (inventoryReviewed && !reason?.trim()) return
    setSaving(true)
    try {
      const result = await api<{ order?: Record<string, unknown>; message?: string }>(`/api/orders/${encodeURIComponent(String(order?.id || orderId))}/route`, { method: "POST", body: JSON.stringify({ force: true, inventoryReviewed, reason }) })
      setOrder(result.order || order)
      await load()
      toast.success(result.message || "Order routing refreshed.")
      window.dispatchEvent(new CustomEvent("dataplus:order-updated"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to refresh order routing.")
    } finally {
      setSaving(false)
    }
  }
  async function syncShipmentToChannel(shipment: Record<string, unknown>) {
    setSaving(true)
    try {
      const result = await api<{ message?: string }>(`/api/orders/${encodeURIComponent(orderId)}/shipments/${encodeURIComponent(String(shipment.id || ""))}/sync-channel`, { method: "POST" })
      await load()
      toast.success(result.message || "Shipment sync updated.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to send tracking to this channel.")
    } finally {
      setSaving(false)
    }
  }
  async function recordLabelRefund(shipment: Record<string, unknown>) {
    const amount = window.prompt("Confirmed label refund amount (total credited so far)", String(shipment.shippingCost || ""))
    if (amount === null) return
    const reference = window.prompt("Provider credit reference confirming the refund was received")
    if (!reference?.trim()) return
    setSaving(true)
    try {
      const result = await api<{ order?: Record<string, unknown>; message?: string }>(`/api/orders/${encodeURIComponent(orderId)}/shipments/${encodeURIComponent(String(shipment.id || ""))}/label-refund`, { method: "POST", body: JSON.stringify({ amount: Number(amount), reference }) })
      setOrder(result.order || order)
      toast.success(result.message || "Label refund recorded.")
      window.dispatchEvent(new CustomEvent("dataplus:order-updated"))
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to record refund.") }
    finally { setSaving(false) }
  }
  async function voidShipmentLabel(shipment: Record<string, unknown>) {
    const reason = window.prompt("Reason for voiding this label?", "Operator requested void")
    if (reason === null) return
    setSaving(true)
    try {
      const result = await api<{ message?: string }>(`/api/orders/${encodeURIComponent(orderId)}/shipments/${encodeURIComponent(String(shipment.id || ""))}/void`, { method: "POST", body: JSON.stringify({ reason }) })
      await load()
      toast.success(result.message || "Label void request recorded.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to void this label.")
    } finally {
      setSaving(false)
    }
  }
  async function fulfillPurchasedShipment(shipment: Record<string, unknown>) {
    const packageInfo = (Array.isArray(shipment.packages) ? shipment.packages[0] : {}) as Record<string, unknown>
    const shipmentLines = (Array.isArray(shipment.lines) ? shipment.lines : []) as Array<Record<string, unknown>>
    const requestedLines = shipmentLines.map((line) => ({ sku: String(line.sku || ""), lineIndex: Number(line.lineIndex || 0), qty: Math.max(0, Number(line.qtyAllocated || 0) - Number(line.qtyFulfilled || 0)) })).filter((line) => line.sku && line.qty > 0)
    if (!requestedLines.length) return toast.error("This labeled shipment has no remaining items to fulfill.")
    setSaving(true)
    try {
      const result = await api<{ message?: string }>(`/api/orders/${encodeURIComponent(orderId)}/fulfill`, { method: "POST", body: JSON.stringify({ shipmentId: String(shipment.id || ""), warehouseId: String(shipment.warehouseId || ""), carrier: String(shipment.carrier || "Shopify Shipping"), carrierName: String(shipment.carrierName || shipment.carrier || "Shopify Shipping"), service: String(shipment.service || "Shopify Shipping"), trackingNumber: String(shipment.trackingNumber || ""), trackingUrl: String(shipment.trackingUrl || ""), shipDate: String(shipment.shipDate || new Date().toISOString().slice(0, 10)), shippingCost: 0, packageWeight: Number(packageInfo.weight || 0), packageLength: Number(packageInfo.length || 0), packageWidth: Number(packageInfo.width || 0), packageHeight: Number(packageInfo.height || 0), notifyCustomer: Boolean(shipment.notifyCustomer), lines: requestedLines }) })
      await load()
      toast.success(result.message || "Shipment fulfilled and inventory updated.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to fulfill this labeled shipment.")
    } finally {
      setSaving(false)
    }
  }
  if (loading) return <div className="grid gap-4"><Skeleton className="h-24" /><Skeleton className="h-44" /><Skeleton className="h-72" /></div>
  if (!order) return <Card><CardContent className="p-8 text-center text-muted-foreground">This order was not found.</CardContent></Card>
  const routingState = getOrderRoutingState(order)
  const attentionItems = orderAttentionItems(order)
  const operationalState = String(order.operationalStatus || order.workflowStatus || "").trim()
  const operationalStateLower = operationalState.toLowerCase()
  const operationalStateVariant = operationalStateLower === "completed" ? "success" : ["on_hold", "pending_payment"].includes(operationalStateLower) ? "warning" : operationalStateLower === "canceled" ? "destructive" : "outline"
  const hasRemainingFulfillment = lines.some((line, index) => remaining(line, index) > 0)
  const walmartExternal = (order.external || {}) as Record<string, unknown>
  const walmartCancellationRequest = (walmartExternal.walmartCancellationRequest || {}) as Record<string, unknown>
  const walmartCancellationStatus = String(walmartCancellationRequest.status || "").toLowerCase()
  const walmartCancellationEvent = String(walmartCancellationRequest.subEventType || walmartCancellationRequest.eventType || "").toUpperCase()
  const unshippableShipments = shipments.filter((shipment) => ["fulfilled", "shipped", "delivered"].includes(String(shipment.status || "").toLowerCase()))
  const activeTrackedShipments = shipments.filter((shipment) => {
    const status = String(shipment.status || "").toLowerCase()
    const voidStatus = String(shipment.voidStatus || "").toLowerCase()
    return Boolean(String(shipment.trackingNumber || "").trim()) && !["voided", "canceled", "cancelled", "superseded"].includes(status) && voidStatus !== "voided"
  })
  const hasMultipleActiveLabels = new Set(activeTrackedShipments.map((shipment) => String(shipment.trackingNumber || "").trim())).size > 1
  const movingTrackingNumbers = new Set(activeTrackedShipments.filter((shipment) => {
    const carrierStatus = String(shipment.trackingStatus || shipment.carrierStatus || "").toLowerCase()
    const shipmentStatus = String(shipment.status || "").toLowerCase()
    return ["accepted", "in_transit", "out_for_delivery", "delivered"].includes(carrierStatus) || ["in_transit", "shipped", "fulfilled", "delivered"].includes(shipmentStatus)
  }).map((shipment) => String(shipment.trackingNumber || "").trim()))
  const savedShippingRate = orderFulfillmentRateReview(order)
  const selectedShippingRate = savedShippingRate.review?.selectedRate && typeof savedShippingRate.review.selectedRate === "object" ? savedShippingRate.review.selectedRate as Record<string, unknown> : null
  const selectedShippingRateLabel = selectedShippingRate ? `${String(selectedShippingRate.carrier || selectedShippingRate.provider || "Carrier")} ${String(selectedShippingRate.service || "Shipping")}`.trim() : ""
  const fulfillmentWorkspace = <Card className="h-full"><CardHeader className="gap-3 border-b"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{String(order.fulfillmentWarehouseName || "Staten Island warehouse")}</Badge><Tooltip><TooltipTrigger asChild><Badge variant={String(order.fulfillmentStatus || order.status || "").toLowerCase().includes("fulfill") ? "default" : "secondary"}>{String(order.fulfillmentStatus || order.status || "Unfulfilled")}</Badge></TooltipTrigger><TooltipContent>Order-level fulfillment status. Each line below shows its own remaining quantity.</TooltipContent></Tooltip></div><div className="rounded-md border bg-muted/20 p-3 text-sm"><p className="font-medium">{String(order.shippingService || "Shipping service will be selected with the label")}</p><p className="mt-1 text-muted-foreground">{String(order.shippingAddressLabel || "Delivery address")}</p></div></CardHeader><CardContent className="grid gap-3 p-3"><OrderFulfillmentItemRows lines={lines} shipments={shipments} remaining={remaining} onEditTracking={openTrackingEditor} onEditSku={openSkuEditor} vendorHrefForLine={vendorHrefForOrderLine} />{hasRemainingFulfillment ? <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3"><Button size="sm" variant="outline" onClick={() => openFulfill(true)}>Mark as fulfilled</Button>{selectedShippingRate ? <div className="mr-1 min-w-0 text-right"><p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">{moneyLabel(Number(selectedShippingRate.amount || 0))}</p><p className="max-w-56 truncate text-xs text-muted-foreground" title={selectedShippingRateLabel}>{selectedShippingRateLabel}</p></div> : null}<Button size="sm" disabled={saving} onClick={() => setShippingLabelOpen(true)}><Truck className="size-4" /> Print shipping label</Button></div> : <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3 text-sm text-muted-foreground"><CheckCircle2 className="size-4 text-emerald-600" /><span>All lines are shipped.</span></div>}</CardContent></Card>
  const orderContext = <div className="grid content-start gap-4">
    <OrderCustomerInformationCard order={order} collapsible />
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Payment</CardTitle></CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <div className="flex justify-between"><span>Items</span><span>{moneyLabel(Number(pnl.itemRevenue || order.subtotal || order.total || 0))}</span></div>
        <div className="flex justify-between"><span>Customer shipping</span><span>{moneyLabel(Number(pnl.shippingCollected || order.shippingPaid || 0))}</span></div>
        {Number(order.shippingCost || 0) > 0 && <div className="flex justify-between text-muted-foreground"><span>Label cost</span><span>{moneyLabel(Number(order.shippingCost || 0))}</span></div>}
        <div className="flex justify-between border-t pt-2 font-medium"><span>Revenue total</span><span>{moneyLabel(Number(order.total || 0))}</span></div>
        <div className="flex justify-between text-sm font-medium"><span>Est. profit</span><span className={Number(pnl.grossProfit || 0) < 0 ? "text-destructive" : ""}>{moneyLabel(Number(pnl.grossProfit || 0))}</span></div>
      </CardContent>
    </Card>
  </div>
  return <div className="grid gap-5">
    <PageHeader eyebrow="Operations / Order" title={String(order.orderNumber || orderId)} description={`${String(order.source || "Order")}${isEbayLive ? " / eBay Live sale" : ` / ${String(order.channelSource || "Unclassified sales channel")}`}${!isWalmartOrder && channelOrderNumber ? ` / Channel order ${channelOrderNumber}` : ""}`} action={<div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" asChild><a href="/orders">Back to orders</a></Button>{isWalmartOrder && hasRemainingFulfillment && <Button size="sm" variant="outline" disabled={saving || loading} onClick={() => void openWalmartCancellation()}><Ban className="size-4" /> Cancel Walmart lines</Button>}<OrderActionsMenu order={order} busy={saving || loading} onAction={runOrderAction} onRefresh={() => void refreshOrder()} onRefreshRouting={() => void refreshRouting()} onCreatePurchaseOrders={() => void createPurchaseOrders()} onPrintTemuLabel={() => setShippingLabelOpen(true)} unshippableShipments={unshippableShipments} onUnshipShipment={(shipment) => void unshipShipment(shipment)} /></div>} />
    {isEbayLive && <div className="flex flex-col gap-2 rounded-md border border-pink-500/40 bg-pink-500/5 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-center gap-2"><EbayLiveMark className="h-4 w-[46px]" /><div className="min-w-0"><p className="text-sm font-medium">eBay Live order</p><p className="text-xs text-muted-foreground">Sales channel: eBay</p></div></div><div className="flex min-w-0 flex-wrap items-center gap-1 text-xs"><span className="text-muted-foreground">{liveEventIds.length === 1 ? "Live event ID" : "Live event IDs"}</span>{liveEventIds.length ? liveEventIds.map((eventId) => <code key={eventId} className="max-w-full select-all break-all rounded bg-background px-1.5 py-0.5 font-mono text-foreground">{eventId}</code>) : <span className="text-amber-700 dark:text-amber-300">Not provided by eBay</span>}</div></div>}
    {isWalmartOrder && <TooltipProvider><div className="flex flex-wrap items-center gap-2 text-sm"><OrderChannelHeaderReferences order={order} references={orderReferences} href={channelOrderUrl} /></div></TooltipProvider>}
    {isWalmartOrder && walmartCancellationStatus === "pending" && <Alert className="border-amber-500/50 bg-amber-500/10"><AlertTriangle className="size-4" /><AlertTitle>Walmart cancellation requested</AlertTitle><AlertDescription className="flex flex-wrap items-center justify-between gap-3"><span>Walmart sent an intent-to-cancel event. Pause fulfillment, review the live line quantities, and confirm only the lines that should be canceled.</span><Button size="sm" variant="outline" disabled={saving || loading || !hasRemainingFulfillment} onClick={() => void openWalmartCancellation()}>Review cancellation</Button></AlertDescription></Alert>}
    {isWalmartOrder && walmartCancellationStatus === "canceled" && <Alert variant="destructive"><AlertTriangle className="size-4" /><AlertTitle>{walmartCancellationEvent === "FRAUD_CANCEL" ? "Walmart fraud cancellation" : "Walmart line auto-canceled"}</AlertTitle><AlertDescription>Walmart reported this cancellation event and DataPlus refreshed the order and fulfillment quantities. Do not ship canceled units.</AlertDescription></Alert>}
    <TooltipProvider><div className="flex flex-wrap items-center gap-2 text-sm">{isEbayLive ? <Tooltip><TooltipTrigger asChild><span className="inline-flex"><EbayLiveMark /></span></TooltipTrigger><TooltipContent>This order was identified by eBay as an eBay Live sale.</TooltipContent></Tooltip> : null}{channelOrderNumber && <Tooltip><TooltipTrigger asChild>{channelOrderUrl ? <a href={channelOrderUrl} target="_blank" rel="noreferrer"><Badge variant="outline" className="max-w-full cursor-pointer gap-1 font-mono text-xs hover:bg-muted"><span className="font-sans">Channel order</span> <span className="break-all">{channelOrderNumber}</span><ExternalLink className="size-3 shrink-0" /></Badge></a> : <Badge variant="outline" className="max-w-full gap-1 font-mono text-xs"><span className="font-sans">Channel order</span> <span className="break-all">{channelOrderNumber}</span></Badge>}</TooltipTrigger><TooltipContent>{channelOrderUrl ? `Open this order in ${String(order.source || "the sales channel")}.` : `Marketplace order number from ${String(order.source || "the sales channel")}.`}</TooltipContent></Tooltip>}<Tooltip><TooltipTrigger asChild><Badge variant="outline">{String(order.financialStatus || "Unpaid")}</Badge></TooltipTrigger><TooltipContent>Payment state reported by the sales channel.</TooltipContent></Tooltip>{operationalState && <Tooltip><TooltipTrigger asChild><Badge variant={operationalStateVariant}>{orderStateLabel(operationalState)}</Badge></TooltipTrigger><TooltipContent>DataPlus operational state for routing, fulfillment, and open work queues.</TooltipContent></Tooltip>}<Tooltip><TooltipTrigger asChild><Badge variant={String(order.fulfillmentStatus || order.status || "").toLowerCase().includes("fulfill") ? "default" : "secondary"}>{String(order.fulfillmentStatus || order.status || "Unfulfilled")}</Badge></TooltipTrigger><TooltipContent>Channel fulfillment status. Line-level status appears in the fulfillment workspace.</TooltipContent></Tooltip><Tooltip><TooltipTrigger asChild><Badge variant={routingState.needsRouting || routingState.needsReview ? "destructive" : routingState.hasActiveRoutes ? "secondary" : "outline"} className={routingState.hasActiveRoutes ? "gap-1 text-emerald-700 dark:text-emerald-400" : "gap-1"}>{routingState.needsRouting || routingState.needsReview ? <AlertCircle className="size-3.5" /> : routingState.hasActiveRoutes ? <CheckCircle2 className="size-3.5" /> : null}{routingState.label}</Badge></TooltipTrigger><TooltipContent>{routingState.detail}</TooltipContent></Tooltip><Tooltip><TooltipTrigger asChild><Badge variant={hasPurchaseOrders ? "secondary" : "outline"} className={hasPurchaseOrders ? "gap-1 text-emerald-700 dark:text-emerald-400" : "gap-1 text-muted-foreground"}>{hasPurchaseOrders ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />}{hasPurchaseOrders ? "Has PO" : "No PO"}</Badge></TooltipTrigger><TooltipContent>{hasPurchaseOrders ? "At least one supplier purchase order is linked to this order." : "No supplier purchase order is linked yet."}</TooltipContent></Tooltip><span className="text-muted-foreground">{dateLabel(String(order.createdAt || order.importedAt || ""))} from {String(order.channelSource || order.source || "channel")}</span></div></TooltipProvider>
    {attentionItems.length ? <Alert variant={orderHasBlockingException(order) ? "destructive" : "default"}><AlertTriangle className="size-4" /><AlertTitle>Needs attention</AlertTitle><AlertDescription><div className="mt-2 grid gap-2">{attentionItems.slice(0, 5).map((item) => <div key={item.id} className="rounded-md border bg-background/70 p-2"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{item.title}</span><Badge variant={["blocking", "error", "critical", "destructive", "exception", "buyer_review", "blocked"].includes(item.severity.toLowerCase()) ? "destructive" : "outline"}>{item.severity.replace(/_/g, " ")}</Badge></div><p className="mt-1 break-words text-sm text-muted-foreground">{item.detail}</p>{item.source ? <p className="mt-1 text-xs text-muted-foreground">Source: {item.source}</p> : null}</div>)}{attentionItems.length > 5 ? <p className="text-xs text-muted-foreground">Open the Operations tab to review all {numberLabel(attentionItems.length)} attention items.</p> : null}</div></AlertDescription></Alert> : null}
    <div className="grid gap-4 lg:hidden">{fulfillmentWorkspace}{orderContext}</div>
    <ResizablePanelGroup orientation="horizontal" className="hidden min-h-[360px] overflow-hidden rounded-lg border bg-card lg:flex"><ResizablePanel defaultSize={72} minSize={45}><ScrollArea className="h-[440px] p-3">{fulfillmentWorkspace}</ScrollArea></ResizablePanel><ResizableHandle withHandle /><ResizablePanel defaultSize={28} minSize={20}><ScrollArea className="h-[440px] p-3">{orderContext}</ScrollArea></ResizablePanel></ResizablePanelGroup>
    <div className="grid min-w-0 gap-4"><Tabs value={detailTab} onValueChange={setDetailTab}><TabsList className="flex flex-wrap justify-start gap-1 group-data-horizontal/tabs:h-auto [&>[role=tab]]:h-8"><TabsTrigger value="notes">Notes ({orderNotes.length})</TabsTrigger><TabsTrigger value="items">Profit &amp; Loss</TabsTrigger><TabsTrigger value="operations">Operations</TabsTrigger><TabsTrigger value="fulfillment">Fulfillment ({shipments.length})</TabsTrigger><TabsTrigger value="purchase-orders">POs ({Math.max(purchaseOrderIds.length, purchaseOrderNumbers.length)})</TabsTrigger><TabsTrigger value="finance">Finance</TabsTrigger><TabsTrigger value="transactions">Transactions</TabsTrigger><TabsTrigger value="customer">Customer</TabsTrigger><TabsTrigger value="returns">Returns ({relatedReturns.length})</TabsTrigger><TabsTrigger value="documents">Documents ({documents.length})</TabsTrigger><TabsTrigger value="channel">Channel</TabsTrigger><TabsTrigger value="activity">Activity ({Math.max(events.length, timelineEvents.length)})</TabsTrigger></TabsList>
      <OrderItemsProfitLoss lines={lines} pnl={pnl} />
      <TabsContent value="operations" className="pt-4"><OrderOperationsPanel orderId={orderId} order={order} onUpdated={load} /></TabsContent>
      <TabsContent value="fulfillment" className="grid gap-4 pt-4">
        <p className="text-sm text-muted-foreground">Choose a customer delivery option, then record or synchronize the fulfillment. Every shipment remains visible here with its package and channel-sync state.</p>
        {hasMultipleActiveLabels && <Alert className="border-amber-500/40 bg-amber-500/5"><AlertTriangle className="size-4" /><AlertTitle>Multiple active labels</AlertTitle><AlertDescription>Carrier movement identifies which tracking number was used. Review and void any unused purchased label before its refund window closes.</AlertDescription></Alert>}
        <FulfillmentStagePanel orderId={orderId} order={order} onUpdated={load} />
        <ShipmentGroupPanel orderId={orderId} order={order} onUpdated={load} />
        {shipments.length ? shipments.map((shipment) => {
          const shipmentPackage = (Array.isArray(shipment.packages) ? shipment.packages[0] || {} : {}) as Record<string, unknown>
          const channelSync = (shipment.channelSync || {}) as Record<string, unknown>
          const trackingUrl = String(shipment.trackingUrl || "")
          const channelMessage = String(channelSync.message || "")
          const channelSyncStatus = String(channelSync.status || "").toLowerCase()
          const canSyncChannel = ["fulfilled", "shipped", "delivered"].includes(String(shipment.status || "").toLowerCase()) && !["sent", "synced"].includes(channelSyncStatus)
          const documents = Array.isArray(shipment.documents) ? shipment.documents as Array<Record<string, unknown>> : []
          const awaitingFulfillment = String(shipment.status || "").toLowerCase() === "label_purchased"
          const voidStatus = String(shipment.voidStatus || "")
          const canVoid = ["label_purchased", "label_ready", "unshipped", "fulfilled", "shipped"].includes(String(shipment.status || "").toLowerCase()) && !["voided", "not_supported"].includes(voidStatus.toLowerCase())
          const trackingNumber = String(shipment.trackingNumber || "").trim()
          const labelUseState = !hasMultipleActiveLabels || !trackingNumber
            ? ""
            : movingTrackingNumbers.has(trackingNumber)
              ? "used"
              : movingTrackingNumbers.size
                ? "unused"
                : "undetermined"
          return <Card key={String(shipment.id)}><CardContent className="grid gap-3 p-4 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium">{String(shipment.reference || shipment.warehouseName || "Shipment")}</p><p className="text-xs text-muted-foreground">{String(shipment.warehouseName || "Warehouse")} / {String(shipment.status || "Shipment")}</p></div><div className="flex flex-wrap items-center gap-2">{labelUseState === "used" && <Badge variant="success">Used to ship</Badge>}{labelUseState === "unused" && <Badge variant="destructive">Unused label - void recommended</Badge>}{labelUseState === "undetermined" && <Badge variant="warning">Usage undetermined</Badge>}<Badge variant={awaitingFulfillment ? "secondary" : channelSyncStatus === "pending" ? "secondary" : "outline"}>{awaitingFulfillment ? "Label purchased" : String(channelSync.status || "Local only")}</Badge>{voidStatus && <Badge variant="outline">Void: {voidStatus.replace(/_/g, " ")}</Badge>}<Button size="sm" variant="outline" disabled={saving} onClick={() => openTrackingEditor(shipment)}><Pencil className="size-4" /> Edit tracking</Button>{awaitingFulfillment && <Button size="sm" disabled={saving} onClick={() => void fulfillPurchasedShipment(shipment)}>Mark fulfilled</Button>}{canSyncChannel && <Button size="sm" variant="outline" disabled={saving} onClick={() => void syncShipmentToChannel(shipment)}>Send tracking to channel</Button>}{Number(shipment.shippingCost || 0) > 0 && <Button size="sm" variant="outline" disabled={saving} onClick={() => void recordLabelRefund(shipment)}>Record label refund</Button>}{shipment.labelRefundStatus ? <Badge variant="outline">Refund: {String(shipment.labelRefundStatus)}</Badge> : null}{canVoid && <Button size="sm" variant="outline" disabled={saving} onClick={() => void voidShipmentLabel(shipment)}>Void label</Button>}</div></div><div className="grid gap-2 text-muted-foreground sm:grid-cols-2"><p>{String(shipment.carrierName || shipment.service || "Carrier")} / {String(shipment.service || "Service")}</p><p>{String(shipment.trackingNumber || "No tracking")}</p><p>{Number(shipment.shippingCost || 0) > 0 ? `Shipping cost ${moneyLabel(Number(shipment.shippingCost || 0))}` : "Shipping cost not recorded"}</p><p>{Number(shipmentPackage.weight || 0) > 0 ? `${Number(shipmentPackage.weight)} lb package` : "Package measurements not recorded"}</p></div><div className="flex flex-wrap gap-3">{trackingUrl && <a className="text-primary hover:underline" href={trackingUrl} target="_blank" rel="noreferrer">Track shipment</a>}{documents.map((document, index) => <a key={`${String(document.url)}-${index}`} className="text-primary hover:underline" href={String(document.url || "")} target="_blank" rel="noreferrer">Reprint {String(document.format || document.documentType || "label")}</a>)}</div>{channelMessage && <p className="text-xs text-muted-foreground">{channelMessage}</p>}</CardContent></Card>
        }) : <Card><CardContent className="p-5 text-sm text-muted-foreground">No shipments recorded yet.</CardContent></Card>}
        {shippingActivity.length > 0 && <Card><CardHeader><CardTitle className="text-sm">Shipping rater activity</CardTitle><CardDescription>Recent rate, label, and void events for this order.</CardDescription></CardHeader><CardContent className="grid gap-2">{shippingActivity.slice(0, 6).map((event) => <div key={String(event.id)} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"><div><p className="font-medium">{String(event.provider || "Shipping")} / {String(event.action || "activity")}</p><p className="text-xs text-muted-foreground">{String(event.message || "")}</p></div><div className="flex items-center gap-2"><Badge variant={String(event.status || "").toLowerCase().includes("fail") ? "destructive" : "outline"}>{String(event.status || "info")}</Badge><span className="text-xs text-muted-foreground">{dateLabel(String(event.createdAt || ""))}</span></div></div>)}</CardContent></Card>}
      </TabsContent>
      <TabsContent value="purchase-orders" className="grid gap-4 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><p className="font-medium">Supplier purchase orders</p><p className="text-sm text-muted-foreground">Purchase orders are split by supplier and remain linked to this customer order.</p></div>
          <Button size="sm" disabled={saving} onClick={() => void createPurchaseOrders()}><Boxes className="size-4" /> Create supplier PO(s)</Button>
        </div>
        {activePurchaseDismissals.length > 0 && <Card className="border-amber-500/40"><CardHeader className="pb-3"><CardTitle className="text-sm">Dismissed purchasing items</CardTitle><CardDescription>These lines stay out of automatic routing until a buyer explicitly restores them.</CardDescription></CardHeader><CardContent className="grid gap-2">{activePurchaseDismissals.map((dismissal) => <div key={String(dismissal.id)} className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/20 p-3 text-sm"><div className="min-w-0"><p className="font-medium">{String(dismissal.sku || "Unknown SKU")} <span className="font-normal text-muted-foreground">x {numberLabel(Number(dismissal.qty || 0))}</span></p><p className="truncate text-xs text-muted-foreground">{String(dismissal.title || dismissal.reason || "Dismissed from purchasing")}</p></div><Button size="sm" variant="outline" disabled={saving} onClick={() => { restorePurchaseDemandRequestIdRef.current = crypto.randomUUID(); setRestoreDismissal(dismissal); setRestoreMode("new_po"); setRestorePoReference("") }}><RotateCcw className="size-4" /> Restore</Button></div>)}</CardContent></Card>}
        {linkedPurchaseOrders.length ? <LinkedPurchaseOrdersTable purchaseOrders={linkedPurchaseOrders} /> : hasPurchaseOrders ? <Card><CardContent className="p-5 text-sm text-muted-foreground">The linked PO summaries are loading. Refresh the order to load their latest supplier, status, and receipt details.</CardContent></Card> : <Card><CardContent className="flex flex-wrap items-center justify-between gap-3 p-5 text-sm text-muted-foreground"><span>No purchase order is linked to this order.</span><Button size="sm" disabled={saving} onClick={() => void createPurchaseOrders()}>Create supplier PO(s)</Button></CardContent></Card>}
      </TabsContent>
      <TabsContent value="payments" className="grid gap-3 pt-4">{payments.length ? payments.map((payment) => <Card key={String(payment.id)}><CardContent className="flex items-center justify-between p-4 text-sm"><span>{String(payment.provider || "Payment")} / {moneyLabel(Number(payment.amount || 0))}</span><Badge>{String(payment.status || "-")}</Badge></CardContent></Card>) : <Card><CardContent className="p-5 text-sm text-muted-foreground">No payment events recorded.</CardContent></Card>}</TabsContent>
      <TabsContent value="transactions" className="min-w-0 pt-4"><OrderTransactions order={order} pnl={pnl} returns={relatedReturns} /></TabsContent>
      <TabsContent value="finance" className="grid gap-4 pt-4"><div><OrderLineActionPanel mode="refund" orderId={orderId} order={order} lines={lines} onUpdated={load} /></div><OrderFinancePanel orderId={orderId} order={order} lines={lines} onUpdated={load} /><ShopifyPaymentCapturePanel orderId={orderId} order={order} onUpdated={load} /><OrderRefundSyncPanel orderId={orderId} order={order} onUpdated={load} /></TabsContent>
      <TabsContent value="customer" className="grid gap-4 pt-4"><OrderCustomerPanel orderId={orderId} order={order} summary={customerSummary} onUpdated={load} /><CustomerNotificationPanel orderId={orderId} order={order} onUpdated={load} /></TabsContent>
      <TabsContent value="notes" className="pt-4"><OrderNotesPanel orderId={orderId} order={order} documents={documents} onUpdated={load} /></TabsContent>
      <TabsContent value="returns" className="grid gap-4 pt-4"><div><OrderLineActionPanel mode="return" orderId={orderId} order={order} lines={lines} warehouses={warehouses} returns={relatedReturns} onUpdated={load} /></div><OrderReturnsPanel orderId={orderId} order={order} lines={lines} warehouses={warehouses} returns={relatedReturns} onUpdated={load} /><OrderReturnSyncPanel order={order} returns={relatedReturns} onUpdated={load} /></TabsContent>
      <TabsContent value="documents" className="pt-4"><OrderDocumentsPanel orderId={orderId} documents={documents} onUpdated={load} /></TabsContent>
      <OrderChannelPanel order={order} lines={lines} shipments={shipments} shopifyAdminUrl={shopifyAdminUrl} />
      <TabsContent value="activity" className="pt-4"><OrderActivityTimeline order={order} /></TabsContent>
    </Tabs></div>
    <Dialog open={walmartCancelOpen} onOpenChange={(open) => { if (!walmartCancelLoading) { setWalmartCancelOpen(open); if (!open) { setWalmartCancelPlan(null); setWalmartCancelReview(null) } } }}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Cancel Walmart order lines</DialogTitle><DialogDescription>DataPlus checks the live Walmart order before review and again before submission. Shipped quantities and Walmart Fulfillment Services lines cannot be canceled here.</DialogDescription></DialogHeader>
        {walmartCancelLoading && !walmartCancelPlan ? <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading the latest Walmart quantities...</div> : walmartCancelPlan ? <div className="grid gap-4">
          <div className="rounded-md border bg-muted/20 p-3 text-sm"><p className="font-medium">Walmart purchase order {String(walmartCancelPlan.purchaseOrderId || "")}</p><p className="text-xs text-muted-foreground">Only Created or Acknowledged units are available below.</p></div>
          <Label className="grid gap-2">Cancellation reason<Select value={walmartCancelReason} onValueChange={(value) => { setWalmartCancelReason(value); setWalmartCancelReview(null) }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="CUSTOMER_REQUESTED_SELLER_TO_CANCEL">Customer requested cancellation</SelectItem><SelectItem value="SELLER_CANCEL_OUT_OF_STOCK">Out of stock</SelectItem><SelectItem value="SELLER_CANCEL_PRICING_ERROR">Pricing error</SelectItem><SelectItem value="SELLER_CANCEL_ADDRESS_NOT_SERVICEABLE">Address not serviceable</SelectItem><SelectItem value="SELLER_CANCEL_FRAUD_STOP_SHIPMENT">Fraud stop shipment</SelectItem></SelectContent></Select></Label>
          <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Line</TableHead><TableHead>SKU / item</TableHead><TableHead className="w-36">Available</TableHead><TableHead className="w-36">Cancel qty</TableHead></TableRow></TableHeader><TableBody>{((walmartCancelPlan.availableLines || []) as Array<Record<string, unknown>>).map(line => <TableRow key={String(line.lineNumber)}><TableCell className="font-mono text-xs">{String(line.lineNumber)}</TableCell><TableCell><p className="font-medium">{String(line.sku || "No SKU")}</p><p className="text-xs text-muted-foreground">{String(line.title || "Walmart order line")}</p></TableCell><TableCell>{numberLabel(Number(line.cancellableQuantity || 0))}</TableCell><TableCell><Input type="number" min="0" max={Number(line.cancellableQuantity || 0)} step="1" disabled={Number(line.cancellableQuantity || 0) < 1 || Boolean(walmartCancelReview)} value={walmartCancelQuantities[String(line.lineNumber)] || 0} onChange={(event) => { const value = Math.max(0, Math.min(Number(line.cancellableQuantity || 0), Math.floor(Number(event.target.value || 0)))); setWalmartCancelQuantities(current => ({ ...current, [String(line.lineNumber)]: value })); setWalmartCancelReview(null) }} /></TableCell></TableRow>)}</TableBody></Table></div>
          {walmartCancelReview && <Alert className="border-amber-500/40 bg-amber-500/10"><AlertTriangle className="size-4" /><AlertTitle>Ready for final submission</AlertTitle><AlertDescription>{((walmartCancelReview.lines || []) as Array<Record<string, unknown>>).map(line => `Line ${line.lineNumber}: ${line.quantity}`).join("; ")}. Walmart will be updated immediately after confirmation.</AlertDescription></Alert>}
        </div> : null}
        <DialogFooter><Button variant="outline" disabled={walmartCancelLoading} onClick={() => setWalmartCancelOpen(false)}>Close</Button>{walmartCancelReview ? <Button variant="destructive" disabled={walmartCancelLoading} onClick={() => void applyWalmartCancellation()}>{walmartCancelLoading && <Loader2 className="size-4 animate-spin" />} Confirm cancellation</Button> : <Button disabled={walmartCancelLoading || !walmartCancelPlan} onClick={() => void reviewWalmartCancellation()}>{walmartCancelLoading && <Loader2 className="size-4 animate-spin" />} Review cancellation</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(skuEditLine)} onOpenChange={(open) => { if (!open) setSkuEditLine(null) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Edit imported order SKU</DialogTitle><DialogDescription>The channel SKU remains in the audit history. DataPlus will use the corrected SKU for catalog matching, fulfillment, and reporting.</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <div className="rounded-md border bg-muted/20 p-3 text-sm"><p className="font-medium">{String(skuEditLine?.line.title || "Order item")}</p><p className="mt-1 text-xs text-muted-foreground">Current SKU: {String(skuEditLine?.line.sku || "Blank")}</p></div>
          <Field label="Correct SKU"><div className="relative"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input autoFocus className="pl-9" value={skuEditValue} onChange={(event) => setSkuEditValue(event.target.value)} placeholder="Search or enter the DataPlus SKU" /></div></Field>
          {skuEditSearching ? <p className="text-xs text-muted-foreground"><Loader2 className="mr-1 inline size-3 animate-spin" /> Searching Catalog...</p> : skuEditValue.trim().length >= 2 ? <div className="max-h-56 overflow-y-auto rounded-md border bg-background">{skuEditResults.map((item) => <button key={String(item.id || item.sku)} type="button" className="grid w-full grid-cols-[minmax(110px,0.4fr)_minmax(0,1fr)] gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted" onClick={() => { setSkuEditValue(String(item.sku || "")); setSkuEditResults([]) }}><span className="font-mono text-xs font-semibold">{String(item.sku || "-")}</span><span className="min-w-0 truncate">{String(item.title || item.marketplaceTitle || item.sku || "Untitled product")}</span></button>)}{!skuEditResults.length ? <p className="p-3 text-sm text-muted-foreground">No catalog match. You can still save this SKU and DataPlus will create a draft product for review.</p> : null}</div> : null}
          <Field label="Reason for correction (optional)"><Textarea value={skuEditReason} onChange={(event) => setSkuEditReason(event.target.value)} placeholder="Example: Channel listing used an old alias" /></Field>
          <p className="text-xs text-muted-foreground">Choose a catalog result or save the value you entered. New SKUs are created as draft products and flagged for catalog review.</p>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setSkuEditLine(null)}>Cancel</Button><Button disabled={saving || !skuEditValue.trim() || String(skuEditLine?.line.sku || "").trim().toLowerCase() === skuEditValue.trim().toLowerCase()} onClick={() => void saveSkuCorrection()}>{saving && <Loader2 className="size-4 animate-spin" />} Save SKU</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(restoreDismissal)} onOpenChange={(open) => { if (!open) { restorePurchaseDemandRequestIdRef.current = ""; setRestoreDismissal(null) } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Restore dismissed item</DialogTitle><DialogDescription>{String(restoreDismissal?.sku || "This SKU")} will remain suppressed from automatic routing unless you choose one of these buyer-directed destinations.</DialogDescription></DialogHeader>
        <RadioGroup value={restoreMode} onValueChange={setRestoreMode} className="grid gap-2">
          <Label className="flex cursor-pointer items-start gap-3 rounded-md border p-3"><RadioGroupItem value="new_po" className="mt-0.5" /><span><span className="block font-medium">Create a new PO</span><span className="block text-xs text-muted-foreground">Create a separate draft for the supplier saved on this line.</span></span></Label>
          <Label className="flex cursor-pointer items-start gap-3 rounded-md border p-3"><RadioGroupItem value="existing_po" className="mt-0.5" /><span className="min-w-0 flex-1"><span className="block font-medium">Add to an existing PO</span><span className="block text-xs text-muted-foreground">The PO must be unsubmitted and belong to the same supplier.</span>{restoreMode === "existing_po" && <Input className="mt-2" value={restorePoReference} onChange={(event) => setRestorePoReference(event.target.value)} placeholder="PO#1284" />}</span></Label>
          <Label className="flex cursor-pointer items-start gap-3 rounded-md border p-3"><RadioGroupItem value="dropship" className="mt-0.5" /><span><span className="block font-medium">Dropship to customer</span><span className="block text-xs text-muted-foreground">Create a supplier PO using the customer shipping address.</span></span></Label>
        </RadioGroup>
        <DialogFooter><Button variant="outline" onClick={() => { restorePurchaseDemandRequestIdRef.current = ""; setRestoreDismissal(null) }}>Cancel</Button><Button disabled={saving || (restoreMode === "existing_po" && !restorePoReference.trim())} onClick={() => void restoreDismissedPurchaseDemand()}>{saving ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />} Restore item</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={fulfillOpen} onOpenChange={setFulfillOpen}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader><DialogTitle>{labelWorkflow ? "Create Shopify shipping label" : supplierDropshipFulfillment ? "Record supplier tracking" : "Record shipment"}</DialogTitle><DialogDescription>{labelWorkflow ? `Select what will ship in ${String(order.orderNumber || orderId).replace(/^#/, "")}-SH${shipments.length + 1}, then calculate delivery options before purchasing a carrier label.` : supplierDropshipFulfillment ? `${String(supplierDropshipPurchaseOrder?.supplier || "The supplier")} is shipping this order directly to the customer through ${String(supplierDropshipPurchaseOrder?.poNumber || "its dropship PO")}. Physical warehouse inventory will not be reserved or deducted.` : "Update local inventory, preserve the package record, and prepare the fulfillment for its sales channel."}</DialogDescription></DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          {!supplierDropshipFulfillment && <Field label="Warehouse"><Select value={warehouseId} onValueChange={setWarehouseId}><SelectTrigger><SelectValue placeholder="Choose warehouse" /></SelectTrigger><SelectContent>{warehouses.map((warehouse) => <SelectItem key={String(warehouse.id)} value={String(warehouse.id)}>{String(warehouse.name || warehouse.code || "Warehouse")}</SelectItem>)}</SelectContent></Select></Field>}
          {!labelWorkflow && <Field label="Carrier"><Select value={carrier} onValueChange={(value) => { setCarrier(value); setService(value === "Other" ? "" : enabledCarrierServices(fulfillmentCarriers, value)[0] || ""); setTrackingUrl(""); if (value === "Other") { setCarrierName(""); setCarrierPhone("") } else { setCarrierName(value); setCarrierPhone("") } }}><SelectTrigger><SelectValue placeholder="Choose carrier" /></SelectTrigger><SelectContent>{trackingCarrierOptions.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select></Field>}
          {!labelWorkflow && carrier === "Other" && <Field label="Carrier name"><Input value={carrierName} onChange={(event) => setCarrierName(event.target.value)} placeholder="Enter the carrier name" /></Field>}
          {!labelWorkflow && carrier !== "Other" && <Field label="Service"><Select value={service} onValueChange={setService}><SelectTrigger><SelectValue placeholder="Choose service" /></SelectTrigger><SelectContent>{shipmentServiceOptions.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select></Field>}
          {!labelWorkflow && carrier === "Other" && <Field label="Service"><Input value={service} onChange={(event) => setService(event.target.value)} placeholder="Carrier service" /></Field>}
          {!labelWorkflow && <Field label="Tracking number"><Input value={trackingNumber} onChange={(event) => { const value = event.target.value; setTrackingNumber(value); const detected = detectTrackingCarrier(value); if (detected && trackingCarrierOptions.includes(detected) && detected !== carrier) { setCarrier(detected); setCarrierName(detected); setService(""); setTrackingUrl("") } }} />{detectTrackingCarrier(trackingNumber) ? <p className="mt-1 text-xs text-emerald-600">Detected {detectTrackingCarrier(trackingNumber)}</p> : null}</Field>}
          {!labelWorkflow && carrier === "Other" && <Field label="Tracking URL"><Input value={trackingUrl} onChange={(event) => setTrackingUrl(event.target.value)} placeholder="https://carrier.example/track/..." /></Field>}
          {!labelWorkflow && carrier === "Other" && <Field label="Carrier phone number"><Input type="tel" value={carrierPhone} onChange={(event) => setCarrierPhone(event.target.value)} placeholder="Optional support phone" /></Field>}
          {!labelWorkflow && carrier !== "Other" && trackingNumber && <div className="grid content-center gap-1 rounded-md border bg-muted/20 px-3 py-2 text-sm"><span className="text-xs font-medium text-muted-foreground">Tracking link</span><a className="break-all text-primary hover:underline" href={trackingUrlForShipment({}, carrierName || carrier, trackingNumber)} target="_blank" rel="noreferrer">{trackingUrlForShipment({}, carrierName || carrier, trackingNumber)}</a></div>}
          <Field label="Ship date"><Input type="date" value={shipDate} onChange={(event) => setShipDate(event.target.value)} /></Field>
          {labelWorkflow ? null : <Field label="Shipping cost"><Input type="number" min="0" step="0.01" value={shippingCost} onChange={(event) => setShippingCost(event.target.value)} /></Field>}
          {labelWorkflow && <Field label="Package weight (lb)"><Input type="number" min="0" step="0.01" value={packageWeight} onChange={(event) => setPackageWeight(event.target.value)} /></Field>}
          {labelWorkflow && <Field label="Package length (in)"><Input type="number" min="0" step="0.01" value={packageLength} onChange={(event) => setPackageLength(event.target.value)} /></Field>}
          {labelWorkflow && <Field label="Package width (in)"><Input type="number" min="0" step="0.01" value={packageWidth} onChange={(event) => setPackageWidth(event.target.value)} /></Field>}
          {labelWorkflow && <Field label="Package height (in)"><Input type="number" min="0" step="0.01" value={packageHeight} onChange={(event) => setPackageHeight(event.target.value)} /></Field>}
        </div>
        {!supplierDropshipFulfillment && <ToggleField label="Request customer notification" checked={notifyCustomer} onCheckedChange={setNotifyCustomer} />}
        <div className="max-h-64 overflow-y-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Remaining</TableHead><TableHead>Ship now</TableHead></TableRow></TableHeader><TableBody>{lines.map((line, index) => <TableRow key={`${String(line.sku)}-${index}`}><TableCell>{String(line.sku || "-")}</TableCell><TableCell>{numberLabel(remaining(line, index))}</TableCell><TableCell><Input className="w-24" type="number" min="0" max={remaining(line, index)} value={String(lineQty[index] || 0)} onChange={(event) => updateShipmentQuantity(index, Number(event.target.value || 0))} /></TableCell></TableRow>)}</TableBody></Table></div>
        {labelWorkflow && String(order.source || "").toLowerCase() === "shopify" && <div className="grid gap-4 border-t pt-4"><div className="rounded-md border bg-muted/30 p-3 text-sm"><span className="font-medium">Shipping reference: </span>{String(order.orderNumber || orderId).replace(/^#/, "")}-SH{shipments.length + 1}</div><ShopifyDeliveryQuotePanel orderId={orderId} order={order} onUpdated={load} selectedLines={lines.map((_, lineIndex) => ({ lineIndex, qty: Number(lineQty[lineIndex] || 0) })).filter((line) => line.qty > 0)} /><ShippingLabelReadinessPanel orderId={orderId} order={order} onUpdated={load} shipmentDraft={{ warehouseId, warehouseName: String(warehouses.find((warehouse) => String(warehouse.id) === warehouseId)?.name || ""), packageWeight, packageLength, packageWidth, packageHeight, shipDate, notifyCustomer, lines: lines.map((line, lineIndex) => ({ sku: String(line.sku || ""), lineIndex, qty: Number(lineQty[lineIndex] || 0) })).filter((line) => line.sku && line.qty > 0) }} /></div>}
        <DialogFooter><Button variant="outline" onClick={() => setFulfillOpen(false)}>Cancel</Button>{!labelWorkflow && <Button disabled={saving || !service || !trackingNumber.trim() || (carrier === "Other" && (!carrierName.trim() || !trackingUrl.trim()))} onClick={() => void saveFulfillment()}>{supplierDropshipFulfillment ? "Save supplier tracking" : "Record shipment"}</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={trackingEditOpen} onOpenChange={setTrackingEditOpen}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit tracking</DialogTitle>
          <DialogDescription>Update the active carrier and tracking number for this shipment. DataPlus keeps previous tracking values in the shipment history.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <Field label="Carrier">
            <Select value={trackingEditDraft.carrier} onValueChange={(value) => updateTrackingDraft("carrier", value)}>
              <SelectTrigger><SelectValue placeholder="Choose carrier" /></SelectTrigger>
              <SelectContent>{trackingCarrierOptions.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          {trackingEditDraft.carrier === "Other" && <Field label="Carrier name"><Input value={trackingEditDraft.carrierName} onChange={(event) => updateTrackingDraft("carrierName", event.target.value)} placeholder="Carrier shown to the team" /></Field>}
          {trackingEditDraft.carrier !== "Other" && <Field label="Service"><Select value={trackingEditDraft.service} onValueChange={(value) => updateTrackingDraft("service", value)}><SelectTrigger><SelectValue placeholder="Choose service" /></SelectTrigger><SelectContent>{trackingEditServiceOptions.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select></Field>}
          {trackingEditDraft.carrier === "Other" && <Field label="Service"><Input value={trackingEditDraft.service} onChange={(event) => updateTrackingDraft("service", event.target.value)} placeholder="Carrier service" /></Field>}
          <Field label="Tracking number"><Input value={trackingEditDraft.trackingNumber} onChange={(event) => updateTrackingDraft("trackingNumber", event.target.value)} />{detectTrackingCarrier(trackingEditDraft.trackingNumber) ? <p className="mt-1 text-xs text-emerald-600">Detected {detectTrackingCarrier(trackingEditDraft.trackingNumber)}</p> : null}</Field>
          {trackingEditDraft.carrier === "Other" && <Field label="Tracking URL"><Input value={trackingEditDraft.trackingUrl} onChange={(event) => updateTrackingDraft("trackingUrl", event.target.value)} placeholder="https://carrier.example/track/..." /></Field>}
          {trackingEditDraft.carrier === "Other" && <Field label="Carrier phone number"><Input type="tel" value={trackingEditDraft.carrierPhone} onChange={(event) => updateTrackingDraft("carrierPhone", event.target.value)} placeholder="Optional support phone" /></Field>}
          <Field label="Label cost"><Input type="number" min="0" step="0.01" value={trackingEditDraft.shippingCost} onChange={(event) => updateTrackingDraft("shippingCost", event.target.value)} placeholder="Optional" /></Field>
        </div>
        {trackingEditHistory.length > 0 ? <div className="rounded-md border p-3">
          <p className="text-xs font-semibold uppercase text-muted-foreground">Previous tracking</p>
          <div className="mt-2 grid gap-2">{trackingEditHistory.slice(0, 4).map((history, index) => <div key={String(history.id || index)} className="rounded-md bg-muted/30 p-2 text-xs"><p className="font-medium">{String(history.carrierName || history.carrier || "Carrier")} {String(history.service || "")}</p><p className="break-all font-mono text-muted-foreground">{String(history.trackingNumber || "No tracking number")}</p><p className="text-muted-foreground">Replaced {dateLabel(String(history.replacedAt || history.updatedAt || ""))}</p></div>)}</div>
        </div> : null}
        <DialogFooter><Button variant="outline" onClick={() => setTrackingEditOpen(false)}>Cancel</Button><Button disabled={saving || !trackingEditDraft.carrierName.trim() || !trackingEditDraft.service.trim() || !trackingEditDraft.trackingNumber.trim() || (trackingEditDraft.carrier === "Other" && !trackingEditDraft.trackingUrl.trim())} onClick={() => void saveTrackingEdit()}>{saving && <Loader2 className="size-4 animate-spin" />} Save tracking</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <UniversalShippingLabelDialog open={shippingLabelOpen} onOpenChange={setShippingLabelOpen} orderId={orderId} order={order} warehouses={warehouses} lines={lines} remaining={remaining} onUpdated={load} initialRateReview={savedShippingRate.review} routeIds={savedShippingRate.routeIds} defaultShipFromWarehouseId={String(fulfillmentSettings.defaultShipFromWarehouseId || "")} />
  </div>
}

