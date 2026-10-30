import { useCallback, useEffect, useRef, useState } from "react"
import { Camera, CheckCircle2, ExternalLink, Flashlight, Keyboard, Loader2, PackageCheck, RotateCcw, Search, XCircle } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api, dateLabel } from "../lib/client-api"
import { startFastBarcodeScanner } from "../lib/fast-barcode-scanner"

type Row = Record<string, unknown>
type LookupResponse = {
  scannedValue?: string
  normalizedTracking?: string
  normalizedCandidates?: string[]
  orders?: Row[]
  returns?: Row[]
  total?: number
  ambiguous?: boolean
}

type TrackingCameraLookupProps = {
  scope?: "all" | "orders" | "returns"
  label?: string
  className?: string
  onReturnSelected?: (record: Row) => void
}

function value(row: Row, key: string) { return String(row[key] || "").trim() }

export function TrackingCameraLookup({ scope = "all", label = "Scan tracking", className, onReturnSelected }: TrackingCameraLookupProps) {
  const [open, setOpen] = useState(false)
  const [cameraAttempt, setCameraAttempt] = useState(0)
  const [cameraState, setCameraState] = useState<"opening" | "ready" | "permission" | "error" | "unsupported">("opening")
  const [cameraDevices, setCameraDevices] = useState<Array<{ id: string; label: string }>>([])
  const [selectedCameraId, setSelectedCameraId] = useState("")
  const [scannerEngine, setScannerEngine] = useState<"native" | "zxing">("zxing")
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [torchEnabled, setTorchEnabled] = useState(false)
  const [manualValue, setManualValue] = useState("")
  const [message, setMessage] = useState("Align the carrier tracking barcode with the guide.")
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<LookupResponse | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<Awaited<ReturnType<typeof startFastBarcodeScanner>> | null>(null)
  const scanBusyRef = useRef(false)
  const pausedRef = useRef(false)
  const lastScanRef = useRef({ value: "", at: 0 })

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const devices = (await navigator.mediaDevices.enumerateDevices())
      .filter((device) => device.kind === "videoinput")
      .map((device, index) => ({ id: device.deviceId, label: device.label || `Camera ${index + 1}` }))
    setCameraDevices(devices)
    if (!selectedCameraId) {
      const back = devices.find((device) => /back|rear|environment|world/i.test(device.label))
      if (back?.id) setSelectedCameraId(back.id)
    }
  }, [selectedCameraId])

  const lookup = useCallback(async (scanned: string) => {
    const tracking = scanned.trim()
    if (!tracking || scanBusyRef.current) return
    scanBusyRef.current = true
    setBusy(true)
    setResult(null)
    setMessage(`Looking up ${tracking}...`)
    try {
      const response = await api<LookupResponse>(`/api/orders/tracking-lookup?q=${encodeURIComponent(tracking)}&scope=${scope}`)
      setResult(response)
      setManualValue(String(response.normalizedTracking || tracking))
      pausedRef.current = true
      setMessage(Number(response.total || 0) ? `${Number(response.total || 0)} matching record${Number(response.total || 0) === 1 ? "" : "s"} found.` : "No order or return matches this tracking barcode.")
      if (navigator.vibrate) navigator.vibrate(Number(response.total || 0) ? 80 : [60, 50, 60])
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to look up this tracking barcode.")
      if (navigator.vibrate) navigator.vibrate([60, 50, 60])
    } finally {
      setBusy(false)
      scanBusyRef.current = false
    }
  }, [scope])

  useEffect(() => {
    if (!open || result) return
    let controls: Awaited<ReturnType<typeof startFastBarcodeScanner>> | null = null
    let canceled = false
    let retryTimer: number | undefined
    const start = async (attempt = 0) => {
      if (canceled || !open) return
      const video = videoRef.current
      if (!video) {
        if (attempt < 8) retryTimer = window.setTimeout(() => void start(attempt + 1), 40)
        return
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraState("unsupported")
        return
      }
      try {
        setCameraState("opening")
        controls = await startFastBarcodeScanner(video, (decoded) => {
          const tracking = String(decoded || "").trim()
          const now = Date.now()
          if (canceled || pausedRef.current || scanBusyRef.current || !tracking || (lastScanRef.current.value === tracking && now - lastScanRef.current.at < 1800)) return
          lastScanRef.current = { value: tracking, at: now }
          void lookup(tracking)
        }, { deviceId: selectedCameraId || undefined, scanType: "tracking" })
        controlsRef.current = controls
        setScannerEngine(controls.engine)
        setTorchAvailable(controls.torchAvailable)
        setTorchEnabled(false)
        await refreshDevices()
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
      controls?.stop()
      if (controlsRef.current === controls) controlsRef.current = null
      setTorchAvailable(false)
      setTorchEnabled(false)
    }
  }, [cameraAttempt, lookup, open, refreshDevices, result, selectedCameraId])

  async function toggleTorch() {
    const controls = controlsRef.current
    if (!controls?.torchAvailable) return
    const next = !torchEnabled
    try {
      await controls.setTorch(next)
      setTorchEnabled(next)
    } catch {
      setMessage("The camera light could not be changed on this device.")
    }
  }

  function resetScanner() {
    pausedRef.current = false
    lastScanRef.current = { value: "", at: 0 }
    setResult(null)
    setManualValue("")
    setMessage("Align the carrier tracking barcode with the guide.")
    setCameraAttempt((current) => current + 1)
  }

  function closeScanner() {
    setOpen(false)
    resetScanner()
  }

  const orders = result?.orders || []
  const returns = result?.returns || []
  return <>
    <Button type="button" size="sm" variant="outline" className={className} onClick={() => { resetScanner(); setOpen(true) }}><Camera className="size-4" /> {label}</Button>
    <Dialog open={open} onOpenChange={(next) => { if (!next) closeScanner() }}>
      <DialogContent className="!inset-0 !flex !h-[100dvh] !max-w-none !translate-x-0 !translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 sm:!left-1/2 sm:!top-1/2 sm:!h-[min(90dvh,760px)] sm:!max-w-3xl sm:!-translate-x-1/2 sm:!-translate-y-1/2 sm:rounded-lg" showCloseButton={false}>
        <DialogHeader className="shrink-0 border-b px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div><DialogTitle>Scan carrier tracking</DialogTitle><DialogDescription>Use the tracking barcode from UPS, USPS, FedEx, DHL, Amazon, or another carrier to find the order or return.</DialogDescription></div>
            {!result ? <div className="flex shrink-0 items-center gap-2">{torchAvailable ? <Button type="button" size="icon" variant={torchEnabled ? "default" : "outline"} title={torchEnabled ? "Turn off camera light" : "Turn on camera light"} onClick={() => void toggleTorch()}><Flashlight className="size-4" /></Button> : null}{cameraDevices.length > 1 ? <Select value={selectedCameraId} onValueChange={(id) => { setSelectedCameraId(id); setCameraAttempt((current) => current + 1) }}><SelectTrigger className="h-9 w-36"><SelectValue placeholder="Back camera" /></SelectTrigger><SelectContent>{cameraDevices.map((device) => <SelectItem key={device.id} value={device.id}>{device.label}</SelectItem>)}</SelectContent></Select> : null}</div> : null}
          </div>
          <form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); void lookup(manualValue) }}><div className="relative min-w-0 flex-1"><Keyboard className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9 font-mono" autoComplete="off" value={manualValue} onChange={(event) => setManualValue(event.target.value)} placeholder="Scan or enter tracking number" /></div><Button type="submit" variant="secondary" disabled={busy || !manualValue.trim()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Find</Button></form>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto bg-black">
          {!result ? <div className="relative h-full min-h-72">
            <video ref={videoRef} className="size-full object-contain" autoPlay muted playsInline />
            {cameraState !== "ready" && <div className="absolute inset-0 grid place-items-center bg-black/85 p-6 text-center text-white"><div className="max-w-sm"><p className="font-medium">{cameraState === "opening" ? "Starting camera..." : cameraState === "permission" ? "Camera permission is needed" : cameraState === "unsupported" ? "Camera scanning is not supported here" : "Camera could not start"}</p><p className="mt-2 text-sm text-white/70">{cameraState === "permission" ? "Allow camera access for DataPlus in your phone browser settings." : "You can still scan with a Bluetooth scanner or enter the tracking number above."}</p>{!(["opening", "unsupported"] as string[]).includes(cameraState) ? <Button className="mt-4" variant="secondary" onClick={() => setCameraAttempt((current) => current + 1)}>Try camera again</Button> : null}</div></div>}
            {cameraState === "ready" && !busy ? <div className="pointer-events-none absolute inset-x-[10%] top-1/2 -translate-y-1/2" aria-hidden="true"><div className="h-28 rounded-md border-2 border-emerald-400/90 shadow-[0_0_18px_rgba(74,222,128,.55)]"><div className="mt-14 h-0.5 bg-emerald-400" /></div><p className="mx-auto mt-3 w-fit rounded-full bg-black/75 px-3 py-1.5 text-xs font-medium text-white">Align one tracking barcode inside the frame · {scannerEngine === "native" ? "Fast scan" : "Compatible scan"}</p></div> : null}
            {busy ? <div className="absolute inset-x-4 top-4 flex items-center gap-3 rounded-md border border-sky-300 bg-sky-600 p-3 text-white shadow-xl"><Loader2 className="size-5 animate-spin" /><span className="truncate">{message}</span></div> : null}
          </div> : <div className="min-h-full bg-background p-4 text-foreground">
            <div className={`mb-4 flex items-start gap-3 rounded-md border p-3 ${Number(result.total || 0) ? "border-emerald-500/40 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5"}`}>{Number(result.total || 0) ? <CheckCircle2 className="mt-0.5 size-5 text-emerald-600" /> : <XCircle className="mt-0.5 size-5 text-destructive" />}<div className="min-w-0"><p className="font-medium">{message}</p><p className="mt-1 break-all font-mono text-xs text-muted-foreground">Tracking {result.normalizedTracking || result.scannedValue || manualValue}</p>{result.ambiguous ? <p className="mt-1 text-xs text-amber-600">More than one record uses this tracking reference. Choose the correct record.</p> : null}</div></div>
            {orders.length ? <section className="grid gap-2"><h3 className="text-sm font-semibold">Orders</h3>{orders.map((order) => <div key={value(order, "id")} className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold">Order {value(order, "orderNumber")}</span><Badge variant="outline">{value(order, "channel") || "Order"}</Badge><Badge variant="secondary">{value(order, "status") || "Unknown"}</Badge></div><p className="mt-1 truncate text-sm text-muted-foreground">{[value(order, "buyer"), value(order, "channelOrderNumber") && `Channel ${value(order, "channelOrderNumber")}`].filter(Boolean).join(" · ")}</p><p className="mt-1 break-all font-mono text-xs">{value(order, "carrier")} {value(order, "trackingNumber")}</p>{value(order, "orderDate") ? <p className="mt-1 text-xs text-muted-foreground">Ordered {dateLabel(value(order, "orderDate"))}</p> : null}</div><Button size="sm" asChild><a href={value(order, "href")}><ExternalLink className="size-4" /> Open order</a></Button></div>)}</section> : null}
            {returns.length ? <section className={`grid gap-2 ${orders.length ? "mt-5" : ""}`}><h3 className="text-sm font-semibold">Returns</h3>{returns.map((record) => <div key={value(record, "id")} className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{value(record, "returnNumber") || value(record, "channelReturnId") || "Return"}</span><Badge variant="outline">{value(record, "source") || "Return"}</Badge><Badge variant="secondary">{value(record, "receivingStatus") || value(record, "status") || "Not received"}</Badge></div><p className="mt-1 text-sm text-muted-foreground">Order {value(record, "orderNumber") || value(record, "channelOrderId") || "Unmatched"}</p></div>{onReturnSelected ? <Button size="sm" onClick={() => { closeScanner(); onReturnSelected(record) }}><PackageCheck className="size-4" /> Receive return</Button> : <Button size="sm" asChild><a href={value(record, "receivingHref") || value(record, "href")}><PackageCheck className="size-4" /> Receive return</a></Button>}</div>)}</section> : null}
          </div>}
        </div>
        <DialogFooter className="!m-0 shrink-0 !flex-col gap-2 rounded-none border-t bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:!flex-row sm:items-center sm:justify-between">{result ? <Button className="w-full sm:w-auto" onClick={resetScanner}><RotateCcw className="size-4" /> Scan another</Button> : <span className="w-full text-xs text-muted-foreground sm:min-w-0 sm:flex-1 sm:truncate">{message}</span>}<Button className="w-full sm:w-auto" variant="outline" onClick={closeScanner}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
