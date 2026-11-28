import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, CheckCircle2, Keyboard, Loader2, Monitor, Plus, RefreshCw, Settings2, Trash2, VideoOff, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { captureCompressedEvidence } from "@/lib/fast-barcode-scanner"

const STORAGE_KEY = "dataplus.outbound.packing-stations.v1"
const MAX_STATIONS = 4

type PackingStation = {
  id: string
  name: string
  scannerPrefix: string
  cameraId: string
  captureDelayMs: number
  autoPhoto: boolean
  enabled: boolean
}

type PackingScan = {
  id: string
  trackingRaw: string
  trackingNumber: string
  carrier: string
  matchStatus: "pending" | "matched" | "multiple" | "unmatched"
  evidenceStatus: "missing" | "uploading" | "complete" | "failed"
  evidenceCount: number
}

type PackingSession = {
  id: string
  auditNumber: string
  warehouseName: string
  packageCount: number
  pendingMatchCount: number
  carrierBreakdown: Array<{ carrier: string; count: number }>
}

type PackingScanResponse = {
  scan: PackingScan
  duplicate?: boolean
  message?: string
}

type StationResult = {
  kind: "idle" | "saving" | "success" | "duplicate" | "warning" | "error"
  title: string
  detail: string
  trackingNumber: string
  photoState: "none" | "queued" | "missing"
}

type CameraState = "off" | "opening" | "ready" | "error"

function defaultStations(): PackingStation[] {
  return [
    { id: crypto.randomUUID(), name: "Packing 1", scannerPrefix: "P1|", cameraId: "", captureDelayMs: 700, autoPhoto: true, enabled: true },
    { id: crypto.randomUUID(), name: "Packing 2", scannerPrefix: "P2|", cameraId: "", captureDelayMs: 700, autoPhoto: true, enabled: true },
  ]
}

function loadStations() {
  if (typeof window === "undefined") return defaultStations()
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]")
    if (!Array.isArray(parsed) || !parsed.length) return defaultStations()
    return parsed.slice(0, MAX_STATIONS).map((row, index) => ({
      id: String(row.id || crypto.randomUUID()),
      name: String(row.name || `Packing ${index + 1}`).slice(0, 40),
      scannerPrefix: String(row.scannerPrefix || `P${index + 1}|`).slice(0, 20),
      cameraId: String(row.cameraId || ""),
      captureDelayMs: Math.max(0, Math.min(3000, Number(row.captureDelayMs ?? 700))),
      autoPhoto: row.autoPhoto !== false,
      enabled: row.enabled !== false,
    }))
  } catch {
    return defaultStations()
  }
}

function normalized(value = "") {
  return String(value).trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds))
}

function cameraLabel(device: MediaDeviceInfo, index: number) {
  return device.label || `Camera ${index + 1}`
}

function resultStyle(kind: StationResult["kind"]) {
  if (kind === "success") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
  if (kind === "duplicate" || kind === "warning") return "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200"
  if (kind === "error") return "border-destructive/40 bg-destructive/10 text-destructive"
  if (kind === "saving") return "border-blue-500/40 bg-blue-500/10 text-blue-800 dark:text-blue-200"
  return "border-border bg-muted/20 text-muted-foreground"
}

function StationCamera({ station, duplicateCamera, onVideo, onState }: {
  station: PackingStation
  duplicateCamera: boolean
  onVideo: (stationId: string, video: HTMLVideoElement | null) => void
  onState: (stationId: string, state: CameraState) => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const video = videoRef.current
    onVideo(station.id, video)
    if (!station.enabled || !station.cameraId || duplicateCamera || !video || !navigator.mediaDevices?.getUserMedia) {
      onState(station.id, "off")
      if (video) video.srcObject = null
      return () => onVideo(station.id, null)
    }
    let stopped = false
    let stream: MediaStream | null = null
    onState(station.id, "opening")
    void navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        deviceId: { exact: station.cameraId },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 15, max: 24 },
      },
    }).then((nextStream) => {
      if (stopped) {
        nextStream.getTracks().forEach((track) => track.stop())
        return
      }
      stream = nextStream
      video.srcObject = nextStream
      return video.play()
    }).then(() => {
      if (!stopped) onState(station.id, "ready")
    }).catch(() => {
      if (!stopped) onState(station.id, "error")
    })
    return () => {
      stopped = true
      stream?.getTracks().forEach((track) => track.stop())
      if (video.srcObject === stream) video.srcObject = null
      onVideo(station.id, null)
    }
  }, [duplicateCamera, onState, onVideo, station.cameraId, station.enabled, station.id])

  return <div className="relative aspect-video overflow-hidden rounded-md border bg-black">
    <video ref={videoRef} className="size-full object-cover" muted playsInline autoPlay />
    {!station.cameraId ? <div className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-white/70"><div><VideoOff className="mx-auto mb-2 size-6" />Select a camera for automatic photos.</div></div> : null}
    {duplicateCamera ? <div className="absolute inset-0 grid place-items-center bg-black/80 p-4 text-center text-sm text-amber-200"><div><AlertTriangle className="mx-auto mb-2 size-6" />This camera is assigned to another enabled station.</div></div> : null}
  </div>
}

export function OutboundPackingStations({ open, onOpenChange, session, scans, pendingUploads, onScan, onPhoto, isTrackingBarcode }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  session: PackingSession
  scans: PackingScan[]
  pendingUploads: number
  onScan: (trackingNumber: string, options: { deferOrderMatch: true; stationName: string }) => Promise<PackingScanResponse>
  onPhoto: (scan: PackingScan, photo: { blob: Blob; width: number; height: number }) => Promise<void>
  isTrackingBarcode: (value: string) => boolean
}) {
  const [stations, setStations] = useState<PackingStation[]>(loadStations)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [configuring, setConfiguring] = useState(false)
  const [cameraPermissionError, setCameraPermissionError] = useState("")
  const [cameraStates, setCameraStates] = useState<Record<string, CameraState>>({})
  const [results, setResults] = useState<Record<string, StationResult>>({})
  const [stationCounts, setStationCounts] = useState<Record<string, number>>({})
  const [manualValues, setManualValues] = useState<Record<string, string>>({})
  const videoElementsRef = useRef<Record<string, HTMLVideoElement | null>>({})
  const busyStationsRef = useRef(new Set<string>())
  const scanBufferRef = useRef({ value: "", startedAt: 0, lastAt: 0 })

  const enabledStations = useMemo(() => stations.filter((station) => station.enabled), [stations])
  const duplicateCameraIds = useMemo(() => {
    const counts = new Map<string, number>()
    enabledStations.forEach((station) => station.cameraId && counts.set(station.cameraId, (counts.get(station.cameraId) || 0) + 1))
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id))
  }, [enabledStations])
  const prefixIssues = useMemo(() => {
    const prefixes = enabledStations.map((station) => station.scannerPrefix.trim().toUpperCase())
    const overlaps = prefixes.some((prefix, index) => prefixes.some((other, otherIndex) => index !== otherIndex && prefix && other.startsWith(prefix)))
    return enabledStations.length > 1 && (prefixes.some((prefix) => !prefix) || new Set(prefixes).size !== prefixes.length || overlaps)
  }, [enabledStations])

  const refreshDevices = useCallback(async (requestPermission = false) => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setCameraPermissionError("This browser does not expose camera devices.")
      return
    }
    let permissionStream: MediaStream | null = null
    try {
      if (requestPermission) permissionStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true })
      const cameras = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "videoinput" && device.deviceId)
      setDevices(cameras)
      setCameraPermissionError("")
      setStations((current) => {
        const assigned = new Set(current.map((station) => station.cameraId).filter(Boolean))
        let changed = false
        const next = current.map((station) => {
          if (station.cameraId && cameras.some((camera) => camera.deviceId === station.cameraId)) return station
          const available = cameras.find((camera) => !assigned.has(camera.deviceId))
          if (!available) {
            if (station.cameraId) changed = true
            return station.cameraId ? { ...station, cameraId: "" } : station
          }
          assigned.add(available.deviceId)
          changed = true
          return { ...station, cameraId: available.deviceId }
        })
        return changed ? next : current
      })
    } catch (error) {
      setCameraPermissionError(error instanceof Error ? error.message : "Camera permission was not granted.")
    } finally {
      permissionStream?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void refreshDevices(false)
    const handler = () => void refreshDevices(false)
    navigator.mediaDevices?.addEventListener?.("devicechange", handler)
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", handler)
  }, [open, refreshDevices])

  useEffect(() => {
    if (!open) return
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stations))
  }, [open, stations])

  const updateStation = useCallback((stationId: string, patch: Partial<PackingStation>) => {
    setStations((current) => current.map((station) => station.id === stationId ? { ...station, ...patch } : station))
  }, [])

  const registerVideo = useCallback((stationId: string, video: HTMLVideoElement | null) => {
    videoElementsRef.current[stationId] = video
  }, [])

  const updateCameraState = useCallback((stationId: string, state: CameraState) => {
    setCameraStates((current) => current[stationId] === state ? current : { ...current, [stationId]: state })
  }, [])

  const processScan = useCallback(async (station: PackingStation, scannedValue: string) => {
    if (busyStationsRef.current.has(station.id)) {
      setResults((current) => ({ ...current, [station.id]: { kind: "warning", title: "Station busy", detail: "Wait for the current package photo, then scan again.", trackingNumber: scannedValue, photoState: "none" } }))
      return
    }
    const trackingNumber = scannedValue.trim()
    if (!isTrackingBarcode(trackingNumber)) {
      setResults((current) => ({ ...current, [station.id]: { kind: "error", title: "Not a shipping tracking barcode", detail: "The scan was ignored so a SKU, routing code, or label reference is not saved as a package.", trackingNumber, photoState: "none" } }))
      return
    }
    const trackingKey = normalized(trackingNumber)
    if (scans.some((scan) => normalized(scan.trackingNumber || scan.trackingRaw) === trackingKey)) {
      const existing = scans.find((scan) => normalized(scan.trackingNumber || scan.trackingRaw) === trackingKey)
      setResults((current) => ({ ...current, [station.id]: { kind: "duplicate", title: "Already scanned", detail: existing?.evidenceCount ? "This package and its photo are already in today's audit." : "This package is already in today's audit. Its photo is still missing.", trackingNumber: existing?.trackingNumber || trackingNumber, photoState: existing?.evidenceCount ? "queued" : "missing" } }))
      return
    }

    busyStationsRef.current.add(station.id)
    setResults((current) => ({ ...current, [station.id]: { kind: "saving", title: "Saving package", detail: "Carrier is detected now; order matching continues in the background.", trackingNumber, photoState: "none" } }))
    try {
      const response = await onScan(trackingNumber, { deferOrderMatch: true, stationName: station.name })
      if (response.duplicate) {
        setResults((current) => ({ ...current, [station.id]: { kind: "duplicate", title: "Already scanned", detail: response.scan.evidenceCount ? "This package and its photo are already in today's audit." : "This package is already in today's audit. Its photo is still missing.", trackingNumber: response.scan.trackingNumber, photoState: response.scan.evidenceCount ? "queued" : "missing" } }))
        return
      }

      setStationCounts((current) => ({ ...current, [station.id]: (current[station.id] || 0) + 1 }))
      let photoState: StationResult["photoState"] = "missing"
      let photoDetail = "Package saved. Photo missing."
      const video = videoElementsRef.current[station.id]
      if (station.autoPhoto && video && cameraStates[station.id] === "ready" && !duplicateCameraIds.has(station.cameraId)) {
        try {
          await wait(station.captureDelayMs)
          const captured = await captureCompressedEvidence(video)
          await onPhoto(response.scan, captured)
          photoState = "queued"
          photoDetail = "Package saved. Photo queued for background upload."
        } catch (error) {
          photoDetail = `Package saved. Photo is missing: ${error instanceof Error ? error.message : "camera capture failed"}`
        }
      } else if (!station.autoPhoto) {
        photoDetail = "Package saved. Automatic photo is off."
      } else if (!station.cameraId) {
        photoDetail = "Package saved. Select a camera to add automatic photos."
      } else {
        photoDetail = "Package saved. Camera was not ready, so the photo is missing."
      }
      setResults((current) => ({ ...current, [station.id]: { kind: "success", title: `${response.scan.carrier || "Package"} recorded`, detail: photoDetail, trackingNumber: response.scan.trackingNumber, photoState } }))
    } catch (error) {
      setResults((current) => ({ ...current, [station.id]: { kind: "error", title: "Package needs attention", detail: error instanceof Error ? error.message : "The package could not be saved.", trackingNumber, photoState: "missing" } }))
    } finally {
      busyStationsRef.current.delete(station.id)
    }
  }, [cameraStates, duplicateCameraIds, isTrackingBarcode, onPhoto, onScan, scans])

  const routeScan = useCallback((rawValue: string) => {
    const value = rawValue.trim()
    if (!value || !enabledStations.length) return
    if (prefixIssues) {
      setResults((current) => ({ ...current, [enabledStations[0].id]: { kind: "error", title: "Fix scanner prefixes", detail: "Every enabled station needs a unique prefix before multi-station scanning can start.", trackingNumber: value, photoState: "none" } }))
      return
    }
    const upper = value.toUpperCase()
    const station = enabledStations.find((candidate) => candidate.scannerPrefix && upper.startsWith(candidate.scannerPrefix.toUpperCase()))
      || (enabledStations.length === 1 ? enabledStations[0] : null)
    if (!station) {
      setResults((current) => ({ ...current, [enabledStations[0].id]: { kind: "error", title: "Unknown scanner prefix", detail: `Use ${enabledStations.map((candidate) => candidate.scannerPrefix).join(" or ")} so DataPlus knows which camera to use.`, trackingNumber: value, photoState: "none" } }))
      return
    }
    const trackingNumber = station.scannerPrefix && upper.startsWith(station.scannerPrefix.toUpperCase())
      ? value.slice(station.scannerPrefix.length).trim()
      : value
    void processScan(station, trackingNumber)
  }, [enabledStations, prefixIssues, processScan])

  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const now = performance.now()
      if (event.key === "Enter") {
        const buffered = scanBufferRef.current.value
        scanBufferRef.current = { value: "", startedAt: 0, lastAt: 0 }
        if (buffered.length >= 3) {
          event.preventDefault()
          routeScan(buffered)
        }
        return
      }
      if (event.key.length !== 1) return
      if (!scanBufferRef.current.value || now - scanBufferRef.current.lastAt > 180) {
        scanBufferRef.current = { value: event.key, startedAt: now, lastAt: now }
      } else {
        scanBufferRef.current.value += event.key
        scanBufferRef.current.lastAt = now
      }
      event.preventDefault()
    }
    window.addEventListener("keydown", handler, true)
    return () => window.removeEventListener("keydown", handler, true)
  }, [open, routeScan])

  function addStation() {
    if (stations.length >= MAX_STATIONS) return
    const number = stations.length + 1
    setStations((current) => [...current, { id: crypto.randomUUID(), name: `Packing ${number}`, scannerPrefix: `P${number}|`, cameraId: "", captureDelayMs: 700, autoPhoto: true, enabled: true }])
    setConfiguring(true)
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)]">
      <DialogHeader className="shrink-0 border-b px-4 py-3 pr-12 sm:px-6">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <DialogTitle className="flex items-center gap-2"><Monitor className="size-5" /> Packing stations · {session.auditNumber}</DialogTitle>
            <DialogDescription>{session.warehouseName} · scan label, capture photo, continue packing</DialogDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="secondary">{session.packageCount} packages</Badge>
            {session.carrierBreakdown.map((row) => <Badge key={row.carrier} variant="outline">{row.carrier} {row.count}</Badge>)}
            {session.pendingMatchCount ? <Badge variant="secondary"><Loader2 className="size-3 animate-spin" /> {session.pendingMatchCount} matching</Badge> : null}
            {pendingUploads ? <Badge variant="secondary"><Loader2 className="size-3 animate-spin" /> {pendingUploads} photo uploads</Badge> : null}
            <Button size="sm" variant={configuring ? "secondary" : "outline"} onClick={() => setConfiguring((value) => !value)}><Settings2 className="size-4" /> Configure</Button>
          </div>
        </div>
      </DialogHeader>

      <div className="min-h-0 flex-1 overflow-y-auto bg-muted/20 p-3 sm:p-4">
        {configuring ? <div className="mb-4 rounded-md border bg-card p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div><h3 className="font-semibold">Computer station setup</h3><p className="text-sm text-muted-foreground">Camera choices and scanner prefixes are saved only on this computer. Configure each USB scanner to type its prefix before the tracking number and Enter afterward.</p></div>
            <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void refreshDevices(true)}><RefreshCw className="size-4" /> Enable / refresh cameras</Button><Button size="sm" variant="outline" disabled={stations.length >= MAX_STATIONS} onClick={addStation}><Plus className="size-4" /> Add station</Button></div>
          </div>
          {cameraPermissionError ? <p className="mt-3 text-sm text-destructive">{cameraPermissionError}</p> : null}
          {prefixIssues ? <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">Every enabled station must have a unique scanner prefix.</p> : null}
        </div> : null}

        <div className="grid gap-4 xl:grid-cols-2">
          {stations.map((station) => {
            const result = results[station.id] || { kind: "idle", title: "Ready for package", detail: `Waiting for scanner ${station.scannerPrefix || "without a prefix"}`, trackingNumber: "", photoState: "none" }
            const duplicateCamera = Boolean(station.cameraId && duplicateCameraIds.has(station.cameraId))
            const cameraState = cameraStates[station.id] || "off"
            return <Card key={station.id} className={!station.enabled ? "opacity-60" : ""}>
              <CardHeader className="border-b p-4">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="flex min-w-0 items-center gap-2 text-base"><span className={`size-2.5 shrink-0 rounded-full ${cameraState === "ready" ? "bg-emerald-500" : cameraState === "opening" ? "animate-pulse bg-blue-500" : "bg-muted-foreground/50"}`} /><span className="truncate">{station.name}</span></CardTitle>
                  <div className="flex items-center gap-2"><Badge variant="outline">{stationCounts[station.id] || 0} this run</Badge><Badge variant="secondary" className="font-mono">{station.scannerPrefix || "No prefix"}</Badge></div>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 p-4">
                {configuring ? <div className="grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-2">
                  <div className="grid gap-1.5"><Label>Station name</Label><Input value={station.name} onChange={(event) => updateStation(station.id, { name: event.target.value })} /></div>
                  <div className="grid gap-1.5"><Label>Scanner prefix</Label><Input className="font-mono" value={station.scannerPrefix} onChange={(event) => updateStation(station.id, { scannerPrefix: event.target.value.toUpperCase() })} placeholder="P1|" /></div>
                  <div className="grid gap-1.5 sm:col-span-2"><Label>Default webcam</Label><Select value={station.cameraId || "none"} onValueChange={(cameraId) => updateStation(station.id, { cameraId: cameraId === "none" ? "" : cameraId })}><SelectTrigger><SelectValue placeholder="Choose camera" /></SelectTrigger><SelectContent><SelectItem value="none">No camera</SelectItem>{devices.map((device, index) => <SelectItem key={device.deviceId || index} value={device.deviceId}>{cameraLabel(device, index)}</SelectItem>)}</SelectContent></Select></div>
                  <div className="grid gap-1.5"><Label>Photo delay</Label><Select value={String(station.captureDelayMs)} onValueChange={(value) => updateStation(station.id, { captureDelayMs: Number(value) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0">Immediately</SelectItem><SelectItem value="350">0.35 seconds</SelectItem><SelectItem value="700">0.7 seconds</SelectItem><SelectItem value="1200">1.2 seconds</SelectItem><SelectItem value="2000">2 seconds</SelectItem></SelectContent></Select></div>
                  <div className="flex items-end justify-between gap-3 rounded-md border px-3 py-2"><div><Label>Automatic photo</Label><p className="text-xs text-muted-foreground">Capture after scan</p></div><Switch checked={station.autoPhoto} onCheckedChange={(autoPhoto) => updateStation(station.id, { autoPhoto })} /></div>
                  <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"><div><Label>Station enabled</Label><p className="text-xs text-muted-foreground">Accept scanner input</p></div><Switch checked={station.enabled} onCheckedChange={(enabled) => updateStation(station.id, { enabled })} /></div>
                  <Button variant="outline" className="text-destructive" disabled={stations.length === 1} onClick={() => setStations((current) => current.filter((candidate) => candidate.id !== station.id))}><Trash2 className="size-4" /> Remove station</Button>
                </div> : null}

                <StationCamera station={station} duplicateCamera={duplicateCamera} onVideo={registerVideo} onState={updateCameraState} />
                <div className={`rounded-md border p-3 ${resultStyle(result.kind)}`}>
                  <div className="flex items-start gap-2">
                    {result.kind === "saving" ? <Loader2 className="mt-0.5 size-5 shrink-0 animate-spin" /> : result.kind === "success" ? <CheckCircle2 className="mt-0.5 size-5 shrink-0" /> : result.kind === "duplicate" || result.kind === "warning" || result.kind === "error" ? <AlertTriangle className="mt-0.5 size-5 shrink-0" /> : <Keyboard className="mt-0.5 size-5 shrink-0" />}
                    <div className="min-w-0"><p className="font-medium">{result.title}</p><p className="mt-0.5 text-xs opacity-80">{result.detail}</p>{result.trackingNumber ? <p className="mt-1 break-all font-mono text-xs">{result.trackingNumber}</p> : null}</div>
                  </div>
                </div>
                <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); const value = manualValues[station.id] || ""; if (value.trim()) { void processScan(station, value); setManualValues((current) => ({ ...current, [station.id]: "" })) } }}>
                  <Input value={manualValues[station.id] || ""} onChange={(event) => setManualValues((current) => ({ ...current, [station.id]: event.target.value }))} placeholder="Type tracking for this station" className="font-mono" disabled={!station.enabled} />
                  <Button type="submit" variant="outline" disabled={!station.enabled || !manualValues[station.id]?.trim()}>Record</Button>
                </form>
              </CardContent>
            </Card>
          })}
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-2 border-t bg-background px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>Keep this window active. Each scanner must send its station prefix and finish with Enter/CR.</p>
        <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}><X className="size-4" /> Exit packing stations</Button>
      </div>
    </DialogContent>
  </Dialog>
}
