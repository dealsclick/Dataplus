import { lazy, useEffect, useRef, useState } from "react"
import {
  AlertCircle, AlertTriangle, Archive, Ban, Boxes, CheckCircle2, ExternalLink, Eye,
  FileDown, History, Link2, Loader2, MoreHorizontal,
  PackageSearch, Play, Power, RefreshCw, RotateCcw, Search, ShieldCheck, ShoppingBag, Store,
  Trash2, Warehouse, X,
} from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { CatalogCreationDateFilter } from "./catalog-creation-date-filter"
import { readWorkspaceCache, writeWorkspaceCache } from "../lib/workspace-cache"
import { api, dateLabel, moneyLabel, numberLabel } from "../lib/client-api"
import { normalizePastedSearch, parseSearchTerms } from "../lib/multi-search"
import { cn } from "@/lib/utils"
import {
  AttributesPage, AttributeGroupsPage, CategoriesWorkspace, CategoryReviewPage, CatalogChannelMarks,
  catalogCategoryLeaf, catalogCellText, CatalogResourcePage, CatalogSupplierCoverage, catalogWorkspaceTabFromPath,
  catalogWorkspaceTabs, channelFilterLabel, ContextActions, Field, ImportReviewPage,
  InventorySourceCell, InventoryWorkspace, launchWalmartExisting, marketplaceChannelKey, MetricCard,
  normalizeUnifiedCatalogFilters, PageHeader, ProductDetailSheet, SkuChangesPage,
  ToggleField, unifiedCatalogSourceFilters, unifiedCatalogUsesManagedRecords, VendorMappingsPage,
} from "../App"
import type {
  CatalogItem, CatalogResponse, CatalogWorkspaceTab, ChannelConnection, EbayListingBlockerReport,
  EbaySyncWarningReport, ImportJob, MarketplaceChannelKey, ProductItem,
} from "../App"

const WalmartChannel = lazy(() => import("./walmart-channel").then((module) => ({ default: module.WalmartChannel })))
const WalmartLaunch = lazy(() => import("./walmart-launch").then((module) => ({ default: module.WalmartLaunch })))
const WalmartUpcMatch = lazy(() => import("./walmart-upc-match").then((module) => ({ default: module.WalmartUpcMatch })))

function AdvancedMainCatalogPage({ channels = [] }: { totalSkuCount?: number; channels?: ChannelConnection[] }) {
  const [walmartSingleLaunchSku, setWalmartSingleLaunchSku] = useState("")
  const [walmartMatchSkus, setWalmartMatchSkus] = useState<string[]>([])
  const [walmartMatchSelection, setWalmartMatchSelection] = useState<{ allFiltered: true; query: string; filters: Record<string, string>; count: number } | undefined>()
  const [walmartMatchOpen, setWalmartMatchOpen] = useState(false)
  const [walmartReadinessMode, setWalmartReadinessMode] = useState(false)
  const catalogRequest = useRef<AbortController | null>(null)
  const readinessCountRequest = useRef<AbortController | null>(null)
  const [channelReadyCounts, setChannelReadyCounts] = useState<Record<string, { count: number; status: "idle" | "loading" | "ready" | "unavailable" }>>({})
  const [countStatus, setCountStatus] = useState<"loading" | "ready" | "unavailable">("loading")
  const retryCatalogCount = useRef<(() => void) | null>(null)
  useEffect(() => () => {
    catalogRequest.current?.abort()
    readinessCountRequest.current?.abort()
  }, [])
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get("q") || "")
  const [filters, setFilters] = useState<Record<string, string>>(() => {
    const params = new URLSearchParams(window.location.search)
    const initial = Object.fromEntries(
      ["catalogStatus", "vendorScope", "supplier", "suppliers", "active", "stockStatus", "hasStock", "hasImage", "stockQty", "stockQtyOperator", "hazardous", "toBeDiscontinued", "brand", "manufacturer", "category", "channelStatus", "creationSource", "verifiedBrand", "createdFrom", "createdTo", "replenishableMode", "replenishableChannel"]
        .map((key) => [key, params.get(key) || ""])
        .filter(([, value]) => Boolean(value)),
    ) as Record<string, string>
    if (window.location.pathname.toLowerCase().startsWith("/source-catalog") || window.location.pathname.toLowerCase() === "/source") initial.catalogStatus = "source-only"
    return normalizeUnifiedCatalogFilters(initial)
  })
  const [savedViews, setSavedViews] = useState<Array<{ name: string; query: string; filters: Record<string, string>; sort: { key: string; direction: "asc" | "desc" } }>>(() => {
    try { return JSON.parse(window.localStorage.getItem("dataplus-products-saved-views") || "[]") } catch { return [] }
  })
  const [facets, setFacets] = useState<{ suppliers?: string[]; brands?: string[]; manufacturers?: string[]; categories?: string[] }>({})
  const [rows, setRows] = useState<ProductItem[]>([])
  const [total, setTotal] = useState(0)
  const [totalQty, setTotalQty] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [searchPending, setSearchPending] = useState(false)
  const searchRequestRef = useRef(0)
  const hasMountedCatalogSearchRef = useRef(false)
  const [selected, setSelected] = useState<CatalogItem | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [allFiltered, setAllFiltered] = useState(false)
  const [ebayLaunchOpen, setEbayLaunchOpen] = useState(false)
  const [ebayLaunchSaving, setEbayLaunchSaving] = useState(false)
  const [ebayLaunchSkus, setEbayLaunchSkus] = useState<string[]>([])
  const [ebayLaunchAllFiltered, setEbayLaunchAllFiltered] = useState(false)
  const [ebayLaunchScope, setEbayLaunchScope] = useState<{ query: string; filters: Record<string, string> }>({ query: "", filters: {} })
  const [ebayLaunchDraft, setEbayLaunchDraft] = useState({ lifecycleAction: "launch", marketplaceId: "EBAY_US", merchantLocationKey: "", paymentPolicyId: "", returnPolicyId: "", fulfillmentPolicyId: "", categoryId: "", storeCategoryId: "", storeCategoryName: "", listingTemplateId: "", itemSpecificTemplateId: "", dispatchTimeDays: "2", condition: "NEW", bestOfferEnabled: false, matchEbayCatalog: true, limit: "500" })
  const [channelStatusOpen, setChannelStatusOpen] = useState(false)
  const [channelStatusSaving, setChannelStatusSaving] = useState(false)
  const [channelStatusChannels, setChannelStatusChannels] = useState<string[]>([])
  const [channelStatusMode, setChannelStatusMode] = useState<"inactive" | "active">("inactive")
  const [channelStatusIds, setChannelStatusIds] = useState<string[]>([])
  const [channelStatusAllFiltered, setChannelStatusAllFiltered] = useState(false)
  const [replenishableOpen, setReplenishableOpen] = useState(false)
  const [replenishableSaving, setReplenishableSaving] = useState(false)
  const [replenishableEnabled, setReplenishableEnabled] = useState(true)
  const [replenishableSource, setReplenishableSource] = useState<"vendor" | "sku" | "channel">("channel")
  const [replenishableQuantity, setReplenishableQuantity] = useState("1")
  const [replenishableChannels, setReplenishableChannels] = useState<string[]>([])
  const [filterOpen, setFilterOpen] = useState(false)
  const [facetsLoading, setFacetsLoading] = useState(false)
  const [filterField, setFilterField] = useState("supplier")
  const [channelFilterScope, setChannelFilterScope] = useState("shopify")
  const [filterSearch, setFilterSearch] = useState("")
  const [filterSelection, setFilterSelection] = useState<string[]>([])
  const [pendingFilters, setPendingFilters] = useState<Record<string, string[]>>({})
  const [quantityMin, setQuantityMin] = useState("")
  const [quantityMax, setQuantityMax] = useState("")
  const [pageSize, setPageSize] = useState(() => Number(window.localStorage.getItem("dataplus-products-page-size") || 25))
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" }>({ key: "", direction: "asc" })
  const [compact, setCompact] = useState(() => window.localStorage.getItem("dataplus-products-density") === "compact")
  const [visible, setVisible] = useState<Record<string, boolean>>(() => {
    const defaults = { readiness: true, catalogStatus: false, suppliers: true, stock: true, price: true, brand: true, category: true, channels: true, images: true, updated: true, created: false, verified: false, hazardous: false, shopifySynced: false, manufacturer: false, vendorSku: false, status: false, shadows: false, uom: false, shipping: true }
    try { return { ...defaults, ...JSON.parse(window.localStorage.getItem("dataplus-products-columns") || "{}") } } catch { return defaults }
  })
  const ebayChannel = channels.find((channel) => String(channel.name || "").toLowerCase() === "ebay")
  const ebaySettings = ebayChannel?.settings || {}
  const ebayMerchantLocations = Array.isArray(ebaySettings.ebayMerchantLocations) ? ebaySettings.ebayMerchantLocations : []
  const ebayPaymentPolicies = Array.isArray(ebaySettings.ebayPaymentPolicies) ? ebaySettings.ebayPaymentPolicies : []
  const ebayReturnPolicies = Array.isArray(ebaySettings.ebayReturnPolicies) ? ebaySettings.ebayReturnPolicies : []
  const ebayFulfillmentPolicies = Array.isArray(ebaySettings.ebayFulfillmentPolicies) ? ebaySettings.ebayFulfillmentPolicies : []
  const ebayStoreCategories = Array.isArray(ebaySettings.ebayStoreCategories) ? ebaySettings.ebayStoreCategories : []
  const ebayListingTemplates = Array.isArray(ebaySettings.ebayListingTemplates) ? ebaySettings.ebayListingTemplates : []
  const ebayItemSpecificTemplates = Array.isArray(ebaySettings.ebayItemSpecificTemplates) ? ebaySettings.ebayItemSpecificTemplates : []
  const ebayLifecycleLabel: Record<string, string> = { launch: "Publish eligible listings", review: "Run eBay launch preflight", compliance: "Run compliance audit", revise: "Queue listing revisions", relist: "Relist eligible listings", end: "End active listings" }
  const columns = [
    ["readiness", "Readiness"], ["catalogStatus", "Catalog status"], ["suppliers", "Suppliers"], ["stock", "Stock"], ["price", "Price"], ["brand", "Brand"], ["category", "Category"], ["channels", "Channels"], ["images", "Images"], ["updated", "Updated"], ["created", "Created"], ["verified", "Category verified"], ["hazardous", "Hazardous"], ["shopifySynced", "Shopify synced"], ["manufacturer", "Manufacturer"], ["vendorSku", "Vendor SKU"], ["status", "Status"], ["shadows", "Shadows"], ["uom", "UOM"], ["shipping", "Shipping"],
  ] as const
  const filterDefinitions: Record<string, { label: string; values: string[]; display: (value: string) => string }> = {
    shippingClass: { label: "Shipping type", values: ["parcel", "ltl", "missing_measurements"], display: (value) => ({ parcel: "FedEx Ground eligible", ltl: "LTL freight", missing_measurements: "Shipping review (missing measurements)" }[value] || value) },
    catalogStatus: { label: "Catalog review", values: ["source-only"], display: () => "Needs review" },
    vendorScope: { label: "Supplier participation", values: ["enabled", "all"], display: (value) => value === "all" ? "All supplier profiles" : "Enabled supplier profiles" },
    channelStatus: { label: "Channel", values: ["shopify-detected", "shopify-live", "shopify-linked", "shopify-missing", "shopify-ready", "shopify-not-ready", "shopify-unpublished", "shopify-price-mismatch", "ebay-validated-ready", "ebay-launch-not-ready", "temu-detected", "temu-missing", "walmart-live", "walmart-detected", "walmart-not-live", "walmart-submitted", "walmart-error", "walmart-ready", "walmart-not-ready", "walmart-missing", "walmart-offer-ready", "walmart-offer-blocked", "walmart-new-ready", "walmart-new-blocked", "walmart-offer-not-found", "walmart-check-error", "walmart-launch-ready", "walmart-launch-blocked"], display: channelFilterLabel },
    hasStock: { label: "Inventory", values: ["true", "false"], display: (value) => value === "true" ? "In stock" : "Out of stock" },
    replenishableMode: { label: "Replenishable", values: ["enabled", "disabled", "vendor", "sku", "channel-default", "suspended"], display: (value) => ({ enabled: "Enabled", disabled: "Disabled", vendor: "Vendor rule", sku: "SKU quantity", "channel-default": "Channel default", suspended: "Suspended by SKU status" }[value] || value) },
    replenishableChannel: { label: "Replenishable channel", values: ["shopify", "ebay", "walmart", "temu", "whatnot", "tiktok"], display: (value) => ({ shopify: "Shopify", ebay: "eBay", walmart: "Walmart", temu: "Temu", whatnot: "Whatnot", tiktok: "TikTok Shop" }[value] || value) },
    stockQtyRange: { label: "Quantity range", values: [], display: (value) => value },
    hasImage: { label: "Has image", values: ["true", "false"], display: (value) => value === "true" ? "Has image" : "No image" },
    multipleSuppliers: { label: "Supplier coverage", values: ["true", "false"], display: (value) => value === "true" ? "Multiple suppliers" : "Not multiple suppliers" },
    supplier: { label: "Supplier", values: facets.suppliers || [], display: (value) => value },
    brand: { label: "Brand", values: facets.brands || [], display: (value) => value },
    manufacturer: { label: "Manufacturer", values: facets.manufacturers || [], display: (value) => value },
    category: { label: "Category", values: facets.categories || [], display: (value) => value },
    creationSource: { label: "Creation source", values: ["internal universal datadump", "source catalog / data dump", "csv product import", "warehouse audit", "legacy catalog import"], display: (value) => value.replace(/\b\w/g, (letter) => letter.toUpperCase()) },
    hazardous: { label: "Hazardous", values: ["true", "false"], display: (value) => value === "true" ? "Hazardous" : "Not hazardous" },
    verifiedBrand: { label: "Verified brand", values: ["true", "false"], display: (value) => value === "true" ? "Verified" : "Not verified" },
    active: { label: "Status", values: ["true", "false"], display: (value) => value === "true" ? "Active" : "Inactive" },
    toBeDiscontinued: { label: "Closeout", values: ["true", "false"], display: (value) => value === "true" ? "Discontinued" : "Not discontinued" },
  }

  async function load(nextPage = page, nextFilters = filters, nextSort = sort, nextPageSize = pageSize) {
    catalogRequest.current?.abort()
    const controller = new AbortController()
    catalogRequest.current = controller
    retryCatalogCount.current = null
    const normalizedFilters = normalizeUnifiedCatalogFilters(nextFilters)
    const useManagedRecords = unifiedCatalogUsesManagedRecords(normalizedFilters)
    setAllFiltered(false)
    try {
      const params = new URLSearchParams({ q: query, page: String(nextPage), limit: String(nextPageSize), fastPage: "true", includeTotal: "true", sort: nextSort.key, sortDirection: nextSort.direction })
      const requestFilters = useManagedRecords ? { ...normalizedFilters } : unifiedCatalogSourceFilters(normalizedFilters)
      delete requestFilters.catalogStatus
      Object.entries(requestFilters).forEach(([key, value]) => { if (value) params.set(key, value) })
      const cacheKey = `catalog:${useManagedRecords ? "managed" : "source"}:${params.toString()}`
      const cached = readWorkspaceCache<{ rows: ProductItem[]; total: number; totalQty: number; hasMore: boolean; page: number; countStatus: "loading" | "ready" | "unavailable" }>(cacheKey)
      if (cached) {
        setRows(cached.rows)
        setTotal(cached.total)
        setTotalQty(cached.totalQty)
        setHasMore(cached.hasMore)
        setPage(cached.page)
        setCountStatus(cached.countStatus)
      } else {
        setRows([])
        setCountStatus("loading")
        setTotal(0)
      }
      setLoading(!cached)
      if (useManagedRecords) {
        params.set("includeTotal", "false")
        const result = await api<{ inventory?: ProductItem[]; total?: number; totalQty?: number; page?: number; hasMore?: boolean }>(`/api/inventory?${params}`, { signal: controller.signal })
        if (catalogRequest.current !== controller) return
        setRows(result.inventory || [])
        setTotal(0)
        setTotalQty(Number(result.totalQty || 0))
        setHasMore(Boolean(result.hasMore))
        setPage(Number(result.page || nextPage))
        writeWorkspaceCache(cacheKey, { rows: result.inventory || [], total: 0, totalQty: Number(result.totalQty || 0), hasMore: Boolean(result.hasMore), page: Number(result.page || nextPage), countStatus: "loading" })
        const countParams = new URLSearchParams(params)
        countParams.set("includeTotal", "true")
        countParams.set("countOnly", "true")
        countParams.set("page", "1")
        countParams.set("limit", "1")
        countParams.delete("sort")
        countParams.delete("sortDirection")
        const pollCount = async (retry = false) => {
          setCountStatus("loading")
          let failures = 0
          const started = Date.now()
          while (!controller.signal.aborted && catalogRequest.current === controller) {
            if (Date.now() - started > 300000) { setCountStatus("unavailable"); return }
            let delay = 2000
            try {
              countParams.set("retryCount", String(retry))
              const count = await api<{ total?: number; totalQty?: number; totalKnown?: boolean; countStatus?: string; retryAfterMs?: number }>(`/api/inventory?${countParams}`, { signal: controller.signal })
              if (controller.signal.aborted || catalogRequest.current !== controller) return
              retry = false
              failures = 0
              if (count.totalKnown) {
                setTotal(Number(count.total || 0))
                setTotalQty(Number(count.totalQty || 0))
                setCountStatus("ready")
                writeWorkspaceCache(cacheKey, { rows: result.inventory || [], total: Number(count.total || 0), totalQty: Number(count.totalQty || 0), hasMore: Boolean(result.hasMore), page: Number(result.page || nextPage), countStatus: "ready" })
                return
              }
              if (!["queued", "running", "busy"].includes(count.countStatus || "")) { setCountStatus("unavailable"); return }
              delay = Math.max(1000, Math.min(10000, count.retryAfterMs || 2000))
            } catch {
              if (controller.signal.aborted || catalogRequest.current !== controller) return
              if (++failures >= 3) { setCountStatus("unavailable"); return }
              delay = failures * 2000
            }
            await new Promise<void>(resolve => {
              const finish = () => { window.clearTimeout(timer); controller.signal.removeEventListener("abort", finish); resolve() }
              const timer = window.setTimeout(finish, delay)
              controller.signal.addEventListener("abort", finish, { once: true })
            })
          }
        }
        retryCatalogCount.current = () => { void pollCount(true) }
        void pollCount()
      } else {
        const result = await api<CatalogResponse>(`/api/catalog/products?${params}`, { signal: controller.signal })
        if (catalogRequest.current !== controller) return
        const sourceRows = (result.items || []) as ProductItem[]
        setRows(sourceRows)
        setTotal(Number(result.totalMatches || 0))
        setTotalQty(sourceRows.reduce((sum, row) => sum + Number(row.qty ?? row.stockQty ?? 0), 0))
        setHasMore(Boolean(result.hasMore))
        setPage(Number(result.page || nextPage))
        setCountStatus("ready")
        writeWorkspaceCache(cacheKey, { rows: sourceRows, total: Number(result.totalMatches || 0), totalQty: sourceRows.reduce((sum, row) => sum + Number(row.qty ?? row.stockQty ?? 0), 0), hasMore: Boolean(result.hasMore), page: Number(result.page || nextPage), countStatus: "ready" })
      }
    } catch (error) {
      if (controller.signal.aborted || catalogRequest.current !== controller) return
      setRows([])
      setTotal(0)
      setHasMore(false)
      setCountStatus("unavailable")
      toast.error(error instanceof Error ? error.message : "Unable to load products.")
    } finally {
      if (catalogRequest.current === controller) setLoading(false)
    }
  }

  useEffect(() => {
    load(1, filters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.catalogStatus])

  useEffect(() => {
    // The initial catalog fetch is handled above. Every intentional change to
    // the search text gets a short debounce so the field can show feedback
    // immediately without issuing a request for every keystroke.
    if (!hasMountedCatalogSearchRef.current) {
      hasMountedCatalogSearchRef.current = true
      return
    }
    // A one-character catalog search can fan out across the full supplier
    // dataset. Keep that available on Enter, but only auto-search once the
    // operator has provided enough context to keep the request selective.
    if (query.trim().length === 1) {
      setSearchPending(false)
      return
    }
    const requestId = ++searchRequestRef.current
    setSearchPending(true)
    const timeout = window.setTimeout(() => {
      setAllFiltered(false)
      setSelectedIds(new Set())
      void load(1).finally(() => {
        if (requestId === searchRequestRef.current) setSearchPending(false)
      })
    }, 280)
    return () => window.clearTimeout(timeout)
    // load intentionally follows the latest render state for query, filters, and sort.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  useEffect(() => {
    if (!filterOpen) return
    let active = true
    const sourceOnly = filters.catalogStatus === "source-only"
    const endpoint = sourceOnly ? "/api/catalog/facets" : "/api/inventory/facets"
    setFacetsLoading(true)
    api<{ facets?: { suppliers?: string[]; brands?: string[]; manufacturers?: string[]; categories?: string[] }; suppliers?: string[]; brands?: string[]; manufacturers?: string[]; categories?: string[] }>(endpoint)
      .then((result) => {
        if (!active) return
        const loadedFacets = result.facets || result
        setFacets({
          suppliers: loadedFacets.suppliers || [],
          brands: loadedFacets.brands || [],
          manufacturers: loadedFacets.manufacturers || [],
          categories: loadedFacets.categories || [],
        })
      })
      .catch(() => {
        if (active) toast.error("Unable to load catalog filter values.")
      })
      .finally(() => { if (active) setFacetsLoading(false) })
    return () => { active = false }
  }, [filterOpen, filters.catalogStatus])

  const activeDefinition = filterDefinitions[filterField]
  const filterValues = filterField === "channelStatus"
    ? activeDefinition.values.filter((value) => value.startsWith(`${channelFilterScope}-`))
    : activeDefinition.values
  const matchingValues = filterValues.filter((value) => activeDefinition.display(value).trim().toLowerCase().startsWith(filterSearch.trim().toLowerCase())).slice(0, 250)
  const pendingSelections = Object.entries(pendingFilters).flatMap(([key, values]) => values.map((value) => ({ key, value, label: `${filterDefinitions[key]?.label || key}: ${filterDefinitions[key]?.display(value) || value}` })))
  const selectionCount = allFiltered ? total : selectedIds.size
  const selectedQty = allFiltered
    ? totalQty
    : rows
      .filter((row) => selectedIds.has(String(row.id || row.sku || "")))
      .reduce((sum, row) => sum + Number(row.qty ?? row.stockQty ?? 0), 0)
  const pageIds = rows.map((row) => String(row.id || row.sku || "")).filter(Boolean)
  const pageSelected = pageIds.length > 0 && pageIds.every((id) => allFiltered || selectedIds.has(id))
  const setDensity = (next: boolean) => { setCompact(next); window.localStorage.setItem("dataplus-products-density", next ? "compact" : "regular") }
  const toggleColumn = (key: string) => setVisible((current) => { const next = { ...current, [key]: !current[key] }; window.localStorage.setItem("dataplus-products-columns", JSON.stringify(next)); return next })
  const resetColumns = () => {
    const defaults = { readiness: true, catalogStatus: false, suppliers: true, stock: true, price: true, brand: true, category: true, channels: true, images: true, updated: true, created: false, verified: false, hazardous: false, shopifySynced: false, manufacturer: false, vendorSku: false, status: false, shadows: false, uom: false, shipping: true }
    setVisible(defaults)
    window.localStorage.setItem("dataplus-products-columns", JSON.stringify(defaults))
  }
  const setPageLimit = (next: string) => {
    const limit = Number(next)
    setPageSize(limit)
    window.localStorage.setItem("dataplus-products-page-size", String(limit))
    setAllFiltered(false)
    setSelectedIds(new Set())
    load(1, filters, sort, limit)
  }
  const changeSort = (key: string) => {
    const next = { key, direction: sort.key === key && sort.direction === "asc" ? "desc" as const : "asc" as const }
    setSort(next)
    setAllFiltered(false)
    setSelectedIds(new Set())
    load(1, filters, next)
  }
  const applyFilter = () => {
    const minimum = quantityMin.trim()
    const maximum = quantityMax.trim()
    if ((minimum && !Number.isFinite(Number(minimum))) || (maximum && !Number.isFinite(Number(maximum)))) {
      toast.error("Quantity range must contain valid numbers.")
      return
    }
    if (minimum && maximum && Number(minimum) > Number(maximum)) {
      toast.error("Minimum quantity cannot be greater than maximum quantity.")
      return
    }
    const next = { ...filters }
    Object.entries(pendingFilters).forEach(([key, values]) => {
      if (!filterDefinitions[key]) return
      if (values.length) next[key] = values.join("|")
      else delete next[key]
    })
    if (minimum && maximum) {
      next.stockQtyOperator = "between"
      next.stockQty = `${minimum}|${maximum}`
    } else if (minimum) {
      next.stockQtyOperator = "gte"
      next.stockQty = minimum
    } else if (maximum) {
      next.stockQtyOperator = "lte"
      next.stockQty = maximum
    } else if (filterField === "stockQtyRange") {
      delete next.stockQtyOperator
      delete next.stockQty
    }
    const normalized = normalizeUnifiedCatalogFilters(next)
    setFilters(normalized); setFilterOpen(false); setFilterSelection([]); setPendingFilters({}); setFilterSearch(""); setAllFiltered(false); setSelectedIds(new Set()); load(1, normalized)
  }
  const removeFilter = (key: string) => { const next = { ...filters }; delete next[key]; if (["stockQty", "stockQtyOperator"].includes(key)) { delete next.stockQty; delete next.stockQtyOperator; setQuantityMin(""); setQuantityMax("") } const normalized = normalizeUnifiedCatalogFilters(next); setFilters(normalized); setAllFiltered(false); setSelectedIds(new Set()); load(1, normalized) }
  const resetFilters = () => { setFilters({}); setQuery(""); setAllFiltered(false); setSelectedIds(new Set()); load(1, {}) }
  const toggleRow = (id: string, checked: boolean) => { if (loading) return; setAllFiltered(false); setSelectedIds((current) => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next }) }
  const togglePage = (checked: boolean) => { if (loading) return; setAllFiltered(false); setSelectedIds((current) => { const next = new Set(current); pageIds.forEach((id) => checked ? next.add(id) : next.delete(id)); return next }) }
  const applySavedFilter = (next: Record<string, string>) => { const normalized = normalizeUnifiedCatalogFilters(next); setFilters(normalized); setAllFiltered(false); setSelectedIds(new Set()); load(1, normalized) }
  const applySavedView = (view: { name: string; query: string; filters: Record<string, string>; sort: { key: string; direction: "asc" | "desc" } }) => { const normalized = normalizeUnifiedCatalogFilters(view.filters || {}); setQuery(view.query || ""); setFilters(normalized); setSort(view.sort || { key: "", direction: "asc" }); setAllFiltered(false); setSelectedIds(new Set()); load(1, normalized, view.sort || { key: "", direction: "asc" }) }
  const saveCurrentView = () => {
    const name = window.prompt("Name this product view")?.trim()
    if (!name) return
    const next = [...savedViews.filter((view) => view.name.toLowerCase() !== name.toLowerCase()), { name, query, filters, sort }]
    setSavedViews(next)
    window.localStorage.setItem("dataplus-products-saved-views", JSON.stringify(next))
    toast.success(`Saved product view: ${name}.`)
  }
  const removeSavedView = () => {
    if (!savedViews.length) return
    const name = window.prompt(`Remove which saved view?\n${savedViews.map((view) => view.name).join("\n")}`)?.trim().toLowerCase()
    if (!name) return
    const next = savedViews.filter((view) => view.name.toLowerCase() !== name)
    if (next.length === savedViews.length) return toast.error("No saved product view matched that name.")
    setSavedViews(next)
    window.localStorage.setItem("dataplus-products-saved-views", JSON.stringify(next))
    toast.success("Saved product view removed.")
  }
  async function runBulk(action: "set-active" | "set-inactive" | "set-discontinued" | "delete") {
    if (!selectionCount) return
    if ((action === "delete" || action === "set-discontinued") && !window.confirm(`${action === "delete" ? "Delete" : "Discontinue"} ${numberLabel(selectionCount)} selected product${selectionCount === 1 ? "" : "s"}?`)) return
    try {
      const result = await api<{ changed?: number; limited?: boolean }>("/api/inventory/bulk", { method: "POST", body: JSON.stringify({ ids: [...selectedIds], allFiltered, query, filters, action }) })
      toast.success(`${numberLabel(result.changed || 0)} product${result.changed === 1 ? "" : "s"} updated.${result.limited ? " Limited to the first 25,000 filtered rows." : ""}`)
      setSelectedIds(new Set()); setAllFiltered(false); load(1)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update selected products.") }
  }
  const supportedChannelKey = (channel: ChannelConnection) => {
    const name = String(channel.name || "").trim().toLowerCase()
    return name === "tiktok shop" ? "tiktok" : ["shopify", "ebay", "walmart", "temu", "whatnot", "tiktok"].includes(name) ? name : ""
  }
  const channelStatusOptions = channels
    .map((channel) => ({
      key: supportedChannelKey(channel),
      label: channel.name,
      enabled: channel.settings?.channelEnabled !== false && String(channel.status || "active").toLowerCase() !== "inactive",
      connected: channel.connected === true,
    }))
    .filter((channel, index, values) => channel.key && values.findIndex((candidate) => candidate.key === channel.key) === index)
  const openChannelStatus = (ids?: string[]) => {
    const targetIds = ids || [...selectedIds]
    const useAllFiltered = !ids && allFiltered
    if (!useAllFiltered && !targetIds.length) return toast.error("Select at least one product.")
    setChannelStatusIds(targetIds)
    setChannelStatusAllFiltered(useAllFiltered)
    setChannelStatusChannels([])
    setChannelStatusMode("inactive")
    setChannelStatusOpen(true)
  }
  const saveChannelStatus = async () => {
    if (!channelStatusChannels.length || channelStatusSaving) return
    setChannelStatusSaving(true)
    try {
      const result = await api<{ changed?: number; limited?: boolean; job?: ImportJob | null; jobs?: ImportJob[]; message?: string }>("/api/inventory/bulk", {
        method: "POST",
        body: JSON.stringify({ ids: channelStatusIds, allFiltered: channelStatusAllFiltered, query, filters, action: "set-channel-status", channels: channelStatusChannels, status: channelStatusMode }),
      })
      toast.success(result.message || `${numberLabel(result.changed || 0)} product channel statuses updated.${result.limited ? " Limited to the first 25,000 filtered rows." : ""}`)
      const queuedJobs = result.jobs?.length || (result.job?.id ? 1 : 0)
      if (queuedJobs) toast.info(`${queuedJobs} channel batch${queuedJobs === 1 ? "" : "es"} queued. Track marketplace acknowledgments in Jobs.`)
      setChannelStatusOpen(false)
      setSelectedIds(new Set())
      setAllFiltered(false)
      void load(1)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update channel status.") }
    finally { setChannelStatusSaving(false) }
  }
  const openReplenishable = (enabled = true) => {
    if (!selectionCount) return toast.error("Select at least one product.")
    setReplenishableEnabled(enabled)
    setReplenishableSource("channel")
    setReplenishableQuantity("1")
    setReplenishableChannels(channelStatusOptions.filter((channel) => channel.enabled).map((channel) => channel.key))
    setReplenishableOpen(true)
  }
  const saveReplenishable = async () => {
    if (replenishableSaving || (replenishableEnabled && !replenishableChannels.length)) return
    setReplenishableSaving(true)
    try {
      const result = await api<{ changed?: number; limited?: boolean; message?: string }>("/api/inventory/bulk", { method: "POST", body: JSON.stringify({ ids: [...selectedIds], allFiltered, query, filters, action: "set-replenishable", enabled: replenishableEnabled, source: replenishableSource, quantity: Number(replenishableQuantity || 0), channels: replenishableChannels }) })
      toast.success(result.message || `${numberLabel(result.changed || 0)} replenishable policies updated.`)
      setReplenishableOpen(false)
      setSelectedIds(new Set())
      setAllFiltered(false)
      void load(1)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update replenishable policies.") }
    finally { setReplenishableSaving(false) }
  }
  async function addSourceRowsToManaged(requestedSkus?: string[]) {
    const skus = requestedSkus || rows.filter((item) => selectedIds.has(String(item.id || item.sku || ""))).map((item) => String(item.sku || "")).filter(Boolean)
    const isFilteredBatch = allFiltered && !requestedSkus
    if (!isFilteredBatch && !skus.length) return
    const count = isFilteredBatch ? total : skus.length
    const actionLabel = needsReviewView ? "add to the managed catalog" : "add or refresh in the managed catalog"
    if (!window.confirm(`${actionLabel.charAt(0).toUpperCase()}${actionLabel.slice(1)} for ${numberLabel(count)} source record${count === 1 ? "" : "s"}? This keeps DataWarehouse as the source of truth and creates managed records only for the selected SKUs.`)) return
    try {
      const result = await api<{ job?: ImportJob; message?: string; impact?: { limited?: boolean } }>("/api/catalog/bulk", {
        method: "POST",
        body: JSON.stringify(isFilteredBatch
          ? { action: "add-active", allFiltered: true, query, filters: unifiedCatalogSourceFilters(filters), importMode: "new-and-update" }
          : { action: "add-active", skus, importMode: "new-and-update" }),
      })
      toast.success(result.message || `${numberLabel(count)} source record${count === 1 ? "" : "s"} queued for managed catalog import.${result.impact?.limited ? " The configured batch limit applies." : ""}`)
      setSelectedIds(new Set())
      setAllFiltered(false)
      if (result.job?.id) window.setTimeout(() => { window.history.pushState({}, "", "/jobs"); window.dispatchEvent(new PopStateEvent("popstate")) }, 450)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to queue the managed catalog import.") }
  }
  function openEbayLaunch(ids?: string[], lifecycleAction = "launch") {
    if (loading || searchPending) { toast.error("Wait for the catalog filters to finish loading."); return }
    const selected = ids || [...selectedIds]
    const useAllFiltered = !ids && allFiltered
    if (!useAllFiltered && !selected.length) {
      toast.error("Select catalog products or choose all filtered results before preparing an eBay launch.")
      return
    }
    setEbayLaunchSkus(selected)
    setEbayLaunchAllFiltered(useAllFiltered)
    setEbayLaunchScope({ query, filters: { ...filters } })
    setEbayLaunchDraft({
      lifecycleAction,
      marketplaceId: String(ebaySettings.ebayMarketplaceId || "EBAY_US"),
      merchantLocationKey: String(ebaySettings.ebayMerchantLocationKey || ""),
      paymentPolicyId: String(ebaySettings.ebayPaymentPolicyId || ""),
      returnPolicyId: String(ebaySettings.ebayReturnPolicyId || ""),
      fulfillmentPolicyId: String(ebaySettings.ebayFulfillmentPolicyId || ""),
      categoryId: String(ebaySettings.ebayDefaultCategoryId || ""),
      storeCategoryId: String(ebaySettings.ebayDefaultStoreCategoryId || ""),
      storeCategoryName: String(ebaySettings.ebayDefaultStoreCategoryName || ""),
      listingTemplateId: String(ebaySettings.ebayListingTemplateId || ""),
      itemSpecificTemplateId: String(ebaySettings.ebayItemSpecificTemplateId || ""),
      dispatchTimeDays: String(ebaySettings.ebayDefaultDispatchTimeDays ?? 2),
      condition: String(ebaySettings.ebayDefaultCondition || "NEW"),
      bestOfferEnabled: ebaySettings.ebayBestOfferEnabled === true,
      matchEbayCatalog: true,
      limit: String(ebaySettings.ebayListingLaunchLimit || 500),
    })
    setEbayLaunchOpen(true)
  }

  async function queueEbayLaunch(action = ebayLaunchDraft.lifecycleAction) {
    const reviewOnly = action === "review" || action === "compliance"
    if (action === "end" && !window.confirm("End the selected eBay listings? This removes their live eBay offers, but keeps their DataPlus listing history.")) return
    setEbayLaunchSaving(true)
    try {
      const result = await api<{ job?: ImportJob; duplicate?: boolean; message?: string }>(action === "launch" ? "/api/ebay/listings/launch" : "/api/ebay/listings/lifecycle", {
        method: "POST",
        body: JSON.stringify({
          skus: ebayLaunchAllFiltered ? [] : ebayLaunchSkus,
          allFiltered: ebayLaunchAllFiltered,
          selectionScope: true,
          selectionTotal: ebayLaunchAllFiltered ? total : ebayLaunchSkus.length,
          query: ebayLaunchScope.query,
          filters: ebayLaunchScope.filters,
          batchSize: Math.max(25, Math.min(1000, Number(ebayLaunchDraft.limit || 500) || 500)),
          lifecycleAction: action,
          action,
          dryRun: reviewOnly,
          apply: !reviewOnly,
          publish: action === "launch" ? !reviewOnly : undefined,
          marketplaceId: ebayLaunchDraft.marketplaceId,
          merchantLocationKey: ebayLaunchDraft.merchantLocationKey,
          paymentPolicyId: ebayLaunchDraft.paymentPolicyId,
          returnPolicyId: ebayLaunchDraft.returnPolicyId,
          fulfillmentPolicyId: ebayLaunchDraft.fulfillmentPolicyId,
          categoryId: ebayLaunchDraft.categoryId,
          storeCategoryId: ebayLaunchDraft.storeCategoryId,
          storeCategoryName: ebayLaunchDraft.storeCategoryName,
          listingTemplateId: ebayLaunchDraft.listingTemplateId,
          itemSpecificTemplateId: ebayLaunchDraft.itemSpecificTemplateId,
          dispatchTimeDays: Math.max(0, Math.min(30, Number(ebayLaunchDraft.dispatchTimeDays || 0) || 0)),
          condition: ebayLaunchDraft.condition,
          bestOfferEnabled: ebayLaunchDraft.bestOfferEnabled,
          matchEbayCatalog: ebayLaunchDraft.matchEbayCatalog,
        }),
      })
      setEbayLaunchOpen(false)
      toast.success(result.message || (result.duplicate ? "An equivalent eBay listing job is already running." : `${ebayLifecycleLabel[action] || "eBay listing work"} queued.`))
      if (!reviewOnly) { setSelectedIds(new Set()); setAllFiltered(false) }
      void load(1)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to queue eBay listing work.")
    } finally {
      setEbayLaunchSaving(false)
    }
  }
  async function runShopifyLaunch(apply: boolean, requestedSkus?: string[]) {
    const skus = requestedSkus || rows.filter((item) => selectedIds.has(String(item.id || item.sku || ""))).map((item) => String(item.sku || "")).filter(Boolean)
    const isFilteredBatch = allFiltered && !requestedSkus
    if (!isFilteredBatch && !skus.length) return
    const count = isFilteredBatch ? total : skus.length
    const scope = `${numberLabel(count)} selected product${count === 1 ? "" : "s"}`
    if (apply && !window.confirm(`Create ${scope} in live Shopify? DataPlus will automatically process the complete selection. Zero-stock products can be created with inventory at zero; discontinued, linked, and otherwise not-ready SKUs are skipped. Review the dry-run job first.`)) return
    try {
      const result = await api<{ job?: ImportJob; message?: string }>("/api/shopify/product-create", {
        method: "POST",
        body: JSON.stringify(isFilteredBatch
          ? { allFiltered: true, selectionTotal: count, query, filters, apply, dryRun: !apply }
          : { skus, selectionTotal: skus.length, apply, dryRun: !apply }),
      })
      toast.success(result.message || `Shopify ${apply ? "product creation" : "create dry run"} queued.`)
      if (apply) { setSelectedIds(new Set()); setAllFiltered(false) }
      if (result.job?.id) window.setTimeout(() => { window.history.pushState({}, "", "/jobs"); window.dispatchEvent(new PopStateEvent("popstate")) }, 500)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to queue Shopify product creation.") }
  }
  async function runShopifyLink(apply: boolean) {
    const skus = rows.filter((item) => selectedIds.has(String(item.id || item.sku || ""))).map((item) => String(item.sku || "")).filter(Boolean)
    const isFilteredBatch = allFiltered
    if (!isFilteredBatch && !skus.length) return
    const scope = isFilteredBatch ? `up to 100,000 filtered products` : `${numberLabel(skus.length)} selected product${skus.length === 1 ? "" : "s"}`
    if (apply && !window.confirm(`Apply Shopify variant links for ${scope}? This updates DataPlus links only; it does not create Shopify products.`)) return
    try {
      const result = await api<{ message?: string }>("/api/shopify/link-existing-variants", { method: "POST", body: JSON.stringify(isFilteredBatch ? { query, filters, limit: 100000, apply, dryRun: !apply } : { skus, limit: skus.length, apply, dryRun: !apply }) })
      toast.success(result.message || `Shopify variant-link ${apply ? "backfill" : "review"} queued.`)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to queue Shopify variant linking.") }
  }
  async function syncShopifyStatus(item: ProductItem) {
    try {
      const result = await api<{ message?: string }>("/api/shopify/status-sync", { method: "POST", body: JSON.stringify({ sku: item.sku }) })
      toast.success(result.message || `Shopify status refreshed for ${item.sku}.`)
      void load(page)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to refresh Shopify status.") }
  }
  async function exportProducts() {
    const skus = allFiltered ? [] : rows.filter((item) => selectedIds.has(String(item.id || item.sku || ""))).map((item) => String(item.sku || "")).filter(Boolean)
    const scope = skus.length ? `${skus.length} selected product${skus.length === 1 ? "" : "s"}` : "the current filtered products"
    try {
      const result = await api<{ queued?: boolean; job?: ImportJob; message?: string; filename?: string; csv?: string; productCount?: number }>("/api/export-mappings/custom-export", {
        method: "POST",
        body: JSON.stringify({
          skus,
          query: skus.length ? "" : query,
          filters: skus.length ? {} : filters,
          forceJob: allFiltered || total > 5000,
          dataFileName: "dataplus-products.csv",
          template: {
            name: "DataPlus Products",
            source: "DataPlus",
            mappings: [
              { externalColumn: "SKU", productField: "sku" },
              { externalColumn: "Title", productField: "title" },
              { externalColumn: "Supplier", productField: "supplier" },
              { externalColumn: "Brand", productField: "brand" },
              { externalColumn: "Main category", productField: "mainCategory" },
              { externalColumn: "Cost", productField: "cost" },
              { externalColumn: "Price", productField: "price" },
              { externalColumn: "Available", productField: "available" },
              { externalColumn: "UPC", productField: "barcode" },
            ],
          },
        }),
      })
      if (result.queued) return toast.success(result.message || `Export job queued for ${scope}.`)
      const blob = new Blob([result.csv || ""], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = result.filename || "dataplus-products.csv"
      link.click()
      URL.revokeObjectURL(url)
      toast.success(`Exported ${numberLabel(result.productCount || 0)} products.`)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to export products.") }
  }
  const readiness = (item: ProductItem) => {
    const checks = [Boolean(item.title || item.marketplaceTitle), Boolean(item.mainCategory || item.category), Number(item.websitePrice || item.price || 0) > 0, Boolean(item.defaultImage), Number(item.qty ?? item.stockQty ?? 0) > 0]
    const score = Math.round((checks.filter(Boolean).length / checks.length) * 100)
    return { score, missing: [!checks[0] && "title", !checks[1] && "category", !checks[2] && "price", !checks[3] && "image", !checks[4] && "stock"].filter(Boolean).join(", ") }
  }
  const applyChannelFilter = (channelStatus: string) => {
    const next = normalizeUnifiedCatalogFilters({ ...filters, channelStatus })
    setFilters(next)
    setAllFiltered(false)
    setSelectedIds(new Set())
    load(1, next)
  }
  const managedCatalogView = unifiedCatalogUsesManagedRecords(filters)
  const sourceCatalogView = !managedCatalogView
  const needsReviewView = filters.catalogStatus === "source-only"
  const cellCount = 4 + columns.filter(([key]) => visible[key]).length
  const readinessChannels = channels.flatMap((channel) => {
    const marketplace = marketplaceChannelKey(channel)
    const statusByMarketplace: Partial<Record<MarketplaceChannelKey, string>> = {
      ebay: "ebay-validated-ready",
      walmart: "walmart-launch-ready",
      shopify: "shopify-ready",
    }
    const channelStatus = marketplace ? statusByMarketplace[marketplace] : ""
    const enabled = channel.connected
      && String(channel.status || "active").toLowerCase() !== "inactive"
      && channel.settings?.channelEnabled !== false
    return marketplace && channelStatus && enabled ? [{ channel, marketplace, channelStatus }] : []
  })

  const loadChannelReadyCount = (marketplace: string, channelStatus: string) => {
    readinessCountRequest.current?.abort()
    const controller = new AbortController()
    readinessCountRequest.current = controller
    setChannelReadyCounts((current) => Object.fromEntries(
      Object.entries(current).map(([key, value]) => [key, key === marketplace
        ? { count: 0, status: "loading" as const }
        : value.status === "loading" ? { count: 0, status: "idle" as const } : value]),
    ))
    const requestFilters = { ...normalizeUnifiedCatalogFilters(filters) }
    delete requestFilters.catalogStatus
    delete requestFilters.channelStatus
    const loadCount = async () => {
      const params = new URLSearchParams({ q: query, page: "1", limit: "1", fastPage: "true", includeTotal: "true", countOnly: "true", channelStatus })
      Object.entries(requestFilters).forEach(([key, value]) => { if (value) params.set(key, value) })
      const started = Date.now()
      while (!controller.signal.aborted && Date.now() - started < 120000) {
        try {
          const result = await api<{ total?: number; totalKnown?: boolean; countStatus?: string; retryAfterMs?: number }>(`/api/inventory?${params}`, { signal: controller.signal })
          if (controller.signal.aborted) return
          if (result.totalKnown) {
            setChannelReadyCounts((current) => ({ ...current, [marketplace]: { count: Number(result.total || 0), status: "ready" } }))
            return
          }
          if (!["queued", "running", "busy"].includes(result.countStatus || "")) break
          await new Promise<void>((resolve) => window.setTimeout(resolve, Math.max(1000, Math.min(5000, result.retryAfterMs || 2000))))
        } catch {
          if (!controller.signal.aborted) break
        }
      }
      if (!controller.signal.aborted) setChannelReadyCounts((current) => ({ ...current, [marketplace]: { count: 0, status: "unavailable" } }))
    }
    void loadCount()
  }

  useEffect(() => {
    readinessCountRequest.current?.abort()
    if (!managedCatalogView || !readinessChannels.length) {
      setChannelReadyCounts({})
      return
    }
    setChannelReadyCounts(Object.fromEntries(readinessChannels.map(({ marketplace }) => [marketplace, { count: 0, status: "idle" as const }])))
    // A filtered page and its exact total load immediately. Marketplace readiness
    // is intentionally on demand because each channel uses a separate validator.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, filters, channels, managedCatalogView])

  return (
    <div className="grid min-w-0 gap-4 sm:gap-5">
      <WalmartLaunch sku={walmartSingleLaunchSku} open={Boolean(walmartSingleLaunchSku)} onOpenChange={open => { if (!open) setWalmartSingleLaunchSku("") }} /><WalmartUpcMatch readiness={walmartReadinessMode} skus={walmartMatchSkus} selectionRequest={walmartMatchSelection} open={walmartMatchOpen} onOpenChange={setWalmartMatchOpen} />
      <PageHeader
        eyebrow="Catalog"
        title="Catalog"
        description={String(filters.channelStatus || "").includes("walmart")
          ? "Basic checks cover catalog fields and category mapping. Last-check filters use assessments from the past 24 hours for unchanged products; rules or mapping changes require a recheck. Launch review always validates current requirements. Live means Walmart reported PUBLISHED; feed acceptance alone is not live."
          : needsReviewView
          ? "Source records that still need a managed catalog record before marketplace work can begin."
          : managedCatalogView
            ? "Managed catalog SKUs with marketplace settings, status controls, and connected-channel actions."
            : "All supplier source records in one workspace. Managed catalog and channel state appear when a source SKU is linked."}
      />
      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="grid gap-3 border-b p-3 sm:p-6">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-auto">
              <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
              <Input
                className="w-full pl-8 pr-20 sm:w-[360px]"
                placeholder="Search or paste SKUs, UPCs, aliases..."
                value={query}
                onPaste={(event) => normalizePastedSearch(event, query, setQuery)}
                onChange={(event) => {
                  const nextQuery = event.target.value
                  setSearchPending(nextQuery.trim().length !== 1)
                  setQuery(nextQuery)
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    searchRequestRef.current += 1
                    setSearchPending(false)
                    setAllFiltered(false);
                    setSelectedIds(new Set());
                    load(1);
                  }
                }}
              />
              {(loading || searchPending) ? (
                <div className="absolute right-2 top-2.5 flex items-center" aria-live="polite">
                  <Loader2 className="size-4 animate-spin text-primary" aria-label="Searching catalog" />
                  <span className="sr-only">Searching catalog</span>
                </div>
              ) : query.trim().length === 1 ? (
                <span className="pointer-events-none absolute right-2 top-2.5 text-[10px] font-medium text-muted-foreground">
                  Type 1 more
                </span>
              ) : null}
            </div>
            {parseSearchTerms(query).length > 1 ? <Badge variant="secondary">{numberLabel(parseSearchTerms(query).length)} identifiers</Badge> : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline">
                  Saved views
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Quick filters</DropdownMenuLabel>
                <DropdownMenuItem
                  onSelect={() =>
                    applySavedFilter({ channelStatus: "shopify-live" })
                  }
                >
                  Shopify storefront live
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => applySavedFilter({ hasStock: "true" })}
                >
                  In stock
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    applySavedFilter({ channelStatus: "shopify-missing" })
                  }
                >
                  Not in Shopify catalog
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    applySavedFilter({ channelStatus: "ebay-needs-relink" })
                  }
                >
                  eBay needs relink
                </DropdownMenuItem>
                {savedViews.length ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>My saved views</DropdownMenuLabel>
                    {savedViews.map((view) => (
                      <DropdownMenuItem
                        key={view.name}
                        onSelect={() => applySavedView(view)}
                      >
                        {view.name}
                      </DropdownMenuItem>
                    ))}
                  </>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={saveCurrentView}>
                  Save current view...
                </DropdownMenuItem>
                {savedViews.length ? (
                  <DropdownMenuItem onSelect={removeSavedView}>
                    Remove saved view...
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
            <Popover
              open={filterOpen}
              onOpenChange={(open) => {
                setFilterOpen(open)
                if (!open) return

                const nextPending = Object.fromEntries(
                  Object.entries(filters)
                    .filter(([key]) => Boolean(filterDefinitions[key]))
                    .map(([key, value]) => [
                      key,
                      String(value || "").split("|").filter(Boolean),
                    ]),
                )
                setPendingFilters(nextPending)
                setFilterSelection(nextPending[filterField] || [])
                setFilterSearch("")
                const quantityValues = String(filters.stockQty || "").split("|")
                const quantityOperator = filters.stockQtyOperator || ""
                setQuantityMin(["gte", "gt", "between"].includes(quantityOperator) ? quantityValues[0] || "" : "")
                setQuantityMax(["lte", "lt"].includes(quantityOperator) ? quantityValues[0] || "" : quantityOperator === "between" ? quantityValues[1] || "" : "")
              }}
            >
              <PopoverTrigger asChild>
                <Button size="sm" variant="outline">
                  + Filter
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="max-h-[var(--radix-popover-content-available-height)] w-[380px] max-w-[calc(100vw-24px)] overflow-y-auto p-3">
                <div className="grid gap-3">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">
                    Add product filter
                  </p>
                  <Select
                    value={filterField}
                    onValueChange={(value) => {
                      setFilterField(value);
                      if (value === "channelStatus") setChannelFilterScope("shopify");
                      setFilterSelection(pendingFilters[value] || []);
                      setFilterSearch("");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(filterDefinitions).map(
                        ([key, definition]) => (
                          <SelectItem key={key} value={key}>
                            {definition.label}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                  {filterField === "channelStatus" ? (
                    <div className="grid gap-1">
                      <Label className="text-xs">Channel</Label>
                      <Select
                        value={channelFilterScope}
                        onValueChange={(value) => {
                          setChannelFilterScope(value);
                          setFilterSelection(pendingFilters.channelStatus || []);
                          setFilterSearch("");
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="shopify">Shopify</SelectItem>
                          <SelectItem value="ebay">eBay</SelectItem>
                          <SelectItem value="temu">Temu</SelectItem>
                          <SelectItem value="walmart">Walmart</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {channelFilterScope === "ebay" ? "Choose whether products are ready to launch." : "Choose a channel status to filter."}
                      </p>
                      {channelFilterScope === "ebay" ? (
                        <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2 text-xs text-muted-foreground">
                          Ready means the SKU passed the full eBay launch preflight within the last 24 hours. Not ready means it is not live and has no current passing preflight. Run an eBay launch preflight to refresh the result.
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {filterField === "stockQtyRange" ? (
                    <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
                      <Field label="Minimum quantity">
                        <Input type="number" inputMode="numeric" placeholder="No minimum" value={quantityMin} onChange={(event) => setQuantityMin(event.target.value)} />
                      </Field>
                      <Field label="Maximum quantity">
                        <Input type="number" inputMode="numeric" placeholder="No maximum" value={quantityMax} onChange={(event) => setQuantityMax(event.target.value)} />
                      </Field>
                      <p className="text-xs text-muted-foreground sm:col-span-2">Leave either side blank to filter only by a minimum or maximum.</p>
                    </div>
                  ) : filterField === "channelStatus" && channelFilterScope === "ebay" ? (
                    <RadioGroup
                      value={filterSelection[0] || ""}
                      onValueChange={(value) => {
                        const next = value ? [value] : []
                        setFilterSelection(next)
                        setPendingFilters((pending) => ({ ...pending, channelStatus: next }))
                      }}
                      className="grid gap-2"
                    >
                      <Label htmlFor="ebay-ready-to-launch" className="flex cursor-pointer items-start gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 hover:bg-emerald-500/10">
                        <RadioGroupItem id="ebay-ready-to-launch" value="ebay-validated-ready" className="mt-0.5" />
                        <span className="min-w-0"><span className="flex items-center gap-1.5 font-medium text-emerald-800 dark:text-emerald-200"><CheckCircle2 className="size-4" /> Ready to launch</span><span className="mt-1 block text-xs font-normal text-muted-foreground">Passed the current full eBay launch preflight.</span></span>
                      </Label>
                      <Label htmlFor="ebay-not-ready-to-launch" className="flex cursor-pointer items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 hover:bg-amber-500/10">
                        <RadioGroupItem id="ebay-not-ready-to-launch" value="ebay-launch-not-ready" className="mt-0.5" />
                        <span className="min-w-0"><span className="flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-200"><AlertCircle className="size-4" /> Not ready to launch</span><span className="mt-1 block text-xs font-normal text-muted-foreground">Not live and does not have a current passing preflight.</span></span>
                      </Label>
                    </RadioGroup>
                  ) : (
                    <>
                      <Input value="Is any of" disabled />
                      <div className="relative">
                        <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
                        <Input className="pl-8" placeholder="Search values" value={filterSearch} onChange={(event) => setFilterSearch(event.target.value)} />
                      </div>
                      {facetsLoading ? (
                        <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                          <Loader2 className="size-3 animate-spin" /> Loading filter values...
                        </div>
                      ) : null}
                      <div className="max-h-52 overflow-y-auto rounded-md border">
                        <div className="flex items-center justify-between gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
                          <span>{matchingValues.length} shown</span>
                          {!(filterField === "channelStatus" && channelFilterScope === "ebay") ? <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!matchingValues.length} onClick={() => setFilterSelection((current) => {
                            const allShownSelected = matchingValues.every((value) => current.includes(value))
                            const next = allShownSelected ? current.filter((value) => !matchingValues.includes(value)) : Array.from(new Set([...current, ...matchingValues]))
                            setPendingFilters((pending) => ({ ...pending, [filterField]: next }))
                            return next
                          })}>
                            {matchingValues.length && matchingValues.every((value) => filterSelection.includes(value)) ? "Clear shown" : "Select all shown"}
                          </Button> : <span>Choose one</span>}
                        </div>
                        {matchingValues.map((value) => (
                          <label key={value} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted">
                            <Checkbox checked={filterSelection.includes(value)} onCheckedChange={() => setFilterSelection((current) => {
                              const next = filterField === "channelStatus" && channelFilterScope === "ebay"
                                ? (current.includes(value) ? [] : [value])
                                : (current.includes(value) ? current.filter((item) => item !== value) : [...current, value])
                              setPendingFilters((pending) => ({ ...pending, [filterField]: next }))
                              return next
                            })} />
                            {activeDefinition.display(value)}
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                  {pendingSelections.length > 0 ? (
                    <div className="flex flex-wrap gap-1 border-t pt-3">
                      {pendingSelections.map((selection) => (
                        <Button
                          key={`${selection.key}-${selection.value}`}
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="h-7 max-w-full gap-1 px-2 text-xs"
                          onClick={() => {
                            const next = (pendingFilters[selection.key] || []).filter(
                              (value) => value !== selection.value,
                            )
                            setPendingFilters((current) => ({
                              ...current,
                              [selection.key]: next,
                            }))
                            if (selection.key === filterField) {
                              setFilterSelection(next)
                            }
                          }}
                        >
                          <span className="truncate">{selection.label}</span>
                          <X className="size-3 shrink-0" />
                        </Button>
                      ))}
                    </div>
                  ) : null}
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setFilterOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={applyFilter}
                      disabled={!pendingSelections.length && filterField !== "stockQtyRange"}
                    >
                      Apply filter
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            <div className="sm:block"><CatalogCreationDateFilter from={filters.createdFrom} to={filters.createdTo} onApply={(from, to) => {
              const next = normalizeUnifiedCatalogFilters({ ...filters, catalogStatus: "managed" });
              if (from) next.createdFrom = from; else delete next.createdFrom;
              if (to) next.createdTo = to; else delete next.createdTo;
              setFilters(next);
              setAllFiltered(false);
              setSelectedIds(new Set());
              void load(1, next);
            }} /></div>
            <Button
              size="sm"
              variant="ghost"
              onClick={resetFilters}
              disabled={!Object.keys(filters).length && !query}
            >
              Clear
            </Button>
              {managedCatalogView ? <><Button size="icon" variant="outline" className="sm:hidden" onClick={() => void exportProducts()} aria-label="Export catalog"><FileDown className="size-4" /></Button><Button size="sm" variant="outline" className="hidden sm:inline-flex" onClick={() => void exportProducts()}><FileDown className="size-4" /> Export</Button></> : <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300">Source records</Badge>}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="hidden sm:inline-flex">
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {columns.map(([key, label]) => (
                  <DropdownMenuItem
                    key={key}
                    onSelect={(event) => {
                      event.preventDefault();
                      toggleColumn(key);
                    }}
                  >
                    <Checkbox checked={visible[key]} /> {label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={resetColumns}>
                  Reset default columns
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="ml-auto hidden items-center gap-1 rounded-md border p-1 sm:flex">
              <Button
                size="sm"
                variant={!compact ? "secondary" : "ghost"}
                onClick={() => setDensity(false)}
              >
                Regular
              </Button>
              <Button
                size="sm"
                variant={compact ? "secondary" : "ghost"}
                onClick={() => setDensity(true)}
              >
                Compact
              </Button>
            </div>
          </div>
          {readinessChannels.length > 0 && managedCatalogView && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/35 px-3 py-2">
              <span className="text-xs font-semibold text-foreground">Ready to launch</span>
              <span className="text-xs text-muted-foreground">Check a channel when needed. Readiness uses the current filters and never publishes automatically.</span>
              {readinessChannels.map(({ channel, marketplace, channelStatus }) => {
                const result = channelReadyCounts[marketplace]
                return <div key={channel.id || channel.name} className="flex items-center gap-1 border-l pl-2 first:border-l-0 first:pl-0">
                  <span className="text-xs font-medium text-muted-foreground">{channel.name}</span>
                  <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs text-emerald-700 hover:bg-emerald-500/15 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200" onClick={() => result?.status === "ready" ? applyChannelFilter(channelStatus) : loadChannelReadyCount(marketplace, channelStatus)}>
                    {!result || result.status === "idle" ? "Check" : result.status === "loading" ? <><Loader2 className="size-3 animate-spin" /> Counting</> : result.status === "unavailable" ? "Retry" : `${numberLabel(result.count)} ready`}
                  </Button>
                </div>
              })}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              {countStatus === "ready" ? `${numberLabel(total)} filtered` : countStatus === "loading" ? "Counting matches..." : "Count could not finish"}
              {countStatus === "unavailable" && <Button size="sm" variant="ghost" onClick={() => retryCatalogCount.current?.()} disabled={!retryCatalogCount.current}><RefreshCw className="size-3" />Retry count</Button>} |{" "}
              {rows.length
                ? `${numberLabel((page - 1) * pageSize + 1)}-${numberLabel((page - 1) * pageSize + rows.length)}`
                : "0"}{" "}
              shown | page {page}
            </span>
            {Object.entries(filters).filter(([key]) => key !== "stockQtyOperator").map(([key, value]) => (
              <Badge
                key={key}
                variant="outline"
                className="gap-1 border-primary/35 bg-primary/5 text-primary"
              >
                {key === "stockQty"
                  ? filters.stockQtyOperator === "between"
                    ? `Quantity is ${value.split("|")[0]} to ${value.split("|")[1]}`
                    : filters.stockQtyOperator === "gte"
                      ? `Quantity is at least ${value}`
                      : filters.stockQtyOperator === "lte"
                        ? `Quantity is at most ${value}`
                        : `Quantity is ${value}`
                  : key === "createdFrom"
                  ? `Created on or after ${value}`
                  : key === "createdTo"
                    ? `Created on or before ${value}`
                    : filterDefinitions[key]?.label
                      ? `${filterDefinitions[key].label} is ${value
                          .split("|")
                          .map(
                            (item) =>
                              filterDefinitions[key]?.display(item) || item,
                          )
                          .join(", ")}`
                      : `Creation source is ${value}`}
                <button className="ml-1" onClick={() => removeFilter(key)}>
                  x
                </button>
              </Badge>
            ))}
          </div>
          {selectionCount > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2">
              <p className="text-sm font-medium">
                {allFiltered
                  ? `${numberLabel(selectionCount)} filtered ${sourceCatalogView ? "records" : "products"} selected`
                  : `${numberLabel(selectionCount)} selected`}
              </p>
              {!allFiltered && total > selectedIds.size ? (
                <Button
                  size="sm"
                  variant="link"
                  className="h-auto px-0 text-sm"
                  onClick={() => {
                    setSelectedIds(new Set());
                    setAllFiltered(true);
                  }}
                >
                  Select all {numberLabel(total)} results
                </Button>
              ) : null}
              <span className="mr-auto text-sm text-muted-foreground">
                Total qty: <span className="font-medium text-foreground">{allFiltered && sourceCatalogView ? "Calculated in import" : numberLabel(selectedQty)}</span>
              </span>
              <Button className="w-full sm:w-auto"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSelectedIds(new Set());
                  setAllFiltered(false);
                }}
              >
                Clear
              </Button>
              {sourceCatalogView ? <ContextActions label="Actions" actions={[
                { id: "add-managed", label: needsReviewView ? "Add to managed catalog" : "Add or refresh managed catalog", description: "Move the selected source records into the managed catalog.", icon: <Boxes className="size-4" />, onSelect: () => void addSourceRowsToManaged() },
              ]} /> : <ContextActions label="Actions" actions={[
                { id: "export", label: "Export selection", description: "Download the selected catalog records as a CSV.", icon: <FileDown className="size-4" />, onSelect: () => void exportProducts() },
                { id: "check-walmart-readiness", label: "Validate Walmart readiness", description: "Check existing-offer and new-item requirements without publishing. Stock is not required to create the offer; results remain filterable for 24 hours.", icon: <Search className="size-4" />, onSelect: () => {
                  setWalmartReadinessMode(true)
                  const requestFilters = { ...normalizeUnifiedCatalogFilters(filters) }; delete requestFilters.catalogStatus
                  setWalmartMatchSkus(allFiltered ? [] : [...selectedIds])
                  setWalmartMatchSelection(allFiltered ? { allFiltered: true, query, filters: requestFilters, count: total } : undefined)
                  setWalmartMatchOpen(true)
                } },
                { id: "match-walmart-upc", label: "Match on Walmart by UPC", description: "Search selected products in background batches.", icon: <Search className="size-4" />, onSelect: () => {
                  setWalmartReadinessMode(false)
                  const requestFilters = { ...normalizeUnifiedCatalogFilters(filters) }; delete requestFilters.catalogStatus
                  setWalmartMatchSkus(allFiltered ? [] : [...selectedIds])
                  setWalmartMatchSelection(allFiltered ? { allFiltered: true, query, filters: requestFilters, count: total } : undefined)
                  setWalmartMatchOpen(true)
                } },
                { id: "launch-walmart-existing", label: "Launch ready Walmart existing offers", description: "Revalidate and submit eligible existing-catalog matches in feeds of up to 1,000. Unmatched items remain for new-item setup.", icon: <Store className="size-4" />, onSelect: () => {
                  const requestFilters = { ...normalizeUnifiedCatalogFilters(filters) }; delete requestFilters.catalogStatus
                  void launchWalmartExisting({ skus: allFiltered ? [] : [...selectedIds], ...(allFiltered ? { allFiltered: true, query, filters: requestFilters } : {}) })
                } },
                { id: "review-walmart", label: "Review Walmart new-item launch", description: "Review one SKU or up to 100 selected SKUs that need a new Walmart catalog item.", icon: <Store className="size-4" />, onSelect: () => {
                  const skus = rows.filter(item => selectedIds.has(String(item.id || item.sku || ""))).map(item => String(item.sku || "")).filter(Boolean)
                  if (allFiltered || selectedIds.size !== skus.length || skus.length > 100) { toast.error("Select up to 100 items on the current page for Walmart review."); return }
                  if (skus.length === 1) { setWalmartSingleLaunchSku(skus[0]); return }
                  window.location.href = `/products?action=walmart-launch&skus=${encodeURIComponent(skus.join("\n"))}`
                } },
                { id: "review-shopify", label: "Review Shopify", description: "Create a review job before launching selected SKUs.", icon: <ShoppingBag className="size-4" />, onSelect: () => void runShopifyLaunch(false) },
                { id: "launch-shopify", label: "Launch Shopify", description: "Create selected ready SKUs in Shopify.", icon: <ShoppingBag className="size-4" />, onSelect: () => void runShopifyLaunch(true) },
                { id: "review-links", label: "Review Shopify links", description: "Find existing Shopify variants that may match this selection.", icon: <Link2 className="size-4" />, group: "Utilities", onSelect: () => void runShopifyLink(false) },
                { id: "link-existing", label: "Link existing Shopify", description: "Connect selected records to matching Shopify variants.", icon: <Link2 className="size-4" />, group: "Utilities", onSelect: () => void runShopifyLink(true) },
                { id: "validate-ebay", label: "Validate eBay readiness", description: "Run the full eBay launch validator without publishing and save the result for 24 hours.", icon: <CheckCircle2 className="size-4" />, onSelect: () => openEbayLaunch(undefined, "review") },
                { id: "launch-ebay", label: "Launch eBay", description: "Choose eBay policies and create listings for the selection.", icon: <Store className="size-4" />, onSelect: () => openEbayLaunch() },
                { id: "set-active", label: "Set active", description: "Mark the selected catalog records active.", icon: <CheckCircle2 className="size-4" />, group: "Utilities", onSelect: () => runBulk("set-active") },
                { id: "set-inactive", label: "Set inactive", description: "Keep selected records in the catalog without treating them as active.", icon: <Archive className="size-4" />, group: "Utilities", onSelect: () => runBulk("set-inactive") },
                { id: "set-channel-inactive", label: "Set channel status", description: "Disable or restore selected SKUs on specific channels. Inactive channels are immediately queued for zero inventory.", icon: <Power className="size-4" />, group: "Utilities", onSelect: () => openChannelStatus() },
                { id: "set-replenishable", label: "Set replenishable", description: "Choose channels and a vendor, SKU, or channel-default inventory target without changing warehouse stock.", icon: <RefreshCw className="size-4" />, group: "Utilities", onSelect: () => openReplenishable(true) },
                { id: "clear-replenishable", label: "Use physical inventory", description: "Remove the replenishable override and resume normal stock and safety rules.", icon: <Warehouse className="size-4" />, group: "Utilities", onSelect: () => openReplenishable(false) },
                { id: "discontinue", label: "Discontinue", description: "Prevent selected records from future marketplace launches.", icon: <AlertCircle className="size-4" />, group: "Danger zone", destructive: true, onSelect: () => runBulk("set-discontinued") },
                { id: "delete", label: "Delete selected", description: "Remove selected catalog records from DataPlus.", icon: <Trash2 className="size-4" />, group: "Danger zone", destructive: true, onSelect: () => runBulk("delete") },
              ]} />}
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="grid gap-2 p-4">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : (
            <>
            <div className="divide-y md:hidden">
              {rows.map((item) => {
                const id = String(item.id || item.sku || "")
                const isManagedItem = item.inProducts === undefined ? managedCatalogView : Boolean(item.inProducts || item.productCatalogId)
                const managedSku = String(item.productCatalogSku || item.sku || "")
                const ready = readiness(item)
                const stock = Number(item.qty ?? item.stockQty ?? 0)
                const productTitle = item.marketplaceTitle || item.title || "Untitled product"
                const mainCategoryPath = String(item.mainCategory || item.category || "")
                const readinessClass = ready.score === 100
                  ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : ready.score >= 60
                    ? "border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300"
                    : "border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                return <article key={`mobile-${id}`} className="grid min-w-0 grid-cols-[auto_52px_minmax(0,1fr)_auto] gap-x-3 gap-y-2 p-3">
                  <Checkbox className="mt-1" aria-label={`Select ${item.sku}`} checked={allFiltered || selectedIds.has(id)} onCheckedChange={(checked) => toggleRow(id, checked === true)} />
                  <button type="button" className="row-span-2 grid size-13 place-items-center overflow-hidden rounded-md border bg-muted" onClick={() => setSelected(item)} aria-label={`Quick view ${item.sku}`}>
                    {item.defaultImage ? <img src={item.defaultImage} alt="" className="max-h-full max-w-full object-contain" /> : <Boxes className="size-5 text-muted-foreground" />}
                  </button>
                  <div className="min-w-0">
                    <a className="block truncate font-mono text-xs font-semibold text-primary hover:underline" href={`/products/${encodeURIComponent(managedSku)}`}>{item.sku}</a>
                    <p className="line-clamp-2 text-sm font-semibold leading-5">{productTitle}</p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="size-9" aria-label={`Actions for ${item.sku}`}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setSelected(item)}>Quick view</DropdownMenuItem>
                      {sourceCatalogView ? <>
                        {isManagedItem ? <DropdownMenuItem asChild><a href={`/products/${encodeURIComponent(managedSku)}`}>Open managed product</a></DropdownMenuItem> : <DropdownMenuItem onClick={() => void addSourceRowsToManaged([String(item.sku || "")])}>Add to managed catalog</DropdownMenuItem>}
                      </> : <>
                        <DropdownMenuItem asChild><a href={`/products/${encodeURIComponent(managedSku)}`}>Open product page</a></DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void syncShopifyStatus(item)}>Refresh Shopify status</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void runShopifyLaunch(false, [String(item.sku || "")])}>Review Shopify launch</DropdownMenuItem>
                        <DropdownMenuItem disabled={Boolean(item.toBeDiscontinued || item.shopifyId)} onClick={() => void runShopifyLaunch(true, [String(item.sku || "")])}>Launch Shopify</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openEbayLaunch([String(item.sku || id)])}>Launch eBay</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => runBulkRow(id, "set-active")}>Set active</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => runBulkRow(id, "set-inactive")}>Set inactive</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openChannelStatus([id])}>Set channel status</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => runBulkRow(id, "set-discontinued")}>Discontinue</DropdownMenuItem>
                      </>}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <div className="col-start-3 col-end-5 flex min-w-0 flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className={readinessClass}>{ready.score}% ready</Badge>
                    <Badge variant="outline" className={stock > 0 ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300"}>{numberLabel(stock)} in stock</Badge>
                    <span className="text-xs font-semibold">{moneyLabel(item.websitePrice ?? item.price)}</span>
                  </div>
                  <dl className="col-start-2 col-end-5 grid min-w-0 grid-cols-2 gap-x-3 gap-y-1 rounded-md bg-muted/35 p-2 text-xs">
                    <div className="min-w-0"><dt className="text-muted-foreground">Supplier</dt><dd className="truncate font-medium">{item.supplier || item.vendor || "Unassigned"}</dd></div>
                    <div className="min-w-0"><dt className="text-muted-foreground">Brand</dt><dd className="truncate font-medium">{item.brand || "No brand"}</dd></div>
                    <div className="col-span-2 min-w-0"><dt className="text-muted-foreground">Category</dt><dd className="truncate font-medium">{catalogCategoryLeaf(mainCategoryPath) || "Uncategorized"}</dd></div>
                  </dl>
                  {visible.channels ? <div className="col-start-2 col-end-5 flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">Channels</span><CatalogChannelMarks item={item} channels={channels} /></div> : null}
                </article>
              })}
              {!rows.length ? <div className="p-8 text-center text-sm text-muted-foreground">No approved products match these filters.</div> : null}
            </div>
            <div className="relative hidden overflow-x-auto md:block">
              <Table className={cn("min-w-[1080px]", compact && "text-xs")}>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        aria-label="Select current page"
                        checked={pageSelected}
                        onCheckedChange={(checked) =>
                          togglePage(checked === true)
                        }
                      />
                    </TableHead>
                    <TableHead className="w-32 min-w-32">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => changeSort("sku")}
                      >
                        SKU
                      </Button>
                    </TableHead>
                    <TableHead className="w-56 min-w-56">Title</TableHead>
                    {visible.readiness && <TableHead className="w-24">Catalog completeness</TableHead>}
                    {visible.catalogStatus && <TableHead className="w-28">Catalog status</TableHead>}
                    {visible.suppliers && <TableHead className="w-36">Suppliers</TableHead>}
                    {visible.stock && (
                      <TableHead>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => changeSort("stock")}
                        >
                          Stock
                        </Button>
                      </TableHead>
                    )}
                    {visible.price && (
                      <TableHead>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => changeSort("price")}
                        >
                          Price
                        </Button>
                      </TableHead>
                    )}
                    {visible.brand && (
                      <TableHead>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => changeSort("brand")}
                        >
                          Brand
                        </Button>
                      </TableHead>
                    )}
                    {visible.category && (
                      <TableHead>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => changeSort("category")}
                        >
                          Category
                        </Button>
                      </TableHead>
                    )}
                    {visible.channels && <TableHead className="w-32">Channels</TableHead>}
                    {visible.images && <TableHead className="w-16 text-center">Images</TableHead>}
                    {visible.updated && (
                      <TableHead>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => changeSort("updated")}
                        >
                          Updated
                        </Button>
                      </TableHead>
                    )}
                    {visible.created && (
                      <TableHead>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => changeSort("created")}
                        >
                          Created
                        </Button>
                      </TableHead>
                    )}
                    {visible.verified && <TableHead>Category</TableHead>}
                    {visible.hazardous && <TableHead>Hazmat</TableHead>}
                    {visible.shopifySynced && (
                      <TableHead>Shopify sync</TableHead>
                    )}
                    {visible.manufacturer && (
                      <TableHead>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => changeSort("manufacturer")}
                        >
                          Manufacturer
                        </Button>
                      </TableHead>
                    )}
                    {visible.vendorSku && (
                      <TableHead>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => changeSort("vendorSku")}
                        >
                          Vendor SKU
                        </Button>
                      </TableHead>
                    )}
                    {visible.status && (
                      <TableHead>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => changeSort("status")}
                        >
                          Status
                        </Button>
                      </TableHead>
                    )}
                    {visible.shadows && <TableHead>Shadows</TableHead>}
                    {visible.uom && <TableHead>UOM</TableHead>}
                    {visible.shipping && <TableHead>Shipping</TableHead>}
                    <TableHead className="sticky right-0 z-20 w-12 min-w-12 bg-background text-right shadow-[-8px_0_12px_-10px_hsl(var(--foreground)/0.6)]"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((item) => {
                    const id = String(item.id || item.sku || "");
                    const isManagedItem = item.inProducts === undefined
                      ? managedCatalogView
                      : Boolean(item.inProducts || item.productCatalogId)
                    const managedSku = String(item.productCatalogSku || item.sku || "")
                    const ready = readiness(item);
                    const imageCount = Number(
                      item.imageCount || (item.defaultImage ? 1 : 0),
                    );
                    const stock = Number(item.qty ?? item.stockQty ?? 0);
                    const productTitle = item.marketplaceTitle || item.title || "Untitled product";
                    const compactTitle = productTitle.length > 30 ? `${productTitle.slice(0, 30)}...` : productTitle;
                    const mainCategoryPath = String(item.mainCategory || item.category || "")
                    const sourceCategoryPath = String(item.vendorCategory || item.sourceCategory || "")
                    const readinessClass =
                      ready.score === 100
                        ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : ready.score >= 60
                          ? "border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300"
                          : "border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300";
                    return (
                      <TableRow key={id} className={compact ? "h-10" : ""}>
                        <TableCell>
                          <Checkbox
                            aria-label={`Select ${item.sku}`}
                            checked={allFiltered || selectedIds.has(id)}
                            onCheckedChange={(checked) =>
                              toggleRow(id, checked === true)
                            }
                          />
                        </TableCell>
                        <TableCell className="w-32 min-w-32 max-w-32">
                          <div className="group flex items-center gap-1">
                            <a className="font-mono text-xs font-semibold hover:text-primary hover:underline" href={`/products/${encodeURIComponent(managedSku)}`}>{item.sku}</a>
                            <Tooltip><TooltipTrigger asChild><Button size="icon" variant="ghost" className="size-6 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" onClick={() => setSelected(item)} aria-label={`Quick view ${item.sku}`}><Eye className="size-3.5" /></Button></TooltipTrigger><TooltipContent>Quick view</TooltipContent></Tooltip>
                          </div>
                        </TableCell>
                        <TableCell className="w-56 min-w-56 max-w-56">
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted">{item.defaultImage ? <img src={item.defaultImage} alt="" className="max-h-full max-w-full object-contain" /> : <Boxes className="size-4 text-muted-foreground" />}</div>
                            <p className="line-clamp-1 font-medium" title={productTitle}>{compactTitle}</p>
                          </div>
                        </TableCell>
                        {visible.readiness && (
                          <TableCell>
                            <Badge variant="outline" className={readinessClass}>
                              {ready.score}%
                            </Badge>
                            {!compact && ready.missing && (
                              <p className="mt-1 max-w-28 truncate text-xs text-muted-foreground">
                                {ready.missing}
                              </p>
                            )}
                          </TableCell>
                        )}
                        {visible.catalogStatus && (
                          <TableCell>
                            {isManagedItem ? <div className="grid gap-1"><Badge variant="outline" className="w-fit border-emerald-500/35 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300">Managed</Badge>{!compact && item.productCatalogDiffs?.length ? <p className="max-w-36 truncate text-xs text-amber-700 dark:text-amber-300" title={item.productCatalogDiffs.join(", ")}>Source changes: {item.productCatalogDiffs.join(", ")}</p> : null}</div> : <Badge variant="outline" className="border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300">Needs review</Badge>}
                          </TableCell>
                        )}
                        {visible.suppliers && <TableCell className="w-36 max-w-36"><CatalogSupplierCoverage item={item} /></TableCell>}
                        {visible.stock && (
                          <TableCell
                            className={
                              stock > 0
                                ? "font-medium text-emerald-700 dark:text-emerald-300"
                                : "font-medium text-destructive"
                            }
                          >
                            <InventorySourceCell item={item} />
                          </TableCell>
                        )}
                        {visible.price && (
                          <TableCell className="font-medium">
                            {moneyLabel(item.websitePrice ?? item.price)}
                          </TableCell>
                        )}
                    {visible.brand && (
                          <TableCell className="w-32 max-w-32 truncate" title={item.brand || "No brand"}>{catalogCellText(item.brand || "No brand", 20)}</TableCell>
                        )}
                        {visible.category && (
                          <TableCell className="w-36 max-w-36">
                            <p
                              className="truncate"
                              title={mainCategoryPath || "Uncategorized"}
                            >
                              {catalogCategoryLeaf(mainCategoryPath)}
                            </p>
                            {!compact && (
                              <p className="truncate text-xs text-muted-foreground" title={sourceCategoryPath || "No vendor category"}>
                                {sourceCategoryPath ? catalogCategoryLeaf(sourceCategoryPath) : "No vendor category"}
                              </p>
                            )}
                          </TableCell>
                        )}
                        {visible.channels && <TableCell className="w-32"><CatalogChannelMarks item={item} channels={channels} /></TableCell>}
                        {visible.images && <TableCell className="w-16 text-center">{imageCount}</TableCell>}
                        {visible.updated && (
                          <TableCell>
                            {item.updatedAt
                              ? new Date(item.updatedAt).toLocaleDateString()
                              : "-"}
                          </TableCell>
                        )}
                        {visible.created && (
                          <TableCell>
                            {item.createdAt
                              ? new Date(item.createdAt).toLocaleDateString()
                              : "-"}
                          </TableCell>
                        )}
                        {visible.verified && (
                          <TableCell>
                            <Badge
                              variant={
                                item.categoryVerified ? "default" : "outline"
                              }
                            >
                              {item.categoryVerified ? "Verified" : "Review"}
                            </Badge>
                          </TableCell>
                        )}
                        {visible.hazardous && (
                          <TableCell>
                            {item.hazardous ? (
                              <Badge variant="destructive">Hazardous</Badge>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                        )}
                        {visible.shopifySynced && (
                          <TableCell>
                            {item.shopifySyncedAt
                              ? new Date(
                                  item.shopifySyncedAt,
                                ).toLocaleDateString()
                              : "-"}
                          </TableCell>
                        )}
                        {visible.manufacturer && (
                          <TableCell className="w-36 max-w-36 truncate" title={item.manufacturer || "-"}>{catalogCellText(item.manufacturer, 20)}</TableCell>
                        )}
                        {visible.vendorSku && (
                          <TableCell>{item.vendorSku || "-"}</TableCell>
                        )}
                        {visible.status && (
                          <TableCell>
                            <Badge
                              variant={
                                item.active === false ? "outline" : "secondary"
                              }
                            >
                              {item.status ||
                                (item.active === false ? "Inactive" : "Active")}
                            </Badge>
                          </TableCell>
                        )}
                        {visible.shadows && (
                          <TableCell>
                            {numberLabel(item.shadowSkuCount)}
                          </TableCell>
                        )}
                        {visible.uom && (
                          <TableCell>
                            {item.uomDisplay ||
                              [item.uomQty, item.uom]
                                .filter(Boolean)
                                .join(" ") ||
                              "Each"}
                          </TableCell>
                        )}
                        {visible.shipping && (
                          <TableCell>
                            <Badge
                              variant={
                                item.shippingClass === "ltl"
                                  ? "destructive"
                                  : "outline"
                              }
                            >
                              {item.shippingMethod ||
                                item.shippingClass ||
                                "Unclassified"}
                            </Badge>
                          </TableCell>
                        )}
                        <TableCell className="sticky right-0 z-10 w-12 min-w-12 bg-background text-right shadow-[-8px_0_12px_-10px_hsl(var(--foreground)/0.6)]">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                title="Product actions"
                              >
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => setSelected(item)}
                              >
                                Quick view
                              </DropdownMenuItem>
                              {sourceCatalogView ? <>
                                {isManagedItem ? <DropdownMenuItem asChild><a href={`/products/${encodeURIComponent(managedSku)}`}>Open managed product</a></DropdownMenuItem> : <DropdownMenuItem onClick={() => void addSourceRowsToManaged([String(item.sku || "")])}>Add to managed catalog</DropdownMenuItem>}
                              </> : <>
                                <DropdownMenuItem asChild>
                                  <a
                                    href={`/products/${encodeURIComponent(item.sku || "")}`}
                                  >
                                    Open product page
                                  </a>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => void syncShopifyStatus(item)}
                                >
                                  Refresh Shopify status
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() =>
                                    void runShopifyLaunch(false, [
                                      String(item.sku || ""),
                                    ])
                                  }
                                >
                                  Review Shopify launch
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={Boolean(
                                    item.toBeDiscontinued || item.shopifyId,
                                  )}
                                  onClick={() =>
                                    void runShopifyLaunch(true, [
                                      String(item.sku || ""),
                                    ])
                                  }
                                >
                                  Launch Shopify
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => openEbayLaunch([String(item.sku || id)])}
                                >
                                  Launch eBay
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => runBulkRow(id, "set-active")}
                                >
                                  Set active
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => runBulkRow(id, "set-inactive")}
                                >
                                  Set inactive
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => openChannelStatus([id])}>
                                  Set channel status
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() =>
                                    runBulkRow(id, "set-discontinued")
                                  }
                                >
                                  Discontinue
                                </DropdownMenuItem>
                              </>}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!rows.length && (
                    <TableRow>
                      <TableCell
                        colSpan={cellCount}
                        className="h-28 text-center text-muted-foreground"
                      >
                        No approved products match these filters.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            </>
          )}
        </CardContent>
        <div className="grid gap-3 border-t p-3 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Button
              size="sm"
              variant="outline"
              onClick={() => togglePage(true)}
              disabled={loading || !pageIds.length}
            >
              Select page
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setSelectedIds(new Set());
                setAllFiltered(true);
              }}
              disabled={!total || countStatus !== "ready"}
            >
              Select all filtered
            </Button>
          </div>
          <div className="flex items-center justify-between gap-2 sm:flex-wrap sm:justify-end">
            <Select value={String(pageSize)} onValueChange={setPageLimit}>
              <SelectTrigger className="hidden h-8 w-20 text-xs sm:flex">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs font-medium text-muted-foreground sm:hidden">Page {page}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={loading || page <= 1}
              onClick={() => load(page - 1)}
            >
              Previous
            </Button>
            {total > 0 &&
              Array.from(
                { length: Math.min(5, Math.ceil(total / pageSize)) },
                (_, index) => {
                  const totalPages = Math.ceil(total / pageSize);
                  const start = Math.min(
                    Math.max(1, page - 2),
                    Math.max(1, totalPages - 4),
                  );
                  const number = start + index;
                  return (
                    <Button
                      key={number}
                      size="sm"
                      className="hidden sm:inline-flex"
                      variant={number === page ? "secondary" : "outline"}
                      onClick={() => load(number)}
                    >
                      {number}
                    </Button>
                  );
                },
              )}
            {total > 0 && Math.ceil(total / pageSize) > 5 && (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                of {numberLabel(Math.ceil(total / pageSize))}
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={
                loading ||
                (total ? page >= Math.ceil(total / pageSize) : !hasMore)
              }
              onClick={() => load(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>
      <Dialog open={ebayLaunchOpen} onOpenChange={setEbayLaunchOpen}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-4xl">
          <DialogHeader className="shrink-0 pr-6">
            <DialogTitle>eBay listing lifecycle</DialogTitle>
            <DialogDescription>Choose the batch operation and its fallback policy bundle. Product-level eBay settings and mapped categories always take precedence over these values.</DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 gap-4 overflow-y-auto overflow-x-hidden pr-1 lg:grid-cols-[minmax(0,1fr)_230px]">
            <div className="grid min-w-0 content-start gap-4 sm:grid-cols-2 [&>div]:min-w-0">
              <Field label="Lifecycle action"><Select value={ebayLaunchDraft.lifecycleAction} onValueChange={(value) => setEbayLaunchDraft((current) => ({ ...current, lifecycleAction: value }))}><SelectTrigger className="w-full min-w-0 [&_[data-slot=select-value]]:block [&_[data-slot=select-value]]:truncate"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="launch">Launch new listings</SelectItem><SelectItem value="review">eBay launch preflight (no publish)</SelectItem><SelectItem value="compliance">Compliance audit</SelectItem><SelectItem value="revise">Revise live listings</SelectItem><SelectItem value="relist">Relist ended listings</SelectItem><SelectItem value="end">End active listings</SelectItem></SelectContent></Select></Field>
              <Field label="Marketplace"><Select value={ebayLaunchDraft.marketplaceId} onValueChange={(value) => setEbayLaunchDraft((current) => ({ ...current, marketplaceId: value }))}><SelectTrigger className="w-full min-w-0 [&_[data-slot=select-value]]:block [&_[data-slot=select-value]]:truncate"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="EBAY_US">United States</SelectItem><SelectItem value="EBAY_CA">Canada</SelectItem><SelectItem value="EBAY_GB">United Kingdom</SelectItem><SelectItem value="EBAY_AU">Australia</SelectItem></SelectContent></Select></Field>
              <Field label="Merchant location">
                {ebayMerchantLocations.length ? <Select value={ebayLaunchDraft.merchantLocationKey || "none"} onValueChange={(value) => setEbayLaunchDraft((current) => ({ ...current, merchantLocationKey: value === "none" ? "" : value }))}><SelectTrigger className="w-full min-w-0 [&_[data-slot=select-value]]:block [&_[data-slot=select-value]]:truncate"><SelectValue placeholder="Select location" /></SelectTrigger><SelectContent><SelectItem value="none">No merchant location selected</SelectItem>{ebayMerchantLocations.map((location: any) => <SelectItem key={`launch-location-${String(location.merchantLocationKey || location.key || location.name)}`} value={String(location.merchantLocationKey || location.key || location.name)}>{String(location.name || location.merchantLocationKey || location.key)}{location.status ? ` / ${String(location.status)}` : ""}</SelectItem>)}</SelectContent></Select> : <Input value={ebayLaunchDraft.merchantLocationKey} placeholder="Sync locations in eBay channel settings" onChange={(event) => setEbayLaunchDraft((current) => ({ ...current, merchantLocationKey: event.target.value }))} />}
              </Field>
              <Field label="Payment policy"><Select value={ebayLaunchDraft.paymentPolicyId || "none"} onValueChange={(value) => setEbayLaunchDraft((current) => ({ ...current, paymentPolicyId: value === "none" ? "" : value }))}><SelectTrigger className="w-full min-w-0 [&_[data-slot=select-value]]:block [&_[data-slot=select-value]]:truncate"><SelectValue placeholder="Select imported policy" /></SelectTrigger><SelectContent><SelectItem value="none">No payment policy selected</SelectItem>{ebayPaymentPolicies.map((policy: any) => <SelectItem key={`launch-payment-${String(policy.id)}`} value={String(policy.id)}>{String(policy.name || policy.id)}</SelectItem>)}</SelectContent></Select></Field>
              <Field label="Return policy"><Select value={ebayLaunchDraft.returnPolicyId || "none"} onValueChange={(value) => setEbayLaunchDraft((current) => ({ ...current, returnPolicyId: value === "none" ? "" : value }))}><SelectTrigger className="w-full min-w-0 [&_[data-slot=select-value]]:block [&_[data-slot=select-value]]:truncate"><SelectValue placeholder="Select imported policy" /></SelectTrigger><SelectContent><SelectItem value="none">No return policy selected</SelectItem>{ebayReturnPolicies.map((policy: any) => <SelectItem key={`launch-return-${String(policy.id)}`} value={String(policy.id)}>{String(policy.name || policy.id)}</SelectItem>)}</SelectContent></Select></Field>
              <Field label="Shipping / fulfillment policy"><Select value={ebayLaunchDraft.fulfillmentPolicyId || "none"} onValueChange={(value) => setEbayLaunchDraft((current) => ({ ...current, fulfillmentPolicyId: value === "none" ? "" : value }))}><SelectTrigger className="w-full min-w-0 [&_[data-slot=select-value]]:block [&_[data-slot=select-value]]:truncate"><SelectValue placeholder="Select imported policy" /></SelectTrigger><SelectContent><SelectItem value="none">No fulfillment policy selected</SelectItem>{ebayFulfillmentPolicies.map((policy: any) => <SelectItem key={`launch-fulfillment-${String(policy.id)}`} value={String(policy.id)}>{String(policy.name || policy.id)}</SelectItem>)}</SelectContent></Select></Field>
              <Field label="Fallback eBay category ID"><Input value={ebayLaunchDraft.categoryId} placeholder="SKU mapping takes precedence" onChange={(event) => setEbayLaunchDraft((current) => ({ ...current, categoryId: event.target.value }))} /></Field>
              <Field label="Store category">
                {ebayStoreCategories.length ? <Select value={ebayLaunchDraft.storeCategoryId || "none"} onValueChange={(value) => {
                  const selectedStoreCategory = ebayStoreCategories.find((category: any) => String(category.id || category.categoryId || "") === value)
                  setEbayLaunchDraft((current) => ({
                    ...current,
                    storeCategoryId: value === "none" ? "" : value,
                    storeCategoryName: value === "none" ? "" : String(selectedStoreCategory?.name || selectedStoreCategory?.categoryName || "")
                  }))
                }}><SelectTrigger className="w-full min-w-0 [&_[data-slot=select-value]]:block [&_[data-slot=select-value]]:truncate"><SelectValue placeholder="Select store category" /></SelectTrigger><SelectContent><SelectItem value="none">No store category selected</SelectItem>{ebayStoreCategories.map((category: any) => { const id = String(category.id || category.categoryId || ""); return id ? <SelectItem key={`launch-store-category-${id}`} value={id}>{String(category.name || category.categoryName || id)}</SelectItem> : null })}</SelectContent></Select> : <Input value={ebayLaunchDraft.storeCategoryId} placeholder="Optional eBay store category ID" onChange={(event) => setEbayLaunchDraft((current) => ({ ...current, storeCategoryId: event.target.value }))} />}
              </Field>
              <Field label="Listing template"><Select value={ebayLaunchDraft.listingTemplateId || "none"} onValueChange={(value) => setEbayLaunchDraft((current) => ({ ...current, listingTemplateId: value === "none" ? "" : value }))}><SelectTrigger className="w-full min-w-0 [&_[data-slot=select-value]]:block [&_[data-slot=select-value]]:truncate"><SelectValue placeholder="Optional listing template" /></SelectTrigger><SelectContent><SelectItem value="none">No listing template selected</SelectItem>{ebayListingTemplates.map((template: any) => { const id = String(template.id || ""); return id ? <SelectItem key={`launch-listing-template-${id}`} value={id}>{String(template.name || id)}</SelectItem> : null })}</SelectContent></Select></Field>
              <Field label="Item specifics template"><Select value={ebayLaunchDraft.itemSpecificTemplateId || "none"} onValueChange={(value) => setEbayLaunchDraft((current) => ({ ...current, itemSpecificTemplateId: value === "none" ? "" : value }))}><SelectTrigger className="w-full min-w-0 [&_[data-slot=select-value]]:block [&_[data-slot=select-value]]:truncate"><SelectValue placeholder="Optional item specifics template" /></SelectTrigger><SelectContent><SelectItem value="none">No item specifics template selected</SelectItem>{ebayItemSpecificTemplates.map((template: any) => { const id = String(template.id || ""); return id ? <SelectItem key={`launch-item-specific-template-${id}`} value={id}>{String(template.name || id)}</SelectItem> : null })}</SelectContent></Select></Field>
              <Field label="Dispatch time (days)"><Input type="number" min="0" max="30" value={ebayLaunchDraft.dispatchTimeDays} onChange={(event) => setEbayLaunchDraft((current) => ({ ...current, dispatchTimeDays: event.target.value }))} /></Field>
              <Field label="Condition"><Select value={ebayLaunchDraft.condition} onValueChange={(value) => setEbayLaunchDraft((current) => ({ ...current, condition: value }))}><SelectTrigger className="w-full min-w-0 [&_[data-slot=select-value]]:block [&_[data-slot=select-value]]:truncate"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="NEW">New</SelectItem><SelectItem value="USED_EXCELLENT">Used - Excellent</SelectItem><SelectItem value="USED_VERY_GOOD">Used - Very good</SelectItem><SelectItem value="USED_GOOD">Used - Good</SelectItem><SelectItem value="USED_ACCEPTABLE">Used - Acceptable</SelectItem></SelectContent></Select></Field>
              <Field label="Processing batch size"><Input type="number" min="25" max="1000" value={ebayLaunchDraft.limit} onChange={(event) => setEbayLaunchDraft((current) => ({ ...current, limit: event.target.value }))} /><p className="mt-1 text-xs text-muted-foreground">Controls checkpoint size only. It does not limit how many selected SKUs the job processes.</p></Field>
              <div className="sm:col-span-2"><ToggleField label="Enable Best Offer for this job" checked={ebayLaunchDraft.bestOfferEnabled} onCheckedChange={(value) => setEbayLaunchDraft((current) => ({ ...current, bestOfferEnabled: value }))} /></div>
              <div className="sm:col-span-2 space-y-1"><ToggleField label="Match eBay catalog" checked={ebayLaunchDraft.matchEbayCatalog} onCheckedChange={(value) => setEbayLaunchDraft((current) => ({ ...current, matchEbayCatalog: value }))} /><p className="text-xs text-muted-foreground">Uses one exact GTIN or brand and MPN match when available. If no safe match exists, DataPlus creates the listing from your product data. Turn this off to always create from scratch.</p></div>
            </div>
            <div className="grid min-w-0 content-start gap-3 rounded-md border bg-muted/30 p-4 text-sm">
              <div><p className="font-medium">Job scope</p><p className="mt-1 text-muted-foreground">{ebayLaunchAllFiltered ? `All ${numberLabel(total)} filtered products, processed automatically in ${numberLabel(Math.max(25, Math.min(1000, Number(ebayLaunchDraft.limit || 500) || 500)))}-SKU checkpoints` : `${numberLabel(ebayLaunchSkus.length)} selected product${ebayLaunchSkus.length === 1 ? "" : "s"}`}</p></div>
              <Separator />
              <div><p className="font-medium">Selected operation</p><p className="mt-1 text-xs text-muted-foreground">{ebayLaunchDraft.lifecycleAction === "review" || ebayLaunchDraft.lifecycleAction === "compliance" ? "This queues an inspection only. The result CSV explains every ready, missing, restricted, or already-live SKU." : ebayLaunchDraft.lifecycleAction === "end" ? "This ends active eBay offers only. DataPlus retains the listing record and full lifecycle history." : "DataPlus uses the SKU's price, quantity, category mapping, and identifiers first, then fills gaps from this policy bundle."}</p></div>
              <div><p className="font-medium">Operational record</p><p className="mt-1 text-xs text-muted-foreground">One job tracks the entire selection and produces a downloadable result file for successful, skipped, and failed rows.</p></div>
            </div>
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t pt-3 pb-[env(safe-area-inset-bottom)] sm:gap-2">
            <Button variant="outline" onClick={() => setEbayLaunchOpen(false)} disabled={ebayLaunchSaving}>Cancel</Button>
            {ebayLaunchDraft.lifecycleAction !== "review" && ebayLaunchDraft.lifecycleAction !== "compliance" ? <Button variant="secondary" disabled={ebayLaunchSaving} onClick={() => void queueEbayLaunch("review")}>{ebayLaunchSaving && <Loader2 className="size-4 animate-spin" />} Run preflight</Button> : null}
            <Button variant={ebayLaunchDraft.lifecycleAction === "end" ? "destructive" : "default"} disabled={ebayLaunchSaving} onClick={() => void queueEbayLaunch()}>{ebayLaunchSaving && <Loader2 className="size-4 animate-spin" />}{ebayLifecycleLabel[ebayLaunchDraft.lifecycleAction] || "Queue eBay action"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={channelStatusOpen} onOpenChange={(open) => { if (!channelStatusSaving) setChannelStatusOpen(open) }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>Set channel selling status</DialogTitle><DialogDescription>Apply a durable channel rule to {numberLabel(channelStatusAllFiltered ? total : channelStatusIds.length)} selected SKU{(channelStatusAllFiltered ? total : channelStatusIds.length) === 1 ? "" : "s"}. Inactive SKUs are zeroed now and remain at zero during future inventory updates.</DialogDescription></DialogHeader>
          <div className="grid gap-4">
            <Field label="Status"><Select value={channelStatusMode} onValueChange={(value) => setChannelStatusMode(value as "inactive" | "active")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="inactive">Inactive - send zero inventory</SelectItem><SelectItem value="active">Active - resume normal inventory rules</SelectItem></SelectContent></Select></Field>
            <div className="grid gap-2"><Label>Channels</Label><div className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">{channelStatusOptions.map((channel) => { const selected = channelStatusChannels.includes(channel.key); return <button key={channel.key} type="button" aria-pressed={selected} onClick={() => setChannelStatusChannels((current) => selected ? current.filter((key) => key !== channel.key) : [...new Set([...current, channel.key])])} className={`flex min-h-14 items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors ${selected ? "border-primary bg-primary/10 ring-1 ring-primary" : "bg-background hover:bg-muted/50"}`}><Checkbox tabIndex={-1} aria-hidden checked={selected} /><span className="min-w-0 flex-1"><span className="block font-medium">{channel.label}</span><span className="mt-0.5 flex flex-wrap gap-1 text-xs text-muted-foreground"><span>{channel.enabled ? "Enabled" : "Channel off"}</span><span aria-hidden>·</span><span>{channel.connected ? "Connected" : "Not connected"}</span></span></span></button> })}{!channelStatusOptions.length && <p className="text-sm text-muted-foreground">No supported marketplace channels are configured. Add the channel under Channels, then return here.</p>}</div><p className="text-xs text-muted-foreground">You can save an inactive rule even when a channel is off or temporarily disconnected. DataPlus will keep that SKU at zero when channel updates resume.</p></div>
            {channelStatusMode === "active" ? <Alert><AlertCircle className="size-4" /><AlertTitle>Reactivation does not publish</AlertTitle><AlertDescription>The block is removed. The next enabled inventory sync may send the SKU's normal sellable quantity; listings are not created or republished automatically.</AlertDescription></Alert> : <Alert className="border-amber-500/40 bg-amber-500/10"><Ban className="size-4" /><AlertTitle>Inventory will be zeroed</AlertTitle><AlertDescription>DataPlus preserves local stock and listing identities. A background job records whether each marketplace accepts zero inventory.</AlertDescription></Alert>}
          </div>
          <DialogFooter><Button variant="outline" disabled={channelStatusSaving} onClick={() => setChannelStatusOpen(false)}>Cancel</Button><Button disabled={channelStatusSaving || !channelStatusChannels.length} onClick={() => void saveChannelStatus()}>{channelStatusSaving && <Loader2 className="size-4 animate-spin" />}{channelStatusMode === "inactive" ? "Set inactive and zero" : "Set active"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={replenishableOpen} onOpenChange={(open) => { if (!replenishableSaving) setReplenishableOpen(open) }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader><DialogTitle>{replenishableEnabled ? "Set replenishable inventory" : "Use physical inventory"}</DialogTitle><DialogDescription>Update {numberLabel(selectionCount)} selected SKU{selectionCount === 1 ? "" : "s"}. This changes channel inventory policy only; warehouse on-hand, reservations, and receiving records stay untouched.</DialogDescription></DialogHeader>
          {replenishableEnabled ? <div className="grid gap-4">
            <Field label="Quantity source"><Select value={replenishableSource} onValueChange={(value) => setReplenishableSource(value as "vendor" | "sku" | "channel")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="vendor">Follow vendor replenishable rule</SelectItem><SelectItem value="channel">Use each channel default</SelectItem><SelectItem value="sku">Use one SKU quantity</SelectItem></SelectContent></Select><p className="text-xs text-muted-foreground">Vendor rules can enable and size the target centrally. Channel default is used when no SKU quantity is saved.</p></Field>
            {replenishableSource === "sku" ? <Field label="Replenishable quantity"><Input type="number" min="1" value={replenishableQuantity} onChange={(event) => setReplenishableQuantity(event.target.value)} /></Field> : null}
            <div className="grid gap-2"><Label>Channels</Label><div className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">{channelStatusOptions.map((channel) => { const selected = replenishableChannels.includes(channel.key); return <button key={`replenishable-${channel.key}`} type="button" aria-pressed={selected} onClick={() => setReplenishableChannels((current) => selected ? current.filter((key) => key !== channel.key) : [...new Set([...current, channel.key])])} className={cn("flex min-h-14 items-center gap-3 rounded-md border px-3 py-2 text-left text-sm", selected ? "border-primary bg-primary/10 ring-1 ring-primary" : "bg-background hover:bg-muted/50")}><Checkbox tabIndex={-1} checked={selected} /><span className="min-w-0 flex-1"><span className="block font-medium">{channel.label}</span><span className="text-xs text-muted-foreground">{channel.enabled ? "Enabled" : "Channel off"} · {channel.connected ? "Connected" : "Not connected"}</span></span></button> })}</div></div>
            <Alert className="border-amber-500/40 bg-amber-500/10"><ShieldCheck className="size-4" /><AlertTitle>Safeguards still win</AlertTitle><AlertDescription>Inactive, discontinued, channel-disabled, retired-vendor, stale-feed, vendor-unavailable, and configured velocity protections send zero. Channel maximum quantity also caps the target.</AlertDescription></Alert>
          </div> : <Alert><Warehouse className="size-4" /><AlertTitle>Resume stock-based inventory</AlertTitle><AlertDescription>Future channel syncs will use available physical or supplier stock, then apply vendor or channel safety quantity and maximum quantity rules.</AlertDescription></Alert>}
          <DialogFooter><Button variant="outline" disabled={replenishableSaving} onClick={() => setReplenishableOpen(false)}>Cancel</Button><Button disabled={replenishableSaving || (replenishableEnabled && (!replenishableChannels.length || (replenishableSource === "sku" && Number(replenishableQuantity) < 1)))} onClick={() => void saveReplenishable()}>{replenishableSaving && <Loader2 className="size-4 animate-spin" />}{replenishableEnabled ? "Save replenishable policy" : "Use physical inventory"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <ProductDetailSheet
        sourceItem={selected}
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </div>
  );

  async function runBulkRow(id: string, action: "set-active" | "set-inactive" | "set-discontinued") {
    try {
      const result = await api<{ changed?: number }>("/api/inventory/bulk", { method: "POST", body: JSON.stringify({ ids: [id], action }) })
      toast.success(`${numberLabel(result.changed || 0)} product updated.`)
      load(page)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update product.") }
  }
}

function CatalogTemplatesPage() {
  const templates = [["SKU category import", "/api/categories/templates/sku-categories.csv", "Assign main categories to specific SKUs."], ["Category mapping import", "/api/categories/templates/category-mapping.csv", "Map category structures to sales channels."], ["SKU changes export", "/api/catalog/changes.csv", "Export tracked source catalog changes."], ["Closeouts export", "/api/catalog/closeouts.csv", "Review supplier closeout and discontinued SKUs."]]
  return <div className="grid gap-5"><PageHeader eyebrow="Catalog" title="Templates" description="Download structured templates for category maintenance and catalog review." /><div className="grid gap-3 sm:grid-cols-2">{templates.map(([title, href, description]) => <Card key={href}><CardHeader><CardTitle className="text-sm">{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent><Button variant="outline" size="sm" asChild><a href={href}><FileDown className="size-4" /> Download CSV</a></Button></CardContent></Card>)}</div></div>
}

function EbayBlockersPage() {
  const [report, setReport] = useState<EbayListingBlockerReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState("")
  const [limit, setLimit] = useState("25")
  const load = async () => {
    setLoading(true)
    try {
      const result = await api<EbayListingBlockerReport>("/api/ebay/listings/blockers?limit=5000")
      setReport(result)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load eBay blockers.")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [])
  const retry = async (code = "") => {
    const retryLimit = Math.max(1, Math.min(500, Number(limit || 25) || 25))
    setRetrying(code || "all")
    try {
      const result = await api<{ job?: ImportJob; selected?: number; duplicate?: boolean; message?: string }>("/api/ebay/listings/retry-blocked", {
        method: "POST",
        body: JSON.stringify({
          limit: retryLimit,
          codes: code ? [code] : [],
          includeUnclassified: true,
          marketplaceId: "EBAY_US",
          fulfillmentPolicyId: "252002458010"
        }),
      })
      toast.success(result.message || `Queued eBay retry for ${numberLabel(result.selected || retryLimit)} SKU${Number(result.selected || retryLimit) === 1 ? "" : "s"}.`)
      if (result.job?.id) window.setTimeout(() => { window.history.pushState({}, "", "/jobs"); window.dispatchEvent(new PopStateEvent("popstate")) }, 500)
      void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to queue eBay retry.")
    } finally {
      setRetrying("")
    }
  }
  const groups = report?.groups || []
  const rows = report?.rows || []
  return <div className="grid gap-5">
    <PageHeader eyebrow="Catalog" title="eBay Launch Blockers" description="Prepared eBay offers that are not live yet, grouped by the publish blocker DataPlus can see." action={<div className="flex flex-wrap items-center gap-2"><Input className="h-9 w-20" type="number" min="1" max="500" value={limit} onChange={(event) => setLimit(event.target.value)} /><Button size="sm" variant="outline" disabled={loading} onClick={() => void load()}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh</Button><Button size="sm" disabled={loading || retrying !== "" || !Number(report?.retryableTotal || 0)} onClick={() => void retry()}>{retrying === "all" ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Retry {numberLabel(Math.min(Number(limit || 25) || 25, Number(report?.retryableTotal || 0)))} </Button></div>} />
    <div className="grid gap-3 md:grid-cols-4">
      <MetricCard label="Prepared, not live" value={report?.total || 0} icon={ShoppingBag} />
      <MetricCard label="Retryable" value={report?.retryableTotal || 0} icon={RotateCcw} />
      <MetricCard label="Scanned" value={report?.scanned || 0} icon={Search} />
      <MetricCard label="Blocker groups" value={groups.length} icon={AlertTriangle} />
    </div>
    <Alert className="border-blue-500/35 bg-blue-500/5"><AlertCircle className="size-4" /><AlertTitle>Small batch retry mode</AlertTitle><AlertDescription>The retry button queues prepared-not-live eBay offers in capped batches and forces the True Value fulfillment policy ID `252002458010`. Shipping defaults now send dimensional weight when actual package weight is missing.</AlertDescription></Alert>
    {loading ? <div className="grid gap-3"><Skeleton className="h-28" /><Skeleton className="h-60" /></div> : groups.length ? <div className="grid gap-3">{groups.map((group) => <Card key={group.code} className="overflow-hidden"><CardHeader className="border-b bg-muted/20"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-base">{group.code.replace(/_/g, " ")}</CardTitle><CardDescription>{group.suggestedFix || "Review the eBay publish error and update the SKU or channel defaults."}</CardDescription></div><div className="flex flex-wrap items-center gap-2"><Badge variant={group.retryable ? "secondary" : "outline"}>{group.retryable ? "Retryable" : "Review needed"}</Badge><Badge variant="outline">{numberLabel(group.count)} SKU{group.count === 1 ? "" : "s"}</Badge>{group.retryable ? <Button size="sm" variant="outline" disabled={retrying !== ""} onClick={() => void retry(group.code)}>{retrying === group.code ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />} Retry group</Button> : null}</div></div></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Product</TableHead><TableHead>Field</TableHead><TableHead>Package</TableHead><TableHead>Last error</TableHead></TableRow></TableHeader><TableBody>{(group.samples || []).map((sample) => <TableRow key={`${group.code}-${sample.sku}`}><TableCell><a className="font-mono text-xs font-medium text-primary hover:underline" href={`/products/${encodeURIComponent(sample.sku || "")}`}>{sample.sku || "-"}</a><p className="text-[11px] text-muted-foreground">Offer {sample.offerId || "-"}</p></TableCell><TableCell className="max-w-md"><p className="line-clamp-2 text-sm">{sample.title || "Untitled product"}</p><p className="text-xs text-muted-foreground">{sample.supplier || "No supplier"}</p></TableCell><TableCell>{sample.field || "-"}</TableCell><TableCell><p className="text-xs">{numberLabel(sample.packageWeight || 0)} lb actual</p><p className="text-xs text-muted-foreground">{numberLabel(sample.dimensionalWeight || 0)} lb dimensional / {sample.packageType || "default type"}</p></TableCell><TableCell className="max-w-xl"><p className="line-clamp-3 text-xs text-muted-foreground">{sample.error || sample.suggestedFix || "No raw publish error stored yet."}</p>{sample.errorAt ? <p className="mt-1 text-[11px] text-muted-foreground">{dateLabel(sample.errorAt)}</p> : null}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>)}</div> : <Empty><EmptyHeader><EmptyMedia variant="icon"><CheckCircle2 className="size-5" /></EmptyMedia><EmptyTitle>No prepared eBay blockers found</EmptyTitle><EmptyDescription>There are no offer-only eBay SKUs in the first scan window. New publish failures will appear here with their blocker code and suggested fix.</EmptyDescription></EmptyHeader></Empty>}
    {rows.length ? <Card><CardHeader><CardTitle className="text-base">Recent prepared-not-live SKUs</CardTitle><CardDescription>First {numberLabel(rows.length)} rows from the blocker scan.</CardDescription></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Block type</TableHead><TableHead>Fix</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{rows.slice(0, 25).map((row) => <TableRow key={`blocked-row-${row.sku}`}><TableCell><a className="font-mono text-xs font-medium text-primary hover:underline" href={`/products/${encodeURIComponent(row.sku || "")}`}>{row.sku}</a></TableCell><TableCell>{row.code?.replace(/_/g, " ") || "-"}</TableCell><TableCell className="max-w-xl text-xs text-muted-foreground">{row.suggestedFix || "-"}</TableCell><TableCell><Badge variant={row.retryable ? "secondary" : "outline"}>{row.retryable ? "Retryable" : "Review"}</Badge></TableCell></TableRow>)}</TableBody></Table></CardContent></Card> : null}
  </div>
}

function EbaySyncWarningsPage() {
  const [report, setReport] = useState<EbaySyncWarningReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [working, setWorking] = useState("")
  const [limit, setLimit] = useState("500")
  const load = async () => {
    setLoading(true)
    try {
      const result = await api<EbaySyncWarningReport>(`/api/ebay/listings/sync-warnings?limit=${encodeURIComponent(limit || "500")}`)
      setReport(result)
      setSelected(new Set())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load eBay sync warnings.")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [])
  const rows = report?.rows || []
  const groups = report?.groups || []
  const selectedRows = rows.filter((row) => row.sku && selected.has(row.sku))
  const allPageSelected = rows.length > 0 && rows.every((row) => row.sku && selected.has(row.sku))
  const toggleSku = (sku = "", checked: boolean) => {
    if (!sku) return
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(sku)
      else next.delete(sku)
      return next
    })
  }
  const setPageSelected = (checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      for (const row of rows) {
        if (!row.sku) continue
        if (checked) next.add(row.sku)
        else next.delete(row.sku)
      }
      return next
    })
  }
  const retry = async (mode: "selected" | "all", explicitSkus: string[] = []) => {
    const skus = explicitSkus.length ? explicitSkus : mode === "selected" ? selectedRows.map((row) => row.sku).filter(Boolean) : []
    if (mode === "selected" && !skus.length) return toast.error("Select at least one SKU to retry.")
    setWorking(`retry-${mode}`)
    try {
      const result = await api<{ message?: string; job?: ImportJob; selected?: number }>("/api/ebay/listings/sync-warnings/retry", {
        method: "POST",
        body: JSON.stringify({ skus, limit: Math.max(1, Math.min(500, Number(limit || 25) || 25)), updateInventory: true, updatePrice: false }),
      })
      toast.success(result.message || `Queued eBay sync retry for ${numberLabel(result.selected || skus.length)} SKU${Number(result.selected || skus.length) === 1 ? "" : "s"}.`)
      if (result.job?.id) window.setTimeout(() => { window.history.pushState({}, "", "/jobs"); window.dispatchEvent(new PopStateEvent("popstate")) }, 700)
      void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to queue eBay sync retry.")
    } finally {
      setWorking("")
    }
  }
  const clear = async () => {
    const skus = selectedRows.map((row) => row.sku).filter(Boolean)
    if (!skus.length) return toast.error("Select at least one reviewed SKU to clear.")
    setWorking("clear")
    try {
      const result = await api<{ changed?: number; message?: string }>("/api/ebay/listings/sync-warnings/clear", {
        method: "POST",
        body: JSON.stringify({ skus }),
      })
      toast.success(result.message || `Cleared ${numberLabel(result.changed || 0)} eBay sync warning${Number(result.changed || 0) === 1 ? "" : "s"}.`)
      void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to clear eBay sync warnings.")
    } finally {
      setWorking("")
    }
  }
  return <div className="grid gap-5">
    <PageHeader eyebrow="Catalog" title="eBay Sync Warnings" description="Live or linked eBay SKUs that DataPlus could not update through the eBay Inventory API." action={<div className="flex flex-wrap items-center gap-2"><Input className="h-9 w-24" type="number" min="1" max="5000" value={limit} onChange={(event) => setLimit(event.target.value)} /><Button size="sm" variant="outline" disabled={loading} onClick={() => void load()}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh</Button><Button size="sm" disabled={loading || working !== "" || !rows.length} onClick={() => void retry("all")}>{working === "retry-all" ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />} Retry batch</Button></div>} />
    <div className="grid gap-3 md:grid-cols-4">
      <MetricCard label="Sync warnings" value={report?.total || 0} icon={AlertTriangle} />
      <MetricCard label="Need relink" value={report?.needsRelinkTotal || 0} icon={Link2} />
      <MetricCard label="Scanned listings" value={report?.scanned || 0} icon={Search} />
      <MetricCard label="Latest job errors" value={(report?.latestJobs || []).reduce((sum, job) => sum + Number(job.errorCount || 0), 0)} icon={History} />
    </div>
    <Alert className="border-amber-500/35 bg-amber-500/5"><AlertTriangle className="size-4" /><AlertTitle>What this page means</AlertTitle><AlertDescription>A listing ID means the item can be live on eBay. A sync warning means DataPlus could not update price or inventory for that SKU. Needs relink usually means eBay has the live listing, but the Inventory API SKU saved in DataPlus does not match what eBay expects.</AlertDescription></Alert>
    <Card className="border-blue-500/30 bg-blue-500/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">How to relink a SKU</CardTitle>
        <CardDescription>Open the SKU, go to Channels, and compare the DataPlus SKU/merchant SKU with the live eBay listing. If eBay has the listing under a different custom label, update the SKU's eBay merchant SKU or listing identity to match eBay, save it, then retry inventory sync from this page. If the eBay listing cannot be tied back to the Inventory API SKU, recreate the eBay offer/listing from DataPlus so future price and inventory updates use the correct SKU.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 pt-0 text-xs text-muted-foreground md:grid-cols-3">
        <div className="rounded-md border bg-background/70 p-3"><span className="font-semibold text-foreground">1. Open product</span><br />Use the row action to open the SKU and inspect its eBay listing fields.</div>
        <div className="rounded-md border bg-background/70 p-3"><span className="font-semibold text-foreground">2. Match eBay identity</span><br />Make the merchant SKU/custom label and listing identity match the live eBay record.</div>
        <div className="rounded-md border bg-background/70 p-3"><span className="font-semibold text-foreground">3. Retry sync</span><br />Return here and retry inventory sync. A successful sync clears the warning automatically.</div>
      </CardContent>
    </Card>
    {groups.length ? <div className="grid gap-3 md:grid-cols-2">{groups.map((group) => <Card key={group.code}><CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-sm capitalize">{String(group.reason || group.code || "warning").replace(/_/g, " ")}</CardTitle><CardDescription>{group.suggestedFix || "Review and retry after correcting the SKU/channel data."}</CardDescription></div><Badge variant={group.code === "needs_relink" ? "destructive" : "secondary"}>{numberLabel(group.count || 0)}</Badge></div></CardHeader></Card>)}</div> : null}
    {selectedRows.length ? <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 p-3"><p className="text-sm font-medium">{numberLabel(selectedRows.length)} selected</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={working !== ""} onClick={() => void clear()}>{working === "clear" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Clear reviewed</Button><Button size="sm" disabled={working !== ""} onClick={() => void retry("selected")}>{working === "retry-selected" ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />} Retry selected</Button></div></div> : null}
    {loading ? <div className="grid gap-3"><Skeleton className="h-28" /><Skeleton className="h-96" /></div> : rows.length ? <Card className="overflow-hidden"><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead className="w-10"><Checkbox checked={allPageSelected} onCheckedChange={(checked) => setPageSelected(checked === true)} aria-label="Select page" /></TableHead><TableHead className="min-w-44">SKU</TableHead><TableHead className="min-w-80">Product</TableHead><TableHead className="min-w-52">eBay identity</TableHead><TableHead className="min-w-40">Status</TableHead><TableHead className="min-w-96">Latest error</TableHead><TableHead className="w-24 text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={`${row.sku}-${row.code}-${row.jobId}`}><TableCell><Checkbox checked={Boolean(row.sku && selected.has(row.sku))} onCheckedChange={(checked) => toggleSku(row.sku, checked === true)} aria-label={`Select ${row.sku || "SKU"}`} /></TableCell><TableCell><a className="font-mono text-xs font-semibold text-primary hover:underline" href={`/products/${encodeURIComponent(row.sku || "")}`}>{row.sku || "-"}</a><p className="text-[11px] text-muted-foreground">Merchant {row.merchantSku || row.sku || "-"}</p></TableCell><TableCell><p className="line-clamp-2 text-sm font-medium">{row.title || "Untitled product"}</p><p className="text-xs text-muted-foreground">{row.supplier || "No supplier"}</p></TableCell><TableCell><p className="text-xs">Listing {row.listingId || "-"}</p><p className="text-xs text-muted-foreground">Offer {row.offerId || "-"}</p>{row.jobNumber ? <p className="text-[11px] text-muted-foreground">Job #{row.jobNumber}</p> : null}</TableCell><TableCell><Badge variant={row.code === "needs_relink" ? "destructive" : "secondary"} className="capitalize">{String(row.reason || row.status || "warning").replace(/_/g, " ")}</Badge><p className="mt-1 text-[11px] text-muted-foreground">{row.lastSyncAt ? dateLabel(row.lastSyncAt) : "No sync date"}</p></TableCell><TableCell><p className="line-clamp-3 text-xs text-muted-foreground">{row.error || row.suggestedFix || "No raw error stored."}</p></TableCell><TableCell className="text-right"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="size-4" /><span className="sr-only">Open actions</span></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuLabel>Actions</DropdownMenuLabel><DropdownMenuItem asChild><a href={`/products/${encodeURIComponent(row.sku || "")}`}><PackageSearch className="size-4" /> Open product</a></DropdownMenuItem>{row.listingUrl ? <DropdownMenuItem asChild><a href={row.listingUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-4" /> View on eBay</a></DropdownMenuItem> : null}<DropdownMenuSeparator /><DropdownMenuItem onClick={() => { if (row.sku) void retry("selected", [row.sku]) }}><RotateCcw className="size-4" /> Retry sync</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card> : <Empty><EmptyHeader><EmptyMedia variant="icon"><CheckCircle2 className="size-5" /></EmptyMedia><EmptyTitle>No eBay sync warnings found</EmptyTitle><EmptyDescription>DataPlus did not find saved relink warnings or recent eBay price/inventory job errors in this scan.</EmptyDescription></EmptyHeader></Empty>}
  </div>
}

export function CatalogPage({ channels = [] }: { channels?: ChannelConnection[] }) {
  const [tab, setTab] = useState<CatalogWorkspaceTab>(catalogWorkspaceTabFromPath)
  const [workspaceCounts, setWorkspaceCounts] = useState<Record<string, number>>({})
  useEffect(() => {
    const path = window.location.pathname.toLowerCase()
    if (!path.startsWith("/source-catalog") && path !== "/source") return
    const params = new URLSearchParams(window.location.search)
    params.set("catalogStatus", "source-only")
    window.history.replaceState({}, "", `/products?${params.toString()}`)
    setTab("products")
  }, [])
  useEffect(() => {
    api<{ counts?: Record<string, number> }>("/api/catalog/workspace-summary")
      .then((result) => setWorkspaceCounts(result.counts || {}))
      .catch(() => {})
  }, [])
  const selectTab = (next: string) => {
    const selected = next as CatalogWorkspaceTab
    setTab(selected)
    const paths: Record<CatalogWorkspaceTab, string> = { products: "/products", review: "/import-review", changes: "/sku-changes", "category-review": "/category-review", categories: "/categories", mappings: "/vendor-category-mappings", "ebay-blockers": "/ebay-blockers", "ebay-sync-warnings": "/ebay-sync-warnings", attributes: "/attributes", groups: "/groups", inventory: "/inventory", templates: "/templates", readiness: "/readiness" }
    window.history.replaceState({}, "", paths[selected])
  }
  if (new URLSearchParams(window.location.search).get("action") === "walmart-launch") {
    const channel = channels.find(item => item.name === "Walmart")
    return <div className="grid gap-4"><PageHeader eyebrow="Catalog / Marketplace" title="Walmart catalog launch" description="Review selected catalog SKUs and UPC matches before submission." action={<Button asChild variant="outline"><a href="/products">Back to Products</a></Button>} />{channel ? <WalmartChannel key={channel.id} channel={channel} catalogMode onSave={async () => { throw new Error("Configure Walmart features in Channels before launching.") }} /> : <p>Walmart is not configured. <a className="underline" href="/channels?channel=Walmart">Open channel setup</a></p>}</div>
  }
  return <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)] gap-4 sm:gap-5"><Tabs className="min-w-0 overflow-hidden" value={tab} onValueChange={selectTab}><div className="w-full max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-slate-50/80 p-1.5 shadow-sm dark:border-slate-700/80 dark:bg-slate-950/80"><TabsList className="h-auto min-w-max justify-start gap-1 bg-transparent p-0">{catalogWorkspaceTabs.map((item) => <TabsTrigger key={item.id} value={item.id} className="px-3 text-xs font-semibold text-slate-600 hover:bg-slate-200/80 hover:text-slate-950 data-[state=active]:bg-blue-600 data-[state=active]:!text-white dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white dark:data-[state=active]:bg-blue-500">{item.label}</TabsTrigger>)}</TabsList></div></Tabs>{tab === "products" && <AdvancedMainCatalogPage totalSkuCount={workspaceCounts.products} channels={channels} />}{tab === "review" && <ImportReviewPage />}{tab === "changes" && <SkuChangesPage />}{tab === "category-review" && <CategoryReviewPage />}{tab === "mappings" && <VendorMappingsPage />}{tab === "ebay-blockers" && <EbayBlockersPage />}{tab === "ebay-sync-warnings" && <EbaySyncWarningsPage />}{tab === "attributes" && <AttributesPage />}{tab === "groups" && <AttributeGroupsPage />}{tab === "inventory" && <InventoryWorkspace />}{tab === "templates" && <CatalogTemplatesPage />}{tab === "categories" && <CategoriesWorkspace />}{tab === "readiness" && <CatalogResourcePage tab="readiness" />}</div>
}

