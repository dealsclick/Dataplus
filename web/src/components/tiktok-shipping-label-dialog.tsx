import { useEffect, useMemo, useState } from "react"
import { ExternalLink, Loader2, PackageCheck, Printer, RefreshCw, ShieldCheck, Truck } from "lucide-react"
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

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {}
}

function positiveInput(value: unknown) {
  const numeric = Number(value || 0)
  return Number.isFinite(numeric) && numeric > 0 ? String(numeric) : ""
}

function orderPackageDefaults(order: Json) {
  const saved = object(order.fulfillmentPackage || order.package || order.shippingPackage)
  return {
    weight: positiveInput(saved.weight || saved.weightLb || order.shippingWeight),
    length: positiveInput(saved.length || saved.lengthIn),
    width: positiveInput(saved.width || saved.widthIn),
    height: positiveInput(saved.height || saved.heightIn),
  }
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
  const [measurements, setMeasurements] = useState(() => orderPackageDefaults(order))
  const [services, setServices] = useState<Json[]>([])
  const [selectedServiceId, setSelectedServiceId] = useState("")
  const [preview, setPreview] = useState<Json | null>(null)
  const [createdPackageId, setCreatedPackageId] = useState("")
  const [document, setDocument] = useState<Json | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const packageIds = useMemo(() => [...new Set([
    ...(Array.isArray(detail?.packageIds) ? detail.packageIds : []),
    createdPackageId,
  ].map((value) => String(value || "").trim()).filter(Boolean))], [createdPackageId, detail?.packageIds])
  const selectedService = services.find((service) => String(service.id || "") === selectedServiceId)
  const measurementReady = [measurements.weight, measurements.length, measurements.width, measurements.height]
    .every((value) => Number(value) > 0)

  useEffect(() => {
    if (!open) return
    setMeasurements(orderPackageDefaults(order))
    setServices([])
    setSelectedServiceId("")
    setPreview(null)
    setCreatedPackageId("")
    setDocument(null)
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
            ship_type: "1",
            order_id: orderId,
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
      const response = await api<Json>(`/api/tiktok/fulfillment/packages/${encodeURIComponent(packageId)}/document?accountId=${encodeURIComponent(accountId)}`)
      setCreatedPackageId(packageId)
      setDocument(response.data || {})
      if (!response.data?.doc_url) setError("TikTok created the package, but the label document is not ready yet. Retry Get label in a moment.")
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
      toast.success("TikTok Shipping label purchased.")
      await retrieveDocument(packageId)
      await onUpdated?.()
    } catch (purchaseError) {
      setError(purchaseError instanceof Error ? purchaseError.message : "TikTok label purchase failed.")
    } finally {
      setBusy(false)
    }
  }

  const openLabel = () => {
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

        {packageIds.length ? <section className="grid gap-2 rounded-md border p-3">
          <div><p className="text-sm font-semibold">Existing TikTok package</p><p className="text-xs text-muted-foreground">This order already has a package. Retrieve its label without purchasing another one.</p></div>
          <div className="flex flex-wrap gap-2">{packageIds.map((packageId) => <Button key={packageId} variant="outline" disabled={busy} onClick={() => void retrieveDocument(packageId)}><RefreshCw className="size-4" /> Get label {packageId}</Button>)}</div>
        </section> : null}

        {detail.labelEligible && !packageIds.length ? <>
          <section className="grid gap-3 rounded-md border p-3">
            <div><p className="text-sm font-semibold">Package measurements</p><p className="text-xs text-muted-foreground">Enter the final packed carton. TikTok calculates eligible services and the estimated label price from these values.</p></div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="grid gap-1.5"><Label htmlFor="tiktok-weight">Weight (lb)</Label><Input id="tiktok-weight" inputMode="decimal" type="number" min="0.01" step="0.01" value={measurements.weight} onChange={(event) => setMeasurements((current) => ({ ...current, weight: event.target.value }))} /></div>
              <div className="grid gap-1.5"><Label htmlFor="tiktok-length">Length (in)</Label><Input id="tiktok-length" inputMode="decimal" type="number" min="0.01" step="0.01" value={measurements.length} onChange={(event) => setMeasurements((current) => ({ ...current, length: event.target.value }))} /></div>
              <div className="grid gap-1.5"><Label htmlFor="tiktok-width">Width (in)</Label><Input id="tiktok-width" inputMode="decimal" type="number" min="0.01" step="0.01" value={measurements.width} onChange={(event) => setMeasurements((current) => ({ ...current, width: event.target.value }))} /></div>
              <div className="grid gap-1.5"><Label htmlFor="tiktok-height">Height (in)</Label><Input id="tiktok-height" inputMode="decimal" type="number" min="0.01" step="0.01" value={measurements.height} onChange={(event) => setMeasurements((current) => ({ ...current, height: event.target.value }))} /></div>
            </div>
            <div className="flex justify-end"><Button variant="outline" disabled={busy || !measurementReady} onClick={() => void quote()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Get TikTok rates</Button></div>
          </section>

          {services.length ? <section className="grid gap-3 rounded-md border p-3">
            <div><p className="text-sm font-semibold">Eligible TikTok service</p><p className="text-xs text-muted-foreground">Service IDs are checked for this order and carton. They are never reused across orders.</p></div>
            <Select value={selectedServiceId} onValueChange={(value) => { setSelectedServiceId(value); setPreview(null) }}><SelectTrigger><SelectValue placeholder="Choose a TikTok service" /></SelectTrigger><SelectContent>{services.map((service) => <SelectItem key={String(service.id)} value={String(service.id)}>{String(service.shipping_provider_name || service.name || "TikTok service")} · {String(service.name || "Service")} · {moneyLabel(Number(service.price || 0))} {String(service.currency || "USD")}</SelectItem>)}</SelectContent></Select>
            {selectedService ? <div className="flex flex-wrap items-center gap-2 text-sm"><Badge variant="outline">{String(selectedService.shipping_provider_name || "Carrier")}</Badge><span>{String(selectedService.name || "Service")}</span><span className="font-semibold">{moneyLabel(Number(selectedService.price || 0))} {String(selectedService.currency || "USD")}</span><span className="text-muted-foreground">{Number(selectedService.earliest_delivery_days || 0)}-{Number(selectedService.latest_delivery_days || 0)} days</span></div> : null}
            <div className="flex justify-end"><Button disabled={busy || !selectedServiceId} onClick={() => void reviewPurchase()}><ShieldCheck className="size-4" /> Review label purchase</Button></div>
          </section> : null}

          {preview ? <Alert className="border-blue-500/40 bg-blue-500/5"><ShieldCheck className="size-4" /><AlertTitle>Ready for final confirmation</AlertTitle><AlertDescription className="grid gap-3"><span>No package or label has been created yet. Confirm once to purchase the selected TikTok Shipping label.</span><Button className="w-fit" disabled={busy} onClick={() => void purchase()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <PackageCheck className="size-4" />} Purchase TikTok label</Button></AlertDescription></Alert> : null}
        </> : null}

        {!detail.labelEligible ? <Alert><Truck className="size-4" /><AlertTitle>TikTok does not provide this label</AlertTitle><AlertDescription>This order uses {String(detail.shippingType || "seller")} shipping. Use the universal carrier label action and send its tracking number back to TikTok.</AlertDescription></Alert> : null}

        {document?.doc_url ? <Alert className="border-emerald-500/40 bg-emerald-500/5"><Printer className="size-4" /><AlertTitle>Label ready</AlertTitle><AlertDescription className="grid gap-3"><span>{document.tracking_number ? `Tracking ${String(document.tracking_number)}. ` : ""}TikTok label links expire, so print or save it now.</span><Button className="w-fit" onClick={openLabel}><ExternalLink className="size-4" /> Open and print label</Button></AlertDescription></Alert> : null}
      </div> : null}

      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Close</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
