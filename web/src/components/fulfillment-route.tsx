import { useEffect, useMemo, useRef, useState } from "react"
import {
  AlertCircle, AlertTriangle, ArrowLeft, ArrowRight, Boxes, CalendarDays, CheckCircle2,
  ChevronDown, Clock3, Copy, ExternalLink, Eye, FileDown, Info, Link2, ListChecks,
  Loader2, Monitor, MoreHorizontal, Package, PackageCheck, Pencil, Plus, Printer, RefreshCw,
  RotateCcw, Save, Search, SendHorizontal, ShieldAlert, ShieldCheck, SlidersHorizontal,
  Trash2, Truck, Filter, X,
} from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { api, dateLabel, moneyLabel, numberLabel } from "../lib/client-api"
import { matchesSearch, normalizePastedSearch } from "../lib/multi-search"
import { Detail, Field, PageHeader, sortShippingRatesForDisplay, ToggleField } from "../App"
import type { ImportJob, ProductItem } from "../App"

type FulfillmentCarrierService = { id: string; name: string; enabled: boolean }
type FulfillmentCarrier = { id: string; name: string; enabled: boolean; trackingUrlTemplate?: string; phone?: string; services: FulfillmentCarrierService[] }

const FULFILLMENT_SAVED_RATE_TTL_MS = 15 * 60_000

function fulfillmentRateValidUntil(review?: Record<string, any> | null): number | null {
  const rate = review?.selectedRate as Record<string, unknown> | undefined
  if (!rate) return 0
  const provider = String(rate.provider || "").toLowerCase()
  const action = String(rate.action || "").toLowerCase()
  if (action === "retrieve_existing_label" || provider === "shopify") return null
  const explicitExpiry = Date.parse(String(rate.expiresAt || ""))
  if (Number.isFinite(explicitExpiry)) return explicitExpiry
  const quotedAt = Date.parse(String(rate.quotedAt || review?.ratedAt || review?.attemptedAt || ""))
  return Number.isFinite(quotedAt) ? quotedAt + FULFILLMENT_SAVED_RATE_TTL_MS : 0
}

function fulfillmentRateIsCurrent(review?: Record<string, any> | null, now = Date.now()): boolean {
  if (!review?.selectedRate || review.selectedRate.expired === true) return false
  const validUntil = fulfillmentRateValidUntil(review)
  return validUntil === null || validUntil > now
}

function measurementInputValue(value?: unknown) {
  const number = Number(value || 0)
  return Number.isFinite(number) && number > 0 ? number.toFixed(2).replace(/\.?0+$/, "") : ""
}

function RecoverySourceLabel({ record, fallback }: { record?: Record<string, any> | null; fallback?: Record<string, any> | null }) {
  const sourceBatchNumber = String(record?.sourceBatchNumber || fallback?.sourceBatchNumber || "").trim()
  if (!sourceBatchNumber) return null
  return <span className="inline-flex w-fit max-w-full self-start shrink-0 items-center rounded-full border border-fuchsia-300 bg-fuchsia-500 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none text-white shadow-sm dark:border-fuchsia-400 dark:bg-fuchsia-500" title={`Recovered from ${sourceBatchNumber}`}>Recovered from {sourceBatchNumber}</span>
}

function reportFulfillmentClientPerformance(sample: Record<string, unknown>) {
  void fetch("/api/fulfillment/diagnostics/client", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sample),
    keepalive: true,
  }).catch(() => undefined)
}

function FulfillmentRateCell({ review, busy, onOpen, onProcess, onSelectRate }: { review?: Record<string, any> | null; busy: boolean; onOpen: () => void; onProcess: () => void; onSelectRate: (rateId: string) => Promise<boolean> }) {
  const authoritativeRateId = String(review?.selectedRate?.id || "")
  const [selectedRateId, setSelectedRateId] = useState(authoritativeRateId)
  const [savingRate, setSavingRate] = useState(false)
  const status = String(review?.rowStatus || "").toLowerCase()
  const pending = ["queued", "processing"].includes(status)
  const labelFailure = review?.labelFailure as Record<string, unknown> | undefined
  const failed = status === "failed" || Boolean(review?.error) || Boolean(labelFailure)
  const rates = sortShippingRatesForDisplay(Array.isArray(review?.rates) ? review.rates as Array<Record<string, unknown>> : [], selectedRateId || authoritativeRateId)
  const rate = (rates.find((option) => String(option.id || "") === selectedRateId) || review?.selectedRate) as Record<string, unknown> | undefined
  const rateAmount = rate?.amount === null || rate?.amount === undefined || rate?.amount === "" ? null : Number(rate.amount)
  const selectedReview = rate ? { ...review, selectedRate: rate } : review
  const validUntil = fulfillmentRateValidUntil(selectedReview)
  const rateExpiresAt = validUntil === null || validUntil <= 0 ? "" : new Date(validUntil).toISOString()
  const rateExpired = Boolean(rate) && !fulfillmentRateIsCurrent(selectedReview)
  const lowestRate = [...rates].filter((option) => Number(option.amount) > 0).sort((left, right) => Number(left.amount) - Number(right.amount))[0]
  const rateFreshness = rateExpired ? "Verified at purchase" : rateExpiresAt ? `Expires ${dateLabel(rateExpiresAt)}` : rate ? "Fresh quote" : ""
  const label = labelFailure ? "Label failed" : rate ? (rateAmount !== null && Number.isFinite(rateAmount) ? moneyLabel(rateAmount) : String(rate.action || "") === "retrieve_existing_label" ? "Existing channel label" : "Cost unavailable") : pending ? (status === "processing" ? "Checking rates" : "Rate queued") : failed ? "Rate failed" : "Not rated"
  const tone = labelFailure ? "border-destructive/40 bg-destructive/5 text-destructive" : rateExpired ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300" : rate ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : pending ? "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300" : failed ? "border-destructive/40 bg-destructive/5 text-destructive" : "text-muted-foreground"
  const reviewLabel = review?.source === "background" ? "Automatic rate" : String(review?.batchNumber || "Rate review")

  useEffect(() => setSelectedRateId(authoritativeRateId), [authoritativeRateId])

  const chooseRate = async (rateId: string) => {
    if (busy || savingRate || rateId === selectedRateId) return
    const previousRateId = selectedRateId
    setSelectedRateId(rateId)
    setSavingRate(true)
    const saved = await onSelectRate(rateId)
    if (!saved) setSelectedRateId(previousRateId)
    setSavingRate(false)
  }

  if (!review) return <span className="text-xs text-muted-foreground">Not rated</span>
  return <Popover>
    <PopoverTrigger asChild>
      <Button variant="outline" className={`h-auto min-w-36 justify-start px-3 py-2 text-left ${tone}`}>
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-medium">{pending && <Loader2 className={`size-3.5 ${status === "processing" ? "animate-spin" : ""}`} />}{failed && <AlertCircle className="size-3.5" />}{rate && <CheckCircle2 className="size-3.5" />}{label}</span>
          <span className="block max-w-44 truncate text-xs opacity-80">{rate ? `${String(rate.carrier || "")} ${String(rate.service || "")}` : reviewLabel}</span>{rateFreshness ? <span className="mt-0.5 block text-[10px] opacity-70">{rateFreshness}</span> : null}
        </span>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" sideOffset={6} collisionPadding={12} className="w-[min(34rem,calc(100vw-1rem))] overflow-hidden border bg-popover p-0 text-popover-foreground opacity-100 shadow-xl">
      <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
        <div className="min-w-0"><p className="truncate text-sm font-semibold">Select shipping rate</p><p className="text-xs text-muted-foreground">{reviewLabel} · {rates.length} option{rates.length === 1 ? "" : "s"}{savingRate ? " · Saving" : ""}</p></div>
        {review?.source !== "background" && <Button size="sm" variant="ghost" className="h-7 shrink-0 px-2" onClick={onOpen}>Review</Button>}
      </div>
      {rateExpired ? <Alert className="m-3 w-auto border-amber-500/40 bg-amber-500/5"><Clock3 className="size-4" /><AlertTitle>Carrier quote expired</AlertTitle><AlertDescription>DataPlus will request a fresh quote for the same carrier service immediately before purchasing the label.</AlertDescription></Alert> : null}
      {labelFailure ? <Alert variant="destructive" className="m-3 w-auto"><AlertCircle className="size-4" /><AlertTitle>Label purchase failed</AlertTitle><AlertDescription>{String(labelFailure.message || "The last label purchase failed. Select this order in Pending shipment to create a new batch.")}</AlertDescription></Alert> : null}
      {rates.length > 0 ? <div className="max-h-72 overscroll-contain overflow-y-auto" onWheel={(event) => event.stopPropagation()}>
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-popover shadow-[0_1px_0_hsl(var(--border))]"><TableRow><TableHead className="h-8 px-3 text-xs">Service</TableHead><TableHead className="h-8 w-32 px-3 text-xs">ETA</TableHead><TableHead className="h-8 w-24 px-3 text-right text-xs">Price</TableHead></TableRow></TableHeader>
          <TableBody>{rates.map((option) => {
            const selected = String(option.id) === String(rate?.id || "")
            const lowest = Boolean(lowestRate) && String(option.id) === String(lowestRate.id)
            const deliveryEstimate = String(option.deliveryEstimate || "")
            const eta = option.deliveryDays ? `${String(option.deliveryDays)} days` : deliveryEstimate && !Number.isNaN(Date.parse(deliveryEstimate)) ? dateLabel(deliveryEstimate) : deliveryEstimate || "Unavailable"
            return <TableRow key={String(option.id)} role="button" tabIndex={0} aria-selected={selected} className={`cursor-pointer ${selected ? "bg-primary/10" : ""}`} onClick={() => void chooseRate(String(option.id))} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void chooseRate(String(option.id)) } }}>
              <TableCell className="max-w-0 px-3 py-2"><div className="flex min-w-0 items-center gap-2">{selected ? <CheckCircle2 className="size-3.5 shrink-0 text-primary" /> : <span className="size-3.5 shrink-0" />}<div className="min-w-0"><div className="flex items-center gap-1.5"><p className="truncate text-sm font-medium">{String(option.carrier || "Carrier")}</p>{selected ? <Badge variant="outline" className="h-4 px-1 text-[9px]">Selected</Badge> : null}{lowest ? <Badge variant="success" className="h-4 px-1 text-[9px]">Lowest</Badge> : null}</div><p className="truncate text-xs text-muted-foreground">{String(option.service || "Service")}</p></div></div></TableCell>
              <TableCell className="px-3 py-2 text-xs text-muted-foreground">{eta}</TableCell>
              <TableCell className="px-3 py-2 text-right text-sm font-semibold tabular-nums">{option.amount === null || option.amount === undefined || option.amount === "" ? (String(option.action || "") === "retrieve_existing_label" ? "Existing label" : "Unavailable") : moneyLabel(Number(option.amount))}</TableCell>
            </TableRow>
          })}</TableBody>
        </Table>
      </div> : <div className="p-3">
        {pending && <Alert><Clock3 className="size-4" /><AlertTitle>Rate check has not finished</AlertTitle><AlertDescription>{String(review.notice || "Continue this saved review to load carrier options. No shipment or label has been purchased.")}</AlertDescription></Alert>}
        {failed && <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Rate lookup failed</AlertTitle><AlertDescription>{String(review.error || "The carrier did not return a usable rate.")}</AlertDescription></Alert>}
        {!pending && !failed && <p className="text-sm text-muted-foreground">No carrier rates are available.</p>}
      </div>}
      {!rates.length && <div className="flex justify-end border-t p-2"><Button size="sm" disabled={busy} onClick={onProcess}>{busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} {failed ? "Retry" : "Continue"}</Button></div>}
    </PopoverContent>
  </Popover>
}

function FulfillmentChannelShipmentStatus({ row, compact = false }: { row: Record<string, any>; compact?: boolean }) {
  const sync = (row.channelSync || {}) as Record<string, any>
  const status = String(sync.status || "").trim().toLowerCase()
  const message = String(sync.message || "").trim()
  const channel = String(sync.channel || row.channel || "channel").trim()
  const confirmed = ["sent", "synced", "already_synced"].includes(status)
  const failed = ["failed", "disabled", "not_supported"].includes(status)
  const label = confirmed ? "Marked shipped" : failed ? "Channel update failed" : "Awaiting channel update"
  const detail = message || (confirmed
    ? `${channel} accepted the shipment and tracking update.`
    : failed
      ? `${channel} did not accept the shipment update.`
      : `The label is purchased locally, but DataPlus has not received confirmation that ${channel} accepted the tracking update.`)
  const color = confirmed
    ? "text-emerald-700 dark:text-emerald-300"
    : failed
      ? "text-red-700 dark:text-red-300"
      : "text-amber-700 dark:text-amber-300"
  const dot = confirmed ? "bg-emerald-500" : failed ? "bg-red-500" : "bg-amber-500"
  return <TooltipProvider delayDuration={250}><Tooltip><TooltipTrigger asChild><span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", color)}><span className={cn("size-2 shrink-0 rounded-full", dot)}>{compact ? <span className="sr-only">{label}</span> : null}</span>{compact ? null : label}</span></TooltipTrigger><TooltipContent><p className="font-medium">Marketplace status: {label}</p><p className="max-w-72 text-xs opacity-80">{detail}</p></TooltipContent></Tooltip></TooltipProvider>
}

function fulfillmentOrderDateLabel(value: unknown) {
  const date = new Date(String(value || ""))
  if (Number.isNaN(date.getTime())) return "Date unavailable"
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}

type FulfillmentCountedFilterOption = { value: string; label: string; count: number }

function fulfillmentFilterValue(value: unknown) {
  return String(value || "").trim().toLowerCase()
}

function fulfillmentShipmentSkus(row: Record<string, any>) {
  const values = Array.isArray(row.skus) ? row.skus : [row.sku]
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
}

function fulfillmentShipmentSuppliers(row: Record<string, any>) {
  const values = Array.isArray(row.supplierNames) ? row.supplierNames : [row.supplierName, row.supplier]
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
}

function fulfillmentShipmentPrinted(row: Record<string, any>) {
  return Number(row.labelPrintCount || 0) > 0 || Boolean(row.labelPrintedAt)
}

function fulfillmentChannelSyncState(row: Record<string, any>) {
  const status = fulfillmentFilterValue(row.channelSync?.status)
  if (["sent", "synced", "already_synced"].includes(status)) return "confirmed"
  if (["failed", "disabled", "not_supported"].includes(status)) return "failed"
  return "pending"
}

function fulfillmentCountedFilterOptions(rows: Array<Record<string, any>>, valuesForRow: (row: Record<string, any>) => string[]) {
  const options = new Map<string, FulfillmentCountedFilterOption>()
  for (const row of rows) {
    const seen = new Set<string>()
    for (const label of valuesForRow(row)) {
      const value = fulfillmentFilterValue(label)
      if (!value || seen.has(value)) continue
      seen.add(value)
      const current = options.get(value)
      options.set(value, { value, label: current?.label || label, count: Number(current?.count || 0) + 1 })
    }
  }
  return [...options.values()].sort((left, right) => left.label.localeCompare(right.label))
}

function FulfillmentShipmentTable({ rows, onPrint, emptyMessage }: { rows: Array<Record<string, any>>; onPrint: (row: Record<string, any>) => void; emptyMessage: string }) {
  const [page, setPage] = useState(1)
  const pageSize = 50
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pageRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  useEffect(() => { setPage(1) }, [rows])
  return <div><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Batch ID</TableHead><TableHead>Tracking</TableHead><TableHead>Item</TableHead><TableHead>Ship to</TableHead><TableHead>Channel</TableHead><TableHead>Marketplace status</TableHead><TableHead>Carrier / service / source</TableHead><TableHead>Ship by</TableHead><TableHead>Carrier status</TableHead><TableHead>Print history</TableHead><TableHead>Last carrier check</TableHead><TableHead className="sticky right-0 z-20 w-12 bg-background text-right shadow-[-1px_0_0_hsl(var(--border))]">Actions</TableHead></TableRow></TableHeader><TableBody>{pageRows.map((row, index) => {
    const labelDocument = row.documents?.find((document: Record<string, unknown>) => document.documentType === "shipping_label" || document.documentId)
    const labelGenerating = ["label_pending", "purchase_processing"].includes(String(row.status || "").toLowerCase()) || String(row.trackingStatus || "").toLowerCase() === "label_generating"
    const trackingLabel = String(row.trackingStatus || "awaiting_pickup").replace(/_/g, " ")
    const printCount = Math.max(0, Number(row.labelPrintCount || 0))
    const printed = printCount > 0 || Boolean(row.labelPrintedAt)
    const lastPrintedAt = String(row.labelLastPrintedAt || row.labelPrintedAt || "")
    const lastPrintDestination = [row.labelLastPrintStation, row.labelLastPrinterName].filter(Boolean).join(" · ")
    const printHistoryTitle = Array.isArray(row.labelPrintHistory) && row.labelPrintHistory.length
      ? row.labelPrintHistory.slice(0, 10).map((entry: Record<string, unknown>) => [entry.printedAt ? dateLabel(String(entry.printedAt)) : "", entry.printedBy, entry.stationName, entry.printerName].filter(Boolean).join(" · ")).join("\n")
      : [lastPrintedAt ? dateLabel(lastPrintedAt) : "", row.labelLastPrintedBy, lastPrintDestination].filter(Boolean).join(" · ")
    const carrier = String(row.carrierName || row.carrier || "Carrier")
    const service = String(row.service || "").replace(/\s*·\s*(Purchased from DataPlus|Outsourced label)\s*$/i, "").trim() || "Service unavailable"
    const labelSource = String(row.labelSource || "").toLowerCase() === "dataplus" ? "DataPlus" : String(row.channel || row.labelSourceLabel || "External")
    const city = String(row.destination?.city || row.destination?.town || "Unknown city")
    const state = String(row.destination?.state || "").trim()
    const printRow = () => onPrint({ orderId: row.orderId, shipmentId: row.id, packetUrl: `/api/orders/${encodeURIComponent(String(row.orderId))}/shipments/${encodeURIComponent(String(row.id))}/print-packet.pdf`, printNumber: `Label ${String(row.orderNumber || row.orderId)}`, batchId: row.fulfillmentBatchId, batchNumber: row.fulfillmentBatchNumber, orderCount: 1, status: printed ? "printed" : "ready", printCount, printedAt: lastPrintedAt, printedBy: row.labelLastPrintedBy || row.labelPrintedBy, stationName: row.labelLastPrintStation, printerName: row.labelLastPrinterName })
    return <TableRow key={`${String(row.id)}-${index}`} className="group">
      <TableCell><a className="font-medium hover:underline" href={`/orders/${encodeURIComponent(String(row.orderId))}`}>{String(row.orderNumber || row.orderId)}</a><p className="mt-1 whitespace-nowrap text-xs tabular-nums text-muted-foreground">{fulfillmentOrderDateLabel(row.orderDate)}</p></TableCell>
      <TableCell><p className="whitespace-nowrap font-medium">{String(row.fulfillmentBatchNumber || "-")}</p>{row.printNumber ? <p className="whitespace-nowrap text-xs text-muted-foreground">{String(row.printNumber)}</p> : null}</TableCell>
      <TableCell className="font-mono text-xs">{row.trackingUrl ? <a className="text-primary hover:underline" href={String(row.trackingUrl)} target="_blank" rel="noreferrer">{String(row.trackingNumber || "Open tracking")}</a> : String(row.trackingNumber || "Pending")}</TableCell>
      <TableCell><div className="flex min-w-40 items-center gap-2">{row.productImage ? <img src={String(row.productImage)} alt="" className="size-9 rounded border bg-background object-contain" /> : <span className="grid size-9 shrink-0 place-items-center rounded border bg-muted"><Package className="size-4 text-muted-foreground" /></span>}<span className="font-mono text-xs">{Array.isArray(row.skus) && row.skus.length ? row.skus.join(", ") : "-"}</span></div></TableCell>
      <TableCell><p className="max-w-44 truncate whitespace-nowrap font-medium" title={[city, state].filter(Boolean).join(", ")}>{[city, state].filter(Boolean).join(", ")}</p></TableCell>
      <TableCell>{String(row.channel || "-")}</TableCell>
      <TableCell><FulfillmentChannelShipmentStatus row={row} /></TableCell>
      <TableCell><p className="max-w-64 truncate whitespace-nowrap text-xs" title={`${carrier} | ${service} | ${labelSource}`}><span className="font-semibold text-foreground">{carrier}</span><span className="px-1.5 text-muted-foreground">|</span>{service}<span className="px-1.5 text-muted-foreground">|</span><span className="font-medium text-foreground">{labelSource}</span></p></TableCell>
      <TableCell><FulfillmentShipBy row={row} /></TableCell>
      <TableCell><Badge variant={row.trackingRefreshError ? "destructive" : row.trackingStatus === "delivered" ? "success" : row.trackingStatus === "voided" ? "destructive" : row.trackingStatus === "in_transit" ? "secondary" : "outline"}>{row.trackingRefreshError ? "Check failed" : trackingLabel}</Badge>{row.trackingRefreshError ? <p className="mt-1 max-w-52 text-xs text-destructive" title={String(row.trackingRefreshError)}>{String(row.trackingRefreshError)}</p> : null}</TableCell>
      <TableCell>{labelGenerating ? <Badge variant="outline">Waiting for document</Badge> : printed ? <div title={printHistoryTitle}><Badge variant={printCount > 1 ? "warning" : "success"}>{printCount > 1 ? `Reprinted ${printCount} times` : "Printed once"}</Badge>{lastPrintedAt ? <p className="mt-1 whitespace-nowrap text-xs text-muted-foreground">Last {dateLabel(lastPrintedAt)}</p> : null}{lastPrintDestination ? <p className="max-w-44 truncate text-xs text-muted-foreground">{lastPrintDestination}</p> : null}</div> : <Badge variant="warning">Not printed</Badge>}</TableCell>
      <TableCell><span className="whitespace-nowrap text-xs">{row.trackingCheckedAt ? dateLabel(String(row.trackingCheckedAt)) : "Not checked"}</span></TableCell>
      <TableCell className="sticky right-0 z-10 bg-background text-right shadow-[-1px_0_0_hsl(var(--border))] group-hover:bg-muted/50"><DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label={`Actions for order ${String(row.orderNumber || row.orderId)}`}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={!labelDocument || labelGenerating} onSelect={printRow}><Printer className="size-4" /> {printed ? "Reprint label" : "Print label"}</DropdownMenuItem><DropdownMenuItem disabled={!row.fulfillmentBatchId || labelGenerating} onSelect={() => window.open(`/api/fulfillment/label-batches/${encodeURIComponent(String(row.fulfillmentBatchId))}/pick-sheet`, "_blank", "noopener,noreferrer")}><ListChecks className="size-4" /> Pick sheet</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell>
    </TableRow>
  })}{!rows.length && <TableRow><TableCell colSpan={13} className="h-28 text-center text-muted-foreground">{emptyMessage}</TableCell></TableRow>}</TableBody></Table></div>{rows.length > pageSize && <div className="flex flex-col gap-2 border-t px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"><span className="text-muted-foreground">Showing {numberLabel((currentPage - 1) * pageSize + 1)}-{numberLabel(Math.min(currentPage * pageSize, rows.length))} of {numberLabel(rows.length)}</span><div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button><span className="min-w-20 text-center">Page {currentPage} of {pageCount}</span><Button size="sm" variant="outline" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next</Button></div></div>}</div>
}

const fulfillmentWorkColumnOptions = [
  ["order", "Order"], ["item", "Item"], ["shipTo", "Ship to"], ["channel", "Channel"], ["supplier", "Supplier"], ["warehouse", "Warehouse"],
  ["supply", "Supply"], ["readiness", "Readiness"], ["rate", "Rate"], ["shipBy", "Ship by"], ["status", "Status"]
] as const

type FulfillmentSkuGroup = {
  sku: string
  image: string
  title: string
  brand: string
  supplier: string
  routeIds: string[]
  orderCount: number
  allocatedOrderCount: number
}

type FulfillmentRateRefreshItem = {
  orderId: string
  orderNumber: string
  channel: string
  rateLane: "temu" | "shopify" | "veeqo"
  routeIds: string[]
  skus: string[]
  status: "queued" | "checking" | "rated" | "recorded" | "failed" | "blocked"
  selectedRate?: Record<string, any> | null
  error?: string
}

function FulfillmentSkuSelector({ groups, selectedSkus, onSelectionChange, onClear }: {
  groups: FulfillmentSkuGroup[]
  selectedSkus: Set<string>
  onSelectionChange: (sku: string, selected: boolean) => void
  onClear: () => void
}) {
  return <Popover>
    <PopoverTrigger asChild><Button size="sm" variant={selectedSkus.size ? "secondary" : "outline"}><Boxes className="size-4" /> SKUs{selectedSkus.size ? ` (${numberLabel(selectedSkus.size)})` : ""}</Button></PopoverTrigger>
    <PopoverContent align="end" sideOffset={8} className="w-[min(94vw,54rem)] overflow-hidden border-2 bg-popover p-0 shadow-2xl ring-1 ring-primary/20">
      <div className="flex items-start justify-between gap-3 border-b bg-muted/70 px-3 py-2">
        <div><p className="text-sm font-medium">Filter orders by SKU</p><p className="text-xs text-muted-foreground">The queue shows only orders for checked SKUs.</p></div>
        {selectedSkus.size > 0 && <Button size="sm" variant="ghost" className="h-7" onClick={onClear}>Clear</Button>}
      </div>
      <ScrollArea className="h-80 bg-popover">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-popover"><TableRow>
            <TableHead className="w-9" /><TableHead>SKU</TableHead><TableHead className="w-12">Image</TableHead><TableHead>Title</TableHead><TableHead>Brand</TableHead><TableHead>Supplier</TableHead><TableHead>Allocated</TableHead><TableHead className="text-right">Orders</TableHead>
          </TableRow></TableHeader>
          <TableBody>{groups.map((group) => {
            const selected = selectedSkus.has(group.sku.toLowerCase())
            const shortTitle = group.title.length > 10 ? `${group.title.slice(0, 10)}...` : group.title
            return <TableRow key={group.sku} className="h-11 bg-popover hover:bg-accent/60">
              <TableCell className="py-1"><Checkbox aria-label={`Filter orders for ${group.sku}`} checked={selected} onCheckedChange={(checked) => onSelectionChange(group.sku, checked === true)} /></TableCell>
              <TableCell className="max-w-36 truncate py-1 font-mono text-xs" title={group.sku}>{group.sku}</TableCell>
              <TableCell className="py-1">{group.image ? <img src={group.image} alt="" className="size-8 rounded border object-contain" /> : <div className="grid size-8 place-items-center rounded border bg-muted"><Package className="size-4 text-muted-foreground" /></div>}</TableCell>
              <TableCell className="py-1 text-xs" title={group.title}>{shortTitle || "-"}</TableCell>
              <TableCell className="max-w-28 truncate py-1 text-xs" title={group.brand}>{group.brand || "-"}</TableCell>
              <TableCell className="max-w-36 truncate py-1 text-xs" title={group.supplier}>{group.supplier || "-"}</TableCell>
              <TableCell className="py-1"><Badge variant={group.allocatedOrderCount === group.orderCount ? "success" : group.allocatedOrderCount ? "warning" : "outline"}>{group.allocatedOrderCount}/{group.orderCount}</Badge></TableCell>
              <TableCell className="py-1 text-right font-medium">{numberLabel(group.orderCount)}</TableCell>
            </TableRow>
          })}{!groups.length && <TableRow><TableCell colSpan={8} className="h-24 text-center text-muted-foreground">No SKUs match the current filters.</TableCell></TableRow>}</TableBody>
        </Table>
      </ScrollArea>
    </PopoverContent>
  </Popover>
}

type FulfillmentDeadlineState = "late" | "due_soon" | "on_time" | "unknown"

function fulfillmentDeadlineTimestamp(row: Record<string, any>) {
  const value = String(row.shipDeadline || row.shipBy || "").trim()
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number)
    const timestamp = new Date(year, month - 1, day, 23, 59, 59, 999).getTime()
    return Number.isFinite(timestamp) ? timestamp : null
  }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function fulfillmentDeadlineState(row: Record<string, any>, now = Date.now()): FulfillmentDeadlineState {
  const deadline = fulfillmentDeadlineTimestamp(row)
  if (deadline === null) return "unknown"
  const trackingStatus = String(row.trackingStatus || "").toLowerCase()
  const completedAt = ["in_transit", "delivered"].includes(trackingStatus) ? Date.parse(String(row.carrierConfirmedAt || row.shippedAt || "")) : Number.NaN
  const comparisonTime = Number.isFinite(completedAt) ? completedAt : now
  const remaining = deadline - comparisonTime
  if (remaining < 0) return "late"
  if (Number.isFinite(completedAt)) return "on_time"
  if (row.vergeOfLateShipment === true || (Array.isArray(row.channelOrderLabels) && row.channelOrderLabels.includes("soon_to_be_overdue"))) return "due_soon"
  if (remaining <= 24 * 60 * 60 * 1000) return "due_soon"
  return "on_time"
}

function matchesFulfillmentDeadlineFilter(row: Record<string, any>, filter: string) {
  if (filter === "all") return true
  const state = fulfillmentDeadlineState(row)
  return filter === "at_risk" ? ["late", "due_soon"].includes(state) : state === filter
}

function matchesFulfillmentSearch(row: Record<string, any>, query: string) {
  return matchesSearch(row, query)
}

function FulfillmentShipBy({ row }: { row: Record<string, any> }) {
  const state = fulfillmentDeadlineState(row)
  const value = String(row.shipDeadline || row.shipBy || "").trim()
  const details: Record<FulfillmentDeadlineState, { label: string; variant: "destructive" | "warning" | "success" | "outline" }> = {
    late: { label: "Late", variant: "destructive" },
    due_soon: { label: "Verge of late shipment", variant: "warning" },
    on_time: { label: "On time", variant: "success" },
    unknown: { label: "No deadline", variant: "outline" },
  }
  const detail = details[state]
  return <div className="min-w-28"><p className="whitespace-nowrap text-sm">{value ? dateLabel(value) : "-"}</p><Badge variant={detail.variant} className="mt-1 whitespace-nowrap text-[10px]">{detail.label}</Badge></div>
}

function FulfillmentReadinessChecklist({ row, compact = false }: { row: Record<string, any>; compact?: boolean }) {
  const readiness = (row.labelReadiness || {}) as Record<string, any>
  const blockers = Array.isArray(readiness.blockers) ? readiness.blockers.map(String) : []
  const destination = (row.destination || {}) as Record<string, any>
  const allocationReady = String(row.allocationStatus || "").toLowerCase() === "allocated" || String(row.status || "") === "Ready to ship"
  const addressReady = Boolean((destination.city || destination.town) && (destination.state || destination.province) && (destination.postalCode || destination.zip || destination.postcode))
  const packageReady = readiness.ready === true
  const rateReady = Boolean(row.rateReview?.selectedRate) && !row.rateReview?.labelFailure
  const checks = [
    { label: "Inventory", state: allocationReady ? "ready" : "warning", detail: allocationReady ? "Inventory allocated" : "Inventory needs review" },
    { label: "Package", state: packageReady ? "ready" : "warning", detail: packageReady ? `${String(readiness.weight || 0)} lb · ${String(readiness.length || 0)} × ${String(readiness.width || 0)} × ${String(readiness.height || 0)} in` : blockers[0] || "Package measurements needed" },
    { label: "Address", state: addressReady ? "ready" : "warning", detail: addressReady ? "Delivery address complete" : "Delivery address needs review" },
    { label: "Rate", state: rateReady ? "ready" : "warning", detail: rateReady ? `${String(row.rateReview?.selectedRate?.carrier || "Carrier")} ${String(row.rateReview?.selectedRate?.service || "")}`.trim() : "Shipping rate needed" },
    { label: "Channel", state: "neutral", detail: "Channel shipment confirmation becomes available after the label is purchased." },
  ]
  return <TooltipProvider delayDuration={250}><div className={cn("flex items-center", compact ? "gap-1" : "flex-wrap gap-x-3 gap-y-2")}>
    {checks.map((check) => <Tooltip key={check.label}><TooltipTrigger asChild><span className={cn("inline-flex items-center gap-1.5 text-xs", check.state === "ready" ? "text-emerald-700 dark:text-emerald-300" : check.state === "neutral" ? "text-muted-foreground" : "text-amber-700 dark:text-amber-300")}><span className={cn("size-2 rounded-full", check.state === "ready" ? "bg-emerald-500" : check.state === "neutral" ? "border border-muted-foreground/50 bg-transparent" : "bg-amber-500")} />{compact ? <span className="sr-only">{check.label}</span> : check.label}</span></TooltipTrigger><TooltipContent><p className="font-medium">{check.label}</p><p className="max-w-64 text-xs opacity-80">{check.detail}</p></TooltipContent></Tooltip>)}
  </div></TooltipProvider>
}

function FulfillmentPackageTableRow({
  rows,
  selectedRouteIds,
  showColumn,
  busy,
  onToggleSelection,
  onEditPackage,
  onSetShipAlone,
  onCreateLabel,
  onOpenBatches,
  onProcessRates,
  onAdvance,
  onSelectRate,
  onShipTogether,
  onQuickView,
}: {
  rows: Array<Record<string, any>>
  selectedRouteIds: Set<string>
  showColumn: (column: string) => boolean
  busy: boolean
  onToggleSelection: (routeIds: string[], selected: boolean) => void
  onEditPackage: (rows: Array<Record<string, any>>) => void
  onSetShipAlone: (row: Record<string, any>, shipAlone: boolean) => void
  onCreateLabel: (rows: Array<Record<string, any>>) => void
  onOpenBatches: () => void
  onProcessRates: (row: Record<string, any>) => void
  onAdvance: (row: Record<string, any>, stage: string) => void
  onSelectRate: (row: Record<string, any>, rateId: string) => Promise<boolean>
  onShipTogether: (row: Record<string, any>) => void
  onQuickView: (rows: Array<Record<string, any>>) => void
}) {
  const row = rows.find((entry) => entry.rateReview?.selectedRate) || rows[0]
  if (!row) return null
  const routeIds = rows.map((entry) => String(entry.id || "")).filter(Boolean)
  const selected = routeIds.length > 0 && routeIds.every((routeId) => selectedRouteIds.has(routeId))
  const readiness = (row.labelReadiness || {}) as Record<string, unknown>
  const blockers = Array.isArray(readiness.blockers) ? readiness.blockers as string[] : []
  const next: string = ""
  const statusRow = rows.find((entry) => String(entry.status || "") === "exception") || row
  const suppliers = [...new Set(rows.map((entry) => String(entry.supplierName || "Internal stock")))]
  const supplies = [...new Set(rows.map((entry) => String(entry.supplyLabel || "No PO")))]
  return <TableRow className="group align-top hover:bg-muted/30">
    <TableCell><Checkbox aria-label={`Select shipment for ${String(row.orderNumber || row.orderId)}`} checked={selected} onCheckedChange={(checked) => onToggleSelection(routeIds, checked === true)} /></TableCell>
    {showColumn("order") && <TableCell><a className="font-medium hover:underline" href={`/orders/${encodeURIComponent(String(row.orderId))}`}>{String(row.orderNumber || row.orderId)}</a><p className="max-w-40 truncate text-xs text-muted-foreground">{String(row.customer || "Customer")}</p><p className="text-xs text-muted-foreground">{row.orderDate ? dateLabel(String(row.orderDate)) : "Order date unavailable"}</p>{rows.length > 1 ? <Badge variant="secondary" className="mt-1">{rows.length} items · 1 shipment</Badge> : null}{Number(row.shipmentConsolidation?.candidateCount || 0) > 0 ? <button type="button" className="mt-1 block" onClick={() => onShipTogether(row)}><Badge variant="outline" className="border-blue-500/40 text-blue-700 dark:text-blue-300"><PackageCheck className="mr-1 size-3" /> Ship together · {Number(row.shipmentConsolidation.candidateCount) + 1}</Badge></button> : null}</TableCell>}
    {showColumn("item") && <TableCell><div className="grid min-w-56 gap-2">{rows.map((item) => <div key={String(item.id)} className="flex items-center gap-2"><a className="shrink-0" href={`/products/${encodeURIComponent(String(item.parentSku || item.catalogSku || item.sku || ""))}`}>{item.productImage ? <img src={String(item.productImage)} alt="" className="size-10 rounded border bg-background object-contain" /> : <span className="grid size-10 place-items-center rounded border bg-muted"><Package className="size-4 text-muted-foreground" /></span>}</a><div className="min-w-0"><a className="block truncate font-medium hover:underline" href={`/products/${encodeURIComponent(String(item.parentSku || item.catalogSku || item.sku || ""))}`}>{String(item.sku || "Missing SKU")}</a>{item.parentSku ? <p className="truncate text-xs text-muted-foreground">Parent {String(item.parentSku)}</p> : null}<div className="flex flex-wrap items-center gap-1"><span className="text-xs text-muted-foreground">{numberLabel(Number(item.qty || 0))} units</span>{item.shipAlone === true ? <Badge variant="outline" className="border-blue-500/30 text-[10px] text-blue-700 dark:text-blue-300">Ships alone</Badge> : null}</div></div></div>)}</div></TableCell>}
    {showColumn("shipTo") && <TableCell><p className="max-w-40 truncate font-medium" title={String(row.destination?.name || row.customer || "")}>{String(row.destination?.city || row.destination?.town || "Unknown city")}</p><p className="max-w-40 truncate text-xs text-muted-foreground">{[row.destination?.state, row.destination?.postalCode || row.destination?.zip || row.destination?.postcode].filter(Boolean).join(" ") || "Address unavailable"}</p></TableCell>}
    {showColumn("channel") && <TableCell><Badge variant="outline">{String(row.channel || "Unassigned")}</Badge></TableCell>}
    {showColumn("supplier") && <TableCell><p className="max-w-44 truncate font-medium" title={suppliers.join(", ")}>{suppliers.length === 1 ? suppliers[0] : `${suppliers.length} sources`}</p></TableCell>}
    {showColumn("warehouse") && <TableCell>{String(row.warehouseName || "Unassigned")}</TableCell>}
    {showColumn("supply") && <TableCell><Badge variant={row.supplyStatus === "incoming" ? "secondary" : row.supplyStatus === "draft" ? "warning" : "outline"}>{supplies.length === 1 ? supplies[0] : "Mixed supply"}</Badge>{row.purchaseOrderId ? <p className="mt-1 text-xs"><a className="text-primary hover:underline" href={`/purchase-orders/${encodeURIComponent(String(row.purchaseOrderId))}`}>{String(row.purchaseOrderNumber || "Open PO")}</a></p> : null}</TableCell>}
    {showColumn("readiness") && <TableCell><button type="button" className={`w-full min-w-40 rounded-md border p-2 text-left transition-colors hover:bg-accent/50 ${readiness.ready ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"}`} onClick={() => onEditPackage(rows)}><p className={`text-xs font-medium ${readiness.ready ? "text-emerald-700 dark:text-emerald-300" : "text-amber-800 dark:text-amber-300"}`}>{readiness.ready ? "Ready for label" : blockers[0] || "Review needed"}</p><div className="mt-2"><FulfillmentReadinessChecklist row={row} compact /></div></button></TableCell>}
    {showColumn("rate") && <TableCell><FulfillmentRateCell review={row.rateReview} busy={busy} onOpen={onOpenBatches} onProcess={() => onProcessRates(row)} onSelectRate={(rateId) => onSelectRate(row, rateId)} /></TableCell>}
    {showColumn("shipBy") && <TableCell><FulfillmentShipBy row={row} /></TableCell>}
    {showColumn("status") && <TableCell><Badge variant={statusRow.status === "exception" ? "destructive" : statusRow.status === "ready_to_ship" ? "success" : "outline"}>{statusRow.status === "ready_to_ship" ? "Ready for label" : String(statusRow.status || "new").replace(/_/g, " ")}</Badge>{row.rateReview?.batchNumber ? <p className="mt-1 text-xs text-blue-700 dark:text-blue-300">{String(row.rateReview.batchNumber)}</p> : null}</TableCell>}
    <TableCell className="text-right"><div className="flex justify-end gap-1"><Button size="icon" variant="ghost" title="Quick view" aria-label={`Quick view order ${String(row.orderNumber || row.orderId)}`} onClick={() => onQuickView(rows)}><Eye className="size-4" /></Button><DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label={`Actions for order ${String(row.orderNumber || row.orderId)}`}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => onEditPackage(rows)}><Pencil className="size-4" /> Edit shipment package</DropdownMenuItem>{rows.map((item) => <DropdownMenuItem key={String(item.id)} disabled={busy} onClick={() => onSetShipAlone(item, item.shipAlone !== true)}><Package className="size-4" /> {item.shipAlone === true ? `Rejoin ${String(item.sku || "item")}` : `Split ${String(item.sku || "item")}`}</DropdownMenuItem>)}{Number(row.shipmentConsolidation?.candidateCount || 0) > 0 ? <DropdownMenuItem disabled={busy} onClick={() => onShipTogether(row)}><PackageCheck className="size-4" /> Ship orders together</DropdownMenuItem> : null}<DropdownMenuSeparator /><DropdownMenuItem disabled={busy || !readiness.ready} onClick={() => onCreateLabel(rows)}><Truck className="size-4" /> Create shipping label</DropdownMenuItem>{row.rateReview?.batchId ? <DropdownMenuItem onClick={onOpenBatches}><ExternalLink className="size-4" /> Open rate review</DropdownMenuItem> : null}{next && <DropdownMenuItem onClick={() => onAdvance(row, next)}><ArrowRight className="size-4" /> Mark {next.replace(/_/g, " ")}</DropdownMenuItem>}<DropdownMenuItem asChild><a href={`/orders/${encodeURIComponent(String(row.orderId))}`}><ExternalLink className="size-4" /> Open order</a></DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></TableCell>
  </TableRow>
}

export function ShippingBatchesPage() {
  const [data, setData] = useState<Record<string, any>>({ batches: [], printQueue: [], page: 1, pageSize: 25, total: 0, totalPages: 1 })
  const [queryDraft, setQueryDraft] = useState("")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState("")
  const [printJob, setPrintJob] = useState<Record<string, any> | null>(null)
  const printFrameRef = useRef<HTMLIFrameElement>(null)
  const batches = Array.isArray(data.batches) ? data.batches as Array<Record<string, any>> : []
  const printQueue = Array.isArray(data.printQueue) ? data.printQueue as Array<Record<string, any>> : []
  const printJobBatch = batches.find((batch) => String(batch.id || "") === String(printJob?.batchId || ""))

  const load = async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "25" })
      if (query) params.set("q", query)
      const result = await api<Record<string, any>>(`/api/fulfillment/shipping-batches?${params.toString()}`)
      setData(result)
      if (Number(result.reconciled || 0) > 0) toast.success(`${numberLabel(Number(result.reconciled))} purchased label${Number(result.reconciled) === 1 ? " was" : "s were"} restored to batch history.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load shipping batches.")
    } finally { if (!quiet) setLoading(false) }
  }

  useEffect(() => { void load() }, [page, query])

  const runBatchAction = async (batch: Record<string, any>, action: "purchase" | "retry" | "picked") => {
    const id = String(batch.id || "")
    setBusyId(id)
    try {
      if (action === "purchase") {
        const routeIds = [...new Set((batch.rows || []).filter((row: Record<string, any>) => ["rated", "queued"].includes(String(row.status || ""))).flatMap((row: Record<string, any>) => row.routeIds || [row.routeId]).map(String).filter(Boolean))]
        if (!routeIds.length) throw new Error("This batch has no rated labels waiting to be purchased.")
        const result = await api<{ message?: string }>(`/api/fulfillment/label-batches/${encodeURIComponent(id)}/process-jobs`, { method: "POST", body: JSON.stringify({ routeIds, printRequestId: crypto.randomUUID() }) })
        toast.success(result.message || `${String(batch.batchNumber || "Batch")} label purchase queued.`)
      } else if (action === "retry") {
        const result = await api<{ message?: string }>(`/api/fulfillment/label-batches/${encodeURIComponent(id)}/retry-released`, { method: "POST", body: "{}" })
        toast.success(result.message || "Released labels reopened in the same batch.")
      } else {
        const result = await api<{ message?: string }>(`/api/fulfillment/label-batches/${encodeURIComponent(id)}/picked`, { method: "POST", body: "{}" })
        toast.success(result.message || "Label batch marked picked.")
      }
      await load(true)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update this shipping batch.") }
    finally { setBusyId("") }
  }

  const printInBrowser = async () => {
    if (!printJob?.id) return
    printFrameRef.current?.contentWindow?.print()
    setBusyId(String(printJob.id))
    try {
      const result = await api<{ message?: string }>(`/api/fulfillment/print-queue/${encodeURIComponent(String(printJob.id))}/printed`, { method: "POST", body: "{}" })
      toast.success(result.message || "Print activity recorded.")
      await load(true)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to record this print activity.") }
    finally { setBusyId("") }
  }

  const openBatchPrintModal = (job: Record<string, any>, batch?: Record<string, any>) => {
    setPrintJob({ ...job, warehouseStatus: String(batch?.warehouseStatus || "open"), recoveryOnly: job.recoveryOnly === true || batch?.recoveryOnly === true, sourceBatchNumber: job.sourceBatchNumber || batch?.sourceBatchNumber || "" })
  }

  const updateBatchHandlingStatus = async (batchId: string, status: "open" | "closed") => {
    if (!batchId) return
    setBusyId(batchId)
    try {
      const result = await api<{ batch?: Record<string, any>; message?: string }>(`/api/fulfillment/label-batches/${encodeURIComponent(batchId)}/handling-status`, { method: "PATCH", body: JSON.stringify({ status }) })
      if (result.batch && printJob && String(printJob.batchId || "") === batchId) setPrintJob((current) => current ? { ...current, warehouseStatus: result.batch?.warehouseStatus || status } : current)
      toast.success(result.message || `Shipping batch marked ${status}.`)
      await load(true)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update the batch status.") }
    finally { setBusyId("") }
  }

  const recordSavedPdf = async () => {
    if (!printJob?.id) return
    try {
      const result = await api<{ message?: string; printJob?: Record<string, any> }>(`/api/fulfillment/print-queue/${encodeURIComponent(String(printJob.id))}/saved-pdf`, { method: "POST", body: "{}" })
      if (result.printJob) setPrintJob(result.printJob)
      toast.success(result.message || "Batch marked Saved PDF.")
      await load(true)
    } catch (error) { toast.error(error instanceof Error ? error.message : "The PDF downloaded, but its saved status could not be recorded.") }
  }

  return <div className="grid gap-5">
    <PageHeader eyebrow="Fulfillment / Shipping batches" title="Shipping batches" description="Review label purchases and print history without loading the live fulfillment queues." action={<div className="flex gap-2"><Button variant="outline" asChild><a href="/fulfillment"><ArrowLeft className="size-4" /> Fulfillment</a></Button><Button size="icon" variant="outline" title="Refresh shipping batches" disabled={loading} onClick={() => void load()}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}</Button></div>} />
    <Card>
      <CardHeader className="gap-3 border-b md:flex-row md:items-end md:justify-between"><div><CardTitle>Batch history</CardTitle><CardDescription>{numberLabel(Number(data.total || 0))} purchase batches. Search by batch, order, customer, or SKU.</CardDescription></div><form className="flex w-full gap-2 md:w-auto" onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(queryDraft.trim()) }}><div className="relative min-w-0 flex-1 md:w-80"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" value={queryDraft} onChange={(event) => setQueryDraft(event.target.value)} onPaste={(event) => normalizePastedSearch(event, queryDraft, setQueryDraft)} placeholder="Batch, order, customer, or SKU" /></div><Button type="submit" variant="outline">Search</Button></form></CardHeader>
      <CardContent className="grid gap-4 p-0">
        {batches.map((batch) => {
          const rows = Array.isArray(batch.rows) ? batch.rows as Array<Record<string, any>> : []
          const job = printQueue.find((entry) => String(entry.batchId || "") === String(batch.id || ""))
          const busy = busyId === String(batch.id || "")
          return <section key={String(batch.id)} className="border-b last:border-b-0">
            {batch.sourceBatchNumber ? <div className="px-4 pt-3"><RecoverySourceLabel record={batch} fallback={job} /></div> : null}
            <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex flex-wrap items-center gap-2">{job ? <button type="button" className="font-semibold hover:underline" onClick={() => openBatchPrintModal(job, batch)}>{String(batch.batchNumber || "Shipping batch")}</button> : <h2 className="font-semibold">{String(batch.batchNumber || "Shipping batch")}</h2>}<Badge variant={Number(batch.counts?.failed || 0) > 0 ? "destructive" : Number(batch.counts?.purchased || 0) > 0 ? "success" : "outline"}>{String(batch.status || "queued").replaceAll("_", " ")}</Badge><Badge variant={String(batch.warehouseStatus || "open") === "closed" ? "success" : "warning"}>{String(batch.warehouseStatus || "open") === "closed" ? "Closed" : "Open"}</Badge>{String(job?.lastOutputAction || batch.lastOutputAction || "") === "saved_pdf" ? <Badge variant="secondary"><FileDown className="mr-1 size-3" /> Saved PDF</Badge> : Number(job?.printCount || batch.labelPrintCount || 0) > 0 ? <Badge variant="outline"><Printer className="mr-1 size-3" /> Printed</Badge> : null}</div><p className="mt-1 text-xs text-muted-foreground">Created {dateLabel(String(batch.createdAt || batch.updatedAt || ""))} · {numberLabel(Number(batch.counts?.purchased || 0))} purchased · {numberLabel(Number(batch.counts?.failed || 0))} failed · {numberLabel(Number(job?.printCount || batch.labelPrintCount || 0))} prints · {numberLabel(Number(job?.savedPdfCount || batch.labelPdfSaveCount || 0))} PDF saves</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!Number(batch.counts?.purchased || 0)} onClick={() => window.open(`/api/fulfillment/label-batches/${encodeURIComponent(String(batch.id))}/pick-sheet`, "_blank", "noopener,noreferrer")}><ListChecks className="size-4" /> Pick sheet</Button><Button size="sm" variant="outline" disabled={busy || !Number(batch.counts?.purchased || 0)} onClick={() => void updateBatchHandlingStatus(String(batch.id || ""), String(batch.warehouseStatus || "open") === "closed" ? "open" : "closed")}>{busy ? <Loader2 className="size-4 animate-spin" /> : String(batch.warehouseStatus || "open") === "closed" ? <RotateCcw className="size-4" /> : <CheckCircle2 className="size-4" />} {String(batch.warehouseStatus || "open") === "closed" ? "Reopen batch" : "Close batch"}</Button>{Number(batch.counts?.failed || 0) > 0 ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void runBatchAction(batch, "retry")}><RotateCcw className="size-4" /> Retry failed</Button> : null}{Number(batch.counts?.rated || 0) + Number(batch.counts?.queued || 0) > 0 ? <Button size="sm" disabled={busy} onClick={() => void runBatchAction(batch, "purchase")}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />} Buy ready labels</Button> : null}{job && Number(job.documentCount || batch.counts?.purchased || 0) > 0 ? <Button size="sm" onClick={() => openBatchPrintModal(job, batch)}><Printer className="size-4" /> {Number(job.printCount || 0) > 0 ? "Open & reprint" : "Open & print"}</Button> : null}</div></div>
            <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Customer</TableHead><TableHead>SKUs</TableHead><TableHead>Label status</TableHead><TableHead>Carrier / service</TableHead><TableHead className="text-right">Cost</TableHead></TableRow></TableHeader><TableBody>{rows.map((row, index) => <TableRow key={`${String(row.orderId || row.orderNumber)}:${index}`}><TableCell><a className="font-medium text-primary hover:underline" href={`/orders/${encodeURIComponent(String(row.orderId || row.orderNumber || ""))}`}>{String(row.orderNumber || row.orderId)}</a></TableCell><TableCell><p className="max-w-56 truncate" title={String(row.customer || "")}>{String(row.customer || "Customer unavailable")}</p></TableCell><TableCell><div className="flex max-w-80 flex-wrap gap-1">{(row.skus || []).map((sku: string) => <a key={sku} href={`/products/${encodeURIComponent(sku)}`}><Badge variant="outline" className="font-mono hover:bg-muted">{sku}</Badge></a>)}</div></TableCell><TableCell><Badge variant={row.status === "purchased" ? "success" : row.status === "failed" ? "destructive" : row.status === "label_pending" ? "warning" : "outline"}>{row.status === "purchased" ? "Purchased" : String(row.status || "pending").replaceAll("_", " ")}</Badge>{row.error ? <p className="mt-1 max-w-80 text-xs text-destructive">{String(row.error)}</p> : null}</TableCell><TableCell>{row.selectedRate ? <><p className="font-medium">{String(row.selectedRate.carrier || "Carrier")}</p><p className="text-xs text-muted-foreground">{String(row.selectedRate.service || "Service")}</p></> : "-"}</TableCell><TableCell className="text-right tabular-nums">{row.selectedRate ? moneyLabel(Number(row.shippingCost ?? row.selectedRate.amount ?? 0)) : "-"}</TableCell></TableRow>)}{!rows.length ? <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">No orders are stored in this batch.</TableCell></TableRow> : null}</TableBody></Table></div>
          </section>
        })}
        {!loading && !batches.length ? <Empty className="min-h-56"><EmptyHeader><EmptyMedia variant="icon"><Truck className="size-4" /></EmptyMedia><EmptyTitle>No matching shipping batches</EmptyTitle><EmptyDescription>Try another batch number, order, customer, or SKU.</EmptyDescription></EmptyHeader></Empty> : null}
      </CardContent>
    </Card>
    <div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">Page {numberLabel(Number(data.page || page))} of {numberLabel(Number(data.totalPages || 1))}</p><div className="flex gap-2"><Button variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button><Button variant="outline" disabled={page >= Number(data.totalPages || 1) || loading} onClick={() => setPage((current) => current + 1)}>Next</Button></div></div>
    <Dialog open={Boolean(printJob)} onOpenChange={(open) => !open && setPrintJob(null)}><DialogContent className="flex h-[92dvh] max-w-5xl flex-col gap-0 overflow-hidden p-0"><DialogHeader className="border-b p-4 pr-12"><DialogTitle>{String(printJob?.printNumber || printJob?.batchNumber || "Print labels")}</DialogTitle><DialogDescription>This packet contains purchased labels only. Printing it does not buy another label or close the warehouse batch.</DialogDescription></DialogHeader><div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-4 py-3"><div><p className="text-sm font-medium">Warehouse batch status</p><p className="text-xs text-muted-foreground">Close only after the physical labels are in hand and this batch has been handled.</p></div><Select value={String(printJobBatch?.warehouseStatus || printJob?.warehouseStatus || "open")} onValueChange={(value) => void updateBatchHandlingStatus(String(printJob?.batchId || ""), value as "open" | "closed")} disabled={!printJob?.batchId || busyId === String(printJob?.batchId || "")}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="open">Open</SelectItem><SelectItem value="closed">Closed</SelectItem></SelectContent></Select></div><div className="min-h-0 flex-1 bg-muted/30 p-3">{printJob?.id ? <iframe ref={printFrameRef} src={`/api/fulfillment/print-queue/${encodeURIComponent(String(printJob.id))}/document.pdf`} title="Purchased shipping labels" className="h-full min-h-[420px] w-full rounded-md border bg-white" /> : null}</div><DialogFooter className="border-t p-4"><Button variant="outline" onClick={() => setPrintJob(null)}>Close</Button>{printJob?.id ? <Button variant="outline" asChild><a href={`/api/fulfillment/print-queue/${encodeURIComponent(String(printJob.id))}/document.pdf`} download={`${String(printJob.printNumber || "shipping-labels")}.pdf`} onClick={() => void recordSavedPdf()}><FileDown className="size-4" /> Download PDF</a></Button> : null}<Button disabled={busyId === String(printJob?.id || "")} onClick={() => void printInBrowser()}>{busyId === String(printJob?.id || "") ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />} Print in browser</Button></DialogFooter></DialogContent></Dialog>
  </div>
}

export function FulfillmentPage() {
  const [data, setData] = useState<Record<string, any>>({ work: [], allWork: [], batches: [], printQueue: [], printStations: [], shipments: [], doNotShip: [], exceptions: [], manifests: [], reports: {}, settings: {} })
  const fulfillmentTabMountedRef = useRef(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [tab, setFulfillmentTab] = useState("ready")
  const setTab = (next: string) => {
    if (next === "batches") window.location.assign("/fulfillment/batches")
    else setFulfillmentTab(next)
  }
  const [status, setStatus] = useState("all")
  const [query, setQuery] = useState("")
  const [searchDraft, setSearchDraft] = useState("")
  const [workSort, setWorkSort] = useState("order_date_asc")
  const [workPage, setWorkPage] = useState(1)
  const [workPageSize, setWorkPageSize] = useState(25)
  const [visibleWorkColumns, setVisibleWorkColumns] = useState<Set<string>>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("dataplus:fulfillment-columns:v2") || "[]") as string[]
      return new Set(saved.length ? saved : fulfillmentWorkColumnOptions.map(([id]) => id))
    } catch { return new Set(fulfillmentWorkColumnOptions.map(([id]) => id)) }
  })
  const [hiddenChannels, setHiddenChannels] = useState<Set<string>>(new Set())
  const [allocationFilter, setAllocationFilter] = useState("all")
  const [deadlineFilter, setDeadlineFilter] = useState("all")
  const [consolidationFilter, setConsolidationFilter] = useState("all")
  const [selectedSkuFilters, setSelectedSkuFilters] = useState<Set<string>>(new Set())
  const [selectedRouteIds, setSelectedRouteIds] = useState<Set<string>>(new Set())
  const [rateRefreshProgress, setRateRefreshProgress] = useState<{ active: boolean; items: FulfillmentRateRefreshItem[]; jobNumber?: number; message?: string }>({ active: false, items: [] })
  const [rateStatusOpen, setRateStatusOpen] = useState(false)
  const rateRefreshSelectionKeyRef = useRef("")
  const [latestRateAuthorization, setLatestRateAuthorization] = useState<{ selectionKey: string; routeIds: Set<string> }>({ selectionKey: "", routeIds: new Set() })
  const [rateRefreshJobId, setRateRefreshJobId] = useState(() => window.localStorage.getItem("dataplus:fulfillment-rate-refresh-job") || "")
  const [labelPurchaseJobId, setLabelPurchaseJobId] = useState(() => window.localStorage.getItem("dataplus:fulfillment-label-purchase-job") || "")
  const [packageRow, setPackageRow] = useState<Record<string, unknown> | null>(null)
  const [packageRouteIds, setPackageRouteIds] = useState<string[]>([])
  const [packageDraft, setPackageDraft] = useState({ packageWeight: "", packageLength: "", packageWidth: "", packageHeight: "" })
  const [savePackageAsDefault, setSavePackageAsDefault] = useState(false)
  const [packageShipAlone, setPackageShipAlone] = useState(false)
  const [saveShipAloneAsDefault, setSaveShipAloneAsDefault] = useState(false)
  const [exceptionRecord, setExceptionRecord] = useState<Record<string, any> | null>(null)
  const [exceptionRow, setExceptionRow] = useState<Record<string, any> | null>(null)
  const [shadowQuery, setShadowQuery] = useState("")
  const [shadowResults, setShadowResults] = useState<ProductItem[]>([])
  const [shadowSearching, setShadowSearching] = useState(false)
  const [shadowTargetSku, setShadowTargetSku] = useState("")
  const [shadowUnitsPerPack, setShadowUnitsPerPack] = useState("1")
  const [resolutionDraft, setResolutionDraft] = useState({ warehouseId: "", name: "", phone: "", line1: "", line2: "", city: "", state: "", postalCode: "", country: "US", packageWeight: "", packageLength: "", packageWidth: "", packageHeight: "" })
  const [batchOpen, setBatchOpen] = useState(() => Boolean(window.localStorage.getItem("dataplus:fulfillment-label-purchase-job")))
  const [batchDraft, setBatchDraft] = useState({ batchNumber: "", labelFormat: "PDF", printSize: "4x6", includePackingSlips: true, packingSlipOrientation: "portrait" })
  const [batchRecoveryOpen, setBatchRecoveryOpen] = useState(false)
  const [labelPurchaseProgress, setLabelPurchaseProgress] = useState<{
    active: boolean
    total: number
    purchased: number
    failed: number
    pending: number
    batchNumber: string
    message: string
  } | null>(null)
  const [bulkShipDate, setBulkShipDate] = useState(new Date().toISOString().slice(0, 10))
  const [purchasedPrintJobs, setPurchasedPrintJobs] = useState<Array<Record<string, any>>>([])
  const [pendingPrintRecovery, setPendingPrintRecovery] = useState<{ batchId: string } | null>(null)
  const [labelAdminPin, setLabelAdminPin] = useState("")
  const [labelAdminPinRequest, setLabelAdminPinRequest] = useState<Record<string, any> | null>(null)
  const [settingsDraft, setSettingsDraft] = useState<Record<string, any>>({})
  const [manifestDraft, setManifestDraft] = useState({ carrier: "", shipDate: new Date().toISOString().slice(0, 10) })
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false)
  const [purchasedLabelFilter, setPurchasedLabelFilter] = useState("all")
  const [purchasedCarrierFilter, setPurchasedCarrierFilter] = useState("all")
  const [purchasedSupplierFilter, setPurchasedSupplierFilter] = useState("all")
  const [purchasedSkuFilter, setPurchasedSkuFilter] = useState("all")
  const [purchasedChannelFilter, setPurchasedChannelFilter] = useState("all")
  const [purchasedLabelSourceFilter, setPurchasedLabelSourceFilter] = useState("all")
  const [purchasedChannelSyncFilter, setPurchasedChannelSyncFilter] = useState("all")
  const [printBatchPickerOpen, setPrintBatchPickerOpen] = useState(false)
  const [printBatchSearch, setPrintBatchSearch] = useState("")
  const [doNotShipFilter, setDoNotShipFilter] = useState("all")
  const [consolidationOrder, setConsolidationOrder] = useState<Record<string, any> | null>(null)
  const [consolidationCandidates, setConsolidationCandidates] = useState<Array<Record<string, any>>>([])
  const [consolidationSelection, setConsolidationSelection] = useState<Set<string>>(new Set())
  const [consolidationLoading, setConsolidationLoading] = useState(false)
  const [consolidationPreviewLoading, setConsolidationPreviewLoading] = useState(false)
  const [consolidationCartonization, setConsolidationCartonization] = useState<Record<string, any> | null>(null)
  const [quickViewRows, setQuickViewRows] = useState<Array<Record<string, any>>>([])
  const printPreviewFrameRef = useRef<HTMLIFrameElement>(null)
  const [printJobPreview, setPrintJobPreview] = useState<Record<string, any> | null>(null)
  const [printPacketPreviewOpen, setPrintPacketPreviewOpen] = useState(false)
  const [printPacketPreviewLoading, setPrintPacketPreviewLoading] = useState(false)
  const [printDocumentMode, setPrintDocumentMode] = useState("packing-4x6")
  const [packingSlipOrientation, setPackingSlipOrientation] = useState("portrait")
  const [previewPrintDestination, setPreviewPrintDestination] = useState("browser")
  const [previewPrintPrinter, setPreviewPrintPrinter] = useState("")
  const [printPreference, setPrintPreference] = useState({ destination: "browser", printerName: "" })
  const [printPreferenceLoaded, setPrintPreferenceLoaded] = useState(false)
  const printPacketFrameRef = useRef<HTMLIFrameElement>(null)
  const [dispatchPrintJob, setDispatchPrintJob] = useState<Record<string, any> | null>(null)
  const [dispatchStationId, setDispatchStationId] = useState("")
  const [dispatchPrinter, setDispatchPrinter] = useState("")
  const [pairStationOpen, setPairStationOpen] = useState(false)
  const [pairStationName, setPairStationName] = useState("Warehouse desktop")
  const [pairingResult, setPairingResult] = useState<Record<string, any> | null>(null)
  const [printStationToRemove, setPrintStationToRemove] = useState<Record<string, any> | null>(null)
  const [testPrintStation, setTestPrintStation] = useState<Record<string, any> | null>(null)
  const [testPrintDraft, setTestPrintDraft] = useState({ printerName: "", size: "4x6", includePackingSlips: false })
  const automaticRateStatusRef = useRef("")
  const stages = ["all", "late", "label_ready", "Ready to ship", "exception"]
  const normalizeWorkRows = (source: unknown): Array<Record<string, any>> => Array.isArray(source) ? (source as Array<Record<string, any>>).map((row): Record<string, any> => {
    const workflowStatus = String(row.status || "")
    const operationalStatus = String(row.operationalStatus || "")
    const terminalStatus = [workflowStatus, operationalStatus].find((value) => ["shipped", "fulfilled", "closed", "expired", "canceled", "cancelled"].includes(value.toLowerCase()))
    const displayStatus = terminalStatus
      ? terminalStatus.toLowerCase()
      : workflowStatus === "exception"
      ? "exception"
      : String(row.allocationStatus || "").toLowerCase() === "allocated"
        ? "Ready to ship"
        : workflowStatus === "ready_to_ship"
          ? "label_ready"
          : workflowStatus
    return { ...row, workflowStatus, status: displayStatus, displayStatus }
  }) : []
  const consoleCounts = data.counts && typeof data.counts === "object" ? data.counts as Record<string, number> : {}
  const pendingRows = normalizeWorkRows(data.work).filter((row) => {
    if (row.historyOnly === true) return false
    const statuses = [row.status, row.operationalStatus].map((value) => String(value || "").toLowerCase())
    return !statuses.some((value) => ["shipped", "fulfilled", "closed", "delivered", "expired", "canceled", "cancelled", "void", "voided"].includes(value))
  })
  const allShipmentRows = normalizeWorkRows(Array.isArray(data.allWork) ? data.allWork : data.work).filter((row) => {
    const statuses = [row.status, row.operationalStatus, row.warehouseStage, row.paymentStatus]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean)
    if (statuses.some((value) => ["canceled", "cancelled", "void", "voided", "deleted", "refunded", "fully_refunded", "expired"].includes(value))) return false
    if (!statuses.some((value) => ["shipped", "fulfilled", "closed", "delivered"].includes(value))) return true
    const shipment = row.shipment && typeof row.shipment === "object" ? row.shipment as Record<string, unknown> : {}
    const activityAt = String(row.shippedAt || row.carrierConfirmedAt || shipment.shippedAt || shipment.carrierConfirmedAt || shipment.labelPurchasedAt || shipment.createdAt || shipment.updatedAt || row.orderDate || "")
    const timestamp = new Date(activityAt || 0).getTime()
    return Number.isFinite(timestamp) && timestamp > 0 && Date.now() - timestamp >= 0 && Date.now() - timestamp <= 30 * 24 * 60 * 60 * 1000
  })
  const rows = tab === "all-shipments" ? allShipmentRows : pendingRows
  const channelOptions = [...new Set(rows.map((row) => String(row.channel || "Unassigned").trim() || "Unassigned"))].sort((left, right) => left.localeCompare(right))
  const allBatches = Array.isArray(data.batches) ? data.batches as Array<Record<string, any>> : []
  const batches = allBatches.filter((batch) => String(batch.phase || "rates") === "purchase" || Number(batch.counts?.purchased || 0) > 0)
  const printQueue = Array.isArray(data.printQueue) ? data.printQueue as Array<Record<string, any>> : []
  const isPrintedJob = (row: Record<string, any>) => row.status === "printed" || row.deliveryStatus === "printed" || Boolean(row.printedAt)
  const unprintedPrintQueue = printQueue.filter((row) => row.kind !== "test_page" && !isPrintedJob(row))
  const printStations = Array.isArray(data.printStations) ? data.printStations as Array<Record<string, any>> : []
  const windowsPrintAgentCommand = pairingResult?.pairingCode
    ? `$p="$env:TEMP\\DataPlusPrintAgent.ps1"; Invoke-WebRequest "${window.location.origin}/api/fulfillment/print-agent/windows.ps1" -OutFile $p; powershell.exe -ExecutionPolicy Bypass -File $p -Install -PairCode '${String(pairingResult.pairingCode).replaceAll("'", "''")}' -ServerUrl '${window.location.origin.replaceAll("'", "''")}' -StationName '${pairStationName.replaceAll("'", "''")}'`
    : ""
  const testPrintPreviewUrl = testPrintStation?.id
    ? `/api/fulfillment/print-stations/${encodeURIComponent(String(testPrintStation.id))}/test-preview.pdf?size=${encodeURIComponent(testPrintDraft.size)}&includePackingSlips=${testPrintDraft.includePackingSlips ? "1" : "0"}&printerName=${encodeURIComponent(testPrintDraft.printerName)}`
    : ""
  const printPacketBaseUrl = printJobPreview?.packetUrl || (printJobPreview?.id ? `/api/fulfillment/print-queue/${encodeURIComponent(String(printJobPreview.id))}/document.pdf` : "")
  const printPacketSettings = printDocumentMode === "packing-letter" ? { size: "letter", packingSlips: "1", packingSlipOrientation } : printDocumentMode === "packing-4x6" ? { size: "4x6", packingSlips: "1", packingSlipOrientation } : { size: "4x6", packingSlips: "0", packingSlipOrientation }
  const printPacketUrl = printPacketBaseUrl ? `${printPacketBaseUrl}${printPacketBaseUrl.includes("?") ? "&" : "?"}${new URLSearchParams(printPacketSettings).toString()}` : ""
  const previewPrintStation = printStations.find((station) => String(station.id) === previewPrintDestination)
  const printJobPreviewBatch = allBatches.find((batch) => String(batch.id || "") === String(printJobPreview?.batchId || ""))
  const shipments = Array.isArray(data.shipments) ? data.shipments as Array<Record<string, any>> : []
  const activeShipments = shipments.filter((row) => row.voidStatus !== "voided" && (row.trackingNumber || ["label_pending", "purchase_processing", "label_purchased", "purchased", "shipped", "fulfilled", "in_transit", "delivered"].includes(String(row.status || "").toLowerCase()) || (Array.isArray(row.documents) && row.documents.some((document: Record<string, unknown>) => document.documentType === "shipping_label" || document.documentId))))
  const purchasedLabelQueue = activeShipments.filter((row) => {
    const hasPurchasedLabel = ["label_pending", "purchase_processing", "label_purchased", "purchased"].includes(String(row.status || "").toLowerCase())
      || (Array.isArray(row.documents) && row.documents.some((document: Record<string, unknown>) => document.documentType === "shipping_label" || document.documentId))
    return hasPurchasedLabel && ["label_generating", "awaiting_pickup", "delayed"].includes(String(row.trackingStatus || "awaiting_pickup").toLowerCase())
  })
  const purchasedCarrierOptions = fulfillmentCountedFilterOptions(purchasedLabelQueue, (row) => [String(row.carrierName || row.carrier || "Unknown carrier")])
  const purchasedSupplierOptions = fulfillmentCountedFilterOptions(purchasedLabelQueue, fulfillmentShipmentSuppliers)
  const purchasedSkuOptions = fulfillmentCountedFilterOptions(purchasedLabelQueue, fulfillmentShipmentSkus)
  const purchasedChannelOptions = fulfillmentCountedFilterOptions(purchasedLabelQueue, (row) => [String(row.channel || "Unassigned")])
  const purchasedLabelSourceOptions = fulfillmentCountedFilterOptions(purchasedLabelQueue, (row) => [fulfillmentFilterValue(row.labelSource) === "dataplus" ? "DataPlus" : "Marketplace"])
  const purchasedChannelSyncOptions = fulfillmentCountedFilterOptions(purchasedLabelQueue, (row) => [{ confirmed: "Confirmed", failed: "Failed", pending: "Pending" }[fulfillmentChannelSyncState(row)] || "Pending"])
  const purchasedFiltersActive = [purchasedLabelFilter, purchasedCarrierFilter, purchasedSupplierFilter, purchasedSkuFilter, purchasedChannelFilter, purchasedLabelSourceFilter, purchasedChannelSyncFilter].some((value) => value !== "all")
  const clearPurchasedLabelFilters = () => {
    setPurchasedLabelFilter("all")
    setPurchasedCarrierFilter("all")
    setPurchasedSupplierFilter("all")
    setPurchasedSkuFilter("all")
    setPurchasedChannelFilter("all")
    setPurchasedLabelSourceFilter("all")
    setPurchasedChannelSyncFilter("all")
  }
  const unprintedPurchasedLabelCount = Number(consoleCounts.unprintedPurchasedLabels ?? purchasedLabelQueue.filter((row) => !fulfillmentShipmentPrinted(row)).length)
  const displayedPurchasedLabels = purchasedLabelQueue.filter((row) => {
    if (!matchesFulfillmentDeadlineFilter(row, deadlineFilter) || !matchesFulfillmentSearch(row, query)) return false
    const printed = fulfillmentShipmentPrinted(row)
    if (purchasedLabelFilter === "printed" && !printed) return false
    if (purchasedLabelFilter === "unprinted" && printed) return false
    if (purchasedCarrierFilter !== "all" && fulfillmentFilterValue(row.carrierName || row.carrier || "Unknown carrier") !== purchasedCarrierFilter) return false
    if (purchasedSupplierFilter !== "all" && !fulfillmentShipmentSuppliers(row).some((value) => fulfillmentFilterValue(value) === purchasedSupplierFilter)) return false
    if (purchasedSkuFilter !== "all" && !fulfillmentShipmentSkus(row).some((value) => fulfillmentFilterValue(value) === purchasedSkuFilter)) return false
    if (purchasedChannelFilter !== "all" && fulfillmentFilterValue(row.channel || "Unassigned") !== purchasedChannelFilter) return false
    const source = fulfillmentFilterValue(row.labelSource) === "dataplus" ? "dataplus" : "marketplace"
    if (purchasedLabelSourceFilter !== "all" && source !== purchasedLabelSourceFilter) return false
    if (purchasedChannelSyncFilter !== "all" && fulfillmentChannelSyncState(row) !== purchasedChannelSyncFilter) return false
    return true
  })
  const printableBatchJobs = useMemo<Array<Record<string, any> & { searchText: string }>>(() => {
    const shipmentsByPrintJob = new Map<string, Array<Record<string, any>>>()
    for (const shipment of shipments) {
      const printJobId = String(shipment.printJobId || "")
      if (!printJobId) continue
      const related = shipmentsByPrintJob.get(printJobId) || []
      related.push(shipment)
      shipmentsByPrintJob.set(printJobId, related)
    }
    const batchesById = new Map(allBatches.map((batch) => [String(batch.id || ""), batch]))
    return printQueue
      .filter((job) => job.kind !== "test_page" && Number(job.documentCount || 0) > 0 && String(job.status || "") !== "waiting_for_labels")
      .map((job) => {
        const relatedShipments = shipmentsByPrintJob.get(String(job.id || "")) || []
        const batch = batchesById.get(String(job.batchId || ""))
        const batchRows = Array.isArray(batch?.rows) ? batch.rows as Array<Record<string, any>> : []
        const customers = [...new Set([...relatedShipments, ...batchRows].map((row) => String(row.customer || row.customerName || row.destination?.name || "").trim()).filter(Boolean))]
        const skus = [...new Set([...relatedShipments, ...batchRows].flatMap((row) => {
          const values = Array.isArray(row.skus) ? row.skus : [row.sku, row.catalogSku, row.parentSku, row.selectedSku]
          return values.map((value) => String(value || "").trim()).filter(Boolean)
        }))]
        const orders = [...new Set([...relatedShipments, ...batchRows].map((row) => String(row.orderNumber || row.orderId || "").trim()).filter(Boolean))]
        const searchText = [job.batchNumber, job.printNumber, ...customers, ...skus, ...orders].join(" ").toLowerCase()
        return { ...job, warehouseStatus: String(batch?.warehouseStatus || "open"), searchText } as Record<string, any> & { searchText: string }
      })
      .sort((left, right) => new Date(String(right.createdAt || right.updatedAt || 0)).getTime() - new Date(String(left.createdAt || left.updatedAt || 0)).getTime())
  }, [allBatches, printQueue, shipments])
  const filteredPrintableBatchJobs = printableBatchJobs.filter((job) => job.searchText.includes(printBatchSearch.trim().toLowerCase()))
  const shippedQueue = activeShipments.filter((row) => ["in_transit", "delivered"].includes(String(row.trackingStatus || "").toLowerCase()))
  const displayedShippedQueue = shippedQueue.filter((row) => matchesFulfillmentDeadlineFilter(row, deadlineFilter) && matchesFulfillmentSearch(row, query))
  const doNotShipQueue = Array.isArray(data.doNotShip) ? data.doNotShip as Array<Record<string, any>> : []
  const displayedDoNotShipQueue = doNotShipQueue.filter((row) => {
    if (!matchesFulfillmentDeadlineFilter(row, deadlineFilter)) return false
    if (doNotShipFilter !== "all" && String(row.kind || "") !== doNotShipFilter) return false
    return matchesFulfillmentSearch(row, query)
  })
  const exceptions = Array.isArray(data.exceptions) ? data.exceptions as Array<Record<string, any>> : []
  const displayedExceptions = exceptions.filter((row) => matchesFulfillmentDeadlineFilter(row, deadlineFilter) && matchesFulfillmentSearch(row, query))
  const trackingRefresh = data.trackingRefresh && typeof data.trackingRefresh === "object" ? data.trackingRefresh as Record<string, any> : null
  const trackingFailureCount = Number(consoleCounts.trackingFailures ?? exceptions.filter((row) => row.type === "tracking").length)
  const manifests = Array.isArray(data.manifests) ? data.manifests as Array<Record<string, any>> : []
  const warehouses = Array.isArray(data.warehouses) ? data.warehouses as Array<Record<string, any>> : []

  const load = async (fresh = false, quiet = false, requestedView = tab) => {
    const requestStarted = window.performance.now()
    if (!quiet) setLoading(true)
    try {
      const params = new URLSearchParams({ view: requestedView })
      if (fresh) params.set("fresh", "1")
      if (requestedView === "all-shipments") {
        params.set("paged", "1")
        params.set("page", String(workPage))
        params.set("pageSize", String(workPageSize))
        params.set("q", query)
        params.set("status", status)
        params.set("allocation", allocationFilter)
        params.set("consolidation", consolidationFilter)
        params.set("deadline", deadlineFilter)
        params.set("sort", workSort)
        for (const channel of hiddenChannels) params.append("hiddenChannel", channel)
        for (const sku of selectedSkuFilters) params.append("sku", sku)
      }
      const result = await api<Record<string, any>>(`/api/fulfillment/console?${params.toString()}`)
      const apiCompletedAt = window.performance.now()
      setData((current) => ({ ...current, ...result }))
      if (result.settings) setSettingsDraft(result.settings)
      const activeRouteIds = new Set((Array.isArray(result.work) ? result.work : []).map((row: Record<string, any>) => String(row.id || "")).filter(Boolean))
      setSelectedRouteIds((current) => {
        const next = new Set([...current].filter((routeId) => activeRouteIds.has(routeId)))
        return next.size === current.size ? current : next
      })
      const rowCount = [result.work, result.allWork, result.shipments, result.exceptions, result.doNotShip, result.batches]
        .reduce((total, rows) => total + (Array.isArray(rows) ? rows.length : 0), 0)
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        const committedAt = window.performance.now()
        reportFulfillmentClientPerformance({
          view: requestedView,
          apiMs: apiCompletedAt - requestStarted,
          renderMs: committedAt - apiCompletedAt,
          totalMs: committedAt - requestStarted,
          rowCount,
          quiet,
          fresh,
        })
      }))
      if (result.snapshotStale) window.setTimeout(() => void load(false, true), 2500)
      return result
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load fulfillment work.")
      return null
    } finally {
      if (!quiet) setLoading(false)
    }
  }

  const loadConsolidationCartonization = async (row: Record<string, any>, orderIds: string[]) => {
    if (!orderIds.length) { setConsolidationCartonization(null); return }
    setConsolidationPreviewLoading(true)
    try {
      const result = await api<{ preview?: Record<string, any> }>(`/api/orders/${encodeURIComponent(String(row.orderId || ""))}/shipment-group/cartonization-preview`, { method: "POST", body: JSON.stringify({ orderIds }) })
      setConsolidationCartonization(result.preview || null)
    } catch (error) {
      setConsolidationCartonization({ status: "blocked", reason: error instanceof Error ? error.message : "Unable to calculate a carton plan.", cartons: [] })
    } finally { setConsolidationPreviewLoading(false) }
  }

  const updateConsolidationSelection = (id: string, checked: boolean) => {
    setConsolidationSelection((current) => {
      const next = new Set(current)
      if (checked) next.add(id); else next.delete(id)
      if (consolidationOrder) void loadConsolidationCartonization(consolidationOrder, [...next])
      return next
    })
  }

  const openShipmentConsolidation = async (row: Record<string, any>) => {
    setConsolidationOrder(row)
    setConsolidationCandidates([])
    setConsolidationSelection(new Set())
    setConsolidationCartonization(null)
    setConsolidationLoading(true)
    try {
      const result = await api<{ eligible?: boolean; reason?: string; candidates?: Array<Record<string, any>> }>(`/api/orders/${encodeURIComponent(String(row.orderId || ""))}/shipment-group-candidates`)
      if (result.eligible === false) throw new Error(result.reason || "This order cannot be combined yet.")
      const candidates = result.candidates || []
      const candidateIds = candidates.map((candidate) => String(candidate.id || "")).filter(Boolean)
      setConsolidationCandidates(candidates)
      setConsolidationSelection(new Set(candidateIds))
      await loadConsolidationCartonization(row, candidateIds)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to find orders that can ship together.")
      setConsolidationOrder(null)
    } finally {
      setConsolidationLoading(false)
    }
  }

  const saveShipmentConsolidation = async () => {
    if (!consolidationOrder || !consolidationSelection.size) return
    setConsolidationLoading(true)
    try {
      const result = await api<{ message?: string }>(`/api/orders/${encodeURIComponent(String(consolidationOrder.orderId || ""))}/shipment-group`, { method: "POST", body: JSON.stringify({ orderIds: [...consolidationSelection], user: "Luis" }) })
      setConsolidationOrder(null)
      await load(false, true)
      toast.success(result.message || "Orders grouped for one shipment.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to group these orders.")
    } finally {
      setConsolidationLoading(false)
    }
  }

  const showPurchasedPrintPackets = (responseJobs: Array<Record<string, any>>, refreshedData: Record<string, any> | null, batchId: string, printRequestId = "") => {
    const savedJobs = (Array.isArray(refreshedData?.printQueue) ? refreshedData.printQueue : []).filter((job: Record<string, any>) => {
      if (printRequestId) return String(job.printRequestId || "") === printRequestId
      return String(job.batchId || "") === batchId
    })
    const jobs = [...responseJobs, ...savedJobs].reduce((unique, job) => {
      const id = String(job?.id || "")
      if (id && !unique.some((entry: Record<string, any>) => String(entry.id || "") === id)) unique.push(job)
      return unique
    }, [] as Array<Record<string, any>>)
    if (jobs.length >= 1) {
      const printJob = jobs[0]
      window.setTimeout(() => openPrintPreview(printJob), 0)
    } else {
      toast.warning("The labels were purchased, but the print packet is still being prepared. Open Purchased labels to print it.")
    }
  }

  useEffect(() => { void load(false, false, "ready") }, [])
  useEffect(() => {
    void api<{ preference?: { destination?: string; printerName?: string } }>("/api/fulfillment/print-preference")
      .then((result) => setPrintPreference({ destination: String(result.preference?.destination || "browser"), printerName: String(result.preference?.printerName || "") }))
      .catch(() => setPrintPreference({ destination: "browser", printerName: "" }))
      .finally(() => setPrintPreferenceLoaded(true))
  }, [])
  useEffect(() => {
    if (!printPreferenceLoaded) return
    const station = printStations.find((entry) => entry.status === "active" && String(entry.id) === printPreference.destination)
    const destination = station ? String(station.id) : "browser"
    const printerName = station && (station.printers || []).includes(printPreference.printerName)
      ? printPreference.printerName
      : String(station?.defaultPrinter || station?.printers?.[0] || "")
    setPreviewPrintDestination(destination)
    setPreviewPrintPrinter(printerName)
  }, [printPreferenceLoaded, printPreference.destination, printPreference.printerName, data.printStations])
  useEffect(() => {
    if (!fulfillmentTabMountedRef.current) {
      fulfillmentTabMountedRef.current = true
      return
    }
    if (tab !== "all-shipments") void load(false, false, tab)
  }, [tab])
  useEffect(() => {
    if (tab !== "all-shipments") return
    void load(false, false, "all-shipments")
  }, [tab, workPage, workPageSize, status, query, workSort, allocationFilter, consolidationFilter, deadlineFilter, hiddenChannels, selectedSkuFilters])
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(false, true, tab)
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [tab])
  useEffect(() => {
    if (!rateRefreshJobId) return
    let canceled = false
    let timer = 0
    const poll = async () => {
      try {
        const response = await api<{ job: ImportJob }>(`/api/import-jobs/${encodeURIComponent(rateRefreshJobId)}`)
        if (canceled) return
        const job = response.job
        const results = Array.isArray(job.rateRefreshResults) ? job.rateRefreshResults : []
        const resultsByOrder = new Map(results.map((result) => [String(result.orderId || ""), result]))
        const targets = Array.isArray(job.rateRefreshTargets) && job.rateRefreshTargets.length
          ? job.rateRefreshTargets
          : results
        const active = ["queued", "running"].includes(String(job.status || "").toLowerCase())
        const items = targets.map((target) => {
          const result = resultsByOrder.get(String(target.orderId || ""))
          const review = result?.review
          const resultStatus = String(result?.status || review?.rowStatus || "").toLowerCase()
          const status: FulfillmentRateRefreshItem["status"] = result
            ? resultStatus === "blocked" ? "blocked" : resultStatus === "failed" ? "failed" : resultStatus === "purchased" ? "recorded" : review?.selectedRate ? "rated" : "failed"
            : active && String(job.status || "").toLowerCase() === "running" ? "checking" : "queued"
          return {
            ...target,
            status,
            selectedRate: review?.selectedRate || result?.selectedRate || null,
            error: String(result?.error || review?.error || ""),
          }
        })
        setRateRefreshProgress({ active, items, jobNumber: job.jobNumber, message: job.message })
        const reviewsByRoute = new Map<string, Record<string, any>>()
        for (const result of results) {
          if (!result.review) continue
          for (const routeId of result.routeIds || []) reviewsByRoute.set(String(routeId), result.review)
        }
        if (reviewsByRoute.size) setData((current) => ({
          ...current,
          work: (Array.isArray(current.work) ? current.work : []).map((row: Record<string, any>) => reviewsByRoute.has(String(row.id)) ? { ...row, rateReview: reviewsByRoute.get(String(row.id)) } : row),
        }))
        if (active) {
          timer = window.setTimeout(poll, 2000)
        } else {
          if (rateRefreshSelectionKeyRef.current) {
            setLatestRateAuthorization({
              selectionKey: rateRefreshSelectionKeyRef.current,
              routeIds: new Set(items.flatMap((item) => item.routeIds.map(String))),
            })
          }
          await load(false, true)
          if (["failed", "warning"].includes(String(job.status || "").toLowerCase())) toast.warning(job.message || "Rate check finished with items needing attention.")
          else toast.success(job.message || "Shipping rates are ready.")
        }
      } catch (error) {
        if (!canceled) timer = window.setTimeout(poll, 5000)
      }
    }
    void poll()
    return () => { canceled = true; window.clearTimeout(timer) }
  }, [rateRefreshJobId])
  useEffect(() => {
    if (!labelPurchaseJobId) return
    let canceled = false
    let timer = 0
    const poll = async () => {
      try {
        const response = await api<{ job: ImportJob }>(`/api/import-jobs/${encodeURIComponent(labelPurchaseJobId)}`)
        if (canceled) return
        const job = response.job
        const status = String(job.status || "").toLowerCase()
        const active = ["queued", "running"].includes(status)
        const counts = job.labelPurchaseCounts || {}
        const failed = Number(counts.failed || 0) + Number(counts.blocked || 0) + Number(counts.skipped || 0) + Number(counts.superseded || 0)
        setLabelPurchaseProgress({
          active,
          total: Number(counts.total || job.totalRows || 0),
          purchased: Number(counts.purchased || job.changed || 0),
          failed,
          pending: Number(counts.label_pending || 0),
          batchNumber: String(job.labelPurchaseBatchNumber || ""),
          message: String(job.message || (active ? "Purchasing carrier labels" : "Label purchase finished")),
        })
        if (active) {
          timer = window.setTimeout(poll, 1500)
          return
        }
        window.localStorage.removeItem("dataplus:fulfillment-label-purchase-job")
        setLabelPurchaseJobId("")
        const refreshedData = await load(false, true)
        const printJobs = (Array.isArray(refreshedData?.printQueue) ? refreshedData.printQueue : []).filter((entry: Record<string, any>) => String(entry.id || "") === String(job.printJobId || ""))
        setSelectedRouteIds(new Set())
        setPurchasedLabelFilter("unprinted")
        setTab("purchased-labels")
        if (Number(counts.label_pending || 0) > 0 && job.labelPurchaseBatchId) setPendingPrintRecovery({ batchId: String(job.labelPurchaseBatchId) })
        else if (printJobs.length) showPurchasedPrintPackets(printJobs, refreshedData, String(job.labelPurchaseBatchId || ""), String(job.printRequestId || ""))
        if (status === "failed") toast.error(job.message || "Shipping-label purchase failed.")
        else if (status === "warning") toast.warning(job.message || "Label purchase finished with items needing attention.")
        else toast.success(job.message || "Shipping labels purchased and ready to print.")
      } catch {
        if (!canceled) timer = window.setTimeout(poll, 4000)
      }
    }
    void poll()
    return () => { canceled = true; window.clearTimeout(timer) }
  }, [labelPurchaseJobId])
  useEffect(() => {
    if (!pendingPrintRecovery?.batchId) return
    let canceled = false
    let timer = 0
    const check = async () => {
      try {
        const result = await api<Record<string, any>>("/api/fulfillment/console?view=purchased-labels&fresh=1")
        if (canceled) return
        setData(result)
        setSettingsDraft(result.settings || {})
        const batch = (Array.isArray(result.batches) ? result.batches : []).find((entry: Record<string, any>) => String(entry.id || "") === pendingPrintRecovery.batchId)
        const pending = Number(batch?.counts?.label_pending || 0)
        const printJob = (Array.isArray(result.printQueue) ? result.printQueue : []).find((entry: Record<string, any>) => String(entry.batchId || "") === pendingPrintRecovery.batchId)
        if (pending === 0 && printJob?.id) {
          setPendingPrintRecovery(null)
          setPurchasedLabelFilter("unprinted")
          setTab("purchased-labels")
          openPrintPreview(printJob)
          toast.success(`${String(printJob.batchNumber || "Shipping batch")} labels are ready to print.`)
          return
        }
      } catch {
        // Keep polling while Temu finishes generating an accepted package's document.
      }
      if (!canceled) timer = window.setTimeout(check, 10000)
    }
    timer = window.setTimeout(check, 10000)
    return () => { canceled = true; window.clearTimeout(timer) }
  }, [pendingPrintRecovery?.batchId])
  useEffect(() => { window.localStorage.setItem("dataplus:fulfillment-columns:v2", JSON.stringify([...visibleWorkColumns])) }, [visibleWorkColumns])
  useEffect(() => {
    let canceled = false
    let timer = 0
    const check = async () => {
      try {
        const response = await api<{ job?: ImportJob | null; intervalMinutes?: number }>("/api/fulfillment/rates/status")
        if (canceled || !response.job) return
        const job = response.job
        const status = String(job.status || "").toLowerCase()
        const key = `${job.id}:${status}:${job.finishedAt || job.updatedAt || ""}`
        const previousKey = automaticRateStatusRef.current
        automaticRateStatusRef.current = key
        if (previousKey && key !== previousKey && ["success", "warning", "failed"].includes(status)) {
          await load(false, true)
          toast.info(status === "success" ? "Fresh shipping rates are now available." : "The automatic rate refresh finished with orders needing attention.")
        } else if (!previousKey && ["success", "warning"].includes(status)) {
          await load(false, true)
        }
      } catch {
        // The next lightweight status check will reconcile completed background rates.
      } finally {
        if (!canceled) timer = window.setTimeout(check, 15_000)
      }
    }
    void check()
    return () => { canceled = true; window.clearTimeout(timer) }
  }, [])
  useEffect(() => {
    const search = shadowQuery.trim()
    if (!exceptionRecord || exceptionRecord.type !== "missing_catalog_product" || search.length < 2) { setShadowResults([]); return }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setShadowSearching(true)
      api<{ inventory?: ProductItem[] }>(`/api/inventory?q=${encodeURIComponent(search)}&limit=10&fastPage=1`)
        .then((result) => { if (!cancelled) setShadowResults(result.inventory || []) })
        .catch(() => { if (!cancelled) setShadowResults([]) })
        .finally(() => { if (!cancelled) setShadowSearching(false) })
    }, 180)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [shadowQuery, exceptionRecord])

  const terminalFulfillmentStatuses = new Set(["shipped", "fulfilled", "closed", "expired", "canceled", "cancelled"])
  const isTerminalFulfillmentRow = (row: Record<string, unknown>) => terminalFulfillmentStatuses.has(String(row.status || "").toLowerCase()) || terminalFulfillmentStatuses.has(String(row.operationalStatus || "").toLowerCase())
  const includeTerminalRows = tab === "all-shipments"
  const matchesFulfillmentStage = (row: Record<string, any>, stage: string) => stage === "all"
    ? includeTerminalRows || !isTerminalFulfillmentRow(row)
    : stage === "late"
      ? (includeTerminalRows || !isTerminalFulfillmentRow(row)) && fulfillmentDeadlineState(row) === "late"
      : String(row.displayStatus || row.status) === stage
  const lateShipmentCount = rows.filter((row) => matchesFulfillmentStage(row, "late")).length
  const baseFilteredWork = rows.filter((row) =>
    matchesFulfillmentStage(row, status) &&
    !hiddenChannels.has(String(row.channel || "Unassigned").trim() || "Unassigned") &&
    (allocationFilter === "all" || String(row.allocationStatus || "unallocated") === allocationFilter) &&
    (consolidationFilter === "all" || (consolidationFilter === "candidates" ? Number(row.shipmentConsolidation?.candidateCount || 0) > 0 : Boolean(row.shipmentGroupId))) &&
    matchesFulfillmentDeadlineFilter(row, deadlineFilter) &&
    matchesFulfillmentSearch(row, query),
  )
  const filteredWork = baseFilteredWork.filter((row) => {
    if (!selectedSkuFilters.size) return true
    const sku = String(row.sku || row.catalogSku || "Missing SKU").trim().toLowerCase() || "missing sku"
    return selectedSkuFilters.has(sku)
  }).sort((left, right) => {
    const direction = workSort.endsWith("_desc") ? -1 : 1
    const leftValue = workSort.startsWith("sku") ? String(left.sku || "") : workSort.startsWith("deadline") ? String(fulfillmentDeadlineTimestamp(left) ?? Number.MAX_SAFE_INTEGER) : String(left.orderDate || left.createdAt || "")
    const rightValue = workSort.startsWith("sku") ? String(right.sku || "") : workSort.startsWith("deadline") ? String(fulfillmentDeadlineTimestamp(right) ?? Number.MAX_SAFE_INTEGER) : String(right.orderDate || right.createdAt || "")
    return leftValue.localeCompare(rightValue, undefined, { numeric: true, sensitivity: "base" }) * direction || String(left.orderNumber || left.orderId || "").localeCompare(String(right.orderNumber || right.orderId || ""), undefined, { numeric: true })
  })
  const filteredWorkGroups = [...filteredWork.reduce((groups, row) => {
    const key = `${String(row.orderId || row.orderNumber || row.id)}:${String(row.packageGroupKey || "combined")}`
    groups.set(key, [...(groups.get(key) || []), row])
    return groups
  }, new Map<string, Array<Record<string, any>>>() ).values()]
  const allShipmentsServerPaged = tab === "all-shipments" && Number.isFinite(Number(data.total))
  const filteredWorkTotal = allShipmentsServerPaged ? Number(data.total || 0) : filteredWorkGroups.length
  const workPageCount = Math.max(1, allShipmentsServerPaged ? Number(data.totalPages || Math.ceil(filteredWorkTotal / workPageSize)) : Math.ceil(filteredWorkGroups.length / workPageSize))
  const currentWorkPage = Math.min(workPage, workPageCount)
  const workPageStart = (currentWorkPage - 1) * workPageSize
  const shownGroups = allShipmentsServerPaged ? filteredWorkGroups : filteredWorkGroups.slice(workPageStart, workPageStart + workPageSize)
  const shown = shownGroups.flat()
  const skuGroups = [...baseFilteredWork.reduce((groups, row) => {
    const sku = String(row.sku || row.catalogSku || "Missing SKU").trim() || "Missing SKU"
    const key = sku.toLowerCase()
    const existing = groups.get(key) || {
      sku,
      image: String(row.productImage || ""),
      title: String(row.productTitle || row.title || sku),
      brand: String(row.productBrand || ""),
      supplier: String(row.supplierName || "Internal stock"),
      routeByOrder: new Map<string, { id: string; score: number }>(),
      orderIds: new Set<string>(),
      allocatedOrderIds: new Set<string>(),
    }
    const orderId = String(row.orderId || row.orderNumber || row.id)
    const routeScore = (String(row.allocationStatus || "") === "allocated" ? 100 : String(row.allocationStatus || "") === "partial" ? 50 : 0)
      + (String(row.routeType || "") === "warehouse" ? 20 : 0)
      + (Number(row.qty || 0) > 0 ? 10 : 0)
      + (row.labelReadiness?.ready === true ? 5 : 0)
    const currentRoute = existing.routeByOrder.get(orderId)
    if (!currentRoute || routeScore > currentRoute.score) existing.routeByOrder.set(orderId, { id: String(row.id), score: routeScore })
    existing.orderIds.add(orderId)
    if (String(row.allocationStatus || "") === "allocated") existing.allocatedOrderIds.add(orderId)
    groups.set(key, existing)
    return groups
  }, new Map<string, { sku: string; image: string; title: string; brand: string; supplier: string; routeByOrder: Map<string, { id: string; score: number }>; orderIds: Set<string>; allocatedOrderIds: Set<string> }>()).values()].map((group) => ({
    sku: group.sku,
    image: group.image,
    title: group.title,
    brand: group.brand,
    supplier: group.supplier,
    routeIds: [...group.routeByOrder.values()].map((route) => route.id),
    orderCount: group.orderIds.size,
    allocatedOrderCount: group.allocatedOrderIds.size,
  })).sort((left, right) => right.orderCount - left.orderCount || left.sku.localeCompare(right.sku, undefined, { numeric: true, sensitivity: "base" }))
  useEffect(() => { setWorkPage(1) }, [tab, status, query, workPageSize, workSort, allocationFilter, consolidationFilter, deadlineFilter, hiddenChannels, selectedSkuFilters])
  useEffect(() => { if (workPage > workPageCount) setWorkPage(workPageCount) }, [workPage, workPageCount])
  const readinessFor = (row: Record<string, unknown>) => (row.labelReadiness || {}) as Record<string, unknown>
  const showWorkColumn = (id: string) => visibleWorkColumns.has(id)
  const visibleWorkColumnCount = fulfillmentWorkColumnOptions.filter(([id]) => showWorkColumn(id)).length + 2
  const nextStage = (_current: string) => ""

  const advance = async (row: Record<string, unknown>, next: string) => {
    setBusy(true)
    try {
      await api(`/api/orders/${encodeURIComponent(String(row.orderId))}/workflow-routes/${encodeURIComponent(String(row.id))}/status`, { method: "POST", body: JSON.stringify({ status: next }) })
      toast.success(`Work moved to ${next.replace(/_/g, " ")}.`)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update fulfillment work.")
    } finally {
      setBusy(false)
    }
  }

  const createPickList = async () => {
    setBusy(true)
    try {
      const result = await api<{ pickList?: Record<string, unknown>; message?: string }>("/api/fulfillment/pick-lists", { method: "POST", body: JSON.stringify({ routeIds: [...selectedRouteIds], pickingMode: settingsDraft.defaultPickingMode }) })
      toast.success(`${result.message || "Pick list created."} ${String(result.pickList?.pickListNumber || "")}`)
      setSelectedRouteIds(new Set())
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to create fulfillment batch.")
    } finally {
      setBusy(false)
    }
  }

  const processBatch = async (batchId: string, mode: "rates" | "purchase", confirmOverLimit = false, selectionMode = "", keepReadyToShipContext = false, adminPin = "") => {
    if (mode === "rates" && batchId.startsWith("route:")) {
      const routeId = batchId.slice("route:".length)
      setBusy(true)
      setData((current) => ({
        ...current,
        work: (Array.isArray(current.work) ? current.work : []).map((workRow: Record<string, any>) => String(workRow.id) === routeId ? {
          ...workRow,
          rateReview: { source: "background", rowStatus: "processing", selectedRate: null, rates: [], notice: "Requesting live carrier rates." },
        } : workRow),
      }))
      try {
        const result = await api<{ message?: string }>("/api/fulfillment/rates/refresh", { method: "POST", body: JSON.stringify({ routeIds: [routeId], selectionMode: selectionMode || "cheapest" }) })
        toast.success(result.message || "Shipping rates refreshed.")
        await load(false, true)
      } catch (error) {
        setData((current) => ({
          ...current,
          work: (Array.isArray(current.work) ? current.work : []).map((workRow: Record<string, any>) => String(workRow.id) === routeId ? {
            ...workRow,
            rateReview: { source: "background", rowStatus: "failed", selectedRate: null, rates: [], error: error instanceof Error ? error.message : "Unable to refresh shipping rates." },
          } : workRow),
        }))
        toast.error(error instanceof Error ? error.message : "Unable to refresh shipping rates.")
      } finally { setBusy(false) }
      return
    }
    if (mode === "purchase") {
      const batch = allBatches.find((entry) => String(entry.id || "") === batchId)
      const routeIds = [...new Set((Array.isArray(batch?.rows) ? batch.rows : [])
        .filter((row: Record<string, any>) => ["rated", "queued"].includes(String(row.status || "")))
        .flatMap((row: Record<string, any>) => Array.isArray(row.routeIds) ? row.routeIds.map(String) : [String(row.routeId || "")])
        .filter(Boolean))]
      if (!routeIds.length) {
        toast.info("This batch has no rated labels waiting to be purchased.")
        return
      }
      setBatchOpen(true)
      setBusy(true)
      setLabelPurchaseProgress({ active: true, total: routeIds.length, purchased: 0, failed: 0, pending: 0, batchNumber: String(batch?.batchNumber || ""), message: "Queueing carrier label purchase" })
      try {
        const printRequestId = crypto.randomUUID()
        const queued = await api<{ job: ImportJob; batch?: Record<string, any>; message?: string }>(`/api/fulfillment/label-batches/${encodeURIComponent(batchId)}/process-jobs`, { method: "POST", body: JSON.stringify({ routeIds, printRequestId, adminPin, confirmOverLimit }) })
        const jobId = String(queued.job?.id || "")
        if (!jobId) throw new Error("The background label-purchase job was not created.")
        window.localStorage.setItem("dataplus:fulfillment-label-purchase-job", jobId)
        setLabelPurchaseJobId(jobId)
        setLabelPurchaseProgress((current) => current ? { ...current, total: Number(queued.batch?.counts?.total || current.total), message: queued.message || "Shipping-label purchase queued" } : current)
        toast.success(`${String(batch?.batchNumber || "Shipping batch")} started. You can leave this page while labels are purchased.`)
      } catch (error) {
        const payload = (error as Error & { payload?: Record<string, unknown> })?.payload
        if (payload?.requiresAdminPin === true) {
          setLabelAdminPin("")
          setLabelAdminPinRequest({ kind: "batch", batchId, confirmOverLimit, selectionMode, keepReadyToShipContext, orderNumbers: payload.orderNumbers })
        }
        setLabelPurchaseProgress((current) => current ? { ...current, active: false, message: "Label purchase stopped" } : current)
        toast.error(error instanceof Error ? error.message : "Unable to queue the label purchase.")
      } finally { setBusy(false) }
      return
    }
    setBusy(true)
    try {
      const printJobs: Array<Record<string, any>> = []
      const printRequestId = ""
      let remaining = 1
      let pendingDocuments = 0
      let loops = 0
      while (remaining > 0 && loops < 30) {
        const result = await api<{ remaining?: number; pendingDocuments?: number; message?: string; printJob?: Record<string, any> }>(`/api/fulfillment/label-batches/${encodeURIComponent(batchId)}/process`, { method: "POST", body: JSON.stringify({ mode, confirmOverLimit, selectionMode, refreshRates: mode === "rates" && loops === 0 && selectionMode === "cheapest", printRequestId, adminPin }) })
        remaining = Number(result.remaining || 0)
        pendingDocuments = Number(result.pendingDocuments || 0)
        if (result.printJob?.id && !printJobs.some((job) => String(job.id) === String(result.printJob?.id))) printJobs.push(result.printJob)
        loops += 1
        if (remaining > 0 && pendingDocuments > 0) await new Promise((resolve) => window.setTimeout(resolve, 2000))
      }
      const refreshedData = await load()
      const hasPurchasedPackets = printJobs.length > 0
      toast.success(hasPurchasedPackets ? "Existing channel labels are ready to print." : "Shipping rates are ready for review.")
      if (pendingDocuments === 0 && hasPurchasedPackets) showPurchasedPrintPackets(printJobs, refreshedData, batchId, printRequestId)
      if (hasPurchasedPackets) setPurchasedLabelFilter("unprinted")
      if (!keepReadyToShipContext) {
        if (hasPurchasedPackets) setTab("purchased-labels")
        else window.location.assign("/fulfillment/batches")
      }
    } catch (error) {
      const payload = (error as Error & { payload?: Record<string, unknown> })?.payload
      if (payload?.requiresAdminPin === true) {
        setLabelAdminPin("")
        setLabelAdminPinRequest({ kind: "batch", batchId, confirmOverLimit, selectionMode, keepReadyToShipContext, orderNumbers: payload.orderNumbers })
      }
      toast.error(error instanceof Error ? error.message : "Unable to process the rate and label batch.")
      await load()
    } finally {
      setBusy(false)
    }
  }

  const retryReleasedBatch = async (batchId: string) => {
    setBusy(true)
    try {
      const result = await api<{ retried?: number; message?: string }>(`/api/fulfillment/label-batches/${encodeURIComponent(batchId)}/retry-released`, { method: "POST", body: JSON.stringify({}) })
      toast.success(result.message || "Released labels reopened in the same batch.")
      await load(false, true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to reopen this shipping batch.")
      return
    } finally {
      setBusy(false)
    }
    await processBatch(batchId, "rates", false, "cheapest")
  }

  const refreshRatesForRows = async (targetRows: Array<Record<string, any>>, quiet = false) => {
    const targets = [...targetRows.reduce((grouped, row) => {
      const orderId = String(row.orderId || "")
      const routeId = String(row.id || "")
      if (!orderId || !routeId) return grouped
      const current = grouped.get(orderId) || {
        orderId,
        orderNumber: String(row.orderNumber || orderId),
        channel: String(row.channel || row.source || ""),
        rateLane: String(row.channel || row.source || "").toLowerCase() === "temu" ? "temu" as const : String(row.channel || row.source || "").toLowerCase() === "shopify" ? "shopify" as const : "veeqo" as const,
        routeIds: [],
        skus: [],
        status: "queued" as const,
      }
      if (!current.routeIds.includes(routeId)) current.routeIds.push(routeId)
      const sku = String(row.sku || row.catalogSku || "Missing SKU")
      if (!current.skus.includes(sku)) current.skus.push(sku)
      grouped.set(orderId, current)
      return grouped
    }, new Map<string, FulfillmentRateRefreshItem>()).values()]
    if (!targets.length) return
    if (!quiet) {
      setBusy(true)
      const selectedRouteIdSet = new Set(targets.flatMap((item) => item.routeIds))
      setRateRefreshProgress({ active: true, items: targets, message: "Queueing carrier rate refresh." })
      setData((current) => ({
        ...current,
        work: (Array.isArray(current.work) ? current.work : []).map((workRow: Record<string, any>) => selectedRouteIdSet.has(String(workRow.id)) ? {
          ...workRow,
          rateReview: { source: "background", rowStatus: "queued", selectedRate: null, rates: [], notice: "Waiting for the carrier rate check." },
        } : workRow),
      }))
      try {
        const response = await api<{ job: ImportJob; message?: string }>("/api/fulfillment/rates/refresh-jobs", {
          method: "POST",
          body: JSON.stringify({ routeIds: targets.flatMap((item) => item.routeIds), targets, selectionMode: "cheapest" }),
        })
        const jobId = String(response.job?.id || "")
        if (!jobId) throw new Error("The rate refresh job was not created.")
        window.localStorage.setItem("dataplus:fulfillment-rate-refresh-job", jobId)
        setRateRefreshJobId(jobId)
        setRateRefreshProgress({ active: true, items: targets, jobNumber: response.job.jobNumber, message: response.message || response.job.message })
        toast.success(`Rate refresh${response.job.jobNumber ? ` JOB-${response.job.jobNumber}` : ""} started. You can leave this page while it runs.`)
      } catch (error) {
        setRateRefreshProgress((current) => ({ ...current, active: false, items: current.items.map((item) => ({ ...item, status: "failed", error: error instanceof Error ? error.message : "Unable to queue shipping rates." })) }))
        toast.error(error instanceof Error ? error.message : "Unable to queue shipping rates.")
      } finally {
        setBusy(false)
      }
      return
    }
    if (!quiet) setBusy(true)
    if (!quiet) {
      const selectedRouteIdSet = new Set(targets.flatMap((item) => item.routeIds))
      setRateRefreshProgress({ active: true, items: targets })
      setData((current) => ({
        ...current,
        work: (Array.isArray(current.work) ? current.work : []).map((workRow: Record<string, any>) => selectedRouteIdSet.has(String(workRow.id)) ? {
          ...workRow,
          rateReview: { source: "background", rowStatus: "queued", selectedRate: null, rates: [], notice: "Waiting for the carrier rate check." },
        } : workRow),
      }))
    }
    let failed = 0
    try {
      const buildChunks = (laneTargets: FulfillmentRateRefreshItem[], maxOrders: number) => {
        const chunks: FulfillmentRateRefreshItem[][] = []
        let chunk: FulfillmentRateRefreshItem[] = []
        let chunkRouteCount = 0
        for (const target of laneTargets) {
          if (chunk.length && (chunk.length >= maxOrders || chunkRouteCount + target.routeIds.length > 8)) {
            chunks.push(chunk)
            chunk = []
            chunkRouteCount = 0
          }
          chunk.push(target)
          chunkRouteCount += target.routeIds.length
        }
        if (chunk.length) chunks.push(chunk)
        return chunks
      }
      const processChunk = async (currentChunk: FulfillmentRateRefreshItem[]) => {
        const chunkOrderIds = new Set(currentChunk.map((item) => item.orderId))
        const chunkRouteIds = new Set(currentChunk.flatMap((item) => item.routeIds))
        if (!quiet) {
          setRateRefreshProgress((current) => ({ ...current, items: current.items.map((item) => chunkOrderIds.has(item.orderId) ? { ...item, status: "checking", error: "" } : item) }))
          setData((current) => ({
            ...current,
            work: (Array.isArray(current.work) ? current.work : []).map((workRow: Record<string, any>) => chunkRouteIds.has(String(workRow.id)) ? {
              ...workRow,
              rateReview: { source: "background", rowStatus: "processing", selectedRate: null, rates: [], notice: "Requesting live carrier rates." },
            } : workRow),
          }))
        }
        try {
          const result = await api<{ results?: Array<{ orderId?: string; routeIds?: string[]; status?: string; error?: string; review?: Record<string, any> }> }>("/api/fulfillment/rates/refresh", { method: "POST", body: JSON.stringify({ routeIds: currentChunk.flatMap((item) => item.routeIds), selectionMode: "cheapest" }) })
          const refreshedByOrder = new Map((result.results || []).map((item) => [String(item.orderId || ""), item]))
          const reviewByRoute = new Map<string, Record<string, any>>()
          for (const target of currentChunk) {
            const refreshed = refreshedByOrder.get(target.orderId)
            const review = refreshed?.review
            const rowStatus = String(refreshed?.status || review?.rowStatus || "failed").toLowerCase()
            const status: FulfillmentRateRefreshItem["status"] = rowStatus === "blocked" ? "blocked" : rowStatus === "failed" ? "failed" : rowStatus === "purchased" ? "recorded" : review?.selectedRate ? "rated" : "failed"
            if (status === "failed" || status === "blocked") failed += 1
            if (review) target.routeIds.forEach((routeId) => reviewByRoute.set(routeId, review))
            if (!quiet) setRateRefreshProgress((current) => ({
              ...current,
              items: current.items.map((item) => item.orderId === target.orderId ? { ...item, status, selectedRate: review?.selectedRate || null, error: String(refreshed?.error || review?.error || "") } : item),
            }))
          }
          if (reviewByRoute.size) setData((current) => ({
            ...current,
            work: (Array.isArray(current.work) ? current.work : []).map((workRow: Record<string, any>) => reviewByRoute.has(String(workRow.id)) ? { ...workRow, rateReview: reviewByRoute.get(String(workRow.id)) } : workRow),
          }))
        } catch (error) {
          failed += currentChunk.length
          if (!quiet) setRateRefreshProgress((current) => ({
            ...current,
            items: current.items.map((item) => chunkOrderIds.has(item.orderId) ? { ...item, status: "failed", error: error instanceof Error ? error.message : "Unable to refresh shipping rates." } : item),
          }))
        }
      }
      const lanes = [...targets.reduce((grouped, target) => {
        const lane = grouped.get(target.rateLane) || []
        lane.push(target)
        grouped.set(target.rateLane, lane)
        return grouped
      }, new Map<FulfillmentRateRefreshItem["rateLane"], FulfillmentRateRefreshItem[]>()).entries()]
      await Promise.all(lanes.map(async ([laneName, laneTargets]) => {
        const maxOrders = laneName === "temu" ? 2 : 4
        for (const currentChunk of buildChunks(laneTargets, maxOrders)) await processChunk(currentChunk)
      }))
      if (!quiet) toast.success(failed ? `Rate refresh finished with ${failed} order${failed === 1 ? "" : "s"} needing attention.` : `Shipping rates refreshed for ${targets.length} order${targets.length === 1 ? "" : "s"}.`)
      await load(false, true)
    } finally {
      if (!quiet) {
        setBusy(false)
        setRateRefreshProgress((current) => ({ ...current, active: false }))
      }
    }
  }

  const refreshSelectedRates = async () => {
    if (!selectedRateReadyRows.length) {
      toast.error("None of the selected shipments are ready for rates. Add the missing package or address details first.")
      return
    }
    if (selectedRateSkippedCount > 0) {
      toast.info(`Refreshing ${selectedRateReadyRows.length} ready shipment${selectedRateReadyRows.length === 1 ? "" : "s"}; skipping ${selectedRateSkippedCount} that ${selectedRateSkippedCount === 1 ? "is" : "are"} not ready.`)
    }
    rateRefreshSelectionKeyRef.current = [...selectedRouteIds].sort().join("|")
    setLatestRateAuthorization({ selectionKey: "", routeIds: new Set() })
    await refreshRatesForRows(selectedRateReadyRows)
  }

  const updateRateChoice = async (row: Record<string, any>, patch: Record<string, unknown>): Promise<boolean> => {
    const selectedRateId = String(patch.selectedRateId || "")
    const selectedRate = (Array.isArray(row.rateReview?.rates) ? row.rateReview.rates : []).find((rate: Record<string, unknown>) => String(rate.id || "") === selectedRateId)
    if (!selectedRate) return false

    setData((current) => ({
      ...current,
      work: (Array.isArray(current.work) ? current.work : []).map((workRow: Record<string, any>) => String(workRow.id) === String(row.id)
        ? { ...workRow, rateReview: { ...workRow.rateReview, selectedRate } }
        : workRow),
    }))
    try {
      await api(`/api/fulfillment/rates/${encodeURIComponent(String(row.id))}`, { method: "PATCH", body: JSON.stringify(patch) })
      toast.success("Shipping choice saved.")
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save the shipping choice.")
      await load(false, true)
      return false
    }
  }

  const applySelectedShipDate = async () => {
    const ratedRows = selectedRows.filter((row) => row.rateReview?.selectedRate)
    if (!ratedRows.length) return
    setBusy(true)
    try {
      await Promise.all(ratedRows.map((row) => api(`/api/fulfillment/rates/${encodeURIComponent(String(row.id))}`, { method: "PATCH", body: JSON.stringify({ shipDate: bulkShipDate }) })))
      await load(false, true)
      toast.success(`Ship date updated for ${ratedRows.length} order${ratedRows.length === 1 ? "" : "s"}.`)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update the ship date.") } finally { setBusy(false) }
  }

  const buySelectedLabels = async (adminPin = "") => {
    if (labelPurchaseProgress?.active) {
      setBatchOpen(true)
      return
    }
    if (!selectedPurchaseEligibleRows.length) {
      toast.error("None of the selected shipments have both a saved rate and complete shipment details.")
      return
    }
    if (selectedPurchaseSkippedCount > 0) {
      toast.info(`Buying ${selectedPurchaseEligiblePackages.length} ready label${selectedPurchaseEligiblePackages.length === 1 ? "" : "s"}; skipping ${selectedPurchaseSkippedCount} ineligible shipment${selectedPurchaseSkippedCount === 1 ? "" : "s"}.`)
    }
    const confirmOverLimit = selectedPurchaseEligiblePackages.some((row) => row.rateReview?.requiresCostConfirmation === true)
      ? window.confirm("At least one selected label is above the configured cost limit. Create the batch and purchase anyway?")
      : false
    if (selectedPurchaseEligiblePackages.some((row) => row.rateReview?.requiresCostConfirmation === true) && !confirmOverLimit) return
    setBatchOpen(true)
    setBusy(true)
    setLabelPurchaseProgress({ active: true, total: selectedPurchaseEligiblePackages.length, purchased: 0, failed: 0, pending: 0, batchNumber: "", message: "Creating shipping batch" })
    let batchId = ""
    try {
      const purchaseRouteIds = selectedPurchaseEligibleRows.map((row) => String(row.id))
      const created = await api<{ batch?: Record<string, any>; message?: string }>("/api/fulfillment/label-batches", { method: "POST", body: JSON.stringify({ routeIds: purchaseRouteIds, ...batchDraft, useSavedRates: true }) })
      batchId = String(created.batch?.id || "")
      if (!batchId) throw new Error("The shipping batch was created without an ID.")
      setBatchDraft((current) => ({ ...current, batchNumber: "" }))
      setBatchRecoveryOpen(false)
      setLabelPurchaseProgress((current) => current ? { ...current, batchNumber: String(created.batch?.batchNumber || ""), message: "Queueing carrier label purchase" } : current)
      const printRequestId = crypto.randomUUID()
      const queued = await api<{ job: ImportJob; batch?: Record<string, any>; message?: string }>(`/api/fulfillment/label-batches/${encodeURIComponent(batchId)}/process-jobs`, { method: "POST", body: JSON.stringify({ routeIds: purchaseRouteIds, printRequestId, adminPin, confirmOverLimit }) })
      const jobId = String(queued.job?.id || "")
      if (!jobId) throw new Error("The background label-purchase job was not created.")
      window.localStorage.setItem("dataplus:fulfillment-label-purchase-job", jobId)
      setLabelPurchaseJobId(jobId)
      setLabelPurchaseProgress((current) => current ? { ...current, total: Number(queued.batch?.counts?.total || current.total), message: queued.message || "Shipping-label purchase queued" } : current)
      toast.success(`${created.batch?.batchNumber || "Shipping batch"} started. You can leave this page while labels are purchased.`)
    } catch (error) {
      setLabelPurchaseProgress((current) => current ? { ...current, active: false, message: "Label purchase stopped" } : current)
      const payload = (error as Error & { payload?: Record<string, unknown> })?.payload
      if (payload?.requiresAdminPin === true && batchId) {
        setLabelAdminPin("")
        setLabelAdminPinRequest({ kind: "batch", batchId, confirmOverLimit, orderNumbers: payload.orderNumbers })
      } else if (batchId) {
        await api(`/api/fulfillment/label-batches/${encodeURIComponent(batchId)}/release-unstarted`, { method: "POST", body: JSON.stringify({}) }).catch(() => null)
      }
      toast.error(error instanceof Error ? error.message : "Unable to purchase the selected labels.")
      await load()
    } finally { setBusy(false) }
  }

  const exportSelected = () => {
    const columns = ["Order", "Customer", "Channel", "SKU", "Quantity", "Warehouse", "Requested delivery", "Ship by", "Package source", "Weight", "Length", "Width", "Height", "Stage"]
    const csv = [columns, ...selectedRows.map((row) => {
      const readiness = readinessFor(row)
      return [row.orderNumber || row.orderId, row.customer, row.channel, row.sku, row.qty, row.warehouseName, row.shippingService, row.shipBy, row.packageSource, readiness.weight, readiness.length, readiness.width, readiness.height, row.status]
    })].map((values) => values.map((value) => `"${String(value || "").replaceAll('"', '""')}"`).join(",")).join("\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = `fulfillment-selected-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const saveSettings = async () => {
    setBusy(true)
    try {
      const result = await api<{ settings?: Record<string, any>; message?: string }>("/api/fulfillment/settings", { method: "PUT", body: JSON.stringify(settingsDraft) })
      setSettingsDraft(result.settings || settingsDraft)
      toast.success(result.message || "Fulfillment settings saved.")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save fulfillment settings.")
    } finally { setBusy(false) }
  }

  const createManifest = async () => {
    setBusy(true)
    try {
      const result = await api<{ message?: string }>("/api/fulfillment/manifests", { method: "POST", body: JSON.stringify(manifestDraft) })
      toast.success(result.message || "Manifest created.")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to create the manifest.")
    } finally { setBusy(false) }
  }

  const openPrintPreview = (printJob: Record<string, any>) => {
    const savedPrintJob = printQueue.find((row) => String(row.id || "") === String(printJob.id || "")) || printJob
    const batch = allBatches.find((row) => String(row.id || "") === String(savedPrintJob.batchId || ""))
    setPurchasedPrintJobs([])
    setPrintDocumentMode("packing-4x6")
    setPackingSlipOrientation(savedPrintJob.packingSlipOrientation === "landscape" ? "landscape" : "portrait")
    setPrintPacketPreviewOpen(false)
    setPrintPacketPreviewLoading(false)
    setPrintJobPreview({ ...savedPrintJob, warehouseStatus: String(batch?.warehouseStatus || savedPrintJob.warehouseStatus || "open") })
  }
  const markPrinted = openPrintPreview
  const updatePrintBatchHandlingStatus = async (batchId: string, status: "open" | "closed") => {
    if (!batchId) return
    setBusy(true)
    try {
      const result = await api<{ batch?: Record<string, any>; message?: string }>(`/api/fulfillment/label-batches/${encodeURIComponent(batchId)}/handling-status`, { method: "PATCH", body: JSON.stringify({ status }) })
      if (result.batch && printJobPreview && String(printJobPreview.batchId || "") === batchId) setPrintJobPreview((current) => current ? { ...current, warehouseStatus: result.batch?.warehouseStatus || status } : current)
      toast.success(result.message || `Shipping batch marked ${status}.`)
      await load(false, true)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update the batch status.") }
    finally { setBusy(false) }
  }
  const refreshCarrierTracking = async () => {
    setBusy(true)
    try {
      const result = await api<{ message?: string; result?: Record<string, any> }>("/api/fulfillment/tracking/refresh", { method: "POST", body: JSON.stringify({ force: true, limit: 100 }) })
      if (Number(result.result?.failed || 0) > 0) toast.warning(`${result.message || "Carrier tracking refreshed."} ${numberLabel(Number(result.result?.failed || 0))} need attention.`)
      else toast.success(result.message || "Carrier tracking refreshed.")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to refresh carrier tracking.")
    } finally { setBusy(false) }
  }
  const printInBrowser = async () => {
    const job = printJobPreview
    if (!job || !printPacketUrl) return
    setBusy(true)
    try {
      if (printPacketPreviewOpen && printPacketFrameRef.current) {
        printPacketFrameRef.current.contentWindow?.focus()
        printPacketFrameRef.current.contentWindow?.print()
      } else {
        await new Promise<void>((resolve, reject) => {
          const frame = document.createElement("iframe")
          const timeout = window.setTimeout(() => {
            frame.remove()
            reject(new Error("The label packet took too long to load. Try Preview or Download PDF."))
          }, 30_000)
          frame.title = "Shipping label print packet"
          frame.setAttribute("aria-hidden", "true")
          frame.style.position = "fixed"
          frame.style.width = "1px"
          frame.style.height = "1px"
          frame.style.opacity = "0"
          frame.style.pointerEvents = "none"
          frame.onload = () => {
            window.clearTimeout(timeout)
            try {
              frame.contentWindow?.focus()
              frame.contentWindow?.print()
              resolve()
            } catch (error) {
              reject(error)
            } finally {
              window.setTimeout(() => frame.remove(), 60_000)
            }
          }
          frame.onerror = () => {
            window.clearTimeout(timeout)
            frame.remove()
            reject(new Error("Unable to load the label packet for printing."))
          }
          frame.src = printPacketUrl
          document.body.appendChild(frame)
        })
      }
      let result: { message?: string; printJob?: { channelSyncResults?: Array<{ status?: string; error?: string }> }; channelResults?: Array<{ status?: string; error?: string }>; channelResult?: { status?: string; error?: string } }
      if (job.id) result = await api(`/api/fulfillment/print-queue/${encodeURIComponent(String(job.id))}/printed`, { method: "POST", body: "{}" })
      else if (job.orderId && job.shipmentId) result = await api(`/api/orders/${encodeURIComponent(String(job.orderId))}/shipments/${encodeURIComponent(String(job.shipmentId))}/printed`, { method: "POST", body: "{}" })
      else return
      const channelResults = result.printJob?.channelSyncResults || result.channelResults || (result.channelResult ? [result.channelResult] : [])
      const failed = channelResults.filter((entry) => !["sent", "already_synced"].includes(String(entry.status || "").toLowerCase()))
      if (failed.length) toast.warning(`${result.message || "Print activity recorded."} ${failed.length} marketplace tracking update${failed.length === 1 ? "" : "s"} need attention.`)
      else toast.success(result.message || "Print activity recorded and marketplace tracking sent.")
      if (result.printJob) setPrintJobPreview((current) => current ? { ...current, ...result.printJob } : current)
      await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update print status.") }
    finally { setBusy(false) }
  }

  const recordBatchPdfSave = async () => {
    if (!printJobPreview?.id) return
    try {
      const result = await api<{ message?: string; printJob?: Record<string, any> }>(`/api/fulfillment/print-queue/${encodeURIComponent(String(printJobPreview.id))}/saved-pdf`, { method: "POST", body: "{}" })
      if (result.printJob) setPrintJobPreview(result.printJob)
      toast.success(result.message || "Batch marked Saved PDF.")
      await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : "The PDF downloaded, but its saved status could not be recorded.") }
  }

  const savePreviewPrintPreference = async (destination: string, printerName = "") => {
    const preference = { destination, printerName: destination === "browser" ? "" : printerName }
    setPrintPreference(preference)
    try {
      await api("/api/fulfillment/print-preference", { method: "PATCH", body: JSON.stringify(preference) })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save your print preference.")
    }
  }

  const choosePreviewPrintDestination = (destination: string) => {
    setPreviewPrintDestination(destination)
    const station = printStations.find((entry) => String(entry.id) === destination)
    const printerName = String(station?.defaultPrinter || station?.printers?.[0] || "")
    setPreviewPrintPrinter(printerName)
    void savePreviewPrintPreference(destination, printerName)
  }

  const sendPreviewToStation = async () => {
    if ((!printJobPreview?.id && (!printJobPreview?.orderId || !printJobPreview?.shipmentId)) || previewPrintDestination === "browser" || !previewPrintPrinter) return
    setBusy(true)
    try {
      const endpoint = printJobPreview.id
        ? `/api/fulfillment/print-queue/${encodeURIComponent(String(printJobPreview.id))}/dispatch`
        : `/api/orders/${encodeURIComponent(String(printJobPreview.orderId))}/shipments/${encodeURIComponent(String(printJobPreview.shipmentId))}/dispatch-print`
      const result = await api<{ message?: string }>(endpoint, {
        method: "POST",
        body: JSON.stringify({ stationId: previewPrintDestination, printerName: previewPrintPrinter, size: printPacketSettings.size, includePackingSlips: printPacketSettings.packingSlips === "1", packingSlipOrientation })
      })
      toast.success(result.message || "Label queued for the selected station. It will be marked printed when the desktop confirms it printed.")
      setPrintJobPreview(null)
      await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to send the packet to the print station.") }
    finally { setBusy(false) }
  }

  const openPrintDispatch = (printJob: Record<string, any>) => {
    const station = printStations.find((entry) => entry.online) || printStations.find((entry) => entry.status === "active")
    setDispatchPrintJob(printJob)
    setDispatchStationId(String(station?.id || ""))
    setDispatchPrinter(String(station?.defaultPrinter || station?.printers?.[0] || ""))
  }

  const chooseDispatchStation = (stationId: string) => {
    const station = printStations.find((entry) => String(entry.id) === stationId)
    setDispatchStationId(stationId)
    setDispatchPrinter(String(station?.defaultPrinter || station?.printers?.[0] || ""))
  }

  const dispatchToDesktop = async () => {
    if (!dispatchPrintJob?.id || !dispatchStationId || !dispatchPrinter) return
    setBusy(true)
    try {
      const result = await api<{ message?: string }>(`/api/fulfillment/print-queue/${encodeURIComponent(String(dispatchPrintJob.id))}/dispatch`, { method: "POST", body: JSON.stringify({ stationId: dispatchStationId, printerName: dispatchPrinter }) })
      toast.success(result.message || "Print packet queued for the desktop.")
      setDispatchPrintJob(null)
      await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to send the packet to the desktop.") }
    finally { setBusy(false) }
  }

  const createPairingCode = async () => {
    setBusy(true)
    try {
      const result = await api<Record<string, any>>("/api/fulfillment/print-stations/pairing", { method: "POST", body: JSON.stringify({ name: pairStationName }) })
      setPairingResult(result)
      await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to create a pairing code.") }
    finally { setBusy(false) }
  }

  const updatePrintStation = async (stationId: string, patch: Record<string, unknown>) => {
    setBusy(true)
    try {
      const result = await api<{ message?: string }>(`/api/fulfillment/print-stations/${encodeURIComponent(stationId)}`, { method: "PATCH", body: JSON.stringify(patch) })
      toast.success(result.message || "Print station updated.")
      await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update the print station.") }
    finally { setBusy(false) }
  }

  const removePrintStation = async () => {
    if (!printStationToRemove?.id) return
    setBusy(true)
    try {
      const stationId = String(printStationToRemove.id)
      const result = await api<{ message?: string }>(`/api/fulfillment/print-stations/${encodeURIComponent(stationId)}`, { method: "DELETE" })
      if (dispatchStationId === stationId) { setDispatchStationId(""); setDispatchPrinter("") }
      if (previewPrintDestination === stationId) {
        setPreviewPrintDestination("browser")
        setPreviewPrintPrinter("")
        void savePreviewPrintPreference("browser")
      }
      setPrintStationToRemove(null)
      toast.success(result.message || "Print station removed.")
      await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to remove the print station.") }
    finally { setBusy(false) }
  }

  const openPrintStationTest = (station: Record<string, any>) => {
    setTestPrintStation(station)
    setTestPrintDraft({ printerName: String(station.defaultPrinter || station.printers?.[0] || ""), size: "4x6", includePackingSlips: false })
  }

  const printStationTestPage = async () => {
    if (!testPrintStation?.id || !testPrintDraft.printerName) return
    setBusy(true)
    try {
      const result = await api<{ message?: string }>(`/api/fulfillment/print-stations/${encodeURIComponent(String(testPrintStation.id))}/test`, { method: "POST", body: JSON.stringify(testPrintDraft) })
      toast.success(result.message || "Test page queued.")
      setTestPrintStation(null)
      setTab("print")
      await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to queue the test page.") }
    finally { setBusy(false) }
  }

  const openBatchPickSheet = (batchId: string) => window.open(`/api/fulfillment/label-batches/${encodeURIComponent(batchId)}/pick-sheet`, "_blank", "noopener,noreferrer")

  const markBatchPicked = async (batch: Record<string, any>) => {
    setBusy(true)
    try {
      const result = await api<{ message?: string }>(`/api/fulfillment/label-batches/${encodeURIComponent(String(batch.id))}/picked`, { method: "POST", body: "{}" })
      toast.success(result.message || "Label batch marked picked.")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to confirm the picked batch.")
    } finally { setBusy(false) }
  }

  const openException = (exception: Record<string, any>) => {
    const routeIds = new Set([String(exception.routeId || ""), ...(Array.isArray(exception.routeIds) ? exception.routeIds.map(String) : [])].filter(Boolean))
    const matchedRow = rows.find((candidate) => routeIds.has(String(candidate.id))) || rows.find((candidate) => String(candidate.orderId) === String(exception.orderId)) || null
    const preferredWarehouse = warehouses.find((warehouse) => String(warehouse.id) === String(exception.warehouseId || ""))
      || warehouses.find((warehouse) => String(warehouse.name || "").trim().toLowerCase() === "warehouse-2")
      || warehouses[0]
    const row = matchedRow || (exception.type === "missing_catalog_product" ? {
      id: `manual-unresolved-${String(exception.orderId)}-${Number(exception.lineIndex)}`,
      orderId: exception.orderId,
      orderNumber: exception.orderNumber,
      routeType: "warehouse",
      manualLineIndex: Number(exception.lineIndex),
      manualUnresolvedSku: true,
      sku: exception.sku,
      productTitle: exception.title,
      warehouseId: exception.warehouseId || preferredWarehouse?.id || "",
      warehouseName: exception.warehouseName || preferredWarehouse?.name || "",
      destination: exception.destination || {},
      supplyLabel: "No PO",
      labelReadiness: { ready: false, blockers: ["Package measurements required"], weight: 0, length: 0, width: 0, height: 0 },
    } : null)
    if (!row) {
      setExceptionRecord(exception)
      setExceptionRow(null)
      setShadowQuery("")
      setShadowResults([])
      setShadowTargetSku("")
      return
    }
    const address = (row.destination || {}) as Record<string, unknown>
    const readiness = readinessFor(row)
    setExceptionRecord(exception)
    setExceptionRow(row)
    setResolutionDraft({
      warehouseId: String(row.warehouseId || ""),
      name: String(address.name || row.customer || ""),
      phone: String(address.phone || ""),
      line1: String(address.line1 || address.address1 || ""),
      line2: String(address.line2 || address.address2 || ""),
      city: String(address.city || address.town || ""),
      state: String(address.state || address.province || ""),
      postalCode: String(address.postalCode || address.zip || address.postcode || ""),
      country: String(address.country || address.countryCode || "US"),
      packageWeight: String(readiness.weight || ""),
      packageLength: String(readiness.length || ""),
      packageWidth: String(readiness.width || ""),
      packageHeight: String(readiness.height || ""),
    })
  }

  const resolveMissingSku = async (mode: "create" | "alias" | "shadow") => {
    if (!exceptionRecord?.orderId || Number(exceptionRecord.lineIndex) < 0) return
    const orderId = encodeURIComponent(String(exceptionRecord.orderId))
    const lineIndex = Number(exceptionRecord.lineIndex)
    const sourceSku = String(exceptionRecord.sku || "").trim()
    if (mode !== "create" && !shadowTargetSku) { toast.error("Choose the existing DataPlus product first."); return }
    setBusy(true)
    try {
      if (mode === "create") {
        await api(`/api/orders/${orderId}/items/${lineIndex}/create-sku`, { method: "POST", body: JSON.stringify({ sku: sourceSku, title: exceptionRecord.title || sourceSku, user: "Luis" }) })
      } else {
        await api(`/api/orders/${orderId}/items/${lineIndex}/map-sku`, { method: "POST", body: JSON.stringify({ targetSku: shadowTargetSku, sourceSku, shadowSku: mode === "shadow" && Number(shadowUnitsPerPack) > 1 ? `${shadowTargetSku}-${Number(shadowUnitsPerPack)}PK` : sourceSku, marketplaceSku: sourceSku, unitsPerPack: mode === "shadow" ? Math.max(1, Number(shadowUnitsPerPack) || 1) : 1, mappingType: mode, user: "Luis" }) })
      }
      await api(`/api/orders/${orderId}/route`, { method: "POST", body: JSON.stringify({ force: true, user: "Luis" }) })
      setExceptionRecord(null)
      setExceptionRow(null)
      setShadowQuery("")
      setShadowResults([])
      setShadowTargetSku("")
      setShadowUnitsPerPack("1")
      await load(false, true)
      toast.success(mode === "create" ? `${sourceSku} was created and routed.` : mode === "alias" ? `${sourceSku} is now an alias of ${shadowTargetSku}.` : `${sourceSku} now shadows ${shadowTargetSku}; current and future matching orders use the parent inventory.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to resolve the missing SKU.")
    } finally { setBusy(false) }
  }

  const clearExceptionRecord = async (resolution: string) => {
    if (!exceptionRecord || String(exceptionRecord.type || "") !== "label") return
    await api(`/api/fulfillment/exceptions/${encodeURIComponent(String(exceptionRecord.id))}/resolve`, { method: "POST", body: JSON.stringify({ resolution, user: "Luis" }) })
  }

  const saveException = async (createLabel = false) => {
    if (!exceptionRow) return
    const warehouse = warehouses.find((entry) => String(entry.id) === resolutionDraft.warehouseId)
    setBusy(true)
    try {
      const saved = await api<{ route?: Record<string, unknown> }>(`/api/orders/${encodeURIComponent(String(exceptionRow.orderId))}/fulfillment-package`, {
        method: "PATCH",
        body: JSON.stringify({
          routeId: exceptionRow.manualUnresolvedSku ? undefined : exceptionRow.id,
          createRouteForLineIndex: exceptionRow.manualUnresolvedSku ? Number(exceptionRow.manualLineIndex) : undefined,
          warehouseId: resolutionDraft.warehouseId,
          warehouseName: warehouse?.name || "",
          packageWeight: Number(resolutionDraft.packageWeight || 0),
          packageLength: Number(resolutionDraft.packageLength || 0),
          packageWidth: Number(resolutionDraft.packageWidth || 0),
          packageHeight: Number(resolutionDraft.packageHeight || 0),
          address: { name: resolutionDraft.name, phone: resolutionDraft.phone, line1: resolutionDraft.line1, line2: resolutionDraft.line2, city: resolutionDraft.city, state: resolutionDraft.state, postalCode: resolutionDraft.postalCode, country: resolutionDraft.country },
          markReady: String(exceptionRow.routeType || "warehouse") === "warehouse",
          user: "Luis",
        }),
      })
      await clearExceptionRecord("Warehouse, address, and package information corrected.")
      setExceptionRecord(null)
      setExceptionRow(null)
      await load()
      if (createLabel) {
        const savedRouteId = String(saved.route?.id || exceptionRow.id)
        setSelectedRouteIds(new Set([savedRouteId]))
        setLabelPurchaseProgress(null)
        setBatchOpen(true)
      }
      const warehouseReady = String(exceptionRow.routeType || "warehouse") === "warehouse"
      toast.success(createLabel ? "Corrections saved. Review rates to create its label." : warehouseReady ? "Exception resolved. The order is ready for a shipping label." : "Shipping details saved. The order remains in its PO supply status until inventory arrives.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to resolve this fulfillment exception.")
    } finally { setBusy(false) }
  }

  const retryExceptionRouting = async () => {
    if (!exceptionRecord?.orderId) return
    setBusy(true)
    try {
      await api(`/api/orders/${encodeURIComponent(String(exceptionRecord.orderId))}/route`, { method: "POST", body: JSON.stringify({ force: true, user: "Luis" }) })
      await clearExceptionRecord("Warehouse routing retried from Fulfillment.")
      setExceptionRecord(null)
      setExceptionRow(null)
      await load()
      toast.success("Routing refreshed. The exception queue has been updated.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to retry warehouse routing.")
    } finally { setBusy(false) }
  }

  const editPackage = (row: Record<string, unknown>) => {
    const readiness = readinessFor(row)
    setPackageRow(row)
    setPackageRouteIds([String(row.id)])
    setSavePackageAsDefault(false)
    setPackageShipAlone(row.shipAlone === true)
    setSaveShipAloneAsDefault(false)
    setPackageDraft({
      packageWeight: measurementInputValue(readiness.weight),
      packageLength: measurementInputValue(readiness.length),
      packageWidth: measurementInputValue(readiness.width),
      packageHeight: measurementInputValue(readiness.height),
    })
  }

  const editPackageGroup = (groupRows: Array<Record<string, any>>) => {
    if (!groupRows.length) return
    const row = groupRows[0]
    const readiness = readinessFor(row)
    setPackageRow(row)
    setPackageRouteIds(groupRows.map((entry) => String(entry.id || "")).filter(Boolean))
    setSavePackageAsDefault(false)
    setPackageShipAlone(false)
    setSaveShipAloneAsDefault(false)
    setPackageDraft({
      packageWeight: measurementInputValue(readiness.weight),
      packageLength: measurementInputValue(readiness.length),
      packageWidth: measurementInputValue(readiness.width),
      packageHeight: measurementInputValue(readiness.height),
    })
  }

  const editSelectedPackages = () => {
    if (!selectedRows.length) return
    const first = selectedRows[0]
    const readiness = readinessFor(first)
    setPackageRow(first)
    setPackageRouteIds(selectedRows.map((row) => String(row.id)))
    setSavePackageAsDefault(false)
    setPackageShipAlone(false)
    setSaveShipAloneAsDefault(false)
    setPackageDraft({ packageWeight: measurementInputValue(readiness.weight), packageLength: measurementInputValue(readiness.length), packageWidth: measurementInputValue(readiness.width), packageHeight: measurementInputValue(readiness.height) })
  }

  const savePackage = async () => {
    if (!packageRow) return
    setBusy(true)
    try {
      const targets = rows.filter((row) => packageRouteIds.includes(String(row.id)))
      const targetsByOrder = [...targets.reduce((groups, row) => {
        const orderId = String(row.orderId)
        groups.set(orderId, [...(groups.get(orderId) || []), row])
        return groups
      }, new Map<string, Array<Record<string, any>>>() ).values()]
      const responses = await Promise.all(targetsByOrder.map(async (orderRows) => {
        const saved = [] as Array<{ warning?: string }>
        for (const row of orderRows) {
          saved.push(await api<{ warning?: string }>(`/api/orders/${encodeURIComponent(String(row.orderId))}/fulfillment-package`, {
            method: "PATCH",
            body: JSON.stringify({ routeId: row.id, packageWeight: Number(packageDraft.packageWeight || 0), packageLength: Number(packageDraft.packageLength || 0), packageWidth: Number(packageDraft.packageWidth || 0), packageHeight: Number(packageDraft.packageHeight || 0), warehouseId: row.warehouseId, warehouseName: row.warehouseName, shipAlone: targets.length === 1 ? packageShipAlone : undefined, saveAsProductDefault: targets.length === 1 && savePackageAsDefault, saveShipAloneAsProductDefault: targets.length === 1 && saveShipAloneAsDefault, catalogSku: row.catalogSku || row.sku || "", user: "Luis" }),
          }))
        }
        return saved
      }))
      const warning = responses.flat().map((response) => String(response.warning || "").trim()).find(Boolean)
      if (warning) toast.warning(warning)
      else toast.success(`Package details saved for ${targets.length} order${targets.length === 1 ? "" : "s"}.`)
      setPackageRow(null)
      setPackageRouteIds([])
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save package details.")
    } finally {
      setBusy(false)
    }
  }

  const setRouteShipAlone = async (row: Record<string, unknown>, shipAlone: boolean) => {
    const readiness = readinessFor(row)
    setBusy(true)
    try {
      await api(`/api/orders/${encodeURIComponent(String(row.orderId))}/fulfillment-package`, {
        method: "PATCH",
        body: JSON.stringify({ routeId: row.id, packageWeight: Number(readiness.weight || 0), packageLength: Number(readiness.length || 0), packageWidth: Number(readiness.width || 0), packageHeight: Number(readiness.height || 0), warehouseId: row.warehouseId, warehouseName: row.warehouseName, shipAlone, catalogSku: row.catalogSku || row.sku || "", user: "Luis" }),
      })
      toast.success(shipAlone ? "This line will use its own package and label." : "This line will be combined with the order when possible.")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update the shipment split.")
    } finally {
      setBusy(false)
    }
  }

  const packageComplete = Object.values(packageDraft).every((value) => Number(value) > 0)
  const resolutionComplete = Boolean(resolutionDraft.warehouseId && resolutionDraft.line1.trim() && resolutionDraft.city.trim() && resolutionDraft.postalCode.trim() && resolutionDraft.country.trim())
    && [resolutionDraft.packageWeight, resolutionDraft.packageLength, resolutionDraft.packageWidth, resolutionDraft.packageHeight].every((value) => Number(value) > 0)
  const selectedRows = rows.filter((row) => selectedRouteIds.has(String(row.id)))
  const selectedPackageGroups = selectedRows.reduce((groups, row) => {
    const key = `${String(row.orderId)}:${String(row.packageGroupKey || "combined")}`
    const packageRows = groups.get(key) || []
    packageRows.push(row)
    groups.set(key, packageRows)
    return groups
  }, new Map<string, Array<Record<string, any>>>())
  const selectedPackageRows = [...selectedPackageGroups.values()].map((packageRows) => packageRows[0])
  const selectedRateReadyPackageEntries = [...selectedPackageGroups.entries()].filter(([, packageRows]) => packageRows.every((row: Record<string, any>) => readinessFor(row).ready === true))
  const selectedRateReadyPackageKeys = new Set(selectedRateReadyPackageEntries.map(([key]) => key))
  const selectedRateReadyRows = selectedRows.filter((row) => selectedRateReadyPackageKeys.has(`${String(row.orderId)}:${String(row.packageGroupKey || "combined")}`))
  const selectedRateReadyPackages = selectedRateReadyPackageEntries.map(([, packageRows]) => packageRows[0])
  const selectedRateSkippedCount = Math.max(0, selectedPackageRows.length - selectedRateReadyPackages.length)
  const selectedRouteIdsKey = [...selectedRouteIds].sort().join("|")
  const latestRefreshMatchesSelection = latestRateAuthorization.selectionKey === selectedRouteIdsKey
  const routeHasCurrentRate = (row: Record<string, any>) => fulfillmentRateIsCurrent(row.rateReview)
    || (latestRefreshMatchesSelection && latestRateAuthorization.routeIds.has(String(row.id)))
  const selectedPurchaseEligiblePackageEntries = [...selectedPackageGroups.entries()].filter(([, packageRows]) => packageRows.every((row: Record<string, any>) => readinessFor(row).ready === true && Boolean(row.rateReview?.selectedRate)))
  const selectedRatesCurrent = selectedRateReadyPackageEntries.length > 0
    && selectedRateReadyPackageEntries.every(([, packageRows]) => packageRows.every((row: Record<string, any>) => Boolean(row.rateReview?.selectedRate)))
  const selectedPurchaseEligiblePackageKeys = new Set(selectedPurchaseEligiblePackageEntries.map(([key]) => key))
  const selectedPurchaseEligibleRows = selectedRows.filter((row) => selectedPurchaseEligiblePackageKeys.has(`${String(row.orderId)}:${String(row.packageGroupKey || "combined")}`))
  const selectedPurchaseEligiblePackages = selectedPurchaseEligiblePackageEntries.map(([, packageRows]) => packageRows[0])
  const selectedPurchaseVerificationCount = selectedPurchaseEligiblePackageEntries.filter(([, packageRows]) => packageRows.some((row: Record<string, any>) => !routeHasCurrentRate(row))).length
  const selectedPurchaseSkippedCount = Math.max(0, selectedPackageRows.length - selectedPurchaseEligiblePackages.length)
  const previewOrderIds = [...new Set(selectedRows.map((row) => String(row.orderId || "")).filter(Boolean))].slice(0, 10)
  const printPreviewUrl = `/api/fulfillment/print-preview.pdf?orderIds=${encodeURIComponent(previewOrderIds.join(","))}&size=${encodeURIComponent(batchDraft.printSize)}&packingSlips=${batchDraft.includePackingSlips ? "1" : "0"}&packingSlipOrientation=${encodeURIComponent(batchDraft.packingSlipOrientation)}`
  const selectedRatedRows = selectedPackageRows.filter((row) => row.rateReview?.selectedRate)
  const selectedRateTotal = selectedPurchaseEligiblePackages.reduce((sum, row) => sum + Number(row.rateReview?.selectedRate?.amount || 0), 0)
  const selectedCarrierSummary = [...selectedPurchaseEligiblePackages.reduce((groups, row) => {
    const carrier = String(row.rateReview?.selectedRate?.carrier || "Carrier")
    groups.set(carrier, (groups.get(carrier) || 0) + 1)
    return groups
  }, new Map<string, number>()).entries()]
  const purchaseProgressTotal = Number(labelPurchaseProgress?.total || selectedPurchaseEligiblePackages.length)
  const purchaseProgressCompleted = Number(labelPurchaseProgress?.purchased || 0) + Number(labelPurchaseProgress?.failed || 0)
  const purchaseProgressPercent = Math.min(100, Math.round((purchaseProgressCompleted / Math.max(1, purchaseProgressTotal)) * 100))
  const rateProgressRated = rateRefreshProgress.items.filter((item) => item.status === "rated").length
  const rateProgressRecorded = rateRefreshProgress.items.filter((item) => item.status === "recorded").length
  const rateProgressFailed = rateRefreshProgress.items.filter((item) => ["failed", "blocked"].includes(item.status)).length
  const rateProgressProcessed = rateProgressRated + rateProgressRecorded + rateProgressFailed
  const rateProgressRemaining = Math.max(0, rateRefreshProgress.items.length - rateProgressProcessed)
  const rateProgressSelectionKey = [...new Set(rateRefreshProgress.items.flatMap((item) => item.routeIds.map(String)))].sort().join("|")
  const currentRateSelectionKey = [...selectedRouteIds].sort().join("|")
  const rateProgressMatchesSelection = rateRefreshProgress.active || (Boolean(rateProgressSelectionKey) && rateProgressSelectionKey === currentRateSelectionKey)
  const selectedWarehouseOnly = selectedRows.every((row) => String(row.routeType || "warehouse") === "warehouse")
  const configuredCarriers = (Array.isArray(settingsDraft.carriers) ? settingsDraft.carriers : []) as FulfillmentCarrier[]
  const carrierNames = [...new Set([...configuredCarriers.filter((carrier) => carrier.enabled).map((carrier) => carrier.name), ...shipments.map((row) => String(row.carrierName || row.carrier || "")).filter(Boolean)])].sort()
  const updateCarrier = (carrierId: string, patch: Partial<FulfillmentCarrier>) => setSettingsDraft((current) => ({ ...current, carriers: (current.carriers || []).map((carrier: FulfillmentCarrier) => carrier.id === carrierId ? { ...carrier, ...patch } : carrier) }))
  const updateCarrierService = (carrierId: string, serviceId: string, enabled: boolean) => setSettingsDraft((current) => ({ ...current, carriers: (current.carriers || []).map((carrier: FulfillmentCarrier) => carrier.id === carrierId ? { ...carrier, services: carrier.services.map((service) => service.id === serviceId ? { ...service, enabled } : service) } : carrier) }))
  const addRule = () => setSettingsDraft((current) => ({ ...current, rules: [...(Array.isArray(current.rules) ? current.rules : []), { id: crypto.randomUUID(), name: "New shipping rule", enabled: true, priority: (current.rules?.length || 0) + 1, channels: [], warehouseIds: [], destinationCountries: [], destinationStates: [], postalPrefixes: [], deliveryMethodContains: "", minWeight: 0, maxWeight: 0, minOrderValue: 0, maxOrderValue: 0, carrier: "", service: "", selection: "preferred", packagePresetId: "", note: "" }] }))
  const updateRule = (id: string, patch: Record<string, unknown>) => setSettingsDraft((current) => ({ ...current, rules: (current.rules || []).map((rule: Record<string, unknown>) => String(rule.id) === id ? { ...rule, ...patch } : rule) }))

  return (
    <div id="fulfillment-workspace" className="grid gap-5">
      <PageHeader
        eyebrow="Fulfillment operations"
        title="Fulfillment"
        description="Purchase and print labels from pending shipments. Eligible quotes are refreshed automatically according to each provider's expiration window."
        action={<div className="flex items-center gap-2"><Button size="icon" variant="outline" title="Refresh fulfillment" disabled={loading} onClick={() => void load(true)}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}</Button><DropdownMenu><DropdownMenuTrigger asChild><Button size="sm"><SlidersHorizontal className="size-4" /> Actions</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuLabel>Carrier tracking</DropdownMenuLabel><DropdownMenuItem disabled={busy} onClick={() => void refreshCarrierTracking()}><RefreshCw className="size-4" /> Refresh carrier statuses</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuLabel>Shipping tools</DropdownMenuLabel><DropdownMenuItem onClick={() => { setPurchasedLabelFilter("unprinted"); setTab("purchased-labels") }}><Printer className="size-4" /> Unprinted purchased labels ({unprintedPurchasedLabelCount})</DropdownMenuItem><DropdownMenuItem asChild><a href="/fulfillment/batches"><Package className="size-4" /> Shipping batch history</a></DropdownMenuItem><DropdownMenuItem onClick={() => setTab("print-stations")}><Monitor className="size-4" /> Print stations</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuLabel>Optional picking</DropdownMenuLabel><DropdownMenuItem disabled={!selectedRouteIds.size || !selectedWarehouseOnly} onClick={() => void createPickList()}><ListChecks className="size-4" /> Create pick list</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>}
      />
      <div className="grid overflow-hidden rounded-md border bg-card grid-cols-2 lg:grid-cols-6">
        {[
          ["Pending shipment", Number(consoleCounts.pending ?? pendingRows.length), "bg-blue-500"],
          ["Late shipments", Number(consoleCounts.late ?? pendingRows.filter((row) => fulfillmentDeadlineState(row) === "late").length), "bg-red-500"],
          ["Ready for label", Number(consoleCounts.readyForLabel ?? pendingRows.filter((row) => row.status === "Ready to ship").length), "bg-emerald-500"],
          ["Purchased labels", Number(consoleCounts.purchasedLabels ?? purchasedLabelQueue.length), "bg-violet-500"],
          ["Carrier confirmed", Number(consoleCounts.shipped ?? shippedQueue.length), "bg-teal-500"],
          ["Do not ship / recovery", Number(consoleCounts.doNotShip ?? doNotShipQueue.length), "bg-amber-500"],
        ].map(([label, value, tone], index) => <div key={String(label)} className={cn("min-w-0 px-4 py-3", index % 2 === 0 ? "border-r" : "", index < 4 ? "border-b lg:border-b-0" : "", index < 5 ? "lg:border-r" : "")}><div className="flex items-center gap-2"><span className={cn("size-2 shrink-0 rounded-full", String(tone))} /><p className="truncate text-xs font-medium text-muted-foreground">{String(label)}</p></div><p className="mt-1 text-xl font-semibold tabular-nums">{numberLabel(Number(value))}</p></div>)}
      </div>
      <div className={cn("flex flex-col gap-2 rounded-md border px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between", trackingFailureCount ? "border-destructive/40 bg-destructive/5" : "bg-muted/20")}>
        <div className="flex min-w-0 items-center gap-2">{trackingFailureCount ? <AlertTriangle className="size-4 shrink-0 text-destructive" /> : <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />}<span className="truncate">Last carrier check: {trackingRefresh?.completedAt ? dateLabel(String(trackingRefresh.completedAt)) : "Not run yet"}</span>{trackingRefresh?.completedAt ? <span className="hidden text-muted-foreground sm:inline">· {numberLabel(Number(trackingRefresh.checked || 0))} checked · {numberLabel(Number(trackingRefresh.confirmed || 0))} newly shipped</span> : null}</div>
        {trackingFailureCount ? <Button size="sm" variant="outline" className="shrink-0" onClick={() => setTab("exceptions")}>{numberLabel(trackingFailureCount)} tracking issue{trackingFailureCount === 1 ? "" : "s"}</Button> : <span className="text-xs text-muted-foreground">Automatic checks run every 4 hours</span>}
      </div>
      {selectedRouteIds.size > 0 && !batchOpen && !rateStatusOpen && <div className="sticky top-2 z-20 flex flex-col gap-3 rounded-md border bg-background p-3 shadow-sm xl:flex-row xl:items-center xl:justify-between"><div><p className="font-medium">{selectedRouteIds.size} item{selectedRouteIds.size === 1 ? "" : "s"} selected</p><p className="text-xs text-muted-foreground">{selectedPackageRows.length} shipment{selectedPackageRows.length === 1 ? "" : "s"} · {rateRefreshProgress.active ? "Refreshing latest rates" : selectedRatesCurrent ? `${selectedPurchaseEligiblePackages.length} ready to buy${selectedPurchaseSkippedCount > 0 ? ` · ${selectedPurchaseSkippedCount} will be skipped` : ""} · ${selectedPurchaseEligiblePackages.length ? `${moneyLabel(selectedRateTotal)} eligible total` : "No rates returned"}` : `${selectedRateReadyPackages.length} need latest rates${selectedRateSkippedCount > 0 ? ` · ${selectedRateSkippedCount} not ready` : ""}`}</p></div><div className="flex flex-wrap gap-2"><Popover><PopoverTrigger asChild><Button size="sm" variant="outline"><CalendarDays className="size-4" /> Edit ship date</Button></PopoverTrigger><PopoverContent align="end" className="w-72 space-y-3"><Field label="Ship date"><Input type="date" value={bulkShipDate} onChange={(event) => setBulkShipDate(event.target.value)} /></Field><Button className="w-full" size="sm" disabled={busy || !selectedRatedRows.length} onClick={() => void applySelectedShipDate()}>Apply to rated orders</Button></PopoverContent></Popover><Button size="sm" variant="outline" onClick={editSelectedPackages}><Package className="size-4" /> Edit packages</Button><Button size="sm" variant="outline" className={cn(rateProgressMatchesSelection && rateProgressFailed > 0 && "border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive")} onClick={() => { if (rateProgressMatchesSelection) setRateStatusOpen(true); else void refreshSelectedRates() }} disabled={busy || (!rateProgressMatchesSelection && !selectedRateReadyRows.length)} aria-haspopup="dialog" aria-label={rateProgressMatchesSelection ? "View rate refresh status" : "Refresh selected shipping rates"}>{rateRefreshProgress.active ? <Loader2 className="size-4 animate-spin" /> : rateProgressMatchesSelection && rateProgressFailed > 0 ? <AlertCircle className="size-4" /> : rateProgressMatchesSelection ? <CheckCircle2 className="size-4 text-emerald-600" /> : <RefreshCw className="size-4" />} {rateRefreshProgress.active ? `Rates ${rateProgressProcessed}/${rateRefreshProgress.items.length}` : rateProgressMatchesSelection && rateProgressFailed > 0 ? `${rateProgressFailed} rate issue${rateProgressFailed === 1 ? "" : "s"}` : rateProgressMatchesSelection ? `Rates ready ${rateProgressProcessed}/${rateRefreshProgress.items.length}` : `Refresh rates${selectedRateSkippedCount > 0 ? ` (${selectedRateReadyPackages.length})` : ""}`}</Button><ButtonGroup><Button size="sm" disabled={busy || rateRefreshProgress.active || !selectedRatesCurrent || !selectedPurchaseEligibleRows.length} onClick={() => setBatchOpen(true)}>{labelPurchaseProgress?.active || rateRefreshProgress.active ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />} {labelPurchaseProgress?.active ? `Purchased ${labelPurchaseProgress.purchased}/${labelPurchaseProgress.total}` : rateRefreshProgress.active ? "Waiting for latest rates" : !selectedRatesCurrent ? "Refresh rates before buying" : `Buy ${selectedPurchaseEligiblePackages.length} label${selectedPurchaseEligiblePackages.length === 1 ? "" : "s"}${selectedPurchaseSkippedCount > 0 ? ` · skip ${selectedPurchaseSkippedCount}` : ""}`}</Button><DropdownMenu><DropdownMenuTrigger asChild><Button size="icon-sm" disabled={busy} aria-label="Label and print options"><ChevronDown className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-72"><DropdownMenuLabel>Buy and print</DropdownMenuLabel><DropdownMenuCheckboxItem checked={!batchDraft.includePackingSlips} onCheckedChange={() => setBatchDraft((current) => ({ ...current, includePackingSlips: false, printSize: "4x6" }))}>Shipping label · 4 × 6</DropdownMenuCheckboxItem><DropdownMenuCheckboxItem checked={batchDraft.includePackingSlips && batchDraft.printSize === "4x6"} onCheckedChange={() => setBatchDraft((current) => ({ ...current, includePackingSlips: true, printSize: "4x6" }))}>Label + packing slip · 4 × 6</DropdownMenuCheckboxItem><DropdownMenuCheckboxItem checked={batchDraft.includePackingSlips && batchDraft.printSize === "letter"} onCheckedChange={() => setBatchDraft((current) => ({ ...current, includePackingSlips: true, printSize: "letter" }))}>Label + packing slip · Letter</DropdownMenuCheckboxItem><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => setPrintPreviewOpen(true)}><Eye className="size-4" /> Preview print layout</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuLabel>Label format</DropdownMenuLabel><DropdownMenuCheckboxItem checked={batchDraft.labelFormat === "PDF"} onCheckedChange={() => setBatchDraft((current) => ({ ...current, labelFormat: "PDF" }))}>PDF</DropdownMenuCheckboxItem><DropdownMenuCheckboxItem checked={batchDraft.labelFormat === "PNG"} onCheckedChange={() => setBatchDraft((current) => ({ ...current, labelFormat: "PNG" }))}>PNG</DropdownMenuCheckboxItem></DropdownMenuContent></DropdownMenu></ButtonGroup><DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="outline" disabled={busy}><MoreHorizontal className="size-4" /> More</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuLabel>{selectedRouteIds.size} selected</DropdownMenuLabel><DropdownMenuItem onClick={() => setPrintPreviewOpen(true)}><Eye className="size-4" /> Preview print layout</DropdownMenuItem><DropdownMenuItem onClick={() => setTab("batches")}><Eye className="size-4" /> Shipping batch overview</DropdownMenuItem><DropdownMenuItem disabled={!selectedWarehouseOnly} onClick={() => void createPickList()}><ListChecks className="size-4" /> Create pick list</DropdownMenuItem><DropdownMenuItem onClick={exportSelected}><FileDown className="size-4" /> Export selected CSV</DropdownMenuItem></DropdownMenuContent></DropdownMenu><Button size="sm" variant="ghost" onClick={() => setSelectedRouteIds(new Set())}>Clear</Button></div></div>}
      <Dialog open={rateStatusOpen && rateRefreshProgress.items.length > 0} onOpenChange={setRateStatusOpen}>
        <DialogContent className="flex h-[min(88dvh,720px)] w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
          <DialogHeader className="shrink-0 gap-3 border-b bg-blue-500/5 px-5 py-4" role="status" aria-live="polite">
            <div className="flex min-w-0 items-start gap-2 pr-8">
              {rateRefreshProgress.active ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" /> : rateProgressFailed > 0 ? <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />}
              <div className="min-w-0 text-left"><DialogTitle className="text-base">{rateRefreshProgress.active ? "Getting carrier rates" : rateProgressFailed > 0 ? "Rate check finished with items needing attention" : "Rates ready"}{rateRefreshProgress.jobNumber ? ` · JOB-${rateRefreshProgress.jobNumber}` : ""}</DialogTitle><DialogDescription>{rateRefreshProgress.message || "This job continues in the background. You can close this window and return while it runs."}</DialogDescription></div>
            </div>
            <div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold tabular-nums">Completed {rateProgressProcessed} / {rateRefreshProgress.items.length}</p><p className="text-xs text-muted-foreground">{rateProgressRemaining} remaining</p></div>
            <Progress value={(rateProgressProcessed / Math.max(1, rateRefreshProgress.items.length)) * 100} className="h-2" />
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">{rateProgressRated > 0 ? <span>{rateProgressRated} rates ready</span> : null}{rateProgressRecorded > 0 ? <span>{rateProgressRecorded} existing labels recorded</span> : null}{rateProgressFailed > 0 ? <span className="text-destructive">{rateProgressFailed} need attention</span> : null}</div>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto"><Table className="table-fixed"><TableHeader className="sticky top-0 z-10 bg-card"><TableRow><TableHead className="w-24">Order</TableHead><TableHead className="w-36">Selected SKU</TableHead><TableHead>Status</TableHead><TableHead className="hidden w-48 lg:table-cell">Rate</TableHead><TableHead className="hidden w-24 text-right sm:table-cell">Cost</TableHead></TableRow></TableHeader><TableBody>{rateRefreshProgress.items.map((item) => {
            const rate = item.selectedRate || null
            return <TableRow key={item.orderId}><TableCell className="align-top"><a className="font-medium hover:underline" href={`/orders/${encodeURIComponent(item.orderId)}`}>{item.orderNumber}</a></TableCell><TableCell className="align-top"><p className="truncate font-mono text-xs" title={item.skus.join(", ")}>{item.skus.join(", ")}</p></TableCell><TableCell className="min-w-0 align-top">{item.status === "checking" ? <span className="flex items-center gap-1.5 text-sm text-blue-700 dark:text-blue-300"><Loader2 className="size-3.5 animate-spin" /> Checking</span> : item.status === "queued" ? <span className="text-sm text-muted-foreground">Waiting</span> : item.status === "rated" ? <Badge variant="success">Rate ready</Badge> : item.status === "recorded" ? <Badge variant="success">Existing label recorded</Badge> : <Badge variant="destructive">{item.status === "blocked" ? "Blocked" : "Failed"}</Badge>}{item.error && ["failed", "blocked"].includes(item.status) ? <p className="mt-1 break-words text-xs leading-relaxed text-destructive">{item.error}</p> : null}{rate && item.status === "recorded" ? <p className="mt-1 text-xs text-muted-foreground lg:hidden">{String(rate.carrier || "Marketplace")} · {String(rate.service || "Existing label")}</p> : null}</TableCell><TableCell className="hidden align-top lg:table-cell">{rate ? <><p className="font-medium">{String(rate.carrier || "Carrier")}</p><p className="break-words text-xs text-muted-foreground">{String(rate.service || "Service")}</p></> : "-"}</TableCell><TableCell className="hidden text-right align-top font-medium tabular-nums sm:table-cell">{rate?.amount === null || rate?.amount === undefined ? "-" : moneyLabel(Number(rate.amount))}</TableCell></TableRow>
          })}</TableBody></Table></div>
          <DialogFooter className="shrink-0 flex-wrap border-t bg-background px-5 py-4">
            {!rateRefreshProgress.active && <Button variant="ghost" onClick={() => { window.localStorage.removeItem("dataplus:fulfillment-rate-refresh-job"); setRateRefreshJobId(""); setRateRefreshProgress({ active: false, items: [] }); setRateStatusOpen(false) }}>Dismiss results</Button>}
            {!rateRefreshProgress.active && <Button variant="outline" disabled={busy || !selectedRateReadyRows.length} onClick={() => void refreshSelectedRates()}><RefreshCw className="size-4" /> Refresh selected again</Button>}
            <Button onClick={() => setRateStatusOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Tabs value={tab} onValueChange={(next) => { setTab(next); setStatus("all"); setSelectedRouteIds(new Set()) }} className="min-w-0"><div className="overflow-x-auto rounded-md border bg-card p-1"><TabsList className="h-auto min-w-max justify-start bg-transparent p-0"><TabsTrigger value="ready">Pending shipment</TabsTrigger><TabsTrigger value="purchased-labels">Purchased labels ({numberLabel(Number(consoleCounts.purchasedLabels ?? purchasedLabelQueue.length))})</TabsTrigger><TabsTrigger value="shipments">Shipped ({numberLabel(Number(consoleCounts.shipped ?? shippedQueue.length))})</TabsTrigger><TabsTrigger value="exceptions">Exceptions {Number(consoleCounts.exceptions ?? exceptions.length) > 0 && <Badge variant="destructive" className="ml-1">{numberLabel(Number(consoleCounts.exceptions ?? exceptions.length))}</Badge>}</TabsTrigger><TabsTrigger value="do-not-ship">Do Not Ship &amp; Recovery {Number(consoleCounts.doNotShip ?? doNotShipQueue.length) > 0 && <Badge variant="destructive" className="ml-1">{numberLabel(Number(consoleCounts.doNotShip ?? doNotShipQueue.length))}</Badge>}</TabsTrigger><TabsTrigger value="all-shipments">All shipments ({numberLabel(Number(consoleCounts.allShipments ?? allShipmentRows.length))})</TabsTrigger><TabsTrigger value="manifests">Manifests</TabsTrigger><TabsTrigger value="reports">Reports</TabsTrigger><TabsTrigger value="carriers">Carriers</TabsTrigger><TabsTrigger value="settings">Settings</TabsTrigger></TabsList></div>
        {["ready", "all-shipments", "do-not-ship", "purchased-labels", "shipments", "exceptions"].includes(tab) && <form className="mt-3 flex flex-col gap-2 rounded-md border bg-card p-3 sm:flex-row" onSubmit={(event) => { event.preventDefault(); setQuery(searchDraft.trim()); setWorkPage(1); setSelectedRouteIds(new Set()) }}>
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input className="pl-9 pr-9" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search order, channel order, batch, tracking, SKU, customer, carrier, or status" />
            {searchDraft ? <Button type="button" size="icon" variant="ghost" className="absolute right-0.5 top-0.5 size-8" title="Clear fulfillment search" aria-label="Clear fulfillment search" onClick={() => { setSearchDraft(""); setQuery(""); setWorkPage(1); setSelectedRouteIds(new Set()) }}><X className="size-4" /></Button> : null}
          </div>
          <Button type="submit" size="sm"><Search className="size-4" /> Search</Button>
        </form>}
        {["ready", "all-shipments", "do-not-ship", "purchased-labels", "shipments", "exceptions"].includes(tab) && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card px-3 py-2"><div><p className="text-sm font-medium">Ship deadline</p><p className="text-xs text-muted-foreground">The same urgency filter applies across every fulfillment queue.</p></div><Select value={deadlineFilter} onValueChange={setDeadlineFilter}><SelectTrigger className="h-8 w-full sm:w-64"><Clock3 className="size-4" /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All ship deadlines</SelectItem><SelectItem value="at_risk">Late or verge of late shipment</SelectItem><SelectItem value="late">Late orders</SelectItem><SelectItem value="due_soon">Verge of late shipment</SelectItem><SelectItem value="on_time">On time</SelectItem></SelectContent></Select></div>}
        {["ready", "all-shipments"].includes(tab) && <div className="mt-4 grid gap-4">
          {tab === "ready" && <div className="flex gap-1 overflow-x-auto rounded-md border bg-card p-1">{stages.map((stage) => <Button key={stage} size="sm" variant={status === stage ? "secondary" : "ghost"} className="shrink-0" onClick={() => { setStatus(stage); if (stage === "late") setDeadlineFilter("late"); else if (deadlineFilter === "late") setDeadlineFilter("all") }}>{stage === "all" ? "Pending shipment" : stage === "late" ? "Late shipments" : stage === "label_ready" ? "Label ready" : stage.replace(/_/g, " ")} <Badge variant={stage === "late" ? "destructive" : "outline"} className="ml-1">{numberLabel(stage === "all" ? rows.length : stage === "late" ? lateShipmentCount : rows.filter((row) => row.status === stage).length)}</Badge></Button>)}</div>}
          <Card className={cn(tab === "all-shipments" ? "[&_th:first-child]:hidden [&_td:first-child]:hidden [&_th:last-child]:hidden [&_td:last-child]:hidden" : undefined, "[&>*:nth-child(3)]:hidden")}>
            <CardHeader className="border-b py-3">
              <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
                <div className="ml-auto flex flex-wrap gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button size="sm" variant="outline"><Filter className="size-4" /> Channels{hiddenChannels.size ? ` (${channelOptions.length - hiddenChannels.size}/${channelOptions.length})` : ""}</Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-56">
                      <DropdownMenuLabel>Orders by channel</DropdownMenuLabel><DropdownMenuSeparator />
                      {channelOptions.map((channel) => <DropdownMenuCheckboxItem key={channel} checked={!hiddenChannels.has(channel)} onSelect={(event) => event.preventDefault()} onCheckedChange={(checked) => setHiddenChannels((current) => { const next = new Set(current); if (checked) next.delete(channel); else next.add(channel); return next })}>{channel}</DropdownMenuCheckboxItem>)}
                      <DropdownMenuSeparator /><DropdownMenuItem onSelect={(event) => { event.preventDefault(); setHiddenChannels(new Set()) }}>Select all channels</DropdownMenuItem><DropdownMenuItem onSelect={(event) => { event.preventDefault(); setHiddenChannels(new Set(channelOptions)) }}>Clear all channels</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Select value={allocationFilter} onValueChange={setAllocationFilter}>
                    <SelectTrigger className="h-8 w-full sm:w-44"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="all">All allocation</SelectItem><SelectItem value="allocated">Allocated orders</SelectItem><SelectItem value="partial">Partially allocated</SelectItem><SelectItem value="unallocated">Not allocated</SelectItem></SelectContent>
                  </Select>
                  <Select value={consolidationFilter} onValueChange={setConsolidationFilter}>
                    <SelectTrigger className="h-8 w-full sm:w-48"><PackageCheck className="size-4" /><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="all">All combinations</SelectItem><SelectItem value="candidates">Can ship together</SelectItem><SelectItem value="grouped">Grouped shipments</SelectItem></SelectContent>
                  </Select>
                  <FulfillmentSkuSelector
                    groups={skuGroups}
                    selectedSkus={selectedSkuFilters}
                    onSelectionChange={(sku, selected) => setSelectedSkuFilters((current) => {
                      const next = new Set(current)
                      const key = sku.toLowerCase()
                      if (selected) next.add(key)
                      else next.delete(key)
                      return next
                    })}
                    onClear={() => setSelectedSkuFilters(new Set())}
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button size="sm" variant="outline"><ListChecks className="size-4" /> Columns</Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-52"><DropdownMenuLabel>Visible columns</DropdownMenuLabel><DropdownMenuSeparator />{fulfillmentWorkColumnOptions.map(([id, label]) => <DropdownMenuCheckboxItem key={id} checked={visibleWorkColumns.has(id)} onCheckedChange={(checked) => setVisibleWorkColumns((current) => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next })}>{label}</DropdownMenuCheckboxItem>)}<DropdownMenuSeparator /><DropdownMenuItem onSelect={() => setVisibleWorkColumns(new Set(fulfillmentWorkColumnOptions.map(([id]) => id)))}>Reset columns</DropdownMenuItem></DropdownMenuContent>
                  </DropdownMenu>
                  <Select value={workSort} onValueChange={setWorkSort}><SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="deadline_asc">Ship deadline first</SelectItem><SelectItem value="order_date_asc">Oldest orders first</SelectItem><SelectItem value="order_date_desc">Newest orders first</SelectItem><SelectItem value="sku_asc">SKU A-Z</SelectItem><SelectItem value="sku_desc">SKU Z-A</SelectItem></SelectContent></Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_hsl(var(--border))]"><TableRow><TableHead className="w-10"><Checkbox aria-label="Select visible fulfillment work" checked={shown.length > 0 && shown.every((row) => selectedRouteIds.has(String(row.id)))} onCheckedChange={(checked) => setSelectedRouteIds(checked === true ? new Set(shown.map((row) => String(row.id))) : new Set())} /></TableHead>{showWorkColumn("order") && <TableHead>Order</TableHead>}{showWorkColumn("item") && <TableHead>Items</TableHead>}{showWorkColumn("shipTo") && <TableHead>Ship to</TableHead>}{showWorkColumn("channel") && <TableHead>Channel</TableHead>}{showWorkColumn("supplier") && <TableHead>Supplier</TableHead>}{showWorkColumn("warehouse") && <TableHead>Warehouse</TableHead>}{showWorkColumn("supply") && <TableHead>Supply</TableHead>}{showWorkColumn("readiness") && <TableHead>Readiness</TableHead>}{showWorkColumn("rate") && <TableHead>Rate</TableHead>}{showWorkColumn("shipBy") && <TableHead>Ship by</TableHead>}{showWorkColumn("status") && <TableHead>Status</TableHead>}<TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{shownGroups.map((groupRows) => <FulfillmentPackageTableRow key={`${String(groupRows[0]?.orderId || groupRows[0]?.orderNumber || "order")}:${String(groupRows[0]?.packageGroupKey || "combined")}`} rows={groupRows} selectedRouteIds={selectedRouteIds} showColumn={showWorkColumn} busy={busy} onToggleSelection={(routeIds, checked) => setSelectedRouteIds((current) => { const next = new Set(current); for (const routeId of routeIds) { if (checked) next.add(routeId); else next.delete(routeId) } return next })} onEditPackage={editPackageGroup} onSetShipAlone={(item, shipAlone) => void setRouteShipAlone(item, shipAlone)} onCreateLabel={(items) => { setSelectedRouteIds(new Set(items.map((item) => String(item.id)))); setBatchOpen(true) }} onOpenBatches={() => setTab("batches")} onProcessRates={(item) => void processBatch(String(item.rateReview?.batchId || ""), "rates")} onAdvance={(item, stage) => void advance(item, stage)} onSelectRate={(item, rateId) => updateRateChoice(item, { selectedRateId: rateId })} onShipTogether={(item) => void openShipmentConsolidation(item)} onQuickView={setQuickViewRows} />)}{!shownGroups.length && <TableRow><TableCell colSpan={visibleWorkColumnCount} className="h-28 text-center text-muted-foreground">No warehouse fulfillment work matches this view. Dropship orders are managed from their PO.</TableCell></TableRow>}</TableBody></Table></div></CardContent>
            <CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead className="w-10"><Checkbox aria-label="Select visible fulfillment work" checked={shown.length > 0 && shown.every((row) => selectedRouteIds.has(String(row.id)))} onCheckedChange={(checked) => setSelectedRouteIds(checked === true ? new Set(shown.map((row) => String(row.id))) : new Set())} /></TableHead>{showWorkColumn("order") && <TableHead>Order</TableHead>}{showWorkColumn("item") && <TableHead>Item</TableHead>}{showWorkColumn("shipTo") && <TableHead>Ship to</TableHead>}{showWorkColumn("channel") && <TableHead>Channel</TableHead>}{showWorkColumn("supplier") && <TableHead>Supplier</TableHead>}{showWorkColumn("warehouse") && <TableHead>Warehouse</TableHead>}{showWorkColumn("supply") && <TableHead>Supply</TableHead>}{showWorkColumn("readiness") && <TableHead>Readiness</TableHead>}{showWorkColumn("rate") && <TableHead>Rate</TableHead>}{showWorkColumn("shipBy") && <TableHead>Ship by</TableHead>}{showWorkColumn("status") && <TableHead>Status</TableHead>}<TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{shown.map((row) => { const readiness = readinessFor(row); const blockers = Array.isArray(readiness.blockers) ? readiness.blockers as string[] : []; const next = String(row.routeType || "warehouse") === "warehouse" ? nextStage(String(row.status)) : ""; return <TableRow key={String(row.id)}><TableCell><Checkbox aria-label={`Select ${String(row.orderNumber || row.orderId)}`} checked={selectedRouteIds.has(String(row.id))} onCheckedChange={(checked) => setSelectedRouteIds((current) => { const selected = new Set(current); if (checked === true) selected.add(String(row.id)); else selected.delete(String(row.id)); return selected })} /></TableCell>{showWorkColumn("order") && <TableCell><a className="font-medium hover:underline" href={`/orders/${encodeURIComponent(String(row.orderId))}`}>{String(row.orderNumber || row.orderId)}</a><p className="max-w-40 truncate text-xs text-muted-foreground">{String(row.customer || "Customer")}</p><p className="text-xs text-muted-foreground">{row.orderDate ? dateLabel(String(row.orderDate)) : "Order date unavailable"}</p></TableCell>}{showWorkColumn("item") && <TableCell><div className="flex min-w-52 items-center gap-2"><a className="shrink-0" href={`/products/${encodeURIComponent(String(row.parentSku || row.catalogSku || row.sku || ""))}`}>{row.productImage ? <img src={String(row.productImage)} alt="" className="size-10 rounded border bg-background object-contain" /> : <span className="grid size-10 place-items-center rounded border bg-muted"><Package className="size-4 text-muted-foreground" /></span>}</a><div className="min-w-0"><a className="block truncate font-medium hover:underline" href={`/products/${encodeURIComponent(String(row.parentSku || row.catalogSku || row.sku || ""))}`}>{String(row.sku || "Missing SKU")}</a>{row.parentSku ? <p className="truncate text-xs text-muted-foreground">Parent {String(row.parentSku)}</p> : null}<p className="text-xs text-muted-foreground">{numberLabel(Number(row.qty || 0))} units</p>{row.shipAlone === true ? <Badge variant="outline" className="mt-1 border-blue-500/30 text-blue-700 dark:text-blue-300">Ships alone</Badge> : null}</div></div></TableCell>}{showWorkColumn("shipTo") && <TableCell><p className="max-w-40 truncate font-medium" title={String(row.destination?.name || row.customer || "")}>{String(row.destination?.city || row.destination?.town || "Unknown city")}</p><p className="max-w-40 truncate text-xs text-muted-foreground">{[row.destination?.state, row.destination?.postalCode || row.destination?.zip || row.destination?.postcode].filter(Boolean).join(" ") || "Address unavailable"}</p></TableCell>}{showWorkColumn("channel") && <TableCell><Badge variant="outline">{String(row.channel || "Unassigned")}</Badge></TableCell>}{showWorkColumn("supplier") && <TableCell><p className="max-w-44 truncate font-medium" title={String(row.supplierName || "")}>{String(row.supplierName || "Internal stock")}</p></TableCell>}{showWorkColumn("warehouse") && <TableCell>{String(row.warehouseName || "Unassigned")}</TableCell>}{showWorkColumn("supply") && <TableCell><Badge variant={row.supplyStatus === "incoming" ? "secondary" : row.supplyStatus === "draft" ? "warning" : "outline"}>{String(row.supplyLabel || "No PO")}</Badge>{row.purchaseOrderId ? <p className="mt-1 text-xs"><a className="text-primary hover:underline" href={`/purchase-orders/${encodeURIComponent(String(row.purchaseOrderId))}`}>{String(row.purchaseOrderNumber || "Open PO")}</a></p> : null}</TableCell>}{showWorkColumn("readiness") && <TableCell><button type="button" className={`w-full min-w-36 rounded-md border p-2 text-left ${readiness.ready ? "border-emerald-500/30 bg-emerald-500/10" : "border-destructive/40 bg-destructive/5"}`} onClick={() => editPackage(row)}><p className={`text-xs font-medium ${readiness.ready ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}`}>{readiness.ready ? "Ready for label" : blockers[0] || "Blocked"}</p><p className="mt-1 text-xs text-muted-foreground">{String(readiness.weight || 0)} lb · {String(readiness.length || 0)} × {String(readiness.width || 0)} × {String(readiness.height || 0)} in</p></button></TableCell>}{showWorkColumn("rate") && <TableCell><FulfillmentRateCell review={row.rateReview} busy={busy} onOpen={() => setTab("batches")} onProcess={() => void processBatch(String(row.rateReview?.batchId || ""), "rates")} onSelectRate={(rateId) => updateRateChoice(row, { selectedRateId: rateId })} /></TableCell>}{showWorkColumn("shipBy") && <TableCell><FulfillmentShipBy row={row} /></TableCell>}{showWorkColumn("status") && <TableCell><Badge variant={row.status === "exception" ? "destructive" : row.status === "ready_to_ship" ? "success" : "outline"}>{row.status === "ready_to_ship" ? "Ready for label" : String(row.status || "new").replace(/_/g, " ")}</Badge>{row.rateReview?.batchNumber ? <p className="mt-1 text-xs text-blue-700 dark:text-blue-300">{String(row.rateReview.batchNumber)}</p> : null}</TableCell>}<TableCell className="text-right"><DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="ghost"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => editPackage(row)}><Pencil className="size-4" /> Edit package</DropdownMenuItem><DropdownMenuItem disabled={busy} onClick={() => void setRouteShipAlone(row, row.shipAlone !== true)}><Package className="size-4" /> {row.shipAlone === true ? "Rejoin order package" : "Split shipment"}</DropdownMenuItem><DropdownMenuItem disabled={!readiness.ready} onClick={() => { setSelectedRouteIds(new Set([String(row.id)])); setBatchOpen(true) }}><Truck className="size-4" /> Create shipping label</DropdownMenuItem>{row.rateReview?.batchId ? <DropdownMenuItem onClick={() => setTab("batches")}><ExternalLink className="size-4" /> Open rate review</DropdownMenuItem> : null}{next && <DropdownMenuItem onClick={() => void advance(row, next)}><ArrowRight className="size-4" /> Mark {next.replace(/_/g, " ")}</DropdownMenuItem>}<DropdownMenuItem asChild><a href={`/orders/${encodeURIComponent(String(row.orderId))}`}><ExternalLink className="size-4" /> Open order</a></DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell></TableRow> })}{!shown.length && <TableRow><TableCell colSpan={visibleWorkColumnCount} className="h-28 text-center text-muted-foreground">No warehouse fulfillment work matches this view. Dropship orders are managed from their PO.</TableCell></TableRow>}</TableBody></Table></div></CardContent>
          </Card>
        </div>}
        {["ready", "all-shipments"].includes(tab) && <div className="flex flex-col gap-3 rounded-md border bg-card px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"><p className="text-muted-foreground">{filteredWorkTotal ? `Showing ${numberLabel(workPageStart + 1)}-${numberLabel(Math.min(workPageStart + shownGroups.length, filteredWorkTotal))} of ${numberLabel(filteredWorkTotal)} shipments` : "No matching shipments"}</p><div className="flex flex-wrap items-center gap-2"><Select value={String(workPageSize)} onValueChange={(value) => setWorkPageSize(Number(value))}><SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="25">25 per page</SelectItem><SelectItem value="50">50 per page</SelectItem><SelectItem value="100">100 per page</SelectItem></SelectContent></Select><span className="min-w-24 text-center text-muted-foreground">Page {currentWorkPage} of {workPageCount}</span><Button size="sm" variant="outline" disabled={currentWorkPage <= 1} onClick={() => setWorkPage((current) => Math.max(1, current - 1))}>Previous</Button><Button size="sm" variant="outline" disabled={currentWorkPage >= workPageCount} onClick={() => setWorkPage((current) => Math.min(workPageCount, current + 1))}>Next</Button></div></div>}
        <TabsContent value="batches" className="mt-4 grid gap-3">
          {batches.map((batch) => {
            const rows = Array.isArray(batch.rows) ? batch.rows as Array<Record<string, any>> : []
            const overLimit = rows.filter((row) => row.requiresCostConfirmation && row.status === "rated")
            const printJob = printQueue.find((row) => String(row.batchId) === String(batch.id))
            const purchase = () => {
              const confirmed = !overLimit.length || window.confirm(`${overLimit.length} selected label${overLimit.length === 1 ? " is" : "s are"} above the configured cost limit. Purchase anyway?`)
              if (confirmed) void processBatch(String(batch.id), "purchase", overLimit.length > 0)
            }
            return <Card key={String(batch.id)}>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div><CardTitle className="text-base">{printJob ? <button type="button" className="hover:underline" onClick={() => openPrintPreview(printJob)}>{String(batch.batchNumber)}</button> : String(batch.batchNumber)}</CardTitle><CardDescription>{numberLabel(Number(batch.counts?.total || 0))} orders · {dateLabel(String(batch.createdAt || ""))}{Number(batch.labelPrintCount || printJob?.printCount || 0) > 0 ? ` · Printed ${numberLabel(Number(batch.labelPrintCount || printJob?.printCount || 0))} time${Number(batch.labelPrintCount || printJob?.printCount || 0) === 1 ? "" : "s"}` : " · Not printed"}</CardDescription></div>
                <div className="flex flex-wrap gap-2"><Badge variant={String(batch.warehouseStatus || "open") === "closed" ? "success" : "warning"}>{String(batch.warehouseStatus || "open") === "closed" ? "Closed" : "Open"}</Badge><Badge variant={batch.status === "completed" ? "success" : batch.status === "warning" ? "destructive" : "outline"}>{String(batch.status || "queued")}</Badge></div>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-8"><Detail label="Rated" value={numberLabel(Number(batch.counts?.rated || 0))} /><Detail label="Labels generating" value={numberLabel(Number(batch.counts?.label_pending || 0))} /><Detail label="Purchased" value={numberLabel(Number(batch.counts?.purchased || 0))} /><Detail label="Picked" value={`${numberLabel(Number(batch.counts?.picked || 0))} / ${numberLabel(Number(batch.counts?.purchased || 0))}`} /><Detail label="Prints" value={numberLabel(Number(batch.labelPrintCount || printJob?.printCount || 0))} /><Detail label="Failed" value={numberLabel(Number(batch.counts?.failed || 0))} /><Detail label="Blocked" value={numberLabel(Number(batch.counts?.blocked || 0))} /><Detail label="Format" value={`${String(batch.labelFormat || "PDF")} · ${String(batch.printSize || "4x6")}`} /></div>
                {overLimit.length > 0 && <Alert variant="destructive"><AlertTriangle className="size-4" /><AlertTitle>Cost approval required</AlertTitle><AlertDescription>{overLimit.length} label{overLimit.length === 1 ? " is" : "s are"} above the configured label-cost limit.</AlertDescription></Alert>}
                {rows.some((row) => row.error) && <div className="grid gap-1 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">{rows.filter((row) => row.error).slice(0, 8).map((row) => <p key={String(row.orderId)}><span className="font-medium">{String(row.orderNumber)}</span>: {String(row.error)}</p>)}</div>}
                <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Label status</TableHead><TableHead>Customer requested</TableHead><TableHead>Selected cheapest rate</TableHead><TableHead>ETA</TableHead><TableHead>Cost</TableHead><TableHead>Measurements</TableHead></TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={String(row.orderId)}><TableCell className="font-medium">{String(row.orderNumber || row.orderId)}</TableCell><TableCell><Badge variant={row.status === "purchased" ? "success" : row.status === "failed" ? "destructive" : "outline"}>{row.status === "purchased" ? "Label purchased" : row.status === "failed" ? "No label purchased" : row.status === "label_pending" ? "Label generating" : String(row.status || "pending").replace(/_/g, " ")}</Badge>{row.status === "failed" && row.error ? <p className="mt-1 max-w-64 text-xs text-muted-foreground">Purchase attempt failed</p> : null}</TableCell><TableCell>{String(row.requestedDeliveryMethod || "Not specified")}</TableCell><TableCell>{row.selectedRate ? `${String(row.selectedRate.carrier || "")} ${String(row.selectedRate.service || "")}`.trim() : row.status === "blocked" ? "Blocked" : "Rate pending"}</TableCell><TableCell>{row.estimatedDeliveryAt ? dateLabel(String(row.estimatedDeliveryAt)) : String(row.selectedRate?.deliveryEstimate || (row.selectedRate?.deliveryDays ? `${row.selectedRate.deliveryDays} days` : "Not provided"))}</TableCell><TableCell>{row.selectedRate ? moneyLabel(Number(row.selectedRate.amount || 0)) : "-"}</TableCell><TableCell><Badge variant={row.packageInferred ? "secondary" : "outline"}>{row.packageInferred ? "Product fallback" : String(row.packageSource || "Order package").replace(/_/g, " ")}</Badge></TableCell></TableRow>)}</TableBody></Table></div>
                {Number(batch.counts?.failed || 0) > 0 ? <p className="text-xs text-muted-foreground">Safely released purchases can be rate-checked again without changing this batch number. Rows with carrier evidence remain locked for reconciliation.</p> : null}
                <div className="flex flex-wrap justify-end gap-2">{Number(batch.counts?.failed || 0) > 0 ? <Button variant="outline" disabled={busy} onClick={() => void retryReleasedBatch(String(batch.id))}><RotateCcw className="size-4" /> Retry in same batch</Button> : null}{(String(batch.phase || "rates") === "rates" || Number(batch.counts?.rated || 0) + Number(batch.counts?.queued || 0) > 0) ? <Button variant="outline" disabled={busy} onClick={() => void processBatch(String(batch.id), "rates", false, "cheapest")}><RefreshCw className="size-4" /> Refresh rates + cheapest</Button> : null}<Button variant="outline" disabled={!Number(batch.counts?.purchased || 0)} onClick={() => openBatchPickSheet(String(batch.id))}><ListChecks className="size-4" /> Print pick sheet</Button><Button variant="outline" disabled={busy || !Number(batch.counts?.purchased || 0) || Number(batch.counts?.picked || 0) >= Number(batch.counts?.purchased || 0)} onClick={() => void markBatchPicked(batch)}><CheckCircle2 className="size-4" /> Mark batch picked</Button>{printJob ? <Button disabled={busy} onClick={() => openPrintPreview(printJob)}><Printer className="size-4" /> {printJob.status === "printed" ? "Open & reprint" : "Open & print"}</Button> : Number(batch.counts?.rated || 0) > 0 ? <Button disabled={busy} onClick={purchase}><Truck className="size-4" /> Buy labels</Button> : null}</div>
              </CardContent>
            </Card>
          })}
          {!batches.length && <Empty className="min-h-56 rounded-md border"><EmptyHeader><EmptyMedia variant="icon"><Truck className="size-4" /></EmptyMedia><EmptyTitle>No shipping batches</EmptyTitle><EmptyDescription>Rates are saved on each order automatically. Select rated orders from Pending shipment to create a batch and purchase their labels.</EmptyDescription></EmptyHeader></Empty>}
        </TabsContent>
        <TabsContent value="print-stations" className="mt-4"><Card>
          <CardHeader className="flex-row items-start justify-between gap-3"><div><CardTitle>Desktop print stations</CardTitle><CardDescription>Pair a warehouse computer once, then send purchased labels to it from mobile or any DataPlus session.</CardDescription></div><Button size="sm" onClick={() => { setPairingResult(null); setPairStationOpen(true) }}><Plus className="size-4" /> Pair desktop</Button></CardHeader>
          <CardContent className="grid gap-3">{printStations.map((station) => <div key={String(station.id)} className="grid gap-3 rounded-md border p-3 md:grid-cols-[minmax(180px,1fr)_minmax(220px,1fr)_auto] md:items-center">
            <div><div className="flex items-center gap-2"><p className="font-medium">{String(station.name)}</p><Badge variant={station.online ? "success" : station.status === "disabled" ? "secondary" : "warning"}>{station.online ? "Online" : station.status === "pending" ? "Pairing" : station.status === "disabled" ? "Disabled" : "Offline"}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{String(station.hostname || "Not paired yet")}{station.lastSeenAt ? ` · Seen ${dateLabel(String(station.lastSeenAt))}` : ""}</p></div>
            <Field label="Default printer"><Select disabled={!station.printers?.length || station.status === "disabled"} value={String(station.defaultPrinter || "")} onValueChange={(defaultPrinter) => void updatePrintStation(String(station.id), { defaultPrinter })}><SelectTrigger><SelectValue placeholder="Choose printer" /></SelectTrigger><SelectContent>{(station.printers || []).map((printer: string) => <SelectItem key={printer} value={printer}>{printer}</SelectItem>)}</SelectContent></Select></Field>
            <div className="flex justify-end gap-2"><Button size="sm" disabled={busy || station.status !== "active" || !station.defaultPrinter} onClick={() => openPrintStationTest(station)}><Eye className="size-4" /> Preview test</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void updatePrintStation(String(station.id), { status: station.status === "disabled" ? "active" : "disabled" })}>{station.status === "disabled" ? "Enable" : "Disable"}</Button><Button size="icon" variant="ghost" className="text-destructive hover:text-destructive" disabled={busy} title={`Remove ${String(station.name || "print station")}`} onClick={() => setPrintStationToRemove(station)}><Trash2 className="size-4" /></Button></div>
            {station.lastError ? <p className="text-xs text-destructive md:col-span-3">{String(station.lastError)}</p> : null}
          </div>)}{!printStations.length ? <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No desktop is paired yet. Browser and AirPrint printing remain available.</div> : null}</CardContent>
        </Card></TabsContent>
        <AlertDialog open={Boolean(printStationToRemove)} onOpenChange={(open) => { if (!open && !busy) setPrintStationToRemove(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Remove {String(printStationToRemove?.name || "print station")}?</AlertDialogTitle><AlertDialogDescription>This permanently revokes this desktop's connection. Completed print history is preserved. Any unfinished packets assigned to this station return to the print queue so they can be sent to another printer.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>Keep station</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={busy} onClick={(event) => { event.preventDefault(); void removePrintStation() }}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Remove station</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
        <TabsContent value="print" className="mt-4"><Card><CardHeader><CardTitle>Print queue</CardTitle><CardDescription>Purchased packets remain here until a browser or paired warehouse desktop reports them printed.</CardDescription></CardHeader><CardContent className="overflow-x-auto p-0"><Table><TableHeader><TableRow><TableHead>Packet</TableHead><TableHead>Batch</TableHead><TableHead>Orders</TableHead><TableHead>Documents</TableHead><TableHead>Status</TableHead><TableHead>Destination</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{unprintedPrintQueue.map((row) => <TableRow key={String(row.id)}><TableCell className="font-medium">{String(row.printNumber)}</TableCell><TableCell>{String(row.batchNumber)}</TableCell><TableCell>{numberLabel(Number(row.orderCount || 0))}</TableCell><TableCell>{numberLabel(Number(row.documentCount || 0))}</TableCell><TableCell><Badge variant={row.deliveryStatus === "failed" ? "destructive" : "secondary"}>{String(row.deliveryStatus || row.status || "ready").replaceAll("_", " ")}</Badge>{row.lastError ? <p className="mt-1 max-w-64 text-xs text-destructive">{String(row.lastError)}</p> : null}</TableCell><TableCell><p className="font-medium">{String(row.stationName || "Browser")}</p>{row.printerName ? <p className="text-xs text-muted-foreground">{String(row.printerName)}</p> : null}</TableCell><TableCell className="text-right"><div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => void markPrinted(row)}><Printer className="size-4" /> Browser</Button><Button size="sm" disabled={!printStations.some((station) => station.status === "active")} onClick={() => openPrintDispatch(row)}><SendHorizontal className="size-4" /> Send</Button></div></TableCell></TableRow>)}{!unprintedPrintQueue.length && <TableRow><TableCell colSpan={7} className="h-28 text-center text-muted-foreground">No purchased label packets are waiting to print.</TableCell></TableRow>}</TableBody></Table></CardContent></Card></TabsContent>
        <TabsContent value="do-not-ship" className="mt-4">
          <Card>
            <CardHeader className="gap-3 border-b lg:flex-row lg:items-start lg:justify-between">
              <div><CardTitle>Do Not Ship &amp; Recovery</CardTitle><CardDescription>Channel cancellations and refunds are blocked from fulfillment. Orders that already moved with a carrier require a return or marketplace reimbursement review.</CardDescription></div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                <div className="relative min-w-0 sm:w-80"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} onPaste={(event) => normalizePastedSearch(event, query, setQuery)} placeholder="Search or paste orders, SKUs, tracking..." /></div>
                <Select value={doNotShipFilter} onValueChange={setDoNotShipFilter}><SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All blocked orders</SelectItem><SelectItem value="do_not_ship">Do not ship</SelectItem><SelectItem value="recovery_required">Recovery required</SelectItem></SelectContent></Select>
              </div>
            </CardHeader>
            <CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Channel</TableHead><TableHead>Disposition</TableHead><TableHead>Reason</TableHead><TableHead>Shipment evidence</TableHead><TableHead>Detected</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>
              {displayedDoNotShipQueue.map((row) => <TableRow key={String(row.id)} className={String(row.kind) === "recovery_required" ? "bg-amber-500/5" : "bg-destructive/5"}>
                <TableCell><a className="font-medium text-primary hover:underline" href={`/orders/${encodeURIComponent(String(row.orderId || row.orderNumber || ""))}`}>{String(row.orderNumber || row.orderId)}</a><p className="max-w-44 truncate text-xs text-muted-foreground">{String(row.customer || "Customer")}</p></TableCell>
                <TableCell><Badge variant="outline">{String(row.channel || "Unassigned")}</Badge>{row.channelOrderNumber ? <p className="mt-1 max-w-48 truncate font-mono text-xs text-muted-foreground" title={String(row.channelOrderNumber)}>{String(row.channelOrderNumber)}</p> : null}</TableCell>
                <TableCell><Badge variant={String(row.kind) === "recovery_required" ? "warning" : "destructive"}>{String(row.kind) === "recovery_required" ? "Recovery required" : "Do not ship"}</Badge><p className="mt-1 text-xs capitalize text-muted-foreground">{String(row.sourceReason || "channel hold")}</p></TableCell>
                <TableCell className="min-w-72"><p className="font-medium">{String(row.reasonLabel || "Channel status requires review")}</p><p className="mt-1 text-xs text-muted-foreground">{String(row.action || "Review before fulfillment.")}</p></TableCell>
                <TableCell><p className="text-sm capitalize">{String(row.shipmentStatus || "not shipped").replaceAll("_", " ")}</p>{row.trackingNumber ? <p className="mt-1 max-w-52 truncate font-mono text-xs text-muted-foreground" title={String(row.trackingNumber)}>{String(row.carrier || "Carrier")} · {String(row.trackingNumber)}</p> : <p className="mt-1 text-xs text-muted-foreground">No tracking recorded</p>}</TableCell>
                <TableCell><p className="whitespace-nowrap text-sm">{row.detectedAt ? dateLabel(String(row.detectedAt)) : "Not recorded"}</p></TableCell>
                <TableCell className="text-right"><Button size="sm" variant="outline" asChild><a href={`/orders/${encodeURIComponent(String(row.orderId || row.orderNumber || ""))}`}><Eye className="size-4" /> Open order</a></Button></TableCell>
              </TableRow>)}
              {!displayedDoNotShipQueue.length && <TableRow><TableCell colSpan={7} className="h-32 text-center text-muted-foreground">No blocked or recovery orders match these filters.</TableCell></TableRow>}
            </TableBody></Table></div></CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="purchased-labels" className="mt-4">
          <Card>
            <CardHeader className="gap-3 border-b lg:flex-row lg:items-start lg:justify-between">
              <div><CardTitle>Purchased labels</CardTitle><CardDescription>Print one order from its row, or choose a batch packet to print all labels purchased together. Print status shows whether each label has already been printed.{trackingRefresh?.completedAt ? ` Last checked ${dateLabel(String(trackingRefresh.completedAt))}.` : ""}</CardDescription></div>
              <div className="flex flex-wrap gap-2">
                <Popover open={printBatchPickerOpen} onOpenChange={(open) => { setPrintBatchPickerOpen(open); if (!open) setPrintBatchSearch("") }}>
                  <PopoverTrigger asChild><Button size="sm" variant="outline" disabled={!printableBatchJobs.length}><Printer className="size-4" /> Print batch <ChevronDown className="size-4" /></Button></PopoverTrigger>
                  <PopoverContent align="end" className="w-[min(22rem,calc(100vw-1rem))] overflow-hidden p-0">
                    <div className="relative border-b p-2"><Search className="absolute left-4 top-4 size-4 text-muted-foreground" /><Input autoFocus className="h-9 pl-9" value={printBatchSearch} onChange={(event) => setPrintBatchSearch(event.target.value)} placeholder="Filter batch, customer, order, or SKU" /></div>
                    <ScrollArea className="h-[min(18rem,45vh)]">
                      <div className="p-1">
                        {filteredPrintableBatchJobs.map((job) => <button key={String(job.id)} type="button" className="w-full rounded-sm px-2.5 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { setPrintBatchPickerOpen(false); setPrintBatchSearch(""); openPrintPreview(job) }}><span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{String(job.batchNumber || job.printNumber || "Label batch")}</span><Badge variant={String(job.warehouseStatus || "open") === "closed" ? "success" : "warning"}>{String(job.warehouseStatus || "open") === "closed" ? "Closed" : "Open"}</Badge></span><span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"><span>{numberLabel(Number(job.orderCount || 0))} label{Number(job.orderCount || 0) === 1 ? "" : "s"} · {String(job.lastOutputAction || "") === "saved_pdf" ? "Saved PDF" : isPrintedJob(job) ? "Printed" : "Not printed"}</span><RecoverySourceLabel record={job} /></span></button>)}
                        {!filteredPrintableBatchJobs.length ? <div className="px-3 py-6 text-center text-sm text-muted-foreground">No printable batches match this filter.</div> : null}
                      </div>
                    </ScrollArea>
                  </PopoverContent>
                </Popover>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void refreshCarrierTracking()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh tracking</Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="flex flex-col gap-3 border-b bg-muted/20 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={purchasedLabelFilter} onValueChange={setPurchasedLabelFilter}><SelectTrigger aria-label="Filter purchased labels by print status" className="h-9 w-[10.5rem]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Print status · All ({numberLabel(purchasedLabelQueue.length)})</SelectItem><SelectItem value="unprinted">Not printed ({numberLabel(purchasedLabelQueue.filter((row) => !fulfillmentShipmentPrinted(row)).length)})</SelectItem><SelectItem value="printed">Printed ({numberLabel(purchasedLabelQueue.filter(fulfillmentShipmentPrinted).length)})</SelectItem></SelectContent></Select>
                  <Select value={purchasedCarrierFilter} onValueChange={setPurchasedCarrierFilter}><SelectTrigger aria-label="Filter purchased labels by carrier" className="h-9 w-[10.5rem]"><SelectValue placeholder="Carrier" /></SelectTrigger><SelectContent><SelectItem value="all">Carrier · All</SelectItem>{purchasedCarrierOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label} ({numberLabel(option.count)})</SelectItem>)}</SelectContent></Select>
                  <Select value={purchasedSupplierFilter} onValueChange={setPurchasedSupplierFilter}><SelectTrigger aria-label="Filter purchased labels by supplier" className="h-9 w-[11.5rem]"><SelectValue placeholder="Supplier" /></SelectTrigger><SelectContent><SelectItem value="all">Supplier · All</SelectItem>{purchasedSupplierOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label} ({numberLabel(option.count)})</SelectItem>)}</SelectContent></Select>
                  <Select value={purchasedSkuFilter} onValueChange={setPurchasedSkuFilter}><SelectTrigger aria-label="Filter purchased labels by SKU" className="h-9 w-[12.5rem]"><SelectValue placeholder="SKU breakdown" /></SelectTrigger><SelectContent><SelectItem value="all">SKU breakdown · All</SelectItem>{purchasedSkuOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label} ({numberLabel(option.count)})</SelectItem>)}</SelectContent></Select>
                  <Select value={purchasedChannelFilter} onValueChange={setPurchasedChannelFilter}><SelectTrigger aria-label="Filter purchased labels by channel" className="h-9 w-[10rem]"><SelectValue placeholder="Channel" /></SelectTrigger><SelectContent><SelectItem value="all">Channel · All</SelectItem>{purchasedChannelOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label} ({numberLabel(option.count)})</SelectItem>)}</SelectContent></Select>
                  <Select value={purchasedLabelSourceFilter} onValueChange={setPurchasedLabelSourceFilter}><SelectTrigger aria-label="Filter purchased labels by label source" className="h-9 w-[11rem]"><SelectValue placeholder="Label source" /></SelectTrigger><SelectContent><SelectItem value="all">Label source · All</SelectItem>{purchasedLabelSourceOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label} ({numberLabel(option.count)})</SelectItem>)}</SelectContent></Select>
                  <Select value={purchasedChannelSyncFilter} onValueChange={setPurchasedChannelSyncFilter}><SelectTrigger aria-label="Filter purchased labels by channel update status" className="h-9 w-[11.5rem]"><SelectValue placeholder="Channel update" /></SelectTrigger><SelectContent><SelectItem value="all">Channel update · All</SelectItem>{purchasedChannelSyncOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label} ({numberLabel(option.count)})</SelectItem>)}</SelectContent></Select>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>Showing {numberLabel(displayedPurchasedLabels.length)} of {numberLabel(purchasedLabelQueue.length)} purchased labels. Filters use the loaded fulfillment snapshot.</span>
                  {purchasedFiltersActive ? <Button size="sm" variant="ghost" className="h-7 px-2" onClick={clearPurchasedLabelFilters}>Clear filters</Button> : null}
                </div>
              </div>
              <FulfillmentShipmentTable rows={displayedPurchasedLabels} onPrint={markPrinted} emptyMessage={purchasedFiltersActive ? "No purchased labels match these filters." : "No purchased labels are waiting for a carrier scan."} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="shipments" className="mt-4"><Card><CardHeader><CardTitle>Shipped orders</CardTitle><CardDescription>Only orders with carrier-confirmed movement or delivery appear here.</CardDescription></CardHeader><CardContent className="p-0"><FulfillmentShipmentTable rows={displayedShippedQueue} onPrint={markPrinted} emptyMessage="No carrier-confirmed shipments match this deadline filter." /></CardContent></Card></TabsContent>
        <TabsContent value="exceptions" className="mt-4 grid gap-2">
          {displayedExceptions.map((row) => <div key={String(row.id)} className={cn("flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between", row.type === "tracking" ? "border-destructive/30 bg-destructive/5" : "border-amber-500/30 bg-amber-500/5")}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><AlertTriangle className={cn("size-4", row.type === "tracking" ? "text-destructive" : "text-amber-600")} /><a className="font-medium text-primary hover:underline" href={`/orders/${encodeURIComponent(String(row.orderId || row.orderNumber || ""))}`}>Order {String(row.orderNumber || row.orderId)}</a><Badge variant="outline">{String(row.type || "exception")}</Badge>{row.trackingNumber ? <span className="font-mono text-xs text-muted-foreground">{String(row.trackingNumber)}</span> : null}</div><p className="mt-1 text-sm text-muted-foreground">{String(row.message || "Fulfillment requires review.")}</p>{row.createdAt ? <p className="mt-1 text-xs text-muted-foreground">Last attempt {dateLabel(String(row.createdAt))}</p> : null}</div><div className="flex shrink-0 items-center gap-3"><FulfillmentShipBy row={row} />{row.type === "tracking" ? <Button size="sm" variant="outline" asChild><a href={`/orders/${encodeURIComponent(String(row.orderId || row.orderNumber || ""))}`}><Eye className="size-4" /> Open order</a></Button> : <Button size="sm" onClick={() => openException(row)}><Pencil className="size-4" /> Resolve here</Button>}</div></div>)}
          {!displayedExceptions.length && <Empty className="min-h-56 rounded-md border"><EmptyHeader><EmptyMedia variant="icon"><CheckCircle2 className="size-4" /></EmptyMedia><EmptyTitle>No matching exceptions</EmptyTitle><EmptyDescription>There are no open exceptions for the selected ship-deadline filter.</EmptyDescription></EmptyHeader></Empty>}
        </TabsContent>
        <TabsContent value="manifests" className="mt-4 grid gap-4"><Card><CardHeader><CardTitle>Create end-of-day closeout</CardTitle><CardDescription>Groups today&apos;s labels by carrier. It is an internal manifest until a carrier-specific electronic submission is connected.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]"><Field label="Carrier"><Select value={manifestDraft.carrier} onValueChange={(carrier) => setManifestDraft((current) => ({ ...current, carrier }))}><SelectTrigger><SelectValue placeholder="Choose carrier" /></SelectTrigger><SelectContent>{carrierNames.map((carrier) => <SelectItem key={carrier} value={carrier}>{carrier}</SelectItem>)}</SelectContent></Select></Field><Field label="Ship date"><Input type="date" value={manifestDraft.shipDate} onChange={(event) => setManifestDraft((current) => ({ ...current, shipDate: event.target.value }))} /></Field><div className="flex items-end"><Button className="w-full" disabled={busy || !manifestDraft.carrier} onClick={() => void createManifest()}>Close carrier day</Button></div></CardContent></Card><Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Manifest</TableHead><TableHead>Carrier</TableHead><TableHead>Date</TableHead><TableHead>Shipments</TableHead><TableHead>Cost</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{manifests.map((row) => <TableRow key={String(row.id)}><TableCell className="font-medium">{String(row.manifestNumber)}</TableCell><TableCell>{String(row.carrier)}</TableCell><TableCell>{String(row.shipDate)}</TableCell><TableCell>{numberLabel(Number(row.shipmentCount || 0))}</TableCell><TableCell>{moneyLabel(Number(row.totalCost || 0))}</TableCell><TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => window.open(`/api/fulfillment/manifests/${encodeURIComponent(String(row.id))}/print`, "_blank", "noopener,noreferrer")}><Printer className="size-4" /> Print</Button></TableCell></TableRow>)}</TableBody></Table></CardContent></Card></TabsContent>
        <TabsContent value="reports" className="mt-4 grid gap-4"><div className="grid gap-3 sm:grid-cols-3"><Detail label="Total shipments" value={numberLabel(Number(data.reports?.totalShipments || 0))} /><Detail label="Total label cost" value={moneyLabel(Number(data.reports?.totalCost || 0))} /><Detail label="Average label cost" value={moneyLabel(Number(data.reports?.totalShipments || 0) ? Number(data.reports?.totalCost || 0) / Number(data.reports?.totalShipments || 1) : 0)} /></div><Card><CardHeader><CardTitle>Carrier usage</CardTitle><CardDescription>Current retained shipment history by carrier.</CardDescription></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Carrier</TableHead><TableHead>Shipments</TableHead><TableHead>Total cost</TableHead><TableHead>Average</TableHead></TableRow></TableHeader><TableBody>{(data.reports?.byCarrier || []).map((row: Record<string, any>) => <TableRow key={String(row.carrier)}><TableCell className="font-medium">{String(row.carrier)}</TableCell><TableCell>{numberLabel(Number(row.shipments || 0))}</TableCell><TableCell>{moneyLabel(Number(row.cost || 0))}</TableCell><TableCell>{moneyLabel(Number(row.shipments || 0) ? Number(row.cost || 0) / Number(row.shipments || 1) : 0)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card></TabsContent>
        <TabsContent value="settings" className="mt-4 grid gap-4"><Card><CardHeader><CardTitle>Fulfillment defaults</CardTitle><CardDescription>Controls the warehouse workflow and bulk-label behavior. Carrier credentials remain in Channels.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Field label="Default ship-from warehouse"><Select value={String(settingsDraft.defaultShipFromWarehouseId || "")} onValueChange={(value) => setSettingsDraft((current) => ({ ...current, defaultShipFromWarehouseId: value }))}><SelectTrigger><SelectValue placeholder="Choose warehouse" /></SelectTrigger><SelectContent>{warehouses.map((warehouse) => <SelectItem key={String(warehouse.id)} value={String(warehouse.id)}>{String(warehouse.name || warehouse.code || "Warehouse")}</SelectItem>)}</SelectContent></Select><p className="mt-1 text-xs text-muted-foreground">Used for rates, labels, and return addresses, including dropship orders.</p></Field><Field label="Orders per shipping batch"><Input type="number" min="1" max="100" value={String(settingsDraft.maxOrdersPerBatch || 100)} onChange={(event) => setSettingsDraft((current) => ({ ...current, maxOrdersPerBatch: Number(event.target.value || 100) }))} /></Field><Field label="Processing chunk size"><Input type="number" min="1" max="20" value={String(settingsDraft.processingChunkSize || 10)} onChange={(event) => setSettingsDraft((current) => ({ ...current, processingChunkSize: Number(event.target.value || 10) }))} /></Field><Field label="Default picking mode"><Select value={String(settingsDraft.defaultPickingMode || "most_efficient")} onValueChange={(value) => setSettingsDraft((current) => ({ ...current, defaultPickingMode: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="most_efficient">Most efficient</SelectItem><SelectItem value="single_tote">Single tote</SelectItem><SelectItem value="pick_to_order">Pick to order</SelectItem></SelectContent></Select></Field><Field label="Default label size"><Select value={String(settingsDraft.defaultPrintSize || "4x6")} onValueChange={(value) => setSettingsDraft((current) => ({ ...current, defaultPrintSize: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="4x6">4 × 6 thermal</SelectItem><SelectItem value="letter">US Letter</SelectItem></SelectContent></Select></Field><ToggleField label="Require scan to pack" checked={settingsDraft.requireScanToPack !== false} onCheckedChange={(value) => setSettingsDraft((current) => ({ ...current, requireScanToPack: value }))} /><ToggleField label="Require quality check" checked={settingsDraft.requireQualityCheck === true} onCheckedChange={(value) => setSettingsDraft((current) => ({ ...current, requireQualityCheck: value }))} /><ToggleField label="Include packing slips" checked={settingsDraft.autoPrintPackingSlip !== false} onCheckedChange={(value) => setSettingsDraft((current) => ({ ...current, autoPrintPackingSlip: value }))} /><ToggleField label="Detect orders that can ship together" checked={settingsDraft.shipmentConsolidationEnabled !== false} onCheckedChange={(value) => setSettingsDraft((current) => ({ ...current, shipmentConsolidationEnabled: value }))} /><Field label="Ship-together window (hours)"><Input type="number" min="1" max="168" value={String(settingsDraft.shipmentConsolidationWindowHours || 24)} onChange={(event) => setSettingsDraft((current) => ({ ...current, shipmentConsolidationWindowHours: Number(event.target.value || 24) }))} /></Field></CardContent></Card><Card><CardHeader className="flex-row items-start justify-between"><div><CardTitle>Shipping automation rules</CardTitle><CardDescription>Rules are evaluated by priority. The winning rule and any conflicts are saved on each batch row.</CardDescription></div><Button size="sm" variant="outline" onClick={addRule}><Plus className="size-4" /> Add rule</Button></CardHeader><CardContent className="grid gap-3">{(settingsDraft.rules || []).map((rule: Record<string, any>, index: number) => <div key={String(rule.id)} className="grid gap-3 rounded-md border p-3 lg:grid-cols-[80px_minmax(160px,1fr)_minmax(130px,1fr)_minmax(130px,1fr)_120px_auto]"><Field label="Priority"><Input type="number" min="1" value={String(rule.priority || index + 1)} onChange={(event) => updateRule(String(rule.id), { priority: Number(event.target.value || 1) })} /></Field><Field label="Rule name"><Input value={String(rule.name || "")} onChange={(event) => updateRule(String(rule.id), { name: event.target.value })} /></Field><Field label="Channel(s)"><Input value={(rule.channels || []).join(", ")} onChange={(event) => updateRule(String(rule.id), { channels: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} placeholder="Shopify, eBay" /></Field><Field label="Destination states"><Input value={(rule.destinationStates || []).join(", ")} onChange={(event) => updateRule(String(rule.id), { destinationStates: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} placeholder="NY, NJ" /></Field><Field label="Selection"><Select value={String(rule.selection || "preferred")} onValueChange={(value) => updateRule(String(rule.id), { selection: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="preferred">Preferred</SelectItem><SelectItem value="cheapest">Cheapest</SelectItem><SelectItem value="fastest">Fastest</SelectItem></SelectContent></Select></Field><div className="flex items-end gap-2"><Switch aria-label={`Enable ${String(rule.name || "rule")}`} checked={rule.enabled !== false} onCheckedChange={(value) => updateRule(String(rule.id), { enabled: value })} /><Button size="icon" variant="ghost" title="Delete rule" onClick={() => setSettingsDraft((current) => ({ ...current, rules: (current.rules || []).filter((entry: Record<string, any>) => String(entry.id) !== String(rule.id)) }))}><Trash2 className="size-4" /></Button></div><div className="grid gap-3 lg:col-span-6 sm:grid-cols-2 lg:grid-cols-5"><Field label="Carrier contains"><Input value={String(rule.carrier || "")} onChange={(event) => updateRule(String(rule.id), { carrier: event.target.value })} placeholder="UPS" /></Field><Field label="Service contains"><Input value={String(rule.service || "")} onChange={(event) => updateRule(String(rule.id), { service: event.target.value })} placeholder="Ground" /></Field><Field label="Minimum weight"><Input type="number" min="0" value={String(rule.minWeight || 0)} onChange={(event) => updateRule(String(rule.id), { minWeight: Number(event.target.value || 0) })} /></Field><Field label="Maximum weight"><Input type="number" min="0" value={String(rule.maxWeight || 0)} onChange={(event) => updateRule(String(rule.id), { maxWeight: Number(event.target.value || 0) })} /></Field><Field label="Delivery method contains"><Input value={String(rule.deliveryMethodContains || "")} onChange={(event) => updateRule(String(rule.id), { deliveryMethodContains: event.target.value })} /></Field></div></div>)}{!(settingsDraft.rules || []).length && <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No fulfillment-specific rules. The channel shipping-label default selects the rate.</p>}</CardContent><CardFooter className="justify-end border-t pt-4"><Button disabled={busy} onClick={() => void saveSettings()}><Save className="size-4" /> Save fulfillment settings</Button></CardFooter></Card></TabsContent>
        <TabsContent value="carriers" className="mt-4 grid gap-4">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3 border-b">
              <div><CardTitle>Carriers and services</CardTitle><CardDescription>Choose which carriers and services appear when recording shipments, editing tracking, and adding PO tracking.</CardDescription></div>
              <Button size="sm" disabled={busy} onClick={() => void saveSettings()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save carriers</Button>
            </CardHeader>
            <CardContent className="grid gap-4 p-4 lg:grid-cols-2">
              {configuredCarriers.map((carrier) => {
                const enabledServices = carrier.services.filter((service) => service.enabled).length
                return <section key={carrier.id} className={cn("rounded-md border", !carrier.enabled && "bg-muted/20")}>
                  <div className="flex items-start justify-between gap-4 border-b p-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{carrier.name}</h3><Badge variant={carrier.enabled ? "success" : "secondary"}>{carrier.enabled ? "Enabled" : "Disabled"}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{enabledServices} of {carrier.services.length} services enabled{carrier.phone ? ` · ${carrier.phone}` : ""}</p></div><Switch aria-label={`Enable ${carrier.name}`} checked={carrier.enabled} onCheckedChange={(enabled) => updateCarrier(carrier.id, { enabled })} /></div>
                  <div className="grid gap-1 p-3">{carrier.services.map((service) => <label key={service.id} className={cn("flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted/40", !carrier.enabled && "cursor-not-allowed opacity-60")}><Checkbox disabled={!carrier.enabled} checked={service.enabled} onCheckedChange={(enabled) => updateCarrierService(carrier.id, service.id, enabled === true)} /><span>{service.name}</span></label>)}</div>
                  <div className="border-t px-4 py-3 text-xs text-muted-foreground"><p className="truncate" title={carrier.trackingUrlTemplate || ""}>{carrier.trackingUrlTemplate || "Tracking URL entered manually"}</p></div>
                </section>
              })}
              {!configuredCarriers.length && <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground lg:col-span-2">Carrier defaults are loading. Refresh this page if they do not appear.</div>}
            </CardContent>
            <CardFooter className="border-t text-xs text-muted-foreground">Other remains available for uncommon carriers and requires a carrier name, tracking URL, and optional phone number.</CardFooter>
          </Card>
        </TabsContent>
      </Tabs>
      <Sheet open={quickViewRows.length > 0} onOpenChange={(open) => { if (!open) setQuickViewRows([]) }}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
          {(() => {
            const row = quickViewRows.find((entry) => entry.rateReview?.selectedRate) || quickViewRows[0]
            if (!row) return null
            const destination = (row.destination || {}) as Record<string, any>
            const readiness = (row.labelReadiness || {}) as Record<string, any>
            const selectedRate = row.rateReview?.selectedRate as Record<string, any> | undefined
            return <>
              <SheetHeader className="border-b px-5 py-4 text-left">
                <div className="flex flex-wrap items-center gap-2"><SheetTitle>Order {String(row.orderNumber || row.orderId)}</SheetTitle><Badge variant="outline">{String(row.channel || "Unassigned")}</Badge><Badge variant={row.status === "exception" ? "destructive" : ["Ready to ship", "label_ready"].includes(String(row.status || "")) ? "success" : "outline"}>{String(row.status || "new").replace(/_/g, " ")}</Badge></div>
                <SheetDescription>{String(row.customer || destination.name || "Customer")} · {quickViewRows.length} item{quickViewRows.length === 1 ? "" : "s"} in this shipment</SheetDescription>
              </SheetHeader>
              <ScrollArea className="min-h-0 flex-1">
                <div className="grid gap-0">
                  <section className="border-b px-5 py-4"><p className="mb-3 text-xs font-semibold uppercase text-muted-foreground">Shipment readiness</p><FulfillmentReadinessChecklist row={row} /></section>
                  <section className="border-b px-5 py-4"><div className="mb-3 flex items-center justify-between"><p className="text-xs font-semibold uppercase text-muted-foreground">Items</p><Badge variant="secondary">{numberLabel(quickViewRows.reduce((total, item) => total + Number(item.qty || 0), 0))} units</Badge></div><div className="grid gap-3">{quickViewRows.map((item) => <div key={String(item.id)} className="flex items-center gap-3"><a href={`/products/${encodeURIComponent(String(item.parentSku || item.catalogSku || item.sku || ""))}`} className="shrink-0">{item.productImage ? <img src={String(item.productImage)} alt="" className="size-12 rounded-md border bg-background object-contain" /> : <span className="grid size-12 place-items-center rounded-md border bg-muted"><Package className="size-4 text-muted-foreground" /></span>}</a><div className="min-w-0 flex-1"><a href={`/products/${encodeURIComponent(String(item.parentSku || item.catalogSku || item.sku || ""))}`} className="block truncate font-medium hover:underline">{String(item.sku || "Missing SKU")}</a><p className="truncate text-xs text-muted-foreground">{String(item.title || item.productTitle || "Catalog product")}</p></div><div className="text-right"><p className="font-medium tabular-nums">{numberLabel(Number(item.qty || 0))}</p>{item.shipAlone === true ? <Badge variant="outline" className="text-[10px]">Ships alone</Badge> : null}</div></div>)}</div></section>
                  <section className="grid gap-4 border-b px-5 py-4 sm:grid-cols-2"><div><p className="text-xs font-semibold uppercase text-muted-foreground">Ship to</p><p className="mt-2 font-medium">{String(destination.name || row.customer || "Customer")}</p><p className="text-sm text-muted-foreground">{[destination.line1 || destination.address1, destination.line2 || destination.address2, destination.city || destination.town, destination.state || destination.province, destination.postalCode || destination.zip || destination.postcode, destination.country].filter(Boolean).join(", ") || "Address needs review"}</p></div><div><p className="text-xs font-semibold uppercase text-muted-foreground">Fulfill from</p><p className="mt-2 font-medium">{String(row.warehouseName || "Unassigned warehouse")}</p><p className="text-sm text-muted-foreground">{String(row.supplierName || "Internal stock")} · {String(row.supplyLabel || "No PO")}</p></div></section>
                  <section className="grid gap-4 border-b px-5 py-4 sm:grid-cols-2"><div><p className="text-xs font-semibold uppercase text-muted-foreground">Package</p><p className="mt-2 font-medium tabular-nums">{String(readiness.weight || 0)} lb</p><p className="text-sm text-muted-foreground tabular-nums">{String(readiness.length || 0)} × {String(readiness.width || 0)} × {String(readiness.height || 0)} in</p></div><div><p className="text-xs font-semibold uppercase text-muted-foreground">Selected rate</p>{selectedRate ? <><p className="mt-2 font-medium">{selectedRate.amount === null || selectedRate.amount === undefined ? "Cost unavailable" : moneyLabel(Number(selectedRate.amount))}</p><p className="text-sm text-muted-foreground">{`${String(selectedRate.carrier || "Carrier")} ${String(selectedRate.service || "")}`.trim()}</p></> : <p className="mt-2 text-sm text-muted-foreground">No rate selected</p>}</div></section>
                  <section className="px-5 py-4"><p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Ship deadline</p><FulfillmentShipBy row={row} /></section>
                </div>
              </ScrollArea>
              <SheetFooter className="grid grid-cols-2 border-t bg-background px-5 py-4"><Button variant="outline" onClick={() => { setQuickViewRows([]); editPackageGroup(quickViewRows) }}><Pencil className="size-4" /> Edit package</Button><Button asChild><a href={`/orders/${encodeURIComponent(String(row.orderId))}`}>Open full order <ArrowRight className="size-4" /></a></Button></SheetFooter>
            </>
          })()}
        </SheetContent>
      </Sheet>
      <Dialog open={Boolean(consolidationOrder)} onOpenChange={(open) => { if (!open && !consolidationLoading) { setConsolidationOrder(null); setConsolidationCartonization(null) } }}>
        <DialogContent className="flex max-h-[92dvh] w-[calc(100%-2rem)] max-w-2xl flex-col overflow-hidden">
          <DialogHeader><DialogTitle>Ship orders together</DialogTitle><DialogDescription>One physical package and tracking number can serve these orders. Each marketplace order, payment, and channel reference remains separate.</DialogDescription></DialogHeader>
          {consolidationLoading && !consolidationCandidates.length ? <div className="grid gap-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div> : <div className="min-h-0 space-y-3 overflow-y-auto">
            <Alert><PackageCheck className="size-4" /><AlertTitle>Cartonization preview</AlertTitle><AlertDescription>DataPlus tests the selected orders against the configured package catalog. This preview does not request rates or change labels. Confirm the physical carton before purchase.</AlertDescription></Alert>
            <div className="rounded-md border p-3 text-sm"><div className="flex items-center justify-between gap-3"><div><p className="font-medium">Order {String(consolidationOrder?.orderNumber || consolidationOrder?.orderId || "")}</p><p className="text-xs text-muted-foreground">{String(consolidationOrder?.customer || "Customer")} · {String(consolidationOrder?.warehouseName || "Warehouse")}</p></div><Badge>Primary</Badge></div></div>
            <div className="rounded-md border"><Table><TableHeader><TableRow><TableHead className="w-10" /><TableHead>Order</TableHead><TableHead>Created</TableHead><TableHead>Match</TableHead></TableRow></TableHeader><TableBody>{consolidationCandidates.map((candidate) => { const id = String(candidate.id || ""); return <TableRow key={id}><TableCell><Checkbox checked={consolidationSelection.has(id)} onCheckedChange={(checked) => updateConsolidationSelection(id, checked === true)} /></TableCell><TableCell><a className="font-medium text-primary hover:underline" href={`/orders/${encodeURIComponent(id)}`}>{String(candidate.orderNumber || id)}</a><p className="text-xs text-muted-foreground">{String(candidate.buyer || "Customer")}</p></TableCell><TableCell className="text-xs">{candidate.createdAt ? dateLabel(String(candidate.createdAt)) : "-"}</TableCell><TableCell><Badge variant="outline">Customer + address + warehouse</Badge></TableCell></TableRow> })}{!consolidationCandidates.length && <TableRow><TableCell colSpan={4} className="h-20 text-center text-muted-foreground">No compatible orders remain.</TableCell></TableRow>}</TableBody></Table></div>
            <div className="rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-medium">Suggested package plan</p><p className="text-xs text-muted-foreground">Uses SKU/package measurements, carton tare weight, and DIM divisor {numberLabel(Number(consolidationCartonization?.divisor || 139))}.</p></div>{consolidationCartonization?.status ? <Badge variant={consolidationCartonization.status === "single_carton" ? "default" : consolidationCartonization.status === "blocked" ? "destructive" : "secondary"}>{String(consolidationCartonization.status).replaceAll("_", " ")}</Badge> : null}</div>
              {consolidationPreviewLoading ? <div className="mt-3 grid gap-2"><Skeleton className="h-20" /><Skeleton className="h-20" /></div> : consolidationCartonization ? <div className="mt-3 grid gap-3"><p className="text-sm text-muted-foreground">{String(consolidationCartonization.reason || "Review the suggested package plan.")}</p>{Array.isArray(consolidationCartonization.cartons) && consolidationCartonization.cartons.length ? <div className="grid gap-2 sm:grid-cols-2">{consolidationCartonization.cartons.map((carton: Record<string, any>, index: number) => <div key={`${String(carton.packageId || "carton")}-${index}`} className="rounded-md border bg-muted/20 p-3 text-sm"><div className="flex items-start justify-between gap-2"><p className="font-medium">Package {index + 1}: {String(carton.packageName || "Custom carton")}</p><Badge variant="outline">{Number(carton.placements?.length || 0)} item{Number(carton.placements?.length || 0) === 1 ? "" : "s"}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{Number(carton.length || 0)} × {Number(carton.width || 0)} × {Number(carton.height || 0)} in · {Number(carton.physicalWeight || 0).toFixed(2)} lb physical</p><div className="mt-2 grid grid-cols-2 gap-2 text-xs"><span>DIM weight <strong>{Number(carton.dimensionalWeight || 0).toFixed(2)} lb</strong></span><span>Billable <strong>{Number(carton.billableWeight || 0).toFixed(2)} lb</strong></span></div></div>)}</div> : null}{consolidationCartonization.status === "manual_review" || consolidationCartonization.status === "blocked" ? <Alert variant="destructive"><AlertTriangle className="size-4" /><AlertTitle>Warehouse review required</AlertTitle><AlertDescription>Add the needed package preset or correct missing measurements before requesting a combined-shipment rate.</AlertDescription></Alert> : null}</div> : <p className="mt-3 text-sm text-muted-foreground">Select at least one compatible order to calculate a package plan.</p>}
            </div>
            <p className="text-xs text-muted-foreground">Matches are limited to the configured {numberLabel(Number(consolidationOrder?.shipmentConsolidation?.windowHours || 24))}-hour window. Picked, packed, held, shipped, labeled, or mismatched-warehouse orders are excluded.</p>
          </div>}
          <DialogFooter><Button variant="outline" disabled={consolidationLoading} onClick={() => setConsolidationOrder(null)}>Cancel</Button><Button disabled={consolidationLoading || consolidationPreviewLoading || !consolidationSelection.size || consolidationCartonization?.status === "blocked"} onClick={() => void saveShipmentConsolidation()}>{consolidationLoading ? <Loader2 className="size-4 animate-spin" /> : <PackageCheck className="size-4" />} Create one shipment group</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(testPrintStation)} onOpenChange={(open) => !open && setTestPrintStation(null)}>
        <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-full max-w-none flex-col gap-0 overflow-hidden p-0 sm:h-[92dvh] sm:max-w-5xl sm:rounded-lg">
          <DialogHeader className="border-b p-4 pr-12"><DialogTitle>Preview printer test</DialogTitle><DialogDescription>Review the exact test packet and use the same document options as a regular label. This preview is not postage and contains no customer data.</DialogDescription></DialogHeader>
          <div className="grid gap-4 border-b p-4 lg:grid-cols-[minmax(180px,1fr)_minmax(150px,220px)_minmax(260px,1.4fr)]">
            <Field label="Printer"><Select value={testPrintDraft.printerName} onValueChange={(printerName) => setTestPrintDraft((current) => ({ ...current, printerName }))}><SelectTrigger><SelectValue placeholder="Choose printer" /></SelectTrigger><SelectContent>{(testPrintStation?.printers || []).map((printer: string) => <SelectItem key={printer} value={printer}>{printer}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Paper size"><Select value={testPrintDraft.size} onValueChange={(size) => setTestPrintDraft((current) => ({ ...current, size }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="4x6">4 × 6 thermal</SelectItem><SelectItem value="letter">US Letter</SelectItem></SelectContent></Select></Field>
            <Field label="Documents"><RadioGroup value={testPrintDraft.includePackingSlips ? "label-packing" : "label"} onValueChange={(value) => setTestPrintDraft((current) => ({ ...current, includePackingSlips: value === "label-packing" }))} className="grid gap-2 sm:grid-cols-2"><label className="flex cursor-pointer items-center gap-2 rounded-md border p-3"><RadioGroupItem value="label" /><span className="text-sm">Label only</span></label><label className="flex cursor-pointer items-center gap-2 rounded-md border p-3"><RadioGroupItem value="label-packing" /><span className="text-sm">Label + packing slip</span></label></RadioGroup></Field>
          </div>
          <div className="min-h-0 flex-1 bg-muted/30 p-2 sm:p-4">{testPrintPreviewUrl ? <iframe key={testPrintPreviewUrl} src={testPrintPreviewUrl} title="DataPlus printer test preview" className="h-full min-h-[420px] w-full rounded-md border bg-white" /> : null}</div>
          <DialogFooter className="border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><Button variant="outline" onClick={() => setTestPrintStation(null)}>Cancel</Button>{testPrintPreviewUrl ? <Button variant="outline" asChild><a href={testPrintPreviewUrl} download="DataPlus-Printer-Test.pdf"><FileDown className="size-4" /> Download preview</a></Button> : null}<Button disabled={busy || !testPrintDraft.printerName} onClick={() => void printStationTestPage()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />} Print test</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(dispatchPrintJob)} onOpenChange={(open) => !open && setDispatchPrintJob(null)}><DialogContent className="w-[calc(100vw-1rem)] sm:max-w-lg"><DialogHeader><DialogTitle>Send to warehouse printer</DialogTitle><DialogDescription>{String(dispatchPrintJob?.printNumber || "This packet")} will be printed by the selected paired desktop. This does not purchase labels again.</DialogDescription></DialogHeader><div className="grid gap-4"><Field label="Print station"><Select value={dispatchStationId} onValueChange={chooseDispatchStation}><SelectTrigger><SelectValue placeholder="Choose a desktop" /></SelectTrigger><SelectContent>{printStations.filter((station) => station.status === "active").map((station) => <SelectItem key={String(station.id)} value={String(station.id)}>{String(station.name)}{station.online ? " · Online" : " · Offline"}</SelectItem>)}</SelectContent></Select></Field><Field label="Printer"><Select value={dispatchPrinter} onValueChange={setDispatchPrinter}><SelectTrigger><SelectValue placeholder="Choose a printer" /></SelectTrigger><SelectContent>{(printStations.find((station) => String(station.id) === dispatchStationId)?.printers || []).map((printer: string) => <SelectItem key={printer} value={printer}>{printer}</SelectItem>)}</SelectContent></Select></Field>{dispatchStationId && !printStations.find((station) => String(station.id) === dispatchStationId)?.online ? <Alert><AlertTriangle className="size-4" /><AlertTitle>Desktop is offline</AlertTitle><AlertDescription>The packet will remain queued and print automatically when the desktop agent reconnects.</AlertDescription></Alert> : null}</div><DialogFooter><Button variant="outline" onClick={() => setDispatchPrintJob(null)}>Cancel</Button><Button disabled={busy || !dispatchStationId || !dispatchPrinter} onClick={() => void dispatchToDesktop()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />} Send to printer</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={pairStationOpen} onOpenChange={(open) => { setPairStationOpen(open); if (!open) setPairingResult(null) }}>
        <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-xl">
          <DialogHeader><DialogTitle>Pair a desktop print station</DialogTitle><DialogDescription>No DataPlus project folder or Node.js installation is required. The one-time code expires after 15 minutes.</DialogDescription></DialogHeader>
          {!pairingResult ? <Field label="Station name"><Input value={pairStationName} onChange={(event) => setPairStationName(event.target.value)} placeholder="Packing desk 1" /></Field> : <div className="grid gap-4">
            <div className="rounded-md border bg-muted/30 p-4 text-center"><p className="text-xs font-medium uppercase text-muted-foreground">One-time pairing code</p><p className="mt-2 font-mono text-3xl font-semibold tracking-widest">{String(pairingResult.pairingCode || "")}</p></div>
            <div className="grid gap-2"><Label>Run once in Windows PowerShell</Label><div className="flex items-start gap-2 rounded-md border bg-muted/30 p-3"><code className="min-w-0 flex-1 break-all text-xs">{windowsPrintAgentCommand}</code><Button size="icon" variant="ghost" title="Copy install command" onClick={() => void navigator.clipboard.writeText(windowsPrintAgentCommand)}><Copy className="size-4" /></Button></div><p className="text-xs text-muted-foreground">This installs the agent in Local AppData, starts it in the background, and makes it start automatically when that Windows user signs in.</p></div>
            <Button variant="outline" asChild><a href="/api/fulfillment/print-agent/windows.ps1" download="DataPlusPrintAgent.ps1"><FileDown className="size-4" /> Download agent script</a></Button>
          </div>}
          <DialogFooter><Button variant="outline" onClick={() => setPairStationOpen(false)}>{pairingResult ? "Done" : "Cancel"}</Button>{!pairingResult ? <Button disabled={busy || !pairStationName.trim()} onClick={() => void createPairingCode()}>{busy && <Loader2 className="size-4 animate-spin" />} Create pairing code</Button> : null}</DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(exceptionRecord)} onOpenChange={(open) => { if (!open) { setExceptionRecord(null); setExceptionRow(null) } }}>
        <DialogContent className="max-h-[94vh] w-[calc(100vw-1rem)] max-w-4xl overflow-y-auto p-0">
          <DialogHeader className="border-b px-4 py-4 sm:px-6"><DialogTitle>Resolve fulfillment exception</DialogTitle><DialogDescription>{exceptionRecord?.type === "missing_catalog_product" ? "Enter this shipment's package details to create the label now. The catalog SKU can be created or linked later." : "Correct the warehouse, delivery address, and package without leaving the fulfillment queue."}</DialogDescription></DialogHeader>
          <div className="grid gap-5 px-4 py-5 sm:px-6">
            <Alert variant="destructive"><AlertTriangle className="size-4" /><AlertTitle>Order {String(exceptionRecord?.orderNumber || exceptionRecord?.orderId || "")}</AlertTitle><AlertDescription>{String(exceptionRecord?.message || "Fulfillment requires review.")}</AlertDescription></Alert>
            {!exceptionRow ? exceptionRecord?.type === "missing_catalog_product" ? <div className="grid gap-5">
              <section className="grid gap-3 rounded-md border p-4"><div><p className="font-medium">Create the channel SKU as a new product</p><p className="text-sm text-muted-foreground">Creates <span className="font-mono text-foreground">{String(exceptionRecord.sku || "")}</span> as its own draft catalog product using the order title and source. Use this only when it is truly a new item.</p></div><Button className="w-fit" disabled={busy || !String(exceptionRecord.sku || "").trim()} onClick={() => void resolveMissingSku("create")}><Plus className="size-4" /> Create source SKU</Button></section>
              <section className="grid gap-3 rounded-md border p-4"><div><p className="font-medium">Link to an existing catalog product</p><p className="text-sm text-muted-foreground">Choose the product that owns inventory for <span className="font-mono text-foreground">{String(exceptionRecord.sku || "this channel SKU")}</span>, then choose the relationship.</p></div><div className="relative"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input className="pl-9" value={shadowQuery} onChange={(event) => setShadowQuery(event.target.value)} placeholder="Search parent SKU, UPC, title, or brand" /></div>{shadowSearching ? <p className="text-xs text-muted-foreground">Searching catalog...</p> : null}{shadowQuery.trim().length >= 2 ? <div className="max-h-64 overflow-y-auto rounded-md border">{shadowResults.map((product) => <button key={product.id || product.sku} type="button" onClick={() => setShadowTargetSku(String(product.sku || ""))} className={`grid w-full gap-1 border-b px-3 py-3 text-left last:border-b-0 hover:bg-muted ${shadowTargetSku === String(product.sku || "") ? "bg-blue-500/10 ring-1 ring-inset ring-blue-500" : ""}`}><span className="font-mono text-xs font-semibold">{product.sku}</span><span className="truncate text-sm">{product.title || product.marketplaceTitle || product.sku}</span></button>)}{!shadowSearching && !shadowResults.length ? <p className="p-4 text-sm text-muted-foreground">No catalog products match this search.</p> : null}</div> : null}<div className="grid gap-3 sm:grid-cols-2"><div className="grid gap-2 rounded-md border bg-muted/20 p-3"><div><p className="font-medium">Add alias</p><p className="text-xs text-muted-foreground">Use when both SKUs are the same product and the same selling unit.</p></div><Button variant="outline" disabled={busy || !shadowTargetSku} onClick={() => void resolveMissingSku("alias")}><Link2 className="size-4" /> Add alias</Button></div><div className="grid gap-2 rounded-md border bg-muted/20 p-3"><div><p className="font-medium">Create pack shadow</p><p className="text-xs text-muted-foreground">The channel SKU shares the parent inventory and deducts the selected number of pieces per order unit.</p></div><Field label="Pieces per ordered pack"><Input type="number" min="1" step="1" value={shadowUnitsPerPack} onChange={(event) => setShadowUnitsPerPack(event.target.value)} /></Field><Button disabled={busy || !shadowTargetSku || !(Number(shadowUnitsPerPack) >= 1)} onClick={() => void resolveMissingSku("shadow")}><Copy className="size-4" /> Create shadow</Button></div></div></section>
            </div> : <div className="grid gap-3 rounded-md border border-dashed p-5"><p className="font-medium">No active warehouse line is attached to this exception.</p><p className="text-sm text-muted-foreground">Retry routing here. DataPlus will check physical inventory and purchase-order supply again.</p><Button className="w-fit" disabled={busy} onClick={() => void retryExceptionRouting()}><RefreshCw className="size-4" /> Retry routing</Button></div> : <>
              {exceptionRecord?.type === "missing_catalog_product" ? <Alert><Info className="size-4" /><AlertTitle>Catalog setup will not block this label</AlertTitle><AlertDescription>The dimensions below apply only to this shipment. DataPlus can rate and purchase the label now, while the SKU remains available for catalog creation or alias mapping later.</AlertDescription></Alert> : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Ship-from warehouse"><Select value={resolutionDraft.warehouseId} onValueChange={(warehouseId) => setResolutionDraft((current) => ({ ...current, warehouseId }))}><SelectTrigger><SelectValue placeholder="Choose warehouse" /></SelectTrigger><SelectContent>{warehouses.map((warehouse) => <SelectItem key={String(warehouse.id)} value={String(warehouse.id)}>{String(warehouse.name || warehouse.code || warehouse.id)}</SelectItem>)}</SelectContent></Select></Field>
                <div className="rounded-md border bg-muted/20 p-3"><p className="text-xs font-medium uppercase text-muted-foreground">Supply</p><p className="mt-1 font-medium">{String(exceptionRow.supplyLabel || "No PO")}</p>{exceptionRow.purchaseOrderNumber ? <p className="text-xs text-muted-foreground">{String(exceptionRow.purchaseOrderNumber)}</p> : null}</div>
              </div>
              <section className="grid gap-3"><div><h3 className="font-medium">Ship to</h3><p className="text-sm text-muted-foreground">Carrier labels use this address.</p></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Recipient"><Input value={resolutionDraft.name} onChange={(event) => setResolutionDraft((current) => ({ ...current, name: event.target.value }))} /></Field><Field label="Phone"><Input value={resolutionDraft.phone} onChange={(event) => setResolutionDraft((current) => ({ ...current, phone: event.target.value }))} /></Field><Field label="Address line 1"><Input value={resolutionDraft.line1} onChange={(event) => setResolutionDraft((current) => ({ ...current, line1: event.target.value }))} /></Field><Field label="Address line 2"><Input value={resolutionDraft.line2} onChange={(event) => setResolutionDraft((current) => ({ ...current, line2: event.target.value }))} /></Field><Field label="City"><Input value={resolutionDraft.city} onChange={(event) => setResolutionDraft((current) => ({ ...current, city: event.target.value }))} /></Field><Field label="State"><Input value={resolutionDraft.state} onChange={(event) => setResolutionDraft((current) => ({ ...current, state: event.target.value }))} /></Field><Field label="Postal code"><Input value={resolutionDraft.postalCode} onChange={(event) => setResolutionDraft((current) => ({ ...current, postalCode: event.target.value }))} /></Field><Field label="Country"><Input value={resolutionDraft.country} onChange={(event) => setResolutionDraft((current) => ({ ...current, country: event.target.value }))} /></Field></div></section>
              <section className="grid gap-3"><div><h3 className="font-medium">Package</h3><p className="text-sm text-muted-foreground">Product dimensions remain the fallback. Adjust these values only for the shipment package.</p></div><div className="grid gap-3 grid-cols-2 lg:grid-cols-4"><Field label="Weight (lb)"><Input type="number" min="0" step="0.01" value={resolutionDraft.packageWeight} onChange={(event) => setResolutionDraft((current) => ({ ...current, packageWeight: event.target.value }))} /></Field><Field label="Length (in)"><Input type="number" min="0" step="0.01" value={resolutionDraft.packageLength} onChange={(event) => setResolutionDraft((current) => ({ ...current, packageLength: event.target.value }))} /></Field><Field label="Width (in)"><Input type="number" min="0" step="0.01" value={resolutionDraft.packageWidth} onChange={(event) => setResolutionDraft((current) => ({ ...current, packageWidth: event.target.value }))} /></Field><Field label="Height (in)"><Input type="number" min="0" step="0.01" value={resolutionDraft.packageHeight} onChange={(event) => setResolutionDraft((current) => ({ ...current, packageHeight: event.target.value }))} /></Field></div></section>
            </>}
          </div>
          <DialogFooter className="sticky bottom-0 border-t bg-background px-4 py-4 sm:px-6">{exceptionRecord?.type !== "missing_catalog_product" ? <Button variant="ghost" disabled={busy} onClick={() => void retryExceptionRouting()}><RefreshCw className="size-4" /> Retry routing</Button> : null}<Button variant="outline" onClick={() => { setExceptionRecord(null); setExceptionRow(null) }}>Cancel</Button>{exceptionRow ? <><Button variant="outline" disabled={busy || !resolutionComplete} onClick={() => void saveException(false)}><CheckCircle2 className="size-4" /> {String(exceptionRow.routeType || "warehouse") === "warehouse" ? "Save as label ready" : "Save corrections"}</Button><Button disabled={busy || !resolutionComplete} onClick={() => void saveException(true)}><Truck className="size-4" /> Save and create label</Button></> : null}</DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={printPreviewOpen} onOpenChange={setPrintPreviewOpen}><DialogContent className="flex h-[100dvh] max-h-[100dvh] flex-col gap-0 overflow-hidden p-0 sm:h-[92dvh] sm:max-w-5xl sm:rounded-lg"><DialogHeader className="border-b p-4 pr-12"><DialogTitle>Print layout preview</DialogTitle><DialogDescription>This sample uses selected order data. The preview label is not postage; the carrier barcode appears only after label purchase.</DialogDescription></DialogHeader><div className="grid gap-3 border-b p-4 sm:grid-cols-3"><Field label="Paper size"><Select value={batchDraft.printSize} onValueChange={(printSize) => setBatchDraft((current) => ({ ...current, printSize }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="4x6">4 × 6 thermal</SelectItem><SelectItem value="letter">US Letter</SelectItem></SelectContent></Select></Field><ToggleField label="Include packing slip after each label" checked={batchDraft.includePackingSlips} onCheckedChange={(includePackingSlips) => setBatchDraft((current) => ({ ...current, includePackingSlips }))} />{batchDraft.includePackingSlips && batchDraft.printSize === "4x6" ? <Field label="Packing slip orientation"><Select value={batchDraft.packingSlipOrientation} onValueChange={(packingSlipOrientation) => setBatchDraft((current) => ({ ...current, packingSlipOrientation }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="landscape">Horizontal</SelectItem><SelectItem value="portrait">Vertical</SelectItem></SelectContent></Select></Field> : null}</div><div className="min-h-0 flex-1 bg-muted/30 p-2 sm:p-4"><iframe ref={printPreviewFrameRef} key={printPreviewUrl} src={printPreviewUrl} title="Fulfillment print layout preview" className="h-full min-h-[420px] w-full rounded-md border bg-white" /></div><DialogFooter className="border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><Button variant="outline" onClick={() => setPrintPreviewOpen(false)}>Close</Button><Button variant="outline" asChild><a href={printPreviewUrl} download="fulfillment-print-preview.pdf"><FileDown className="size-4" /> Download sample</a></Button><Button onClick={() => printPreviewFrameRef.current?.contentWindow?.print()}><Printer className="size-4" /> Print sample</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={Boolean(printJobPreview)} onOpenChange={(open) => !open && setPrintJobPreview(null)}>
        <DialogContent className={cn("flex max-h-[calc(100dvh-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl sm:rounded-lg", printPacketPreviewOpen ? "h-[calc(100dvh-1rem)] sm:h-[92dvh]" : "h-auto")}>
          <DialogHeader className="border-b px-4 py-3 pr-12 text-left">
            <div className="flex flex-wrap items-center gap-2"><DialogTitle>{String(printJobPreview?.printNumber || "Print labels")}</DialogTitle><Badge variant="outline">{numberLabel(Number(printJobPreview?.orderCount || printJobPreviewBatch?.counts?.purchased || 0))} label{Number(printJobPreview?.orderCount || printJobPreviewBatch?.counts?.purchased || 0) === 1 ? "" : "s"}</Badge>{Number(printJobPreview?.printCount || 0) > 0 ? <Badge variant="warning">Printed {numberLabel(Number(printJobPreview?.printCount || 0))}×</Badge> : <Badge variant="secondary">Not printed</Badge>}{String(printJobPreview?.lastOutputAction || "") === "saved_pdf" ? <Badge variant="secondary">Saved PDF</Badge> : null}</div>
            <RecoverySourceLabel record={printJobPreview} fallback={printJobPreviewBatch} />
            <DialogDescription>{Number(printJobPreview?.printCount || 0) > 0 && printJobPreview?.printedAt ? `Last printed ${dateLabel(String(printJobPreview.printedAt))}${printJobPreview?.printedBy ? ` by ${String(printJobPreview.printedBy)}` : ""}.` : "Purchased labels are ready."} Reopening this packet never buys another label.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-4 py-2.5">
            <div className="min-w-0"><p className="text-sm font-medium">Warehouse batch · {String(printJobPreview?.batchNumber || printJobPreviewBatch?.batchNumber || "No batch number")}</p><p className="truncate text-xs text-muted-foreground">Close only after physical labels are in hand.</p></div>
            <div className="flex items-center gap-2"><Label htmlFor="label-batch-status" className="text-xs font-medium text-foreground">Handling</Label><Select value={String(printJobPreviewBatch?.warehouseStatus || printJobPreview?.warehouseStatus || "open")} onValueChange={(value) => void updatePrintBatchHandlingStatus(String(printJobPreview?.batchId || ""), value as "open" | "closed")} disabled={busy || !printJobPreview?.batchId}><SelectTrigger id="label-batch-status" className={cn("h-9 w-32 font-semibold shadow-sm", String(printJobPreviewBatch?.warehouseStatus || printJobPreview?.warehouseStatus || "open") === "closed" ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-amber-500/60 bg-amber-500/10 text-amber-800 dark:text-amber-300")}><span className={cn("size-2 rounded-full", String(printJobPreviewBatch?.warehouseStatus || printJobPreview?.warehouseStatus || "open") === "closed" ? "bg-emerald-500" : "bg-amber-500")} /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="open">Open</SelectItem><SelectItem value="closed">Closed</SelectItem></SelectContent></Select></div>
          </div>
          <div className="grid gap-3 border-b px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-end">
            <div className="grid min-w-0 gap-1.5"><Label>Documents</Label><ButtonGroup className="flex w-full"><Button type="button" size="sm" className="min-w-0 flex-1" variant={printDocumentMode === "label" ? "default" : "outline"} aria-pressed={printDocumentMode === "label"} onClick={() => setPrintDocumentMode("label")}>Label only</Button><Button type="button" size="sm" className="min-w-0 flex-1" variant={printDocumentMode === "packing-4x6" ? "default" : "outline"} aria-pressed={printDocumentMode === "packing-4x6"} onClick={() => setPrintDocumentMode("packing-4x6")}>Label + 4 × 6 slip</Button><Button type="button" size="sm" className="min-w-0 flex-1" variant={printDocumentMode === "packing-letter" ? "default" : "outline"} aria-pressed={printDocumentMode === "packing-letter"} onClick={() => setPrintDocumentMode("packing-letter")}>Label + Letter slip</Button></ButtonGroup></div>
            {printDocumentMode === "packing-4x6" ? <div className="grid gap-1.5"><Label>Orientation</Label><ButtonGroup><Button type="button" size="sm" variant={packingSlipOrientation === "landscape" ? "default" : "outline"} aria-pressed={packingSlipOrientation === "landscape"} onClick={() => setPackingSlipOrientation("landscape")}>Horizontal</Button><Button type="button" size="sm" variant={packingSlipOrientation === "portrait" ? "default" : "outline"} aria-pressed={packingSlipOrientation === "portrait"} onClick={() => setPackingSlipOrientation("portrait")}>Vertical</Button></ButtonGroup></div> : null}
            <div className="grid gap-1.5"><Label className="font-medium text-foreground">Destination</Label><div className="flex flex-col gap-2 sm:flex-row"><Select value={previewPrintDestination} onValueChange={choosePreviewPrintDestination}><SelectTrigger className="h-9 w-full border-primary/50 bg-primary/10 font-semibold text-primary shadow-sm sm:w-44"><Printer className="size-4" /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="browser">This browser</SelectItem>{printStations.filter((station) => station.status === "active").map((station) => <SelectItem key={String(station.id)} value={String(station.id)}>{String(station.name || "Print station")}{station.online ? " - online" : ""}</SelectItem>)}</SelectContent></Select>{previewPrintStation ? <Select value={previewPrintPrinter} onValueChange={(printerName) => { setPreviewPrintPrinter(printerName); void savePreviewPrintPreference(previewPrintDestination, printerName) }}><SelectTrigger className="h-9 w-full sm:w-48"><SelectValue placeholder="Choose printer" /></SelectTrigger><SelectContent>{(previewPrintStation.printers || []).map((printer: string) => <SelectItem key={printer} value={printer}>{printer}</SelectItem>)}</SelectContent></Select> : null}</div></div>
          </div>
          {printPacketPreviewOpen ? <div className="relative min-h-0 flex-1 bg-muted/30 p-2 sm:p-3">{printPacketPreviewLoading ? <div className="absolute inset-0 z-10 grid place-items-center bg-background/70"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading label preview</div></div> : null}{printPacketUrl ? <iframe key={printPacketUrl} ref={printPacketFrameRef} src={printPacketUrl} onLoad={() => setPrintPacketPreviewLoading(false)} title="Purchased shipping labels" className="h-full min-h-[420px] w-full rounded-md border bg-white" /> : null}</div> : null}
          <DialogFooter className="min-h-16 shrink-0 border-t bg-background px-4 py-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]"><div className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center"><Button className="w-full sm:w-auto" variant="outline" onClick={() => { const next = !printPacketPreviewOpen; setPrintPacketPreviewOpen(next); setPrintPacketPreviewLoading(next) }}><Eye className="size-4" /> {printPacketPreviewOpen ? "Hide preview" : "Preview"}</Button>{printPacketUrl ? <Button className="w-full sm:w-auto" variant="outline" asChild><a href={printPacketUrl} download={`${String(printJobPreview?.printNumber || "shipping-labels")}.pdf`} onClick={() => void recordBatchPdfSave()}><FileDown className="size-4" /> Download PDF</a></Button> : null}<span className="hidden sm:block sm:flex-1" /><Button className="w-full sm:w-auto" variant="ghost" onClick={() => setPrintJobPreview(null)}>Close</Button><Button className="w-full sm:w-auto" disabled={busy || (previewPrintDestination !== "browser" && !previewPrintPrinter)} onClick={() => void (previewPrintDestination === "browser" ? printInBrowser() : sendPreviewToStation())}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />} {previewPrintDestination === "browser" ? "Print" : "Send to printer"}</Button></div></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(packageRow)} onOpenChange={(open) => { if (!open) { setPackageRow(null); setPackageRouteIds([]) } }}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>{packageRouteIds.length > 1 ? `Edit ${packageRouteIds.length} packages` : "Edit package"}</DialogTitle><DialogDescription>These values are checked before carrier quotes and label purchase. Saving them refreshes the fulfillment queue immediately.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><Field label="Package weight (lb)"><Input type="number" min="0" step="0.01" value={packageDraft.packageWeight} onChange={(event) => setPackageDraft((current) => ({ ...current, packageWeight: event.target.value }))} /></Field><Field label="Package length (in)"><Input type="number" min="0" step="0.01" value={packageDraft.packageLength} onChange={(event) => setPackageDraft((current) => ({ ...current, packageLength: event.target.value }))} /></Field><Field label="Package width (in)"><Input type="number" min="0" step="0.01" value={packageDraft.packageWidth} onChange={(event) => setPackageDraft((current) => ({ ...current, packageWidth: event.target.value }))} /></Field><Field label="Package height (in)"><Input type="number" min="0" step="0.01" value={packageDraft.packageHeight} onChange={(event) => setPackageDraft((current) => ({ ...current, packageHeight: event.target.value }))} /></Field></div>{packageRouteIds.length === 1 ? <div className="grid gap-3 rounded-md border p-3"><ToggleField label="Ship this item alone" checked={packageShipAlone} onCheckedChange={setPackageShipAlone} /><p className="text-xs text-muted-foreground">When enabled, this line gets its own carrier quote and shipping label. Turning it off rejoins the order package.</p>{packageRow?.hasCatalogProduct === true && !packageRow?.isAlias && !packageRow?.parentSku ? <ToggleField label={`Save ship-alone as the default for ${String(packageRow?.catalogSku || packageRow?.sku || "this SKU")}`} checked={saveShipAloneAsDefault} onCheckedChange={setSaveShipAloneAsDefault} /> : null}</div> : null}{packageRouteIds.length === 1 && packageRow?.hasCatalogProduct === true && !packageRow?.isAlias && !packageRow?.parentSku && Number(packageRow?.qty || packageRow?.quantity || 1) === 1 ? <ToggleField label={`Save as the default package dimensions for ${String(packageRow?.catalogSku || packageRow?.sku || "this SKU")}`} checked={savePackageAsDefault} onCheckedChange={setSavePackageAsDefault} /> : <p className="text-sm text-muted-foreground">{packageRouteIds.length === 1 && packageRow?.hasCatalogProduct !== true ? "This item is not in the catalog. These measurements will still be saved for this shipment and used to request rates." : "Bulk, multi-unit, and shadow package edits apply only to these shipments and do not replace catalog defaults."}</p>}<DialogFooter><Button variant="outline" onClick={() => { setPackageRow(null); setPackageRouteIds([]) }}>Cancel</Button><Button disabled={busy || !packageComplete} onClick={() => void savePackage()}>{busy && <Loader2 className="size-4 animate-spin" />} Save package</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={purchasedPrintJobs.length > 0} onOpenChange={(open) => !open && setPurchasedPrintJobs([])}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Labels are ready to print</DialogTitle><DialogDescription>The selected rates were accepted and the labels were purchased. Open the batch to review the packet and print.</DialogDescription></DialogHeader><div className="grid gap-2">{purchasedPrintJobs.map((job) => <div key={String(job.id)} className="flex items-center justify-between gap-3 rounded-md border p-3"><div><p className="font-medium">{String(job.printNumber || job.batchNumber || "Print packet")}</p><p className="text-xs text-muted-foreground">{numberLabel(Number(job.orderCount || 0))} labels · {batchDraft.printSize === "4x6" ? "4 × 6" : "Letter"}{batchDraft.includePackingSlips ? " + packing slips" : ""}</p></div><Button onClick={() => openPrintPreview(job)}><Printer className="size-4" /> Open batch</Button></div>)}</div><DialogFooter><Button variant="outline" onClick={() => setPurchasedPrintJobs([])}>Done</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={Boolean(labelAdminPinRequest)} onOpenChange={(open) => { if (!open) { setLabelAdminPinRequest(null); setLabelAdminPin("") } }}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Administrator approval required</DialogTitle><DialogDescription>{Array.isArray(labelAdminPinRequest?.orderNumbers) && labelAdminPinRequest.orderNumbers.length ? `Order ${labelAdminPinRequest.orderNumbers.join(", ")} is canceled on its marketplace.` : "At least one selected order is canceled on its marketplace."} Rates can still be reviewed, but label purchase requires the operations administrator PIN.</DialogDescription></DialogHeader><Alert variant="destructive"><ShieldAlert className="size-4" /><AlertTitle>Review before purchasing</AlertTitle><AlertDescription>A purchased label may create a carrier charge for an order the marketplace no longer expects to ship.</AlertDescription></Alert><Field label="Administrator PIN"><Input autoFocus type="password" inputMode="numeric" autoComplete="off" value={labelAdminPin} onChange={(event) => setLabelAdminPin(event.target.value.replace(/\D/g, "").slice(0, 12))} placeholder="Enter 4-12 digit PIN" /></Field><DialogFooter><Button variant="outline" onClick={() => { setLabelAdminPinRequest(null); setLabelAdminPin("") }}>Cancel</Button><Button disabled={busy || labelAdminPin.length < 4} onClick={() => { const request = labelAdminPinRequest; setLabelAdminPinRequest(null); if (request?.kind === "selected") void buySelectedLabels(labelAdminPin); else if (request?.batchId) void processBatch(String(request.batchId), "purchase", request.confirmOverLimit === true, String(request.selectionMode || ""), request.keepReadyToShipContext === true, labelAdminPin) }}><ShieldCheck className="size-4" /> Authorize label purchase</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={batchOpen} onOpenChange={(open) => {
        if (!open && busy) return
        setBatchOpen(open)
        if (!open && !labelPurchaseJobId) {
          setLabelPurchaseProgress(null)
          setBatchRecoveryOpen(false)
          setBatchDraft((current) => ({ ...current, batchNumber: "" }))
        }
      }}>
        <DialogContent className="flex h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] w-full flex-col gap-0 overflow-hidden p-0 sm:h-[min(92dvh,760px)] sm:max-h-[min(92dvh,760px)] sm:max-w-xl sm:rounded-lg">
          <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12 text-left">
            <DialogTitle>{labelPurchaseProgress ? "Purchasing shipping labels" : "Create shipping batch"}</DialogTitle>
            <DialogDescription>{labelPurchaseProgress ? `This purchase continues in the background for all ${labelPurchaseProgress.total} eligible labels. You can close this window or leave the page and return to the same progress.` : selectedRatesCurrent ? `Create one batch for ${selectedPurchaseEligiblePackages.length} eligible shipment${selectedPurchaseEligiblePackages.length === 1 ? "" : "s"}. ${selectedPurchaseSkippedCount > 0 ? `${selectedPurchaseSkippedCount} ineligible shipment${selectedPurchaseSkippedCount === 1 ? "" : "s"} will be skipped. ` : ""}The print dialog opens as soon as purchasing finishes.` : "Request the latest carrier rates for this selection before purchasing any labels."}</DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-0 min-h-0 flex-1">
            <div className="grid">
              <section className="grid gap-3 border-b px-5 py-4">
                <div className="flex items-center gap-2"><span className="grid size-6 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">1</span><h3 className="font-semibold">Purchase summary</h3></div>
                <div className="grid grid-cols-4 overflow-hidden rounded-md border bg-muted/20"><div className="px-3 py-2"><p className="text-[11px] text-muted-foreground">Selected</p><p className="font-semibold tabular-nums">{numberLabel(selectedPackageRows.length)}</p></div><div className="border-l px-3 py-2"><p className="text-[11px] text-muted-foreground">Ready to buy</p><p className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{numberLabel(selectedPurchaseEligiblePackages.length)}</p></div><div className="border-x px-3 py-2"><p className="text-[11px] text-muted-foreground">Skipped</p><p className="font-semibold tabular-nums">{numberLabel(selectedPurchaseSkippedCount)}</p></div><div className="px-3 py-2"><p className="text-[11px] text-muted-foreground">Label total</p><p className="font-semibold tabular-nums">{moneyLabel(selectedRateTotal)}</p></div></div>
                {!selectedRatesCurrent ? <Alert><RefreshCw className="size-4" /><AlertTitle>Latest rates required</AlertTitle><AlertDescription>Saved rates are shown for reference, but they cannot be used for this purchase until the current selection finishes a new rate check.</AlertDescription></Alert> : selectedPurchaseSkippedCount > 0 ? <Alert><AlertTriangle className="size-4" /><AlertTitle>{selectedPurchaseSkippedCount} shipment{selectedPurchaseSkippedCount === 1 ? "" : "s"} will not be purchased</AlertTitle><AlertDescription>Missing rates or incomplete package/address details are skipped automatically and remain available for correction.</AlertDescription></Alert> : null}
                {selectedPurchaseVerificationCount > 0 ? <Alert><ShieldCheck className="size-4" /><AlertTitle>Price protection active</AlertTitle><AlertDescription>{selectedPurchaseVerificationCount} saved quote{selectedPurchaseVerificationCount === 1 ? " will" : "s will"} be verified during purchase. DataPlus buys when the current price is within 10% and skips only labels whose price increased by more than 10%. Selecting a skipped label again accepts its newly saved quote.</AlertDescription></Alert> : null}
                <div className="flex flex-wrap gap-1.5">{selectedCarrierSummary.map(([carrier, count]) => <Badge key={carrier} variant="outline">{carrier} · {count}</Badge>)}{!selectedCarrierSummary.length ? <span className="text-xs text-muted-foreground">A saved rate is required before purchasing labels.</span> : null}</div>
                <Alert><ShieldCheck className="size-4" /><AlertTitle>One batch is created when you place it</AlertTitle><AlertDescription>Background rate checks do not create batch numbers. This action purchases labels only for the selected shipments.</AlertDescription></Alert>
              </section>

              <section className="grid gap-3 border-b px-5 py-4" role="status" aria-live="polite">
                <div className="flex items-center gap-2"><span className="grid size-6 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">2</span><h3 className="font-semibold">Live progress</h3></div>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-2">
                    {labelPurchaseProgress?.active ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" /> : labelPurchaseProgress?.failed ? <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" /> : labelPurchaseProgress && labelPurchaseProgress.purchased === labelPurchaseProgress.total ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <Clock3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                    <div className="min-w-0"><p className="text-sm font-medium">{labelPurchaseProgress?.message || "Ready to purchase"}</p><p className="text-xs text-muted-foreground">{labelPurchaseProgress?.batchNumber || "Progress appears here as each carrier responds."}</p></div>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums">Purchased {numberLabel(Number(labelPurchaseProgress?.purchased || 0))} / {numberLabel(purchaseProgressTotal)}</p>
                </div>
                <Progress value={purchaseProgressPercent} className="h-2" />
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{Math.max(0, purchaseProgressTotal - purchaseProgressCompleted)} remaining</span>
                  {Number(labelPurchaseProgress?.pending || 0) > 0 ? <span className="text-amber-700 dark:text-amber-300">{labelPurchaseProgress?.pending} waiting for marketplace</span> : null}
                  {Number(labelPurchaseProgress?.failed || 0) > 0 ? <span className="text-destructive">{labelPurchaseProgress?.failed} need attention</span> : null}
                </div>
              </section>

              <section className="grid gap-4 border-b px-5 py-4">
                <div className="flex items-center gap-2"><span className="grid size-6 place-items-center rounded-full bg-muted text-xs font-semibold">3</span><h3 className="font-semibold">Documents</h3></div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Label format"><Select disabled={busy} value={batchDraft.labelFormat} onValueChange={(labelFormat) => setBatchDraft((current) => ({ ...current, labelFormat }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="PDF">PDF</SelectItem><SelectItem value="PNG">PNG</SelectItem></SelectContent></Select></Field>
                  <Field label="Print size"><Select disabled={busy} value={batchDraft.printSize} onValueChange={(printSize) => setBatchDraft((current) => ({ ...current, printSize }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="4x6">4 × 6 thermal</SelectItem><SelectItem value="letter">US Letter</SelectItem></SelectContent></Select></Field>
                  <div className="sm:col-span-2"><ToggleField label="Reuse a failed batch number" checked={batchRecoveryOpen} onCheckedChange={(checked) => { if (busy) return; setBatchRecoveryOpen(checked); if (!checked) setBatchDraft((current) => ({ ...current, batchNumber: "" })) }} /></div>
                  {batchRecoveryOpen ? <div className="grid gap-2 sm:col-span-2"><Field label="Existing batch ID"><div className="flex gap-2"><Input disabled={busy} value={batchDraft.batchNumber} onChange={(event) => setBatchDraft((current) => ({ ...current, batchNumber: event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "") }))} placeholder="BATCH-1033" /><Button type="button" variant="outline" disabled={busy || !batchDraft.batchNumber} onClick={() => setBatchDraft((current) => ({ ...current, batchNumber: "" }))}>Clear</Button></div></Field>{!/^BATCH-\d+$/.test(batchDraft.batchNumber) ? <p className="text-xs text-destructive">Enter an existing ID in BATCH-#### format, or turn off recovery to create a new batch automatically.</p> : null}</div> : null}
                  <div className="sm:col-span-2"><ToggleField label="Include a packing slip after every label (default)" checked={batchDraft.includePackingSlips} onCheckedChange={(includePackingSlips) => !busy && setBatchDraft((current) => ({ ...current, includePackingSlips }))} /></div>
                  {batchDraft.includePackingSlips && batchDraft.printSize === "4x6" ? <Field label="Packing slip orientation"><Select disabled={busy} value={batchDraft.packingSlipOrientation} onValueChange={(packingSlipOrientation) => setBatchDraft((current) => ({ ...current, packingSlipOrientation }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="portrait">Vertical</SelectItem><SelectItem value="landscape">Horizontal</SelectItem></SelectContent></Select></Field> : null}
                  {batchDraft.includePackingSlips && batchDraft.printSize === "4x6" ? <p className="self-end pb-2 text-xs text-muted-foreground">The carrier label keeps its original orientation.</p> : null}
                </div>
              </section>

              <section className="grid gap-4 px-5 py-4">
                <div className="flex items-center gap-2"><span className="grid size-6 place-items-center rounded-full bg-muted text-xs font-semibold">4</span><h3 className="font-semibold">Printer</h3></div>
                <div className="grid gap-3 sm:grid-cols-2"><Field label="Print destination"><Select disabled={busy} value={previewPrintDestination} onValueChange={choosePreviewPrintDestination}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="browser">This browser</SelectItem>{printStations.filter((station) => station.status === "active").map((station) => <SelectItem key={String(station.id)} value={String(station.id)}>{String(station.name || "Print station")}{station.online ? " - online" : " - offline"}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">Saved as your default print destination.</p></Field>{previewPrintStation ? <Field label="Printer"><Select disabled={busy} value={previewPrintPrinter} onValueChange={(printerName) => { setPreviewPrintPrinter(printerName); void savePreviewPrintPreference(previewPrintDestination, printerName) }}><SelectTrigger><SelectValue placeholder="Choose printer" /></SelectTrigger><SelectContent>{(previewPrintStation.printers || []).map((printer: string) => <SelectItem key={printer} value={printer}>{printer}</SelectItem>)}</SelectContent></Select></Field> : <p className="self-end pb-2 text-xs text-muted-foreground">The browser print dialog opens when labels are ready.</p>}</div>
              </section>
            </div>
          </ScrollArea>
          <DialogFooter className="shrink-0 flex-wrap border-t bg-background px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Button variant="outline" disabled={busy} onClick={() => { setBatchOpen(false); setPrintPreviewOpen(true) }}><Eye className="size-4" /> Preview layout</Button>
            <Button variant="outline" disabled={busy} onClick={() => { setBatchOpen(false); if (!labelPurchaseJobId) setLabelPurchaseProgress(null) }}>{labelPurchaseJobId ? "Close" : "Cancel"}</Button>
            {labelPurchaseJobId ? null : !selectedRatesCurrent ? <Button disabled={busy || rateRefreshProgress.active || !selectedRateReadyRows.length} onClick={() => void refreshSelectedRates()}>{busy || rateRefreshProgress.active ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} {rateRefreshProgress.active ? `Getting rates ${rateProgressProcessed}/${rateRefreshProgress.items.length}` : `Get latest rates for ${selectedRateReadyPackages.length}`}</Button> : <Button disabled={busy || !selectedPurchaseEligibleRows.length || (batchRecoveryOpen && !/^BATCH-\d+$/.test(batchDraft.batchNumber))} onClick={() => void buySelectedLabels()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />} {busy ? "Starting purchase..." : `Buy ${selectedPurchaseEligiblePackages.length} eligible label${selectedPurchaseEligiblePackages.length === 1 ? "" : "s"}`}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

