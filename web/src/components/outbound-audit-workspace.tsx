import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, Camera, CheckCircle2, ChevronDown, ClipboardCheck, ExternalLink, FileDown, Flashlight, Image as ImageIcon, Keyboard, Loader2, PackageCheck, Printer, RefreshCw, RotateCcw, ScanBarcode, Search, Trash2, Truck, Undo2, UploadCloud, X } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { api, dateLabel, numberLabel } from "../lib/client-api"
import { captureCompressedEvidence, isNativeWarehouseWebView, startFastBarcodeScanner } from "../lib/fast-barcode-scanner"
import { listPendingOutboundEvidence, removePendingOutboundEvidence, savePendingOutboundEvidence, type PendingOutboundEvidence } from "../lib/outbound-evidence-queue"

type Row = Record<string, any>
type AuditSession = {
  id: string
  auditNumber: string
  warehouseId: string
  warehouseName: string
  carrier: string
  status: "open" | "closed"
  handoffMethod: string
  driverName: string
  pickupConfirmation: string
  notes: string
  packageCount: number
  matchedCount: number
  unmatchedCount: number
  multipleMatchCount: number
  carrierBreakdown: Array<{ carrier: string; count: number }>
  evidenceRequired: boolean
  evidenceCompleteCount: number
  evidenceMissingCount: number
  evidenceOverrideReason: string
  closeOverrideReason: string
  startedByName: string
  startedAt: string
  closedAt: string
  searchMatch?: { trackingNumber?: string; orderNumber?: string } | null
}
type AuditScan = {
  id: string
  trackingRaw: string
  trackingNumber: string
  carrier: string
  trackingUrl: string
  matchStatus: "matched" | "multiple" | "unmatched"
  matches: Row[]
  evidenceStatus: "missing" | "uploading" | "complete" | "failed"
  evidenceCount: number
  evidence: Array<{ id: string; status: string; contentUrl: string; capturedAt: string; byteSize: number }>
  liveItemRequired: boolean
  liveItemStatus: "not_required" | "pending" | "complete"
  liveItemExpectedCount: number
  liveItemScannedCount: number
  liveItems: LiveItem[]
  scannedByName: string
  scannedAt: string
}
type LiveItem = {
  clientScanId: string
  orderId: string
  orderNumber: string
  shipmentGroupId: string
  listingLineIndex: number
  listingSku: string
  listingTitle: string
  soldPrice: number
  productId: string
  sku: string
  title: string
  barcode: string
  image: string
  cost: number
  warehouseName: string
  quickCreated: boolean
  verificationOnly?: boolean
  verificationMatched?: boolean
  scannedAt: string
}
type AuditDetail = { session: AuditSession; scans: AuditScan[] }
type ScanResponse = { scan: AuditScan; session: AuditSession; duplicate?: boolean; message?: string; rolledOverFrom?: AuditSession | null }
type LiveItemResponse = { scan: AuditScan; item?: LiveItem; duplicate?: boolean; complete?: boolean; notFound?: boolean; allowQuickCreate?: boolean; barcode?: string; target?: { orderNumber?: string; listingTitle?: string }; trackingCandidate?: boolean; trackingNumber?: string; carrier?: string; message?: string }
type CapturedPhoto = { blob: Blob; width: number; height: number; previewUrl: string }

function physicalWarehouses(warehouses: Row[]) {
  return warehouses.filter((warehouse) => {
    const type = String(warehouse.type || warehouse.warehouseType || "").toLowerCase()
    return !type.includes("virtual") && !type.includes("supplier_feed") && warehouse.active !== false
  })
}

function matchBadge(scan: AuditScan) {
  if (scan.matchStatus === "matched") return <Badge variant="success">Order matched</Badge>
  if (scan.matchStatus === "multiple") return <Badge variant="warning">Multiple orders</Badge>
  return <Badge variant="warning">No order match · retained</Badge>
}

function evidenceBadge(scan: AuditScan) {
  if (scan.evidenceCount > 0) return <Badge variant="success"><ImageIcon className="size-3" /> Photo saved</Badge>
  if (scan.evidenceStatus === "uploading") return <Badge variant="secondary"><Loader2 className="size-3 animate-spin" /> Uploading</Badge>
  if (scan.evidenceStatus === "failed") return <Badge variant="destructive">Photo failed</Badge>
  return <Badge variant="warning">Photo needed</Badge>
}

function itemScanAvailable(scan: AuditScan) {
  return Boolean(scan.id && scan.trackingNumber)
}

function normalizedScanValue(value = "") {
  return String(value).trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
}

function isPackageTrackingBarcode(scan: AuditScan, value = "") {
  const normalized = normalizedScanValue(value)
  return Boolean(normalized && [scan.trackingRaw, scan.trackingNumber].some((tracking) => normalizedScanValue(tracking) === normalized))
}

function isLikelyPackageTrackingBarcode(value = "") {
  const normalized = normalizedScanValue(value)
  if (!normalized) return false
  return /^(?:1Z[0-9A-Z]{16}|T\d{10}|9[23456]\d{18,20}|[A-Z]{2}\d{9}US|(?:GM|JVGL|JJD|JD)[0-9A-Z]{8,24}|C\d{14}|TB[AMCD]\d{8,}|(?:SPX|SPD)\d{8,}|GFUS[0-9A-Z]{12,30}|GF\d{10,}|GOFO[0-9A-Z]{6,}|SWX[0-9A-Z]{12,30}|SWIFTX[0-9A-Z]{6,}|U?US[0-9A-Z]{12,30}|\d{15,34})$/.test(normalized)
}

function itemProgressLabel(scan: AuditScan) {
  return scan.liveItemExpectedCount > 0
    ? `${scan.liveItemScannedCount}/${scan.liveItemExpectedCount}`
    : `${scan.liveItemScannedCount} scanned`
}

function itemScanBadge(scan: AuditScan) {
  if (!itemScanAvailable(scan)) return null
  if (scan.liveItemStatus === "complete") return <Badge variant="success"><CheckCircle2 className="size-3" /> Items {itemProgressLabel(scan)}</Badge>
  if (scan.liveItemRequired) return <Badge variant="warning"><ScanBarcode className="size-3" /> Items required {itemProgressLabel(scan)}</Badge>
  return <Badge variant="secondary"><ScanBarcode className="size-3" /> Item scan optional · {itemProgressLabel(scan)}</Badge>
}

function TrackingReference({ scan, compact = false }: { scan: AuditScan; compact?: boolean }) {
  const className = `${compact ? "break-all" : "whitespace-nowrap"} inline-flex items-center gap-1 font-mono text-xs font-medium`
  if (!scan.trackingUrl) return <span className={className}>{scan.trackingNumber}</span>
  return <a className={`${className} text-primary hover:underline`} href={scan.trackingUrl} target="_blank" rel="noreferrer" title={`Track with ${scan.carrier || "carrier"}`}>{scan.trackingNumber}<ExternalLink className="size-3 shrink-0" /></a>
}

function MatchedOrders({ scan, compact = false, onRemoveItem, removingItemId = "" }: { scan: AuditScan; compact?: boolean; onRemoveItem?: (scan: AuditScan, item: LiveItem) => void; removingItemId?: string }) {
  const shipmentGroupId = String(scan.matches.find((match) => match.shipmentGroupId)?.shipmentGroupId || "")
  return <div className="grid gap-2">
    {!scan.matches.length ? <span className="text-sm text-amber-700 dark:text-amber-300">Tracking retained without an order link</span> : null}
    {shipmentGroupId ? <p className="text-xs font-medium text-muted-foreground">Shipment group {shipmentGroupId}</p> : null}
    {scan.matches.map((match) => {
      const orderNumber = String(match.orderNumber || match.orderId || "")
      const channelOrderNumber = String(match.channelOrderNumber || "")
      return <div key={`${match.orderId}:${match.shipmentId}`} className="min-w-0"><a className="w-fit font-medium text-primary hover:underline" href={String(match.href || `/orders/${encodeURIComponent(String(match.orderId || ""))}`)}>DataPlus order {orderNumber}</a>{channelOrderNumber && channelOrderNumber !== orderNumber ? <p className={`${compact ? "max-w-[16rem] truncate" : "break-all"} text-xs text-muted-foreground`}>{String(match.channel || "Channel")} order {channelOrderNumber}</p> : null}</div>
    })}
    {scan.liveItems.length ? <details className="mt-1 border-t pt-2"><summary className="cursor-pointer text-xs font-medium">Scanned package items ({scan.liveItems.length})</summary><div className="mt-2 grid gap-1">{scan.liveItems.map((item) => <div key={item.clientScanId} className="flex items-start gap-2 rounded border bg-muted/20 p-2 text-xs"><div className="min-w-0 flex-1"><a href={`/products/${encodeURIComponent(item.sku)}`} className="font-medium text-primary hover:underline">{item.sku}</a><p className={compact ? "line-clamp-2" : "max-w-80 truncate"} title={item.title}>{item.title}</p><p className="text-muted-foreground">{item.orderNumber ? `Order ${item.orderNumber} · ` : "Unmatched package · "}Cost ${Number(item.cost || 0).toFixed(2)}{item.orderNumber ? ` · Sold $${Number(item.soldPrice || 0).toFixed(2)}` : ""}{item.verificationOnly ? item.verificationMatched === false ? " · SKU mismatch" : item.verificationMatched === true ? " · Verified" : " · Recorded" : " · Inventory assigned"}</p></div>{item.verificationOnly && onRemoveItem ? <Button size="icon" variant="ghost" className="size-8 shrink-0 text-destructive" title={`Remove ${item.sku} scan`} disabled={removingItemId === item.clientScanId} onClick={() => onRemoveItem(scan, item)}>{removingItemId === item.clientScanId ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}</Button> : null}</div>)}</div></details> : null}
  </div>
}

function scanOrderReference(scan: AuditScan) {
  const match = scan.matches[0]
  if (!match) return "No order match"
  const orderNumber = String(match.orderNumber || match.orderId || "")
  const channelOrderNumber = String(match.channelOrderNumber || "")
  return [`DataPlus ${orderNumber}`, channelOrderNumber && channelOrderNumber !== orderNumber ? `${String(match.channel || "Channel")} ${channelOrderNumber}` : ""].filter(Boolean).join(" · ")
}

function AuditCamera({ open, initialScan, initialMode, onOpenChange, onScan, onItemScan, onQuickCreate, onRemoveItem, onPhoto, pendingUploads }: {
  open: boolean
  initialScan?: AuditScan | null
  initialMode?: "photo" | null
  onOpenChange: (open: boolean) => void
  onScan: (tracking: string) => Promise<ScanResponse>
  onItemScan: (scan: AuditScan, barcode: string, clientScanId: string, options?: { forceItem?: boolean }) => Promise<LiveItemResponse>
  onQuickCreate: (scan: AuditScan, input: { barcode: string; title: string; cost: number; clientScanId: string }) => Promise<LiveItemResponse>
  onRemoveItem: (scan: AuditScan, item: LiveItem) => Promise<AuditScan>
  onPhoto: (scan: AuditScan, photo: Omit<CapturedPhoto, "previewUrl">) => Promise<void>
  pendingUploads: number
}) {
  const [cameraState, setCameraState] = useState<"opening" | "ready" | "permission" | "error" | "unsupported">("opening")
  const [attempt, setAttempt] = useState(0)
  const [manualValue, setManualValue] = useState("")
  const [busy, setBusy] = useState(false)
  const [lastResult, setLastResult] = useState<ScanResponse | null>(null)
  const [mode, setMode] = useState<"scan" | "items" | "tracking" | "quick" | "photo" | "preview">("scan")
  const [activeScan, setActiveScan] = useState<AuditScan | null>(null)
  const [lastItem, setLastItem] = useState<LiveItem | null>(null)
  const [unknownItem, setUnknownItem] = useState<{ barcode: string; clientScanId: string; target?: LiveItemResponse["target"] } | null>(null)
  const [trackingCandidate, setTrackingCandidate] = useState<{ barcode: string; clientScanId: string; carrier: string } | null>(null)
  const [quickDraft, setQuickDraft] = useState({ title: "", cost: "" })
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null)
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [torchEnabled, setTorchEnabled] = useState(false)
  const [scannerEngine, setScannerEngine] = useState<"native" | "zxing">("zxing")
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<Awaited<ReturnType<typeof startFastBarcodeScanner>> | null>(null)
  const scanBusyRef = useRef(false)
  const lastScanRef = useRef({ value: "", at: 0 })
  const lastTrackingRejectRef = useRef(0)
  const modeRef = useRef(mode)
  const activeScanRef = useRef<AuditScan | null>(null)

  useEffect(() => { modeRef.current = mode }, [mode])
  useEffect(() => { activeScanRef.current = activeScan }, [activeScan])
  useEffect(() => {
    if (!open) return
    if (initialScan) {
      setActiveScan(initialScan)
      setMode(initialMode === "photo" ? "photo" : itemScanAvailable(initialScan) && initialScan.liveItemStatus !== "complete" ? "items" : initialScan.evidenceCount ? "scan" : "photo")
      setLastItem(initialScan.liveItems[initialScan.liveItems.length - 1] || null)
    } else {
      setMode("scan")
      setActiveScan(null)
      setLastItem(null)
    }
    setUnknownItem(null)
    setTrackingCandidate(null)
    setQuickDraft({ title: "", cost: "" })
  }, [initialMode, initialScan, open])
  useEffect(() => () => { if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl) }, [photo?.previewUrl])

  const clearPhoto = useCallback(() => {
    setPhoto((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl)
      return null
    })
  }, [])

  const submit = useCallback(async (tracking: string) => {
    const value = tracking.trim()
    if (!value || scanBusyRef.current) return
    scanBusyRef.current = true
    setBusy(true)
    try {
      const result = await onScan(value)
      setLastResult(result)
      setManualValue("")
      if (navigator.vibrate) navigator.vibrate(result.duplicate ? [50, 40, 50] : result.scan.matchStatus === "unmatched" ? [80, 40, 80] : 80)
      if (itemScanAvailable(result.scan) && result.scan.liveItemStatus !== "complete") {
        clearPhoto()
        setActiveScan(result.scan)
        setLastItem(result.scan.liveItems[result.scan.liveItems.length - 1] || null)
        setMode("items")
      } else if (!result.scan.evidenceCount) {
        clearPhoto()
        setActiveScan(result.scan)
        setMode("photo")
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to record this tracking barcode."
      toast.error(message)
      setLastResult(null)
      if (navigator.vibrate) navigator.vibrate([80, 40, 80])
    } finally {
      setBusy(false)
      scanBusyRef.current = false
    }
  }, [clearPhoto, onScan])

  const submitItem = useCallback(async (barcode: string, existingClientScanId = "", forceItem = false) => {
    const value = barcode.trim()
    const scan = activeScanRef.current
    if (!value || !scan || scanBusyRef.current) return
    if (isPackageTrackingBarcode(scan, value)) {
      setManualValue("")
      const now = Date.now()
      if (now - lastTrackingRejectRef.current > 5000) {
        lastTrackingRejectRef.current = now
        toast.warning("That is the package tracking label. Scan the product UPC, or skip to the package photo.")
        if (navigator.vibrate) navigator.vibrate([80, 40, 80])
      }
      return
    }
    if (isLikelyPackageTrackingBarcode(value)) {
      setManualValue("")
      if (scan.liveItemRequired && scan.liveItemStatus !== "complete") {
        toast.warning("This Live shipment still needs its item scans. Finish this package before starting the next tracking label.")
        if (navigator.vibrate) navigator.vibrate([80, 40, 80])
        return
      }
      toast.info("New package tracking label detected. Starting the next package now.")
      if (navigator.vibrate) navigator.vibrate([50, 40, 50])
      await submit(value)
      return
    }
    scanBusyRef.current = true
    setBusy(true)
    const clientScanId = existingClientScanId || crypto.randomUUID()
    try {
      const result = await onItemScan(scan, value, clientScanId, { forceItem })
      setManualValue("")
      if (result.trackingCandidate) {
        setTrackingCandidate({ barcode: result.trackingNumber || value, clientScanId, carrier: result.carrier || "FedEx" })
        setMode("tracking")
        if (navigator.vibrate) navigator.vibrate([80, 40, 80])
        return
      }
      if (result.notFound) {
        if (result.allowQuickCreate === false) {
          toast.warning(result.message || "This item was not found. Scan another item or skip to the package photo.")
          if (navigator.vibrate) navigator.vibrate([80, 40, 80])
          return
        }
        setUnknownItem({ barcode: result.barcode || value, clientScanId, target: result.target })
        setQuickDraft({ title: "", cost: "" })
        setMode("quick")
        if (navigator.vibrate) navigator.vibrate([80, 40, 80])
        return
      }
      setActiveScan(result.scan)
      setLastItem(result.item || null)
      setUnknownItem(null)
      if (navigator.vibrate) navigator.vibrate(70)
      if (result.item?.verificationOnly && result.item.verificationMatched === false) toast.warning(result.message || "The scanned item does not match the expected order SKU.")
      else toast.success(result.message || `${result.item?.sku || "Item"} recorded for this package.`)
      if (result.complete || result.scan.liveItemStatus === "complete") {
        clearPhoto()
        setMode(result.scan.evidenceCount ? "scan" : "photo")
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to record this package item.")
      if (navigator.vibrate) navigator.vibrate([80, 40, 80])
    } finally {
      setBusy(false)
      scanBusyRef.current = false
    }
  }, [clearPhoto, onItemScan, submit])

  async function useTrackingCandidateAsPackage() {
    if (!trackingCandidate || busy) return
    const trackingNumber = trackingCandidate.barcode
    setTrackingCandidate(null)
    setMode("items")
    await submit(trackingNumber)
  }

  async function useTrackingCandidateAsItem() {
    if (!trackingCandidate || busy) return
    const candidate = trackingCandidate
    setTrackingCandidate(null)
    setMode("items")
    await submitItem(candidate.barcode, candidate.clientScanId, true)
  }

  async function quickCreateItem() {
    const scan = activeScanRef.current
    if (!scan || !unknownItem || busy) return
    const title = quickDraft.title.trim()
    const cost = Number(quickDraft.cost || 0)
    if (!title) return toast.error("Enter a product title.")
    if (!Number.isFinite(cost) || cost < 0) return toast.error("Cost must be zero or a positive amount.")
    setBusy(true)
    try {
      const result = await onQuickCreate(scan, { barcode: unknownItem.barcode, title, cost, clientScanId: unknownItem.clientScanId })
      setActiveScan(result.scan)
      setLastItem(result.item || null)
      setUnknownItem(null)
      setQuickDraft({ title: "", cost: "" })
      toast.success(result.message || `${result.item?.sku || "Draft SKU"} created and assigned.`)
      setMode(result.complete || result.scan.liveItemStatus === "complete" ? (result.scan.evidenceCount ? "scan" : "photo") : "items")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to create and assign this item.")
    } finally { setBusy(false) }
  }

  useEffect(() => {
    if (!open) return
    let canceled = false
    let retryTimer: number | undefined
    const start = async (retry = 0) => {
      const video = videoRef.current
      if (canceled || !open) return
      if (!video) {
        if (retry < 8) retryTimer = window.setTimeout(() => void start(retry + 1), 40)
        return
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraState("unsupported")
        return
      }
      try {
        setCameraState("opening")
        const controls = await startFastBarcodeScanner(video, (decoded) => {
          const value = String(decoded || "").trim()
          const now = Date.now()
          if (!value || scanBusyRef.current || canceled || (lastScanRef.current.value === value && now - lastScanRef.current.at < 2500)) return
          if (modeRef.current !== "scan" && modeRef.current !== "items") return
          lastScanRef.current = { value, at: now }
          if (modeRef.current === "items") void submitItem(value)
          else void submit(value)
        }, { scanType: "general", preferRegularRearCamera: isNativeWarehouseWebView() })
        controlsRef.current = controls
        setTorchAvailable(controls.torchAvailable)
        setScannerEngine(controls.engine)
        setCameraState("ready")
      } catch (error) {
        if (canceled) return
        const name = error instanceof DOMException ? error.name : ""
        setCameraState(name === "NotAllowedError" || name === "SecurityError" ? "permission" : "error")
      }
    }
    void start()
    return () => {
      canceled = true
      if (retryTimer) window.clearTimeout(retryTimer)
      controlsRef.current?.stop()
      controlsRef.current = null
    }
  }, [attempt, open, submit, submitItem])

  async function capturePhoto() {
    if (!videoRef.current || !activeScan) return
    setBusy(true)
    try {
      const captured = await captureCompressedEvidence(videoRef.current)
      clearPhoto()
      setPhoto({ ...captured, previewUrl: URL.createObjectURL(captured.blob) })
      setMode("preview")
      if (navigator.vibrate) navigator.vibrate(40)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to capture the package photo.")
    } finally { setBusy(false) }
  }

  async function usePhoto() {
    if (!activeScan || !photo) return
    setBusy(true)
    try {
      await onPhoto(activeScan, photo)
      clearPhoto()
      setActiveScan(null)
      setTrackingCandidate(null)
      setMode("scan")
      setLastResult(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to queue the package photo.")
    } finally { setBusy(false) }
  }

  function skipOptionalItemScan() {
    if (!activeScan || activeScan.liveItemRequired) return
    setManualValue("")
    setUnknownItem(null)
    setTrackingCandidate(null)
    clearPhoto()
    setMode(activeScan.evidenceCount ? "scan" : "photo")
  }

  async function undoLastItemScan() {
    if (!activeScan || !lastItem?.verificationOnly || busy) return
    setBusy(true)
    try {
      const updated = await onRemoveItem(activeScan, lastItem)
      setActiveScan(updated)
      setLastItem(updated.liveItems[updated.liveItems.length - 1] || null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to remove the last item scan.")
    } finally {
      setBusy(false)
    }
  }

  async function toggleTorch() {
    const next = !torchEnabled
    try {
      await controlsRef.current?.setTorch(next)
      setTorchEnabled(next)
    } catch { toast.error("The camera light could not be changed on this device.") }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="!inset-0 !flex !h-[100dvh] !max-w-none !translate-x-0 !translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 sm:!left-1/2 sm:!top-1/2 sm:!h-[min(90dvh,760px)] sm:!max-w-3xl sm:!-translate-x-1/2 sm:!-translate-y-1/2 sm:rounded-lg" showCloseButton={false}>
      <DialogHeader className="shrink-0 border-b px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <DialogTitle>{mode === "scan" ? "Scan outbound packages" : mode === "items" ? "Scan package items" : mode === "tracking" ? "Confirm FedEx barcode" : mode === "quick" ? "Create missing catalog item" : mode === "photo" ? "Photograph this package" : "Review package photo"}</DialogTitle>
            <DialogDescription className="break-words">{mode === "scan" ? "Tracking is recorded even when no DataPlus order is found. Every package can continue to item scans and a photo." : mode === "items" && activeScan ? `${activeScan.liveItemRequired ? "Required" : "Optional"} · ${itemProgressLabel(activeScan)} · ${activeScan.trackingNumber}` : mode === "tracking" ? "FedEx tracking and UPCs can both contain 12 digits. Choose the barcode's purpose." : mode === "quick" ? "This barcode was not found. Create a Draft SKU and use it for the current group line." : activeScan ? `${activeScan.trackingNumber} · ${scanOrderReference(activeScan)}` : "Capture the exterior shipping box."}</DialogDescription>
          </div>
          {torchAvailable ? <Button size="icon" variant={torchEnabled ? "default" : "outline"} title={torchEnabled ? "Turn off camera light" : "Turn on camera light"} onClick={() => void toggleTorch()}><Flashlight className="size-4" /></Button> : null}
        </div>
        {mode === "scan" || mode === "items" ? <form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); if (mode === "items") void submitItem(manualValue); else void submit(manualValue) }}>
          <div className="relative min-w-0 flex-1"><Keyboard className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9 font-mono" value={manualValue} onChange={(event) => setManualValue(event.target.value)} placeholder={mode === "items" ? "Scan or enter item UPC" : "Scan or enter tracking number"} autoComplete="off" /></div>
          <Button type="submit" variant="secondary" disabled={busy || !manualValue.trim()}>{busy ? <Loader2 className="size-4 animate-spin" /> : mode === "items" ? <ScanBarcode className="size-4" /> : <Search className="size-4" />} {mode === "items" ? "Use item" : "Record"}</Button>
        </form> : null}
      </DialogHeader>
      <div className="relative min-h-0 flex-1 bg-black"><video ref={videoRef} className="size-full object-contain" autoPlay muted playsInline />
        {cameraState !== "ready" && <div className="absolute inset-0 grid place-items-center bg-black/85 p-6 text-center text-white"><div className="max-w-sm"><p className="font-medium">{cameraState === "opening" ? "Starting camera..." : cameraState === "permission" ? "Camera permission is needed" : cameraState === "unsupported" ? "Camera scanning is not supported here" : "Camera could not start"}</p><p className="mt-2 text-sm text-white/70">Use the manual field or a Bluetooth scanner if camera access is unavailable.</p>{cameraState === "permission" || cameraState === "error" ? <Button className="mt-4" variant="secondary" onClick={() => setAttempt((value) => value + 1)}>Try camera again</Button> : null}</div></div>}
        {cameraState === "ready" && (mode === "scan" || mode === "items") ? <div className="pointer-events-none absolute inset-x-[7%] top-1/2 -translate-y-1/2"><div className={`h-28 rounded-md border-2 shadow-[0_0_18px_rgba(74,222,128,.55)] ${mode === "items" ? "border-blue-400/90" : "border-emerald-400/90"}`}><div className={`mt-14 h-0.5 ${mode === "items" ? "bg-blue-400" : "bg-emerald-400"}`} /></div><p className="mx-auto mt-3 w-fit rounded-full bg-black/75 px-3 py-1.5 text-xs font-medium text-white">{mode === "items" && activeScan ? `Scan actual item UPC · ${itemProgressLabel(activeScan)}` : "Align one tracking barcode inside the frame"} · {scannerEngine === "native" ? "Fast scan" : "Compatible scan"}</p></div> : null}
        {lastResult && mode === "scan" ? <div className={`absolute inset-x-3 top-3 flex items-start gap-3 rounded-md border p-3 text-white shadow-xl ${lastResult.duplicate ? "border-amber-300 bg-amber-700" : lastResult.scan.matchStatus === "unmatched" ? "border-amber-300 bg-amber-700" : "border-emerald-300 bg-emerald-700"}`}>{lastResult.duplicate || lastResult.scan.matchStatus === "unmatched" ? <AlertTriangle className="mt-0.5 size-5 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-5 shrink-0" />}<div className="min-w-0"><p className="font-medium">{lastResult.message}</p><p className="mt-1 truncate font-mono text-xs text-white/80">{lastResult.scan.trackingNumber}</p></div></div> : null}
        {mode === "items" && activeScan ? <div className="absolute inset-x-3 top-3 rounded-md border border-blue-300 bg-blue-950/90 p-3 text-white shadow-xl"><div className="flex items-center justify-between gap-3"><div><p className="font-medium">{activeScan.liveItemRequired ? activeScan.matches.length > 1 ? "Combined Live shipment" : "Live shipment" : activeScan.matches.length ? "Optional item verification" : "Unmatched package contents"}</p><p className="text-xs text-blue-100">{activeScan.matches.length ? `${activeScan.matches.length} order${activeScan.matches.length === 1 ? "" : "s"}` : "No DataPlus order matched"}{activeScan.liveItemRequired ? " · inventory assignment required" : " · scan items or skip to the package photo"}</p></div><Badge variant="secondary" className="shrink-0">{itemProgressLabel(activeScan)}</Badge></div>{lastItem ? <div className="mt-3 rounded border border-white/20 bg-black/30 p-2"><p className="truncate text-sm font-medium">{lastItem.sku} · {lastItem.title}</p><p className="truncate text-xs text-white/70">{lastItem.orderNumber ? `${lastItem.verificationOnly ? lastItem.verificationMatched === false ? "Does not match" : "Verified for" : "Assigned to"} ${lastItem.orderNumber} · ${lastItem.listingTitle}` : "Recorded with this unmatched package"}</p></div> : <p className="mt-3 text-sm text-blue-100">{activeScan.liveItemRequired ? "Scan each actual product in the box. DataPlus assigns inventory to the next open line across the group." : "Scan any item UPCs you want recorded, or skip this optional step and photograph the package."}</p>}</div> : null}
        {mode === "tracking" && trackingCandidate ? <div className="absolute inset-0 overflow-y-auto bg-background/98 p-4 text-foreground"><div className="mx-auto grid max-w-lg gap-4 rounded-md border bg-card p-4 shadow-xl"><div><div className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4 text-amber-500" /> FedEx tracking or item UPC?</div><p className="mt-2 break-all font-mono text-sm">{trackingCandidate.barcode}</p><p className="mt-2 text-sm text-muted-foreground">DataPlus did not find this 12–14 digit value in the catalog. FedEx tracking uses the same numeric format as many product barcodes.</p></div><div className="grid gap-2 sm:grid-cols-2"><Button variant="outline" disabled={busy} onClick={() => void useTrackingCandidateAsItem()}><PackageCheck className="size-4" /> Use as item UPC</Button><Button disabled={busy} onClick={() => void useTrackingCandidateAsPackage()}><Truck className="size-4" /> Start FedEx package</Button></div></div></div> : null}
        {mode === "quick" && unknownItem ? <div className="absolute inset-0 overflow-y-auto bg-background/98 p-4 text-foreground"><div className="mx-auto grid max-w-lg gap-4 rounded-md border bg-card p-4 shadow-xl"><div><div className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4 text-amber-500" /> Product not found</div><p className="mt-1 break-all font-mono text-xs text-muted-foreground">{unknownItem.barcode}</p>{unknownItem.target ? <p className="mt-2 text-sm text-muted-foreground">Next group line: {unknownItem.target.orderNumber} · {unknownItem.target.listingTitle}</p> : null}</div><div className="grid gap-2"><Label>Product title</Label><Input value={quickDraft.title} onChange={(event) => setQuickDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Actual product name" autoFocus /></div><div className="grid gap-2"><Label>Unit cost</Label><Input type="number" min="0" step="0.01" inputMode="decimal" value={quickDraft.cost} onChange={(event) => setQuickDraft((current) => ({ ...current, cost: event.target.value }))} placeholder="0.00" /></div><p className="text-xs text-muted-foreground">Creates a Draft catalog SKU at this audit warehouse, records the outbound unit, and leaves the product for catalog review.</p><div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="outline" disabled={busy} onClick={() => { setUnknownItem(null); setMode("items") }}>Scan another UPC</Button><Button disabled={busy || !quickDraft.title.trim()} onClick={() => void quickCreateItem()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <PackageCheck className="size-4" />} Create and use item</Button></div></div></div> : null}
        {mode === "photo" && cameraState === "ready" ? <div className="absolute inset-x-0 bottom-5 flex justify-center"><Button className="size-16 rounded-full border-4 border-white bg-white text-black shadow-2xl hover:bg-white" size="icon" title="Take package photo" disabled={busy} onClick={() => void capturePhoto()}>{busy ? <Loader2 className="size-6 animate-spin" /> : <Camera className="size-7" />}</Button></div> : null}
        {mode === "preview" && photo ? <div className="absolute inset-0 grid bg-black"><img src={photo.previewUrl} alt="Package evidence preview" className="size-full object-contain" /><div className="absolute inset-x-0 bottom-0 flex justify-center gap-3 bg-black/70 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><Button variant="secondary" disabled={busy} onClick={() => { clearPhoto(); setMode("photo") }}><RotateCcw className="size-4" /> Retake</Button><Button disabled={busy} onClick={() => void usePhoto()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />} Use photo</Button></div></div> : null}
        {busy ? <div className="absolute inset-0 grid place-items-center bg-black/40"><div className="flex items-center gap-2 rounded-md bg-background px-4 py-3 text-foreground shadow-xl"><Loader2 className="size-5 animate-spin" /> {mode === "items" || mode === "quick" ? activeScan?.liveItemRequired ? "Assigning inventory..." : "Verifying item..." : "Recording package..."}</div></div> : null}
      </div>
      <DialogFooter className="!m-0 shrink-0 !flex-col gap-2 rounded-none border-t bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:!flex-row sm:items-center sm:justify-between"><p className="w-full text-xs text-muted-foreground sm:min-w-0 sm:flex-1 sm:truncate">{pendingUploads ? `${pendingUploads} photo upload${pendingUploads === 1 ? "" : "s"} continuing in the background.` : mode === "scan" ? "Camera stays open between packages for faster scanning." : mode === "items" ? activeScan?.liveItemRequired ? "Item scans apply to the complete shipment group, including combined orders." : "Item verification is optional. You can remove mistakes or skip directly to the package photo." : mode === "tracking" ? "Choose tracking only when this barcode came from the shipping label." : mode === "quick" ? "Quick-created products remain Draft until catalog review." : "Include the label and the exterior condition of the box."}</p><div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">{mode === "items" && lastItem?.verificationOnly ? <Button className="w-full sm:w-auto" variant="outline" disabled={busy} onClick={() => void undoLastItemScan()}><Undo2 className="size-4" /> Undo last item</Button> : null}{mode === "items" && activeScan && !activeScan.liveItemRequired ? <Button className="w-full sm:w-auto" onClick={skipOptionalItemScan}><ImageIcon className="size-4" /> {activeScan.evidenceCount ? "Skip item scan" : "Skip to package photo"}</Button> : null}<Button className="w-full sm:w-auto" variant="outline" onClick={() => onOpenChange(false)}>Done</Button></div></DialogFooter>
    </DialogContent>
  </Dialog>
}

export function OutboundAuditWorkspace({ warehouses = [] }: { warehouses?: Row[] }) {
  const availableWarehouses = useMemo(() => physicalWarehouses(warehouses), [warehouses])
  const photoDeepLink = useMemo(() => {
    if (typeof window === "undefined") return { auditId: "", scanId: "", photo: false }
    const params = new URLSearchParams(window.location.search)
    return { auditId: params.get("auditId") || "", scanId: params.get("scanId") || "", photo: params.get("photo") === "1" }
  }, [])
  const [audits, setAudits] = useState<AuditSession[]>([])
  const [auditMatches, setAuditMatches] = useState<AuditSession[]>([])
  const [auditPickerOpen, setAuditPickerOpen] = useState(false)
  const [auditQuery, setAuditQuery] = useState("")
  const [auditSearching, setAuditSearching] = useState(false)
  const [selectedId, setSelectedId] = useState("")
  const [detail, setDetail] = useState<AuditDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [startOpen, setStartOpen] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scannerInitialScan, setScannerInitialScan] = useState<AuditScan | null>(null)
  const [scannerInitialMode, setScannerInitialMode] = useState<"photo" | null>(null)
  const [closeOpen, setCloseOpen] = useState(false)
  const [manualTracking, setManualTracking] = useState("")
  const [uploadStates, setUploadStates] = useState<Record<string, "uploading" | "failed">>({})
  const [removingItemId, setRemovingItemId] = useState("")
  const [packageSearch, setPackageSearch] = useState("")
  const [carrierFilter, setCarrierFilter] = useState("all")
  const [channelFilter, setChannelFilter] = useState("all")
  const [scannerFilter, setScannerFilter] = useState("all")
  const [photoPreview, setPhotoPreview] = useState<{ url: string; tracking: string } | null>(null)
  const uploadingEvidenceRef = useRef(new Set<string>())
  const photoDeepLinkHandledRef = useRef(false)
  const [startDraft, setStartDraft] = useState({ warehouseId: "", notes: "" })
  const [closeDraft, setCloseDraft] = useState({ handoffMethod: "pickup", driverName: "", pickupConfirmation: "", notes: "", completionOverrideReason: "" })

  const loadAudits = useCallback(async (preferredId = "") => {
    setLoading(true)
    try {
      const response = await api<{ audits?: AuditSession[] }>("/api/fulfillment/outbound-audits?limit=100")
      const rows = response.audits || []
      setAudits(rows)
      setSelectedId((current) => {
        if (preferredId && rows.some((row) => row.id === preferredId)) return preferredId
        if (current && rows.some((row) => row.id === current)) return current
        return rows.find((row) => row.status === "open")?.id || rows[0]?.id || ""
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load outbound audits.")
    } finally { setLoading(false) }
  }, [])

  const loadDetail = useCallback(async (auditId: string) => {
    if (!auditId) { setDetail(null); return }
    try { setDetail(await api<AuditDetail>(`/api/fulfillment/outbound-audits/${encodeURIComponent(auditId)}`)) }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load the outbound audit.") }
  }, [])

  const uploadEvidence = useCallback(async (item: PendingOutboundEvidence) => {
    if (uploadingEvidenceRef.current.has(item.id)) return
    uploadingEvidenceRef.current.add(item.id)
    setUploadStates(current => ({ ...current, [item.id]: "uploading" }))
    try {
      const intent = await api<{ uploadUrl: string }>(`/api/fulfillment/outbound-audits/${encodeURIComponent(item.auditId)}/scans/${encodeURIComponent(item.scanId)}/evidence`, {
        method: "POST",
        body: JSON.stringify({ clientEvidenceId: item.id, contentType: "image/jpeg", byteSize: item.blob.size, width: item.width, height: item.height, capturedAt: item.capturedAt }),
      })
      const response = await fetch(intent.uploadUrl, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: item.blob })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(String(payload.error || payload.message || `Photo upload failed: ${response.status}`))
      await removePendingOutboundEvidence(item.id).catch(() => {})
      setUploadStates(current => {
        const next = { ...current }
        delete next[item.id]
        return next
      })
      await loadAudits(item.auditId)
      if (selectedId === item.auditId) await loadDetail(item.auditId)
    } catch (error) {
      setUploadStates(current => ({ ...current, [item.id]: "failed" }))
      toast.error(error instanceof Error ? `Package photo queued for retry: ${error.message}` : "Package photo queued for retry.")
    } finally {
      uploadingEvidenceRef.current.delete(item.id)
    }
  }, [loadAudits, loadDetail, selectedId])

  const retryPendingEvidence = useCallback(async () => {
    const pending = await listPendingOutboundEvidence().catch(() => [])
    for (const item of pending) void uploadEvidence(item)
    return pending.length
  }, [uploadEvidence])

  const queueEvidencePhoto = useCallback(async (scan: AuditScan, captured: Omit<CapturedPhoto, "previewUrl">) => {
    if (!detail?.session.id) throw new Error("The outbound audit is no longer available.")
    const item: PendingOutboundEvidence = {
      id: crypto.randomUUID(),
      auditId: detail.session.id,
      scanId: scan.id,
      blob: captured.blob,
      width: captured.width,
      height: captured.height,
      capturedAt: new Date().toISOString(),
    }
    await savePendingOutboundEvidence(item)
    setDetail(current => current ? { ...current, scans: current.scans.map(row => row.id === scan.id ? { ...row, evidenceStatus: "uploading" } : row) } : current)
    void uploadEvidence(item)
  }, [detail?.session.id, uploadEvidence])

  useEffect(() => { void loadAudits(photoDeepLink.auditId) }, [loadAudits, photoDeepLink.auditId])
  useEffect(() => { void loadDetail(selectedId) }, [loadDetail, selectedId])
  useEffect(() => {
    if (photoDeepLinkHandledRef.current || !photoDeepLink.photo || !photoDeepLink.auditId || !photoDeepLink.scanId || detail?.session.id !== photoDeepLink.auditId) return
    photoDeepLinkHandledRef.current = true
    const scan = detail.scans.find((row) => row.id === photoDeepLink.scanId)
    if (!scan) {
      toast.error("The scanned package is no longer available for a photo.")
      return
    }
    setScannerInitialScan(scan)
    setScannerInitialMode("photo")
    setScannerOpen(true)
  }, [detail, photoDeepLink])
  useEffect(() => { void retryPendingEvidence() }, [retryPendingEvidence])
  useEffect(() => {
    const query = auditQuery.trim()
    if (query.length < 2) {
      setAuditMatches([])
      setAuditSearching(false)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setAuditSearching(true)
      try {
        const response = await api<{ audits?: AuditSession[] }>(`/api/fulfillment/outbound-audits?${new URLSearchParams({ limit: "50", q: query })}`, { signal: controller.signal })
        setAuditMatches(response.audits || [])
      } catch (error) {
        if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : "Unable to search outbound audits.")
      } finally {
        if (!controller.signal.aborted) setAuditSearching(false)
      }
    }, 250)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [auditQuery])
  useEffect(() => {
    setCloseDraft(current => ({ ...current, completionOverrideReason: "" }))
    setPackageSearch("")
    setCarrierFilter("all")
    setChannelFilter("all")
    setScannerFilter("all")
  }, [selectedId])
  useEffect(() => {
    if (!startDraft.warehouseId && availableWarehouses[0]?.id) setStartDraft((current) => ({ ...current, warehouseId: String(availableWarehouses[0].id) }))
  }, [availableWarehouses, startDraft.warehouseId])

  async function startAudit() {
    const warehouse = availableWarehouses.find((row) => String(row.id) === startDraft.warehouseId)
    if (!warehouse) return toast.error("Choose a physical warehouse.")
    setBusy(true)
    try {
      const response = await api<{ audit: AuditSession; message?: string }>("/api/fulfillment/outbound-audits", { method: "POST", body: JSON.stringify({ warehouseId: warehouse.id, warehouseName: warehouse.name || warehouse.code, notes: startDraft.notes }) })
      toast.success(response.message || "Outbound audit started.")
      setStartOpen(false)
      setStartDraft((current) => ({ ...current, notes: "" }))
      await loadAudits(response.audit.id)
      await loadDetail(response.audit.id)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to start the outbound audit.") }
    finally { setBusy(false) }
  }

  const recordScan = useCallback(async (trackingNumber: string) => {
    if (!detail?.session.id) throw new Error("Start or select an open outbound audit first.")
    const result = await api<ScanResponse>(`/api/fulfillment/outbound-audits/${encodeURIComponent(detail.session.id)}/scan`, { method: "POST", body: JSON.stringify({ trackingNumber, clientScanId: crypto.randomUUID() }) })
    setDetail((current) => current ? current.session.id === result.session.id
      ? { session: result.session, scans: result.duplicate ? current.scans : [result.scan, ...current.scans] }
      : { session: result.session, scans: [result.scan] } : current)
    setSelectedId(result.session.id)
    setAudits((current) => {
      const next = current.map((row) => row.id === result.rolledOverFrom?.id
        ? { ...row, status: "closed" as const, closedAt: result.rolledOverFrom?.closedAt || row.closedAt }
        : row.id === result.session.id ? result.session : row)
      return next.some((row) => row.id === result.session.id) ? next : [result.session, ...next]
    })
    return result
  }, [detail?.session.id])

  const recordLiveItem = useCallback(async (scan: AuditScan, barcode: string, clientScanId: string, options: { forceItem?: boolean } = {}) => {
    if (!detail?.session.id) throw new Error("The outbound audit is no longer available.")
    const result = await api<LiveItemResponse>(`/api/fulfillment/outbound-audits/${encodeURIComponent(detail.session.id)}/item-scan`, {
      method: "POST",
      body: JSON.stringify({ scanId: scan.id, barcode, clientScanId, forceItem: options.forceItem === true }),
    })
    if (!result.notFound && !result.trackingCandidate) setDetail((current) => current ? { ...current, scans: current.scans.map((row) => row.id === result.scan.id ? result.scan : row) } : current)
    return result
  }, [detail?.session.id])

  const quickCreateLiveItem = useCallback(async (scan: AuditScan, input: { barcode: string; title: string; cost: number; clientScanId: string }) => {
    if (!detail?.session.id) throw new Error("The outbound audit is no longer available.")
    const result = await api<LiveItemResponse>(`/api/fulfillment/outbound-audits/${encodeURIComponent(detail.session.id)}/quick-item`, {
      method: "POST",
      body: JSON.stringify({ scanId: scan.id, ...input }),
    })
    setDetail((current) => current ? { ...current, scans: current.scans.map((row) => row.id === result.scan.id ? result.scan : row) } : current)
    return result
  }, [detail?.session.id])

  const removeOptionalItem = useCallback(async (scan: AuditScan, item: LiveItem) => {
    if (!detail?.session.id) throw new Error("The outbound audit is no longer available.")
    setRemovingItemId(item.clientScanId)
    try {
      const result = await api<{ scan: AuditScan; item: LiveItem; message?: string }>(`/api/fulfillment/outbound-audits/${encodeURIComponent(detail.session.id)}/scans/${encodeURIComponent(scan.id)}/items/${encodeURIComponent(item.clientScanId)}`, { method: "DELETE" })
      setDetail((current) => current ? { ...current, scans: current.scans.map((row) => row.id === result.scan.id ? result.scan : row) } : current)
      toast.success(result.message || `${item.sku} was removed from this package scan.`)
      return result.scan
    } finally {
      setRemovingItemId("")
    }
  }, [detail?.session.id])

  async function submitManualScan() {
    const tracking = manualTracking.trim()
    if (!tracking) return
    setBusy(true)
    try {
      const result = await recordScan(tracking)
      if (result.scan.matchStatus === "unmatched" || result.duplicate) toast.warning(result.message || "Package recorded.")
      else toast.success(result.message || "Package recorded.")
      if ((itemScanAvailable(result.scan) && result.scan.liveItemStatus !== "complete") || !result.scan.evidenceCount) {
        setScannerInitialScan(result.scan)
        setScannerOpen(true)
      }
      setManualTracking("")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to record the package.") }
    finally { setBusy(false) }
  }

  async function reconcileUnmatched() {
    if (!detail?.session.id) return
    setBusy(true)
    try {
      const result = await api<AuditDetail & { message?: string }>(`/api/fulfillment/outbound-audits/${encodeURIComponent(detail.session.id)}/reconcile`, { method: "POST", body: "{}" })
      setDetail({ session: result.session, scans: result.scans })
      setAudits((current) => current.map((row) => row.id === result.session.id ? result.session : row))
      toast.success(result.message || "Unmatched scans checked again.")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to recheck unmatched scans.") }
    finally { setBusy(false) }
  }

  async function closeAudit() {
    if (!detail?.session.id) return
    setBusy(true)
    try {
      const response = await api<{ audit: AuditSession; message?: string }>(`/api/fulfillment/outbound-audits/${encodeURIComponent(detail.session.id)}/close`, { method: "POST", body: JSON.stringify(closeDraft) })
      setDetail((current) => current ? { ...current, session: response.audit } : current)
      setAudits((current) => current.map((row) => row.id === response.audit.id ? response.audit : row))
      setCloseOpen(false)
      toast.success(response.message || "Outbound handoff closed.")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to close the outbound audit.") }
    finally { setBusy(false) }
  }

  const session = detail?.session
  const open = session?.status === "open"
  const pendingUploadCount = Object.keys(uploadStates).length
  const incompleteLiveScans = detail?.scans.filter((scan) => scan.liveItemRequired && scan.liveItemStatus !== "complete") || []
  const carrierOptions = useMemo(() => [...new Set((detail?.scans || []).map((scan) => scan.carrier || "Unknown"))].sort(), [detail?.scans])
  const channelOptions = useMemo(() => [...new Set((detail?.scans || []).flatMap((scan) => scan.matches.map((match) => String(match.channel || "").trim())).filter(Boolean))].sort(), [detail?.scans])
  const scannerOptions = useMemo(() => [...new Set((detail?.scans || []).map((scan) => scan.scannedByName || "Unknown"))].sort(), [detail?.scans])
  const filteredScans = useMemo(() => {
    const query = packageSearch.trim().toLowerCase()
    return (detail?.scans || []).filter((scan) => {
      const channels = scan.matches.map((match) => String(match.channel || ""))
      const searchable = [scan.trackingNumber, scan.carrier, scan.scannedByName, ...channels, ...scan.matches.flatMap((match) => [match.orderNumber, match.orderId, match.channelOrderNumber])].join(" ").toLowerCase()
      return (!query || searchable.includes(query))
        && (carrierFilter === "all" || (scan.carrier || "Unknown") === carrierFilter)
        && (channelFilter === "all" || channels.includes(channelFilter))
        && (scannerFilter === "all" || (scan.scannedByName || "Unknown") === scannerFilter)
    })
  }, [detail?.scans, packageSearch, carrierFilter, channelFilter, scannerFilter])
  const filtersActive = Boolean(packageSearch.trim() || carrierFilter !== "all" || channelFilter !== "all" || scannerFilter !== "all")
  const auditOptions = auditQuery.trim().length >= 2 ? auditMatches : audits
  return <div className="grid min-w-0 gap-4">
    <div className="flex flex-col gap-3 rounded-md border bg-card p-3 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0 flex-1"><Label className="mb-2 block">Outbound audit</Label><Popover open={auditPickerOpen} onOpenChange={(open) => { setAuditPickerOpen(open); if (!open) { setAuditQuery(""); setAuditMatches([]) } }}><PopoverTrigger asChild><Button type="button" variant="outline" role="combobox" aria-expanded={auditPickerOpen} className="h-auto min-h-10 w-full max-w-3xl justify-between gap-3 px-3 py-2 text-left font-normal"><span className="min-w-0 flex-1"><span className="block truncate font-semibold">{session?.auditNumber || (loading ? "Loading outbound audits..." : "Select an outbound audit")}</span>{session ? <span className="block truncate text-xs text-muted-foreground">{session.status === "open" ? "Today · " : ""}{session.warehouseName} · Daily session · {numberLabel(session.packageCount)} packages</span> : <span className="block truncate text-xs text-muted-foreground">Search audit ID, tracking number, or order number</span>}</span><ChevronDown className="size-4 shrink-0 text-muted-foreground" /></Button></PopoverTrigger><PopoverContent align="start" className="w-[min(52rem,calc(100vw-2rem))] p-0"><Command shouldFilter={false}><CommandInput value={auditQuery} onValueChange={setAuditQuery} placeholder="Search all audits, tracking numbers, or order numbers..." /><CommandList className="max-h-[min(70vh,32rem)]">{auditSearching ? <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Searching all outbound audits...</div> : <CommandEmpty>{auditQuery.trim().length < 2 ? "No recent outbound audits." : "No audit, tracking number, or order number matched."}</CommandEmpty>}<CommandGroup heading={auditQuery.trim().length >= 2 ? "Search results" : "Today and recent history"}>{auditOptions.map((audit) => <CommandItem key={audit.id} value={audit.id} onSelect={() => { setSelectedId(audit.id); setAuditPickerOpen(false); setAuditQuery(""); setAuditMatches([]) }} className="items-start gap-3 py-3"><CheckCircle2 className={`mt-0.5 size-4 shrink-0 ${selectedId === audit.id ? "text-primary" : "text-transparent"}`} /><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="font-semibold">{audit.auditNumber}</span><Badge variant={audit.status === "open" ? "warning" : "success"}>{audit.status}</Badge>{audit.status === "open" ? <Badge variant="secondary">Today</Badge> : null}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{audit.warehouseName} · Daily session · {dateLabel(audit.startedAt)} · {numberLabel(audit.packageCount)} packages</span>{audit.searchMatch?.trackingNumber || audit.searchMatch?.orderNumber ? <span className="mt-1 block truncate text-xs font-medium text-primary">{audit.searchMatch.trackingNumber ? `Tracking ${audit.searchMatch.trackingNumber}` : ""}{audit.searchMatch.trackingNumber && audit.searchMatch.orderNumber ? " · " : ""}{audit.searchMatch.orderNumber ? `Order ${audit.searchMatch.orderNumber}` : ""}</span> : null}</span></CommandItem>)}</CommandGroup></CommandList></Command></PopoverContent></Popover><p className="mt-1.5 text-xs text-muted-foreground">Previous-day sessions close automatically at midnight Eastern. New scans always go to today&apos;s warehouse audit. Searches every outbound audit by audit ID, warehouse, user, tracking number, DataPlus order, or channel order.</p></div>
      <div className="flex shrink-0 flex-wrap gap-2"><Button variant="outline" size="icon" title="Refresh audits" onClick={() => void loadAudits(selectedId)} disabled={loading}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}</Button><Button onClick={() => setStartOpen(true)}><ClipboardCheck className="size-4" /> Use today&apos;s audit</Button></div>
    </div>
    <Card className="min-w-0"><CardHeader className="border-b"><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><div className="flex flex-wrap items-center gap-2"><CardTitle>{session?.auditNumber || "Outbound handoff audit"}</CardTitle>{session ? <Badge variant={open ? "warning" : "success"}>{session.status}</Badge> : null}{open ? <Badge variant="secondary">Today</Badge> : null}</div><CardDescription>{session ? `${session.warehouseName} · Daily mixed-carrier session · Session date ${dateLabel(session.startedAt)}` : "Start an audit and scan every physical package before carrier handoff."}</CardDescription></div>{session ? <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" asChild><a href={`/api/fulfillment/outbound-audits/${encodeURIComponent(session.id)}/export.csv`}><FileDown className="size-4" /> CSV</a></Button><Button size="sm" variant="outline" asChild><a href={`/api/fulfillment/outbound-audits/${encodeURIComponent(session.id)}/print`} target="_blank" rel="noreferrer"><Printer className="size-4" /> Print record</a></Button>{open ? <Button size="sm" onClick={() => { setScannerInitialScan(null); setScannerOpen(true) }}><Camera className="size-4" /> Scan packages</Button> : null}</div> : null}</div></CardHeader>
      <CardContent className="grid gap-4 p-4">{session ? <>
        <div className="grid overflow-hidden rounded-md border grid-cols-2 lg:grid-cols-3">{[["Scanned", session.packageCount], ["Matched", session.matchedCount], ["No order match", session.unmatchedCount], ["Photos saved", session.evidenceCompleteCount], ["Without photo", session.evidenceMissingCount], ["Multiple orders", session.multipleMatchCount]].map(([label, count], index) => <div key={String(label)} className={`border-b p-3 ${index % 2 === 0 ? "border-r lg:border-r" : ""} ${index % 3 !== 2 ? "lg:border-r" : "lg:border-r-0"} ${index >= 4 ? "border-b-0" : ""} ${index >= 3 ? "lg:border-b-0" : ""}`}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{numberLabel(Number(count))}</p></div>)}</div>
        <div className="rounded-md border bg-muted/20 p-3"><p className="text-xs font-medium text-muted-foreground">Carrier breakdown</p><div className="mt-2 flex flex-wrap gap-2">{session.carrierBreakdown?.length ? session.carrierBreakdown.map((row) => <Badge key={row.carrier} variant="secondary">{row.carrier} · {numberLabel(row.count)}</Badge>) : <span className="text-sm text-muted-foreground">No packages scanned yet.</span>}</div></div>
        {open ? <form className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3 sm:flex-row" onSubmit={(event) => { event.preventDefault(); void submitManualScan() }}><div className="relative min-w-0 flex-1"><Keyboard className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9 font-mono" value={manualTracking} onChange={(event) => setManualTracking(event.target.value)} placeholder="Scan with a hardware scanner or enter tracking" autoComplete="off" /></div><Button type="submit" variant="outline" disabled={busy || !manualTracking.trim()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <PackageCheck className="size-4" />} Record package</Button><Button type="button" onClick={() => setCloseOpen(true)}><Truck className="size-4" /> Close handoff</Button></form> : <div className="rounded-md border bg-emerald-500/5 p-3 text-sm"><div className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="size-4" /> Handoff closed {session.closedAt ? dateLabel(session.closedAt) : ""}</div><p className="mt-1 text-muted-foreground">Driver: {session.driverName || "Not recorded"} · Confirmation: {session.pickupConfirmation || "Not recorded"}</p>{session.closeOverrideReason ? <p className="mt-1 text-muted-foreground">{session.closeOverrideReason === "Automatically closed at the daily outbound rollover." ? "Daily close" : "Supervisor exception"}: {session.closeOverrideReason}</p> : null}</div>}
        {session.unmatchedCount > 0 ? <div className="flex flex-col gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" /><div><p className="text-sm font-medium">{numberLabel(session.unmatchedCount)} package{session.unmatchedCount === 1 ? "" : "s"} retained without an order match</p><p className="text-xs text-muted-foreground">These packages remain part of the handoff record. Recheck after channel tracking or missing orders import.</p></div></div><Button size="sm" variant="outline" disabled={busy} onClick={() => void reconcileUnmatched()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Recheck unmatched</Button></div> : null}
        {incompleteLiveScans.length ? <div className="flex flex-col gap-3 rounded-md border border-blue-500/40 bg-blue-500/5 p-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-2"><ScanBarcode className="mt-0.5 size-4 shrink-0 text-blue-600" /><div><p className="text-sm font-medium">{incompleteLiveScans.length} Live shipment group{incompleteLiveScans.length === 1 ? "" : "s"} still need item scans</p><p className="text-xs text-muted-foreground">Combined orders are scanned as one group. Inventory is deducted from {session.warehouseName} as each actual UPC is assigned.</p></div></div><Button size="sm" variant="outline" onClick={() => { setScannerInitialScan(incompleteLiveScans[0]); setScannerOpen(true) }}><ScanBarcode className="size-4" /> Continue item scans</Button></div> : null}
        {pendingUploadCount > 0 ? <div className="flex flex-col gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-2"><ImageIcon className="mt-0.5 size-4 shrink-0 text-amber-600" /><div><p className="text-sm font-medium">{pendingUploadCount} optional package photo upload{pendingUploadCount === 1 ? "" : "s"} pending</p><p className="text-xs text-muted-foreground">Photos are optional evidence and never block closing the audit.</p></div></div><Button size="sm" variant="outline" onClick={() => void retryPendingEvidence()}><RefreshCw className="size-4" /> Retry uploads</Button></div> : null}
        <div className="grid gap-2 rounded-md border bg-muted/10 p-3 lg:grid-cols-[minmax(14rem,1fr)_repeat(3,minmax(9rem,auto))_auto]"><div className="relative"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" value={packageSearch} onChange={(event) => setPackageSearch(event.target.value)} placeholder="Tracking or order" /></div><Select value={carrierFilter} onValueChange={setCarrierFilter}><SelectTrigger><SelectValue placeholder="Carrier" /></SelectTrigger><SelectContent><SelectItem value="all">All carriers</SelectItem>{carrierOptions.map((carrier) => <SelectItem key={carrier} value={carrier}>{carrier}</SelectItem>)}</SelectContent></Select><Select value={channelFilter} onValueChange={setChannelFilter}><SelectTrigger><SelectValue placeholder="Channel" /></SelectTrigger><SelectContent><SelectItem value="all">All channels</SelectItem>{channelOptions.map((channel) => <SelectItem key={channel} value={channel}>{channel}</SelectItem>)}</SelectContent></Select><Select value={scannerFilter} onValueChange={setScannerFilter}><SelectTrigger><SelectValue placeholder="Scanned by" /></SelectTrigger><SelectContent><SelectItem value="all">All users</SelectItem>{scannerOptions.map((scanner) => <SelectItem key={scanner} value={scanner}>{scanner}</SelectItem>)}</SelectContent></Select><Button variant="ghost" size="sm" disabled={!filtersActive} onClick={() => { setPackageSearch(""); setCarrierFilter("all"); setChannelFilter("all"); setScannerFilter("all") }}><X className="size-4" /> Clear</Button><p className="text-xs text-muted-foreground lg:col-span-5">Showing {numberLabel(filteredScans.length)} of {numberLabel(detail.scans.length)} packages</p></div>
        <div className="grid gap-2 md:hidden">{filteredScans.map((scan) => <div key={scan.id} className="rounded-md border p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><TrackingReference scan={scan} compact /><p className="mt-1 text-xs text-muted-foreground">{scan.carrier || "Carrier unknown"} · {dateLabel(scan.scannedAt)}</p></div>{matchBadge(scan)}</div><div className="mt-3"><MatchedOrders scan={scan} compact removingItemId={removingItemId} onRemoveItem={(selectedScan, item) => void removeOptionalItem(selectedScan, item)} /></div><div className="mt-3 flex flex-wrap items-center gap-2">{itemScanBadge(scan)}{evidenceBadge(scan)}{scan.evidence[0]?.contentUrl ? <Button size="sm" variant="ghost" onClick={() => setPhotoPreview({ url: scan.evidence[0].contentUrl, tracking: scan.trackingNumber })}><ImageIcon className="size-4" /> View photo</Button> : null}{open && ((itemScanAvailable(scan) && scan.liveItemStatus !== "complete") || !scan.evidenceCount) ? <Button size="sm" variant="outline" onClick={() => { setScannerInitialScan(scan); setScannerOpen(true) }}>{itemScanAvailable(scan) && scan.liveItemStatus !== "complete" ? <><ScanBarcode className="size-4" /> {scan.liveItemRequired ? "Continue" : "Scan items"}</> : <><Camera className="size-4" /> Add photo</>}</Button> : null}</div></div>)}</div>
        <div className="hidden rounded-md border md:block"><Table><TableHeader><TableRow><TableHead className="w-[19rem]">Package</TableHead><TableHead>Order and channel</TableHead><TableHead className="w-[12rem]">Verification</TableHead><TableHead className="w-[10rem]">Photo</TableHead><TableHead className="w-[11rem]">Scanned by</TableHead></TableRow></TableHeader><TableBody>{filteredScans.map((scan) => <TableRow key={scan.id}><TableCell><TrackingReference scan={scan} /><p className="mt-1 text-xs text-muted-foreground">{scan.carrier || "Unknown"}</p></TableCell><TableCell><div className="grid gap-1"><MatchedOrders scan={scan} removingItemId={removingItemId} onRemoveItem={(selectedScan, item) => void removeOptionalItem(selectedScan, item)} />{matchBadge(scan)}</div></TableCell><TableCell><div className="grid justify-items-start gap-1">{itemScanBadge(scan) || <span className="text-xs text-muted-foreground">No order items</span>}{open && ((itemScanAvailable(scan) && scan.liveItemStatus !== "complete") || !scan.evidenceCount) ? <Button size="sm" variant="outline" onClick={() => { setScannerInitialScan(scan); setScannerOpen(true) }}>{itemScanAvailable(scan) && scan.liveItemStatus !== "complete" ? <><ScanBarcode className="size-4" /> {scan.liveItemRequired ? "Continue" : "Scan items"}</> : <><Camera className="size-4" /> Add photo</>}</Button> : null}</div></TableCell><TableCell><div className="grid justify-items-start gap-1">{evidenceBadge(scan)}{scan.evidence[0]?.contentUrl ? <Button size="sm" variant="ghost" onClick={() => setPhotoPreview({ url: scan.evidence[0].contentUrl, tracking: scan.trackingNumber })}><ImageIcon className="size-4" /> View</Button> : null}</div></TableCell><TableCell><p className="text-xs font-medium">{scan.scannedByName || "Unknown"}</p><p className="whitespace-nowrap text-xs text-muted-foreground">{dateLabel(scan.scannedAt)}</p></TableCell></TableRow>)}{!filteredScans.length ? <TableRow><TableCell colSpan={5} className="h-28 text-center text-muted-foreground">{detail.scans.length ? "No packages match these filters." : "No packages scanned yet."}</TableCell></TableRow> : null}</TableBody></Table></div>
      </> : <div className="grid min-h-72 place-items-center text-center"><div><ClipboardCheck className="mx-auto size-8 text-muted-foreground" /><p className="mt-3 font-medium">No outbound audit selected</p><p className="mt-1 text-sm text-muted-foreground">Open or create today&apos;s warehouse audit.</p><Button className="mt-4" onClick={() => setStartOpen(true)}>Use today&apos;s audit</Button></div></div>}</CardContent>
    </Card>
    <Dialog open={startOpen} onOpenChange={setStartOpen}><DialogContent><DialogHeader><DialogTitle>Use today&apos;s outbound audit</DialogTitle><DialogDescription>DataPlus reopens today&apos;s daily warehouse session when it already exists. Carrier is detected from each tracking label automatically.</DialogDescription></DialogHeader><div className="grid gap-4"><div className="grid gap-2"><Label>Warehouse</Label><Select value={startDraft.warehouseId} onValueChange={(warehouseId) => setStartDraft((current) => ({ ...current, warehouseId }))}><SelectTrigger><SelectValue placeholder="Choose warehouse" /></SelectTrigger><SelectContent>{availableWarehouses.map((warehouse) => <SelectItem key={String(warehouse.id)} value={String(warehouse.id)}>{String(warehouse.name || warehouse.code || warehouse.id)}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-2"><Label>Notes</Label><Textarea value={startDraft.notes} onChange={(event) => setStartDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Pickup window, dock, route, or other context" /></div></div><DialogFooter><Button variant="outline" onClick={() => setStartOpen(false)}>Cancel</Button><Button disabled={busy || !startDraft.warehouseId} onClick={() => void startAudit()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <ClipboardCheck className="size-4" />} Continue</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Close outbound handoff</DialogTitle><DialogDescription>Closing freezes the package list as the warehouse&apos;s record of what was handed over. It does not mark packages carrier-accepted.</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2"><Label>Handoff method</Label><Select value={closeDraft.handoffMethod} onValueChange={(handoffMethod) => setCloseDraft((current) => ({ ...current, handoffMethod }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pickup">Carrier pickup</SelectItem><SelectItem value="dropoff">Carrier drop-off</SelectItem><SelectItem value="third_party">Third-party handoff</SelectItem></SelectContent></Select></div>
          <div className="grid gap-2"><Label>Driver or receiving party</Label><Input value={closeDraft.driverName} onChange={(event) => setCloseDraft((current) => ({ ...current, driverName: event.target.value }))} placeholder="Optional name" /></div>
          <div className="grid gap-2"><Label>Pickup confirmation</Label><Input value={closeDraft.pickupConfirmation} onChange={(event) => setCloseDraft((current) => ({ ...current, pickupConfirmation: event.target.value }))} placeholder="Optional confirmation or route" /></div>
          <div className="grid gap-2 sm:col-span-2"><Label>Handoff notes</Label><Textarea value={closeDraft.notes} onChange={(event) => setCloseDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Exceptions, package count confirmation, or driver notes" /></div>
          {(!session?.packageCount || incompleteLiveScans.length > 0) ? <div className="grid gap-2 sm:col-span-2"><Label>Supervisor completion override reason</Label><Textarea value={closeDraft.completionOverrideReason} onChange={(event) => setCloseDraft((current) => ({ ...current, completionOverrideReason: event.target.value }))} placeholder={!session?.packageCount ? "Required to close an empty previous audit" : `Required to close with ${incompleteLiveScans.length} incomplete Live shipment group${incompleteLiveScans.length === 1 ? "" : "s"}`} /></div> : null}
        </div>
        {session?.unmatchedCount ? <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm"><strong>{numberLabel(session.unmatchedCount)} unmatched package{session.unmatchedCount === 1 ? "" : "s"}</strong> will remain in the closed record with their tracking numbers.</div> : null}
        {session?.evidenceMissingCount ? <div className="rounded-md border bg-muted/30 p-3 text-sm"><strong>{numberLabel(session.evidenceMissingCount)} package{session.evidenceMissingCount === 1 ? " has" : "s have"} no photo.</strong> Photos are optional and this does not prevent closing.</div> : null}
        {incompleteLiveScans.length ? <div className="rounded-md border border-blue-500/40 bg-blue-500/5 p-3 text-sm"><strong>{incompleteLiveScans.length} Live shipment group{incompleteLiveScans.length === 1 ? " is" : "s are"} incomplete.</strong> Finish the item scans, or record a supervisor reason to retain the exception and close this older audit.</div> : null}
        <DialogFooter><Button variant="outline" onClick={() => setCloseOpen(false)}>Keep scanning</Button><Button disabled={busy || Boolean((!session?.packageCount || incompleteLiveScans.length > 0) && !closeDraft.completionOverrideReason.trim())} onClick={() => void closeAudit()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />} Close {numberLabel(session?.packageCount || 0)} package handoff</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(photoPreview)} onOpenChange={(next) => !next && setPhotoPreview(null)}><DialogContent className="max-h-[92vh] sm:max-w-5xl"><DialogHeader><DialogTitle>Shipment photo</DialogTitle><DialogDescription>{photoPreview?.tracking || "Outbound package evidence"}</DialogDescription></DialogHeader>{photoPreview ? <img src={photoPreview.url} alt={`Shipment ${photoPreview.tracking}`} className="max-h-[75vh] w-full rounded-md bg-muted object-contain" /> : null}</DialogContent></Dialog>
    <AuditCamera open={scannerOpen} initialScan={scannerInitialScan} initialMode={scannerInitialMode} onOpenChange={(next) => { setScannerOpen(next); if (!next) { setScannerInitialScan(null); setScannerInitialMode(null) } }} onScan={recordScan} onItemScan={recordLiveItem} onQuickCreate={quickCreateLiveItem} onRemoveItem={removeOptionalItem} onPhoto={queueEvidencePhoto} pendingUploads={pendingUploadCount} />
  </div>
}
