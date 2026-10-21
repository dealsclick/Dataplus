import { useEffect, useRef, useState } from "react"
import {
  AlertCircle, AlertTriangle, ArrowLeft, ArrowUpDown, Ban, Building2, CheckCircle2,
  ChevronDown, Clock3, ExternalLink, Eye, FileUp, Filter, History,
  Info, ListChecks, Loader2, PackageSearch,
  Play, Plus, RefreshCw, RotateCcw, Save, ScanBarcode, Search, SendHorizontal,
  ShieldCheck, ShoppingBag, Store, Trash2, Truck, Warehouse, X,
} from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field as FormField, FieldDescription, FieldLabel } from "@/components/ui/field"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { readWorkspaceCache, writeWorkspaceCache } from "../lib/workspace-cache"
import { api, dateLabel, moneyLabel, numberLabel } from "../lib/client-api"
import { matchesSearch, normalizePastedSearch } from "../lib/multi-search"
import { BulkSearchActions } from "./bulk-search-csv-button"
import {
  CatalogImage, ContextActions, Detail, detectTrackingCarrier, detectedTrackingUpdate,
  enabledCarrierNames, enabledCarrierServices, Field, PageHeader,
  purchaseOrderChannelReferenceUrl, purchaseOrderCtechNumber, purchaseOrderSalesChannel,
  purchaseOrderSupplierReference, useFulfillmentCarriers,
} from "../App"
import type { QuickProductResult } from "../App"

type PooledSupplierGroup = {
  key: string
  vendorId: string
  supplier: string
  requirements: Array<Record<string, unknown>>
  orderIds: Set<string>
  skus: Set<string>
  destinations: Set<string>
  poGroups: Set<string>
  units: number
  nextCutoff?: Record<string, unknown>
  due: boolean
}

function pooledSupplierKey(row: Record<string, unknown>) {
  const vendorId = String(row.vendorId || "").trim()
  if (vendorId) return `vendor:${vendorId}`
  const supplier = String(row.vendorName || "Unassigned").trim().toLowerCase()
  return `name:${supplier || "unassigned"}`
}

function pooledRequirementDestination(row: Record<string, unknown>) {
  return String(row.warehouseName || row.destinationWarehouseName || "Order destination")
}

function pooledRequirementCutoff(row: Record<string, unknown>) {
  const date = String(row.poolDate || row.cutoffDate || "").split("T")[0]
  const time = String(row.cutoffTime || "15:00")
  if (!date) return Number.POSITIVE_INFINITY
  const parsed = new Date(`${date}T${time.length === 5 ? `${time}:00` : time}`).getTime()
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY
}

function groupPooledRequirements(rows: Array<Record<string, unknown>>) {
  const groups = new Map<string, PooledSupplierGroup>()
  rows.forEach((row) => {
    const key = pooledSupplierKey(row)
    const vendorId = String(row.vendorId || "").trim()
    const supplier = String(row.vendorName || "Unassigned")
    const destination = pooledRequirementDestination(row)
    const cutoffMs = pooledRequirementCutoff(row)
    const poolDate = String(row.poolDate || row.cutoffDate || "Next business day")
    const cutoffTime = String(row.cutoffTime || "15:00")
    const group = groups.get(key) || {
      key,
      vendorId,
      supplier,
      requirements: [],
      orderIds: new Set<string>(),
      skus: new Set<string>(),
      destinations: new Set<string>(),
      poGroups: new Set<string>(),
      units: 0,
      due: false,
    }
    group.requirements.push(row)
    if (row.orderId) group.orderIds.add(String(row.orderId))
    if (row.sku) group.skus.add(String(row.sku))
    group.destinations.add(destination)
    group.poGroups.add(`${destination}|${poolDate}|${cutoffTime}`)
    group.units += Number(row.qty || 0)
    if (!group.nextCutoff || cutoffMs < pooledRequirementCutoff(group.nextCutoff)) group.nextCutoff = row
    if (cutoffMs <= Date.now()) group.due = true
    groups.set(key, group)
  })
  return [...groups.values()].sort((left, right) => left.supplier.localeCompare(right.supplier))
}

type WaitingPoSupplierGroup = {
  key: string
  vendorId: string
  supplier: string
  purchaseOrders: Array<Record<string, unknown>>
  orderIds: Set<string>
  skus: Set<string>
  destinations: Set<string>
  units: number
  estimatedCost: number
  nextCutoffMs: number
  nextCutoffPo?: Record<string, unknown>
  readyForReview: boolean
}

function purchaseOrderItems(po: Record<string, unknown>) {
  return (Array.isArray(po.items) ? po.items : Array.isArray(po.lines) ? po.lines : []) as Array<Record<string, unknown>>
}

const purchasingHistoryStatusesByScope: Record<string, Set<string>> = {
  canceled: new Set(["canceled", "cancelled"]),
  rejected: new Set(["rejected"]),
  archive: new Set(["superseded", "received", "closed", "shipped", "completed"]),
}

type PurchasingWorkData = {
  requirements?: Array<Record<string, unknown>>
  purchaseOrders?: Array<Record<string, unknown>>
  buyerAlerts?: Array<Record<string, unknown>>
  vendorReturnSummary?: { attentionCount?: number }
  purchaseOrderCountsByStatus?: Record<string, number>
  poolSummary?: Record<string, unknown>
  workflowSettings?: Record<string, unknown>
  pagination?: { page?: number; pageSize?: number; total?: number; totalPages?: number }
}

function purchaseOrderHasSubmission(po: Record<string, unknown>) {
  if (purchaseOrderCtechNumber(po)) return true
  if (po.submissionActive === false) return false
  return Boolean(po.submittedAt || po.placedAt || po.sentAt)
    || (Array.isArray(po.submissions) && po.submissions.length > 0)
    || (Array.isArray(po.submissionHistory) && po.submissionHistory.length > 0)
}

function purchaseOrderHasTracking(po: Record<string, unknown>) {
  return Boolean(String(po.trackingNumber || "").trim())
    || (Array.isArray(po.dropshipShipments) && po.dropshipShipments.some((shipment) => Boolean(String((shipment as Record<string, unknown>).trackingNumber || "").trim())))
}

function purchaseOrderIsWaiting(po: Record<string, unknown>) {
  const status = String(po.status || "draft").toLowerCase()
  const approval = (po.approval || {}) as Record<string, unknown>
  return String(po.type || "") === "customer_demand"
    && status === "draft"
    && !purchaseOrderHasSubmission(po)
    && !Boolean(po.readyForReview)
    && (po.manualDraftHold === true || waitingPoCutoff(po) > Date.now())
    && String(approval.status || "").toLowerCase() !== "rejected"
}

function purchaseOrderIsReadyToSubmit(po: Record<string, unknown>) {
  const status = String(po.status || "draft").toLowerCase()
  const type = String(po.type || "").toLowerCase()
  const approvalStatus = String(((po.approval || {}) as Record<string, unknown>).status || "").toLowerCase()
  if (po.manualDraftHold === true) return false
  if (type === "manual_inventory") {
    return !purchaseOrderHasSubmission(po)
      && !["hold", "rejected", "canceled", "superseded", "deleted", "received", "closed"].includes(status)
      && approvalStatus !== "rejected"
  }
  return type === "customer_demand"
    && !purchaseOrderHasSubmission(po)
    && !["hold", "rejected", "canceled", "superseded", "deleted", "received", "closed"].includes(status)
    && approvalStatus !== "rejected"
    && (status === "ready_to_send"
    || status === "awaiting_approval"
    || status === "approved"
    || Boolean(po.readyForReview)
    || waitingPoCutoff(po) <= Date.now()
    || approvalStatus === "approved")
}

function purchaseRequirementStatusLabel(status: unknown) {
  const value = String(status || "new").toLowerCase()
  if (value === "converted") return "Added to PO"
  if (value === "pooled") return "Awaiting draft PO"
  if (value === "buyer_review") return "Unassigned Orders"
  if (value.includes("exception")) return "Needs attention"
  return value.replace(/_/g, " ")
}

type PurchaseOrderNextStep = {
  label: string
  description: string
  variant: "default" | "secondary" | "outline" | "destructive"
  priority: number
}

function purchaseOrderNextStep(po: Record<string, unknown>): PurchaseOrderNextStep {
  const status = String(po.status || "draft").toLowerCase()
  const type = String(po.type || "").toLowerCase()
  const approval = (po.approval || {}) as Record<string, unknown>
  const approvalStatus = String(approval.status || "").toLowerCase()
  const approvalRequired = approval.required === true
    || po.approvalRequired === true
    || po.requiresApproval === true
    || status === "awaiting_approval"
  const approved = approvalStatus === "approved"
  const cutoffReached = status === "ready_to_send" || Boolean(po.readyForReview) || waitingPoCutoff(po) <= Date.now()

  if (["canceled", "cancelled"].includes(status)) {
    const reason = [po.cancelReasonLabel || po.cancelReason || "Reason was not recorded", po.cancelReasonNote].filter(Boolean).map(String).join(": ")
    return { label: "Purchase order canceled", description: reason, variant: "destructive", priority: 0 }
  }

  if (["partially_received", "receiving"].includes(status)) {
    return { label: "Receive shipment", description: "This warehouse-bound PO is in the receiving workflow.", variant: "default", priority: 2 }
  }
  if (status === "in_transit" || String(po.workflowStage || "").toLowerCase() === "incoming") {
    return { label: "Incoming", description: po.noTrackingNeeded === true ? "The supplier does not provide tracking. Receive this PO when it arrives." : "The supplier shipment is on its way to the receiving warehouse.", variant: "secondary", priority: 2 }
  }
  if (purchaseOrderHasSubmission(po) || ["submitted", "placed", "sent", "acknowledged", "vendor_confirmed"].includes(status)) {
    return purchaseOrderHasTracking(po)
      ? { label: "Shipment recorded", description: "Tracking is saved. Follow the shipment through fulfillment or warehouse receiving.", variant: "secondary", priority: 1 }
      : { label: "Awaiting tracking", description: "The PO is with the supplier. Record tracking when the supplier ships it.", variant: "outline", priority: 3 }
  }

  if (status === "hold" || approvalStatus === "rejected") {
    return { label: "Buyer review", description: "Resolve the hold or rejection before this PO can move forward.", variant: "destructive", priority: 4 }
  }
  if (approvalRequired && !approved) {
    return cutoffReached
      ? { label: "Needs approval", description: "Approve or hold this draft before it can be sent to the supplier.", variant: "outline", priority: 3 }
      : { label: "Collecting orders", description: "Eligible orders can continue joining this draft until cutoff; approval follows.", variant: "secondary", priority: 1 }
  }
  if (type === "manual_inventory") {
    return { label: "Ready to send", description: "Review quantities, cost, and delivery details, then submit it to the supplier.", variant: "default", priority: 2 }
  }
  if (approved || cutoffReached) {
    return { label: "Ready to send", description: "Review quantities, cost, and delivery details, then submit it to the supplier.", variant: "default", priority: 2 }
  }
  return { label: "Collecting orders", description: "Eligible orders will keep joining this supplier draft until cutoff.", variant: "secondary", priority: 1 }
}

export function PurchaseOrderProgress({ po }: { po: Record<string, unknown> }) {
  const status = String(po.status || "draft").toLowerCase()
  const workflowStage = String(po.workflowStage || "").toLowerCase()
  const approval = (po.approval || {}) as Record<string, unknown>
  const lines = Array.isArray(po.items) ? po.items as Array<Record<string, unknown>> : []
  const ordered = lines.reduce((sum, line) => sum + Number(line.qty || line.quantity || 0), 0)
  const received = lines.reduce((sum, line) => sum + Number(line.receivedQty || 0), 0)
  const stopped = ["canceled", "cancelled", "rejected", "superseded", "deleted", "hold"].includes(status)
  const complete = ["received", "closed", "completed"].includes(status) || Boolean(ordered > 0 && received >= ordered)
  const inbound = complete || ["in_transit", "partially_received", "receiving", "incoming"].includes(status) || workflowStage === "incoming" || Boolean(po.trackingNumber || received > 0)
  const ctechId = purchaseOrderCtechNumber(po)
  const sent = inbound || purchaseOrderHasSubmission(po) || ["submitted", "placed", "sent", "acknowledged", "vendor_confirmed"].includes(status)
  const approved = sent || String(approval.status || "").toLowerCase() === "approved" || ["approved", "ready_to_send"].includes(status)
  const activeIndex = complete ? 4 : inbound ? 3 : sent ? 2 : approved ? 1 : 0
  const steps = [
    { label: "Draft", detail: "Created" },
    { label: "Approved / sent", detail: ctechId ? `CTech ${ctechId}` : approved ? "Buyer approved" : "Pending approval" },
    { label: "Awaiting tracking", detail: sent ? (po.trackingNumber ? "Tracking received" : "With supplier") : "Not sent" },
    { label: "Inbound", detail: inbound ? (received > 0 ? `${numberLabel(received)} received` : "In transit") : "Not shipped" },
    { label: "Complete", detail: complete ? "Receiving complete" : "Open" },
  ]

  return <section aria-label="Purchase order progress" className="min-w-0 overflow-hidden rounded-md border bg-card">
    <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
      <div className="min-w-0"><p className="text-sm font-semibold">Purchase order progress</p><p className="text-xs text-muted-foreground">From buyer approval through warehouse receiving.</p></div>
      {stopped ? <Badge variant="destructive">{status.replace(/_/g, " ")}</Badge> : <Badge variant={complete ? "success" : "outline"}>{steps[activeIndex].label}</Badge>}
    </div>
    <div className="overflow-x-auto px-4 py-4">
      <ol className="grid min-w-[42rem] grid-cols-5">
        {steps.map((step, index) => {
          const done = !stopped && index < activeIndex
          const current = !stopped && index === activeIndex
          return <li key={step.label} className="relative min-w-0 pr-3 last:pr-0">
            {index < steps.length - 1 ? <span aria-hidden="true" className={cn("absolute left-5 right-0 top-3 h-px", done ? "bg-emerald-500" : "bg-border")} /> : null}
            <div className="relative z-10 flex items-start gap-2">
              <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border bg-background", done && "border-emerald-500 bg-emerald-500 text-white", current && "border-primary bg-primary text-primary-foreground", stopped && index === activeIndex && "border-destructive bg-destructive text-destructive-foreground")}>
                {done ? <CheckCircle2 className="size-4" /> : <span className="size-1.5 rounded-full bg-current" />}
              </span>
              <span className="min-w-0"><span className={cn("block text-xs font-semibold", !done && !current && "text-muted-foreground")}>{step.label}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{step.detail}</span></span>
            </div>
          </li>
        })}
      </ol>
    </div>
  </section>
}

function purchaseOrderOperator(po: Record<string, unknown>, kind: "approval" | "placement") {
  const approval = (po.approval || {}) as Record<string, unknown>
  if (kind === "approval" && approval.approvedBy) return { name: String(approval.approvedBy), at: String(approval.approvedAt || "") }
  if (kind === "placement") {
    if (po.placedBy || po.submittedBy) return { name: String(po.placedBy || po.submittedBy), at: String(po.placedAt || po.submittedAt || po.sentAt || "") }
    const submissions = Array.isArray(po.submissionHistory) ? po.submissionHistory as Array<Record<string, unknown>> : []
    const submission = [...submissions].reverse().find((entry) => entry.user)
    if (submission) return { name: String(submission.user), at: String(submission.createdAt || po.submittedAt || "") }
    const timeline = Array.isArray(po.timeline) ? po.timeline as Array<Record<string, unknown>> : []
    const placement = [...timeline].reverse().find((entry) => /placed with vendor|submitted|sent/i.test(`${String(entry.title || "")} ${String(entry.message || "")}`) && entry.user)
    if (placement) return { name: String(placement.user), at: String(placement.createdAt || placement.at || po.placedAt || "") }
  }
  return { name: "", at: "" }
}

function purchaseOrderTrackingState(po: Record<string, unknown>) {
  if (po.noTrackingNeeded === true) return { label: "Tracking not required", variant: "secondary" as const }
  const shipment = (po.inboundShipment || po.shipment || {}) as Record<string, unknown>
  const rawStatus = String(po.trackingStatus || po.carrierStatus || shipment.trackingStatus || shipment.status || "").toLowerCase()
  if (rawStatus.includes("deliver")) return { label: "Delivered", variant: "success" as const }
  if (rawStatus.includes("transit")) return { label: "In transit", variant: "secondary" as const }
  if (rawStatus.includes("ship") || rawStatus.includes("pickup") || purchaseOrderHasTracking(po)) return { label: "Shipped", variant: "success" as const }
  return { label: "Tracking pending", variant: "warning" as const }
}

type SupplierSubmissionCapability = {
  enabled?: boolean
  inboundTrackingExpected?: boolean
  preferredMethod?: string
  ready?: boolean
  sendNowEnabled?: boolean
  methods?: string[]
}

type PurchaseOrderApprovalDecision = {
  id: string
  poNumber: string
  supplier: string
  capability: SupplierSubmissionCapability
}

type PurchaseOrderRejectionDecision = {
  id: string
  poNumber: string
  supplier: string
}

function PurchaseOrderApprovalFollowUpDialog({ decision, busy, onBusyChange, onClose, onCompleted, user = "Luis" }: {
  decision: PurchaseOrderApprovalDecision | null
  busy: boolean
  onBusyChange: (busy: boolean) => void
  onClose: () => void
  onCompleted: () => Promise<void> | void
  user?: string
}) {
  const [noTrackingNeeded, setNoTrackingNeeded] = useState(false)
  useEffect(() => { if (decision) setNoTrackingNeeded(decision.capability.inboundTrackingExpected === false) }, [decision?.id, decision?.capability.inboundTrackingExpected])
  const advance = async (mode: "send" | "placed") => {
    if (!decision || busy) return
    onBusyChange(true)
    try {
      if (mode === "send") {
        await api(`/api/purchase-orders/${encodeURIComponent(decision.id)}/submit`, { method: "POST", body: JSON.stringify({ method: "preferred", noTrackingNeeded, user }) })
        toast.success(noTrackingNeeded ? `${decision.poNumber} sent and moved to Incoming.` : `${decision.poNumber} sent and moved to Awaiting tracking.`)
      } else {
        await api(`/api/purchase-orders/${encodeURIComponent(decision.id)}/action`, { method: "POST", body: JSON.stringify({ action: "mark_placed", noTrackingNeeded, user }) })
        toast.success(noTrackingNeeded ? `${decision.poNumber} moved to Incoming.` : `${decision.poNumber} moved to Awaiting tracking.`)
      }
      onClose()
      await onCompleted()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to advance this purchase order.")
    } finally { onBusyChange(false) }
  }
  const methods = decision?.capability.methods || []
  const sendNowEnabled = decision?.capability.sendNowEnabled === true || (decision?.capability.ready === true && methods.length > 0)
  return <Dialog open={Boolean(decision)} onOpenChange={(open) => { if (!open && !busy) onClose() }}>
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>Purchase order approved</DialogTitle><DialogDescription>{decision ? `${decision.poNumber} for ${decision.supplier} is approved. Send it now or confirm that it was placed with the vendor. Until then, it remains Approved, not sent in Review & send.` : "Choose the next purchasing step."}</DialogDescription></DialogHeader>
      <div className="grid gap-3">
        <div className="rounded-md border bg-muted/30 p-3"><p className="text-sm font-medium">Supplier delivery method</p><p className="mt-1 text-xs text-muted-foreground">{sendNowEnabled ? `Send now is available by ${methods.map((method) => method.toUpperCase()).join(", ")}.` : "No enabled API, FTP, or email destination is configured on this supplier profile."}</p></div>
        <label className="flex items-center justify-between gap-4 rounded-md border p-3"><span><span className="block text-sm font-medium">No tracking needed</span><span className="block text-xs text-muted-foreground">Move directly to Incoming after the PO is sent or confirmed placed.{decision?.capability.inboundTrackingExpected === false ? " This is the supplier profile default." : ""}</span></span><Switch checked={noTrackingNeeded} onCheckedChange={setNoTrackingNeeded} /></label>
      </div>
      <DialogFooter className="gap-2 sm:justify-between">
        <Button variant="ghost" disabled={busy} onClick={onClose}>Keep approved, not sent</Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button className="h-auto min-h-9 whitespace-normal" variant="outline" disabled={busy} onClick={() => void advance("placed")}><CheckCircle2 className="size-4 shrink-0" /> PO has been placed with vendor</Button>
          <Button disabled={busy || !sendNowEnabled} onClick={() => void advance("send")}>{busy ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />} Send now</Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}

function PurchaseOrderRejectionDialog({ decision, busy, onClose, onConfirm }: {
  decision: PurchaseOrderRejectionDecision | null
  busy: boolean
  onClose: () => void
  onConfirm: (disposition: string, note: string, externalPlacement?: { sourceSystem: string; externalPoNumber: string; noTrackingNeeded: boolean }) => Promise<void>
}) {
  const [disposition, setDisposition] = useState("")
  const [note, setNote] = useState("")
  const [sourceSystem, setSourceSystem] = useState("")
  const [externalPoNumber, setExternalPoNumber] = useState("")
  const [noTrackingNeeded, setNoTrackingNeeded] = useState(false)
  const [cancellationConfirmed, setCancellationConfirmed] = useState(false)
  useEffect(() => { if (decision) { setDisposition(""); setNote(""); setSourceSystem(""); setExternalPoNumber(""); setNoTrackingNeeded(false); setCancellationConfirmed(false) } }, [decision?.id])
  const cancelDemand = disposition === "cancel_customer_demand"
  const dismissDemand = disposition === "dismiss_demand"
  const externalSource = disposition === "external_source"
  return <Dialog open={Boolean(decision)} onOpenChange={(open) => { if (!open && !busy) onClose() }}>
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>Reject or redirect purchase order</DialogTitle><DialogDescription>{decision ? `Choose what happens to ${decision.poNumber} for ${decision.supplier}. An external placement keeps its linked demand active; the other choices reject this DataPlus PO.` : "Choose a disposition for the linked demand."}</DialogDescription></DialogHeader>
      <div className="grid gap-4">
        <Field label="PO disposition"><Select value={disposition} onValueChange={(value) => { setDisposition(value); setCancellationConfirmed(false) }}><SelectTrigger><SelectValue placeholder="Choose what happens next" /></SelectTrigger><SelectContent><SelectItem value="external_source">PO placed from another source</SelectItem><SelectItem value="dismiss_demand">Dismiss items from purchasing</SelectItem><SelectItem value="return_to_sourcing">Return to sourcing / replacement PO</SelectItem><SelectItem value="warehouse_fulfillment">Move to warehouse fulfillment</SelectItem><SelectItem value="cancel_customer_demand">Customer demand was canceled</SelectItem><SelectItem value="duplicate_test">Void duplicate or test PO</SelectItem></SelectContent></Select></Field>
        {externalSource ? <div className="grid gap-4 rounded-md border bg-muted/20 p-3"><div className="grid gap-4 sm:grid-cols-2"><Field label="Source system"><Input value={sourceSystem} onChange={(event) => setSourceSystem(event.target.value)} placeholder="CTech, legacy ERP, etc." /></Field><Field label="External PO number (optional)"><Input value={externalPoNumber} onChange={(event) => setExternalPoNumber(event.target.value)} placeholder="Can be added later" /></Field></div><label className="flex items-center justify-between gap-4"><span><span className="block text-sm font-medium">No tracking needed</span><span className="block text-xs text-muted-foreground">Move directly to Incoming instead of waiting for tracking.</span></span><Switch checked={noTrackingNeeded} onCheckedChange={setNoTrackingNeeded} /></label></div> : null}
        <Field label={externalSource ? "Placement note (optional)" : "Rejection reason"}><Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={externalSource ? "Add any details about where or how the PO was placed" : "Explain why this purchasing attempt is being rejected"} /></Field>
        {cancelDemand ? <label className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3"><Checkbox checked={cancellationConfirmed} onCheckedChange={(checked) => setCancellationConfirmed(checked === true)} /><span><span className="block text-sm font-medium">The customer demand is canceled</span><span className="block text-xs text-muted-foreground">This removes the linked demand from active fulfillment. Use only after confirming the marketplace or customer cancellation.</span></span></label> : null}
        {dismissDemand ? <label className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3"><Checkbox checked={cancellationConfirmed} onCheckedChange={(checked) => setCancellationConfirmed(checked === true)} /><span><span className="block text-sm font-medium">Stop sourcing these items</span><span className="block text-xs text-muted-foreground">The lines will leave active POs, dropships, and sourcing queues. The customer order remains unfulfilled with an audit record and will not be sourced again automatically.</span></span></label> : null}
      </div>
      <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>Keep PO</Button><Button variant={externalSource ? "default" : "destructive"} disabled={busy || !disposition || (externalSource ? !sourceSystem.trim() : !note.trim()) || ((cancelDemand || dismissDemand) && !cancellationConfirmed)} onClick={() => void onConfirm(disposition, note.trim(), externalSource ? { sourceSystem: sourceSystem.trim(), externalPoNumber: externalPoNumber.trim(), noTrackingNeeded } : undefined)}>{busy ? <Loader2 className="size-4 animate-spin" /> : externalSource ? <ExternalLink className="size-4" /> : <Ban className="size-4" />} {externalSource ? "Record external placement" : "Reject PO"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

function purchaseOrderCancellationReason(po: Record<string, unknown>) {
  return [po.cancelReasonLabel || po.cancelReason || "Canceled", po.cancelReasonNote]
    .filter(Boolean)
    .map(String)
    .join(": ")
}

function purchaseOrderCancellationActor(po: Record<string, unknown>) {
  if (String(po.canceledBy || "").trim()) return String(po.canceledBy)
  const timeline = Array.isArray(po.timeline) ? po.timeline as Array<Record<string, unknown>> : []
  const event = [...timeline].reverse().find((entry) => ["customer_order_canceled", "canceled", "cancelled"].includes(String(entry.type || "").toLowerCase()))
  return String(event?.user || "System")
}

function purchaseOrderCanceledOrders(po: Record<string, unknown>) {
  const references = new Map<string, { id: string; number: string }>()
  const orderIds = Array.isArray(po.orderIds) ? po.orderIds as unknown[] : []
  const orderNumbers = Array.isArray(po.orderNumbers) ? po.orderNumbers as unknown[] : []
  orderIds.forEach((value, index) => {
    const id = String(value || "").trim()
    const number = String(orderNumbers[index] || id).trim()
    if (id || number) references.set(id || number, { id, number })
  })
  const removedDemand = Array.isArray(po.removedDemand) ? po.removedDemand as Array<Record<string, unknown>> : []
  removedDemand.forEach((line) => {
    const id = String(line.orderId || "").trim()
    const number = String(line.orderNumber || id).trim()
    if (id || number) references.set(id || number, { id, number })
  })
  if (!references.size && String(po.orderNumber || "").trim()) {
    const number = String(po.orderNumber).trim()
    references.set(number, { id: String(po.orderId || "").trim(), number })
  }
  return [...references.values()]
}

function purchaseLineSupplierOffers(line: Record<string, unknown>, fallbackSupplier = "") {
  const selectedName = String(line.supplier || line.vendorName || fallbackSupplier || "Unassigned supplier").trim()
  const selectedVendorId = String(line.vendorId || "").trim()
  const rawOffers = Array.isArray(line.supplierOffers) ? line.supplierOffers as Array<Record<string, unknown>> : []
  const offers = new Map<string, Record<string, unknown>>()
  for (const offer of rawOffers) {
    const name = String(offer.vendorName || offer.supplier || offer.vendor || "").trim()
    if (!name) continue
    const vendorId = String(offer.vendorId || "").trim()
    const key = (vendorId || name).toLowerCase()
    if (!offers.has(key)) offers.set(key, { ...offer, vendorName: name, vendorId })
  }
  if (selectedName) {
    const selectedKey = (selectedVendorId || selectedName).toLowerCase()
    if (!offers.has(selectedKey)) offers.set(selectedKey, {
      vendorId: selectedVendorId,
      vendorName: selectedName,
      vendorSku: line.vendorSku,
      unitCost: line.unitCost,
      availableQty: line.availableQty,
      availabilityKnown: line.availabilityKnown
    })
  }
  const selectedKey = (selectedVendorId || selectedName).toLowerCase()
  return {
    selectedName,
    alternatives: [...offers.entries()].filter(([key]) => key !== selectedKey).map(([, offer]) => offer)
  }
}

function PurchaseLineSupplier({ line, fallbackSupplier = "" }: { line: Record<string, unknown>; fallbackSupplier?: string }) {
  const { selectedName, alternatives } = purchaseLineSupplierOffers(line, fallbackSupplier)
  if (!alternatives.length) return <span>{selectedName}</span>
  const selectedCost = Number(line.unitCost || line.estimatedUnitCost || 0)
  return <div className="flex min-w-0 items-center gap-1.5"><span className="truncate" title={selectedName}>{selectedName}</span><HoverCard openDelay={150}><HoverCardTrigger asChild><Button type="button" size="sm" variant="outline" className="h-6 shrink-0 rounded-full px-2 text-xs font-semibold">+{alternatives.length}</Button></HoverCardTrigger><HoverCardContent align="start" className="w-80"><div className="space-y-3"><div><p className="font-medium">Other supplier options</p><p className="text-xs text-muted-foreground">Availability and cost captured when this order was routed.</p></div><div className="grid gap-2">{alternatives.map((offer, index) => { const cost = Number(offer.unitCost || offer.cost || 0); const available = Number(offer.availableQty ?? offer.stockQty ?? offer.qty ?? 0); const availabilityKnown = offer.availabilityKnown !== false; return <div key={`${String(offer.vendorId || offer.vendorName)}-${index}`} className="rounded-md border bg-muted/25 p-2.5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{String(offer.vendorName || offer.supplier || "Supplier")}</p><p className="truncate text-xs text-muted-foreground">Vendor SKU {String(offer.vendorSku || "-")}</p></div>{cost > 0 && selectedCost > 0 && cost < selectedCost && <Badge variant="success">Lower cost</Badge>}</div><div className="mt-2 flex justify-between text-xs"><span>{cost > 0 ? moneyLabel(cost) : "Cost unavailable"}</span><span>{availabilityKnown ? `${numberLabel(available)} available` : "Availability unknown"}</span></div></div> })}</div><p className="text-xs text-muted-foreground">Use Re-source open quantities from the PO Actions menu to change suppliers.</p></div></HoverCardContent></HoverCard></div>
}

function waitingPoSupplierKey(po: Record<string, unknown>) {
  const vendorId = String(po.vendorId || "").trim()
  if (vendorId) return `vendor:${vendorId}`
  return `name:${String(po.supplier || "Unassigned").trim().toLowerCase()}`
}

function waitingPoCutoff(po: Record<string, unknown>) {
  const date = String(po.poolDate || po.cutoffDate || "").split("T")[0]
  const time = String(po.cutoffTime || "15:00")
  if (!date) return Number.POSITIVE_INFINITY
  const parsed = new Date(`${date}T${time.length === 5 ? `${time}:00` : time}`).getTime()
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY
}

export const PURCHASE_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

type VendorDeliveryScheduleRow = {
  id: string
  cutoffDay: number
  cutoffTime: string
  deliveryDay: number
  enabled: boolean
  label?: string
}

type VendorScheduleException = {
  id: string
  date: string
  label: string
  enabled: boolean
}

type VendorTemporaryScheduleOverride = {
  enabled: boolean
  cutoffDate: string
  cutoffTime: string
  deliveryDate: string
  label: string
}

export function normalizeVendorDeliverySchedule(value: unknown): VendorDeliveryScheduleRow[] {
  if (!Array.isArray(value)) return []
  return value.map((entry, index) => {
    const row = (entry || {}) as Record<string, unknown>
    return {
      id: String(row.id || `delivery-window-${index + 1}`),
      cutoffDay: Math.max(0, Math.min(6, Number(row.cutoffDay ?? 2))),
      cutoffTime: /^\d{2}:\d{2}$/.test(String(row.cutoffTime || "")) ? String(row.cutoffTime) : "16:00",
      deliveryDay: Math.max(0, Math.min(6, Number(row.deliveryDay ?? 3))),
      enabled: row.enabled !== false,
      label: String(row.label || ""),
    }
  })
}

export function normalizeVendorScheduleExceptions(value: unknown): VendorScheduleException[] {
  if (!Array.isArray(value)) return []
  return value.map((entry, index) => {
    const row = (entry || {}) as Record<string, unknown>
    return {
      id: String(row.id || `schedule-exception-${index + 1}`),
      date: String(row.date || "").slice(0, 10),
      label: String(row.label || "Supplier closed"),
      enabled: row.enabled !== false,
    }
  }).filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date))
}

export function normalizeVendorTemporaryScheduleOverride(value: unknown): VendorTemporaryScheduleOverride {
  const row = (value && typeof value === "object" ? value : {}) as Record<string, unknown>
  return {
    enabled: row.enabled === true,
    cutoffDate: String(row.cutoffDate || "").slice(0, 10),
    cutoffTime: /^\d{2}:\d{2}$/.test(String(row.cutoffTime || "")) ? String(row.cutoffTime) : "15:00",
    deliveryDate: String(row.deliveryDate || "").slice(0, 10),
    label: String(row.label || "Temporary supplier schedule"),
  }
}

function purchaseScheduleTimeLabel(value: unknown) {
  const [hours, minutes] = String(value || "15:00").split(":").map(Number)
  const date = new Date(2000, 0, 1, Number.isFinite(hours) ? hours : 15, Number.isFinite(minutes) ? minutes : 0)
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

function purchaseScheduleDateLabel(value: unknown) {
  const raw = String(value || "").split("T")[0]
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw || "Not scheduled"
  return new Date(`${raw}T12:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
}

function PurchaseScheduleSummary({ record, compact = false }: { record: Record<string, unknown>; compact?: boolean }) {
  const cutoffMs = waitingPoCutoff(record)
  const passed = Boolean(record.readyForReview) || (Number.isFinite(cutoffMs) && cutoffMs <= Date.now())
  const reopened = record.manualDraftHold === true
  const cutoffDate = record.poolDate || record.cutoffDate
  const expectedDelivery = record.expectedDeliveryDate || record.expectedAt
  const detail = reopened
    ? `Returned to draft ${record.manualDraftHoldAt ? dateLabel(String(record.manualDraftHoldAt)) : "by a manager"}. The date shown is the original supplier cutoff.`
    : `Delivery ${purchaseScheduleDateLabel(expectedDelivery)} · ${String(record.scheduleLabel || record.cutoffTimezone || "America/New_York").replace("America/", "")}`
  return <div className={`grid ${compact ? "min-w-44 gap-1" : "gap-1"}`}>
    <div className="flex items-center gap-1.5"><Badge variant={reopened ? "outline" : passed ? "default" : "info"} className="w-fit">{reopened ? "Reopened draft" : passed ? "Ready to send" : "Collecting"}</Badge>{compact ? <Tooltip><TooltipTrigger asChild><button type="button" className="grid size-6 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Schedule details"><Info className="size-3.5" /></button></TooltipTrigger><TooltipContent className="max-w-72">{detail}</TooltipContent></Tooltip> : null}</div>
    <span className="whitespace-nowrap text-sm font-medium">{reopened ? "Original cutoff: " : ""}{purchaseScheduleDateLabel(cutoffDate)} at {purchaseScheduleTimeLabel(record.cutoffTime)}</span>
    {!compact ? <span className="text-xs text-muted-foreground">{detail}</span> : null}
  </div>
}

function groupWaitingPurchaseOrders(rows: Array<Record<string, unknown>>) {
  const groups = new Map<string, WaitingPoSupplierGroup>()
  rows.filter(purchaseOrderIsWaiting).forEach((po) => {
    const key = waitingPoSupplierKey(po)
    const items = purchaseOrderItems(po)
    const cutoffMs = waitingPoCutoff(po)
    const group = groups.get(key) || {
      key,
      vendorId: String(po.vendorId || ""),
      supplier: String(po.supplier || "Unassigned"),
      purchaseOrders: [],
      orderIds: new Set<string>(),
      skus: new Set<string>(),
      destinations: new Set<string>(),
      units: 0,
      estimatedCost: 0,
      nextCutoffMs: Number.POSITIVE_INFINITY,
      readyForReview: false,
    }
    group.purchaseOrders.push(po)
    items.forEach((line) => {
      if (line.orderId) group.orderIds.add(String(line.orderId))
      if (line.sku) group.skus.add(String(line.sku))
      group.units += Number(line.qty || 0)
    })
    if (po.warehouseName) group.destinations.add(String(po.warehouseName))
    group.estimatedCost += Number(po.openEstimatedCost ?? po.estimatedCost ?? 0)
    if (cutoffMs < group.nextCutoffMs) {
      group.nextCutoffMs = cutoffMs
      group.nextCutoffPo = po
    }
    group.readyForReview = group.readyForReview || Boolean(po.readyForReview) || cutoffMs <= Date.now()
    groups.set(key, group)
  })
  return [...groups.values()].sort((left, right) => left.supplier.localeCompare(right.supplier))
}


export function PurchasingRouter({ operatorName = "Buyer" }: { operatorName?: string } = {}) {
  if (["/purchasing/reconciliation", "/purchasing/tools"].includes(window.location.pathname)) return <PurchasingToolsPage />
  if (window.location.pathname === "/purchasing/supplier-returns") return <SupplierReturnsPage operatorName={operatorName} />
  const match = window.location.pathname.match(/^\/purchasing\/(?:waiting-for-po|supplier-pools)\/([^/]+)\/?$/)
  return match ? <PurchasingSupplierPoolPage supplierKey={decodeURIComponent(match[1])} /> : <PurchasingPage operatorName={operatorName} />
}

type SupplierReturnRow = Record<string, unknown> & { purchaseOrderId?: string; purchaseOrderNumber?: string; supplier?: string; vendorId?: string; items?: Array<Record<string, unknown>> }
type SupplierReturnData = {
  returns?: SupplierReturnRow[]
  summary?: { totalCount?: number; attentionCount?: number; openUnits?: number; shippedCount?: number; creditPendingCount?: number }
  pagination?: { page?: number; pageSize?: number; total?: number; totalPages?: number }
}

function SupplierReturnsPage({ operatorName = "Buyer" }: { operatorName?: string } = {}) {
  const [data, setData] = useState<SupplierReturnData>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [statusFilter, setStatusFilter] = useState("attention")
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<SupplierReturnRow | null>(null)
  const [draft, setDraft] = useState({ status: "awaiting_buyer_review", rmaNumber: "", carrier: "", trackingNumber: "", buyerNote: "" })
  const load = async () => {
    setLoading(true)
    try {
      const first = await api<SupplierReturnData>("/api/purchasing/supplier-returns?pageSize=500")
      const returns = [...(first.returns || [])]
      const totalPages = Math.max(1, Number(first.pagination?.totalPages || 1))
      const total = Number(first.pagination?.total || returns.length)
      for (let page = 2; page <= totalPages; page += 4) {
        const pages = Array.from({ length: Math.min(4, totalPages - page + 1) }, (_, index) => page + index)
        const results = await Promise.all(pages.map((pageNumber) => {
          const params = new URLSearchParams({
            page: String(pageNumber),
            pageSize: String(first.pagination?.pageSize || 500),
            includeSummary: "false",
            total: String(total),
          })
          return api<SupplierReturnData>(`/api/purchasing/supplier-returns?${params.toString()}`)
        }))
        results.forEach((next) => returns.push(...(next.returns || [])))
      }
      setData({ ...first, returns })
    }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load supplier returns.") }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  const beginUpdate = (vendorReturn: SupplierReturnRow) => {
    setSelected(vendorReturn)
    setDraft({ status: String(vendorReturn.status || "awaiting_buyer_review"), rmaNumber: String(vendorReturn.rmaNumber || ""), carrier: String(vendorReturn.carrier || ""), trackingNumber: String(vendorReturn.trackingNumber || ""), buyerNote: String(vendorReturn.buyerNote || "") })
  }
  const save = async () => {
    if (!selected?.purchaseOrderId || !selected.id) return
    setSaving(true)
    try {
      await api(`/api/purchase-orders/${encodeURIComponent(String(selected.purchaseOrderId))}/returns/${encodeURIComponent(String(selected.id))}`, { method: "PATCH", body: JSON.stringify({ ...draft, user: operatorName }) })
      setSelected(null)
      toast.success("Supplier return updated.")
      await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update supplier return.") }
    finally { setSaving(false) }
  }
  const summary = data.summary || {}
  const allReturns = data.returns || []
  const normalizedQuery = query.trim().toLowerCase()
  const filtered = allReturns.filter((vendorReturn) => {
    const status = String(vendorReturn.status || "awaiting_buyer_review").toLowerCase()
    if (statusFilter === "attention" && !["draft", "awaiting_buyer_review", "ready_to_return", "vendor_contacted", "rma_received", "ready_to_ship", "credit_pending"].includes(status)) return false
    if (statusFilter === "in_transit" && status !== "shipped_to_vendor") return false
    if (statusFilter === "closed" && !["closed", "canceled"].includes(status)) return false
    return !normalizedQuery || JSON.stringify(vendorReturn).toLowerCase().includes(normalizedQuery)
  })
  const statusVariant = (status: string): "success" | "warning" | "destructive" | "secondary" => {
    if (["closed"].includes(status)) return "success"
    if (["awaiting_buyer_review", "draft", "credit_pending"].includes(status)) return "warning"
    if (["canceled"].includes(status)) return "destructive"
    return "secondary"
  }
  return <div className="grid gap-5">
    <PageHeader eyebrow="Purchasing / supplier returns" title="Supplier returns" description="Physically received customer returns that were held for a supplier disposition. Review each one before it leaves the warehouse or is financially closed." action={<div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={loading} onClick={() => void load()}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh</Button><Button size="sm" variant="outline" asChild><a href="/purchasing">Back to purchasing</a></Button></div>} />
    <Alert><AlertCircle className="size-4" /><AlertTitle>Buyer review protects returned inventory</AlertTitle><AlertDescription>Returned units remain in their return hold. When open customer demand exists, warehouse inspection offers those units to demand first. These records only appear here after the decision is to return the stock to its supplier.</AlertDescription></Alert>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Detail label="Needs buyer attention" value={numberLabel(Number(summary.attentionCount || 0))} /><Detail label="Units in review" value={numberLabel(Number(summary.openUnits || 0))} /><Detail label="Sent to supplier" value={numberLabel(Number(summary.shippedCount || 0))} /><Detail label="Credit pending" value={numberLabel(Number(summary.creditPendingCount || 0))} /><Detail label="All supplier returns" value={numberLabel(Number(summary.totalCount || 0))} /></div>
    <Card><CardHeader className="gap-3 border-b lg:flex-row lg:items-center lg:justify-between"><div><CardTitle className="text-base">Return disposition queue</CardTitle><CardDescription>Capture the supplier contact, RMA, outbound tracking, and the credit outcome in one buyer record.</CardDescription></div><div className="flex flex-wrap gap-2"><Input className="w-64" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search return, PO, supplier, SKU" /><Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="attention">Needs attention</SelectItem><SelectItem value="all">All returns</SelectItem><SelectItem value="in_transit">Sent to supplier</SelectItem><SelectItem value="closed">Closed</SelectItem></SelectContent></Select></div></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Supplier return</TableHead><TableHead>Supplier / PO</TableHead><TableHead>Customer return</TableHead><TableHead>SKU / units</TableHead><TableHead>Warehouse</TableHead><TableHead>Status</TableHead><TableHead>RMA / tracking</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{filtered.map((vendorReturn) => { const items = Array.isArray(vendorReturn.items) ? vendorReturn.items : []; const firstItem = items[0] || {}; const units = items.reduce((sum, item) => sum + Number(item.qty || item.receivedQty || 0), 0); const status = String(vendorReturn.status || "awaiting_buyer_review"); return <TableRow key={String(vendorReturn.id)}><TableCell className="font-medium">{String(vendorReturn.returnNumber || vendorReturn.id || "Supplier return")}<p className="text-xs text-muted-foreground">{dateLabel(String(vendorReturn.updatedAt || vendorReturn.createdAt || ""))}</p></TableCell><TableCell>{vendorReturn.vendorId ? <a className="font-medium hover:underline" href={`/vendors/${encodeURIComponent(String(vendorReturn.vendorId))}`}>{String(vendorReturn.supplier || "Supplier")}</a> : <span className="font-medium">{String(vendorReturn.supplier || "Supplier")}</span>}<p className="text-xs text-muted-foreground"><a className="hover:underline" href={`/purchase-orders/${encodeURIComponent(String(vendorReturn.purchaseOrderId || ""))}`}>{String(vendorReturn.purchaseOrderNumber || "PO")}</a></p></TableCell><TableCell>{String(vendorReturn.sourceReturnNumber || "-")}{vendorReturn.sourceOrderId ? <p className="text-xs text-muted-foreground"><a className="hover:underline" href={`/orders/${encodeURIComponent(String(vendorReturn.sourceOrderId))}`}>Order {String(vendorReturn.sourceOrderNumber || vendorReturn.sourceOrderId)}</a></p> : null}</TableCell><TableCell>{String(firstItem.sku || "-")}<p className="text-xs text-muted-foreground">{numberLabel(units)} unit{units === 1 ? "" : "s"}</p></TableCell><TableCell>{String(vendorReturn.warehouseName || "-")}</TableCell><TableCell><Badge variant={statusVariant(status)}>{status.replace(/_/g, " ")}</Badge></TableCell><TableCell>{vendorReturn.rmaNumber ? <p>RMA {String(vendorReturn.rmaNumber)}</p> : <p className="text-muted-foreground">No RMA</p>}{vendorReturn.trackingNumber ? <p className="font-mono text-xs">{String(vendorReturn.carrier || "Carrier")} {String(vendorReturn.trackingNumber)}</p> : null}</TableCell><TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => beginUpdate(vendorReturn)}>Review</Button></TableCell></TableRow> })}{!loading && !filtered.length && <TableRow><TableCell colSpan={8} className="h-32 text-center text-muted-foreground">No supplier returns match this view.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
    <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null) }}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle>Review {String(selected?.returnNumber || "supplier return")}</DialogTitle><DialogDescription>Update the vendor-return lifecycle without changing sellable inventory. The activity is recorded on the linked purchase order.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><Field label="Status"><Select value={draft.status} onValueChange={(status) => setDraft((current) => ({ ...current, status }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="awaiting_buyer_review">Awaiting buyer review</SelectItem><SelectItem value="vendor_contacted">Vendor contacted</SelectItem><SelectItem value="rma_received">RMA received</SelectItem><SelectItem value="ready_to_ship">Ready to ship</SelectItem><SelectItem value="shipped_to_vendor">Shipped to vendor</SelectItem><SelectItem value="credit_pending">Credit pending</SelectItem><SelectItem value="closed">Closed</SelectItem><SelectItem value="canceled">Canceled</SelectItem></SelectContent></Select></Field><Field label="Vendor RMA"><Input value={draft.rmaNumber} onChange={(event) => setDraft((current) => ({ ...current, rmaNumber: event.target.value }))} placeholder="RMA or case number" /></Field><Field label="Carrier"><Input value={draft.carrier} onChange={(event) => setDraft((current) => ({ ...current, carrier: event.target.value }))} placeholder="Carrier" /></Field><Field label="Outbound tracking"><Input value={draft.trackingNumber} onChange={(event) => setDraft((current) => ({ ...current, trackingNumber: event.target.value }))} placeholder="Tracking number" /></Field></div><Field label="Buyer note"><Textarea value={draft.buyerNote} onChange={(event) => setDraft((current) => ({ ...current, buyerNote: event.target.value }))} placeholder="Supplier authorization, freight instructions, expected credit, or other handoff detail" /></Field><DialogFooter><Button variant="outline" onClick={() => setSelected(null)}>Cancel</Button><Button disabled={saving} onClick={() => void save()}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save supplier return</Button></DialogFooter></DialogContent></Dialog>
  </div>
}

type ExternalSupplierPoRow = { id?: string; sourceSystem?: string; supplier?: string; poNumber?: string; poDate?: string; sku?: string; matchedSku?: string; quantity?: number; unitCost?: number; lineTotal?: number; currentSupplierCost?: number; costDifference?: number | null; matchStatus?: string; orderCandidates?: Array<{ orderId?: string; orderNumber?: string; orderDate?: string; qty?: number; daysFromPo?: number }> }
type ExternalSupplierPoData = { rows?: ExternalSupplierPoRow[]; summary?: { lineCount?: number; poCount?: number; totalCost?: number; matchedLines?: number; reviewLines?: number; unmatchedLines?: number; historicalCandidateLines?: number }; issues?: Array<{ row?: number; level?: string; message?: string }>; import?: { importedLines?: number; skippedDuplicates?: number; lineCount?: number; poCount?: number; totalCost?: number } }
type ExternalSupplierPoMapping = Record<"poNumber" | "supplier" | "poDate" | "sku" | "quantity" | "unitCost" | "lineTotal", string>
type ExternalSupplierPoPreview = { headers?: string[]; mapping?: ExternalSupplierPoMapping; fileType?: string; sampleRows?: Array<Record<string, string>>; issues?: Array<{ row?: number; level?: string; message?: string }>; summary?: { lineCount?: number; poCount?: number; totalCost?: number; errors?: number }; readyToImport?: boolean }

function PurchasingToolsPage() {
  const [data, setData] = useState<ExternalSupplierPoData>({})
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [sourceSystem, setSourceSystem] = useState("External purchasing system")
  const [supplier, setSupplier] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ExternalSupplierPoPreview | null>(null)
  const [mapping, setMapping] = useState<ExternalSupplierPoMapping>({ poNumber: "", supplier: "", poDate: "", sku: "", quantity: "", unitCost: "", lineTotal: "" })
  const [previewing, setPreviewing] = useState(false)
  const load = async () => {
    setLoading(true)
    try { setData(await api<ExternalSupplierPoData>("/api/purchasing/tools/external-po")) }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load external supplier POs.") }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  const filePayload = async () => {
    if (!file) throw new Error("Choose a supplier PO CSV or PDF first.")
    if (file.size > 10 * 1024 * 1024) throw new Error("Split supplier PO exports into files smaller than 10 MB.")
    if (/\.pdf$/i.test(file.name)) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ""
      for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
      return { fileType: "pdf", pdfBase64: btoa(binary) }
    }
    if (/\.csv$/i.test(file.name)) return { fileType: "csv", csv: await file.text() }
    throw new Error("Choose a CSV export or text-based PDF.")
  }
  const previewFile = async (nextMapping?: ExternalSupplierPoMapping) => {
    if (!file) return toast.error("Choose a supplier PO CSV or PDF first.")
    setPreviewing(true)
    try {
      const result = await api<ExternalSupplierPoPreview>("/api/purchasing/tools/external-po/preview", { method: "POST", body: JSON.stringify({ ...(await filePayload()), sourceSystem, supplier, mapping: nextMapping || mapping }) })
      setPreview(result)
      setMapping(result.mapping || mapping)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to preview supplier PO data.") }
    finally { setPreviewing(false) }
  }
  const importFile = async () => {
    if (!file || !preview?.readyToImport) return toast.error("Review the mapped preview before importing.")
    setImporting(true)
    try {
      const result = await api<ExternalSupplierPoData>("/api/purchasing/tools/external-po/import", { method: "POST", body: JSON.stringify({ ...(await filePayload()), sourceSystem, supplier, mapping }) })
      setData(result)
      setFile(null)
      setPreview(null)
      toast.success(`${numberLabel(Number(result.import?.importedLines || 0))} supplier PO lines imported; ${numberLabel(Number(result.import?.skippedDuplicates || 0))} duplicate lines skipped.`)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to import supplier POs.") }
    finally { setImporting(false) }
  }
  const summary = data.summary || {}
  const fileSizeLabel = (bytes: number) => bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  const matchLabel = (status: string) => status === "supplier_sku_match" ? "Supplier SKU match" : status === "sku_match_supplier_review" ? "SKU match - confirm supplier" : "SKU not found"
  const matchVariant = (status: string): "success" | "warning" | "destructive" => status === "supplier_sku_match" ? "success" : status === "sku_match_supplier_review" ? "warning" : "destructive"
  return <div className="grid gap-5">
    <PageHeader eyebrow="Purchasing / Supplier PO reconciliation" title="Supplier PO reconciliation" description="Import supplier POs from the external purchasing system, preserve the price paid and PO date, then use that evidence to validate historical cost." action={<div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void load()} disabled={loading || importing}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh</Button><Button size="sm" variant="outline" asChild><a href="/purchasing">Back to purchasing</a></Button></div>} />
    <Alert><ShieldCheck className="size-4" /><AlertTitle>Current supplier cost remains the estimate</AlertTitle><AlertDescription>DataPlus continues to use the current catalog supplier cost when a historical cost is unknown. Imported POs are dated evidence of what was actually paid. They do not create inventory, receiving work, or operational POs, and they never overwrite historical order cost without a buyer-confirmed reconciliation.</AlertDescription></Alert>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7"><Detail label="Imported PO lines" value={numberLabel(Number(summary.lineCount || 0))} /><Detail label="External POs" value={numberLabel(Number(summary.poCount || 0))} /><Detail label="Recorded paid cost" value={moneyLabel(Number(summary.totalCost || 0))} /><Detail label="Supplier SKU matches" value={numberLabel(Number(summary.matchedLines || 0))} /><Detail label="Supplier review" value={numberLabel(Number(summary.reviewLines || 0))} /><Detail label="Unmatched SKUs" value={numberLabel(Number(summary.unmatchedLines || 0))} /><Detail label="Historical candidates" value={numberLabel(Number(summary.historicalCandidateLines || 0))} /></div>
    <Card><CardHeader><CardTitle className="text-base">Import external supplier POs</CardTitle><CardDescription>Upload a CSV export or a text-based PO PDF. First preview the file, confirm its field mapping, then import only the valid lines. Scanned PDFs stop for review rather than guessing at a cost.</CardDescription></CardHeader><CardContent className="grid gap-4"><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><FormField><FieldLabel>Source system</FieldLabel><Input value={sourceSystem} onChange={(event) => setSourceSystem(event.target.value)} placeholder="External purchasing system" /></FormField><FormField><FieldLabel>Supplier fallback</FieldLabel><Input value={supplier} onChange={(event) => setSupplier(event.target.value)} placeholder="Used when the file has no supplier column" /></FormField><FormField className="xl:col-span-2"><FieldLabel>PO CSV or PDF</FieldLabel><Input type="file" accept=".csv,text/csv,.pdf,application/pdf" onChange={(event) => { setFile(event.target.files?.[0] || null); setPreview(null) }} />{file ? <FieldDescription>{file.name} - {fileSizeLabel(file.size)}</FieldDescription> : null}</FormField></div><div className="flex justify-end"><Button variant="outline" disabled={previewing || importing || !file} onClick={() => void previewFile()}>{previewing ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />} Preview and map fields</Button></div>{preview ? <div className="grid gap-4 rounded-md border p-4"><div><p className="font-medium">Review field mapping</p><p className="text-sm text-muted-foreground">{preview.fileType === "pdf" ? "PDF table extracted for review." : "CSV headers detected."} Map PO number, PO date, SKU, quantity, and a cost column before import.</p></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{([['poNumber', 'PO number'], ['poDate', 'PO date'], ['supplier', 'Supplier'], ['sku', 'SKU'], ['quantity', 'Quantity'], ['unitCost', 'Unit cost'], ['lineTotal', 'Line total']] as Array<[keyof ExternalSupplierPoMapping, string]>).map(([field, label]) => <FormField key={field}><FieldLabel>{label}{["poNumber", "poDate", "sku", "quantity"].includes(field) ? " *" : ""}</FieldLabel><Select value={mapping[field] || "__unmapped__"} onValueChange={(value) => setMapping((current) => ({ ...current, [field]: value === "__unmapped__" ? "" : value }))}><SelectTrigger><SelectValue placeholder="Not mapped" /></SelectTrigger><SelectContent><SelectItem value="__unmapped__">Not mapped</SelectItem>{(preview.headers || []).map((header) => <SelectItem key={header} value={header}>{header}</SelectItem>)}</SelectContent></Select></FormField>)}</div><div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={previewing || importing} onClick={() => void previewFile(mapping)}>{previewing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Update preview</Button><Button disabled={importing || !preview.readyToImport} onClick={() => void importFile()}>{importing ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />} Import reviewed data</Button></div><div className="overflow-x-auto"><Table><TableHeader><TableRow>{(preview.headers || []).slice(0, 8).map((header) => <TableHead key={header}>{header}</TableHead>)}</TableRow></TableHeader><TableBody>{(preview.sampleRows || []).map((row, index) => <TableRow key={index}>{(preview.headers || []).slice(0, 8).map((header) => <TableCell key={header} className="max-w-44 truncate">{String(row[header] || "-")}</TableCell>)}</TableRow>)}</TableBody></Table></div>{preview.issues?.length ? <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>{numberLabel(preview.issues.length)} row{preview.issues.length === 1 ? "" : "s"} need attention</AlertTitle><AlertDescription><div className="mt-2 grid gap-1">{preview.issues.slice(0, 8).map((issue, index) => <p key={`${issue.row}-${index}`}>Row {issue.row || "?"}: {issue.message}</p>)}</div></AlertDescription></Alert> : <Alert><ShieldCheck className="size-4" /><AlertTitle>{numberLabel(Number(preview.summary?.lineCount || 0))} valid PO lines ready</AlertTitle><AlertDescription>{numberLabel(Number(preview.summary?.poCount || 0))} PO{Number(preview.summary?.poCount || 0) === 1 ? "" : "s"} totaling {moneyLabel(Number(preview.summary?.totalCost || 0))} will be stored as dated cost evidence.</AlertDescription></Alert>}</div> : null}{data.issues?.length ? <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>{numberLabel(data.issues.length)} last import row{data.issues.length === 1 ? "" : "s"} need attention</AlertTitle><AlertDescription><div className="mt-2 grid gap-1">{data.issues.slice(0, 8).map((issue, index) => <p key={`${issue.row}-${index}`}>Row {issue.row || "?"}: {issue.message}</p>)}</div></AlertDescription></Alert> : null}</CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Dated cost evidence</CardTitle><CardDescription>Review the imported price beside the current catalog supplier estimate and the nearest same-SKU historical order. Candidates are limited to the PO date plus or minus the operating window; buyer confirmation is required before writing a verified historical cost.</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>PO date</TableHead><TableHead>External PO</TableHead><TableHead>Supplier</TableHead><TableHead>SKU</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Paid unit cost</TableHead><TableHead className="text-right">Current cost</TableHead><TableHead>Historical candidate</TableHead><TableHead>Match</TableHead></TableRow></TableHeader><TableBody>{(data.rows || []).map((row) => { const candidate = row.orderCandidates?.[0]; return <TableRow key={String(row.id)}><TableCell className="whitespace-nowrap">{dateLabel(row.poDate || "")}</TableCell><TableCell className="font-medium">{row.poNumber || "-"}</TableCell><TableCell>{row.supplier || "-"}<p className="text-xs text-muted-foreground">{row.sourceSystem || "External"}</p></TableCell><TableCell><p className="font-mono text-xs">{row.sku || "-"}</p>{row.matchedSku && row.matchedSku !== row.sku ? <p className="text-xs text-muted-foreground">Maps to {row.matchedSku}</p> : null}</TableCell><TableCell className="text-right">{numberLabel(Number(row.quantity || 0))}</TableCell><TableCell className="text-right font-medium">{moneyLabel(Number(row.unitCost || 0))}</TableCell><TableCell className="text-right">{Number(row.currentSupplierCost || 0) > 0 ? <><p>{moneyLabel(Number(row.currentSupplierCost || 0))}</p>{row.costDifference == null ? null : <p className={Number(row.costDifference || 0) > 0 ? "text-xs text-amber-700 dark:text-amber-300" : "text-xs text-muted-foreground"}>{moneyLabel(Number(row.costDifference || 0))} variance</p>}</> : <span className="text-muted-foreground">No current cost</span>}</TableCell><TableCell>{candidate ? <><a className="font-medium text-primary hover:underline" href={`/orders/${encodeURIComponent(String(candidate.orderId || ""))}`}>{candidate.orderNumber || candidate.orderId}</a><p className="text-xs text-muted-foreground">{dateLabel(candidate.orderDate || "")} - {numberLabel(Number(candidate.daysFromPo || 0))}d from PO</p></> : <span className="text-muted-foreground">No nearby order</span>}</TableCell><TableCell><Badge variant={matchVariant(String(row.matchStatus || ""))}>{matchLabel(String(row.matchStatus || ""))}</Badge></TableCell></TableRow> })}{!loading && !(data.rows || []).length && <TableRow><TableCell colSpan={9} className="h-32 text-center text-muted-foreground">No external supplier PO lines imported yet.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
  </div>
}

const dropshipPoColumnOptions = [
  ["order", "Order #"], ["channel", "Channel"], ["supplier", "Supplier"], ["shipTo", "Ship to"],
  ["items", "SKUs"], ["units", "Units"], ["status", "Status"], ["updated", "Updated"],
] as const

function DropshipPurchaseOrdersWorkspace({ purchaseOrders, warehouses, operatorName, onReload, onQuickView }: {
  purchaseOrders: Array<Record<string, unknown>>
  warehouses: Array<Record<string, unknown>>
  operatorName: string
  onReload: () => Promise<void>
  onQuickView: (po: Record<string, unknown>) => void
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectedSupplierKey, setSelectedSupplierKey] = useState("")
  const [hiddenChannels, setHiddenChannels] = useState<Set<string>>(new Set())
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set(dropshipPoColumnOptions.map(([id]) => id)))
  const [sortMode, setSortMode] = useState("newest")
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeWarehouseId, setMergeWarehouseId] = useState("")
  const [mergeReason, setMergeReason] = useState("")
  const [merging, setMerging] = useState(false)
  const mergeRequestIdRef = useRef("")
  const channelOptions = [...new Set(purchaseOrders.map(purchaseOrderSalesChannel).filter((channel) => channel && channel !== "-"))].sort()
  const supplierRows = [...purchaseOrders.reduce((rows, po) => {
    const name = String(po.supplier || "Unassigned supplier").trim() || "Unassigned supplier"
    const key = String(po.vendorId || name).trim().toLowerCase()
    const current = rows.get(key) || { key, name, poIds: new Set<string>(), orderIds: new Set<string>(), units: 0, channels: new Set<string>() }
    current.poIds.add(String(po.id || ""))
    for (const orderId of [...(Array.isArray(po.orderIds) ? po.orderIds : []), po.orderId].filter(Boolean)) current.orderIds.add(String(orderId))
    current.units += Number(po.totalUnits || purchaseOrderItems(po).reduce((sum, line) => sum + Number(line.qty || 0), 0))
    const channel = purchaseOrderSalesChannel(po)
    if (channel && channel !== "-") current.channels.add(channel)
    rows.set(key, current)
    return rows
  }, new Map<string, { key: string; name: string; poIds: Set<string>; orderIds: Set<string>; units: number; channels: Set<string> }>()).values()].sort((left, right) => right.poIds.size - left.poIds.size || left.name.localeCompare(right.name))
  const visibleRows = purchaseOrders.filter((po) => (!selectedSupplierKey || String(po.vendorId || po.supplier || "").trim().toLowerCase() === selectedSupplierKey)
    && !hiddenChannels.has(purchaseOrderSalesChannel(po))).sort((left, right) => {
      if (sortMode === "oldest") return new Date(String(left.createdAt || left.updatedAt || 0)).getTime() - new Date(String(right.createdAt || right.updatedAt || 0)).getTime()
      if (sortMode === "sku") return String(purchaseOrderItems(left)[0]?.sku || "").localeCompare(String(purchaseOrderItems(right)[0]?.sku || ""))
      if (sortMode === "channel") return purchaseOrderSalesChannel(left).localeCompare(purchaseOrderSalesChannel(right))
      return new Date(String(right.createdAt || right.updatedAt || 0)).getTime() - new Date(String(left.createdAt || left.updatedAt || 0)).getTime()
    })
  const selectedRows = purchaseOrders.filter((po) => selectedIds.has(String(po.id || "")))
  const selectedSuppliers = new Set(selectedRows.map((po) => String(po.vendorId || po.supplier || "").trim().toLowerCase()).filter(Boolean))
  const selectedSupplier = supplierRows.find((supplier) => supplier.key === selectedSupplierKey)
  const allVisibleSelected = Boolean(visibleRows.length) && visibleRows.every((po) => selectedIds.has(String(po.id || "")))
  const receivingWarehouses = warehouses.filter((warehouse) => warehouse.isPhysical !== false && warehouse.allowReceiving !== false && !["supplier_feed", "dropship", "virtual", "transfer"].includes(String(warehouse.inventorySourceType || "").toLowerCase()))
  const openMerge = () => {
    const defaultWarehouse = receivingWarehouses.find((warehouse) => warehouse.isDefaultReceiving === true) || receivingWarehouses[0]
    setMergeWarehouseId(String(defaultWarehouse?.id || ""))
    setMergeReason("")
    mergeRequestIdRef.current = crypto.randomUUID()
    setMergeOpen(true)
  }
  const selectSupplierOrders = (supplierKey: string) => {
    if (selectedSupplierKey === supplierKey) {
      setSelectedSupplierKey("")
      setSelectedIds(new Set())
      return
    }
    const supplier = supplierRows.find((row) => row.key === supplierKey)
    setSelectedSupplierKey(supplierKey)
    setSelectedIds(new Set(supplier?.poIds || []))
  }
  const mergeSelected = async () => {
    if (!selectedIds.size || !mergeWarehouseId || merging) return
    setMerging(true)
    try {
      const result = await api<{ purchaseOrder?: Record<string, unknown>; message?: string }>("/api/purchase-orders/dropship/consolidate", { method: "POST", body: JSON.stringify({ requestId: mergeRequestIdRef.current || crypto.randomUUID(), purchaseOrderIds: [...selectedIds], warehouseId: mergeWarehouseId, reason: mergeReason.trim(), user: operatorName }) })
      toast.success(result.message || "Warehouse purchase order created.")
      setMergeOpen(false)
      mergeRequestIdRef.current = ""
      setSelectedIds(new Set())
      await onReload()
      if (result.purchaseOrder?.id) window.location.href = `/purchase-orders/${encodeURIComponent(String(result.purchaseOrder.id))}`
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to consolidate the selected dropship POs.") }
    finally { setMerging(false) }
  }
  const colSpan = 3 + dropshipPoColumnOptions.filter(([id]) => visibleColumns.has(id)).length
  return <div className="grid gap-3">
    <Alert><Truck className="size-4" /><AlertTitle>Dropship is the supplier default, not a lock</AlertTitle><AlertDescription>Use each PO for direct-to-customer shipping, or select compatible unsubmitted POs from one supplier and merge them into a single warehouse PO.</AlertDescription></Alert>
    <Card>
      <CardHeader className="gap-3 border-b">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-base">Dropship purchase orders</CardTitle><CardDescription>{numberLabel(visibleRows.length)} shown of {numberLabel(purchaseOrders.length)} unsubmitted dropship PO{purchaseOrders.length === 1 ? "" : "s"}.</CardDescription></div><Select value={sortMode} onValueChange={setSortMode}><SelectTrigger className="w-44"><ArrowUpDown className="size-4" /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="newest">Newest first</SelectItem><SelectItem value="oldest">Oldest first</SelectItem><SelectItem value="sku">SKU A-Z</SelectItem><SelectItem value="channel">Channel A-Z</SelectItem></SelectContent></Select></div>
        <div className="flex flex-wrap gap-2">
          <Popover><PopoverTrigger asChild><Button size="sm" variant={selectedSupplierKey ? "default" : "outline"}><Building2 className="size-4" /> Supplier{selectedSupplier ? `: ${selectedSupplier.name}` : ""}</Button></PopoverTrigger><PopoverContent align="start" className="w-[min(94vw,720px)] p-0"><div className="flex items-center justify-between border-b px-3 py-2"><div><p className="text-sm font-medium">Select supplier orders</p><p className="text-xs text-muted-foreground">Selecting a supplier filters the table and selects all eligible dropship POs from that supplier.</p></div>{selectedSupplierKey ? <Button size="sm" variant="ghost" onClick={() => { setSelectedSupplierKey(""); setSelectedIds(new Set()) }}>Clear</Button> : null}</div><ScrollArea className="h-72"><Table><TableHeader className="sticky top-0 z-10 bg-popover"><TableRow><TableHead className="w-10" /><TableHead>Supplier</TableHead><TableHead>Channels</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">POs</TableHead><TableHead className="text-right">Units</TableHead></TableRow></TableHeader><TableBody>{supplierRows.map((supplier) => <TableRow key={supplier.key} className="cursor-pointer" data-state={selectedSupplierKey === supplier.key ? "selected" : undefined} onClick={() => selectSupplierOrders(supplier.key)}><TableCell><Checkbox checked={selectedSupplierKey === supplier.key} aria-label={`Select all orders for ${supplier.name}`} onCheckedChange={() => selectSupplierOrders(supplier.key)} onClick={(event) => event.stopPropagation()} /></TableCell><TableCell className="font-medium">{supplier.name}</TableCell><TableCell><div className="flex flex-wrap gap-1">{[...supplier.channels].slice(0, 3).map((channel) => <Badge key={channel} variant="outline">{channel}</Badge>)}</div></TableCell><TableCell className="text-right">{numberLabel(supplier.orderIds.size)}</TableCell><TableCell className="text-right">{numberLabel(supplier.poIds.size)}</TableCell><TableCell className="text-right">{numberLabel(supplier.units)}</TableCell></TableRow>)}</TableBody></Table></ScrollArea></PopoverContent></Popover>
          <DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="outline"><Store className="size-4" /> Channels{hiddenChannels.size ? ` (${channelOptions.length - hiddenChannels.size})` : ""}</Button></DropdownMenuTrigger><DropdownMenuContent align="start" className="min-w-52"><DropdownMenuLabel>Show channels</DropdownMenuLabel><DropdownMenuSeparator />{channelOptions.map((channel) => <DropdownMenuCheckboxItem key={channel} checked={!hiddenChannels.has(channel)} onSelect={(event) => event.preventDefault()} onCheckedChange={(checked) => setHiddenChannels((current) => { const next = new Set(current); if (checked) next.delete(channel); else next.add(channel); return next })}>{channel}</DropdownMenuCheckboxItem>)}</DropdownMenuContent></DropdownMenu>
          <DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="outline"><ListChecks className="size-4" /> Columns</Button></DropdownMenuTrigger><DropdownMenuContent align="start" className="min-w-52"><DropdownMenuLabel>Visible columns</DropdownMenuLabel><DropdownMenuSeparator />{dropshipPoColumnOptions.map(([id, label]) => <DropdownMenuCheckboxItem key={id} checked={visibleColumns.has(id)} onCheckedChange={(checked) => setVisibleColumns((current) => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next })}>{label}</DropdownMenuCheckboxItem>)}<DropdownMenuSeparator /><DropdownMenuItem onSelect={() => setVisibleColumns(new Set(dropshipPoColumnOptions.map(([id]) => id)))}>Reset columns</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {selectedIds.size ? <div className="sticky top-2 z-20 flex flex-wrap items-center justify-between gap-3 border-b bg-background p-3 shadow-sm"><div><p className="font-medium">{selectedSupplier ? `All ${selectedSupplier.name} orders selected` : `${selectedIds.size} PO${selectedIds.size === 1 ? "" : "s"} selected`}</p><p className="text-xs text-muted-foreground">{selectedSuppliers.size > 1 ? "Select POs from one supplier to merge." : `${selectedIds.size} eligible PO${selectedIds.size === 1 ? "" : "s"} will become one warehouse PO.`}</p></div><div className="flex gap-2"><DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" disabled={selectedSuppliers.size !== 1 || !receivingWarehouses.length}>Actions <ChevronDown className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={openMerge}><Warehouse className="size-4" /> Merge into one PO</DropdownMenuItem></DropdownMenuContent></DropdownMenu><Button size="sm" variant="ghost" onClick={() => { setSelectedSupplierKey(""); setSelectedIds(new Set()) }}>Clear</Button></div></div> : null}
        <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead className="w-10"><Checkbox checked={allVisibleSelected} onCheckedChange={(checked) => setSelectedIds((current) => { const next = new Set(current); for (const po of visibleRows) { const id = String(po.id || ""); if (checked) next.add(id); else next.delete(id) } return next })} /></TableHead><TableHead>PO</TableHead>{visibleColumns.has("order") && <TableHead>Order#</TableHead>}{visibleColumns.has("channel") && <TableHead>Channel</TableHead>}{visibleColumns.has("supplier") && <TableHead>Supplier</TableHead>}{visibleColumns.has("shipTo") && <TableHead>Ship to</TableHead>}{visibleColumns.has("items") && <TableHead>SKUs</TableHead>}{visibleColumns.has("units") && <TableHead>Units</TableHead>}{visibleColumns.has("status") && <TableHead>Status</TableHead>}{visibleColumns.has("updated") && <TableHead>Updated</TableHead>}<TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{visibleRows.map((po) => { const poId = String(po.id || ""); const shipTo = (po.shipTo || {}) as Record<string, unknown>; const orderId = Array.isArray(po.orderIds) ? String(po.orderIds[0] || "") : String(po.orderId || ""); const orderNumber = Array.isArray(po.orderNumbers) ? String(po.orderNumbers[0] || orderId) : String(po.orderNumber || orderId); const items = purchaseOrderItems(po); return <TableRow key={poId} data-state={selectedIds.has(poId) ? "selected" : undefined}><TableCell><Checkbox checked={selectedIds.has(poId)} onCheckedChange={(checked) => setSelectedIds((current) => { const next = new Set(current); if (checked) next.add(poId); else next.delete(poId); return next })} /></TableCell><TableCell><div className="flex items-center gap-1"><a className="font-medium text-primary hover:underline" href={`/purchase-orders/${encodeURIComponent(poId)}`}>{String(po.poNumber || poId)}</a><Button type="button" size="icon" variant="ghost" className="size-7" title="Quick view" aria-label={`Quick view ${String(po.poNumber || poId)}`} onClick={() => onQuickView(po)}><Eye className="size-4" /></Button></div></TableCell>{visibleColumns.has("order") && <TableCell>{orderId ? <a className="font-medium hover:underline" href={`/orders/${encodeURIComponent(orderId)}`}>{orderNumber}</a> : "-"}</TableCell>}{visibleColumns.has("channel") && <TableCell><Badge variant="outline">{purchaseOrderSalesChannel(po)}</Badge></TableCell>}{visibleColumns.has("supplier") && <TableCell>{String(po.supplier || "Unassigned")}</TableCell>}{visibleColumns.has("shipTo") && <TableCell className="w-44 max-w-44"><p className="truncate" title={[shipTo.name, shipTo.line1, shipTo.city, shipTo.state].filter(Boolean).join(", ")}>{[shipTo.name, shipTo.city, shipTo.state].filter(Boolean).join(", ") || "Address needs review"}</p></TableCell>}{visibleColumns.has("items") && <TableCell><div className="flex max-w-56 flex-wrap gap-1">{items.slice(0, 3).map((line, index) => <Badge key={`${String(line.sku)}-${index}`} variant="secondary">{String(line.sku || "-")}</Badge>)}{items.length > 3 ? <Badge variant="outline">+{items.length - 3}</Badge> : null}</div></TableCell>}{visibleColumns.has("units") && <TableCell>{numberLabel(Number(po.totalUnits || items.reduce((sum, line) => sum + Number(line.qty || 0), 0)))}</TableCell>}{visibleColumns.has("status") && <TableCell><Badge variant={String(po.status || "").toLowerCase() === "ready_to_send" ? "warning" : "outline"}>{String(po.status || "draft").replace(/_/g, " ")}</Badge></TableCell>}{visibleColumns.has("updated") && <TableCell>{dateLabel(String(po.updatedAt || po.createdAt || ""))}</TableCell>}<TableCell className="text-right"><Button size="sm" variant="outline" asChild><a href={`/purchase-orders/${encodeURIComponent(poId)}`}>Open PO</a></Button></TableCell></TableRow> })}{!visibleRows.length && <TableRow><TableCell colSpan={colSpan} className="h-28 text-center text-muted-foreground">No dropship POs match the selected supplier and channel filters.</TableCell></TableRow>}</TableBody></Table></div>
      </CardContent>
    </Card>
    <Dialog open={mergeOpen} onOpenChange={(open) => { if (!merging) setMergeOpen(open) }}><DialogContent className="w-[calc(100%-2rem)] sm:max-w-lg"><DialogHeader><DialogTitle>Merge into one warehouse PO</DialogTitle><DialogDescription>The selected dropship POs will be retained as superseded records. Their customer demand will move to one PO for receiving and allocation at your warehouse.</DialogDescription></DialogHeader><div className="grid gap-4"><Alert><Warehouse className="size-4" /><AlertTitle>{selectedIds.size} PO{selectedIds.size === 1 ? "" : "s"} selected</AlertTitle><AlertDescription>{selectedRows.reduce((sum, po) => sum + purchaseOrderItems(po).length, 0)} lines from {new Set(selectedRows.flatMap((po) => purchaseOrderItems(po).map((line) => String(line.orderId || ""))).filter(Boolean)).size} customer orders.</AlertDescription></Alert><Field label="Receiving warehouse"><Select value={mergeWarehouseId} onValueChange={setMergeWarehouseId}><SelectTrigger><SelectValue placeholder="Choose a warehouse" /></SelectTrigger><SelectContent>{receivingWarehouses.map((warehouse) => <SelectItem key={String(warehouse.id)} value={String(warehouse.id)}>{String(warehouse.name || warehouse.id)}</SelectItem>)}</SelectContent></Select></Field><Field label="Reason (optional)"><Textarea value={mergeReason} onChange={(event) => setMergeReason(event.target.value)} placeholder="Why this demand is being brought into the warehouse" /></Field></div><DialogFooter><Button variant="outline" disabled={merging} onClick={() => setMergeOpen(false)}>Cancel</Button><Button disabled={merging || !mergeWarehouseId || selectedSuppliers.size !== 1} onClick={() => void mergeSelected()}>{merging ? <Loader2 className="size-4 animate-spin" /> : <Warehouse className="size-4" />} Create warehouse PO</Button></DialogFooter></DialogContent></Dialog>
  </div>
}

function PurchasingPage({ operatorName = "Buyer" }: { operatorName?: string } = {}) {
  const fulfillmentCarriers = useFulfillmentCarriers()
  const cachedPurchasingWork = readWorkspaceCache<PurchasingWorkData>("purchasing:work")
  const [data, setData] = useState<PurchasingWorkData>(cachedPurchasingWork || {})
  const [loading, setLoading] = useState(!cachedPurchasingWork)
  const [initialLoadComplete, setInitialLoadComplete] = useState(false)
  const [loadedHistoryScopes, setLoadedHistoryScopes] = useState<Set<string>>(new Set())
  const [historyLoadingScope, setHistoryLoadingScope] = useState("")
  const [creatingOrderId, setCreatingOrderId] = useState("")
  const orderPoRequestIdsRef = useRef(new Map<string, string>())
  const [actingPoId, setActingPoId] = useState("")
  const [approvalDecision, setApprovalDecision] = useState<PurchaseOrderApprovalDecision | null>(null)
  const [rejectionDecision, setRejectionDecision] = useState<PurchaseOrderRejectionDecision | null>(null)
  const [reviewFilter, setReviewFilter] = useState("all")
  const [poolingBusy, setPoolingBusy] = useState(false)
  const [forcePoolOpen, setForcePoolOpen] = useState(false)
  const [createPoOpen, setCreatePoOpen] = useState(false)
  const [createPoSaving, setCreatePoSaving] = useState(false)
  const createPoRequestIdRef = useRef("")
  const [createPoMode, setCreatePoMode] = useState<"choose" | "new" | "external">("choose")
  const [purchaseReferences, setPurchaseReferences] = useState<{ vendors: Array<Record<string, unknown>>; warehouses: Array<Record<string, unknown>> }>({ vendors: [], warehouses: [] })
  const [createPoForm, setCreatePoForm] = useState({ vendorId: "", warehouseId: "", expectedAt: "", notes: "", items: [] as Array<{ sku: string; title: string; qty: string; unitCost: string; vendorSku?: string; brand?: string; manufacturer?: string; catalogProduct?: boolean }> })
  const [externalPoFile, setExternalPoFile] = useState<File | null>(null)
  const [externalPoPreview, setExternalPoPreview] = useState<null | { document: Record<string, unknown>; vendor: Record<string, unknown>; file: Record<string, unknown>; duplicate?: { id?: string; poNumber?: string } | null; readyToCreate?: boolean; unresolvedLineCount?: number; items: Array<Record<string, unknown>> }>(null)
  const [externalPoPreviewing, setExternalPoPreviewing] = useState(false)
  const [quickViewPo, setQuickViewPo] = useState<Record<string, unknown> | null>(null)
  const [quickViewLoading, setQuickViewLoading] = useState(false)
  const [quickViewStatusAction, setQuickViewStatusAction] = useState("")
  const [quickViewTrackingForm, setQuickViewTrackingForm] = useState({ carrier: "", service: "", trackingNumber: "", shipDate: new Date().toISOString().slice(0, 10), expectedAt: "" })
  const [quickViewSaving, setQuickViewSaving] = useState(false)
  const [poCatalogQuery, setPoCatalogQuery] = useState("")
  const [poCatalogResults, setPoCatalogResults] = useState<QuickProductResult[]>([])
  const [poCatalogSearching, setPoCatalogSearching] = useState(false)
  const purchasingTabs = new Set(["attention", "buyer_review", "pool", "approvals", "dropships", "inbound", "receiving", "rejected", "canceled", "archive", "requirements", "performance", "risks"])
  const initialPurchasingParams = new URLSearchParams(window.location.search)
  const requestedPurchasingTabValue = initialPurchasingParams.get("tab") || "attention"
  const requestedPurchasingTab = ["sent", "awaiting_tracking", "incoming"].includes(requestedPurchasingTabValue) ? "inbound" : requestedPurchasingTabValue === "waiting" ? "approvals" : requestedPurchasingTabValue
  const [tab, setTabState] = useState(purchasingTabs.has(requestedPurchasingTab) ? requestedPurchasingTab : "attention")
  const [query, setQueryState] = useState(initialPurchasingParams.get("q") || "")
  const updatePurchasingLocation = (nextTab: string, nextQuery: string) => {
    const params = new URLSearchParams(window.location.search)
    if (nextTab === "attention") params.delete("tab")
    else params.set("tab", nextTab)
    if (nextQuery.trim()) params.set("q", nextQuery)
    else params.delete("q")
    const search = params.toString()
    window.history.replaceState(window.history.state, "", `/purchasing${search ? `?${search}` : ""}`)
  }
  const setTab = (nextTab: string) => {
    const compatibleTab = ["sent", "awaiting_tracking", "incoming"].includes(nextTab) ? "inbound" : nextTab === "waiting" ? "approvals" : nextTab
    const normalizedTab = purchasingTabs.has(compatibleTab) ? compatibleTab : "attention"
    setTabState(normalizedTab)
    updatePurchasingLocation(normalizedTab, query)
  }
  const setQuery = (nextQuery: string) => {
    setQueryState(nextQuery)
    updatePurchasingLocation(tab, nextQuery)
  }
  const loadRemainingPurchaseOrderPages = async (first: PurchasingWorkData, scope = "active") => {
    const totalPages = Math.max(1, Number(first.pagination?.totalPages || 1))
    if (totalPages <= 1) return first.purchaseOrders || []
    const rows = [...(first.purchaseOrders || [])]
    const pages = Array.from({ length: totalPages - 1 }, (_, index) => index + 2)
    const concurrency = 4
    for (let offset = 0; offset < pages.length; offset += concurrency) {
      const results = await Promise.all(pages.slice(offset, offset + concurrency).map((page) => {
        const params = new URLSearchParams({ page: String(page), pageSize: String(first.pagination?.pageSize || 500) })
        if (scope !== "active") params.set("scope", scope)
        else params.set("purchaseOrdersOnly", "1")
        return api<PurchasingWorkData>(`/api/purchasing/work?${params.toString()}`)
      }))
      for (const result of results) rows.push(...(result.purchaseOrders || []))
    }
    return rows
  }
  const load = async () => {
    if (!readWorkspaceCache("purchasing:work")) setLoading(true)
    try {
      const activeResult = await api<PurchasingWorkData>("/api/purchasing/work")
      const activePurchaseOrders = await loadRemainingPurchaseOrderPages(activeResult)
      const historyScope = purchasingHistoryStatusesByScope[tab] ? tab : ""
      const historyResult = historyScope
        ? await api<PurchasingWorkData>(`/api/purchasing/work?scope=${encodeURIComponent(historyScope)}`)
        : null
      const historyPurchaseOrders = historyResult ? await loadRemainingPurchaseOrderPages(historyResult, historyScope) : []
      setData({
        ...activeResult,
        purchaseOrders: [...activePurchaseOrders, ...historyPurchaseOrders],
        purchaseOrderCountsByStatus: historyResult?.purchaseOrderCountsByStatus || activeResult.purchaseOrderCountsByStatus,
      })
      setLoadedHistoryScopes(new Set(historyScope ? [historyScope] : []))
      writeWorkspaceCache("purchasing:work", activeResult)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load purchasing work.") }
    finally { setLoading(false); setInitialLoadComplete(true) }
  }
  const loadHistoryScope = async (scope: string) => {
    if (!purchasingHistoryStatusesByScope[scope] || loadedHistoryScopes.has(scope) || historyLoadingScope) return
    setHistoryLoadingScope(scope)
    try {
      const result = await api<PurchasingWorkData>(`/api/purchasing/work?scope=${encodeURIComponent(scope)}`)
      const purchaseOrders = await loadRemainingPurchaseOrderPages(result, scope)
      setData((current) => {
        const rows = new Map((current.purchaseOrders || []).map((po) => [String(po.id || po.poNumber), po]))
        for (const po of purchaseOrders) rows.set(String(po.id || po.poNumber), po)
        return { ...current, purchaseOrders: [...rows.values()], purchaseOrderCountsByStatus: result.purchaseOrderCountsByStatus || current.purchaseOrderCountsByStatus }
      })
      setLoadedHistoryScopes((current) => new Set(current).add(scope))
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load purchase-order history.") }
    finally { setHistoryLoadingScope("") }
  }
  useEffect(() => {
    void load()
    void api<{ vendors?: Array<Record<string, unknown>>; warehouses?: Array<Record<string, unknown>> }>("/api/purchase-orders/reference-data")
      .then((state) => setPurchaseReferences({ vendors: state.vendors || [], warehouses: state.warehouses || [] }))
      .catch(() => undefined)
  }, [])
  useEffect(() => {
    if (initialLoadComplete && purchasingHistoryStatusesByScope[tab]) void loadHistoryScope(tab)
  }, [tab, initialLoadComplete, historyLoadingScope])
  useEffect(() => {
    if (!quickViewPo) return
    setQuickViewStatusAction("")
    setQuickViewTrackingForm({
      carrier: String(quickViewPo.shippingCarrier || quickViewPo.carrier || ""),
      service: String(quickViewPo.shippingService || quickViewPo.service || ""),
      trackingNumber: String(quickViewPo.trackingNumber || ""),
      shipDate: String(quickViewPo.shipDate || new Date().toISOString().slice(0, 10)).slice(0, 10),
      expectedAt: String(quickViewPo.expectedAt || "").slice(0, 10)
    })
  }, [quickViewPo])
  useEffect(() => {
    const poId = String(quickViewPo?.id || "")
    if (!poId || quickViewPo?._quickViewHydrated === true) return
    let active = true
    setQuickViewLoading(true)
    void api<{ purchaseOrder?: Record<string, unknown>; supplierSubmission?: SupplierSubmissionCapability }>(`/api/purchase-orders/${encodeURIComponent(poId)}`)
      .then((detail) => {
        if (!active) return
        setQuickViewPo((current) => String(current?.id || "") === poId
          ? { ...current, ...(detail.purchaseOrder || {}), supplierSubmission: detail.supplierSubmission || current?.supplierSubmission, _quickViewHydrated: true }
          : current)
      })
      .catch((error) => { if (active) toast.error(error instanceof Error ? error.message : "Unable to load the latest PO details.") })
      .finally(() => { if (active) setQuickViewLoading(false) })
    return () => { active = false }
  }, [quickViewPo?.id, quickViewPo?._quickViewHydrated])
  useEffect(() => {
    if (!createPoOpen || poCatalogQuery.trim().length < 2) { setPoCatalogResults([]); return }
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setPoCatalogSearching(true)
      try {
        const params = new URLSearchParams({ q: poCatalogQuery.trim(), limit: "12" })
        const result = await api<{ products?: QuickProductResult[] }>(`/api/quick-search/products?${params}`, { signal: controller.signal })
        setPoCatalogResults(result.products || [])
      } catch (error) {
        if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : "Unable to search the catalog.")
      } finally { if (!controller.signal.aborted) setPoCatalogSearching(false) }
    }, 100)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [createPoOpen, poCatalogQuery])
  const activePurchaseVendors = purchaseReferences.vendors.filter((vendor) => !["inactive", "retired"].includes(String(vendor.status || "active").toLowerCase())).sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")))
  const receivingWarehouses = purchaseReferences.warehouses.filter((warehouse) => warehouse.isPhysical !== false && warehouse.allowReceiving !== false && !["supplier_feed", "dropship", "virtual", "transfer"].includes(String(warehouse.inventorySourceType || "").toLowerCase())).sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")))
  const openCreatePo = () => {
    const defaultWarehouse = receivingWarehouses.find((warehouse) => warehouse.isDefaultReceiving === true) || receivingWarehouses[0]
    setCreatePoForm({ vendorId: "", warehouseId: String(defaultWarehouse?.id || ""), expectedAt: "", notes: "", items: [] })
    setPoCatalogQuery("")
    setPoCatalogResults([])
    setCreatePoMode("choose")
    setExternalPoFile(null)
    setExternalPoPreview(null)
    createPoRequestIdRef.current = crypto.randomUUID()
    setCreatePoOpen(true)
  }
  const addPoCatalogItem = (product: QuickProductResult) => {
    const sku = String(product.sku || "").trim()
    if (!sku) return
    setCreatePoForm((current) => {
      const existing = current.items.findIndex((line) => line.sku.toLowerCase() === sku.toLowerCase())
      if (existing >= 0) return { ...current, items: current.items.map((line, index) => index === existing ? { ...line, qty: String(Number(line.qty || 0) + 1) } : line) }
      return { ...current, items: [...current.items, { sku, title: String(product.title || sku), qty: "1", unitCost: String(Number(product.cost || 0) || ""), vendorSku: String(product.vendorSku || ""), brand: String(product.brand || ""), manufacturer: String(product.manufacturer || ""), catalogProduct: true }] }
    })
    setPoCatalogQuery("")
    setPoCatalogResults([])
  }
  const updatePoLine = (index: number, patch: Partial<(typeof createPoForm.items)[number]>) => setCreatePoForm((current) => ({ ...current, items: current.items.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line) }))
  const saveManualPo = async () => {
    setCreatePoSaving(true)
    const requestId = createPoRequestIdRef.current || crypto.randomUUID()
    createPoRequestIdRef.current = requestId
    try {
      const result = await api<{ purchaseOrder?: Record<string, unknown>; message?: string }>("/api/purchase-orders", { method: "POST", body: JSON.stringify({ requestId, manual: true, ...createPoForm, items: createPoForm.items.map((line) => ({ ...line, qty: Number(line.qty), estimatedUnitCost: Number(line.unitCost || 0) })), user: operatorName }) })
      const poId = String(result.purchaseOrder?.id || "")
      toast.success(result.message || "Purchase order draft saved.")
      createPoRequestIdRef.current = ""
      setCreatePoOpen(false)
      if (poId) window.location.href = `/purchase-orders/${encodeURIComponent(poId)}`
      else await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to create purchase order.") }
    finally { setCreatePoSaving(false) }
  }
  const externalPoBase64 = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || "")); reader.onerror = () => reject(new Error("The selected PDF could not be read.")); reader.readAsDataURL(file) })
  const previewExternalPo = async () => {
    if (!createPoForm.vendorId) return toast.error("Choose the supplier shown on the external PO.")
    if (!externalPoFile) return toast.error("Choose a purchase-order PDF.")
    if (externalPoFile.size > 10 * 1024 * 1024) return toast.error("Purchase-order PDFs must be smaller than 10 MB.")
    setExternalPoPreviewing(true)
    try {
      const preview = await api<{ document: Record<string, unknown>; vendor: Record<string, unknown>; file: Record<string, unknown>; duplicate?: { id?: string; poNumber?: string } | null; readyToCreate?: boolean; unresolvedLineCount?: number; items: Array<Record<string, unknown>> }>("/api/purchase-orders/external-preview", { method: "POST", body: JSON.stringify({ vendorId: createPoForm.vendorId, fileName: externalPoFile.name, pdfBase64: await externalPoBase64(externalPoFile) }) })
      setExternalPoPreview(preview)
    } catch (error) { setExternalPoPreview(null); toast.error(error instanceof Error ? error.message : "Unable to read this external PO.") }
    finally { setExternalPoPreviewing(false) }
  }
  const saveExternalPo = async () => {
    if (!createPoForm.vendorId || !createPoForm.warehouseId || !externalPoFile || !externalPoPreview?.readyToCreate) return toast.error("Preview a valid PDF before adding this purchase order.")
    setCreatePoSaving(true)
    const requestId = createPoRequestIdRef.current || crypto.randomUUID()
    createPoRequestIdRef.current = requestId
    try {
      const result = await api<{ purchaseOrder?: Record<string, unknown>; message?: string }>("/api/purchase-orders", { method: "POST", body: JSON.stringify({ requestId, external: true, vendorId: createPoForm.vendorId, warehouseId: createPoForm.warehouseId, notes: createPoForm.notes, fileName: externalPoFile.name, pdfBase64: await externalPoBase64(externalPoFile), user: operatorName }) })
      const poId = String(result.purchaseOrder?.id || "")
      toast.success(result.message || "External purchase order added.")
      createPoRequestIdRef.current = ""
      setCreatePoOpen(false)
      if (poId) window.location.href = `/purchase-orders/${encodeURIComponent(poId)}`
      else await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to add this external purchase order.") }
    finally { setCreatePoSaving(false) }
  }
  const createForOrder = async (orderId: string) => {
    setCreatingOrderId(orderId)
    const requestId = orderPoRequestIdsRef.current.get(orderId) || crypto.randomUUID()
    orderPoRequestIdsRef.current.set(orderId, requestId)
    try {
      const result = await api<{ purchaseOrders?: Array<Record<string, unknown>>; message?: string }>(`/api/orders/${encodeURIComponent(orderId)}/purchase-orders`, { method: "POST", body: JSON.stringify({ requestId, user: operatorName }) })
      toast.success(result.message || "Supplier-specific purchase order created.")
      orderPoRequestIdsRef.current.delete(orderId)
      await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to create purchase order.") } finally { setCreatingOrderId("") }
  }
  const actOnPo = async (poId: string, action: "approve" | "hold" | "reject" | "reopen") => {
    if (action === "reopen" && !window.confirm("Return this purchase order to Draft? Its approval will be reset.")) return
    if (action === "reject") {
      const po = (data.purchaseOrders || []).find((row) => String(row.id || "") === poId)
      setRejectionDecision({ id: poId, poNumber: String(po?.poNumber || poId), supplier: String(po?.supplier || "the supplier") })
      return
    }
    setActingPoId(poId)
    try {
      const detail = action === "approve" ? await api<{ purchaseOrder?: Record<string, unknown>; supplierSubmission?: SupplierSubmissionCapability }>(`/api/purchase-orders/${encodeURIComponent(poId)}`) : null
      await api(`/api/purchase-orders/${encodeURIComponent(poId)}/action`, { method: "POST", body: JSON.stringify({ action, user: operatorName }) })
      if (action === "approve") {
        const approvedPo = detail?.purchaseOrder || {}
        setApprovalDecision({ id: poId, poNumber: String(approvedPo.poNumber || poId), supplier: String(approvedPo.supplier || "the supplier"), capability: detail?.supplierSubmission || {} })
        toast.success(`${String(approvedPo.poNumber || "PO")} approved. Choose how it was placed.`)
      } else toast.success(action === "reopen" ? "PO returned to Draft." : `PO ${action}d.`)
      await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update PO.") } finally { setActingPoId("") }
  }
  const rejectPo = async (disposition: string, note: string, externalPlacement?: { sourceSystem: string; externalPoNumber: string; noTrackingNeeded: boolean }) => {
    if (!rejectionDecision || actingPoId) return
    setActingPoId(rejectionDecision.id)
    try {
      const result = await api<{ message?: string }>(`/api/purchase-orders/${encodeURIComponent(rejectionDecision.id)}/action`, { method: "POST", body: JSON.stringify({ action: "reject", disposition, note, ...externalPlacement, user: operatorName }) })
      toast.success(result.message || `${rejectionDecision.poNumber} rejected.`)
      setRejectionDecision(null)
      await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to reject the PO.") }
    finally { setActingPoId("") }
  }
  const continueApprovedPo = async (po: Record<string, unknown>) => {
    const poId = String(po.id || "")
    if (!poId || actingPoId) return
    setActingPoId(poId)
    try {
      const detail = await api<{ purchaseOrder?: Record<string, unknown>; supplierSubmission?: SupplierSubmissionCapability }>(`/api/purchase-orders/${encodeURIComponent(poId)}`)
      const current = detail.purchaseOrder || po
      if (String(((current.approval || {}) as Record<string, unknown>).status || "").toLowerCase() !== "approved") throw new Error("This purchase order still needs approval.")
      setApprovalDecision({ id: poId, poNumber: String(current.poNumber || poId), supplier: String(current.supplier || "the supplier"), capability: detail.supplierSubmission || {} })
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load placement options.") }
    finally { setActingPoId("") }
  }
  const runPurchasePool = async (force = false) => {
    setPoolingBusy(true)
    try {
      const result = await api<{ message?: string; purchaseOrders?: Array<Record<string, unknown>> }>("/api/purchasing/pool/run", { method: "POST", body: JSON.stringify({ force, user: operatorName }) })
      toast.success(result.message || `${numberLabel(result.purchaseOrders?.length || 0)} supplier POs created.`)
      setForcePoolOpen(false)
      await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to process pooled supplier demand.") } finally { setPoolingBusy(false) }
  }
  const purchasingSearch = query.trim().toLowerCase()
  const compactPurchasingSearch = purchasingSearch.replace(/[^a-z0-9]+/g, "")
  const matchesPurchasingSearch = (row: Record<string, unknown>) => {
    if (!purchasingSearch) return true
    if (/[\r\n,;]/.test(query)) return matchesSearch(row, query)
    const searchable = JSON.stringify(row).toLowerCase()
    return searchable.includes(purchasingSearch)
      || (compactPurchasingSearch.length >= 2 && searchable.replace(/[^a-z0-9]+/g, "").includes(compactPurchasingSearch))
  }
  const requirements = (data.requirements || []).filter(matchesPurchasingSearch)
  const archivedPoStatuses = new Set(["superseded", "canceled", "cancelled", "rejected", "deleted", "received", "closed", "shipped", "completed"])
  const supplierCommittedStatuses = new Set(["submitted", "placed", "sent", "acknowledged", "vendor_confirmed", "awaiting_tracking"])
  const allPos = (data.purchaseOrders || []).filter(matchesPurchasingSearch)
  const pos = allPos.filter((row) => !archivedPoStatuses.has(String(row.status || "").toLowerCase()))
  const canceledPos = allPos.filter((row) => ["canceled", "cancelled"].includes(String(row.status || "").toLowerCase()))
  const rejectedPos = allPos.filter((row) => String(row.status || "").toLowerCase() === "rejected")
  const archivedPos = allPos.filter((row) => archivedPoStatuses.has(String(row.status || "").toLowerCase()) && !["canceled", "cancelled", "rejected"].includes(String(row.status || "").toLowerCase()))
  const purchaseOrderCountsByStatus = data.purchaseOrderCountsByStatus || {}
  const historyCount = (scope: string, filteredRows: Array<Record<string, unknown>>) => purchasingSearch && loadedHistoryScopes.has(scope)
    ? filteredRows.length
    : [...(purchasingHistoryStatusesByScope[scope] || [])].reduce((sum, status) => sum + Number(purchaseOrderCountsByStatus[status] || 0), 0)
  const rejectedCount = historyCount("rejected", rejectedPos)
  const canceledCount = historyCount("canceled", canceledPos)
  const archivedCount = historyCount("archive", archivedPos)
  const isDropshipPo = (po: Record<string, unknown>) => String(po.fulfillmentMode || "").toLowerCase() === "dropship_per_order" || po.directToCustomer === true
  const openPurchaseOrderQuickView = (po: Record<string, unknown>) => setQuickViewPo(po)
  const dropshipPos = pos.filter((po) => isDropshipPo(po) && !purchaseOrderHasSubmission(po) && !supplierCommittedStatuses.has(String(po.status || "").toLowerCase()))
  const collectingPurchaseOrders = allPos.filter((po) => !isDropshipPo(po) && purchaseOrderIsWaiting(po))
  const readyToSubmitPos = allPos.filter((po) => !isDropshipPo(po) && purchaseOrderIsReadyToSubmit(po))
  const waitingSupplierGroups = groupWaitingPurchaseOrders(collectingPurchaseOrders)
  const waitingOrderIds = new Set(collectingPurchaseOrders.flatMap((po) => purchaseOrderItems(po).map((line) => String(line.orderId || "")).filter(Boolean)))
  const waitingUnits = collectingPurchaseOrders.reduce((sum, po) => sum + purchaseOrderItems(po).reduce((lineSum, line) => lineSum + Number(line.qty || 0), 0), 0)
  const receivingPos = allPos.filter((po) => !isDropshipPo(po) && (["partially_received", "receiving"].includes(String(po.status || "").toLowerCase()) || (Array.isArray(po.receiptDrafts) && po.receiptDrafts.length > 0)))
  const incomingPos = allPos.filter((po) => !isDropshipPo(po) && !receivingPos.includes(po) && (String(po.status || "").toLowerCase() === "in_transit" || String(po.workflowStage || "").toLowerCase() === "incoming"))
  const awaitingTrackingPos = allPos.filter((po) => {
    const status = String(po.status || "").toLowerCase()
    return !archivedPoStatuses.has(status)
      && !["partially_received", "receiving"].includes(status)
      && String(po.workflowStage || "").toLowerCase() !== "incoming"
      && po.noTrackingNeeded !== true
      && !purchaseOrderIsWaiting(po)
      && !purchaseOrderHasTracking(po)
      && (purchaseOrderHasSubmission(po) || supplierCommittedStatuses.has(status))
  })
  const inboundPos = [...awaitingTrackingPos, ...incomingPos].sort((left, right) => new Date(String(right.placedAt || right.submittedAt || right.updatedAt || 0)).getTime() - new Date(String(left.placedAt || left.submittedAt || left.updatedAt || 0)).getTime())
  const pooledRequirements = requirements.filter((row) => String(row.status || "").toLowerCase() === "pooled")
  const pooledSupplierGroups = groupPooledRequirements(pooledRequirements)
  const buyerReviewRequirements = requirements.filter((row) => String(row.status || "").toLowerCase() === "buyer_review")
  const poolSummary = data.poolSummary || {}
  const reviewStateForPo = (po: Record<string, unknown>) => {
    const status = String(po.status || "draft").toLowerCase()
    const approvalStatus = String((((po.approval || {}) as Record<string, unknown>).status || "")).toLowerCase()
    if (status === "hold") return { key: "on_hold", label: "On hold", description: "A buyer must return this PO to draft before it can continue.", variant: "destructive" as const, priority: 5 }
    if (po.manualDraftHold === true) return { key: "reopened_draft", label: "Reopened draft", description: "This PO was deliberately returned to draft. A manager can approve and place it now; it will not submit automatically.", variant: "outline" as const, priority: 4 }
    if (approvalStatus === "approved") return { key: "approved_not_sent", label: "Approved, not sent", description: "Approval is complete, but supplier placement has not been confirmed.", variant: "secondary" as const, priority: 3 }
    if (purchaseOrderIsWaiting(po)) return { key: "collecting", label: "Collecting", description: "Eligible demand can continue joining this draft until its supplier cutoff.", variant: "secondary" as const, priority: 1 }
    if (String(po.type || "").toLowerCase() === "customer_demand" && waitingPoCutoff(po) <= Date.now()) return { key: "placement_overdue", label: "Placement overdue", description: "The supplier cutoff passed without confirmed placement. Approve it, link an external PO, reschedule it, or reject it with a disposition.", variant: "destructive" as const, priority: 5 }
    if (((po.approval || {}) as Record<string, unknown>).required === true || status === "awaiting_approval") return { key: "needs_approval", label: "Needs approval", description: "Buyer approval is required before supplier placement.", variant: "outline" as const, priority: 4 }
    return { key: "draft_ready", label: "Draft ready", description: "This draft is ready for buyer review and approval.", variant: "outline" as const, priority: 2 }
  }
  const reviewPurchaseOrders = Array.from(new Map<string, Record<string, unknown>>([...collectingPurchaseOrders, ...readyToSubmitPos, ...pos.filter((po) => !isDropshipPo(po) && String(po.status || "").toLowerCase() === "hold")].map((po): [string, Record<string, unknown>] => [String(po.id || po.poNumber), po])).values())
  const reviewCounts = reviewPurchaseOrders.reduce<Record<string, number>>((counts, po) => { const key = reviewStateForPo(po).key; counts[key] = Number(counts[key] || 0) + 1; return counts }, {})
  const approvalQueue = reviewPurchaseOrders.filter((po) => reviewFilter === "all" || reviewStateForPo(po).key === reviewFilter).sort((left, right) => reviewStateForPo(right).priority - reviewStateForPo(left).priority || waitingPoCutoff(left) - waitingPoCutoff(right))
  const approvedNotSentCount = reviewCounts.approved_not_sent || 0
  const needsApprovalCount = (reviewCounts.needs_approval || 0) + (reviewCounts.placement_overdue || 0) + (reviewCounts.draft_ready || 0) + (reviewCounts.reopened_draft || 0)
  const reviewActionCount = reviewPurchaseOrders.filter((po) => reviewStateForPo(po).key !== "collecting").length
  const vendorReturnAttentionCount = Number(data.vendorReturnSummary?.attentionCount || 0)
  const today = new Date().toISOString().slice(0, 10)
  const supplierPerformance: any[] = Object.values(pos.reduce((groups, po) => { const key = String(po.vendorId || po.supplier || "unassigned"); const group = (groups as any)[key] || { vendorId: String(po.vendorId || ""), supplier: String(po.supplier || "Unassigned"), total: 0, open: 0, received: 0, acknowledged: 0, overdue: 0, commitment: 0, units: 0, receivedUnits: 0 }; group.total += 1; group.units += Number(po.totalUnits || 0); group.receivedUnits += (Array.isArray(po.items) ? po.items as Array<Record<string, unknown>> : []).reduce((sum, line) => sum + Number(line.receivedQty || 0), 0); group.commitment += Number(po.openEstimatedCost ?? po.estimatedCost ?? 0); const status = String(po.status || "").toLowerCase(); if (!["received", "closed", "canceled", "rejected"].includes(status)) group.open += 1; if (["received", "closed"].includes(status)) group.received += 1; if (po.vendorAcknowledgement || ["vendor_confirmed", "partially_received", "received", "closed"].includes(status)) group.acknowledged += 1; if (!["received", "closed", "canceled", "rejected"].includes(status) && String(po.expectedAt || "") && String(po.expectedAt) < today) group.overdue += 1; (groups as any)[key] = group; return groups }, {} as Record<string, { vendorId: string; supplier: string; total: number; open: number; received: number; acknowledged: number; overdue: number; commitment: number; units: number; receivedUnits: number }>))
  const performanceTotals = { suppliers: supplierPerformance.length, onTime: supplierPerformance.reduce((sum, row) => sum + Math.max(0, row.received - row.overdue), 0), received: supplierPerformance.reduce((sum, row) => sum + row.received, 0), acknowledged: supplierPerformance.reduce((sum, row) => sum + row.acknowledged, 0), total: supplierPerformance.reduce((sum, row) => sum + row.total, 0), commitment: supplierPerformance.reduce((sum, row) => sum + row.commitment, 0) }
  const risks = [
    ...requirements.filter((row) => String(row.status || "").includes("exception") || String(row.status || "").toLowerCase() === "buyer_review" || !String(row.vendorId || "").trim()).map((row) => ({ kind: "Requirement", id: String(row.id), reference: String(row.orderNumber || row.sku || "Requirement"), detail: String(row.reviewReason || (!String(row.vendorId || "").trim() ? "No supplier assigned" : String(row.status || "Exception"))), href: `/orders/${encodeURIComponent(String(row.orderId || ""))}` })),
    ...pos.filter((po) => !["received", "closed", "canceled"].includes(String(po.status || "")) && String(po.expectedAt || "") && String(po.expectedAt) < today).map((po) => ({ kind: "PO", id: String(po.id), reference: String(po.poNumber || po.id), detail: `Overdue: expected ${String(po.expectedAt)}`, href: `/purchase-orders/${encodeURIComponent(String(po.id || ""))}` }))
  ]
  const attentionCount = buyerReviewRequirements.length + reviewActionCount + receivingPos.length + vendorReturnAttentionCount
  const quickViewItems = quickViewPo ? purchaseOrderItems(quickViewPo) : []
  const quickViewApproval = quickViewPo ? purchaseOrderOperator(quickViewPo, "approval") : { name: "", at: "" }
  const quickViewPlacement = quickViewPo ? purchaseOrderOperator(quickViewPo, "placement") : { name: "", at: "" }
  const quickViewTracking = quickViewPo ? purchaseOrderTrackingState(quickViewPo) : { label: "Tracking pending", variant: "warning" as const }
  const quickViewTimeline = quickViewPo && Array.isArray(quickViewPo.timeline) ? [...quickViewPo.timeline as Array<Record<string, unknown>>].reverse().slice(0, 12) : []
  const quickViewChannelOrders = quickViewPo ? [...new Map((Array.isArray(quickViewPo.channelOrders) ? quickViewPo.channelOrders as Array<Record<string, unknown>> : quickViewItems.map((line) => ({ orderId: line.orderId, orderNumber: line.orderNumber, channelOrderNumber: line.channelOrderNumber, channel: line.salesChannel })))
    .filter((entry) => entry.channelOrderNumber || entry.orderNumber || entry.orderId)
    .map((entry) => [String(entry.orderId || entry.orderNumber || entry.channelOrderNumber), entry])).values()] : []
  const quickViewStatus = String(quickViewPo?.status || "draft").toLowerCase()
  const quickViewStatusOptions = quickViewStatus === "draft"
    ? [{ value: "approve", label: "Approve and choose placement" }, { value: "hold", label: "On hold" }]
    : quickViewStatus === "ready_to_send"
      ? [{ value: "mark_placed", label: "PO has been placed with vendor" }, { value: "hold", label: "On hold" }, { value: "reopen", label: "Return to draft" }]
      : ["hold", "rejected"].includes(quickViewStatus)
        ? [{ value: "reopen", label: "Return to draft" }, { value: "approve", label: "Approve and choose placement" }]
        : ["submitted", "placed", "awaiting_tracking", "vendor_confirmed", "acknowledged"].includes(quickViewStatus)
          ? [{ value: "mark_inbound", label: "Mark inbound" }, { value: "acknowledge", label: "Supplier confirmed" }]
          : quickViewStatus === "received"
            ? [{ value: "close", label: "Closed" }]
            : []
  const quickViewCarrierOptions = enabledCarrierNames(fulfillmentCarriers, quickViewTrackingForm.carrier).filter((carrier) => carrier !== "Other")
  const quickViewServiceOptions = enabledCarrierServices(fulfillmentCarriers, quickViewTrackingForm.carrier, quickViewTrackingForm.service)
  const saveQuickViewStatus = async () => {
    if (!quickViewPo?.id || !quickViewStatusAction || quickViewSaving) return
    setQuickViewSaving(true)
    try {
      const poId = String(quickViewPo.id)
      const action = quickViewStatusAction
      const detail = action === "approve"
        ? await api<{ purchaseOrder?: Record<string, unknown>; supplierSubmission?: SupplierSubmissionCapability }>(`/api/purchase-orders/${encodeURIComponent(poId)}`)
        : null
      const result = await api<{ purchaseOrder?: Record<string, unknown> }>(`/api/purchase-orders/${encodeURIComponent(String(quickViewPo.id))}/action`, { method: "POST", body: JSON.stringify({ action: quickViewStatusAction, user: operatorName, noTrackingNeeded: false }) })
      if (result.purchaseOrder) setQuickViewPo((current) => current ? { ...current, ...result.purchaseOrder } : result.purchaseOrder || null)
      setQuickViewStatusAction("")
      if (action === "approve") {
        const approvedPo = result.purchaseOrder || detail?.purchaseOrder || quickViewPo
        setApprovalDecision({ id: poId, poNumber: String(approvedPo.poNumber || poId), supplier: String(approvedPo.supplier || "the supplier"), capability: detail?.supplierSubmission || {} })
        toast.success(`${String(approvedPo.poNumber || "PO")} approved. Choose how it was placed.`)
      } else toast.success("Purchase-order status updated.")
      await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update the PO status.") }
    finally { setQuickViewSaving(false) }
  }
  const saveQuickViewTracking = async () => {
    if (!quickViewPo?.id || !quickViewTrackingForm.carrier || !quickViewTrackingForm.service || !quickViewTrackingForm.trackingNumber.trim() || quickViewSaving) return
    setQuickViewSaving(true)
    try {
      const endpoint = isDropshipPo(quickViewPo) ? "dropship-tracking" : "inbound-tracking"
      const result = await api<{ purchaseOrder?: Record<string, unknown>; message?: string }>(`/api/purchase-orders/${encodeURIComponent(String(quickViewPo.id))}/${endpoint}`, { method: "POST", body: JSON.stringify({ ...quickViewTrackingForm, carrierName: quickViewTrackingForm.carrier, user: operatorName }) })
      if (result.purchaseOrder) setQuickViewPo((current) => current ? { ...current, ...result.purchaseOrder } : result.purchaseOrder || null)
      toast.success(result.message || "Tracking saved.")
      await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save tracking.") }
    finally { setQuickViewSaving(false) }
  }
  return <div className="grid gap-5">
    <PageHeader eyebrow="Buyer operations" title="Purchasing" description="Review customer demand, create supplier-specific POs, submit them, and receive inventory into the destination warehouse." action={<div className="flex flex-wrap gap-2"><Button size="sm" onClick={openCreatePo}><Plus className="size-4" /> New PO</Button><ContextActions disabled={loading} actions={[
      { id: "refresh", label: "Refresh purchasing", description: "Reload purchase requirements, POs, approvals, and supplier scorecards.", icon: loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />, onSelect: () => void load() },
      { id: "buyer-review", label: "Open Unassigned Orders", description: "Assign a supplier to paid order lines that could not be routed automatically.", icon: <AlertCircle className="size-4" />, onSelect: () => setTab("buyer_review") },
      { id: "approvals", label: "Open purchase-order review", description: "See collecting drafts, approvals, overdue placement, and approved POs in one queue.", icon: <ShieldCheck className="size-4" />, onSelect: () => setTab("approvals") },
      { id: "dropships", label: "Open Dropships", description: "Review one-customer POs that will ship directly from the supplier.", icon: <Truck className="size-4" />, onSelect: () => setTab("dropships") },
      { id: "inbound", label: "Open Inbound", description: "Review placed POs from tracking pending through arrival at the warehouse.", icon: <Truck className="size-4" />, onSelect: () => setTab("inbound") },
      { id: "receiving", label: "Open Receiving", description: "Track partially received and actively receiving purchase orders.", icon: <PackageSearch className="size-4" />, onSelect: () => setTab("receiving") },
      ...(pooledRequirements.length ? [{ id: "repair-legacy-pool", label: "Attach older lines to Draft POs", description: "Group older purchase lines into local numbered Draft POs. Nothing is sent to suppliers.", icon: <RefreshCw className="size-4" />, onSelect: () => setForcePoolOpen(true) }] : []),
      { id: "requirements", label: "Trace order lines", description: "Follow a customer-order line into its supplier and linked PO when troubleshooting.", icon: <ShoppingBag className="size-4" />, group: "Utilities", onSelect: () => setTab("requirements") },
      { id: "supplier-po-reconciliation", label: "Supplier PO reconciliation", description: "Import external supplier POs and compare dated paid costs before applying historical cost evidence.", icon: <FileUp className="size-4" />, group: "Utilities", onSelect: () => { window.location.href = "/purchasing/reconciliation" } },
      { id: "performance", label: "Supplier scorecards", description: "Review supplier acknowledgement, fill rate, and overdue-receipt history.", icon: <Truck className="size-4" />, group: "Utilities", onSelect: () => setTab("performance") },
      { id: "risk", label: "Supply issues", description: "Review only unresolved sourcing problems and overdue supplier receipts.", icon: <AlertCircle className="size-4" />, group: "Utilities", onSelect: () => setTab("risks") },
      { id: "supplier-returns", label: "Supplier returns", description: "Review received customer returns that need a supplier return, RMA, shipment, or credit decision.", icon: <RotateCcw className="size-4" />, group: "Utilities", onSelect: () => { window.location.href = "/purchasing/supplier-returns" } },
      { id: "rejected", label: "Open Rejected POs", description: "Review declined, unsubmitted POs and the selected demand disposition.", icon: <X className="size-4" />, group: "Utilities", onSelect: () => setTab("rejected") },
      { id: "canceled", label: "Open Canceled POs", description: "Review canceled purchase orders and their recorded reasons.", icon: <Ban className="size-4" />, group: "Utilities", onSelect: () => setTab("canceled") },
      { id: "history", label: "View PO history", description: "Review completed, replaced, closed, and deleted purchase orders.", icon: <History className="size-4" />, group: "Utilities", onSelect: () => setTab("archive") },
    ]} /></div>} />
    <Tabs value={tab} onValueChange={setTab}>
      <div className="overflow-x-auto rounded-md border bg-card p-1"><TabsList className="h-auto min-w-max justify-start bg-transparent p-0 [&_[role=tab]]:h-8 [&_[role=tab]]:px-2 [&_[role=tab]]:text-xs"><TabsTrigger value="attention">Needs attention ({numberLabel(attentionCount)})</TabsTrigger><TabsTrigger value="buyer_review">Sourcing ({numberLabel(buyerReviewRequirements.length)})</TabsTrigger><TabsTrigger value="approvals">Review &amp; send ({numberLabel(reviewPurchaseOrders.length)})</TabsTrigger><TabsTrigger value="dropships">Dropships ({numberLabel(dropshipPos.length)})</TabsTrigger><TabsTrigger value="inbound">Inbound ({numberLabel(inboundPos.length)})</TabsTrigger><TabsTrigger value="receiving">Receiving ({numberLabel(receivingPos.length)})</TabsTrigger><TabsTrigger value="rejected">Rejected ({numberLabel(rejectedCount)})</TabsTrigger><TabsTrigger value="canceled">Canceled ({numberLabel(canceledCount)})</TabsTrigger><TabsTrigger value="archive">History ({numberLabel(archivedCount)})</TabsTrigger></TabsList></div>
      <div className="mt-4 flex max-w-3xl flex-wrap gap-2"><div className="relative min-w-64 flex-1"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} onPaste={(event) => normalizePastedSearch(event, query, setQuery)} placeholder="Search or paste POs, orders, SKUs, tracking..." /></div><BulkSearchActions onApply={setQuery} /></div>
      <TabsContent value="attention" className="mt-4">
        <Card>
          <CardHeader className="border-b">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><CardTitle className="text-base">Needs attention</CardTitle><CardDescription className="mt-1">Only work that requires a person is listed here. Open a queue, complete the decision, and the item leaves this list.</CardDescription></div>
              <Badge variant={attentionCount ? "warning" : "success"}>{attentionCount ? `${numberLabel(attentionCount)} open` : "All clear"}</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {attentionCount ? <div className="divide-y">
              {buyerReviewRequirements.length > 0 && <div className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="flex min-w-0 gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300"><AlertCircle className="size-4" /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">Assign a supplier</p><Badge variant="warning">{numberLabel(buyerReviewRequirements.length)}</Badge></div><p className="mt-1 text-sm text-muted-foreground">Paid order lines cannot move forward until a supplier is selected.</p></div></div><Button size="sm" variant="outline" onClick={() => setTab("buyer_review")}>Open sourcing</Button></div>}
              {reviewActionCount > 0 && <div className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="flex min-w-0 gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-md bg-blue-500/10 text-blue-700 dark:text-blue-300"><ShieldCheck className="size-4" /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">Approve or place purchase orders</p><Badge variant="warning">{numberLabel(reviewActionCount)}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{numberLabel(needsApprovalCount)} need a buyer decision{approvedNotSentCount ? `; ${numberLabel(approvedNotSentCount)} are approved and still need supplier placement` : ""}.</p></div></div><Button size="sm" onClick={() => setTab("approvals")}>Review POs</Button></div>}
              {receivingPos.length > 0 && <div className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="flex min-w-0 gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><PackageSearch className="size-4" /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">Finish receiving inventory</p><Badge variant="warning">{numberLabel(receivingPos.length)}</Badge></div><p className="mt-1 text-sm text-muted-foreground">A receiving count has started or a PO was only partially received.</p></div></div><Button size="sm" variant="outline" onClick={() => setTab("receiving")}>Open receiving</Button></div>}
              {vendorReturnAttentionCount > 0 && <div className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="flex min-w-0 gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300"><RotateCcw className="size-4" /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">Decide supplier returns</p><Badge variant="warning">{numberLabel(vendorReturnAttentionCount)}</Badge></div><p className="mt-1 text-sm text-muted-foreground">Returned inventory is waiting for an RMA, return shipment, or supplier credit decision.</p></div></div><Button size="sm" variant="outline" asChild><a href="/purchasing/supplier-returns">Review returns</a></Button></div>}
            </div> : <div className="flex items-center gap-3 p-6"><CheckCircle2 className="size-5 text-emerald-600" /><div><p className="font-medium">No buyer action is due</p><p className="text-sm text-muted-foreground">Collecting drafts and POs already with suppliers remain available in their own tabs.</p></div></div>}
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="waiting" className="mt-4 grid gap-4">
        <Alert><Clock3 className="size-4" /><AlertTitle>Drafts are still collecting demand</AlertTitle><AlertDescription>Nothing is sent while a PO is in this stage. The cutoff moves it to Review & send, where the buyer approves and submits it.</AlertDescription></Alert>
        <Card><CardHeader className="border-b"><CardTitle className="text-base">Draft POs</CardTitle><CardDescription>{numberLabel(collectingPurchaseOrders.length)} numbered draft PO{collectingPurchaseOrders.length === 1 ? "" : "s"} are collecting {numberLabel(waitingUnits)} units across {numberLabel(waitingOrderIds.size)} customer order{waitingOrderIds.size === 1 ? "" : "s"}. The schedule shows the actual supplier cutoff and expected delivery.</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Supplier</TableHead><TableHead>Draft POs</TableHead><TableHead>Orders</TableHead><TableHead>SKUs</TableHead><TableHead>Units</TableHead><TableHead>Open cost</TableHead><TableHead>Receiving destination</TableHead><TableHead>Schedule</TableHead><TableHead>Next step</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{waitingSupplierGroups.map((group) => { const destinations = [...group.destinations]; const nextStep = group.purchaseOrders.map(purchaseOrderNextStep).sort((left, right) => right.priority - left.priority)[0]; return <TableRow key={group.key}><TableCell><a className="font-medium hover:underline" href={`/purchasing/waiting-for-po/${encodeURIComponent(group.key)}`}>{group.supplier}</a></TableCell><TableCell>{numberLabel(group.purchaseOrders.length)}</TableCell><TableCell>{numberLabel(group.orderIds.size)}</TableCell><TableCell>{numberLabel(group.skus.size)}</TableCell><TableCell>{numberLabel(group.units)}</TableCell><TableCell>{moneyLabel(group.estimatedCost)}</TableCell><TableCell className="max-w-56"><p className="truncate" title={destinations.join(", ")}>{destinations.length === 1 ? destinations[0] : `${numberLabel(destinations.length)} destinations`}</p></TableCell><TableCell>{group.nextCutoffPo ? <PurchaseScheduleSummary record={group.nextCutoffPo} compact /> : "Not scheduled"}</TableCell><TableCell><div className="grid max-w-56 gap-1"><Badge variant={nextStep?.variant || "secondary"} className="w-fit">{nextStep?.label || "Collecting orders"}</Badge><span className="text-xs text-muted-foreground">{nextStep?.description || "New eligible orders keep joining this supplier draft."}</span></div></TableCell><TableCell className="text-right"><Button size="sm" variant="outline" asChild><a href={`/purchasing/waiting-for-po/${encodeURIComponent(group.key)}`}>Open draft</a></Button></TableCell></TableRow>})}{!waitingSupplierGroups.length && <TableRow><TableCell colSpan={10} className="h-28 text-center text-muted-foreground">No draft POs are collecting orders. Check Ready to Send for drafts that need buyer action.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
      </TabsContent>
      <TabsContent value="pool" className="mt-4 grid gap-4">
        <Alert><Clock3 className="size-4" /><AlertTitle>Supplier demand is pooled before PO creation</AlertTitle><AlertDescription>DataPlus groups unfulfilled supplier lines by supplier and receiving warehouse until the cutoff. Physical warehouse stock bypasses this queue and goes directly to fulfillment. Next cutoff: {poolSummary.nextCutoff ? dateLabel(String(poolSummary.nextCutoff)) : "not scheduled"}.</AlertDescription></Alert>
        <Card><CardHeader className="gap-3 border-b lg:flex-row lg:items-center lg:justify-between"><div><CardTitle className="text-base">Demand waiting for supplier POs</CardTitle><CardDescription>{numberLabel(Number(poolSummary.units || 0))} units across {numberLabel(pooledSupplierGroups.length)} supplier pool{pooledSupplierGroups.length === 1 ? "" : "s"}. Open a supplier to review every linked customer order.</CardDescription></div><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={poolingBusy || Number(poolSummary.dueRequirements || 0) === 0} onClick={() => void runPurchasePool(false)}>{poolingBusy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Run due cutoffs</Button><Button disabled={poolingBusy || pooledRequirements.length === 0} onClick={() => setForcePoolOpen(true)}>Create pooled POs now</Button></div></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Supplier</TableHead><TableHead>Orders</TableHead><TableHead>SKUs</TableHead><TableHead>Units</TableHead><TableHead>Receiving destination</TableHead><TableHead>Next cutoff</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{pooledSupplierGroups.map((group) => { const cutoff = group.nextCutoff || {}; const destinationNames = [...group.destinations]; return <TableRow key={group.key}><TableCell><a className="font-medium hover:underline" href={`/purchasing/supplier-pools/${encodeURIComponent(group.key)}`}>{group.supplier}</a><p className="text-xs text-muted-foreground">{numberLabel(group.poGroups.size)} PO group{group.poGroups.size === 1 ? "" : "s"}</p></TableCell><TableCell>{numberLabel(group.orderIds.size)}</TableCell><TableCell>{numberLabel(group.skus.size)}</TableCell><TableCell>{numberLabel(group.units)}</TableCell><TableCell className="max-w-64"><p className="truncate" title={destinationNames.join(", ")}>{destinationNames.length === 1 ? destinationNames[0] : `${numberLabel(destinationNames.length)} destinations`}</p>{destinationNames.length > 1 && <p className="truncate text-xs text-muted-foreground">{destinationNames.join(", ")}</p>}</TableCell><TableCell className="whitespace-nowrap">{String(cutoff.cutoffTime || "15:00")}<p className="text-xs text-muted-foreground">{String(cutoff.poolDate || cutoff.cutoffDate || "Next business day")}</p></TableCell><TableCell><Badge variant={group.due ? "destructive" : "secondary"}>{group.due ? "Cutoff due" : "Pooling"}</Badge></TableCell><TableCell className="text-right"><Button size="sm" variant="outline" asChild><a href={`/purchasing/supplier-pools/${encodeURIComponent(group.key)}`}>View orders</a></Button></TableCell></TableRow>})}{!pooledSupplierGroups.length && <TableRow><TableCell colSpan={8} className="h-28 text-center text-muted-foreground">No supplier demand is waiting in the cutoff pool.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
      </TabsContent>
      <TabsContent value="buyer_review" className="mt-4 grid gap-4">
        <Alert><AlertCircle className="size-4" /><AlertTitle>Supplier assignment required</AlertTitle><AlertDescription>These paid order lines could not be assigned safely to a supplier. Choose a supplier or resolve its availability, then DataPlus can place the line into that supplier's draft PO.</AlertDescription></Alert>
        <Card><CardHeader><CardTitle className="text-base">Unassigned order lines</CardTitle><CardDescription>{numberLabel(Number(poolSummary.buyerReviewUnits || 0))} units remain visible here until a supplier is assigned.</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Customer order</TableHead><TableHead>SKU / quantity</TableHead><TableHead>Supplier</TableHead><TableHead>Supplier availability</TableHead><TableHead>Reason</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{buyerReviewRequirements.map((row) => { const orderId = String(row.orderId || ""); const sku = String(row.sku || ""); const hasSupplier = Boolean(String(row.vendorId || "").trim()); return <TableRow key={String(row.id)}><TableCell><a className="font-medium hover:underline" href={`/orders/${encodeURIComponent(orderId)}`}>{String(row.orderNumber || orderId || "-")}</a></TableCell><TableCell><a className="font-medium hover:underline" href={`/products/${encodeURIComponent(sku)}`}>{sku || "-"}</a><p className="text-xs text-muted-foreground">{numberLabel(Number(row.qty || 0))} units</p></TableCell><TableCell>{String(row.vendorName || "Unassigned supplier")}</TableCell><TableCell>{row.availabilityKnown === true ? `${numberLabel(Number(row.availableQty || 0))} reported` : "Not reported"}</TableCell><TableCell className="max-w-80"><p className="text-sm text-amber-700 dark:text-amber-300">{String(row.reviewReason || (hasSupplier ? "Supplier availability needs buyer review." : "Assign a supplier before creating the PO."))}</p></TableCell><TableCell className="text-right">{hasSupplier ? <Button size="sm" disabled={creatingOrderId === orderId} onClick={() => void createForOrder(orderId)}>{creatingOrderId === orderId ? <Loader2 className="size-4 animate-spin" /> : "Create PO"}</Button> : <Button size="sm" variant="outline" asChild><a href={`/products/${encodeURIComponent(sku)}`}>Assign supplier</a></Button>}</TableCell></TableRow> })}{!buyerReviewRequirements.length && <TableRow><TableCell colSpan={6} className="h-28 text-center text-muted-foreground">Every paid order line has a supplier assignment.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
      </TabsContent>
      <TabsContent value="requirements" className="mt-4 grid gap-4"><Alert><History className="size-4" /><AlertTitle>Trace order lines</AlertTitle><AlertDescription>Use this reference view only when you need to follow an order line to its supplier and PO. “Added to PO” means it is already covered and needs no buyer action.</AlertDescription></Alert><Card><CardHeader className="border-b"><CardTitle className="text-base">Order-to-PO trace</CardTitle><CardDescription>Trace a customer order line into its supplier PO or diagnose a sourcing problem.</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Customer order</TableHead><TableHead>SKU / quantity</TableHead><TableHead>Fulfillment path</TableHead><TableHead>Supplier</TableHead><TableHead>Linked PO</TableHead><TableHead>Ship by</TableHead><TableHead>Trace status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>
        {requirements.map((row) => { const poId = String(row.purchaseOrderId || ""); const orderId = String(row.orderId || ""); const sku = String(row.sku || ""); const status = String(row.status || "new").toLowerCase(); const hasSupplier = Boolean(String(row.vendorId || "").trim()); return <TableRow key={String(row.id)}><TableCell><a className="font-medium hover:underline" href={`/orders/${encodeURIComponent(orderId)}`}>{String(row.orderNumber)}</a><p className="text-xs text-muted-foreground">{String(row.customer || "Customer")}</p></TableCell><TableCell>{sku ? <a className="font-medium hover:underline" href={`/products/${encodeURIComponent(sku)}`} target="_blank" rel="noreferrer" title={`Open ${sku} in a new tab`}>{sku}</a> : "-"}<p className="text-xs text-muted-foreground">{numberLabel(Number(row.qty || 0))} units</p></TableCell><TableCell><Badge variant="outline">{String(row.type || "purchase").replace(/_/g, " ")}</Badge></TableCell><TableCell>{String(row.vendorName || "Unassigned")} {row.reviewReason ? <p className="mt-1 max-w-64 text-xs text-amber-700 dark:text-amber-300">{String(row.reviewReason)}</p> : null}</TableCell><TableCell>{poId ? <a className="font-medium hover:underline" href={`/purchase-orders/${encodeURIComponent(poId)}`}>{String(row.purchaseOrderNumber || poId)}</a> : <span className="text-muted-foreground">Not created</span>}</TableCell><TableCell>{String(row.shipBy || "-")}</TableCell><TableCell><Badge variant={status.includes("exception") ? "destructive" : status === "buyer_review" ? "outline" : status === "converted" ? "default" : "secondary"} className={status === "buyer_review" ? "border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200" : status === "converted" ? "bg-emerald-600 text-white hover:bg-emerald-600" : ""}>{purchaseRequirementStatusLabel(status)}</Badge></TableCell><TableCell className="text-right">{poId ? <Button size="sm" variant="outline" asChild><a href={`/purchase-orders/${encodeURIComponent(poId)}`}>Open PO</a></Button> : status === "buyer_review" && !hasSupplier ? <Button size="sm" variant="outline" asChild><a href={`/products/${encodeURIComponent(sku)}`}>Assign supplier</a></Button> : <Button size="sm" disabled={creatingOrderId === orderId} onClick={() => void createForOrder(orderId)}>{creatingOrderId === orderId ? <Loader2 className="size-4 animate-spin" /> : "Create PO"}</Button>}</TableCell></TableRow> })}
        {!requirements.length && <TableRow><TableCell colSpan={8} className="h-28 text-center text-muted-foreground">No purchase requirements match this view.</TableCell></TableRow>}
      </TableBody></Table></div></CardContent></Card></TabsContent>
      <TabsContent value="approvals" className="mt-4">
        <Card>
          <CardHeader className="border-b">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Review &amp; send</CardTitle>
                <CardDescription className="mt-1">Draft collection, approval, overdue placement, and approved-but-unsent POs are managed in one queue. Supplier placement moves a PO to Inbound.</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Select value={reviewFilter} onValueChange={setReviewFilter}><SelectTrigger className="w-48"><Filter className="size-4" /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses ({reviewPurchaseOrders.length})</SelectItem><SelectItem value="collecting">Collecting ({reviewCounts.collecting || 0})</SelectItem><SelectItem value="reopened_draft">Reopened draft ({reviewCounts.reopened_draft || 0})</SelectItem><SelectItem value="draft_ready">Draft ready ({reviewCounts.draft_ready || 0})</SelectItem><SelectItem value="needs_approval">Needs approval ({reviewCounts.needs_approval || 0})</SelectItem><SelectItem value="approved_not_sent">Approved, not sent ({approvedNotSentCount})</SelectItem><SelectItem value="placement_overdue">Placement overdue ({reviewCounts.placement_overdue || 0})</SelectItem><SelectItem value="on_hold">On hold ({reviewCounts.on_hold || 0})</SelectItem></SelectContent></Select>
                <Badge variant="outline">{numberLabel(needsApprovalCount)} need action</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>PO</TableHead><TableHead>Supplier</TableHead><TableHead>Orders</TableHead><TableHead>Units</TableHead><TableHead>Estimated cost</TableHead><TableHead>Status</TableHead><TableHead>Schedule</TableHead><TableHead>Approval</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
                <TableBody>
                  {approvalQueue.map((po) => {
                    const approval = (po.approval || {}) as Record<string, unknown>
                    const poId = String(po.id || "")
                    const approvalStatus = String(approval.status || "pending").toLowerCase()
                    const reviewState = reviewStateForPo(po)
                    const needsApproval = approvalStatus !== "approved"
                    const approvalOperator = purchaseOrderOperator(po, "approval")
                    return <TableRow key={poId}>
                      <TableCell><div className="flex items-center gap-1"><a className="font-medium text-primary hover:underline" href={`/purchase-orders/${encodeURIComponent(poId)}`}>{String(po.poNumber || poId)}</a><Button type="button" size="icon" variant="ghost" className="size-7 shrink-0" aria-label={`Quick view ${String(po.poNumber || poId)}`} title="Quick view" onClick={() => setQuickViewPo(po)}><Eye className="size-4" /></Button></div></TableCell>
                      <TableCell>{String(po.supplier || "Unassigned")}</TableCell>
                      <TableCell>{numberLabel(Array.isArray(po.orderIds) ? po.orderIds.length : 0)}</TableCell>
                      <TableCell>{numberLabel(Number(po.totalUnits || purchaseOrderItems(po).reduce((sum, line) => sum + Number(line.qty || 0), 0)))}</TableCell>
                      <TableCell>{moneyLabel(Number(po.openEstimatedCost ?? po.estimatedCost ?? 0))}</TableCell>
                      <TableCell><div className="flex items-center gap-1.5"><Badge variant={reviewState.variant} className="w-fit whitespace-nowrap">{reviewState.label}</Badge><Tooltip><TooltipTrigger asChild><button type="button" className="grid size-6 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`${reviewState.label} details`}><Info className="size-3.5" /></button></TooltipTrigger><TooltipContent className="max-w-72">{reviewState.description}</TooltipContent></Tooltip></div></TableCell>
                      <TableCell><PurchaseScheduleSummary record={po} compact /></TableCell>
                      <TableCell>{approvalOperator.name ? <div><p className="font-medium">{approvalOperator.name}</p><p className="text-xs text-muted-foreground">Approved{approvalOperator.at ? ` · ${dateLabel(approvalOperator.at)}` : ""}</p></div> : <span className="text-muted-foreground">{reviewState.key === "collecting" ? "Not submitted" : needsApproval ? "Pending approval" : "No approval required"}</span>}</TableCell>
                      <TableCell className="text-right">{reviewState.key === "collecting"
                        ? <div className="flex justify-end gap-1"><Button size="sm" disabled={actingPoId === poId} onClick={() => void actOnPo(poId, "approve")}>{actingPoId === poId ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />} Place now</Button><Tooltip><TooltipTrigger asChild><Button size="icon" variant="outline" className="size-8" onClick={() => setQuickViewPo(po)} aria-label={`Quick view ${String(po.poNumber || poId)}`}><Eye className="size-4" /></Button></TooltipTrigger><TooltipContent>Quick view</TooltipContent></Tooltip></div>
                        : reviewState.key === "on_hold"
                          ? <div className="flex justify-end gap-1"><Button size="sm" variant="outline" disabled={actingPoId === poId} onClick={() => void actOnPo(poId, "reopen")}>{actingPoId === poId ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />} Return to draft</Button><Tooltip><TooltipTrigger asChild><Button size="icon" variant="outline" className="size-8" onClick={() => setQuickViewPo(po)} aria-label={`Quick view ${String(po.poNumber || poId)}`}><Eye className="size-4" /></Button></TooltipTrigger><TooltipContent>Quick view</TooltipContent></Tooltip></div>
                          : needsApproval
                        ? <div className="flex justify-end gap-1"><Button size="sm" disabled={actingPoId === poId} onClick={() => void actOnPo(poId, "approve")}>{reviewState.key === "reopened_draft" ? "Approve & place" : "Approve"}</Button><Button size="sm" variant="outline" disabled={actingPoId === poId} onClick={() => void actOnPo(poId, "hold")}>Hold</Button><Button size="sm" variant="ghost" disabled={actingPoId === poId} onClick={() => void actOnPo(poId, "reject")}>Reject</Button></div>
                        : <div className="flex justify-end gap-1"><Button size="sm" disabled={actingPoId === poId} onClick={() => void continueApprovedPo(po)}>{actingPoId === poId ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />} Send / mark placed</Button><Tooltip><TooltipTrigger asChild><Button size="icon" variant="ghost" className="size-8" disabled={actingPoId === poId} onClick={() => void actOnPo(poId, "reopen")} aria-label={`Return ${String(po.poNumber || poId)} to draft`}>{actingPoId === poId ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}</Button></TooltipTrigger><TooltipContent>Return to draft</TooltipContent></Tooltip><Tooltip><TooltipTrigger asChild><Button size="icon" variant="outline" className="size-8" onClick={() => setQuickViewPo(po)} aria-label={`Quick view ${String(po.poNumber || poId)}`}><Eye className="size-4" /></Button></TooltipTrigger><TooltipContent>Quick view</TooltipContent></Tooltip></div>}
                      </TableCell>
                    </TableRow>
                  })}
                  {!approvalQueue.length && <TableRow><TableCell colSpan={9} className="h-28 text-center text-muted-foreground">No purchase orders match this status filter.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="dropships" className="mt-4"><DropshipPurchaseOrdersWorkspace purchaseOrders={dropshipPos} warehouses={purchaseReferences.warehouses} operatorName={operatorName} onReload={load} onQuickView={openPurchaseOrderQuickView} /></TabsContent>
      <TabsContent value="inbound" className="mt-4"><Card><CardHeader className="border-b"><CardTitle className="text-base">Inbound purchase orders</CardTitle><CardDescription>Placed warehouse POs remain in one queue from tracking pending through shipment. The first saved receiving count moves the PO to Receiving.</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>PO</TableHead><TableHead>Supplier</TableHead><TableHead>References</TableHead><TableHead>Destination</TableHead><TableHead>Units</TableHead><TableHead>Tracking</TableHead><TableHead>Expected</TableHead><TableHead>Placed by</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>
        {inboundPos.map((po) => { const tracking = purchaseOrderTrackingState(po); const operator = purchaseOrderOperator(po, "placement"); const supplierReference = purchaseOrderSupplierReference(po); const ctechNumber = purchaseOrderCtechNumber(po); const externalReference = po.placedFromExternalSource === true ? `${String(po.externalSourceSystem || "External")}: ${String(po.externalPoNumber || "Not recorded")}` : ""; const poId = String(po.id || ""); return <TableRow key={poId}><TableCell><div className="flex items-center gap-1"><a className="font-medium text-primary hover:underline" href={`/purchase-orders/${encodeURIComponent(poId)}`}>{String(po.poNumber || poId)}</a><Button type="button" size="icon" variant="ghost" className="size-7 shrink-0" aria-label={`Quick view ${String(po.poNumber || poId)}`} title="Quick view" onClick={() => setQuickViewPo(po)}><Eye className="size-4" /></Button></div></TableCell><TableCell>{String(po.supplier || "Unassigned")}</TableCell><TableCell><div className="grid gap-0.5 text-xs">{externalReference ? <span>{externalReference}</span> : null}{supplierReference ? <span>Supplier: {supplierReference}</span> : null}{ctechNumber && !externalReference ? <span>CTech: {ctechNumber}</span> : null}{!externalReference && !supplierReference && !ctechNumber ? <span className="text-muted-foreground">-</span> : null}</div></TableCell><TableCell>{String(po.warehouseName || "-")}</TableCell><TableCell>{numberLabel(Number(po.totalUnits || 0))}</TableCell><TableCell><div className="grid gap-1"><Badge variant={tracking.variant} className="w-fit">{tracking.label}</Badge>{po.trackingNumber ? po.trackingUrl ? <a className="font-mono text-xs text-primary hover:underline" href={String(po.trackingUrl)} target="_blank" rel="noreferrer">{String(po.trackingNumber)}</a> : <span className="font-mono text-xs">{String(po.trackingNumber)}</span> : null}</div></TableCell><TableCell>{po.expectedAt ? dateLabel(String(po.expectedAt)) : "-"}</TableCell><TableCell>{operator.name ? <div><p className="font-medium">{operator.name}</p>{operator.at ? <p className="text-xs text-muted-foreground">{dateLabel(operator.at)}</p> : null}</div> : <span className="text-muted-foreground">Not recorded</span>}</TableCell><TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => setQuickViewPo(po)}><Eye className="size-4" /> Quick view</Button></TableCell></TableRow> })}
        {!inboundPos.length && <TableRow><TableCell colSpan={9} className="h-28 text-center text-muted-foreground">No warehouse purchase orders are currently inbound.</TableCell></TableRow>}
      </TableBody></Table></div></CardContent></Card></TabsContent>
      <TabsContent value="receiving" className="mt-4"><Card><CardHeader className="border-b"><CardTitle className="text-base">Receiving</CardTitle><CardDescription>Purchase orders where a warehouse count has started or stock was partially received. Open a PO to receive the remaining quantities.</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>PO</TableHead><TableHead>Supplier</TableHead><TableHead>Destination</TableHead><TableHead>Orders</TableHead><TableHead>Units</TableHead><TableHead>Status</TableHead><TableHead>Expected</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>
        {receivingPos.map((po) => <TableRow key={String(po.id)}><TableCell className="font-medium"><a className="hover:underline" href={`/purchase-orders/${encodeURIComponent(String(po.id || ""))}`}>{String(po.poNumber || po.id)}</a></TableCell><TableCell>{String(po.supplier || "Unassigned")}</TableCell><TableCell>{String(po.warehouseName || "-")}</TableCell><TableCell>{numberLabel(Array.isArray(po.orderIds) ? po.orderIds.length : 0)}</TableCell><TableCell>{numberLabel(Number(po.totalUnits || 0))}</TableCell><TableCell><Badge variant="secondary">{String(po.status || "receiving").replace(/_/g, " ")}</Badge></TableCell><TableCell>{po.expectedAt ? dateLabel(String(po.expectedAt)) : "-"}</TableCell><TableCell className="text-right"><Button size="sm" asChild><a href={`/purchase-orders/${encodeURIComponent(String(po.id || ""))}`}>Receive PO</a></Button></TableCell></TableRow>)}
        {!receivingPos.length && <TableRow><TableCell colSpan={8} className="h-28 text-center text-muted-foreground">No purchase orders are currently being received.</TableCell></TableRow>}
      </TableBody></Table></div></CardContent></Card></TabsContent>
      <TabsContent value="rejected" className="mt-4"><Card><CardHeader className="border-b"><CardTitle className="text-base">Rejected purchase orders</CardTitle><CardDescription>Rejected POs were declined before supplier commitment. They remain separate from canceled POs and retain the buyer's selected disposition for linked demand.</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>PO</TableHead><TableHead>Supplier</TableHead><TableHead>Order#</TableHead><TableHead>Disposition</TableHead><TableHead>Reason</TableHead><TableHead>Rejected by</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>
        {rejectedPos.map((po) => { const orderReferences = purchaseOrderCanceledOrders(po); const disposition = String(po.rejectionDispositionLabel || po.rejectionDisposition || "Not recorded").replace(/_/g, " "); const reason = String(po.rejectionNote || "No rejection note recorded"); const poId = String(po.id || ""); return <TableRow key={poId}><TableCell><div className="flex items-center gap-1"><a className="font-medium text-primary hover:underline" href={`/purchase-orders/${encodeURIComponent(poId)}`}>{String(po.poNumber || poId)}</a><Button type="button" size="icon" variant="ghost" className="size-7" title="Quick view" aria-label={`Quick view ${String(po.poNumber || poId)}`} onClick={() => setQuickViewPo(po)}><Eye className="size-4" /></Button></div><Badge variant="outline" className="mt-1">Rejected</Badge></TableCell><TableCell>{String(po.supplier || "Unassigned")}</TableCell><TableCell>{orderReferences.length ? <div className="flex max-w-52 flex-wrap gap-x-2 gap-y-1">{orderReferences.map((reference) => reference.id ? <a key={reference.id} className="font-medium text-primary hover:underline" href={`/orders/${encodeURIComponent(reference.id)}`}>{reference.number}</a> : <span key={reference.number}>{reference.number}</span>)}</div> : <span className="text-muted-foreground">-</span>}</TableCell><TableCell className="max-w-64 whitespace-normal">{disposition}</TableCell><TableCell className="max-w-80 whitespace-normal break-words" title={reason}>{reason}</TableCell><TableCell>{String(po.rejectedBy || ((po.approval || {}) as Record<string, unknown>).rejectedBy || "Not recorded")}</TableCell><TableCell className="whitespace-nowrap">{dateLabel(String(po.rejectedAt || po.updatedAt || ""))}</TableCell><TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => setQuickViewPo(po)}><Eye className="size-4" /> Quick view</Button></TableCell></TableRow> })}
        {!rejectedPos.length && <TableRow><TableCell colSpan={8} className="h-28 text-center text-muted-foreground">{historyLoadingScope === "rejected" ? <span className="inline-flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading rejected purchase orders</span> : "No rejected purchase orders match this view."}</TableCell></TableRow>}
      </TableBody></Table></div></CardContent></Card></TabsContent>
      <TabsContent value="canceled" className="mt-4"><Card><CardHeader className="border-b"><CardTitle className="text-base">Canceled purchase orders</CardTitle><CardDescription>Canceled POs are never deleted. Their reason, operator, timestamps, lines, and supplier history remain available for audit.</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>PO</TableHead><TableHead>Supplier</TableHead><TableHead>Order#</TableHead><TableHead>Reason</TableHead><TableHead>Canceled by</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>
        {canceledPos.map((po) => { const orderReferences = purchaseOrderCanceledOrders(po); const reason = purchaseOrderCancellationReason(po); return <TableRow key={String(po.id)}><TableCell className="font-medium"><a className="hover:underline" href={`/purchase-orders/${encodeURIComponent(String(po.id || ""))}`}>{String(po.poNumber || po.id)}</a><div className="mt-1"><Badge variant="destructive">Canceled</Badge></div></TableCell><TableCell>{String(po.supplier || "Unassigned")}</TableCell><TableCell>{orderReferences.length ? <div className="flex max-w-52 flex-wrap gap-x-2 gap-y-1">{orderReferences.map((reference) => reference.id ? <a key={reference.id} className="font-medium text-primary hover:underline" href={`/orders/${encodeURIComponent(reference.id)}`}>{reference.number}</a> : <span key={reference.number}>{reference.number}</span>)}</div> : <span className="text-muted-foreground">-</span>}</TableCell><TableCell className="max-w-80 whitespace-normal break-words" title={reason}>{reason}</TableCell><TableCell>{purchaseOrderCancellationActor(po)}</TableCell><TableCell className="whitespace-nowrap">{dateLabel(String(po.canceledAt || po.updatedAt || ""))}</TableCell><TableCell className="text-right"><Button size="sm" variant="outline" asChild><a href={`/purchase-orders/${encodeURIComponent(String(po.id || ""))}`}>Open PO</a></Button></TableCell></TableRow> })}
        {!canceledPos.length && <TableRow><TableCell colSpan={7} className="h-28 text-center text-muted-foreground">{historyLoadingScope === "canceled" ? <span className="inline-flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading canceled purchase orders</span> : "No canceled purchase orders match this view."}</TableCell></TableRow>}
      </TableBody></Table></div></CardContent></Card></TabsContent>
      <TabsContent value="archive" className="mt-4"><Card><CardHeader><CardTitle className="text-base">Purchase-order history</CardTitle><CardDescription>Completed, received, closed, replaced, and deleted POs remain available for audit without crowding active purchasing work.</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>PO</TableHead><TableHead>Supplier</TableHead><TableHead>Status</TableHead><TableHead>Reason</TableHead><TableHead>Replacement</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader><TableBody>
        {archivedPos.map((po) => { const replacementId = String(po.replacedByPurchaseOrderId || ""); const historyReason = [po.rejectionDispositionLabel, po.rejectionNote].filter(Boolean).join(": ") || String(po.buyerNote || po.reSourceReason || "-"); return <TableRow key={String(po.id)}><TableCell className="font-medium"><a className="hover:underline" href={`/purchase-orders/${encodeURIComponent(String(po.id || ""))}`}>{String(po.poNumber || po.id)}</a></TableCell><TableCell>{String(po.supplier || "Unassigned")}</TableCell><TableCell><Badge variant={String(po.status).toLowerCase() === "superseded" ? "secondary" : "outline"}>{String(po.status || "archived").replace(/_/g, " ")}</Badge></TableCell><TableCell className="max-w-72"><p className="truncate" title={historyReason}>{historyReason.replace(/_/g, " ")}</p></TableCell><TableCell>{replacementId ? <a className="font-medium text-primary hover:underline" href={`/purchase-orders/${encodeURIComponent(replacementId)}`}>{String(po.replacedByPurchaseOrderNumber || replacementId)}</a> : <span className="text-muted-foreground">-</span>}</TableCell><TableCell>{dateLabel(String(po.updatedAt || po.createdAt || ""))}</TableCell></TableRow> })}
        {!archivedPos.length && <TableRow><TableCell colSpan={6} className="h-28 text-center text-muted-foreground">{historyLoadingScope === "archive" ? <span className="inline-flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading purchase-order history</span> : "No completed or archived purchase orders match this view."}</TableCell></TableRow>}
      </TableBody></Table></div></CardContent></Card></TabsContent>
      <TabsContent value="performance" className="mt-4 grid gap-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Detail label="Open commitment" value={moneyLabel(performanceTotals.commitment)} /><Detail label="Supplier acknowledgement" value={`${performanceTotals.total ? ((performanceTotals.acknowledged / performanceTotals.total) * 100).toFixed(0) : 0}%`} /><Detail label="PO receipt rate" value={`${performanceTotals.total ? ((performanceTotals.received / performanceTotals.total) * 100).toFixed(0) : 0}%`} /><Detail label="On-time receipt" value={`${performanceTotals.received ? ((performanceTotals.onTime / performanceTotals.received) * 100).toFixed(0) : 0}%`} /></div><Card><CardHeader><CardTitle className="text-base">Supplier scorecards</CardTitle><CardDescription>Reference reporting for supplier reliability. It does not create or block buyer work.</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Supplier</TableHead><TableHead>Open POs</TableHead><TableHead>Open commitment</TableHead><TableHead>Acknowledged</TableHead><TableHead>Fill rate</TableHead><TableHead>Overdue</TableHead><TableHead /></TableRow></TableHeader><TableBody>{supplierPerformance.sort((left, right) => right.commitment - left.commitment).map((supplier) => <TableRow key={supplier.vendorId || supplier.supplier}><TableCell className="font-medium">{supplier.supplier}</TableCell><TableCell>{numberLabel(supplier.open)}</TableCell><TableCell>{moneyLabel(supplier.commitment)}</TableCell><TableCell>{supplier.total ? `${((supplier.acknowledged / supplier.total) * 100).toFixed(0)}%` : "-"}</TableCell><TableCell>{supplier.units ? `${((supplier.receivedUnits / supplier.units) * 100).toFixed(0)}%` : "-"}</TableCell><TableCell>{supplier.overdue ? <Badge variant="destructive">{supplier.overdue}</Badge> : <Badge variant="secondary">0</Badge>}</TableCell><TableCell>{supplier.vendorId ? <Button size="sm" variant="outline" asChild><a href={`/vendors/${encodeURIComponent(supplier.vendorId)}`}>Open vendor</a></Button> : <span className="text-xs text-muted-foreground">No profile</span>}</TableCell></TableRow>)}{!supplierPerformance.length && <TableRow><TableCell colSpan={7} className="h-28 text-center text-muted-foreground">No purchase-order history is available yet.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card></TabsContent>
      <TabsContent value="risks" className="mt-4"><Card><CardHeader><CardTitle className="text-base">Supply issues</CardTitle><CardDescription>Reference list of unresolved sourcing problems and overdue supplier receipts. Routine buyer work belongs in Needs action.</CardDescription></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Reference</TableHead><TableHead>Issue</TableHead><TableHead /></TableRow></TableHeader><TableBody>{risks.map((risk) => <TableRow key={`${risk.kind}-${risk.id}`}><TableCell><Badge variant="destructive">{risk.kind}</Badge></TableCell><TableCell className="font-medium">{risk.reference}</TableCell><TableCell>{risk.detail}</TableCell><TableCell><Button size="sm" variant="outline" asChild><a href={risk.href}>Open</a></Button></TableCell></TableRow>)}{!risks.length && <TableRow><TableCell colSpan={4} className="h-28 text-center text-muted-foreground">No unresolved purchasing issues.</TableCell></TableRow>}</TableBody></Table></CardContent></Card></TabsContent>
    </Tabs>
    <Sheet open={Boolean(quickViewPo)} onOpenChange={(open) => { if (!open) { setQuickViewPo(null); setQuickViewLoading(false) } }}>
      <SheetContent side="right" className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden p-0 sm:w-full sm:max-w-3xl">
        <SheetHeader className="border-b px-5 py-4 pr-14 text-left sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle>{String(quickViewPo?.poNumber || quickViewPo?.id || "Purchase order")}</SheetTitle>
            {quickViewPo ? <Badge variant="outline">{String(quickViewPo.status || "draft").replace(/_/g, " ")}</Badge> : null}
            {quickViewPo ? <Badge variant={quickViewTracking.variant}>{quickViewTracking.label}</Badge> : null}
            {quickViewLoading ? <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Loading details</span> : null}
          </div>
          <SheetDescription>{quickViewPo ? `${String(quickViewPo.supplier || "Unassigned supplier")} to ${String(quickViewPo.warehouseName || (isDropshipPo(quickViewPo) ? "customer" : "unassigned destination"))}` : "Purchase order quick view"}</SheetDescription>
        </SheetHeader>
        {quickViewPo ? <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          <div className="grid gap-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Detail label="Supplier" value={String(quickViewPo.supplier || "Unassigned")} />
              <Detail label="Destination" value={isDropshipPo(quickViewPo) ? "Direct to customer" : String(quickViewPo.warehouseName || "-")} />
              <Detail label="Units" value={numberLabel(Number(quickViewPo.totalUnits || quickViewItems.reduce((sum, line) => sum + Number(line.qty || 0), 0)))} />
              <Detail label="Estimated cost" value={moneyLabel(Number(quickViewPo.estimatedTotalCost ?? quickViewPo.openEstimatedCost ?? quickViewPo.estimatedCost ?? 0))} />
              <Detail label="Expected" value={quickViewPo.expectedAt || quickViewPo.expectedDeliveryDate ? dateLabel(String(quickViewPo.expectedAt || quickViewPo.expectedDeliveryDate)) : "Not scheduled"} />
              <Detail label="Customer orders" value={numberLabel(Array.isArray(quickViewPo.orderIds) ? quickViewPo.orderIds.length : 0)} />
            </div>
            <Card>
              <CardHeader className="border-b py-3"><CardTitle className="text-sm">Update purchase order</CardTitle><CardDescription>Use the same guarded status and tracking workflows available on the full PO.</CardDescription></CardHeader>
              <CardContent className="grid gap-4 p-4">
                <div className="grid content-start gap-2"><Label>Status</Label>{quickViewStatusOptions.length ? <><Select value={quickViewStatusAction} onValueChange={setQuickViewStatusAction}><SelectTrigger><SelectValue placeholder="Choose next status" /></SelectTrigger><SelectContent>{quickViewStatusOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select><Button size="sm" disabled={quickViewSaving || !quickViewStatusAction} onClick={() => void saveQuickViewStatus()}>{quickViewSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save status</Button></> : <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">This status advances through tracking or warehouse receiving.</p>}</div>
                <div className="grid gap-3"><Label>Tracking</Label><div className="grid gap-3"><Input value={quickViewTrackingForm.trackingNumber} onChange={(event) => setQuickViewTrackingForm((current) => detectedTrackingUpdate(current, event.target.value, fulfillmentCarriers))} placeholder="Tracking number" /><Select value={quickViewTrackingForm.carrier} onValueChange={(carrier) => setQuickViewTrackingForm((current) => ({ ...current, carrier, service: "" }))}><SelectTrigger><SelectValue placeholder="Carrier auto-detects" /></SelectTrigger><SelectContent>{quickViewCarrierOptions.map((carrier) => <SelectItem key={carrier} value={carrier}>{carrier}</SelectItem>)}</SelectContent></Select>{detectTrackingCarrier(quickViewTrackingForm.trackingNumber) ? <p className="text-xs text-emerald-600">Detected {detectTrackingCarrier(quickViewTrackingForm.trackingNumber)}</p> : null}<Select value={quickViewTrackingForm.service} onValueChange={(service) => setQuickViewTrackingForm((current) => ({ ...current, service }))}><SelectTrigger><SelectValue placeholder="Choose carrier service" /></SelectTrigger><SelectContent>{quickViewServiceOptions.map((service) => <SelectItem key={service} value={service}>{service}</SelectItem>)}</SelectContent></Select><div className="grid gap-3 sm:grid-cols-2"><div><Label className="text-xs text-muted-foreground">Ship date</Label><Input type="date" value={quickViewTrackingForm.shipDate} onChange={(event) => setQuickViewTrackingForm((current) => ({ ...current, shipDate: event.target.value }))} aria-label="Supplier ship date" /></div>{!isDropshipPo(quickViewPo) ? <div><Label className="text-xs text-muted-foreground">Expected arrival</Label><Input type="date" value={quickViewTrackingForm.expectedAt} onChange={(event) => setQuickViewTrackingForm((current) => ({ ...current, expectedAt: event.target.value }))} /></div> : null}</div></div><div className="flex justify-end"><Button size="sm" disabled={quickViewSaving || !quickViewTrackingForm.carrier || !quickViewTrackingForm.service || !quickViewTrackingForm.trackingNumber.trim()} onClick={() => void saveQuickViewTracking()}>{quickViewSaving ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />} Save tracking</Button></div></div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="border-b py-3"><CardTitle className="text-sm">References and ownership</CardTitle></CardHeader>
              <CardContent className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
                <Detail label="Supplier order #" value={purchaseOrderSupplierReference(quickViewPo) || "Not recorded"} />
                <Detail label="CTech PO #" value={purchaseOrderCtechNumber(quickViewPo) || "Not recorded"} />
                {quickViewPo.placedFromExternalSource === true ? <Detail label={`${String(quickViewPo.externalSourceSystem || "External source")} PO #`} value={String(quickViewPo.externalPoNumber || "Not recorded")} /> : null}
                <Detail label="Tracking" value={String(quickViewPo.trackingNumber || quickViewTracking.label)} />
                <Detail label="Approved by" value={quickViewApproval.name ? `${quickViewApproval.name}${quickViewApproval.at ? `, ${dateLabel(quickViewApproval.at)}` : ""}` : "Not recorded"} />
                <Detail label="Placed by" value={quickViewPlacement.name ? `${quickViewPlacement.name}${quickViewPlacement.at ? `, ${dateLabel(quickViewPlacement.at)}` : ""}` : "Not recorded"} />
                <Detail label="Carrier" value={String(quickViewPo.shippingCarrier || quickViewPo.carrier || "Not recorded")} />
                <div className="grid gap-2 rounded-md border bg-muted/20 p-3 sm:col-span-2 lg:col-span-3"><p className="text-xs font-medium uppercase text-muted-foreground">Channel orders</p>{quickViewChannelOrders.map((reference, index) => { const channelHref = purchaseOrderChannelReferenceUrl(reference); return <div key={`${String(reference.orderId || reference.orderNumber || index)}`} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span><span className="font-medium">{String(reference.channel || quickViewPo.salesChannel || "Channel")}</span> {channelHref ? <a className="inline-flex items-center gap-1 font-mono text-primary hover:underline" href={channelHref} target={channelHref.startsWith("http") ? "_blank" : undefined} rel={channelHref.startsWith("http") ? "noreferrer" : undefined}>{String(reference.channelOrderNumber || "Not recorded")}<ExternalLink className="size-3" /></a> : <span className="font-mono">{String(reference.channelOrderNumber || "Not recorded")}</span>}</span>{reference.orderId ? <a className="text-primary hover:underline" href={`/orders/${encodeURIComponent(String(reference.orderId))}`}>DataPlus order {String(reference.orderNumber || reference.orderId)}</a> : null}</div> })}{!quickViewChannelOrders.length ? <p className="text-sm text-muted-foreground">No linked channel order was found.</p> : null}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="border-b py-3"><CardTitle className="text-sm">Items ({numberLabel(quickViewItems.length)})</CardTitle></CardHeader>
              <CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead className="w-14">Item</TableHead><TableHead>SKU / title</TableHead><TableHead>Order</TableHead><TableHead className="text-right">Ordered</TableHead><TableHead className="text-right">Received</TableHead><TableHead className="text-right">Open</TableHead><TableHead className="text-right">Unit cost</TableHead></TableRow></TableHeader><TableBody>
                {quickViewItems.map((line, index) => {
                  const qty = Number(line.qty || line.quantity || 0)
                  const received = Number(line.receivedQty || 0)
                  const sku = String(line.sku || line.vendorSku || "")
                  const channelReference = quickViewChannelOrders.find((reference) => String(reference.orderId || "") === String(line.orderId || "")) || {}
                  const channelHref = purchaseOrderChannelReferenceUrl({ ...channelReference, channelOrderNumber: line.channelOrderNumber || channelReference.channelOrderNumber, channel: line.salesChannel || channelReference.channel })
                  const manufacturerSku = String(line.manufacturerSku || line.mfrPartNumber || line.manufacturerPartNumber || line.mpn || "-")
                  const upc = String(line.upc || line.barcode || line.gtin || "-")
                  return <TableRow key={`${sku}-${index}`}><TableCell><CatalogImage src={String(line.defaultImage || line.imageUrl || line.image || "")} alt={String(line.title || sku || "PO item")} className="size-10" imageClassName="object-contain" /></TableCell><TableCell className="min-w-64"><a className="font-medium text-primary hover:underline" href={`/products/${encodeURIComponent(sku)}`}>{sku || "Unmatched SKU"}</a><p className="line-clamp-2 text-xs text-muted-foreground">{String(line.title || line.name || "No product title")}</p><div className="mt-1 grid gap-0.5 text-xs text-muted-foreground"><span>Vendor SKU: <span className="font-mono text-foreground">{String(line.vendorSku || "-")}</span></span><span>Manufacturer SKU: <span className="font-mono text-foreground">{manufacturerSku}</span></span><span>UPC: <span className="font-mono text-foreground">{upc}</span></span></div></TableCell><TableCell>{line.orderNumber || line.orderId ? <a className="text-primary hover:underline" href={`/orders/${encodeURIComponent(String(line.orderId || line.orderNumber))}`}>{String(line.orderNumber || line.orderId)}</a> : "-"}{line.channelOrderNumber ? <p className="text-xs text-muted-foreground">Channel {channelHref ? <a className="font-mono text-primary hover:underline" href={channelHref} target={channelHref.startsWith("http") ? "_blank" : undefined} rel={channelHref.startsWith("http") ? "noreferrer" : undefined}>{String(line.channelOrderNumber)}</a> : <span className="font-mono">{String(line.channelOrderNumber)}</span>}</p> : null}</TableCell><TableCell className="text-right">{numberLabel(qty)}</TableCell><TableCell className="text-right">{numberLabel(received)}</TableCell><TableCell className="text-right">{numberLabel(Math.max(0, qty - received))}</TableCell><TableCell className="text-right">{moneyLabel(Number(line.unitCost || line.cost || 0))}</TableCell></TableRow>
                })}
                {!quickViewItems.length && <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No PO line items were found.</TableCell></TableRow>}
              </TableBody></Table></div></CardContent>
            </Card>
            <Card>
              <CardHeader className="border-b py-3"><CardTitle className="text-sm">Recent activity</CardTitle></CardHeader>
              <CardContent className="grid gap-3 p-4">
                {quickViewTimeline.map((event, index) => <div key={`${String(event.createdAt || event.at || "event")}-${index}`} className="border-l-2 border-primary/40 pl-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{String(event.title || event.type || "PO activity")}</p><span className="text-xs text-muted-foreground">{event.createdAt || event.at ? dateLabel(String(event.createdAt || event.at)) : ""}</span></div><p className="text-muted-foreground">{String(event.message || event.note || "")}{event.user ? ` · ${String(event.user)}` : ""}</p></div>)}
                {!quickViewTimeline.length && <p className="text-sm text-muted-foreground">No PO activity has been recorded.</p>}
              </CardContent>
            </Card>
          </div>
        </div> : null}
        <SheetFooter className="border-t bg-background px-5 py-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:px-6">
          <Button variant="outline" onClick={() => setQuickViewPo(null)}>Close</Button>
          {quickViewPo ? <Button asChild><a href={`/purchase-orders/${encodeURIComponent(String(quickViewPo.id || ""))}`}>Open full PO</a></Button> : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
    <PurchaseOrderApprovalFollowUpDialog decision={approvalDecision} busy={Boolean(actingPoId)} onBusyChange={(busy) => setActingPoId(busy ? approvalDecision?.id || "approval" : "")} onClose={() => setApprovalDecision(null)} onCompleted={async () => { await load(); setQuickViewPo((current) => current ? { ...current, _quickViewHydrated: false } : current) }} user={operatorName} />
    <PurchaseOrderRejectionDialog decision={rejectionDecision} busy={Boolean(actingPoId)} onClose={() => setRejectionDecision(null)} onConfirm={rejectPo} />
    <Dialog open={createPoOpen} onOpenChange={(open) => { if (!createPoSaving) setCreatePoOpen(open) }}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1rem)] max-w-6xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4 sm:px-6">
          <DialogTitle>{createPoMode === "choose" ? "Create or add purchase order" : createPoMode === "external" ? "Add existing purchase order" : "Create new purchase order"}</DialogTitle>
          <DialogDescription>{createPoMode === "choose" ? "Start a new DataPlus PO or bring in an existing PO created in another system." : createPoMode === "external" ? "Select the supplier, upload its text-based PDF, and review every product match before creating the receiving PO." : "Create a warehouse-bound Draft PO now. It will not be sent to the supplier until the normal approval and submission steps are completed."}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          {createPoMode === "choose" ? <div className="grid gap-3 md:grid-cols-2">
            <button type="button" className="grid min-h-40 gap-3 rounded-md border bg-card p-5 text-left transition-colors hover:border-primary hover:bg-muted/30" onClick={() => setCreatePoMode("new")}><span className="grid size-10 place-items-center rounded-md bg-primary text-primary-foreground"><Plus className="size-5" /></span><span><span className="block font-semibold">New PO</span><span className="mt-1 block text-sm text-muted-foreground">Build a new Draft PO from catalog products or manual lines.</span></span></button>
            <button type="button" className="grid min-h-40 gap-3 rounded-md border bg-card p-5 text-left transition-colors hover:border-primary hover:bg-muted/30" onClick={() => setCreatePoMode("external")}><span className="grid size-10 place-items-center rounded-md bg-primary text-primary-foreground"><FileUp className="size-5" /></span><span><span className="block font-semibold">Add existing PO</span><span className="mt-1 block text-sm text-muted-foreground">Upload a supplier PO from another system and match its items to DataPlus.</span></span></button>
          </div> : createPoMode === "external" ? <div className="grid gap-5">
            <div className="grid gap-4 md:grid-cols-2">
              <FormField><FieldLabel>Supplier</FieldLabel><Select value={createPoForm.vendorId} onValueChange={(vendorId) => { setCreatePoForm((current) => ({ ...current, vendorId })); setExternalPoPreview(null) }}><SelectTrigger><SelectValue placeholder="Choose supplier" /></SelectTrigger><SelectContent>{activePurchaseVendors.map((vendor) => <SelectItem key={String(vendor.id)} value={String(vendor.id)}>{String(vendor.name || vendor.id)}</SelectItem>)}</SelectContent></Select><FieldDescription>The supplier profile determines how the ITEM column is matched.</FieldDescription></FormField>
              <FormField><FieldLabel>Receiving warehouse</FieldLabel><Select value={createPoForm.warehouseId} onValueChange={(warehouseId) => setCreatePoForm((current) => ({ ...current, warehouseId }))}><SelectTrigger><SelectValue placeholder="Choose warehouse" /></SelectTrigger><SelectContent>{receivingWarehouses.map((warehouse) => <SelectItem key={String(warehouse.id)} value={String(warehouse.id)}>{String(warehouse.name || warehouse.code || warehouse.id)}</SelectItem>)}</SelectContent></Select><FieldDescription>Inventory will be received into this physical warehouse.</FieldDescription></FormField>
            </div>
            <FormField><FieldLabel>CTech PO PDF</FieldLabel><Input type="file" accept="application/pdf,.pdf" onChange={(event) => { setExternalPoFile(event.target.files?.[0] || null); setExternalPoPreview(null) }} />{externalPoFile ? <FieldDescription>{externalPoFile.name} / {(externalPoFile.size / 1024).toFixed(0)} KB</FieldDescription> : <FieldDescription>Text-based CTech PDFs are parsed locally; no AI usage is required.</FieldDescription>}</FormField>
            <div className="flex justify-end"><Button type="button" variant="outline" disabled={externalPoPreviewing || !createPoForm.vendorId || !externalPoFile} onClick={() => void previewExternalPo()}>{externalPoPreviewing ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />} Preview matches</Button></div>
            {externalPoPreview ? <div className="grid gap-4">
              <div className="grid gap-3 rounded-md border bg-muted/20 p-4 sm:grid-cols-2 lg:grid-cols-5"><Detail label="CTech PO #" value={String(externalPoPreview.document.poNumber || "-")} /><Detail label="Supplier" value={String(externalPoPreview.vendor.name || "-")} /><Detail label="PO date" value={String(externalPoPreview.document.orderedAt || "-")} /><Detail label="Expected" value={String(externalPoPreview.document.expectedAt || "-")} /><Detail label="Total" value={moneyLabel(Number(externalPoPreview.document.total || 0))} /></div>
              {externalPoPreview.duplicate ? <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>PO already exists</AlertTitle><AlertDescription>CTech PO {String(externalPoPreview.document.poNumber || "")} is already linked to {String(externalPoPreview.duplicate.poNumber || "an existing DataPlus PO")}.</AlertDescription></Alert> : null}
              <div className="max-h-72 overflow-auto rounded-md border"><Table><TableHeader className="sticky top-0 z-10 bg-background"><TableRow><TableHead>ITEM / MPN</TableHead><TableHead>Matched SKU</TableHead><TableHead>Description</TableHead><TableHead>Match</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Unit cost</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader><TableBody>{externalPoPreview.items.map((line, index) => <TableRow key={`${String(line.manufacturerPartNumber)}-${index}`}><TableCell className="font-mono text-xs">{String(line.manufacturerPartNumber || "-")}</TableCell><TableCell>{line.sku ? <a className="font-mono text-xs font-medium text-primary hover:underline" href={`/products/${encodeURIComponent(String(line.sku))}`} target="_blank" rel="noreferrer">{String(line.sku)}</a> : <span className="text-destructive">Not found</span>}</TableCell><TableCell className="max-w-72"><p className="truncate" title={String(line.description || "")}>{String(line.description || "-")}</p></TableCell><TableCell><Badge variant={line.matchStatus === "matched" ? "success" : "destructive"}>{line.matchStatus === "matched" ? String(line.matchBasis || "Matched") : line.matchStatus === "ambiguous" ? "Multiple matches" : "No catalog match"}</Badge></TableCell><TableCell className="text-right">{numberLabel(Number(line.qty || 0))}</TableCell><TableCell className="text-right">{moneyLabel(Number(line.unitCost || 0))}</TableCell><TableCell className="text-right font-medium">{moneyLabel(Number(line.lineTotal || 0))}</TableCell></TableRow>)}</TableBody></Table></div>
              {externalPoPreview.duplicate ? null : Number(externalPoPreview.unresolvedLineCount || 0) > 0 ? <Alert className="border-amber-500/40 bg-amber-500/10"><AlertTriangle className="size-4" /><AlertTitle>Ready to add with SKU follow-up</AlertTitle><AlertDescription>{numberLabel(Number(externalPoPreview.unresolvedLineCount || 0))} line{Number(externalPoPreview.unresolvedLineCount || 0) === 1 ? "" : "s"} will be saved as unresolved. The warehouse can receive those lines immediately; their quantities remain on SKU-resolution hold until an existing SKU is linked or the missing SKU is created.</AlertDescription></Alert> : <Alert><CheckCircle2 className="size-4" /><AlertTitle>Ready to add</AlertTitle><AlertDescription>All {numberLabel(externalPoPreview.items.length)} line{externalPoPreview.items.length === 1 ? "" : "s"} matched. DataPlus will preserve the CTech PO number and create a separate internal DataPlus PO number.</AlertDescription></Alert>}
            </div> : null}
            <FormField><FieldLabel>Internal notes</FieldLabel><Textarea className="min-h-20" value={createPoForm.notes} onChange={(event) => setCreatePoForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Optional import or receiving context" /></FormField>
          </div> : <div className="grid gap-5">
            <div className="grid gap-4 md:grid-cols-3">
              <FormField><FieldLabel>Supplier</FieldLabel><Select value={createPoForm.vendorId} onValueChange={(vendorId) => setCreatePoForm((current) => ({ ...current, vendorId }))}><SelectTrigger><SelectValue placeholder="Choose supplier" /></SelectTrigger><SelectContent>{activePurchaseVendors.map((vendor) => <SelectItem key={String(vendor.id)} value={String(vendor.id)}>{String(vendor.name || vendor.id)}</SelectItem>)}</SelectContent></Select><FieldDescription>Only active suppliers can receive a new PO.</FieldDescription></FormField>
              <FormField><FieldLabel>Receiving warehouse</FieldLabel><Select value={createPoForm.warehouseId} onValueChange={(warehouseId) => setCreatePoForm((current) => ({ ...current, warehouseId }))}><SelectTrigger><SelectValue placeholder="Choose warehouse" /></SelectTrigger><SelectContent>{receivingWarehouses.map((warehouse) => <SelectItem key={String(warehouse.id)} value={String(warehouse.id)}>{String(warehouse.name || warehouse.code || warehouse.id)}</SelectItem>)}</SelectContent></Select><FieldDescription>Virtual and dropship locations are excluded.</FieldDescription></FormField>
              <FormField><FieldLabel>Expected arrival</FieldLabel><Input type="date" value={createPoForm.expectedAt} onChange={(event) => setCreatePoForm((current) => ({ ...current, expectedAt: event.target.value }))} /><FieldDescription>Optional until the supplier confirms.</FieldDescription></FormField>
            </div>
            <FormField>
              <FieldLabel>Quick add SKU</FieldLabel>
              <div className="relative"><ScanBarcode className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input autoFocus className="pl-9" value={poCatalogQuery} onChange={(event) => setPoCatalogQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && poCatalogResults[0]) { event.preventDefault(); addPoCatalogItem(poCatalogResults[0]) } }} placeholder="Type or scan SKU, alias, UPC, vendor SKU, or MPN" /></div>
              {poCatalogSearching ? <p className="text-xs text-muted-foreground">Searching catalog...</p> : null}
              {poCatalogQuery.trim().length >= 2 && !poCatalogSearching ? <div className="max-h-56 overflow-y-auto rounded-md border bg-background">{poCatalogResults.map((product) => <button key={String(product.id || product.sku)} type="button" className="grid w-full grid-cols-[minmax(100px,0.35fr)_minmax(0,1fr)_100px] gap-3 border-b px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-muted" onClick={() => addPoCatalogItem(product)}><span className="font-mono text-xs font-medium">{product.sku || "-"}</span><span className="min-w-0"><span className="block truncate font-medium">{product.title || product.sku || "Untitled product"}</span><span className="block truncate text-xs text-muted-foreground">{[product.matchLabel, product.brand, product.supplier].filter(Boolean).join(" / ") || "Catalog product"}</span></span><span className="text-right font-medium">{moneyLabel(Number(product.cost || 0))}</span></button>)}{!poCatalogResults.length ? <p className="p-4 text-sm text-muted-foreground">No catalog products match. Add a manual line below when the supplier SKU is not cataloged yet.</p> : null}</div> : null}
            </FormField>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader><TableRow><TableHead className="min-w-36">SKU</TableHead><TableHead className="min-w-60">Product</TableHead><TableHead className="w-28">Quantity</TableHead><TableHead className="w-36">Unit cost</TableHead><TableHead className="w-28 text-right">Line total</TableHead><TableHead className="w-12" /></TableRow></TableHeader>
                <TableBody>{createPoForm.items.map((line, index) => <TableRow key={`${line.sku}-${index}`}><TableCell><Input value={line.sku} onChange={(event) => updatePoLine(index, { sku: event.target.value })} placeholder="SKU" /></TableCell><TableCell><Input value={line.title} onChange={(event) => updatePoLine(index, { title: event.target.value })} placeholder="Product title" /></TableCell><TableCell><Input type="number" min="1" step="1" value={line.qty} onChange={(event) => updatePoLine(index, { qty: event.target.value })} /></TableCell><TableCell><Input type="number" min="0" step="0.01" value={line.unitCost} onChange={(event) => updatePoLine(index, { unitCost: event.target.value })} placeholder="0.00" /></TableCell><TableCell className="text-right font-medium tabular-nums">{moneyLabel(Number(line.qty || 0) * Number(line.unitCost || 0))}</TableCell><TableCell><Button type="button" size="icon" variant="ghost" title="Remove line" onClick={() => setCreatePoForm((current) => ({ ...current, items: current.items.filter((_, lineIndex) => lineIndex !== index) }))}><Trash2 className="size-4" /></Button></TableCell></TableRow>)}{!createPoForm.items.length ? <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">Search the catalog or add a manual line to begin.</TableCell></TableRow> : null}</TableBody>
              </Table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3"><Button type="button" size="sm" variant="outline" onClick={() => setCreatePoForm((current) => ({ ...current, items: [...current.items, { sku: "", title: "", qty: "1", unitCost: "" }] }))}><Plus className="size-4" /> Add manual line</Button><div className="text-right"><p className="text-xs text-muted-foreground">Estimated PO total</p><p className="text-lg font-semibold tabular-nums">{moneyLabel(createPoForm.items.reduce((sum, line) => sum + (Number(line.qty || 0) * Number(line.unitCost || 0)), 0))}</p></div></div>
            <FormField><FieldLabel>Buyer notes</FieldLabel><Textarea className="min-h-24" value={createPoForm.notes} onChange={(event) => setCreatePoForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Terms, supplier instructions, reason for purchase, or internal receiving notes" /></FormField>
          </div>}
        </div>
        <DialogFooter className="border-t bg-muted/20 px-5 py-4 sm:px-6">{createPoMode !== "choose" ? <Button variant="outline" disabled={createPoSaving || externalPoPreviewing} onClick={() => { setCreatePoMode("choose"); setExternalPoPreview(null) }}><ArrowLeft className="size-4" /> Back</Button> : null}<Button variant="outline" disabled={createPoSaving || externalPoPreviewing} onClick={() => setCreatePoOpen(false)}>Cancel</Button>{createPoMode === "new" ? <Button disabled={createPoSaving} onClick={() => void saveManualPo()}>{createPoSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save draft</Button> : createPoMode === "external" ? <Button disabled={createPoSaving || externalPoPreviewing || !externalPoPreview?.readyToCreate} onClick={() => void saveExternalPo()}>{createPoSaving ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />} Add existing PO</Button> : null}</DialogFooter>
      </DialogContent>
    </Dialog>
    <AlertDialog open={forcePoolOpen} onOpenChange={setForcePoolOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Attach older lines to Draft POs?</AlertDialogTitle><AlertDialogDescription>DataPlus will group {numberLabel(pooledRequirements.length)} older purchase line{pooledRequirements.length === 1 ? "" : "s"} by supplier and receiving warehouse, then create or update local numbered Draft POs. It will not approve, submit, or send anything to a supplier.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={poolingBusy}>Cancel</AlertDialogCancel><AlertDialogAction disabled={poolingBusy} onClick={(event) => { event.preventDefault(); void runPurchasePool(true) }}>{poolingBusy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Attach to Draft POs</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>
}

function PurchasingSupplierPoolPage({ supplierKey }: { supplierKey: string }) {
  const [data, setData] = useState<{ purchaseOrders?: Array<Record<string, unknown>> }>({})
  const [loading, setLoading] = useState(true)
  const load = async () => {
    setLoading(true)
    try { setData(await api("/api/purchasing/work")) }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load draft POs.") }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [supplierKey])

  const purchaseOrders = (data.purchaseOrders || []).filter((po) => (purchaseOrderIsWaiting(po) || purchaseOrderIsReadyToSubmit(po)) && waitingPoSupplierKey(po) === supplierKey)
  const allItems = purchaseOrders.flatMap(purchaseOrderItems)
  const supplier = String(purchaseOrders[0]?.supplier || (supplierKey.startsWith("name:") ? supplierKey.slice(5) : "Supplier"))
  const vendorId = String(purchaseOrders[0]?.vendorId || "")
  const orderIds = new Set(allItems.map((line) => String(line.orderId || "")).filter(Boolean))
  const skus = new Set(allItems.map((line) => String(line.sku || "")).filter(Boolean))
  const units = allItems.reduce((sum, line) => sum + Number(line.qty || 0), 0)
  const openCost = purchaseOrders.reduce((sum, po) => sum + Number(po.openEstimatedCost ?? po.estimatedCost ?? 0), 0)
  const buyerActionCount = purchaseOrders.filter((po) => purchaseOrderNextStep(po).priority > 1).length

  return <div className="grid gap-5">
    <PageHeader eyebrow="Purchasing / Draft POs" title={`${supplier} - Draft POs`} description="Numbered draft purchase orders collecting linked customer orders and supplier SKUs until buyer submission." action={<div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" asChild><a href="/purchasing">Back to purchasing</a></Button><ContextActions disabled={loading} label="Draft PO actions" actions={[
      { id: "refresh", label: "Refresh drafts", description: "Reload draft POs, customer orders, and SKU quantities.", icon: loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />, onSelect: () => void load() },
      ...(vendorId ? [{ id: "vendor", label: "Open supplier profile", description: "Review purchasing rules, cutoff, contacts, and source settings.", icon: <Store className="size-4" />, group: "Utilities" as const, onSelect: () => { window.location.href = `/vendors/${encodeURIComponent(vendorId)}` } }] : []),
    ]} /></div>} />

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><Detail label="Draft POs" value={numberLabel(purchaseOrders.length)} /><Detail label="Customer orders" value={numberLabel(orderIds.size)} /><Detail label="Unique SKUs" value={numberLabel(skus.size)} /><Detail label="Units" value={numberLabel(units)} /><Detail label="Open cost" value={moneyLabel(openCost)} /><Detail label="Needs buyer action" value={numberLabel(buyerActionCount)} /></div>

    <Alert><Clock3 className="size-4" /><AlertTitle>Orders keep joining the open draft</AlertTitle><AlertDescription>Each draft is fixed to one supplier and receiving warehouse. New eligible demand is appended idempotently until the PO is submitted or placed; the next order then opens a new numbered draft.</AlertDescription></Alert>

    {purchaseOrders.map((po) => {
      const items = purchaseOrderItems(po)
      const poOrders = new Set(items.map((line) => String(line.orderId || "")).filter(Boolean))
      const nextStep = purchaseOrderNextStep(po)
      return <Card key={String(po.id)}>
        <CardHeader className="gap-3 border-b lg:flex-row lg:items-center lg:justify-between"><div><div className="flex flex-wrap items-center gap-2"><CardTitle className="text-base"><a className="hover:underline" href={`/purchase-orders/${encodeURIComponent(String(po.id || ""))}`}>{String(po.poNumber || "Draft PO")}</a></CardTitle><Badge variant={nextStep.variant}>{nextStep.label}</Badge></div><CardDescription>{String(po.warehouseName || "Receiving warehouse not assigned")} · {numberLabel(poOrders.size)} order{poOrders.size === 1 ? "" : "s"} · updated {dateLabel(String(po.updatedAt || po.createdAt || ""))}</CardDescription><p className="mt-1 text-xs text-muted-foreground">{nextStep.description}</p></div><div className="flex flex-wrap items-center gap-3"><PurchaseScheduleSummary record={po} /><Button size="sm" variant="outline" asChild><a href={`/purchase-orders/${encodeURIComponent(String(po.id || ""))}`}>Open draft PO</a></Button></div></CardHeader>
        <CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead className="w-14">Item</TableHead><TableHead>SKU / product</TableHead><TableHead>Supplier</TableHead><TableHead>Mfr part #</TableHead><TableHead>Vendor part #</TableHead><TableHead>Vendor SKU</TableHead><TableHead>Customer order</TableHead><TableHead>Quantity</TableHead><TableHead>Unit cost</TableHead><TableHead>Line total</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{items.map((line, index) => { const sku = String(line.sku || ""); const orderId = String(line.orderId || ""); const quantity = Number(line.qty || 0); const unitCost = Number(line.unitCost ?? line.estimatedUnitCost ?? 0); return <TableRow key={String(line.routeId || `${sku}-${orderId}-${index}`)}><TableCell><CatalogImage src={String(line.defaultImage || "")} alt={String(line.title || sku || "Product")} className="size-10 shrink-0" imageClassName="size-full" /></TableCell><TableCell><a className="font-medium hover:underline" href={`/products/${encodeURIComponent(sku)}`}>{sku || "Missing SKU"}</a><p className="max-w-80 truncate text-xs text-muted-foreground" title={String(line.title || "")}>{String(line.title || "Untitled product")}</p></TableCell><TableCell><PurchaseLineSupplier line={line} fallbackSupplier={String(po.supplier || "")} /></TableCell><TableCell className="font-mono text-xs">{String(line.mfrPartNumber || line.manufacturerPartNumber || line.mpn || "-")}</TableCell><TableCell className="font-mono text-xs">{String(line.vendorPartNumber || line.vendorPart || line.partNumber || "-")}</TableCell><TableCell className="font-mono text-xs">{String(line.vendorSku || "-")}</TableCell><TableCell><a className="font-medium hover:underline" href={`/orders/${encodeURIComponent(orderId)}`}>{String(line.orderNumber || orderId || "-")}</a></TableCell><TableCell>{numberLabel(quantity)}</TableCell><TableCell>{moneyLabel(unitCost)}</TableCell><TableCell>{moneyLabel(quantity * unitCost)}</TableCell><TableCell><Badge variant="secondary">Added to draft</Badge></TableCell></TableRow>})}{!items.length && <TableRow><TableCell colSpan={11} className="h-24 text-center text-muted-foreground">This draft has no linked lines.</TableCell></TableRow>}</TableBody></Table></div></CardContent>
      </Card>
    })}

    {!loading && !purchaseOrders.length && <Empty className="rounded-lg border"><EmptyHeader><EmptyMedia variant="icon"><CheckCircle2 /></EmptyMedia><EmptyTitle>No open draft PO</EmptyTitle><EmptyDescription>This supplier's demand may have been submitted, rerouted, received, or resolved. New eligible demand will open the next numbered draft automatically.</EmptyDescription></EmptyHeader><Button variant="outline" asChild><a href="/purchasing">Return to purchasing</a></Button></Empty>}
    {loading && <Card><CardContent className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading draft purchase orders...</CardContent></Card>}
  </div>
}

export function LegacyPurchasingSupplierPoolPage({ supplierKey, operatorName = "Buyer" }: { supplierKey: string; operatorName?: string }) {
  const [data, setData] = useState<{ requirements?: Array<Record<string, unknown>> }>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const load = async () => {
    setLoading(true)
    try { setData(await api("/api/purchasing/work")) }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load supplier demand.") }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [supplierKey])

  const requirements = (data.requirements || []).filter((row) => String(row.status || "").toLowerCase() === "pooled" && pooledSupplierKey(row) === supplierKey)
  const supplierGroup = groupPooledRequirements(requirements)[0]
  const supplier = supplierGroup?.supplier || (supplierKey.startsWith("name:") ? supplierKey.slice(5) : "Supplier")
  const vendorId = supplierGroup?.vendorId || ""
  const orderCount = new Set(requirements.map((row) => String(row.orderId || "")).filter(Boolean)).size
  const skuCount = new Set(requirements.map((row) => String(row.sku || "")).filter(Boolean)).size
  const unitCount = requirements.reduce((sum, row) => sum + Number(row.qty || 0), 0)
  const dueCount = requirements.filter((row) => pooledRequirementCutoff(row) <= Date.now()).length
  const destinationGroups = [...requirements.reduce((groups, row) => {
    const destination = pooledRequirementDestination(row)
    const poolDate = String(row.poolDate || row.cutoffDate || "Next business day")
    const cutoffTime = String(row.cutoffTime || "15:00")
    const key = `${destination}|${poolDate}|${cutoffTime}`
    const group = groups.get(key) || { key, destination, poolDate, cutoffTime, requirements: [] as Array<Record<string, unknown>> }
    group.requirements.push(row)
    groups.set(key, group)
    return groups
  }, new Map<string, { key: string; destination: string; poolDate: string; cutoffTime: string; requirements: Array<Record<string, unknown>> }>()).values()]

  const createSupplierPos = async (force: boolean) => {
    setBusy(true)
    try {
      const result = await api<{ message?: string; purchaseOrders?: Array<Record<string, unknown>> }>("/api/purchasing/pool/run", {
        method: "POST",
        body: JSON.stringify({ requirementIds: requirements.map((row) => String(row.id)), vendorId: vendorId || undefined, force, user: operatorName }),
      })
      toast.success(result.message || `${numberLabel(result.purchaseOrders?.length || 0)} supplier POs created.`)
      setConfirmOpen(false)
      await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to process this supplier pool.") }
    finally { setBusy(false) }
  }

  return <div className="grid gap-5">
    <PageHeader eyebrow="Purchasing / supplier pool" title={`${supplier} pooled demand`} description="Customer-order lines are combined by supplier for buyer review, while receiving destinations remain separate PO groups." action={<div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" asChild><a href="/purchasing">Back to purchasing</a></Button><ContextActions disabled={loading || busy} label="Pool actions" actions={[
      { id: "refresh", label: "Refresh supplier pool", description: "Reload linked customer orders and pooled quantities.", icon: loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />, onSelect: () => void load() },
      { id: "run-due", label: "Run due cutoff groups", description: "Create POs only for this supplier's groups whose cutoff has passed.", icon: <Play className="size-4" />, disabled: dueCount === 0, onSelect: () => void createSupplierPos(false) },
      { id: "create-now", label: "Create this supplier's POs now", description: "Bypass cutoff and create draft POs for this supplier only.", icon: <ShoppingBag className="size-4" />, disabled: requirements.length === 0, onSelect: () => setConfirmOpen(true) },
      ...(vendorId ? [{ id: "vendor", label: "Open supplier profile", description: "Review purchasing rules, cutoff, contacts, and source settings.", icon: <Store className="size-4" />, group: "Utilities" as const, onSelect: () => { window.location.href = `/vendors/${encodeURIComponent(vendorId)}` } }] : []),
    ]} /></div>} />

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Detail label="Customer orders" value={numberLabel(orderCount)} /><Detail label="Unique SKUs" value={numberLabel(skuCount)} /><Detail label="Units" value={numberLabel(unitCount)} /><Detail label="PO groups" value={numberLabel(destinationGroups.length)} /><Detail label="Due now" value={numberLabel(dueCount)} /></div>

    <Alert><Clock3 className="size-4" /><AlertTitle>One supplier, compatible PO groups</AlertTitle><AlertDescription>All demand below belongs to {supplier}. DataPlus keeps each receiving destination and cutoff group separate when draft POs are created, so customer orders are combined without mixing incompatible receipts.</AlertDescription></Alert>

    {destinationGroups.map((group) => {
      const groupOrders = new Set(group.requirements.map((row) => String(row.orderId || "")).filter(Boolean)).size
      const groupUnits = group.requirements.reduce((sum, row) => sum + Number(row.qty || 0), 0)
      const groupDue = group.requirements.some((row) => pooledRequirementCutoff(row) <= Date.now())
      return <Card key={group.key}><CardHeader className="gap-3 border-b sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><CardTitle className="text-base">{group.destination}</CardTitle><Badge variant={groupDue ? "destructive" : "secondary"}>{groupDue ? "Cutoff due" : "Pooling"}</Badge></div><CardDescription>{numberLabel(groupOrders)} customer order{groupOrders === 1 ? "" : "s"} · {numberLabel(groupUnits)} units</CardDescription></div><div className="text-sm"><p className="font-medium">Cutoff {group.cutoffTime}</p><p className="text-xs text-muted-foreground">{group.poolDate}</p></div></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Customer order</TableHead><TableHead>Customer</TableHead><TableHead>SKU / item</TableHead><TableHead>Quantity</TableHead><TableHead>Source</TableHead><TableHead>Ship by</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{group.requirements.map((row) => <TableRow key={String(row.id)}><TableCell><a className="font-medium hover:underline" href={`/orders/${encodeURIComponent(String(row.orderId || ""))}`}>{String(row.orderNumber || row.orderId || "-")}</a></TableCell><TableCell>{String(row.customer || "Customer")}</TableCell><TableCell><a className="font-medium hover:underline" href={`/products/${encodeURIComponent(String(row.sku || ""))}`}>{String(row.sku || "-")}</a>{row.title ? <p className="max-w-72 truncate text-xs text-muted-foreground" title={String(row.title)}>{String(row.title)}</p> : null}</TableCell><TableCell>{numberLabel(Number(row.qty || 0))}</TableCell><TableCell>{String(row.sourceWarehouseName || row.sourceName || "Supplier feed")}</TableCell><TableCell>{String(row.shipBy || "-")}</TableCell><TableCell><Badge variant="secondary">Pooled</Badge></TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>
    })}

    {!loading && !requirements.length && <Empty className="rounded-lg border"><EmptyHeader><EmptyMedia variant="icon"><CheckCircle2 /></EmptyMedia><EmptyTitle>No pooled demand remains for this supplier</EmptyTitle><EmptyDescription>The requirements may have moved into purchase orders, been rerouted, or been resolved.</EmptyDescription></EmptyHeader><Button variant="outline" asChild><a href="/purchasing">Return to purchasing</a></Button></Empty>}
    {loading && <Card><CardContent className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading supplier orders...</CardContent></Card>}

    <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Create {supplier} purchase orders now?</AlertDialogTitle><AlertDialogDescription>This bypasses the cutoff for {numberLabel(requirements.length)} pooled line{requirements.length === 1 ? "" : "s"} across {numberLabel(orderCount)} customer order{orderCount === 1 ? "" : "s"}. DataPlus will create separate draft POs for compatible receiving destinations. Buyer approval rules still apply.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>Keep pooling</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); void createSupplierPos(true) }}>{busy ? <Loader2 className="size-4 animate-spin" /> : <ShoppingBag className="size-4" />} Create supplier POs</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>
}

