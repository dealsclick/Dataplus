import { type MouseEvent, useEffect, useRef, useState } from "react"
import { Flashlight, Loader2, RotateCcw, ScanBarcode, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { startFastBarcodeScanner } from "../lib/fast-barcode-scanner"

type CameraState = "opening" | "ready" | "permission" | "error" | "unsupported"

export function QuickFindBarcodeScanner({ onScan }: { onScan: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const [cameraAttempt, setCameraAttempt] = useState(0)
  const [cameraState, setCameraState] = useState<CameraState>("opening")
  const [scannerEngine, setScannerEngine] = useState<"native" | "zxing">("zxing")
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [torchEnabled, setTorchEnabled] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<Awaited<ReturnType<typeof startFastBarcodeScanner>> | null>(null)
  const acceptedRef = useRef(false)
  const onScanRef = useRef(onScan)

  useEffect(() => { onScanRef.current = onScan }, [onScan])

  useEffect(() => {
    if (!open) return
    let controls: Awaited<ReturnType<typeof startFastBarcodeScanner>> | null = null
    let cancelled = false
    let retryTimer: number | undefined
    acceptedRef.current = false

    const start = async (attempt = 0) => {
      if (cancelled || !open) return
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
          const barcode = String(decoded || "").trim()
          if (cancelled || acceptedRef.current || !barcode) return
          acceptedRef.current = true
          if (navigator.vibrate) navigator.vibrate(70)
          setOpen(false)
          onScanRef.current(barcode)
        })
        controlsRef.current = controls
        setScannerEngine(controls.engine)
        setTorchAvailable(controls.torchAvailable)
        setTorchEnabled(false)
        setCameraState("ready")
      } catch (error) {
        if (cancelled) return
        const name = error instanceof DOMException ? error.name : ""
        setCameraState(name === "NotAllowedError" || name === "SecurityError" ? "permission" : "error")
      }
    }

    void start()
    return () => {
      cancelled = true
      if (retryTimer) window.clearTimeout(retryTimer)
      controls?.stop()
      if (controlsRef.current === controls) controlsRef.current = null
      setTorchAvailable(false)
      setTorchEnabled(false)
    }
  }, [cameraAttempt, open])

  async function toggleTorch() {
    const controls = controlsRef.current
    if (!controls?.torchAvailable) return
    const next = !torchEnabled
    try {
      await controls.setTorch(next)
      setTorchEnabled(next)
    } catch {
      setTorchEnabled(false)
    }
  }

  function openScanner(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
    setCameraAttempt((current) => current + 1)
    setOpen(true)
  }

  const cameraMessage = cameraState === "opening"
    ? "Starting camera..."
    : cameraState === "permission"
      ? "Camera permission is needed"
      : cameraState === "unsupported"
        ? "Camera scanning is not supported here"
        : "Camera could not start"

  return <>
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="grid size-6 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Scan UPC" onClick={openScanner}>
          <ScanBarcode className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>Scan UPC</TooltipContent>
    </Tooltip>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="!inset-0 !flex !h-[100dvh] !max-w-none !translate-x-0 !translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 sm:!left-1/2 sm:!top-1/2 sm:!h-[min(82dvh,680px)] sm:!max-w-2xl sm:!-translate-x-1/2 sm:!-translate-y-1/2 sm:rounded-lg" showCloseButton={false}>
        <DialogHeader className="shrink-0 border-b px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div><DialogTitle>Scan product UPC</DialogTitle><DialogDescription>Point the camera at the product barcode. DataPlus will search the catalog as soon as it reads the code.</DialogDescription></div>
            <div className="flex shrink-0 items-center gap-1">
              {torchAvailable ? <Button type="button" size="icon" variant={torchEnabled ? "default" : "outline"} title={torchEnabled ? "Turn off camera light" : "Turn on camera light"} onClick={() => void toggleTorch()}><Flashlight className="size-4" /></Button> : null}
              <Button type="button" size="icon" variant="ghost" title="Close scanner" onClick={() => setOpen(false)}><X className="size-4" /></Button>
            </div>
          </div>
        </DialogHeader>
        <div className="relative min-h-72 flex-1 overflow-hidden bg-black">
          <video ref={videoRef} className="size-full object-contain" autoPlay muted playsInline />
          {cameraState !== "ready" ? <div className="absolute inset-0 grid place-items-center bg-black/85 p-6 text-center text-white"><div className="max-w-sm">{cameraState === "opening" ? <Loader2 className="mx-auto mb-3 size-6 animate-spin" /> : null}<p className="font-medium">{cameraMessage}</p><p className="mt-2 text-sm text-white/70">{cameraState === "permission" ? "Allow camera access for DataPlus in your browser settings, then try again." : "You can still enter or scan the UPC with a handheld scanner in the search field."}</p>{!(cameraState === "opening" || cameraState === "unsupported") ? <Button className="mt-4" variant="secondary" onClick={() => setCameraAttempt((current) => current + 1)}><RotateCcw className="size-4" /> Try again</Button> : null}</div></div> : null}
          {cameraState === "ready" ? <div className="pointer-events-none absolute inset-x-[8%] top-1/2 -translate-y-1/2" aria-hidden="true"><div className="h-28 rounded-md border-2 border-emerald-400/90 shadow-[0_0_18px_rgba(74,222,128,.55)]"><div className="mt-14 h-0.5 bg-emerald-400" /></div><p className="mx-auto mt-3 w-fit rounded-full bg-black/75 px-3 py-1.5 text-xs font-medium text-white">Align one UPC inside the frame · {scannerEngine === "native" ? "Fast scan" : "Compatible scan"}</p></div> : null}
        </div>
        <DialogFooter className="!m-0 shrink-0 rounded-none border-t bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3"><Button className="w-full sm:w-auto" variant="outline" onClick={() => setOpen(false)}>Cancel</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
