import { useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, Boxes, CheckCircle2, Download, FileUp, Loader2, MoreHorizontal, Package, PackageCheck, Play, RefreshCw, Search, Truck } from "lucide-react"
import { toast } from "sonner"
import { api, dateLabel, moneyLabel } from "@/lib/client-api"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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
  sourceFileName?: string
  createdByName: string
  createdAt: string
  updatedAt: string
  lastQuotedAt?: string
  raw?: { importType?: string; importGroupId?: string; sequence?: number; totalBatches?: number; summary?: TemuImportSummary; sourceSummary?: TemuImportSummary }
}
type DisputeQuote = { rank: number; provider: string; carrier: string; service: string; amount: number; currency: string; deliveryDays?: number | null; deliveryEstimate?: string; quotedAt?: string }
type TemuAdjustmentTransaction = { rowNumber: number; date: string; relatedId: string; signedAmount: number; total: number | null; currency: string }
type TemuAdjustmentEvidence = {
  sourceReport: "temu_transaction_report"
  transactionType: "Shipping label purchase adjustment"
  reference: string
  signedAmount: number
  expenseAmount: number
  currency: string
  transactionCount: number
  debitCount: number
  creditCount: number
  firstDate: string
  lastDate: string
  relatedIds: string[]
  transactions: TemuAdjustmentTransaction[]
}
type TemuImportSummary = {
  transactionCount: number
  orderCount: number
  debitCount: number
  creditCount: number
  invalidRows: number
  signedAmount: number
  expenseAmount: number
  firstDate: string
  lastDate: string
  currency: string
}
type TemuReportImport = { references: string[]; evidence: TemuAdjustmentEvidence[]; summary: TemuImportSummary; importGroupId: string }
type ParsedUpload = { references: string[]; temuReport?: TemuReportImport }
type DisputeOrderLine = { id: string; lineIndex: number; sku: string; mappedSku: string; originalSku: string; catalogSku: string; title: string; image: string; brand: string; supplier: string; quantity?: number | null }
type DisputeSkuOption = { sku: string; image: string; title: string; brand: string; supplier: string; orderCount: number }
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
  adjustmentEvidence?: TemuAdjustmentEvidence | null
  orderLines: DisputeOrderLine[]
  skus: string[]
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

function packageSourceLabel(value = "") {
  if (value === "current_catalog_sku") return "Current catalog SKU"
  if (value === "current_catalog_order_estimate") return "Current catalog order estimate"
  if (value === "label_purchase_snapshot") return "Original label snapshot"
  if (value === "manual_dispute_override") return "Manual dispute override"
  return statusLabel(value || "unknown")
}

function billedPackageText(parcel: DisputeItem["carrierBilledPackage"]) {
  const dimensions = [parcel.length, parcel.width, parcel.height]
  if (!parcel.weight && !dimensions.some((value) => Number(value) > 0)) return "Not reported"
  return `${parcel.weight ? `${parcel.weight} lb` : "Weight n/a"}${dimensions.every((value) => Number(value) > 0) ? ` · ${dimensions.join(" × ")} in` : ""}`
}

function readyToQuote(item: DisputeItem) {
  return item.matchStatus === "matched"
    && [item.package.weight, item.package.length, item.package.width, item.package.height].every((value) => Number(value) > 0)
    && Boolean(item.destination.line1 && item.destination.city && item.destination.state && item.destination.postalCode && item.destination.country)
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

const DISPUTE_REFERENCE_LIMIT = 50_000
const DISPUTE_PAGE_SIZE = 100

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function normalizedHeader(value: unknown) {
  return String(value ?? "").toLowerCase().replaceAll(/[^a-z0-9]+/g, " ").trim()
}

function numberFromCell(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  const source = String(value ?? "").trim()
  if (!source) return null
  const parenthesized = /^\(.*\)$/.test(source)
  const parsed = Number(source.replaceAll(/[$,\s()]/g, ""))
  if (!Number.isFinite(parsed)) return null
  return parenthesized ? -parsed : parsed
}

function temuAdjustmentReportFromRows(inputRows: unknown[][]): TemuReportImport | null {
  const rows = normalizedUploadRows(inputRows)
  if (!rows.length) return null
  const headerIndex = rows.slice(0, 20).findIndex((row) => {
    const headers = new Set(row.map(normalizedHeader))
    return headers.has("transaction type") && headers.has("order id") && headers.has("others")
  })
  if (headerIndex < 0) return null
  const headers = rows[headerIndex].map(normalizedHeader)
  const column = (name: string) => headers.indexOf(name)
  const transactionTypeColumn = column("transaction type")
  const orderIdColumn = column("order id")
  const amountColumn = column("others")
  const dateColumn = column("date time")
  const relatedIdColumn = column("related id")
  const totalColumn = column("total")
  const currencyColumn = column("currency")
  const grouped = new Map<string, TemuAdjustmentEvidence>()
  let transactionCount = 0, debitCount = 0, creditCount = 0, invalidRows = 0
  let signedAmount = 0, firstDate = "", lastDate = "", currency = "USD"
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index]
    if (normalizedHeader(row[transactionTypeColumn]) !== "shipping label purchase adjustment") continue
    const reference = String(row[orderIdColumn] || "").trim()
    const adjustment = numberFromCell(row[amountColumn])
    if (!reference || adjustment == null) { invalidRows += 1; continue }
    const date = dateColumn >= 0 ? String(row[dateColumn] || "").trim() : ""
    const rowCurrency = currencyColumn >= 0 ? String(row[currencyColumn] || "").trim() || "USD" : "USD"
    const transaction: TemuAdjustmentTransaction = {
      rowNumber: index + 1,
      date,
      relatedId: relatedIdColumn >= 0 ? String(row[relatedIdColumn] || "").trim() : "",
      signedAmount: roundMoney(adjustment),
      total: totalColumn >= 0 ? numberFromCell(row[totalColumn]) : null,
      currency: rowCurrency,
    }
    const key = reference.toLowerCase()
    const existing = grouped.get(key) || {
      sourceReport: "temu_transaction_report",
      transactionType: "Shipping label purchase adjustment",
      reference,
      signedAmount: 0,
      expenseAmount: 0,
      currency: rowCurrency,
      transactionCount: 0,
      debitCount: 0,
      creditCount: 0,
      firstDate: date,
      lastDate: date,
      relatedIds: [],
      transactions: [],
    }
    existing.transactions.push(transaction)
    existing.transactionCount += 1
    existing.signedAmount = roundMoney(existing.signedAmount + adjustment)
    existing.expenseAmount = roundMoney(-existing.signedAmount)
    if (adjustment < 0) existing.debitCount += 1
    if (adjustment > 0) existing.creditCount += 1
    if (transaction.relatedId && !existing.relatedIds.includes(transaction.relatedId)) existing.relatedIds.push(transaction.relatedId)
    if (date && (!existing.firstDate || date < existing.firstDate)) existing.firstDate = date
    if (date && (!existing.lastDate || date > existing.lastDate)) existing.lastDate = date
    grouped.set(key, existing)
    transactionCount += 1
    signedAmount += adjustment
    if (adjustment < 0) debitCount += 1
    if (adjustment > 0) creditCount += 1
    if (date && (!firstDate || date < firstDate)) firstDate = date
    if (date && (!lastDate || date > lastDate)) lastDate = date
    currency = rowCurrency || currency
  }
  const evidence = [...grouped.values()]
  return {
    references: evidence.map((row) => row.reference),
    evidence,
    importGroupId: crypto.randomUUID(),
    summary: {
      transactionCount,
      orderCount: evidence.length,
      debitCount,
      creditCount,
      invalidRows,
      signedAmount: roundMoney(signedAmount),
      expenseAmount: roundMoney(-signedAmount),
      firstDate,
      lastDate,
      currency,
    },
  }
}

const referenceHeaderPattern = /^(dataplus )?order( number| id)?$|^(channel|marketplace|external) order( number| id)?$|^po( number| id)?$|^reference$/

function normalizedUploadRows(rows: unknown[][]) {
  return rows
    .map((row) => row.map((value) => String(value ?? "").trim()))
    .filter((row) => row.some(Boolean))
}

function referenceColumns(row: string[]) {
  return row
    .map((value, index) => referenceHeaderPattern.test(value.toLowerCase().replaceAll(/[^a-z0-9]+/g, " ").trim()) ? index : -1)
    .filter((index) => index >= 0)
}

function referencesFromRows(inputRows: unknown[][]) {
  const rows = normalizedUploadRows(inputRows)
  if (!rows.length) return []
  const headerIndex = rows.slice(0, 20).findIndex((row) => referenceColumns(row).length > 0)
  if (headerIndex >= 0) {
    const columns = referenceColumns(rows[headerIndex])
    return rows.slice(headerIndex + 1).flatMap((row) => columns.map((index) => row[index]).filter(Boolean))
  }
  if (rows[0].length > 1) return rows.map((row) => row[0]).filter(Boolean)
  return rows.flatMap((row) => String(row[0] || "").split(/[,;]+/)).map((value) => value.trim()).filter(Boolean)
}

function referencesFromUpload(content: string) {
  const rows = content.split(/\r?\n/).map((line) => parseCsvLine(line))
  return referencesFromRows(rows)
}

function isExcelFile(file: File) {
  return /\.(xlsx|xls)$/i.test(file.name)
    || ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel"].includes(file.type)
}

async function referencesFromFile(file: File): Promise<ParsedUpload> {
  if (!isExcelFile(file)) {
    const rows = (await file.text()).split(/\r?\n/).map((line) => parseCsvLine(line))
    const temuReport = temuAdjustmentReportFromRows(rows)
    return { references: temuReport?.references || referencesFromRows(rows), temuReport: temuReport || undefined }
  }
  const XLSX = await import("xlsx")
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false })
  let fallback: string[] = []
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: "", raw: false, blankrows: false })
    const normalizedRows = normalizedUploadRows(rows)
    if (!normalizedRows.length) continue
    const temuReport = temuAdjustmentReportFromRows(normalizedRows)
    if (temuReport) return { references: temuReport.references, temuReport }
    const references = referencesFromRows(normalizedRows)
    if (!fallback.length) fallback = references
    if (normalizedRows.slice(0, 20).some((row) => referenceColumns(row).length > 0)) return { references }
  }
  return { references: fallback }
}

function ProviderCard({ name, status }: { name: string; status?: ProviderStatus }) {
  const ready = status?.enabled !== false && status?.configured === true
  return <div className="flex min-w-0 items-start gap-3 rounded-md border bg-card p-3">
    <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md ${ready ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"}`}><Truck className="size-4" /></span>
    <div className="min-w-0"><div className="flex items-center gap-2"><p className="font-medium">{name}</p><Badge variant={ready ? "default" : "outline"}>{ready ? "Ready" : "Setup needed"}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{status?.message || "Provider status unavailable."}</p></div>
  </div>
}

function DisputeSkuImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (!src || failed) return <span className="grid size-8 shrink-0 place-items-center rounded border bg-muted"><Package className="size-4 text-muted-foreground" /></span>
  return <img src={src} alt={alt} className="size-8 shrink-0 rounded border bg-background object-contain" loading="lazy" onError={() => setFailed(true)} />
}

function DisputeSkuSelector({ groups, selectedSkus, onSelectionChange, onClear }: {
  groups: DisputeSkuOption[]
  selectedSkus: Set<string>
  onSelectionChange: (sku: string, selected: boolean) => void
  onClear: () => void
}) {
  return <Popover>
    <PopoverTrigger asChild><Button size="sm" variant={selectedSkus.size ? "secondary" : "outline"}><Boxes className="size-4" /> SKUs{selectedSkus.size ? ` (${selectedSkus.size})` : ""}</Button></PopoverTrigger>
    <PopoverContent align="end" sideOffset={8} className="w-[min(94vw,54rem)] overflow-hidden border-2 bg-popover p-0 shadow-2xl ring-1 ring-primary/20">
      <div className="flex items-start justify-between gap-3 border-b bg-muted/70 px-3 py-2">
        <div><p className="text-sm font-medium">Filter shipments by SKU</p><p className="text-xs text-muted-foreground">The dispute shows only shipments for checked SKUs.</p></div>
        {selectedSkus.size > 0 ? <Button size="sm" variant="ghost" className="h-7" onClick={onClear}>Clear</Button> : null}
      </div>
      <ScrollArea className="h-80 bg-popover">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-popover"><TableRow><TableHead className="w-9" /><TableHead>SKU</TableHead><TableHead className="w-12">Image</TableHead><TableHead>Title</TableHead><TableHead>Brand</TableHead><TableHead>Supplier</TableHead><TableHead className="text-right">Orders</TableHead></TableRow></TableHeader>
          <TableBody>{groups.map((group) => {
            const selected = selectedSkus.has(group.sku.toLowerCase())
            const shortTitle = group.title.length > 28 ? `${group.title.slice(0, 28)}...` : group.title
            return <TableRow key={group.sku} className="h-11 bg-popover hover:bg-accent/60">
              <TableCell className="py-1"><Checkbox aria-label={`Filter shipments for ${group.sku}`} checked={selected} onCheckedChange={(checked) => onSelectionChange(group.sku, checked === true)} /></TableCell>
              <TableCell className="max-w-36 truncate py-1 font-mono text-xs" title={group.sku}>{group.sku}</TableCell>
              <TableCell className="py-1"><DisputeSkuImage src={group.image} alt={group.title || group.sku} /></TableCell>
              <TableCell className="max-w-52 py-1 text-xs" title={group.title}><span className="line-clamp-2">{shortTitle || "-"}</span></TableCell>
              <TableCell className="max-w-28 truncate py-1 text-xs" title={group.brand}>{group.brand || "-"}</TableCell>
              <TableCell className="max-w-36 truncate py-1 text-xs" title={group.supplier}>{group.supplier || "-"}</TableCell>
              <TableCell className="py-1 text-right font-medium">{group.orderCount.toLocaleString()}</TableCell>
            </TableRow>
          })}{!groups.length ? <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No SKUs were found in these orders.</TableCell></TableRow> : null}</TableBody>
        </Table>
      </ScrollArea>
    </PopoverContent>
  </Popover>
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
  const [temuReport, setTemuReport] = useState<TemuReportImport | null>(null)
  const [query, setQuery] = useState("")
  const [selectedSkuFilters, setSelectedSkuFilters] = useState<Set<string>>(new Set())
  const [matchFilter, setMatchFilter] = useState("all")
  const [adjustmentFilter, setAdjustmentFilter] = useState("all")
  const [pageIndex, setPageIndex] = useState(0)
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
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
  useEffect(() => { setQuery(""); setSelectedSkuFilters(new Set()); setMatchFilter("all"); setAdjustmentFilter("all"); setPageIndex(0); setSelectedItemIds([]) }, [selectedId])
  useEffect(() => {
    if (!detail || detail.status !== "quoting") return
    const timer = window.setInterval(() => { void loadDetail(detail.id, true); void loadList(true) }, 2500)
    return () => window.clearInterval(timer)
  }, [detail?.id, detail?.status])

  const skuOptions = useMemo(() => {
    const groups = new Map<string, DisputeSkuOption & { orderIds: Set<string> }>()
    for (const item of detail?.items || []) {
      const orderId = item.orderId || item.inputReference
      for (const line of item.orderLines || []) {
        for (const sku of [...new Set([line.mappedSku, line.sku, line.originalSku].filter(Boolean))]) {
          const key = sku.toLowerCase()
          const current = groups.get(key) || { sku, image: "", title: "", brand: "", supplier: "", orderCount: 0, orderIds: new Set<string>() }
          current.image ||= line.image || ""
          current.title ||= line.title || sku
          current.brand ||= line.brand || ""
          current.supplier ||= line.supplier || ""
          current.orderIds.add(orderId)
          groups.set(key, current)
        }
      }
      for (const sku of item.skus || []) {
        const key = sku.toLowerCase()
        const current = groups.get(key) || { sku, image: "", title: sku, brand: "", supplier: "", orderCount: 0, orderIds: new Set<string>() }
        current.orderIds.add(orderId)
        groups.set(key, current)
      }
    }
    return [...groups.values()].map(({ orderIds, ...group }) => ({ ...group, orderCount: orderIds.size })).sort((left, right) => right.orderCount - left.orderCount || left.sku.localeCompare(right.sku, undefined, { numeric: true, sensitivity: "base" }))
  }, [detail?.items])
  const visibleItems = useMemo(() => {
    const value = query.trim().toLowerCase()
    return (detail?.items || []).filter((item) => {
      const matchesSku = !selectedSkuFilters.size || (item.skus || []).some((sku) => selectedSkuFilters.has(sku.toLowerCase()))
      if (!matchesSku) return false
      const matched = item.matchStatus === "matched"
      if (matchFilter === "matched" && !matched) return false
      if (matchFilter === "unmatched" && matched) return false
      const adjustmentAmount = Number(item.adjustmentEvidence?.expenseAmount || 0)
      if (adjustmentFilter === "charge" && !(adjustmentAmount > 0)) return false
      if (adjustmentFilter === "credit" && !(adjustmentAmount < 0)) return false
      if (adjustmentFilter === "none" && adjustmentAmount !== 0) return false
      if (!value) return true
      return [item.inputReference, item.orderNumber, item.channelOrderNumber, item.trackingNumber, item.channel, ...(item.skus || []), ...(item.orderLines || []).map((line) => line.title)]
        .some((candidate) => String(candidate || "").toLowerCase().includes(value))
    })
  }, [adjustmentFilter, detail?.items, matchFilter, query, selectedSkuFilters])
  const readyItems = (detail?.items || []).filter(readyToQuote)
  const visibleReadyItems = visibleItems.filter(readyToQuote)
  const visibleReadyIds = new Set(visibleReadyItems.map((item) => item.id))
  const selectedReadyItemIds = selectedItemIds.filter((itemId) => visibleReadyIds.has(itemId))
  const allVisibleReadySelected = Boolean(visibleReadyItems.length) && visibleReadyItems.every((item) => selectedReadyItemIds.includes(item.id))
  const pageCount = Math.max(1, Math.ceil(visibleItems.length / DISPUTE_PAGE_SIZE))
  const pagedItems = visibleItems.slice(pageIndex * DISPUTE_PAGE_SIZE, (pageIndex + 1) * DISPUTE_PAGE_SIZE)

  useEffect(() => { setPageIndex(0) }, [adjustmentFilter, matchFilter, query, selectedSkuFilters])
  useEffect(() => { if (pageIndex >= pageCount) setPageIndex(pageCount - 1) }, [pageCount, pageIndex])

  const createBatch = async () => {
    const references = temuReport?.references || referencesFromUpload(referenceText)
    if (!references.length) { toast.error("Paste or upload at least one order number."); return }
    if (references.length > DISPUTE_REFERENCE_LIMIT) { toast.error(`One dispute can contain at most ${DISPUTE_REFERENCE_LIMIT.toLocaleString()} unique order references.`); return }
    setCreating(true)
    try {
      const result = await api<{ batch: DisputeDetail }>("/api/accounting/shipping-disputes", {
        method: "POST",
        body: JSON.stringify({
          name: name || (temuReport ? "Temu shipping label purchase adjustments" : "Shipping dispute"),
          references,
          referenceEvidence: temuReport?.evidence || [],
          sourceFileName,
          importMeta: temuReport ? {
            importType: "temu_shipping_label_purchase_adjustment",
            importGroupId: temuReport.importGroupId,
            sequence: 1,
            totalBatches: 1,
            summary: temuReport.summary,
            sourceSummary: temuReport.summary,
          } : undefined,
        }),
      })
      setCreateOpen(false); setName(""); setReferenceText(""); setSourceFileName(""); setTemuReport(null)
      await loadList(true)
      setSelectedId(result.batch.id); setDetail(result.batch)
      toast.success(`${result.batch.totalItems} shipment row${result.batch.totalItems === 1 ? "" : "s"} loaded into one dispute.`)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to create shipping dispute.") }
    finally { setCreating(false) }
  }

  const quoteItems = async (itemIds?: string[], selectionMode = "all") => {
    if (!detail) return
    if (itemIds && !itemIds.length) { toast.error("Select at least one ready shipment to quote."); return }
    setQuoting(true)
    try {
      const result = await api<{ message?: string }>(`/api/accounting/shipping-disputes/${encodeURIComponent(detail.id)}/quote`, { method: "POST", body: JSON.stringify({ itemIds, selectionMode }) })
      toast.success(result.message || "Comparison quotes queued.")
      setSelectedItemIds([])
      await loadDetail(detail.id, true)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to queue comparison quotes.") }
    finally { setQuoting(false) }
  }

  const toggleVisibleReady = (checked: boolean) => {
    const visibleIds = visibleReadyItems.map((item) => item.id)
    setSelectedItemIds((current) => checked ? [...new Set([...current, ...visibleIds])] : current.filter((itemId) => !visibleIds.includes(itemId)))
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
      if (file.size > 10 * 1024 * 1024) throw new Error("Choose a CSV, text, or Excel file smaller than 10 MB.")
      const parsed = await referencesFromFile(file)
      if (!parsed.references.length) throw new Error(parsed.temuReport ? "This Temu report does not contain any Shipping label purchase adjustment rows." : "No order numbers were found in the uploaded file.")
      setTemuReport(parsed.temuReport || null)
      setReferenceText(parsed.temuReport ? "" : parsed.references.join("\n")); setSourceFileName(file.name)
      if (parsed.temuReport) {
        if (!name) setName("Temu shipping label purchase adjustments")
        toast.success(`${parsed.temuReport.summary.transactionCount.toLocaleString()} Temu shipping adjustments loaded for ${parsed.temuReport.summary.orderCount.toLocaleString()} orders.`)
      } else {
        toast.success(`${parsed.references.length} order reference${parsed.references.length === 1 ? "" : "s"} loaded from ${file.name}.`)
      }
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to read this file.") }
    finally { if (fileRef.current) fileRef.current.value = "" }
  }

  return <div className="grid min-w-0 gap-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-medium uppercase text-muted-foreground">Accounting</p><h1 className="text-2xl font-semibold">Shipping Disputes</h1><p className="mt-1 max-w-3xl text-sm text-muted-foreground">Compare historical package and billing evidence with current UPS and Veeqo rates. Quotes are evidence only and never alter orders, labels, or settlements.</p></div><Button onClick={() => setCreateOpen(true)}><FileUp className="size-4" /> New dispute</Button></div>

    <div className="grid gap-3 md:grid-cols-2"><ProviderCard name="UPS negotiated rates" status={providers.ups} /><ProviderCard name="Veeqo carrier rates" status={providers.veeqo} /></div>

    <div className="grid gap-2 border-y py-3 sm:grid-cols-3">
      {[
        ["1", "Upload report", "Choose a statement or order list."],
        ["2", "Review matched orders", "Filter by SKU and verify package evidence."],
        ["3", "Compare rates", "Quote one shipment, a selection, or the batch."],
      ].map(([step, title, description], index) => <div key={step} className="flex min-w-0 gap-3 px-2">
        <span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${detail || index === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{detail && index < 2 ? <CheckCircle2 className="size-4" /> : step}</span>
        <div className="min-w-0"><p className="text-sm font-medium">{title}</p><p className="text-xs text-muted-foreground">{description}</p></div>
      </div>)}
    </div>

    <div className="grid min-w-0 gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
      <Card className="min-w-0"><CardHeader className="pb-3"><div className="flex items-center justify-between"><div><CardTitle className="text-base">Disputes</CardTitle><CardDescription>{batches.length} recent disputes</CardDescription></div><Button size="icon-sm" variant="ghost" onClick={() => void loadList()} aria-label="Refresh disputes"><RefreshCw className="size-4" /></Button></div></CardHeader><CardContent className="p-0"><ScrollArea className="h-[610px]"><div className="grid gap-1 p-2">{loading ? <div className="flex items-center justify-center p-8 text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" /> Loading</div> : batches.map((batch) => <button key={batch.id} type="button" onClick={() => setSelectedId(batch.id)} className={`grid gap-1 rounded-md border px-3 py-2 text-left transition-colors ${selectedId === batch.id ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted"}`}><div className="flex items-center justify-between gap-2"><span className="font-medium">{batch.displayId}</span><Badge variant={statusVariant(batch.status)}>{statusLabel(batch.status)}</Badge></div><span className="truncate text-xs text-muted-foreground">{batch.name || "Shipping dispute"}</span><span className="text-xs text-muted-foreground">{batch.quotedItems}/{batch.totalItems} quoted · {dateLabel(batch.createdAt)}</span></button>)}{!loading && !batches.length ? <p className="p-8 text-center text-sm text-muted-foreground">No shipping disputes yet.</p> : null}</div></ScrollArea></CardContent></Card>

      <Card className="min-w-0"><CardHeader className="border-b"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><CardTitle className="text-lg">{detail?.displayId || "Select a dispute"}</CardTitle>{detail ? <Badge variant={statusVariant(detail.status)}>{statusLabel(detail.status)}</Badge> : null}</div><CardDescription>{detail ? `${detail.name} · ${detail.matchedItems} matched · ${detail.quotedItems} quoted${detail.sourceFileName ? ` · ${detail.sourceFileName}` : ""}` : "Choose a dispute or create a new one."}</CardDescription></div>{detail ? <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => window.location.assign(`/api/accounting/shipping-disputes/${encodeURIComponent(detail.id)}/export.csv`)}><Download className="size-4" /> Export CSV</Button><Button size="sm" disabled={quoting || detail.status === "quoting" || !readyItems.length} onClick={() => void quoteItems(undefined, "all")}>{quoting || detail.status === "quoting" ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Quote entire dispute ({readyItems.length})</Button></div> : null}</div></CardHeader><CardContent className="p-0">
        {detailLoading ? <div className="flex h-64 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" /> Loading shipment evidence</div> : detail ? <>
          {detail.raw?.importType === "temu_shipping_label_purchase_adjustment" ? <Alert className="m-4 w-auto"><CheckCircle2 className="size-4" /><AlertTitle>Temu shipping adjustment evidence</AlertTitle><AlertDescription>{Number(detail.raw.summary?.transactionCount || 0).toLocaleString()} adjustment transaction{Number(detail.raw.summary?.transactionCount || 0) === 1 ? "" : "s"} across {Number(detail.raw.summary?.orderCount || 0).toLocaleString()} orders in this dispute · net additional shipping expense {moneyLabel(Number(detail.raw.summary?.expenseAmount || 0))}. These rows support the dispute and do not post a second charge to accounting.</AlertDescription></Alert> : null}
          {(detail.items.some((item) => !["matched"].includes(item.matchStatus) || ["needs_package_data", "needs_address_review"].includes(item.status))) ? <Alert className="m-4 w-auto"><AlertTriangle className="size-4" /><AlertTitle>Review required before quoting</AlertTitle><AlertDescription>DataPlus automatically builds the quote package from each matched order's current catalog SKU measurements; Temu reports are not expected to include dimensions. Only unmatched orders, incomplete catalog measurements, or incomplete addresses require review.</AlertDescription></Alert> : null}
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
            <div className="relative min-w-56 flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input className="h-9 pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter order, channel order, tracking, or SKU" /></div>
            <DisputeSkuSelector groups={skuOptions} selectedSkus={selectedSkuFilters} onSelectionChange={(sku, selected) => setSelectedSkuFilters((current) => { const next = new Set(current); const key = sku.toLowerCase(); if (selected) next.add(key); else next.delete(key); return next })} onClear={() => setSelectedSkuFilters(new Set())} />
            <Select value={matchFilter} onValueChange={setMatchFilter}><SelectTrigger className="h-9 w-40" aria-label="Matched order filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All match states</SelectItem><SelectItem value="matched">Matched: Yes</SelectItem><SelectItem value="unmatched">Matched: No</SelectItem></SelectContent></Select>
            <Select value={adjustmentFilter} onValueChange={setAdjustmentFilter}><SelectTrigger className="h-9 w-44" aria-label="Statement adjustment filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All adjustments</SelectItem><SelectItem value="charge">Net charges</SelectItem><SelectItem value="credit">Net credits</SelectItem><SelectItem value="none">Net zero / none</SelectItem></SelectContent></Select>
            <Button size="sm" variant="outline" disabled={quoting || detail.status === "quoting" || !visibleReadyItems.length} onClick={() => void quoteItems(visibleReadyItems.map((item) => item.id), "filtered")}><Play className="size-4" /> Quote filtered ({visibleReadyItems.length})</Button>
            <span className="text-xs text-muted-foreground">{visibleItems.length} of {detail.items.length} shipment rows</span>
          </div>
          {selectedReadyItemIds.length ? <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-primary/5 px-4 py-2"><p className="text-sm font-medium">{selectedReadyItemIds.length} ready shipment{selectedReadyItemIds.length === 1 ? "" : "s"} selected</p><div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => setSelectedItemIds([])}>Clear</Button><Button size="sm" disabled={quoting || detail.status === "quoting"} onClick={() => void quoteItems(selectedReadyItemIds, "selected")}><Play className="size-4" /> Quote selected</Button></div></div> : null}
          <div className="max-h-[520px] overflow-auto"><Table><TableHeader className="sticky top-0 z-10 bg-background"><TableRow><TableHead className="w-10"><Checkbox aria-label="Select all ready filtered shipments" disabled={!visibleReadyItems.length} checked={allVisibleReadySelected ? true : selectedReadyItemIds.some((itemId) => visibleReadyItems.some((item) => item.id === itemId)) ? "indeterminate" : false} onCheckedChange={(checked) => toggleVisibleReady(checked === true)} /></TableHead><TableHead className="min-w-48">Order / shipment</TableHead><TableHead className="min-w-44">Order SKUs</TableHead><TableHead className="min-w-56">Quote package</TableHead><TableHead className="min-w-48">Carrier evidence</TableHead><TableHead className="min-w-44 text-right">Cost comparison</TableHead><TableHead className="min-w-52">Current comparison</TableHead><TableHead className="w-36">Status</TableHead><TableHead className="w-16 text-right">Action</TableHead></TableRow></TableHeader><TableBody>{pagedItems.map((item) => {
            const lowest = item.quotes[0]
            const adjustment = item.adjustmentEvidence
            const itemReady = readyToQuote(item)
            return <TableRow key={item.id} data-state={selectedReadyItemIds.includes(item.id) ? "selected" : undefined}>
              <TableCell><Checkbox aria-label={`Select order ${item.orderNumber || item.inputReference}`} disabled={!itemReady} checked={selectedReadyItemIds.includes(item.id)} onCheckedChange={(checked) => setSelectedItemIds((current) => checked === true ? [...new Set([...current, item.id])] : current.filter((itemId) => itemId !== item.id))} /></TableCell>
              <TableCell><div className="grid gap-1"><a className="font-medium text-primary hover:underline" href={item.orderId ? `/orders/${encodeURIComponent(item.orderId)}` : undefined}>{item.orderNumber || item.inputReference}</a><span className="text-xs text-muted-foreground">{item.channel || "Unknown channel"} · {item.channelOrderNumber || "No channel order"}</span><span className="text-xs text-muted-foreground">{item.trackingNumber || item.shipmentId || "No shipment reference"}</span><span className="text-xs text-muted-foreground">{[item.destination.city, item.destination.state, item.destination.postalCode].filter(Boolean).join(", ") || "Destination missing"}</span></div></TableCell>
              <TableCell><div className="grid gap-2">{item.orderLines.length ? item.orderLines.slice(0, 3).map((line, index) => { const primarySku = line.mappedSku || line.catalogSku || line.sku || line.originalSku; const productSku = line.catalogSku || line.mappedSku || line.sku; const channelSku = line.originalSku && line.originalSku !== primarySku ? line.originalSku : ""; return <div key={line.id || `${primarySku}-${index}`} className="flex min-w-0 items-center gap-2">{productSku ? <a className="shrink-0" href={`/products/${encodeURIComponent(productSku)}`}><DisputeSkuImage src={line.image} alt={line.title || primarySku} /></a> : <DisputeSkuImage src={line.image} alt={line.title || primarySku} />}<div className="min-w-0">{productSku ? <a className="block truncate font-mono text-xs font-medium text-primary hover:underline" href={`/products/${encodeURIComponent(productSku)}`} title={primarySku}>{primarySku || "SKU missing"}{line.quantity != null ? ` × ${line.quantity}` : ""}</a> : <p className="truncate font-mono text-xs font-medium" title={primarySku}>{primarySku || "SKU missing"}{line.quantity != null ? ` × ${line.quantity}` : ""}</p>}<p className="truncate text-xs text-muted-foreground" title={line.title}>{line.title || line.supplier || "Catalog details unavailable"}</p>{channelSku ? <p className="truncate text-xs text-muted-foreground">Channel: {channelSku}</p> : null}</div></div> }) : <span className="text-xs text-muted-foreground">No normalized order lines</span>}{item.orderLines.length > 3 ? <span className="text-xs text-muted-foreground">+{item.orderLines.length - 3} more lines</span> : null}</div></TableCell>
              <TableCell><p className={item.status === "needs_package_data" ? "font-medium text-destructive" : "font-medium"}>{packageText(item.package)}</p><p className="mt-1 text-xs text-muted-foreground">Source: {packageSourceLabel(item.package.source)}</p></TableCell>
              <TableCell><p className="font-medium">{billedPackageText(item.carrierBilledPackage)}</p><p className="mt-1 text-xs text-muted-foreground">{item.settlementId ? `Settlement ${item.settlementId}` : "No settlement dimensions linked"}</p></TableCell>
              <TableCell className="text-right"><p>Purchased {item.originalLabelCost == null ? "—" : moneyLabel(item.originalLabelCost)}</p>{adjustment ? <p className={adjustment.expenseAmount > 0 ? "font-medium text-destructive" : adjustment.expenseAmount < 0 ? "font-medium text-emerald-600" : "text-muted-foreground"} title={`${adjustment.transactionCount} statement row${adjustment.transactionCount === 1 ? "" : "s"}${adjustment.relatedIds.length ? ` · ${adjustment.relatedIds.join(", ")}` : ""}`}>Temu {adjustment.expenseAmount > 0 ? `charge ${moneyLabel(adjustment.expenseAmount)}` : adjustment.expenseAmount < 0 ? `credit ${moneyLabel(Math.abs(adjustment.expenseAmount))}` : "net zero"}</p> : null}<p>Billed {item.finalBilledCost == null ? "—" : moneyLabel(item.finalBilledCost)}</p><p className={Number(item.billingDifference || 0) > 0 ? "font-semibold text-destructive" : "text-muted-foreground"}>Difference {item.billingDifference == null ? "—" : moneyLabel(item.billingDifference)}</p></TableCell>
              <TableCell>{lowest ? <button type="button" className="grid text-left" onClick={() => setRatesItem(item)}><span className="font-semibold text-emerald-600">{moneyLabel(lowest.amount)}</span><span className="text-xs">{lowest.carrier} · {lowest.service}</span><span className="text-xs text-muted-foreground">{item.quotes.length} saved rate{item.quotes.length === 1 ? "" : "s"} · view all</span></button> : <span className="text-sm text-muted-foreground">{item.latestRun?.error || "Not quoted"}</span>}</TableCell>
              <TableCell><Badge variant={statusVariant(item.status)}>{statusLabel(item.status)}</Badge>{item.reviewReason ? <p className="mt-1 max-w-40 text-xs text-muted-foreground">{item.reviewReason}</p> : null}</TableCell>
              <TableCell className="text-right">{item.matchStatus === "matched" ? <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label={`Actions for order ${item.orderNumber || item.inputReference}`}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-52"><DropdownMenuItem disabled={!itemReady || quoting || detail.status === "quoting"} onSelect={() => void quoteItems([item.id], "single")}><RefreshCw className="size-4" /> Request current rates</DropdownMenuItem><DropdownMenuItem onSelect={() => openPackageEdit(item)}><PackageCheck className="size-4" /> Override quote package</DropdownMenuItem></DropdownMenuContent></DropdownMenu> : null}</TableCell>
            </TableRow>
          })}{!visibleItems.length ? <TableRow><TableCell colSpan={9} className="h-32 text-center text-muted-foreground">No shipment evidence matches this filter.</TableCell></TableRow> : null}</TableBody></Table></div>
          {visibleItems.length > DISPUTE_PAGE_SIZE ? <div className="flex items-center justify-between gap-3 border-t px-4 py-3"><p className="text-xs text-muted-foreground">Showing {(pageIndex * DISPUTE_PAGE_SIZE) + 1}-{Math.min((pageIndex + 1) * DISPUTE_PAGE_SIZE, visibleItems.length)} of {visibleItems.length}</p><div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={pageIndex === 0} onClick={() => setPageIndex((current) => Math.max(0, current - 1))}>Previous</Button><span className="text-xs text-muted-foreground">Page {pageIndex + 1} of {pageCount}</span><Button size="sm" variant="outline" disabled={pageIndex + 1 >= pageCount} onClick={() => setPageIndex((current) => Math.min(pageCount - 1, current + 1))}>Next</Button></div></div> : null}
        </> : <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground"><Truck className="size-8" /><p className="text-sm">Select a dispute.</p></div>}
      </CardContent></Card>
    </div>

    <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="max-h-[100dvh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>Start shipping dispute</DialogTitle><DialogDescription>Step 1 of 3: upload CSV, TXT, XLSX, or XLS, or paste order identifiers. One file creates one dispute, and loading matched orders does not request carrier rates.</DialogDescription></DialogHeader><div className="grid grid-cols-3 gap-2 border-y py-3 text-xs"><div className="font-medium text-primary">1. Upload</div><div className="text-muted-foreground">2. Review orders</div><div className="text-muted-foreground">3. Compare rates</div></div><div className="grid gap-4"><div className="grid gap-1.5"><Label>Dispute name</Label><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Temu UPS dimension overcharges - October" /></div><div className="grid gap-1.5"><div className="flex items-center justify-between"><Label>{temuReport ? "Temu report" : "Order references"}</Label><Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}><FileUp className="size-4" /> Upload file</Button></div>{temuReport ? <Alert><CheckCircle2 className="size-4" /><AlertTitle>Temu adjustment report recognized</AlertTitle><AlertDescription><span className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1"><span>{temuReport.summary.transactionCount.toLocaleString()} adjustment rows</span><span>{temuReport.summary.orderCount.toLocaleString()} unique orders</span><span>{temuReport.summary.debitCount.toLocaleString()} charges</span><span>{temuReport.summary.creditCount.toLocaleString()} credits</span><span className="col-span-2 font-medium">Net additional shipping expense: {moneyLabel(temuReport.summary.expenseAmount)}</span><span className="col-span-2">One dispute will be loaded. DataPlus processes large files in bounded internal chunks.</span></span></AlertDescription></Alert> : <Textarea className="min-h-48 font-mono text-sm" value={referenceText} onChange={(event) => { setReferenceText(event.target.value); setTemuReport(null); if (sourceFileName) setSourceFileName("") }} placeholder={"54571\nPO-211-17286699405434066\n17-15309-20107"} />}<input ref={fileRef} className="hidden" type="file" accept=".csv,.txt,.xlsx,.xls,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={(event) => void upload(event.target.files?.[0])} />{sourceFileName ? <div className="flex items-center justify-between gap-2"><p className="truncate text-xs text-muted-foreground">Loaded from {sourceFileName}</p><Button size="sm" variant="ghost" onClick={() => { setSourceFileName(""); setTemuReport(null); setReferenceText("") }}>Clear</Button></div> : null}</div></div><DialogFooter className="pb-[max(0.75rem,env(safe-area-inset-bottom))]"><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button disabled={creating} onClick={() => void createBatch()}>{creating ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} {creating ? "Loading one dispute" : "Load matching orders"}</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={Boolean(editItem)} onOpenChange={(open) => !open && setEditItem(null)}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Override quote package</DialogTitle><DialogDescription>DataPlus normally uses the current catalog SKU measurements. This override affects only this dispute quote; the catalog, order, label, and shipping report history remain unchanged.</DialogDescription></DialogHeader><div className="grid gap-4"><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><div className="grid gap-1.5"><Label>Weight (lb)</Label><Input type="number" min="0.01" step="0.01" value={editDraft.weight} onChange={(event) => setEditDraft({ ...editDraft, weight: event.target.value })} /></div><div className="grid gap-1.5"><Label>Length (in)</Label><Input type="number" min="0.01" step="0.01" value={editDraft.length} onChange={(event) => setEditDraft({ ...editDraft, length: event.target.value })} /></div><div className="grid gap-1.5"><Label>Width (in)</Label><Input type="number" min="0.01" step="0.01" value={editDraft.width} onChange={(event) => setEditDraft({ ...editDraft, width: event.target.value })} /></div><div className="grid gap-1.5"><Label>Height (in)</Label><Input type="number" min="0.01" step="0.01" value={editDraft.height} onChange={(event) => setEditDraft({ ...editDraft, height: event.target.value })} /></div></div><div className="grid gap-1.5"><Label>Reason for override</Label><Textarea value={editDraft.reason} onChange={(event) => setEditDraft({ ...editDraft, reason: event.target.value })} placeholder="Verified against the physical sell unit or corrected catalog package." /></div></div><DialogFooter><Button variant="outline" onClick={() => setEditItem(null)}>Cancel</Button><Button onClick={() => void savePackage()}>Save override</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={Boolean(ratesItem)} onOpenChange={(open) => !open && setRatesItem(null)}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Current comparison rates</DialogTitle><DialogDescription>{ratesItem?.orderNumber} · requested {dateLabel(ratesItem?.latestRun?.requestedAt)}</DialogDescription></DialogHeader><Alert><AlertTriangle className="size-4" /><AlertTitle>Supporting evidence, not a historical re-rate</AlertTitle><AlertDescription>Fuel, accessorial charges, service availability, and negotiated pricing can change. The original label purchase snapshot and final carrier bill remain the historical accounting evidence.</AlertDescription></Alert><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Rank</TableHead><TableHead>Provider</TableHead><TableHead>Carrier / service</TableHead><TableHead className="text-right">Rate</TableHead><TableHead>Delivery</TableHead></TableRow></TableHeader><TableBody>{(ratesItem?.quotes || []).map((quote) => <TableRow key={`${quote.rank}-${quote.provider}-${quote.service}`}><TableCell>{quote.rank}</TableCell><TableCell>{statusLabel(quote.provider)}</TableCell><TableCell><p className="font-medium">{quote.carrier}</p><p className="text-xs text-muted-foreground">{quote.service}</p></TableCell><TableCell className="text-right font-semibold">{moneyLabel(quote.amount)}</TableCell><TableCell>{quote.deliveryEstimate || (quote.deliveryDays ? `${quote.deliveryDays} days` : "Not provided")}</TableCell></TableRow>)}</TableBody></Table></div><DialogFooter><Button onClick={() => setRatesItem(null)}>Close</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
