import { useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, CheckCircle2, Download, FileUp, Loader2, PackageCheck, Play, RefreshCw, Search, Truck } from "lucide-react"
import { toast } from "sonner"
import { api, dateLabel, moneyLabel } from "@/lib/client-api"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"

type ProviderStatus = { enabled?: boolean; configured?: boolean; environment?: string; accountEnding?: string; message?: string }
type DisputeBatch = {
  id: string
  displayId: string
  name: string
  status: string
  totalItems: number
  matchedItems: number
  quotedItems: number
  failedItems: number
  createdByName: string
  createdAt: string
  updatedAt: string
  lastQuotedAt?: string
}
type DisputeQuote = { rank: number; provider: string; carrier: string; service: string; amount: number; currency: string; deliveryDays?: number | null; deliveryEstimate?: string; quotedAt?: string }
type DisputeItem = {
  id: string
  inputReference: string
  matchStatus: string
  status: string
  orderId: string
  orderNumber: string
  channel: string
  channelOrderNumber: string
  shipmentId: string
  trackingNumber: string
  destination: { line1?: string; city?: string; state?: string; postalCode?: string; country?: string }
  package: { type?: string; weight?: number | null; length?: number | null; width?: number | null; height?: number | null; weightUnit?: string; dimensionUnit?: string; source?: string }
  carrierBilledPackage: { weight?: number | null; length?: number | null; width?: number | null; height?: number | null }
  originalLabelCost?: number | null
  finalBilledCost?: number | null
  billingDifference?: number | null
  settlementId?: string
  carrierInvoiceNumber?: string
  reviewReason?: string
  latestRun?: { status?: string; requestedAt?: string; error?: string } | null
  quotes: DisputeQuote[]
}
type DisputeDetail = DisputeBatch & { items: DisputeItem[] }
type ListResponse = { batches: DisputeBatch[]; providers: { ups: ProviderStatus; veeqo: ProviderStatus } }

function statusLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function statusVariant(value: string): "default" | "secondary" | "destructive" | "outline" {
  if (["ready", "quoted"].includes(value)) return "default"
  if (["failed", "quote_failed", "unmatched", "ambiguous"].includes(value)) return "destructive"
  if (["quoting", "ready_to_quote"].includes(value)) return "secondary"
  return "outline"
}

function packageText(parcel: DisputeItem["package"]) {
  if (![parcel.weight, parcel.length, parcel.width, parcel.height].every((value) => Number(value) > 0)) return "Missing measurements"
  return `${parcel.weight} ${parcel.weightUnit || "lb"} · ${parcel.length} × ${parcel.width} × ${parcel.height} ${parcel.dimensionUnit || "in"}`
}

function billedPackageText(parcel: DisputeItem["carrierBilledPackage"]) {
  const dimensions = [parcel.length, parcel.width, parcel.height]
  if (!parcel.weight && !dimensions.some((value) => Number(value) > 0)) return "Not reported"
  return `${parcel.weight ? `${parcel.weight} lb` : "Weight n/a"}${dimensions.every((value) => Number(value) > 0) ? ` · ${dimensions.join(" × ")} in` : ""}`
}

function parseCsvLine(line: string) {
  const cells: string[] = []
  let value = "", quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1 }
    else if (char === '"') quoted = !quoted
    else if (char === "," && !quoted) { cells.push(value.trim()); value = "" }
    else value += char
  }
  cells.push(value.trim())
  return cells
}

function referencesFromUpload(content: string) {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (!lines.length) return []
  const first = parseCsvLine(lines[0]).map((value) => value.toLowerCase().replaceAll(/[^a-z0-9]+/g, " ").trim())
  const known = first.map((value, index) => /^(dataplus )?order( number| id)?$|^channel order( number| id)?$|^reference$/.test(value) ? index : -1).filter((index) => index >= 0)
  if (known.length) return lines.slice(1).flatMap((line) => { const cells = parseCsvLine(line); return known.map((index) => cells[index]).filter(Boolean) })
  if (first.length > 1) return lines.map((line) => parseCsvLine(line)[0]).filter(Boolean)
  return lines.flatMap((line) => line.split(/[,;]+/)).map((value) => value.trim()).filter(Boolean)
}

function ProviderCard({ name, status }: { name: string; status?: ProviderStatus }) {
  const ready = status?.enabled !== false && status?.configured === true
  return <div className="flex min-w-0 items-start gap-3 rounded-md border bg-card p-3">
    <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md ${ready ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"}`}><Truck className="size-4" /></span>
    <div className="min-w-0"><div className="flex items-center gap-2"><p className="font-medium">{name}</p><Badge variant={ready ? "default" : "outline"}>{ready ? "Ready" : "Setup needed"}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{status?.message || "Provider status unavailable."}</p></div>
  </div>
}

export function ShippingDisputes() {
  const [batches, setBatches] = useState<DisputeBatch[]>([])
  const [providers, setProviders] = useState<ListResponse["providers"]>({ ups: {}, veeqo: {} })
  const [selectedId, setSelectedId] = useState("")
  const [detail, setDetail] = useState<DisputeDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [quoting, setQuoting] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState("")
  const [referenceText, setReferenceText] = useState("")
  const [sourceFileName, setSourceFileName] = useState("")
  const [query, setQuery] = useState("")
  const [editItem, setEditItem] = useState<DisputeItem | null>(null)
  const [editDraft, setEditDraft] = useState({ weight: "", length: "", width: "", height: "", reason: "" })
  const [ratesItem, setRatesItem] = useState<DisputeItem | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const loadList = async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const result = await api<ListResponse>("/api/accounting/shipping-disputes")
      setBatches(result.batches || [])
      setProviders(result.providers || { ups: {}, veeqo: {} })
      setSelectedId((current) => current || result.batches?.[0]?.id || "")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load shipping disputes.") }
    finally { if (!quiet) setLoading(false) }
  }

  const loadDetail = async (id: string, quiet = false) => {
    if (!id) { setDetail(null); return }
    if (!quiet) setDetailLoading(true)
    try {
      const result = await api<{ batch: DisputeDetail }>(`/api/accounting/shipping-disputes/${encodeURIComponent(id)}`)
      setDetail(result.batch)
      setBatches((current) => current.map((batch) => batch.id === result.batch.id ? result.batch : batch))
    } catch (error) { if (!quiet) toast.error(error instanceof Error ? error.message : "Unable to load this dispute.") }
    finally { if (!quiet) setDetailLoading(false) }
  }

  useEffect(() => { void loadList() }, [])
  useEffect(() => { void loadDetail(selectedId) }, [selectedId])
  useEffect(() => {
    if (!detail || detail.status !== "quoting") return
    const timer = window.setInterval(() => { void loadDetail(detail.id, true); void loadList(true) }, 2500)
    return () => window.clearInterval(timer)
  }, [detail?.id, detail?.status])

  const visibleItems = useMemo(() => {
    const value = query.trim().toLowerCase()
    if (!value) return detail?.items || []
    return (detail?.items || []).filter((item) => [item.inputReference, item.orderNumber, item.channelOrderNumber, item.trackingNumber, item.channel].some((candidate) => String(candidate || "").toLowerCase().includes(value)))
  }, [detail?.items, query])
  const readyCount = (detail?.items || []).filter((item) => item.matchStatus === "matched"
    && [item.package.weight, item.package.length, item.package.width, item.package.height].every((value) => Number(value) > 0)
    && Boolean(item.destination.line1 && item.destination.city && item.destination.state && item.destination.postalCode && item.destination.country)).length

  const createBatch = async () => {
    const references = referencesFromUpload(referenceText)
    if (!references.length) { toast.error("Paste or upload at least one order number."); return }
    setCreating(true)
    try {
      const result = await api<{ batch: DisputeDetail }>("/api/accounting/shipping-disputes", { method: "POST", body: JSON.stringify({ name: name || "Shipping dispute", references, sourceFileName }) })
      setCreateOpen(false); setName(""); setReferenceText(""); setSourceFileName("")
      await loadList(true); setSelectedId(result.batch.id); setDetail(result.batch)
      toast.success(`${result.batch.displayId} created with ${result.batch.totalItems} shipment row${result.batch.totalItems === 1 ? "" : "s"}.`)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to create shipping dispute.") }
    finally { setCreating(false) }
  }

  const quoteBatch = async () => {
    if (!detail) return
    setQuoting(true)
    try {
      const result = await api<{ message?: string }>(`/api/accounting/shipping-disputes/${encodeURIComponent(detail.id)}/quote`, { method: "POST", body: "{}" })
      toast.success(result.message || "Comparison quotes queued.")
      await loadDetail(detail.id, true)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to queue comparison quotes.") }
    finally { setQuoting(false) }
  }

  const openPackageEdit = (item: DisputeItem) => {
    setEditItem(item)
    setEditDraft({ weight: String(item.package.weight || ""), length: String(item.package.length || ""), width: String(item.package.width || ""), height: String(item.package.height || ""), reason: "" })
  }
  const savePackage = async () => {
    if (!detail || !editItem) return
    try {
      const result = await api<{ batch: DisputeDetail }>(`/api/accounting/shipping-disputes/${encodeURIComponent(detail.id)}/items/${encodeURIComponent(editItem.id)}`, {
        method: "PATCH", body: JSON.stringify({ package: { type: editItem.package.type || "box", weight: editDraft.weight, length: editDraft.length, width: editDraft.width, height: editDraft.height, weightUnit: "lb", dimensionUnit: "in" }, reason: editDraft.reason }),
      })
      setDetail(result.batch); setEditItem(null); toast.success("Dispute package evidence updated.")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update package evidence.") }
  }

  const upload = async (file?: File) => {
    if (!file) return
    try {
      const content = await file.text()
      const references = referencesFromUpload(content)
      if (!references.length) throw new Error("No order numbers were found in the uploaded file.")
      setReferenceText(references.join("\n")); setSourceFileName(file.name)
      toast.success(`${references.length} order reference${references.length === 1 ? "" : "s"} loaded from ${file.name}.`)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to read this file.") }
    finally { if (fileRef.current) fileRef.current.value = "" }
  }

  return <div className="grid min-w-0 gap-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-medium uppercase text-muted-foreground">Accounting</p><h1 className="text-2xl font-semibold">Shipping Disputes</h1><p className="mt-1 max-w-3xl text-sm text-muted-foreground">Compare historical package and billing evidence with current UPS and Veeqo rates. Quotes are evidence only and never alter orders, labels, or settlements.</p></div><Button onClick={() => setCreateOpen(true)}><FileUp className="size-4" /> New dispute</Button></div>

    <div className="grid gap-3 md:grid-cols-2"><ProviderCard name="UPS negotiated rates" status={providers.ups} /><ProviderCard name="Veeqo carrier rates" status={providers.veeqo} /></div>

    <div className="grid min-w-0 gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
      <Card className="min-w-0"><CardHeader className="pb-3"><div className="flex items-center justify-between"><div><CardTitle className="text-base">Dispute batches</CardTitle><CardDescription>{batches.length} recent batches</CardDescription></div><Button size="icon-sm" variant="ghost" onClick={() => void loadList()} aria-label="Refresh disputes"><RefreshCw className="size-4" /></Button></div></CardHeader><CardContent className="p-0"><ScrollArea className="h-[610px]"><div className="grid gap-1 p-2">{loading ? <div className="flex items-center justify-center p-8 text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" /> Loading</div> : batches.map((batch) => <button key={batch.id} type="button" onClick={() => setSelectedId(batch.id)} className={`grid gap-1 rounded-md border px-3 py-2 text-left transition-colors ${selectedId === batch.id ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted"}`}><div className="flex items-center justify-between gap-2"><span className="font-medium">{batch.displayId}</span><Badge variant={statusVariant(batch.status)}>{statusLabel(batch.status)}</Badge></div><span className="truncate text-xs text-muted-foreground">{batch.name || "Shipping dispute"}</span><span className="text-xs text-muted-foreground">{batch.quotedItems}/{batch.totalItems} quoted · {dateLabel(batch.createdAt)}</span></button>)}{!loading && !batches.length ? <p className="p-8 text-center text-sm text-muted-foreground">No shipping disputes yet.</p> : null}</div></ScrollArea></CardContent></Card>

      <Card className="min-w-0"><CardHeader className="border-b"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><CardTitle className="text-lg">{detail?.displayId || "Select a dispute"}</CardTitle>{detail ? <Badge variant={statusVariant(detail.status)}>{statusLabel(detail.status)}</Badge> : null}</div><CardDescription>{detail ? `${detail.name} · ${detail.matchedItems} matched · ${detail.quotedItems} quoted` : "Choose a batch or create a new dispute."}</CardDescription></div>{detail ? <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => window.location.assign(`/api/accounting/shipping-disputes/${encodeURIComponent(detail.id)}/export.csv`)}><Download className="size-4" /> Export CSV</Button><Button size="sm" disabled={quoting || detail.status === "quoting" || !readyCount} onClick={() => void quoteBatch()}>{quoting || detail.status === "quoting" ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} {detail.quotedItems ? "Refresh quotes" : "Request quotes"}</Button></div> : null}</div></CardHeader><CardContent className="p-0">
        {detailLoading ? <div className="flex h-64 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" /> Loading shipment evidence</div> : detail ? <>
          {(detail.items.some((item) => !["matched"].includes(item.matchStatus) || ["needs_package_data", "needs_address_review"].includes(item.status))) ? <Alert className="m-4 w-auto"><AlertTriangle className="size-4" /><AlertTitle>Review required before quoting</AlertTitle><AlertDescription>Unmatched references and incomplete historical package records remain visible. Add corrected package evidence with a reason; unresolved rows are skipped without blocking the rest of the batch.</AlertDescription></Alert> : null}
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3"><div className="relative min-w-56 flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input className="h-9 pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter order, channel order, or tracking" /></div><span className="text-xs text-muted-foreground">{visibleItems.length} shipment rows</span></div>
          <div className="max-h-[520px] overflow-auto"><Table><TableHeader className="sticky top-0 z-10 bg-background"><TableRow><TableHead className="min-w-48">Order / shipment</TableHead><TableHead className="min-w-56">Package evidence</TableHead><TableHead className="min-w-48">Carrier evidence</TableHead><TableHead className="min-w-44 text-right">Cost comparison</TableHead><TableHead className="min-w-52">Current comparison</TableHead><TableHead className="w-36">Status</TableHead><TableHead className="w-24 text-right">Action</TableHead></TableRow></TableHeader><TableBody>{visibleItems.map((item) => {
            const lowest = item.quotes[0]
            return <TableRow key={item.id}><TableCell><div className="grid gap-1"><a className="font-medium text-primary hover:underline" href={item.orderId ? `/orders/${encodeURIComponent(item.orderId)}` : undefined}>{item.orderNumber || item.inputReference}</a><span className="text-xs text-muted-foreground">{item.channel || "Unknown channel"} · {item.channelOrderNumber || "No channel order"}</span><span className="text-xs text-muted-foreground">{item.trackingNumber || item.shipmentId || "No shipment reference"}</span><span className="text-xs text-muted-foreground">{[item.destination.city, item.destination.state, item.destination.postalCode].filter(Boolean).join(", ") || "Destination missing"}</span></div></TableCell><TableCell><p className={item.status === "needs_package_data" ? "font-medium text-destructive" : "font-medium"}>{packageText(item.package)}</p><p className="mt-1 text-xs text-muted-foreground">Source: {statusLabel(item.package.source || "unknown")}</p></TableCell><TableCell><p className="font-medium">{billedPackageText(item.carrierBilledPackage)}</p><p className="mt-1 text-xs text-muted-foreground">{item.settlementId ? `Settlement ${item.settlementId}` : "No settlement dimensions linked"}</p></TableCell><TableCell className="text-right"><p>Purchased {item.originalLabelCost == null ? "—" : moneyLabel(item.originalLabelCost)}</p><p>Billed {item.finalBilledCost == null ? "—" : moneyLabel(item.finalBilledCost)}</p><p className={Number(item.billingDifference || 0) > 0 ? "font-semibold text-destructive" : "text-muted-foreground"}>Difference {item.billingDifference == null ? "—" : moneyLabel(item.billingDifference)}</p></TableCell><TableCell>{lowest ? <button type="button" className="grid text-left" onClick={() => setRatesItem(item)}><span className="font-semibold text-emerald-600">{moneyLabel(lowest.amount)}</span><span className="text-xs">{lowest.carrier} · {lowest.service}</span><span className="text-xs text-muted-foreground">{item.quotes.length} saved rate{item.quotes.length === 1 ? "" : "s"} · view all</span></button> : <span className="text-sm text-muted-foreground">{item.latestRun?.error || "Not quoted"}</span>}</TableCell><TableCell><Badge variant={statusVariant(item.status)}>{statusLabel(item.status)}</Badge>{item.reviewReason ? <p className="mt-1 max-w-40 text-xs text-muted-foreground">{item.reviewReason}</p> : null}</TableCell><TableCell className="text-right">{item.matchStatus === "matched" ? <Button size="icon-sm" variant="outline" onClick={() => openPackageEdit(item)} aria-label="Edit package evidence"><PackageCheck className="size-4" /></Button> : null}</TableCell></TableRow>
          })}{!visibleItems.length ? <TableRow><TableCell colSpan={7} className="h-32 text-center text-muted-foreground">No shipment evidence matches this filter.</TableCell></TableRow> : null}</TableBody></Table></div>
        </> : <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground"><Truck className="size-8" /><p className="text-sm">Select a dispute batch.</p></div>}
      </CardContent></Card>
    </div>

    <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="max-h-[100dvh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>Create shipping dispute</DialogTitle><DialogDescription>Paste DataPlus order numbers or channel order numbers separated by commas or new lines. A CSV or text file may contain one identifier column.</DialogDescription></DialogHeader><div className="grid gap-4"><div className="grid gap-1.5"><Label>Dispute name</Label><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Temu UPS dimension overcharges - October" /></div><div className="grid gap-1.5"><div className="flex items-center justify-between"><Label>Order references</Label><Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}><FileUp className="size-4" /> Upload CSV</Button></div><Textarea className="min-h-48 font-mono text-sm" value={referenceText} onChange={(event) => { setReferenceText(event.target.value); if (sourceFileName) setSourceFileName("") }} placeholder={"54571\nPO-211-17286699405434066\n17-15309-20107"} /><input ref={fileRef} className="hidden" type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(event) => void upload(event.target.files?.[0])} />{sourceFileName ? <p className="text-xs text-muted-foreground">Loaded from {sourceFileName}</p> : null}</div></div><DialogFooter className="pb-[max(0.75rem,env(safe-area-inset-bottom))]"><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button disabled={creating} onClick={() => void createBatch()}>{creating ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Create dispute</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={Boolean(editItem)} onOpenChange={(open) => !open && setEditItem(null)}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Package evidence</DialogTitle><DialogDescription>These measurements are used only for this dispute quote. The order, label, and shipping report history remain unchanged.</DialogDescription></DialogHeader><div className="grid gap-4"><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><div className="grid gap-1.5"><Label>Weight (lb)</Label><Input type="number" min="0.01" step="0.01" value={editDraft.weight} onChange={(event) => setEditDraft({ ...editDraft, weight: event.target.value })} /></div><div className="grid gap-1.5"><Label>Length (in)</Label><Input type="number" min="0.01" step="0.01" value={editDraft.length} onChange={(event) => setEditDraft({ ...editDraft, length: event.target.value })} /></div><div className="grid gap-1.5"><Label>Width (in)</Label><Input type="number" min="0.01" step="0.01" value={editDraft.width} onChange={(event) => setEditDraft({ ...editDraft, width: event.target.value })} /></div><div className="grid gap-1.5"><Label>Height (in)</Label><Input type="number" min="0.01" step="0.01" value={editDraft.height} onChange={(event) => setEditDraft({ ...editDraft, height: event.target.value })} /></div></div><div className="grid gap-1.5"><Label>Reason for correction</Label><Textarea value={editDraft.reason} onChange={(event) => setEditDraft({ ...editDraft, reason: event.target.value })} placeholder="Verified against the package record used for the original shipment." /></div></div><DialogFooter><Button variant="outline" onClick={() => setEditItem(null)}>Cancel</Button><Button onClick={() => void savePackage()}>Save evidence</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={Boolean(ratesItem)} onOpenChange={(open) => !open && setRatesItem(null)}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Current comparison rates</DialogTitle><DialogDescription>{ratesItem?.orderNumber} · requested {dateLabel(ratesItem?.latestRun?.requestedAt)}</DialogDescription></DialogHeader><Alert><AlertTriangle className="size-4" /><AlertTitle>Supporting evidence, not a historical re-rate</AlertTitle><AlertDescription>Fuel, accessorial charges, service availability, and negotiated pricing can change. The original label purchase snapshot and final carrier bill remain the historical accounting evidence.</AlertDescription></Alert><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Rank</TableHead><TableHead>Provider</TableHead><TableHead>Carrier / service</TableHead><TableHead className="text-right">Rate</TableHead><TableHead>Delivery</TableHead></TableRow></TableHeader><TableBody>{(ratesItem?.quotes || []).map((quote) => <TableRow key={`${quote.rank}-${quote.provider}-${quote.service}`}><TableCell>{quote.rank}</TableCell><TableCell>{statusLabel(quote.provider)}</TableCell><TableCell><p className="font-medium">{quote.carrier}</p><p className="text-xs text-muted-foreground">{quote.service}</p></TableCell><TableCell className="text-right font-semibold">{moneyLabel(quote.amount)}</TableCell><TableCell>{quote.deliveryEstimate || (quote.deliveryDays ? `${quote.deliveryDays} days` : "Not provided")}</TableCell></TableRow>)}</TableBody></Table></div><DialogFooter><Button onClick={() => setRatesItem(null)}>Close</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
