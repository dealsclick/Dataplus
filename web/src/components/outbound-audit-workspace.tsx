import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, Camera, CheckCircle2, ClipboardCheck, ExternalLink, FileDown, Flashlight, Image as ImageIcon, Keyboard, Loader2, PackageCheck, Printer, RefreshCw, RotateCcw, Search, Truck, UploadCloud } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { api, dateLabel, numberLabel } from "../lib/client-api"
import { captureCompressedEvidence, startFastBarcodeScanner } from "../lib/fast-barcode-scanner"
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
  evidenceRequired: boolean
  evidenceCompleteCount: number
  evidenceMissingCount: number
  evidenceOverrideReason: string
  startedByName: string
  startedAt: string
  closedAt: string
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
  scannedByName: string
  scannedAt: string
}
type AuditDetail = { session: AuditSession; scans: AuditScan[] }
type ScanResponse = { scan: AuditScan; session: AuditSession; duplicate?: boolean; message?: string }
type CapturedPhoto = { blob: Blob; width: number; height: number; previewUrl: string }

const carriers = ["UPS", "USPS", "FedEx", "DHL", "Amazon Shipping", "OnTrac", "Other"]

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

function TrackingReference({ scan, compact = false }: { scan: AuditScan; compact?: boolean }) {
  const className = `${compact ? "break-all" : "whitespace-nowrap"} inline-flex items-center gap-1 font-mono text-xs font-medium`
  if (!scan.trackingUrl) return <span className={className}>{scan.trackingNumber}</span>
  return <a className={`${className} text-primary hover:underline`} href={scan.trackingUrl} target="_blank" rel="noreferrer" title={`Track with ${scan.carrier || "carrier"}`}>{scan.trackingNumber}<ExternalLink className="size-3 shrink-0" /></a>
}

function MatchedOrders({ scan, compact = false }: { scan: AuditScan; compact?: boolean }) {
  if (!scan.matches.length) return <span className="text-sm text-amber-700 dark:text-amber-300">Tracking retained without an order link</span>
  return <div className="grid gap-2">{scan.matches.map((match) => {
    const orderNumber = String(match.orderNumber || match.orderId || "")
    const channelOrderNumber = String(match.channelOrderNumber || "")
    return <div key={`${match.orderId}:${match.shipmentId}`} className="min-w-0"><a className="w-fit font-medium text-primary hover:underline" href={String(match.href || `/orders/${encodeURIComponent(String(match.orderId || ""))}`)}>DataPlus order {orderNumber}</a>{channelOrderNumber && channelOrderNumber !== orderNumber ? <p className={`${compact ? "max-w-[16rem] truncate" : "break-all"} text-xs text-muted-foreground`}>{String(match.channel || "Channel")} order {channelOrderNumber}</p> : null}</div>
  })}</div>
}

function scanOrderReference(scan: AuditScan) {
  const match = scan.matches[0]
  if (!match) return "No order match"
  const orderNumber = String(match.orderNumber || match.orderId || "")
  const channelOrderNumber = String(match.channelOrderNumber || "")
  return [`DataPlus ${orderNumber}`, channelOrderNumber && channelOrderNumber !== orderNumber ? `${String(match.channel || "Channel")} ${channelOrderNumber}` : ""].filter(Boolean).join(" · ")
}

function AuditCamera({ open, onOpenChange, onScan, onPhoto, pendingUploads }: { open: boolean; onOpenChange: (open: boolean) => void; onScan: (tracking: string) => Promise<ScanResponse>; onPhoto: (scan: AuditScan, photo: Omit<CapturedPhoto, "previewUrl">) => Promise<void>; pendingUploads: number }) {
  const [cameraState, setCameraState] = useState<"opening" | "ready" | "permission" | "error" | "unsupported">("opening")
  const [attempt, setAttempt] = useState(0)
  const [manualValue, setManualValue] = useState("")
  const [busy, setBusy] = useState(false)
  const [lastResult, setLastResult] = useState<ScanResponse | null>(null)
  const [mode, setMode] = useState<"scan" | "photo" | "preview">("scan")
  const [activeScan, setActiveScan] = useState<AuditScan | null>(null)
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null)
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [torchEnabled, setTorchEnabled] = useState(false)
  const [scannerEngine, setScannerEngine] = useState<"native" | "zxing">("zxing")
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<Awaited<ReturnType<typeof startFastBarcodeScanner>> | null>(null)
  const scanBusyRef = useRef(false)
  const lastScanRef = useRef({ value: "", at: 0 })
  const modeRef = useRef(mode)

  useEffect(() => { modeRef.current = mode }, [mode])
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
      if (!result.scan.evidenceCount) {
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
          const tracking = String(decoded || "").trim()
          const now = Date.now()
          if (modeRef.current !== "scan" || !tracking || scanBusyRef.current || canceled || (lastScanRef.current.value === tracking && now - lastScanRef.current.at < 2500)) return
          lastScanRef.current = { value: tracking, at: now }
          void submit(tracking)
        })
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
  }, [attempt, open, submit])

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
      setMode("scan")
      setLastResult(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to queue the package photo.")
    } finally { setBusy(false) }
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
      <DialogHeader className="shrink-0 border-b px-4 py-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><DialogTitle>{mode === "scan" ? "Scan outbound packages" : mode === "photo" ? "Photograph this package" : "Review package photo"}</DialogTitle><DialogDescription className="break-words">{mode === "scan" ? "Tracking is matched immediately, then the same camera captures the box evidence." : activeScan ? `${activeScan.trackingNumber} · ${scanOrderReference(activeScan)}` : "Capture the exterior shipping box."}</DialogDescription></div>{torchAvailable ? <Button size="icon" variant={torchEnabled ? "default" : "outline"} title={torchEnabled ? "Turn off camera light" : "Turn on camera light"} onClick={() => void toggleTorch()}><Flashlight className="size-4" /></Button> : null}</div>{mode === "scan" ? <form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); void submit(manualValue) }}><div className="relative min-w-0 flex-1"><Keyboard className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9 font-mono" value={manualValue} onChange={(event) => setManualValue(event.target.value)} placeholder="Scan or enter tracking number" autoComplete="off" /></div><Button type="submit" variant="secondary" disabled={busy || !manualValue.trim()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Record</Button></form> : null}</DialogHeader>
      <div className="relative min-h-0 flex-1 bg-black"><video ref={videoRef} className="size-full object-contain" autoPlay muted playsInline />
        {cameraState !== "ready" && <div className="absolute inset-0 grid place-items-center bg-black/85 p-6 text-center text-white"><div className="max-w-sm"><p className="font-medium">{cameraState === "opening" ? "Starting camera..." : cameraState === "permission" ? "Camera permission is needed" : cameraState === "unsupported" ? "Camera scanning is not supported here" : "Camera could not start"}</p><p className="mt-2 text-sm text-white/70">Use the manual field or a Bluetooth scanner if camera access is unavailable.</p>{cameraState === "permission" || cameraState === "error" ? <Button className="mt-4" variant="secondary" onClick={() => setAttempt((value) => value + 1)}>Try camera again</Button> : null}</div></div>}
        {cameraState === "ready" && mode === "scan" ? <div className="pointer-events-none absolute inset-x-[7%] top-1/2 -translate-y-1/2"><div className="h-28 rounded-md border-2 border-emerald-400/90 shadow-[0_0_18px_rgba(74,222,128,.55)]"><div className="mt-14 h-0.5 bg-emerald-400" /></div><p className="mx-auto mt-3 w-fit rounded-full bg-black/75 px-3 py-1.5 text-xs font-medium text-white">Align one barcode inside the frame · {scannerEngine === "native" ? "Fast scan" : "Compatible scan"}</p></div> : null}
        {lastResult && mode === "scan" ? <div className={`absolute inset-x-3 top-3 flex items-start gap-3 rounded-md border p-3 text-white shadow-xl ${lastResult.duplicate ? "border-amber-300 bg-amber-700" : lastResult.scan.matchStatus === "unmatched" ? "border-amber-300 bg-amber-700" : "border-emerald-300 bg-emerald-700"}`}>{lastResult.duplicate || lastResult.scan.matchStatus === "unmatched" ? <AlertTriangle className="mt-0.5 size-5 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-5 shrink-0" />}<div className="min-w-0"><p className="font-medium">{lastResult.message}</p><p className="mt-1 truncate font-mono text-xs text-white/80">{lastResult.scan.trackingNumber}</p></div></div> : null}
        {mode === "photo" && cameraState === "ready" ? <div className="absolute inset-x-0 bottom-5 flex justify-center"><Button className="size-16 rounded-full border-4 border-white bg-white text-black shadow-2xl hover:bg-white" size="icon" title="Take package photo" disabled={busy} onClick={() => void capturePhoto()}>{busy ? <Loader2 className="size-6 animate-spin" /> : <Camera className="size-7" />}</Button></div> : null}
        {mode === "preview" && photo ? <div className="absolute inset-0 grid bg-black"><img src={photo.previewUrl} alt="Package evidence preview" className="size-full object-contain" /><div className="absolute inset-x-0 bottom-0 flex justify-center gap-3 bg-black/70 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><Button variant="secondary" disabled={busy} onClick={() => { clearPhoto(); setMode("photo") }}><RotateCcw className="size-4" /> Retake</Button><Button disabled={busy} onClick={() => void usePhoto()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />} Use photo</Button></div></div> : null}
        {busy ? <div className="absolute inset-0 grid place-items-center bg-black/40"><div className="flex items-center gap-2 rounded-md bg-background px-4 py-3 text-foreground shadow-xl"><Loader2 className="size-5 animate-spin" /> Recording package...</div></div> : null}
      </div>
      <DialogFooter className="shrink-0 border-t bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:justify-between"><p className="text-xs text-muted-foreground">{pendingUploads ? `${pendingUploads} photo upload${pendingUploads === 1 ? "" : "s"} continuing in the background.` : mode === "scan" ? "Camera stays open between packages for faster scanning." : "Include the label and the exterior condition of the box."}</p><Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

export function OutboundAuditWorkspace({ warehouses = [] }: { warehouses?: Row[] }) {
  const availableWarehouses = useMemo(() => physicalWarehouses(warehouses), [warehouses])
  const [audits, setAudits] = useState<AuditSession[]>([])
  const [selectedId, setSelectedId] = useState("")
  const [detail, setDetail] = useState<AuditDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [startOpen, setStartOpen] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [closeOpen, setCloseOpen] = useState(false)
  const [manualTracking, setManualTracking] = useState("")
  const [uploadStates, setUploadStates] = useState<Record<string, "uploading" | "failed">>({})
  const uploadingEvidenceRef = useRef(new Set<string>())
  const [startDraft, setStartDraft] = useState({ warehouseId: "", carrier: "any", notes: "" })
  const [closeDraft, setCloseDraft] = useState({ handoffMethod: "pickup", driverName: "", pickupConfirmation: "", notes: "", evidenceOverrideReason: "" })

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

  useEffect(() => { void loadAudits() }, [loadAudits])
  useEffect(() => { void loadDetail(selectedId) }, [loadDetail, selectedId])
  useEffect(() => { void retryPendingEvidence() }, [retryPendingEvidence])
  useEffect(() => { setCloseDraft(current => ({ ...current, evidenceOverrideReason: "" })) }, [selectedId])
  useEffect(() => {
    if (!startDraft.warehouseId && availableWarehouses[0]?.id) setStartDraft((current) => ({ ...current, warehouseId: String(availableWarehouses[0].id) }))
  }, [availableWarehouses, startDraft.warehouseId])

  async function startAudit() {
    const warehouse = availableWarehouses.find((row) => String(row.id) === startDraft.warehouseId)
    if (!warehouse) return toast.error("Choose a physical warehouse.")
    setBusy(true)
    try {
      const response = await api<{ audit: AuditSession; message?: string }>("/api/fulfillment/outbound-audits", { method: "POST", body: JSON.stringify({ warehouseId: warehouse.id, warehouseName: warehouse.name || warehouse.code, carrier: startDraft.carrier === "any" ? "" : startDraft.carrier, notes: startDraft.notes }) })
      toast.success(response.message || "Outbound audit started.")
      setStartOpen(false)
      setStartDraft((current) => ({ ...current, carrier: "any", notes: "" }))
      await loadAudits(response.audit.id)
      await loadDetail(response.audit.id)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to start the outbound audit.") }
    finally { setBusy(false) }
  }

  const recordScan = useCallback(async (trackingNumber: string) => {
    if (!detail?.session.id) throw new Error("Start or select an open outbound audit first.")
    const result = await api<ScanResponse>(`/api/fulfillment/outbound-audits/${encodeURIComponent(detail.session.id)}/scan`, { method: "POST", body: JSON.stringify({ trackingNumber, clientScanId: crypto.randomUUID() }) })
    setDetail((current) => current ? { session: result.session, scans: result.duplicate ? current.scans : [result.scan, ...current.scans] } : current)
    setAudits((current) => current.map((row) => row.id === result.session.id ? result.session : row))
    return result
  }, [detail?.session.id])

  async function submitManualScan() {
    const tracking = manualTracking.trim()
    if (!tracking) return
    setBusy(true)
    try {
      const result = await recordScan(tracking)
      if (result.scan.matchStatus === "unmatched" || result.duplicate) toast.warning(result.message || "Package recorded.")
      else toast.success(result.message || "Package recorded.")
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
  return <div className="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
    <Card className="h-fit"><CardHeader className="flex-row items-start justify-between gap-3"><div><CardTitle>Outbound audits</CardTitle><CardDescription>Physical package handoffs</CardDescription></div><Button size="icon" variant="outline" title="Refresh audits" onClick={() => void loadAudits()} disabled={loading}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}</Button></CardHeader><CardContent className="grid gap-2"><Button onClick={() => setStartOpen(true)}><ClipboardCheck className="size-4" /> Start audit</Button><div className="grid max-h-[28rem] gap-2 overflow-y-auto">{audits.map((audit) => <button type="button" key={audit.id} onClick={() => setSelectedId(audit.id)} className={`rounded-md border p-3 text-left transition-colors ${selectedId === audit.id ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}><div className="flex items-center justify-between gap-2"><span className="font-semibold">{audit.auditNumber}</span><Badge variant={audit.status === "open" ? "warning" : "success"}>{audit.status}</Badge></div><p className="mt-1 truncate text-xs text-muted-foreground">{audit.warehouseName} · {audit.carrier || "Any carrier"}</p><p className="mt-1 text-xs">{numberLabel(audit.packageCount)} packages · {numberLabel(audit.unmatchedCount)} unmatched</p></button>)}{!audits.length && !loading ? <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">No outbound audits yet.</p> : null}</div></CardContent></Card>
    <Card className="min-w-0"><CardHeader className="border-b"><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><div className="flex flex-wrap items-center gap-2"><CardTitle>{session?.auditNumber || "Outbound handoff audit"}</CardTitle>{session ? <Badge variant={open ? "warning" : "success"}>{session.status}</Badge> : null}</div><CardDescription>{session ? `${session.warehouseName} · ${session.carrier || "Any carrier"} · Started ${dateLabel(session.startedAt)}` : "Start an audit and scan every physical package before carrier handoff."}</CardDescription></div>{session ? <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" asChild><a href={`/api/fulfillment/outbound-audits/${encodeURIComponent(session.id)}/export.csv`}><FileDown className="size-4" /> CSV</a></Button><Button size="sm" variant="outline" asChild><a href={`/api/fulfillment/outbound-audits/${encodeURIComponent(session.id)}/print`} target="_blank" rel="noreferrer"><Printer className="size-4" /> Print record</a></Button>{open ? <Button size="sm" onClick={() => setScannerOpen(true)}><Camera className="size-4" /> Scan packages</Button> : null}</div> : null}</div></CardHeader>
      <CardContent className="grid gap-4 p-4">{session ? <>
        <div className="grid overflow-hidden rounded-md border grid-cols-2 lg:grid-cols-3">{[["Scanned", session.packageCount], ["Matched", session.matchedCount], ["No order match", session.unmatchedCount], ["Photos saved", session.evidenceCompleteCount], ["Photos missing", session.evidenceMissingCount], ["Multiple orders", session.multipleMatchCount]].map(([label, count], index) => <div key={String(label)} className={`border-b p-3 ${index % 2 === 0 ? "border-r lg:border-r" : ""} ${index % 3 !== 2 ? "lg:border-r" : "lg:border-r-0"} ${index >= 4 ? "border-b-0" : ""} ${index >= 3 ? "lg:border-b-0" : ""}`}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{numberLabel(Number(count))}</p></div>)}</div>
        {open ? <form className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3 sm:flex-row" onSubmit={(event) => { event.preventDefault(); void submitManualScan() }}><div className="relative min-w-0 flex-1"><Keyboard className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9 font-mono" value={manualTracking} onChange={(event) => setManualTracking(event.target.value)} placeholder="Scan with a hardware scanner or enter tracking" autoComplete="off" /></div><Button type="submit" variant="outline" disabled={busy || !manualTracking.trim()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <PackageCheck className="size-4" />} Record package</Button><Button type="button" onClick={() => setCloseOpen(true)} disabled={!session.packageCount}><Truck className="size-4" /> Close handoff</Button></form> : <div className="rounded-md border bg-emerald-500/5 p-3 text-sm"><div className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="size-4" /> Handoff closed {session.closedAt ? dateLabel(session.closedAt) : ""}</div><p className="mt-1 text-muted-foreground">Driver: {session.driverName || "Not recorded"} · Confirmation: {session.pickupConfirmation || "Not recorded"}</p></div>}
        {session.unmatchedCount > 0 ? <div className="flex flex-col gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" /><div><p className="text-sm font-medium">{numberLabel(session.unmatchedCount)} package{session.unmatchedCount === 1 ? "" : "s"} retained without an order match</p><p className="text-xs text-muted-foreground">These packages remain part of the handoff record. Recheck after channel tracking or missing orders import.</p></div></div><Button size="sm" variant="outline" disabled={busy} onClick={() => void reconcileUnmatched()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Recheck unmatched</Button></div> : null}
        {session.evidenceMissingCount > 0 || pendingUploadCount > 0 ? <div className="flex flex-col gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-2"><ImageIcon className="mt-0.5 size-4 shrink-0 text-amber-600" /><div><p className="text-sm font-medium">{pendingUploadCount ? `${pendingUploadCount} package photo upload${pendingUploadCount === 1 ? "" : "s"} pending` : `${session.evidenceMissingCount} package${session.evidenceMissingCount === 1 ? "" : "s"} still need a photo`}</p><p className="text-xs text-muted-foreground">Photos are compressed on the phone, queued locally, and uploaded without holding the image in server memory.</p></div></div>{pendingUploadCount ? <Button size="sm" variant="outline" onClick={() => void retryPendingEvidence()}><RefreshCw className="size-4" /> Retry uploads</Button> : null}</div> : null}
        <div className="grid gap-2 md:hidden">{detail.scans.map((scan) => <div key={scan.id} className="rounded-md border p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><TrackingReference scan={scan} compact /><p className="mt-1 text-xs text-muted-foreground">{scan.carrier || "Carrier unknown"} · {dateLabel(scan.scannedAt)}</p></div>{matchBadge(scan)}</div><div className="mt-3"><MatchedOrders scan={scan} compact /></div><div className="mt-3 flex items-center gap-2">{evidenceBadge(scan)}{scan.evidence[0]?.contentUrl ? <a href={scan.evidence[0].contentUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-primary hover:underline">View photo</a> : null}</div></div>)}</div>
        <div className="hidden overflow-x-auto rounded-md border md:block"><Table><TableHeader><TableRow><TableHead>Tracking</TableHead><TableHead>Carrier</TableHead><TableHead>Order</TableHead><TableHead>Match</TableHead><TableHead>Photo</TableHead><TableHead>Scanned</TableHead></TableRow></TableHeader><TableBody>{detail.scans.map((scan) => <TableRow key={scan.id}><TableCell><TrackingReference scan={scan} /></TableCell><TableCell>{scan.carrier || "Unknown"}</TableCell><TableCell><MatchedOrders scan={scan} /></TableCell><TableCell>{matchBadge(scan)}</TableCell><TableCell><div className="flex items-center gap-2">{evidenceBadge(scan)}{scan.evidence[0]?.contentUrl ? <a href={scan.evidence[0].contentUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-primary hover:underline">View</a> : null}</div></TableCell><TableCell><p className="whitespace-nowrap text-xs">{dateLabel(scan.scannedAt)}</p><p className="text-xs text-muted-foreground">{scan.scannedByName}</p></TableCell></TableRow>)}{!detail.scans.length ? <TableRow><TableCell colSpan={6} className="h-28 text-center text-muted-foreground">No packages scanned yet.</TableCell></TableRow> : null}</TableBody></Table></div>
      </> : <div className="grid min-h-72 place-items-center text-center"><div><ClipboardCheck className="mx-auto size-8 text-muted-foreground" /><p className="mt-3 font-medium">No outbound audit selected</p><p className="mt-1 text-sm text-muted-foreground">Start an audit for the next carrier pickup.</p><Button className="mt-4" onClick={() => setStartOpen(true)}>Start audit</Button></div></div>}</CardContent>
    </Card>
    <Dialog open={startOpen} onOpenChange={setStartOpen}><DialogContent><DialogHeader><DialogTitle>Start outbound audit</DialogTitle><DialogDescription>Create an independent physical handoff record. This does not change fulfillment or carrier status.</DialogDescription></DialogHeader><div className="grid gap-4"><div className="grid gap-2"><Label>Warehouse</Label><Select value={startDraft.warehouseId} onValueChange={(warehouseId) => setStartDraft((current) => ({ ...current, warehouseId }))}><SelectTrigger><SelectValue placeholder="Choose warehouse" /></SelectTrigger><SelectContent>{availableWarehouses.map((warehouse) => <SelectItem key={String(warehouse.id)} value={String(warehouse.id)}>{String(warehouse.name || warehouse.code || warehouse.id)}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-2"><Label>Expected carrier</Label><Select value={startDraft.carrier} onValueChange={(carrier) => setStartDraft((current) => ({ ...current, carrier }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="any">Any carrier</SelectItem>{carriers.map((carrier) => <SelectItem key={carrier} value={carrier}>{carrier}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">Any carrier is useful for mixed drop-offs. The detected carrier is saved on every package.</p></div><div className="grid gap-2"><Label>Notes</Label><Textarea value={startDraft.notes} onChange={(event) => setStartDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Pickup window, dock, route, or other context" /></div></div><DialogFooter><Button variant="outline" onClick={() => setStartOpen(false)}>Cancel</Button><Button disabled={busy || !startDraft.warehouseId} onClick={() => void startAudit()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <ClipboardCheck className="size-4" />} Start audit</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={closeOpen} onOpenChange={setCloseOpen}><DialogContent><DialogHeader><DialogTitle>Close outbound handoff</DialogTitle><DialogDescription>Closing freezes the package list as the warehouse&apos;s record of what was handed over. It does not mark packages carrier-accepted.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><div className="grid gap-2"><Label>Handoff method</Label><Select value={closeDraft.handoffMethod} onValueChange={(handoffMethod) => setCloseDraft((current) => ({ ...current, handoffMethod }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pickup">Carrier pickup</SelectItem><SelectItem value="dropoff">Carrier drop-off</SelectItem><SelectItem value="third_party">Third-party handoff</SelectItem></SelectContent></Select></div><div className="grid gap-2"><Label>Driver or receiving party</Label><Input value={closeDraft.driverName} onChange={(event) => setCloseDraft((current) => ({ ...current, driverName: event.target.value }))} placeholder="Optional name" /></div><div className="grid gap-2"><Label>Pickup confirmation</Label><Input value={closeDraft.pickupConfirmation} onChange={(event) => setCloseDraft((current) => ({ ...current, pickupConfirmation: event.target.value }))} placeholder="Optional confirmation or route" /></div><div className="grid gap-2 sm:col-span-2"><Label>Handoff notes</Label><Textarea value={closeDraft.notes} onChange={(event) => setCloseDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Exceptions, package count confirmation, or driver notes" /></div>{session?.evidenceMissingCount ? <div className="grid gap-2 sm:col-span-2"><Label>Supervisor photo override reason</Label><Textarea value={closeDraft.evidenceOverrideReason} onChange={(event) => setCloseDraft((current) => ({ ...current, evidenceOverrideReason: event.target.value }))} placeholder={`Required to close while ${session.evidenceMissingCount} package photo${session.evidenceMissingCount === 1 ? " is" : "s are"} missing`} /></div> : null}</div>{session?.unmatchedCount ? <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm"><strong>{numberLabel(session.unmatchedCount)} unmatched package{session.unmatchedCount === 1 ? "" : "s"}</strong> will remain in the closed record with their tracking numbers.</div> : null}{session?.evidenceMissingCount ? <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm"><strong>{numberLabel(session.evidenceMissingCount)} package photo{session.evidenceMissingCount === 1 ? " is" : "s are"} missing.</strong> Add the evidence or record a supervisor reason before closing.</div> : null}<DialogFooter><Button variant="outline" onClick={() => setCloseOpen(false)}>Keep scanning</Button><Button disabled={busy || !session?.packageCount || Boolean(session?.evidenceMissingCount && !closeDraft.evidenceOverrideReason.trim())} onClick={() => void closeAudit()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />} Close {numberLabel(session?.packageCount || 0)} package handoff</Button></DialogFooter></DialogContent></Dialog>
    <AuditCamera open={scannerOpen} onOpenChange={setScannerOpen} onScan={recordScan} onPhoto={queueEvidencePhoto} pendingUploads={pendingUploadCount} />
  </div>
}
