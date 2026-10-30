import { Alert,AlertDescription,AlertTitle } from "@/components/ui/alert"
import { AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible,CollapsibleContent,CollapsibleTrigger } from "@/components/ui/collapsible"
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { HoverCard,HoverCardContent,HoverCardTrigger } from "@/components/ui/hover-card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup,RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Sheet,SheetContent,SheetDescription,SheetFooter,SheetHeader,SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs,TabsContent,TabsList,TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip,TooltipContent,TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  AlertCircle,
  Archive,
  ArrowUpDown,
  Ban,
  Boxes,
  ExternalLink,
  FileDown,
  FileText,
  FileUp,
  Link2,
  Loader2,
  Mail,
  MoreHorizontal,
  PackageSearch,
  Pencil,
  Printer,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Store,
  Trash2,
  Truck,
  Warehouse,
  X
} from "lucide-react"
import { useEffect,useRef,useState,type ClipboardEvent as ReactClipboardEvent } from "react"
import { toast } from "sonner"
import type {
  ImportJob,
  ProductItem
} from "../App"
import {
  orderHref
} from "../App"
import { loadAppBootstrap } from "../lib/app-state"
import { api,dateLabel,moneyLabel,numberLabel } from "../lib/client-api"
import { readWorkspaceCache,writeWorkspaceCache } from "../lib/workspace-cache"
import { orderChannelFilterLabel,orderChannelFilterValue } from "./ebay-live-mark"
import { OrderReturnDetails,ReturnReceiptFields } from "./order-return-details"

import { ContextActions,Detail,Field,PageHeader,ToggleField } from "./app-ui"
import { rmaHref } from "./product-workspaces"
import { shipmentTrackingCarriers,trackingUrlForShipment } from "./shipment-links"

export { shipmentDisplayValue,trackingUrlForShipment } from "./shipment-links"

type OrderRoutingState = {
  hasActiveRoutes: boolean
  needsRouting: boolean
  needsReview: boolean
  label: "Routed" | "Needs review" | "Not routed" | "Not required"
  detail: string
}

function orderRouteNeedsReview(route: Record<string, unknown>) {
  const status = String(route.status || "").trim().toLowerCase()
  const detail = String(route.reviewReason || route.reason || route.message || "").trim()
  const hasPurchaseOrder = Boolean(route.purchaseOrderId || route.purchaseOrderNumber)
  if (status === "buyer_review" && hasPurchaseOrder && !detail) return false
  return ["exception", "buyer_review", "blocked"].includes(status)
}

export function getOrderRoutingState(order: Record<string, unknown>): OrderRoutingState {
  const routes = Array.isArray(order.fulfillmentRoutes) ? order.fulfillmentRoutes as Array<Record<string, unknown>> : []
  const activeRoutes = routes.filter((route) => {
    const status = String(route.status || "").trim().toLowerCase()
    const quantity = Number(route.qty || route.quantity || 0)
    return quantity > 0 && !["shipped", "delivered", "canceled", "cancelled", "closed", "received"].includes(status)
  })
  const payments = Array.isArray(order.payments) ? order.payments as Array<Record<string, unknown>> : []
  const financialStatus = String(order.financialStatus || order.paymentStatus || "").trim().toLowerCase()
  const paymentCleared = ["paid", "partially paid", "partially_paid", "authorized"].includes(financialStatus)
    || payments.some((payment) => ["authorized", "captured", "paid"].includes(String(payment.status || "").trim().toLowerCase()))
  const orderStatus = String(order.status || "").trim().toLowerCase()
  const operationalStatus = String(order.operationalStatus || order.workflowStatus || "").trim().toLowerCase()
  const fulfillmentStatus = String(order.fulfillmentStatus || order.fulfillmentStage || "").trim().toLowerCase()
  const terminal = ["canceled", "cancelled", "void", "voided", "deleted", "archived", "shipped", "fulfilled", "delivered", "completed", "complete", "done", "closed"].includes(orderStatus)
    || ["completed", "done", "canceled", "cancelled"].includes(operationalStatus)
    || ["fulfilled", "shipped", "delivered", "completed", "complete", "done", "closed"].includes(fulfillmentStatus)
  const items = Array.isArray(order.items)
    ? order.items as Array<Record<string, unknown>>
    : Array.isArray(order.lineItems)
      ? order.lineItems as Array<Record<string, unknown>>
      : []
  const hasOpenItems = items.some((item) => Number(item.qty || item.quantity || 0) > Number(item.fulfilledQty || item.qtyFulfilled || 0))
  const needsRouting = paymentCleared && !terminal && hasOpenItems && activeRoutes.length === 0

  const reviewRoutes = activeRoutes.filter(orderRouteNeedsReview)
  if (reviewRoutes.length) {
    const route = reviewRoutes[0]
    return {
      hasActiveRoutes: false,
      needsRouting: false,
      needsReview: true,
      label: "Needs review",
      detail: String(route.reviewReason || route.reason || route.message || "A routed line needs buyer or management review before it can move forward.")
    }
  }
  if (activeRoutes.length) return { hasActiveRoutes: true, needsRouting: false, needsReview: false, label: "Routed", detail: "Warehouse or supplier routing is assigned." }
  if (needsRouting) return { hasActiveRoutes: false, needsRouting: true, needsReview: false, label: "Not routed", detail: "This paid, open order has no warehouse or supplier routing yet." }
  return { hasActiveRoutes: false, needsRouting: false, needsReview: false, label: "Not required", detail: "Routing becomes available after payment clears while open items remain." }
}

const DONE_ORDER_STATUSES = new Set(["shipped", "fulfilled", "delivered", "completed", "complete", "done", "closed"])

function normalizedOrderStatusValue(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_")
}

function orderExternalStatusValues(row: Record<string, unknown>) {
  const external = row.external && typeof row.external === "object" ? row.external as Record<string, unknown> : {}
  return [
    row.status,
    row.fulfillmentStatus,
    row.fulfillmentStage,
    row.channelStatus,
    row.marketplaceStatus,
    external.status,
    external.fulfillmentStatus,
    external.fulfillmentStage,
    external.orderStatus,
    external.orderFulfillmentStatus,
    external.parentOrderStatus,
    external.packageStatus,
    external.shippingStatus,
  ].map(normalizedOrderStatusValue).filter(Boolean)
}

export function isDoneOrderRow(row: Record<string, unknown>) {
  if ((row.shipmentCorrection as Record<string, unknown> | undefined)?.active) return false
  if (["canceled", "cancelled", "void", "voided", "deleted"].includes(normalizedOrderStatusValue(row.status)) || row.cancelledAt) return false
  if (unresolvedOrderExceptions(row).some((entry) => ["blocking", "error", "critical", "destructive"].includes(normalizedOrderStatusValue(entry.severity)))) return false
  const operational = normalizedOrderStatusValue(row.operationalStatus || row.workflowStatus)
  if (operational === "on_hold") return false
  const shipments = Array.isArray(row.shipments) ? row.shipments as Array<Record<string, unknown>> : []
  const lines = Array.isArray(row.items) ? row.items as Array<Record<string, unknown>> : []
  const total = lines.reduce((sum, line) => sum + Number(line.qty || 0), 0)
  const shipped = shipments.filter((shipment) => DONE_ORDER_STATUSES.has(normalizedOrderStatusValue(shipment.status || shipment.fulfillmentStatus || shipment.shipmentStatus))).flatMap((shipment) => Array.isArray(shipment.lines) ? shipment.lines as Array<Record<string, unknown>> : []).reduce((sum, line) => sum + Number(line.qtyFulfilled ?? line.qty ?? 0), 0)
  return orderExternalStatusValues(row).some((status) => DONE_ORDER_STATUSES.has(status))
    || ["completed", "done"].includes(operational)
    || (total > 0 && shipped >= total)
}

export function orderStateLabel(value: unknown) {
  const text = String(value || "").trim()
  return text ? text.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : ""
}

function unresolvedOrderExceptions(order: Record<string, unknown>) {
  return (Array.isArray(order.workflowExceptions) ? order.workflowExceptions as Array<Record<string, unknown>> : [])
    .filter((entry) => String(entry.status || "open").toLowerCase() !== "resolved")
}

function orderExceptionTitle(entry: Record<string, unknown>) {
  return String(entry.title || entry.sku || entry.type || "Order exception").replace(/_/g, " ")
}

function orderExceptionDetail(entry: Record<string, unknown>) {
  return String(entry.description || entry.message || entry.reason || "This line requires operational review.")
}

export function orderHasBlockingException(order: Record<string, unknown>) {
  const exceptions = unresolvedOrderExceptions(order)
  const routes = Array.isArray(order.fulfillmentRoutes) ? order.fulfillmentRoutes as Array<Record<string, unknown>> : []
  return exceptions.some((entry) => {
    const severity = String(entry.severity || "").toLowerCase()
    const owner = String(entry.owner || "").toLowerCase()
    const type = String(entry.type || entry.title || "").toLowerCase()
    const message = String(entry.message || entry.description || "").toLowerCase()
    const apiOnlyWarning = severity === "warning" && (owner.includes("api") || type.includes("api") || message.includes("api error"))
    return !apiOnlyWarning && ["blocking", "error", "critical", "destructive"].includes(severity)
  }) || routes.some(orderRouteNeedsReview)
}

export function orderAttentionItems(order: Record<string, unknown>) {
  const exceptionItems = unresolvedOrderExceptions(order).map((entry) => ({
    id: String(entry.id || `${entry.type || entry.title || "exception"}-${entry.createdAt || ""}`),
    title: orderExceptionTitle(entry),
    detail: orderExceptionDetail(entry),
    severity: String(entry.severity || "blocking"),
    source: String(entry.owner || "Orders")
  }))
  const routes = Array.isArray(order.fulfillmentRoutes) ? order.fulfillmentRoutes as Array<Record<string, unknown>> : []
  const routeItems = routes
    .filter(orderRouteNeedsReview)
    .map((route, index) => ({
      id: String(route.id || `route-${index}`),
      title: `Routing review: ${String(route.sku || "Unmatched SKU")}`,
      detail: String(route.reviewReason || route.reason || route.message || "Review this route before purchasing or fulfillment."),
      severity: String(route.status || "buyer_review"),
      source: String(route.vendorName || route.warehouseName || route.type || "Routing")
    }))
  return [...exceptionItems, ...routeItems]
}

export function OrderActionsMenu({ order, busy, onAction, onRefresh, onRefreshRouting, onCreatePurchaseOrders, onPrintTemuLabel, unshippableShipments = [], onUnshipShipment }: { order: Record<string, unknown>; busy?: boolean; onAction: (action: string, body?: Record<string, unknown>) => Promise<void>; onRefresh?: () => void; onRefreshRouting?: () => void; onCreatePurchaseOrders?: () => void; onPrintTemuLabel?: () => void; unshippableShipments?: Array<Record<string, unknown>>; onUnshipShipment?: (shipment: Record<string, unknown>) => void }) {
  const [cancelOpen, setCancelOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)
  const [mode, setMode] = useState<"local" | "channel">("local")
  const [reason, setReason] = useState("OTHER")
  const [note, setNote] = useState("")
  const [restock, setRestock] = useState(true)
  const [notifyCustomer, setNotifyCustomer] = useState(false)
  const [confirmation, setConfirmation] = useState("")
  const isShopify = String(order.source || "").toLowerCase() === "shopify"
  const isTemu = String(order.source || "").toLowerCase() === "temu"
  const reference = String(order.internalOrderNumber || order.orderNumber || order.id || "")
  const packingSlipUrl = `/api/orders/${encodeURIComponent(String(order.id || ""))}/packing-slip`
  const cancel = async () => {
    await onAction("cancel", { notifyChannel: mode === "channel", reason, note, restock, notifyCustomer })
    setCancelOpen(false)
  }
  const remove = async () => {
    await onAction("delete", { confirmation, reason: note || "Deleted from DataPlus" })
    setDeleteOpen(false)
  }
  const voidOrder = async () => {
    await onAction("void", { reason: "Voided locally from the order workspace" })
    setVoidOpen(false)
  }
  return <>
    <ContextActions disabled={busy} actions={[
      ...(onRefresh ? [{ id: "refresh", label: "Refresh order", description: "Reload the order, its channel data, and current workflow state.", icon: <RefreshCw className="size-4" />, onSelect: onRefresh }] : []),
      ...(onRefreshRouting ? [{ id: "refresh-routing", label: "Refresh routing", description: "Re-evaluate warehouse stock, allocations, and supplier purchase requirements.", icon: <RefreshCw className="size-4" />, onSelect: onRefreshRouting }] : []),
      { id: "packing-slip", label: "Print packing slip", description: "Open a printable packing slip in a new tab.", icon: <FileDown className="size-4" />, onSelect: () => window.open(packingSlipUrl, "_blank", "noopener,noreferrer") },
      ...(onPrintTemuLabel ? [{ id: "shipping-label", label: "Print shipping label", description: isTemu ? "Load Temu and universal carrier label options." : "Load universal carrier label options for this order.", icon: <Truck className="size-4" />, onSelect: onPrintTemuLabel }] : []),
      { id: "accounting-export", label: "Accounting exports", description: "Review posted ledger entries and export history.", icon: <FileDown className="size-4" />, group: "Utilities", onSelect: () => { window.location.href = `/accounting?order=${encodeURIComponent(String(order.id))}&transactionsView=exports` } },
      ...(isShopify ? [{ id: "sync-address", label: "Send address to Shopify", description: "Push the current order address to Shopify.", icon: <RefreshCw className="size-4" />, onSelect: () => void onAction("sync-address") }] : []),
      { id: "fulfill-all", label: "Record full shipment", description: "Open fulfillment for every remaining line item.", icon: <Truck className="size-4" />, onSelect: () => window.dispatchEvent(new CustomEvent("dataplus:order-detail-action", { detail: { action: "fulfill-all" } })) },
      { id: "fulfill-partial", label: "Record partial shipment", description: "Choose the items and quantities to fulfill now.", icon: <Truck className="size-4" />, onSelect: () => window.dispatchEvent(new CustomEvent("dataplus:order-detail-action", { detail: { action: "fulfill-partial" } })) },
      { id: "create-rma", label: "Create RMA", description: "Select returned items and start receiving, inspection, disposition, and refund review.", icon: <RotateCcw className="size-4" />, onSelect: () => window.dispatchEvent(new CustomEvent("dataplus:order-detail-action", { detail: { action: "create-rma" } })) },
      ...((onUnshipShipment && unshippableShipments.length) ? unshippableShipments.map((shipment, index) => {
        const trackingNumber = String(shipment.trackingNumber || shipment.trackingNo || shipment.trackingCode || "").trim()
        const carrier = String(shipment.carrierName || shipment.carrier || shipment.service || "Shipment").trim()
        const reference = String(shipment.reference || trackingNumber || carrier || `shipment ${index + 1}`).trim()
        return {
          id: `unship-${String(shipment.id || reference || index)}`,
          label: unshippableShipments.length > 1 ? `Unship ${reference}` : "Unship shipment",
          description: trackingNumber ? `Reopen ${carrier} tracking ${trackingNumber} locally so it can be shipped again in DataPlus.` : "Reopen this shipment locally so the order can be fulfilled again in DataPlus.",
          icon: <RotateCcw className="size-4" />,
          group: "Utilities" as const,
          onSelect: () => onUnshipShipment(shipment)
        }
      }) : []),
      ...(onCreatePurchaseOrders ? [{ id: "create-pos", label: "Create supplier PO(s)", description: "Split unassigned purchase requirements by supplier.", icon: <Boxes className="size-4" />, onSelect: onCreatePurchaseOrders }] : []),
      { id: "hold", label: "Place on hold", description: "Keep this order out of active fulfillment.", icon: <Archive className="size-4" />, group: "Utilities", onSelect: () => void onAction("hold") },
      { id: "archive", label: "Archive locally", description: "Archive this DataPlus record without changing its sales channel.", icon: <Archive className="size-4" />, group: "Utilities", onSelect: () => void onAction("archive") },
      { id: "void", label: "Void locally", description: "Remove this order from DataPlus operational fulfillment only.", icon: <X className="size-4" />, group: "Danger zone", destructive: true, onSelect: () => setVoidOpen(true) },
      { id: "cancel", label: "Cancel order", description: "Choose local-only cancellation or also notify the sales channel.", icon: <X className="size-4" />, group: "Danger zone", destructive: true, onSelect: () => setCancelOpen(true) },
      { id: "delete", label: "Delete locally", description: "Permanently remove the DataPlus record after confirmation.", icon: <Trash2 className="size-4" />, group: "Danger zone", destructive: true, onSelect: () => setDeleteOpen(true) },
    ]} />
    <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>Cancel {reference}</DialogTitle><DialogDescription>Choose whether this cancellation stays inside DataPlus or is also sent to Shopify. Shopify cancellations are irreversible and this action does not issue a refund.</DialogDescription></DialogHeader>
        <div className="grid gap-4 py-2">
          <Field label="Cancellation scope"><Select value={mode} onValueChange={(value) => setMode(value as "local" | "channel")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="local">Cancel locally only</SelectItem>{isShopify && <SelectItem value="channel">Cancel locally and send to Shopify</SelectItem>}</SelectContent></Select></Field>
          <Field label="Reason"><Select value={reason} onValueChange={setReason}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="CUSTOMER">Customer request</SelectItem><SelectItem value="INVENTORY">Inventory unavailable</SelectItem><SelectItem value="FRAUD">Fraud</SelectItem><SelectItem value="DECLINED">Payment declined</SelectItem><SelectItem value="STAFF">Staff error</SelectItem><SelectItem value="OTHER">Other</SelectItem></SelectContent></Select></Field>
          {mode === "channel" && <div className="grid gap-3 rounded-md border p-3"><ToggleField label="Restock Shopify inventory" checked={restock} onCheckedChange={setRestock} /><ToggleField label="Email customer" checked={notifyCustomer} onCheckedChange={setNotifyCustomer} /></div>}
          <Field label="Internal note"><Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional cancellation note" /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setCancelOpen(false)}>Back</Button><Button variant="destructive" disabled={busy} onClick={() => void cancel()}>Cancel order</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <AlertDialog open={voidOpen} onOpenChange={setVoidOpen}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Void {reference} locally?</AlertDialogTitle><AlertDialogDescription>This removes the order from operational fulfillment without changing the sales channel. Use Cancel order when Shopify or another channel should be notified.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Keep order active</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={busy} onClick={() => void voidOrder()}>Void locally</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>Delete {reference} locally?</DialogTitle><DialogDescription>This removes the DataPlus operational record only. It does not change Shopify or any other sales channel.</DialogDescription></DialogHeader>
        <Field label={`Type ${reference} to confirm`}><Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></Field>
        <DialogFooter><Button variant="outline" onClick={() => setDeleteOpen(false)}>Back</Button><Button variant="destructive" disabled={busy || confirmation !== reference} onClick={() => void remove()}>Delete locally</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}

function accountingDateLabel(value: unknown) {
  const raw = String(value || "").trim()
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return "-"
  const [, year, month, day] = match
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(Number(year), Number(month) - 1, Number(day)))
}

export function OrderFinancePanel({ orderId, order, lines, onUpdated }: { orderId: string; order: Record<string, unknown>; lines: Array<Record<string, unknown>>; onUpdated: () => Promise<void> }) {
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [refundOpen, setRefundOpen] = useState(false)
  const [shippingAdjustmentOpen, setShippingAdjustmentOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [payment, setPayment] = useState({ amount: "", provider: "Manual", status: "captured", transactionId: "" })
  const [refund, setRefund] = useState({ amount: "", method: "manual", reference: "", reason: "Customer request", note: "" })
  const [shippingAdjustment, setShippingAdjustment] = useState({ amount: "", reference: "", reason: "Carrier or channel billing adjustment", source: String(order.source || "Manual") })
  const payments = Array.isArray(order.payments) ? order.payments as Array<Record<string, unknown>> : []
  const refunds = Array.isArray(order.refunds) ? order.refunds as Array<Record<string, unknown>> : []
  const profitLoss = order.profitLoss && typeof order.profitLoss === "object" ? order.profitLoss as Record<string, unknown> : {}
  const total = Number(profitLoss.orderTotal ?? order.total ?? 0)
  const paid = payments.filter((row) => ["paid", "captured", "success"].includes(String(row.status || "").toLowerCase())).reduce((sum, row) => sum + Number(row.amount || 0), 0)
  const refunded = Number(profitLoss.refunds ?? order.refundAmount ?? 0) || refunds.reduce((sum, row) => sum + Number(row.amount || 0), 0)
  const financials = order.financials && typeof order.financials === "object" ? order.financials as Record<string, unknown> : {}
  const channelFee = financials.channelFee && typeof financials.channelFee === "object" ? financials.channelFee as Record<string, unknown> : {}
  const shippingFinance = financials.shipping && typeof financials.shipping === "object" ? financials.shipping as Record<string, unknown> : {}
  const settlements = Array.isArray(financials.settlements) ? financials.settlements as Array<Record<string, unknown>> : []
  const confirmedPayouts = settlements.filter((row) => row.payoutConfirmed === true || String(row.payoutStatus || "").toUpperCase() === "SUCCEEDED")
  const payoutConfirmed = confirmedPayouts.length > 0
  const recognizedPaid = payoutConfirmed ? total : paid
  const payoutProceeds = confirmedPayouts.reduce((sum, row) => sum + Number(row.orderPayoutAmount || 0), 0)
  const payoutTransactions = settlements.flatMap((row) => Array.isArray(row.transactions) ? row.transactions as Array<Record<string, unknown>> : [])
  const payoutInstrumentLabel = (row: Record<string, unknown>) => {
    const instrument = row.payoutInstrument && typeof row.payoutInstrument === "object" ? row.payoutInstrument as Record<string, unknown> : {}
    const type = String(instrument.instrumentType || instrument.type || "Bank account").replaceAll("_", " ")
    const ending = String(instrument.lastFourDigits || instrument.accountLastFourDigits || instrument.accountLast4 || "").trim()
    const nickname = String(instrument.nickname || instrument.name || "").trim()
    return [nickname || type, ending ? `ending ${ending}` : ""].filter(Boolean).join(" / ")
  }
  const channelFeeReconciled = channelFee.actualFee !== null && channelFee.actualFee !== undefined
  const shippingReconciled = String(shippingFinance.reconciliationStatus || "") === "reconciled"
  const run = async (path: string, body: Record<string, unknown>) => {
    setSaving(true)
    try { await api(path, { method: "POST", body: JSON.stringify(body) }); await onUpdated(); toast.success("Order finance updated.") } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update order finance.") } finally { setSaving(false) }
  }
  const recordPayment = async () => { await run(`/api/orders/${encodeURIComponent(orderId)}/payments`, { ...payment, amount: Number(payment.amount || 0) }); setPaymentOpen(false) }
  const recordRefund = async () => { await run(`/api/orders/${encodeURIComponent(orderId)}/refunds`, { ...refund, amount: Number(refund.amount || 0), items: lines.map((line, lineIndex) => ({ sku: String(line.sku || ""), title: String(line.title || ""), qty: Number(line.qty || 0), price: Number(line.price || 0), lineIndex })) }); setRefundOpen(false) }
  const adjustments = Array.isArray(order.shippingCostAdjustments) ? order.shippingCostAdjustments as Array<Record<string, unknown>> : []
  const recordShippingAdjustment = async () => { await run(`/api/orders/${encodeURIComponent(orderId)}/shipping-cost-adjustments`, { ...shippingAdjustment, amount: Number(shippingAdjustment.amount || 0) }); setShippingAdjustmentOpen(false) }
  return <div className="grid gap-4">
    <div className="flex flex-wrap gap-2"><Button onClick={() => { setPayment({ amount: String(Math.max(0, total - paid)), provider: "Manual", status: "captured", transactionId: "" }); setPaymentOpen(true) }}>Record payment</Button><Button variant="outline" onClick={() => { setRefund({ amount: String(Math.max(0, total - refunded)), method: "manual", reference: "", reason: "Customer request", note: "" }); setRefundOpen(true) }}>Record refund</Button><Button variant="outline" onClick={() => { setShippingAdjustment({ amount: "", reference: "", reason: "Carrier or channel billing adjustment", source: String(order.source || "Manual") }); setShippingAdjustmentOpen(true) }}>Record label adjustment</Button></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Detail label="Order total" value={moneyLabel(total)} /><Detail label="Customer payment" value={moneyLabel(recognizedPaid)} /><Detail label="Seller payout" value={payoutConfirmed ? "Confirmed" : "Not linked"} /><Detail label="Net payout proceeds" value={payoutConfirmed ? moneyLabel(payoutProceeds) : "-"} /></div>
    <Card>
      <CardHeader><CardTitle className="text-sm">Order costs</CardTitle><CardDescription>Customer-paid shipping is revenue and is never included in these expense totals.</CardDescription></CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-3 rounded-md border p-3">
          <div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">Channel fees</p><Badge variant={channelFeeReconciled ? "success" : "secondary"}>{channelFeeReconciled ? "Reconciled" : "Estimated"}</Badge></div>
          <div className="grid grid-cols-2 gap-3"><Detail label="Estimated" value={moneyLabel(Number(channelFee.estimatedFee || 0))} /><Detail label="Used in P&L" value={moneyLabel(Number(channelFee.effectiveFee || 0))} /></div>
          {channelFeeReconciled && <p className="text-xs text-muted-foreground">Actual fee {moneyLabel(Number(channelFee.actualFee || 0))} from settlement {String(channelFee.externalSettlementId || channelFee.settlementId || "-")}.</p>}
        </div>
        <div className="grid gap-3 rounded-md border p-3">
          <div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">Shipping expense</p><Badge variant={shippingReconciled ? "success" : "secondary"}>{shippingReconciled ? "Reconciled" : String(shippingFinance.reconciliationStatus || "estimated").replaceAll("_", " ")}</Badge></div>
          <div className="grid grid-cols-2 gap-3"><Detail label="Estimated labels" value={moneyLabel(Number(shippingFinance.estimatedCost ?? order.shippingCost ?? 0))} /><Detail label="Used in P&L" value={moneyLabel(Number(shippingFinance.effectiveCost ?? order.shippingCost ?? 0))} /></div>
          <p className="text-xs text-muted-foreground">{shippingFinance.actualCost == null ? "Carrier invoice has not been reconciled yet." : `Actual carrier cost ${moneyLabel(Number(shippingFinance.actualCost || 0))}.`}</p>
        </div>
      </CardContent>
    </Card>
    <Card>
      <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-sm">Channel settlement and payout</CardTitle><CardDescription>A matched statement reconciles revenue and expense. Only a successful channel payout confirms that proceeds were sent to the business.</CardDescription></div><Badge variant={payoutConfirmed ? "success" : "secondary"}>{payoutConfirmed ? "Payout confirmed" : settlements.length ? "Statement linked" : "No statement linked"}</Badge></div></CardHeader>
      <CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Payout ID</TableHead><TableHead>Paid out</TableHead><TableHead>Order proceeds</TableHead><TableHead>Batch payout</TableHead><TableHead>Bank reference</TableHead><TableHead>Destination</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{settlements.map((row) => <TableRow key={`payout-${String(row.settlementId)}`}><TableCell><p className="font-mono text-xs">{String(row.externalSettlementId || row.settlementId || "-")}</p><p className="text-xs text-muted-foreground">Imported {row.importedAt ? dateLabel(String(row.importedAt)) : "-"}</p></TableCell><TableCell>{row.payoutDate ? dateLabel(String(row.payoutDate)) : accountingDateLabel(row.settlementDate)}</TableCell><TableCell className="font-medium tabular-nums">{row.orderPayoutAmount == null ? "-" : moneyLabel(Number(row.orderPayoutAmount || 0))}</TableCell><TableCell className="tabular-nums">{row.payoutAmount == null ? "-" : moneyLabel(Number(row.payoutAmount || 0))}</TableCell><TableCell className="max-w-48 break-words font-mono text-xs">{String(row.bankReference || "Not provided")}</TableCell><TableCell>{payoutInstrumentLabel(row)}</TableCell><TableCell><Badge variant={row.payoutConfirmed ? "success" : "secondary"}>{row.payoutConfirmed ? "Paid out" : String(row.payoutStatus || row.status || "Imported").replaceAll("_", " ")}</Badge>{row.payoutMemo ? <p className="mt-1 max-w-56 text-xs text-muted-foreground">{String(row.payoutMemo)}</p> : null}</TableCell></TableRow>)}{!settlements.length && <TableRow><TableCell colSpan={7} className="h-20 text-center text-muted-foreground">No channel payout is linked to this order yet.</TableCell></TableRow>}</TableBody></Table></div></CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle className="text-sm">Settlement transactions</CardTitle><CardDescription>Order-level channel transaction references retained with the payout for accounting support.</CardDescription></CardHeader>
      <CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Reference</TableHead><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Retail</TableHead><TableHead className="text-right">Platform discount</TableHead><TableHead className="text-right">Seller discount</TableHead><TableHead className="text-right">Revenue before fee</TableHead><TableHead className="text-right">Service fee</TableHead><TableHead className="text-right">Net proceeds</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{payoutTransactions.map((row, index) => <TableRow key={`${String(row.transactionId)}-${index}`}><TableCell><p className="font-mono text-xs">{String(row.relatedId || row.orderItemId || "-")}</p><p className="font-mono text-xs text-muted-foreground">{String(row.transactionId || "-")}</p></TableCell><TableCell>{row.transactionDate ? dateLabel(String(row.transactionDate)) : "-"}</TableCell><TableCell><p>{String(row.transactionType || "-").replaceAll("_", " ")}</p><p className="text-xs text-muted-foreground">{String(row.bookingEntry || "-")}</p></TableCell><TableCell className="text-right tabular-nums">{row.retailPrice == null ? "-" : moneyLabel(Number(row.retailPrice || 0))}</TableCell><TableCell className="text-right tabular-nums">{row.platformDiscount == null ? "-" : moneyLabel(Number(row.platformDiscount || 0))}</TableCell><TableCell className="text-right tabular-nums">{row.sellerDiscount == null ? "-" : moneyLabel(Number(row.sellerDiscount || 0))}</TableCell><TableCell className="text-right tabular-nums">{row.grossAmount == null ? "-" : moneyLabel(Number(row.grossAmount || 0))}</TableCell><TableCell className={`text-right tabular-nums ${Number(row.feeAmount || 0) > 0 ? "text-destructive" : Number(row.feeAmount || 0) < 0 ? "text-emerald-600" : ""}`}>{row.feeAmount == null ? "-" : moneyLabel(Number(row.feeAmount || 0))}</TableCell><TableCell className="text-right font-medium tabular-nums">{row.netAmount == null ? row.amount == null ? "-" : moneyLabel(Number(row.amount || 0)) : moneyLabel(Number(row.netAmount || 0))}</TableCell><TableCell><Badge variant={String(row.transactionStatus || "").toUpperCase() === "PAYOUT" ? "success" : "outline"}>{String(row.transactionStatus || "Recorded").replaceAll("_", " ")}</Badge></TableCell></TableRow>)}{!payoutTransactions.length && <TableRow><TableCell colSpan={10} className="h-20 text-center text-muted-foreground">No settlement transaction details are attached to this order.</TableCell></TableRow>}</TableBody></Table></div></CardContent>
    </Card>
    <Card><CardHeader><CardTitle className="text-sm">Transactions</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Provider</TableHead><TableHead>Reference</TableHead><TableHead>Kind</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Recorded</TableHead></TableRow></TableHeader><TableBody>{payments.map((row) => <TableRow key={String(row.id)}><TableCell>{String(row.provider || "-")}</TableCell><TableCell>{String(row.transactionId || "-")}</TableCell><TableCell>{String(row.kind || "payment")}</TableCell><TableCell>{moneyLabel(Number(row.amount || 0))}</TableCell><TableCell><Badge variant={String(row.status || "").toLowerCase() === "voided" ? "outline" : "secondary"}>{String(row.status || "-")}</Badge></TableCell><TableCell>{dateLabel(String(row.createdAt || ""))}</TableCell></TableRow>)}{!payments.length && <TableRow><TableCell colSpan={6} className="h-20 text-center text-muted-foreground">No payment transactions recorded.</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
    {adjustments.length > 0 && <Card><CardHeader><CardTitle className="text-sm">Shipping cost adjustments</CardTitle><CardDescription>Carrier and channel charges or credits received after the label was purchased.</CardDescription></CardHeader><CardContent className="grid gap-2">{adjustments.map((row) => <div key={String(row.id)} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"><span>{String(row.source || "Carrier")} / {String(row.reference || "-")}</span><span className={Number(row.amount || 0) > 0 ? "font-medium text-destructive" : "font-medium text-emerald-600"}>{moneyLabel(Number(row.amount || 0))}</span><span className="text-muted-foreground">{String(row.reason || "")}</span></div>)}</CardContent></Card>}
    {refunds.length > 0 && <Card><CardHeader><CardTitle className="text-sm">Refunds</CardTitle></CardHeader><CardContent className="grid gap-2">{refunds.map((row) => <div key={String(row.id)} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"><span>{String(row.reason || "Refund")} / {String(row.method || "manual")}</span><span className="font-medium">{moneyLabel(Number(row.amount || 0))}</span><span className="text-muted-foreground">{dateLabel(String(row.refundedAt || row.createdAt || ""))}</span></div>)}</CardContent></Card>}
    <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}><DialogContent><DialogHeader><DialogTitle>Record payment</DialogTitle><DialogDescription>This records an operational payment transaction in DataPlus.</DialogDescription></DialogHeader><div className="grid gap-4"><Field label="Amount"><Input type="number" min="0" step="0.01" value={payment.amount} onChange={(event) => setPayment({ ...payment, amount: event.target.value })} /></Field><Field label="Provider"><Input value={payment.provider} onChange={(event) => setPayment({ ...payment, provider: event.target.value })} /></Field><Field label="Transaction reference"><Input value={payment.transactionId} onChange={(event) => setPayment({ ...payment, transactionId: event.target.value })} /></Field><Field label="Status"><Select value={payment.status} onValueChange={(status) => setPayment({ ...payment, status })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="authorized">Authorized</SelectItem><SelectItem value="captured">Captured</SelectItem><SelectItem value="paid">Paid</SelectItem></SelectContent></Select></Field></div><DialogFooter><Button variant="outline" onClick={() => setPaymentOpen(false)}>Cancel</Button><Button disabled={saving} onClick={() => void recordPayment()}>Save payment</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={refundOpen} onOpenChange={setRefundOpen}><DialogContent><DialogHeader><DialogTitle>Record refund</DialogTitle><DialogDescription>This records a local refund and keeps the order margin audit accurate. It does not send a refund to Shopify.</DialogDescription></DialogHeader><div className="grid gap-4"><Field label="Amount"><Input type="number" min="0" step="0.01" value={refund.amount} onChange={(event) => setRefund({ ...refund, amount: event.target.value })} /></Field><Field label="Method"><Input value={refund.method} onChange={(event) => setRefund({ ...refund, method: event.target.value })} /></Field><Field label="Reference"><Input value={refund.reference} onChange={(event) => setRefund({ ...refund, reference: event.target.value })} /></Field><Field label="Reason"><Input value={refund.reason} onChange={(event) => setRefund({ ...refund, reason: event.target.value })} /></Field><Field label="Internal note"><Textarea value={refund.note} onChange={(event) => setRefund({ ...refund, note: event.target.value })} /></Field></div><DialogFooter><Button variant="outline" onClick={() => setRefundOpen(false)}>Cancel</Button><Button disabled={saving} onClick={() => void recordRefund()}>Save refund</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={shippingAdjustmentOpen} onOpenChange={setShippingAdjustmentOpen}><DialogContent><DialogHeader><DialogTitle>Record label adjustment</DialogTitle><DialogDescription>Use a positive amount for a later carrier/channel charge and a negative amount for a confirmed credit. The original label cost remains preserved.</DialogDescription></DialogHeader><div className="grid gap-4"><Field label="Amount"><Input type="number" step="0.01" value={shippingAdjustment.amount} onChange={(event) => setShippingAdjustment({ ...shippingAdjustment, amount: event.target.value })} placeholder="Example: 2.45 or -2.45" /></Field><Field label="Carrier or channel"><Input value={shippingAdjustment.source} onChange={(event) => setShippingAdjustment({ ...shippingAdjustment, source: event.target.value })} /></Field><Field label="Billing reference"><Input value={shippingAdjustment.reference} onChange={(event) => setShippingAdjustment({ ...shippingAdjustment, reference: event.target.value })} /></Field><Field label="Reason"><Textarea value={shippingAdjustment.reason} onChange={(event) => setShippingAdjustment({ ...shippingAdjustment, reason: event.target.value })} /></Field></div><DialogFooter><Button variant="outline" onClick={() => setShippingAdjustmentOpen(false)}>Cancel</Button><Button disabled={saving || !Number(shippingAdjustment.amount) || !shippingAdjustment.reference.trim()} onClick={() => void recordShippingAdjustment()}>Record adjustment</Button></DialogFooter></DialogContent></Dialog>
  </div>
}

export function fulfillmentPackageDefaults(lines: Array<Record<string, unknown>>, quantityForLine: (line: Record<string, unknown>, index: number) => number) {
  const numeric = (...values: unknown[]) => values.map(Number).find((value) => Number.isFinite(value) && value > 0) || 0
  const bundledDimensions = (length: number, width: number, height: number, multiplier: number) => {
    const axes = [length, width, height].sort((left, right) => right - left)
    if (multiplier > 1 && axes.every((value) => value > 0)) axes[2] *= multiplier
    axes.sort((left, right) => right - left)
    return { length: axes[0] || 0, width: axes[1] || 0, height: axes[2] || 0 }
  }
  let weight = 0
  let length = 0
  let width = 0
  let height = 0
  lines.forEach((line, index) => {
    const quantity = Number(quantityForLine(line, index) || 0)
    if (quantity <= 0) return
    const product = (line.localProduct || {}) as Record<string, unknown>
    const savedMultiplier = Number(line.inventoryMultiplier || 0)
    const packMultiplier = Number.isFinite(savedMultiplier) && savedMultiplier > 1 ? savedMultiplier : 1
    const itemWeight = numeric(product.itemWeight, line.itemWeight, line.weight)
    const fallbackPackageWeight = numeric(product.packageWeight, line.packageWeight)
    const itemLength = numeric(product.itemLength, line.itemLength)
    const itemWidth = numeric(product.itemWidth, line.itemWidth)
    const itemHeight = numeric(product.itemHeight, line.itemHeight)
    const hasCompleteItemDimensions = itemLength > 0 && itemWidth > 0 && itemHeight > 0
    const dimensions = hasCompleteItemDimensions
      ? bundledDimensions(itemLength, itemWidth, itemHeight, packMultiplier)
      : bundledDimensions(
          numeric(product.packageLength, line.packageLength),
          numeric(product.packageWidth, line.packageWidth),
          numeric(product.packageHeight, line.packageHeight),
          1
        )
    weight += (itemWeight ? itemWeight * packMultiplier : fallbackPackageWeight) * quantity
    length = Math.max(length, dimensions.length)
    width = Math.max(width, dimensions.width)
    height = Math.max(height, dimensions.height)
  })
  const label = (value: number) => value > 0 ? String(Math.round(value * 100) / 100) : ""
  return { weight: label(weight), length: label(length), width: label(width), height: label(height) }
}

export function sortShippingRatesForDisplay(rates: Array<Record<string, unknown>>, selectedRateId = "") {
  const amount = (rate: Record<string, unknown>) => {
    if (rate.amount === null || rate.amount === undefined || rate.amount === "") return Number.POSITIVE_INFINITY
    const value = Number(rate.amount)
    return Number.isFinite(value) && value >= 0 ? value : Number.POSITIVE_INFINITY
  }
  return [...rates].sort((left, right) => {
    const leftSelected = Boolean(selectedRateId) && String(left.id || "") === selectedRateId
    const rightSelected = Boolean(selectedRateId) && String(right.id || "") === selectedRateId
    if (leftSelected !== rightSelected) return leftSelected ? -1 : 1
    return amount(left) - amount(right)
      || String(left.carrier || "").localeCompare(String(right.carrier || ""))
      || String(left.service || "").localeCompare(String(right.service || ""))
  })
}

export function orderFulfillmentRateReview(order: Record<string, unknown>) {
  const routes = Array.isArray(order.fulfillmentRoutes) ? order.fulfillmentRoutes as Array<Record<string, unknown>> : []
  const activeRoutes = routes.filter((route) => String(route.type || "warehouse") === "warehouse" && !["canceled", "cancelled", "closed", "shipped", "delivered"].includes(String(route.status || "").toLowerCase()))
  const route = activeRoutes.find((entry) => {
    const review = entry.shippingRateReview as Record<string, unknown> | undefined
    return Boolean(review?.selectedRate) && Array.isArray(review?.rates) && review.rates.length > 0
  }) || activeRoutes.find((entry) => Boolean(entry.shippingRateReview))
  const orderReview = order.shippingRateReview && typeof order.shippingRateReview === "object" ? order.shippingRateReview as Record<string, unknown> : null
  return {
    routeIds: activeRoutes.map((entry) => String(entry.id || "")).filter(Boolean),
    review: route?.shippingRateReview && typeof route.shippingRateReview === "object" ? route.shippingRateReview as Record<string, unknown> : orderReview
  }
}

export function UniversalShippingLabelDialog({ open, onOpenChange, orderId, order, warehouses, lines, remaining, onUpdated, purchaseOrderId = "", initialRateReview = null, routeIds = [], defaultShipFromWarehouseId = "" }: { open: boolean; onOpenChange: (open: boolean) => void; orderId: string; order: Record<string, unknown>; warehouses: Array<Record<string, unknown>>; lines: Array<Record<string, unknown>>; remaining: (line: Record<string, unknown>, index: number) => number; onUpdated: () => Promise<void>; purchaseOrderId?: string; initialRateReview?: Record<string, unknown> | null; routeIds?: string[]; defaultShipFromWarehouseId?: string }) {
  const [loading, setLoading] = useState(false)
  const [rates, setRates] = useState<Array<Record<string, unknown>>>([])
  const [blockers, setBlockers] = useState<string[]>([])
  const [providerErrors, setProviderErrors] = useState<Array<Record<string, unknown>>>([])
  const [warehouseFallback, setWarehouseFallback] = useState("")
  const [labelRules, setLabelRules] = useState<Record<string, unknown>>({})
  const [packagePresets, setPackagePresets] = useState<Array<Record<string, unknown>>>([
    { id: "poly-mailer", name: "Poly mailer", packageType: "poly_mailer", weight: 0.1, length: 14, width: 10, height: 1 },
    { id: "small-box", name: "Small box", packageType: "box", weight: 0.2, length: 8, width: 6, height: 4, default: true },
    { id: "medium-box", name: "Medium box", packageType: "box", weight: 0.45, length: 12, width: 10, height: 8 },
  ])
  const [selectedId, setSelectedId] = useState("")
  const [sortMode, setSortMode] = useState("recommended")
  const [rateLoadCompleted, setRateLoadCompleted] = useState(false)
  const [adminPinRequired, setAdminPinRequired] = useState(false)
  const [adminPin, setAdminPin] = useState("")
  const [printPreview, setPrintPreview] = useState<{ shipmentId: string; orderNumber: string } | null>(null)
  const [printDocumentMode, setPrintDocumentMode] = useState("label")
  const [printStations, setPrintStations] = useState<Array<Record<string, any>>>([])
  const [printDestination, setPrintDestination] = useState("browser")
  const [printStationPrinter, setPrintStationPrinter] = useState("")
  const printFrameRef = useRef<HTMLIFrameElement>(null)
  const [draft, setDraft] = useState({ warehouseId: "", packagePresetId: "", packageType: "box", packageWeight: "", packageLength: "", packageWidth: "", packageHeight: "", shipDate: new Date().toISOString().slice(0, 10), labelFormat: "PDF", printPackingSlip: false })
  const autoLoadKeyRef = useRef("")
  const initializedOpenOrderRef = useRef("")
  const applyPreset = (presetId: string) => {
    const preset = packagePresets.find((entry) => String(entry.id) === presetId)
    setDraft((current) => preset ? { ...current, packagePresetId: presetId, packageType: String(preset.packageType || "box"), packageWeight: String(preset.weight || ""), packageLength: String(preset.length || ""), packageWidth: String(preset.width || ""), packageHeight: String(preset.height || "") } : { ...current, packagePresetId: "" })
  }
  useEffect(() => {
    if (!open) {
      initializedOpenOrderRef.current = ""
      return
    }
    if (initializedOpenOrderRef.current === orderId) return
    initializedOpenOrderRef.current = orderId
    const measurements = fulfillmentPackageDefaults(lines, remaining)
    const defaultPreset = packagePresets.find((preset) => preset.default) || packagePresets[0]
    const label = (value: number) => value > 0 ? String(Math.round(value * 100) / 100) : ""
    const savedPackage = order.package && typeof order.package === "object" ? order.package as Record<string, unknown> : {}
    const savedMeasurement = (...keys: string[]) => label(Number(keys.map((key) => savedPackage[key]).find((value) => Number(value || 0) > 0) || 0))
    const savedRates = Array.isArray(initialRateReview?.rates) ? initialRateReview.rates as Array<Record<string, unknown>> : []
    const savedSelectedRate = initialRateReview?.selectedRate && typeof initialRateReview.selectedRate === "object" ? initialRateReview.selectedRate as Record<string, unknown> : null
    const savedSelectedId = String(savedSelectedRate?.id || "")
    setDraft({ warehouseId: String(initialRateReview?.warehouseId || defaultShipFromWarehouseId || order.fulfillmentWarehouseId || warehouses[0]?.id || ""), packagePresetId: String(savedPackage.packagePresetId || ""), packageType: String(savedPackage.packageType || defaultPreset?.packageType || "box"), packageWeight: savedMeasurement("packageWeight", "weightPounds", "weight") || measurements.weight || label(Number(defaultPreset?.weight || 0)), packageLength: savedMeasurement("packageLength", "lengthInches", "length") || measurements.length || label(Number(defaultPreset?.length || 0)), packageWidth: savedMeasurement("packageWidth", "widthInches", "width") || measurements.width || label(Number(defaultPreset?.width || 0)), packageHeight: savedMeasurement("packageHeight", "heightInches", "height") || measurements.height || label(Number(defaultPreset?.height || 0)), shipDate: new Date().toISOString().slice(0, 10), labelFormat: "PDF", printPackingSlip: Boolean(labelRules.printPackingSlipWithLabel) })
    setRates(sortShippingRatesForDisplay(savedRates, savedSelectedId))
    setBlockers([])
    setProviderErrors([])
    setWarehouseFallback("")
    setSelectedId(savedSelectedId)
    setSortMode("recommended")
    setRateLoadCompleted(savedRates.length > 0)
    setAdminPinRequired(false)
    setAdminPin("")
    autoLoadKeyRef.current = ""
  }, [open, order, warehouses, lines, initialRateReview, defaultShipFromWarehouseId])
  const selected = rates.find((rate) => String(rate.id) === selectedId)
  const selectedIsReference = Boolean(selected?.purchaseDisabled || String(selected?.action || "") === "reference_only")
  const isPrintableRate = (rate: Record<string, unknown>) => !Boolean(rate.purchaseDisabled || String(rate.action || "") === "reference_only")
  const selectedLines = lines.map((line, lineIndex) => ({ sku: String(line.sku || ""), lineIndex, qty: remaining(line, lineIndex) })).filter((line) => line.sku && line.qty > 0)
  const printPacketSettings = printDocumentMode === "packing-letter" ? { size: "letter", packingSlips: "1" } : printDocumentMode === "packing-4x6" ? { size: "4x6", packingSlips: "1" } : { size: "4x6", packingSlips: "0" }
  const printPacketUrl = printPreview?.shipmentId ? `/api/orders/${encodeURIComponent(orderId)}/shipments/${encodeURIComponent(printPreview.shipmentId)}/print-packet.pdf?${new URLSearchParams(printPacketSettings).toString()}` : ""
  const selectedPrintStation = printStations.find((station) => String(station.id) === printDestination)
  useEffect(() => {
    if (!printPreview) return
    void Promise.all([
      api<{ stations?: Array<Record<string, any>> }>("/api/fulfillment/print-stations").catch(() => ({ stations: [] })),
      api<{ preference?: { destination?: string; printerName?: string } }>("/api/fulfillment/print-preference").catch(() => ({ preference: { destination: "browser", printerName: "" } }))
    ]).then(([stationResult, preferenceResult]) => {
      const active = (stationResult.stations || []).filter((station) => station.status === "active")
      setPrintStations(active)
      const preferredDestination = String(preferenceResult.preference?.destination || "browser")
      const station = active.find((entry) => String(entry.id) === preferredDestination)
      setPrintDestination(station ? String(station.id) : "browser")
      const preferredPrinter = String(preferenceResult.preference?.printerName || "")
      setPrintStationPrinter(station && (station.printers || []).includes(preferredPrinter) ? preferredPrinter : String(station?.defaultPrinter || station?.printers?.[0] || ""))
    })
  }, [printPreview])
  const savePrintPreference = async (destination: string, printerName = "") => {
    try {
      await api("/api/fulfillment/print-preference", { method: "PATCH", body: JSON.stringify({ destination, printerName }) })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save your print preference.")
    }
  }
  const choosePrintDestination = (destination: string) => {
    setPrintDestination(destination)
    const station = printStations.find((entry) => String(entry.id) === destination)
    const printerName = String(station?.defaultPrinter || station?.printers?.[0] || "")
    setPrintStationPrinter(printerName)
    void savePrintPreference(destination, printerName)
  }
  const showPurchasedLabel = (result: { document?: Record<string, unknown>; shipment?: Record<string, unknown>; message?: string }) => {
    const shipmentId = String(result.shipment?.id || "")
    const shipmentDocuments = Array.isArray(result.shipment?.documents) ? result.shipment.documents : []
    if (!shipmentId || (!result.document && !shipmentDocuments.length)) {
      toast.success(result.message || "Label purchase is processing. It will appear under Purchased labels when the document is ready.")
      return
    }
    const nextPreview = { shipmentId, orderNumber: String(order.orderNumber || orderId) }
    window.setTimeout(() => {
      setPrintDocumentMode(draft.printPackingSlip ? "packing-4x6" : "label")
      setPrintPreview(nextPreview)
    }, 0)
    toast.success(result.message || "Shipping label purchased and ready to print.")
  }
  const printPurchasedLabel = async () => {
    if (!printPreview?.shipmentId) return
    const printCompletion = api<{ message?: string; channelResult?: { status?: string; error?: string } }>(`/api/orders/${encodeURIComponent(orderId)}/shipments/${encodeURIComponent(printPreview.shipmentId)}/printed`, { method: "POST", body: "{}" })
    printFrameRef.current?.contentWindow?.print()
    try {
      const result = await printCompletion
      if (result.channelResult && !["sent", "already_synced"].includes(String(result.channelResult.status || "").toLowerCase())) toast.warning(result.message || "The label was printed, but marketplace tracking needs attention.")
      else toast.success(result.message || "Label printed and marketplace tracking sent.")
      await onUpdated()
    } catch (error) { toast.error(error instanceof Error ? error.message : "The label opened, but DataPlus could not record it as printed.") }
  }
  const sendPurchasedLabelToStation = async () => {
    if (!printPreview?.shipmentId || printDestination === "browser" || !printStationPrinter) return
    setLoading(true)
    try {
      const result = await api<{ message?: string }>(`/api/orders/${encodeURIComponent(orderId)}/shipments/${encodeURIComponent(printPreview.shipmentId)}/dispatch-print`, {
        method: "POST",
        body: JSON.stringify({ stationId: printDestination, printerName: printStationPrinter, size: printPacketSettings.size, includePackingSlips: printPacketSettings.packingSlips === "1" })
      })
      toast.success(result.message || "Label queued for the selected print station.")
      setPrintPreview(null)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to send the label to the print station.") }
    finally { setLoading(false) }
  }
  const chooseDefaultRate = (nextRates: Array<Record<string, unknown>>, rules: Record<string, unknown>) => {
    const printable = nextRates.filter(isPrintableRate)
    const priced = printable.filter((rate) => Number(rate.amount || 0) > 0)
    const preferredCarrier = String(rules.preferredCarrier || "").trim().toLowerCase()
    const preferredService = String(rules.preferredService || "").trim().toLowerCase()
    const preferred = printable.find((rate) => (!preferredCarrier || String(rate.carrier || "").toLowerCase().includes(preferredCarrier)) && (!preferredService || String(rate.service || "").toLowerCase().includes(preferredService)))
    const fastest = priced.filter((rate) => Number(rate.deliveryDays || 0) > 0).sort((a, b) => Number(a.deliveryDays || 9999) - Number(b.deliveryDays || 9999))[0]
    const cheapest = priced.sort((a, b) => Number(a.amount || 999999) - Number(b.amount || 999999))[0]
    if (String(rules.autoSelectRule || "cheapest") === "preferred" && preferred) return String(preferred.id)
    if (String(rules.autoSelectRule || "cheapest") === "fastest" && fastest) return String(fastest.id)
    if (String(rules.autoSelectRule || "cheapest") === "none") return ""
    return String((cheapest || printable[0] || {}).id || "")
  }
  const loadRates = async () => {
    setLoading(true)
    setRateLoadCompleted(false)
    try {
      const result = await api<{ rates?: Array<Record<string, unknown>>; blockers?: string[]; providerErrors?: Array<Record<string, unknown>>; packagePresets?: Array<Record<string, unknown>>; labelRules?: Record<string, unknown>; warehouseId?: string; warehouseName?: string; warehouseFallbackApplied?: boolean; warehouseFallbackReason?: string; rateReview?: Record<string, unknown>; message?: string }>(`/api/orders/${encodeURIComponent(orderId)}/shipping/rates`, { method: "POST", body: JSON.stringify({ ...draft, lines: selectedLines, routeIds }) })
      const nextRates = result.rates || []
      const nextRules = result.labelRules || {}
      setLabelRules(nextRules)
      setDraft((current) => ({ ...current, printPackingSlip: Boolean(nextRules.printPackingSlipWithLabel) }))
      if (Array.isArray(result.packagePresets) && result.packagePresets.length) setPackagePresets(result.packagePresets)
      const savedSelection = result.rateReview?.selectedRate && typeof result.rateReview.selectedRate === "object" ? result.rateReview.selectedRate as Record<string, unknown> : null
      const defaultRateId = String(savedSelection?.id || chooseDefaultRate(nextRates, nextRules))
      setRates(sortShippingRatesForDisplay(nextRates, defaultRateId))
      setBlockers(result.blockers || [])
      setProviderErrors(result.providerErrors || [])
      if (result.warehouseFallbackApplied && result.warehouseId) {
        setDraft((current) => ({ ...current, warehouseId: String(result.warehouseId) }))
        setWarehouseFallback(`${String(result.warehouseFallbackReason || "The selected warehouse has no complete ship-from address")} Using ${String(result.warehouseName || "WH-SI2")} for this label.`)
      } else {
        setWarehouseFallback("")
      }
      setSelectedId(defaultRateId)
      toast.success(result.message || "Shipping rates loaded.")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load shipping rates.") } finally { setLoading(false); setRateLoadCompleted(true) }
  }
  const selectRate = async (rateId: string) => {
    setSelectedId(rateId)
    if (!routeIds.length) return
    try {
      await api(`/api/fulfillment/rates/${encodeURIComponent(routeIds[0])}`, { method: "PATCH", body: JSON.stringify({ selectedRateId: rateId, routeIds }) })
      await onUpdated()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save this shipping choice.")
    }
  }
  useEffect(() => {
    if (!open || loading || rateLoadCompleted || rates.length || blockers.length) return
    if (!draft.packageWeight || !draft.packageLength || !draft.packageWidth || !draft.packageHeight) return
    const key = [draft.warehouseId, draft.packageType, draft.packageWeight, draft.packageLength, draft.packageWidth, draft.packageHeight, selectedLines.length].join("|")
    if (autoLoadKeyRef.current === key) return
    autoLoadKeyRef.current = key
    void loadRates()
  }, [open, loading, rateLoadCompleted, rates.length, blockers.length, draft.warehouseId, draft.packageType, draft.packageWeight, draft.packageLength, draft.packageWidth, draft.packageHeight, selectedLines.length])
  const buy = async () => {
    if (!selected) return toast.error("Choose a shipping option first.")
    if (selectedIsReference) return toast.error("This shipping option is reference-only. Choose Veeqo, Temu, or another label provider to print a label.")
    setLoading(true)
    try {
      const result = await api<{ document?: Record<string, unknown>; shipment?: Record<string, unknown>; message?: string }>(`/api/orders/${encodeURIComponent(orderId)}/shipping/labels`, { method: "POST", body: JSON.stringify({ provider: selected.provider, rate: selected, ...draft, labelFormat: draft.labelFormat, lines: selectedLines, purchaseOrderId, adminPin }) })
      await onUpdated()
      onOpenChange(false)
      showPurchasedLabel(result)
    } catch (error) {
      const payload = (error as Error & { payload?: Record<string, unknown> })?.payload
      if (payload?.requiresAdminPin === true) {
        setAdminPinRequired(true)
        await onUpdated()
        toast.error(error instanceof Error ? error.message : "Administrator approval is required.")
        return
      }
      if (error instanceof Error && error.message.includes("exceeds the configured max") && window.confirm(`${error.message}\n\nBuy this label anyway?`)) {
        try {
          const result = await api<{ document?: Record<string, unknown>; shipment?: Record<string, unknown>; message?: string }>(`/api/orders/${encodeURIComponent(orderId)}/shipping/labels`, { method: "POST", body: JSON.stringify({ provider: selected.provider, rate: selected, ...draft, confirmAboveMaxCost: true, lines: selectedLines, purchaseOrderId, adminPin }) })
          await onUpdated(); onOpenChange(false); showPurchasedLabel(result)
        } catch (confirmError) { toast.error(confirmError instanceof Error ? confirmError.message : "Unable to print shipping label.") }
      } else {
        toast.error(error instanceof Error ? error.message : "Unable to print shipping label.")
      }
    } finally { setLoading(false) }
  }
  const carrierDisplay = (rate: Record<string, unknown>) => {
    const carrier = String(rate.carrier || "").trim()
    const service = String(rate.service || "").trim()
    const provider = String(rate.provider || "").trim().toLowerCase()
    if (provider === "veeqo" && (!carrier || carrier.toLowerCase() === "veeqo")) {
      const match = service.match(/\b(USPS|UPS|FedEx|DHL|OnTrac|LaserShip)\b/i)
      return match ? match[1].replace(/fedex/i, "FedEx") : "Veeqo"
    }
    return carrier || String(rate.provider || "Carrier")
  }
  const carrierMark = (carrier: string) => {
    const normalized = carrier.toLowerCase()
    if (normalized.includes("usps")) return { text: "USPS", className: "border-blue-500/50 bg-blue-500/10 text-blue-700 dark:text-blue-300" }
    if (normalized.includes("ups")) return { text: "UPS", className: "border-amber-600/50 bg-amber-500/10 text-amber-800 dark:text-amber-300" }
    if (normalized.includes("fedex")) return { text: "FDX", className: "border-purple-500/50 bg-purple-500/10 text-purple-700 dark:text-purple-300" }
    if (normalized.includes("dhl")) return { text: "DHL", className: "border-yellow-500/50 bg-yellow-500/10 text-yellow-800 dark:text-yellow-300" }
    if (normalized.includes("shopify")) return { text: "SHOP", className: "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" }
    if (normalized.includes("temu")) return { text: "TM", className: "border-orange-500/50 bg-orange-500/10 text-orange-700 dark:text-orange-300" }
    if (normalized.includes("veeqo")) return { text: "VQ", className: "border-sky-500/50 bg-sky-500/10 text-sky-700 dark:text-sky-300" }
    return { text: carrier.slice(0, 3).toUpperCase() || "SHP", className: "border-muted-foreground/30 bg-muted text-muted-foreground" }
  }
  const etaSortValue = (rate: Record<string, unknown>) => {
    const days = Number(rate.deliveryDays || 0)
    if (days > 0) return days
    const eta = String(rate.deliveryEstimate || "")
    const range = eta.match(/(\d+)\s*-\s*(\d+)/)
    if (range) return Number(range[2])
    const single = eta.match(/(\d+)\s*(business|work|calendar)?\s*days?/i)
    if (single) return Number(single[1])
    const date = new Date(eta)
    if (!Number.isNaN(date.getTime())) return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 86400000))
    return Number.MAX_SAFE_INTEGER
  }
  const cheapestRateId = String([...rates].filter((rate) => isPrintableRate(rate) && Number(rate.amount || 0) > 0).sort((a, b) => Number(a.amount || 999999) - Number(b.amount || 999999))[0]?.id || "")
  const suggestedRateId = selectedId || chooseDefaultRate(rates, labelRules)
  const sortedRates = [...rates].sort((a, b) => {
    const referenceA = isPrintableRate(a) ? 0 : 1
    const referenceB = isPrintableRate(b) ? 0 : 1
    const amountA = Number(a.amount || 0) > 0 ? Number(a.amount) : Number.MAX_SAFE_INTEGER
    const amountB = Number(b.amount || 0) > 0 ? Number(b.amount) : Number.MAX_SAFE_INTEGER
    if (sortMode === "cost-desc") return referenceA - referenceB || amountB - amountA
    if (sortMode === "speed") return referenceA - referenceB || etaSortValue(a) - etaSortValue(b) || amountA - amountB
    if (sortMode === "carrier") return carrierDisplay(a).localeCompare(carrierDisplay(b)) || referenceA - referenceB || amountA - amountB
    if (sortMode === "provider") return String(a.provider || "").localeCompare(String(b.provider || "")) || referenceA - referenceB || amountA - amountB
    if (sortMode === "recommended") {
      const suggestedA = String(a.id || "") === suggestedRateId ? -1 : 0
      const suggestedB = String(b.id || "") === suggestedRateId ? -1 : 0
      return suggestedA - suggestedB || referenceA - referenceB || amountA - amountB || etaSortValue(a) - etaSortValue(b)
    }
    return referenceA - referenceB || amountA - amountB
  })
  const selectedWarehouse = warehouses.find((warehouse) => String(warehouse.id || "") === String(draft.warehouseId || ""))
  const selectedPreset = packagePresets.find((preset) => String(preset.id || "") === String(draft.packagePresetId || ""))
  const packageName = selectedPreset ? String(selectedPreset.name || selectedPreset.id || "Package") : "Custom package"
  const packageSummary = `${String(draft.packageType || "box").replace(/_/g, " ")} / ${draft.packageWeight || "0"} lb / ${draft.packageLength || "0"} x ${draft.packageWidth || "0"} x ${draft.packageHeight || "0"} in`
  const rateCostLabel = (rate: Record<string, unknown>) => Number(rate.amount || 0) > 0 ? moneyLabel(Number(rate.amount || 0)) : String(rate.action || "") === "retrieve_existing_label" ? "Channel label" : "Cost not returned"
  const rateEtaLabel = (rate: Record<string, unknown>) => {
    const eta = String(rate.deliveryEstimate || "").trim()
    if (eta) {
      const date = new Date(eta)
      if (!Number.isNaN(date.getTime()) && /T|\d{4}-\d{2}-\d{2}/.test(eta)) {
        return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(date)
      }
      return eta.replace(/\s*\+\d{2}:?\d{2}$/, "")
    }
    return Number(rate.deliveryDays || 0) > 0 ? `${Number(rate.deliveryDays)} day${Number(rate.deliveryDays) === 1 ? "" : "s"}` : "ETA not returned"
  }
  return <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Print shipping label</DialogTitle>
          <DialogDescription>Load available label options for this order, choose a rate, then print the attached label.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-3 rounded-md border bg-muted/20 p-3 md:grid-cols-3">
            <div className="md:col-span-2">
              <p className="text-sm font-semibold">Package</p>
              <p className="mt-1 text-xs text-muted-foreground">{packageName} / {packageSummary}</p>
              <p className="mt-1 text-xs text-muted-foreground">Ship from {String(selectedWarehouse?.name || selectedWarehouse?.code || "selected warehouse")} on {draft.shipDate || "selected date"}.</p>
            </div>
            <div className="flex items-start justify-end">
              <Badge variant={rates.length ? "default" : "outline"}>{loading ? "Loading rates..." : rates.length ? `${rates.length} option${rates.length === 1 ? "" : "s"}` : rateLoadCompleted ? "No rates returned" : "Rates pending"}</Badge>
            </div>
          </div>
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><p className="text-sm font-semibold">Packages</p><p className="text-xs text-muted-foreground">Choose a preset or use custom measurements before loading rates.</p></div>
              <Field label="Package preset"><Select value={draft.packagePresetId || "custom"} onValueChange={(value) => applyPreset(value === "custom" ? "" : value)}><SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="custom">Custom package</SelectItem>{packagePresets.map((preset) => <SelectItem key={String(preset.id)} value={String(preset.id)}>{String(preset.name || preset.id)}</SelectItem>)}</SelectContent></Select></Field>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {packagePresets.slice(0, 4).map((preset) => {
                const active = String(draft.packagePresetId || "") === String(preset.id || "")
                return <button key={String(preset.id)} type="button" onClick={() => applyPreset(String(preset.id || ""))} className={cn("rounded-md border p-3 text-left text-sm hover:bg-muted/40", active && "border-primary bg-primary/10")}>
                  <div className="flex items-center justify-between gap-2"><span className="font-medium">{String(preset.name || preset.id)}</span>{preset.default ? <Badge variant="secondary">Default</Badge> : null}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{String(preset.packageType || "box").replace(/_/g, " ")} / {String(preset.weight || 0)} lb</p>
                  <p className="text-xs text-muted-foreground">{String(preset.length || 0)} x {String(preset.width || 0)} x {String(preset.height || 0)} in</p>
                </button>
              })}
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Warehouse"><Select value={draft.warehouseId || "none"} onValueChange={(value) => setDraft((current) => ({ ...current, warehouseId: value === "none" ? "" : value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No warehouse</SelectItem>{warehouses.map((warehouse) => <SelectItem key={String(warehouse.id)} value={String(warehouse.id)}>{String(warehouse.name || warehouse.code || warehouse.id)}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Ship date"><Input type="date" value={draft.shipDate} onChange={(event) => setDraft((current) => ({ ...current, shipDate: event.target.value }))} /></Field>
            <Field label="Label format"><Select value={draft.labelFormat || "PDF"} onValueChange={(value) => setDraft((current) => ({ ...current, labelFormat: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="PDF">PDF</SelectItem><SelectItem value="PNG">PNG</SelectItem><SelectItem value="ZPL">ZPL</SelectItem><SelectItem value="JPEG">JPEG</SelectItem></SelectContent></Select></Field>
            <Field label="Package type"><Select value={draft.packageType || "box"} onValueChange={(value) => setDraft((current) => ({ ...current, packageType: value, packagePresetId: "" }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="box">Box</SelectItem><SelectItem value="poly_mailer">Poly mailer</SelectItem><SelectItem value="envelope">Envelope</SelectItem><SelectItem value="tube">Tube</SelectItem></SelectContent></Select></Field>
            <Field label="Package weight (lb)"><Input type="number" min="0" step="0.01" value={draft.packageWeight} onChange={(event) => setDraft((current) => ({ ...current, packageWeight: event.target.value, packagePresetId: "" }))} /></Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="L"><Input type="number" min="0" step="0.01" value={draft.packageLength} onChange={(event) => setDraft((current) => ({ ...current, packageLength: event.target.value, packagePresetId: "" }))} /></Field>
              <Field label="W"><Input type="number" min="0" step="0.01" value={draft.packageWidth} onChange={(event) => setDraft((current) => ({ ...current, packageWidth: event.target.value, packagePresetId: "" }))} /></Field>
              <Field label="H"><Input type="number" min="0" step="0.01" value={draft.packageHeight} onChange={(event) => setDraft((current) => ({ ...current, packageHeight: event.target.value, packagePresetId: "" }))} /></Field>
            </div>
          </div>
          <ToggleField label="Open packing slip with label" checked={draft.printPackingSlip} onCheckedChange={(value) => setDraft((current) => ({ ...current, printPackingSlip: value }))} />
          {Number(labelRules.maxCost || 0) > 0 && <Alert><AlertCircle className="size-4" /><AlertTitle>Label cost rule</AlertTitle><AlertDescription>Labels above {moneyLabel(Number(labelRules.maxCost || 0))} require confirmation before purchase.</AlertDescription></Alert>}
          {adminPinRequired && <Alert variant="destructive"><ShieldAlert className="size-4" /><AlertTitle>Marketplace order is canceled</AlertTitle><AlertDescription>Rates remain available, but buying this label requires the operations administrator PIN.</AlertDescription></Alert>}
          {adminPinRequired && <Field label="Administrator PIN"><Input autoFocus type="password" inputMode="numeric" autoComplete="off" value={adminPin} onChange={(event) => setAdminPin(event.target.value.replace(/\D/g, "").slice(0, 12))} placeholder="Enter 4-12 digit PIN" /></Field>}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/25 p-3 text-sm">
            <span>{loading ? "Contacting connected carriers. You can keep this window open while each provider responds." : `${selectedLines.length} line${selectedLines.length === 1 ? "" : "s"} selected for remaining quantities. Options auto-load when package data is complete.`}</span>
            <Button size="sm" onClick={() => void loadRates()} disabled={loading}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} {loading ? "Loading rates" : "Load options"}</Button>
          </div>
          {blockers.length > 0 && <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Rates need setup</AlertTitle><AlertDescription>{blockers.join(" ")}</AlertDescription></Alert>}
          {warehouseFallback && <Alert><Warehouse className="size-4" /><AlertTitle>Ship-from warehouse changed</AlertTitle><AlertDescription>{warehouseFallback}</AlertDescription></Alert>}
          {providerErrors.length > 0 && <Alert variant={rates.length ? "default" : "destructive"}><AlertCircle className="size-4" /><AlertTitle>{rates.length ? "Some providers did not return rates" : "No provider returned a printable label option"}</AlertTitle><AlertDescription>{providerErrors.map((entry) => `${String(entry.provider || "Provider")}: ${String(entry.message || "No details returned.")}`).join(" ")}</AlertDescription></Alert>}
          {rateLoadCompleted && !rates.length && !blockers.length && !providerErrors.length && <Alert><AlertCircle className="size-4" /><AlertTitle>No rates were returned</AlertTitle><AlertDescription>The carrier lookup completed, but none of the connected providers returned a purchasable option for this package. Adjust the warehouse or package and load options again.</AlertDescription></Alert>}
          <div className="grid gap-3">
            {rates.length ? <div className="flex flex-wrap items-center justify-between gap-2">
              <div><p className="text-sm font-semibold">Shipping options</p><p className="text-xs text-muted-foreground">Compare carrier, method, cost, and delivery estimate before printing.</p></div>
              <Field label="Sort by"><Select value={sortMode} onValueChange={setSortMode}><SelectTrigger className="w-[190px]"><ArrowUpDown className="size-4" /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="recommended">Recommended</SelectItem><SelectItem value="cost">Cost low to high</SelectItem><SelectItem value="cost-desc">Cost high to low</SelectItem><SelectItem value="speed">Fastest delivery</SelectItem><SelectItem value="carrier">Carrier</SelectItem><SelectItem value="provider">Provider</SelectItem></SelectContent></Select></Field>
            </div> : null}
            {suggestedRateId && rates.length ? <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">Suggested option</span><Badge variant="secondary">{suggestedRateId === cheapestRateId ? "Cheapest" : "Auto-selected"}</Badge></div><p className="mt-1 text-muted-foreground">DataPlus selected the best available rate based on your Fulfillment settings. You can choose a different service before printing.</p></div> : null}
            {sortedRates.map((rate) => {
              const isSelected = selectedId === String(rate.id)
              const isCheapest = cheapestRateId && String(rate.id) === cheapestRateId
              const isSuggested = suggestedRateId && String(rate.id) === suggestedRateId
              const isReference = !isPrintableRate(rate)
              const carrier = carrierDisplay(rate)
              const mark = carrierMark(carrier)
              return <button key={String(rate.id)} type="button" onClick={() => void selectRate(String(rate.id))} className={cn("grid gap-3 rounded-md border p-4 text-left text-sm hover:bg-muted/40", isSelected && "border-primary bg-primary/10")}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className={cn("grid h-9 min-w-12 place-items-center rounded-md border px-2 text-[11px] font-bold leading-none", mark.className)}>{mark.text}</span>
                    <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{carrier}</span>
                      <Badge variant="outline">{String(rate.provider || "provider")}</Badge>
                      {isSuggested && <Badge>Suggested</Badge>}
                      {isCheapest && <Badge variant="secondary">Cheapest</Badge>}
                      {isReference && <Badge variant="secondary">Reference only</Badge>}
                    </div>
                    <p className="mt-1 text-muted-foreground">{String(rate.service || "Shipping method")}</p>
                    </div>
                  </div>
                  <div className="grid gap-1 text-right">
                    <span className="text-lg font-semibold">{rateCostLabel(rate)}</span>
                    <span className="text-xs text-muted-foreground">{String(rate.currency || "USD")}</span>
                  </div>
                </div>
                <div className="grid gap-2 rounded-md bg-muted/30 p-3 sm:grid-cols-3">
                  <div><p className="text-xs font-medium uppercase text-muted-foreground">Method</p><p className="font-medium">{String(rate.service || "Shipping")}</p></div>
                  <div><p className="text-xs font-medium uppercase text-muted-foreground">Cost</p><p className="font-medium">{rateCostLabel(rate)}</p></div>
                  <div><p className="text-xs font-medium uppercase text-muted-foreground">ETA</p><p className="font-medium">{rateEtaLabel(rate)}</p></div>
                </div>
                {Array.isArray(rate.protections) && rate.protections.length > 0 && <p className="text-xs text-muted-foreground">Protections: {rate.protections.map(String).join(", ")}</p>}
                {rate.warning ? <p className="text-xs text-amber-700 dark:text-amber-300">{String(rate.warning)}</p> : null}
              </button>
            })}
            {!rates.length && <p className="rounded-md border p-4 text-sm text-muted-foreground">{providerErrors.length ? "No printable shipping options are available from the connected providers for this order yet." : "Load options to compare available shipping labels for this order."}</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={loading || !selected || selectedIsReference || (adminPinRequired && adminPin.length < 4)} onClick={() => void buy()}>{loading ? <Loader2 className="size-4 animate-spin" /> : adminPinRequired ? <ShieldCheck className="size-4" /> : <Truck className="size-4" />} {selectedIsReference ? "Choose label provider" : adminPinRequired ? "Authorize and buy label" : "Buy label"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(printPreview)} onOpenChange={(nextOpen) => !nextOpen && setPrintPreview(null)}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] flex-col gap-0 overflow-hidden p-0 sm:h-[92dvh] sm:max-w-5xl sm:rounded-lg">
        <DialogHeader className="border-b p-4 pr-12"><DialogTitle>Print label {printPreview?.orderNumber}</DialogTitle><DialogDescription>The label is already purchased. Choose the packet format, preview it, then print or download it without buying again.</DialogDescription></DialogHeader>
        <div className="grid gap-3 border-b bg-muted/20 p-3 sm:p-4"><RadioGroup value={printDocumentMode} onValueChange={setPrintDocumentMode} className="grid gap-2 sm:grid-cols-3"><Label className="flex cursor-pointer items-start gap-2 rounded-md border bg-background p-3"><RadioGroupItem value="label" className="mt-0.5" /><span><span className="block text-sm font-medium">Shipping label</span><span className="block text-xs text-muted-foreground">Carrier label only</span></span></Label><Label className="flex cursor-pointer items-start gap-2 rounded-md border bg-background p-3"><RadioGroupItem value="packing-4x6" className="mt-0.5" /><span><span className="block text-sm font-medium">Label + packing slip</span><span className="block text-xs text-muted-foreground">4 x 6 thermal pages</span></span></Label><Label className="flex cursor-pointer items-start gap-2 rounded-md border bg-background p-3"><RadioGroupItem value="packing-letter" className="mt-0.5" /><span><span className="block text-sm font-medium">Label + packing slip</span><span className="block text-xs text-muted-foreground">Packing slip on Letter</span></span></Label></RadioGroup><div className="grid gap-3 sm:grid-cols-2"><Field label="Print destination"><Select value={printDestination} onValueChange={choosePrintDestination}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="browser">This browser</SelectItem>{printStations.map((station) => <SelectItem key={String(station.id)} value={String(station.id)}>{String(station.name || "Print station")}{station.online ? " - online" : ""}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">Saved as your default print destination.</p></Field>{selectedPrintStation ? <Field label="Printer"><Select value={printStationPrinter} onValueChange={(printerName) => { setPrintStationPrinter(printerName); void savePrintPreference(printDestination, printerName) }}><SelectTrigger><SelectValue placeholder="Choose printer" /></SelectTrigger><SelectContent>{(selectedPrintStation.printers || []).map((printer: string) => <SelectItem key={printer} value={printer}>{printer}</SelectItem>)}</SelectContent></Select></Field> : null}</div></div>
        <div className="min-h-0 flex-1 bg-muted/30 p-2 sm:p-4">{printPacketUrl ? <iframe key={printPacketUrl} ref={printFrameRef} src={printPacketUrl} title={`Purchased label ${printPreview?.orderNumber || ""}`} className="h-full min-h-[420px] w-full rounded-md border bg-white" /> : null}</div>
        <DialogFooter className="border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><Button variant="outline" onClick={() => setPrintPreview(null)}>Close</Button>{printPacketUrl ? <Button variant="outline" asChild><a href={printPacketUrl} download={`Label-${printPreview?.orderNumber || orderId}.pdf`}><FileDown className="size-4" /> Download PDF</a></Button> : null}<Button disabled={!printPacketUrl || loading || (printDestination !== "browser" && !printStationPrinter)} onClick={() => void (printDestination === "browser" ? printPurchasedLabel() : sendPurchasedLabelToStation())}>{loading ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />} {printDestination === "browser" ? "Print in browser" : "Send to printer"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}

export function LinkedPurchaseOrdersTable({ purchaseOrders }: { purchaseOrders: Array<Record<string, unknown>> }) {
  return <Card><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>PO</TableHead><TableHead>Supplier</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead><TableHead>Placed</TableHead><TableHead>Expected</TableHead><TableHead>Units received</TableHead><TableHead>Est. cost</TableHead><TableHead className="text-right" /></TableRow></TableHeader><TableBody>{purchaseOrders.map((po) => {
    const totalUnits = Number(po.totalUnits || 0)
    const receivedUnits = Number(po.receivedUnits || 0)
    const placedAt = String(po.placedAt || "")
    const canceled = ["canceled", "cancelled"].includes(String(po.status || "").toLowerCase())
    const cancelReason = [po.cancelReasonLabel || (canceled ? "Reason was not recorded" : ""), po.cancelReasonNote].filter(Boolean).map(String).join(": ")
    const canceledLines = Array.isArray(po.canceledLines) ? po.canceledLines as Array<Record<string, unknown>> : []
    return <TableRow key={String(po.id || po.poNumber)}><TableCell className="font-medium"><a className="hover:underline" href={`/purchase-orders/${encodeURIComponent(String(po.id || ""))}`}>{String(po.poNumber || po.id || "Purchase order")}</a><p className="text-xs text-muted-foreground">{numberLabel(Number(po.lineCount || 0))} line{Number(po.lineCount || 0) === 1 ? "" : "s"}</p></TableCell><TableCell>{String(po.supplier || "Unassigned")}</TableCell><TableCell className="min-w-52"><Badge variant={canceled ? "destructive" : "outline"}>{String(po.status || "Draft").replace(/_/g, " ")}</Badge>{canceled ? <p className="mt-1 break-words text-xs text-destructive">{cancelReason}</p> : null}{canceledLines.map((line, index) => <p key={`${String(line.sku)}-${index}`} className="mt-1 break-words text-xs text-destructive">{String(line.sku || "Line")} · {numberLabel(Number(line.qty || 0))} canceled · {String(line.reasonLabel || "Reason not recorded")}{line.reasonNote ? `: ${String(line.reasonNote)}` : ""}</p>)}</TableCell><TableCell>{dateLabel(String(po.createdAt || ""))}</TableCell><TableCell>{placedAt ? dateLabel(placedAt) : <span className="text-muted-foreground">Not placed</span>}</TableCell><TableCell>{po.expectedAt ? dateLabel(String(po.expectedAt)) : <span className="text-muted-foreground">Not set</span>}</TableCell><TableCell><span className={receivedUnits >= totalUnits && totalUnits > 0 ? "font-medium text-emerald-700 dark:text-emerald-300" : ""}>{numberLabel(receivedUnits)} / {numberLabel(totalUnits)}</span></TableCell><TableCell>{moneyLabel(Number(po.estimatedCost || 0))}</TableCell><TableCell className="text-right"><Button size="sm" variant="outline" asChild><a href={`/purchase-orders/${encodeURIComponent(String(po.id || ""))}`}>Open PO</a></Button></TableCell></TableRow>
  })}</TableBody></Table></div></CardContent></Card>
}

function ReturnPolicyQuestionnaire({ amount, responsibility, onResponsibilityChange, feePercent, onFeePercentChange, defaultFeePercent, managerReview, onManagerReviewChange, managerReviewReason, onManagerReviewReasonChange }: {
  amount: number
  responsibility: string
  onResponsibilityChange: (value: string) => void
  feePercent: number
  onFeePercentChange: (value: number) => void
  defaultFeePercent: number
  managerReview: boolean
  onManagerReviewChange: (value: boolean) => void
  managerReviewReason: string
  onManagerReviewReasonChange: (value: string) => void
}) {
  const fee = Number((amount * feePercent / 100).toFixed(2))
  const selectResponsibility = (value: string) => {
    onResponsibilityChange(value)
    if (value === "customer" && feePercent === 0) onFeePercentChange(defaultFeePercent)
    if (value !== "customer" && feePercent === defaultFeePercent) onFeePercentChange(0)
  }
  return <div className="grid gap-4 rounded-md border bg-muted/15 p-4">
    <div><p className="font-medium">Return policy questionnaire</p><p className="text-xs text-muted-foreground">Record who caused the return, confirm the fee, and route exceptions to a manager before the RMA is processed.</p></div>
    <div className="grid gap-2"><Label>Who is responsible?</Label><RadioGroup value={responsibility} onValueChange={selectResponsibility} className="grid gap-2 sm:grid-cols-2"><Label className="flex cursor-pointer items-center gap-2 rounded-md border bg-background p-3"><RadioGroupItem value="customer" />Customer choice or customer error</Label><Label className="flex cursor-pointer items-center gap-2 rounded-md border bg-background p-3"><RadioGroupItem value="merchant" />Our product or fulfillment issue</Label><Label className="flex cursor-pointer items-center gap-2 rounded-md border bg-background p-3"><RadioGroupItem value="carrier" />Carrier damage or loss</Label><Label className="flex cursor-pointer items-center gap-2 rounded-md border bg-background p-3"><RadioGroupItem value="unknown" />Needs investigation</Label></RadioGroup></div>
    <div className="grid gap-3 sm:grid-cols-[minmax(0,220px)_1fr]"><Field label="Restocking fee percent"><Input type="number" min="0" max="100" step="0.1" value={String(feePercent)} onChange={(event) => onFeePercentChange(Math.max(0, Math.min(100, Number(event.target.value || 0))))} /></Field><div className="rounded-md border bg-background p-3 text-sm"><p className="font-medium">Fee {moneyLabel(fee)}</p><p className="text-xs text-muted-foreground">Estimated refund after fee: {moneyLabel(Math.max(0, amount - fee))}. This fee is reviewed during refund; it is not charged automatically.</p></div></div>
    <Label className="flex items-center justify-between gap-4 rounded-md border bg-background p-3"><span><span className="block font-medium">Send to manager review</span><span className="block text-xs font-normal text-muted-foreground">Use for exceptions, goodwill overrides, unclear responsibility, or policy disputes.</span></span><Switch checked={managerReview} onCheckedChange={onManagerReviewChange} /></Label>
    {managerReview && <Field label="What should the manager review?"><Textarea className="min-h-20" value={managerReviewReason} onChange={(event) => onManagerReviewReasonChange(event.target.value)} placeholder="Explain the exception, requested approval, and customer commitment." /></Field>}
    <Alert variant={managerReview ? "default" : undefined}><ShieldCheck className="size-4" /><AlertTitle>{managerReview ? "Creates in Needs revision" : "Creates as a new return"}</AlertTitle><AlertDescription>{managerReview ? "A manager must approve it before it returns to In process." : `${responsibility === "customer" ? "Customer-responsible" : "Non-customer-responsible"} return with a ${feePercent}% restocking fee.`}</AlertDescription></Alert>
  </div>
}

export function OrderLineActionPanel({ mode, orderId, order, lines, warehouses, returns = [], onUpdated }: { mode: "refund" | "return"; orderId: string; order: Record<string, unknown>; lines: Array<Record<string, unknown>>; warehouses?: Array<Record<string, unknown>>; returns?: Array<Record<string, unknown>>; onUpdated: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [quantities, setQuantities] = useState<Record<number, number>>({})
  const [warehouseId, setWarehouseId] = useState("")
  const [reason, setReason] = useState(mode === "refund" ? "Customer request" : "Customer return")
  const [returnLabelPolicy, setReturnLabelPolicy] = useState("merchant_provided")
  const [responsibility, setResponsibility] = useState("unknown")
  const [restockingFeePercent, setRestockingFeePercent] = useState(0)
  const [defaultRestockingFeePercent, setDefaultRestockingFeePercent] = useState(30)
  const [managerReviewRequested, setManagerReviewRequested] = useState(false)
  const [managerReviewReason, setManagerReviewReason] = useState("")
  const [note, setNote] = useState("")
  const [attachments, setAttachments] = useState<File[]>([])
  const allowedReturnAttachmentTypes = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"])
  const maxAttachmentBytes = 5 * 1024 * 1024
  const maxAttachmentTotalBytes = 15 * 1024 * 1024
  const maxAttachmentCount = 8
  const returnedByLine = new Map<number, number>()
  if (mode === "return") returns.filter((record) => !["canceled", "cancelled", "denied", "rejected"].includes(String(record.status || "").toLowerCase())).forEach((record) => {
    const items = Array.isArray(record.items) ? record.items as Array<Record<string, unknown>> : []
    items.forEach((item) => {
      const lineIndex = Number(item.lineIndex)
      if (Number.isInteger(lineIndex) && lineIndex >= 0) returnedByLine.set(lineIndex, Number(returnedByLine.get(lineIndex) || 0) + Math.max(0, Number(item.qty || 0)))
    })
  })
  const availableQty = (line: Record<string, unknown>, lineIndex: number) => Math.max(0, Number(line.qty || 0) - Number(returnedByLine.get(lineIndex) || 0))
  const selected = lines.map((line, lineIndex) => ({ sku: String(line.sku || ""), title: String(line.title || ""), qty: Math.max(0, Math.min(availableQty(line, lineIndex), Number(quantities[lineIndex] || 0))), price: Number(line.price || 0), cost: Number(line.unitCost || line.cost || 0), lineIndex })).filter((line) => line.sku && line.qty > 0)
  const amount = selected.reduce((sum, line) => sum + line.qty * line.price, 0)
  const begin = () => {
    setQuantities(Object.fromEntries(lines.map((_, index) => [index, 0])))
    setWarehouseId(String(order.returnWarehouseId || warehouses?.find((warehouse) => warehouse.isDefaultReturns)?.id || warehouses?.[0]?.id || ""))
    setReason(mode === "refund" ? "Customer request" : "Customer return")
    setReturnLabelPolicy("merchant_provided")
    setResponsibility("unknown")
    setRestockingFeePercent(0)
    setManagerReviewRequested(false)
    setManagerReviewReason("")
    setNote("")
    setAttachments([])
    setOpen(true)
  }
  const addAttachments = (incoming: File[]) => {
    if (!incoming.length) return
    const unsupported = incoming.find((file) => !allowedReturnAttachmentTypes.has(file.type))
    if (unsupported) return toast.error(`${unsupported.name || "That file"} is not a supported PNG, JPEG, WebP, or PDF.`)
    const oversized = incoming.find((file) => file.size > maxAttachmentBytes)
    if (oversized) return toast.error(`${oversized.name || "That file"} is larger than 5 MB.`)
    setAttachments((current) => {
      const merged = [...current]
      for (const file of incoming) {
        const key = `${file.name}:${file.size}:${file.lastModified}`
        if (!merged.some((item) => `${item.name}:${item.size}:${item.lastModified}` === key)) merged.push(file)
      }
      if (merged.length > maxAttachmentCount) {
        toast.error(`Attach no more than ${maxAttachmentCount} files to one RMA.`)
        return current
      }
      if (merged.reduce((sum, file) => sum + file.size, 0) > maxAttachmentTotalBytes) {
        toast.error("RMA attachments cannot exceed 15 MB combined.")
        return current
      }
      return merged
    })
  }
  const handleAttachmentPaste = (event: ReactClipboardEvent<HTMLElement>) => {
    const pasted = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))
      .map((file, index) => file.name && file.name !== "image.png" ? file : new File([file], `pasted-screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}-${index + 1}.png`, { type: file.type || "image/png", lastModified: Date.now() }))
    if (!pasted.length) return
    event.preventDefault()
    addAttachments(pasted)
  }
  const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ""))
    reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`))
    reader.readAsDataURL(file)
  })
  useEffect(() => {
    if (mode !== "return") return
    const openRma = () => begin()
    window.addEventListener("dataplus:order-create-rma", openRma)
    return () => window.removeEventListener("dataplus:order-create-rma", openRma)
  }, [mode, order, warehouses, lines])
  useEffect(() => {
    if (mode !== "return") return
    void loadAppBootstrap().then((state) => setDefaultRestockingFeePercent(Math.max(0, Math.min(100, Number(state.systemSettings?.returnDefaultCustomerRestockingPercent ?? 30))))).catch(() => undefined)
  }, [mode])
  const save = async () => {
    if (!selected.length) return toast.error("Choose at least one line quantity.")
    if (mode === "return" && !warehouseId) return toast.error("Choose a return warehouse.")
    setSaving(true)
    try {
      const path = mode === "refund" ? `/api/orders/${encodeURIComponent(orderId)}/refunds` : `/api/orders/${encodeURIComponent(orderId)}/returns`
      const encodedAttachments = mode === "return" ? await Promise.all(attachments.map(async (file) => ({ name: file.name, size: file.size, mimeType: file.type, dataUrl: await fileToBase64(file), source: "RMA evidence" }))) : []
      const body = mode === "refund" ? { items: selected, amount, reason, method: "manual" } : { items: selected, amount, reason, note: note.trim(), attachments: encodedAttachments, warehouseId, condition: "Unknown", returnLabelPolicy, responsibility, restockingFeePercent, returnFee: Number((amount * restockingFeePercent / 100).toFixed(2)), managerReviewRequested, managerReviewReason: managerReviewReason.trim() }
      await api(path, { method: "POST", body: JSON.stringify(body) })
      setOpen(false); await onUpdated(); toast.success(mode === "refund" ? "Partial refund recorded." : "RMA created.")
    } catch (error) { toast.error(error instanceof Error ? error.message : `Unable to create ${mode}.`) } finally { setSaving(false) }
  }
  const label = mode === "refund" ? "Create line-level refund" : "Create RMA"
  return <><Button variant="outline" onClick={begin}>{label}</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[100dvh] overflow-y-auto sm:max-h-[92dvh] sm:max-w-2xl"><DialogHeader><DialogTitle>{label}</DialogTitle><DialogDescription>Select only the quantities that should be {mode === "refund" ? "refunded" : "returned"}. DataPlus will generate the RMA and continue through receiving, inspection, disposition, and refund review. Total: {moneyLabel(amount)}.</DialogDescription></DialogHeader><div className="max-h-72 overflow-y-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Item</TableHead><TableHead>{mode === "return" ? "Available" : "Ordered"}</TableHead><TableHead>{mode === "refund" ? "Refund" : "Return"}</TableHead></TableRow></TableHeader><TableBody>{lines.map((line, index) => { const maximum = availableQty(line, index); return <TableRow key={`${String(line.sku)}-${index}`}><TableCell>{String(line.sku || "-")}</TableCell><TableCell><span className="block max-w-64 truncate" title={String(line.title || "-")}>{String(line.title || "-")}</span></TableCell><TableCell>{numberLabel(maximum)}</TableCell><TableCell><Input className="w-24" type="number" min="0" max={maximum} disabled={maximum <= 0} value={String(quantities[index] || 0)} onChange={(event) => setQuantities({ ...quantities, [index]: Math.max(0, Math.min(maximum, Number(event.target.value || 0))) })} /></TableCell></TableRow> })}</TableBody></Table></div>{mode === "return" && <Field label="Return warehouse"><Select value={warehouseId} onValueChange={setWarehouseId}><SelectTrigger><SelectValue placeholder="Choose warehouse" /></SelectTrigger><SelectContent>{(warehouses || []).map((warehouse) => <SelectItem key={String(warehouse.id)} value={String(warehouse.id)}>{String(warehouse.name || warehouse.code || "Warehouse")}</SelectItem>)}</SelectContent></Select></Field>}<Field label="Reason">{mode === "return" ? <Select value={reason} onValueChange={setReason}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Customer return", "Damaged", "Defective", "Incorrect item", "Item not as described", "Missing parts", "Carrier damage", "Changed mind", "Other"].map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select> : <Input value={reason} onChange={(event) => setReason(event.target.value)} />}</Field>{mode === "return" && <><Field label="Return shipping"><RadioGroup value={returnLabelPolicy} onValueChange={setReturnLabelPolicy} className="grid gap-2 sm:grid-cols-2"><Label className="flex cursor-pointer gap-3 rounded-md border p-3"><RadioGroupItem value="merchant_provided" /><span><span className="block font-medium">Provide a prepaid label</span><span className="block text-xs text-muted-foreground">Create the RMA first, then compare return-label quotes.</span></span></Label><Label className="flex cursor-pointer gap-3 rounded-md border p-3"><RadioGroupItem value="customer_provided" /><span><span className="block font-medium">No label</span><span className="block text-xs text-muted-foreground">Customer ships the approved return at their own cost.</span></span></Label></RadioGroup></Field><ReturnPolicyQuestionnaire amount={amount} responsibility={responsibility} onResponsibilityChange={setResponsibility} feePercent={restockingFeePercent} onFeePercentChange={setRestockingFeePercent} defaultFeePercent={defaultRestockingFeePercent} managerReview={managerReviewRequested} onManagerReviewChange={setManagerReviewRequested} managerReviewReason={managerReviewReason} onManagerReviewReasonChange={setManagerReviewReason} /><Field label="Return notes"><Textarea className="min-h-24" value={note} onChange={(event) => setNote(event.target.value)} onPaste={handleAttachmentPaste} placeholder="Add customer details, troubleshooting, approval context, or other notes..." /></Field><div className="grid gap-3 rounded-md border bg-muted/20 p-3" onPaste={handleAttachmentPaste} tabIndex={0}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-medium">Evidence</p><p className="text-xs text-muted-foreground">Select multiple PNG, JPEG, WebP, or PDF files, or paste screenshots here. Up to 8 files, 5 MB each, 15 MB combined.</p></div><label className="inline-flex cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-medium hover:bg-accent"><FileUp className="size-4" />Add files<Input className="sr-only" type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(event) => { addAttachments(Array.from(event.currentTarget.files || [])); event.currentTarget.value = "" }} /></label></div>{attachments.length > 0 && <div className="grid gap-2 sm:grid-cols-2">{attachments.map((file, index) => <div key={`${file.name}-${file.size}-${file.lastModified}`} className="flex min-w-0 items-center gap-2 rounded-md border bg-background p-2"><FileText className="size-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium" title={file.name}>{file.name}</p><p className="text-[11px] text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p></div><Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label={`Remove ${file.name}`} onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X className="size-4" /></Button></div>)}</div>}</div></>}<DialogFooter className="sticky bottom-0 bg-background pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={saving || !selected.length || (mode === "return" && !warehouseId)} onClick={() => void save()}>{saving && <Loader2 className="size-4 animate-spin" />}{mode === "return" ? "Create RMA" : "Save refund"}</Button></DialogFooter></DialogContent></Dialog></>
}

export function OrderRefundSyncPanel({ orderId, order, onUpdated }: { orderId: string; order: Record<string, unknown>; onUpdated: () => Promise<void> }) {
  const [savingId, setSavingId] = useState("")
  const refunds = Array.isArray(order.refunds) ? order.refunds as Array<Record<string, unknown>> : []
  const isShopify = String(order.source || "").toLowerCase() === "shopify"
  if (!refunds.length || !isShopify) return null
  const send = async (refund: Record<string, unknown>) => {
    setSavingId(String(refund.id || ""))
    try { const result = await api<{ message?: string }>(`/api/orders/${encodeURIComponent(orderId)}/refunds/${encodeURIComponent(String(refund.id || ""))}/sync-shopify`, { method: "POST" }); await onUpdated(); toast.success(result.message || "Refund sent to Shopify.") } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to send refund to Shopify.") } finally { setSavingId("") }
  }
  return <Card><CardHeader><CardTitle className="text-sm">Shopify refund delivery</CardTitle><CardDescription>Each local refund is sent once, only after Shopify refund sync is enabled in Channel Settings.</CardDescription></CardHeader><CardContent className="grid gap-2">{refunds.map((refund) => { const sync = (refund.channelSync || {}) as Record<string, unknown>; const sent = ["sent", "synced"].includes(String(sync.status || "").toLowerCase()); return <div key={String(refund.id)} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"><span>{moneyLabel(Number(refund.amount || 0))} / {String(refund.reason || "Refund")}</span><div className="flex items-center gap-2"><Badge variant={sent ? "secondary" : "outline"}>{String(sync.status || "Local only")}</Badge>{!sent && <Button size="sm" variant="outline" disabled={savingId === String(refund.id)} onClick={() => void send(refund)}>Send to Shopify</Button>}</div></div> })}</CardContent></Card>
}

export function ShopifyPaymentCapturePanel({ orderId, order, onUpdated }: { orderId: string; order: Record<string, unknown>; onUpdated: () => Promise<void> }) {
  const [open, setOpen] = useState(false); const [saving, setSaving] = useState(false); const [selected, setSelected] = useState<Record<string, unknown> | null>(null); const [amount, setAmount] = useState("")
  const isShopify = String(order.source || "").toLowerCase() === "shopify"
  const authorizations = (Array.isArray(order.payments) ? order.payments as Array<Record<string, unknown>> : []).filter((payment) => String(payment.kind || "").toLowerCase() === "authorization" && Boolean(payment.manuallyCapturable))
  if (!isShopify || !authorizations.length) return null
  const begin = (payment: Record<string, unknown>) => { setSelected(payment); setAmount(String(Number(payment.amount || 0).toFixed(2))); setOpen(true) }
  const capture = async () => { if (!selected || !(Number(amount) > 0)) return toast.error("Enter a capture amount greater than zero."); setSaving(true); try { const result = await api<{ message?: string }>(`/api/orders/${encodeURIComponent(orderId)}/payments/${encodeURIComponent(String(selected.id || ""))}/capture-shopify`, { method: "POST", body: JSON.stringify({ amount: Number(amount) }) }); setOpen(false); await onUpdated(); toast.success(result.message || "Payment captured in Shopify.") } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to capture Shopify payment.") } finally { setSaving(false) } }
  return <Card><CardHeader><CardTitle className="text-sm">Shopify payment capture</CardTitle><CardDescription>Only Shopify authorizations marked available for manual capture are shown. Your Shopify staff account also needs payment-capture permission.</CardDescription></CardHeader><CardContent className="grid gap-2">{authorizations.map((payment) => <div key={String(payment.id)} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"><span>{String(payment.provider || "Shopify")} / {moneyLabel(Number(payment.amount || 0))}</span><Button size="sm" variant="outline" onClick={() => begin(payment)}>Capture</Button></div>)}<Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Capture Shopify payment</DialogTitle><DialogDescription>This captures the selected authorization in Shopify and cannot be undone from DataPlus. Confirm the amount before continuing.</DialogDescription></DialogHeader><Field label="Capture amount"><Input type="number" min="0.01" step="0.01" max={Number(selected?.amount || 0)} value={amount} onChange={(event) => setAmount(event.target.value)} /></Field><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={saving || !(Number(amount) > 0)} onClick={() => void capture()}>Capture payment</Button></DialogFooter></DialogContent></Dialog></CardContent></Card>
}

export function OrderReturnSyncPanel({ order, returns, onUpdated }: { order: Record<string, unknown>; returns: Array<Record<string, unknown>>; onUpdated: () => Promise<void> }) {
  const [savingId, setSavingId] = useState("")
  const isShopify = String(order.source || "").toLowerCase() === "shopify"
  if (!returns.length || !isShopify) return null
  const send = async (record: Record<string, unknown>) => {
    setSavingId(String(record.id || ""))
    try { const result = await api<{ message?: string }>(`/api/returns/${encodeURIComponent(String(record.id || ""))}/sync-shopify`, { method: "POST" }); await onUpdated(); toast.success(result.message || "Return sent to Shopify.") } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to send return to Shopify.") } finally { setSavingId("") }
  }
  return <Card><CardHeader><CardTitle className="text-sm">Shopify return delivery</CardTitle><CardDescription>Only fulfilled, eligible Shopify lines can be sent. Each local return is sent once after return sync is enabled in Channel Settings.</CardDescription></CardHeader><CardContent className="grid gap-2">{returns.map((record) => { const sync = (record.channelSync || {}) as Record<string, unknown>; const sent = ["sent", "synced"].includes(String(sync.status || "").toLowerCase()); return <div key={String(record.id)} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"><span>{String(record.returnNumber || "Return")} / {String(record.reason || "Return")}</span><div className="flex items-center gap-2"><Badge variant={sent ? "secondary" : "outline"}>{String(sync.status || "Local only")}</Badge>{!sent && <Button size="sm" variant="outline" disabled={savingId === String(record.id)} onClick={() => void send(record)}>Send to Shopify</Button>}</div></div> })}</CardContent></Card>
}

export function OrderCustomerPanel({ orderId, order, summary, onUpdated }: { orderId: string; order: Record<string, unknown>; summary: Record<string, unknown>; onUpdated: () => Promise<void> }) {
  const [open, setOpen] = useState(false); const [saving, setSaving] = useState(false)
  const address = (order.address || {}) as Record<string, unknown>; const billing = (order.billingAddress || {}) as Record<string, unknown>
  const [draft, setDraft] = useState<Record<string, string>>({})
  const begin = () => { setDraft({ buyer: String(order.buyer || ""), buyerEmail: String(order.buyerEmail || ""), phone: String(order.phone || ""), notes: String(order.notes || ""), shippingLine1: String(address.line1 || ""), shippingCity: String(address.city || ""), shippingState: String(address.state || ""), shippingPostalCode: String(address.postalCode || ""), shippingCountry: String(address.country || ""), billingLine1: String(billing.line1 || ""), billingCity: String(billing.city || ""), billingState: String(billing.state || ""), billingPostalCode: String(billing.postalCode || ""), billingCountry: String(billing.country || "") }); setOpen(true) }
  const save = async () => { setSaving(true); try { await api(`/api/orders/${encodeURIComponent(orderId)}`, { method: "PATCH", body: JSON.stringify({ buyer: draft.buyer, buyerEmail: draft.buyerEmail, phone: draft.phone, notes: draft.notes, address: { line1: draft.shippingLine1, city: draft.shippingCity, state: draft.shippingState, postalCode: draft.shippingPostalCode, country: draft.shippingCountry }, billingAddress: { line1: draft.billingLine1, city: draft.billingCity, state: draft.billingState, postalCode: draft.billingPostalCode, country: draft.billingCountry } }) }); setOpen(false); await onUpdated(); toast.success("Customer and address details saved.") } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save customer details.") } finally { setSaving(false) } }
  return <div className="grid gap-4"><div className="flex justify-end"><Button variant="outline" onClick={begin}>Edit customer details</Button></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Detail label="Customer orders" value={numberLabel(Number(summary.orderCount || 0))} /><Detail label="Lifetime value" value={moneyLabel(Number(summary.lifetimeValue || 0))} /><Detail label="First order" value={dateLabel(String(summary.firstOrderAt || ""))} /><Detail label="Most recent" value={dateLabel(String(summary.lastOrderAt || ""))} /></div><Card><CardHeader><CardTitle className="text-sm">Customer contact</CardTitle></CardHeader><CardContent className="grid gap-2 text-sm"><p className="font-medium">{String(order.buyer || "Customer")}</p><p>{String(order.buyerEmail || "No email")}</p><p>{String(order.phone || "No phone")}</p><p className="whitespace-pre-wrap text-muted-foreground">{String(order.notes || "No internal notes.")}</p></CardContent></Card><Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-3xl"><DialogHeader><DialogTitle>Edit customer details</DialogTitle><DialogDescription>Updates the local operational order record. Shopify customer and address data remain unchanged until a channel edit workflow is explicitly enabled.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><Field label="Customer name"><Input value={draft.buyer || ""} onChange={(event) => setDraft({ ...draft, buyer: event.target.value })} /></Field><Field label="Email"><Input value={draft.buyerEmail || ""} onChange={(event) => setDraft({ ...draft, buyerEmail: event.target.value })} /></Field><Field label="Phone"><Input value={draft.phone || ""} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /></Field><div /><Field label="Shipping address line 1"><Input value={draft.shippingLine1 || ""} onChange={(event) => setDraft({ ...draft, shippingLine1: event.target.value })} /></Field><Field label="Billing address line 1"><Input value={draft.billingLine1 || ""} onChange={(event) => setDraft({ ...draft, billingLine1: event.target.value })} /></Field><Field label="Shipping city"><Input value={draft.shippingCity || ""} onChange={(event) => setDraft({ ...draft, shippingCity: event.target.value })} /></Field><Field label="Billing city"><Input value={draft.billingCity || ""} onChange={(event) => setDraft({ ...draft, billingCity: event.target.value })} /></Field><Field label="Shipping state / ZIP"><Input value={`${draft.shippingState || ""} ${draft.shippingPostalCode || ""}`.trim()} onChange={(event) => { const [state = "", postalCode = ""] = event.target.value.split(/\s+/, 2); setDraft({ ...draft, shippingState: state, shippingPostalCode: postalCode }) }} /></Field><Field label="Billing state / ZIP"><Input value={`${draft.billingState || ""} ${draft.billingPostalCode || ""}`.trim()} onChange={(event) => { const [state = "", postalCode = ""] = event.target.value.split(/\s+/, 2); setDraft({ ...draft, billingState: state, billingPostalCode: postalCode }) }} /></Field><Field label="Shipping country"><Input value={draft.shippingCountry || ""} onChange={(event) => setDraft({ ...draft, shippingCountry: event.target.value })} /></Field><Field label="Billing country"><Input value={draft.billingCountry || ""} onChange={(event) => setDraft({ ...draft, billingCountry: event.target.value })} /></Field></div><Field label="Internal notes"><Textarea value={draft.notes || ""} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></Field><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={saving} onClick={() => void save()}>Save details</Button></DialogFooter></DialogContent></Dialog></div>
}

export function OrderDocumentsPanel({ orderId, documents, onUpdated }: { orderId: string; documents: Array<Record<string, unknown>>; onUpdated: () => Promise<void> }) {
  const [uploadOpen, setUploadOpen] = useState(false); const [linkOpen, setLinkOpen] = useState(false); const [saving, setSaving] = useState(false); const [selectedFile, setSelectedFile] = useState<File | null>(null); const [type, setType] = useState("other"); const [note, setNote] = useState(""); const [draft, setDraft] = useState({ name: "", url: "", type: "other", note: "" }); const [preview, setPreview] = useState<Record<string, unknown> | null>(null); const [removing, setRemoving] = useState<Record<string, unknown> | null>(null)
  const documentTypes = <SelectContent><SelectItem value="invoice">Invoice</SelectItem><SelectItem value="packing-slip">Packing slip</SelectItem><SelectItem value="label">Shipping label</SelectItem><SelectItem value="supplier-document">Supplier document</SelectItem><SelectItem value="proof-of-delivery">Proof of delivery</SelectItem><SelectItem value="customer-message">Customer message</SelectItem><SelectItem value="product-photo">Product photo</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent>
  const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || "")); reader.onerror = () => reject(new Error("The selected file could not be read.")); reader.readAsDataURL(file) })
  const upload = async () => { if (!selectedFile) return toast.error("Choose a file to upload."); if (selectedFile.size > 15 * 1024 * 1024) return toast.error("Attachments must be 15 MB or smaller."); setSaving(true); try { await api(`/api/orders/${encodeURIComponent(orderId)}/attachments`, { method: "POST", body: JSON.stringify({ name: selectedFile.name, mimeType: selectedFile.type, contentBase64: await fileToBase64(selectedFile), type, note, user: "Luis" }) }); setUploadOpen(false); setSelectedFile(null); setType("other"); setNote(""); await onUpdated(); toast.success("Attachment uploaded to this order.") } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to upload attachment.") } finally { setSaving(false) } }
  const saveLink = async () => { if (!draft.name.trim() || !draft.url.trim()) return toast.error("A name and URL are required."); setSaving(true); try { await api(`/api/orders/${encodeURIComponent(orderId)}/documents`, { method: "POST", body: JSON.stringify(draft) }); setLinkOpen(false); setDraft({ name: "", url: "", type: "other", note: "" }); await onUpdated(); toast.success("External document linked to order.") } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to link document.") } finally { setSaving(false) } }
  const remove = async () => { if (!removing) return; setSaving(true); try { await api(`/api/orders/${encodeURIComponent(orderId)}/attachments/${encodeURIComponent(String(removing.id || ""))}`, { method: "DELETE" }); setRemoving(null); await onUpdated(); toast.success("Attachment removed.") } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to remove attachment.") } finally { setSaving(false) } }
  const isImage = (document: Record<string, unknown>) => String(document.mimeType || "").startsWith("image/")
  const sizeLabel = (size: unknown) => { const bytes = Number(size || 0); return bytes ? bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB` : "External link" }
  return <div className="grid gap-4"><Card><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-medium">Attachments</p><p className="text-sm text-muted-foreground">Upload order files, photos, labels, and supplier documents. Every attachment is recorded in Activity.</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setLinkOpen(true)}><Link2 className="size-4" /> Link URL</Button><Button size="sm" onClick={() => setUploadOpen(true)}><FileUp className="size-4" /> Upload attachment</Button></div></CardContent></Card>{documents.length ? <div className="grid gap-2">{documents.map((document) => <div key={String(document.id)} className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card p-3 text-sm"><div className="flex min-w-0 items-center gap-3">{isImage(document) ? <button type="button" className="size-12 shrink-0 overflow-hidden rounded border bg-muted" onClick={() => setPreview(document)} title="Preview image"><img src={String(document.url || "")} alt={String(document.name || "Attachment")} className="size-full object-cover" /></button> : <div className="grid size-12 shrink-0 place-items-center rounded border bg-muted"><FileText className="size-5 text-muted-foreground" /></div>}<div className="min-w-0"><a href={String(document.url || "#")} target="_blank" rel="noreferrer" className="block truncate font-medium hover:underline">{String(document.name || "Document")}</a><p className="mt-0.5 truncate text-xs text-muted-foreground">{String(document.type || "other").replace(/-/g, " ")} / {sizeLabel(document.size)} / {dateLabel(String(document.createdAt || ""))}</p>{Boolean(document.note) && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{String(document.note)}</p>}</div></div><div className="flex shrink-0 gap-1">{isImage(document) && <Button size="sm" variant="outline" onClick={() => setPreview(document)}>Preview</Button>}{String(document.storage || "") === "local" && <Button size="icon" variant="ghost" title="Delete attachment" disabled={saving} onClick={() => setRemoving(document)}><Trash2 className="size-4" /></Button>}</div></div>)}</div> : <Card><CardContent className="p-5 text-sm text-muted-foreground">No files are attached to this order.</CardContent></Card>}<Dialog open={uploadOpen} onOpenChange={setUploadOpen}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Upload order attachment</DialogTitle><DialogDescription>Upload a PDF, CSV, text file, or product photo. On a phone, use the camera option to capture a document or image directly.</DialogDescription></DialogHeader><div className="grid gap-4"><Field label="File"><Input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,text/plain,text/csv" capture="environment" onChange={(event) => setSelectedFile(event.target.files?.[0] || null)} />{selectedFile && <p className="text-xs text-muted-foreground">{selectedFile.name} / {sizeLabel(selectedFile.size)}</p>}</Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Category"><Select value={type} onValueChange={setType}><SelectTrigger><SelectValue /></SelectTrigger>{documentTypes}</Select></Field><Field label="Internal note"><Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional context" /></Field></div></div><DialogFooter><Button variant="outline" onClick={() => setUploadOpen(false)}>Cancel</Button><Button disabled={saving || !selectedFile} onClick={() => void upload()}>{saving && <Loader2 className="size-4 animate-spin" />} Upload attachment</Button></DialogFooter></DialogContent></Dialog><Dialog open={linkOpen} onOpenChange={setLinkOpen}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Link external document</DialogTitle><DialogDescription>Use this for files stored in a supplier portal, cloud drive, or another system.</DialogDescription></DialogHeader><div className="grid gap-4"><Field label="Name"><Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field><Field label="URL"><Input value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} placeholder="https://..." /></Field><Field label="Category"><Select value={draft.type} onValueChange={(value) => setDraft({ ...draft, type: value })}><SelectTrigger><SelectValue /></SelectTrigger>{documentTypes}</Select></Field><Field label="Internal note"><Textarea value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></Field></div><DialogFooter><Button variant="outline" onClick={() => setLinkOpen(false)}>Cancel</Button><Button disabled={saving} onClick={() => void saveLink()}>Link document</Button></DialogFooter></DialogContent></Dialog><Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}><DialogContent className="max-h-[92vh] sm:max-w-4xl"><DialogHeader><DialogTitle>{String(preview?.name || "Attachment")}</DialogTitle><DialogDescription>{String(preview?.type || "Image").replace(/-/g, " ")}</DialogDescription></DialogHeader>{preview && <img src={String(preview.url || "")} alt={String(preview.name || "Attachment")} className="max-h-[70vh] w-full rounded-md object-contain" />}</DialogContent></Dialog><AlertDialog open={Boolean(removing)} onOpenChange={(open) => !open && setRemoving(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete attachment?</AlertDialogTitle><AlertDialogDescription>{String(removing?.name || "This file")} will be removed from the order. This cannot be undone.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep attachment</AlertDialogCancel><AlertDialogAction disabled={saving} onClick={() => void remove()}>Delete attachment</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>
}

export function ReturnLabelPanel({ record, onUpdated }: { record: Record<string, unknown>; onUpdated: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const [printSize, setPrintSize] = useState("4x6")
  const [includePrintInstructions, setIncludePrintInstructions] = useState(true)
  const printFrameRef = useRef<HTMLIFrameElement>(null)
  const [loading, setLoading] = useState(false)
  const [rates, setRates] = useState<Array<Record<string, unknown>>>([])
  const [quoteId, setQuoteId] = useState("")
  const [quoteExpiresAt, setQuoteExpiresAt] = useState("")
  const [selectedRateId, setSelectedRateId] = useState("")
  const [addressReview, setAddressReview] = useState<{ origin?: Record<string, unknown>; destination?: Record<string, unknown> }>({})
  const [parcel, setParcel] = useState({ packageWeight: "1", packageLength: "8", packageWidth: "6", packageHeight: "4" })
  const [action, setAction] = useState<"void" | "refund" | "tracking" | "send" | null>(null)
  const [actionDraft, setActionDraft] = useState({ reason: "Label no longer needed", amount: "", reference: "", carrier: "UPS", trackingNumber: "", trackingUrl: "", recipient: "", subject: "", message: "" })
  const merchantProvided = String(record.returnLabelPolicy || "customer_provided") === "merchant_provided"
  const label = (record.returnLabel || {}) as Record<string, unknown>
  const document = (label.document || {}) as Record<string, unknown>
  const voided = String(label.voidStatus || "").toLowerCase() === "voided"
  const refundPending = voided && String(label.labelRefundStatus || "").toLowerCase() !== "confirmed"
  const tracking = Array.isArray(record.returnTracking) ? record.returnTracking as Array<Record<string, unknown>> : []
  const onDedicatedPage = window.location.pathname.startsWith("/returns/")
  const printUrl = `/api/returns/${encodeURIComponent(String(record.id || ""))}/shipping/print?size=${encodeURIComponent(printSize)}&instructions=${includePrintInstructions ? "1" : "0"}`
  const addressLines = (address?: Record<string, unknown>) => address ? [address.name, address.company, address.line1, address.line2, [address.town, address.county, address.postcode].filter(Boolean).join(", "), address.country_code].filter(Boolean).map(String) : []
  const quote = async () => {
    setLoading(true)
    try {
      const result = await api<{ rates?: Array<Record<string, unknown>>; quote?: Record<string, unknown>; addressReview?: { origin?: Record<string, unknown>; destination?: Record<string, unknown> }; blockers?: string[]; providerErrors?: Array<{ message?: string }> }>(`/api/returns/${encodeURIComponent(String(record.id || ""))}/shipping/rates`, { method: "POST", body: JSON.stringify({ ...Object.fromEntries(Object.entries(parcel).map(([key, value]) => [key, Number(value)])), packageType: "box" }) })
      const sortedRates = sortShippingRatesForDisplay(result.rates || [])
      setRates(sortedRates); setQuoteId(String(result.quote?.id || "")); setQuoteExpiresAt(String(result.quote?.expiresAt || "")); setSelectedRateId(String(sortedRates[0]?.id || "")); setAddressReview(result.addressReview || {})
      if (!result.rates?.length) toast.error((result.blockers || []).join(" ") || (result.providerErrors || []).map((entry) => entry.message).join(" ") || "No return-label rates were returned.")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load return-label rates.") } finally { setLoading(false) }
  }
  const buy = async () => {
    const rate = rates.find((entry) => String(entry.id || "") === selectedRateId)
    if (!rate) return toast.error("Choose a return-label rate.")
    if (!window.confirm(`Buy the ${String(rate.carrier || "carrier")} ${String(rate.service || "service")} return label for ${moneyLabel(Number(rate.amount || 0))}?\n\nRMA ${String(record.returnNumber || record.id)} / Order ${String(record.orderNumber || "-")}\nFrom: ${addressLines(addressReview.origin).join(", ")}\nTo: ${addressLines(addressReview.destination).join(", ")}`)) return
    setLoading(true)
    try {
      const purchase = (confirmAboveMaxCost = false) => api<{ document?: Record<string, unknown>; message?: string }>(`/api/returns/${encodeURIComponent(String(record.id || ""))}/shipping/labels`, { method: "POST", body: JSON.stringify({ quoteId, rateId: selectedRateId, confirmAboveMaxCost }) })
      let result
      try { result = await purchase(false) } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to purchase the return label."
        if (!message.includes("exceeds the configured max") || !window.confirm(`${message}\n\nBuy this label anyway?`)) throw error
        result = await purchase(true)
      }
      setOpen(false); await onUpdated(); setPrintOpen(true); toast.success(result.message || "Return label purchased.")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to purchase the return label.") } finally { setLoading(false) }
  }
  const runAction = async () => {
    if (!action) return
    setLoading(true)
    try {
      const route = action === "void" ? "shipping/void" : action === "refund" ? "shipping/refund" : action === "tracking" ? "tracking" : "send-customer"
      const body = action === "void" ? { reason: actionDraft.reason }
        : action === "refund" ? { amount: Number(actionDraft.amount), reference: actionDraft.reference }
          : action === "tracking" ? { carrier: actionDraft.carrier, trackingNumber: actionDraft.trackingNumber, trackingUrl: actionDraft.trackingUrl }
            : { recipient: actionDraft.recipient, subject: actionDraft.subject, message: actionDraft.message }
      const result = await api<{ message?: string }>(`/api/returns/${encodeURIComponent(String(record.id || ""))}/${route}`, { method: "POST", body: JSON.stringify(body) })
      setAction(null); await onUpdated(); toast.success(result.message || "Return updated.")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update this return.") } finally { setLoading(false) }
  }
  const refreshTracking = async () => {
    setLoading(true)
    try { const result = await api<{ message?: string }>(`/api/returns/${encodeURIComponent(String(record.id || ""))}/shipping/refresh`, { method: "POST" }); await onUpdated(); toast.success(result.message || "Return tracking refreshed.") }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to refresh return tracking.") } finally { setLoading(false) }
  }
  const openAction = (next: typeof action) => {
    setActionDraft({ reason: "Label no longer needed", amount: String(label.shippingCost || ""), reference: "", carrier: "UPS", trackingNumber: "", trackingUrl: "", recipient: "", subject: `${String(record.returnNumber || "RMA")} return instructions`, message: "" })
    setAction(next)
  }
  const actionTitle = action === "void" ? "Void return label" : action === "refund" ? "Record label refund" : action === "tracking" ? "Add customer return tracking" : "Send RMA to customer"
  return <div className="flex flex-wrap items-center gap-2">
    {!onDedicatedPage && <Button size="sm" variant="outline" asChild><a href={rmaHref(record)}><ExternalLink className="size-4" /> Open RMA</a></Button>}
    <Button size="sm" variant="outline" asChild><a href={`/api/returns/${encodeURIComponent(String(record.id || ""))}/pdf`} target="_blank" rel="noreferrer"><FileDown className="size-4" /> RMA PDF</a></Button>
    {(!document.url || voided) && <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Truck className="size-4" /> {voided ? "Buy replacement" : merchantProvided ? "Return label" : "Buy optional label"}</Button>}
    {Boolean(document.url) && <Button size="sm" variant="outline" onClick={() => setPrintOpen(true)}><Printer className="size-4" /> {voided ? "View voided label" : "Print label"}</Button>}
    {merchantProvided && Boolean(document.url) && !voided && <Button size="sm" variant="outline" disabled={loading} onClick={() => openAction("void")}><Ban className="size-4" /> Void</Button>}
    {merchantProvided && Boolean(label.remoteShipmentId) && !voided && <Button size="sm" variant="outline" disabled={loading} onClick={() => void refreshTracking()}><RefreshCw className="size-4" /> Tracking</Button>}
    {refundPending && <Button size="sm" variant="outline" onClick={() => openAction("refund")}>Record refund</Button>}
    {!merchantProvided && <Button size="sm" variant="outline" onClick={() => openAction("tracking")}><Truck className="size-4" /> Add tracking</Button>}
    {(!merchantProvided || (Boolean(document.url) && !voided)) && <Button size="sm" variant="outline" onClick={() => openAction("send")}><Mail className="size-4" /> Send RMA</Button>}
    <Badge variant={voided ? "destructive" : document.url ? "default" : merchantProvided ? "secondary" : "outline"}>{voided ? "Label voided" : document.url ? "Label purchased" : merchantProvided ? "Label required" : "Customer ships"}</Badge>
    {Boolean(tracking[0]?.trackingNumber) && <a className="text-xs font-medium text-primary hover:underline" href={String(tracking[0].trackingUrl || "#")} target="_blank" rel="noreferrer">{String(tracking[0].carrier || "Carrier")} {String(tracking[0].trackingNumber)}</a>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[100dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Return-label options</DialogTitle><DialogDescription>RMA {String(record.returnNumber || record.id)} for order {String(record.orderNumber || "-")}. Rates run from this order's customer address to the selected return warehouse.</DialogDescription></DialogHeader><div className="grid gap-3 sm:grid-cols-4"><Field label="Weight (lb)"><Input type="number" min="0.1" step="0.1" value={parcel.packageWeight} onChange={(event) => setParcel({ ...parcel, packageWeight: event.target.value })} /></Field><Field label="Length (in)"><Input type="number" min="1" value={parcel.packageLength} onChange={(event) => setParcel({ ...parcel, packageLength: event.target.value })} /></Field><Field label="Width (in)"><Input type="number" min="1" value={parcel.packageWidth} onChange={(event) => setParcel({ ...parcel, packageWidth: event.target.value })} /></Field><Field label="Height (in)"><Input type="number" min="1" value={parcel.packageHeight} onChange={(event) => setParcel({ ...parcel, packageHeight: event.target.value })} /></Field></div><Button variant="outline" disabled={loading} onClick={() => void quote()}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Get fresh quotes</Button>{addressReview.origin && addressReview.destination && <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-md border p-3"><p className="text-xs font-semibold uppercase text-muted-foreground">Ship from customer</p><p className="mt-2 whitespace-pre-line text-sm">{addressLines(addressReview.origin).join("\n")}</p></div><div className="rounded-md border border-emerald-600/40 bg-emerald-500/5 p-3"><p className="text-xs font-semibold uppercase text-emerald-700 dark:text-emerald-400">Return to warehouse</p><p className="mt-2 whitespace-pre-line text-sm">{addressLines(addressReview.destination).join("\n")}</p></div></div>}{quoteExpiresAt && <p className="text-xs text-muted-foreground">Quote expires {dateLabel(quoteExpiresAt)}. Expired rates cannot be purchased.</p>}{rates.length > 0 && <RadioGroup value={selectedRateId} onValueChange={setSelectedRateId} className="max-h-64 overflow-y-auto">{rates.map((rate) => <Label key={String(rate.id)} className="flex cursor-pointer items-center gap-3 rounded-md border p-3"><RadioGroupItem value={String(rate.id)} /><span className="min-w-0 flex-1"><span className="block font-medium">{String(rate.carrier || "Carrier")} / {String(rate.service || "Service")}</span><span className="block text-xs text-muted-foreground">{String(rate.deliveryEstimate || (rate.deliveryDays ? `${rate.deliveryDays} days` : "Delivery estimate unavailable"))}</span></span><span className="font-medium">{moneyLabel(Number(rate.amount || 0))}</span></Label>)}</RadioGroup>}<DialogFooter className="sticky bottom-0 bg-background pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={loading || !selectedRateId || !addressReview.origin || !addressReview.destination} onClick={() => void buy()}><ShoppingBag className="size-4" /> Buy selected label</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={printOpen} onOpenChange={setPrintOpen}><DialogContent className="flex h-[100dvh] max-h-[100dvh] flex-col gap-0 overflow-hidden p-0 sm:h-[92dvh] sm:max-w-5xl sm:rounded-lg"><DialogHeader className="border-b p-4 pr-12"><DialogTitle>Print return label</DialogTitle><DialogDescription>Preview the complete print packet without leaving this RMA. The shipping instructions print as page two when enabled.</DialogDescription></DialogHeader><div className="grid gap-3 border-b p-4 sm:grid-cols-[220px_minmax(0,1fr)] sm:items-end"><Field label="Paper size"><Select value={printSize} onValueChange={setPrintSize}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="4x6">4 x 6 thermal label</SelectItem><SelectItem value="letter">Letter 8.5 x 11</SelectItem><SelectItem value="original">Original carrier size</SelectItem></SelectContent></Select></Field><Label className="flex min-h-10 items-center justify-between gap-4 rounded-md border px-3 py-2"><span><span className="block text-sm font-medium">How to ship instructions</span><span className="block text-xs font-normal text-muted-foreground">Include as a second label</span></span><Switch checked={includePrintInstructions} onCheckedChange={setIncludePrintInstructions} /></Label></div><div className="min-h-0 flex-1 bg-muted/30 p-2 sm:p-4"><iframe ref={printFrameRef} key={printUrl} src={printUrl} title={`${String(record.returnNumber || "RMA")} print preview`} className="h-full min-h-[420px] w-full rounded-md border bg-white" /></div><DialogFooter className="border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><Button variant="outline" onClick={() => setPrintOpen(false)}>Close</Button><Button variant="outline" asChild><a href={printUrl} download={`${String(record.returnNumber || "RMA")}-print.pdf`}><FileDown className="size-4" /> Download PDF</a></Button><Button onClick={() => printFrameRef.current?.contentWindow?.print()}><Printer className="size-4" /> Print packet</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(action)} onOpenChange={(value) => !value && setAction(null)}><DialogContent className="max-h-[100dvh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>{actionTitle}</DialogTitle><DialogDescription>{action === "void" ? "Veeqo will cancel this label. Its cost remains in P&L until the provider refund is confirmed." : action === "refund" ? "Record the actual carrier credit after it appears. This reduces return shipping expense." : action === "tracking" ? "Save tracking supplied by the customer for a customer-paid return." : "Email the editable RMA PDF and, when applicable, the active prepaid carrier label."}</DialogDescription></DialogHeader><div className="grid gap-4">{action === "void" && <Field label="Reason"><Textarea value={actionDraft.reason} onChange={(event) => setActionDraft({ ...actionDraft, reason: event.target.value })} /></Field>}{action === "refund" && <><Field label="Confirmed refund amount"><Input type="number" min="0.01" step="0.01" value={actionDraft.amount} onChange={(event) => setActionDraft({ ...actionDraft, amount: event.target.value })} /></Field><Field label="Provider credit reference"><Input value={actionDraft.reference} onChange={(event) => setActionDraft({ ...actionDraft, reference: event.target.value })} /></Field></>}{action === "tracking" && <><Field label="Carrier"><Select value={actionDraft.carrier} onValueChange={(carrier) => setActionDraft({ ...actionDraft, carrier })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="UPS">UPS</SelectItem><SelectItem value="FedEx">FedEx</SelectItem><SelectItem value="USPS">USPS</SelectItem><SelectItem value="DHL">DHL</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent></Select></Field><Field label="Tracking number"><Input value={actionDraft.trackingNumber} onChange={(event) => setActionDraft({ ...actionDraft, trackingNumber: event.target.value })} /></Field><Field label="Tracking URL (optional)"><Input value={actionDraft.trackingUrl} onChange={(event) => setActionDraft({ ...actionDraft, trackingUrl: event.target.value })} /></Field></>}{action === "send" && <><Field label="Customer email"><Input type="email" value={actionDraft.recipient} onChange={(event) => setActionDraft({ ...actionDraft, recipient: event.target.value })} placeholder="Uses the order email when blank" /></Field><Field label="Subject"><Input value={actionDraft.subject} onChange={(event) => setActionDraft({ ...actionDraft, subject: event.target.value })} /></Field><Field label="Message (optional)"><Textarea className="min-h-28" value={actionDraft.message} onChange={(event) => setActionDraft({ ...actionDraft, message: event.target.value })} placeholder="Uses the saved RMA template when blank" /></Field></>}</div><DialogFooter className="pb-[max(0.75rem,env(safe-area-inset-bottom))]"><Button variant="outline" onClick={() => setAction(null)}>Cancel</Button><Button variant={action === "void" ? "destructive" : "default"} disabled={loading} onClick={() => void runAction()}>{loading && <Loader2 className="size-4 animate-spin" />}{action === "send" ? "Send RMA" : action === "tracking" ? "Save tracking" : action === "refund" ? "Record refund" : "Void label"}</Button></DialogFooter></DialogContent></Dialog>
  </div>
}

function orderAddressText(value: unknown) {
  const address = (value || {}) as Record<string, unknown>
  return [
    address.name,
    address.company,
    address.line1 || address.address1,
    address.line2 || address.address2,
    [address.city || address.town, address.state || address.province || address.county, address.postalCode || address.zip || address.postcode].filter(Boolean).join(", "),
    address.country || address.countryCode || address.country_code,
  ].filter(Boolean).join("\n") || "Not provided"
}

export function OrderCustomerInformationCard({ order, collapsible = false }: { order: Record<string, unknown>; collapsible?: boolean }) {
  const source = String(order.channelSource || order.source || "Sales channel").trim()
  const sourceKey = source.toLowerCase()
  const email = String(order.buyerEmail || "").trim()
  const phone = String(order.phone || (order.address as Record<string, unknown> | undefined)?.phone || "").trim()
  const isTemuRelayContact = sourceKey === "temu" && /@[^@]*temuemail\.com$/i.test(email)
  const hasTemuCustomerAccount = Boolean(order.marketplaceCustomerId || order.buyerId || order.customerExternalId)
  const customerProfileHref = order.customerId && (!isTemuRelayContact || hasTemuCustomerAccount) ? `/customers/${encodeURIComponent(String(order.customerId))}` : ""
  const orderKey = String(order.id || order.orderNumber || "").trim()
  const orderNumber = String(order.orderNumber || order.id || "Not linked")
  const content = <CardContent className="grid gap-4 text-sm">
    <div className="grid gap-4 md:grid-cols-2">
      <div className="min-w-0 rounded-md border bg-muted/20 p-3">
        <p className="text-xs font-semibold uppercase text-muted-foreground">Contact information</p>
        <div className="mt-2 grid gap-1">
          <p className="font-medium">{String(order.buyer || "Customer name not provided")}</p>
          {email ? <a className="break-all text-primary hover:underline" href={`mailto:${email}`}>{email}</a> : <p className="text-muted-foreground">No email</p>}
          {phone ? <a className="text-primary hover:underline" href={`tel:${phone}`}>{phone}</a> : <p className="text-muted-foreground">No phone</p>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/20 p-3">
        <div className="min-w-0"><p className="text-xs font-semibold uppercase text-muted-foreground">Order</p>{orderKey ? <a className="mt-2 block break-all font-medium text-primary hover:underline" href={`/orders/${encodeURIComponent(orderKey)}`}>{orderNumber}</a> : <p className="mt-2 font-medium">{orderNumber}</p>}</div>
        <div className="min-w-0"><p className="text-xs font-semibold uppercase text-muted-foreground">Sales channel</p><p className="mt-2 break-words font-medium">{source}</p></div>
      </div>
    </div>
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-md border p-3"><p className="text-xs font-semibold uppercase text-muted-foreground">Shipping address</p><p className="mt-2 whitespace-pre-line break-words text-muted-foreground">{orderAddressText(order.address)}</p></div>
      <div className="rounded-md border p-3"><p className="text-xs font-semibold uppercase text-muted-foreground">Billing address</p><p className="mt-2 whitespace-pre-line break-words text-muted-foreground">{orderAddressText(order.billingAddress)}</p></div>
    </div>
  </CardContent>
  return <Card>
    {collapsible ? <Collapsible defaultOpen><CardHeader className="flex flex-row items-start justify-between gap-3 pb-3"><div className="min-w-0"><CardTitle className="text-sm">Customer information</CardTitle>{customerProfileHref ? <a href={customerProfileHref} className="mt-1 block truncate text-sm text-primary hover:underline">{String(order.buyer || order.buyerEmail || "Customer")}</a> : <CardDescription className="mt-1 truncate">{String(order.buyer || order.buyerEmail || "Customer")}</CardDescription>}</div><CollapsibleTrigger asChild><Button size="sm" variant="outline">Details</Button></CollapsibleTrigger></CardHeader><CollapsibleContent>{content}</CollapsibleContent></Collapsible> : <><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-sm">Customer information</CardTitle><CardDescription>Contact and delivery details from the linked order.</CardDescription></div>{customerProfileHref && <Button size="sm" variant="outline" asChild><a href={customerProfileHref}>Open customer</a></Button>}</div></CardHeader>{content}</>}
  </Card>
}

export function OrderReturnsPanel({ orderId, order, lines, warehouses, returns, onUpdated }: { orderId: string; order: Record<string, unknown>; lines: Array<Record<string, unknown>>; warehouses: Array<Record<string, unknown>>; returns: Array<Record<string, unknown>>; onUpdated: () => Promise<void> }) {
  const [manageOpen, setManageOpen] = useState(false); const [selectedReturn, setSelectedReturn] = useState<Record<string, unknown> | null>(null); const [returnUpdate, setReturnUpdate] = useState<Record<string, string>>({})
  const [open, setOpen] = useState(false); const [saving, setSaving] = useState(false); const [warehouseId, setWarehouseId] = useState(""); const [reason, setReason] = useState("Customer request"); const [condition, setCondition] = useState("Unknown"); const [note, setNote] = useState(""); const [returnFee, setReturnFee] = useState("")
  const create = async () => { setSaving(true); try { await api(`/api/orders/${encodeURIComponent(orderId)}/returns`, { method: "POST", body: JSON.stringify({ warehouseId, reason, condition, note, returnFee: Number(returnFee || 0), amount: Number(order.total || 0), items: lines.map((line, lineIndex) => ({ sku: String(line.sku || ""), title: String(line.title || ""), qty: Number(line.qty || 0), price: Number(line.price || 0), cost: Number(line.unitCost || line.cost || 0), lineIndex })) }) }); setOpen(false); await onUpdated(); toast.success("Return created.") } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to create return.") } finally { setSaving(false) } }
  const beginManage = (record: Record<string, unknown>) => { setSelectedReturn(record); setReturnUpdate({ warehouseId: String(record.warehouseId || ""), status: String(record.receivingStatus || (record.status === "closed" ? "done" : record.status) || "requested"), condition: String(record.condition || "Unknown"), disposition: String(record.disposition || "quarantine"), binLocation: String(record.binLocation || ""), inspectionStatus: String(record.inspectionStatus || "pending"), inspectionCondition: String(record.inspectionCondition || ""), inspectionNotes: String(record.inspectionNotes || ""), resolutionNotes: String(record.resolutionNotes || ""), returnFee: String(record.returnFee || "") }); setManageOpen(true) }
  const saveManagedReturn = async () => { if (!selectedReturn) return; setSaving(true); try { const result = await api<{ return?: Record<string, unknown>; vendorReturnLinks?: Array<Record<string, unknown>> }>(`/api/returns/${encodeURIComponent(String(selectedReturn.id || ""))}`, { method: "PATCH", body: JSON.stringify({ ...returnUpdate, returnFee: Number(returnUpdate.returnFee || 0), warehouseId: returnUpdate.warehouseId, items: (Array.isArray(selectedReturn.items) ? selectedReturn.items as Array<Record<string, unknown>> : []).map((line, index) => ({ ...line, receivedQty: Number(returnUpdate[`received-${index}`] ?? line.receivedQty ?? 0) })) }) }); if (String((result.return?.allocationReview as Record<string, unknown> | undefined)?.status || "") === "pending") { const allocation = await api<{ return?: Record<string, unknown>; allocation?: Record<string, unknown> }>(`/api/returns/${encodeURIComponent(String(selectedReturn.id || ""))}/allocate-open-orders`, { method: "POST" }); await onUpdated(); setSelectedReturn(allocation.return || result.return || selectedReturn); setManageOpen(false); toast.success(`${numberLabel(Number(allocation.allocation?.allocatedQty || 0))} inspected return unit(s) were reserved for open orders. Review any remaining quantity before final disposition.`) } else { await onUpdated(); setManageOpen(false); toast.success(result.vendorReturnLinks?.length ? `${result.vendorReturnLinks.length} vendor return${result.vendorReturnLinks.length === 1 ? " was" : "s were"} added to Purchasing.` : returnUpdate.disposition === "restock" && returnUpdate.status === "done" ? "Return closed and inventory restocked." : "Return updated.") } } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update return.") } finally { setSaving(false) } }
  const refreshReturns = async () => { setSaving(true); try { const result = await api<{ job?: ImportJob; message?: string }>(`/api/${String(order.source).toLowerCase()}/returns/import`, { method: "POST", body: JSON.stringify({ fetchAll: true, lookbackDays: Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 86400000) + 1 }) }); toast.success(result.message || "Return import queued.", { action: result.job?.id ? { label: "View job", onClick: () => { window.location.href = `/jobs/${result.job?.id}` } } : undefined }); } catch (error) { toast.error(error instanceof Error ? error.message : "Return import failed.") } finally { setSaving(false) } }
  return <div className="grid gap-4"><div className="flex flex-wrap gap-2">{["ebay", "shopify", "temu"].includes(String(order.source || "").toLowerCase()) && <Button variant="outline" disabled={saving} onClick={() => void refreshReturns()}><RefreshCw className="mr-2 size-4" />Refresh channel returns</Button>}<Button onClick={() => window.dispatchEvent(new CustomEvent("dataplus:order-create-rma"))}>Create return</Button></div>{returns.length ? returns.map((record) => <Card key={String(record.id)}><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm"><div><p className="font-medium">{String(record.returnNumber || "Return")}</p><p className="text-muted-foreground">{String(record.reason || "No reason")} / {String(record.warehouseName || "No warehouse")}</p></div><div className="flex flex-wrap items-center gap-2"><span>{record.refundAmountUnverified ? "Amount unverified" : moneyLabel(Number(record.amount || 0))}</span><Badge variant="outline">{String(record.status || "requested")}</Badge><ReturnLabelPanel record={record} onUpdated={onUpdated} /><Button size="sm" variant="outline" onClick={() => beginManage(record)}>Manage</Button></div><OrderReturnDetails record={record} trackingUrl={trackingUrlForShipment} /></CardContent></Card>) : <Card><CardContent className="p-5 text-sm text-muted-foreground">No returns are linked to this order.</CardContent></Card>}<Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Create return</DialogTitle><DialogDescription>Creates a local return request for the order's current line quantities. Receiving, inspection, and restocking are recorded from this order.</DialogDescription></DialogHeader><div className="grid gap-4"><Field label="Return warehouse"><Select value={warehouseId} onValueChange={setWarehouseId}><SelectTrigger><SelectValue placeholder="Choose warehouse" /></SelectTrigger><SelectContent>{warehouses.map((item) => <SelectItem key={String(item.id)} value={String(item.id)}>{String(item.name || item.code || "Warehouse")}</SelectItem>)}</SelectContent></Select></Field><Field label="Reason"><Input value={reason} onChange={(event) => setReason(event.target.value)} /></Field><Field label="Condition"><Select value={condition} onValueChange={setCondition}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Unknown">Unknown</SelectItem><SelectItem value="New">New</SelectItem><SelectItem value="Opened">Opened</SelectItem><SelectItem value="Damaged">Damaged</SelectItem></SelectContent></Select></Field><Field label="Return fee"><Input type="number" min="0" step="0.01" value={returnFee} onChange={(event) => setReturnFee(event.target.value)} /></Field><Field label="Internal note"><Textarea value={note} onChange={(event) => setNote(event.target.value)} /></Field></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={saving || !warehouseId} onClick={() => void create()}>Create return</Button></DialogFooter></DialogContent></Dialog><Dialog open={manageOpen} onOpenChange={setManageOpen}><DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>Manage {String(selectedReturn?.returnNumber || "return")}</DialogTitle><DialogDescription>Closing a return with Restock adds received quantities back once at the assigned warehouse.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><Field label="Return status"><Select value={returnUpdate.status || "requested"} onValueChange={(status) => setReturnUpdate({ ...returnUpdate, status })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="requested">Requested</SelectItem><SelectItem value="received">Received</SelectItem><SelectItem value="inspection">In inspection</SelectItem><SelectItem value="done">Closed</SelectItem></SelectContent></Select></Field><Field label="Disposition"><Select value={returnUpdate.disposition || "quarantine"} onValueChange={(disposition) => setReturnUpdate({ ...returnUpdate, disposition })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending_local_receipt">Awaiting decision</SelectItem><SelectItem value="restock">Restock inventory</SelectItem><SelectItem value="quarantine">Quarantine</SelectItem><SelectItem value="return_to_vendor">Return to vendor</SelectItem><SelectItem value="dispose">Dispose</SelectItem></SelectContent></Select></Field><Field label="Received condition"><Input value={returnUpdate.condition || ""} onChange={(event) => setReturnUpdate({ ...returnUpdate, condition: event.target.value })} /></Field><Field label="Bin location"><Input value={returnUpdate.binLocation || ""} onChange={(event) => setReturnUpdate({ ...returnUpdate, binLocation: event.target.value })} /></Field><Field label="Inspection status"><Select value={returnUpdate.inspectionStatus || "pending"} onValueChange={(inspectionStatus) => setReturnUpdate({ ...returnUpdate, inspectionStatus })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending">Pending</SelectItem><SelectItem value="passed">Passed</SelectItem><SelectItem value="failed">Failed</SelectItem></SelectContent></Select></Field><Field label="Inspection condition"><Input value={returnUpdate.inspectionCondition || ""} onChange={(event) => setReturnUpdate({ ...returnUpdate, inspectionCondition: event.target.value })} /></Field><Field label="Return fee"><Input type="number" min="0" step="0.01" value={returnUpdate.returnFee || ""} onChange={(event) => setReturnUpdate({ ...returnUpdate, returnFee: event.target.value })} /></Field></div><ReturnReceiptFields record={selectedReturn} warehouses={warehouses} draft={returnUpdate} setDraft={setReturnUpdate} /><Field label="Inspection notes"><Textarea value={returnUpdate.inspectionNotes || ""} onChange={(event) => setReturnUpdate({ ...returnUpdate, inspectionNotes: event.target.value })} /></Field><Field label="Resolution notes"><Textarea value={returnUpdate.resolutionNotes || ""} onChange={(event) => setReturnUpdate({ ...returnUpdate, resolutionNotes: event.target.value })} /></Field><DialogFooter className="sticky bottom-0 bg-background py-3"><Button variant="outline" onClick={() => setManageOpen(false)}>Cancel</Button><Button disabled={saving} onClick={() => void saveManagedReturn()}>Save return</Button></DialogFooter></DialogContent></Dialog></div>
}

export function FulfillmentStagePanel({ orderId, order, onUpdated }: { orderId: string; order: Record<string, unknown>; onUpdated: () => Promise<void> }) {
  const [saving, setSaving] = useState(false)
  const stage = String(order.fulfillmentStage || "ready")
  const run = async (nextStage: string) => { setSaving(true); try { const result = await api<{ message?: string }>(`/api/orders/${encodeURIComponent(orderId)}/fulfillment-stage`, { method: "POST", body: JSON.stringify({ stage: nextStage }) }); await onUpdated(); toast.success(result.message || "Fulfillment stage updated.") } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update fulfillment stage.") } finally { setSaving(false) } }
  return <Card><CardHeader><CardTitle className="text-sm">Pick and pack</CardTitle><CardDescription>Current stage: <span className="font-medium capitalize text-foreground">{stage}</span></CardDescription></CardHeader><CardContent className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={saving || stage === "picked" || stage === "packed"} onClick={() => void run("picked")}>Mark picked</Button><Button size="sm" variant="outline" disabled={saving || stage !== "picked"} onClick={() => void run("packed")}>Mark packed</Button>{stage === "packed" && <Button size="sm" variant="ghost" disabled={saving} onClick={() => void run("unpacked")}>Undo pack</Button>}{stage === "picked" && <Button size="sm" variant="ghost" disabled={saving} onClick={() => void run("unpicked")}>Undo pick</Button>}</CardContent></Card>
}

export function CustomerNotificationPanel({ orderId, order, onUpdated }: { orderId: string; order: Record<string, unknown>; onUpdated: () => Promise<void> }) {
  const [open, setOpen] = useState(false); const [saving, setSaving] = useState(false); const [template, setTemplate] = useState("order-update"); const [message, setMessage] = useState("")
  const notifications = Array.isArray(order.notifications) ? order.notifications as Array<Record<string, unknown>> : []
  const save = async () => { setSaving(true); try { const result = await api<{ message?: string }>(`/api/orders/${encodeURIComponent(orderId)}/notifications`, { method: "POST", body: JSON.stringify({ template, message }) }); setOpen(false); setMessage(""); await onUpdated(); toast.success(result.message || "Customer notification queued.") } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to queue notification.") } finally { setSaving(false) } }
  return <Card><CardHeader><CardTitle className="text-sm">Customer notifications</CardTitle><CardDescription>Queue an order message for {String(order.buyerEmail || "the customer")}. Delivery remains auditable on this order.</CardDescription></CardHeader><CardContent className="grid gap-3"><Button size="sm" variant="outline" className="w-fit" onClick={() => setOpen(true)}>Queue notification</Button>{notifications.slice(0, 3).map((notification) => <div key={String(notification.id)} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"><span>{String(notification.template || "order-update")}</span><Badge variant="outline">{String(notification.status || "queued")}</Badge></div>)}<Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Queue customer notification</DialogTitle><DialogDescription>Templates provide the default message. You can add a specific note before queueing it.</DialogDescription></DialogHeader><Field label="Template"><Select value={template} onValueChange={setTemplate}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="shipment">Shipment</SelectItem><SelectItem value="partial-shipment">Partial shipment</SelectItem><SelectItem value="return-approved">Return approved</SelectItem><SelectItem value="refund">Refund</SelectItem><SelectItem value="backorder">Backorder</SelectItem><SelectItem value="order-update">Order update</SelectItem></SelectContent></Select></Field><Field label="Optional message override"><Textarea value={message} onChange={(event) => setMessage(event.target.value)} /></Field><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={saving} onClick={() => void save()}>Queue notification</Button></DialogFooter></DialogContent></Dialog></CardContent></Card>
}

export function ShopifyDeliveryQuotePanel({ orderId, order, onUpdated, selectedLines = [] }: { orderId: string; order: Record<string, unknown>; onUpdated: () => Promise<void>; selectedLines?: Array<{ lineIndex: number; qty: number }> }) {
  const [loading, setLoading] = useState(false)
  const quotes = Array.isArray(order.shippingQuotes) ? order.shippingQuotes as Array<Record<string, unknown>> : []
  const latest = quotes[0]
  const options = Array.isArray(latest?.options) ? latest.options as Array<Record<string, unknown>> : []
  const selected = (order.selectedShippingQuote || {}) as Record<string, unknown>
  const quote = async () => { if (!selectedLines.length && Array.isArray(order.items) && order.items.length) return toast.error("Select at least one item and quantity to ship first."); setLoading(true); try { const result = await api<{ message?: string }>(`/api/orders/${encodeURIComponent(orderId)}/shipping-quotes/shopify`, { method: "POST", body: JSON.stringify({ lines: selectedLines }) }); await onUpdated(); toast.success(result.message || "Shopify delivery options are ready.") } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to calculate Shopify delivery options.") } finally { setLoading(false) } }
  const select = async (quoteId: string, handle: string) => { setLoading(true); try { const result = await api<{ message?: string }>(`/api/orders/${encodeURIComponent(orderId)}/shipping-quotes/${encodeURIComponent(quoteId)}/select`, { method: "POST", body: JSON.stringify({ handle }) }); await onUpdated(); toast.success(result.message || "Delivery option selected.") } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to select delivery option.") } finally { setLoading(false) } }
  return <Card><CardHeader><CardTitle className="text-sm">Shopify delivery options</CardTitle><CardDescription>Calculates customer-facing shipping options from the current order, address, and Shopify delivery profiles. This does not create a draft order, change the order, or buy a label.</CardDescription></CardHeader><CardContent className="grid gap-3"><div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" disabled={loading} onClick={() => void quote()}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Get delivery options</Button>{Boolean(selected.handle) && <Badge variant="outline">Selected: {String(selected.title || "Shipping")} / {moneyLabel(Number(selected.amount || 0))}</Badge>}</div>{latest ? <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Service</TableHead><TableHead>Customer price</TableHead><TableHead>Action</TableHead></TableRow></TableHeader><TableBody>{options.map((option) => <TableRow key={String(option.handle)}><TableCell className="font-medium">{String(option.title || "Shipping")}</TableCell><TableCell>{moneyLabel(Number(option.amount || 0))} {String(option.currency || "")}</TableCell><TableCell><Button size="sm" variant={String(selected.handle || "") === String(option.handle || "") ? "secondary" : "outline"} disabled={loading || String(selected.handle || "") === String(option.handle || "")} onClick={() => void select(String(latest.id), String(option.handle))}>{String(selected.handle || "") === String(option.handle || "") ? "Selected" : "Select"}</Button></TableCell></TableRow>)}{!options.length && <TableRow><TableCell colSpan={3} className="text-muted-foreground">Shopify returned no delivery options for this order.</TableCell></TableRow>}</TableBody></Table></div> : <p className="text-sm text-muted-foreground">No delivery options calculated yet.</p>}</CardContent></Card>
}

export function ShippingLabelReadinessPanel({ orderId, order, onUpdated, shipmentDraft }: { orderId: string; order: Record<string, unknown>; onUpdated: () => Promise<void>; shipmentDraft?: Record<string, unknown> }) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ ready?: boolean; blockers?: string[]; apiVersion?: string } | null>(null)
  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const purchases = Array.isArray(order.shippingLabelPurchases) ? order.shippingLabelPurchases as Array<Record<string, unknown>> : []
  const selected = (order.selectedShippingQuote || {}) as Record<string, unknown>
  const shopifyAdminUrl = String(order.shopifyAdminUrl || "")
  const check = async () => { setLoading(true); try { setResult(await api(`/api/orders/${encodeURIComponent(orderId)}/shipping-label-readiness`, { method: "POST", body: JSON.stringify({ shipment: shipmentDraft || {} }) })) } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to check label readiness.") } finally { setLoading(false) } }
  const refreshPurchase = async (purchaseId: string) => { setLoading(true); try { const response = await api<{ purchase?: Record<string, unknown> }>(`/api/orders/${encodeURIComponent(orderId)}/shipping-labels/shopify/${encodeURIComponent(purchaseId)}`); await onUpdated(); toast.success(String(response.purchase?.status || "Label status updated.")) } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to refresh label status.") } finally { setLoading(false) } }
  const purchase = async () => { setLoading(true); try { const response = await api<{ purchase?: Record<string, unknown>; message?: string }>(`/api/orders/${encodeURIComponent(orderId)}/shipping-labels/shopify`, { method: "POST", body: JSON.stringify({ weightPounds: Number(shipmentDraft?.packageWeight || 0), lengthInches: Number(shipmentDraft?.packageLength || 0), widthInches: Number(shipmentDraft?.packageWidth || 0), heightInches: Number(shipmentDraft?.packageHeight || 0), shipDate: String(shipmentDraft?.shipDate || ""), notifyCustomer: Boolean(shipmentDraft?.notifyCustomer), warehouseId: String(shipmentDraft?.warehouseId || ""), warehouseName: String(shipmentDraft?.warehouseName || ""), lines: Array.isArray(shipmentDraft?.lines) ? shipmentDraft.lines : [], packageType: "BOX" }) }); setPurchaseOpen(false); await onUpdated(); toast.success(response.message || "Shopify label purchase started."); if (response.purchase?.id && !response.purchase.done) window.setTimeout(() => void refreshPurchase(String(response.purchase?.id)), 1800) } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to purchase Shopify label.") } finally { setLoading(false) } }
  const canPurchase = Boolean(result?.ready && selected.handle)
  return <Card><CardHeader><CardTitle className="text-sm">Shopify Shipping label readiness</CardTitle><CardDescription>Choose a customer delivery option, confirm the live package details, then purchase a Shopify Shipping label.</CardDescription></CardHeader><CardContent className="grid gap-3"><div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" onClick={() => void check()} disabled={loading}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Check readiness</Button><Button size="sm" disabled={!canPurchase || loading} onClick={() => setPurchaseOpen(true)}><ShoppingBag className="size-4" /> Buy Shopify label</Button></div>{!selected.handle && <p className="text-xs text-muted-foreground">Select a Shopify delivery option before purchasing a label.</p>}{result && <div className="rounded-md border p-3 text-sm"><Badge variant={result.ready ? "default" : "outline"}>{result.ready ? "Label prerequisites ready" : "Needs setup"}</Badge><p className="mt-2 text-muted-foreground">Shopify API: {result.apiVersion || "Not configured"}</p>{!result.ready && <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">{(result.blockers || []).map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>}</div>}{purchases.map((purchase) => { const labels = Array.isArray(purchase.labels) ? purchase.labels as Array<Record<string, unknown>> : []; const errors = Array.isArray(purchase.errors) ? purchase.errors as Array<Record<string, unknown>> : []; return <div key={String(purchase.id)} className="rounded-md border p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium">Shopify label purchase</p><p className="text-xs text-muted-foreground">{dateLabel(String(purchase.requestedAt || purchase.checkedAt || ""))}</p></div><div className="flex items-center gap-2"><Badge variant={String(purchase.status) === "PURCHASED" ? "default" : String(purchase.status) === "PURCHASE_FAILED" ? "destructive" : "secondary"}>{String(purchase.status || "PENDING_PURCHASE")}</Badge>{!Boolean(purchase.done) && <Button size="sm" variant="outline" disabled={loading} onClick={() => void refreshPurchase(String(purchase.id))}>Refresh status</Button>}</div></div>{labels.map((label) => { const tracking = (label.tracking || {}) as Record<string, unknown>; const documents = Array.isArray(label.documents) ? label.documents as Array<Record<string, unknown>> : []; return <div key={String(label.id)} className="mt-2 flex flex-wrap items-center gap-2 text-muted-foreground"><span>{String(tracking.company || "Shopify Shipping")} / {String(tracking.number || "Tracking pending")}</span>{String(tracking.url || "") && <a className="text-primary hover:underline" href={String(tracking.url)} target="_blank" rel="noreferrer">Track</a>}{documents.map((document, index) => <a key={`${String(document.url)}-${index}`} className="text-primary hover:underline" href={String(document.url)} target="_blank" rel="noreferrer">Open {String(document.format || document.documentType || "label")}</a>)}{Boolean(label.cancellable) && shopifyAdminUrl && <a className="text-primary hover:underline" href={shopifyAdminUrl} target="_blank" rel="noreferrer">Void in Shopify</a>}</div>})}{errors.map((error, index) => <p key={`${String(error.code)}-${index}`} className="mt-2 text-destructive">{String(error.message || "Shopify could not purchase the label.")}</p>)}</div>})}<Dialog open={purchaseOpen} onOpenChange={setPurchaseOpen}><DialogContent><DialogHeader><DialogTitle>Buy Shopify shipping label</DialogTitle><DialogDescription>This starts an irreversible label purchase with Shopify Shipping for the selected package.</DialogDescription></DialogHeader><div className="grid gap-3 rounded-md border bg-muted/20 p-3 text-sm"><div className="flex justify-between gap-3"><span className="text-muted-foreground">Customer delivery option</span><span className="font-medium">{String(selected.title || "Not selected")}</span></div><div className="flex justify-between gap-3"><span className="text-muted-foreground">Package</span><span className="font-medium">{String(shipmentDraft?.packageLength || 0)} x {String(shipmentDraft?.packageWidth || 0)} x {String(shipmentDraft?.packageHeight || 0)} in / {String(shipmentDraft?.packageWeight || 0)} lb</span></div><p className="text-xs text-muted-foreground">Shopify determines the purchasable carrier rate from the fulfillment order and its shipping configuration.</p></div><DialogFooter><Button variant="outline" onClick={() => setPurchaseOpen(false)}>Cancel</Button><Button disabled={loading} onClick={() => void purchase()}><ShoppingBag className="size-4" /> Buy label</Button></DialogFooter></DialogContent></Dialog></CardContent></Card>
}

export function ShipmentGroupPanel({ orderId, order, onUpdated }: { orderId: string; order: Record<string, unknown>; onUpdated: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [applyingShipment, setApplyingShipment] = useState(false)
  const [syncingShipment, setSyncingShipment] = useState(false)
  const [candidates, setCandidates] = useState<Array<Record<string, unknown>>>([])
  const [selected, setSelected] = useState<string[]>([])
  const [eligibility, setEligibility] = useState<{ eligible: boolean; reason: string; warehouseId: string }>({ eligible: true, reason: "", warehouseId: "" })
  const groupId = String(order.shipmentGroupId || "")
  const groupOrderIds = Array.isArray(order.shipmentGroupOrderIds) ? order.shipmentGroupOrderIds as string[] : []
  const masterShipment = (Array.isArray(order.shipments) ? order.shipments as Array<Record<string, unknown>> : []).find((shipment) => {
    const status = String(shipment.status || "").toLowerCase()
    return Boolean(shipment.trackingNumber) && ["fulfilled", "shipped", "in_transit", "delivered"].includes(status)
  })
  const sameAddressCandidates = candidates.filter((candidate) => Array.isArray(candidate.matchReasons) && (candidate.matchReasons as string[]).includes("same_address"))
  const groupedCandidates = candidates.filter((candidate) => groupId && String(candidate.shipmentGroupId || "") === groupId)
  const candidateLabel = (candidate: Record<string, unknown>) => {
    const reasons = Array.isArray(candidate.matchReasons) ? candidate.matchReasons as string[] : []
    if (reasons.includes("same_group")) return "Grouped"
    if (reasons.includes("same_address")) return "Same address"
    return "Compatible"
  }
  const loadCandidates = async (showErrors = false) => {
    setLoading(true)
    try {
      const result = await api<{ candidates?: Array<Record<string, unknown>>; eligible?: boolean; reason?: string; warehouseId?: string }>(`/api/orders/${encodeURIComponent(orderId)}/shipment-group-candidates`)
      setCandidates(result.candidates || [])
      setEligibility({ eligible: result.eligible !== false, reason: String(result.reason || ""), warehouseId: String(result.warehouseId || "") })
    } catch (error) {
      if (showErrors) toast.error(error instanceof Error ? error.message : "Unable to find compatible orders.")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void loadCandidates(false) }, [orderId, groupId])
  const openDialog = async () => { setOpen(true); setSelected(groupedCandidates.map((candidate) => String(candidate.id || "")).filter(Boolean)); if (!candidates.length) await loadCandidates(true) }
  const save = async () => { if (!selected.length) return toast.error("Select at least one compatible order."); setSaving(true); try { const result = await api<{ message?: string }>(`/api/orders/${encodeURIComponent(orderId)}/shipment-group`, { method: "POST", body: JSON.stringify({ orderIds: selected }) }); setOpen(false); await onUpdated(); toast.success(result.message || "Shipment group saved.") } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to group shipments.") } finally { setSaving(false) } }
  const applyMasterShipment = async () => { if (!masterShipment || !window.confirm(`Apply tracking ${String(masterShipment.trackingNumber)} to ${Math.max(0, groupOrderIds.length - 1)} other grouped order(s)? This will fulfill their lines, reduce inventory, and allocate the label cost.`)) return; setApplyingShipment(true); try { const result = await api<{ message?: string }>(`/api/orders/${encodeURIComponent(orderId)}/shipment-group/apply-shipment`, { method: "POST", body: JSON.stringify({ shipmentId: String(masterShipment.id || ""), user: "Luis" }) }); await onUpdated(); toast.success(result.message || "Shared shipment applied.") } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to apply the shared shipment.") } finally { setApplyingShipment(false) } }
  const syncGroupShipment = async () => { if (!masterShipment || !window.confirm(`Send tracking ${String(masterShipment.trackingNumber)} to every connected marketplace order in this shipment group? Each channel result will be recorded separately.`)) return; setSyncingShipment(true); try { const result = await api<{ message?: string; report?: Array<{ status?: string; message?: string }> }>(`/api/orders/${encodeURIComponent(orderId)}/shipment-group/sync-channel`, { method: "POST", body: JSON.stringify({ shipmentId: String(masterShipment.id || ""), user: "Luis" }) }); await onUpdated(); const failed = (result.report || []).filter((entry) => entry.status === "failed"); if (failed.length) toast.error(`${result.message || "Some channel updates failed."} ${failed[0]?.message || ""}`); else toast.success(result.message || "Shared tracking sent to connected channels.") } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to sync the shared shipment.") } finally { setSyncingShipment(false) } }
  return <><Card><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-sm">Ship together</CardTitle><CardDescription>{groupId ? `Shipment group ${groupId}. One package can carry the selected orders; each marketplace order remains separate.` : "Find paid, unlabeled orders for the exact same recipient and delivery address."}</CardDescription></div>{sameAddressCandidates.length > 0 && <Badge variant="secondary">{sameAddressCandidates.length} compatible</Badge>}</div></CardHeader><CardContent className="grid gap-3">{!eligibility.eligible ? <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-muted-foreground">Cannot combine this order yet: {eligibility.reason}</p> : loading && !candidates.length ? <div className="grid gap-2"><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : sameAddressCandidates.length || groupedCandidates.length ? <div className="grid gap-2">{(groupedCandidates.length ? groupedCandidates : sameAddressCandidates).slice(0, 5).map((candidate) => { const address = (candidate.address || {}) as Record<string, unknown>; return <a key={String(candidate.id)} className="rounded-md border bg-muted/20 p-3 text-sm hover:bg-muted/40" href={`/orders/${encodeURIComponent(String(candidate.id || ""))}`}><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{String(candidate.orderNumber || candidate.id)}</span><Badge variant={String(candidate.shipmentGroupId || "") === groupId && groupId ? "default" : "outline"}>{candidateLabel(candidate)}</Badge></div><div className="mt-1 text-xs text-muted-foreground">{String(candidate.buyer || "Customer")} / {moneyLabel(Number(candidate.total || 0))}</div><div className="mt-1 truncate text-xs text-muted-foreground">{[address.line1, address.city, address.state, address.postalCode].filter(Boolean).join(", ")}</div></a> })}</div> : <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No other paid, unlabeled orders were found for this exact delivery address.</p>}<div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!eligibility.eligible} onClick={() => void openDialog()}>{groupId ? "Manage shipment group" : sameAddressCandidates.length ? "Create shipment group" : "Find compatible orders"}</Button><Button size="sm" variant="ghost" disabled={loading} onClick={() => void loadCandidates(true)}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh</Button></div></CardContent></Card>{groupId && groupOrderIds.length > 1 && <Card><CardHeader><CardTitle className="text-sm">Apply one shipment</CardTitle><CardDescription>{masterShipment ? `Use ${String(masterShipment.carrierName || masterShipment.carrier || "the recorded carrier")} tracking ${String(masterShipment.trackingNumber)} for the other ${groupOrderIds.length - 1} grouped order${groupOrderIds.length === 2 ? "" : "s"}. Inventory and label cost are recorded per order. Send the completed tracking to Shopify or eBay from here; unsupported channels remain visibly pending.` : "Record and fulfill the master order first. Its carrier and tracking can then be applied to the other grouped orders."}</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-2"><Button size="sm" disabled={!masterShipment || applyingShipment} onClick={() => void applyMasterShipment()}>{applyingShipment && <Loader2 className="size-4 animate-spin" />}{masterShipment ? "Apply shared tracking to group" : "Awaiting master shipment"}</Button><Button size="sm" variant="outline" disabled={!masterShipment || syncingShipment} onClick={() => void syncGroupShipment()}>{syncingShipment && <Loader2 className="size-4 animate-spin" />} Send tracking to channels</Button></CardContent></Card>}<Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Combine compatible orders</DialogTitle><DialogDescription>Only orders with the same recipient, full delivery address, and fulfillment warehouse are eligible. The order records and channel payments stay separate.</DialogDescription></DialogHeader>{loading ? <div className="grid gap-2"><Skeleton className="h-12" /><Skeleton className="h-12" /></div> : candidates.length ? <div className="max-h-72 overflow-y-auto rounded-md border"><Table><TableHeader><TableRow><TableHead /><TableHead>Order</TableHead><TableHead>Match</TableHead><TableHead>Status</TableHead><TableHead>Total</TableHead></TableRow></TableHeader><TableBody>{candidates.map((candidate) => { const id = String(candidate.id || ""); const checked = selected.includes(id); return <TableRow key={id}><TableCell><Checkbox checked={checked} onCheckedChange={(value) => setSelected(value ? [...new Set([...selected, id])] : selected.filter((item) => item !== id))} /></TableCell><TableCell><a className="font-medium hover:underline" href={`/orders/${encodeURIComponent(id)}`}>{String(candidate.orderNumber || id)}</a></TableCell><TableCell><Badge variant="outline">{candidateLabel(candidate)}</Badge></TableCell><TableCell><Badge variant="outline">{String(candidate.fulfillmentStatus || candidate.status || "new")}</Badge></TableCell><TableCell>{moneyLabel(Number(candidate.total || 0))}</TableCell></TableRow> })}</TableBody></Table></div> : <p className="rounded-md border p-4 text-sm text-muted-foreground">No active compatible orders were found.</p>}<DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={saving || loading || !selected.length} onClick={() => void save()}>{groupId ? "Update shipment group" : "Create shipment group"}</Button></DialogFooter></DialogContent></Dialog></>
}

export function OrderOperationsPanel({ orderId, order, onUpdated }: { orderId: string; order: Record<string, unknown>; onUpdated: () => Promise<void> }) {
  const [routing, setRouting] = useState(false)
  const routes = Array.isArray(order.fulfillmentRoutes) ? order.fulfillmentRoutes as Array<Record<string, unknown>> : []
  const routingExplanations = Array.isArray(order.routingExplanation) ? order.routingExplanation as Array<Record<string, unknown>> : []
  const exceptions = unresolvedOrderExceptions(order)
  const route = async () => {
    setRouting(true)
    try {
      const result = await api<{ message?: string }>(`/api/orders/${encodeURIComponent(orderId)}/route`, { method: "POST", body: JSON.stringify({ user: "Luis" }) })
      await onUpdated()
      toast.success(result.message || "Order routing refreshed.")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to refresh order routing.") } finally { setRouting(false) }
  }
  return <div className="grid gap-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium">Operational routing</p><p className="text-sm text-muted-foreground">Inventory is reserved per order line; unallocated supply is routed to purchasing or review.</p></div><Button size="sm" variant="outline" disabled={routing} onClick={() => void route()}>{routing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh routing</Button></div>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.42fr)]"><Card><CardHeader><CardTitle className="text-sm">Line allocations</CardTitle><CardDescription>Every route is tied to an order line, warehouse, vendor, or purchase order.</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Line</TableHead><TableHead>Route</TableHead><TableHead>Source</TableHead><TableHead>Quantity</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{routes.map((route) => <TableRow key={String(route.id)}><TableCell><p className="font-medium">{String(route.sku || "Unmatched SKU")}</p><p className="max-w-56 truncate text-xs text-muted-foreground">{String(route.title || "")}</p></TableCell><TableCell>{String(route.type || "warehouse").replace(/_/g, " ")}</TableCell><TableCell>{String(route.warehouseName || route.vendorName || route.purchaseOrderNumber || "Unassigned")}</TableCell><TableCell>{numberLabel(Number(route.qty || 0))}</TableCell><TableCell><Badge variant={orderRouteNeedsReview(route) ? "destructive" : "outline"}>{String(route.status || "new").replace(/_/g, " ")}</Badge>{route.reviewReason ? <p className="mt-1 max-w-64 text-xs text-muted-foreground">{String(route.reviewReason)}</p> : null}</TableCell></TableRow>)}{!routes.length && <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No routes exist yet. Refresh routing to allocate stock or create supply requirements.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card><Card><CardHeader><CardTitle className="text-sm">Exceptions</CardTitle><CardDescription>Unresolved warnings and blockers from channel imports, routing, and purchasing.</CardDescription></CardHeader><CardContent className="grid gap-2">{exceptions.map((entry) => { const severity = String(entry.severity || "blocking").toLowerCase(); const blocking = ["blocking", "error", "critical", "destructive"].includes(severity); return <div key={String(entry.id)} className={`rounded-md border p-3 text-sm ${blocking ? "border-destructive/30 bg-destructive/5" : "border-amber-500/30"}`}><div className="flex items-center justify-between gap-2"><p className="font-medium">{orderExceptionTitle(entry)}</p><Badge variant={blocking ? "destructive" : "outline"}>{String(entry.severity || "warning")}</Badge></div><p className="mt-1 break-words text-muted-foreground">{orderExceptionDetail(entry)}</p></div> })}{!exceptions.length && <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-muted-foreground">No unresolved operational exceptions.</div>}</CardContent></Card></div>
    <Card><CardHeader><CardTitle className="text-sm">Routing decisions</CardTitle><CardDescription>Why each line was assigned to a warehouse, supplier, or purchasing workflow.</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Channel</TableHead><TableHead>Rule</TableHead><TableHead>Warehouses considered</TableHead><TableHead>Decision</TableHead></TableRow></TableHeader><TableBody>{routingExplanations.map((entry, index) => {
      const considered = Array.isArray(entry.consideredWarehouses) ? entry.consideredWarehouses as Array<string | Record<string, unknown>> : []
      const decisions = Array.isArray(entry.decisions) ? entry.decisions as Array<Record<string, unknown>> : []
      const decisionText = decisions.length
        ? decisions.map((decision) => `${String(decision.warehouseName || decision.routeType || decision.status || "Route")}: ${String(decision.reason || "Selected")}`).join("; ")
        : considered.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null).map((row) => `${String(row.warehouseName || row.warehouseId || "Warehouse")}: ${String(row.reason || row.decision || "considered")}`).join("; ")
      const warehouseText = considered.map((row) => typeof row === "string" ? row : String(row.warehouseName || row.warehouseId || "Warehouse")).join(", ")
      return <TableRow key={String(entry.id || `${entry.sku || "line"}-${index}`)}><TableCell className="font-medium">{String(entry.sku || "-")}</TableCell><TableCell>{String(entry.channel || "Direct")}</TableCell><TableCell>{String(entry.ruleName || "Default priority")}</TableCell><TableCell className="max-w-72"><p className="truncate" title={warehouseText}>{warehouseText || "No eligible warehouse"}</p></TableCell><TableCell className="min-w-80 text-sm text-muted-foreground">{decisionText || "Routing evaluated; no detailed decision was retained."}</TableCell></TableRow>
    })}{!routingExplanations.length && <TableRow><TableCell colSpan={5} className="h-20 text-center text-muted-foreground">Routing details appear after the order is evaluated.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
  </div>
}

export function OrderActivityTimeline({ order }: { order: Record<string, unknown> }) {
  const [filter, setFilter] = useState("all")
  const workflow = Array.isArray(order.workflowHistory) ? order.workflowHistory as Array<Record<string, unknown>> : []
  const timeline = Array.isArray(order.timeline) ? order.timeline as Array<Record<string, unknown>> : []
  const events = [...workflow, ...timeline].filter((event, index, all) => {
    const id = String(event.id || `${event.createdAt}-${event.title}-${event.message}`)
    return all.findIndex((candidate) => String(candidate.id || `${candidate.createdAt}-${candidate.title}-${candidate.message}`) === id) === index
  }).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
  const eventKind = (event: Record<string, unknown>) => {
    const value = String(event.type || event.step || "workflow").toLowerCase()
    if (value.includes("note")) return "Notes"
    if (value.includes("purchase") || value.includes("po_")) return "Purchasing"
    if (value.includes("fulfill") || value.includes("shipment") || value.includes("pick") || value.includes("shipping")) return "Fulfillment"
    if (value.includes("payment") || value.includes("refund")) return "Finance"
    if (value.includes("channel") || value.includes("sync") || value.includes("import") || value === "created") return "Channel"
    return "Workflow"
  }
  const kinds = ["all", ...Array.from(new Set(events.map(eventKind)))]
  const visibleEvents = filter === "all" ? events : events.filter((event) => eventKind(event) === filter)
  const dayLabel = (value: unknown) => {
    const date = new Date(String(value || ""))
    return Number.isNaN(date.getTime()) ? "Undated activity" : date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" })
  }
  const grouped = visibleEvents.reduce<Array<{ day: string; events: Array<Record<string, unknown>> }>>((groups, event) => {
    const day = dayLabel(event.createdAt)
    const group = groups.find((entry) => entry.day === day)
    if (group) group.events.push(event)
    else groups.push({ day, events: [event] })
    return groups
  }, [])
  const tone = (kind: string) => kind === "Notes" ? "bg-amber-500" : kind === "Purchasing" ? "bg-violet-500" : kind === "Fulfillment" ? "bg-emerald-500" : kind === "Finance" ? "bg-sky-500" : kind === "Channel" ? "bg-primary" : "bg-slate-500"
  return <div className="grid gap-4"><Card><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-medium">Order activity</p><p className="text-sm text-muted-foreground">A permanent record of imports, operational decisions, fulfillment, purchasing, and notes.</p></div><Badge variant="outline">{numberLabel(events.length)} event{events.length === 1 ? "" : "s"}</Badge></CardContent></Card><div className="flex flex-wrap gap-2">{kinds.map((kind) => <Button key={kind} size="sm" variant={filter === kind ? "default" : "outline"} onClick={() => setFilter(kind)}>{kind === "all" ? `All (${events.length})` : kind}</Button>)}</div><div className="grid gap-5">{grouped.map((group) => <section key={group.day}><p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.day}</p><div className="relative grid gap-3 before:absolute before:bottom-3 before:left-[5px] before:top-3 before:w-px before:bg-border">{group.events.map((event) => { const kind = eventKind(event); return <div key={String(event.id || `${event.createdAt}-${event.title}`)} className="relative grid grid-cols-[12px_minmax(0,1fr)] gap-3"><div className={`z-10 mt-4 size-2.5 rounded-full ring-4 ring-background ${tone(kind)}`} /><div className="rounded-md border bg-card p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-2"><p className="truncate font-medium">{String(event.title || event.step || event.type || "Order event")}</p><Badge variant="outline" className="shrink-0 text-[10px]">{kind}</Badge></div><span className="shrink-0 text-xs text-muted-foreground">{dateLabel(String(event.createdAt || ""))}</span></div>{Boolean(event.message) && <p className="mt-1 text-muted-foreground">{String(event.message)}</p>}{Boolean(event.user) && <p className="mt-2 text-xs text-muted-foreground">By {String(event.user)}</p>}</div></div> })}</div></section>)}{!visibleEvents.length && <Card><CardContent className="p-5 text-sm text-muted-foreground">No {filter === "all" ? "operational activity" : filter.toLowerCase()} events recorded yet.</CardContent></Card>}</div></div>
}

type MentionableUser = { id: string; username: string; name: string; department?: string; avatarUrl?: string }

function MentionText({ text }: { text: string }) {
  const parts = text.split(/(@[a-z0-9][a-z0-9._-]{0,63})/gi)
  return <>{parts.map((part, index) => /^@[a-z0-9][a-z0-9._-]{0,63}$/i.test(part) ? <strong key={`${part}-${index}`} className="font-semibold text-primary">{part}</strong> : part)}</>
}

export function OrderNotesPanel({ orderId, order, documents, onUpdated }: { orderId: string; order: Record<string, unknown>; documents: Array<Record<string, unknown>>; onUpdated: () => Promise<void> }) {
  const [text, setText] = useState("")
  const [saving, setSaving] = useState(false)
  const [attachment, setAttachment] = useState<File | null>(null)
  const [mentionUsers, setMentionUsers] = useState<MentionableUser[]>([])
  const [mentionLoading, setMentionLoading] = useState(false)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [caret, setCaret] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const notes = Array.isArray(order.orderNotes) ? order.orderNotes as Array<Record<string, unknown>> : []
  const mentionToken = text.slice(0, caret).match(/(^|\s)@([a-z0-9._-]*)$/i)
  const mentionQuery = String(mentionToken?.[2] || "").toLowerCase()
  const mentionSuggestions = mentionToken
    ? mentionUsers.filter((user) => `${user.username} ${user.name}`.toLowerCase().includes(mentionQuery)).slice(0, 8)
    : []
  const loadMentionUsers = async () => {
    if (mentionUsers.length || mentionLoading) return
    setMentionLoading(true)
    try {
      const result = await api<{ users: MentionableUser[] }>("/api/mentions/users")
      setMentionUsers(result.users || [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load teammates for mentions.")
    } finally { setMentionLoading(false) }
  }
  const insertMention = (user: MentionableUser) => {
    if (!mentionToken) return
    const tokenStart = caret - mentionToken[0].length + mentionToken[1].length
    const next = `${text.slice(0, tokenStart)}@${user.username} ${text.slice(caret)}`
    const nextCaret = tokenStart + user.username.length + 2
    setText(next)
    setCaret(nextCaret)
    setMentionIndex(0)
    window.requestAnimationFrame(() => { textareaRef.current?.focus(); textareaRef.current?.setSelectionRange(nextCaret, nextCaret) })
  }
  const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || "")); reader.onerror = () => reject(new Error("The selected file could not be read.")); reader.readAsDataURL(file) })
  const save = async () => {
    if (!text.trim() && !attachment) return toast.error("Enter a note or attach a document before saving.")
    if (attachment && attachment.size > 15 * 1024 * 1024) return toast.error("Attachments must be 15 MB or smaller.")
    setSaving(true)
    try {
      const noteResult = text.trim() ? await api<{ note?: Record<string, unknown>; mentions?: Array<Record<string, unknown>>; mentionWarning?: string }>(`/api/orders/${encodeURIComponent(orderId)}/notes`, { method: "POST", body: JSON.stringify({ text: text.trim() }) }) : null
      if (attachment) await api(`/api/orders/${encodeURIComponent(orderId)}/attachments`, { method: "POST", body: JSON.stringify({ name: attachment.name, mimeType: attachment.type, contentBase64: await fileToBase64(attachment), type: "customer-message", note: text.trim(), noteId: String(noteResult?.note?.id || "") }) })
      setText("")
      setAttachment(null)
      await onUpdated()
      if (noteResult?.mentions?.length) {
        window.dispatchEvent(new CustomEvent("dataplus:mentions-changed"))
        window.dispatchEvent(new CustomEvent("dataplus:notifications-changed"))
      }
      if (noteResult?.mentionWarning) toast.warning(noteResult.mentionWarning)
      else toast.success(noteResult?.mentions?.length ? `Note saved and ${noteResult.mentions.length} teammate${noteResult.mentions.length === 1 ? " was" : "s were"} notified.` : attachment ? "Note and attachment added to this order." : "Internal order note added.")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save the order note.") } finally { setSaving(false) }
  }
  const attachmentsForNote = (note: Record<string, unknown>) => documents.filter((document) => String(document.noteId || "") === String(note.id || "") || (!document.noteId && String(document.note || "").trim() === String(note.text || "").trim()))
  return <div className="grid gap-4"><Card><CardHeader><CardTitle className="text-sm">Add internal note</CardTitle><CardDescription>Use @username to assign a follow-up. The teammate receives a private notification and the conversation remains in this order's Activity log.</CardDescription></CardHeader><CardContent className="grid gap-3"><div className="relative"><Textarea ref={textareaRef} className="min-h-28" value={text} onFocus={() => void loadMentionUsers()} onClick={(event) => setCaret(event.currentTarget.selectionStart)} onKeyUp={(event) => setCaret(event.currentTarget.selectionStart)} onChange={(event) => { setText(event.target.value); setCaret(event.target.selectionStart); setMentionIndex(0) }} onKeyDown={(event) => { if (!mentionSuggestions.length) return; if (event.key === "ArrowDown") { event.preventDefault(); setMentionIndex((current) => (current + 1) % mentionSuggestions.length) } else if (event.key === "ArrowUp") { event.preventDefault(); setMentionIndex((current) => (current - 1 + mentionSuggestions.length) % mentionSuggestions.length) } else if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); insertMention(mentionSuggestions[mentionIndex] || mentionSuggestions[0]) } else if (event.key === "Escape") { setCaret(-1) } }} placeholder="Add context or type @username to assign a follow-up..." />{mentionToken && (mentionSuggestions.length || mentionLoading) ? <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">{mentionLoading ? <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading teammates...</div> : mentionSuggestions.map((user, index) => <button key={user.id} type="button" className={`flex w-full items-center justify-between gap-3 rounded-sm px-3 py-2 text-left text-sm ${index === mentionIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"}`} onMouseDown={(event) => { event.preventDefault(); insertMention(user) }}><span className="min-w-0"><span className="block truncate font-medium">{user.name}</span><span className="block truncate text-xs text-muted-foreground">@{user.username}</span></span>{user.department ? <span className="shrink-0 text-xs text-muted-foreground">{user.department}</span> : null}</button>)}</div> : null}</div><div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/25 p-3"><div className="min-w-0"><p className="text-sm font-medium">Attach document</p><p className="text-xs text-muted-foreground">PDF, CSV, text, or photo up to 15 MB.</p></div><Input className="max-w-full sm:max-w-xs" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,text/plain,text/csv" capture="environment" onChange={(event) => setAttachment(event.target.files?.[0] || null)} />{attachment && <p className="w-full text-xs text-muted-foreground">Ready to attach: {attachment.name}</p>}</div><div className="flex justify-end"><Button size="sm" disabled={saving || (!text.trim() && !attachment)} onClick={() => void save()}>{saving && <Loader2 className="size-4 animate-spin" />} {attachment ? "Save note & attachment" : "Save note"}</Button></div></CardContent></Card><Card><CardHeader><CardTitle className="text-sm">Internal notes</CardTitle><CardDescription>{notes.length ? `${numberLabel(notes.length)} note${notes.length === 1 ? "" : "s"} on this order.` : "No standalone internal notes yet."}</CardDescription></CardHeader><CardContent className="grid gap-3">{notes.map((note) => { const noteAttachments = attachmentsForNote(note); return <div key={String(note.id)} className="rounded-md border p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{String(note.createdBy || "DataPlus user")}</span><span className="text-xs text-muted-foreground">{dateLabel(String(note.createdAt || ""))}</span></div><p className="mt-2 whitespace-pre-wrap text-muted-foreground"><MentionText text={String(note.text || "")} /></p>{noteAttachments.length > 0 && <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">{noteAttachments.map((document) => <a key={String(document.id)} href={String(document.url || "#")} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-muted/30 px-2 py-1 text-xs font-medium hover:bg-muted"><FileText className="size-3.5 shrink-0" /><span className="truncate">{String(document.name || "Attachment")}</span></a>)}</div>}</div> })}{!notes.length && <p className="text-sm text-muted-foreground">Use the form above to add the first internal note.</p>}</CardContent></Card></div>
}

function marketplaceReferenceValue(references: Array<Record<string, unknown>>, ...types: string[]) {
  const normalizedTypes = types.map((type) => type.toLowerCase().replace(/[^a-z0-9]+/g, ""))
  const reference = references.find((entry) => normalizedTypes.includes(String(entry.type || "").toLowerCase().replace(/[^a-z0-9]+/g, "")))
  return String(reference?.value || "").trim()
}

export function walmartOrderIdentifiers(order: Record<string, unknown>, references: Array<Record<string, unknown>> = []) {
  const external = (order.external || {}) as Record<string, unknown>
  const purchaseOrderId = String(external.purchaseOrderId || marketplaceReferenceValue(references, "purchaseOrderId", "walmartPurchaseOrderId") || order.marketplaceOrderNumber || order.marketplaceOrderId || "").trim()
  const channelOrderId = String(external.customerOrderId || marketplaceReferenceValue(references, "customerOrderId", "walmartCustomerOrderId") || "").trim()
  return { purchaseOrderId, channelOrderId }
}

export function channelOrderNumberFor(order: Record<string, unknown>, references: Array<Record<string, unknown>> = []) {
  const external = (order.external || {}) as Record<string, unknown>
  return marketplaceReferenceValue(references, "parent_order", "order")
    || String(order.marketplaceOrderNumber || order.marketplaceOrderId || order.channelOrderNumber || order.externalOrderId || external.parentOrderSn || external.orderId || "")
}

export function channelOrderUrlFor(order: Record<string, unknown>, channelOrderNumber = "", shopifyAdminUrl = "") {
  const source = String(order.source || order.channelSource || "").trim().toLowerCase()
  const orderNumber = String(channelOrderNumber || order.marketplaceOrderNumber || order.marketplaceOrderId || "").trim()
  const external = (order.external || {}) as Record<string, unknown>
  const savedUrl = String(order.channelOrderUrl || order.marketplaceOrderUrl || order.adminUrl || external.orderUrl || "").trim()
  if (/^https?:\/\//i.test(savedUrl)) return savedUrl
  if (!orderNumber) return ""
  if (source === "temu") return `https://seller.temu.com/order-detail.html?parent_order_sn=${encodeURIComponent(orderNumber)}`
  if (source === "ebay") return `https://www.ebay.com/sh/ord/details?orderid=${encodeURIComponent(orderNumber)}`
  if (source === "walmart") return `https://seller.walmart.com/orders/manage-orders?orderGroups=All&poNumber=${encodeURIComponent(orderNumber)}`
  if (source === "shopify") {
    if (shopifyAdminUrl) return shopifyAdminUrl
    const rawId = String(order.shopifyOrderId || order.marketplaceOrderId || orderNumber)
    const legacyId = rawId.match(/Order\/(\d+)/)?.[1] || rawId.match(/(\d{6,})/)?.[1] || ""
    return legacyId ? `https://admin.shopify.com/orders/${encodeURIComponent(legacyId)}` : ""
  }
  return ""
}

function ChannelOrderLinkDetail({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <div className="rounded-md border bg-background p-2">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 break-all font-medium text-primary hover:underline">
          <span>{value}</span>
          <ExternalLink className="size-3.5 shrink-0" />
        </a>
      ) : <p className="break-words font-medium">{value}</p>}
    </div>
  )
}

export function OrderChannelHeaderReferences({ order, references, href }: { order: Record<string, unknown>; references: Array<Record<string, unknown>>; href: string }) {
  const source = String(order.source || order.channelSource || "the sales channel")
  const isWalmart = source.trim().toLowerCase() === "walmart"
  if (isWalmart) {
    const identifiers = walmartOrderIdentifiers(order, references)
    return <>{[
      { label: "Walmart order ID", value: identifiers.channelOrderId, hint: "Open Walmart Seller Center and locate this order using its PO number." },
      { label: "Walmart PO", value: identifiers.purchaseOrderId, hint: "Open Walmart Seller Center and search this purchase order number." }
    ].filter((entry) => entry.value).map((entry) => <Tooltip key={entry.label}><TooltipTrigger asChild><a href={href} target="_blank" rel="noreferrer"><Badge variant="outline" className="max-w-full cursor-pointer gap-1 font-mono text-xs hover:bg-muted"><span className="font-sans">{entry.label}</span> <span className="break-all">{entry.value}</span><ExternalLink className="size-3 shrink-0" /></Badge></a></TooltipTrigger><TooltipContent>{entry.hint}</TooltipContent></Tooltip>)}</>
  }
  const channelOrderNumber = channelOrderNumberFor(order, references)
  if (!channelOrderNumber) return null
  return <Tooltip><TooltipTrigger asChild>{href ? <a href={href} target="_blank" rel="noreferrer"><Badge variant="outline" className="max-w-full cursor-pointer gap-1 font-mono text-xs hover:bg-muted"><span className="font-sans">Channel order</span> <span className="break-all">{channelOrderNumber}</span><ExternalLink className="size-3 shrink-0" /></Badge></a> : <Badge variant="outline" className="max-w-full gap-1 font-mono text-xs"><span className="font-sans">Channel order</span> <span className="break-all">{channelOrderNumber}</span></Badge>}</TooltipTrigger><TooltipContent>{href ? `Open this order in ${source}.` : `Marketplace order number from ${source}.`}</TooltipContent></Tooltip>
}

export function purchaseOrderChannelReferenceUrl(reference: Record<string, unknown>) {
  const orderId = String(reference.orderId || "").trim()
  const channelOrderNumber = String(reference.channelOrderNumber || "").trim()
  return channelOrderUrlFor({
    source: reference.channel,
    marketplaceOrderNumber: channelOrderNumber,
    channelOrderUrl: reference.channelOrderUrl
  }, channelOrderNumber, String(reference.channelOrderUrl || "")) || (orderId ? `/orders/${encodeURIComponent(orderId)}` : "")
}

type FulfillmentCarrierService = { id: string; name: string; enabled: boolean }
type FulfillmentCarrier = { id: string; name: string; enabled: boolean; trackingUrlTemplate?: string; phone?: string; services: FulfillmentCarrierService[] }

export function useFulfillmentCarriers() {
  const [carriers, setCarriers] = useState<FulfillmentCarrier[]>([])
  useEffect(() => {
    let cancelled = false
    void api<{ carriers?: FulfillmentCarrier[] }>("/api/fulfillment/carriers")
      .then((result) => { if (!cancelled) setCarriers(result.carriers || []) })
      .catch(() => { if (!cancelled) setCarriers([]) })
    return () => { cancelled = true }
  }, [])
  return carriers
}

export function enabledCarrierNames(carriers: FulfillmentCarrier[], current = "") {
  const names = carriers.length ? carriers.filter((carrier) => carrier.enabled).map((carrier) => carrier.name) : shipmentTrackingCarriers.filter((carrier) => carrier !== "Other")
  if (current && current !== "Other" && !names.some((name) => name.toLowerCase() === current.toLowerCase())) names.unshift(current)
  return [...new Set([...names, "Other"])]
}

export function enabledCarrierServices(carriers: FulfillmentCarrier[], carrierName: string, current = "") {
  const carrier = carriers.find((entry) => entry.name.toLowerCase() === carrierName.toLowerCase())
  const services = carrier?.services.filter((service) => service.enabled).map((service) => service.name) || []
  if (current && !services.some((service) => service.toLowerCase() === current.toLowerCase())) services.unshift(current)
  return [...new Set(services)]
}

export function detectTrackingCarrier(trackingNumber = "") {
  const tracking = trackingNumber.trim().toUpperCase().replace(/[\s-]+/g, "")
  if (/^1Z[0-9A-Z]{10,}$/.test(tracking)) return "UPS"
  if (/^(?:9[23456]|82)\d{18,20}$/.test(tracking) || /^[A-Z]{2}\d{9}US$/.test(tracking)) return "USPS"
  if (/^(?:\d{12}|\d{15})$/.test(tracking)) return "FedEx"
  if (/^(?:GM|JVGL|JJD)\d{10,22}$/.test(tracking)) return "DHL"
  if (/^C\d{14}$/.test(tracking)) return "OnTrac"
  if (/^TB[AMCD]\d{8,}$/.test(tracking)) return "Amazon Shipping"
  if (/^(?:SPX|SPD)\d{8,}$/.test(tracking)) return "SpeedX"
  if (/^(?:GF\d{10,}|GOFO[0-9A-Z]{6,})$/.test(tracking)) return "GOFO"
  if (/^SWIFTX[0-9A-Z]{6,}$/.test(tracking)) return "SwiftX"
  return ""
}

export function detectedTrackingUpdate<T extends { carrier: string; service: string; trackingNumber: string }>(current: T, trackingNumber: string, carriers: FulfillmentCarrier[]) {
  const detected = detectTrackingCarrier(trackingNumber)
  if (!detected || detected.toLowerCase() === current.carrier.toLowerCase()) return { ...current, trackingNumber }
  const enabled = enabledCarrierNames(carriers).find((carrier) => carrier.toLowerCase() === detected.toLowerCase())
  if (!enabled) return { ...current, trackingNumber }
  const services = enabledCarrierServices(carriers, enabled)
  return { ...current, carrier: enabled, service: services.length === 1 ? services[0] : "", trackingNumber }
}

export function OrderChannelPanel({ order, lines, shipments, shopifyAdminUrl }: { order: Record<string, unknown>; lines: Array<Record<string, unknown>>; shipments: Array<Record<string, unknown>>; shopifyAdminUrl: string }) {
  const source = String(order.source || "Channel")
  const external = (order.external || {}) as Record<string, unknown>
  const financials = ((order.channelFinancials || external.channelFinancials || {}) as Record<string, unknown>)
  const references = Array.isArray(order.marketplaceReferences) ? order.marketplaceReferences as Array<Record<string, unknown>> : []
  const importWarnings = Array.isArray(external.importWarnings) ? external.importWarnings.map(String).filter(Boolean) : []
  const amountPermissionWarning = importWarnings.find((warning) => /amount .*api access|errorCode["']?:?3000032|access_token don't have this api access/i.test(warning))
  const shippingVisibilityWarning = importWarnings.find((warning) => /shipping .*current order status cannot be viewed|decrypt_shipping .*current order status cannot be viewed/i.test(warning))
  const channelOrderNumber = channelOrderNumberFor(order, references) || "-"
  const isWalmart = source.toLowerCase() === "walmart"
  const walmartIdentifiers = walmartOrderIdentifiers(order, references)
  const channelOrderUrl = channelOrderUrlFor(order, isWalmart ? walmartIdentifiers.purchaseOrderId : channelOrderNumber, shopifyAdminUrl)
  const financialValue = (...keys: string[]) => {
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(financials, key)) continue
      const value = Number(financials[key] || 0)
      if (Number.isFinite(value)) return moneyLabel(value)
    }
    return "-"
  }
  const lineMoney = (line: Record<string, unknown>, ...keys: string[]) => {
    const values = (line.channelFinancials || {}) as Record<string, unknown>
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(values, key)) continue
      const value = Number(values[key] || 0)
      if (Number.isFinite(value)) return moneyLabel(value)
    }
    return "-"
  }
  const isTemu = source.toLowerCase() === "temu"
  return <TabsContent value="channel" className="grid gap-4 pt-4">
    {isTemu && importWarnings.length > 0 && <Alert variant={amountPermissionWarning ? "destructive" : "default"}><AlertCircle className="size-4" /><AlertTitle>Temu returned partial order data</AlertTitle><AlertDescription className="grid gap-2"><p>{amountPermissionWarning ? "Temu is blocking the order amount/proceeds endpoint for the current access token, so base price, shipping proceeds, and estimated revenue will stay at $0.00 until the token is regenerated after approving that API." : "DataPlus imported the available Temu fields, but Temu did not return every optional order detail for this record."}</p>{shippingVisibilityWarning && <p>Shipping/customer details are incomplete because Temu said the current order status cannot be viewed for shipping information.</p>}<div className="grid gap-1 text-xs">{importWarnings.slice(0, 3).map((warning, index) => <p key={`${warning}-${index}`} className="break-words rounded-md border bg-background p-2 font-mono">{warning}</p>)}</div></AlertDescription></Alert>}
    <Card><CardHeader><CardTitle className="text-sm">{source} channel details</CardTitle><CardDescription>{isTemu ? "Temu reports seller proceeds and estimated revenue to DataPlus. The buyer's final checkout total is not available from the Temu order API." : "Marketplace order references and channel sync state for this order."}</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {isWalmart ? <>
        <ChannelOrderLinkDetail label="Walmart channel order ID" value={walmartIdentifiers.channelOrderId || "Not provided"} href={channelOrderUrl} />
        <ChannelOrderLinkDetail label="Walmart PO number" value={walmartIdentifiers.purchaseOrderId || "Not provided"} href={channelOrderUrl} />
      </> : <ChannelOrderLinkDetail label={isTemu ? "Temu PO / order number" : "Channel order number"} value={channelOrderNumber} href={channelOrderUrl} />}
      <Detail label="Integration" value={source} />
      <Detail label="Sales channel" value={String(order.channelSource || source || "-")} />
      <Detail label="Imported" value={dateLabel(String(order.importedAt || order.createdAt || ""))} />
      <Detail label="Last updated" value={dateLabel(String(order.updatedAt || ""))} />
      {isTemu && <><Detail label="Base price total" value={financialValue("basePriceTotal")} /><Detail label="Shipping proceeds" value={financialValue("shippingProceedsTotal")} /><Detail label="Estimated revenue" value={financialValue("estimatedRevenue")} /><Detail label="Customer paid" value={String(financials.customerPaidAvailable) === "true" ? moneyLabel(Number(order.total || 0)) : "Not exposed by Temu"} /></>}
    </CardContent></Card>
    {isTemu && <Card><CardHeader><CardTitle className="text-sm">Temu item financials</CardTitle><CardDescription>Line prices are imported as seller proceeds. Retail/customer-paid values are displayed only when Temu returns them.</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead>DataPlus SKU</TableHead><TableHead>Temu SKU ID</TableHead><TableHead>Order item ID</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Unit base</TableHead><TableHead className="text-right">Retail</TableHead><TableHead className="text-right">Shipping</TableHead><TableHead className="text-right">Revenue</TableHead></TableRow></TableHeader><TableBody>{lines.map((line, index) => <TableRow key={String(line.id || line.temuOrderItemId || `${line.sku}-${index}`)}><TableCell><p className="max-w-72 truncate font-medium">{String(line.title || "Temu item")}</p><p className="text-xs text-muted-foreground">Goods ID {String(line.temuGoodsId || line.channelProductId || "-")}</p></TableCell><TableCell>{String(line.sku || "-")}</TableCell><TableCell>{String(line.temuSkuId || line.channelVariantId || "-")}</TableCell><TableCell>{String(line.temuOrderItemId || line.channelOrderItemId || "-")}</TableCell><TableCell className="text-right">{numberLabel(Number(line.qty || 0))}</TableCell><TableCell className="text-right">{lineMoney(line, "unitBasePrice")}</TableCell><TableCell className="text-right">{lineMoney(line, "unitRetailPrice")}</TableCell><TableCell className="text-right">{lineMoney(line, "lineShippingProceeds")}</TableCell><TableCell className="text-right">{lineMoney(line, "lineEstimatedRevenue", "lineBaseSubtotal")}</TableCell></TableRow>)}{!lines.length && <TableRow><TableCell colSpan={9} className="h-20 text-center text-muted-foreground">No channel line details were imported yet.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>}
    <Card><CardHeader><CardTitle className="text-sm">Marketplace references</CardTitle><CardDescription>Identifiers retained from the channel import for matching, support, and shipment confirmation.</CardDescription></CardHeader><CardContent className="grid gap-2">{references.length ? references.map((reference, index) => <div key={`${String(reference.type || "reference")}-${String(reference.value || index)}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"><span className="font-medium">{String(reference.label || reference.type || "Reference")}</span><span className="font-mono text-xs text-muted-foreground">{String(reference.value || "-")}</span></div>) : <p className="text-sm text-muted-foreground">No marketplace references were retained for this order.</p>}</CardContent></Card>
    <Card><CardHeader><CardTitle className="text-sm">Channel delivery state</CardTitle><CardDescription>Local fulfillment is recorded immediately. Channel delivery remains visible until a connected channel confirms it.</CardDescription></CardHeader><CardContent className="grid gap-2">{shipments.length ? shipments.map((shipment) => { const sync = (shipment.channelSync || {}) as Record<string, unknown>; return <div key={String(shipment.id)} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"><span>{String(shipment.trackingNumber || "Shipment")}</span><Badge variant={String(sync.status || "").toLowerCase() === "pending" ? "secondary" : "outline"}>{String(sync.status || "Local only")}</Badge></div> }) : <p className="text-sm text-muted-foreground">No fulfillment is ready for channel sync.</p>}</CardContent></Card>
    {shopifyAdminUrl && <a href={shopifyAdminUrl} target="_blank" rel="noreferrer" className="w-fit text-sm text-primary hover:underline">Open order in Shopify</a>}
  </TabsContent>
}

export function OrderDetailPage() {
  const orderId = decodeURIComponent((window.location.pathname.split("/")[2] || "").trim())
  const cacheKey = `orders:detail:${orderId}`
  const cachedOrder = readWorkspaceCache<Record<string, unknown> | null>(cacheKey)
  const [order, setOrder] = useState<Record<string, unknown> | null>(cachedOrder)
  const [loading, setLoading] = useState(!cachedOrder)
  async function load() { if (!order) setLoading(true); try { const result = await api<{ order?: Record<string, unknown> }>(`/api/orders/${encodeURIComponent(orderId)}`); const nextOrder = result.order || null; setOrder(nextOrder); writeWorkspaceCache(cacheKey, nextOrder) } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load order.") } finally { setLoading(false) } }
  useEffect(() => { void load() }, [orderId])
  useEffect(() => { const refresh = () => void load(); window.addEventListener("dataplus:order-updated", refresh); return () => window.removeEventListener("dataplus:order-updated", refresh) }, [orderId])
  const items = Array.isArray(order?.items) ? order.items as Array<Record<string, unknown>> : []
  const shipments = Array.isArray(order?.shipments) ? order.shipments as Array<Record<string, unknown>> : []
  const payments = Array.isArray(order?.payments) ? order.payments as Array<Record<string, unknown>> : []
  const events = Array.isArray(order?.workflowHistory) ? order.workflowHistory as Array<Record<string, unknown>> : []
  return <div className="grid gap-5"><PageHeader eyebrow="Operations / Order" title={String(order?.orderNumber || orderId || "Order")} description="Order lines, allocation, fulfillment, payments, and workflow activity in one record." action={<div className="flex gap-2"><Button size="sm" variant="outline" asChild><a href="/orders">Back to orders</a></Button><Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh</Button></div>} />{loading ? <div className="grid gap-3"><Skeleton className="h-32" /><Skeleton className="h-56" /></div> : !order ? <Card><CardContent className="p-8 text-center text-muted-foreground">This order was not found.</CardContent></Card> : <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Detail label="Status" value={String(order.status || "New")} /><Detail label="Allocation" value={String(order.allocationStatus || "Not allocated")} /><Detail label="Total" value={moneyLabel(Number(order.total || 0))} /><Detail label="Channel" value={String(order.channel || order.source || "-")} /></div><Tabs defaultValue="overview"><TabsList><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="shipments">Shipments ({shipments.length})</TabsTrigger><TabsTrigger value="payments">Payments ({payments.length})</TabsTrigger><TabsTrigger value="workflow">Workflow ({events.length})</TabsTrigger></TabsList><TabsContent value="overview" className="pt-4"><Card><CardHeader><CardTitle className="text-sm">Order lines</CardTitle><CardDescription>{String(order.buyer || order.customerName || order.buyerEmail || "No customer recorded")}</CardDescription></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Item</TableHead><TableHead>Qty</TableHead><TableHead>Price</TableHead></TableRow></TableHeader><TableBody>{items.map((line, index) => <TableRow key={`${String(line.sku)}-${index}`}><TableCell className="font-medium">{String(line.sku || "-")}</TableCell><TableCell>{String(line.title || "-")}</TableCell><TableCell>{String(line.qty || 0)}</TableCell><TableCell>{moneyLabel(Number(line.price || 0))}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card></TabsContent><TabsContent value="shipments" className="grid gap-3 pt-4">{shipments.map((shipment) => <Card key={String(shipment.id)}><CardContent className="p-4 text-sm"><div className="font-medium">{String(shipment.warehouseName || "Unassigned warehouse")} · {String(shipment.status || "Allocated")}</div><div className="mt-1 text-muted-foreground">{String(shipment.carrierName || shipment.service || "No carrier")} {String(shipment.trackingNumber || "")}</div></CardContent></Card>)}{!shipments.length && <Card><CardContent className="p-5 text-sm text-muted-foreground">No shipments have been allocated.</CardContent></Card>}</TabsContent><TabsContent value="payments" className="grid gap-3 pt-4">{payments.map((payment) => <Card key={String(payment.id)}><CardContent className="flex justify-between p-4 text-sm"><span>{String(payment.provider || "Manual")} · {moneyLabel(Number(payment.amount || 0))}</span><Badge>{String(payment.status || "authorized")}</Badge></CardContent></Card>)}{!payments.length && <Card><CardContent className="p-5 text-sm text-muted-foreground">No payment events recorded.</CardContent></Card>}</TabsContent><TabsContent value="workflow" className="grid gap-3 pt-4">{events.map((event) => <Card key={String(event.id)}><CardContent className="p-4 text-sm"><div className="font-medium">{String(event.title || event.step || "Workflow event")}</div><div className="mt-1 text-muted-foreground">{String(event.message || "")} · {dateLabel(String(event.createdAt || ""))}</div></CardContent></Card>)}{!events.length && <Card><CardContent className="p-5 text-sm text-muted-foreground">No workflow activity recorded.</CardContent></Card>}</TabsContent></Tabs></>}</div>
}

export function LegacyOperationsPage() {
  const initial = window.location.pathname.startsWith("/returns") ? "returns" : window.location.pathname.startsWith("/drafts") ? "drafts" : "orders"
  const [tab, setTab] = useState(initial)
  const [data, setData] = useState<{ orders?: Array<Record<string, unknown>>; orderDrafts?: Array<Record<string, unknown>>; returns?: Array<Record<string, unknown>> }>({})
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null)
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null)
  const [busy, setBusy] = useState(false)
  async function load() { setLoading(true); try { setData(await api("/api/orders?limit=5000")) } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load operations data.") } finally { setLoading(false) } }
  async function importShopifyOrders() { setBusy(true); try { const result = await api<{ queued?: boolean; duplicate?: boolean; imported?: number; message?: string }>("/api/shopify/orders/import", { method: "POST", body: JSON.stringify({ limit: 250 }) }); toast.success(result.message || (result.queued ? "Shopify order import queued. Follow progress in Jobs." : `${numberLabel(result.imported)} Shopify orders imported.`)); if (!result.queued) await load() } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to import Shopify orders.") } finally { setBusy(false) } }
  useEffect(() => { void load() }, [])
  useEffect(() => {
    const handleAction = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action
      if (action === "import-shopify") void importShopifyOrders()
      if (action === "refresh") void load()
    }
    window.addEventListener("dataplus:operations-action", handleAction)
    return () => window.removeEventListener("dataplus:operations-action", handleAction)
  }, [])
  async function openOrder(row: Record<string, unknown>) { setSelected(row); setDetail(null); try { const result = await api<{ order?: Record<string, unknown> }>(`/api/orders/${encodeURIComponent(String(row.id || row.orderNumber || ""))}`); setDetail(result.order || row) } catch { setDetail(row) } }
  async function command(path: string, body: Record<string, unknown> = {}) { if (!selected) return; setBusy(true); try { const result = await api<{ order?: Record<string, unknown>; message?: string }>(path, { method: "POST", body: JSON.stringify(body) }); setDetail(result.order || detail); toast.success(result.message || "Order workflow updated."); await load() } catch (error) { toast.error(error instanceof Error ? error.message : "Order action failed.") } finally { setBusy(false) } }
  const rows: Array<Record<string, unknown> & { customer?: { name?: string } }> = tab === "orders" ? data.orders || [] : tab === "drafts" ? data.orderDrafts || [] : data.returns || []
  const filtered = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(query.toLowerCase()))
  const title = tab === "orders" ? "Orders" : tab === "drafts" ? "Draft orders" : "Returns"
  const current = detail || selected
  const shipments = Array.isArray(current?.shipments) ? current.shipments as Array<Record<string, unknown>> : []
  const payments = Array.isArray(current?.payments) ? current.payments as Array<Record<string, unknown>> : []
  const workflow = Array.isArray(current?.workflowHistory) ? current.workflowHistory as Array<Record<string, unknown>> : []
  return <div className="grid gap-5"><PageHeader eyebrow="Operations" title={title} description="Integration identifies where we imported the order; sales channel identifies where the customer actually bought it." action={<div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy || loading} onClick={() => void importShopifyOrders()}><Store className="size-4" /> Import Shopify orders</Button><Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh</Button></div>} /><Tabs value={tab} onValueChange={(next) => { setTab(next); window.history.replaceState({}, "", next === "orders" ? "/orders" : `/${next}`) }}><TabsList><TabsTrigger value="orders">Orders ({numberLabel(data.orders?.length)})</TabsTrigger><TabsTrigger value="drafts">Drafts ({numberLabel(data.orderDrafts?.length)})</TabsTrigger><TabsTrigger value="returns">Returns ({numberLabel(data.returns?.length)})</TabsTrigger></TabsList></Tabs><Card><CardHeader className="gap-3 border-b"><div className="relative max-w-lg"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${title.toLowerCase()}`} /></div><CardDescription>{numberLabel(filtered.length)} {title.toLowerCase()} shown. Source is the integration; sales channel is the storefront or marketplace.</CardDescription></CardHeader><CardContent className="p-0">{loading ? <div className="grid gap-2 p-4"><Skeleton className="h-12" /><Skeleton className="h-12" /></div> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Reference</TableHead><TableHead>Customer</TableHead><TableHead>Status</TableHead><TableHead>Allocation</TableHead><TableHead>Integration</TableHead><TableHead>Sales channel</TableHead><TableHead>Total</TableHead><TableHead>Updated</TableHead><TableHead /></TableRow></TableHeader><TableBody>{filtered.map((row, index) => { const reference = String(row.internalOrderNumber || row.orderNumber || row.reference || row.returnNumber || row.id || "-"); return <TableRow key={`${reference}-${index}`}><TableCell className="font-medium"><div className="group flex items-center gap-1"><a href={orderHref(row)} className="hover:underline">{reference}</a><Button size="icon" variant="ghost" className="size-7 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Quick view ${reference}`} title="Quick view" onClick={() => void openOrder(row)}><PackageSearch className="size-4" /></Button></div></TableCell><TableCell>{String(row.customerName || row.customer?.name || row.customerEmail || "-")}</TableCell><TableCell><Badge variant="outline">{String(row.status || row.returnStatus || "Draft")}</Badge></TableCell><TableCell>{row.allocationStatus ? <Badge variant="secondary">{String(row.allocationStatus)}</Badge> : "-"}</TableCell><TableCell>{String(row.source || "-")}</TableCell><TableCell>{String(row.channelSource || row.salesChannel || row.sourceChannel || "-")}</TableCell><TableCell>{moneyLabel(Number(row.total || row.refundAmount || 0))}</TableCell><TableCell>{dateLabel(String(row.updatedAt || row.createdAt || ""))}</TableCell><TableCell><Button size="sm" variant="outline" asChild><a href={orderHref(row)}>Open</a></Button></TableCell></TableRow>})}{!filtered.length && <TableRow><TableCell colSpan={9} className="h-28 text-center text-muted-foreground">No {title.toLowerCase()} are available.</TableCell></TableRow>}</TableBody></Table></div>}</CardContent></Card><Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}><SheetContent className="w-full overflow-y-auto sm:max-w-2xl"><SheetHeader><SheetTitle>{String(current?.internalOrderNumber || current?.orderNumber || current?.id || "Order")}</SheetTitle><SheetDescription>Shipment-first fulfillment keeps every allocation, movement, and payment visible on this record.</SheetDescription></SheetHeader>{!detail ? <div className="grid gap-2 py-6"><Skeleton className="h-20" /><Skeleton className="h-20" /></div> : <div className="grid gap-5 py-5"><div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy} onClick={() => void command(`/api/orders/${encodeURIComponent(String(selected?.id || ""))}/allocate`)}>Allocate inventory</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void command(`/api/orders/${encodeURIComponent(String(selected?.id || ""))}/backorder-po`)}>Create backorder PO</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void command(`/api/orders/${encodeURIComponent(String(selected?.id || ""))}/payments`, { amount: Number(current?.total || 0), status: "authorized", provider: "Manual" })}>Record payment</Button></div><Tabs defaultValue="shipments"><TabsList><TabsTrigger value="shipments">Shipments ({shipments.length})</TabsTrigger><TabsTrigger value="payments">Payments ({payments.length})</TabsTrigger><TabsTrigger value="workflow">Workflow ({workflow.length})</TabsTrigger><TabsTrigger value="backorders">Backorders</TabsTrigger></TabsList><TabsContent value="shipments" className="grid gap-2 pt-3">{shipments.map((shipment) => <Card key={String(shipment.id)}><CardContent className="grid gap-1 p-3 text-sm"><div className="font-medium">{String(shipment.warehouseName || "Unassigned warehouse")} <Badge variant="outline">{String(shipment.status || "allocated")}</Badge></div><div className="text-muted-foreground">{String(shipment.carrierName || shipment.service || "No carrier")} {String(shipment.trackingNumber || "")}</div></CardContent></Card>)}{!shipments.length && <p className="text-sm text-muted-foreground">Allocate this order to create shipment records.</p>}</TabsContent><TabsContent value="payments" className="grid gap-2 pt-3">{payments.map((payment) => <Card key={String(payment.id)}><CardContent className="flex items-center justify-between p-3 text-sm"><span>{String(payment.provider || "Manual")} · {moneyLabel(Number(payment.amount || 0))}</span><Badge>{String(payment.status || "authorized")}</Badge></CardContent></Card>)}{!payments.length && <p className="text-sm text-muted-foreground">No payment events have been recorded.</p>}</TabsContent><TabsContent value="workflow" className="grid gap-2 pt-3">{workflow.map((event) => <div key={String(event.id)} className="border-l-2 border-primary pl-3 text-sm"><div className="font-medium">{String(event.title || event.step || "Workflow event")}</div><div className="text-muted-foreground">{String(event.message || "")} · {dateLabel(String(event.createdAt || ""))}</div></div>)}{!workflow.length && <p className="text-sm text-muted-foreground">No workflow events yet.</p>}</TabsContent><TabsContent value="backorders" className="grid gap-2 pt-3">{(Array.isArray(current?.backorderLines) ? current.backorderLines as Array<Record<string, unknown>> : []).map((line, index) => <div key={`${String(line.sku)}-${index}`} className="rounded border p-3 text-sm">{String(line.sku)} · {String(line.qty)} · <Badge variant="secondary">{String(line.status)}</Badge></div>)}{!(Array.isArray(current?.backorderLines) && current.backorderLines.length) && <p className="text-sm text-muted-foreground">No backordered lines.</p>}</TabsContent></Tabs></div>}<SheetFooter><Button variant="outline" onClick={() => setSelected(null)}>Close</Button></SheetFooter></SheetContent></Sheet></div>
}

export function OrderListPreview({ order, orderId, reference, itemCount, hasPo, queue }: { order: Record<string, unknown>; orderId: string; reference: string; itemCount: number; hasPo: boolean; queue: string }) {
  const shipping = (order.shippingAddress || order.shipping_address || {}) as Record<string, unknown>
  const destination = [shipping.city, shipping.state || shipping.province, shipping.postalCode || shipping.zip].filter(Boolean).join(", ")
  const financialStatus = String(order.financialStatus || order.paymentStatus || "Unpaid")

  return <HoverCard openDelay={180} closeDelay={120}>
    <Tooltip><TooltipTrigger asChild><HoverCardTrigger asChild>
      <Button size="icon" variant="ghost" className="size-7 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Preview ${reference}`}>
        <PackageSearch className="size-4" />
      </Button>
    </HoverCardTrigger></TooltipTrigger><TooltipContent>Preview order</TooltipContent></Tooltip>
    <HoverCardContent align="start">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><p className="font-semibold">{reference}</p><p className="truncate text-xs text-muted-foreground">{String(order.buyer || order.customerName || order.customerEmail || "No customer")}</p></div>
        <Badge variant={financialStatus.toLowerCase() === "paid" ? "secondary" : "outline"}>{financialStatus}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-2 rounded-md border bg-muted/30 p-2 text-xs">
        <div><p className="text-muted-foreground">Workflow</p><p className="mt-0.5 font-medium capitalize">{queue.replace(/-/g, " ")}</p></div>
        <div><p className="text-muted-foreground">Items</p><p className="mt-0.5 font-medium">{numberLabel(itemCount)}</p></div>
        <div><p className="text-muted-foreground">Total</p><p className="mt-0.5 font-medium">{moneyLabel(Number(order.total || 0))}</p></div>
        <div><p className="text-muted-foreground">Supplier PO</p><p className="mt-0.5 font-medium">{hasPo ? "Linked" : "Not created"}</p></div>
      </div>
      <Collapsible className="text-xs text-muted-foreground"><CollapsibleTrigger asChild><Button className="h-auto px-0 py-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground" variant="ghost">More order context</Button></CollapsibleTrigger><CollapsibleContent className="grid gap-1 pt-2"><p>{String(order.channelSource || order.salesChannel || order.source || "Unclassified channel")}</p>{destination && <p>Ship to {destination}</p>}{Boolean(order.shipBy) && <p>Ship by {String(order.shipBy)}</p>}</CollapsibleContent></Collapsible>
      <Button size="sm" className="w-full" asChild><a href={`/orders/${encodeURIComponent(orderId || reference)}`}>Open full order</a></Button>
    </HoverCardContent>
  </HoverCard>
}

export function orderListSearchText(row: Record<string, unknown>) {
  const address = (row.address || row.shippingAddress || {}) as Record<string, unknown>
  const items = Array.isArray(row.items) ? row.items as Array<Record<string, unknown>> : []
  const shipments = Array.isArray(row.shipments) ? row.shipments as Array<Record<string, unknown>> : []
  return [
    row.orderNumber,
    row.reference,
    row.returnNumber,
    row.id,
    row.marketplaceOrderNumber,
    row.marketplaceOrderId,
    row.channelOrderNumber,
    row.channelOrderId,
    row.parentOrderSn,
    row.orderSn,
    row.externalOrderNumber,
    row.externalOrderId,
    row.trackingNumber,
    row.buyer,
    row.customerName,
    row.customerEmail,
    row.buyerEmail,
    row.source,
    row.channelSource,
    row.salesChannel,
    row.sourceChannel,
    row.salesOrigin,
    orderChannelFilterLabel(orderChannelFilterValue(row)),
    ...((row.ebayLive && typeof row.ebayLive === "object" && Array.isArray((row.ebayLive as Record<string, unknown>).eventIds)) ? ((row.ebayLive as Record<string, unknown>).eventIds as unknown[]) : []),
    row.status,
    row.returnStatus,
    address.name,
    address.line1,
    address.city,
    address.state,
    address.postalCode,
    ...items.slice(0, 12).flatMap((item) => [item.sku, item.title, item.originalSku, item.mappedSku]),
    ...shipments.slice(0, 12).flatMap((shipment) => [shipment.trackingNumber, shipment.tracking, shipment.carrier, shipment.service])
  ].filter(Boolean).join(" ").toLowerCase()
}

function DraftDetailPage() {
  const draftId = decodeURIComponent((window.location.pathname.split("/")[2] || "").trim())
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({ buyer: "", buyerEmail: "", phone: "", source: "Manual", note: "", line1: "", line2: "", city: "", state: "", postalCode: "", country: "US", items: [] as Array<{ sku: string; title: string; qty: string; price: string }> })
  const load = async () => {
    setLoading(true)
    try {
      const result = await api<{ draft?: Record<string, unknown> }>(`/api/order-drafts/${encodeURIComponent(draftId)}`)
      setDraft(result.draft || null)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load quote.") }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [draftId])
  const duplicate = async () => {
    setBusy(true)
    try { const result = await api<{ draft?: Record<string, unknown> }>(`/api/order-drafts/${encodeURIComponent(draftId)}/duplicate`, { method: "POST" }); toast.success("Quote duplicated."); const nextId = String(result.draft?.id || ""); if (nextId) window.location.href = `/drafts/${encodeURIComponent(nextId)}` }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to duplicate quote.") }
    finally { setBusy(false) }
  }
  const convert = async () => {
    setBusy(true)
    try { const result = await api<{ order?: Record<string, unknown> }>(`/api/order-drafts/${encodeURIComponent(draftId)}/convert`, { method: "POST", body: JSON.stringify({ user: "Luis" }) }); toast.success("Quote converted to an order."); if (result.order) window.location.href = orderHref(result.order) }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to convert quote.") }
    finally { setBusy(false) }
  }
  const beginEdit = () => {
    if (!draft) return
    const shipping = (draft.shippingAddress || {}) as Record<string, unknown>
    const items = Array.isArray(draft.items) ? draft.items as Array<Record<string, unknown>> : []
    setEditForm({ buyer: String(draft.buyer || ""), buyerEmail: String(draft.buyerEmail || ""), phone: String(draft.phone || ""), source: String(draft.source || "Manual"), note: String(draft.note || ""), line1: String(shipping.line1 || shipping.address1 || ""), line2: String(shipping.line2 || shipping.address2 || ""), city: String(shipping.city || ""), state: String(shipping.state || shipping.province || ""), postalCode: String(shipping.postalCode || shipping.zip || ""), country: String(shipping.country || "US"), items: items.map((item) => ({ sku: String(item.sku || ""), title: String(item.title || ""), qty: String(item.qty || 1), price: String(item.price || 0) })) })
    setEditOpen(true)
  }
  const saveEdit = async () => {
    const items = editForm.items.map((item) => ({ sku: item.sku.trim(), title: item.title.trim() || item.sku.trim(), qty: Number(item.qty || 0), price: Number(item.price || 0) })).filter((item) => item.sku && item.qty > 0)
    if (!editForm.buyer.trim() || !items.length) { toast.error("Customer name and at least one valid item are required."); return }
    setBusy(true)
    try {
      await api(`/api/order-drafts/${encodeURIComponent(draftId)}`, { method: "PATCH", body: JSON.stringify({ buyer: editForm.buyer.trim(), buyerEmail: editForm.buyerEmail.trim(), phone: editForm.phone.trim(), source: editForm.source, note: editForm.note.trim(), shippingAddress: { name: editForm.buyer.trim(), line1: editForm.line1.trim(), line2: editForm.line2.trim(), city: editForm.city.trim(), state: editForm.state.trim(), postalCode: editForm.postalCode.trim(), country: editForm.country.trim() }, items }) })
      setEditOpen(false); await load(); toast.success("Quote updated.")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update quote.") }
    finally { setBusy(false) }
  }
  const address = (draft?.shippingAddress || {}) as Record<string, unknown>
  const lines = Array.isArray(draft?.items) ? draft.items as Array<Record<string, unknown>> : []
  const subtotal = lines.reduce((total, line) => total + Number(line.price || 0) * Number(line.qty || 0), 0)
  const addressLines = [address.name, address.company, address.line1 || address.address1, address.line2 || address.address2, [address.city, address.state || address.province, address.postalCode || address.zip].filter(Boolean).join(", "), address.country].filter(Boolean).map(String)
  return <div className="grid gap-5"><PageHeader eyebrow="Operations / Draft quote" title={String(draft?.draftNumber || draftId || "Quote")} description="A customer proposal that remains editable until accepted and converted into an order." action={<div className="flex gap-2"><Button size="sm" variant="outline" asChild><a href="/drafts">Back to drafts</a></Button><Button size="sm" variant="outline" disabled={busy || !draft} onClick={beginEdit}><Pencil className="size-4" /> Edit</Button><DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" disabled={busy}><MoreHorizontal className="size-4" /> Actions</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => void load()}>Refresh</DropdownMenuItem><DropdownMenuItem onSelect={() => void duplicate()}>Duplicate quote</DropdownMenuItem><DropdownMenuItem onSelect={() => void convert()}>Convert to order</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem asChild><a href={`/api/order-drafts/${encodeURIComponent(draftId)}/export/pdf`} target="_blank" rel="noreferrer">Download quote</a></DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>} />{loading ? <div className="grid gap-3"><Skeleton className="h-36" /><Skeleton className="h-72" /></div> : !draft ? <Card><CardContent className="p-8 text-center text-muted-foreground">This draft quote was not found.</CardContent></Card> : <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Detail label="Customer" value={String(draft.buyer || "Not assigned")} /><Detail label="Status" value={String(draft.status || "draft")} /><Detail label="Quote total" value={moneyLabel(subtotal)} /><Detail label="Source" value={String(draft.source || "Manual")} /></div><div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.8fr)]"><Card><CardHeader><CardTitle className="text-base">Quote items</CardTitle><CardDescription>Pricing and local item costs captured for this quote.</CardDescription></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Item</TableHead><TableHead>Qty</TableHead><TableHead>Unit price</TableHead><TableHead>Total</TableHead></TableRow></TableHeader><TableBody>{lines.map((line, index) => <TableRow key={`${String(line.sku)}-${index}`}><TableCell className="font-mono text-xs">{String(line.sku || "-")}</TableCell><TableCell>{String(line.title || line.sku || "-")}</TableCell><TableCell>{numberLabel(Number(line.qty || 0))}</TableCell><TableCell>{moneyLabel(Number(line.price || 0))}</TableCell><TableCell className="font-medium">{moneyLabel(Number(line.price || 0) * Number(line.qty || 0))}</TableCell></TableRow>)}{!lines.length && <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No quote lines.</TableCell></TableRow>}</TableBody></Table></CardContent></Card><div className="grid content-start gap-4"><Card><CardHeader className="pb-3"><CardTitle className="text-sm">Customer & shipping</CardTitle></CardHeader><CardContent className="grid gap-3 text-sm"><div><p className="font-medium">Contact</p><p className="mt-1 text-muted-foreground">{String(draft.buyerEmail || "No email")}</p><p className="text-muted-foreground">{String(draft.phone || "No phone")}</p></div><div><p className="font-medium">Ship-to address</p>{addressLines.length ? <p className="mt-1 whitespace-pre-line text-muted-foreground">{addressLines.join("\n")}</p> : <p className="mt-1 text-muted-foreground">No shipping address has been added.</p>}</div></CardContent></Card><Card><CardHeader className="pb-3"><CardTitle className="text-sm">Quote notes</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{String(draft.note || "No internal notes.")}</CardContent></Card><Card><CardHeader className="pb-3"><CardTitle className="text-sm">Revision</CardTitle></CardHeader><CardContent className="grid gap-1 text-sm"><p>Revision {numberLabel(Number(draft.revisionNumber || 1))}</p><p className="text-muted-foreground">Created {dateLabel(String(draft.createdAt || ""))}</p><p className="text-muted-foreground">Updated {dateLabel(String(draft.updatedAt || draft.createdAt || ""))}</p></CardContent></Card></div></div></>}<Dialog open={editOpen} onOpenChange={setEditOpen}><DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto"><DialogHeader><DialogTitle>Edit draft quote</DialogTitle><DialogDescription>Changes remain local to this quote until it is converted into an order.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><Field label="Customer name"><Input value={editForm.buyer} onChange={(event) => setEditForm({ ...editForm, buyer: event.target.value })} /></Field><Field label="Customer email"><Input type="email" value={editForm.buyerEmail} onChange={(event) => setEditForm({ ...editForm, buyerEmail: event.target.value })} /></Field><Field label="Phone"><Input value={editForm.phone} onChange={(event) => setEditForm({ ...editForm, phone: event.target.value })} /></Field><Field label="Quote source"><Input value={editForm.source} onChange={(event) => setEditForm({ ...editForm, source: event.target.value })} /></Field></div><div className="grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-2"><p className="sm:col-span-2 text-sm font-medium">Ship-to address</p><Field label="Address line 1"><Input value={editForm.line1} onChange={(event) => setEditForm({ ...editForm, line1: event.target.value })} /></Field><Field label="Address line 2"><Input value={editForm.line2} onChange={(event) => setEditForm({ ...editForm, line2: event.target.value })} /></Field><Field label="City"><Input value={editForm.city} onChange={(event) => setEditForm({ ...editForm, city: event.target.value })} /></Field><Field label="State / province"><Input value={editForm.state} onChange={(event) => setEditForm({ ...editForm, state: event.target.value })} /></Field><Field label="Postal code"><Input value={editForm.postalCode} onChange={(event) => setEditForm({ ...editForm, postalCode: event.target.value })} /></Field><Field label="Country"><Input value={editForm.country} onChange={(event) => setEditForm({ ...editForm, country: event.target.value })} /></Field></div><div className="grid gap-2"><div className="flex items-center justify-between"><p className="text-sm font-medium">Quote items</p><Button size="sm" variant="outline" onClick={() => setEditForm({ ...editForm, items: [...editForm.items, { sku: "", title: "", qty: "1", price: "" }] })}>Add item</Button></div>{editForm.items.map((item, index) => <div key={`${item.sku}-${index}`} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1.4fr_90px_120px_auto]"><Input value={item.sku} onChange={(event) => setEditForm({ ...editForm, items: editForm.items.map((line, lineIndex) => lineIndex === index ? { ...line, sku: event.target.value } : line) })} placeholder="SKU" /><Input value={item.title} onChange={(event) => setEditForm({ ...editForm, items: editForm.items.map((line, lineIndex) => lineIndex === index ? { ...line, title: event.target.value } : line) })} placeholder="Product title" /><Input type="number" min="1" value={item.qty} onChange={(event) => setEditForm({ ...editForm, items: editForm.items.map((line, lineIndex) => lineIndex === index ? { ...line, qty: event.target.value } : line) })} /><Input type="number" min="0" step="0.01" value={item.price} onChange={(event) => setEditForm({ ...editForm, items: editForm.items.map((line, lineIndex) => lineIndex === index ? { ...line, price: event.target.value } : line) })} /><Button size="icon" variant="ghost" title="Remove item" disabled={editForm.items.length === 1} onClick={() => setEditForm({ ...editForm, items: editForm.items.filter((_, lineIndex) => lineIndex !== index) })}><Trash2 className="size-4" /></Button></div>)}</div><Field label="Internal note"><Textarea value={editForm.note} onChange={(event) => setEditForm({ ...editForm, note: event.target.value })} /></Field><DialogFooter><Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button><Button disabled={busy} onClick={() => void saveEdit()}><Save className="size-4" /> Save quote</Button></DialogFooter></DialogContent></Dialog></div>
}

void DraftDetailPage

function DraftDetailWorkspace() {
  const draftId = decodeURIComponent((window.location.pathname.split("/")[2] || "").trim())
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorTab, setEditorTab] = useState("items")
  const [catalogQuery, setCatalogQuery] = useState("")
  const [catalogResults, setCatalogResults] = useState<ProductItem[]>([])
  const [catalogSearching, setCatalogSearching] = useState(false)
  const [form, setForm] = useState({ buyer: "", buyerEmail: "", phone: "", source: "Manual", status: "draft", note: "", line1: "", line2: "", city: "", state: "", postalCode: "", country: "US", items: [] as Array<{ sku: string; title: string; qty: string; price: string }> })

  const load = async () => {
    setLoading(true)
    try {
      const result = await api<{ draft?: Record<string, unknown> }>(`/api/order-drafts/${encodeURIComponent(draftId)}`)
      setDraft(result.draft || null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load quote.")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [draftId])
  useEffect(() => {
    const query = catalogQuery.trim()
    if (!editorOpen || query.length < 2) { setCatalogResults([]); setCatalogSearching(false); return }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setCatalogSearching(true)
      api<{ inventory?: ProductItem[] }>(`/api/inventory?q=${encodeURIComponent(query)}&limit=8&fastPage=1`)
        .then((result) => { if (!cancelled) setCatalogResults(result.inventory || []) })
        .catch(() => { if (!cancelled) setCatalogResults([]) })
        .finally(() => { if (!cancelled) setCatalogSearching(false) })
    }, 180)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [catalogQuery, editorOpen])

  const openEditor = () => {
    if (!draft) return
    const address = (draft.shippingAddress || {}) as Record<string, unknown>
    const items = Array.isArray(draft.items) ? draft.items as Array<Record<string, unknown>> : []
    setForm({
      buyer: String(draft.buyer || ""), buyerEmail: String(draft.buyerEmail || ""), phone: String(draft.phone || ""), source: String(draft.source || "Manual"), status: String(draft.status || "draft"), note: String(draft.note || ""),
      line1: String(address.line1 || address.address1 || ""), line2: String(address.line2 || address.address2 || ""), city: String(address.city || ""), state: String(address.state || address.province || ""), postalCode: String(address.postalCode || address.zip || ""), country: String(address.country || "US"),
      items: items.map((item) => ({ sku: String(item.sku || ""), title: String(item.title || ""), qty: String(item.qty || 1), price: String(item.price || 0) })),
    })
    setEditorTab("items")
    setCatalogQuery("")
    setCatalogResults([])
    setEditorOpen(true)
  }
  const updateLine = (index: number, patch: Partial<{ sku: string; title: string; qty: string; price: string }>) => setForm((current) => ({ ...current, items: current.items.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line) }))
  const addCatalogItem = (item: ProductItem) => {
    const sku = String(item.sku || "").trim()
    if (!sku) return
    setForm((current) => {
      const lineIndex = current.items.findIndex((line) => line.sku.toLowerCase() === sku.toLowerCase())
      if (lineIndex >= 0) return { ...current, items: current.items.map((line, index) => index === lineIndex ? { ...line, qty: String(Math.max(1, Number(line.qty || 0)) + 1) } : line) }
      return { ...current, items: [...current.items, { sku, title: String(item.title || item.marketplaceTitle || sku), qty: "1", price: String(item.websitePrice ?? item.price ?? 0) }] }
    })
    setCatalogQuery("")
    setCatalogResults([])
    toast.success(`${sku} added to the quote.`)
  }
  const save = async () => {
    const items = form.items.map((item) => ({ sku: item.sku.trim(), title: item.title.trim() || item.sku.trim(), qty: Number(item.qty || 0), price: Number(item.price || 0) })).filter((item) => item.sku && item.qty > 0)
    if (!form.buyer.trim() || !items.length) { toast.error("Customer name and at least one valid item are required."); return }
    setBusy(true)
    try {
      await api(`/api/order-drafts/${encodeURIComponent(draftId)}`, { method: "PATCH", body: JSON.stringify({ buyer: form.buyer.trim(), buyerEmail: form.buyerEmail.trim(), phone: form.phone.trim(), source: form.source, note: form.note.trim(), shippingAddress: { name: form.buyer.trim(), line1: form.line1.trim(), line2: form.line2.trim(), city: form.city.trim(), state: form.state.trim(), postalCode: form.postalCode.trim(), country: form.country.trim() }, items }) })
      setEditorOpen(false)
      await load()
      toast.success("Quote updated.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update quote.")
    } finally { setBusy(false) }
  }
  const convert = async () => {
    setBusy(true)
    try {
      const result = await api<{ order?: Record<string, unknown> }>(`/api/order-drafts/${encodeURIComponent(draftId)}/convert`, { method: "POST", body: JSON.stringify({ user: "Luis" }) })
      const orderId = String(result.order?.id || "")
      toast.success("Quote converted to an order.")
      if (orderId) window.location.href = `/orders/${encodeURIComponent(orderId)}`
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to convert quote.") }
    finally { setBusy(false) }
  }

  const lines = Array.isArray(draft?.items) ? draft.items as Array<Record<string, unknown>> : []
  const total = lines.reduce((sum, line) => sum + Number(line.price || 0) * Number(line.qty || 0), 0)
  const address = (draft?.shippingAddress || {}) as Record<string, unknown>
  const addressText = [address.line1 || address.address1, address.line2 || address.address2, [address.city, address.state || address.province, address.postalCode || address.zip].filter(Boolean).join(", "), address.country].filter(Boolean).join("\n")
  return <div className="grid gap-5">
    <PageHeader eyebrow="Operations / Draft quote" title={String(draft?.draftNumber || draftId || "Quote")} description="A customer proposal that remains editable until accepted and converted into an order." action={<div className="flex gap-2"><Button size="sm" variant="outline" asChild><a href="/drafts">Back to drafts</a></Button><Button size="sm" variant="outline" disabled={busy || !draft} onClick={openEditor}><Pencil className="size-4" /> Edit</Button><DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" disabled={busy}><MoreHorizontal className="size-4" /> Actions</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => void load()}>Refresh</DropdownMenuItem><DropdownMenuItem onSelect={() => void convert()}>Convert to order</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem asChild><a href={`/api/order-drafts/${encodeURIComponent(draftId)}/export/pdf`} target="_blank" rel="noreferrer">Download quote</a></DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>} />
    {loading ? <div className="grid gap-3"><Skeleton className="h-36" /><Skeleton className="h-72" /></div> : !draft ? <Card><CardContent className="p-8 text-center text-muted-foreground">This draft quote was not found.</CardContent></Card> : <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Detail label="Customer" value={String(draft.buyer || "Not assigned")} /><Detail label="Status" value={String(draft.status || "draft")} /><Detail label="Quote total" value={moneyLabel(total)} /><Detail label="Source" value={String(draft.source || "Manual")} /></div><div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.8fr)]"><Card><CardHeader><CardTitle className="text-base">Quote items</CardTitle><CardDescription>Catalog lines, quantities, sell prices, and quote totals.</CardDescription></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Item</TableHead><TableHead>Qty</TableHead><TableHead>Unit price</TableHead><TableHead>Total</TableHead></TableRow></TableHeader><TableBody>{lines.map((line, index) => <TableRow key={`${String(line.sku)}-${index}`}><TableCell className="font-mono text-xs">{String(line.sku || "-")}</TableCell><TableCell>{String(line.title || line.sku || "-")}</TableCell><TableCell>{numberLabel(Number(line.qty || 0))}</TableCell><TableCell>{moneyLabel(Number(line.price || 0))}</TableCell><TableCell className="font-medium">{moneyLabel(Number(line.price || 0) * Number(line.qty || 0))}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card><div className="grid content-start gap-4"><Card><CardHeader className="pb-3"><CardTitle className="text-sm">Customer & shipping</CardTitle></CardHeader><CardContent className="grid gap-3 text-sm"><div><p className="font-medium">Contact</p><p className="mt-1 text-muted-foreground">{String(draft.buyerEmail || "No email")}</p><p className="text-muted-foreground">{String(draft.phone || "No phone")}</p></div><div><p className="font-medium">Ship-to address</p><p className="mt-1 whitespace-pre-line text-muted-foreground">{addressText || "No shipping address has been added."}</p></div></CardContent></Card><Card><CardHeader className="pb-3"><CardTitle className="text-sm">Internal notes</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{String(draft.note || "No internal notes.")}</CardContent></Card></div></div></>}
    <Dialog open={editorOpen} onOpenChange={setEditorOpen}><DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-6xl overflow-y-auto p-0"><DialogHeader className="border-b px-6 py-5"><DialogTitle>Edit draft quote</DialogTitle><DialogDescription>Build the quote from verified catalog records, then add customer and delivery details.</DialogDescription></DialogHeader><Tabs value={editorTab} onValueChange={setEditorTab} className="grid gap-0"><div className="border-b px-6"><TabsList className="h-12 bg-transparent p-0"><TabsTrigger value="items">Items ({form.items.length})</TabsTrigger><TabsTrigger value="customer">Customer</TabsTrigger><TabsTrigger value="shipping">Shipping</TabsTrigger><TabsTrigger value="notes">Notes</TabsTrigger></TabsList></div><TabsContent value="items" className="m-0 grid gap-5 p-6"><div className="rounded-md border bg-muted/20 p-4"><div className="mb-3 flex items-center gap-2"><PackageSearch className="size-4 text-muted-foreground" /><p className="text-sm font-medium">Add catalog product</p></div><div className="relative"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input autoFocus className="pl-9" value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Search SKU, UPC, title, or brand" /></div>{catalogSearching && <p className="mt-2 text-xs text-muted-foreground">Searching catalog...</p>}{catalogQuery.trim().length >= 2 && !catalogSearching && <div className="mt-3 overflow-hidden rounded-md border bg-background">{catalogResults.map((item) => <button key={item.id || item.sku} type="button" onClick={() => addCatalogItem(item)} className="grid w-full grid-cols-[minmax(120px,0.45fr)_minmax(220px,1fr)_110px] items-center gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted"><span className="font-mono text-xs font-medium">{item.sku}</span><span className="min-w-0 truncate">{item.title || item.marketplaceTitle || item.sku}</span><span className="text-right font-medium">{moneyLabel(Number(item.websitePrice ?? item.price ?? 0))}</span></button>)}{!catalogResults.length && <p className="px-3 py-4 text-sm text-muted-foreground">No catalog product found. You can still add a manual line below.</p>}</div>}</div><div className="flex items-center justify-between"><div><p className="text-sm font-medium">Quote lines</p><p className="text-xs text-muted-foreground">Catalog lines retain their SKU and default sell price; manual lines remain supported.</p></div><Button size="sm" variant="outline" onClick={() => setForm((current) => ({ ...current, items: [...current.items, { sku: "", title: "", qty: "1", price: "" }] }))}>Add manual item</Button></div><div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead className="min-w-40">SKU</TableHead><TableHead className="min-w-64">Product</TableHead><TableHead className="w-24">Qty</TableHead><TableHead className="w-32">Unit price</TableHead><TableHead className="w-12" /></TableRow></TableHeader><TableBody>{form.items.map((line, index) => <TableRow key={`${line.sku}-${index}`}><TableCell><Input value={line.sku} onChange={(event) => updateLine(index, { sku: event.target.value })} placeholder="SKU" /></TableCell><TableCell><Input value={line.title} onChange={(event) => updateLine(index, { title: event.target.value })} placeholder="Product title" /></TableCell><TableCell><Input type="number" min="1" value={line.qty} onChange={(event) => updateLine(index, { qty: event.target.value })} /></TableCell><TableCell><Input type="number" min="0" step="0.01" value={line.price} onChange={(event) => updateLine(index, { price: event.target.value })} /></TableCell><TableCell><Button size="icon" variant="ghost" disabled={form.items.length === 1} title="Remove item" onClick={() => setForm((current) => ({ ...current, items: current.items.filter((_, lineIndex) => lineIndex !== index) }))}><Trash2 className="size-4" /></Button></TableCell></TableRow>)}{!form.items.length && <TableRow><TableCell colSpan={5} className="h-20 text-center text-muted-foreground">Search the catalog or add a manual line to start this quote.</TableCell></TableRow>}</TableBody></Table></div></TabsContent><TabsContent value="customer" className="m-0 grid gap-4 p-6 sm:grid-cols-2"><Field label="Customer name"><Input value={form.buyer} onChange={(event) => setForm({ ...form, buyer: event.target.value })} /></Field><Field label="Customer email"><Input type="email" value={form.buyerEmail} onChange={(event) => setForm({ ...form, buyerEmail: event.target.value })} /></Field><Field label="Phone"><Input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></Field><Field label="Quote source"><Input value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} /></Field></TabsContent><TabsContent value="shipping" className="m-0 grid gap-4 p-6 sm:grid-cols-2"><Field label="Address line 1"><Input value={form.line1} onChange={(event) => setForm({ ...form, line1: event.target.value })} /></Field><Field label="Address line 2"><Input value={form.line2} onChange={(event) => setForm({ ...form, line2: event.target.value })} /></Field><Field label="City"><Input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} /></Field><Field label="State / province"><Input value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })} /></Field><Field label="Postal code"><Input value={form.postalCode} onChange={(event) => setForm({ ...form, postalCode: event.target.value })} /></Field><Field label="Country"><Input value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value })} /></Field></TabsContent><TabsContent value="notes" className="m-0 p-6"><Field label="Internal note"><Textarea className="min-h-40" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Terms, follow-up, or customer context" /></Field></TabsContent></Tabs><DialogFooter className="border-t bg-muted/20 px-6 py-4"><Button variant="outline" onClick={() => setEditorOpen(false)}>Cancel</Button><Button disabled={busy} onClick={() => void save()}><Save className="size-4" /> Save quote</Button></DialogFooter></DialogContent></Dialog>
  </div>
}

void DraftDetailWorkspace
