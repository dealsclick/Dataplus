import { useEffect, useRef, useState } from "react"
import { Camera, Clock3, ImagePlus, MapPin, Package, RefreshCw, RotateCcw, ScanLine, Trash2, UserRound } from "lucide-react"
import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import { Textarea } from "./ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { ReturnReceiptFields } from "./order-return-details"
import { TrackingCameraLookup } from "./tracking-camera-lookup"
import { compressEvidenceImage } from "../lib/fast-barcode-scanner"
import { loadAppReferences } from "../lib/app-state"

type Row = Record<string, unknown>
type Photo = { id: string; name: string; size: number; mimeType: string; dataUrl: string; stage: string }
const rows = (value: unknown): Row[] => Array.isArray(value) ? value : []
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}
const text = (...values: unknown[]) => values.map(value => String(value || "").trim()).find(Boolean) || ""
function customerDetails(record: Row) {
  const customer = object(record.customer)
  const address = object(record.shippingAddress || record.address || customer.address)
  return {
    name: text(record.customerName, record.buyer, customer.name),
    city: text(address.city, record.city),
    state: text(address.state, address.stateCode, record.state),
    postalCode: text(address.postalCode, address.zip, address.zipCode, record.postalCode, record.zip),
  }
}
function customerLocation(record: Row) {
  const customer = customerDetails(record)
  return [customer.city, [customer.state, customer.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ")
}
function dateLabel(value: unknown) {
  const date = new Date(text(value))
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}
function returnHref(record: Row) {
  const slug = text(record.returnSlug, record.returnNumber, record.id).toLowerCase()
  return `/returns/${encodeURIComponent(slug)}`
}
function returnItems(record: Row) {
  return rows(record.items).slice(0, 4).map((line) => ({
    sku: text(line.sku, line.upc, line.vendorSku),
    title: text(line.title, line.name),
    image: text(line.defaultImage, line.productImage, line.imageUrl, line.image, rows(line.images)[0]),
    qty: Number(line.qty || line.qtySelected || 0),
  }))
}
async function json(path: string, body?: unknown) {
  const response = await fetch(path, body ? { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined)
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || `Request failed: ${response.status}`)
  return result
}

export function ReturnReceiving({ warehouses, onUpdated }: { warehouses: Row[]; onUpdated: () => Promise<void> }) {
  const [query, setQuery] = useState(""), [matches, setMatches] = useState<Row[]>([]), [total, setTotal] = useState<number | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("")
  const [recentRecords, setRecentRecords] = useState<Row[]>([]), [recentLoading, setRecentLoading] = useState(true)
  const [record, setRecord] = useState<Row | null>(null), [draft, setDraft] = useState<Record<string, string>>({}), [photos, setPhotos] = useState<Photo[]>([])
  const [receivingWarehouses, setReceivingWarehouses] = useState<Row[]>(warehouses)
  const photoInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { setReceivingWarehouses(warehouses) }, [warehouses])
  useEffect(() => {
    let mounted = true
    void loadAppReferences(["warehouses"], true).then((state) => {
      if (mounted && Array.isArray(state.warehouses)) setReceivingWarehouses(state.warehouses as Row[])
    }).catch(() => undefined)
    return () => { mounted = false }
  }, [])
  async function loadRecent() {
    setRecentLoading(true)
    try {
      const result = await json("/api/returns/workspace?receivedOnly=1&page=1&pageSize=10")
      setRecentRecords(rows(result.returns))
    } catch { setRecentRecords([]) }
    finally { setRecentLoading(false) }
  }
  useEffect(() => { void loadRecent() }, [])
  async function lookup() {
    setBusy(true); setError(""); setMessage(""); setMatches([]); setTotal(null)
    try { const result = await json(`/api/returns/receiving-lookup?q=${encodeURIComponent(query.trim())}`); setMatches(result.returns || []); setTotal(result.total) }
    catch (e) { setError(e instanceof Error ? e.message : "Lookup failed") }
    finally { setBusy(false) }
  }
  function open(row: Row) {
    setRecord(row); setError(""); setPhotos([])
    const disposition = ["quarantine", "restock", "dispose", "return_to_vendor"].includes(String(row.disposition || "")) ? String(row.disposition) : "quarantine"
    setDraft({ warehouseId: String(row.warehouseId || ""), binLocation: String(row.binLocation || ""), condition: String(row.condition || "Unknown"), disposition, inspectionNotes: String(row.inspectionNotes || ""), ...Object.fromEntries(rows(row.items).map((line, index) => [`received-${index}`, String(Number(line.receivedQty || 0) || Number(line.qty || line.qtySelected || 0))])) })
  }
  async function addPhotos(files: FileList | null) {
    if (!files) return
    setBusy(true); setError("")
    try {
      if (files.length + photos.length > 3) throw new Error("Add up to 3 photos per receipt.")
      const next: Photo[] = []
      for (const file of Array.from(files)) {
        const compressed = await compressEvidenceImage(file, { maxBytes: 900_000, maxEdge: 1800, quality: 0.78 })
        const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Unable to read photo")); reader.readAsDataURL(compressed) })
        next.push({ id: crypto.randomUUID(), name: compressed.name, size: compressed.size, mimeType: compressed.type, dataUrl, stage: "received" })
      }
      setPhotos(current => [...current, ...next])
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to add photos") }
    finally { setBusy(false) }
  }
  async function save() {
    if (!record) return
    setBusy(true); setError("")
    try {
      const items = rows(record.items).map((line, index) => ({ ...line, receivedQty: Number(draft[`received-${index}`] || 0) }))
      if (!items.length || !items.some(line => line.receivedQty > 0)) throw new Error("Enter the quantities physically received.")
      if (draft.condition === "New" && draft.disposition === "restock" && photos.length < 1) throw new Error("Take one photo before receiving a New item for restock.")
      const result = await json(`/api/returns/${encodeURIComponent(String(record.id))}`, { ...draft, status: "received", inspectionStatus: "pending", receiptOnly: true, expectedUpdatedAt: String(record.updatedAt || ""), items, attachments: photos })
      const savedAttachments = rows(object(result.return).attachments)
      const savedPhotoIds = new Set(savedAttachments.map(file => String(file.id || "")))
      if (photos.some(photo => !savedPhotoIds.has(photo.id))) throw new Error("The receipt was recorded, but one or more photos were not returned as saved evidence. Reopen this return before continuing.")
      const savedEligibility = object(object(result.return).vendorReturnEligibility)
      const vendorReturnMessage = savedEligibility.qualifies === true ? " This order qualifies for vendor-return review; Purchasing must confirm the supplier RMA." : ""
      setRecord(null); setMatches([]); setTotal(null); setQuery(""); setMessage(`Receipt saved${photos.length ? ` with ${photos.length} photo${photos.length === 1 ? "" : "s"}` : ""}. It now appears in Recently received below. Stock remains unavailable until inspection and restock approval.${vendorReturnMessage}`)
      await onUpdated()
      await loadRecent()
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save receipt") }
    finally { setBusy(false) }
  }
  const selectedWarehouse = receivingWarehouses.find(row => String(row.id || "") === String(draft.warehouseId || ""))
  const activeBins = rows(selectedWarehouse?.bins).filter(bin => bin.active !== false && text(bin.code, bin.id))
  const binRequired = Boolean(selectedWarehouse?.requireBinValidation)
  const stockPhotoRequired = draft.condition === "New" && draft.disposition === "restock"
  const vendorReturnEligibility = object(record?.vendorReturnEligibility)
  const qualifiesForVendorReturn = vendorReturnEligibility.qualifies === true
  return <section aria-label="Return receiving" className="grid min-w-0 gap-3">
    <TrackingCameraLookup scope="all" label="Scan return tracking" className="h-12 w-full justify-center text-base sm:w-auto" onReturnSelected={open} />
    <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" onSubmit={event => { event.preventDefault(); if (!busy) void lookup() }}><Label className="grid min-w-0 gap-2">Search returns<Input value={query} maxLength={300} onChange={event => setQuery(event.target.value)} autoComplete="off" enterKeyHint="search" placeholder="Return, order, tracking, name, phone, ZIP, email, SKU or UPC" /></Label><Button className="h-10" disabled={busy || !query.trim()}><ScanLine className="size-4" />Find return</Button></form>
    {!record && error && <p role="alert" className="text-sm text-destructive">{error}</p>}{message && <p role="status" className="text-sm">{message}</p>}
    {total === 0 && <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No saved return matches this search.</p>}
    {total !== null && total >= 50 && <p className="text-sm text-muted-foreground">Showing the newest 50 matches. Add another customer, order, or item detail to narrow the search.</p>}
    <div className="grid gap-2">{matches.map(row => { const customer = customerDetails(row); const location = customerLocation(row); const items = returnItems(row); const returnNumber = text(row.returnNumber, row.id); const channelReturnNumber = text(row.channelReturnId, row.channelReturnReference); const orderNumber = text(row.orderNumber, row.orderId); const channelOrderNumber = text(row.channelOrderId, row.channelOrderNumber, row.marketplaceOrderId); const vendorEligibility = object(row.vendorReturnEligibility); return <article key={String(row.id)} className="grid gap-3 rounded-md border bg-card p-3 text-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{returnNumber || channelReturnNumber || "Return"}</p><Badge variant="outline">{String(row.source || row.channelSource || "Local")}</Badge><Badge variant={row.restockedAt ? "success" : "secondary"}>{row.restockedAt ? "Restocked" : String(row.receivingStatus || "Not received")}</Badge>{vendorEligibility.qualifies === true ? <Badge variant="success">Vendor return eligible</Badge> : null}</div></div><Button size="sm" disabled={busy || Boolean(row.restockedAt)} onClick={() => open(row)}>{row.restockedAt ? "Received" : "Receive"}</Button></div><dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs"><div><dt className="text-muted-foreground">DataPlus order</dt><dd className="truncate font-medium">{orderNumber || "Unmatched"}</dd></div><div><dt className="text-muted-foreground">Channel order</dt><dd className="truncate font-medium">{channelOrderNumber || "Not provided"}</dd></div>{channelReturnNumber && channelReturnNumber !== returnNumber ? <div className="col-span-2"><dt className="text-muted-foreground">Channel return</dt><dd className="truncate font-medium">{channelReturnNumber}</dd></div> : null}</dl>{customer.name && <p className="flex min-w-0 items-center gap-2"><UserRound className="size-4 shrink-0 text-muted-foreground" /><span className="truncate">{customer.name}</span></p>}{location && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><MapPin className="size-3.5" />{location}</p>}{items.length > 0 && <div className="grid gap-2 border-t pt-2">{items.map((item, index) => <div key={`${item.sku}-${index}`} className="flex min-w-0 items-center gap-2">{item.image ? <a href={item.image} target="_blank" rel="noopener noreferrer" className="shrink-0"><img src={item.image} alt={item.title || item.sku} className="size-12 rounded object-contain" /></a> : <span className="grid size-12 shrink-0 place-items-center rounded bg-muted"><Package className="size-5 text-muted-foreground" /></span>}<div className="min-w-0"><p className="truncate font-mono text-xs font-medium">{item.sku || "Unmatched item"}{item.qty > 1 ? ` × ${item.qty}` : ""}</p>{item.title ? <p className="truncate text-xs text-muted-foreground">{item.title}</p> : null}</div></div>)}</div>}</article> })}</div>
    <section aria-label="Recently received returns" className="grid gap-2 border-t pt-4"><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">Recently received</h2><p className="text-xs text-muted-foreground">The 10 latest warehouse return receipts.</p></div><Button type="button" size="icon-sm" variant="ghost" disabled={recentLoading} onClick={() => void loadRecent()} title="Refresh recent returns"><RefreshCw className={`size-4 ${recentLoading ? "animate-spin" : ""}`} /><span className="sr-only">Refresh recent returns</span></Button></div>{recentLoading ? <div className="h-20 animate-pulse rounded-md bg-muted" /> : recentRecords.length ? <div className="grid gap-2">{recentRecords.map(row => { const customer = customerDetails(row); const location = customerLocation(row); return <article key={`recent-${String(row.id)}`} className="grid gap-2 rounded-md border bg-card p-3 text-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><a className="font-semibold text-primary hover:underline" href={returnHref(row)}>{text(row.returnNumber, row.id) || "Return"}</a><Badge variant="success">Received</Badge><Badge variant="outline">{text(row.channelSource, row.source) || "Local"}</Badge></div><p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><Clock3 className="size-3.5" />{dateLabel(row.updatedAt || row.receivedAt)}</p></div><Button asChild size="sm" variant="outline"><a href={returnHref(row)}>View</a></Button></div><div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs"><div><p className="text-muted-foreground">Order</p><p className="truncate font-medium">{text(row.orderNumber, row.orderId) || "Unmatched"}</p></div><div><p className="text-muted-foreground">Warehouse</p><p className="truncate font-medium">{text(row.warehouseName) || "Unassigned"}</p></div><div><p className="text-muted-foreground">Received by</p><p className="truncate">{text(row.receivedBy) || "Not recorded"}</p></div><div><p className="text-muted-foreground">Disposition</p><p className="truncate capitalize">{text(row.disposition, row.inspectionStatus).replaceAll("_", " ") || "Pending inspection"}</p></div></div>{customer.name || location ? <p className="truncate text-xs text-muted-foreground">{[customer.name, location].filter(Boolean).join(" · ")}</p> : null}</article> })}</div> : <p className="rounded-md border border-dashed p-5 text-center text-sm text-muted-foreground">No returns have been received yet.</p>}</section>
    <Dialog open={Boolean(record)} onOpenChange={value => { if (!value && !busy) setRecord(null) }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle className="break-all">Receive {String(record?.returnNumber || record?.channelReturnId || "return")}</DialogTitle></DialogHeader>
      <p className="text-sm text-muted-foreground">Channel status: {String(record?.channelStatus || record?.channelLifecycleStatus || "Unknown")} / Local receiving only</p>
      {record && error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      {qualifiesForVendorReturn ? <section role="status" className="grid gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm"><div className="flex items-start gap-2"><RotateCcw className="mt-0.5 size-4 shrink-0 text-emerald-700 dark:text-emerald-300" /><div className="min-w-0"><p className="font-medium text-emerald-800 dark:text-emerald-200">Qualifies for vendor return review</p><p className="mt-1 text-xs text-muted-foreground">{String(vendorReturnEligibility.message || "This order is within 30 days.")} {Number(vendorReturnEligibility.daysRemaining || 0)} day{Number(vendorReturnEligibility.daysRemaining || 0) === 1 ? "" : "s"} remain through {String(vendorReturnEligibility.deadline || "the calculated deadline")}.{vendorReturnEligibility.supplier ? ` Supplier: ${String(vendorReturnEligibility.supplier)}.` : " Supplier must be confirmed by Purchasing."}{vendorReturnEligibility.purchaseOrderNumber ? ` PO: ${String(vendorReturnEligibility.purchaseOrderNumber)}.` : ""}</p></div></div>{draft.disposition !== "return_to_vendor" ? <Button type="button" size="sm" variant="outline" className="justify-self-start" onClick={() => setDraft({ ...draft, disposition: "return_to_vendor" })}><RotateCcw className="size-4" />Use vendor return</Button> : <Badge variant="success" className="justify-self-start">Vendor return selected</Badge>}</section> : null}
      <ReturnReceiptFields record={record} warehouses={receivingWarehouses} draft={draft} setDraft={setDraft} allowUnassigned />
      <div className="grid gap-3 sm:grid-cols-2">{selectedWarehouse ? <Label className="grid gap-2">Bin / receiving location{binRequired ? " (required)" : ""}{activeBins.length ? <Select value={draft.binLocation || "__none"} onValueChange={value => setDraft({ ...draft, binLocation: value === "__none" ? "" : value })}><SelectTrigger><SelectValue placeholder="Choose a bin" /></SelectTrigger><SelectContent>{!binRequired && <SelectItem value="__none">No bin</SelectItem>}{activeBins.map(bin => { const code = text(bin.code, bin.id); const name = text(bin.name, bin.nickname); return <SelectItem key={String(bin.id || code)} value={code}>{code}{name && name !== code ? ` - ${name}` : ""}{bin.isDefault ? " (default)" : ""}</SelectItem> })}</SelectContent></Select> : <Input value={draft.binLocation || ""} onChange={event => setDraft({ ...draft, binLocation: event.target.value })} placeholder={binRequired ? "No active bins configured; enter a bin" : "Optional bin or receiving location"} />}</Label> : null}<Label className="grid gap-2">Condition<Select value={draft.condition || "Unknown"} onValueChange={condition => setDraft({ ...draft, condition })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Unknown", "New", "Opened", "Damaged"].map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></Label></div>
      <Label className="grid gap-2">Proposed disposition<Select value={draft.disposition || "quarantine"} onValueChange={disposition => setDraft({ ...draft, disposition })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="quarantine">Quarantine</SelectItem><SelectItem value="restock">Restock after inspection</SelectItem><SelectItem value="dispose">Damaged / dispose after inspection</SelectItem><SelectItem value="return_to_vendor">Return to vendor</SelectItem></SelectContent></Select></Label>
      <Label className="grid gap-2">Inspection notes<Textarea value={draft.inspectionNotes || ""} onChange={event => setDraft({ ...draft, inspectionNotes: event.target.value })} /></Label>
      <section className="grid gap-3 border-t pt-3"><div><p className="font-medium">Receipt photos{stockPhotoRequired ? " (1 required)" : ""}</p><p className="text-xs text-muted-foreground">{photos.length}/3 ready to save with this receipt.{stockPhotoRequired && photos.length < 1 ? " Add one photo because this New item is marked for restock." : ""}</p></div><Input ref={photoInputRef} className="sr-only" type="file" accept="image/*" capture="environment" multiple disabled={busy} onChange={event => { void addPhotos(event.target.files); event.target.value = "" }} /><Button type="button" variant="outline" disabled={busy || photos.length >= 3} onClick={() => photoInputRef.current?.click()}>{photos.length ? <ImagePlus className="size-4" /> : <Camera className="size-4" />}{photos.length ? "Take another photo" : "Take receipt photo"}</Button><div className="flex flex-wrap gap-3">{photos.map(photo => <div key={photo.id} className="relative"><a href={photo.dataUrl} target="_blank" rel="noopener noreferrer"><img src={photo.dataUrl} alt={photo.name} className="size-20 rounded object-cover" /></a><Button className="absolute -right-2 -top-2 size-7 rounded-full" size="icon" variant="destructive" title={`Remove ${photo.name}`} disabled={busy} onClick={() => setPhotos(current => current.filter(row => row.id !== photo.id))}><Trash2 className="size-3.5" /></Button></div>)}</div></section>
      <DialogFooter className="sticky bottom-0 bg-background py-2"><Button variant="outline" disabled={busy} onClick={() => setRecord(null)}>Cancel</Button><Button disabled={busy || Boolean(record?.restockedAt) || (binRequired && !draft.binLocation) || (stockPhotoRequired && photos.length < 1)} onClick={() => void save()}>Save receipt{photos.length ? ` + ${photos.length} photo${photos.length === 1 ? "" : "s"}` : ""}</Button></DialogFooter>
    </DialogContent></Dialog>
  </section>
}
