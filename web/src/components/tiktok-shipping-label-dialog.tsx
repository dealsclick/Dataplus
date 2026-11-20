import { useEffect, useMemo, useState } from "react"
import { ExternalLink, FileText, Loader2, PackageCheck, Printer, RefreshCw, ShieldCheck, Truck } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api, moneyLabel } from "../lib/client-api"

type Json = Record<string, any>

const TIKTOK_DEFAULT_PACKAGE = { weight: "3", length: "5", width: "5", height: "10" }
const TIKTOK_DOCUMENT_OPTIONS = [
  { value: "SHIPPING_LABEL_AND_PACKING_SLIP", label: "Shipping label + packing slip", description: "One PDF packet from TikTok" },
  { value: "SHIPPING_LABEL", label: "Shipping label", description: "Carrier label PDF only" },
  { value: "PACKING_SLIP", label: "Packing slip", description: "TikTok packing slip PDF only" },
  { value: "SHIPPING_LABEL_PICTURE", label: "Shipping label picture", description: "PNG label image" },
  { value: "HAZMAT_LABEL", label: "Hazmat label", description: "A4 PDF for hazardous items only" },
] as const

function tiktokDocumentLabel(value: string) {
  return TIKTOK_DOCUMENT_OPTIONS.find((option) => option.value === value)?.label || "TikTok package document"
}

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {}
}

function positiveInput(value: unknown) {
  const numeric = Number(value || 0)
  return Number.isFinite(numeric) && numeric > 0 ? String(numeric) : ""
}

function orderPackageDefaults(order: Json) {
  const saved = object(order.fulfillmentPackage || order.package || order.shippingPackage)
  const measurements = {
    weight: positiveInput(saved.weight || saved.weightLb || order.shippingWeight),
    length: positiveInput(saved.length || saved.lengthIn),
    width: positiveInput(saved.width || saved.widthIn),
    height: positiveInput(saved.height || saved.heightIn),
  }
  const complete = Object.values(measurements).every(Boolean)
  return {
    measurements: complete ? measurements : TIKTOK_DEFAULT_PACKAGE,
    source: complete ? "Saved final carton" : "Temporary default",
    saved: complete,
  }
}

function orderCatalogSkus(order: Json) {
  const rows = [order.lines, order.items, order.lineItems].find(Array.isArray) || []
  return [...new Set(rows.flatMap((line: Json) => {
    const identity = object(line.catalogIdentityMatch)
    return [identity.catalogSku, line.catalogSku, line.mappedFromSku, line.sku]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  }))]
}

function catalogPackageDefaults(product: Json) {
  const packageMeasurements = {
    weight: positiveInput(product.packageWeight || product.package_weight),
    length: positiveInput(product.packageLength || product.package_length),
    width: positiveInput(product.packageWidth || product.package_width),
    height: positiveInput(product.packageHeight || product.package_height),
  }
  if (Object.values(packageMeasurements).every(Boolean)) return packageMeasurements
  const itemMeasurements = {
    weight: positiveInput(product.itemWeight || product.item_weight || (Number(product.weightOz || 0) > 0 ? Number(product.weightOz) / 16 : 0)),
    length: positiveInput(product.itemLength || product.item_length || product.lengthIn),
    width: positiveInput(product.itemWidth || product.item_width || product.widthIn),
    height: positiveInput(product.itemHeight || product.item_height || product.heightIn),
  }
  return Object.values(itemMeasurements).every(Boolean) ? itemMeasurements : null
}

export function TikTokShippingLabelDialog({
  open,
  onOpenChange,
  order,
  onUpdated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  order: Json
  onUpdated?: () => void | Promise<void>
}) {
  const external = object(order.external)
  const accountId = String(order.channelAccountId || external.channelAccountId || "").trim()
  const accountName = String(order.channelAccountName || external.channelAccountName || "TikTok seller account").trim()
  const orderId = String(order.marketplaceOrderNumber || order.marketplaceOrderId || external.orderId || "").trim()
  const [detail, setDetail] = useState<Json | null>(null)
  const initialPackage = orderPackageDefaults(order)
  const [measurements, setMeasurements] = useState(() => initialPackage.measurements)
  const [measurementSource, setMeasurementSource] = useState(initialPackage.source)
  const [services, setServices] = useState<Json[]>([])
  const [selectedServiceId, setSelectedServiceId] = useState("")
  const [preview, setPreview] = useState<Json | null>(null)
  const [createdPackageId, setCreatedPackageId] = useState("")
  const [document, setDocument] = useState<Json | null>(null)
  const [documentType, setDocumentType] = useState("SHIPPING_LABEL_AND_PACKING_SLIP")
  const [documentSize, setDocumentSize] = useState("A6")
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const packageIds = useMemo(() => [...new Set([
    ...(Array.isArray(detail?.packageIds) ? detail.packageIds : []),
    createdPackageId,
  ].map((value) => String(value || "").trim()).filter(Boolean))], [createdPackageId, detail?.packageIds])
  const selectedService = services.find((service) => String(service.id || "") === selectedServiceId)
  const combinedOrderIds = useMemo<string[]>(() => [...new Set<string>(
    (Array.isArray(detail?.combinablePackage?.orderIds) ? detail.combinablePackage.orderIds : [])
      .map((value: unknown) => String(value || "").trim())
      .filter(Boolean)
  )], [detail?.combinablePackage?.orderIds])
  const isCombinedShipment = combinedOrderIds.length > 1
  const measurementReady = [measurements.weight, measurements.length, measurements.width, measurements.height]
    .every((value) => Number(value) > 0)

  useEffect(() => {
    if (!open) return
    const packageDefaults = orderPackageDefaults(order)
    setMeasurements(packageDefaults.measurements)
    setMeasurementSource(packageDefaults.source)
    setServices([])
    setSelectedServiceId("")
    setPreview(null)
    setCreatedPackageId("")
    setDocument(null)
    setDocumentType("SHIPPING_LABEL_AND_PACKING_SLIP")
    setDocumentSize("A6")
    setError("")
    if (!accountId || !orderId) {
      setDetail(null)
      setError("This order is missing its TikTok shop or TikTok order number. Refresh the order import before creating a label.")
      return
    }
    setLoading(true)
    void api<Json>(`/api/tiktok/fulfillment/orders/${encodeURIComponent(orderId)}?accountId=${encodeURIComponent(accountId)}`)
      .then(setDetail)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load current TikTok fulfillment details."))
      .finally(() => setLoading(false))

    if (!packageDefaults.saved) {
      let canceled = false
      const skus = orderCatalogSkus(order)
      void Promise.all(skus.map(async (sku) => {
        try {
          const response = await api<{ item?: Json }>(`/api/inventory/${encodeURIComponent(sku)}`)
          const measurements = catalogPackageDefaults(response.item || {})
          return measurements ? { sku, measurements } : null
        } catch {
          return null
        }
      })).then((matches) => {
        if (canceled) return
        const match = matches.find(Boolean)
        if (!match) return
        setMeasurements(match.measurements)
        setMeasurementSource(`Catalog SKU ${match.sku}`)
      })
      return () => { canceled = true }
    }
  }, [accountId, open, order, orderId])

  const packageInput = () => ({
    dimension: { length: measurements.length, width: measurements.width, height: measurements.height, unit: "INCH" },
    weight: { value: measurements.weight, unit: "POUND" },
  })

  const quote = async () => {
    if (!measurementReady || !detail) return
    setBusy(true)
    setError("")
    setPreview(null)
    try {
      const response = await api<Json>("/api/tiktok/fulfillment/services", {
        method: "POST",
        body: JSON.stringify({
          accountId,
          orderId,
          package: {
            ...packageInput(),
            order_line_item_ids: detail.lineItemIds || [],
            ...(detail.warehouseId ? { warehouse_id: detail.warehouseId } : {}),
          },
        }),
      })
      const options = Array.isArray(response.data?.shipping_services) ? response.data.shipping_services as Json[] : []
      setServices(options)
      const defaultService = options.find((service) => service.is_default === true) || options[0]
      setSelectedServiceId(String(defaultService?.id || ""))
      if (!options.length) setError("TikTok did not return an eligible shipping service for these package measurements.")
    } catch (quoteError) {
      setError(quoteError instanceof Error ? quoteError.message : "Unable to load TikTok shipping services.")
    } finally {
      setBusy(false)
    }
  }

  const reviewPurchase = async () => {
    if (!detail || !selectedServiceId) return
    setBusy(true)
    setError("")
    try {
      const response = await api<Json>("/api/tiktok/fulfillment/packages/preview", {
        method: "POST",
        body: JSON.stringify({
          accountId,
          package: {
            ship_type: isCombinedShipment ? "3" : "1",
            ...(isCombinedShipment ? { order_list_ids: combinedOrderIds } : { order_id: orderId }),
            shipping_service_id: selectedServiceId,
            ...packageInput(),
            ...(detail.warehouseId ? { warehouse_id: detail.warehouseId } : {}),
          },
        }),
      })
      setPreview(response)
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Unable to prepare the TikTok label purchase.")
    } finally {
      setBusy(false)
    }
  }

  const retrieveDocument = async (packageId: string) => {
    setBusy(true)
    setError("")
    try {
      const query = new URLSearchParams({ accountId, documentType, documentSize })
      const response = await api<Json>(`/api/tiktok/fulfillment/packages/${encodeURIComponent(packageId)}/document?${query}`)
      setCreatedPackageId(packageId)
      setDocument({ ...(response.data || {}), documentType: response.documentType || documentType, documentSize: response.documentSize || documentSize, documentFormat: response.documentFormat || "PDF" })
      if (!response.data?.doc_url) setError(`TikTok did not return the ${tiktokDocumentLabel(documentType).toLowerCase()} yet. Retry in a moment.`)
    } catch (documentError) {
      setError(documentError instanceof Error ? documentError.message : "Unable to retrieve the TikTok label document.")
    } finally {
      setBusy(false)
    }
  }

  const purchase = async () => {
    if (!preview?.token) return
    setBusy(true)
    setError("")
    try {
      const response = await api<Json>("/api/tiktok/fulfillment/packages/apply", {
        method: "POST",
        body: JSON.stringify({ token: preview.token }),
      })
      const packageId = String(response.data?.package_id || response.data?.id || "").trim()
      if (!packageId) throw new Error("TikTok accepted the label request but did not return a package ID. Reconcile the order in TikTok Shop before retrying.")
      setCreatedPackageId(packageId)
      setPreview(null)
      toast.success("TikTok Shipping label purchased. Preparing package documents.")
      await retrieveDocument(packageId)
      await onUpdated?.()
    } catch (purchaseError) {
      setError(purchaseError instanceof Error ? purchaseError.message : "TikTok label purchase failed.")
    } finally {
      setBusy(false)
    }
  }

  const openDocument = () => {
    const url = String(document?.doc_url || "")
    if (url) window.open(url, "_blank", "noopener,noreferrer")
  }

  return <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
    <DialogContent className="max-h-[95dvh] max-w-3xl overflow-y-auto sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><Truck className="size-5" /> TikTok Shipping label</DialogTitle>
        <DialogDescription>Order <span className="font-mono text-foreground">{orderId || "not available"}</span> from {accountName}. Rates and the label come directly from the connected TikTok shop.</DialogDescription>
      </DialogHeader>

      {loading ? <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading current TikTok order details</div> : null}
      {error ? <Alert variant="destructive"><AlertTitle>Action needed</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}

      {!loading && detail ? <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm">
          <Badge variant={detail.labelEligible ? "success" : "warning"}>{String(detail.shippingType || "Unknown")} shipping</Badge>
          <Badge variant="outline">{String(detail.status || "Unknown status").replaceAll("_", " ")}</Badge>
          <span className="text-muted-foreground">{String(detail.accountName || accountName)}</span>
        </div>

        {isCombinedShipment && !packageIds.length ? <Alert className="border-blue-500/40 bg-blue-500/5">
          <PackageCheck className="size-4" />
          <AlertTitle>Combined TikTok shipment</AlertTitle>
          <AlertDescription className="grid gap-2">
            <span>TikTok grouped {combinedOrderIds.length} orders for one carton, one label, and one tracking number. Arrange and purchase it once from any member order.</span>
            <div className="flex flex-wrap gap-1.5">{combinedOrderIds.map((memberOrderId) => <Badge key={memberOrderId} variant="outline" className="font-mono">{memberOrderId}</Badge>)}</div>
          </AlertDescription>
        </Alert> : null}

        {packageIds.length ? <section className="grid gap-2 rounded-md border p-3">
          <div><p className="text-sm font-semibold">TikTok package documents</p><p className="text-xs text-muted-foreground">This order already has a package. Download TikTok's label, packing slip, combined packet, picture label, or hazmat label without purchasing another shipment.</p></div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
            <div className="grid gap-1.5"><Label htmlFor="tiktok-document-type">Document</Label><Select value={documentType} onValueChange={(value) => { setDocumentType(value); setDocument(null) }}><SelectTrigger id="tiktok-document-type"><SelectValue /></SelectTrigger><SelectContent>{TIKTOK_DOCUMENT_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}><span className="flex flex-col"><span>{option.label}</span><span className="text-xs text-muted-foreground">{option.description}</span></span></SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-1.5"><Label htmlFor="tiktok-document-size">PDF size</Label><Select disabled={["SHIPPING_LABEL_PICTURE", "HAZMAT_LABEL"].includes(documentType)} value={documentSize} onValueChange={(value) => { setDocumentSize(value); setDocument(null) }}><SelectTrigger id="tiktok-document-size"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="A6">A6</SelectItem><SelectItem value="A5">A5</SelectItem></SelectContent></Select></div>
          </div>
          {documentType === "HAZMAT_LABEL" ? <Alert className="border-amber-500/40 bg-amber-500/5"><FileText className="size-4" /><AlertTitle>Hazardous items only</AlertTitle><AlertDescription>TikTok fixes this document at A4. Request it only when the package contains a TikTok-recognized hazardous item.</AlertDescription></Alert> : null}
          <div className="grid gap-2">{packageIds.map((packageId) => <div key={packageId} className="flex min-w-0 flex-col gap-2 rounded-md border bg-muted/20 p-2 sm:flex-row sm:items-center sm:justify-between"><span className="min-w-0 break-all font-mono text-xs text-muted-foreground">Package {packageId}</span><Button className="shrink-0" variant="outline" disabled={busy} onClick={() => void retrieveDocument(packageId)}>{busy ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />} Get document</Button></div>)}</div>
        </section> : null}

        {detail.labelEligible && !packageIds.length ? <>
          <section className="grid gap-3 rounded-md border p-3">
            <div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">Package measurements</p><Badge variant="outline">{measurementSource}</Badge></div><p className="text-xs text-muted-foreground">Catalog measurements are preferred when the order SKU is detected. Otherwise DataPlus starts with 3 lb and 5 × 5 × 10 in. Verify the final packed carton before requesting rates.</p></div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="grid gap-1.5"><Label htmlFor="tiktok-weight">Weight (lb)</Label><Input id="tiktok-weight" inputMode="decimal" type="number" min="0.01" step="0.01" value={measurements.weight} onChange={(event) => setMeasurements((current) => ({ ...current, weight: event.target.value }))} /></div>
              <div className="grid gap-1.5"><Label htmlFor="tiktok-length">Length (in)</Label><Input id="tiktok-length" inputMode="decimal" type="number" min="0.01" step="0.01" value={measurements.length} onChange={(event) => setMeasurements((current) => ({ ...current, length: event.target.value }))} /></div>
              <div className="grid gap-1.5"><Label htmlFor="tiktok-width">Width (in)</Label><Input id="tiktok-width" inputMode="decimal" type="number" min="0.01" step="0.01" value={measurements.width} onChange={(event) => setMeasurements((current) => ({ ...current, width: event.target.value }))} /></div>
              <div className="grid gap-1.5"><Label htmlFor="tiktok-height">Height (in)</Label><Input id="tiktok-height" inputMode="decimal" type="number" min="0.01" step="0.01" value={measurements.height} onChange={(event) => setMeasurements((current) => ({ ...current, height: event.target.value }))} /></div>
            </div>
            <div className="flex justify-end"><Button variant="outline" disabled={busy || !measurementReady} onClick={() => void quote()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Get TikTok rates</Button></div>
          </section>

          {services.length ? <section className="grid gap-3 rounded-md border p-3">
            <div><p className="text-sm font-semibold">Eligible TikTok service</p><p className="text-xs text-muted-foreground">{isCombinedShipment ? "This service applies to the single carton shared by every order shown above." : "Service IDs are checked for this order and carton. They are never reused across orders."}</p></div>
            <Select value={selectedServiceId} onValueChange={(value) => { setSelectedServiceId(value); setPreview(null) }}><SelectTrigger><SelectValue placeholder="Choose a TikTok service" /></SelectTrigger><SelectContent>{services.map((service) => <SelectItem key={String(service.id)} value={String(service.id)}>{String(service.shipping_provider_name || service.name || "TikTok service")} · {String(service.name || "Service")} · {moneyLabel(Number(service.price || 0))} {String(service.currency || "USD")}</SelectItem>)}</SelectContent></Select>
            {selectedService ? <div className="flex flex-wrap items-center gap-2 text-sm"><Badge variant="outline">{String(selectedService.shipping_provider_name || "Carrier")}</Badge><span>{String(selectedService.name || "Service")}</span><span className="font-semibold">{moneyLabel(Number(selectedService.price || 0))} {String(selectedService.currency || "USD")}</span><span className="text-muted-foreground">{Number(selectedService.earliest_delivery_days || 0)}-{Number(selectedService.latest_delivery_days || 0)} days</span></div> : null}
            <div className="flex justify-end"><Button disabled={busy || !selectedServiceId} onClick={() => void reviewPurchase()}><ShieldCheck className="size-4" /> {isCombinedShipment ? "Review combined label" : "Review label purchase"}</Button></div>
          </section> : null}

          {preview ? <Alert className="border-blue-500/40 bg-blue-500/5"><ShieldCheck className="size-4" /><AlertTitle>Ready for final confirmation</AlertTitle><AlertDescription className="grid gap-3"><span>{isCombinedShipment ? `Confirm once to arrange all ${combinedOrderIds.length} orders and purchase their one shared TikTok Shipping label.` : "No package or label has been created yet. Confirm once to purchase the selected TikTok Shipping label."}</span><Button className="w-fit" disabled={busy} onClick={() => void purchase()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <PackageCheck className="size-4" />} {isCombinedShipment ? "Arrange and purchase shared label" : "Purchase TikTok label"}</Button></AlertDescription></Alert> : null}
        </> : null}

        {!detail.labelEligible ? <Alert><Truck className="size-4" /><AlertTitle>TikTok does not provide this label</AlertTitle><AlertDescription>This order uses {String(detail.shippingType || "seller")} shipping. Use the universal carrier label action and send its tracking number back to TikTok.</AlertDescription></Alert> : null}

        {document?.doc_url ? <Alert className="border-emerald-500/40 bg-emerald-500/5"><Printer className="size-4" /><AlertTitle>{tiktokDocumentLabel(String(document.documentType || documentType))} ready</AlertTitle><AlertDescription className="grid gap-3"><span>{document.tracking_number ? `Tracking ${String(document.tracking_number)}. ` : ""}TikTok document links expire after 24 hours, so print or save this {String(document.documentFormat || "PDF")} now.</span><Button className="w-fit" onClick={openDocument}><ExternalLink className="size-4" /> Open and print document</Button></AlertDescription></Alert> : null}
      </div> : null}

      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Close</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
