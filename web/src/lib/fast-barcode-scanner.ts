type ScannerControls = {
  stop: () => void
  torchAvailable: boolean
  setTorch: (enabled: boolean) => Promise<void>
  engine: "native" | "zxing"
}

type BarcodeScanType = "general" | "tracking"
type NativeBarcode = { rawValue?: string; format?: string }
type NativeDetector = { detect: (source: CanvasImageSource) => Promise<NativeBarcode[]> }
type NativeDetectorConstructor = {
  new (options?: { formats?: string[] }): NativeDetector
  getSupportedFormats?: () => Promise<string[]>
}

const nativeFormats = ["code_128", "code_39", "codabar", "itf", "ean_13", "ean_8", "upc_a", "upc_e", "data_matrix", "qr_code", "pdf417"]

function compactBarcodeValue(value: string) {
  return String(value || "").trim().replace(/^\][A-Z0-9]{2}/i, "").replace(/[^a-z0-9]/gi, "").toUpperCase()
}

export function trackingBarcodeConfidence(value: string, format = "") {
  const compact = compactBarcodeValue(value)
  const normalizedFormat = String(format || "").toLowerCase()
  if (!compact) return 0
  if (/^(?:1Z[A-Z0-9]{16}|TB[AMCD]\d{8,}|(?:GM|JVGL|JJD|JD)[A-Z0-9]{8,}|(?:SPX|SPD)[A-Z0-9]{8,}|(?:GF\d{10,}|GOFO[A-Z0-9]{6,})|SWIFTX[A-Z0-9]{6,})$/.test(compact)) return 180
  if (/^420\d{5,9}\d{18,34}$/.test(compact)) return 170
  if (/^(?:86|96)\d{32}$/.test(compact)) return 165
  if (/^\d{12}$/.test(compact) || /^\d{15}$/.test(compact)) return 155
  if (/^\d{20}$/.test(compact) || /^\d{22}$/.test(compact) || /^\d{26}$/.test(compact) || /^\d{30}$/.test(compact) || /^\d{34}$/.test(compact)) return 145
  // Pure 18-digit values on marketplace return labels are commonly RMA/SSCC
  // references. Keep them usable, but wait for a carrier barcode first.
  if (/^\d{18}$/.test(compact)) return 25
  if (normalizedFormat.includes("pdf") || normalizedFormat.includes("data_matrix") || normalizedFormat.includes("qr")) return 35
  return /\d/.test(compact) ? 65 : 30
}

function cameraCapabilities(track: MediaStreamTrack) {
  return typeof track.getCapabilities === "function" ? track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean } : {}
}

async function applyCameraDefaults(track: MediaStreamTrack) {
  const capabilities = cameraCapabilities(track) as Record<string, unknown>
  const advanced: Record<string, unknown>[] = []
  if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes("continuous")) advanced.push({ focusMode: "continuous" })
  if (Array.isArray(capabilities.exposureMode) && capabilities.exposureMode.includes("continuous")) advanced.push({ exposureMode: "continuous" })
  if (advanced.length) await track.applyConstraints({ advanced } as unknown as MediaTrackConstraints).catch(() => {})
}

export async function startFastBarcodeScanner(video: HTMLVideoElement, onDecode: (value: string) => void, options: { deviceId?: string; scanType?: BarcodeScanType } = {}): Promise<ScannerControls> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : { facingMode: { ideal: "environment" } }),
      width: { ideal: 1280, max: 1920 },
      height: { ideal: 720, max: 1080 },
      frameRate: { ideal: 30, max: 30 },
    },
  })
  const track = stream.getVideoTracks()[0]
  if (!track) throw new Error("No camera video track is available.")
  video.srcObject = stream
  await video.play()
  await applyCameraDefaults(track)

  let stopped = false
  let timer = 0
  let fallbackControls: { stop: () => void } | null = null
  let candidate = ""
  let candidateCount = 0
  const considerDecoded = (value: string, format: string, engine: "native" | "zxing") => {
    const decoded = String(value || "").trim()
    if (!decoded || stopped) return
    const confidence = options.scanType === "tracking" ? trackingBarcodeConfidence(decoded, format) : 100
    const requiredReads = options.scanType === "tracking"
      ? confidence >= 100 ? (engine === "native" ? 2 : 1) : (engine === "native" ? 7 : 3)
      : engine === "native" ? 2 : 1
    candidateCount = candidate === decoded ? candidateCount + 1 : 1
    candidate = decoded
    if (candidateCount < requiredReads) return
    candidate = ""
    candidateCount = 0
    onDecode(decoded)
  }
  const capabilities = cameraCapabilities(track)
  const setTorch = async (enabled: boolean) => {
    if (!capabilities.torch) return
    await track.applyConstraints({ advanced: [{ torch: enabled }] } as unknown as MediaTrackConstraints)
  }
  const stop = () => {
    stopped = true
    if (timer) window.clearTimeout(timer)
    fallbackControls?.stop()
    for (const streamTrack of stream.getTracks()) streamTrack.stop()
    if (video.srcObject === stream) video.srcObject = null
  }

  const startZxing = async () => {
    if (stopped) return
    const { BarcodeFormat, BrowserMultiFormatReader } = await import("@zxing/browser")
    const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 55, delayBetweenScanSuccess: 350 })
    reader.possibleFormats = [
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.CODABAR,
      BarcodeFormat.ITF,
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.DATA_MATRIX,
      BarcodeFormat.QR_CODE,
      BarcodeFormat.PDF_417,
    ]
    fallbackControls = await reader.decodeFromStream(stream, video, (result) => {
      const value = String(result?.getText() || "").trim()
      const formatValue = result?.getBarcodeFormat()
      const format = formatValue == null ? "" : String(BarcodeFormat[formatValue] || formatValue)
      if (!stopped && value) considerDecoded(value, format, "zxing")
    })
  }

  const Detector = (globalThis as typeof globalThis & { BarcodeDetector?: NativeDetectorConstructor }).BarcodeDetector
  if (!Detector) {
    await startZxing()
    return { stop, torchAvailable: Boolean(capabilities.torch), setTorch, engine: "zxing" }
  }

  const supported = Detector.getSupportedFormats ? await Detector.getSupportedFormats().catch(() => []) : nativeFormats
  const formats = nativeFormats.filter(format => supported.includes(format))
  if (!formats.length) {
    await startZxing()
    return { stop, torchAvailable: Boolean(capabilities.torch), setTorch, engine: "zxing" }
  }

  const detector = new Detector({ formats })
  const canvas = document.createElement("canvas")
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true })
  if (!context) {
    await startZxing()
    return { stop, torchAvailable: Boolean(capabilities.torch), setTorch, engine: "zxing" }
  }
  let running = false
  let failures = 0
  const detect = async () => {
    if (stopped || running) return
    running = true
    try {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight) {
        const sourceWidth = Math.round(video.videoWidth * 0.94)
        const sourceHeight = Math.round(video.videoHeight * 0.58)
        const sourceX = Math.round((video.videoWidth - sourceWidth) / 2)
        const sourceY = Math.round((video.videoHeight - sourceHeight) / 2)
        const scale = Math.min(1, 960 / sourceWidth)
        canvas.width = Math.max(1, Math.round(sourceWidth * scale))
        canvas.height = Math.max(1, Math.round(sourceHeight * scale))
        context.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height)
        const found = await detector.detect(canvas)
        const ranked = found
          .map((barcode, index) => ({ barcode, index, score: options.scanType === "tracking" ? trackingBarcodeConfidence(String(barcode.rawValue || ""), barcode.format) : -index }))
          .sort((left, right) => right.score - left.score || left.index - right.index)
        const selected = ranked[0]?.barcode
        const value = String(selected?.rawValue || "").trim()
        if (value) {
          considerDecoded(value, String(selected?.format || ""), "native")
        } else {
          candidate = ""
          candidateCount = 0
        }
      }
      failures = 0
    } catch {
      failures += 1
      if (failures >= 4 && !fallbackControls) await startZxing().catch(() => {})
    } finally {
      running = false
      if (!stopped && !fallbackControls) timer = window.setTimeout(() => void detect(), 75)
    }
  }
  void detect()
  return { stop, torchAvailable: Boolean(capabilities.torch), setTorch, engine: "native" }
}

function canvasJpeg(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Unable to encode the package photo.")), "image/jpeg", quality))
}

async function photoSource(video: HTMLVideoElement): Promise<ImageBitmap> {
  const track = (video.srcObject as MediaStream | null)?.getVideoTracks()[0]
  const ImageCaptureConstructor = (globalThis as typeof globalThis & { ImageCapture?: new (track: MediaStreamTrack) => { takePhoto: () => Promise<Blob> } }).ImageCapture
  if (track && ImageCaptureConstructor) {
    try {
      return await createImageBitmap(await new ImageCaptureConstructor(track).takePhoto())
    } catch {
      // Some mobile browsers expose ImageCapture but reject still capture. The live frame remains available.
    }
  }
  const frame = document.createElement("canvas")
  frame.width = video.videoWidth
  frame.height = video.videoHeight
  const context = frame.getContext("2d", { alpha: false })
  if (!context || !frame.width || !frame.height) throw new Error("The camera is not ready for a package photo.")
  context.drawImage(video, 0, 0)
  return createImageBitmap(frame)
}

export async function captureCompressedEvidence(video: HTMLVideoElement) {
  const image = await photoSource(video)
  try {
    const maxEdge = 2560
    const scale = Math.min(1, maxEdge / Math.max(image.width, image.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    const context = canvas.getContext("2d", { alpha: false })
    if (!context) throw new Error("Unable to prepare the package photo.")
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    let quality = 0.82
    let blob = await canvasJpeg(canvas, quality)
    while (blob.size > 1_500_000 && quality > 0.5) {
      quality -= 0.08
      blob = await canvasJpeg(canvas, quality)
    }
    if (blob.size > 1_500_000) throw new Error("The photo is still too large. Move closer to the package and try again.")
    return { blob, width: canvas.width, height: canvas.height }
  } finally {
    image.close()
  }
}

export async function compressEvidenceImage(file: File, options: { maxBytes?: number; maxEdge?: number; quality?: number; minQuality?: number } = {}) {
  const image = await createImageBitmap(file)
  try {
    const maxBytes = options.maxBytes ?? 1_500_000
    const maxEdge = options.maxEdge ?? 2560
    const startingQuality = options.quality ?? 0.82
    const minQuality = options.minQuality ?? 0.46
    let scale = Math.min(1, maxEdge / Math.max(image.width, image.height))
    const canvas = document.createElement("canvas")
    const context = canvas.getContext("2d", { alpha: false })
    if (!context) throw new Error("Unable to prepare the receiving document.")
    let blob: Blob | null = null
    for (let attempt = 0; attempt < 6; attempt += 1) {
      canvas.width = Math.max(1, Math.round(image.width * scale))
      canvas.height = Math.max(1, Math.round(image.height * scale))
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      let quality = startingQuality
      blob = await canvasJpeg(canvas, quality)
      while (blob.size > maxBytes && quality > minQuality) {
        quality = Math.max(minQuality, quality - 0.08)
        blob = await canvasJpeg(canvas, quality)
      }
      if (blob.size <= maxBytes) break
      const sizeScale = Math.sqrt(maxBytes / blob.size) * 0.9
      scale *= Math.max(0.5, Math.min(0.82, sizeScale))
    }
    if (!blob || blob.size > maxBytes) throw new Error("The photo is still too large. Move closer to the document and try again.")
    const stem = file.name.replace(/\.[^.]+$/, "") || "packing-slip"
    return new File([blob], `${stem}.jpg`, { type: "image/jpeg", lastModified: Date.now() })
  } finally {
    image.close()
  }
}
