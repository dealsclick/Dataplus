import { Alert,AlertDescription,AlertTitle } from "@/components/ui/alert"
import { AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { Calendar } from "@/components/ui/calendar"
import { Card,CardContent,CardDescription,CardFooter,CardHeader,CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Command,CommandEmpty,CommandGroup,CommandInput,CommandItem,CommandList } from "@/components/ui/command"
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { FieldLabel,Field as FormField } from "@/components/ui/field"
import { HoverCard,HoverCardContent,HoverCardTrigger } from "@/components/ui/hover-card"
import { Empty,EmptyDescription,EmptyHeader,EmptyMedia,EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { InputGroup,InputGroupAddon,InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Popover,PopoverContent,PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs,TabsContent,TabsList,TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip,TooltipContent,TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  Ban,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Clock3,
  Copy,
  ExternalLink,
  FileDown,
  FileText,
  Info,
  Link2,
  Loader2,
  MapPin,
  Mail,
  MessageSquare,
  MoreHorizontal,
  PackageCheck,
  Pencil,
  Phone,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  SendHorizontal,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Truck,
  Users,
  X
} from "lucide-react"
import { useEffect,useRef,useState } from "react"
import { toast } from "sonner"
import type {
  ProductItem,
  QuickProductResult
} from "../App"
import {
  orderHref
} from "../App"
import { api,dateLabel,moneyLabel,numberLabel } from "../lib/client-api"

import { Detail,Field,PageHeader } from "./app-ui"
import { channelOrderNumberFor,channelOrderUrlFor,detectedTrackingUpdate,detectTrackingCarrier,enabledCarrierNames,enabledCarrierServices,UniversalShippingLabelDialog,useFulfillmentCarriers } from "./order-workspaces"
import { CatalogImage } from "./product-workspaces"
import { shipmentTrackingCarriers,trackingUrlForShipment } from "./shipment-links"
import type { QuoteTermDefinition } from "./quote-terms-settings"

const quotePdfVersions = [
  { id: "standard", title: "Standard quote", description: "SKU, description, quantity, unit price, and line total." },
  { id: "savings", title: "Savings proposal", description: "Adds MSRP, customer price, and savings by line and in total." },
  { id: "summary", title: "Compact summary", description: "A shorter customer view with item, quantity, and total only." },
] as const

function quoteDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function quoteDateAfter(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return quoteDateKey(date)
}

function quoteLocalDateTime(value: unknown) {
  const date = new Date(String(value || ""))
  if (!Number.isFinite(date.getTime())) return ""
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function quoteIsoDateTime(value: string) {
  if (!value) return ""
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : ""
}

type QuoteCarrierRate = {
  id: string
  providerId: string
  providerName?: string
  carrier: string
  service: string
  serviceCode?: string
  amount: number
  currency: string
  deliveryDays?: number
  deliveryEstimate?: string
  quotedAt?: string
  expiresAt: string
  warning?: string
}

type QuoteCarrierAccess = { id: string; name: string; enabled: boolean; companyRates: boolean }
type QuoteCarrierPreference = { selectionMode: "lowest_cost" | "preferred_carrier"; preferredProviderId: string; rateTtlMinutes: number }
type QuoteAddressValidation = { status: string; providerId?: string; message?: string; address?: Record<string, unknown> }
type QuoteSupplierOption = {
  key: string
  productId?: string
  vendorId?: string
  supplierName: string
  supplierCode?: string
  supplierSku?: string
  sourceSku?: string
  vendorSku?: string
  managedSku?: string
  cost: number | null
  qty?: number | null
  uom?: string
  matchType?: string
  requiresReview?: boolean
  selectable?: boolean
  related?: boolean
  isPrimary?: boolean
}
type QuoteCatalogPricing = { mapPrice: number | null; listPrice: number | null }
type QuoteCatalogProduct = {
  id: string
  sku: string
  sourceSku?: string
  title: string
  image?: string
  manufacturerPartNumber?: string
  barcode?: string
  matchBasis?: string
  reviewRequired?: boolean
}
type CompetitorProductFacts = {
  title: string
  brand: string
  description: string
  gtin: string
  sku: string
  mpn: string
  imageUrl: string
  competitorPrice: number | null
  currency: string
  structuredDataFound: boolean
  identifiersFound: number
}
type CompetitorCatalogMatch = ProductItem & {
  matchBasis: string
  reviewRequired: boolean
  confirmedIdentifier: boolean
  manufacturerPartNumber?: string
  barcode?: string
}
type CompetitorInspection = {
  inspectionId: string
  sourceUrl: string
  sourceHost: string
  inspectedAt: string
  expiresAt: string
  extractionProvider?: "scrapegraphai" | "direct"
  providerWarning?: string
  product: CompetitorProductFacts
  matches: CompetitorCatalogMatch[]
  confirmedMatchCount: number
  message: string
}
type QuoteLineForm = {
  sku: string
  title: string
  image: string
  sourcePageSku: string
  catalogProductId: string
  catalogMatchedSku: string
  catalogMatchBasis: string
  catalogMatchReviewRequired: boolean
  manufacturerPartNumber: string
  barcode: string
  qty: string
  msrp: string
  mapPrice: string
  price: string
  cost: string
  autoPrice: boolean
  selectedSupplierKey: string
  selectedSupplierId: string
  selectedSupplierName: string
  selectedSupplierCode: string
  selectedSupplierSku: string
  selectedSupplierProductId: string
  selectedSupplierUom: string
}

function quoteLineCost(line: Pick<QuoteLineForm, "cost"> | Record<string, unknown>) {
  if (line.cost === null || line.cost === undefined || line.cost === "") return null
  const value = Number(line.cost)
  return Number.isFinite(value) && value >= 0 ? value : null
}

function quoteMarginPercent(revenue: number, cost: number) {
  return revenue > 0 ? ((revenue - cost) / revenue) * 100 : null
}

function quoteRecommendedPrice(cost: number | null, mapPrice: string | number | null | undefined) {
  const map = Math.max(0, Number(mapPrice || 0))
  if (map > 0) return map
  return cost === null ? 0 : Math.round((cost * 1.3 + Number.EPSILON) * 100) / 100
}

function quoteAddressLines(value: unknown, fallbackName = "") {
  const address = value && typeof value === "object" ? value as Record<string, unknown> : {}
  const locality = [address.city || address.town, address.state || address.province, address.postalCode || address.zip || address.postcode]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ")
  return [
    address.name || fallbackName,
    address.company,
    address.line1 || address.address1,
    address.line2 || address.address2,
    locality,
    address.country || address.countryCode,
  ].map((part) => String(part || "").trim()).filter(Boolean)
}

function quoteAddressFingerprint(value: unknown, fallbackName = "") {
  return quoteAddressLines(value, fallbackName).map((part) => part.toLowerCase().replace(/[^a-z0-9]/g, "")).join("|")
}

function quoteDisplaySupplierOption(line: Record<string, unknown>, options: QuoteSupplierOption[]) {
  const selectable = options.filter((option) => option.selectable !== false && !option.requiresReview)
  const selectedKey = String(line.selectedSupplierKey || "").trim()
  const selectedName = String(line.selectedSupplierName || "").trim().toLowerCase()
  const selectedSku = String(line.selectedSupplierSku || "").trim().toLowerCase()
  const selected = selectable.find((option) => selectedKey && option.key === selectedKey)
    || selectable.find((option) => selectedName && option.supplierName.toLowerCase() === selectedName && (!selectedSku || [option.supplierSku, option.sourceSku, option.vendorSku].some((value) => String(value || "").trim().toLowerCase() === selectedSku)))
  if (selected) return { option: selected, suggested: false }
  const primary = selectable.find((option) => option.isPrimary && option.cost !== null)
  const available = selectable.filter((option) => option.cost !== null && option.qty !== null && option.qty !== undefined && Number(option.qty) > 0)
  const lowestAvailable = available.reduce<QuoteSupplierOption | null>((best, option) => !best || Number(option.cost) < Number(best.cost) ? option : best, null)
  const lowest = selectable.filter((option) => option.cost !== null).reduce<QuoteSupplierOption | null>((best, option) => !best || Number(option.cost) < Number(best.cost) ? option : best, null)
  return { option: lowestAvailable || lowest || primary || selectable[0] || null, suggested: true }
}

function QuoteSupplierPicker({ line, options, loading, onSelect }: { line: QuoteLineForm; options: QuoteSupplierOption[]; loading: boolean; onSelect: (option: QuoteSupplierOption) => void }) {
  const [open, setOpen] = useState(false)
  const selected = options.find((option) => option.key === line.selectedSupplierKey)
  const selectedCost = quoteLineCost(line)
  const knownOptions = options.filter((option) => option.selectable !== false && !option.requiresReview && option.cost !== null)
  const lowest = knownOptions.reduce<QuoteSupplierOption | null>((best, option) => !best || Number(option.cost) < Number(best.cost) ? option : best, null)
  const cheaper = selectedCost !== null && lowest && lowest.cost !== null && Number(lowest.cost) < selectedCost ? lowest : null
  const supplierName = selected?.supplierName || line.selectedSupplierName
  const catalogMatched = Boolean(line.catalogProductId)
  const emptyLabel = catalogMatched ? (line.catalogMatchReviewRequired ? "Catalog candidate" : "Catalog matched") : "No catalog match"
  const emptyDetail = catalogMatched ? "Add BuySupply supplier cost" : "Product was not found"
  return <div className="grid min-w-52 gap-1.5">
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="h-auto min-h-10 w-full justify-between px-3 py-2 text-left" disabled={loading && !options.length}>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{loading ? "Loading suppliers..." : supplierName || (options.length ? "Choose supplier" : emptyLabel)}</span>
            <span className="block truncate text-xs text-muted-foreground">{options.length ? `${options.length} supplier option${options.length === 1 ? "" : "s"}` : emptyDetail}{selectedCost !== null ? ` · ${moneyLabel(selectedCost)}` : ""}</span>
          </span>
          {loading ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <Users className="size-4 shrink-0 text-muted-foreground" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(94vw,430px)] p-0">
        <Command>
          <CommandInput placeholder="Search supplier or supplier SKU..." />
          <CommandList>
            <CommandEmpty>No supplier cost records found.</CommandEmpty>
            <CommandGroup heading="Supplier options">
              {options.map((option) => {
                const isLowest = option.cost !== null && lowest?.key === option.key
                const disabled = option.selectable === false || option.requiresReview
                return <CommandItem key={option.key} disabled={disabled} value={`${option.supplierName} ${option.supplierCode || ""} ${option.supplierSku || ""}`} onSelect={() => { if (!disabled) { onSelect(option); setOpen(false) } }} className="items-start py-3">
                  <CheckCircle2 className={cn("mt-0.5 size-4 shrink-0", option.key === line.selectedSupplierKey ? "text-emerald-600" : "text-transparent")} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5"><span className="font-medium">{option.supplierName}</span>{isLowest ? <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">Lowest cost</Badge> : null}{option.related ? <Badge variant="outline">Related SKU</Badge> : null}{disabled ? <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">Review required</Badge> : null}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">Supplier SKU {option.supplierSku || option.sourceSku || option.vendorSku || "-"}{option.uom ? ` · ${option.uom}` : ""}{option.qty !== null && option.qty !== undefined ? ` · ${numberLabel(option.qty)} available` : ""}</span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">{option.cost === null ? "Unknown" : moneyLabel(option.cost)}</span>
                </CommandItem>
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
    {cheaper ? <p className="text-xs font-medium text-emerald-600">Save {moneyLabel(Number(selectedCost) - Number(cheaper.cost))}/unit with {cheaper.supplierName}</p> : selected && lowest?.key === selected.key ? <p className="text-xs font-medium text-emerald-600">Lowest known supplier cost selected</p> : null}
  </div>
}

export function DraftQuoteFieldDetailPage() {
  const draftId = decodeURIComponent((window.location.pathname.split("/")[2] || "").trim())
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null)
  const [customerProfileId, setCustomerProfileId] = useState("")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorSection, setEditorSection] = useState<"items" | "customer" | "delivery" | "terms" | "notes">("items")
  const [exportOpen, setExportOpen] = useState(false)
  const [exportVariant, setExportVariant] = useState<"standard" | "savings" | "summary">("standard")
  const [voidOpen, setVoidOpen] = useState(false)
  const [voidReason, setVoidReason] = useState("")
  const [expirationCalendarOpen, setExpirationCalendarOpen] = useState(false)
  const [catalogQuery, setCatalogQuery] = useState("")
  const [catalogResults, setCatalogResults] = useState<ProductItem[]>([])
  const [catalogSearching, setCatalogSearching] = useState(false)
  const [similarOpen, setSimilarOpen] = useState(false)
  const [similarLoading, setSimilarLoading] = useState(false)
  const [similarLineIndex, setSimilarLineIndex] = useState(-1)
  const [similarResults, setSimilarResults] = useState<Array<Record<string, unknown>>>([])
  const [competitorOpen, setCompetitorOpen] = useState(false)
  const [competitorUrl, setCompetitorUrl] = useState("")
  const [competitorBusy, setCompetitorBusy] = useState(false)
  const [competitorCreateBusy, setCompetitorCreateBusy] = useState(false)
  const [competitorInspection, setCompetitorInspection] = useState<CompetitorInspection | null>(null)
  const [competitorDraft, setCompetitorDraft] = useState({ title: "", brand: "", gtin: "", mpn: "", description: "" })
  const [warehouses, setWarehouses] = useState<Array<Record<string, unknown>>>([])
  const [quoteTermOptions, setQuoteTermOptions] = useState<QuoteTermDefinition[]>([])
  const [quoteCarriers, setQuoteCarriers] = useState<QuoteCarrierAccess[]>([])
  const [carrierPreference, setCarrierPreference] = useState<QuoteCarrierPreference>({ selectionMode: "lowest_cost", preferredProviderId: "", rateTtlMinutes: 30 })
  const [shippingOpen, setShippingOpen] = useState(false)
  const [shippingBusy, setShippingBusy] = useState(false)
  const [shippingRates, setShippingRates] = useState<QuoteCarrierRate[]>([])
  const [shippingProviderErrors, setShippingProviderErrors] = useState<Array<{ provider?: string; message?: string }>>([])
  const [shippingAddressValidation, setShippingAddressValidation] = useState<QuoteAddressValidation | null>(null)
  const [selectedShippingRateId, setSelectedShippingRateId] = useState("")
  const [shippingWarehouseId, setShippingWarehouseId] = useState("")
  const [shippingPackage, setShippingPackage] = useState({ weight: "", length: "", width: "", height: "" })
  const [supplierOptionsBySku, setSupplierOptionsBySku] = useState<Record<string, QuoteSupplierOption[]>>({})
  const [supplierOptionsLoading, setSupplierOptionsLoading] = useState<Set<string>>(new Set())
  const autoEditOpenedRef = useRef(false)
  const [form, setForm] = useState({
    buyer: "", buyerEmail: "", phone: "", source: "Manual", status: "draft", note: "", customerNote: "",
    salesOwner: "", nextAction: "", nextFollowUpAt: "",
    taxExempt: false, taxMode: "rate" as "rate" | "manual", taxRate: "", taxAmount: "",
    expiresAt: quoteDateAfter(30), selectedTermIds: [] as string[], customTerms: "",
    line1: "", line2: "", city: "", state: "", postalCode: "", country: "US",
    items: [] as QuoteLineForm[],
  })
  const supplierLookupKey = [...new Set(form.items.map((line) => line.sku.trim().toLowerCase()).filter((sku) => sku.length >= 2))].sort().join("|")
  const draftSupplierLookupKey = [...new Set((Array.isArray(draft?.items) ? draft.items : []).map((line) => String((line as Record<string, unknown>).sku || "").trim().toLowerCase()).filter((sku) => sku.length >= 2))].sort().join("|")

  const load = async () => {
    setLoading(true)
    try {
      const result = await api<{ draft?: Record<string, unknown>; customerId?: string; warehouses?: Array<Record<string, unknown>>; quoteTerms?: QuoteTermDefinition[]; carriers?: QuoteCarrierAccess[]; carrierPreference?: QuoteCarrierPreference }>(`/api/order-drafts/${encodeURIComponent(draftId)}`)
      setDraft(result.draft || null)
      setCustomerProfileId(String(result.customerId || result.draft?.customerId || ""))
      setQuoteTermOptions(result.quoteTerms || [])
      setWarehouses(result.warehouses || [])
      setQuoteCarriers(result.carriers || [])
      setCarrierPreference(result.carrierPreference || { selectionMode: "lowest_cost", preferredProviderId: "", rateTtlMinutes: 30 })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load quote.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [draftId])
  useEffect(() => {
    if (!draftSupplierLookupKey) return
    const skus = draftSupplierLookupKey.split("|")
    const controller = new AbortController()
    setSupplierOptionsLoading((current) => new Set([...current, ...skus]))
    Promise.all(skus.map(async (sku) => {
      try {
        const result = await api<{ options?: QuoteSupplierOption[] }>(`/api/order-drafts/${encodeURIComponent(draftId)}/supplier-options?sku=${encodeURIComponent(sku)}`, { signal: controller.signal })
        return [sku, result.options || []] as const
      } catch {
        return [sku, [] as QuoteSupplierOption[]] as const
      }
    })).then((entries) => {
      if (!controller.signal.aborted) setSupplierOptionsBySku((current) => ({ ...current, ...Object.fromEntries(entries) }))
    }).finally(() => {
      if (controller.signal.aborted) return
      setSupplierOptionsLoading((current) => {
        const next = new Set(current)
        for (const sku of skus) next.delete(sku)
        return next
      })
    })
    return () => controller.abort()
  }, [draftId, draftSupplierLookupKey])
  useEffect(() => {
    const query = catalogQuery.trim()
    if (!editorOpen || query.length < 2) { setCatalogResults([]); return }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setCatalogSearching(true)
      api<{ inventory?: ProductItem[] }>(`/api/inventory?q=${encodeURIComponent(query)}&limit=8&fastPage=1`)
        .then((result) => { if (!cancelled) setCatalogResults(result.inventory || []) })
        .catch(() => { if (!cancelled) setCatalogResults([]) })
        .finally(() => { if (!cancelled) setCatalogSearching(false) })
    }, 180)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [catalogQuery, editorOpen])

  useEffect(() => {
    if (!editorOpen || !supplierLookupKey) return
    const skus = supplierLookupKey.split("|")
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setSupplierOptionsLoading(new Set(skus))
      Promise.all(skus.map(async (sku) => {
        try {
          const result = await api<{ product?: QuoteCatalogProduct | null; options?: QuoteSupplierOption[]; mapPrice?: number | null; listPrice?: number | null }>(`/api/order-drafts/${encodeURIComponent(draftId)}/supplier-options?sku=${encodeURIComponent(sku)}`, { signal: controller.signal })
          return [sku, { product: result.product || null, options: result.options || [], mapPrice: result.mapPrice ?? null, listPrice: result.listPrice ?? null }] as const
        } catch (error) {
          if (!(error instanceof DOMException && error.name === "AbortError")) toast.error(error instanceof Error ? error.message : `Unable to load suppliers for ${sku}.`)
          return [sku, { product: null as QuoteCatalogProduct | null, options: [] as QuoteSupplierOption[], mapPrice: null, listPrice: null }] as const
        }
      })).then((entries) => {
        if (controller.signal.aborted) return
        const loaded: Record<string, QuoteSupplierOption[]> = Object.fromEntries(entries.map(([sku, result]) => [sku, result.options]))
        const pricing: Record<string, QuoteCatalogPricing> = Object.fromEntries(entries.map(([sku, result]) => [sku, { mapPrice: result.mapPrice, listPrice: result.listPrice }]))
        setSupplierOptionsBySku((current) => ({ ...current, ...loaded }))
        setForm((current) => ({
          ...current,
          items: current.items.map((line) => {
            const key = line.sku.trim().toLowerCase()
            const options = loaded[key] || []
            const productPricing = pricing[key]
            const product = entries.find(([sku]) => sku === key)?.[1].product
            const mapPrice = Number(line.mapPrice || 0) > 0 ? line.mapPrice : productPricing?.mapPrice ? String(productPricing.mapPrice) : line.mapPrice
            const msrp = Number(line.msrp || 0) > 0 ? line.msrp : productPricing?.listPrice ? String(productPricing.listPrice) : line.msrp
            const pricedLine = {
              ...line,
              title: product?.title || line.title,
              image: product?.image || line.image,
              catalogProductId: product?.id || line.catalogProductId,
              catalogMatchedSku: product?.sku || line.catalogMatchedSku,
              catalogMatchBasis: product?.matchBasis || line.catalogMatchBasis,
              catalogMatchReviewRequired: product?.reviewRequired ?? line.catalogMatchReviewRequired,
              manufacturerPartNumber: product?.manufacturerPartNumber || line.manufacturerPartNumber,
              barcode: product?.barcode || line.barcode,
              mapPrice,
              msrp,
              price: line.autoPrice ? String(quoteRecommendedPrice(quoteLineCost(line), mapPrice)) : line.price,
            }
            if (!options.length || line.selectedSupplierKey) return pricedLine
            const matchingName = options.find((option) => option.selectable !== false && option.supplierName.toLowerCase() === line.selectedSupplierName.toLowerCase())
            const preferred = matchingName || options.find((option) => option.selectable !== false && option.isPrimary) || options.find((option) => option.selectable !== false && !option.requiresReview && option.cost !== null)
            return preferred ? {
              ...pricedLine,
              mapPrice,
              msrp,
              cost: preferred.cost === null ? "" : String(preferred.cost),
              price: line.autoPrice ? String(quoteRecommendedPrice(preferred.cost, mapPrice)) : line.price,
              selectedSupplierKey: preferred.key,
              selectedSupplierId: preferred.vendorId || "",
              selectedSupplierName: preferred.supplierName,
              selectedSupplierCode: preferred.supplierCode || "",
              selectedSupplierSku: preferred.supplierSku || preferred.sourceSku || preferred.vendorSku || "",
              selectedSupplierProductId: preferred.productId || "",
              selectedSupplierUom: preferred.uom || "",
            } : pricedLine
          }),
        }))
      }).finally(() => { if (!controller.signal.aborted) setSupplierOptionsLoading(new Set()) })
    }, 250)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [draftId, editorOpen, supplierLookupKey])

  const openEditor = () => {
    if (!draft) return
    if (["void", "voided"].includes(String(draft.status || "").toLowerCase())) { toast.error("Duplicate this quote to create a new active revision."); return }
    const address = (draft.shippingAddress || {}) as Record<string, unknown>
    const items = Array.isArray(draft.items) ? draft.items as Array<Record<string, unknown>> : []
    setForm({
      buyer: String(draft.buyer || ""), buyerEmail: String(draft.buyerEmail || ""), phone: String(draft.phone || ""),
      source: String(draft.source || "Manual"), status: String(draft.status || "draft"), note: String(draft.note || ""),
      salesOwner: String(draft.salesOwner || ""), nextAction: String(draft.nextAction || ""), nextFollowUpAt: quoteLocalDateTime(draft.nextFollowUpAt),
      customerNote: String(draft.customerNote || ""), expiresAt: String(draft.expiresAt || quoteDateAfter(30)),
      taxExempt: draft.taxExempt === true, taxMode: String(draft.taxMode || "rate") === "manual" ? "manual" : "rate",
      taxRate: String(draft.taxRate || ""), taxAmount: String(draft.taxAmount || ""),
      selectedTermIds: Array.isArray(draft.selectedTermIds) ? draft.selectedTermIds.map(String) : [], customTerms: String(draft.customTerms || ""),
      line1: String(address.line1 || address.address1 || ""), line2: String(address.line2 || address.address2 || ""), city: String(address.city || ""),
      state: String(address.state || address.province || ""), postalCode: String(address.postalCode || address.zip || ""), country: String(address.country || "US"),
      items: items.map((item) => {
        const cost = quoteLineCost(item)
        const mapPrice = String(item.mapPrice || 0)
        const price = Number(item.price || 0)
        const recommended = quoteRecommendedPrice(cost, mapPrice)
        const previousCostMarkup = cost === null ? 0 : Math.round((cost * 1.3 + Number.EPSILON) * 100) / 100
        const previousDefault = Math.max(previousCostMarkup, Number(mapPrice || 0))
        const legacyMatchesDefault = (recommended > 0 && Math.abs(price - recommended) < 0.005) || (previousDefault > 0 && Math.abs(price - previousDefault) < 0.005)
        return {
          sku: String(item.sku || ""), title: String(item.title || ""), qty: String(item.qty || 1), msrp: String(item.msrp || 0), price: String(price),
          image: String(item.image || item.defaultImage || ""), sourcePageSku: String(item.sourcePageSku || ""), catalogProductId: String(item.catalogProductId || ""),
          catalogMatchedSku: String(item.catalogMatchedSku || ""), catalogMatchBasis: String(item.catalogMatchBasis || ""), catalogMatchReviewRequired: item.catalogMatchReviewRequired === true,
          manufacturerPartNumber: String(item.manufacturerPartNumber || item.mfrPartNumber || ""), barcode: String(item.barcode || ""),
          mapPrice, autoPrice: item.priceOverridden === false || (item.priceOverridden !== true && legacyMatchesDefault),
          cost: item.cost === null || item.cost === undefined ? "" : String(item.cost),
          selectedSupplierKey: String(item.selectedSupplierKey || ""), selectedSupplierId: String(item.selectedSupplierId || ""),
          selectedSupplierName: String(item.selectedSupplierName || ""), selectedSupplierCode: String(item.selectedSupplierCode || ""),
          selectedSupplierSku: String(item.selectedSupplierSku || ""), selectedSupplierProductId: String(item.selectedSupplierProductId || ""),
          selectedSupplierUom: String(item.selectedSupplierUom || ""),
        }
      }),
    })
    setCatalogQuery("")
    setCatalogResults([])
    setSupplierOptionsBySku({})
    setSupplierOptionsLoading(new Set())
    setEditorSection("customer")
    setEditorOpen(true)
  }

  useEffect(() => {
    if (loading || !draft || autoEditOpenedRef.current) return
    if (new URLSearchParams(window.location.search).get("edit") !== "1") return
    autoEditOpenedRef.current = true
    openEditor()
    window.history.replaceState({}, "", `/drafts/${encodeURIComponent(draftId)}`)
  }, [loading, draft, draftId])

  const updateLine = (index: number, patch: Partial<QuoteLineForm>) => setForm((current) => ({ ...current, items: current.items.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line) }))
  const addCatalogItem = (item: ProductItem, notify = true) => {
    const sku = String(item.sku || "").trim()
    if (!sku) return
    const rawCost = item.sellUnitCost ?? item.sourceCost ?? item.cost
    const initialCost = rawCost === null || rawCost === undefined || !Number.isFinite(Number(rawCost)) || Number(rawCost) < 0 ? null : Number(rawCost)
    const initialMap = Math.max(0, Number(item.mapPrice || 0))
    setForm((current) => {
      const existing = current.items.findIndex((line) => line.sku.toLowerCase() === sku.toLowerCase())
      if (existing >= 0) return { ...current, items: current.items.map((line, index) => index === existing ? { ...line, qty: String(Math.max(1, Number(line.qty || 0)) + 1) } : line) }
      return { ...current, items: [...current.items, {
        sku, title: String(item.title || item.marketplaceTitle || sku), qty: "1", msrp: String(item.listPrice ?? item.msrp ?? 0), mapPrice: String(initialMap),
        image: String(item.defaultImage || ""), sourcePageSku: String(item.sourceSku || sku), catalogProductId: String(item.id || item.productCatalogId || ""),
        catalogMatchedSku: sku, catalogMatchBasis: "Catalog selection", catalogMatchReviewRequired: false,
        manufacturerPartNumber: String(item.mfrPartNumber || ""), barcode: String(item.barcode || ""),
        price: String(quoteRecommendedPrice(initialCost, initialMap)), cost: initialCost === null ? "" : String(initialCost), autoPrice: true,
        selectedSupplierKey: "", selectedSupplierId: "", selectedSupplierName: String(item.supplier || item.vendor || ""), selectedSupplierCode: String(item.supplierCode || ""),
        selectedSupplierSku: String(item.vendorSku || item.sourceSku || ""), selectedSupplierProductId: String(item.id || item.productCatalogId || ""), selectedSupplierUom: String(item.uom || ""),
      }] }
    })
    setCatalogQuery("")
    setCatalogResults([])
    if (notify) toast.success(`${sku} added to the quote.`)
  }
  const openCompetitorLookup = () => {
    setCompetitorUrl("")
    setCompetitorInspection(null)
    setCompetitorDraft({ title: "", brand: "", gtin: "", mpn: "", description: "" })
    setCompetitorOpen(true)
  }
  const inspectCompetitorUrl = async () => {
    if (!competitorUrl.trim()) return toast.error("Paste a public product URL.")
    setCompetitorBusy(true)
    try {
      const result = await api<CompetitorInspection>(`/api/order-drafts/${encodeURIComponent(draftId)}/competitor-product/inspect`, { method: "POST", body: JSON.stringify({ url: competitorUrl.trim() }) })
      setCompetitorInspection(result)
      setCompetitorDraft({
        title: result.product.title || "",
        brand: result.product.brand || "",
        gtin: result.product.gtin || "",
        mpn: result.product.mpn || "",
        description: result.product.description || "",
      })
      if (result.matches.length) toast.success(result.message)
      else toast.message(result.message)
    } catch (error) {
      setCompetitorInspection(null)
      toast.error(error instanceof Error ? error.message : "Unable to inspect this product page.")
    } finally { setCompetitorBusy(false) }
  }
  const addCompetitorMatch = (match: CompetitorCatalogMatch) => {
    addCatalogItem(match)
    setCompetitorOpen(false)
  }
  const createCompetitorSku = async () => {
    if (!competitorInspection || !competitorDraft.title.trim()) return toast.error("Enter a product title before creating the draft SKU.")
    setCompetitorCreateBusy(true)
    try {
      const result = await api<{ product: ProductItem; message?: string }>(`/api/order-drafts/${encodeURIComponent(draftId)}/competitor-product/create`, {
        method: "POST",
        body: JSON.stringify({ inspectionId: competitorInspection.inspectionId, confirmNoMatch: true, product: competitorDraft })
      })
      addCatalogItem(result.product, false)
      setCompetitorOpen(false)
      toast.success(result.message || `${String(result.product.sku || "Draft SKU")} was created.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to create the draft SKU.")
    } finally { setCompetitorCreateBusy(false) }
  }
  const findSimilar = async (line: Record<string, unknown>, index: number) => {
    setSimilarOpen(true); setSimilarLineIndex(index); setSimilarResults([]); setSimilarLoading(true)
    try {
      const result = await api<{ alternatives?: Array<Record<string, unknown>>; message?: string }>(`/api/order-drafts/${encodeURIComponent(draftId)}/similar-skus?lineIndex=${index}&sku=${encodeURIComponent(String(line.sku || ""))}&title=${encodeURIComponent(String(line.title || ""))}`)
      setSimilarResults(result.alternatives || [])
      if (!result.alternatives?.length) toast.message(result.message || "No similar SKUs found.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to find similar SKUs.")
    } finally { setSimilarLoading(false) }
  }
  const applySimilar = (item: Record<string, unknown>) => {
    const lines = Array.isArray(draft?.items) ? draft.items as Array<Record<string, unknown>> : []
    if (!editorOpen) openEditor()
    window.setTimeout(() => setForm((current) => ({
      ...current,
      items: (current.items.length ? current.items : lines.map((line) => ({
        sku: String(line.sku || ""), title: String(line.title || ""), qty: String(line.qty || 1), msrp: String(line.msrp || 0), price: String(line.price || 0),
        image: String(line.image || line.defaultImage || ""), sourcePageSku: String(line.sourcePageSku || ""), catalogProductId: String(line.catalogProductId || ""),
        catalogMatchedSku: String(line.catalogMatchedSku || ""), catalogMatchBasis: String(line.catalogMatchBasis || ""), catalogMatchReviewRequired: line.catalogMatchReviewRequired === true,
        manufacturerPartNumber: String(line.manufacturerPartNumber || line.mfrPartNumber || ""), barcode: String(line.barcode || ""),
        mapPrice: String(line.mapPrice || 0), autoPrice: false,
        cost: line.cost === null || line.cost === undefined ? "" : String(line.cost), selectedSupplierKey: String(line.selectedSupplierKey || ""),
        selectedSupplierId: String(line.selectedSupplierId || ""), selectedSupplierName: String(line.selectedSupplierName || ""), selectedSupplierCode: String(line.selectedSupplierCode || ""),
        selectedSupplierSku: String(line.selectedSupplierSku || ""), selectedSupplierProductId: String(line.selectedSupplierProductId || ""), selectedSupplierUom: String(line.selectedSupplierUom || ""),
      }))).map((line, index) => index === similarLineIndex ? {
        ...line, sku: String(item.sku || ""), title: String(item.title || item.sku || ""), msrp: String(item.listPrice || item.msrp || line.msrp || 0), mapPrice: String(item.mapPrice || 0),
        image: String(item.image || item.defaultImage || ""), sourcePageSku: String(item.sourceSku || item.sku || ""), catalogProductId: String(item.id || item.productCatalogId || ""),
        catalogMatchedSku: String(item.sku || ""), catalogMatchBasis: "Catalog alternative", catalogMatchReviewRequired: false,
        manufacturerPartNumber: String(item.manufacturerPartNumber || item.mfrPartNumber || ""), barcode: String(item.barcode || ""),
        price: String(quoteRecommendedPrice(item.cost === null || item.cost === undefined ? null : Number(item.cost), Number(item.mapPrice || 0))), autoPrice: true,
        cost: item.cost === null || item.cost === undefined ? "" : String(item.cost), selectedSupplierKey: "", selectedSupplierId: "", selectedSupplierName: "", selectedSupplierCode: "", selectedSupplierSku: "", selectedSupplierProductId: "", selectedSupplierUom: "",
      } : line),
    })), 0)
    setSimilarOpen(false)
    toast.success(`${String(item.sku || "SKU")} applied to the quote draft. Save the quote to keep it.`)
  }
  const toggleTerm = (termId: string, checked: boolean) => setForm((current) => {
    let selected = current.selectedTermIds.filter((id) => id !== termId)
    const term = quoteTermOptions.find((option) => option.id === termId)
    if (checked && term?.exclusiveGroup) selected = selected.filter((id) => quoteTermOptions.find((option) => option.id === id)?.exclusiveGroup !== term.exclusiveGroup)
    if (checked) selected.push(termId)
    return { ...current, selectedTermIds: selected }
  })
  const save = async () => {
    const items = form.items.map((item) => ({
      sku: item.sku.trim(), title: item.title.trim() || item.sku.trim(), qty: Number(item.qty || 0), msrp: Number(item.msrp || 0), listPrice: Number(item.msrp || 0), mapPrice: Number(item.mapPrice || 0), price: Number(item.price || 0), priceOverridden: !item.autoPrice,
      cost: quoteLineCost(item), selectedSupplierKey: item.selectedSupplierKey, selectedSupplierId: item.selectedSupplierId,
      selectedSupplierName: item.selectedSupplierName, selectedSupplierCode: item.selectedSupplierCode, selectedSupplierSku: item.selectedSupplierSku,
      selectedSupplierProductId: item.selectedSupplierProductId, selectedSupplierUom: item.selectedSupplierUom,
      image: item.image, sourcePageSku: item.sourcePageSku, catalogProductId: item.catalogProductId, catalogMatchedSku: item.catalogMatchedSku,
      catalogMatchBasis: item.catalogMatchBasis, catalogMatchReviewRequired: item.catalogMatchReviewRequired,
      manufacturerPartNumber: item.manufacturerPartNumber, barcode: item.barcode,
    })).filter((item) => item.sku && item.qty > 0)
    setBusy(true)
    try {
      await api(`/api/order-drafts/${encodeURIComponent(draftId)}`, { method: "PATCH", body: JSON.stringify({
        buyer: form.buyer.trim(), buyerEmail: form.buyerEmail.trim(), phone: form.phone.trim(), source: form.source, status: form.status,
        salesOwner: form.salesOwner.trim(), nextAction: form.nextAction.trim(), nextFollowUpAt: quoteIsoDateTime(form.nextFollowUpAt),
        taxExempt: form.taxExempt, taxMode: form.taxMode, taxRate: Number(form.taxRate || 0), taxAmount: Number(form.taxAmount || 0),
        note: form.note.trim(), customerNote: form.customerNote.trim(), expiresAt: form.expiresAt, selectedTermIds: form.selectedTermIds, customTerms: form.customTerms.trim(),
        shippingAddress: { name: form.buyer.trim(), line1: form.line1.trim(), line2: form.line2.trim(), city: form.city.trim(), state: form.state.trim(), postalCode: form.postalCode.trim(), country: form.country.trim() }, items,
      }) })
      setEditorOpen(false)
      await load()
      toast.success("Quote updated.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update quote.")
    } finally { setBusy(false) }
  }
  const updateStatus = async (status: string) => {
    setBusy(true)
    try { await api(`/api/order-drafts/${encodeURIComponent(draftId)}`, { method: "PATCH", body: JSON.stringify({ status }) }); await load(); toast.success(`Quote marked ${status.replace(/_/g, " ")}.`) }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update quote status.") }
    finally { setBusy(false) }
  }
  const voidQuote = async () => {
    const reason = voidReason.trim()
    if (!reason) { toast.error("Enter a reason for voiding this quote."); return }
    setBusy(true)
    try {
      await api(`/api/order-drafts/${encodeURIComponent(draftId)}`, { method: "PATCH", body: JSON.stringify({ status: "voided", voidReason: reason }) })
      setVoidOpen(false)
      setVoidReason("")
      await load()
      toast.success("Quote voided and removed from the active pipeline.")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to void quote.") }
    finally { setBusy(false) }
  }
  const duplicate = async () => {
    setBusy(true)
    try { const result = await api<{ draft?: Record<string, unknown> }>(`/api/order-drafts/${encodeURIComponent(draftId)}/duplicate`, { method: "POST" }); toast.success("Quote duplicated with a new 30-day validity period."); const nextId = String(result.draft?.id || ""); if (nextId) window.location.href = `/drafts/${encodeURIComponent(nextId)}` }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to duplicate quote.") }
    finally { setBusy(false) }
  }
  const convert = async () => {
    if (isVoided) { toast.error("Duplicate this quote to create a new active revision."); return }
    setBusy(true)
    try { const result = await api<{ order?: Record<string, unknown> }>(`/api/order-drafts/${encodeURIComponent(draftId)}/convert`, { method: "POST", body: JSON.stringify({ user: "Luis" }) }); toast.success("Quote converted to an order."); if (result.order) window.location.href = orderHref(result.order) }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to convert quote.") }
    finally { setBusy(false) }
  }

  const openShippingRates = () => {
    if (isVoided) { toast.error("Voided quotes cannot request new carrier rates."); return }
    const estimate = draft?.shippingEstimate as Record<string, unknown> | undefined
    const packageInfo = estimate?.package as Record<string, unknown> | undefined
    setShippingPackage({
      weight: packageInfo?.weight ? String(packageInfo.weight) : "",
      length: packageInfo?.length ? String(packageInfo.length) : "",
      width: packageInfo?.width ? String(packageInfo.width) : "",
      height: packageInfo?.height ? String(packageInfo.height) : "",
    })
    setShippingWarehouseId(String(estimate?.warehouseId || warehouses.find((row) => row.isDefaultReceiving)?.id || warehouses[0]?.id || ""))
    setShippingRates([])
    setShippingProviderErrors([])
    setShippingAddressValidation(null)
    setSelectedShippingRateId("")
    setShippingOpen(true)
  }
  const requestShippingRates = async () => {
    const parcel = Object.fromEntries(Object.entries(shippingPackage).map(([key, value]) => [key, Number(value)]))
    if (Object.values(parcel).some((value) => !Number.isFinite(value) || value <= 0)) { toast.error("Enter weight and all package dimensions."); return }
    setShippingBusy(true)
    try {
      const result = await api<{ rates?: QuoteCarrierRate[]; providerErrors?: Array<{ provider?: string; message?: string }>; addressValidation?: QuoteAddressValidation }>(`/api/order-drafts/${encodeURIComponent(draftId)}/shipping-rates`, { method: "POST", body: JSON.stringify({ warehouseId: shippingWarehouseId, package: parcel }) })
      const rates = result.rates || []
      setShippingRates(rates)
      setShippingProviderErrors(result.providerErrors || [])
      setShippingAddressValidation(result.addressValidation || null)
      setSelectedShippingRateId(rates[0]?.id || "")
      if (!rates.length) toast.error("No enabled carrier returned an eligible rate for this package.")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to request carrier rates.") }
    finally { setShippingBusy(false) }
  }
  const saveShippingRate = async () => {
    const rate = shippingRates.find((row) => row.id === selectedShippingRateId)
    if (!rate) return
    setShippingBusy(true)
    try {
      await api(`/api/order-drafts/${encodeURIComponent(draftId)}`, { method: "PATCH", body: JSON.stringify({ shippingEstimate: {
        providerId: rate.providerId, carrier: rate.carrier, service: rate.service, serviceCode: rate.serviceCode || "", amount: rate.amount, currency: rate.currency || "USD",
        deliveryDays: rate.deliveryDays || null, deliveryEstimate: rate.deliveryEstimate || "", quotedAt: rate.quotedAt || new Date().toISOString(),
        expiresAt: rate.expiresAt, warehouseId: shippingWarehouseId, package: Object.fromEntries(Object.entries(shippingPackage).map(([key, value]) => [key, Number(value)])),
      } }) })
      setShippingOpen(false)
      await load()
      toast.success(`${rate.carrier} shipping estimate added to the quote.`)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save the shipping estimate.") }
    finally { setShippingBusy(false) }
  }

  const lines = Array.isArray(draft?.items) ? draft.items as Array<Record<string, unknown>> : []
  const subtotal = lines.reduce((sum, line) => sum + Number(line.price || 0) * Number(line.qty || 0), 0)
  const savedShippingEstimate = draft?.shippingEstimate && typeof draft.shippingEstimate === "object" ? draft.shippingEstimate as Record<string, unknown> : null
  const savedRateExpiresAt = Date.parse(String(savedShippingEstimate?.expiresAt || ""))
  const savedRateExpired = Boolean(savedShippingEstimate && (!Number.isFinite(savedRateExpiresAt) || savedRateExpiresAt <= Date.now()))
  const enabledQuoteCarriers = quoteCarriers.filter((provider) => provider.enabled && provider.companyRates)
  const enabledQuoteCarrierLabel = enabledQuoteCarriers.map((provider) => provider.name).join(", ")
  const shippingAmount = Number(savedShippingEstimate?.amount || 0)
  const taxExempt = draft?.taxExempt === true
  const taxRate = Math.max(0, Number(draft?.taxRate || 0))
  const taxAmount = taxExempt ? 0 : Math.max(0, Number(draft?.taxAmount || 0))
  const total = subtotal + shippingAmount + taxAmount
  const resolvedLineSources = lines.map((line) => {
    const skuKey = String(line.sku || "").trim().toLowerCase()
    const options = supplierOptionsBySku[skuKey] || []
    const display = quoteDisplaySupplierOption(line, options)
    const savedCost = quoteLineCost(line)
    const optionCost = display.option?.cost === null || display.option?.cost === undefined ? null : Number(display.option.cost)
    return { options, option: display.option, cost: savedCost ?? (Number.isFinite(optionCost) && Number(optionCost) >= 0 ? optionCost : null), suggested: savedCost === null && display.suggested }
  })
  const costedLines = resolvedLineSources.filter((source) => source.cost !== null)
  const productCost = resolvedLineSources.reduce((sum, source, index) => sum + Number(lines[index]?.qty || 0) * Number(source.cost || 0), 0)
  const costsComplete = lines.length > 0 && costedLines.length === lines.length
  const grossProfit = costsComplete ? subtotal - productCost : null
  const grossMargin = grossProfit === null ? null : quoteMarginPercent(subtotal, productCost)
  const savings = lines.reduce((sum, line) => sum + Math.max(0, Number(line.msrp || 0) - Number(line.price || 0)) * Number(line.qty || 0), 0)
  const missingMsrpCount = lines.filter((line) => !(Number(line.msrp || 0) > 0)).length
  const hasCompleteMsrp = lines.length > 0 && missingMsrpCount === 0
  const expiresAt = String(draft?.expiresAt || "")
  const expired = Boolean(expiresAt && expiresAt < quoteDateKey(new Date()))
  const isVoided = ["void", "voided"].includes(String(draft?.status || "").toLowerCase())
  const nextFollowUpAt = String(draft?.nextFollowUpAt || "")
  const followUpDue = Boolean(nextFollowUpAt && Date.parse(nextFollowUpAt) <= Date.now() && !["accepted", "lost", "void", "voided"].includes(String(draft?.status || "").toLowerCase()))
  const quoteActivity = Array.isArray(draft?.quoteActivity) ? [...draft.quoteActivity as Array<Record<string, unknown>>].reverse() : []
  const selectedTermIds = Array.isArray(draft?.selectedTermIds) ? draft.selectedTermIds.map(String) : []
  const selectedTermSnapshot = Array.isArray(draft?.selectedTermsSnapshot) ? draft.selectedTermsSnapshot as QuoteTermDefinition[] : []
  const selectedTerms = selectedTermIds.map((id) => selectedTermSnapshot.find((term) => term.id === id) || quoteTermOptions.find((term) => term.id === id)).filter((term): term is QuoteTermDefinition => Boolean(term))
  const customerName = String(draft?.buyer || "Not assigned")
  const customerEmail = String(draft?.buyerEmail || "").trim()
  const customerPhone = String(draft?.phone || "").trim()
  const shippingAddress = draft?.shippingAddress && typeof draft.shippingAddress === "object" ? draft.shippingAddress : {}
  const billingAddress = draft?.billingAddress && typeof draft.billingAddress === "object" ? draft.billingAddress : shippingAddress
  const shippingAddressLines = quoteAddressLines(shippingAddress, customerName)
  const billingAddressLines = quoteAddressLines(billingAddress, customerName)
  const billingMatchesShipping = Boolean(shippingAddressLines.length && quoteAddressFingerprint(shippingAddress, customerName) === quoteAddressFingerprint(billingAddress, customerName))
  const editableQuoteTerms = quoteTermOptions.filter((term) => term.active || form.selectedTermIds.includes(term.id))
  const quoteTermGroups = [...new Set(editableQuoteTerms.map((term) => term.group))]
  const expirationDate = form.expiresAt ? new Date(`${form.expiresAt}T12:00:00`) : undefined
  const formSubtotal = form.items.reduce((sum, line) => sum + Math.max(0, Number(line.qty || 0)) * Math.max(0, Number(line.price || 0)), 0)
  const formSavings = form.items.reduce((sum, line) => sum + Math.max(0, Number(line.msrp || 0) - Number(line.price || 0)) * Math.max(0, Number(line.qty || 0)), 0)
  const formUnitCount = form.items.reduce((sum, line) => sum + Math.max(0, Number(line.qty || 0)), 0)
  const formCostedLines = form.items.filter((line) => quoteLineCost(line) !== null)
  const formProductCost = formCostedLines.reduce((sum, line) => sum + Math.max(0, Number(line.qty || 0)) * Number(quoteLineCost(line)), 0)
  const formCostsComplete = form.items.length > 0 && formCostedLines.length === form.items.length
  const formGrossProfit = formCostsComplete ? formSubtotal - formProductCost : null
  const formGrossMargin = formGrossProfit === null ? null : quoteMarginPercent(formSubtotal, formProductCost)
  const formTaxableAmount = formSubtotal + shippingAmount
  const formTaxAmount = form.taxExempt ? 0 : form.taxMode === "manual"
    ? Math.max(0, Number(form.taxAmount || 0))
    : Math.round((formTaxableAmount * Math.max(0, Number(form.taxRate || 0)) / 100 + Number.EPSILON) * 100) / 100
  const formEstimatedTotal = formTaxableAmount + formTaxAmount
  const editorSections = ["customer", "items", "delivery", "terms", "notes"] as const
  const editorSectionIndex = editorSections.indexOf(editorSection)
  const editorCompletion = {
    items: form.items.some((line) => line.sku.trim() && Number(line.qty || 0) > 0),
    customer: Boolean(form.buyer.trim()),
    delivery: Boolean(form.line1.trim() && form.city.trim() && form.state.trim() && form.postalCode.trim()),
    terms: Boolean(form.expiresAt),
    notes: Boolean(form.note.trim() || form.customerNote.trim()),
  }
  const editorSectionMeta = [
    { id: "customer" as const, label: "Customer", icon: Users },
    { id: "items" as const, label: "Items", icon: PackageCheck },
    { id: "delivery" as const, label: "Delivery", icon: Truck },
    { id: "terms" as const, label: "Validity & terms", icon: FileText },
    { id: "notes" as const, label: "Notes", icon: MessageSquare },
  ]

  return <div className="grid gap-5">
    <Dialog open={voidOpen} onOpenChange={(open) => { if (!busy) { setVoidOpen(open); if (!open) setVoidReason("") } }}><DialogContent><DialogHeader><DialogTitle>Void {String(draft?.draftNumber || "quote")}</DialogTitle><DialogDescription>The quote remains in audit history but will disappear from active search, the pipeline, and sales analytics.</DialogDescription></DialogHeader><Field label="Reason"><Textarea autoFocus value={voidReason} onChange={(event) => setVoidReason(event.target.value)} placeholder="Why is this quote being voided?" /></Field><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setVoidOpen(false)}>Cancel</Button><Button variant="destructive" disabled={busy || !voidReason.trim()} onClick={() => void voidQuote()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />} Void quote</Button></DialogFooter></DialogContent></Dialog>
    <PageHeader eyebrow="Operations / Draft quote" title={String(draft?.draftNumber || draftId || "Quote")} description="A customer proposal that remains editable until accepted and converted into an order." action={<div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" asChild><a href="/drafts">Back to drafts</a></Button>
      <Button size="sm" disabled={busy || !draft || isVoided} onClick={openEditor}><Pencil className="size-4" /> Edit quote</Button>
      <Button size="sm" variant="outline" disabled={busy || !draft || isVoided} asChild><a href={`/api/order-drafts/${encodeURIComponent(draftId)}/export/email.eml?variant=standard`} target="_blank" rel="noreferrer" onClick={() => toast.success("Outlook quote draft generated with the PDF attached.")}><Mail className="size-4" /> Email quote</a></Button>
      <DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="outline" disabled={busy || !draft}><MoreHorizontal className="size-4" /> Actions</Button></DropdownMenuTrigger><DropdownMenuContent align="end">
        {!isVoided && <><DropdownMenuLabel>Quote status</DropdownMenuLabel>
        {["draft", "reviewing", "quoted", "sent", "accepted", "lost"].map((status) => <DropdownMenuItem key={status} onSelect={() => void updateStatus(status)}>{status === "accepted" ? "Approved" : status === "lost" ? "Rejected" : status.replace(/_/g, " ")}</DropdownMenuItem>)}
        <DropdownMenuSeparator />
        </>}
        <DropdownMenuItem onSelect={() => void duplicate()}><Copy className="size-4" /> Duplicate quote</DropdownMenuItem>
        {!isVoided && <DropdownMenuItem onSelect={() => void convert()}><ArrowRight className="size-4" /> Convert to order</DropdownMenuItem>}
        {!isVoided && <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => { setVoidReason(""); setVoidOpen(true) }}><Ban className="size-4" /> Void quote</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => { setExportVariant("standard"); setExportOpen(true) }}><Printer className="size-4" /> Print / save PDF</DropdownMenuItem>
        <DropdownMenuItem asChild><a href={`/api/order-drafts/${encodeURIComponent(draftId)}/export/csv`} target="_blank" rel="noreferrer"><FileDown className="size-4" /> Download CSV</a></DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>
    </div>} />

    {loading ? <div className="grid gap-3"><Skeleton className="h-36" /><Skeleton className="h-72" /></div> : !draft ? <Card><CardContent className="p-8 text-center text-muted-foreground">This draft quote was not found.</CardContent></Card> : <>
      {isVoided ? <Alert><Ban className="size-4" /><AlertTitle>Quote voided</AlertTitle><AlertDescription>{String(draft.voidReason || "No reason recorded.")} {draft.voidedBy ? `Voided by ${String(draft.voidedBy)}${draft.voidedAt ? ` on ${dateLabel(String(draft.voidedAt))}` : ""}.` : ""} This quote is excluded from active search and analytics. Duplicate it to create a new active revision.</AlertDescription></Alert> : null}
      {expired && !["accepted", "lost", "void", "voided"].includes(String(draft.status || "").toLowerCase()) ? <Alert variant="destructive"><Clock3 className="size-4" /><AlertTitle>Quote expired</AlertTitle><AlertDescription>Extend the validity date before sending or accepting this quote.</AlertDescription></Alert> : null}
      {followUpDue ? <Alert><Clock3 className="size-4" /><AlertTitle>Follow-up is due</AlertTitle><AlertDescription>{String(draft.nextAction || "Contact the customer and record the next action.")}</AlertDescription></Alert> : null}
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <main className="order-2 grid min-w-0 content-start gap-4 xl:order-1">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Detail label="Status" value={String(draft.status || "draft").toLowerCase() === "accepted" ? "Approved" : String(draft.status || "draft").toLowerCase() === "lost" ? "Rejected" : String(draft.status || "draft").replace(/_/g, " ")} />
            <Detail label="Quote total" value={moneyLabel(total)} />
            <Detail label="Sales tax" value={taxExempt ? "Tax exempt" : `${moneyLabel(taxAmount)}${taxRate > 0 ? ` · ${taxRate}%` : ""}`} />
            <Detail label="Gross margin" value={grossMargin === null ? `${numberLabel(lines.length - costedLines.length)} line cost${lines.length - costedLines.length === 1 ? "" : "s"} needed` : `${grossMargin.toFixed(1)}% · ${moneyLabel(grossProfit)}`} />
            <Detail label="Valid until" value={expiresAt ? `${dateLabel(`${expiresAt}T12:00:00`)}${expired ? " (expired)" : ""}` : "Not set"} />
          </div>
      <Card><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-base">Quote items</CardTitle><CardDescription>MSRP, MAP, selling price, supplier cost, inventory availability, and gross margin by line.</CardDescription></div><div className="flex flex-wrap gap-2">{hasCompleteMsrp ? <Badge variant="outline">{moneyLabel(savings)} customer savings</Badge> : <Badge variant="outline">{lines.length ? `MSRP missing on ${numberLabel(missingMsrpCount)} line${missingMsrpCount === 1 ? "" : "s"}` : "No quote lines"}</Badge>}{costsComplete ? <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">{grossMargin?.toFixed(1)}% total margin</Badge> : <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">Cost needed on {numberLabel(lines.length - costedLines.length)} line{lines.length - costedLines.length === 1 ? "" : "s"}</Badge>}</div></div></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table className="min-w-[1220px]"><TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Supplier</TableHead><TableHead>Qty</TableHead><TableHead>MSRP</TableHead><TableHead>MAP</TableHead><TableHead>Price</TableHead><TableHead>Cost</TableHead><TableHead>Availability</TableHead><TableHead>Margin</TableHead><TableHead>Total</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>
        {lines.map((line, index) => {
          const lineSavings = Math.max(0, Number(line.msrp || 0) - Number(line.price || 0)) * Number(line.qty || 0)
          const lineSource = resolvedLineSources[index]
          const lineCost = lineSource?.cost ?? null
          const supplierOption = lineSource?.option || null
          const supplierLoading = supplierOptionsLoading.has(String(line.sku || "").trim().toLowerCase())
          const supplierName = String(supplierOption?.supplierName || line.selectedSupplierName || "No supplier source")
          const supplierSku = String(supplierOption?.supplierSku || supplierOption?.sourceSku || supplierOption?.vendorSku || line.selectedSupplierSku || "-")
          const supplierQty = supplierOption?.qty === null || supplierOption?.qty === undefined ? null : Number(supplierOption.qty)
          const supplierQtyKnown = Number.isFinite(supplierQty) && Number(supplierQty) >= 0
          const lineMap = Math.max(0, Number(line.mapPrice || 0))
          const lineRevenue = Number(line.price || 0) * Number(line.qty || 0)
          const lineProfit = lineCost === null ? null : lineRevenue - lineCost * Number(line.qty || 0)
          const lineMargin = lineCost === null ? null : quoteMarginPercent(Number(line.price || 0), lineCost)
          const productTitle = String(line.title || line.sku || "-")
          const productImage = String(line.image || line.defaultImage || "")
          const catalogSku = String(line.catalogMatchedSku || line.sku || "")
          return <TableRow key={`${String(line.sku)}-${index}`}><TableCell><div className="flex min-w-72 items-center gap-3"><CatalogImage src={productImage || undefined} alt={productTitle} className="size-12 shrink-0" imageClassName="p-1" /><div className="min-w-0">{line.catalogProductId ? <a className="font-mono text-xs font-semibold text-primary hover:underline" href={`/products/${encodeURIComponent(catalogSku)}`}>{String(line.sku || "-")}</a> : <p className="font-mono text-xs">{String(line.sku || "-")}</p>}<p className="mt-0.5 whitespace-normal font-medium leading-5">{productTitle}</p><div className="mt-1 flex flex-wrap items-center gap-1.5">{line.catalogProductId ? <Badge variant="outline" className={line.catalogMatchReviewRequired ? "border-amber-500/40 text-amber-700 dark:text-amber-300" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}>{line.catalogMatchReviewRequired ? "Catalog candidate" : "Catalog matched"}</Badge> : <Badge variant="outline" className="border-red-500/40 text-red-700 dark:text-red-300">Not in catalog</Badge>}{line.catalogMatchBasis ? <span className="text-xs text-muted-foreground">{String(line.catalogMatchBasis)}</span> : null}</div></div></div></TableCell><TableCell><p className="font-medium">{supplierLoading ? "Loading sources..." : supplierName}</p><p className="font-mono text-xs text-muted-foreground">{supplierSku}</p><div className="mt-1 flex flex-wrap gap-1">{lineSource?.suggested && supplierOption ? <Badge variant="outline" className="border-blue-500/40 text-blue-700 dark:text-blue-300">{supplierQtyKnown && Number(supplierQty) > 0 ? "Lowest available cost" : "Lowest cost suggestion"}</Badge> : supplierOption ? <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">Selected source</Badge> : null}{lineSource?.options.length ? <Badge variant="outline">{lineSource.options.length} option{lineSource.options.length === 1 ? "" : "s"}</Badge> : null}</div></TableCell><TableCell>{numberLabel(Number(line.qty || 0))}</TableCell><TableCell>{Number(line.msrp || 0) > 0 ? moneyLabel(Number(line.msrp)) : "Not set"}</TableCell><TableCell>{lineMap > 0 ? moneyLabel(lineMap) : "Not set"}</TableCell><TableCell><p className={cn("font-medium", lineMap > 0 && Number(line.price || 0) < lineMap ? "text-destructive" : "")}>{moneyLabel(Number(line.price || 0))}</p>{lineMap > 0 && Number(line.price || 0) < lineMap ? <p className="text-xs text-destructive">Below MAP</p> : lineSavings > 0 ? <p className="text-xs text-emerald-600">{moneyLabel(lineSavings)} saved</p> : null}</TableCell><TableCell className="font-semibold tabular-nums">{supplierLoading && lineCost === null ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : lineCost === null ? <span className="text-muted-foreground">Not available</span> : <><span>{moneyLabel(lineCost)}</span>{lineSource?.suggested ? <span className="mt-0.5 block text-xs font-normal text-blue-600">Current suggestion</span> : null}</>}</TableCell><TableCell>{supplierLoading ? <Skeleton className="h-5 w-20" /> : supplierQtyKnown ? <><p className={cn("font-medium", Number(supplierQty) > 0 ? "text-emerald-600" : "text-destructive")}>{Number(supplierQty) > 0 ? `${numberLabel(Number(supplierQty))} available` : "Out of stock"}</p><p className="text-xs text-muted-foreground">Supplier inventory{supplierOption?.uom ? ` · ${supplierOption.uom}` : ""}</p></> : <span className="text-sm text-muted-foreground">Not reported</span>}</TableCell><TableCell className={cn("font-medium", lineProfit !== null && lineProfit < 0 ? "text-destructive" : lineProfit !== null ? "text-emerald-600" : "text-muted-foreground")}>{lineMargin === null ? "Cost needed" : `${lineMargin.toFixed(1)}% · ${moneyLabel(lineProfit)}`}</TableCell><TableCell className="font-medium">{moneyLabel(lineRevenue)}</TableCell><TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => void findSimilar(line, index)}><Search className="size-4" /> Find similar</Button></TableCell></TableRow>
        })}
      </TableBody></Table></div></CardContent></Card>
      {enabledQuoteCarriers.length ? <Card><CardHeader className="pb-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-sm">Shipping estimate</CardTitle><CardDescription>Compare the shared {enabledQuoteCarrierLabel} accounts for an accurate customer quote.</CardDescription></div><Button size="sm" variant={savedShippingEstimate ? "outline" : "default"} onClick={openShippingRates}><Truck className="size-4" /> {savedShippingEstimate ? "Refresh carrier rates" : "Get carrier rates"}</Button></div></CardHeader><CardContent className="grid gap-3">{savedShippingEstimate ? <><div className="grid gap-3 text-sm sm:grid-cols-3 xl:grid-cols-6"><Detail label="Carrier / service" value={`${String(savedShippingEstimate.carrier || "Carrier")} ${String(savedShippingEstimate.service || "")}`} /><Detail label="Shipping" value={moneyLabel(shippingAmount)} /><Detail label="Sales tax" value={taxExempt ? "Tax exempt" : moneyLabel(taxAmount)} /><Detail label="Package" value={`${String((savedShippingEstimate.package as Record<string, unknown>)?.weight || "-")} lb / ${String((savedShippingEstimate.package as Record<string, unknown>)?.length || "-")} x ${String((savedShippingEstimate.package as Record<string, unknown>)?.width || "-")} x ${String((savedShippingEstimate.package as Record<string, unknown>)?.height || "-")} in`} /><Detail label="Rate valid until" value={savedRateExpired ? "Expired - refresh required" : dateLabel(String(savedShippingEstimate.expiresAt || ""))} /><Detail label="Estimated quote total" value={moneyLabel(total)} /></div>{savedRateExpired ? <Alert variant="destructive"><Clock3 className="size-4" /><AlertTitle>Shipping rate expired</AlertTitle><AlertDescription>Refresh carrier rates before accepting or converting this quote.</AlertDescription></Alert> : null}</> : <p className="text-sm text-muted-foreground">No shipping rate has been added. Product subtotal is {moneyLabel(subtotal)} and sales tax is {taxExempt ? "exempt" : moneyLabel(taxAmount)}.</p>}</CardContent></Card> : null}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Quote details</CardTitle><CardDescription>Notes, customer-facing terms, and recent pipeline activity.</CardDescription></CardHeader>
            <CardContent>
              <Tabs defaultValue="notes">
                <TabsList className="w-full justify-start overflow-x-auto"><TabsTrigger value="notes">Notes</TabsTrigger><TabsTrigger value="terms">Terms</TabsTrigger><TabsTrigger value="activity">Activity</TabsTrigger></TabsList>
                <TabsContent value="notes" className="mt-4 grid gap-5 md:grid-cols-2">
                  <section><h3 className="text-sm font-semibold">Internal notes</h3><p className="mt-1 text-xs text-muted-foreground">Visible only to DataPlus staff.</p><div className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{String(draft.note || "No internal notes.")}</div></section>
                  <section className="border-t pt-4 md:border-l md:border-t-0 md:pl-5 md:pt-0"><h3 className="text-sm font-semibold">Customer message</h3><p className="mt-1 text-xs text-muted-foreground">Included on every customer quote version.</p><div className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{String(draft.customerNote || "No customer message.")}</div></section>
                </TabsContent>
                <TabsContent value="terms" className="mt-4 grid gap-2 text-sm text-muted-foreground">{selectedTerms.map((term) => <div key={term.id} className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /><span>{term.label}</span></div>)}{draft.customTerms ? <div className="mt-2 whitespace-pre-wrap border-t pt-3">{String(draft.customTerms)}</div> : null}{!selectedTerms.length && !draft.customTerms ? "No terms selected." : null}</TabsContent>
                <TabsContent value="activity" className="mt-4 grid gap-3 text-sm">{draft.nextAction ? <div><p className="font-medium">Next action</p><p className="text-muted-foreground">{String(draft.nextAction)}</p></div> : null}{quoteActivity.slice(0, 8).map((event) => <div key={String(event.id || event.createdAt)} className="border-l-2 pl-3"><p className="font-medium capitalize">{String(event.toStatus || event.type || "Updated").replaceAll("_", " ")}</p><p className="text-xs text-muted-foreground">{String(event.user || "DataPlus user")} · {dateLabel(String(event.createdAt || ""))}</p></div>)}{!draft.nextAction && !quoteActivity.length ? <p className="text-muted-foreground">No pipeline activity yet.</p> : null}</TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </main>

        <aside className="order-1 grid content-start gap-4 xl:order-2 xl:sticky xl:top-20 xl:self-start">
          <Card className="overflow-hidden">
            <CardHeader className="border-b pb-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><CardDescription>Customer</CardDescription><CardTitle className="mt-1 truncate text-lg">{customerProfileId ? <a className="text-primary hover:underline" href={`/customers/${encodeURIComponent(customerProfileId)}`}>{customerName}</a> : customerName}</CardTitle></div><div className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><Users className="size-4" /></div></div></CardHeader>
            <CardContent className="grid gap-5 pt-5">
              <section className="grid gap-2.5 text-sm">
                <h3 className="font-semibold">Contact</h3>
                {customerEmail ? <a className="flex min-w-0 items-center gap-2 text-primary hover:underline" href={`mailto:${customerEmail}`}><Mail className="size-4 shrink-0" /><span className="truncate">{customerEmail}</span></a> : <p className="flex items-center gap-2 text-muted-foreground"><Mail className="size-4 shrink-0" /> No email provided</p>}
                {customerPhone ? <a className="flex items-center gap-2 text-primary hover:underline" href={`tel:${customerPhone}`}><Phone className="size-4 shrink-0" />{customerPhone}</a> : <p className="flex items-center gap-2 text-muted-foreground"><Phone className="size-4 shrink-0" /> No phone provided</p>}
              </section>
              <section className="border-t pt-4"><div className="flex items-center gap-2"><MapPin className="size-4 text-muted-foreground" /><h3 className="text-sm font-semibold">Shipping address</h3></div><address className="mt-2 not-italic text-sm leading-6 text-muted-foreground">{shippingAddressLines.length ? shippingAddressLines.map((line, index) => <span key={`${line}-${index}`} className="block break-words">{line}</span>) : "No shipping address provided."}</address></section>
              <section className="border-t pt-4"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><MapPin className="size-4 text-muted-foreground" /><h3 className="text-sm font-semibold">Billing address</h3></div>{billingMatchesShipping ? <Badge variant="outline">Same as shipping</Badge> : null}</div><address className="mt-2 not-italic text-sm leading-6 text-muted-foreground">{billingAddressLines.length ? billingAddressLines.map((line, index) => <span key={`${line}-${index}`} className="block break-words">{line}</span>) : "No billing address provided."}</address></section>
            </CardContent>
          </Card>
          <Card><CardHeader className="pb-3"><CardTitle className="text-sm">Quote ownership</CardTitle></CardHeader><CardContent className="grid gap-3 text-sm"><div className="flex items-start justify-between gap-3"><span className="text-muted-foreground">Sales owner</span><span className="text-right font-medium">{String(draft.salesOwner || "Unassigned")}</span></div><div className="flex items-start justify-between gap-3"><span className="text-muted-foreground">Source</span><span className="text-right font-medium">{String(draft.source || "Manual")}</span></div><div className="flex items-start justify-between gap-3"><span className="text-muted-foreground">Next follow-up</span><span className={cn("text-right font-medium", followUpDue && "text-amber-600")}>{nextFollowUpAt ? dateLabel(nextFollowUpAt) : "Not scheduled"}</span></div><div className="flex items-start justify-between gap-3"><span className="text-muted-foreground">Quote lines</span><span className="text-right font-medium">{numberLabel(lines.length)}</span></div></CardContent></Card>
        </aside>
      </div>
    </>}

    <Dialog open={shippingOpen} onOpenChange={(open) => { if (!shippingBusy) setShippingOpen(open) }}><DialogContent className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-3xl flex-col overflow-hidden p-0 sm:max-h-[90vh]"><DialogHeader className="border-b px-4 py-5 sm:px-6"><DialogTitle>Get shipping quote rates</DialogTitle><DialogDescription>DataPlus validates the destination, then compares every enabled shared carrier. Label purchasing remains disabled for company quotes.</DialogDescription></DialogHeader><div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6">
      {warehouses.length ? <Field label="Ship from warehouse"><Select value={shippingWarehouseId} onValueChange={setShippingWarehouseId}><SelectTrigger><SelectValue placeholder="Use company address" /></SelectTrigger><SelectContent>{warehouses.map((warehouse) => <SelectItem key={String(warehouse.id)} value={String(warehouse.id)}>{String(warehouse.name || warehouse.code || "Warehouse")}</SelectItem>)}</SelectContent></Select></Field> : <Alert><Info className="size-4" /><AlertTitle>Using company address</AlertTitle><AlertDescription>No company warehouse is configured, so carriers will use the saved company profile address.</AlertDescription></Alert>}
      <div className="grid gap-3 sm:grid-cols-4"><Field label="Weight (lb)"><Input type="number" min="0.01" step="0.01" inputMode="decimal" value={shippingPackage.weight} onChange={(event) => setShippingPackage((current) => ({ ...current, weight: event.target.value }))} /></Field><Field label="Length (in)"><Input type="number" min="0.01" step="0.01" inputMode="decimal" value={shippingPackage.length} onChange={(event) => setShippingPackage((current) => ({ ...current, length: event.target.value }))} /></Field><Field label="Width (in)"><Input type="number" min="0.01" step="0.01" inputMode="decimal" value={shippingPackage.width} onChange={(event) => setShippingPackage((current) => ({ ...current, width: event.target.value }))} /></Field><Field label="Height (in)"><Input type="number" min="0.01" step="0.01" inputMode="decimal" value={shippingPackage.height} onChange={(event) => setShippingPackage((current) => ({ ...current, height: event.target.value }))} /></Field></div>
      <Button type="button" variant="outline" disabled={shippingBusy} onClick={() => void requestShippingRates()}>{shippingBusy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Request carrier rates</Button>
      {shippingAddressValidation ? <Alert variant={shippingAddressValidation.status === "warning" ? "destructive" : "default"}>{shippingAddressValidation.status === "warning" ? <AlertTriangle className="size-4" /> : <CheckCircle2 className="size-4" />}<AlertTitle>{shippingAddressValidation.status === "corrected" ? "Address standardized" : shippingAddressValidation.status === "verified" ? "Address verified" : "Address validation notice"}</AlertTitle><AlertDescription>{shippingAddressValidation.message}</AlertDescription></Alert> : null}
      {shippingProviderErrors.length ? <div className="grid gap-2">{shippingProviderErrors.map((error, index) => <Alert key={`${error.provider}-${index}`}><AlertTriangle className="size-4" /><AlertTitle>{error.provider || "Carrier"} unavailable</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert>)}</div> : null}
      {shippingRates.length ? <div className="grid gap-2"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">Available services</p><Badge variant="outline">{carrierPreference.selectionMode === "preferred_carrier" ? "Preferred carrier first" : "Lowest cost first"}</Badge></div>{shippingRates.map((rate) => { const selected = selectedShippingRateId === rate.id; return <button key={rate.id} type="button" onClick={() => setSelectedShippingRateId(rate.id)} className={cn("grid gap-1 rounded-md border p-3 text-left transition-colors sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center", selected && "border-primary bg-primary/5")}><span><span className="flex flex-wrap items-center gap-2"><span className="font-medium">{rate.carrier} {rate.service}</span><Badge variant="secondary">{rate.providerName || rate.providerId}</Badge></span><span className="block text-xs text-muted-foreground">{rate.deliveryDays ? `${rate.deliveryDays} business day${rate.deliveryDays === 1 ? "" : "s"}` : "Carrier delivery estimate"}{rate.warning ? ` · ${rate.warning}` : ""} · valid until {dateLabel(rate.expiresAt)}</span></span><span className="text-lg font-semibold">{moneyLabel(rate.amount)}</span></button> })}</div> : null}
    </div><DialogFooter className="border-t bg-background px-4 py-4 sm:px-6"><Button variant="outline" disabled={shippingBusy} onClick={() => setShippingOpen(false)}>Cancel</Button><Button disabled={shippingBusy || !selectedShippingRateId} onClick={() => void saveShippingRate()}>{shippingBusy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Add rate to quote</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={exportOpen} onOpenChange={setExportOpen}><DialogContent className="w-[calc(100vw-2rem)] max-w-3xl"><DialogHeader><DialogTitle>Print or save quote PDF</DialogTitle><DialogDescription>Choose the customer-facing version for this conversation. Internal notes are excluded from every version.</DialogDescription></DialogHeader><div className="grid gap-2">
      {quotePdfVersions.map((version) => { const disabled = version.id === "savings" && !hasCompleteMsrp; const selected = exportVariant === version.id; return <button key={version.id} type="button" disabled={disabled} onClick={() => setExportVariant(version.id)} className={cn("flex items-start gap-3 rounded-md border p-4 text-left transition-colors", selected && "border-primary bg-primary/5", disabled && "cursor-not-allowed opacity-50")}><span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border", selected && "border-primary bg-primary text-primary-foreground")}>{selected ? <CheckCircle2 className="size-3.5" /> : null}</span><span className="min-w-0"><span className="block font-medium">{version.title}</span><span className="mt-1 block text-sm text-muted-foreground">{version.description}</span>{disabled ? <span className="mt-1 block text-xs font-medium text-amber-600">Add MSRP to every quote line to use this version.</span> : null}</span></button> })}
    </div><DialogFooter><Button variant="outline" onClick={() => setExportOpen(false)}>Cancel</Button><Button variant="outline" asChild><a href={`/api/order-drafts/${encodeURIComponent(draftId)}/export/email.eml?variant=${exportVariant}`} target="_blank" rel="noreferrer" onClick={() => toast.success("Outlook quote draft generated with the selected PDF attached.")}><Mail className="size-4" /> Email with Outlook</a></Button><Button onClick={() => window.open(`/api/order-drafts/${encodeURIComponent(draftId)}/export/pdf?variant=${exportVariant}`, "_blank", "noopener,noreferrer")}><Printer className="size-4" /> Open PDF</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={competitorOpen} onOpenChange={(open) => { if (!competitorBusy && !competitorCreateBusy) setCompetitorOpen(open) }}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-auto sm:max-h-[92dvh] sm:w-[calc(100vw-2rem)] sm:!max-w-5xl sm:rounded-lg">
        <DialogHeader className="shrink-0 border-b px-4 py-4 pr-12 sm:px-6">
          <DialogTitle>Add product from URL</DialogTitle>
          <DialogDescription>Inspect a public product page, then choose an existing DataPlus SKU or create a local draft SKU.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="grid gap-6 p-4 sm:p-6">
            <FormField>
              <FieldLabel htmlFor="competitor-product-url">Product URL</FieldLabel>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input id="competitor-product-url" autoFocus inputMode="url" value={competitorUrl} onChange={(event) => setCompetitorUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void inspectCompetitorUrl() } }} placeholder="https://competitor.example/product" />
                <Button type="button" className="shrink-0" disabled={competitorBusy || !competitorUrl.trim()} onClick={() => void inspectCompetitorUrl()}>{competitorBusy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Inspect page</Button>
              </div>
            </FormField>

            {competitorInspection ? <>
              {competitorInspection.providerWarning ? <Alert className="border-amber-500/40"><AlertTriangle className="size-4" /><AlertTitle>ScrapeGraphAI fallback used</AlertTitle><AlertDescription>{competitorInspection.providerWarning}</AlertDescription></Alert> : null}
              <section className="grid gap-4 rounded-md border p-4 sm:grid-cols-[112px_minmax(0,1fr)]">
                <div className="grid aspect-square place-items-center overflow-hidden rounded-md border bg-muted/30">
                  {competitorInspection.product.imageUrl ? <img src={competitorInspection.product.imageUrl} alt="" referrerPolicy="no-referrer" className="size-full object-contain" /> : <PackageCheck className="size-8 text-muted-foreground" />}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0"><p className="font-semibold">{competitorInspection.product.title || "Untitled product"}</p><div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><span>{competitorInspection.product.brand || competitorInspection.sourceHost}</span><Badge variant="outline">{competitorInspection.extractionProvider === "scrapegraphai" ? "ScrapeGraphAI" : "Direct parser"}</Badge></div></div>
                    <Button type="button" size="sm" variant="ghost" asChild><a href={competitorInspection.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-4" /> Open source</a></Button>
                  </div>
                  <div className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
                    <Detail label="UPC / GTIN" value={competitorInspection.product.gtin || "Not found"} />
                    <Detail label="Page SKU" value={competitorInspection.product.sku || "Not found"} />
                    <Detail label="MPN" value={competitorInspection.product.mpn || "Not found"} />
                    <Detail label="Observed price" value={competitorInspection.product.competitorPrice === null ? "Not found" : `${competitorInspection.product.currency} ${moneyLabel(competitorInspection.product.competitorPrice)}`} />
                  </div>
                  {competitorInspection.product.competitorPrice !== null ? <p className="mt-3 text-xs text-muted-foreground">Observed price is stored as timestamped market evidence. It does not change cost, MAP, MSRP, or quote price.</p> : null}
                </div>
              </section>

              {competitorInspection.matches.length ? <section className="grid gap-3">
                <div><h3 className="font-semibold">Catalog matches</h3><p className="mt-1 text-sm text-muted-foreground">Choose the correct independent SKU. MPN and page-SKU matches require review.</p></div>
                <div className="overflow-x-auto rounded-md border"><Table className="min-w-[760px]"><TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Product</TableHead><TableHead>Matched by</TableHead><TableHead>Identifier</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{competitorInspection.matches.map((match) => <TableRow key={String(match.id || match.sku)}><TableCell className="font-mono text-xs font-semibold">{String(match.sku)}</TableCell><TableCell><p className="max-w-md truncate font-medium">{String(match.title || match.sku)}</p><p className="text-xs text-muted-foreground">{String(match.brand || "")}</p></TableCell><TableCell><Badge variant={match.reviewRequired ? "outline" : "secondary"}>{match.matchBasis}</Badge></TableCell><TableCell className="font-mono text-xs">{match.matchBasis === "UPC / GTIN" ? String(match.barcode || competitorInspection.product.gtin) : match.matchBasis === "Manufacturer part number" ? String(match.manufacturerPartNumber || competitorInspection.product.mpn) : competitorInspection.product.sku}</TableCell><TableCell className="text-right"><Button type="button" size="sm" onClick={() => addCompetitorMatch(match)}>Add to quote</Button></TableCell></TableRow>)}</TableBody></Table></div>
              </section> : <Alert><Info className="size-4" /><AlertTitle>No catalog SKU matched</AlertTitle><AlertDescription>Review the extracted facts below, then create a local draft SKU.</AlertDescription></Alert>}

              {competitorInspection.confirmedMatchCount === 0 ? <section className="grid gap-4 border-t pt-6">
                <div><h3 className="font-semibold">Create local draft SKU</h3><p className="mt-1 text-sm text-muted-foreground">The new SKU remains in Catalog Readiness until its product details are reviewed.</p></div>
                {competitorInspection.matches.length ? <Alert><AlertTriangle className="size-4" /><AlertTitle>Possible identifier matches need review</AlertTitle><AlertDescription>Use a candidate above when it is the same product. Create a new SKU only when none of those records match.</AlertDescription></Alert> : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Product title"><Input value={competitorDraft.title} onChange={(event) => setCompetitorDraft((current) => ({ ...current, title: event.target.value }))} /></Field>
                  <Field label="Brand"><Input value={competitorDraft.brand} onChange={(event) => setCompetitorDraft((current) => ({ ...current, brand: event.target.value }))} /></Field>
                  <Field label="UPC / GTIN"><Input inputMode="numeric" value={competitorDraft.gtin} onChange={(event) => setCompetitorDraft((current) => ({ ...current, gtin: event.target.value }))} /></Field>
                  <Field label="Manufacturer part number"><Input value={competitorDraft.mpn} onChange={(event) => setCompetitorDraft((current) => ({ ...current, mpn: event.target.value }))} /></Field>
                  <div className="sm:col-span-2"><Field label="Description"><Textarea className="min-h-24" value={competitorDraft.description} onChange={(event) => setCompetitorDraft((current) => ({ ...current, description: event.target.value }))} /></Field></div>
                </div>
                <div className="flex justify-end"><Button type="button" disabled={competitorCreateBusy || !competitorDraft.title.trim()} onClick={() => void createCompetitorSku()}>{competitorCreateBusy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Create draft SKU and add</Button></div>
              </section> : <Alert><CheckCircle2 className="size-4" /><AlertTitle>Confirmed identifier match found</AlertTitle><AlertDescription>Use one of the matching DataPlus SKUs above. Creating a duplicate SKU is disabled.</AlertDescription></Alert>}
            </> : <div className="grid min-h-48 place-items-center rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground"><div><Link2 className="mx-auto mb-3 size-7" /><p>Paste a public product page to search UPC, GTIN, page SKU, and manufacturer part number.</p></div></div>}
          </div>
        </ScrollArea>
        <DialogFooter className="shrink-0 border-t bg-background px-4 py-4 sm:px-6"><Button type="button" variant="outline" disabled={competitorBusy || competitorCreateBusy} onClick={() => setCompetitorOpen(false)}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={similarOpen} onOpenChange={setSimilarOpen}><DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto"><DialogHeader><DialogTitle>Similar SKUs</DialogTitle><DialogDescription>Suggestions prioritize active catalog items, availability, category match, and lower sell price when possible.</DialogDescription></DialogHeader>{similarLoading ? <div className="grid min-h-32 place-items-center"><Loader2 className="size-6 animate-spin text-primary" /></div> : <div className="grid gap-2">{similarResults.map((item) => <div key={String(item.sku)} className="grid gap-3 rounded-md border p-3 sm:grid-cols-[minmax(120px,0.35fr)_minmax(0,1fr)_120px_120px_auto]"><div className="font-mono text-xs font-semibold">{String(item.sku || "")}</div><div className="min-w-0"><p className="truncate font-medium">{String(item.title || item.sku || "")}</p><p className="truncate text-xs text-muted-foreground">{String(item.reason || "Catalog alternative")}</p></div><div><p className="text-xs text-muted-foreground">Available</p><p className="font-medium">{numberLabel(Number(item.available || 0))}</p></div><div><p className="text-xs text-muted-foreground">Price</p><p className="font-medium">{moneyLabel(Number(item.price || 0))}</p></div><Button size="sm" onClick={() => applySimilar(item)}>Apply</Button></div>)}{!similarResults.length && <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">No similar SKUs found for this line.</div>}</div>}<DialogFooter><Button variant="outline" onClick={() => setSimilarOpen(false)}>Close</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={editorOpen} onOpenChange={(open) => { if (!busy) setEditorOpen(open) }}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[92dvh] sm:w-[calc(100vw-2rem)] sm:!max-w-[1480px] sm:rounded-lg">
        <DialogHeader className="shrink-0 border-b px-4 py-4 pr-12 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle>Edit draft quote</DialogTitle>
              <DialogDescription className="mt-1">Build the proposal in focused sections while totals and readiness stay visible.</DialogDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2 pr-1">
              <Badge variant="outline">{form.items.length} line{form.items.length === 1 ? "" : "s"}</Badge>
              <Badge variant="outline">{numberLabel(formUnitCount)} unit{formUnitCount === 1 ? "" : "s"}</Badge>
              <Badge variant="outline" className={formGrossMargin === null ? "border-amber-500/40 text-amber-700 dark:text-amber-300" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}>{formGrossMargin === null ? `${form.items.length - formCostedLines.length} cost${form.items.length - formCostedLines.length === 1 ? "" : "s"} needed` : `${formGrossMargin.toFixed(1)}% margin`}</Badge>
              <Badge variant="secondary">{moneyLabel(formEstimatedTotal)}</Badge>
            </div>
          </div>
        </DialogHeader>

        <Tabs value={editorSection} onValueChange={(value) => setEditorSection(value as typeof editorSection)} className="min-h-0 flex flex-1 flex-col gap-0">
          <div className="shrink-0 overflow-x-auto border-b bg-muted/20 px-2 sm:px-4">
            <TabsList variant="line" className="h-auto min-w-max justify-start overflow-x-auto rounded-none border-0 bg-transparent p-0 md:grid md:w-full md:min-w-0 md:grid-cols-5">
              {editorSectionMeta.map((section) => {
                const Icon = section.icon
                return <TabsTrigger key={section.id} value={section.id} className="h-11 shrink-0 justify-center px-4 md:w-full">
                  <Icon className="size-4" />
                  {section.label}
                  {editorCompletion[section.id] ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : null}
                </TabsTrigger>
              })}
            </TabsList>
          </div>

          <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_290px]">
          <ScrollArea className="h-full min-h-0">
            <div className="p-4 sm:p-6 lg:p-8">
              <TabsContent value="items" className="m-0 grid gap-6">
                <div>
                  <h3 className="text-base font-semibold">Quote items</h3>
                  <p className="mt-1 text-sm text-muted-foreground">Search the approved catalog or add a manual line. Choosing an existing SKU increases its quantity.</p>
                </div>

                <FormField>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <FieldLabel htmlFor="quote-catalog-search">Add catalog product</FieldLabel>
                    <Button type="button" size="sm" variant="outline" onClick={openCompetitorLookup}><Link2 className="size-4" /> Add from URL</Button>
                  </div>
                  <Command shouldFilter={false} className="rounded-md border shadow-xs">
                    <CommandInput id="quote-catalog-search" autoFocus value={catalogQuery} onValueChange={setCatalogQuery} placeholder="Search SKU, UPC, title, or brand" />
                    {catalogQuery.trim().length >= 2 ? <CommandList className="border-t">
                      {catalogSearching ? <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Searching catalog...</div> : null}
                      {!catalogSearching && catalogResults.length ? <CommandGroup heading="Catalog results">
                        {catalogResults.map((item) => <CommandItem key={item.id || item.sku} value={String(item.sku || item.id)} onSelect={() => addCatalogItem(item)} className="grid grid-cols-[44px_minmax(90px,0.3fr)_minmax(0,1fr)_auto] gap-3 py-3">
                          <CatalogImage src={item.defaultImage} alt={String(item.title || item.sku || "Catalog product")} className="size-11" imageClassName="p-1" />
                          <span className="truncate font-mono text-xs font-medium">{item.sku}</span>
                          <span className="truncate">{item.title || item.marketplaceTitle || item.sku}</span>
                          <span className="font-semibold">{moneyLabel(Number(item.websitePrice ?? item.price ?? 0))}</span>
                        </CommandItem>)}
                      </CommandGroup> : null}
                      {!catalogSearching && !catalogResults.length ? <CommandEmpty>No catalog match. Add a manual line below.</CommandEmpty> : null}
                    </CommandList> : null}
                  </Command>
                </FormField>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">Proposal lines</p>
                    <p className="text-xs text-muted-foreground">Prices are per selling unit.</p>
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={() => setForm((current) => ({ ...current, items: [...current.items, {
                    sku: "", title: "", qty: "1", msrp: "0", mapPrice: "0", price: "0", cost: "", autoPrice: true, selectedSupplierKey: "", selectedSupplierId: "", selectedSupplierName: "", selectedSupplierCode: "", selectedSupplierSku: "", selectedSupplierProductId: "", selectedSupplierUom: "",
                    image: "", sourcePageSku: "", catalogProductId: "", catalogMatchedSku: "", catalogMatchBasis: "", catalogMatchReviewRequired: false, manufacturerPartNumber: "", barcode: "",
                  }] }))}><Plus className="size-4" /> Add manual line</Button>
                </div>

                {form.items.length ? <div className="overflow-x-auto rounded-md border">
                  <Table className="min-w-[1580px]">
                    <TableHeader><TableRow><TableHead className="w-36">SKU</TableHead><TableHead>Product</TableHead><TableHead className="w-60">Supplier</TableHead><TableHead className="w-20">Qty</TableHead><TableHead className="w-28">MSRP</TableHead><TableHead className="w-28">MAP</TableHead><TableHead className="w-36">Price</TableHead><TableHead className="w-24">Cost</TableHead><TableHead className="w-36">Profit margin</TableHead><TableHead className="w-28 text-right">Total</TableHead><TableHead className="w-12" /></TableRow></TableHeader>
                    <TableBody>{form.items.map((line, index) => {
                      const lineCost = quoteLineCost(line)
                      const linePrice = Math.max(0, Number(line.price || 0))
                      const lineQty = Math.max(0, Number(line.qty || 0))
                      const lineMap = Math.max(0, Number(line.mapPrice || 0))
                      const lineProfit = lineCost === null ? null : (linePrice - lineCost) * lineQty
                      const lineMargin = lineCost === null ? null : quoteMarginPercent(linePrice, lineCost)
                      const recommendedPrice = quoteRecommendedPrice(lineCost, lineMap)
                      const recommendationLabel = lineMap > 0 ? "MAP default" : "Cost +30%"
                      const skuKey = line.sku.trim().toLowerCase()
                      return <TableRow key={`${line.sku}-${index}`}>
                        <TableCell><Input value={line.sku} onChange={(event) => updateLine(index, { sku: event.target.value, cost: "", msrp: "0", mapPrice: "0", price: "0", autoPrice: true, image: "", sourcePageSku: "", catalogProductId: "", catalogMatchedSku: "", catalogMatchBasis: "", catalogMatchReviewRequired: false, manufacturerPartNumber: "", barcode: "", selectedSupplierKey: "", selectedSupplierId: "", selectedSupplierName: "", selectedSupplierCode: "", selectedSupplierSku: "", selectedSupplierProductId: "", selectedSupplierUom: "" })} placeholder="SKU" /></TableCell>
                        <TableCell><div className="flex min-w-96 items-center gap-3"><CatalogImage src={line.image || undefined} alt={line.title || line.sku || "Quote product"} className="size-12 shrink-0" imageClassName="p-1" /><div className="min-w-0 flex-1"><Input value={line.title} onChange={(event) => updateLine(index, { title: event.target.value })} placeholder="Product title" />{line.catalogProductId ? <p className={cn("mt-1 text-xs font-medium", line.catalogMatchReviewRequired ? "text-amber-600" : "text-emerald-600")}>{line.catalogMatchReviewRequired ? "Catalog candidate - review match" : "Matched to DataPlus catalog"}{line.catalogMatchBasis ? ` · ${line.catalogMatchBasis}` : ""}</p> : <p className="mt-1 text-xs text-destructive">No DataPlus catalog match</p>}</div></div></TableCell>
                        <TableCell><QuoteSupplierPicker line={line} options={supplierOptionsBySku[skuKey] || []} loading={supplierOptionsLoading.has(skuKey)} onSelect={(option) => updateLine(index, {
                          cost: option.cost === null ? "" : String(option.cost), selectedSupplierKey: option.key, selectedSupplierId: option.vendorId || "", selectedSupplierName: option.supplierName,
                          selectedSupplierCode: option.supplierCode || "", selectedSupplierSku: option.supplierSku || option.sourceSku || option.vendorSku || "", selectedSupplierProductId: option.productId || "", selectedSupplierUom: option.uom || "",
                          price: line.autoPrice ? String(quoteRecommendedPrice(option.cost, line.mapPrice)) : line.price,
                        })} /></TableCell>
                        <TableCell><Input type="number" min="1" inputMode="numeric" value={line.qty} onChange={(event) => updateLine(index, { qty: event.target.value })} /></TableCell>
                        <TableCell><InputGroup><InputGroupAddon>$</InputGroupAddon><InputGroupInput type="number" min="0" step="0.01" inputMode="decimal" value={line.msrp} onChange={(event) => updateLine(index, { msrp: event.target.value })} /></InputGroup></TableCell>
                        <TableCell><InputGroup><InputGroupAddon>$</InputGroupAddon><InputGroupInput type="number" min="0" step="0.01" inputMode="decimal" value={line.mapPrice} onChange={(event) => { const mapPrice = event.target.value; updateLine(index, { mapPrice, price: line.autoPrice ? String(quoteRecommendedPrice(lineCost, mapPrice)) : line.price }) }} /></InputGroup></TableCell>
                        <TableCell><div className="grid gap-1"><InputGroup><InputGroupAddon>$</InputGroupAddon><InputGroupInput type="number" min="0" step="0.01" inputMode="decimal" value={line.price} onChange={(event) => updateLine(index, { price: event.target.value, autoPrice: false })} /></InputGroup>{line.autoPrice ? <span className="text-xs text-muted-foreground">{recommendationLabel}</span> : <><span className={cn("text-xs", linePrice < lineMap ? "font-medium text-destructive" : "text-muted-foreground")}>{linePrice < lineMap ? "Manual price below MAP" : "Manual price"}</span><Button type="button" variant="ghost" size="sm" className="h-6 justify-start px-1 text-xs" onClick={() => updateLine(index, { price: String(recommendedPrice), autoPrice: true })}><RotateCcw className="size-3" /> Use recommended</Button></>}</div></TableCell>
                        <TableCell className="font-semibold tabular-nums">{lineCost === null ? <span className="text-muted-foreground">Not set</span> : moneyLabel(lineCost)}</TableCell>
                        <TableCell><p className={cn("font-semibold", lineProfit !== null && lineProfit < 0 ? "text-destructive" : lineProfit !== null ? "text-emerald-600" : "text-muted-foreground")}>{lineMargin === null ? "Cost needed" : `${lineMargin.toFixed(1)}%`}</p><p className="text-xs text-muted-foreground">{lineProfit === null ? "Select a supplier" : `${moneyLabel(lineProfit)} profit`}</p></TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{moneyLabel(lineQty * linePrice)}</TableCell>
                        <TableCell><Button type="button" size="icon" variant="ghost" title="Remove line" onClick={() => setForm((current) => ({ ...current, items: current.items.filter((_, lineIndex) => lineIndex !== index) }))}><Trash2 className="size-4" /></Button></TableCell>
                      </TableRow>
                    })}</TableBody>
                  </Table>
                </div> : <Empty className="border">
                  <EmptyHeader><EmptyMedia variant="icon"><PackageCheck /></EmptyMedia><EmptyTitle>No quote items yet</EmptyTitle><EmptyDescription>Search the catalog above or add a manual line to start the proposal.</EmptyDescription></EmptyHeader>
                </Empty>}
              </TabsContent>

              <TabsContent value="customer" className="m-0 grid gap-6">
                <div><h3 className="text-base font-semibold">Customer and quote status</h3><p className="mt-1 text-sm text-muted-foreground">Keep the buyer details and sales stage together.</p></div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Customer name"><Input autoFocus value={form.buyer} onChange={(event) => setForm({ ...form, buyer: event.target.value })} /></Field>
                  <Field label="Customer email"><Input type="email" value={form.buyerEmail} onChange={(event) => setForm({ ...form, buyerEmail: event.target.value })} /></Field>
                  <Field label="Phone"><Input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></Field>
                  <Field label="Status"><Select value={form.status} onValueChange={(status) => setForm({ ...form, status })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["draft", "reviewing", "quoted", "sent", "accepted", "lost"].map((status) => <SelectItem key={status} value={status}>{status.replace(/_/g, " ")}</SelectItem>)}</SelectContent></Select></Field>
                  <Field label="Source"><Select value={form.source} onValueChange={(source) => setForm({ ...form, source })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Manual", "Phone", "Email", "Shopify"].map((source) => <SelectItem key={source} value={source}>{source}</SelectItem>)}</SelectContent></Select></Field>
                  <Field label="Sales owner"><Input value={form.salesOwner} onChange={(event) => setForm({ ...form, salesOwner: event.target.value })} placeholder="Assigned salesperson" /></Field>
                  <Field label="Next follow-up"><Input type="datetime-local" value={form.nextFollowUpAt} onChange={(event) => setForm({ ...form, nextFollowUpAt: event.target.value })} /></Field>
                  <div className="sm:col-span-2"><Field label="Next action"><Input value={form.nextAction} onChange={(event) => setForm({ ...form, nextAction: event.target.value })} placeholder="Example: Call purchasing manager with revised pricing" /></Field></div>
                </div>
                <section className="grid gap-4 rounded-md border bg-muted/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Sales tax</h3><p className="mt-1 text-xs text-muted-foreground">Tax is calculated on products plus any saved customer shipping charge.</p></div><label className="flex items-center gap-2 text-sm font-medium"><Switch checked={form.taxExempt} onCheckedChange={(taxExempt) => setForm((current) => ({ ...current, taxExempt }))} /> Customer/company is tax exempt</label></div>
                  {!form.taxExempt ? <div className="grid gap-4 sm:grid-cols-3"><Field label="Tax entry"><Select value={form.taxMode} onValueChange={(taxMode: "rate" | "manual") => setForm((current) => ({ ...current, taxMode }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="rate">Tax rate</SelectItem><SelectItem value="manual">Manual amount</SelectItem></SelectContent></Select></Field>{form.taxMode === "rate" ? <Field label="Tax rate (%)"><Input type="number" min="0" max="100" step="0.001" inputMode="decimal" value={form.taxRate} onChange={(event) => setForm((current) => ({ ...current, taxRate: event.target.value }))} placeholder="8.875" /></Field> : <Field label="Tax amount"><Input type="number" min="0" step="0.01" inputMode="decimal" value={form.taxAmount} onChange={(event) => setForm((current) => ({ ...current, taxAmount: event.target.value }))} placeholder="0.00" /></Field>}<Detail label="Calculated tax" value={moneyLabel(formTaxAmount)} /></div> : <Alert><ShieldCheck className="size-4" /><AlertTitle>Tax exempt</AlertTitle><AlertDescription>No sales tax will be added to this quote or the converted order.</AlertDescription></Alert>}
                </section>
              </TabsContent>

              <TabsContent value="delivery" className="m-0 grid gap-6">
                <div><h3 className="text-base font-semibold">Ship-to address</h3><p className="mt-1 text-sm text-muted-foreground">A complete destination is required before comparing carrier rates.</p></div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Address line 1"><Input autoFocus value={form.line1} onChange={(event) => setForm({ ...form, line1: event.target.value })} /></Field>
                  <Field label="Address line 2"><Input value={form.line2} onChange={(event) => setForm({ ...form, line2: event.target.value })} /></Field>
                  <Field label="City"><Input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} /></Field>
                  <Field label="State / province"><Input value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })} /></Field>
                  <Field label="Postal code"><Input value={form.postalCode} onChange={(event) => setForm({ ...form, postalCode: event.target.value })} /></Field>
                  <Field label="Country"><Input value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value })} /></Field>
                </div>
                {!editorCompletion.delivery ? <Alert><Info className="size-4" /><AlertTitle>Destination is incomplete</AlertTitle><AlertDescription>You can save the draft now, but carrier rates need address line 1, city, state, and postal code.</AlertDescription></Alert> : null}
              </TabsContent>

              <TabsContent value="terms" className="m-0 grid gap-8">
                <section className="grid gap-4">
                  <div><h3 className="text-base font-semibold">Quote validity</h3><p className="mt-1 text-sm text-muted-foreground">Set a clear customer deadline. New and duplicated quotes default to 30 days.</p></div>
                  <div className="flex flex-wrap items-end gap-3">
                    <ButtonGroup>
                      <Button type="button" variant={form.expiresAt === quoteDateAfter(7) ? "default" : "outline"} onClick={() => setForm({ ...form, expiresAt: quoteDateAfter(7) })}>7 days</Button>
                      <Button type="button" variant={form.expiresAt === quoteDateAfter(30) ? "default" : "outline"} onClick={() => setForm({ ...form, expiresAt: quoteDateAfter(30) })}>30 days</Button>
                    </ButtonGroup>
                    <Popover open={expirationCalendarOpen} onOpenChange={setExpirationCalendarOpen}><PopoverTrigger asChild><Button type="button" variant="outline"><CalendarDays className="size-4" /> Custom date</Button></PopoverTrigger><PopoverContent align="start" className="w-auto p-2"><Calendar mode="single" selected={expirationDate} disabled={{ before: new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()) }} onSelect={(date) => { if (date) setForm((current) => ({ ...current, expiresAt: quoteDateKey(date) })); setExpirationCalendarOpen(false) }} /></PopoverContent></Popover>
                    <Field label="Valid until"><Input type="date" min={quoteDateKey(new Date())} value={form.expiresAt} onChange={(event) => setForm({ ...form, expiresAt: event.target.value })} /></Field>
                  </div>
                </section>

                <section className="grid gap-4 border-t pt-6">
                  <div><h3 className="text-base font-semibold">Terms and conditions</h3><p className="mt-1 text-sm text-muted-foreground">Check only the approved terms that apply. Terms in the same exclusive group cannot be selected together.</p></div>
                  {quoteTermGroups.length ? <div className="grid gap-5 xl:grid-cols-2">{quoteTermGroups.map((group) => <section key={group} className="grid content-start gap-2"><p className="text-sm font-semibold">{group}</p>{editableQuoteTerms.filter((term) => term.group === group).map((term) => { const checked = form.selectedTermIds.includes(term.id); return <label key={term.id} className={cn("flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors", checked && "border-primary/50 bg-primary/5", !term.active && "opacity-60")}><Checkbox className="mt-0.5" checked={checked} onCheckedChange={(value) => toggleTerm(term.id, value === true)} /><span><span className="flex flex-wrap items-center gap-2 text-sm font-medium">{term.label}{!term.active ? <Badge variant="outline">Inactive</Badge> : null}</span><span className="mt-0.5 block text-xs text-muted-foreground">{term.text}</span></span></label> })}</section>)}</div> : <Alert><Info className="size-4" /><AlertTitle>No quote terms configured</AlertTitle><AlertDescription>An administrator can add customer terms under Settings &gt; Sales.</AlertDescription></Alert>}
                  <Field label="Custom customer terms"><Textarea className="min-h-24" value={form.customTerms} onChange={(event) => setForm({ ...form, customTerms: event.target.value })} placeholder="Add only approved customer-facing terms that are specific to this quote." /></Field>
                </section>
              </TabsContent>

              <TabsContent value="notes" className="m-0 grid gap-7">
                <div><h3 className="text-base font-semibold">Sales notes</h3><p className="mt-1 text-sm text-muted-foreground">Keep internal context separate from the message that appears on customer PDFs.</p></div>
                <Field label="Internal notes"><Textarea autoFocus className="min-h-40" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Only DataPlus staff can see these notes" /></Field>
                <Field label="Customer message"><Textarea className="min-h-40" value={form.customerNote} onChange={(event) => setForm({ ...form, customerNote: event.target.value })} placeholder="Included on every customer quote version" /></Field>
              </TabsContent>
            </div>
          </ScrollArea>

          <aside className="hidden min-h-0 border-l bg-muted/20 lg:block">
            <ScrollArea className="h-full">
              <div className="grid gap-6 p-5">
                <section>
                  <div className="flex items-center justify-between gap-2"><p className="font-semibold">Quote summary</p><Badge variant="outline" className="capitalize">{form.status.replace(/_/g, " ")}</Badge></div>
                  <div className="mt-4 grid gap-2 text-sm">
                    <div className="flex justify-between gap-3 text-muted-foreground"><span>{form.items.length} product line{form.items.length === 1 ? "" : "s"}</span><span>{numberLabel(formUnitCount)} units</span></div>
                    <div className="flex justify-between gap-3"><span>Products</span><span className="font-medium tabular-nums">{moneyLabel(formSubtotal)}</span></div>
                    <div className="flex justify-between gap-3"><span>Supplier cost</span><span className="font-medium tabular-nums">{formCostsComplete ? moneyLabel(formProductCost) : "Incomplete"}</span></div>
                    {formSavings > 0 ? <div className="flex justify-between gap-3 text-emerald-600"><span>Customer savings</span><span className="font-medium tabular-nums">{moneyLabel(formSavings)}</span></div> : null}
                    <div className={cn("flex justify-between gap-3", formGrossProfit !== null && formGrossProfit < 0 ? "text-destructive" : formGrossProfit !== null ? "text-emerald-600" : "text-amber-600")}><span>Gross profit</span><span className="font-medium tabular-nums">{formGrossProfit === null ? "Cost needed" : moneyLabel(formGrossProfit)}</span></div>
                    <div className={cn("flex justify-between gap-3", formGrossMargin !== null && formGrossMargin < 0 ? "text-destructive" : formGrossMargin !== null ? "text-emerald-600" : "text-amber-600")}><span>Gross margin</span><span className="font-medium tabular-nums">{formGrossMargin === null ? "-" : `${formGrossMargin.toFixed(1)}%`}</span></div>
                    <div className="flex justify-between gap-3"><span>Saved shipping</span><span className="font-medium tabular-nums">{savedShippingEstimate ? moneyLabel(shippingAmount) : "Not quoted"}</span></div>
                    <div className="flex justify-between gap-3"><span>Sales tax</span><span className="font-medium tabular-nums">{form.taxExempt ? "Exempt" : moneyLabel(formTaxAmount)}</span></div>
                    <div className="mt-2 flex justify-between gap-3 border-t pt-3 text-base font-semibold"><span>Estimated total</span><span className="tabular-nums">{moneyLabel(formEstimatedTotal)}</span></div>
                  </div>
                </section>

                <section className="border-t pt-5">
                  <p className="font-semibold">Readiness</p>
                  <div className="mt-3 grid gap-2.5 text-sm">
                    {[{ label: "Quote items", ready: editorCompletion.items }, { label: "Supplier costs", ready: formCostsComplete }, { label: "Customer", ready: editorCompletion.customer }, { label: "Delivery address", ready: editorCompletion.delivery }, { label: "Expiration date", ready: editorCompletion.terms }].map((check) => <div key={check.label} className="flex items-center gap-2"><CheckCircle2 className={cn("size-4", check.ready ? "text-emerald-500" : "text-muted-foreground/35")} /><span className={check.ready ? "" : "text-muted-foreground"}>{check.label}</span></div>)}
                  </div>
                </section>

                <section className="border-t pt-5">
                  <p className="font-semibold">Customer terms</p>
                  <p className="mt-2 text-sm text-muted-foreground">{form.selectedTermIds.length} selected</p>
                  <p className="mt-1 text-sm text-muted-foreground">Valid until {form.expiresAt ? dateLabel(form.expiresAt) : "not set"}</p>
                </section>
              </div>
            </ScrollArea>
          </aside>
          </div>
        </Tabs>

        <DialogFooter className="!m-0 !flex-row shrink-0 flex-wrap items-center justify-between rounded-none border-t bg-background px-4 py-3 sm:px-6 sm:!justify-between">
          <span className="hidden text-xs text-muted-foreground sm:block">Section {editorSectionIndex + 1} of {editorSections.length}</span>
          <div className="ml-auto flex flex-wrap justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setEditorOpen(false)}>Cancel</Button>
            {editorSectionIndex > 0 ? <Button variant="outline" disabled={busy} onClick={() => setEditorSection(editorSections[editorSectionIndex - 1])}><ChevronLeft className="size-4" /> Previous</Button> : null}
            {editorSectionIndex < editorSections.length - 1 ? <Button variant="outline" disabled={busy} onClick={() => setEditorSection(editorSections[editorSectionIndex + 1])}>Next <ChevronRight className="size-4" /></Button> : null}
            <Button disabled={busy || !form.expiresAt} onClick={() => void save()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save quote</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
}

type PooledSupplierGroup = {
  key: string
  vendorId: string
  supplier: string
  requirements: Array<Record<string, unknown>>
  orderIds: Set<string>
  skus: Set<string>
  destinations: Set<string>
  poGroups: Set<string>
  units: number
  nextCutoff?: Record<string, unknown>
  due: boolean
}

function pooledSupplierKey(row: Record<string, unknown>) {
  const vendorId = String(row.vendorId || "").trim()
  if (vendorId) return `vendor:${vendorId}`
  const supplier = String(row.vendorName || "Unassigned").trim().toLowerCase()
  return `name:${supplier || "unassigned"}`
}

function pooledRequirementDestination(row: Record<string, unknown>) {
  return String(row.warehouseName || row.destinationWarehouseName || "Order destination")
}

function pooledRequirementCutoff(row: Record<string, unknown>) {
  const date = String(row.poolDate || row.cutoffDate || "").split("T")[0]
  const time = String(row.cutoffTime || "15:00")
  if (!date) return Number.POSITIVE_INFINITY
  const parsed = new Date(`${date}T${time.length === 5 ? `${time}:00` : time}`).getTime()
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY
}

export function groupPooledRequirements(rows: Array<Record<string, unknown>>) {
  const groups = new Map<string, PooledSupplierGroup>()
  rows.forEach((row) => {
    const key = pooledSupplierKey(row)
    const vendorId = String(row.vendorId || "").trim()
    const supplier = String(row.vendorName || "Unassigned")
    const destination = pooledRequirementDestination(row)
    const cutoffMs = pooledRequirementCutoff(row)
    const poolDate = String(row.poolDate || row.cutoffDate || "Next business day")
    const cutoffTime = String(row.cutoffTime || "15:00")
    const group = groups.get(key) || {
      key,
      vendorId,
      supplier,
      requirements: [],
      orderIds: new Set<string>(),
      skus: new Set<string>(),
      destinations: new Set<string>(),
      poGroups: new Set<string>(),
      units: 0,
      due: false,
    }
    group.requirements.push(row)
    if (row.orderId) group.orderIds.add(String(row.orderId))
    if (row.sku) group.skus.add(String(row.sku))
    group.destinations.add(destination)
    group.poGroups.add(`${destination}|${poolDate}|${cutoffTime}`)
    group.units += Number(row.qty || 0)
    if (!group.nextCutoff || cutoffMs < pooledRequirementCutoff(group.nextCutoff)) group.nextCutoff = row
    if (cutoffMs <= Date.now()) group.due = true
    groups.set(key, group)
  })
  return [...groups.values()].sort((left, right) => left.supplier.localeCompare(right.supplier))
}

type WaitingPoSupplierGroup = {
  key: string
  vendorId: string
  supplier: string
  purchaseOrders: Array<Record<string, unknown>>
  orderIds: Set<string>
  skus: Set<string>
  destinations: Set<string>
  units: number
  estimatedCost: number
  nextCutoffMs: number
  nextCutoffPo?: Record<string, unknown>
  readyForReview: boolean
}

function purchaseOrderItems(po: Record<string, unknown>) {
  return (Array.isArray(po.items) ? po.items : Array.isArray(po.lines) ? po.lines : []) as Array<Record<string, unknown>>
}

function purchaseOrderHasSubmission(po: Record<string, unknown>) {
  if (purchaseOrderCtechNumber(po)) return true
  if (po.submissionActive === false) return false
  return Boolean(po.submittedAt || po.placedAt || po.sentAt)
    || (Array.isArray(po.submissions) && po.submissions.length > 0)
    || (Array.isArray(po.submissionHistory) && po.submissionHistory.length > 0)
}

function purchaseOrderHasTracking(po: Record<string, unknown>) {
  return Boolean(String(po.trackingNumber || "").trim())
    || (Array.isArray(po.dropshipShipments) && po.dropshipShipments.some((shipment) => Boolean(String((shipment as Record<string, unknown>).trackingNumber || "").trim())))
}

function purchaseOrderIsWaiting(po: Record<string, unknown>) {
  const status = String(po.status || "draft").toLowerCase()
  const approval = (po.approval || {}) as Record<string, unknown>
  return String(po.type || "") === "customer_demand"
    && status === "draft"
    && !purchaseOrderHasSubmission(po)
    && !Boolean(po.readyForReview)
    && (po.manualDraftHold === true || waitingPoCutoff(po) > Date.now())
    && String(approval.status || "").toLowerCase() !== "rejected"
}

export function purchaseOrderIsReadyToSubmit(po: Record<string, unknown>) {
  const status = String(po.status || "draft").toLowerCase()
  const type = String(po.type || "").toLowerCase()
  const approvalStatus = String(((po.approval || {}) as Record<string, unknown>).status || "").toLowerCase()
  if (po.manualDraftHold === true) return false
  if (type === "manual_inventory") {
    return !purchaseOrderHasSubmission(po)
      && !["hold", "rejected", "canceled", "superseded", "deleted", "received", "closed"].includes(status)
      && approvalStatus !== "rejected"
  }
  return type === "customer_demand"
    && !purchaseOrderHasSubmission(po)
    && !["hold", "rejected", "canceled", "superseded", "deleted", "received", "closed"].includes(status)
    && approvalStatus !== "rejected"
    && (status === "ready_to_send"
    || status === "awaiting_approval"
    || status === "approved"
    || Boolean(po.readyForReview)
    || waitingPoCutoff(po) <= Date.now()
    || approvalStatus === "approved")
}

export function purchaseRequirementStatusLabel(status: unknown) {
  const value = String(status || "new").toLowerCase()
  if (value === "converted") return "Added to PO"
  if (value === "pooled") return "Awaiting draft PO"
  if (value === "buyer_review") return "Unassigned Orders"
  if (value.includes("exception")) return "Needs attention"
  return value.replace(/_/g, " ")
}

type PurchaseOrderNextStep = {
  label: string
  description: string
  variant: "default" | "secondary" | "outline" | "destructive"
  priority: number
}

function purchaseOrderNextStep(po: Record<string, unknown>): PurchaseOrderNextStep {
  const status = String(po.status || "draft").toLowerCase()
  const type = String(po.type || "").toLowerCase()
  const approval = (po.approval || {}) as Record<string, unknown>
  const approvalStatus = String(approval.status || "").toLowerCase()
  const approvalRequired = approval.required === true
    || po.approvalRequired === true
    || po.requiresApproval === true
    || status === "awaiting_approval"
  const approved = approvalStatus === "approved"
  const cutoffReached = status === "ready_to_send" || Boolean(po.readyForReview) || waitingPoCutoff(po) <= Date.now()

  if (["canceled", "cancelled"].includes(status)) {
    const reason = [po.cancelReasonLabel || po.cancelReason || "Reason was not recorded", po.cancelReasonNote].filter(Boolean).map(String).join(": ")
    return { label: "Purchase order canceled", description: reason, variant: "destructive", priority: 0 }
  }

  if (["partially_received", "receiving"].includes(status)) {
    return { label: "Receive shipment", description: "This warehouse-bound PO is in the receiving workflow.", variant: "default", priority: 2 }
  }
  if (status === "in_transit" || String(po.workflowStage || "").toLowerCase() === "incoming") {
    return { label: "Incoming", description: po.noTrackingNeeded === true ? "The supplier does not provide tracking. Receive this PO when it arrives." : "The supplier shipment is on its way to the receiving warehouse.", variant: "secondary", priority: 2 }
  }
  if (purchaseOrderHasSubmission(po) || ["submitted", "placed", "sent", "acknowledged", "vendor_confirmed"].includes(status)) {
    return purchaseOrderHasTracking(po)
      ? { label: "Shipment recorded", description: "Tracking is saved. Follow the shipment through fulfillment or warehouse receiving.", variant: "secondary", priority: 1 }
      : { label: "Awaiting tracking", description: "The PO is with the supplier. Record tracking when the supplier ships it.", variant: "outline", priority: 3 }
  }

  if (status === "hold" || approvalStatus === "rejected") {
    return { label: "Buyer review", description: "Resolve the hold or rejection before this PO can move forward.", variant: "destructive", priority: 4 }
  }
  if (approvalRequired && !approved) {
    return cutoffReached
      ? { label: "Needs approval", description: "Approve or hold this draft before it can be sent to the supplier.", variant: "outline", priority: 3 }
      : { label: "Collecting orders", description: "Eligible orders can continue joining this draft until cutoff; approval follows.", variant: "secondary", priority: 1 }
  }
  if (type === "manual_inventory") {
    return { label: "Ready to send", description: "Review quantities, cost, and delivery details, then submit it to the supplier.", variant: "default", priority: 2 }
  }
  if (approved || cutoffReached) {
    return { label: "Ready to send", description: "Review quantities, cost, and delivery details, then submit it to the supplier.", variant: "default", priority: 2 }
  }
  return { label: "Collecting orders", description: "Eligible orders will keep joining this supplier draft until cutoff.", variant: "secondary", priority: 1 }
}

function PurchaseOrderProgress({ po }: { po: Record<string, unknown> }) {
  const status = String(po.status || "draft").toLowerCase()
  const workflowStage = String(po.workflowStage || "").toLowerCase()
  const approval = (po.approval || {}) as Record<string, unknown>
  const lines = Array.isArray(po.items) ? po.items as Array<Record<string, unknown>> : []
  const ordered = lines.reduce((sum, line) => sum + Number(line.qty || line.quantity || 0), 0)
  const received = lines.reduce((sum, line) => sum + Number(line.receivedQty || 0), 0)
  const stopped = ["canceled", "cancelled", "rejected", "superseded", "deleted", "hold"].includes(status)
  const complete = ["received", "closed", "completed"].includes(status) || Boolean(ordered > 0 && received >= ordered)
  const inbound = complete || ["in_transit", "partially_received", "receiving", "incoming"].includes(status) || workflowStage === "incoming" || Boolean(po.trackingNumber || received > 0)
  const ctechId = purchaseOrderCtechNumber(po)
  const sent = inbound || purchaseOrderHasSubmission(po) || ["submitted", "placed", "sent", "acknowledged", "vendor_confirmed"].includes(status)
  const approved = sent || String(approval.status || "").toLowerCase() === "approved" || ["approved", "ready_to_send"].includes(status)
  const activeIndex = complete ? 4 : inbound ? 3 : sent ? 2 : approved ? 1 : 0
  const steps = [
    { label: "Draft", detail: "Created" },
    { label: "Approved / sent", detail: ctechId ? `CTech ${ctechId}` : approved ? "Buyer approved" : "Pending approval" },
    { label: "Awaiting tracking", detail: sent ? (po.trackingNumber ? "Tracking received" : "With supplier") : "Not sent" },
    { label: "Inbound", detail: inbound ? (received > 0 ? `${numberLabel(received)} received` : "In transit") : "Not shipped" },
    { label: "Complete", detail: complete ? "Receiving complete" : "Open" },
  ]

  return <section aria-label="Purchase order progress" className="min-w-0 overflow-hidden rounded-md border bg-card">
    <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
      <div className="min-w-0"><p className="text-sm font-semibold">Purchase order progress</p><p className="text-xs text-muted-foreground">From buyer approval through warehouse receiving.</p></div>
      {stopped ? <Badge variant="destructive">{status.replace(/_/g, " ")}</Badge> : <Badge variant={complete ? "success" : "outline"}>{steps[activeIndex].label}</Badge>}
    </div>
    <div className="overflow-x-auto px-4 py-4">
      <ol className="grid min-w-[42rem] grid-cols-5">
        {steps.map((step, index) => {
          const done = !stopped && index < activeIndex
          const current = !stopped && index === activeIndex
          return <li key={step.label} className="relative min-w-0 pr-3 last:pr-0">
            {index < steps.length - 1 ? <span aria-hidden="true" className={cn("absolute left-5 right-0 top-3 h-px", done ? "bg-emerald-500" : "bg-border")} /> : null}
            <div className="relative z-10 flex items-start gap-2">
              <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border bg-background", done && "border-emerald-500 bg-emerald-500 text-white", current && "border-primary bg-primary text-primary-foreground", stopped && index === activeIndex && "border-destructive bg-destructive text-destructive-foreground")}>
                {done ? <CheckCircle2 className="size-4" /> : <span className="size-1.5 rounded-full bg-current" />}
              </span>
              <span className="min-w-0"><span className={cn("block text-xs font-semibold", !done && !current && "text-muted-foreground")}>{step.label}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{step.detail}</span></span>
            </div>
          </li>
        })}
      </ol>
    </div>
  </section>
}

export function purchaseOrderOperator(po: Record<string, unknown>, kind: "approval" | "placement") {
  const approval = (po.approval || {}) as Record<string, unknown>
  if (kind === "approval" && approval.approvedBy) return { name: String(approval.approvedBy), at: String(approval.approvedAt || "") }
  if (kind === "placement") {
    if (po.placedBy || po.submittedBy) return { name: String(po.placedBy || po.submittedBy), at: String(po.placedAt || po.submittedAt || po.sentAt || "") }
    const submissions = Array.isArray(po.submissionHistory) ? po.submissionHistory as Array<Record<string, unknown>> : []
    const submission = [...submissions].reverse().find((entry) => entry.user)
    if (submission) return { name: String(submission.user), at: String(submission.createdAt || po.submittedAt || "") }
    const timeline = Array.isArray(po.timeline) ? po.timeline as Array<Record<string, unknown>> : []
    const placement = [...timeline].reverse().find((entry) => /placed with vendor|submitted|sent/i.test(`${String(entry.title || "")} ${String(entry.message || "")}`) && entry.user)
    if (placement) return { name: String(placement.user), at: String(placement.createdAt || placement.at || po.placedAt || "") }
  }
  return { name: "", at: "" }
}

export function purchaseOrderTrackingState(po: Record<string, unknown>) {
  if (po.noTrackingNeeded === true) return { label: "Tracking not required", variant: "secondary" as const }
  const shipment = (po.inboundShipment || po.shipment || {}) as Record<string, unknown>
  const rawStatus = String(po.trackingStatus || po.carrierStatus || shipment.trackingStatus || shipment.status || "").toLowerCase()
  if (rawStatus.includes("deliver")) return { label: "Delivered", variant: "success" as const }
  if (rawStatus.includes("transit")) return { label: "In transit", variant: "secondary" as const }
  if (rawStatus.includes("ship") || rawStatus.includes("pickup") || purchaseOrderHasTracking(po)) return { label: "Shipped", variant: "success" as const }
  return { label: "Tracking pending", variant: "warning" as const }
}

type SupplierSubmissionCapability = {
  enabled?: boolean
  inboundTrackingExpected?: boolean
  preferredMethod?: string
  ready?: boolean
  sendNowEnabled?: boolean
  methods?: string[]
}

type PurchaseOrderApprovalDecision = {
  id: string
  poNumber: string
  supplier: string
  capability: SupplierSubmissionCapability
}

type PurchaseOrderRejectionDecision = {
  id: string
  poNumber: string
  supplier: string
}

function PurchaseOrderApprovalFollowUpDialog({ decision, busy, onBusyChange, onClose, onCompleted, user = "Luis" }: {
  decision: PurchaseOrderApprovalDecision | null
  busy: boolean
  onBusyChange: (busy: boolean) => void
  onClose: () => void
  onCompleted: () => Promise<void> | void
  user?: string
}) {
  const [noTrackingNeeded, setNoTrackingNeeded] = useState(false)
  useEffect(() => { if (decision) setNoTrackingNeeded(decision.capability.inboundTrackingExpected === false) }, [decision?.id, decision?.capability.inboundTrackingExpected])
  const advance = async (mode: "send" | "placed") => {
    if (!decision || busy) return
    onBusyChange(true)
    try {
      if (mode === "send") {
        await api(`/api/purchase-orders/${encodeURIComponent(decision.id)}/submit`, { method: "POST", body: JSON.stringify({ method: "preferred", noTrackingNeeded, user }) })
        toast.success(noTrackingNeeded ? `${decision.poNumber} sent and moved to Incoming.` : `${decision.poNumber} sent and moved to Awaiting tracking.`)
      } else {
        await api(`/api/purchase-orders/${encodeURIComponent(decision.id)}/action`, { method: "POST", body: JSON.stringify({ action: "mark_placed", noTrackingNeeded, user }) })
        toast.success(noTrackingNeeded ? `${decision.poNumber} moved to Incoming.` : `${decision.poNumber} moved to Awaiting tracking.`)
      }
      onClose()
      await onCompleted()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to advance this purchase order.")
    } finally { onBusyChange(false) }
  }
  const methods = decision?.capability.methods || []
  const sendNowEnabled = decision?.capability.sendNowEnabled === true || (decision?.capability.ready === true && methods.length > 0)
  return <Dialog open={Boolean(decision)} onOpenChange={(open) => { if (!open && !busy) onClose() }}>
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>Purchase order approved</DialogTitle><DialogDescription>{decision ? `${decision.poNumber} for ${decision.supplier} is approved. Send it now or confirm that it was placed with the vendor. Until then, it remains Approved, not sent in Review & send.` : "Choose the next purchasing step."}</DialogDescription></DialogHeader>
      <div className="grid gap-3">
        <div className="rounded-md border bg-muted/30 p-3"><p className="text-sm font-medium">Supplier delivery method</p><p className="mt-1 text-xs text-muted-foreground">{sendNowEnabled ? `Send now is available by ${methods.map((method) => method.toUpperCase()).join(", ")}.` : "No enabled API, FTP, or email destination is configured on this supplier profile."}</p></div>
        <label className="flex items-center justify-between gap-4 rounded-md border p-3"><span><span className="block text-sm font-medium">No tracking needed</span><span className="block text-xs text-muted-foreground">Move directly to Incoming after the PO is sent or confirmed placed.{decision?.capability.inboundTrackingExpected === false ? " This is the supplier profile default." : ""}</span></span><Switch checked={noTrackingNeeded} onCheckedChange={setNoTrackingNeeded} /></label>
      </div>
      <DialogFooter className="gap-2 sm:justify-between">
        <Button variant="ghost" disabled={busy} onClick={onClose}>Keep approved, not sent</Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button className="h-auto min-h-9 whitespace-normal" variant="outline" disabled={busy} onClick={() => void advance("placed")}><CheckCircle2 className="size-4 shrink-0" /> PO has been placed with vendor</Button>
          <Button disabled={busy || !sendNowEnabled} onClick={() => void advance("send")}>{busy ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />} Send now</Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}

function PurchaseOrderRejectionDialog({ decision, busy, onClose, onConfirm }: {
  decision: PurchaseOrderRejectionDecision | null
  busy: boolean
  onClose: () => void
  onConfirm: (disposition: string, note: string, externalPlacement?: { sourceSystem: string; externalPoNumber: string; noTrackingNeeded: boolean }) => Promise<void>
}) {
  const [disposition, setDisposition] = useState("")
  const [note, setNote] = useState("")
  const [sourceSystem, setSourceSystem] = useState("")
  const [externalPoNumber, setExternalPoNumber] = useState("")
  const [noTrackingNeeded, setNoTrackingNeeded] = useState(false)
  const [cancellationConfirmed, setCancellationConfirmed] = useState(false)
  useEffect(() => { if (decision) { setDisposition(""); setNote(""); setSourceSystem(""); setExternalPoNumber(""); setNoTrackingNeeded(false); setCancellationConfirmed(false) } }, [decision?.id])
  const cancelDemand = disposition === "cancel_customer_demand"
  const dismissDemand = disposition === "dismiss_demand"
  const externalSource = disposition === "external_source"
  return <Dialog open={Boolean(decision)} onOpenChange={(open) => { if (!open && !busy) onClose() }}>
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>Reject or redirect purchase order</DialogTitle><DialogDescription>{decision ? `Choose what happens to ${decision.poNumber} for ${decision.supplier}. An external placement keeps its linked demand active; the other choices reject this DataPlus PO.` : "Choose a disposition for the linked demand."}</DialogDescription></DialogHeader>
      <div className="grid gap-4">
        <Field label="PO disposition"><Select value={disposition} onValueChange={(value) => { setDisposition(value); setCancellationConfirmed(false) }}><SelectTrigger><SelectValue placeholder="Choose what happens next" /></SelectTrigger><SelectContent><SelectItem value="external_source">PO placed from another source</SelectItem><SelectItem value="dismiss_demand">Dismiss items from purchasing</SelectItem><SelectItem value="return_to_sourcing">Return to sourcing / replacement PO</SelectItem><SelectItem value="warehouse_fulfillment">Move to warehouse fulfillment</SelectItem><SelectItem value="cancel_customer_demand">Customer demand was canceled</SelectItem><SelectItem value="duplicate_test">Void duplicate or test PO</SelectItem></SelectContent></Select></Field>
        {externalSource ? <div className="grid gap-4 rounded-md border bg-muted/20 p-3"><div className="grid gap-4 sm:grid-cols-2"><Field label="Source system"><Input value={sourceSystem} onChange={(event) => setSourceSystem(event.target.value)} placeholder="CTech, legacy ERP, etc." /></Field><Field label="External PO number (optional)"><Input value={externalPoNumber} onChange={(event) => setExternalPoNumber(event.target.value)} placeholder="Can be added later" /></Field></div><label className="flex items-center justify-between gap-4"><span><span className="block text-sm font-medium">No tracking needed</span><span className="block text-xs text-muted-foreground">Move directly to Incoming instead of waiting for tracking.</span></span><Switch checked={noTrackingNeeded} onCheckedChange={setNoTrackingNeeded} /></label></div> : null}
        <Field label={externalSource ? "Placement note (optional)" : "Rejection reason"}><Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={externalSource ? "Add any details about where or how the PO was placed" : "Explain why this purchasing attempt is being rejected"} /></Field>
        {cancelDemand ? <label className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3"><Checkbox checked={cancellationConfirmed} onCheckedChange={(checked) => setCancellationConfirmed(checked === true)} /><span><span className="block text-sm font-medium">The customer demand is canceled</span><span className="block text-xs text-muted-foreground">This removes the linked demand from active fulfillment. Use only after confirming the marketplace or customer cancellation.</span></span></label> : null}
        {dismissDemand ? <label className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3"><Checkbox checked={cancellationConfirmed} onCheckedChange={(checked) => setCancellationConfirmed(checked === true)} /><span><span className="block text-sm font-medium">Stop sourcing these items</span><span className="block text-xs text-muted-foreground">The lines will leave active POs, dropships, and sourcing queues. The customer order remains unfulfilled with an audit record and will not be sourced again automatically.</span></span></label> : null}
      </div>
      <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>Keep PO</Button><Button variant={externalSource ? "default" : "destructive"} disabled={busy || !disposition || (externalSource ? !sourceSystem.trim() : !note.trim()) || ((cancelDemand || dismissDemand) && !cancellationConfirmed)} onClick={() => void onConfirm(disposition, note.trim(), externalSource ? { sourceSystem: sourceSystem.trim(), externalPoNumber: externalPoNumber.trim(), noTrackingNeeded } : undefined)}>{busy ? <Loader2 className="size-4 animate-spin" /> : externalSource ? <ExternalLink className="size-4" /> : <Ban className="size-4" />} {externalSource ? "Record external placement" : "Reject PO"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

export function purchaseOrderCancellationReason(po: Record<string, unknown>) {
  return [po.cancelReasonLabel || po.cancelReason || "Canceled", po.cancelReasonNote]
    .filter(Boolean)
    .map(String)
    .join(": ")
}

export function purchaseOrderCancellationActor(po: Record<string, unknown>) {
  if (String(po.canceledBy || "").trim()) return String(po.canceledBy)
  const timeline = Array.isArray(po.timeline) ? po.timeline as Array<Record<string, unknown>> : []
  const event = [...timeline].reverse().find((entry) => ["customer_order_canceled", "canceled", "cancelled"].includes(String(entry.type || "").toLowerCase()))
  return String(event?.user || "System")
}

export function purchaseOrderCanceledOrders(po: Record<string, unknown>) {
  const references = new Map<string, { id: string; number: string }>()
  const orderIds = Array.isArray(po.orderIds) ? po.orderIds as unknown[] : []
  const orderNumbers = Array.isArray(po.orderNumbers) ? po.orderNumbers as unknown[] : []
  orderIds.forEach((value, index) => {
    const id = String(value || "").trim()
    const number = String(orderNumbers[index] || id).trim()
    if (id || number) references.set(id || number, { id, number })
  })
  const removedDemand = Array.isArray(po.removedDemand) ? po.removedDemand as Array<Record<string, unknown>> : []
  removedDemand.forEach((line) => {
    const id = String(line.orderId || "").trim()
    const number = String(line.orderNumber || id).trim()
    if (id || number) references.set(id || number, { id, number })
  })
  if (!references.size && String(po.orderNumber || "").trim()) {
    const number = String(po.orderNumber).trim()
    references.set(number, { id: String(po.orderId || "").trim(), number })
  }
  return [...references.values()]
}

function purchaseLineSupplierOffers(line: Record<string, unknown>, fallbackSupplier = "") {
  const selectedName = String(line.supplier || line.vendorName || fallbackSupplier || "Unassigned supplier").trim()
  const selectedVendorId = String(line.vendorId || "").trim()
  const rawOffers = Array.isArray(line.supplierOffers) ? line.supplierOffers as Array<Record<string, unknown>> : []
  const offers = new Map<string, Record<string, unknown>>()
  for (const offer of rawOffers) {
    const name = String(offer.vendorName || offer.supplier || offer.vendor || "").trim()
    if (!name) continue
    const vendorId = String(offer.vendorId || "").trim()
    const key = (vendorId || name).toLowerCase()
    if (!offers.has(key)) offers.set(key, { ...offer, vendorName: name, vendorId })
  }
  if (selectedName) {
    const selectedKey = (selectedVendorId || selectedName).toLowerCase()
    if (!offers.has(selectedKey)) offers.set(selectedKey, {
      vendorId: selectedVendorId,
      vendorName: selectedName,
      vendorSku: line.vendorSku,
      unitCost: line.unitCost,
      availableQty: line.availableQty,
      availabilityKnown: line.availabilityKnown
    })
  }
  const selectedKey = (selectedVendorId || selectedName).toLowerCase()
  return {
    selectedName,
    alternatives: [...offers.entries()].filter(([key]) => key !== selectedKey).map(([, offer]) => offer)
  }
}

function PurchaseLineSupplier({ line, fallbackSupplier = "" }: { line: Record<string, unknown>; fallbackSupplier?: string }) {
  const { selectedName, alternatives } = purchaseLineSupplierOffers(line, fallbackSupplier)
  if (!alternatives.length) return <span>{selectedName}</span>
  const selectedCost = Number(line.unitCost || line.estimatedUnitCost || 0)
  return <div className="flex min-w-0 items-center gap-1.5"><span className="truncate" title={selectedName}>{selectedName}</span><HoverCard openDelay={150}><HoverCardTrigger asChild><Button type="button" size="sm" variant="outline" className="h-6 shrink-0 rounded-full px-2 text-xs font-semibold">+{alternatives.length}</Button></HoverCardTrigger><HoverCardContent align="start" className="w-80"><div className="space-y-3"><div><p className="font-medium">Other supplier options</p><p className="text-xs text-muted-foreground">Availability and cost captured when this order was routed.</p></div><div className="grid gap-2">{alternatives.map((offer, index) => { const cost = Number(offer.unitCost || offer.cost || 0); const available = Number(offer.availableQty ?? offer.stockQty ?? offer.qty ?? 0); const availabilityKnown = offer.availabilityKnown !== false; return <div key={`${String(offer.vendorId || offer.vendorName)}-${index}`} className="rounded-md border bg-muted/25 p-2.5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{String(offer.vendorName || offer.supplier || "Supplier")}</p><p className="truncate text-xs text-muted-foreground">Vendor SKU {String(offer.vendorSku || "-")}</p></div>{cost > 0 && selectedCost > 0 && cost < selectedCost && <Badge variant="success">Lower cost</Badge>}</div><div className="mt-2 flex justify-between text-xs"><span>{cost > 0 ? moneyLabel(cost) : "Cost unavailable"}</span><span>{availabilityKnown ? `${numberLabel(available)} available` : "Availability unknown"}</span></div></div> })}</div><p className="text-xs text-muted-foreground">Use Re-source open quantities from the PO Actions menu to change suppliers.</p></div></HoverCardContent></HoverCard></div>
}

function waitingPoSupplierKey(po: Record<string, unknown>) {
  const vendorId = String(po.vendorId || "").trim()
  if (vendorId) return `vendor:${vendorId}`
  return `name:${String(po.supplier || "Unassigned").trim().toLowerCase()}`
}

function waitingPoCutoff(po: Record<string, unknown>) {
  const date = String(po.poolDate || po.cutoffDate || "").split("T")[0]
  const time = String(po.cutoffTime || "15:00")
  if (!date) return Number.POSITIVE_INFINITY
  const parsed = new Date(`${date}T${time.length === 5 ? `${time}:00` : time}`).getTime()
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY
}

export const PURCHASE_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

export type VendorDeliveryScheduleRow = {
  id: string
  cutoffDay: number
  cutoffTime: string
  deliveryDay: number
  enabled: boolean
  label?: string
}

export type VendorScheduleException = {
  id: string
  date: string
  label: string
  enabled: boolean
}

export type VendorTemporaryScheduleOverride = {
  enabled: boolean
  cutoffDate: string
  cutoffTime: string
  deliveryDate: string
  label: string
}

export function normalizeVendorDeliverySchedule(value: unknown): VendorDeliveryScheduleRow[] {
  if (!Array.isArray(value)) return []
  return value.map((entry, index) => {
    const row = (entry || {}) as Record<string, unknown>
    return {
      id: String(row.id || `delivery-window-${index + 1}`),
      cutoffDay: Math.max(0, Math.min(6, Number(row.cutoffDay ?? 2))),
      cutoffTime: /^\d{2}:\d{2}$/.test(String(row.cutoffTime || "")) ? String(row.cutoffTime) : "16:00",
      deliveryDay: Math.max(0, Math.min(6, Number(row.deliveryDay ?? 3))),
      enabled: row.enabled !== false,
      label: String(row.label || ""),
    }
  })
}

export function normalizeVendorScheduleExceptions(value: unknown): VendorScheduleException[] {
  if (!Array.isArray(value)) return []
  return value.map((entry, index) => {
    const row = (entry || {}) as Record<string, unknown>
    return {
      id: String(row.id || `schedule-exception-${index + 1}`),
      date: String(row.date || "").slice(0, 10),
      label: String(row.label || "Supplier closed"),
      enabled: row.enabled !== false,
    }
  }).filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date))
}

export function normalizeVendorTemporaryScheduleOverride(value: unknown): VendorTemporaryScheduleOverride {
  const row = (value && typeof value === "object" ? value : {}) as Record<string, unknown>
  return {
    enabled: row.enabled === true,
    cutoffDate: String(row.cutoffDate || "").slice(0, 10),
    cutoffTime: /^\d{2}:\d{2}$/.test(String(row.cutoffTime || "")) ? String(row.cutoffTime) : "15:00",
    deliveryDate: String(row.deliveryDate || "").slice(0, 10),
    label: String(row.label || "Temporary supplier schedule"),
  }
}

export function purchaseScheduleTimeLabel(value: unknown) {
  const [hours, minutes] = String(value || "15:00").split(":").map(Number)
  const date = new Date(2000, 0, 1, Number.isFinite(hours) ? hours : 15, Number.isFinite(minutes) ? minutes : 0)
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

export function purchaseScheduleDateLabel(value: unknown) {
  const raw = String(value || "").split("T")[0]
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw || "Not scheduled"
  return new Date(`${raw}T12:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
}

export function PurchaseScheduleSummary({ record, compact = false }: { record: Record<string, unknown>; compact?: boolean }) {
  const cutoffMs = waitingPoCutoff(record)
  const passed = Boolean(record.readyForReview) || (Number.isFinite(cutoffMs) && cutoffMs <= Date.now())
  const reopened = record.manualDraftHold === true
  const cutoffDate = record.poolDate || record.cutoffDate
  const expectedDelivery = record.expectedDeliveryDate || record.expectedAt
  const detail = reopened
    ? `Returned to draft ${record.manualDraftHoldAt ? dateLabel(String(record.manualDraftHoldAt)) : "by a manager"}. The date shown is the original supplier cutoff.`
    : `Delivery ${purchaseScheduleDateLabel(expectedDelivery)} · ${String(record.scheduleLabel || record.cutoffTimezone || "America/New_York").replace("America/", "")}`
  return <div className={`grid ${compact ? "min-w-44 gap-1" : "gap-1"}`}>
    <div className="flex items-center gap-1.5"><Badge variant={reopened ? "outline" : passed ? "default" : "info"} className="w-fit">{reopened ? "Reopened draft" : passed ? "Ready to send" : "Collecting"}</Badge>{compact ? <Tooltip><TooltipTrigger asChild><button type="button" className="grid size-6 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Schedule details"><Info className="size-3.5" /></button></TooltipTrigger><TooltipContent className="max-w-72">{detail}</TooltipContent></Tooltip> : null}</div>
    <span className="whitespace-nowrap text-sm font-medium">{reopened ? "Original cutoff: " : ""}{purchaseScheduleDateLabel(cutoffDate)} at {purchaseScheduleTimeLabel(record.cutoffTime)}</span>
    {!compact ? <span className="text-xs text-muted-foreground">{detail}</span> : null}
  </div>
}

export function groupWaitingPurchaseOrders(rows: Array<Record<string, unknown>>) {
  const groups = new Map<string, WaitingPoSupplierGroup>()
  rows.filter(purchaseOrderIsWaiting).forEach((po) => {
    const key = waitingPoSupplierKey(po)
    const items = purchaseOrderItems(po)
    const cutoffMs = waitingPoCutoff(po)
    const group = groups.get(key) || {
      key,
      vendorId: String(po.vendorId || ""),
      supplier: String(po.supplier || "Unassigned"),
      purchaseOrders: [],
      orderIds: new Set<string>(),
      skus: new Set<string>(),
      destinations: new Set<string>(),
      units: 0,
      estimatedCost: 0,
      nextCutoffMs: Number.POSITIVE_INFINITY,
      readyForReview: false,
    }
    group.purchaseOrders.push(po)
    items.forEach((line) => {
      if (line.orderId) group.orderIds.add(String(line.orderId))
      if (line.sku) group.skus.add(String(line.sku))
      group.units += Number(line.qty || 0)
    })
    if (po.warehouseName) group.destinations.add(String(po.warehouseName))
    group.estimatedCost += Number(po.openEstimatedCost ?? po.estimatedCost ?? 0)
    if (cutoffMs < group.nextCutoffMs) {
      group.nextCutoffMs = cutoffMs
      group.nextCutoffPo = po
    }
    group.readyForReview = group.readyForReview || Boolean(po.readyForReview) || cutoffMs <= Date.now()
    groups.set(key, group)
  })
  return [...groups.values()].sort((left, right) => left.supplier.localeCompare(right.supplier))
}

type PoReSourceOffer = { vendorId: string; supplier: string; vendorSku?: string; unitCost: number; stockQty?: number }
type PoReSourceLine = { lineKey: string; lineIndex: number; routeId: string; orderId: string; orderNumber: string; sku: string; title: string; orderedQty: number; receivedQty: number; openQty: number; currentUnitCost: number; alternatives: PoReSourceOffer[] }
type PoReSourceSupplier = { vendorId: string; supplier: string; coverageCount: number; totalLineCount: number; currentCost: number; estimatedCost: number; savings: number; completeCoverage: boolean; lines: Array<{ lineKey: string; sku: string; openQty: number; unitCost: number; stockQty?: number; vendorSku?: string }> }
type PoReSourcePreview = { purchaseOrderId: string; poNumber: string; currentVendorId: string; currentSupplier: string; status: string; committed: boolean; requiresSupplierCancellation: boolean; lines: PoReSourceLine[]; suppliers: PoReSourceSupplier[]; bestSupplierVendorId: string }

export const dropshipReasonOptions = [
  { value: "expedited_shipment", label: "Expedited shipment" },
  { value: "replacement_order", label: "Replacement order" },
  { value: "cannot_receive_at_warehouse", label: "Cannot receive at warehouse" },
  { value: "lower_fulfillment_cost", label: "Lower fulfillment cost" },
  { value: "supplier_direct_only", label: "Supplier ships direct only" },
  { value: "customer_requested_direct", label: "Customer requested direct shipment" },
  { value: "warehouse_inventory_unavailable", label: "Inventory unavailable at warehouse" },
  { value: "other_operational", label: "Other operational reason" },
] as const

const dropshipReturnReasonOptions = [
  { value: "wrong_vendor", label: "Wrong vendor" },
  { value: "wrong_pricing", label: "Wrong pricing" },
  { value: "wrong_quantity", label: "Wrong quantity" },
  { value: "wrong_sku", label: "Wrong SKU" },
  { value: "supplier_rejected", label: "Supplier rejected order" },
  { value: "customer_change", label: "Customer order changed" },
  { value: "other", label: "Other purchasing correction" },
] as const

const purchaseOrderCancelReasonOptions = [
  { value: "discontinued", label: "Item discontinued" },
  { value: "below_cost", label: "Order would be below cost" },
  { value: "customer_canceled", label: "Customer canceled" },
  { value: "supplier_unavailable", label: "Supplier cannot fulfill" },
  { value: "duplicate_po", label: "Duplicate purchase order" },
  { value: "wrong_vendor", label: "Wrong vendor" },
  { value: "other", label: "Other purchasing reason" },
] as const

function purchaseOrderLineKey(line: Record<string, unknown>, index: number) {
  return String(line.routeId || `${index}:${String(line.sku || "")}:${String(line.orderId || "")}`)
}

function purchaseOrderLineRemaining(line: Record<string, unknown>) {
  return Math.max(0, Number(line.qty || 0) - Number(line.receivedQty || 0) - Number(line.reSourcedQty || 0) - Number(line.canceledQty || 0) - Number(line.shortClosedQty || 0))
}

function receivingUserNames(value: unknown) {
  const rows = Array.isArray(value) ? value : []
  const names = new Map<string, string>()
  rows.forEach((entry) => {
    const row = entry && typeof entry === "object" ? entry as Record<string, unknown> : {}
    const user = String(row.user || entry || "").trim()
    if (user && !names.has(user.toLowerCase())) names.set(user.toLowerCase(), user)
  })
  return [...names.values()]
}

function purchaseOrderLineReceiverNames(line: Record<string, unknown>, receipts: Array<Record<string, unknown>> = []) {
  const contributors = receivingUserNames(line.receivingContributors)
  if (contributors.length) return contributors
  const saved = (Array.isArray(line.receivedByUsers) ? line.receivedByUsers : [line.lastReceivedBy]).map((value) => String(value || "").trim()).filter(Boolean)
  if (saved.length) return [...new Set(saved)]
  const receiptUsers = receipts.flatMap((receipt) => {
    const matchingItems = (Array.isArray(receipt.items) ? receipt.items as Array<Record<string, unknown>> : []).filter((item) => {
      if (line.id && item.lineId) return String(line.id) === String(item.lineId)
      if (line.routeId && item.routeId) return String(line.routeId) === String(item.routeId)
      return String(line.sku || "").trim().toLowerCase() === String(item.sku || "").trim().toLowerCase()
    })
    if (!matchingItems.length) return []
    const itemUsers = matchingItems.flatMap((item) => receivingUserNames(item.receivingContributors).length ? receivingUserNames(item.receivingContributors) : [String(item.receivedBy || "").trim()].filter(Boolean))
    if (itemUsers.length) return itemUsers
    return (Array.isArray(receipt.receivedByUsers) ? receipt.receivedByUsers : [receipt.receivedBy]).map((value) => String(value || "").trim()).filter(Boolean)
  })
  return [...new Set(receiptUsers)]
}

function purchaseOrderReceiverNames(po: Record<string, unknown>) {
  const saved = (Array.isArray(po.receivedByUsers) ? po.receivedByUsers : []).map((value) => String(value || "").trim()).filter(Boolean)
  if (saved.length) return [...new Set(saved)]
  const receiptNames = (Array.isArray(po.receipts) ? po.receipts as Array<Record<string, unknown>> : []).flatMap((receipt) => {
    const users = (Array.isArray(receipt.receivedByUsers) ? receipt.receivedByUsers : []).map((value) => String(value || "").trim()).filter(Boolean)
    return users.length ? users : [String(receipt.receivedBy || "").trim()].filter(Boolean)
  })
  return [...new Set(receiptNames)]
}

function activeReceivingUserNames(progress: Record<string, unknown>) {
  const cutoff = Date.now() - 2 * 60 * 1000
  return receivingUserNames((Array.isArray(progress.receivers) ? progress.receivers : Array.isArray(progress.activeReceivers) ? progress.activeReceivers : []).filter((entry) => {
    const row = entry && typeof entry === "object" ? entry as Record<string, unknown> : {}
    const lastActiveAt = new Date(String(row.lastActiveAt || 0)).getTime()
    return Number.isFinite(lastActiveAt) && lastActiveAt >= cutoff
  }))
}

type PurchaseOrderLineCancellationDraft = { selected: boolean; reasonCode: string; reasonNote: string }

function compactPurchaseItemTitle(value: unknown, maxLength = 50) {
  const title = String(value || "")
  return title.length > maxLength ? `${title.slice(0, maxLength - 3)}...` : title
}

export function purchaseOrderSalesChannel(po: Record<string, unknown>) {
  const line = purchaseOrderItems(po).find((item) => String(item.salesChannel || item.channelSource || item.source || "").trim())
  return String(po.salesChannel || po.channelSource || po.source || line?.salesChannel || line?.channelSource || line?.source || "-")
}

export function purchaseOrderCtechNumber(po: Record<string, unknown>) {
  const importedNumber = String(po.source || "") === "external_purchase_order_pdf" ? String(po.externalPoNumber || "").trim() : ""
  return String(po.ctechId || importedNumber || "").trim()
}

export function purchaseOrderSupplierReference(po: Record<string, unknown>) {
  const acknowledgement = (po.vendorAcknowledgement || {}) as Record<string, unknown>
  const savedReference = String(po.supplierOrderNumber || acknowledgement.supplierOrderNumber || "").trim()
  const importedCtechNumber = String(po.source || "") === "external_purchase_order_pdf" ? String(po.externalPoNumber || "").trim() : ""
  return importedCtechNumber && savedReference === importedCtechNumber ? "" : savedReference
}

export function PurchaseOrderDetailPage({ mobileId = "", operatorName = "Buyer" }: { mobileId?: string; operatorName?: string } = {}) {
  const fulfillmentCarriers = useFulfillmentCarriers()
  const mobile = Boolean(mobileId)
  const [scan, setScan] = useState("")
  const [scanMessage, setScanMessage] = useState("")
  const scanRef = useRef<HTMLInputElement>(null)
  const openedMobileReceipt = useRef(false)
  const detailSyncBusyRef = useRef(false)
  const id = mobileId || decodeURIComponent((window.location.pathname.split("/")[2] || "").trim())
  const [data, setData] = useState<{ purchaseOrder?: Record<string, unknown>; linkedOrders?: Array<Record<string, unknown>>; dropshipShipFromWarehouse?: Record<string, unknown> | null; shipFromWarehouses?: Array<Record<string, unknown>>; fulfillmentSettings?: Record<string, unknown>; supplierSubmission?: SupplierSubmissionCapability }>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [receivingOpen, setReceivingOpen] = useState(false)
  const [receiptCorrectionOpen, setReceiptCorrectionOpen] = useState(false)
  const [deletePoOpen, setDeletePoOpen] = useState(false)
  const [deletePoReason, setDeletePoReason] = useState("")
  const [editingOpen, setEditingOpen] = useState(false)
  const [financialOpen, setFinancialOpen] = useState(false)
  const [acknowledgementOpen, setAcknowledgementOpen] = useState(false)
  const [returnToDropshipsOpen, setReturnToDropshipsOpen] = useState(false)
  const [cancelPoOpen, setCancelPoOpen] = useState(false)
  const [acknowledgementMode, setAcknowledgementMode] = useState<"acknowledge" | "reference" | "ctech">("acknowledge")
  const [dropshipTrackingOpen, setDropshipTrackingOpen] = useState(false)
  const [dropshipLabelOpen, setDropshipLabelOpen] = useState(false)
  const [dropshipLabelOrderId, setDropshipLabelOrderId] = useState("")
  const [inboundTrackingOpen, setInboundTrackingOpen] = useState(false)
  const [costLine, setCostLine] = useState<{ line: Record<string, unknown>; index: number } | null>(null)
  const [costDraft, setCostDraft] = useState("")
  const [costScope, setCostScope] = useState<"po_order_only" | "catalog_forward">("po_order_only")
  const [catalogLine, setCatalogLine] = useState<{ line: Record<string, unknown>; index: number } | null>(null)
  const [catalogLineMode, setCatalogLineMode] = useState<"link" | "create">("link")
  const [catalogLineQuery, setCatalogLineQuery] = useState("")
  const [catalogLineResults, setCatalogLineResults] = useState<QuickProductResult[]>([])
  const [catalogLineSearching, setCatalogLineSearching] = useState(false)
  const [catalogLineDraft, setCatalogLineDraft] = useState({ sku: "", title: "" })
  const [documentOpen, setDocumentOpen] = useState(false)
  const [reminderOpen, setReminderOpen] = useState(false)
  const [reSourceOpen, setReSourceOpen] = useState(false)
  const [splitDropshipOpen, setSplitDropshipOpen] = useState(false)
  const [dropshipLine, setDropshipLine] = useState<{ line: Record<string, unknown>; index: number } | null>(null)
  const [dropshipReasonCode, setDropshipReasonCode] = useState("other_operational")
  const [dropshipReasonNote, setDropshipReasonNote] = useState("")
  const [returnReasonCode, setReturnReasonCode] = useState("wrong_vendor")
  const [returnReasonNote, setReturnReasonNote] = useState("")
  const [cancelLineDrafts, setCancelLineDrafts] = useState<Record<string, PurchaseOrderLineCancellationDraft>>({})
  const [splitReasonCode, setSplitReasonCode] = useState("supplier_direct_only")
  const [splitReasonNote, setSplitReasonNote] = useState("")
  const poMutationRequestIdsRef = useRef(new Map<string, string>())
  const [reSourceLoading, setReSourceLoading] = useState(false)
  const [reSourcePreview, setReSourcePreview] = useState<PoReSourcePreview | null>(null)
  const [reSourceDraft, setReSourceDraft] = useState({ vendorId: "", lineKeys: [] as string[], reason: "lower_cost", note: "", supplierCancellationConfirmed: false })
  const [reminderPreview, setReminderPreview] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  const [approvalDecision, setApprovalDecision] = useState<PurchaseOrderApprovalDecision | null>(null)
  const [rejectionDecision, setRejectionDecision] = useState<PurchaseOrderRejectionDecision | null>(null)
  const [receiptNote, setReceiptNote] = useState("")
  const [receiptBin, setReceiptBin] = useState("")
  const [receiptMode, setReceiptMode] = useState<"draft" | "final">("final")
  const [receiptQuantities, setReceiptQuantities] = useState<Record<string, number>>({})
  const [allocateReceivedInventory, setAllocateReceivedInventory] = useState(false)
  const [closeShortShipment, setCloseShortShipment] = useState(false)
  const [receiptDemandPreview, setReceiptDemandPreview] = useState<Record<string, unknown> | null>(null)
  const [receiptDemandLoading, setReceiptDemandLoading] = useState(false)
  const [receiptDemandError, setReceiptDemandError] = useState("")
  const receiptDemandRequest = useRef(0)
  const [receiptCorrectionQuantities, setReceiptCorrectionQuantities] = useState<Record<string, number>>({})
  const [receiptCorrectionReason, setReceiptCorrectionReason] = useState("received_by_mistake")
  const [receiptCorrectionNote, setReceiptCorrectionNote] = useState("")
  const [acknowledgeCanceledDemand, setAcknowledgeCanceledDemand] = useState(false)
  const [referenceData, setReferenceData] = useState<{ vendors?: Array<Record<string, unknown>>; warehouses?: Array<Record<string, unknown>> }>({})
  const [editDraft, setEditDraft] = useState<Record<string, unknown>>({})
  const [financialDraft, setFinancialDraft] = useState<Record<string, string>>({ action: "bill", billNumber: "", billDate: "", dueDate: "", total: "", account: "Accounts Payable", billId: "", paymentDate: "", amount: "", method: "EFT", paymentAccount: "", reference: "", creditNumber: "", creditDate: "", reason: "" })
  const [acknowledgement, setAcknowledgement] = useState({ supplierOrderNumber: "", ctechId: "", expectedAt: "", note: "" })
  const [dropshipTracking, setDropshipTracking] = useState({ carrier: "UPS", carrierName: "UPS", service: "", trackingNumber: "", trackingUrl: "", carrierPhone: "", shipDate: new Date().toISOString().slice(0, 10) })
  const [inboundTracking, setInboundTracking] = useState({ carrier: "UPS", service: "", trackingNumber: "", shipDate: new Date().toISOString().slice(0, 10), expectedAt: "" })
  const dropshipCarrierOptions = enabledCarrierNames(fulfillmentCarriers, dropshipTracking.carrier)
  const inboundCarrierOptions = enabledCarrierNames(fulfillmentCarriers, inboundTracking.carrier).filter((carrier) => carrier !== "Other")
  const purchaseOrderTrackingCarriers = [...new Set([...dropshipCarrierOptions, ...inboundCarrierOptions])]
  const dropshipServiceOptions = enabledCarrierServices(fulfillmentCarriers, dropshipTracking.carrier, dropshipTracking.service)
  const inboundServiceOptions = enabledCarrierServices(fulfillmentCarriers, inboundTracking.carrier, inboundTracking.service)
  const [documentDraft, setDocumentDraft] = useState({ name: "", url: "", type: "supplier acknowledgement", note: "" })
  const load = async (initial = false, silent = false) => {
    if (initial) setLoading(true)
    else if (!silent) setRefreshing(true)
    try { setData(await api(`/api/purchase-orders/${encodeURIComponent(id)}`)) }
    catch (error) { if (!silent) toast.error(error instanceof Error ? error.message : "Unable to load purchase order.") }
    finally { setLoading(false); if (!silent) setRefreshing(false) }
  }
  const loadReferenceData = async () => {
    if (referenceData.vendors?.length && referenceData.warehouses?.length) return
    try { setReferenceData(await api<{ vendors?: Array<Record<string, unknown>>; warehouses?: Array<Record<string, unknown>> }>("/api/purchase-orders/reference-data")) }
    catch { toast.error("Unable to load supplier and warehouse choices.") }
  }
  useEffect(() => { void load(true) }, [id])
  useEffect(() => {
    const sync = async () => {
      if (detailSyncBusyRef.current || document.visibilityState !== "visible") return
      detailSyncBusyRef.current = true
      try { await load(false, true) } finally { detailSyncBusyRef.current = false }
    }
    const timer = window.setInterval(() => { void sync() }, 8000)
    const handleVisibility = () => { if (document.visibilityState === "visible") void sync() }
    document.addEventListener("visibilitychange", handleVisibility)
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", handleVisibility) }
  }, [id])
  useEffect(() => {
    if (!catalogLine || catalogLineMode !== "link" || catalogLineQuery.trim().length < 2) { setCatalogLineResults([]); return }
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setCatalogLineSearching(true)
      try {
        const result = await api<{ products?: QuickProductResult[] }>(`/api/quick-search/products?${new URLSearchParams({ q: catalogLineQuery.trim(), limit: "12" })}`, { signal: controller.signal })
        setCatalogLineResults(result.products || [])
      } catch (error) {
        if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : "Unable to search the catalog.")
      } finally { if (!controller.signal.aborted) setCatalogLineSearching(false) }
    }, 100)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [catalogLine, catalogLineMode, catalogLineQuery])
  const po = data.purchaseOrder || {}
  const shipFromWarehouses = data.shipFromWarehouses || (data.dropshipShipFromWarehouse ? [data.dropshipShipFromWarehouse] : [])
  const defaultShipFromWarehouseId = String(data.fulfillmentSettings?.defaultShipFromWarehouseId || "")
  const lines = Array.isArray(po.items) ? po.items as Array<Record<string, unknown>> : Array.isArray(po.lines) ? po.lines as Array<Record<string, unknown>> : []
  const receipts = Array.isArray(po.receipts) ? po.receipts as Array<Record<string, unknown>> : []
  const activeReceivingAudit = (po.activeReceivingAudit || {}) as Record<string, unknown>
  const activeReceivingUsers = activeReceivingUserNames(activeReceivingAudit)
  const receivedByUsers = purchaseOrderReceiverNames(po)
  const activeReceivingNotice = activeReceivingAudit.auditId ? <Alert className="border-emerald-500/40 bg-emerald-500/5"><PackageCheck className="size-4" /><AlertTitle>PO receiving in progress · {String(activeReceivingAudit.auditNumber || "Receiving session")}</AlertTitle><AlertDescription className="grid gap-2"><div className="flex flex-wrap items-center gap-2"><span>{numberLabel(Number(activeReceivingAudit.scannedUnits || 0))} unit{Number(activeReceivingAudit.scannedUnits || 0) === 1 ? "" : "s"} scanned at {String(activeReceivingAudit.warehouseName || po.warehouseName || "the receiving warehouse")}.</span>{activeReceivingUsers.length ? activeReceivingUsers.map((user) => <Badge key={user} variant="success"><Users className="mr-1 size-3" />{user} active</Badge>) : <span className="text-muted-foreground">Started by {String(activeReceivingAudit.startedBy || "a warehouse user")}; no recent scanner activity.</span>}</div><div className="flex flex-wrap items-center justify-between gap-3"><span>Inventory and PO received quantities update only after the receipt is posted.</span><Button size="sm" variant="outline" asChild><a href={`/warehouse/mobile/audits/${encodeURIComponent(String(activeReceivingAudit.auditId))}`}>Open PO receiving</a></Button></div></AlertDescription></Alert> : null
  const receivedByNotice = receivedByUsers.length ? <Alert><Users className="size-4" /><AlertTitle>{receivedByUsers.length === 1 ? `PO received by ${receivedByUsers[0]}` : `PO received by ${receivedByUsers.length} users`}</AlertTitle><AlertDescription>{receivedByUsers.length === 1 ? "This receiver is preserved on the receipt and each received PO line." : receivedByUsers.join(", ")}</AlertDescription></Alert> : null
  const unresolvedCatalogLines = lines.map((line, index) => ({ line, index })).filter(({ line }) => !String(line.sku || "").trim() || line.resolutionStatus === "unresolved")
  const receivingExceptions = Array.isArray(po.receivingExceptions) ? po.receivingExceptions as Array<Record<string, unknown>> : []
  const canceledDemandExceptions = receivingExceptions.filter((entry) => String(entry.type || "") === "canceled_customer_demand" && !["resolved", "returned", "closed"].includes(String(entry.status || "open")))
  const vendorReturns = Array.isArray(po.returns) ? po.returns as Array<Record<string, unknown>> : []
  const nextStep = purchaseOrderNextStep(po)
  const updateStatus = async (action: string) => { if (action === "cancel") { setCancelLineDrafts(Object.fromEntries(lines.map((line, index) => [purchaseOrderLineKey(line, index), { selected: false, reasonCode: "", reasonNote: "" }]))); setCancelPoOpen(true); return }; if (action === "reject") { setRejectionDecision({ id, poNumber: String(po.poNumber || id), supplier: String(po.supplier || "the supplier") }); return }; setSaving(true); try { await api(`/api/purchase-orders/${encodeURIComponent(id)}/action`, { method: "POST", body: JSON.stringify({ action, user: operatorName }) }); if (action === "approve") { setApprovalDecision({ id, poNumber: String(po.poNumber || id), supplier: String(po.supplier || "the supplier"), capability: data.supplierSubmission || {} }); toast.success("Purchase order approved. Choose how it was placed.") } else toast.success(`Purchase order ${action}d.`); await load() } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update purchase order.") } finally { setSaving(false) } }
  const rejectPurchaseOrder = async (disposition: string, note: string, externalPlacement?: { sourceSystem: string; externalPoNumber: string; noTrackingNeeded: boolean }) => { setSaving(true); try { const result = await api<{ message?: string }>(`/api/purchase-orders/${encodeURIComponent(id)}/action`, { method: "POST", body: JSON.stringify({ action: "reject", disposition, note, ...externalPlacement, user: operatorName }) }); toast.success(result.message || (disposition === "external_source" ? "External PO placement recorded." : "Purchase order rejected.")); setRejectionDecision(null); await load() } catch (error) { toast.error(error instanceof Error ? error.message : disposition === "external_source" ? "Unable to record the external PO placement." : "Unable to reject this purchase order.") } finally { setSaving(false) } }
  const submit = async () => { setSaving(true); try { await api(`/api/purchase-orders/${encodeURIComponent(id)}/submit`, { method: "POST", body: JSON.stringify({ method: "preferred", user: operatorName }) }); toast.success("Purchase order queued for supplier submission."); await load() } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to submit purchase order.") } finally { setSaving(false) } }
  const markInbound = async () => { setSaving(true); try { const result = await api<{ message?: string }>(`/api/purchase-orders/${encodeURIComponent(id)}/action`, { method: "POST", body: JSON.stringify({ action: "mark_inbound", user: operatorName }) }); toast.success(result.message || "Purchase order marked inbound."); await load() } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to mark this purchase order inbound.") } finally { setSaving(false) } }
  const returnToDropships = async () => { setSaving(true); try { const result = await api<{ message?: string }>(`/api/purchase-orders/${encodeURIComponent(id)}/action`, { method: "POST", body: JSON.stringify({ action: "return_to_dropships", reasonCode: returnReasonCode, reasonNote: returnReasonNote.trim(), user: operatorName }) }); toast.success(result.message || "Purchase order returned to Dropships."); setReturnToDropshipsOpen(false); await load() } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to return this PO to Dropships.") } finally { setSaving(false) } }
  const cancelPurchaseOrder = async () => { const selected = lines.map((line, lineIndex) => ({ line, lineIndex, key: purchaseOrderLineKey(line, lineIndex), draft: cancelLineDrafts[purchaseOrderLineKey(line, lineIndex)] })).filter((entry) => entry.draft?.selected); if (!selected.length) return toast.error("Select at least one PO line to cancel."); if (selected.some((entry) => !entry.draft.reasonCode)) return toast.error("Choose a cancellation reason for every selected line."); setSaving(true); try { const result = await api<{ message?: string }>(`/api/purchase-orders/${encodeURIComponent(id)}/action`, { method: "POST", body: JSON.stringify({ action: "cancel", lines: selected.map(({ line, lineIndex, draft }) => ({ routeId: line.routeId, lineIndex, reasonCode: draft.reasonCode, reasonNote: draft.reasonNote.trim() })), user: operatorName }) }); toast.success(result.message || "Selected PO lines canceled."); setCancelPoOpen(false); await load() } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to cancel the selected PO lines.") } finally { setSaving(false) } }
  const openAcknowledgement = () => {
    const savedAcknowledgement = (po.vendorAcknowledgement || {}) as Record<string, unknown>
    setAcknowledgementMode("acknowledge")
    setAcknowledgement({ supplierOrderNumber: purchaseOrderSupplierReference(po), ctechId: purchaseOrderCtechNumber(po), expectedAt: String(po.expectedAt || savedAcknowledgement.expectedAt || ""), note: String(savedAcknowledgement.note || "") })
    setAcknowledgementOpen(true)
  }
  const openSupplierReference = () => {
    const savedAcknowledgement = (po.vendorAcknowledgement || {}) as Record<string, unknown>
    setAcknowledgementMode("reference")
    setAcknowledgement({ supplierOrderNumber: purchaseOrderSupplierReference(po), ctechId: purchaseOrderCtechNumber(po), expectedAt: String(po.expectedAt || savedAcknowledgement.expectedAt || ""), note: String(savedAcknowledgement.note || "") })
    setAcknowledgementOpen(true)
  }
  const openCtechReference = () => { setAcknowledgementMode("ctech"); setAcknowledgement((current) => ({ ...current, ctechId: purchaseOrderCtechNumber(po) })); setAcknowledgementOpen(true) }
  const saveAcknowledgement = async () => { setSaving(true); try { const action = acknowledgementMode === "reference" ? "supplier_reference" : acknowledgementMode === "ctech" ? "ctech_reference" : "acknowledge"; const result = await api<{ purchaseOrder?: Record<string, unknown> }>(`/api/purchase-orders/${encodeURIComponent(id)}/action`, { method: "POST", body: JSON.stringify({ action, supplierOrderNumber: acknowledgement.supplierOrderNumber, ctechId: acknowledgement.ctechId, expectedAt: acknowledgement.expectedAt, note: acknowledgement.note, user: operatorName }) }); if (result.purchaseOrder) setData((current) => ({ ...current, purchaseOrder: result.purchaseOrder })); toast.success(acknowledgementMode === "reference" ? "Supplier order number saved." : acknowledgementMode === "ctech" ? "CTech PO number saved." : "Supplier acknowledgement recorded."); setAcknowledgementOpen(false) } catch (error) { toast.error(error instanceof Error ? error.message : acknowledgementMode === "reference" ? "Unable to save supplier order number." : acknowledgementMode === "ctech" ? "Unable to save CTech PO number." : "Unable to record supplier acknowledgement.") } finally { setSaving(false) } }
  const openLineCost = (line: Record<string, unknown>, index: number) => { setCostLine({ line, index }); setCostDraft(String(Number(line.unitCost ?? line.estimatedUnitCost ?? 0).toFixed(2))); setCostScope("po_order_only") }
  const saveLineCost = async () => { if (!costLine) return; setSaving(true); try { const result = await api<{ message?: string }>(`/api/purchase-orders/${encodeURIComponent(id)}/lines/cost`, { method: "POST", body: JSON.stringify({ routeId: costLine.line.routeId, lineIndex: costLine.index, unitCost: Number(costDraft), scope: costScope, user: operatorName }) }); toast.success(result.message || "PO line cost saved."); setCostLine(null); await load() } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save the PO line cost.") } finally { setSaving(false) } }
  const openCatalogLine = (line: Record<string, unknown>, index: number) => {
    const suggestedSku = String(line.suggestedSku || line.sku || "")
    setCatalogLine({ line, index })
    setCatalogLineMode("link")
    setCatalogLineQuery(String(line.sourceItemNumber || line.vendorSku || line.mfrPartNumber || ""))
    setCatalogLineResults([])
    setCatalogLineDraft({ sku: suggestedSku, title: String(line.sourceDescription || line.title || "") })
  }
  const saveCatalogLine = async (action: "link" | "create", selected?: QuickProductResult) => {
    if (!catalogLine) return
    const sku = String(selected?.sku || catalogLineDraft.sku || "").trim()
    if (!sku) return toast.error(action === "link" ? "Choose a catalog SKU." : "Enter the SKU to create.")
    if (action === "create" && !catalogLineDraft.title.trim()) return toast.error("Enter a product title.")
    setSaving(true)
    try {
      const result = await api<{ message?: string }>(`/api/purchase-orders/${encodeURIComponent(id)}/lines/catalog`, { method: "POST", body: JSON.stringify({ action, lineIndex: catalogLine.index, sku, title: catalogLineDraft.title.trim(), user: operatorName }) })
      toast.success(result.message || "PO line linked to the catalog.")
      setCatalogLine(null)
      await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to resolve this PO line.") }
    finally { setSaving(false) }
  }
  const openDropshipTracking = () => {
    const saved = (po.dropshipShipment || {}) as Record<string, unknown>
    const sourceOrder = (data.linkedOrders || [])[0] || {}
    const orderDate = new Date(String(sourceOrder.orderDate || sourceOrder.orderedAt || sourceOrder.createdAt || ""))
    const defaultShipDate = Number.isFinite(orderDate.getTime()) ? orderDate.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)
    const savedCarrierName = String(saved.carrierName || saved.carrier || po.shippingCarrier || "UPS")
    const knownCarrier = fulfillmentCarriers.some((entry) => entry.name.toLowerCase() === savedCarrierName.toLowerCase()) || shipmentTrackingCarriers.some((name) => name.toLowerCase() === savedCarrierName.toLowerCase())
    const carrier = knownCarrier ? savedCarrierName : "Other"
    setDropshipTracking({ carrier, carrierName: carrier === "Other" ? savedCarrierName : carrier, service: String(saved.service || (carrier === "Other" ? "" : enabledCarrierServices(fulfillmentCarriers, carrier)[0]) || ""), trackingNumber: String(saved.trackingNumber || po.trackingNumber || ""), trackingUrl: String(saved.trackingUrl || po.trackingUrl || ""), carrierPhone: String(saved.carrierPhone || po.carrierPhone || ""), shipDate: String(saved.shipDate || defaultShipDate) })
    setDropshipTrackingOpen(true)
  }
  const saveDropshipTracking = async () => { setSaving(true); try { const result = await api<{ message?: string }>(`/api/purchase-orders/${encodeURIComponent(id)}/dropship-tracking`, { method: "POST", body: JSON.stringify({ ...dropshipTracking, carrierName: dropshipTracking.carrier === "Other" ? dropshipTracking.carrierName : dropshipTracking.carrier, user: operatorName }) }); toast.success(result.message || "Dropship tracking saved on the PO and linked order, then sent to the enabled sales channel."); setDropshipTrackingOpen(false); await load() } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save dropship tracking.") } finally { setSaving(false) } }
  const openInboundTracking = () => { const saved = (po.inboundShipment || {}) as Record<string, unknown>; const carrier = String(saved.carrierName || saved.carrier || po.shippingCarrier || "UPS"); setInboundTracking({ carrier, service: String(saved.service || enabledCarrierServices(fulfillmentCarriers, carrier)[0] || ""), trackingNumber: String(saved.trackingNumber || po.trackingNumber || ""), shipDate: String(saved.shippedAt || new Date().toISOString()).slice(0, 10), expectedAt: String(saved.expectedAt || po.expectedAt || "") }); setInboundTrackingOpen(true) }
  const saveInboundTracking = async () => { setSaving(true); try { const result = await api<{ message?: string }>(`/api/purchase-orders/${encodeURIComponent(id)}/inbound-tracking`, { method: "POST", body: JSON.stringify({ ...inboundTracking, carrierName: inboundTracking.carrier, user: operatorName }) }); toast.success(result.message || "Inbound tracking saved."); setInboundTrackingOpen(false); await load() } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save inbound tracking.") } finally { setSaving(false) } }
  const openDocument = () => { setDocumentDraft({ name: "", url: "", type: "supplier acknowledgement", note: "" }); setDocumentOpen(true) }
  const saveDocument = async () => { setSaving(true); try { await api(`/api/purchase-orders/${encodeURIComponent(id)}/documents`, { method: "POST", body: JSON.stringify({ ...documentDraft, user: operatorName }) }); toast.success("PO document linked."); setDocumentOpen(false); await load() } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to link PO document.") } finally { setSaving(false) } }
  const openReminder = async () => { setSaving(true); try { const result = await api<{ preview?: Record<string, unknown> }>(`/api/purchase-orders/${encodeURIComponent(id)}/reminder/preview`, { method: "POST" }); setReminderPreview(result.preview || {}); setReminderOpen(true) } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to prepare supplier reminder.") } finally { setSaving(false) } }
  const sendReminder = async () => { setSaving(true); try { await api(`/api/purchase-orders/${encodeURIComponent(id)}/reminder/send`, { method: "POST", body: JSON.stringify({ user: operatorName }) }); toast.success("Supplier reminder sent."); setReminderOpen(false); await load() } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to send supplier reminder.") } finally { setSaving(false) } }
  const openReceiving = () => { setScan(""); setScanMessage(""); setReceiptQuantities(Object.fromEntries(lines.map((line, index) => [purchaseOrderLineKey(line, index), mobile || !String(line.sku || "").trim() || line.resolutionStatus === "unresolved" ? 0 : purchaseOrderLineRemaining(line)]))); setReceiptNote(""); setReceiptBin(""); setReceiptMode("final"); setAllocateReceivedInventory(false); setCloseShortShipment(false); setReceiptDemandPreview(null); setReceiptDemandError(""); setAcknowledgeCanceledDemand(false); setReceivingOpen(true) }
  useEffect(() => {
    if (!receivingOpen || receiptMode !== "final" || !po.id) return
    const requestId = ++receiptDemandRequest.current
    const timer = window.setTimeout(() => {
      const items = lines.map((line, lineIndex) => ({ sku: line.sku, routeId: line.routeId, lineIndex, qtyReceived: Math.max(0, Number(receiptQuantities[purchaseOrderLineKey(line, lineIndex)] || 0)) })).filter((line) => line.qtyReceived > 0)
      setReceiptDemandLoading(true)
      setReceiptDemandError("")
      void api<{ preview?: Record<string, unknown> }>(`/api/purchase-orders/${encodeURIComponent(id)}/receipt-preview`, { method: "POST", body: JSON.stringify({ items }) })
        .then((result) => { if (requestId === receiptDemandRequest.current) setReceiptDemandPreview(result.preview || {}) })
        .catch((error) => { if (requestId === receiptDemandRequest.current) setReceiptDemandError(error instanceof Error ? error.message : "Unable to check matching orders.") })
        .finally(() => { if (requestId === receiptDemandRequest.current) setReceiptDemandLoading(false) })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [id, lines, po.id, receiptMode, receiptQuantities, receivingOpen])
  const receive = async () => { if (saving || (!closeShortShipment && !lines.some((line, index) => Number(receiptQuantities[purchaseOrderLineKey(line, index)] || 0) > 0))) return; setSaving(true); try { const result = await api<{ unresolvedHeldUnits?: number; shortShipment?: { totalUnits?: number } | null; allocation?: { allocatedQty?: number; orderCount?: number } | null }>(`/api/purchase-orders/${encodeURIComponent(id)}/receive`, { method: "POST", body: JSON.stringify({ user: operatorName, mode: receiptMode, note: receiptNote, defaultLocationBin: receiptBin, acknowledgeCanceledDemand, allocateOpenOrders: receiptMode === "final" && allocateReceivedInventory, closeRemaining: receiptMode === "final" && closeShortShipment, items: lines.map((line, lineIndex) => ({ sku: line.sku, routeId: line.routeId, lineIndex, qtyReceived: Math.max(0, Number(receiptQuantities[purchaseOrderLineKey(line, lineIndex)] || 0)) })).filter((line) => line.qtyReceived > 0) }) }); const allocatedQty = Number(result.allocation?.allocatedQty || 0); const shortUnits = Number(result.shortShipment?.totalUnits || 0); toast.success(receiptMode === "draft" ? "Receiving draft saved." : shortUnits > 0 ? `Receipt saved and PO closed. ${numberLabel(shortUnits)} unreceived unit${shortUnits === 1 ? " was" : "s were"} recorded as a supplier short shipment.` : Number(result.unresolvedHeldUnits || 0) > 0 ? `Receipt saved. ${numberLabel(Number(result.unresolvedHeldUnits || 0))} unit${Number(result.unresolvedHeldUnits || 0) === 1 ? " is" : "s are"} on SKU-resolution hold.` : canceledDemandExceptions.length ? "Receipt saved. Canceled-order units were placed in vendor-return hold." : allocateReceivedInventory ? allocatedQty > 0 ? `Receipt saved. ${numberLabel(allocatedQty)} unit${allocatedQty === 1 ? " was" : "s were"} allocated to ${numberLabel(Number(result.allocation?.orderCount || 0))} open order${Number(result.allocation?.orderCount || 0) === 1 ? "" : "s"}.` : "Receipt saved. No eligible open order demand remained; stock is available in the warehouse." : "Receipt saved and linked order routes released."); setReceivingOpen(false); await load() } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to receive purchase order.") } finally { setSaving(false) } }
  const startScannedReceiving = async () => {
    if (saving) return
    setSaving(true)
    try {
      const result = await api<{ audit?: Record<string, unknown>; message?: string }>("/api/warehouse-audits", { method: "POST", body: JSON.stringify({ warehouseId: po.warehouseId, warehouseName: po.warehouseName, reason: "purchase_order_receipt", purchaseOrderId: po.id, user: operatorName }) })
      if (!result.audit?.id) throw new Error("The inbound receiving workspace could not be created.")
      toast.success(result.message || "Full shipment receiving started.")
      setReceivingOpen(false)
      window.location.assign(`${mobile ? "/warehouse/mobile/audits" : "/warehouse/audits"}/${encodeURIComponent(String(result.audit.id))}`)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to start full shipment receiving.") }
    finally { setSaving(false) }
  }
  const openReceiptCorrection = () => { setReceiptCorrectionQuantities(Object.fromEntries(lines.map((line, index) => [purchaseOrderLineKey(line, index), Math.max(0, Number(line.receivedQty || 0))]))); setReceiptCorrectionReason("received_by_mistake"); setReceiptCorrectionNote(""); setReceiptCorrectionOpen(true) }
  const receiptCorrectionChanges = lines.map((line, lineIndex) => { const current = Math.max(0, Number(line.receivedQty || 0)); const target = Math.min(current, Math.max(0, Number(receiptCorrectionQuantities[purchaseOrderLineKey(line, lineIndex)] ?? current))); return { line, lineIndex, current, target, reduceBy: current - target } }).filter((entry) => entry.reduceBy > 0)
  const saveReceiptCorrection = async () => { if (!receiptCorrectionChanges.length || saving) return; setSaving(true); try { const result = await api<{ message?: string }>(`/api/purchase-orders/${encodeURIComponent(id)}/receipt-correction`, { method: "POST", body: JSON.stringify({ user: operatorName, reason: receiptCorrectionReason, note: receiptCorrectionNote.trim(), items: receiptCorrectionChanges.map(({ line, lineIndex, target }) => ({ sku: line.sku, routeId: line.routeId, lineIndex, targetReceivedQty: target })) }) }); toast.success(result.message || "PO receipt corrected."); setReceiptCorrectionOpen(false); await load() } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to correct the PO receipt.") } finally { setSaving(false) } }
  const deleteTestPo = async () => {
    if (!deletePoReason.trim() || saving) return
    setSaving(true)
    try {
      const receivedLines = lines.map((line, lineIndex) => ({ line, lineIndex, received: Math.max(0, Number(line.receivedQty || 0)) })).filter((entry) => entry.received > 0)
      if (receivedLines.length) {
        await api(`/api/purchase-orders/${encodeURIComponent(id)}/receipt-correction`, { method: "POST", body: JSON.stringify({ user: operatorName, reason: "testing", note: `PO deletion: ${deletePoReason.trim()}`, items: receivedLines.map(({ line, lineIndex }) => ({ sku: line.sku, routeId: line.routeId, lineIndex, targetReceivedQty: 0 })) }) })
      }
      const result = await api<{ message?: string }>(`/api/purchase-orders/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({ user: operatorName, reason: deletePoReason.trim() }) })
      toast.success(result.message || "PO deleted.")
      window.location.href = "/purchasing?tab=archive"
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to delete this PO.") }
    finally { setSaving(false) }
  }
  const openEditor = () => { void loadReferenceData(); setEditDraft({ vendorId: String(po.vendorId || ""), ...(isDropship ? {} : { warehouseId: String(po.warehouseId || "") }), notes: String(po.notes || ""), expectedAt: String(po.expectedAt || ""), amendmentReason: "", items: lines.map((line) => ({ id: String(line.id || ""), sku: String(line.sku || ""), title: String(line.title || ""), qty: Number(line.qty || 0), estimatedUnitCost: Number(line.estimatedUnitCost ?? line.unitCost ?? line.cost ?? 0), receivedQty: Number(line.receivedQty || 0), source: String(line.source || "manual_line"), catalogProduct: line.catalogProduct === true })) }); setEditingOpen(true) }
  const saveEdit = async () => {
    setSaving(true)
    try {
      const { warehouseId, ...dropshipDraft } = editDraft
      const replaceDraftItems = String(po.source || "") === "manual_purchasing" && !purchaseOrderHasSubmission(po) && ["draft", "hold"].includes(String(po.status || "draft").toLowerCase())
      const payload = { ...(isDropship ? dropshipDraft : { ...editDraft, warehouseId }), replaceDraftItems, user: operatorName }
      const result = await api<{ purchaseOrder?: Record<string, unknown> }>(`/api/purchase-orders/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) })
      if (result.purchaseOrder) setData((current) => ({ ...current, purchaseOrder: result.purchaseOrder }))
      else await load()
      toast.success("Purchase order updated.")
      setEditingOpen(false)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update purchase order.") }
    finally { setSaving(false) }
  }
  const openFinancials = (action = "bill") => { setFinancialDraft({ action, billNumber: "", billDate: new Date().toISOString().slice(0, 10), dueDate: "", total: "", account: "Accounts Payable", billId: "", paymentDate: new Date().toISOString().slice(0, 10), amount: "", method: "EFT", paymentAccount: "", reference: "", creditNumber: "", creditDate: new Date().toISOString().slice(0, 10), reason: "" }); setFinancialOpen(true) }
  const saveFinancial = async () => { setSaving(true); try { await api(`/api/purchase-orders/${encodeURIComponent(id)}/financials`, { method: "POST", body: JSON.stringify({ ...financialDraft, user: operatorName }) }); toast.success(financialDraft.action === "bill" ? "Vendor bill recorded." : financialDraft.action === "payment" ? "Vendor payment recorded." : "Vendor credit recorded."); setFinancialOpen(false); await load() } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save PO financial record.") } finally { setSaving(false) } }
  const selectReSourceVendor = (vendorId: string, preview = reSourcePreview) => {
    const supplier = preview?.suppliers.find((row) => row.vendorId === vendorId)
    setReSourceDraft((current) => ({ ...current, vendorId, lineKeys: supplier?.lines.map((line) => line.lineKey) || [] }))
  }
  const openReSource = async () => {
    setReSourceLoading(true)
    try {
      const result = await api<{ preview?: PoReSourcePreview }>(`/api/purchase-orders/${encodeURIComponent(id)}/re-source-options`)
      const preview = result.preview || null
      if (!preview?.lines.length) { toast.error("This PO has no open, unreceived quantity to move."); return }
      if (!preview.suppliers.length) { toast.error("No other active supplier has an eligible cost offer for these open lines."); return }
      const vendorId = preview.bestSupplierVendorId || preview.suppliers[0].vendorId
      setReSourcePreview(preview)
      setReSourceDraft({ vendorId, lineKeys: preview.suppliers.find((row) => row.vendorId === vendorId)?.lines.map((line) => line.lineKey) || [], reason: "lower_cost", note: "", supplierCancellationConfirmed: false })
      poMutationRequestIdsRef.current.set("re-source", crypto.randomUUID())
      setReSourceOpen(true)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to compare supplier offers.") } finally { setReSourceLoading(false) }
  }
  const applyReSource = async () => {
    if (!reSourceDraft.vendorId || !reSourceDraft.lineKeys.length) return
    setSaving(true)
    try {
      const result = await api<{ replacementPurchaseOrder?: Record<string, unknown>; message?: string }>(`/api/purchase-orders/${encodeURIComponent(id)}/re-source`, { method: "POST", body: JSON.stringify({ ...reSourceDraft, requestId: poMutationRequestIdsRef.current.get("re-source") || crypto.randomUUID(), user: operatorName }) })
      toast.success(result.message || "Replacement purchase order created.")
      poMutationRequestIdsRef.current.delete("re-source")
      setReSourceOpen(false)
      const replacementId = String(result.replacementPurchaseOrder?.id || "")
      if (replacementId) { window.history.pushState({}, "", `/purchase-orders/${encodeURIComponent(replacementId)}`); window.dispatchEvent(new PopStateEvent("popstate")) } else await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to replace the supplier PO.") } finally { setSaving(false) }
  }
  const moveLineToDropship = async () => {
    if (!dropshipLine) return
    setSaving(true)
    const requestKey = `line-dropship:${String(dropshipLine.line.routeId || dropshipLine.index)}`
    try {
      const result = await api<{ dropshipPurchaseOrder?: Record<string, unknown>; message?: string }>(`/api/purchase-orders/${encodeURIComponent(id)}/lines/dropship`, { method: "POST", body: JSON.stringify({ requestId: poMutationRequestIdsRef.current.get(requestKey) || crypto.randomUUID(), routeId: dropshipLine.line.routeId, lineIndex: dropshipLine.index, reasonCode: dropshipReasonCode, reasonNote: dropshipReasonNote.trim(), user: operatorName }) })
      toast.success(result.message || "Dropship PO created.")
      poMutationRequestIdsRef.current.delete(requestKey)
      setDropshipLine(null)
      setDropshipReasonCode("other_operational")
      setDropshipReasonNote("")
      await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to move this line to dropship.") } finally { setSaving(false) }
  }
  const splitAllLinesToDropship = async () => {
    if (!lines.length || saving) return
    setSaving(true)
    try {
      const result = await api<{ message?: string }>(`/api/purchase-orders/${encodeURIComponent(id)}/dropship/split`, { method: "POST", body: JSON.stringify({ requestId: poMutationRequestIdsRef.current.get("split-dropship") || crypto.randomUUID(), reasonCode: splitReasonCode, reasonNote: splitReasonNote.trim(), user: operatorName }) })
      toast.success(result.message || "Purchase order lines were split into dropship POs.")
      poMutationRequestIdsRef.current.delete("split-dropship")
      setSplitDropshipOpen(false)
      setSplitReasonCode("supplier_direct_only")
      setSplitReasonNote("")
      await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to split this purchase order.") } finally { setSaving(false) }
  }
  useEffect(() => {
    if (!mobile || loading || !po.id || openedMobileReceipt.current) return
    openedMobileReceipt.current = true
    if (!["received", "closed", "canceled", "cancelled", "rejected", "superseded", "deleted"].includes(String(po.status).toLowerCase())) openReceiving()
  }, [mobile, loading, po.id])
  useEffect(() => {
    if (!mobile || !receivingOpen || !Object.values(receiptQuantities).some(value => value > 0)) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "" }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [mobile, receivingOpen, receiptQuantities])
  const closeReceiving = () => {
    if (saving) return
    if (mobile && Object.values(receiptQuantities).some(value => value > 0) && !window.confirm("Discard this unsaved receiving count?")) return
    setReceivingOpen(false)
  }
  const scanItem = () => {
    if (saving) return
    const value = scan.trim().toLowerCase()
    if (!value) return
    const matched = lines.map((line, index) => ({ line, index })).filter(({ line }) => [line.sku, line.upc, line.barcode, line.gtin, line.vendorSku, line.sourceSku, ...(Array.isArray(line.scanIdentifiers) ? line.scanIdentifiers : [])].some(identifier => identifier && String(identifier).toLowerCase() === value))
    if (matched.length !== 1) setScanMessage(matched.length ? "Multiple PO lines match. Enter the quantity on the correct line below." : "Item not found on this PO. Check the identifier or enter its quantity below.")
    else {
      const { line, index } = matched[0]
      const key = purchaseOrderLineKey(line, index)
      if (Number(receiptQuantities[key] || 0) >= purchaseOrderLineRemaining(line)) setScanMessage("Remaining quantity reached. Review this line before adding more.")
      else { setReceiptQuantities(current => ({ ...current, [key]: Math.min(purchaseOrderLineRemaining(line), Number(current[key] || 0) + 1) })); setScanMessage(`Added one ${String(line.sku)}.`) }
    }
    setScan(""); scanRef.current?.focus()
  }
  const receiptUnitTotal = Object.values(receiptQuantities).reduce((total, quantity) => total + Math.max(0, Number(quantity || 0)), 0)
  const remainingUnitTotal = lines.reduce((total, line) => total + purchaseOrderLineRemaining(line), 0)
  const remainingAfterThisReceipt = lines.reduce((total, line, index) => total + Math.max(0, purchaseOrderLineRemaining(line) - Math.max(0, Number(receiptQuantities[purchaseOrderLineKey(line, index)] || 0))), 0)
  const receiptFulfillmentOrders = Array.isArray(receiptDemandPreview?.fulfillmentOrders) ? receiptDemandPreview.fulfillmentOrders as Array<Record<string, unknown>> : []
  const receivingDialog = (
    <Dialog open={receivingOpen} onOpenChange={(open) => { if (!open) closeReceiving() }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-6xl gap-0 overflow-hidden p-0 warehouse-receipt-dialog">
        <DialogHeader className="border-b px-5 py-4 pr-14">
          <div className="flex flex-wrap items-center gap-2"><DialogTitle>Receive {String(po.poNumber || "purchase order")}</DialogTitle><Badge variant="outline">{numberLabel(remainingUnitTotal)} remaining</Badge></div>
          <DialogDescription>Enter the quantity physically received for each item. Save a draft while counting, or finalize to add stock and release eligible customer demand.</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-4 overflow-y-auto px-5 py-4">
          <div className="grid gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm sm:grid-cols-3">
            <div><span className="block text-xs font-medium text-muted-foreground">Supplier</span><span className="font-medium">{String(po.supplier || "Unassigned")}</span></div>
            <div><span className="block text-xs font-medium text-muted-foreground">Receiving location</span><span className="font-medium">{String(po.warehouseName || "Unassigned")}</span></div>
            <div><span className="block text-xs font-medium text-muted-foreground">This receipt</span><span className="font-medium">{numberLabel(receiptUnitTotal)} unit{receiptUnitTotal === 1 ? "" : "s"}</span></div>
          </div>
          {mobile && <div className="grid gap-2"><Label htmlFor="po-item-scan">Scan item SKU, UPC, or vendor SKU</Label><div className="flex gap-2"><Input id="po-item-scan" ref={scanRef} autoFocus autoComplete="off" value={scan} onChange={event => setScan(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); scanItem() } }} /><Button variant="outline" onClick={scanItem}>Add unit</Button></div><p role="status" className="text-sm text-muted-foreground">{scanMessage || "Each matched scan adds one unit. Review quantities before saving."}</p></div>}

          {canceledDemandExceptions.length ? <Alert variant="destructive"><AlertTriangle className="size-4" /><AlertTitle>Do not release these units to fulfillment</AlertTitle><AlertDescription className="grid gap-3"><p>{canceledDemandExceptions.length} line{canceledDemandExceptions.length === 1 ? " belongs" : "s belong"} to canceled or refunded customer demand. Received units will be held for a vendor return.</p><div className="grid gap-1 text-xs">{canceledDemandExceptions.map((entry, index) => <p key={String(entry.id || index)}><span className="font-medium">{String(entry.orderNumber || entry.orderId || "Customer order")}</span> · {String(entry.sku || "SKU unavailable")} · {numberLabel(Number(entry.qty || entry.quantity || 0))} units</p>)}</div></AlertDescription></Alert> : null}
          {receiptMode === "final" && <section className="grid gap-3 rounded-md border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-medium">Orders this receipt can move forward</p><p className="text-xs text-muted-foreground">Includes matching paid orders awaiting allocation and already allocated orders with an unshipped label.</p></div>{receiptFulfillmentOrders.length > 0 && <Badge variant="outline">{numberLabel(receiptFulfillmentOrders.length)} order{receiptFulfillmentOrders.length === 1 ? "" : "s"}</Badge>}</div>{receiptDemandLoading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Checking pending shipments...</div> : receiptDemandError ? <p className="text-sm text-destructive">{receiptDemandError}</p> : receiptFulfillmentOrders.length ? <ScrollArea className="max-h-44"><div className="grid gap-2 pr-3">{receiptFulfillmentOrders.slice(0, 12).map((order) => { const state = String(order.state || "needs_allocation"); return <a key={String(order.orderId || order.id)} href={`/orders/${encodeURIComponent(String(order.orderId || order.id || ""))}`} className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-sm hover:bg-muted/40"><span className="min-w-0"><span className="block font-medium">#{String(order.orderNumber || order.orderId || "Order")}</span><span className="block truncate text-xs text-muted-foreground">{String(order.customer || "Customer")} · {(Array.isArray(order.skus) ? order.skus : [order.sku]).filter(Boolean).join(", ")}</span></span><span className="flex shrink-0 flex-col items-end gap-1"><Badge variant="outline" className={state === "label_purchased" ? "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300" : state === "ready_to_ship" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"}>{String(order.stateLabel || "Needs allocation")}</Badge>{order.linkedToPurchaseOrder ? <span className="text-[11px] text-muted-foreground">Linked to this PO</span> : <span className="text-[11px] text-muted-foreground">Additional match</span>}</span></a> })}</div></ScrollArea> : <p className="text-sm text-muted-foreground">No matching unshipped customer orders were found for the selected receipt quantities.</p>}</section>}
          <div className="hidden max-h-[42vh] overflow-auto rounded-md border md:block"><Table className="table-fixed"><TableHeader className="sticky top-0 z-10 bg-popover"><TableRow><TableHead className="w-40">SKU</TableHead><TableHead>Item</TableHead><TableHead className="w-24 text-right">Ordered</TableHead><TableHead className="w-24 text-right">Received</TableHead><TableHead className="w-24 text-right">Remaining</TableHead><TableHead className="w-32 text-right">Receive now</TableHead></TableRow></TableHeader><TableBody>{lines.map((line, index) => { const sku = String(line.sku || ""); const unresolved = !sku || line.resolutionStatus === "unresolved"; const remaining = purchaseOrderLineRemaining(line); const lineKey = purchaseOrderLineKey(line, index); const ordered = Number(line.qty || line.quantity || 0); const received = Number(line.receivedQty || 0); return <TableRow key={`receive-${lineKey}`}><TableCell className="break-all align-top font-mono text-xs font-medium">{sku || String(line.sourceItemNumber || "Needs SKU")}</TableCell><TableCell className="align-top"><p className="line-clamp-2 break-words font-medium" title={String(line.title || "")}>{String(line.title || "Untitled item")}</p>{unresolved ? <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">Can be received now; stock stays on SKU-resolution hold</p> : line.orderNumber ? <p className="mt-1 text-xs text-muted-foreground">Order {String(line.orderNumber)}</p> : null}</TableCell><TableCell className="text-right tabular-nums">{numberLabel(ordered)}</TableCell><TableCell className="text-right tabular-nums">{numberLabel(received)}</TableCell><TableCell className="text-right tabular-nums">{numberLabel(remaining)}</TableCell><TableCell><Input className="ml-auto h-9 w-24 text-right tabular-nums" aria-label={`Receive quantity for ${sku || "unresolved line"}`} type="number" min={0} max={remaining} value={String(receiptQuantities[lineKey] ?? 0)} onChange={(event) => setReceiptQuantities((current) => ({ ...current, [lineKey]: Math.min(remaining, Math.max(0, Number(event.target.value || 0))) }))} /></TableCell></TableRow> })}</TableBody></Table></div>
          <div className="grid gap-2 md:hidden">{lines.map((line, index) => { const sku = String(line.sku || ""); const unresolved = !sku || line.resolutionStatus === "unresolved"; const remaining = purchaseOrderLineRemaining(line); const lineKey = purchaseOrderLineKey(line, index); return <div key={`receive-mobile-${lineKey}`} className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3 rounded-md border p-3"><div className="min-w-0"><p className="break-all font-mono text-xs font-medium">{sku || String(line.sourceItemNumber || "Needs SKU")}</p><p className="mt-1 line-clamp-2 text-sm font-medium">{String(line.title || "Untitled item")}</p><p className={unresolved ? "mt-1 text-xs font-medium text-amber-700 dark:text-amber-300" : "mt-1 text-xs text-muted-foreground"}>{unresolved ? "Receive now; held until SKU is resolved" : `${numberLabel(remaining)} remaining`}</p></div><Field label="Receive"><Input className="text-right tabular-nums" aria-label={`Receive quantity for ${sku || "unresolved line"}`} type="number" min={0} max={remaining} value={String(receiptQuantities[lineKey] ?? 0)} onChange={(event) => setReceiptQuantities((current) => ({ ...current, [lineKey]: Math.min(remaining, Math.max(0, Number(event.target.value || 0))) }))} /></Field></div> })}</div>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]"><Field label="Receipt mode"><Select value={receiptMode} onValueChange={(value) => setReceiptMode(value as "draft" | "final")}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="final">Finalize receipt and release fulfillment</SelectItem><SelectItem value="draft">Save count as draft</SelectItem></SelectContent></Select></Field><Field label="Default bin"><Input value={receiptBin} onChange={(event) => setReceiptBin(event.target.value)} placeholder="Optional receiving bin" /></Field></div>
          <div className="grid gap-2"><Label htmlFor="receipt-note">Receiving note</Label><Textarea id="receipt-note" className="min-h-20" value={receiptNote} onChange={(event) => setReceiptNote(event.target.value)} placeholder="Packing slip, variance, damage, or receiving notes" /></div>
          {receiptMode === "final" && !canceledDemandExceptions.length ? <label className={`flex items-start gap-3 rounded-md border p-3 transition-colors ${allocateReceivedInventory ? "border-emerald-500/50 bg-emerald-500/10" : "bg-muted/20"}`}><Checkbox checked={allocateReceivedInventory} onCheckedChange={(checked) => setAllocateReceivedInventory(checked === true)} /><span className="text-sm"><strong>Allocate remaining received stock to additional open orders.</strong><span className="mt-1 block text-muted-foreground">Customer demand already tied to this PO is released through the normal receiving workflow. This option also reserves remaining received units against other compatible paid orders by ship deadline. Anything left stays available in {String(po.warehouseName || "the receiving warehouse")}.</span></span></label> : null}
          {receiptMode === "final" && remainingAfterThisReceipt > 0 ? <label className={`flex items-start gap-3 rounded-md border p-3 transition-colors ${closeShortShipment ? "border-amber-500/50 bg-amber-500/10" : "bg-muted/20"}`}><Checkbox checked={closeShortShipment} onCheckedChange={(checked) => setCloseShortShipment(checked === true)} /><span className="text-sm"><strong>Finalize and close the PO with {numberLabel(remainingAfterThisReceipt)} unit{remainingAfterThisReceipt === 1 ? "" : "s"} not supplied.</strong><span className="mt-1 block text-muted-foreground">Use this when the supplier will not ship the balance. DataPlus preserves ordered and received quantities, records a short shipment, and returns any unfilled linked demand to buyer review.</span></span></label> : null}
          {canceledDemandExceptions.length && receiptMode === "final" ? <label className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3"><Checkbox checked={acknowledgeCanceledDemand} onCheckedChange={(checked) => setAcknowledgeCanceledDemand(checked === true)} /><span className="text-sm"><strong>Receive into vendor-return hold.</strong><span className="mt-1 block text-muted-foreground">I understand these units are no longer required by the customer and must be segregated for supplier return or buyer disposition.</span></span></label> : null}
        </div>
        <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none px-5 py-4"><div className="mr-auto self-center text-sm text-muted-foreground">{receiptUnitTotal ? `${numberLabel(receiptUnitTotal)} unit${receiptUnitTotal === 1 ? "" : "s"} selected` : closeShortShipment ? `${numberLabel(remainingAfterThisReceipt)} unreceived unit${remainingAfterThisReceipt === 1 ? "" : "s"} will be closed short` : "Enter a received quantity or close the short balance"}</div><Button variant="outline" disabled={saving} onClick={() => void startScannedReceiving()}><PackageCheck className="size-4" /> Scan full shipment</Button><Button variant="outline" onClick={closeReceiving}>Cancel</Button><Button disabled={saving || (receiptUnitTotal <= 0 && !closeShortShipment) || Boolean(receiptMode === "final" && canceledDemandExceptions.length && !acknowledgeCanceledDemand)} onClick={() => void receive()}>{saving ? <Loader2 className="size-4 animate-spin" /> : receiptMode === "draft" ? "Save draft" : closeShortShipment ? "Finalize & close PO" : canceledDemandExceptions.length ? "Receive to return hold" : "Finalize receipt"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
  const receiptCorrectionDialog = (
    <Dialog open={receiptCorrectionOpen} onOpenChange={(open) => { if (!saving) setReceiptCorrectionOpen(open) }}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4 pr-14">
          <DialogTitle>Correct received quantities</DialogTitle>
          <DialogDescription>Lower a line's received total or un-receive the entire PO. DataPlus reverses physical stock and releases allocations that the corrected balance can no longer support.</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-4 overflow-y-auto px-5 py-4">
          <Alert className="border-amber-500/40 bg-amber-500/10"><AlertTriangle className="size-4" /><AlertTitle>This changes inventory and fulfillment</AlertTitle><AlertDescription>Unshipped allocations will be released automatically. The correction is blocked if units were already consumed, transferred, picked, packed, or shipped.</AlertDescription></Alert>
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-muted-foreground">Enter the corrected cumulative received quantity for each line.</p><Button size="sm" variant="outline" onClick={() => setReceiptCorrectionQuantities(Object.fromEntries(lines.map((line, index) => [purchaseOrderLineKey(line, index), Number(line.receivedQty || 0) > 0 ? 0 : Number(line.receivedQty || 0)])))}>Set all received lines to 0</Button></div>
          <div className="max-h-[42vh] overflow-auto rounded-md border"><Table><TableHeader className="sticky top-0 z-10 bg-popover"><TableRow><TableHead>SKU / item</TableHead><TableHead className="w-28 text-right">Ordered</TableHead><TableHead className="w-28 text-right">Received</TableHead><TableHead className="w-40 text-right">Corrected received</TableHead><TableHead className="w-28 text-right">Remove</TableHead></TableRow></TableHeader><TableBody>
            {lines.map((line, index) => { const key = purchaseOrderLineKey(line, index); const received = Math.max(0, Number(line.receivedQty || 0)); const target = Math.min(received, Math.max(0, Number(receiptCorrectionQuantities[key] ?? received))); return <TableRow key={`receipt-correction-${key}`} className={!received ? "opacity-60" : ""}><TableCell><p className="font-mono text-xs font-medium">{String(line.sku || "-")}</p><p className="line-clamp-2 text-sm text-muted-foreground">{String(line.title || "Untitled item")}</p></TableCell><TableCell className="text-right tabular-nums">{numberLabel(Number(line.qty || line.quantity || 0))}</TableCell><TableCell className="text-right tabular-nums">{numberLabel(received)}</TableCell><TableCell><Input className="ml-auto w-28 text-right tabular-nums" aria-label={`Corrected received quantity for ${String(line.sku || "line")}`} type="number" min={0} max={received} disabled={!received} value={String(target)} onChange={(event) => setReceiptCorrectionQuantities((current) => ({ ...current, [key]: Math.min(received, Math.max(0, Number(event.target.value || 0))) }))} /></TableCell><TableCell className="text-right font-medium tabular-nums">{target < received ? numberLabel(received - target) : "-"}</TableCell></TableRow> })}
          </TableBody></Table></div>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Reason"><Select value={receiptCorrectionReason} onValueChange={setReceiptCorrectionReason}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="received_by_mistake">Received by mistake</SelectItem><SelectItem value="quantity_correction">Quantity correction</SelectItem><SelectItem value="wrong_sku">Wrong SKU received</SelectItem><SelectItem value="duplicate_receipt">Duplicate receipt</SelectItem><SelectItem value="testing">Testing</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></Field><Field label={`Note ${receiptCorrectionReason === "other" ? "(required)" : "(optional)"}`}><Textarea className="min-h-20" value={receiptCorrectionNote} onChange={(event) => setReceiptCorrectionNote(event.target.value)} placeholder="Explain why receiving is being corrected" /></Field></div>
        </div>
        <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none border-t px-5 py-4"><div className="mr-auto self-center text-sm text-muted-foreground">{receiptCorrectionChanges.length ? `${numberLabel(receiptCorrectionChanges.reduce((sum, entry) => sum + entry.reduceBy, 0))} purchase unit(s) will be removed` : "No quantities changed"}</div><Button variant="outline" disabled={saving} onClick={() => setReceiptCorrectionOpen(false)}>Cancel</Button><Button variant="destructive" disabled={saving || !receiptCorrectionChanges.length || (receiptCorrectionReason === "other" && !receiptCorrectionNote.trim())} onClick={() => void saveReceiptCorrection()}>{saving ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />} Apply correction</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
  const deletePoDialog = (
    <AlertDialog open={deletePoOpen} onOpenChange={(open) => { if (!saving) setDeletePoOpen(open) }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Delete {String(po.poNumber || "purchase order")}?</AlertDialogTitle><AlertDialogDescription>This is a soft delete for test or invalid POs. Any received inventory and unshipped allocations will be reversed first. The PO remains in audit history and linked customer demand returns to buyer review.</AlertDialogDescription></AlertDialogHeader>
        <div className="grid gap-2"><Label htmlFor="delete-po-reason">Reason</Label><Textarea id="delete-po-reason" value={deletePoReason} onChange={(event) => setDeletePoReason(event.target.value)} placeholder="For example: Test PO created during receiving setup" /></div>
        <AlertDialogFooter><AlertDialogCancel disabled={saving}>Keep PO</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={saving || !deletePoReason.trim()} onClick={(event) => { event.preventDefault(); void deleteTestPo() }}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Delete PO</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
  if (mobile && !loading) return <div className="grid gap-4"><h1 className="text-xl font-semibold">{String(po.poNumber || id)}</h1><p>{String(po.supplier || "")} · {String(po.warehouseName || "")}</p>{!po.id ? <Alert variant="destructive"><AlertTitle>PO unavailable</AlertTitle><AlertDescription>Check your access or retry.<Button variant="outline" onClick={() => void load()}>Retry</Button></AlertDescription></Alert> : <>{activeReceivingNotice}{receivedByNotice}<p className="text-sm text-muted-foreground">{String(po.status || "").replaceAll("_", " ")} · {lines.reduce((total, line) => total + purchaseOrderLineRemaining(line), 0)} units remaining</p><div className="flex flex-wrap gap-2"><Button disabled={saving || ["received", "closed", "canceled", "cancelled", "rejected", "superseded", "deleted"].includes(String(po.status).toLowerCase())} onClick={openReceiving}>Scan / receive items</Button>{lines.some((line) => Number(line.receivedQty || 0) > 0) ? <Button variant="outline" onClick={openReceiptCorrection}>Correct receipt</Button> : null}{!purchaseOrderHasSubmission(po) && String(po.status || "").toLowerCase() !== "deleted" ? <Button variant="destructive" onClick={() => { setDeletePoReason(""); setDeletePoOpen(true) }}><Trash2 className="size-4" /> Delete test PO</Button> : null}</div>{lines.map((line, index) => { const lineReceivers = purchaseOrderLineReceiverNames(line, receipts); return <Card key={purchaseOrderLineKey(line, index)}><CardContent className="grid gap-2 p-4"><strong>{String(line.sku)}</strong><p className="text-sm" title={String(line.title || "")}>{compactPurchaseItemTitle(line.title)}</p><p>{purchaseOrderLineRemaining(line)} remaining</p>{lineReceivers.length ? <p className="text-xs text-muted-foreground">Received by {lineReceivers.join(", ")}</p> : null}</CardContent></Card> })}{receivingDialog}{receiptCorrectionDialog}{deletePoDialog}</>}</div>
  if (loading) return <div className="grid gap-3"><Skeleton className="h-28" /><Skeleton className="h-64" /></div>
  const history = Array.isArray(po.timeline) ? po.timeline as Array<Record<string, unknown>> : []
  const documents = Array.isArray(po.documents) ? po.documents as Array<Record<string, unknown>> : []
  const financials = (po.financials || {}) as Record<string, unknown>
  const bills = Array.isArray(financials.bills) ? financials.bills as Array<Record<string, unknown>> : []
  const payments = Array.isArray(financials.payments) ? financials.payments as Array<Record<string, unknown>> : []
  const credits = Array.isArray(financials.credits) ? financials.credits as Array<Record<string, unknown>> : []
  const financeSummary = (financials.summary || {}) as Record<string, unknown>
  const poCommitted = ["submitted", "sent", "placed", "vendor_confirmed", "acknowledged", "partially_received"].includes(String(po.status || "").toLowerCase()) || Boolean(po.submittedAt || po.sentAt || po.placedAt)
  const editableManualDraftLines = String(po.source || "") === "manual_purchasing" && !poCommitted && ["draft", "hold"].includes(String(po.status || "draft").toLowerCase())
  const draftMissingFields = Array.isArray(po.draftMissingFields) ? po.draftMissingFields.map(String) : []
  const cancelableLineEntries = lines.map((line, index) => ({ line, index, key: purchaseOrderLineKey(line, index) })).filter(({ line }) => purchaseOrderLineRemaining(line) > 0 && Number(line.receivedQty || 0) === 0)
  const selectedCancelLineEntries = cancelableLineEntries.filter(({ key }) => cancelLineDrafts[key]?.selected)
  const allCancelableLinesSelected = Boolean(cancelableLineEntries.length) && selectedCancelLineEntries.length === cancelableLineEntries.length
  const cancelSelectionReady = Boolean(selectedCancelLineEntries.length) && selectedCancelLineEntries.every(({ key }) => Boolean(cancelLineDrafts[key]?.reasonCode))
  const canSplitToDropship = Boolean(lines.length) && !poCommitted && ["draft", "ready_to_send"].includes(String(po.status || "draft").toLowerCase()) && String(po.fulfillmentMode || "") !== "dropship_per_order" && lines.every((line) => Number(line.receivedQty || 0) === 0 && Number(line.reSourcedQty || 0) === 0 && Boolean(line.orderId && line.routeId))
  const supplierAmendment = (po.supplierAmendment || {}) as Record<string, unknown>
  const reSourceSelectedLines = reSourcePreview?.lines.filter((line) => reSourceDraft.lineKeys.includes(line.lineKey)) || []
  const reSourceCurrentCost = reSourceSelectedLines.reduce((sum, line) => sum + line.currentUnitCost * line.openQty, 0)
  const reSourceReplacementCost = reSourceSelectedLines.reduce((sum, line) => { const offer = line.alternatives.find((candidate) => candidate.vendorId === reSourceDraft.vendorId); return sum + Number(offer?.unitCost || 0) * line.openQty }, 0)
  const isDropship = String(po.fulfillmentMode || "").toLowerCase() === "dropship_per_order" || po.directToCustomer === true
  const supplierSubmissionEnabled = data.supplierSubmission?.sendNowEnabled === true || data.supplierSubmission?.ready === true
  const canReturnToDropships = isDropship && purchaseOrderHasSubmission(po) && !purchaseOrderHasTracking(po)
    && !["shipped", "received", "closed", "canceled", "rejected", "superseded", "deleted"].includes(String(po.status || "").toLowerCase())
    && !lines.some((line) => Number(line.receivedQty || 0) > 0)
  const canMarkInbound = !isDropship && purchaseOrderHasSubmission(po)
    && !["in_transit", "incoming", "partially_received", "receiving", "received", "closed", "completed", "canceled", "cancelled", "rejected", "superseded", "deleted"].includes(String(po.status || "").toLowerCase())
    && String(po.workflowStage || "").toLowerCase() !== "incoming"
  const linkedOrder = (data.linkedOrders || []).find((order) => String(order.id || "") === dropshipLabelOrderId) || (data.linkedOrders || [])[0] || {}
  const shipTo = (po.shipTo || linkedOrder.address || linkedOrder.shippingAddress || {}) as Record<string, unknown>
  const ctechId = purchaseOrderCtechNumber(po)
  const supplierOrderNumber = purchaseOrderSupplierReference(po)
  const customerName = String(shipTo.name || linkedOrder.buyer || linkedOrder.customerName || "Customer")
  const customerEmail = String(linkedOrder.buyerEmail || linkedOrder.customerEmail || shipTo.email || "")
  const customerPhone = String(linkedOrder.phone || linkedOrder.buyerPhone || linkedOrder.customerPhone || shipTo.phone || "")
  const deliveryAddress = [shipTo.company, shipTo.line1 || shipTo.address1, shipTo.line2 || shipTo.address2, [shipTo.city, shipTo.state || shipTo.province, shipTo.postalCode || shipTo.zip].filter(Boolean).join(", "), shipTo.country || shipTo.countryCode].filter(Boolean).map(String)
  const customerOrderReference = String(linkedOrder.orderNumber || linkedOrder.marketplaceOrderNumber || (Array.isArray(po.orderNumbers) ? po.orderNumbers[0] : po.orderNumber) || "")
  const channelOrderReference = String(linkedOrder.marketplaceOrderNumber || linkedOrder.channelOrderNumber || linkedOrder.externalOrderId || "")
  const deliveryInstructions = String(linkedOrder.shippingInstructions || linkedOrder.deliveryInstructions || linkedOrder.customerNote || "")
  const dropshipLabelLines = (Array.isArray(linkedOrder.items) ? linkedOrder.items as Array<Record<string, unknown>> : lines.filter((line) => !line.orderId || String(line.orderId) === String(linkedOrder.id)))
  const dropshipCopyText = [
    `Customer: ${customerName}`,
    customerEmail ? `Email: ${customerEmail}` : "",
    customerPhone ? `Phone: ${customerPhone}` : "",
    "Ship to:",
    ...deliveryAddress,
    customerOrderReference ? `DataPlus order: ${customerOrderReference}` : "",
    channelOrderReference && channelOrderReference !== customerOrderReference ? `Channel order: ${channelOrderReference}` : "",
    linkedOrder.source || linkedOrder.channel ? `Sales channel: ${String(linkedOrder.source || linkedOrder.channel)}` : "",
    linkedOrder.shipBy ? `Ship by: ${String(linkedOrder.shipBy)}` : "",
    linkedOrder.shippingMethod || linkedOrder.shippingService ? `Requested service: ${String(linkedOrder.shippingMethod || linkedOrder.shippingService)}` : "",
    supplierOrderNumber ? `Supplier order #: ${supplierOrderNumber}` : "",
    ctechId ? `CTech PO #: ${ctechId}` : "",
    deliveryInstructions ? `Delivery instructions: ${deliveryInstructions}` : "",
    "",
    "Items:",
    ...lines.map((line) => `${numberLabel(Number(line.qty || 0))} x ${String(line.vendorSku || line.sku || "Item")} - ${String(line.title || line.sku || "Item")}`),
  ].filter((value) => value !== "").join("\n")
  const copyDropshipDetails = async () => {
    try {
      await navigator.clipboard.writeText(dropshipCopyText)
      toast.success("Customer and dropship details copied.")
    } catch {
      toast.error("Unable to copy the dropship details.")
    }
  }
  return <div className="grid w-full min-w-0 max-w-full gap-5 overflow-hidden">
    <PageHeader eyebrow="Purchasing / Purchase order" title={String(po.poNumber || id)} description={`${String(po.supplier || "Unassigned supplier")} to ${String(po.warehouseName || "unassigned destination")}`} action={<div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" asChild><a href="/purchasing">Back</a></Button><Button size="sm" variant="outline" disabled={refreshing} onClick={() => void load()}>{refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} {refreshing ? "Refreshing" : "Refresh"}</Button><DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" disabled={saving}><SlidersHorizontal className="size-4" /> Actions <ChevronDown className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="max-h-[min(36rem,calc(100vh-2rem))] w-72 overflow-y-auto">
      <DropdownMenuLabel>Purchase order</DropdownMenuLabel>
      <DropdownMenuItem onClick={openEditor}><Pencil className="size-4" /> Edit PO</DropdownMenuItem>
      <DropdownMenuItem disabled={draftMissingFields.length > 0 || purchaseOrderHasSubmission(po) || String(((po.approval || {}) as Record<string, unknown>).status || "").toLowerCase() === "approved"} onClick={() => void updateStatus("approve")}><CheckCircle2 className="size-4" /> Approve PO</DropdownMenuItem>
      {supplierSubmissionEnabled ? <DropdownMenuItem disabled={draftMissingFields.length > 0 || purchaseOrderHasSubmission(po)} onClick={() => void submit()}><SendHorizontal className="size-4" /> Submit to supplier</DropdownMenuItem> : null}
      <DropdownMenuSeparator />
      <DropdownMenuLabel>Supplier and shipping</DropdownMenuLabel>
      <DropdownMenuItem onClick={openAcknowledgement}><MessageSquare className="size-4" /> Record acknowledgement</DropdownMenuItem>
      {canMarkInbound ? <DropdownMenuItem onClick={() => void markInbound()}><Truck className="size-4" /> Mark inbound</DropdownMenuItem> : null}
      <DropdownMenuItem onClick={openSupplierReference}><Link2 className="size-4" /> {supplierOrderNumber ? "Edit supplier order #" : "Add supplier order #"}</DropdownMenuItem>
      <DropdownMenuItem onClick={openCtechReference}><FileText className="size-4" /> {ctechId ? "Edit CTech PO #" : "Add CTech PO #"}</DropdownMenuItem>
      <DropdownMenuItem onClick={() => void openReminder()}><Clock3 className="size-4" /> Preview overdue reminder</DropdownMenuItem>
      <DropdownMenuItem onClick={openDocument}><Link2 className="size-4" /> Link supplier document</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>Fulfillment</DropdownMenuLabel>
      {canReturnToDropships ? <DropdownMenuItem onClick={() => { setReturnReasonCode("wrong_vendor"); setReturnReasonNote(""); setReturnToDropshipsOpen(true) }}><RotateCcw className="size-4" /> Return to Dropships</DropdownMenuItem> : null}
      <DropdownMenuItem disabled={reSourceLoading || ["received", "closed", "canceled", "rejected", "superseded", "deleted"].includes(String(po.status || "").toLowerCase())} onClick={() => void openReSource()}>{reSourceLoading ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />} Re-source open quantities</DropdownMenuItem>
      <DropdownMenuItem disabled={!canSplitToDropship} onClick={() => { setSplitReasonCode("supplier_direct_only"); setSplitReasonNote(""); poMutationRequestIdsRef.current.set("split-dropship", crypto.randomUUID()); setSplitDropshipOpen(true) }}><Truck className="size-4" /> Split into dropship POs</DropdownMenuItem>
      {String(po.fulfillmentMode || "") !== "dropship_per_order" ? <DropdownMenuItem onClick={openReceiving}><PackageCheck className="size-4" /> Receive inventory</DropdownMenuItem> : null}
      {lines.some((line) => Number(line.receivedQty || 0) > 0) ? <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={openReceiptCorrection}><RotateCcw className="size-4" /> Correct received inventory</DropdownMenuItem> : null}
      <DropdownMenuSeparator />
      <DropdownMenuLabel>Documents</DropdownMenuLabel>
      <DropdownMenuItem onClick={() => window.open(`/api/purchase-orders/${encodeURIComponent(id)}/export?format=csv`, "_blank", "noreferrer")}><FileDown className="size-4" /> Export CSV</DropdownMenuItem>
      <DropdownMenuItem onClick={() => window.open(`/api/purchase-orders/${encodeURIComponent(id)}/export?format=html`, "_blank", "noreferrer")}><Printer className="size-4" /> Print PO</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>Status and exceptions</DropdownMenuLabel>
      <DropdownMenuItem onClick={() => void updateStatus("hold")}><Clock3 className="size-4" /> Place on hold</DropdownMenuItem>
      <DropdownMenuItem onClick={() => void updateStatus("close")}><Archive className="size-4" /> Close PO</DropdownMenuItem>
      <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => void updateStatus("reject")}><Ban className="size-4" /> Reject PO</DropdownMenuItem>
      <DropdownMenuItem disabled={poCommitted || !cancelableLineEntries.length} className="text-destructive focus:text-destructive" onClick={() => void updateStatus("cancel")}><X className="size-4" /> Cancel PO lines</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>Administration</DropdownMenuLabel>
      <DropdownMenuItem disabled={purchaseOrderHasSubmission(po) || String(po.status || "").toLowerCase() === "deleted"} className="text-destructive focus:text-destructive" onClick={() => { setDeletePoReason(""); setDeletePoOpen(true) }}><Trash2 className="size-4" /> Delete test PO</DropdownMenuItem>
    </DropdownMenuContent></DropdownMenu></div>} />
    <PurchaseOrderApprovalFollowUpDialog decision={approvalDecision} busy={saving} onBusyChange={setSaving} onClose={() => setApprovalDecision(null)} onCompleted={load} user={operatorName} />
    <PurchaseOrderRejectionDialog decision={rejectionDecision} busy={saving} onClose={() => setRejectionDecision(null)} onConfirm={rejectPurchaseOrder} />
    {receiptCorrectionDialog}
    {deletePoDialog}
    <PurchaseOrderProgress po={po} />
    {draftMissingFields.length > 0 ? <Alert className="border-amber-500/40 bg-amber-500/10"><AlertTriangle className="size-4" /><AlertTitle>Draft saved, details still needed</AlertTitle><AlertDescription className="flex flex-wrap items-start justify-between gap-3"><span>{draftMissingFields.join(" ")} You can keep editing this draft, but it cannot be approved or sent yet.</span><Button size="sm" variant="outline" onClick={openEditor}><Pencil className="size-4" /> Continue draft</Button></AlertDescription></Alert> : null}
    <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5"><Detail label="Status" value={String(po.status || "draft").replace(/_/g, " ")} /><Detail label="Supplier" value={String(po.supplier || "Unassigned")} />{ctechId ? <Detail label="CTech PO #" value={ctechId} /> : null}{po.placedFromExternalSource === true ? <Detail label={`${String(po.externalSourceSystem || "External source")} PO #`} value={String(po.externalPoNumber || "Not recorded")} /> : null}<Detail label="Destination" value={String(po.warehouseName || "-")} /><Detail label="Units" value={numberLabel(Number(po.totalUnits || lines.reduce((sum, line) => sum + Number(line.qty || 0), 0)))} /><Detail label="Created by" value={String(po.creationActor || po.createdBy || "System")} /><Detail label="Creation path" value={String(po.creationOperation || po.source || "manual").replace(/_/g, " ")} /><Detail label="Merchandise cost" value={moneyLabel(Number(po.merchandiseCost ?? po.estimatedCost ?? 0))} /><Detail label="Dropship fee" value={moneyLabel(Number(po.dropShipFee || 0))} /><Detail label="Total PO cost" value={moneyLabel(Number(po.estimatedTotalCost ?? po.estimatedCost ?? 0))} /><Detail label="Expected delivery" value={purchaseScheduleDateLabel(po.expectedDeliveryDate || po.expectedAt)} /></div>
    {activeReceivingNotice}
    {receivedByNotice}
    {!isDropship && purchaseOrderHasSubmission(po) && !["received", "closed", "canceled", "rejected", "superseded", "deleted"].includes(String(po.status || "").toLowerCase()) ? <Alert className="border-blue-500/30 bg-blue-500/5"><Truck className="size-4" /><AlertTitle>{po.noTrackingNeeded === true ? "Incoming without tracking" : po.trackingNumber ? "Inbound shipment tracking" : "Awaiting supplier tracking"}</AlertTitle><AlertDescription className="flex flex-wrap items-center justify-between gap-3"><span>{po.noTrackingNeeded === true ? `${String(po.supplier || "The supplier")} does not provide tracking. Start receiving when this PO arrives${po.expectedAt ? `; expected ${purchaseScheduleDateLabel(po.expectedAt)}` : ""}.` : po.trackingNumber ? `${String(po.shippingCarrier || "Carrier")} ${String(po.trackingNumber)} is shipping to ${String(po.warehouseName || "the receiving warehouse")}.` : `Record tracking when ${String(po.supplier || "the supplier")} ships this PO to ${String(po.warehouseName || "the receiving warehouse")}.`}</span><span className="flex flex-wrap gap-2">{canMarkInbound ? <Button size="sm" onClick={() => void markInbound()}><Truck className="size-4" /> Mark inbound</Button> : null}{po.noTrackingNeeded === true ? null : <Button size="sm" variant="outline" onClick={openInboundTracking}>{po.trackingNumber ? "Edit inbound tracking" : "Add inbound tracking"}</Button>}</span></AlertDescription></Alert> : null}
    {supplierAmendment.status === "pending_supplier_confirmation" ? <Alert className="border-amber-500/40 bg-amber-500/10"><AlertTriangle className="size-4" /><AlertTitle>Supplier amendment pending</AlertTitle><AlertDescription>This sent PO was changed in DataPlus. Send the amendment to the supplier and record their acknowledgement before relying on the revised quantities or dates.</AlertDescription></Alert> : null}
    <Alert variant={nextStep.variant === "destructive" ? "destructive" : "default"} className={nextStep.variant === "default" ? "border-blue-500/30 bg-blue-500/5" : nextStep.variant === "secondary" ? "border-muted-foreground/20 bg-muted/40" : ""}>
      {["canceled", "cancelled"].includes(String(po.status || "").toLowerCase()) ? <Ban className="size-4" /> : <Clock3 className="size-4" />}
      <AlertTitle>{["canceled", "cancelled"].includes(String(po.status || "").toLowerCase()) ? nextStep.label : `Next step: ${nextStep.label}`}</AlertTitle>
      <AlertDescription>{nextStep.description}</AlertDescription>
    </Alert>
    {po.replacesPurchaseOrderId ? <Alert><RotateCcw className="size-4" /><AlertTitle>Replacement purchase order</AlertTitle><AlertDescription>This PO replaces open quantities from <a className="font-medium text-primary hover:underline" href={`/purchase-orders/${encodeURIComponent(String(po.replacesPurchaseOrderId))}`}>{String(po.replacesPurchaseOrderNumber || po.replacesPurchaseOrderId)}</a>. Received quantities remain on the original PO.</AlertDescription></Alert> : null}
    {po.replacedByPurchaseOrderId ? <Alert><Archive className="size-4" /><AlertTitle>This PO was superseded</AlertTitle><AlertDescription>Its open quantities were moved to <a className="font-medium text-primary hover:underline" href={`/purchase-orders/${encodeURIComponent(String(po.replacedByPurchaseOrderId))}`}>{String(po.replacedByPurchaseOrderNumber || po.replacedByPurchaseOrderId)}</a>. This record is retained for receipts and audit history.</AlertDescription></Alert> : null}
    {Array.isArray(po.replacedByPurchaseOrderIds) && po.replacedByPurchaseOrderIds.length > 1 ? <Alert><Archive className="size-4" /><AlertTitle>This PO was split into dropship POs</AlertTitle><AlertDescription className="flex flex-wrap gap-x-2 gap-y-1">Its lines were grouped by recipient and delivery address into {(po.replacedByPurchaseOrderIds as unknown[]).map((replacementId, index) => <a key={String(replacementId)} className="font-medium text-primary hover:underline" href={`/purchase-orders/${encodeURIComponent(String(replacementId))}`}>{String((po.replacedByPurchaseOrderNumbers as unknown[] | undefined)?.[index] || replacementId)}</a>)}.</AlertDescription></Alert> : null}
    {unresolvedCatalogLines.length ? <Alert className="border-amber-500/40 bg-amber-500/10"><AlertTriangle className="size-4" /><AlertTitle>{numberLabel(unresolvedCatalogLines.length)} PO line{unresolvedCatalogLines.length === 1 ? " needs" : "s need"} a catalog SKU</AlertTitle><AlertDescription>The warehouse can receive these lines now. Their physical counts remain on SKU-resolution hold and are posted to inventory automatically after you link an existing product or create the missing draft SKU.</AlertDescription></Alert> : null}
    {canceledDemandExceptions.length ? <Alert variant="destructive"><AlertTriangle className="size-4" /><AlertTitle>Canceled or refunded customer demand</AlertTitle><AlertDescription>{canceledDemandExceptions.length} committed PO line{canceledDemandExceptions.length === 1 ? " is" : "s are"} no longer needed by the customer. Segregate these units at receiving; DataPlus will place them in vendor-return hold instead of releasing them to fulfillment.</AlertDescription></Alert> : null}
    {isDropship ? <Card className="border-blue-500/30">
      <CardHeader className="gap-3 border-b sm:flex-row sm:items-start sm:justify-between">
        <div><CardTitle className="flex items-center gap-2 text-base"><Truck className="size-4" /> Customer dropship details</CardTitle><CardDescription>Use this information when placing the order with {String(po.supplier || "the supplier")}. Copying includes the customer, complete address, order references, shipping request, instructions, and item lines.</CardDescription></div>
        <div className="flex flex-wrap gap-2">{(data.linkedOrders || []).length > 1 ? <Select value={String(linkedOrder.id || "")} onValueChange={setDropshipLabelOrderId}><SelectTrigger className="w-44"><SelectValue placeholder="Choose order" /></SelectTrigger><SelectContent>{(data.linkedOrders || []).map((order) => <SelectItem key={String(order.id)} value={String(order.id)}>{String(order.orderNumber || order.id)}</SelectItem>)}</SelectContent></Select> : null}<Button size="sm" variant="outline" disabled={!linkedOrder.id || !shipFromWarehouses.length} onClick={() => setDropshipLabelOpen(true)}><Printer className="size-4" /> Buy shipping label</Button><Button size="sm" variant="outline" onClick={() => void copyDropshipDetails()}><Copy className="size-4" /> Copy all details</Button><Button size="sm" variant="outline" onClick={openDropshipTracking}>{po.trackingNumber ? "Edit tracking" : "Add tracking"}</Button><Button size="sm" variant="outline" onClick={openCtechReference}>{ctechId ? "Edit CTech PO #" : "Add CTech PO #"}</Button><Button size="sm" onClick={openSupplierReference}>{supplierOrderNumber ? "Edit supplier order #" : "Add supplier order #"}</Button></div>
      </CardHeader>
      <CardContent className="grid gap-5 p-4 lg:grid-cols-2">
        <div className="grid gap-3"><div><p className="text-xs font-semibold uppercase text-muted-foreground">Customer</p><p className="mt-1 font-medium">{customerName}</p>{customerEmail ? <p className="break-all text-sm">{customerEmail}</p> : <p className="text-sm text-muted-foreground">No email recorded</p>}{customerPhone ? <p className="text-sm">{customerPhone}</p> : <p className="text-sm text-muted-foreground">No phone recorded</p>}</div><div><p className="text-xs font-semibold uppercase text-muted-foreground">Delivery address</p>{deliveryAddress.length ? <div className="mt-1 text-sm">{deliveryAddress.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}</div> : <p className="mt-1 text-sm text-destructive">Delivery address needs review</p>}</div>{deliveryInstructions ? <div><p className="text-xs font-semibold uppercase text-muted-foreground">Delivery instructions</p><p className="mt-1 whitespace-pre-wrap text-sm">{deliveryInstructions}</p></div> : null}</div>
        <div className="grid content-start gap-3 sm:grid-cols-2"><Detail label="DataPlus order" value={customerOrderReference || "Not recorded"} /><Detail label="Channel order" value={channelOrderReference || "Not recorded"} /><Detail label="Sales channel" value={String(linkedOrder.source || linkedOrder.channel || "Not recorded")} /><Detail label="Ship by" value={dateLabel(String(linkedOrder.shipBy || ""))} /><Detail label="Requested service" value={String(linkedOrder.shippingMethod || linkedOrder.shippingService || "Not recorded")} /><Detail label="Supplier order #" value={supplierOrderNumber || "Pending"} /><Detail label="CTech PO #" value={ctechId || "Pending"} /><Detail label="Carrier" value={String(po.shippingCarrier || "Pending")} />{po.trackingNumber && po.trackingUrl ? <div className="rounded-md border bg-background p-2"><p className="text-xs font-bold uppercase text-muted-foreground">Tracking</p><a className="break-all font-medium text-primary hover:underline" href={String(po.trackingUrl)} target="_blank" rel="noreferrer">{String(po.trackingNumber)}</a></div> : <Detail label="Tracking" value={String(po.trackingNumber || "Pending")} />}</div>
      </CardContent>
      {!shipFromWarehouses.length ? <CardFooter className="border-t py-3 text-sm text-amber-700 dark:text-amber-300">Configure a physical ship-from warehouse before buying a dropship label.</CardFooter> : null}
    </Card> : null}
    {isDropship && linkedOrder.id && shipFromWarehouses.length ? <UniversalShippingLabelDialog open={dropshipLabelOpen} onOpenChange={setDropshipLabelOpen} orderId={String(linkedOrder.id)} order={linkedOrder} warehouses={shipFromWarehouses} lines={dropshipLabelLines} remaining={(line) => Math.max(0, Number(line.qty || line.quantity || 0))} purchaseOrderId={String(po.id || id)} onUpdated={load} defaultShipFromWarehouseId={defaultShipFromWarehouseId} /> : null}
    {isDropship && ["closed", "received", "completed"].includes(String(po.status || "").toLowerCase()) && !supplierOrderNumber ? <Alert className="border-amber-500/40 bg-amber-500/5"><AlertTriangle className="size-4" /><AlertTitle>Supplier order number still pending</AlertTitle><AlertDescription className="flex flex-wrap items-center justify-between gap-3"><span>This PO is complete, but the supplier confirmation/reference has not been recorded. Add it when the supplier provides it; the PO will remain complete.</span><Button size="sm" variant="outline" onClick={openSupplierReference}>Add supplier order #</Button></AlertDescription></Alert> : null}
    <Tabs defaultValue="lines" className="min-w-0"><div className="overflow-x-auto"><TabsList className="h-auto min-w-max"><TabsTrigger value="lines">Lines ({lines.length})</TabsTrigger><TabsTrigger value="orders">Linked orders ({(data.linkedOrders || []).length})</TabsTrigger><TabsTrigger value="receipts">Receipts ({receipts.length})</TabsTrigger><TabsTrigger value="financials">Financials</TabsTrigger><TabsTrigger value="returns">Vendor returns ({vendorReturns.length})</TabsTrigger><TabsTrigger value="documents">Documents ({documents.length})</TabsTrigger><TabsTrigger value="history">History ({history.length})</TabsTrigger></TabsList></div>
      <TabsContent value="lines" className="mt-4">
        <Card>
          <CardContent className="min-w-0 max-w-full overflow-hidden p-0">
            <div className="w-full max-w-full overflow-x-auto"><Table className="min-w-[64rem] table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[26rem]">Item and identifiers</TableHead>
                  <TableHead className="w-40">Supplier</TableHead>
                  <TableHead className="w-28">Quantity</TableHead>
                  <TableHead className="w-28 text-right">Unit cost</TableHead>
                  <TableHead className="w-28 text-right">Customer paid</TableHead>
                  <TableHead className="w-16 text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line, index) => {
                  const sku = String(line.sku || "")
                  const unresolved = !sku || line.resolutionStatus === "unresolved"
                  const title = String(line.title || sku || "Item")
                  const identifiers = [
                    ["Mfr", line.manufacturerSku || line.mfrPartNumber || line.manufacturerPartNumber || line.mpn],
                    ["Part", line.vendorPartNumber || line.vendorPart || line.partNumber],
                    ["Vendor", line.vendorSku],
                    ["UPC", line.upc || line.barcode || line.gtin],
                  ].filter((entry) => String(entry[1] || "").trim())
                  return <TableRow key={`${sku}-${index}`}>
                    <TableCell className="align-top">
                      <div className="flex min-w-0 items-start gap-3">
                        <CatalogImage src={String(line.defaultImage || line.imageUrl || line.image || "")} alt={title} className="size-12 shrink-0" imageClassName="p-1" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">{unresolved ? <><span className="font-mono text-xs">{String(line.sourceItemNumber || line.vendorSku || "Unmatched")}</span><Badge variant="warning">Needs SKU</Badge></> : <a className="font-mono text-xs font-semibold text-primary hover:underline" href={`/products/${encodeURIComponent(sku)}`}>{sku}</a>}</div>
                          <p className="mt-1 line-clamp-2 break-words text-sm font-medium" title={title}>{compactPurchaseItemTitle(title)}</p>
                          {identifiers.length ? <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">{identifiers.map(([label, value]) => <span key={String(label)}><span className="font-medium">{String(label)}:</span> <span className="font-mono">{String(value)}</span></span>)}</div> : null}
                          {Number(line.canceledQty || 0) > 0 ? <div className="mt-1"><Badge variant="destructive">{numberLabel(Number(line.canceledQty || 0))} canceled</Badge><p className="mt-1 break-words text-xs text-destructive">{String(line.cancelReasonLabel || "Reason not recorded")}{line.cancelReasonNote ? `: ${String(line.cancelReasonNote)}` : ""}</p></div> : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell><PurchaseLineSupplier line={line} fallbackSupplier={String(po.supplier || "")} /></TableCell>
                    <TableCell className="align-top"><p className="font-medium tabular-nums">{numberLabel(Number(line.qty || 0))} ordered</p><p className="text-xs text-muted-foreground tabular-nums">{numberLabel(Number(line.receivedQty || 0))} received</p>{purchaseOrderLineReceiverNames(line, receipts).length ? <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">By {purchaseOrderLineReceiverNames(line, receipts).join(", ")}</p> : null}<p className="text-xs text-muted-foreground tabular-nums">{numberLabel(purchaseOrderLineRemaining(line))} remaining</p></TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{moneyLabel(Number(line.unitCost ?? line.estimatedUnitCost ?? 0))}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{moneyLabel(Number(line.customerPaid || 0))}</TableCell>
                    <TableCell className="text-right align-top"><DropdownMenu><DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label={`Actions for ${sku || title}`}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{unresolved || String(line.source || "") === "external_po_pdf" ? <DropdownMenuItem disabled={!unresolved && Number(line.receivedQty || 0) > 0} onClick={() => openCatalogLine(line, index)}>{unresolved ? <Search className="size-4" /> : <Pencil className="size-4" />} {unresolved ? "Resolve SKU" : "Change SKU"}</DropdownMenuItem> : null}{!unresolved ? <DropdownMenuItem disabled={purchaseOrderLineRemaining(line) <= 0 || ["received", "closed", "canceled", "rejected", "superseded", "deleted"].includes(String(po.status || "").toLowerCase())} onClick={() => openLineCost(line, index)}>Update cost</DropdownMenuItem> : null}{!unresolved && String(line.source || "") !== "external_po_pdf" && String(po.fulfillmentMode || "") !== "dropship_per_order" && purchaseOrderLineRemaining(line) > 0 && Number(line.receivedQty || 0) === 0 ? <DropdownMenuItem onClick={() => { const requestKey = `line-dropship:${String(line.routeId || index)}`; poMutationRequestIdsRef.current.set(requestKey, crypto.randomUUID()); setDropshipLine({ line, index }); setDropshipReasonCode("other_operational"); setDropshipReasonNote("") }}><Truck className="size-4" /> Move to dropship</DropdownMenuItem> : null}</DropdownMenuContent></DropdownMenu></TableCell>
                  </TableRow>
                })}
              </TableBody>
            </Table></div>
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="orders" className="mt-4 grid gap-2">{(data.linkedOrders || []).map((order) => { const channelNumber = channelOrderNumberFor(order); const channelUrl = channelOrderUrlFor(order, channelNumber, String(order.shopifyAdminUrl || "")); const channel = String(order.source || order.channelSource || order.channel || "Channel"); return <Card key={String(order.id)}><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm"><div><a className="font-medium hover:underline" href={`/orders/${encodeURIComponent(String(order.id))}`}>DataPlus {String(order.orderNumber || order.id)}</a>{channelNumber ? <p className="text-xs text-muted-foreground">{channel} {channelUrl ? <a className="font-mono text-primary hover:underline" href={channelUrl} target="_blank" rel="noreferrer">{channelNumber}</a> : <a className="font-mono text-primary hover:underline" href={`/orders/${encodeURIComponent(String(order.id))}`}>{channelNumber}</a>}</p> : null}</div><span>{String(order.buyer || "Customer")}</span><Badge variant="outline">{String(order.operationalStatus || order.status || "-").replace(/_/g, " ")}</Badge></CardContent></Card> })}</TabsContent>
      <TabsContent value="receipts" className="mt-4 grid gap-2">{receipts.map((receipt, index) => { const receiverNames = (Array.isArray(receipt.receivedByUsers) ? receipt.receivedByUsers : [receipt.receivedBy]).map((value) => String(value || "").trim()).filter(Boolean); return <Card key={String(receipt.id || index)}><CardContent className="flex items-center justify-between gap-3 p-4 text-sm"><div><p className="font-medium">{String(receipt.receiptNumber || `Receipt ${index + 1}`)}</p><p className="text-muted-foreground">{String(receipt.receivedAt || "-")} · {String(receipt.warehouseName || po.warehouseName || "-")}</p>{receiverNames.length ? <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">Received by {receiverNames.join(", ")}</p> : null}</div><Badge variant="outline">{String(receipt.status || "final")}</Badge></CardContent></Card> })}{!receipts.length && <Card><CardContent className="p-4 text-sm text-muted-foreground">No inventory has been received against this PO.</CardContent></Card>}</TabsContent>
      <TabsContent value="financials" className="mt-4 grid gap-4"><div className="flex flex-wrap justify-end gap-2"><Button size="sm" variant="outline" onClick={() => openFinancials("credit")}>Record vendor credit</Button><Button size="sm" variant="outline" disabled={!bills.length} onClick={() => openFinancials("payment")}>Record payment</Button><Button size="sm" onClick={() => openFinancials("bill")}>Record vendor bill</Button></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Detail label="PO commitment" value={moneyLabel(Number(financeSummary.committedCost ?? po.estimatedCost ?? 0))} /><Detail label="Vendor bills" value={moneyLabel(Number(financeSummary.billTotal || 0))} /><Detail label="Paid" value={moneyLabel(Number(financeSummary.paidTotal || 0))} /><Detail label="Credits" value={moneyLabel(Number(financeSummary.creditTotal || 0))} /><Detail label="Open A/P" value={moneyLabel(Number(financeSummary.openBalance || 0))} /></div><Alert><FileText className="size-4" /><AlertTitle>Accounting export readiness</AlertTitle><AlertDescription>{String(financials.accountingStatus || "not_ready") === "ready_to_export" ? "Financial records are structured for accounting export. A QuickBooks connector has not posted them yet." : "Record the vendor bill first. Payments and credits should be applied to that bill so Accounts Payable stays reconciled."}</AlertDescription></Alert><Card><CardHeader className="border-b"><CardTitle className="text-sm">Vendor bills</CardTitle><CardDescription>Use a bill when goods have been invoiced but will be paid later. Record an immediately paid purchase as an expense in the accounting system.</CardDescription></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Bill date</TableHead><TableHead>Due</TableHead><TableHead>Account</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader><TableBody>{bills.map((bill) => <TableRow key={String(bill.id)}><TableCell className="font-medium">{String(bill.billNumber || "-")}</TableCell><TableCell>{String(bill.billDate || "-")}</TableCell><TableCell>{String(bill.dueDate || "-")}</TableCell><TableCell>{String(bill.account || "Accounts Payable")}</TableCell><TableCell><Badge variant={String(bill.status) === "paid" ? "success" : "outline"}>{String(bill.status || "open").replace(/_/g, " ")}</Badge></TableCell><TableCell className="text-right">{moneyLabel(Number(bill.total || 0))}</TableCell></TableRow>)}{!bills.length && <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">No vendor bills recorded.</TableCell></TableRow>}</TableBody></Table></CardContent></Card><div className="grid gap-4 xl:grid-cols-2"><Card><CardHeader className="border-b"><CardTitle className="text-sm">Payments</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Method</TableHead><TableHead>Reference</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader><TableBody>{payments.map((payment) => <TableRow key={String(payment.id)}><TableCell>{String(payment.paymentDate || "-")}</TableCell><TableCell>{String(payment.method || "-")}</TableCell><TableCell>{String(payment.reference || "-")}</TableCell><TableCell className="text-right">{moneyLabel(Number(payment.amount || 0))}</TableCell></TableRow>)}{!payments.length && <TableRow><TableCell colSpan={4} className="h-20 text-center text-muted-foreground">No payments recorded.</TableCell></TableRow>}</TableBody></Table></CardContent></Card><Card><CardHeader className="border-b"><CardTitle className="text-sm">Vendor credits</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Credit</TableHead><TableHead>Date</TableHead><TableHead>Reason</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader><TableBody>{credits.map((credit) => <TableRow key={String(credit.id)}><TableCell>{String(credit.creditNumber || "Vendor credit")}</TableCell><TableCell>{String(credit.creditDate || "-")}</TableCell><TableCell>{String(credit.reason || "-")}</TableCell><TableCell className="text-right">{moneyLabel(Number(credit.amount || 0))}</TableCell></TableRow>)}{!credits.length && <TableRow><TableCell colSpan={4} className="h-20 text-center text-muted-foreground">No credits recorded.</TableCell></TableRow>}</TableBody></Table></CardContent></Card></div></TabsContent>
      <TabsContent value="returns" className="mt-4"><Card><CardHeader className="border-b"><CardTitle className="text-sm">Vendor returns</CardTitle><CardDescription>Customer returns received with “return to vendor” appear here against their original supplier PO. They stay quarantined and never become sellable inventory.</CardDescription></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Return</TableHead><TableHead>Status</TableHead><TableHead>Customer return</TableHead><TableHead>Customer order</TableHead><TableHead>SKU / quantity</TableHead><TableHead>Warehouse</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader><TableBody>{vendorReturns.map((vendorReturn, index) => { const returnItem = Array.isArray(vendorReturn.items) ? vendorReturn.items[0] as Record<string, unknown> : {}; const returnSku = String(vendorReturn.sku || returnItem.sku || ""); const returnQty = Number(vendorReturn.qty || vendorReturn.quantity || returnItem.qty || 0); const sourceOrderId = String(vendorReturn.sourceOrderId || vendorReturn.orderId || ""); return <TableRow key={String(vendorReturn.id || index)}><TableCell className="font-medium">{String(vendorReturn.returnNumber || vendorReturn.id || `Return ${index + 1}`)}</TableCell><TableCell><Badge variant={String(vendorReturn.status || "").includes("review") ? "warning" : "outline"}>{String(vendorReturn.status || "awaiting_receipt").replace(/_/g, " ")}</Badge></TableCell><TableCell>{String(vendorReturn.sourceReturnNumber || "-")}</TableCell><TableCell>{sourceOrderId ? <a className="font-medium hover:underline" href={`/orders/${encodeURIComponent(sourceOrderId)}`}>{String(vendorReturn.sourceOrderNumber || vendorReturn.orderNumber || sourceOrderId)}</a> : "-"}</TableCell><TableCell>{returnSku ? <a className="font-medium hover:underline" href={`/products/${encodeURIComponent(returnSku)}`}>{returnSku}</a> : "-"}<p className="text-xs text-muted-foreground">{numberLabel(returnQty)} units</p></TableCell><TableCell>{String(vendorReturn.warehouseName || po.warehouseName || "-")}</TableCell><TableCell>{String(vendorReturn.reason || "Canceled customer demand")}</TableCell></TableRow> })}{!vendorReturns.length && <TableRow><TableCell colSpan={7} className="h-28 text-center text-muted-foreground">No vendor returns are linked to this PO.</TableCell></TableRow>}</TableBody></Table></CardContent></Card></TabsContent>
      <TabsContent value="documents" className="mt-4 grid gap-2"><div className="flex justify-end"><Button size="sm" onClick={openDocument}>Link document</Button></div>{documents.map((document, index) => <Card key={String(document.id || index)}><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm"><div><p className="font-medium">{String(document.name || "Document")}</p><p className="text-muted-foreground">{String(document.type || "supplier document")}{document.note ? ` - ${String(document.note)}` : ""}</p></div><Button size="sm" variant="outline" asChild><a href={String(document.url || "#")} target="_blank" rel="noreferrer">Open</a></Button></CardContent></Card>)}{!documents.length && <Card><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm text-muted-foreground"><span>No supplier documents are linked.</span><Button size="sm" onClick={openDocument}>Link document</Button></CardContent></Card>}</TabsContent>
      <TabsContent value="history" className="mt-4 grid gap-2">{history.map((event, index) => <Card key={String(event.id || index)}><CardContent className="p-4 text-sm"><p className="font-medium">{String(event.title || event.type || "Activity")}</p><p className="text-muted-foreground">{String(event.message || "")}</p></CardContent></Card>)}{!history.length && <Card><CardContent className="p-4 text-sm text-muted-foreground">No PO activity has been recorded.</CardContent></Card>}</TabsContent>
    </Tabs>
    <Dialog open={Boolean(catalogLine)} onOpenChange={(open) => { if (!open && !saving) setCatalogLine(null) }}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4 pr-14"><DialogTitle>Resolve external PO line</DialogTitle><DialogDescription>Keep the supplier's original line evidence while connecting it to the correct DataPlus catalog SKU.</DialogDescription></DialogHeader>
        {catalogLine ? <div className="grid min-h-0 gap-4 overflow-y-auto px-5 py-4">
          <div className="grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-3"><Detail label="Supplier item" value={String(catalogLine.line.sourceItemNumber || catalogLine.line.vendorSku || "Not recorded")} /><Detail label="Description" value={String(catalogLine.line.sourceDescription || catalogLine.line.title || "Not recorded")} /><Detail label="Ordered" value={numberLabel(Number(catalogLine.line.qty || 0))} /></div>
          <div className="flex gap-2"><Button size="sm" variant={catalogLineMode === "link" ? "default" : "outline"} onClick={() => setCatalogLineMode("link")}>Link existing SKU</Button><Button size="sm" variant={catalogLineMode === "create" ? "default" : "outline"} onClick={() => setCatalogLineMode("create")}>Create missing SKU</Button></div>
          {catalogLineMode === "link" ? <div className="grid gap-3">
            <Field label="Search catalog"><div className="relative"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input autoFocus className="pl-9" value={catalogLineQuery} onChange={(event) => setCatalogLineQuery(event.target.value)} placeholder="Search SKU, UPC, manufacturer part, or title" /></div></Field>
            {catalogLineSearching ? <p className="text-sm text-muted-foreground"><Loader2 className="mr-2 inline size-4 animate-spin" />Searching catalog...</p> : catalogLineQuery.trim().length >= 2 ? <div className="overflow-hidden rounded-md border">{catalogLineResults.map((product) => <button key={String(product.id || product.sku)} type="button" className="grid w-full gap-1 border-b px-4 py-3 text-left last:border-b-0 hover:bg-muted sm:grid-cols-[150px_minmax(0,1fr)_150px]" onClick={() => void saveCatalogLine("link", product)}><span className="font-mono text-xs font-medium">{String(product.sku || "")}</span><span className="truncate text-sm">{String(product.title || product.sku || "")}</span><span className="truncate text-xs text-muted-foreground">{String(product.vendorSku || product.brand || "")}</span></button>)}{!catalogLineResults.length ? <p className="p-4 text-sm text-muted-foreground">No catalog result found. Try another identifier or create the missing SKU.</p> : null}</div> : <p className="text-sm text-muted-foreground">Enter at least two characters to search.</p>}
          </div> : <div className="grid gap-4"><Alert className="border-amber-500/40 bg-amber-500/10"><AlertTriangle className="size-4" /><AlertTitle>Create a draft catalog product</AlertTitle><AlertDescription>This creates product identity only. It does not publish the item or add inventory until this PO is received.</AlertDescription></Alert><Field label="New DataPlus SKU"><Input autoFocus value={catalogLineDraft.sku} onChange={(event) => setCatalogLineDraft((current) => ({ ...current, sku: event.target.value }))} placeholder="Required SKU" /></Field><Field label="Product title"><Input value={catalogLineDraft.title} onChange={(event) => setCatalogLineDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Required product title" /></Field></div>}
        </div> : null}
        <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none border-t px-5 py-4"><Button variant="outline" disabled={saving} onClick={() => setCatalogLine(null)}>Cancel</Button>{catalogLineMode === "create" ? <Button disabled={saving || !catalogLineDraft.sku.trim() || !catalogLineDraft.title.trim()} onClick={() => void saveCatalogLine("create")}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Create and link SKU</Button> : null}</DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={returnToDropshipsOpen} onOpenChange={(open) => { if (!saving) setReturnToDropshipsOpen(open) }}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-lg">
        <DialogHeader><DialogTitle>Return this PO to Dropships?</DialogTitle><DialogDescription>The supplier acknowledgement and submission remain in the audit history. The PO moves back to the buyer Dropships queue so its vendor, price, quantity, or SKU can be corrected before resubmission.</DialogDescription></DialogHeader>
        <div className="grid gap-4"><Field label="Reason"><Select value={returnReasonCode} onValueChange={setReturnReasonCode}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{dropshipReturnReasonOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></Field><Field label="Optional note"><Textarea value={returnReasonNote} maxLength={1000} onChange={(event) => setReturnReasonNote(event.target.value)} placeholder="Add details for the purchasing team" /></Field></div>
        <DialogFooter><Button variant="outline" disabled={saving} onClick={() => setReturnToDropshipsOpen(false)}>Cancel</Button><Button disabled={saving || !returnReasonCode} onClick={() => void returnToDropships()}>{saving ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />} Return to Dropships</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={cancelPoOpen} onOpenChange={(open) => { if (!saving) setCancelPoOpen(open) }}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl flex-col overflow-hidden">
        <DialogHeader><DialogTitle>Cancel purchase order lines</DialogTitle><DialogDescription>Select only the items the supplier cannot fulfill. Every selected line requires its own reason. Canceled lines remain on the PO for audit; remaining lines stay in the draft.</DialogDescription></DialogHeader>
        <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 p-3"><label className="flex items-center gap-2 text-sm font-medium"><Checkbox checked={allCancelableLinesSelected} onCheckedChange={(checked) => setCancelLineDrafts((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, cancelableLineEntries.some((entry) => entry.key === key) ? { ...value, selected: checked === true } : value])))} /> Select all open lines</label><Badge variant={selectedCancelLineEntries.length ? "destructive" : "outline"}>{numberLabel(selectedCancelLineEntries.length)} selected</Badge></div>
        <ScrollArea className="min-h-0 flex-1 pr-3"><div className="grid gap-3 py-1">{cancelableLineEntries.map(({ line, index, key }) => { const draft = cancelLineDrafts[key] || { selected: false, reasonCode: "", reasonNote: "" }; const sku = String(line.sku || `Line ${index + 1}`); return <div key={key} className={cn("grid gap-3 rounded-md border p-3 transition-colors", draft.selected && "border-destructive/50 bg-destructive/5")}><div className="flex items-start gap-3"><Checkbox className="mt-1" aria-label={`Cancel ${sku}`} checked={draft.selected} onCheckedChange={(checked) => setCancelLineDrafts((current) => ({ ...current, [key]: { ...draft, selected: checked === true } }))} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{sku}</p><Badge variant="outline">{numberLabel(purchaseOrderLineRemaining(line))} open</Badge></div><p className="line-clamp-2 text-sm text-muted-foreground" title={String(line.title || "")}>{String(line.title || "Untitled item")}</p>{line.orderNumber || line.orderId ? <p className="mt-1 text-xs text-muted-foreground">Order {String(line.orderNumber || line.orderId)}</p> : null}</div></div>{draft.selected ? <div className="grid gap-3 sm:grid-cols-2"><Field label="Cancellation reason"><Select value={draft.reasonCode} onValueChange={(reasonCode) => setCancelLineDrafts((current) => ({ ...current, [key]: { ...draft, reasonCode } }))}><SelectTrigger><SelectValue placeholder="Choose a reason" /></SelectTrigger><SelectContent>{purchaseOrderCancelReasonOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></Field><Field label="Optional line note"><Input value={draft.reasonNote} maxLength={500} onChange={(event) => setCancelLineDrafts((current) => ({ ...current, [key]: { ...draft, reasonNote: event.target.value } }))} placeholder="Supplier response or buyer context" /></Field></div> : null}</div> })}{!cancelableLineEntries.length ? <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">This PO has no unreceived open lines available to cancel.</div> : null}</div></ScrollArea>
        <DialogFooter><Button variant="outline" disabled={saving} onClick={() => setCancelPoOpen(false)}>Keep PO</Button><Button variant="destructive" disabled={saving || !cancelSelectionReady} onClick={() => void cancelPurchaseOrder()}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />} {allCancelableLinesSelected ? "Cancel entire PO" : `Cancel ${selectedCancelLineEntries.length || "selected"} line${selectedCancelLineEntries.length === 1 ? "" : "s"}`}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={splitDropshipOpen} onOpenChange={(open) => { if (!saving) setSplitDropshipOpen(open) }}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-lg">
        <DialogHeader><DialogTitle>Split all lines into dropship POs?</DialogTitle><DialogDescription>{numberLabel(lines.length)} line{lines.length === 1 ? "" : "s"} will move out of {String(po.poNumber || "this draft")}. Lines from orders with the exact same recipient and delivery address will stay together on one dropship PO. Nothing is sent to the supplier automatically.</DialogDescription></DialogHeader>
        <div className="grid gap-4"><Field label="Reason"><Select value={splitReasonCode} onValueChange={setSplitReasonCode}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{dropshipReasonOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></Field><Field label="Optional note"><Textarea value={splitReasonNote} maxLength={1000} onChange={(event) => setSplitReasonNote(event.target.value)} placeholder="Add context only when needed" /></Field></div>
        <DialogFooter><Button variant="outline" disabled={saving} onClick={() => setSplitDropshipOpen(false)}>Cancel</Button><Button disabled={saving || !canSplitToDropship} onClick={() => void splitAllLinesToDropship()}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />} Split into dropship POs</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <AlertDialog open={Boolean(dropshipLine)} onOpenChange={(open) => { if (!open && !saving) { setDropshipLine(null); setDropshipReasonCode("other_operational"); setDropshipReasonNote("") } }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Move this line to its own dropship PO?</AlertDialogTitle><AlertDialogDescription>{dropshipLine ? `${String(dropshipLine.line.sku || "This line")} will be removed from ${String(po.poNumber || "this draft")} and placed on a new PO for customer order ${String(dropshipLine.line.orderNumber || dropshipLine.line.orderId || "the linked order")}.` : ""} Nothing is sent to the supplier automatically.</AlertDialogDescription></AlertDialogHeader>
        <div className="grid gap-4"><Field label="Reason"><Select value={dropshipReasonCode} onValueChange={setDropshipReasonCode}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{dropshipReasonOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></Field><Field label="Optional note"><Textarea value={dropshipReasonNote} maxLength={1000} onChange={(event) => setDropshipReasonNote(event.target.value)} placeholder="Add context only when needed" /></Field></div>
        <AlertDialogFooter><AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel><AlertDialogAction disabled={saving} onClick={(event) => { event.preventDefault(); void moveLineToDropship() }}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />} Create dropship PO</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <Dialog open={reSourceOpen} onOpenChange={setReSourceOpen}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader><DialogTitle>Replace supplier for open quantities</DialogTitle><DialogDescription>Compare eligible supplier offers and move only the selected unreceived quantities. Received inventory and its original PO history stay unchanged.</DialogDescription></DialogHeader>
        {reSourcePreview ? <div className="grid gap-5">
          <section className="grid gap-3"><div><p className="text-sm font-medium">Choose the replacement supplier</p><p className="text-xs text-muted-foreground">DataPlus shows active suppliers carrying at least one open line. Complete coverage can replace the full remaining PO.</p></div><div className="grid gap-2 md:grid-cols-2">{reSourcePreview.suppliers.map((supplier) => <button key={supplier.vendorId} type="button" className={`rounded-md border p-3 text-left transition-colors ${reSourceDraft.vendorId === supplier.vendorId ? "border-primary bg-primary/10 ring-1 ring-primary" : "bg-muted/20 hover:bg-muted/50"}`} onClick={() => selectReSourceVendor(supplier.vendorId)}><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{supplier.supplier}</p><p className="mt-1 text-xs text-muted-foreground">{supplier.coverageCount} of {supplier.totalLineCount} lines covered</p></div><Badge variant={supplier.completeCoverage ? "success" : "secondary"}>{supplier.completeCoverage ? "Full coverage" : "Partial"}</Badge></div><div className="mt-3 flex items-center justify-between text-sm"><span>{moneyLabel(supplier.estimatedCost)}</span><span className={supplier.savings > 0 ? "font-medium text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>{supplier.savings > 0 ? `${moneyLabel(supplier.savings)} lower` : supplier.savings < 0 ? `${moneyLabel(Math.abs(supplier.savings))} higher` : "Same cost"}</span></div></button>)}</div></section>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Detail label="Current open cost" value={moneyLabel(reSourceCurrentCost)} /><Detail label="Replacement cost" value={moneyLabel(reSourceReplacementCost)} /><Detail label="Estimated savings" value={moneyLabel(reSourceCurrentCost - reSourceReplacementCost)} /><Detail label="Selected units" value={numberLabel(reSourceSelectedLines.reduce((sum, line) => sum + line.openQty, 0))} /></div>
          <section className="grid gap-2"><div><p className="text-sm font-medium">Open PO lines</p><p className="text-xs text-muted-foreground">Clear a line to keep it on {reSourcePreview.poNumber}. A disabled line is not supplied by the selected vendor.</p></div><div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead className="w-10" /><TableHead>SKU / item</TableHead><TableHead>Customer order</TableHead><TableHead className="text-right">Ordered</TableHead><TableHead className="text-right">Received</TableHead><TableHead className="text-right">Move</TableHead><TableHead className="text-right">Current cost</TableHead><TableHead className="text-right">New cost</TableHead></TableRow></TableHeader><TableBody>{reSourcePreview.lines.map((line) => { const offer = line.alternatives.find((candidate) => candidate.vendorId === reSourceDraft.vendorId); const checked = reSourceDraft.lineKeys.includes(line.lineKey); return <TableRow key={line.lineKey}><TableCell><Checkbox aria-label={`Move ${line.sku}`} checked={checked} disabled={!offer} onCheckedChange={(next) => setReSourceDraft((current) => ({ ...current, lineKeys: next === true ? [...new Set([...current.lineKeys, line.lineKey])] : current.lineKeys.filter((key) => key !== line.lineKey) }))} /></TableCell><TableCell><a className="font-medium text-primary hover:underline" href={`/products/${encodeURIComponent(line.sku)}`}>{line.sku}</a><p className="max-w-72 truncate text-xs text-muted-foreground" title={line.title}>{line.title}</p></TableCell><TableCell>{line.orderId ? <a className="font-medium hover:underline" href={`/orders/${encodeURIComponent(line.orderId)}`}>{line.orderNumber || line.orderId}</a> : "-"}</TableCell><TableCell className="text-right tabular-nums">{numberLabel(line.orderedQty)}</TableCell><TableCell className="text-right tabular-nums">{numberLabel(line.receivedQty)}</TableCell><TableCell className="text-right font-medium tabular-nums">{numberLabel(line.openQty)}</TableCell><TableCell className="text-right tabular-nums">{moneyLabel(line.currentUnitCost)}</TableCell><TableCell className="text-right tabular-nums">{offer ? moneyLabel(offer.unitCost) : <span className="text-muted-foreground">Unavailable</span>}</TableCell></TableRow> })}</TableBody></Table></div></section>
          <div className="grid gap-4 md:grid-cols-2"><Field label="Reason for supplier change"><Select value={reSourceDraft.reason} onValueChange={(reason) => setReSourceDraft((current) => ({ ...current, reason }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="lower_cost">Lower cost</SelectItem><SelectItem value="availability">Better availability</SelectItem><SelectItem value="supplier_issue">Supplier issue</SelectItem><SelectItem value="buyer_choice">Buyer decision</SelectItem></SelectContent></Select></Field><Field label="Buyer note"><Textarea value={reSourceDraft.note} onChange={(event) => setReSourceDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Why this supplier is being changed" /></Field></div>
          {reSourcePreview.requiresSupplierCancellation ? <Alert variant="destructive"><AlertTriangle className="size-4" /><AlertTitle>The original PO was already committed</AlertTitle><AlertDescription className="grid gap-3"><p>Cancel or adjust {reSourcePreview.poNumber} with {reSourcePreview.currentSupplier} before creating the replacement. DataPlus retains the original PO for received quantities and audit history.</p><label className="flex items-start gap-2 rounded-md border border-destructive/30 bg-background/70 p-3 text-foreground"><Checkbox checked={reSourceDraft.supplierCancellationConfirmed} onCheckedChange={(checked) => setReSourceDraft((current) => ({ ...current, supplierCancellationConfirmed: checked === true }))} /><span className="text-sm font-medium">I confirm the supplier-side PO was canceled or adjusted.</span></label></AlertDescription></Alert> : null}
        </div> : <div className="flex min-h-56 items-center justify-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>}
        <DialogFooter><Button variant="outline" onClick={() => setReSourceOpen(false)}>Cancel</Button><Button disabled={saving || !reSourceDraft.vendorId || !reSourceDraft.lineKeys.length || Boolean(reSourcePreview?.requiresSupplierCancellation && !reSourceDraft.supplierCancellationConfirmed)} onClick={() => void applyReSource()}>{saving ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />} Create replacement PO</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={acknowledgementOpen} onOpenChange={setAcknowledgementOpen}><DialogContent><DialogHeader><DialogTitle>{acknowledgementMode === "reference" ? (supplierOrderNumber ? "Update supplier order number" : "Add supplier order number") : acknowledgementMode === "ctech" ? (ctechId ? "Update CTech PO number" : "Add CTech PO number") : "Record supplier acknowledgement"}</DialogTitle><DialogDescription>{acknowledgementMode === "reference" ? "Save the vendor's order or confirmation number without changing this PO's current status. You can update it whenever the supplier provides the final reference." : acknowledgementMode === "ctech" ? "Save the PO number from CTech on this purchase order. This does not change the supplier's confirmation number or the PO status." : "Keep the supplier's confirmation number, commitment, expected arrival, and message on this purchase order."}</DialogDescription></DialogHeader><div className="grid gap-4">{acknowledgementMode === "ctech" ? <Field label="CTech PO #"><Input autoFocus value={acknowledgement.ctechId} onChange={(event) => setAcknowledgement((current) => ({ ...current, ctechId: event.target.value }))} placeholder="CTech PO number" /></Field> : <Field label="Supplier order / reference #"><Input autoFocus value={acknowledgement.supplierOrderNumber} onChange={(event) => setAcknowledgement((current) => ({ ...current, supplierOrderNumber: event.target.value }))} placeholder="Vendor order or confirmation number" /></Field>}{acknowledgementMode === "acknowledge" ? <><Field label="Expected arrival"><Input type="date" value={acknowledgement.expectedAt} onChange={(event) => setAcknowledgement((current) => ({ ...current, expectedAt: event.target.value }))} /></Field><Field label="Supplier note"><Textarea value={acknowledgement.note} onChange={(event) => setAcknowledgement((current) => ({ ...current, note: event.target.value }))} placeholder="Availability, shipping commitment, or supplier message" /></Field></> : null}</div><DialogFooter><Button variant="outline" onClick={() => setAcknowledgementOpen(false)}>Cancel</Button><Button disabled={saving || (acknowledgementMode === "reference" && !acknowledgement.supplierOrderNumber.trim()) || (acknowledgementMode === "ctech" && !acknowledgement.ctechId.trim())} onClick={() => void saveAcknowledgement()}>{saving ? <Loader2 className="size-4 animate-spin" /> : null}{acknowledgementMode === "reference" ? "Save supplier order #" : acknowledgementMode === "ctech" ? "Save CTech PO #" : "Save acknowledgement"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(costLine)} onOpenChange={(open) => { if (!open && !saving) setCostLine(null) }}><DialogContent><DialogHeader><DialogTitle>Update item cost</DialogTitle><DialogDescription>Choose whether this is a one-time correction for this PO and customer order, or the verified cost that should also become the catalog cost going forward. Closed orders are never changed.</DialogDescription></DialogHeader><div className="grid gap-4"><div className="grid gap-3 sm:grid-cols-2"><Detail label="SKU" value={String(costLine?.line.sku || "-")} /><Detail label="Customer paid" value={moneyLabel(Number(costLine?.line.customerPaid || 0))} /></div><Field label="Unit cost"><Input autoFocus type="number" min="0" step="0.01" value={costDraft} onChange={(event) => setCostDraft(event.target.value)} /></Field><Field label="Apply cost to"><Select value={costScope} onValueChange={(value) => setCostScope(value as "po_order_only" | "catalog_forward")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="po_order_only">This PO and Order# only</SelectItem><SelectItem value="catalog_forward">This PO/order and catalog SKU going forward</SelectItem></SelectContent></Select></Field><p className="text-xs text-muted-foreground">{costScope === "catalog_forward" ? "Future pricing will use the new catalog cost. Historical closed orders remain unchanged." : "The catalog SKU and future orders keep their current cost."} The customer-paid amount is never changed.</p></div><DialogFooter><Button variant="outline" disabled={saving} onClick={() => setCostLine(null)}>Cancel</Button><Button disabled={saving || costDraft.trim() === "" || !Number.isFinite(Number(costDraft)) || Number(costDraft) < 0} onClick={() => void saveLineCost()}>{saving ? <Loader2 className="size-4 animate-spin" /> : null} Save cost</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={dropshipTrackingOpen} onOpenChange={setDropshipTrackingOpen}><DialogContent><DialogHeader><DialogTitle>{po.trackingNumber ? "Edit dropship tracking" : "Add dropship tracking"}</DialogTitle><DialogDescription>Save the supplier's shipment on this PO and every linked customer order without reducing physical warehouse inventory. DataPlus then sends the same tracking to the enabled sales channel.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><Field label="Carrier"><Select value={dropshipTracking.carrier} onValueChange={(carrier) => setDropshipTracking((current) => ({ ...current, carrier, carrierName: carrier === "Other" ? "" : carrier, service: "", trackingUrl: "", carrierPhone: "" }))}><SelectTrigger><SelectValue placeholder="Carrier auto-detects" /></SelectTrigger><SelectContent>{purchaseOrderTrackingCarriers.map((carrier) => <SelectItem key={carrier} value={carrier}>{carrier}</SelectItem>)}</SelectContent></Select></Field>{dropshipTracking.carrier === "Other" && <Field label="Carrier name"><Input value={dropshipTracking.carrierName} onChange={(event) => setDropshipTracking((current) => ({ ...current, carrierName: event.target.value }))} placeholder="Enter the carrier name" /></Field>}{dropshipTracking.carrier !== "Other" && <Field label="Service"><Select value={dropshipTracking.service} onValueChange={(service) => setDropshipTracking((current) => ({ ...current, service }))}><SelectTrigger><SelectValue placeholder="Choose service" /></SelectTrigger><SelectContent>{dropshipServiceOptions.map((service) => <SelectItem key={service} value={service}>{service}</SelectItem>)}</SelectContent></Select></Field>}{dropshipTracking.carrier === "Other" && <Field label="Service"><Input value={dropshipTracking.service} onChange={(event) => setDropshipTracking((current) => ({ ...current, service: event.target.value }))} placeholder="Carrier service" /></Field>}<Field label="Tracking number"><Input autoFocus value={dropshipTracking.trackingNumber} onChange={(event) => setDropshipTracking((current) => { const next = detectedTrackingUpdate(current, event.target.value, fulfillmentCarriers); return next.carrier === current.carrier ? next : { ...next, carrierName: next.carrier, trackingUrl: "", carrierPhone: "" } })} />{detectTrackingCarrier(dropshipTracking.trackingNumber) ? <p className="mt-1 text-xs text-emerald-600">Detected {detectTrackingCarrier(dropshipTracking.trackingNumber)}</p> : null}</Field>{dropshipTracking.carrier === "Other" && <Field label="Tracking URL"><Input value={dropshipTracking.trackingUrl} onChange={(event) => setDropshipTracking((current) => ({ ...current, trackingUrl: event.target.value }))} placeholder="https://carrier.example/track/..." /></Field>}{dropshipTracking.carrier === "Other" && <Field label="Carrier phone number"><Input type="tel" value={dropshipTracking.carrierPhone} onChange={(event) => setDropshipTracking((current) => ({ ...current, carrierPhone: event.target.value }))} placeholder="Optional support phone" /></Field>}{dropshipTracking.carrier !== "Other" && dropshipTracking.trackingNumber && <div className="grid content-center gap-1 rounded-md border bg-muted/20 px-3 py-2 text-sm"><span className="text-xs font-medium text-muted-foreground">Tracking link</span><a className="break-all text-primary hover:underline" href={trackingUrlForShipment({}, dropshipTracking.carrier, dropshipTracking.trackingNumber)} target="_blank" rel="noreferrer">{trackingUrlForShipment({}, dropshipTracking.carrier, dropshipTracking.trackingNumber)}</a></div>}<Field label="Supplier ship date"><Input type="date" value={dropshipTracking.shipDate} onChange={(event) => setDropshipTracking((current) => ({ ...current, shipDate: event.target.value }))} /></Field></div><DialogFooter><Button variant="outline" onClick={() => setDropshipTrackingOpen(false)}>Cancel</Button><Button disabled={saving || !dropshipTracking.carrier || !dropshipTracking.service || !dropshipTracking.trackingNumber.trim() || (dropshipTracking.carrier === "Other" && (!dropshipTracking.carrierName.trim() || !dropshipTracking.trackingUrl.trim()))} onClick={() => void saveDropshipTracking()}>{saving ? <Loader2 className="size-4 animate-spin" /> : null} Save to PO and order</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={inboundTrackingOpen} onOpenChange={setInboundTrackingOpen}><DialogContent><DialogHeader><DialogTitle>{po.trackingNumber ? "Edit inbound tracking" : "Add inbound tracking"}</DialogTitle><DialogDescription>Record the supplier shipment to the receiving warehouse. This moves the PO into Receiving without fulfilling a customer order or changing inventory until a warehouse receipt is completed.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><Field label="Carrier"><Select value={inboundTracking.carrier} onValueChange={(carrier) => setInboundTracking((current) => ({ ...current, carrier, service: "" }))}><SelectTrigger><SelectValue placeholder="Carrier auto-detects" /></SelectTrigger><SelectContent>{purchaseOrderTrackingCarriers.filter((carrier) => carrier !== "Other").map((carrier) => <SelectItem key={carrier} value={carrier}>{carrier}</SelectItem>)}</SelectContent></Select></Field><Field label="Service"><Select value={inboundTracking.service} onValueChange={(service) => setInboundTracking((current) => ({ ...current, service }))}><SelectTrigger><SelectValue placeholder="Choose service" /></SelectTrigger><SelectContent>{inboundServiceOptions.map((service) => <SelectItem key={service} value={service}>{service}</SelectItem>)}</SelectContent></Select></Field><Field label="Tracking number"><Input autoFocus value={inboundTracking.trackingNumber} onChange={(event) => setInboundTracking((current) => detectedTrackingUpdate(current, event.target.value, fulfillmentCarriers))} />{detectTrackingCarrier(inboundTracking.trackingNumber) ? <p className="mt-1 text-xs text-emerald-600">Detected {detectTrackingCarrier(inboundTracking.trackingNumber)}</p> : null}</Field><Field label="Supplier ship date"><Input type="date" value={inboundTracking.shipDate} onChange={(event) => setInboundTracking((current) => ({ ...current, shipDate: event.target.value }))} /></Field><Field label="Expected arrival"><Input type="date" value={inboundTracking.expectedAt} onChange={(event) => setInboundTracking((current) => ({ ...current, expectedAt: event.target.value }))} /></Field></div><DialogFooter><Button variant="outline" onClick={() => setInboundTrackingOpen(false)}>Cancel</Button><Button disabled={saving || !inboundTracking.carrier || !inboundTracking.service || !inboundTracking.trackingNumber.trim()} onClick={() => void saveInboundTracking()}>{saving ? <Loader2 className="size-4 animate-spin" /> : null} Save inbound tracking</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={reminderOpen} onOpenChange={setReminderOpen}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Supplier overdue reminder</DialogTitle><DialogDescription>{Boolean(reminderPreview.overdue) ? "This PO is past its expected arrival date." : "You can send this reminder manually before the PO becomes overdue."}</DialogDescription></DialogHeader><div className="grid gap-3"><Field label="To"><Input readOnly value={String(reminderPreview.recipient || "No supplier email address")} /></Field><Field label="Subject"><Input readOnly value={String(reminderPreview.subject || "")} /></Field><Field label="Message"><Textarea readOnly className="min-h-40" value={String(reminderPreview.text || "")} /></Field>{Array.isArray(reminderPreview.missing) && reminderPreview.missing.length > 0 && <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{(reminderPreview.missing as string[]).join(" ")}</div>}</div><DialogFooter><Button variant="outline" onClick={() => setReminderOpen(false)}>Close</Button><Button disabled={saving || reminderPreview.ready !== true} onClick={() => void sendReminder()}>{saving ? <Loader2 className="size-4 animate-spin" /> : "Send reminder"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={documentOpen} onOpenChange={setDocumentOpen}><DialogContent><DialogHeader><DialogTitle>Link PO document</DialogTitle><DialogDescription>Add a supplier quote, acknowledgement, invoice, or other document URL to this purchase order.</DialogDescription></DialogHeader><div className="grid gap-4"><Field label="Document name"><Input value={documentDraft.name} onChange={(event) => setDocumentDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Supplier acknowledgement" /></Field><Field label="Document URL"><Input value={documentDraft.url} onChange={(event) => setDocumentDraft((current) => ({ ...current, url: event.target.value }))} placeholder="https://..." /></Field><Field label="Document type"><Input value={documentDraft.type} onChange={(event) => setDocumentDraft((current) => ({ ...current, type: event.target.value }))} /></Field><Field label="Note"><Textarea value={documentDraft.note} onChange={(event) => setDocumentDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Optional internal note" /></Field></div><DialogFooter><Button variant="outline" onClick={() => setDocumentOpen(false)}>Cancel</Button><Button disabled={saving || !documentDraft.name || !documentDraft.url} onClick={() => void saveDocument()}>Link document</Button></DialogFooter></DialogContent></Dialog>
    {receivingDialog}
    <Dialog open={editingOpen} onOpenChange={setEditingOpen}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-4xl overflow-y-auto">
        <DialogHeader><DialogTitle>Edit {String(po.poNumber || "purchase order")}</DialogTitle><DialogDescription>{poCommitted ? "Changes to a sent PO are saved as an amendment and require supplier confirmation. Received quantities cannot be reduced." : isDropship ? "Update the supplier, expected date, buyer notes, and ordered quantities. Dropship POs ship directly to the customer and do not use a receiving warehouse." : "Update the supplier, receiving destination, expected date, buyer notes, and unreceived quantities before submitting the PO."}</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Supplier"><Select value={String(editDraft.vendorId || "")} onValueChange={(value) => setEditDraft((current) => ({ ...current, vendorId: value }))}><SelectTrigger><SelectValue placeholder="Choose supplier" /></SelectTrigger><SelectContent>{(referenceData.vendors || []).map((vendor) => <SelectItem key={String(vendor.id)} value={String(vendor.id)}>{String(vendor.name || vendor.id)}</SelectItem>)}</SelectContent></Select></Field>{!isDropship ? <Field label="Receiving warehouse"><Select value={String(editDraft.warehouseId || "")} onValueChange={(value) => setEditDraft((current) => ({ ...current, warehouseId: value }))}><SelectTrigger><SelectValue placeholder="Choose warehouse" /></SelectTrigger><SelectContent>{(referenceData.warehouses || []).map((warehouse) => <SelectItem key={String(warehouse.id)} value={String(warehouse.id)}>{String(warehouse.name || warehouse.id)}</SelectItem>)}</SelectContent></Select></Field> : <div className="rounded-md border bg-muted/30 p-3 text-sm"><p className="font-medium">Direct to customer</p><p className="mt-1 text-xs text-muted-foreground">No receiving warehouse is used for this dropship PO.</p></div>}<Field label="Expected date"><Input type="date" value={String(editDraft.expectedAt || "")} onChange={(event) => setEditDraft((current) => ({ ...current, expectedAt: event.target.value }))} /></Field></div>
        {editableManualDraftLines ? <div className="grid gap-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-medium">Draft line items</p><p className="text-xs text-muted-foreground">Incomplete lines can be saved now and finished before approval.</p></div><Button size="sm" variant="outline" onClick={() => setEditDraft((current) => ({ ...current, items: [...(Array.isArray(current.items) ? current.items as Array<Record<string, unknown>> : []), { id: crypto.randomUUID(), sku: "", title: "", qty: 1, estimatedUnitCost: 0, source: "manual_line" }] }))}><Plus className="size-4" /> Add line</Button></div><div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead className="min-w-36">SKU</TableHead><TableHead className="min-w-56">Item</TableHead><TableHead className="w-28">Quantity</TableHead><TableHead className="w-36">Unit cost</TableHead><TableHead className="w-12" /></TableRow></TableHeader><TableBody>{(Array.isArray(editDraft.items) ? editDraft.items as Array<Record<string, unknown>> : []).map((item, index) => <TableRow key={String(item.id || `draft-line-${index}`)}><TableCell><Input value={String(item.sku || "")} onChange={(event) => setEditDraft((current) => ({ ...current, items: (Array.isArray(current.items) ? current.items as Array<Record<string, unknown>> : []).map((candidate, lineIndex) => lineIndex === index ? { ...candidate, sku: event.target.value } : candidate) }))} placeholder="SKU" /></TableCell><TableCell><Input value={String(item.title || "")} onChange={(event) => setEditDraft((current) => ({ ...current, items: (Array.isArray(current.items) ? current.items as Array<Record<string, unknown>> : []).map((candidate, lineIndex) => lineIndex === index ? { ...candidate, title: event.target.value } : candidate) }))} placeholder="Product title" /></TableCell><TableCell><Input type="number" min="0" step="1" value={String(item.qty ?? "")} onChange={(event) => setEditDraft((current) => ({ ...current, items: (Array.isArray(current.items) ? current.items as Array<Record<string, unknown>> : []).map((candidate, lineIndex) => lineIndex === index ? { ...candidate, qty: Number(event.target.value || 0) } : candidate) }))} /></TableCell><TableCell><Input type="number" min="0" step="0.01" value={String(item.estimatedUnitCost ?? "")} onChange={(event) => setEditDraft((current) => ({ ...current, items: (Array.isArray(current.items) ? current.items as Array<Record<string, unknown>> : []).map((candidate, lineIndex) => lineIndex === index ? { ...candidate, estimatedUnitCost: Number(event.target.value || 0) } : candidate) }))} /></TableCell><TableCell><Button size="icon" variant="ghost" title="Remove line" onClick={() => setEditDraft((current) => ({ ...current, items: (Array.isArray(current.items) ? current.items as Array<Record<string, unknown>> : []).filter((_, lineIndex) => lineIndex !== index) }))}><Trash2 className="size-4" /></Button></TableCell></TableRow>)}{!(Array.isArray(editDraft.items) && editDraft.items.length) ? <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No items yet. Save the draft now or add a line.</TableCell></TableRow> : null}</TableBody></Table></div></div> : <div className="overflow-hidden rounded-md border"><Table className="table-fixed"><TableHeader><TableRow><TableHead className="w-36">SKU</TableHead><TableHead>Item</TableHead><TableHead className="w-32">Ordered quantity</TableHead></TableRow></TableHeader><TableBody>{lines.map((line, index) => { const sku = String(line.sku || ""); const items = Array.isArray(editDraft.items) ? editDraft.items as Array<Record<string, unknown>> : []; const item = items.find((candidate) => String(candidate.sku) === sku) || { sku, qty: Number(line.qty || 0) }; const title = String(line.title || "-"); return <TableRow key={`edit-${index}`}><TableCell className="break-all font-mono text-xs">{sku}</TableCell><TableCell><p className="line-clamp-2 break-words" title={title}>{compactPurchaseItemTitle(title)}</p></TableCell><TableCell><Input type="number" min={Number(line.receivedQty || 0)} value={String(item.qty || 0)} onChange={(event) => setEditDraft((current) => ({ ...current, items: (Array.isArray(current.items) ? current.items as Array<Record<string, unknown>> : []).map((candidate) => String(candidate.sku) === sku ? { ...candidate, qty: Number(event.target.value || 0) } : candidate) }))} /></TableCell></TableRow> })}</TableBody></Table></div>}
        <div className="grid gap-2"><Label htmlFor="po-notes">Buyer notes</Label><Textarea id="po-notes" value={String(editDraft.notes || "")} onChange={(event) => setEditDraft((current) => ({ ...current, notes: event.target.value }))} /></div>
        {poCommitted ? <div className="grid gap-2"><Label htmlFor="po-amendment-reason">Reason for supplier amendment</Label><Textarea id="po-amendment-reason" value={String(editDraft.amendmentReason || "")} onChange={(event) => setEditDraft((current) => ({ ...current, amendmentReason: event.target.value }))} placeholder="Explain what changed and why the supplier must confirm it" /></div> : null}
        <DialogFooter><Button variant="outline" onClick={() => setEditingOpen(false)}>Cancel</Button><Button disabled={saving} onClick={() => void saveEdit()}>{saving ? <Loader2 className="size-4 animate-spin" /> : "Save PO"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={financialOpen} onOpenChange={setFinancialOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>{financialDraft.action === "bill" ? "Record vendor bill" : financialDraft.action === "payment" ? "Record vendor payment" : "Record vendor credit"}</DialogTitle><DialogDescription>{financialDraft.action === "bill" ? "Capture the supplier invoice and its due date to create the payable record." : financialDraft.action === "payment" ? "Apply a payment to a recorded vendor bill. This preserves the Accounts Payable audit trail." : "Apply a supplier credit or refund to a recorded vendor bill."}</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          {financialDraft.action === "bill" ? (
            <>
              <Field label="Vendor invoice number"><Input value={financialDraft.billNumber || ""} onChange={(event) => setFinancialDraft((current) => ({ ...current, billNumber: event.target.value }))} placeholder="INV-10024" /></Field>
              <div className="grid gap-3 sm:grid-cols-2"><Field label="Bill date"><Input type="date" value={financialDraft.billDate || ""} onChange={(event) => setFinancialDraft((current) => ({ ...current, billDate: event.target.value }))} /></Field><Field label="Due date"><Input type="date" value={financialDraft.dueDate || ""} onChange={(event) => setFinancialDraft((current) => ({ ...current, dueDate: event.target.value }))} /></Field></div>
              <div className="grid gap-3 sm:grid-cols-2"><Field label="Bill total"><Input type="number" min="0" step="0.01" value={financialDraft.total || ""} onChange={(event) => setFinancialDraft((current) => ({ ...current, total: event.target.value }))} /></Field><Field label="Posting account"><Input value={financialDraft.account || ""} onChange={(event) => setFinancialDraft((current) => ({ ...current, account: event.target.value }))} /></Field></div>
            </>
          ) : (
            <>
              <Field label="Vendor bill"><Select value={financialDraft.billId || ""} onValueChange={(value) => setFinancialDraft((current) => ({ ...current, billId: value }))}><SelectTrigger><SelectValue placeholder="Choose vendor bill" /></SelectTrigger><SelectContent>{bills.filter((bill) => String(bill.status || "open") !== "paid").map((bill) => <SelectItem key={String(bill.id)} value={String(bill.id)}>{String(bill.billNumber || "Vendor bill")} · {moneyLabel(Number(bill.total || 0))}</SelectItem>)}</SelectContent></Select></Field>
              <div className="grid gap-3 sm:grid-cols-2"><Field label={financialDraft.action === "payment" ? "Payment date" : "Credit date"}><Input type="date" value={financialDraft.action === "payment" ? financialDraft.paymentDate || "" : financialDraft.creditDate || ""} onChange={(event) => setFinancialDraft((current) => financialDraft.action === "payment" ? { ...current, paymentDate: event.target.value } : { ...current, creditDate: event.target.value })} /></Field><Field label="Amount"><Input type="number" min="0" step="0.01" value={financialDraft.amount || ""} onChange={(event) => setFinancialDraft((current) => ({ ...current, amount: event.target.value }))} /></Field></div>
              {financialDraft.action === "payment" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Payment method"><Input value={financialDraft.method || "EFT"} onChange={(event) => setFinancialDraft((current) => ({ ...current, method: event.target.value }))} placeholder="EFT, ACH, check, credit card" /></Field>
                  <Field label="Payment account"><Input value={financialDraft.paymentAccount || ""} onChange={(event) => setFinancialDraft((current) => ({ ...current, paymentAccount: event.target.value }))} placeholder="Operating checking" /></Field>
                </div>
              ) : (
                <>
                  <Field label="Credit number"><Input value={financialDraft.creditNumber || ""} onChange={(event) => setFinancialDraft((current) => ({ ...current, creditNumber: event.target.value }))} placeholder="VC-10024" /></Field>
                  <Field label="Reason"><Textarea value={financialDraft.reason || ""} onChange={(event) => setFinancialDraft((current) => ({ ...current, reason: event.target.value }))} placeholder="Return, price correction, or vendor concession" /></Field>
                </>
              )}
              <Field label="Reference / confirmation"><Input value={financialDraft.reference || ""} onChange={(event) => setFinancialDraft((current) => ({ ...current, reference: event.target.value }))} placeholder="Check, ACH, or external confirmation number" /></Field>
            </>
          )}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setFinancialOpen(false)}>Cancel</Button><Button disabled={saving} onClick={() => void saveFinancial()}>{saving ? <Loader2 className="size-4 animate-spin" /> : "Save financial record"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
}
