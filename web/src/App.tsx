import { useEffect, useMemo, useState } from "react"
import {
  Activity,
  AlertCircle,
  Boxes,
  CheckCircle2,
  Database,
  ExternalLink,
  FileDown,
  FileWarning,
  History,
  Home,
  Loader2,
  MoreHorizontal,
  PackageSearch,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Square,
  Store,
  Truck,
  Warehouse,
  Pencil,
  Save,
} from "lucide-react"
import { Toaster, toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { TooltipProvider } from "@/components/ui/tooltip"

type AppView = "overview" | "jobs" | "channels" | "catalog" | "product-detail" | "vendors" | "settings"

type ImportJob = {
  id: string
  section?: string
  category?: string
  operation?: string
  direction?: string
  type?: string
  status?: string
  fileName?: string
  originalFileName?: string
  errorFileName?: string
  manifestFileName?: string
  message?: string
  details?: string
  errors?: string[]
  totalRows?: number
  processedRows?: number
  progressPercent?: number
  changed?: number
  missingCount?: number
  created?: number
  startedAt?: string
  createdAt?: string
  finishedAt?: string
  updatedAt?: string
  workerId?: string
  workerTask?: string
}

type WorkerStatus = {
  online?: boolean
  workerId?: string
  currentTask?: string
  status?: string
  lastSeenAt?: string
  ageSeconds?: number
}

type ChannelSettings = {
  defaultShadowStatus?: string
  defaultHandlingTimeDays?: number
  defaultSafetyQty?: number
  defaultMaxSellableQty?: number
  defaultShippingProfile?: string
  defaultShippingService?: string
  priceUpdateEnabled?: boolean
  inventoryUpdateEnabled?: boolean
  orderDownloadEnabled?: boolean
  trackingUpdateEnabled?: boolean
  autoCreateShadow?: boolean
  priceMarkupPercent?: number
  minMarginPercent?: number
  shopifyDefaultStatus?: string
  shopifyInventoryPolicy?: string
  shopifyFulfillmentService?: string
  shopifySyncStatusEnabled?: boolean
  shopifyAutoSyncStatus?: boolean
  shopifyStatusSyncLimit?: number
  shopifyPublishScope?: string
  shopifyCloseoutsEnabled?: boolean
  shopifyInventoryPushEnabled?: boolean
  shopifyInventoryWarehouseId?: string
  shopifyInventoryLocationId?: string
  inventoryScheduleEnabled?: boolean
  inventoryScheduleMode?: string
  inventoryScheduleType?: string
  inventoryScheduleTimes?: string
  inventoryScheduleEveryHours?: number
  inventoryScheduleRequireSuccessfulDump?: boolean
  shopifySkuMapScheduleEnabled?: boolean
  shopifySkuMapScheduleTime?: string
  shopifyShippingProfiles?: Array<{ id?: string; name?: string; default?: boolean }>
  shopifyShippingProfilesSyncedAt?: string
  roundingRule?: string
  [key: string]: unknown
}

type ChannelConnection = {
  id: string
  name: string
  connected?: boolean
  status?: string
  notes?: string
  logoUrl?: string
  logoDataUrl?: string
  externalAccount?: string
  settings?: ChannelSettings
  shopifyConfig?: {
    shop?: string
    apiVersion?: string
    hasAccessToken?: boolean
    hasClientCredentials?: boolean
    configured?: boolean
  }
}

type Vendor = {
  id: string
  name: string
  code?: string
  status?: string
  type?: string
  contactName?: string
  email?: string
  phone?: string
  website?: string
  paymentTerms?: string
  leadTimeDays?: number
  moq?: number
  address?: {
    line1?: string
    line2?: string
    city?: string
    state?: string
    postalCode?: string
    country?: string
  }
  notes?: string
  rating?: number
  openPOs?: number
  totalPOs?: number
  totalSpend?: number
  catalogStats?: Record<string, number>
  pricingRules?: Record<string, unknown>
  variationRules?: Record<string, unknown>
  inventoryRules?: Record<string, unknown>
  channelRules?: Record<string, unknown>
}

type SystemSettings = {
  backgroundJobsMode?: string
  autoDataQualityScanAfterImports?: boolean
  dataQualityWorkerEnabled?: boolean
  backupIncludeSourceCatalog?: boolean
  backupRetentionDays?: number
  jobsRetentionDays?: number
  jobsRetentionAutoCleanupEnabled?: boolean
  trueValueSourceCategoryAsMainCategory?: boolean
  requireAdminConfirmationForDeletes?: boolean
  shopifyDailyInventoryUpdateEnabled?: boolean
  shopifyDailyInventoryUpdateTime?: string
  shopifyDailyInventoryUpdateMode?: string
  [key: string]: unknown
}

type LiteState = {
  connections?: ChannelConnection[]
  vendors?: Vendor[]
  warehouses?: Array<Record<string, unknown>>
  systemSettings?: SystemSettings
}

type ImportJobsResponse = {
  importJobs?: ImportJob[]
  activeJobs?: ImportJob[]
  workerStatus?: WorkerStatus
  total?: number
  page?: number
  limit?: number
}

type CatalogItem = {
  id?: string
  sku?: string
  title?: string
  brand?: string
  supplier?: string
  supplierCode?: string
  mainCategory?: string
  sourceCategory?: string
  categoryVerified?: boolean
  stockQty?: number
  stockStatus?: string
  cost?: number
  websitePrice?: number
  price?: number
  active?: boolean
  status?: string
  inProducts?: boolean
  toBeDiscontinued?: boolean
  alternateVendorCount?: number
  defaultImage?: string
}

type ProductItem = CatalogItem & {
  marketplaceTitle?: string
  category?: string
  vendorCategory?: string
  vendor?: string
  barcode?: string
  manufacturer?: string
  mfrPartNumber?: string
  vendorSku?: string
  uom?: string
  uomName?: string
  uomQty?: string | number
  uomDisplay?: string
  isMultiUnit?: boolean
  qty?: number
  reserved?: number
  sourceCost?: number
  sellUnitCost?: number
  listPrice?: number
  msrp?: number
  itemLength?: number
  itemWidth?: number
  itemHeight?: number
  itemWeight?: number
  packageLength?: number
  packageWidth?: number
  packageHeight?: number
  packageWeight?: number
  dimensionalWeight?: number
  shippingClass?: string
  shippingMethod?: string
  shippingClassReason?: string
  externalId?: string
  supplierCode?: string
  stockStatus?: string
  stockUpdatedAt?: string
  lastPricesUpdateAt?: string
  lastPricesUpdateBy?: string
  shopifyId?: string
  shopifyVariantId?: string
  shopifyHandle?: string
  shopifyStatus?: string
  shopifyPublished?: boolean
  shopifyPublishedAt?: string
  shopifyUpdatedAt?: string
  shopifySyncedAt?: string
  shopifyLivePrice?: number
  shopifyLiveInventoryQuantity?: number
  shopifyOnlineStoreUrl?: string
  shopifyVariantSku?: string
  replenishable?: boolean
  replenishableUseVendorRules?: boolean
  replenishableQtyUseVendorDefault?: boolean
  replenishableQty?: number
  effectiveReplenishableQty?: number
  tags?: string[]
  imageCount?: number
  updatedAt?: string
  shadowSkuCount?: number
  shopifyVariantCount?: number
  ebayListing?: { status?: string; offerId?: string; listingId?: string; listingUrl?: string; marketplaceId?: string; merchantLocationKey?: string; categoryId?: string; categoryPath?: string; taxonomyVersion?: string; condition?: string; quantity?: number; price?: number; currency?: string; paymentPolicyId?: string; returnPolicyId?: string; fulfillmentPolicyId?: string; bestOfferEnabled?: boolean; updatedAt?: string; attributesSyncedAt?: string }
  shortDescription?: string
  longDescription?: string
  condition?: string
  countryOfOrigin?: string
  hazardous?: boolean
  sdsUrl?: string
  originalSdsUrl?: string
  bulletPoints?: string[]
  seoKeywords?: string
  wildcardSearch?: string
  reorderPoint?: number
  minQuantity?: string | number
  quantityIncrements?: string | number
  leadTime?: string | number
  leadtime?: string | number
  fobPrice?: number
  brandLocked?: boolean
  shopifySystemPrice?: number
  shopifyPriceDelta?: number | null
  shopifyPriceMismatch?: boolean
  shopifyLiveCompareAtPrice?: number | null
  shopifyLiveVariantSku?: string
  shopifySyncSource?: string
  unspsc?: string
  identifiers?: Array<Record<string, unknown>>
  pricingCalculation?: { costBasis?: string; sellUnit?: string; sourceCost?: number; sellUnitCost?: number; primarySellUnitCost?: number; markupPercent?: number; markedUpPrice?: number; vendorWebsitePrice?: number; minimumAllowedPrice?: number; minimumAllowedPriceEnforced?: boolean; priceSource?: string; finalPrice?: number; ruleNote?: string }
  systemVariants?: Array<{ sku?: string; optionName?: string; optionValue?: string; uomDisplay?: string; uomQty?: number; quantity?: number; unitCost?: number; price?: number; status?: string; note?: string }>
  shopifyPurchaseVariants?: Array<{ sku?: string; optionName?: string; optionValue?: string; uomDisplay?: string; uomQty?: number; quantity?: number; unitCost?: number; price?: number; compareAtPrice?: number | string; shopifyVariantSku?: string; shopifyVariantId?: string; shopifyLivePrice?: number | null; shopifyLiveInventoryQuantity?: number | null; shopifyPublished?: boolean; shopifyStatus?: string; note?: string }>
  shadowSkus?: Array<{ marketplace?: string; company?: string; shadowSku?: string; price?: number; status?: string; inventoryPolicy?: string }>
  vendorOffers?: Array<{ supplier?: string; vendor?: string; sku?: string; vendorSku?: string; cost?: number; qty?: number; stockQty?: number; category?: string; mainCategory?: string }>
  productManagerFields?: Record<string, unknown>
  original?: Record<string, unknown> | null
  attributes?: Record<string, unknown>
  sourceCatalogMatches?: Array<Record<string, unknown>>
  images?: Array<string | { url?: string; src?: string }>
  aliases?: Array<{ sku?: string; aliasSku?: string; active?: boolean; source?: string; type?: string; createdFromOrderNumber?: string }>
  warehouseStock?: Array<{ warehouseName?: string; warehouse?: string; locationBin?: string; qty?: number; reserved?: number; available?: number; reorderPoint?: number; updatedAt?: string }>
  recentChanges?: Array<{ field?: string; previousValue?: string; nextValue?: string; updatedAt?: string; createdAt?: string }>
}

type CatalogResponse = {
  items?: CatalogItem[]
  page?: number
  limit?: number
  totalMatches?: number
  nextCursor?: string
  hasMore?: boolean
  scanned?: number
  partial?: boolean
  indexed?: boolean
  database?: string
  manifest?: { productCount?: number; source?: string; updatedAt?: string }
}

type ShopifyAuthCheck = {
  ok?: boolean
  tokenSource?: string
  hasToken?: boolean
  scope?: string
  scopes?: string[]
  expiresAt?: string
  hasReadShipping?: boolean
  shop?: {
    name?: string
    myshopifyDomain?: string
  }
  message?: string
  error?: string
}

const navItems: Array<{ id: AppView; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "overview", label: "Overview", icon: Home },
  { id: "jobs", label: "Jobs", icon: History },
  { id: "channels", label: "Channels", icon: Store },
  { id: "catalog", label: "Catalog", icon: PackageSearch },
  { id: "vendors", label: "Vendors", icon: Warehouse },
  { id: "settings", label: "Settings", icon: Settings },
]

const viewPaths: Record<AppView, string> = {
  overview: "/",
  jobs: "/jobs",
  channels: "/channels",
  catalog: "/products",
  "product-detail": "/products",
  vendors: "/vendors",
  settings: "/settings",
}

function viewFromPath(pathname = "/"): AppView {
  const path = pathname.replace(/\/+$/, "") || "/"
  if (path.startsWith("/jobs")) return "jobs"
  if (path.startsWith("/channels")) return "channels"
  if (path.startsWith("/products/")) return "product-detail"
  if (path.startsWith("/products") || path.startsWith("/catalog")) return "catalog"
  if (path.startsWith("/vendors")) return "vendors"
  if (path.startsWith("/settings")) return "settings"
  return "overview"
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.error || payload.message || `Request failed: ${response.status}`)
  }
  return payload as T
}

function dateLabel(value?: string) {
  if (!value) return "Never"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Never"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}

function numberLabel(value?: number | string) {
  return Number(value || 0).toLocaleString()
}

function moneyLabel(value?: number | string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0))
}

function jobStatusTone(status?: string) {
  const value = String(status || "").toLowerCase()
  if (value === "failed") return "destructive"
  if (value === "warning" || value === "queued" || value === "running") return "secondary"
  if (value === "stopped") return "outline"
  return "default"
}

function jobProgress(job: ImportJob) {
  if (["success", "done", "ok", "warning"].includes(String(job.status || "").toLowerCase())) return 100
  if (Number(job.progressPercent || 0) > 0) return Math.max(0, Math.min(100, Number(job.progressPercent)))
  if (Number(job.totalRows || 0) > 0) {
    return Math.round((Number(job.processedRows || 0) / Number(job.totalRows || 1)) * 100)
  }
  return 0
}

function isActiveJob(job: ImportJob) {
  return ["queued", "running"].includes(String(job.status || "").toLowerCase())
}

function isAttentionJob(job: ImportJob) {
  return ["failed", "warning", "stopped"].includes(String(job.status || "").toLowerCase())
}

function isShopifyInventoryJob(job: ImportJob) {
  const haystack = `${job.operation || ""} ${job.fileName || ""} ${job.workerTask || ""}`.toLowerCase()
  return haystack.includes("shopify") && haystack.includes("inventory")
}

function jobCategory(job: ImportJob) {
  return job.category || job.section || "Operations"
}

function FloatingActions({
  view,
  shopify,
  onNavigate,
  onRefresh,
  onCheckShopify,
  onRefreshShopifyToken,
  onRunShopifyAction,
  onCleanupJobs,
}: {
  view: AppView
  shopify?: ChannelConnection
  onNavigate: (view: AppView) => void
  onRefresh: () => void
  onCheckShopify: () => void
  onRefreshShopifyToken: () => void
  onRunShopifyAction: (options: { path: string; body?: Record<string, unknown>; confirmMessage?: string; successMessage?: string }) => void
  onCleanupJobs: () => void
}) {
  const openLegacy = (path = "/legacy") => window.open(path, "_blank", "noreferrer")
  const shopifyStatusLimit = Number(shopify?.settings?.shopifyStatusSyncLimit || 100) || 100

  const items = (() => {
    if (view === "jobs") return <>
      <DropdownMenuItem onClick={onRefresh}><RefreshCw className="size-4" /> Refresh jobs</DropdownMenuItem>
      <DropdownMenuItem onClick={onCleanupJobs}><RotateCcw className="size-4" /> Clean stale jobs</DropdownMenuItem>
      <DropdownMenuItem onClick={() => onNavigate("channels")}><Store className="size-4" /> Open channel logs</DropdownMenuItem>
    </>
    if (view === "channels") return <>
      <DropdownMenuItem onClick={onCheckShopify}><ShieldCheck className="size-4" /> Check Shopify connection</DropdownMenuItem>
      <DropdownMenuItem onClick={onRefreshShopifyToken}><RefreshCw className="size-4" /> Request new Shopify token</DropdownMenuItem>
      <DropdownMenuItem onClick={() => onRunShopifyAction({ path: "/api/shopify/sku-map-sync", successMessage: "Shopify SKU pair audit queued." })}><RotateCcw className="size-4" /> Audit Shopify SKU pairs</DropdownMenuItem>
      <DropdownMenuItem onClick={() => onRunShopifyAction({ path: "/api/shopify/status-sync-all", body: { limit: shopifyStatusLimit }, successMessage: "Shopify status sync queued." })}><RotateCcw className="size-4" /> Sync Shopify status</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => onNavigate("jobs")}><Activity className="size-4" /> View jobs</DropdownMenuItem>
    </>
    if (view === "product-detail") return <>
      <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent("dataplus:product-action", { detail: { action: "edit" } }))}><Pencil className="size-4" /> Edit product</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent("dataplus:product-action", { detail: { action: "review-product" } }))}><ShoppingBag className="size-4" /> Review Shopify product</DropdownMenuItem>
      <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent("dataplus:product-action", { detail: { action: "review-price" } }))}><ShoppingBag className="size-4" /> Review Shopify price</DropdownMenuItem>
      <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent("dataplus:product-action", { detail: { action: "create-product" } }))}><ShoppingBag className="size-4" /> Create Shopify product</DropdownMenuItem>
      <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent("dataplus:product-action", { detail: { action: "push-price" } }))}><ShoppingBag className="size-4" /> Push Shopify price</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => onNavigate("jobs")}><History className="size-4" /> View channel jobs</DropdownMenuItem>
      <DropdownMenuItem onClick={() => onNavigate("catalog")}><Boxes className="size-4" /> Back to products</DropdownMenuItem>
    </>
    if (view === "catalog") return <>
      <DropdownMenuItem onClick={() => window.open("/api/catalog/changes.csv", "_blank", "noreferrer")}><FileDown className="size-4" /> Export SKU changes</DropdownMenuItem>
      <DropdownMenuItem onClick={() => window.open("/api/catalog/closeouts.csv", "_blank", "noreferrer")}><FileDown className="size-4" /> Export closeouts</DropdownMenuItem>
      <DropdownMenuItem onClick={() => onRunShopifyAction({ path: "/api/shopify/status-sync-all", body: { limit: shopifyStatusLimit }, successMessage: "Shopify status sync queued." })}><RotateCcw className="size-4" /> Sync Shopify status</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => openLegacy("/legacy/catalog")}><ExternalLink className="size-4" /> Open legacy catalog tools</DropdownMenuItem>
    </>
    if (view === "vendors") return <>
      <DropdownMenuItem onClick={() => onNavigate("catalog")}><Boxes className="size-4" /> Open catalog</DropdownMenuItem>
      <DropdownMenuItem onClick={() => openLegacy("/legacy/vendors")}><ExternalLink className="size-4" /> Open legacy vendor tools</DropdownMenuItem>
    </>
    if (view === "settings") return <>
      <DropdownMenuItem onClick={onRefresh}><RefreshCw className="size-4" /> Refresh settings</DropdownMenuItem>
      <DropdownMenuItem onClick={() => onNavigate("channels")}><Store className="size-4" /> Open channels</DropdownMenuItem>
      <DropdownMenuItem onClick={() => openLegacy()}><ExternalLink className="size-4" /> Open advanced settings</DropdownMenuItem>
    </>
    return <>
      <DropdownMenuItem onClick={() => onNavigate("catalog")}><Boxes className="size-4" /> Open catalog</DropdownMenuItem>
      <DropdownMenuItem onClick={() => onNavigate("jobs")}><Activity className="size-4" /> Open jobs</DropdownMenuItem>
      <DropdownMenuItem onClick={() => onNavigate("channels")}><Store className="size-4" /> Open channels</DropdownMenuItem>
      <DropdownMenuItem onClick={onRefresh}><RefreshCw className="size-4" /> Refresh workspace</DropdownMenuItem>
    </>
  })()

  return (
    <div className="fixed right-5 bottom-5 z-40">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" className="size-12 rounded-full shadow-lg" aria-label="Open page actions" title="Actions">
            <MoreHorizontal className="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" className="w-64">
          {items}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function App() {
  const [view, setView] = useState<AppView>(() => viewFromPath(window.location.pathname))
  const [state, setState] = useState<LiteState>({})
  const [jobs, setJobs] = useState<ImportJob[]>([])
  const [activeJobs, setActiveJobs] = useState<ImportJob[]>([])
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus>({})
  const [jobPageMeta, setJobPageMeta] = useState({ page: 1, limit: 10, total: 0, status: "all", query: "" })
  const [loading, setLoading] = useState(true)
  const [checkingShopify, setCheckingShopify] = useState(false)
  const [shopifyAuth, setShopifyAuth] = useState<ShopifyAuthCheck | null>(null)
  const [selectedJobId, setSelectedJobId] = useState<string>("")

  async function loadJobs(next: Partial<typeof jobPageMeta> = {}, quiet = false) {
    const request = { ...jobPageMeta, ...next }
    const params = new URLSearchParams({ page: String(request.page), limit: String(request.limit) })
    if (request.status !== "all") params.set("status", request.status)
    if (request.query.trim()) params.set("q", request.query.trim())
    try {
      const jobResponse = await api<ImportJobsResponse>(`/api/import-jobs?${params}`)
      setJobs(jobResponse.importJobs || [])
      setActiveJobs(jobResponse.activeJobs || (jobResponse.importJobs || []).filter(isActiveJob))
      setWorkerStatus(jobResponse.workerStatus || {})
      setJobPageMeta({
        ...request,
        page: Number(jobResponse.page || request.page),
        limit: Number(jobResponse.limit || request.limit),
        total: Number(jobResponse.total || 0),
      })
    } catch (error) {
      if (!quiet) toast.error(error instanceof Error ? error.message : "Unable to load job history.")
    }
  }

  async function loadJobDetail(job: ImportJob) {
    try {
      const result = await api<{ job: ImportJob }>(`/api/import-jobs/${encodeURIComponent(job.id)}`)
      setJobs((current) => current.some((row) => row.id === result.job.id) ? current.map((row) => row.id === result.job.id ? result.job : row) : [result.job, ...current])
      if (isActiveJob(result.job)) setActiveJobs((current) => [result.job, ...current.filter((row) => row.id !== result.job.id)])
      setSelectedJobId(result.job.id)
    } catch (error) {
      setSelectedJobId(job.id)
      toast.error(error instanceof Error ? error.message : "Unable to load job detail.")
    }
  }

  async function refreshData({ quiet = false } = {}) {
    if (!quiet) setLoading(true)
    try {
      const nextState = await api<LiteState>("/api/state?lite=1")
      setState(nextState)
    } catch (error) {
      if (!quiet) toast.error(error instanceof Error ? error.message : "Unable to load DataPlus.")
    } finally {
      setLoading(false)
    }
    void loadJobs({}, quiet)
  }

  function navigateTo(nextView: AppView) {
    setView(nextView)
    const nextPath = viewPaths[nextView]
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, "", nextPath)
    }
  }

  async function checkShopifyConnection() {
    setCheckingShopify(true)
    try {
      const result = await api<ShopifyAuthCheck>("/api/shopify/auth-check", {
        method: "POST",
        body: JSON.stringify({}),
      })
      setShopifyAuth(result)
      toast.success(result.message || "Shopify connection is working.")
    } catch (error) {
      const result = { ok: false, message: error instanceof Error ? error.message : "Shopify connection failed." }
      setShopifyAuth(result)
      toast.error(result.message)
    } finally {
      setCheckingShopify(false)
    }
  }

  async function refreshShopifyToken() {
    try {
      const result = await api<ShopifyAuthCheck>("/api/shopify/token-refresh", {
        method: "POST",
        body: JSON.stringify({}),
      })
      setShopifyAuth(result)
      toast.success(result.message || "Shopify token refreshed.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to refresh Shopify token.")
    }
  }

  async function runShopifyAction({
    path,
    body = {},
    confirmMessage = "",
    successMessage = "Shopify job queued.",
  }: {
    path: string
    body?: Record<string, unknown>
    confirmMessage?: string
    successMessage?: string
  }) {
    if (confirmMessage && !window.confirm(confirmMessage)) return
    try {
      const result = await api<{ job?: ImportJob; importJobs?: ImportJob[]; state?: LiteState; message?: string }>(path, {
        method: "POST",
        body: JSON.stringify(body),
      })
      if (result.state) setState((current) => ({ ...current, ...result.state }))
      if (result.importJobs) setJobs(result.importJobs)
      else if (result.job) setJobs((current) => [result.job as ImportJob, ...current.filter((job) => job.id !== result.job?.id)])
      toast.success(result.message || successMessage)
      refreshData({ quiet: true })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to queue Shopify job.")
    }
  }

  async function mutateJob(path: string, success: string) {
    try {
      const result = await api<ImportJobsResponse>(path, { method: "POST", body: JSON.stringify({}) })
      setJobs(result.importJobs || jobs)
      setActiveJobs(result.activeJobs || (result.importJobs || jobs).filter(isActiveJob))
      toast.success(success)
      void loadJobs({}, true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Job action failed.")
    }
  }

  async function saveChannel(channelId: string, patch: Record<string, unknown>) {
    try {
      const result = await api<{ channel: ChannelConnection; state?: LiteState }>(`/api/channels/${encodeURIComponent(channelId)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      })
      setState((current) => ({
        ...current,
        ...(result.state || {}),
        connections: (result.state?.connections || current.connections || []).map((channel) => (
          channel.id === channelId ? result.channel : channel
        )),
      }))
      toast.success("Channel settings saved.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save channel settings.")
      throw error
    }
  }

  async function saveVendor(vendorId: string, patch: Record<string, unknown>) {
    try {
      const result = await api<{ vendor: Vendor; state?: LiteState }>(`/api/vendors/${encodeURIComponent(vendorId)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      })
      setState((current) => ({
        ...current,
        ...(result.state || {}),
        vendors: (result.state?.vendors || current.vendors || []).map((vendor) => (
          vendor.id === vendorId ? result.vendor : vendor
        )),
      }))
      toast.success("Vendor settings saved.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save vendor settings.")
      throw error
    }
  }

  async function saveSystemSettings(patch: Record<string, unknown>) {
    try {
      const result = await api<{ state?: LiteState; systemSettings?: SystemSettings }>("/api/system-settings", {
        method: "PATCH",
        body: JSON.stringify(patch),
      })
      setState((current) => ({
        ...current,
        ...(result.state || {}),
        systemSettings: result.systemSettings || result.state?.systemSettings || { ...current.systemSettings, ...patch },
      }))
      toast.success("System settings saved.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save system settings.")
      throw error
    }
  }

  useEffect(() => {
    refreshData()
    const timer = window.setInterval(() => refreshData({ quiet: true }), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const onPopState = () => setView(viewFromPath(window.location.pathname))
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [])

  const shopify = useMemo(
    () => (state.connections || []).find((connection) => connection.name?.toLowerCase() === "shopify"),
    [state.connections],
  )
  const attentionJobs = jobs.filter(isAttentionJob)
  const shopifyInventoryJobs = jobs.filter(isShopifyInventoryJob)
  const selectedJob = jobs.find((job) => job.id === selectedJobId) || attentionJobs[0] || jobs[0]

  return (
    <TooltipProvider>
      <div className="min-h-svh bg-muted/35 text-foreground">
        <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r bg-background/95 px-4 py-5 shadow-sm backdrop-blur md:block">
          <div className="mb-8 flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Database className="size-5" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-none">DataPlus</p>
              <p className="text-xs text-muted-foreground">Operations console</p>
            </div>
          </div>
          <nav className="grid gap-1">
            {navItems.map((item) => {
              const Icon = item.icon
              return (
                <Button
                  key={item.id}
                  variant={view === item.id ? "secondary" : "ghost"}
                  className="justify-start"
                  onClick={() => navigateTo(item.id)}
                >
                  <Icon className="size-4" />
                  {item.label}
                </Button>
              )
            })}
          </nav>
          <Separator className="my-5" />
          <Button asChild variant="outline" className="w-full justify-start">
            <a href="/legacy" target="_blank" rel="noreferrer">
              <ExternalLink className="size-4" />
              Old UI fallback
            </a>
          </Button>
        </aside>

        <main className="md:pl-64">
          <header className="sticky top-0 z-10 border-b bg-background/85 px-5 py-3 backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Local MVP</p>
                <h1 className="text-xl font-semibold tracking-tight">DataPlus Console</h1>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={workerStatus.online ? "default" : "secondary"}>
                  {workerStatus.online ? "Worker online" : "Worker idle"}
                </Badge>
                <Button variant="outline" size="sm" onClick={() => refreshData()}>
                  <RefreshCw className="size-4" />
                  Refresh
                </Button>
              </div>
            </div>
          </header>

          <div className="p-5">
            {loading ? (
              <LoadingState />
            ) : (
              <>
                {view === "overview" && (
                  <OverviewPage
                    jobs={jobs}
                    activeJobs={activeJobs}
                    attentionJobs={attentionJobs}
                    shopify={shopify}
                    vendors={state.vendors || []}
                    onOpenJobs={() => navigateTo("jobs")}
                    onOpenShopify={() => navigateTo("channels")}
                  />
                )}
                {view === "jobs" && (
                  <JobsPage
                    jobs={jobs}
                    activeJobs={activeJobs}
                    workerStatus={workerStatus}
                    totalJobs={jobPageMeta.total}
                    page={jobPageMeta.page}
                    pageSize={jobPageMeta.limit}
                    selectedJob={selectedJob}
                    onSelectJob={loadJobDetail}
                    onLoadJobs={(next) => loadJobs(next)}
                    onStopJob={(job) => mutateJob(`/api/import-jobs/${encodeURIComponent(job.id)}/stop`, "Job stopped.")}
                    onRetryJob={(job) => mutateJob(`/api/import-jobs/${encodeURIComponent(job.id)}/retry`, "Retry queued.")}
                    onCleanup={() => mutateJob("/api/import-jobs/cleanup", "Jobs cleaned.")}
                    onRefresh={() => refreshData()}
                  />
                )}
                {view === "channels" && (
                  <ChannelsPage
                    channels={state.connections || []}
                    warehouses={state.warehouses || []}
                    jobs={shopifyInventoryJobs}
                    auth={shopifyAuth}
                    checking={checkingShopify}
                    onCheckShopify={checkShopifyConnection}
                    onRefreshShopifyToken={refreshShopifyToken}
                    onSaveChannel={saveChannel}
                    onRunShopifyAction={runShopifyAction}
                    onRefreshData={() => refreshData({ quiet: true })}
                  />
                )}
                {view === "catalog" && <CatalogPage />}
                {view === "product-detail" && <StandaloneProductPage />}
                {view === "vendors" && (
                  <VendorsPage
                    vendors={state.vendors || []}
                    onSaveVendor={saveVendor}
                  />
                )}
                {view === "settings" && (
                  <SettingsPage
                    settings={state.systemSettings || {}}
                    workerStatus={workerStatus}
                    onSaveSettings={saveSystemSettings}
                  />
                )}
              </>
            )}
          </div>
        </main>
        <FloatingActions
          view={view}
          shopify={shopify}
          onNavigate={navigateTo}
          onRefresh={() => refreshData()}
          onCheckShopify={checkShopifyConnection}
          onRefreshShopifyToken={refreshShopifyToken}
          onRunShopifyAction={runShopifyAction}
          onCleanupJobs={() => mutateJob("/api/import-jobs/cleanup", "Jobs cleaned.")}
        />
      </div>
      <Toaster richColors closeButton />
    </TooltipProvider>
  )
}

function LoadingState() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-28" />
      <div className="grid gap-4 lg:grid-cols-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-96" />
    </div>
  )
}

function OverviewPage({
  jobs,
  activeJobs,
  attentionJobs,
  shopify,
  vendors,
  onOpenJobs,
  onOpenShopify,
}: {
  jobs: ImportJob[]
  activeJobs: ImportJob[]
  attentionJobs: ImportJob[]
  shopify?: ChannelConnection
  vendors: Vendor[]
  onOpenJobs: () => void
  onOpenShopify: () => void
}) {
  const failedJobs = attentionJobs.filter((job) => String(job.status).toLowerCase() === "failed")
  const activeVendors = vendors.filter((vendor) => String(vendor.status || "active").toLowerCase() === "active")
  return (
    <div className="grid gap-5">
      <Alert variant={failedJobs.length ? "destructive" : "default"}>
        {failedJobs.length ? <FileWarning className="size-4" /> : <CheckCircle2 className="size-4" />}
        <AlertTitle>{failedJobs.length ? "Work needs attention" : "System is ready"}</AlertTitle>
        <AlertDescription>
          {failedJobs.length
            ? `${failedJobs.length.toLocaleString()} failed jobs need review. Start with Job History.`
            : "No active failures were found in the current job history."}
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total jobs" value={jobs.length} icon={History} />
        <MetricCard label="Running now" value={activeJobs.length} icon={Activity} />
        <MetricCard label="Active vendors" value={activeVendors.length} icon={Warehouse} />
        <MetricCard label="Shopify" value={shopify?.shopifyConfig?.configured ? "Connected" : "Review"} icon={ShoppingBag} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>Priority queue</CardTitle>
              <CardDescription>Background work that needs a human decision.</CardDescription>
            </div>
            <Button onClick={onOpenJobs}>Open jobs</Button>
          </CardHeader>
          <CardContent className="grid gap-2">
            {attentionJobs.slice(0, 5).map((job) => (
              <div key={job.id} className="grid gap-1 rounded-md border p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold">{job.operation || "Job"}</p>
                  <Badge variant={jobStatusTone(job.status)}>{job.status || "done"}</Badge>
                </div>
                <p className="line-clamp-2 text-xs text-muted-foreground">{job.message || "Review job details."}</p>
              </div>
            ))}
            {!attentionJobs.length && <p className="text-sm text-muted-foreground">No jobs need attention right now.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Shopify connection</CardTitle>
            <CardDescription>Admin API readiness for catalog, inventory, and price pushes.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2 text-sm">
              <Detail label="Store" value={shopify?.shopifyConfig?.shop || "Missing"} />
              <Detail label="API version" value={shopify?.shopifyConfig?.apiVersion || "2026-04"} />
              <Detail label="Credentials" value={shopify?.shopifyConfig?.hasClientCredentials ? "Client auth set" : "Needs auth"} />
            </div>
            <Button variant="outline" onClick={onOpenShopify}>
              Open channel settings
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function MetricCard({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string | number
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4 p-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">{typeof value === "number" ? numberLabel(value) : value}</p>
        </div>
        <div className="grid size-10 place-items-center rounded-md bg-muted">
          <Icon className="size-5 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  )
}

function JobsPage({
  jobs,
  activeJobs,
  workerStatus,
  totalJobs,
  page,
  pageSize,
  selectedJob,
  onSelectJob,
  onLoadJobs,
  onStopJob,
  onRetryJob,
  onCleanup,
  onRefresh,
}: {
  jobs: ImportJob[]
  activeJobs: ImportJob[]
  workerStatus: WorkerStatus
  totalJobs: number
  page: number
  pageSize: number
  selectedJob?: ImportJob
  onSelectJob: (job: ImportJob) => void
  onLoadJobs: (next: { page?: number; limit?: number; status?: string; query?: string }) => void
  onStopJob: (job: ImportJob) => void
  onRetryJob: (job: ImportJob) => void
  onCleanup: () => void
  onRefresh: () => void
}) {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("all")
  const [tab, setTab] = useState("queue")

  const visibleJobs = tab === "logs"
    ? jobs.filter((job) => String(job.direction || job.type || "").toLowerCase().includes("api") || /shopify|ebay|api/i.test(`${job.operation || ""} ${job.fileName || ""}`))
    : jobs
  const totalPages = Math.max(1, Math.ceil(totalJobs / pageSize))
  const issueGroups = useMemo(() => {
    const groups = new Map<string, number>()
    for (const job of jobs.filter(isAttentionJob)) {
      const key = `${jobCategory(job)} / ${job.operation || "Job"}`
      groups.set(key, (groups.get(key) || 0) + 1)
    }
    return [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [jobs])

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="Operations"
        title="Jobs"
        description="Queue, history, API logs, artifacts, and worker health in one compact table."
        action={(
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCleanup}>Clean stale</Button>
            <Button onClick={onRefresh}><RefreshCw className="size-4" /> Refresh</Button>
          </div>
        )}
      />

      <div className="grid gap-3 lg:grid-cols-4">
        <MetricCard label="Jobs found" value={totalJobs} icon={History} />
        <MetricCard label="Needs review" value={jobs.filter(isAttentionJob).length} icon={AlertCircle} />
        <MetricCard label="Active" value={activeJobs.length} icon={Play} />
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Worker</p>
            <div className="mt-2 flex items-center gap-2">
              <Badge variant={workerStatus.online ? "default" : "secondary"}>{workerStatus.online ? "online" : "idle"}</Badge>
              <span className="truncate text-sm text-muted-foreground">{workerStatus.currentTask || workerStatus.workerId || "No task"}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className={activeJobs.length ? "border-primary/30" : ""}>
        <CardHeader className="border-b py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Live activity</CardTitle>
              <CardDescription>{activeJobs.length ? "Jobs currently queued or running. This section stays visible regardless of history filters." : "No jobs are queued or running."}</CardDescription>
            </div>
            <Badge variant={activeJobs.length ? "default" : "outline"}>{activeJobs.length} active</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {activeJobs.length ? <div className="divide-y">{activeJobs.map((job) => <button key={job.id} type="button" className="grid w-full grid-cols-[auto_minmax(0,1fr)_minmax(160px,260px)_auto] items-center gap-3 px-4 py-3 text-left hover:bg-muted/45" onClick={() => onSelectJob(job)}><Badge variant={jobStatusTone(job.status)}>{job.status || "running"}</Badge><div className="min-w-0"><p className="truncate text-sm font-medium">{job.operation || "Job"}</p><p className="truncate text-xs text-muted-foreground">{job.message || job.workerTask || job.id}</p></div><div className="hidden min-w-0 items-center gap-2 sm:flex"><Progress value={jobProgress(job)} className="h-1.5" /><span className="w-10 text-right text-xs text-muted-foreground">{jobProgress(job)}%</span></div><span className="text-xs text-muted-foreground">{numberLabel(job.processedRows)} / {numberLabel(job.totalRows)}</span></button>)}</div> : <div className="px-6 py-5 text-sm text-muted-foreground">New jobs will appear here the moment they are queued.</div>}
        </CardContent>
      </Card>

      {!!issueGroups.length && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">API issues grouped by workflow</CardTitle>
            <CardDescription>Use these to see if repeated jobs are duplicates or a recurring API problem.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {issueGroups.map(([name, count]) => (
              <Badge key={name} variant="outline" className="gap-2 rounded-md px-3 py-2">
                <span className="max-w-64 truncate">{name}</span>
                <span>{count}</span>
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={(value) => { setTab(value); onLoadJobs({ page: 1 }) }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="queue">Queue and history</TabsTrigger>
            <TabsTrigger value="logs">Channel logs</TabsTrigger>
          </TabsList>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
              <Input className="w-72 pl-8" placeholder="Search jobs, files, messages" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onLoadJobs({ page: 1, query, status }) }} />
            </div>
            <Button size="sm" variant="outline" onClick={() => onLoadJobs({ page: 1, query, status })}>Search</Button>
            <Select value={status} onValueChange={(value) => { setStatus(value); onLoadJobs({ page: 1, query, status: value }) }}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="queued">Queued</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="stopped">Stopped</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <TabsContent value={tab} className="mt-4">
          <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
            <Card>
              <CardHeader className="border-b py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{tab === "logs" ? "Channel Logs" : "Import Queue and History"}</CardTitle>
                    <CardDescription>{totalJobs ? `${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, totalJobs)} of ${numberLabel(totalJobs)} jobs` : "No jobs found"}</CardDescription>
                  </div>
                  <div className="flex gap-1">
                    {[10, 25, 50, 100].map((size) => (
                      <Button
                        key={size}
                        size="sm"
                        variant={pageSize === size ? "default" : "outline"}
                        onClick={() => onLoadJobs({ page: 1, limit: size, query, status })}
                      >
                        {size}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Job</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Progress</TableHead>
                      <TableHead>Rows</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead>Worker</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleJobs.map((job) => (
                      <TableRow key={job.id} className="cursor-pointer" onClick={() => onSelectJob(job)}>
                        <TableCell><Badge variant={jobStatusTone(job.status)}>{job.status || "done"}</Badge></TableCell>
                        <TableCell className="max-w-[360px]">
                          <p className="truncate font-medium">{job.operation || "Job"}</p>
                          <p className="truncate text-xs text-muted-foreground">{job.fileName || job.message || job.id}</p>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{jobCategory(job)}</TableCell>
                        <TableCell className="min-w-36">
                          <div className="flex items-center gap-2">
                            <Progress value={jobProgress(job)} className="h-1.5" />
                            <span className="w-10 text-xs text-muted-foreground">{jobProgress(job)}%</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{numberLabel(job.processedRows)} / {numberLabel(job.totalRows)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{dateLabel(job.startedAt || job.createdAt)}</TableCell>
                        <TableCell className="max-w-40 truncate text-sm text-muted-foreground">{job.workerId || job.workerTask || "n/a"}</TableCell>
                        <TableCell>
                          <JobActionMenu job={job} onStop={onStopJob} onRetry={onRetryJob} />
                        </TableCell>
                      </TableRow>
                    ))}
                    {!visibleJobs.length && (
                      <TableRow>
                        <TableCell colSpan={8} className="h-28 text-center text-muted-foreground">No jobs match these filters.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <JobDetail job={selectedJob} onRetry={onRetryJob} onStop={onStopJob} />
          </div>

          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Page {page} of {totalPages}</p>
            <div className="flex gap-2">
              <Button variant="outline" disabled={page <= 1} onClick={() => onLoadJobs({ page: Math.max(1, page - 1), query, status })}>Previous</Button>
              <Button variant="outline" disabled={page >= totalPages} onClick={() => onLoadJobs({ page: Math.min(totalPages, page + 1), query, status })}>Next</Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function JobActionMenu({ job, onStop, onRetry }: { job: ImportJob; onStop: (job: ImportJob) => void; onRetry: (job: ImportJob) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" onClick={(event) => event.stopPropagation()}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => window.open(`/legacy/jobs?job=${encodeURIComponent(job.id)}`, "_blank")}>Open full detail</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onRetry(job)} disabled={!job.workerTask || isActiveJob(job)}>
          <RotateCcw className="size-4" />
          Retry
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onStop(job)} disabled={!isActiveJob(job)}>
          <Square className="size-4" />
          Stop job
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => window.open(`/api/import-jobs/${encodeURIComponent(job.id)}/original?inline=1`, "_blank")}>
          <FileDown className="size-4" />
          Original file
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => window.open(`/api/import-jobs/${encodeURIComponent(job.id)}/errors.csv?inline=1`, "_blank")}>
          <FileDown className="size-4" />
          Errors CSV
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function JobDetail({ job, onRetry, onStop }: { job?: ImportJob; onRetry: (job: ImportJob) => void; onStop: (job: ImportJob) => void }) {
  if (!job) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">Select a job to inspect details.</CardContent>
      </Card>
    )
  }

  return (
    <Card className="xl:sticky xl:top-20">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{job.operation || "Job detail"}</CardTitle>
            <CardDescription className="break-all">{job.id}</CardDescription>
          </div>
          <Badge variant={jobStatusTone(job.status)}>{job.status || "done"}</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => onRetry(job)} disabled={!job.workerTask || isActiveJob(job)}>
            <RotateCcw className="size-4" /> Retry
          </Button>
          <Button size="sm" variant="outline" onClick={() => onStop(job)} disabled={!isActiveJob(job)}>
            <Square className="size-4" /> Stop
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a href={`/legacy/jobs?job=${encodeURIComponent(job.id)}`} target="_blank" rel="noreferrer">Full detail</a>
          </Button>
        </div>
        <Progress value={jobProgress(job)} />
        <div className="grid grid-cols-2 gap-2">
          <Detail label="Category" value={jobCategory(job)} />
          <Detail label="Type" value={job.direction || job.type || "sync"} />
          <Detail label="Started" value={dateLabel(job.startedAt || job.createdAt)} />
          <Detail label="Finished" value={dateLabel(job.finishedAt)} />
          <Detail label="Rows" value={numberLabel(job.totalRows)} />
          <Detail label="Processed" value={numberLabel(job.processedRows)} />
          <Detail label="Changed" value={numberLabel(job.changed)} />
          <Detail label="Missing" value={numberLabel(job.missingCount)} />
        </div>
        {job.message && (
          <div className="rounded-md border bg-muted/45 p-3">
            <p className="font-medium">Status message</p>
            <p className="mt-1 text-muted-foreground">{job.message}</p>
          </div>
        )}
        {job.details && (
          <div className="rounded-md border bg-muted/45 p-3">
            <p className="font-medium">Details</p>
            <p className="mt-1 line-clamp-6 text-muted-foreground">{job.details}</p>
          </div>
        )}
        {!!job.errors?.length && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <p className="font-medium text-destructive">Error preview</p>
            <p className="mt-1 line-clamp-5 text-muted-foreground">{job.errors[0]}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ChannelsPage({
  channels,
  warehouses,
  jobs,
  auth,
  checking,
  onCheckShopify,
  onRefreshShopifyToken,
  onSaveChannel,
  onRunShopifyAction,
  onRefreshData,
}: {
  channels: ChannelConnection[]
  warehouses: Array<Record<string, unknown>>
  jobs: ImportJob[]
  auth: ShopifyAuthCheck | null
  checking: boolean
  onCheckShopify: () => void
  onRefreshShopifyToken: () => void
  onSaveChannel: (id: string, patch: Record<string, unknown>) => Promise<void>
  onRunShopifyAction: (options: { path: string; body?: Record<string, unknown>; confirmMessage?: string; successMessage?: string }) => Promise<void>
  onRefreshData: () => void
}) {
  const [selectedId, setSelectedId] = useState("")
  const selectedChannel = channels.find((channel) => channel.id === selectedId) || channels.find((channel) => channel.name?.toLowerCase() === "shopify") || channels[0]

  useEffect(() => {
    if (!selectedId && selectedChannel?.id) setSelectedId(selectedChannel.id)
  }, [selectedChannel?.id, selectedId])

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="Marketplace"
        title="Channel Settings"
        description="Compact tabs for connection health, defaults, schedules, mappings, and channel logs."
        action={(
          <Button asChild variant="outline">
            <a href="/legacy/channels" target="_blank" rel="noreferrer"><ExternalLink className="size-4" /> Legacy channels</a>
          </Button>
        )}
      />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Channels</CardTitle>
            <CardDescription>Select a marketplace to configure.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {channels.map((channel) => (
              <Button
                key={channel.id}
                variant={selectedChannel?.id === channel.id ? "secondary" : "ghost"}
                className="justify-between"
                onClick={() => setSelectedId(channel.id)}
              >
                <span>{channel.name}</span>
                <Badge variant={channel.connected ? "default" : "outline"}>{channel.status || (channel.connected ? "active" : "draft")}</Badge>
              </Button>
            ))}
          </CardContent>
        </Card>
        {selectedChannel ? (
          <ChannelDetail
            channel={selectedChannel}
            warehouses={warehouses}
            jobs={jobs}
            auth={auth}
            checking={checking}
            onCheckShopify={onCheckShopify}
            onRefreshShopifyToken={onRefreshShopifyToken}
            onSave={onSaveChannel}
            onRunShopifyAction={onRunShopifyAction}
            onRefreshData={onRefreshData}
          />
        ) : (
          <Card><CardContent className="p-6 text-muted-foreground">No channels found.</CardContent></Card>
        )}
      </div>
    </div>
  )
}

function ChannelDetail({
  channel,
  warehouses,
  jobs,
  auth,
  checking,
  onCheckShopify,
  onRefreshShopifyToken,
  onSave,
  onRunShopifyAction,
  onRefreshData,
}: {
  channel: ChannelConnection
  warehouses: Array<Record<string, unknown>>
  jobs: ImportJob[]
  auth: ShopifyAuthCheck | null
  checking: boolean
  onCheckShopify: () => void
  onRefreshShopifyToken: () => void
  onSave: (id: string, patch: Record<string, unknown>) => Promise<void>
  onRunShopifyAction: (options: { path: string; body?: Record<string, unknown>; confirmMessage?: string; successMessage?: string }) => Promise<void>
  onRefreshData: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const isShopify = channel.name?.toLowerCase() === "shopify"
  const settings = { ...(channel.settings || {}), ...draft }
  const shippingProfiles = Array.isArray(channel.settings?.shopifyShippingProfiles) ? channel.settings.shopifyShippingProfiles : []
  const scheduleTimes = String(settings.inventoryScheduleTimes || "03:00,13:00").split(/[,;\s]+/).filter(Boolean)
  const selectedWarehouseId = String(settings.shopifyInventoryWarehouseId || "")

  useEffect(() => {
    setDraft({})
    setEditing(false)
  }, [channel.id])

  function update(field: string, value: unknown) {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  async function save() {
    await onSave(channel.id, draft)
    setDraft({})
    setEditing(false)
  }

  async function syncShippingProfiles() {
    try {
      const result = await api<{ channel: ChannelConnection; message?: string }>(
        "/api/shopify/shipping-profiles/sync",
        { method: "POST", body: JSON.stringify({}) },
      )
      toast.success(result.message || "Shipping profiles imported.")
      onRefreshData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to import Shopify shipping profiles.")
    }
  }

  function queueShopifyAction(kind: string, apply = false) {
    const inventoryLocationId = String(settings.shopifyInventoryLocationId || "")
    const inventoryWarehouseId = String(settings.shopifyInventoryWarehouseId || "")
    const actionMap: Record<string, { path: string; body: Record<string, unknown>; confirmMessage?: string; successMessage: string }> = {
      status: {
        path: "/api/shopify/status-sync-all",
        body: { limit: Number(settings.shopifyStatusSyncLimit || 100) || 100 },
        successMessage: "Shopify status sync queued.",
      },
      skuMap: {
        path: "/api/shopify/sku-map-sync",
        body: {},
        successMessage: "Shopify SKU pair audit queued.",
      },
      inventoryDryRun: {
        path: "/api/shopify/inventory-update",
        body: { apply: false, dryRun: true, warehouseId: inventoryWarehouseId, locationId: inventoryLocationId },
        successMessage: "Shopify inventory dry run queued.",
      },
      inventoryApply: {
        path: "/api/shopify/inventory-update",
        body: { apply: true, dryRun: false, warehouseId: inventoryWarehouseId, locationId: inventoryLocationId },
        confirmMessage: "Push inventory updates to live Shopify now? This should only be used after the dry run looks good.",
        successMessage: "Shopify inventory update queued.",
      },
      priceDryRun: {
        path: "/api/shopify/variant-price-push",
        body: { apply: false, dryRun: true },
        successMessage: "Shopify price dry run queued.",
      },
      priceApply: {
        path: "/api/shopify/variant-price-push",
        body: { apply: true, dryRun: false },
        confirmMessage: "Push DataPlus prices to live Shopify variants now? Run a price dry run first if you have not reviewed it.",
        successMessage: "Shopify price push queued.",
      },
      createDryRun: {
        path: "/api/shopify/product-create",
        body: { apply: false, dryRun: true, limit: 100 },
        successMessage: "Shopify product create dry run queued.",
      },
      createApply: {
        path: "/api/shopify/product-create",
        body: { apply: true, dryRun: false, limit: 100 },
        confirmMessage: "Create new live Shopify products now? This should only be used after reviewing a create dry run.",
        successMessage: "Shopify product creation queued.",
      },
      linkDryRun: {
        path: "/api/shopify/link-existing-variants",
        body: { apply: false, dryRun: true, limit: 50000 },
        successMessage: "Shopify existing-link dry run queued.",
      },
      linkApply: {
        path: "/api/shopify/link-existing-variants",
        body: { apply: true, dryRun: false, limit: 50000 },
        confirmMessage: "Backfill DataPlus links from existing Shopify variants now? This will update DataPlus mappings.",
        successMessage: "Shopify existing-link backfill queued.",
      },
      collectionsDryRun: {
        path: "/api/shopify/product-type-collections-sync",
        body: { apply: false, dryRun: true },
        successMessage: "Shopify product type and collections dry run queued.",
      },
      collectionsApply: {
        path: "/api/shopify/product-type-collections-sync",
        body: { apply: true, dryRun: false },
        confirmMessage: "Push product type and smart collection updates to live Shopify now?",
        successMessage: "Shopify product type and collections sync queued.",
      },
      taxonomyDryRun: {
        path: "/api/shopify/taxonomy-push",
        body: { apply: false, dryRun: true },
        successMessage: "Shopify taxonomy dry run queued.",
      },
      taxonomyApply: {
        path: "/api/shopify/taxonomy-push",
        body: { apply: true, dryRun: false },
        confirmMessage: "Push Shopify taxonomy updates to live products now?",
        successMessage: "Shopify taxonomy push queued.",
      },
    }
    const action = actionMap[kind]
    if (!action) return
    if (apply && kind === "inventoryApply" && !settings.shopifyInventoryPushEnabled) {
      toast.error("Enable DataPlus inventory push before applying inventory updates.")
      return
    }
    onRunShopifyAction(action)
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <ChannelLogo channel={channel} />
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Marketplace channel</p>
              <CardTitle>{channel.name}</CardTitle>
              <CardDescription>{channel.connected ? "Connected" : "Not connected"} / {channel.status || "draft"}</CardDescription>
            </div>
          </div>
          <div className="flex gap-2">
            {editing ? (
              <>
                <Button variant="outline" onClick={() => { setEditing(false); setDraft({}) }}>Cancel</Button>
                <Button onClick={save}>Save changes</Button>
              </>
            ) : (
              <Button onClick={() => setEditing(true)}>Edit</Button>
            )}
          </div>
        </CardHeader>
      </Card>

      <Tabs defaultValue="overview">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="actions">Actions</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="mappings">Mappings</TabsTrigger>
          <TabsTrigger value="variants">Variants</TabsTrigger>
          <TabsTrigger value="skus">SKUs</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="grid gap-4">
          {isShopify && (
            <Card className={auth?.ok ? "border-emerald-300" : ""}>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {auth?.ok ? <CheckCircle2 className="size-5 text-emerald-600" /> : <ShieldCheck className="size-5" />}
                    Shopify connection health
                  </CardTitle>
                  <CardDescription>{auth?.message || "Run a connection check before major Shopify jobs."}</CardDescription>
                </div>
                <Button onClick={onCheckShopify} disabled={checking}>
                  {checking ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  Check connection
                </Button>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-4">
                <Detail label="Store" value={channel.shopifyConfig?.shop || auth?.shop?.myshopifyDomain || "Missing"} />
                <Detail label="API version" value={channel.shopifyConfig?.apiVersion || "2026-04"} />
                <Detail label="Token source" value={auth?.tokenSource || "Configured"} />
                <Detail label="read_shipping" value={auth?.hasReadShipping ? "Active" : auth ? "Missing" : "Unchecked"} />
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Channel defaults</CardTitle>
              <CardDescription>These values are used when new SKUs are prepared for this channel.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              <Detail label="Shadow status" value={String(settings.defaultShadowStatus || "Draft")} />
              <Detail label="Handling days" value={String(settings.defaultHandlingTimeDays ?? 0)} />
              <Detail label="Safety qty" value={String(settings.defaultSafetyQty ?? 0)} />
              <Detail label="Max sellable qty" value={String(settings.defaultMaxSellableQty ?? 0)} />
              <Detail label="Shipping profile" value={String(settings.defaultShippingProfile || "Standard")} />
              <Detail label="Shipping service" value={String(settings.defaultShippingService || "Marketplace Standard")} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="setup">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Editable setup</CardTitle>
              <CardDescription>Click Edit above before changing values. Dark/disabled fields are locked.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Default shadow status">
                <Select disabled={!editing} value={String(settings.defaultShadowStatus || "Draft")} onValueChange={(value) => update("defaultShadowStatus", value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Draft">Draft</SelectItem>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Default handling days">
                <Input disabled={!editing} type="number" value={String(settings.defaultHandlingTimeDays ?? 0)} onChange={(event) => update("defaultHandlingTimeDays", Number(event.target.value || 0))} />
              </Field>
              <Field label="Default safety qty">
                <Input disabled={!editing} type="number" value={String(settings.defaultSafetyQty ?? 0)} onChange={(event) => update("defaultSafetyQty", Number(event.target.value || 0))} />
              </Field>
              <Field label="Default max sellable qty">
                <Input disabled={!editing} type="number" value={String(settings.defaultMaxSellableQty ?? 0)} onChange={(event) => update("defaultMaxSellableQty", Number(event.target.value || 0))} />
              </Field>
              <Field label="Default shipping profile">
                {shippingProfiles.length ? (
                  <Select disabled={!editing} value={String(settings.defaultShippingProfile || "")} onValueChange={(value) => update("defaultShippingProfile", value)}>
                    <SelectTrigger><SelectValue placeholder="Select profile" /></SelectTrigger>
                    <SelectContent>
                      {shippingProfiles.map((profile) => (
                        <SelectItem key={profile.id || profile.name} value={profile.name || profile.id || ""}>{profile.name || profile.id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input disabled={!editing} value={String(settings.defaultShippingProfile || "")} onChange={(event) => update("defaultShippingProfile", event.target.value)} />
                )}
              </Field>
              <Field label="Default shipping service">
                <Input disabled={!editing} value={String(settings.defaultShippingService || "")} onChange={(event) => update("defaultShippingService", event.target.value)} />
              </Field>
              {isShopify && <>
                <div className="col-span-full pt-2"><Separator /><p className="pt-3 text-sm font-semibold">Shopify Admin API</p></div>
                <Field label="Store domain">
                  <Input disabled={!editing} value={String(settings.shopifyStoreDomain || channel.shopifyConfig?.shop || "")} placeholder="store.myshopify.com" onChange={(event) => update("shopifyStoreDomain", event.target.value)} />
                </Field>
                <Field label="Admin API version">
                  <Input disabled={!editing} value={String(settings.shopifyAdminApiVersion || channel.shopifyConfig?.apiVersion || "2026-04")} onChange={(event) => update("shopifyAdminApiVersion", event.target.value)} />
                </Field>
                <Field label="Status sync limit">
                  <Input disabled={!editing} min="1" max="500" type="number" value={String(settings.shopifyStatusSyncLimit ?? 100)} onChange={(event) => update("shopifyStatusSyncLimit", Number(event.target.value || 100))} />
                </Field>
                <div className="col-span-full pt-2"><Separator /><p className="pt-3 text-sm font-semibold">Shopify product defaults</p></div>
                <Field label="Default product status">
                  <Select disabled={!editing} value={String(settings.shopifyDefaultStatus || "draft")} onValueChange={(value) => update("shopifyDefaultStatus", value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="draft">Draft</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="archived">Archived</SelectItem></SelectContent>
                  </Select>
                </Field>
                <Field label="Inventory policy">
                  <Select disabled={!editing} value={String(settings.shopifyInventoryPolicy || "deny")} onValueChange={(value) => update("shopifyInventoryPolicy", value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="deny">Deny oversell</SelectItem><SelectItem value="continue">Continue selling</SelectItem></SelectContent>
                  </Select>
                </Field>
                <Field label="Fulfillment service">
                  <Input disabled={!editing} value={String(settings.shopifyFulfillmentService || "manual")} onChange={(event) => update("shopifyFulfillmentService", event.target.value)} />
                </Field>
                <Field label="Publish scope">
                  <Select disabled={!editing} value={String(settings.shopifyPublishScope || "global")} onValueChange={(value) => update("shopifyPublishScope", value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="global">Global</SelectItem><SelectItem value="web">Web</SelectItem></SelectContent>
                  </Select>
                </Field>
                <ToggleField label="Enable Shopify status sync" checked={Boolean(settings.shopifySyncStatusEnabled)} disabled={!editing} onCheckedChange={(value) => update("shopifySyncStatusEnabled", value)} />
                <ToggleField label="Auto-sync after API actions" checked={Boolean(settings.shopifyAutoSyncStatus)} disabled={!editing} onCheckedChange={(value) => update("shopifyAutoSyncStatus", value)} />
                <ToggleField label="Manage Closeouts collection" checked={Boolean(settings.shopifyCloseoutsEnabled)} disabled={!editing} onCheckedChange={(value) => update("shopifyCloseoutsEnabled", value)} />
              </>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="actions">
          {isShopify ? (
            <div className="grid gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Connection and setup actions</CardTitle>
                  <CardDescription>These do not change products. Use them to verify credentials and import Shopify setup data.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Button onClick={onCheckShopify}>Check connection</Button>
                  <Button variant="outline" onClick={onRefreshShopifyToken}>Request new token</Button>
                  <Button variant="outline" onClick={syncShippingProfiles}>Import shipping profiles</Button>
                  <Button variant="outline" onClick={() => queueShopifyAction("skuMap")}>Audit SKU pairs</Button>
                  <Button variant="outline" onClick={() => queueShopifyAction("status")}>Sync Shopify status</Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Product launch and linking</CardTitle>
                  <CardDescription>Run dry runs first. Live actions ask for confirmation before queueing.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <ActionTile
                    title="Create products"
                    description="Create missing ready products in Shopify."
                    dryRunLabel="Create dry run"
                    applyLabel="Create live"
                    onDryRun={() => queueShopifyAction("createDryRun")}
                    onApply={() => queueShopifyAction("createApply", true)}
                  />
                  <ActionTile
                    title="Link existing"
                    description="Match live Shopify variants back to DataPlus SKUs."
                    dryRunLabel="Link dry run"
                    applyLabel="Link live"
                    onDryRun={() => queueShopifyAction("linkDryRun")}
                    onApply={() => queueShopifyAction("linkApply", true)}
                  />
                  <ActionTile
                    title="Product types"
                    description="Update product type and collection assignments."
                    dryRunLabel="Types dry run"
                    applyLabel="Push types"
                    onDryRun={() => queueShopifyAction("collectionsDryRun")}
                    onApply={() => queueShopifyAction("collectionsApply", true)}
                  />
                  <ActionTile
                    title="Taxonomy"
                    description="Push mapped Shopify/Google taxonomy values."
                    dryRunLabel="Taxonomy dry run"
                    applyLabel="Push taxonomy"
                    onDryRun={() => queueShopifyAction("taxonomyDryRun")}
                    onApply={() => queueShopifyAction("taxonomyApply", true)}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Pricing and inventory</CardTitle>
                  <CardDescription>Live pricing and inventory affect checkout. Review dry runs before applying.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2">
                  <ActionTile
                    title="Variant prices"
                    description="Push DataPlus-calculated prices to linked Shopify variants."
                    dryRunLabel="Price dry run"
                    applyLabel="Push prices"
                    onDryRun={() => queueShopifyAction("priceDryRun")}
                    onApply={() => queueShopifyAction("priceApply", true)}
                  />
                  <ActionTile
                    title="Inventory"
                    description="Push DataPlus warehouse availability to Shopify inventory levels."
                    dryRunLabel="Inventory dry run"
                    applyLabel="Update inventory"
                    onDryRun={() => queueShopifyAction("inventoryDryRun")}
                    onApply={() => queueShopifyAction("inventoryApply", true)}
                  />
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Channel actions</CardTitle>
                <CardDescription>Advanced actions for this channel are still available in the legacy workspace.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" onClick={() => window.open("/legacy/channels", "_blank")}>Open advanced channel actions</Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="rules">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pricing and inventory rules</CardTitle>
              <CardDescription>Rules that background pushes use by default.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Price markup percent">
                <Input disabled={!editing} type="number" value={String(settings.priceMarkupPercent ?? 0)} onChange={(event) => update("priceMarkupPercent", Number(event.target.value || 0))} />
              </Field>
              <Field label="Minimum margin percent">
                <Input disabled={!editing} type="number" value={String(settings.minMarginPercent ?? 0)} onChange={(event) => update("minMarginPercent", Number(event.target.value || 0))} />
              </Field>
              <Field label="Rounding rule">
                <Select disabled={!editing} value={String(settings.roundingRule || "none")} onValueChange={(value) => update("roundingRule", value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">No rounding</SelectItem><SelectItem value="nearest .99">Nearest .99</SelectItem><SelectItem value="nearest .95">Nearest .95</SelectItem><SelectItem value="round up">Round up</SelectItem></SelectContent>
                </Select>
              </Field>
              <ToggleField label="Price updates" checked={Boolean(settings.priceUpdateEnabled)} disabled={!editing} onCheckedChange={(value) => update("priceUpdateEnabled", value)} />
              <ToggleField label="Inventory updates" checked={Boolean(settings.inventoryUpdateEnabled)} disabled={!editing} onCheckedChange={(value) => update("inventoryUpdateEnabled", value)} />
              <ToggleField label="Order downloads" checked={Boolean(settings.orderDownloadEnabled)} disabled={!editing} onCheckedChange={(value) => update("orderDownloadEnabled", value)} />
              <ToggleField label="Tracking updates" checked={Boolean(settings.trackingUpdateEnabled)} disabled={!editing} onCheckedChange={(value) => update("trackingUpdateEnabled", value)} />
              <ToggleField label="Auto-create shadows" checked={Boolean(settings.autoCreateShadow)} disabled={!editing} onCheckedChange={(value) => update("autoCreateShadow", value)} />
              {isShopify && <>
                <div className="col-span-full pt-2"><Separator /><p className="pt-3 text-sm font-semibold">Shopify inventory push</p></div>
                <Field label="DataPlus warehouse">
                  <Select disabled={!editing} value={selectedWarehouseId || "none"} onValueChange={(value) => update("shopifyInventoryWarehouseId", value === "none" ? "" : value)}>
                    <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Select mapped warehouse</SelectItem>
                      {warehouses.map((warehouse) => {
                        const id = String(warehouse.id || "")
                        const name = String(warehouse.name || warehouse.code || "Warehouse")
                        const location = String(warehouse.shopifyLocationName || warehouse.shopifyLocationId || "no Shopify location")
                        return id ? <SelectItem key={id} value={id}>{name} / {location}</SelectItem> : null
                      })}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Fallback Shopify location GID">
                  <Input disabled={!editing} value={String(settings.shopifyInventoryLocationId || "")} placeholder="gid://shopify/Location/..." onChange={(event) => update("shopifyInventoryLocationId", event.target.value)} />
                </Field>
                <Field label="Schedule type">
                  <Select disabled={!editing} value={String(settings.inventoryScheduleType || "times")} onValueChange={(value) => update("inventoryScheduleType", value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="times">Specific times</SelectItem><SelectItem value="interval">Every X hours</SelectItem></SelectContent>
                  </Select>
                </Field>
                <Field label="Run mode">
                  <Select disabled={!editing} value={String(settings.inventoryScheduleMode || "dry-run")} onValueChange={(value) => update("inventoryScheduleMode", value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="dry-run">Dry run only</SelectItem><SelectItem value="apply">Apply to Shopify</SelectItem></SelectContent>
                  </Select>
                </Field>
                <Field label="First run">
                  <Input disabled={!editing} type="time" value={scheduleTimes[0] || "03:00"} onChange={(event) => update("inventoryScheduleTimes", [event.target.value, scheduleTimes[1] || "13:00"].join(","))} />
                </Field>
                <Field label="Second run">
                  <Input disabled={!editing} type="time" value={scheduleTimes[1] || "13:00"} onChange={(event) => update("inventoryScheduleTimes", [scheduleTimes[0] || "03:00", event.target.value].join(","))} />
                </Field>
                <Field label="Every hours">
                  <Input disabled={!editing} type="number" min="1" max="24" value={String(settings.inventoryScheduleEveryHours ?? 12)} onChange={(event) => update("inventoryScheduleEveryHours", Number(event.target.value || 12))} />
                </Field>
                <ToggleField label="Enable DataPlus inventory push" checked={Boolean(settings.shopifyInventoryPushEnabled)} disabled={!editing} onCheckedChange={(value) => update("shopifyInventoryPushEnabled", value)} />
                <ToggleField label="Scheduled inventory updates" checked={Boolean(settings.inventoryScheduleEnabled)} disabled={!editing} onCheckedChange={(value) => update("inventoryScheduleEnabled", value)} />
                <ToggleField label="Require successful product dump" checked={Boolean(settings.inventoryScheduleRequireSuccessfulDump)} disabled={!editing} onCheckedChange={(value) => update("inventoryScheduleRequireSuccessfulDump", value)} />
                <div className="col-span-full pt-2"><Separator /><p className="pt-3 text-sm font-semibold">Shopify SKU pair audit</p><p className="pt-1 text-xs text-muted-foreground">Checks each Shopify SKU mapping and records both the parent Shopify product ID and the matching variant ID.</p></div>
                <Field label="Daily audit time">
                  <Input disabled={!editing} type="time" value={String(settings.shopifySkuMapScheduleTime || "02:00")} onChange={(event) => update("shopifySkuMapScheduleTime", event.target.value)} />
                </Field>
                <ToggleField label="Run daily SKU pair audit" checked={Boolean(settings.shopifySkuMapScheduleEnabled)} disabled={!editing} onCheckedChange={(value) => update("shopifySkuMapScheduleEnabled", value)} />
              </>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mappings">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Mappings</CardTitle>
              <CardDescription>Category and attribute mappings remain available without auto-loading the heavy legacy grid.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild variant="outline"><a href="/legacy/categories" target="_blank" rel="noreferrer">Category mappings</a></Button>
              <Button asChild variant="outline"><a href="/legacy/vendors" target="_blank" rel="noreferrer">Vendor category mappings</a></Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="variants">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Variant rules</CardTitle>
              <CardDescription>Channel-level rules are paired with vendor rules before product pushes.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              <Detail label="Inventory policy" value={String(settings.shopifyInventoryPolicy || "deny")} />
              <Detail label="Fulfillment service" value={String(settings.shopifyFulfillmentService || "manual")} />
              <Detail label="Publish scope" value={String(settings.shopifyPublishScope || "global")} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="skus">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">SKU tools</CardTitle>
              <CardDescription>Use legacy advanced grids for per-SKU review until the React catalog detail screen is migrated.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild variant="outline"><a href="/legacy/products" target="_blank" rel="noreferrer">Open product table</a></Button>
              <Button asChild variant="outline"><a href="/legacy/channels" target="_blank" rel="noreferrer">Open SKU channel tools</a></Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent channel logs</CardTitle>
              <CardDescription>Shopify inventory and API jobs connected to this channel.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {jobs.slice(0, 10).map((job) => (
                <div key={job.id} className="grid gap-1 rounded-md border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">{job.operation || "Shopify job"}</p>
                    <Badge variant={jobStatusTone(job.status)}>{job.status}</Badge>
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{job.message || job.fileName}</p>
                </div>
              ))}
              {!jobs.length && <p className="text-sm text-muted-foreground">No Shopify inventory jobs found.</p>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function ChannelLogo({ channel }: { channel: ChannelConnection }) {
  const src = channel.logoDataUrl || channel.logoUrl
  return (
    <div className="grid size-16 place-items-center overflow-hidden rounded-lg border bg-muted">
      {src ? <img src={src} alt="" className="max-h-full max-w-full object-contain p-2" /> : <ShoppingBag className="size-7 text-muted-foreground" />}
    </div>
  )
}

function ActionTile({
  title,
  description,
  dryRunLabel,
  applyLabel,
  onDryRun,
  onApply,
  applyDisabled = false,
}: {
  title: string
  description: string
  dryRunLabel: string
  applyLabel: string
  onDryRun: () => void
  onApply: () => void
  applyDisabled?: boolean
}) {
  return (
    <div className="grid gap-3 rounded-md border bg-background p-3">
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onDryRun}>{dryRunLabel}</Button>
        <Button size="sm" onClick={onApply} disabled={applyDisabled}>{applyLabel}</Button>
      </div>
    </div>
  )
}

const productEditableNumberFields = new Set([
  "websitePrice", "cost", "qty", "itemLength", "itemWidth", "itemHeight", "itemWeight",
  "packageLength", "packageWidth", "packageHeight", "packageWeight", "replenishableQty",
])

function ProductDetailSheet({
  sourceItem,
  open,
  onOpenChange,
  standalone = false,
}: {
  sourceItem: CatalogItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  standalone?: boolean
}) {
  const [product, setProduct] = useState<ProductItem | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string | number | boolean>>({})
  const [shopifyJob, setShopifyJob] = useState<ImportJob | null>(null)
  const [detailTab, setDetailTab] = useState("overview")
  const [alternates, setAlternates] = useState<CatalogItem[]>([])
  const [loadingAlternates, setLoadingAlternates] = useState(false)
  const [alternatesLoadedFor, setAlternatesLoadedFor] = useState("")

  const initializeDraft = (item: ProductItem) => {
    setDraft({
      mainCategory: item.mainCategory || item.category || "",
      websitePrice: item.websitePrice || item.price || 0,
      qty: item.qty || item.stockQty || 0,
      itemLength: item.itemLength || 0,
      itemWidth: item.itemWidth || 0,
      itemHeight: item.itemHeight || 0,
      itemWeight: item.itemWeight || 0,
      packageLength: item.packageLength || 0,
      packageWidth: item.packageWidth || 0,
      packageHeight: item.packageHeight || 0,
      packageWeight: item.packageWeight || 0,
      replenishableUseVendorRules: Boolean(item.replenishableUseVendorRules),
      replenishable: Boolean(item.replenishable),
      replenishableQtyUseVendorDefault: Boolean(item.replenishableQtyUseVendorDefault),
      replenishableQty: item.replenishableQty || 0,
    })
  }

  useEffect(() => {
    if (!open || !sourceItem?.sku) return
    let cancelled = false
    setLoading(true)
    setProduct(null)
    setEditing(false)
    setDetailTab("overview")
    setAlternates([])
    setAlternatesLoadedFor("")
    api<{ item: ProductItem }>(`/api/inventory/${encodeURIComponent(sourceItem.sku)}`)
      .then((result) => {
        if (cancelled) return
        setProduct(result.item)
        initializeDraft(result.item)
      })
      .catch(() => {
        if (!cancelled) setProduct(null)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, sourceItem?.sku])

  useEffect(() => {
    const alternateSku = product?.sku || ""
    if (detailTab !== "alternates" || !alternateSku || alternatesLoadedFor === alternateSku || loadingAlternates) return
    let cancelled = false
    setLoadingAlternates(true)
    api<{ alternates?: Record<string, CatalogItem[]> }>(`/api/catalog/alternates?sku=${encodeURIComponent(alternateSku)}`)
      .then((result) => { if (!cancelled) { setAlternates(result.alternates?.[alternateSku.toLowerCase()] || []); setAlternatesLoadedFor(alternateSku) } })
      .catch((error) => { if (!cancelled) toast.error(error instanceof Error ? error.message : "Unable to load alternate offers.") })
      .finally(() => { if (!cancelled) setLoadingAlternates(false) })
    return () => { cancelled = true }
  }, [alternatesLoadedFor, detailTab, loadingAlternates, product?.sku])

  async function promote() {
    if (!sourceItem?.sku) return
    setSaving(true)
    try {
      const result = await api<{ item: ProductItem }>("/api/catalog/promote", {
        method: "POST",
        body: JSON.stringify({ sku: sourceItem.sku }),
      })
      setProduct(result.item)
      initializeDraft(result.item)
      toast.success("Added to the main catalog. You can now configure this SKU.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to add SKU to the main catalog.")
    } finally {
      setSaving(false)
    }
  }

  async function save() {
    if (!product?.sku) return
    setSaving(true)
    try {
      const patch: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(draft)) {
        patch[key] = productEditableNumberFields.has(key) ? Number(value || 0) : value
      }
      const result = await api<{ item: ProductItem }>(`/api/inventory/${encodeURIComponent(product.sku)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      })
      setProduct(result.item)
      initializeDraft(result.item)
      setEditing(false)
      toast.success("SKU settings saved.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save SKU settings.")
    } finally {
      setSaving(false)
    }
  }

  async function queueShopifyAction(path: string, apply: boolean, label: string) {
    if (!product?.sku) return
    if (apply && product.toBeDiscontinued) {
      toast.error("Discontinued SKUs cannot be sent to Shopify.")
      return
    }
    if (apply && path.includes("product-create") && product.shopifyId) {
      toast.error("This SKU is already linked to Shopify. Use the price or inventory workflow instead.")
      return
    }
    if (apply && !window.confirm(`${label} for ${product.sku}? This queues a live Shopify update.`)) return
    setSaving(true)
    try {
      const result = await api<{ job?: ImportJob; message?: string }>(path, {
        method: "POST",
        body: JSON.stringify({ skus: [product.sku], dryRun: !apply, apply }),
      })
      setShopifyJob(result.job || null)
      toast.success(result.message || `${label} queued.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Unable to queue ${label.toLowerCase()}.`)
    } finally {
      setSaving(false)
    }
  }

  const setDraftValue = (key: string, value: string | number | boolean) => setDraft((current) => ({ ...current, [key]: value }))
  const sku = product?.sku || sourceItem?.sku || ""
  const usingVendorRules = Boolean(draft.replenishableUseVendorRules)
  const usingVendorQty = Boolean(draft.replenishableQtyUseVendorDefault)
  const openStandalone = () => {
    if (!sku) return
    window.history.pushState({}, "", `/products/${encodeURIComponent(sku)}`)
    window.dispatchEvent(new PopStateEvent("popstate"))
    onOpenChange(false)
  }

  const content = (
    <>
        <SheetHeader className="border-b pr-12">
          <div className="flex items-start gap-3">
            <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted">
              {sourceItem?.defaultImage ? <img src={sourceItem.defaultImage} alt="" className="max-h-full max-w-full object-contain" /> : <Boxes className="size-5 text-muted-foreground" />}
            </div>
            <div className="min-w-0">
              {standalone ? <><h2 className="truncate text-lg font-semibold">{sku || "Product"}</h2><p className="line-clamp-2 text-sm text-muted-foreground">{product?.title || sourceItem?.title || "Source catalog product"}</p></> : <><SheetTitle className="truncate">{sku || "Product"}</SheetTitle><SheetDescription className="line-clamp-2">{product?.title || sourceItem?.title || "Source catalog product"}</SheetDescription></>}
            </div>
            {!standalone && <Button size="sm" variant="outline" className="ml-auto shrink-0" onClick={openStandalone}><ExternalLink className="size-4" /> Open page</Button>}
          </div>
        </SheetHeader>

        {loading && <div className="grid gap-3 p-4"><Skeleton className="h-20" /><Skeleton className="h-52" /><Skeleton className="h-52" /></div>}

        {!loading && !product && (
          <div className="grid gap-4 p-4">
            <Alert>
              <Database className="size-4" />
              <AlertTitle>Source catalog product</AlertTitle>
              <AlertDescription>This SKU is in the supplier data dump but has not been added to the main catalog yet. Add it once to enable SKU rules, inventory, and Shopify controls.</AlertDescription>
            </Alert>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Detail label="Supplier" value={sourceItem?.supplier || "Unknown"} />
              <Detail label="Category" value={sourceItem?.mainCategory || sourceItem?.sourceCategory || "Uncategorized"} />
              <Detail label="Cost" value={moneyLabel(sourceItem?.cost)} />
              <Detail label="Source stock" value={numberLabel(sourceItem?.stockQty)} />
            </div>
            <Button onClick={promote} disabled={saving}>{saving && <Loader2 className="size-4 animate-spin" />} Add to main catalog</Button>
          </div>
        )}

        {!loading && product && (
          <div className="grid gap-5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                <Badge variant={product.active === false ? "outline" : "default"}>{product.active === false ? "Inactive" : "Active"}</Badge>
                <Badge variant={product.categoryVerified ? "default" : "outline"}>{product.categoryVerified ? "Category verified" : "Category needs review"}</Badge>
                {product.toBeDiscontinued && <Badge variant="destructive">Discontinued</Badge>}
              </div>
              <Button size="sm" variant={editing ? "outline" : "default"} onClick={() => { setEditing((current) => !current); if (!editing) initializeDraft(product) }}>
                <Pencil className="size-4" /> {editing ? "Cancel edit" : "Edit SKU"}
              </Button>
            </div>

            <Tabs value={detailTab} onValueChange={setDetailTab}>
              <TabsList className="w-full justify-start overflow-x-auto">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="content">Content</TabsTrigger>
                <TabsTrigger value="identifiers">Identifiers</TabsTrigger>
                <TabsTrigger value="commerce">Commerce</TabsTrigger>
                <TabsTrigger value="shipping">Shipping</TabsTrigger>
                <TabsTrigger value="media">Media</TabsTrigger>
                <TabsTrigger value="replenishable">Replenishable</TabsTrigger>
                <TabsTrigger value="shopify">Shopify</TabsTrigger>
                <TabsTrigger value="alternates">Alternates</TabsTrigger>
              </TabsList>
              <TabsContent value="overview" className="grid gap-4 pt-3">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Detail label="Supplier" value={product.supplier || product.vendor || "Unknown"} />
                  <Detail label="Brand" value={product.brand || "No brand"} />
                  <Detail label="UOM" value={product.uomDisplay || product.uomName || product.uom || "Each"} />
                  <Detail label="Vendor SKU" value={product.vendorSku || "-"} />
                  <Detail label="Barcode" value={product.barcode || "-"} />
                  <Detail label="Shopify" value={product.shopifyStatus || "Not linked"} />
                </div>
                <div className="grid gap-1.5"><Label>Main category</Label><Input disabled={!editing} value={String(draft.mainCategory ?? "")} onChange={(event) => setDraftValue("mainCategory", event.target.value)} /></div>
                <div className="grid grid-cols-2 gap-3 text-sm"><Detail label="Source category" value={product.sourceCategory || "-"} /><Detail label="Vendor category" value={product.vendorCategory || "-"} /></div>
                {product.tags?.length ? <div className="flex flex-wrap gap-1">{product.tags.slice(0, 12).map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}</div> : null}
              </TabsContent>

              <TabsContent value="content" className="grid gap-4 pt-3">
                <div className="grid gap-1.5"><Label>Short description</Label><div className="min-h-20 whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm">{product.shortDescription || "No short description."}</div></div>
                <div className="grid gap-1.5"><Label>Full description</Label><div className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm leading-6">{product.longDescription || "No full description."}</div></div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Detail label="Condition" value={product.condition || "New"} /><Detail label="Country of origin" value={product.countryOfOrigin || "-"} /><Detail label="Tags" value={numberLabel(product.tags?.length)} /><Detail label="Last updated" value={product.updatedAt ? new Date(product.updatedAt).toLocaleString() : "-"} /></div>
              </TabsContent>

              <TabsContent value="identifiers" className="grid gap-4 pt-3">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Detail label="Internal SKU" value={product.sku || "-"} /><Detail label="Vendor SKU" value={product.vendorSku || "-"} /><Detail label="Manufacturer" value={product.manufacturer || "-"} /><Detail label="Mfr part number" value={product.mfrPartNumber || "-"} /><Detail label="Barcode / UPC" value={product.barcode || "-"} /><Detail label="Supplier" value={product.supplier || product.vendor || "-"} /><Detail label="UOM" value={product.uomDisplay || product.uomName || product.uom || "Each"} /><Detail label="Status" value={product.status || (product.active === false ? "Inactive" : "Active")} /></div>
                <div className="grid gap-2"><Label>SKU aliases</Label>{product.aliases?.length ? <div className="flex flex-wrap gap-2">{product.aliases.map((alias, index) => <Badge key={`${alias.aliasSku || alias.sku}-${index}`} variant={alias.active === false ? "outline" : "secondary"}>{alias.aliasSku || alias.sku || "Alias"}{alias.active === false ? " (inactive)" : ""}</Badge>)}</div> : <p className="rounded-md border p-3 text-sm text-muted-foreground">No aliases recorded.</p>}</div>
              </TabsContent>

              <TabsContent value="commerce" className="grid gap-4 pt-3">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Detail label="Cost" value={moneyLabel(product.cost)} />
                  <Detail label="Sell-unit cost" value={moneyLabel(product.sellUnitCost)} />
                  <Detail label="On-hand" value={numberLabel(product.qty)} />
                  <Detail label="Reserved" value={numberLabel(product.reserved)} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5"><Label>Website price</Label><Input disabled={!editing} type="number" min="0" step="0.01" value={String(draft.websitePrice ?? 0)} onChange={(event) => setDraftValue("websitePrice", event.target.value)} /></div>
                  <div className="grid gap-1.5"><Label>On-hand quantity</Label><Input disabled={!editing} type="number" min="0" value={String(draft.qty ?? 0)} onChange={(event) => setDraftValue("qty", event.target.value)} /></div>
                </div>
                <Alert><ShoppingBag className="size-4" /><AlertTitle>Shopify state</AlertTitle><AlertDescription>{product.shopifyPublished ? "Published" : "Not published"}{product.shopifyLivePrice ? ` · Live price ${moneyLabel(product.shopifyLivePrice)}` : ""}{product.shopifyLiveInventoryQuantity !== undefined ? ` · Live inventory ${numberLabel(product.shopifyLiveInventoryQuantity)}` : ""}</AlertDescription></Alert>
              </TabsContent>

              <TabsContent value="shipping" className="grid gap-4 pt-3">
                <Alert><Truck className="size-4" /><AlertTitle>{product.shippingMethod || "Needs measurements"}</AlertTitle><AlertDescription>{product.shippingClassReason || "Enter package measurements to classify shipping."}{product.dimensionalWeight ? ` Dimensional weight: ${numberLabel(product.dimensionalWeight)} lb.` : ""}</AlertDescription></Alert>
                <div className="grid gap-3"><p className="text-sm font-medium">Item measurements</p><MeasurementInputs prefix="item" draft={draft} disabled={!editing} onChange={setDraftValue} /></div>
                <div className="grid gap-3"><p className="text-sm font-medium">Package measurements</p><MeasurementInputs prefix="package" draft={draft} disabled={!editing} onChange={setDraftValue} /></div>
              </TabsContent>

              <TabsContent value="media" className="grid gap-4 pt-3">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{(product.images || []).map((image, index) => { const src = typeof image === "string" ? image : image.url || image.src || ""; return src ? <a key={`${src}-${index}`} href={src} target="_blank" rel="noreferrer" className="aspect-square overflow-hidden rounded-md border bg-muted"><img src={src} alt={`${product.sku} ${index + 1}`} className="size-full object-contain" /></a> : null })}</div>
                {!(product.images || []).length && <p className="rounded-md border p-4 text-sm text-muted-foreground">No product images are available.</p>}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Detail label="Image count" value={numberLabel(product.imageCount)} /><Detail label="Default image" value={product.defaultImage ? "Available" : "Missing"} /><Detail label="Alternates" value={numberLabel(product.alternateVendorCount)} /><Detail label="Shadow SKUs" value={numberLabel(product.shadowSkuCount)} /></div>
              </TabsContent>

              <TabsContent value="replenishable" className="grid gap-4 pt-3">
                <Alert><Warehouse className="size-4" /><AlertTitle>Sellable inventory override</AlertTitle><AlertDescription>{product.effectiveReplenishableQty ? `Shopify uses ${numberLabel(product.effectiveReplenishableQty)} sellable units through Staten Island.` : "Normal warehouse stock is used for Shopify inventory."}</AlertDescription></Alert>
                <div className="grid gap-3 rounded-md border p-3">
                  <ToggleRow label="Use vendor replenishable rule" description="Vendor setting controls this SKU's enabled state and quantity." checked={usingVendorRules} disabled={!editing} onCheckedChange={(checked) => setDraftValue("replenishableUseVendorRules", checked)} />
                  <Separator />
                  <ToggleRow label="SKU replenishable" description="Keep this SKU sellable even when supplier stock is unavailable." checked={Boolean(draft.replenishable)} disabled={!editing || usingVendorRules} onCheckedChange={(checked) => setDraftValue("replenishable", checked)} />
                  <Separator />
                  <ToggleRow label="Use vendor default quantity" description="Use the replenishable quantity saved on the vendor profile." checked={usingVendorQty} disabled={!editing || usingVendorRules} onCheckedChange={(checked) => setDraftValue("replenishableQtyUseVendorDefault", checked)} />
                  <div className="grid gap-1.5"><Label>SKU replenishable quantity</Label><Input disabled={!editing || usingVendorRules || usingVendorQty} type="number" min="0" value={String(draft.replenishableQty ?? 0)} onChange={(event) => setDraftValue("replenishableQty", event.target.value)} /></div>
                </div>
              </TabsContent>

              <TabsContent value="shopify" className="grid gap-4 pt-3">
                <Alert><ShoppingBag className="size-4" /><AlertTitle>SKU-level Shopify actions</AlertTitle><AlertDescription>Every action is limited to {product.sku}. Dry runs create a review job without changing Shopify.</AlertDescription></Alert>
                {product.toBeDiscontinued ? (
                  <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Discontinued SKU</AlertTitle><AlertDescription>Product creation is blocked for discontinued products. Price review remains available for audit purposes.</AlertDescription></Alert>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <ActionTile title="Price" description={`System price ${moneyLabel(product.websitePrice)}. Review or send this SKU only.`} dryRunLabel="Review price" applyLabel="Push price" applyDisabled={product.toBeDiscontinued} onDryRun={() => queueShopifyAction("/api/shopify/variant-price-push", false, "Price review")} onApply={() => queueShopifyAction("/api/shopify/variant-price-push", true, "Price push")} />
                  <ActionTile title="Product" description={product.shopifyId ? "This SKU is already linked to Shopify." : "Create this SKU in Shopify using its mapped category and current rules."} dryRunLabel="Review create" applyLabel={product.shopifyId ? "Already linked" : "Create product"} applyDisabled={product.toBeDiscontinued || Boolean(product.shopifyId)} onDryRun={() => queueShopifyAction("/api/shopify/product-create", false, "Product create review")} onApply={() => queueShopifyAction("/api/shopify/product-create", true, "Product create")} />
                </div>
                {shopifyJob && <Card><CardContent className="grid gap-1 p-3"><div className="flex items-center justify-between gap-3"><p className="font-medium">{shopifyJob.operation || "Shopify job"}</p><Badge variant={jobStatusTone(shopifyJob.status)}>{shopifyJob.status || "queued"}</Badge></div><p className="text-xs text-muted-foreground">{shopifyJob.message || shopifyJob.id}</p><Button size="sm" variant="outline" className="mt-2 w-fit" asChild><a href={`/jobs`} onClick={() => onOpenChange(false)}>Open Jobs</a></Button></CardContent></Card>}
              </TabsContent>

              <TabsContent value="alternates" className="grid gap-4 pt-3">
                <Alert><Boxes className="size-4" /><AlertTitle>Supplier offers</AlertTitle><AlertDescription>Offers are loaded only when this tab is opened, keeping the product screen fast.</AlertDescription></Alert>
                {loadingAlternates && <div className="grid gap-2"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>}
                {!loadingAlternates && alternates.length === 0 && <p className="rounded-md border p-4 text-sm text-muted-foreground">No alternate supplier offers are available for this SKU.</p>}
                {!loadingAlternates && alternates.length > 0 && <div className="overflow-hidden rounded-md border"><Table><TableHeader><TableRow><TableHead>Supplier</TableHead><TableHead>Vendor SKU</TableHead><TableHead>Stock</TableHead><TableHead>Cost</TableHead><TableHead>Category</TableHead></TableRow></TableHeader><TableBody>{alternates.map((alternate, index) => <TableRow key={`${alternate.supplier}-${alternate.sku}-${index}`}><TableCell>{alternate.supplier || "Unknown"}</TableCell><TableCell>{alternate.sku || "-"}</TableCell><TableCell>{numberLabel(alternate.stockQty)}</TableCell><TableCell>{moneyLabel(alternate.cost)}</TableCell><TableCell className="max-w-72"><p className="line-clamp-2">{alternate.mainCategory || alternate.sourceCategory || "-"}</p></TableCell></TableRow>)}</TableBody></Table></div>}
              </TabsContent>
            </Tabs>
          </div>
        )}
        {product && editing && <SheetFooter className="border-t"><Button onClick={save} disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save SKU settings</Button></SheetFooter>}
    </>
  )

  if (standalone) return <div className="mx-auto max-w-7xl">{content}</div>
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-5xl">{content}</SheetContent></Sheet>
}

function StandaloneProductPage() {
  const sku = decodeURIComponent(window.location.pathname.replace(/^\/products\//, "").split("/")[0] || "")
  const [product, setProduct] = useState<ProductItem | null>(null)
  const [channels, setChannels] = useState<ChannelConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const returnToCatalog = () => { window.history.pushState({}, "", "/products"); window.dispatchEvent(new PopStateEvent("popstate")) }
  useEffect(() => {
    if (!sku) { setLoading(false); setError("The product URL is missing a SKU."); return }
    let cancelled = false
    setLoading(true); setError("")
    api<{ item: ProductItem }>(`/api/inventory/${encodeURIComponent(sku)}`)
      .then((result) => { if (!cancelled) setProduct(result.item) })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to load product.") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [sku])
  useEffect(() => {
    let cancelled = false
    api<LiteState>("/api/state?lite=1")
      .then((result) => { if (!cancelled) setChannels(result.connections || []) })
      .catch(() => { if (!cancelled) setChannels([]) })
    return () => { cancelled = true }
  }, [])
  if (loading) return <div className="grid gap-3"><Skeleton className="h-10 w-40" /><Skeleton className="h-36" /><Skeleton className="h-96" /></div>
  if (error || !product) return <div className="grid gap-4"><Button variant="outline" className="w-fit" onClick={returnToCatalog}>Back to Products</Button><Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Product unavailable</AlertTitle><AlertDescription>{error || "This SKU was not found in the main catalog."}</AlertDescription></Alert></div>
  return <CompleteProductWorkspace product={product} sku={sku} channels={channels} onBack={returnToCatalog} onUpdated={setProduct} />
  /* Legacy standalone composition retained temporarily for reference.
  return <div className="grid gap-5"><Button variant="outline" className="w-fit" onClick={returnToCatalog}>Back to Products</Button><PageHeader eyebrow="Product" title={product.sku || sku} description={product.marketplaceTitle || product.title || "Untitled product"} action={<div className="flex gap-2"><Badge variant={product.active === false ? "outline" : "default"}>{product.active === false ? "Inactive" : "Active"}</Badge>{product.toBeDiscontinued && <Badge variant="destructive">Discontinued</Badge>}</div>} /><Tabs defaultValue="overview"><div className="overflow-x-auto rounded-md border bg-card p-1"><TabsList className="h-auto min-w-max justify-start bg-transparent p-0"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="content">Content</TabsTrigger><TabsTrigger value="commerce">Commerce</TabsTrigger><TabsTrigger value="shipping">Shipping</TabsTrigger><TabsTrigger value="channels">Channels</TabsTrigger><TabsTrigger value="media">Media</TabsTrigger><TabsTrigger value="all">All data</TabsTrigger></TabsList></div><TabsContent value="overview" className="mt-4 grid gap-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Detail label="Supplier" value={product.supplier || product.vendor || "-"} /><Detail label="Brand" value={product.brand || "-"} /><Detail label="Manufacturer" value={product.manufacturer || "-"} /><Detail label="Vendor SKU" value={product.vendorSku || "-"} /><Detail label="Barcode" value={product.barcode || "-"} /><Detail label="UOM" value={product.uomDisplay || product.uomName || product.uom || "Each"} /><Detail label="Main category" value={product.mainCategory || product.category || "Uncategorized"} /><Detail label="Vendor category" value={product.vendorCategory || product.sourceCategory || "-"} /></div>{product.tags?.length ? <div className="flex flex-wrap gap-1">{product.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}</div> : null}</TabsContent><TabsContent value="content" className="mt-4 grid gap-4"><Card><CardHeader><CardTitle className="text-sm">Short description</CardTitle></CardHeader><CardContent><p className="whitespace-pre-wrap text-sm">{product.shortDescription || "No short description."}</p></CardContent></Card><Card><CardHeader><CardTitle className="text-sm">Full description</CardTitle></CardHeader><CardContent><p className="whitespace-pre-wrap text-sm leading-6">{product.longDescription || "No full description."}</p></CardContent></Card></TabsContent><TabsContent value="commerce" className="mt-4 grid gap-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Detail label="Cost" value={moneyLabel(product.cost)} /><Detail label="Sell-unit cost" value={moneyLabel(product.sellUnitCost)} /><Detail label="Website price" value={moneyLabel(product.websitePrice || product.price)} /><Detail label="List / MSRP" value={moneyLabel(product.listPrice || product.msrp)} /><Detail label="On hand" value={numberLabel(product.qty)} /><Detail label="Reserved" value={numberLabel(product.reserved)} /><Detail label="Available" value={numberLabel(Math.max(0, Number(product.qty || 0) - Number(product.reserved || 0)))} /><Detail label="Replenishable qty" value={numberLabel(product.effectiveReplenishableQty)} /></div></TabsContent><TabsContent value="shipping" className="mt-4 grid gap-4"><Alert><Truck className="size-4" /><AlertTitle>{product.shippingMethod || "Needs measurements"}</AlertTitle><AlertDescription>{product.shippingClassReason || "No shipping classification is available."}</AlertDescription></Alert><div className="grid gap-3 sm:grid-cols-2"><Card><CardHeader><CardTitle className="text-sm">Item dimensions</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-3"><Detail label="Length" value={product.itemLength ? `${product.itemLength} in` : "-"} /><Detail label="Width" value={product.itemWidth ? `${product.itemWidth} in` : "-"} /><Detail label="Height" value={product.itemHeight ? `${product.itemHeight} in` : "-"} /><Detail label="Weight" value={product.itemWeight ? `${product.itemWeight} lb` : "-"} /></CardContent></Card><Card><CardHeader><CardTitle className="text-sm">Package dimensions</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-3"><Detail label="Length" value={product.packageLength ? `${product.packageLength} in` : "-"} /><Detail label="Width" value={product.packageWidth ? `${product.packageWidth} in` : "-"} /><Detail label="Height" value={product.packageHeight ? `${product.packageHeight} in` : "-"} /><Detail label="Weight" value={product.packageWeight ? `${product.packageWeight} lb` : "-"} /></CardContent></Card></div></TabsContent><TabsContent value="channels" className="mt-4 grid gap-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Detail label="Shopify ID" value={product.shopifyId || "Not linked"} /><Detail label="Shopify status" value={product.shopifyStatus || "-"} /><Detail label="Published" value={product.shopifyPublished ? "Yes" : "No"} /><Detail label="Live price" value={moneyLabel(product.shopifyLivePrice)} /><Detail label="Live inventory" value={numberLabel(product.shopifyLiveInventoryQuantity)} /><Detail label="eBay status" value={product.ebayListing?.status || "Not listed"} /><Detail label="eBay offer" value={product.ebayListing?.offerId || "-"} /><Detail label="eBay listing" value={product.ebayListing?.listingId || "-"} /></div></TabsContent><TabsContent value="media" className="mt-4 grid gap-4"><div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">{imageUrls.map((src, index) => <a key={`${src}-${index}`} href={src} target="_blank" rel="noreferrer" className="aspect-square overflow-hidden rounded-md border bg-muted"><img src={src} alt={`${product.sku} ${index + 1}`} className="size-full object-contain" /></a>)}</div>{!imageUrls.length && <p className="rounded-md border p-4 text-sm text-muted-foreground">No product images are available.</p>}</TabsContent><TabsContent value="all" className="mt-4"><div className="overflow-hidden rounded-md border"><Table><TableHeader><TableRow><TableHead>Field</TableHead><TableHead>Value</TableHead></TableRow></TableHeader><TableBody>{allFields.map(([key, value]) => <TableRow key={key}><TableCell className="w-64 font-medium">{key}</TableCell><TableCell className="whitespace-pre-wrap break-words">{fieldValue(value)}</TableCell></TableRow>)}</TableBody></Table></div></TabsContent></Tabs></div>
  */
}

function StandaloneProductWorkspace({ product, sku, onBack }: { product: ProductItem; sku: string; onBack: () => void }) {
  const imageUrls = (product.images || []).map((image) => typeof image === "string" ? image : image.url || image.src || "").filter(Boolean)
  const primaryImage = product.defaultImage || imageUrls[0] || ""
  const cost = Number(product.sellUnitCost ?? product.cost ?? 0)
  const price = Number(product.websitePrice ?? product.price ?? 0)
  const grossProfit = price - cost
  const margin = price > 0 ? (grossProfit / price) * 100 : 0
  const available = Math.max(0, Number(product.qty ?? product.stockQty ?? 0) - Number(product.reserved || 0))
  const allFields = Object.entries(product).filter(([key]) => !["images", "aliases", "warehouseStock", "recentChanges"].includes(key))
  const value = (field: unknown) => {
    if (field === undefined || field === null || field === "") return "-"
    if (typeof field === "boolean") return field ? "Yes" : "No"
    if (typeof field === "number") return field.toLocaleString()
    if (typeof field === "object") return JSON.stringify(field)
    return String(field)
  }
  const section = (title: string, description: string, children: React.ReactNode) => <Card><CardHeader className="border-b pb-3"><CardTitle className="text-sm">{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent className="pt-4">{children}</CardContent></Card>
  return <div className="grid gap-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><Button variant="outline" onClick={onBack}>Back to Products</Button><div className="flex flex-wrap gap-2"><Badge variant={product.active === false ? "outline" : "default"}>{product.active === false ? "Inactive" : "Active"}</Badge>{product.toBeDiscontinued ? <Badge variant="destructive">Discontinued</Badge> : null}{product.shopifyPublished ? <Badge variant="outline">Shopify live</Badge> : null}</div></div>
    <Card><CardContent className="grid gap-5 p-5 lg:grid-cols-[180px_minmax(0,1fr)]"><div className="grid aspect-square place-items-center overflow-hidden rounded-md border bg-muted/40">{primaryImage ? <img src={primaryImage} alt={product.title || sku} className="size-full object-contain p-3" /> : <Boxes className="size-10 text-muted-foreground" />}</div><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Approved catalog product</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">{product.marketplaceTitle || product.title || "Untitled product"}</h1><div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground"><span className="font-mono font-medium text-foreground">{product.sku || sku}</span><span>{product.brand || "No brand"}</span><span>{product.supplier || product.vendor || "No supplier"}</span></div><p className="mt-4 max-w-4xl text-sm text-muted-foreground">{product.mainCategory || product.category || "Uncategorized"}</p>{product.tags?.length ? <div className="mt-3 flex flex-wrap gap-1">{product.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}</div> : null}</div></CardContent></Card>
    <Tabs defaultValue="overview"><div className="overflow-x-auto rounded-md border bg-card p-1"><TabsList className="h-auto min-w-max justify-start bg-transparent p-0"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="content">Content</TabsTrigger><TabsTrigger value="commerce">Pricing & inventory</TabsTrigger><TabsTrigger value="shipping">Shipping</TabsTrigger><TabsTrigger value="channels">Channels</TabsTrigger><TabsTrigger value="media">Media</TabsTrigger><TabsTrigger value="all">All data</TabsTrigger></TabsList></div>
      <TabsContent value="overview" className="mt-4 grid gap-4">
        <div className="grid gap-4 xl:grid-cols-2">{section("Product identity", "Catalog, supplier, and category assignment.", <div className="grid gap-3 sm:grid-cols-2"><Detail label="SKU" value={product.sku || sku} /><Detail label="Vendor SKU" value={product.vendorSku || "-"} /><Detail label="Brand" value={product.brand || "-"} /><Detail label="Manufacturer" value={product.manufacturer || "-"} /><Detail label="Main category" value={product.mainCategory || product.category || "Uncategorized"} /><Detail label="Vendor category" value={product.vendorCategory || product.sourceCategory || "-"} /><Detail label="UPC / barcode" value={product.barcode || "-"} /><Detail label="UOM" value={product.uomDisplay || product.uomName || product.uom || "Each"} /></div>)}{section("Pricing rules", "Current sell price with the cost-based calculation inputs.", <><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Detail label="Supplier cost" value={moneyLabel(product.cost)} /><Detail label="Sell-unit cost" value={moneyLabel(product.sellUnitCost)} /><Detail label="Website price" value={moneyLabel(price)} /><Detail label="List / MSRP" value={moneyLabel(product.listPrice || product.msrp)} /></div><div className="mt-3 grid grid-cols-2 gap-3 rounded-md border bg-muted/30 p-3 sm:grid-cols-4"><Detail label="Gross profit" value={moneyLabel(grossProfit)} /><Detail label="Margin" value={`${margin.toFixed(1)}%`} /><Detail label="Pricing basis" value={product.isMultiUnit ? "UOM sell unit" : "Each"} /><Detail label="Rule source" value="Vendor / channel rules" /></div></>)}</div>
        {section("Product content", "Customer-facing copy used by connected channels.", <div className="grid gap-4"><div><p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">Short description</p><p className="whitespace-pre-wrap text-sm leading-6">{product.shortDescription || "No short description has been prepared."}</p></div><Separator /><div><p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">Long description</p><p className="whitespace-pre-wrap text-sm leading-6">{product.longDescription || "No long description has been prepared."}</p></div></div>)}
        <div className="grid gap-4 xl:grid-cols-2">{section("Inventory & replenishment", "Available sellable inventory and SKU-level replenishment behavior.", <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Detail label="On hand" value={numberLabel(product.qty ?? product.stockQty)} /><Detail label="Reserved" value={numberLabel(product.reserved)} /><Detail label="Available" value={numberLabel(available)} /><Detail label="Replenishable qty" value={numberLabel(product.effectiveReplenishableQty)} /><Detail label="Replenishable" value={product.replenishable ? "Enabled" : "Off"} /><Detail label="Rule mode" value={product.replenishableUseVendorRules ? "Vendor default" : "SKU rule"} /></div>)}{section("Channel readiness", "Current marketplace linkage and publish state.", <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Detail label="Shopify status" value={product.shopifyStatus || "Not linked"} /><Detail label="Published" value={product.shopifyPublished ? "Yes" : "No"} /><Detail label="Live price" value={moneyLabel(product.shopifyLivePrice)} /><Detail label="Live inventory" value={numberLabel(product.shopifyLiveInventoryQuantity)} /><Detail label="eBay" value={product.ebayListing?.status || "Not listed"} /><Detail label="Shadow SKUs" value={numberLabel(product.shadowSkuCount)} /></div>)}</div>
      </TabsContent>
      <TabsContent value="content" className="mt-4 grid gap-4">{section("Customer-facing copy", "Descriptions and merchandising data for product pages.", <div className="grid gap-5"><div><p className="mb-2 text-sm font-medium">Short description</p><p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{product.shortDescription || "No short description."}</p></div><Separator /><div><p className="mb-2 text-sm font-medium">Long description</p><p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{product.longDescription || "No long description."}</p></div></div>)}</TabsContent>
      <TabsContent value="commerce" className="mt-4 grid gap-4">{section("Price, profitability, and stock", "Pricing result after the product's sell unit and channel rules are applied.", <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Detail label="Cost" value={moneyLabel(product.cost)} /><Detail label="Sell-unit cost" value={moneyLabel(product.sellUnitCost)} /><Detail label="Website price" value={moneyLabel(price)} /><Detail label="List / MSRP" value={moneyLabel(product.listPrice || product.msrp)} /><Detail label="Gross profit" value={moneyLabel(grossProfit)} /><Detail label="Margin" value={`${margin.toFixed(1)}%`} /><Detail label="Available" value={numberLabel(available)} /><Detail label="Replenishable qty" value={numberLabel(product.effectiveReplenishableQty)} /></div>)}</TabsContent>
      <TabsContent value="shipping" className="mt-4 grid gap-4"><Alert><Truck className="size-4" /><AlertTitle>{product.shippingMethod || product.shippingClass || "Needs measurements"}</AlertTitle><AlertDescription>{product.shippingClassReason || "No shipping classification is available."}</AlertDescription></Alert><div className="grid gap-4 xl:grid-cols-2">{section("Item dimensions", "Physical product measurements.", <div className="grid grid-cols-2 gap-3"><Detail label="Length" value={product.itemLength ? `${product.itemLength} in` : "-"} /><Detail label="Width" value={product.itemWidth ? `${product.itemWidth} in` : "-"} /><Detail label="Height" value={product.itemHeight ? `${product.itemHeight} in` : "-"} /><Detail label="Weight" value={product.itemWeight ? `${product.itemWeight} lb` : "-"} /></div>)}{section("Package dimensions", "Measurements used to classify and rate shipments.", <div className="grid grid-cols-2 gap-3"><Detail label="Length" value={product.packageLength ? `${product.packageLength} in` : "-"} /><Detail label="Width" value={product.packageWidth ? `${product.packageWidth} in` : "-"} /><Detail label="Height" value={product.packageHeight ? `${product.packageHeight} in` : "-"} /><Detail label="Weight" value={product.packageWeight ? `${product.packageWeight} lb` : "-"} /></div>)}</div></TabsContent>
      <TabsContent value="channels" className="mt-4 grid gap-4">{section("Marketplace connections", "Current connection identifiers and live storefront values.", <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Detail label="Shopify ID" value={product.shopifyId || "Not linked"} /><Detail label="Shopify variant" value={product.shopifyVariantId || "-"} /><Detail label="Shopify status" value={product.shopifyStatus || "-"} /><Detail label="Published" value={product.shopifyPublished ? "Yes" : "No"} /><Detail label="Live price" value={moneyLabel(product.shopifyLivePrice)} /><Detail label="Live inventory" value={numberLabel(product.shopifyLiveInventoryQuantity)} /><Detail label="eBay status" value={product.ebayListing?.status || "Not listed"} /><Detail label="eBay listing" value={product.ebayListing?.listingId || "-"} /></div>)}</TabsContent>
      <TabsContent value="media" className="mt-4 grid gap-4">{imageUrls.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">{imageUrls.map((src, index) => <a key={`${src}-${index}`} href={src} target="_blank" rel="noreferrer" className="aspect-square overflow-hidden rounded-md border bg-muted"><img src={src} alt={`${product.sku} ${index + 1}`} className="size-full object-contain p-2" /></a>)}</div> : <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">No product images are available.</p>}</TabsContent>
      <TabsContent value="all" className="mt-4"><div className="overflow-hidden rounded-md border"><Table><TableHeader><TableRow><TableHead>Field</TableHead><TableHead>Value</TableHead></TableRow></TableHeader><TableBody>{allFields.map(([key, field]) => <TableRow key={key}><TableCell className="w-64 font-medium">{key}</TableCell><TableCell className="whitespace-pre-wrap break-words">{value(field)}</TableCell></TableRow>)}</TableBody></Table></div></TabsContent>
    </Tabs>
  </div>
}

function CompleteProductWorkspace({ product, sku, channels, onBack, onUpdated }: { product: ProductItem; sku: string; channels: ChannelConnection[]; onBack: () => void; onUpdated: (product: ProductItem) => void }) {
  if (false) return <StandaloneProductWorkspace product={product} sku={sku} onBack={onBack} />
  const [editorOpen, setEditorOpen] = useState(false)
  const [productTab, setProductTab] = useState("overview")
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<Record<string, string | boolean>>({})
  const imageUrls = (product.images || []).map((image) => typeof image === "string" ? image : image.url || image.src || "").filter(Boolean)
  const cost = Number(product.sellUnitCost ?? product.cost ?? 0), price = Number(product.websitePrice ?? product.price ?? 0), available = Math.max(0, Number(product.qty ?? product.stockQty ?? 0) - Number(product.reserved || 0))
  const margin = price > 0 ? ((price - cost) / price) * 100 : 0
  const pricing = product.pricingCalculation || {}
  const pricingSourceLabel = pricing.priceSource === "vendor-website-price" ? "Supplier website price" : pricing.priceSource === "minimum-allowed-price" ? "Minimum allowed price floor" : "Cost plus markup"
  const section = (title: string, description: string, children: React.ReactNode) => <Card><CardHeader className="border-b pb-3"><CardTitle className="text-sm">{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent className="pt-4">{children}</CardContent></Card>
  const values = (rows: Array<[string, string]>) => <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{rows.map(([label, value]) => <Detail key={label} label={label} value={value || "-"} />)}</div>
  const openEditor = () => { setDraft({ marketplaceTitle: product.marketplaceTitle || product.title || "", brand: product.brand || "", manufacturer: product.manufacturer || "", mfrPartNumber: product.mfrPartNumber || "", supplier: product.supplier || product.vendor || "", supplierCode: product.supplierCode || "", vendorSku: product.vendorSku || "", mainCategory: product.mainCategory || product.category || "", sourceCategory: product.sourceCategory || "", vendorCategory: product.vendorCategory || "", condition: product.condition || "New", status: product.status || "Active", barcode: product.barcode || "", externalId: product.externalId || "", unspsc: product.unspsc || "", uom: product.uom || "", uomQty: String(product.uomQty || 1), tags: (product.tags || []).join(", "), shortDescription: product.shortDescription || "", longDescription: product.longDescription || "", bulletPoints: (product.bulletPoints || []).join("\n"), seoKeywords: product.seoKeywords || "", wildcardSearch: product.wildcardSearch || "", defaultImage: product.defaultImage || imageUrls[0] || "", images: imageUrls.join("\n"), websitePrice: String(price), cost: String(product.cost ?? 0), fobPrice: String(product.fobPrice ?? 0), listPrice: String(product.listPrice ?? product.msrp ?? 0), qty: String(product.qty ?? product.stockQty ?? 0), reserved: String(product.reserved ?? 0), reorderPoint: String(product.reorderPoint || 0), minQuantity: String(product.minQuantity || ""), quantityIncrements: String(product.quantityIncrements || ""), leadTime: String(product.leadTime || product.leadtime || ""), itemLength: String(product.itemLength || 0), itemWidth: String(product.itemWidth || 0), itemHeight: String(product.itemHeight || 0), itemWeight: String(product.itemWeight || 0), packageLength: String(product.packageLength || 0), packageWidth: String(product.packageWidth || 0), packageHeight: String(product.packageHeight || 0), packageWeight: String(product.packageWeight || 0), dimensionalWeight: String(product.dimensionalWeight || 0), countryOfOrigin: product.countryOfOrigin || "", sdsUrl: product.sdsUrl || "", stockStatus: product.stockStatus || "", stockUpdatedAt: product.stockUpdatedAt || "", lastPricesUpdateAt: product.lastPricesUpdateAt || "", lastPricesUpdateBy: product.lastPricesUpdateBy || "", hazardous: Boolean(product.hazardous), active: product.active !== false, categoryVerified: Boolean(product.categoryVerified) }); setEditorOpen(true) }
  const save = async () => { setSaving(true); try { const numeric = new Set(["websitePrice", "cost", "fobPrice", "listPrice", "qty", "reserved", "reorderPoint", "minQuantity", "quantityIncrements", "itemLength", "itemWidth", "itemHeight", "itemWeight", "packageLength", "packageWidth", "packageHeight", "packageWeight", "dimensionalWeight"]); const payload = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, key === "images" ? String(value || "").split(/\r?\n/).map((url) => url.trim()).filter(Boolean) : key === "bulletPoints" ? String(value || "").split(/\r?\n/).map((point) => point.trim()).filter(Boolean) : numeric.has(key) ? Number(value || 0) : value])); const result = await api<{ item: ProductItem }>(`/api/inventory/${encodeURIComponent(product.id || product.sku || sku)}`, { method: "PATCH", body: JSON.stringify(payload) }); onUpdated(result.item); setEditorOpen(false); toast.success("Product details saved.") } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save product details.") } finally { setSaving(false) } }
  const pushShopify = async (path: string, apply: boolean, label: string) => { if (apply && product.toBeDiscontinued) return toast.error("Discontinued SKUs cannot be sent to Shopify."); try { const result = await api<{ message?: string }>(path, { method: "POST", body: JSON.stringify({ skus: [product.sku], dryRun: !apply, apply }) }); toast.success(result.message || `${label} queued.`) } catch (error) { toast.error(error instanceof Error ? error.message : `Unable to queue ${label.toLowerCase()}.`) } }
  useEffect(() => { const handleAction = (event: Event) => { const action = (event as CustomEvent<{ action?: string }>).detail?.action; if (action === "edit") openEditor(); if (action === "review-product") void pushShopify("/api/shopify/product-create", false, "Product review"); if (action === "review-price") void pushShopify("/api/shopify/variant-price-push", false, "Price review"); if (action === "create-product") void pushShopify("/api/shopify/product-create", true, "Product create"); if (action === "push-price") void pushShopify("/api/shopify/variant-price-push", true, "Price push") }; window.addEventListener("dataplus:product-action", handleAction); return () => window.removeEventListener("dataplus:product-action", handleAction) }, [product.sku, product.toBeDiscontinued])
  const sourceRows = Object.entries({ ...(product.productManagerFields || {}), ...(product.original || {}) }).slice(0, 80)
  const enabledChannels = channels.filter((channel) => channel.connected && String(channel.status || "active").toLowerCase() !== "inactive")
  const channelTabId = (channel: ChannelConnection) => `channel-${String(channel.id || channel.name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
  const readinessChecks = [
    ["Category", Boolean(product.categoryVerified)],
    ["Content", Boolean(product.shortDescription && product.longDescription)],
    ["Media", imageUrls.length > 0],
    ["Shipping", Boolean(product.shippingMethod && product.packageWeight && product.packageLength && product.packageWidth && product.packageHeight)],
    ["Price", price > 0 && cost > 0],
    ["Shopify", Boolean(product.shopifyId || product.toBeDiscontinued)],
  ] as const
  const readinessScore = Math.round((readinessChecks.filter(([, ready]) => ready).length / readinessChecks.length) * 100)
  return <div className="relative grid gap-5">
    <ProductReadinessPanel score={readinessScore} checks={readinessChecks} discontinued={Boolean(product.toBeDiscontinued)} />
    <div className="flex flex-wrap items-center justify-between gap-3"><Button variant="outline" onClick={onBack}>Back to Products</Button><div className="flex flex-wrap gap-2"><Badge variant={product.active === false ? "outline" : "default"}>{product.active === false ? "Inactive" : "Active"}</Badge>{product.categoryVerified ? <Badge variant="outline">Category verified</Badge> : <Badge variant="outline">Category needs review</Badge>}{product.toBeDiscontinued ? <Badge variant="destructive">Discontinued</Badge> : null}<Button size="sm" onClick={openEditor}><Pencil className="size-4" /> Edit product</Button></div></div>
    <Card><CardContent className="grid gap-5 p-5 lg:grid-cols-[180px_minmax(0,1fr)]"><div className="grid aspect-square place-items-center overflow-hidden rounded-md border bg-muted/40">{product.defaultImage || imageUrls[0] ? <img src={product.defaultImage || imageUrls[0]} alt={product.title || sku} className="size-full object-contain p-3" /> : <Boxes className="size-10 text-muted-foreground" />}</div><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Approved catalog product</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">{product.marketplaceTitle || product.title || "Untitled product"}</h1><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground"><strong className="font-mono text-foreground">{product.sku || sku}</strong><span>{product.brand || "No brand"}</span><span>{product.supplier || product.vendor || "No supplier"}</span><span>{product.uomDisplay || "Each"}</span></div><p className="mt-4 text-sm text-muted-foreground">{product.mainCategory || product.category || "Uncategorized"}</p>{product.tags?.length ? <div className="mt-3 flex flex-wrap gap-1">{product.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}</div> : null}</div></CardContent></Card>
    <Tabs value={productTab} onValueChange={setProductTab}><div className="overflow-x-auto rounded-md border bg-card p-1"><TabsList className="h-auto min-w-max justify-start bg-transparent p-0"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="content">Content</TabsTrigger><TabsTrigger value="identifiers">Identifiers</TabsTrigger><TabsTrigger value="pricing">Pricing</TabsTrigger><TabsTrigger value="inventory">Inventory</TabsTrigger><TabsTrigger value="shipping">Shipping & compliance</TabsTrigger>{enabledChannels.map((channel) => <TabsTrigger key={channel.id || channel.name} value={channelTabId(channel)}>{channel.name}</TabsTrigger>)}<TabsTrigger value="offers">Variants & offers</TabsTrigger><TabsTrigger value="source">Source & history</TabsTrigger></TabsList></div>
      <TabsContent value="overview" className="mt-4 grid gap-4"><div className="grid gap-4 xl:grid-cols-2">{section("Identity & category", "Core catalog, supplier, and classification fields.", values([["SKU", product.sku || sku], ["Vendor SKU", product.vendorSku || ""], ["Brand", product.brand || ""], ["Manufacturer", product.manufacturer || ""], ["Mfr part number", product.mfrPartNumber || ""], ["Supplier", product.supplier || product.vendor || ""], ["Main category", product.mainCategory || product.category || ""], ["UPC / barcode", product.barcode || ""], ["UNSPSC", String(product.unspsc || "")], ["Selling UOM", product.uomDisplay || product.uom || "Each"]]))}{section("Pricing", "The current primary sell-unit price and its source.", values([["Sell-unit cost", moneyLabel(pricing.primarySellUnitCost ?? product.sellUnitCost)], ["Website price", moneyLabel(price)], ["Gross profit", moneyLabel(price - cost)], ["Margin", `${margin.toFixed(1)}%`], ["Pricing source", pricingSourceLabel], ["Last price update", product.lastPricesUpdateAt ? dateLabel(product.lastPricesUpdateAt) : "Not recorded"], ["Updated by", product.lastPricesUpdateBy || "Not recorded"], ["List / MSRP", moneyLabel(product.listPrice || product.msrp)]]))}</div>{section("Product content", "Customer-facing merchandising summary.", <div className="grid gap-4"><div><p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">Short description</p><p className="whitespace-pre-wrap text-sm leading-6">{product.shortDescription || "No short description has been prepared."}</p></div><Separator /><div><p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">Long description</p><p className="line-clamp-4 whitespace-pre-wrap text-sm leading-6">{product.longDescription || "No long description has been prepared."}</p></div></div>)}<div className="grid gap-4 xl:grid-cols-2">{section("Inventory & status", "Sellable stock, replenishment, and product state.", values([["On hand", numberLabel(product.qty ?? product.stockQty)], ["Reserved", numberLabel(product.reserved)], ["Available", numberLabel(available)], ["Reorder point", numberLabel(product.reorderPoint)], ["Replenishable", product.replenishable ? "Enabled" : "Off"], ["Replenishable qty", numberLabel(product.effectiveReplenishableQty)], ["Product status", product.toBeDiscontinued ? "Discontinued" : product.status || (product.active === false ? "Inactive" : "Active")], ["Stock updated", product.stockUpdatedAt ? dateLabel(product.stockUpdatedAt) : "Not recorded"]]))}{section("Dimensions & shipping", "Physical product and shipment measurements.", values([["Item dimensions", product.itemLength && product.itemWidth && product.itemHeight ? `${product.itemLength} x ${product.itemWidth} x ${product.itemHeight} in` : "Not recorded"], ["Item weight", product.itemWeight ? `${product.itemWeight} lb` : "Not recorded"], ["Package dimensions", product.packageLength && product.packageWidth && product.packageHeight ? `${product.packageLength} x ${product.packageWidth} x ${product.packageHeight} in` : "Not recorded"], ["Package weight", product.packageWeight ? `${product.packageWeight} lb` : "Not recorded"], ["Shipping class", product.shippingClass || "Not classified"], ["Shipping method", product.shippingMethod || "Not classified"], ["Dimensional weight", product.dimensionalWeight ? `${product.dimensionalWeight} lb` : "Not calculated"], ["Last record update", product.updatedAt ? dateLabel(product.updatedAt) : "Not recorded"]]))}</div></TabsContent>
      <TabsContent value="content" className="mt-4 grid gap-4">{section("Descriptions & search", "Customer content and internal search fields.", <div className="grid gap-4"><div><p className="mb-1 text-sm font-medium">Short description</p><p className="whitespace-pre-wrap text-sm text-muted-foreground">{product.shortDescription || "No short description."}</p></div><div><p className="mb-1 text-sm font-medium">Long description</p><p className="whitespace-pre-wrap text-sm text-muted-foreground">{product.longDescription || "No long description."}</p></div><div><p className="mb-1 text-sm font-medium">Bullet points</p>{product.bulletPoints?.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{product.bulletPoints.map((point, index) => <li key={`${point}-${index}`}>{point}</li>)}</ul> : <p className="text-sm text-muted-foreground">No bullet points.</p>}</div>{values([["SEO keywords", product.seoKeywords || ""], ["Wildcard search", product.wildcardSearch || ""], ["Condition", product.condition || "New"], ["Country of origin", product.countryOfOrigin || ""]])}</div>)}</TabsContent>
      <TabsContent value="identifiers" className="mt-4 grid gap-4">{section("Primary identifiers", "Keys used to match supplier, catalog, and marketplace records.", values([["Internal SKU", product.sku || sku], ["External ID", product.externalId || ""], ["Vendor SKU", product.vendorSku || ""], ["Supplier code", product.supplierCode || ""], ["Manufacturer", product.manufacturer || ""], ["Mfr part number", product.mfrPartNumber || ""], ["UPC / GTIN", product.barcode || ""], ["UNSPSC", product.unspsc || ""], ["UOM", product.uomDisplay || product.uomName || product.uom || "Each"], ["Source status", product.stockStatus || product.status || ""]]))}{section("Additional identifiers", "Supplier and marketplace identifiers retained with this product record.", <ProductIdentifiersTable rows={product.identifiers || []} />)}{section("SKU aliases", "Alternate internal or imported SKUs that resolve to this product.", <ProductAliases rows={product.aliases || []} />)}</TabsContent>
      <TabsContent value="pricing" className="mt-4 grid gap-4">{section("Pricing calculation", "The actual rule sequence used to calculate the primary Shopify sell-unit price.", <><div className="mb-4 rounded-md border bg-muted/30 p-3 text-sm"><span className="font-medium">{pricingSourceLabel}:</span>{" "}{pricing.priceSource === "vendor-website-price" ? "a valid supplier website price overrides the calculated markup price." : pricing.priceSource === "minimum-allowed-price" ? "the configured minimum allowed price is higher than the calculated markup price." : `sell-unit cost x (1 + ${Number(pricing.markupPercent ?? 35).toFixed(0)}% markup).`}</div>{values([["Rule cost basis", pricing.costBasis === "sell-unit" ? "Sell unit" : "Each unit"], ["Primary sell unit", pricing.sellUnit || product.uomDisplay || "Each"], ["Source cost", moneyLabel(pricing.sourceCost ?? product.sourceCost ?? product.cost)], ["Sell-unit cost", moneyLabel(pricing.sellUnitCost ?? product.sellUnitCost)], ["Price basis", moneyLabel(pricing.primarySellUnitCost ?? product.sellUnitCost)], ["Markup", `${Number(pricing.markupPercent ?? 35).toFixed(0)}%`], ["Calculated markup price", moneyLabel(pricing.markedUpPrice)], ["Supplier website price", moneyLabel(pricing.vendorWebsitePrice)], ["Minimum allowed price", pricing.minimumAllowedPriceEnforced ? moneyLabel(pricing.minimumAllowedPrice) : "Not enforced"], ["Final DataPlus price", moneyLabel(pricing.finalPrice ?? price)], ["Last price update", product.lastPricesUpdateAt ? dateLabel(product.lastPricesUpdateAt) : "Not recorded"], ["Updated by", product.lastPricesUpdateBy || "Not recorded"]])}</>)}{section("Price status & channel comparison", "Current product price compared with the connected Shopify variant.", values([["FOB", moneyLabel(product.fobPrice)], ["List / MSRP", moneyLabel(product.listPrice || product.msrp)], ["Shopify system price", moneyLabel(product.shopifySystemPrice)], ["Shopify live price", moneyLabel(product.shopifyLivePrice)], ["Live price difference", moneyLabel(product.shopifyPriceDelta ?? undefined)], ["Price sync", product.shopifyPriceMismatch ? "Needs review" : product.shopifyId ? "Matched" : "Not linked"], ["Product record updated", product.updatedAt ? dateLabel(product.updatedAt) : "Not recorded"], ["Stock updated", product.stockUpdatedAt ? dateLabel(product.stockUpdatedAt) : "Not recorded"]]))}{section("Shopify purchase variants", "Actual UOM-based sell units; Essendant stays UOM-only.", <ProductVariantsTable rows={product.shopifyPurchaseVariants || []} />)}</TabsContent>
      <TabsContent value="inventory" className="mt-4 grid gap-4">{section("Warehouse stock", "Warehouse-level quantities and reorder thresholds.", <ProductWarehouseTable rows={product.warehouseStock || []} />)}{section("Stock ledger", "SKU-specific inventory movement and adjustment history.", <ProductInventoryLedger sku={product.sku || sku} />)}{section("Recent product changes", "Latest recorded import and operational changes.", <ProductChangesTable rows={product.recentChanges || []} />)}</TabsContent>
      <TabsContent value="shipping" className="mt-4 grid gap-4"><Alert><Truck className="size-4" /><AlertTitle>{product.shippingMethod || product.shippingClass || "Needs measurements"}</AlertTitle><AlertDescription>{product.shippingClassReason || "Enter package measurements to classify shipping."}</AlertDescription></Alert><div className="grid gap-4 xl:grid-cols-2">{section("Item dimensions", "Physical product measurements.", values([["Length", product.itemLength ? `${product.itemLength} in` : ""], ["Width", product.itemWidth ? `${product.itemWidth} in` : ""], ["Height", product.itemHeight ? `${product.itemHeight} in` : ""], ["Weight", product.itemWeight ? `${product.itemWeight} lb` : ""]]))}{section("Package & compliance", "Shipment measurements and regulatory documentation.", values([["Length", product.packageLength ? `${product.packageLength} in` : ""], ["Width", product.packageWidth ? `${product.packageWidth} in` : ""], ["Height", product.packageHeight ? `${product.packageHeight} in` : ""], ["Weight", product.packageWeight ? `${product.packageWeight} lb` : ""], ["Dimensional weight", product.dimensionalWeight ? `${product.dimensionalWeight} lb` : ""], ["Hazardous", product.hazardous ? "Yes" : "No"], ["SDS", product.sdsUrl ? "Available" : "Missing"], ["Country of origin", product.countryOfOrigin || ""]]))}</div></TabsContent>
      {enabledChannels.map((channel) => <TabsContent key={channel.id || channel.name} value={channelTabId(channel)} className="mt-4 grid gap-4"><ProductChannelPanel channel={channel} product={product} section={section} values={values} /></TabsContent>)}
      <TabsContent value="offers" className="mt-4 grid gap-4">{section("System variants", "Product UOM and purchasable variants generated by vendor rules.", <ProductVariantsTable rows={product.systemVariants || []} />)}{section("Aliases & marketplace shadows", "Related SKUs and channel-specific shadow records.", <div className="grid gap-4 lg:grid-cols-2"><ProductAliases rows={product.aliases || []} /><ProductShadows rows={product.shadowSkus || []} /></div>)}{section("Alternate supplier offers", "Existing alternate supplier records for this item.", <ProductOffers rows={product.vendorOffers || []} />)}</TabsContent>
      <TabsContent value="source" className="mt-4 grid gap-4">{section("Source catalog & audit", "Raw supplier fields and import history remain available for review.", <><ProductChangesTable rows={product.recentChanges || []} /><div className="mt-4 overflow-hidden rounded-md border"><Table><TableHeader><TableRow><TableHead>Source field</TableHead><TableHead>Value</TableHead></TableRow></TableHeader><TableBody>{sourceRows.map(([key, value]) => <TableRow key={key}><TableCell className="w-64 font-medium">{key}</TableCell><TableCell className="max-w-xl whitespace-pre-wrap break-words">{typeof value === "object" ? JSON.stringify(value) : String(value ?? "-")}</TableCell></TableRow>)}{!sourceRows.length && <TableRow><TableCell colSpan={2} className="py-8 text-center text-muted-foreground">No raw source fields are stored for this product.</TableCell></TableRow>}</TableBody></Table></div></>)}</TabsContent>
    </Tabs><ProductEditorDialog open={editorOpen} onOpenChange={setEditorOpen} initialTab={productTab === "content" ? "content" : productTab === "pricing" || productTab === "inventory" ? "pricing" : productTab === "shipping" ? "shipping" : productTab === "source" ? "audit" : "basics"} draft={draft} setDraft={setDraft} saving={saving} onSave={save} />
  </div>
}

function ProductReadinessPanel({ score, checks, discontinued }: { score: number; checks: ReadonlyArray<readonly [string, boolean]>; discontinued: boolean }) { const missing = checks.filter(([, ready]) => !ready).map(([label]) => label); const label = discontinued ? "Blocked" : score === 100 ? "Ready" : `${missing.length} item${missing.length === 1 ? "" : "s"} need attention`; return <Card className="order-first lg:absolute lg:right-5 lg:top-[72px] lg:z-10 lg:w-[44%]"><CardContent className="grid gap-3 p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold">Product readiness</p><p className="text-xs text-muted-foreground">{discontinued ? "Discontinued products cannot be published." : label}</p></div><Badge variant={discontinued ? "destructive" : score === 100 ? "default" : "outline"}>{discontinued ? "Blocked" : `${score}%`}</Badge></div><Progress value={score} className="h-2" /><div className="grid grid-cols-3 gap-x-3 gap-y-2 text-xs">{checks.map(([label, ready]) => <div key={label} className={ready ? "text-foreground" : "text-muted-foreground"}><span className={ready ? "mr-1 text-emerald-600" : "mr-1 text-amber-600"}>{ready ? "Ready" : "Needs"}</span>{label}</div>)}</div></CardContent></Card> }

function ProductChannelPanel({ channel, product, section, values }: { channel: ChannelConnection; product: ProductItem; section: (title: string, description: string, children: React.ReactNode) => React.ReactNode; values: (rows: Array<[string, string]>) => React.ReactNode }) {
  const name = String(channel.name || "Channel")
  const kind = name.toLowerCase()
  if (kind === "shopify") {
    const productRows: Array<[string, string]> = [["Product ID", product.shopifyId || "Not linked"], ["Variant ID", product.shopifyVariantId || "Not linked"], ["Handle", product.shopifyHandle || ""], ["Variant SKU", product.shopifyLiveVariantSku || product.shopifyVariantSku || ""], ["Status", product.shopifyStatus || "Not linked"], ["Published", product.shopifyPublished ? "Yes" : "No"], ["Published at", product.shopifyPublishedAt ? dateLabel(product.shopifyPublishedAt) : ""], ["Last Shopify update", product.shopifyUpdatedAt ? dateLabel(product.shopifyUpdatedAt) : ""], ["Last paired", product.shopifySyncedAt ? dateLabel(product.shopifySyncedAt) : ""], ["Sync source", product.shopifySyncSource || ""], ["Product variants", numberLabel(product.shopifyVariantCount)], ["Storefront", product.shopifyOnlineStoreUrl || "Not available"]]
    const commerceRows: Array<[string, string]> = [["DataPlus price", moneyLabel(product.shopifySystemPrice ?? product.websitePrice ?? product.price)], ["Live Shopify price", moneyLabel(product.shopifyLivePrice)], ["Compare-at price", moneyLabel(product.shopifyLiveCompareAtPrice ?? undefined)], ["Price difference", moneyLabel(product.shopifyPriceDelta ?? undefined)], ["Price match", product.shopifyPriceMismatch ? "Needs review" : "Matched"], ["Live inventory", numberLabel(product.shopifyLiveInventoryQuantity)], ["Inventory variant", product.shopifyLiveVariantSku || ""], ["Selling UOM", product.uomDisplay || "Each"]]
    return <>{section("Shopify product pair", "The parent product and sellable variant linked to this DataPlus SKU.", values(productRows))}{section("Shopify commercial values", "Channel-specific price, inventory, and UOM sell-unit information for this product.", <><div className="mb-4">{values(commerceRows)}</div><ProductVariantsTable rows={product.shopifyPurchaseVariants || []} /></>)}</>
  }
  if (kind === "ebay") {
    const ebay = product.ebayListing || {}
    const listingRows: Array<[string, string]> = [["Status", ebay.status || "Not listed"], ["Listing ID", ebay.listingId || "Not linked"], ["Offer ID", ebay.offerId || ""], ["Listing URL", ebay.listingUrl || ""], ["Marketplace", ebay.marketplaceId || "EBAY_US"], ["Merchant location", ebay.merchantLocationKey || ""], ["Category ID", ebay.categoryId || ""], ["Category path", ebay.categoryPath || ""], ["Taxonomy version", ebay.taxonomyVersion || ""], ["Condition", ebay.condition || product.condition || "New"], ["Last listing update", ebay.updatedAt ? dateLabel(ebay.updatedAt) : ""], ["Attributes synced", ebay.attributesSyncedAt ? dateLabel(ebay.attributesSyncedAt) : ""]]
    const commerceRows: Array<[string, string]> = [["Listing price", ebay.price === undefined ? "" : `${ebay.currency || "USD"} ${moneyLabel(ebay.price)}`], ["Listing quantity", numberLabel(ebay.quantity)], ["Best offer", ebay.bestOfferEnabled ? "Enabled" : "Off"], ["Payment policy", ebay.paymentPolicyId || ""], ["Return policy", ebay.returnPolicyId || ""], ["Fulfillment policy", ebay.fulfillmentPolicyId || ""], ["DataPlus price", moneyLabel(product.websitePrice ?? product.price)], ["Available quantity", numberLabel(Math.max(0, Number(product.qty ?? product.stockQty ?? 0) - Number(product.reserved || 0)))]]
    return <>{section("eBay listing connection", "Offer, listing, and category values associated with this SKU.", values(listingRows))}{section("eBay commercial settings", "Product-level listing quantity, price, and policy assignments.", values(commerceRows))}</>
  }
  const shadowRows = (product.shadowSkus || []).filter((shadow) => String(shadow.marketplace || shadow.company || "").toLowerCase() === kind)
  const channelRows: Array<[string, string]> = [["Connection", channel.connected ? "Enabled" : "Disabled"], ["Channel status", channel.status || "Active"], ["Default status", String(channel.settings?.defaultShadowStatus || "Draft")], ["Default handling days", String(channel.settings?.defaultHandlingTimeDays ?? "")], ["Default safety quantity", String(channel.settings?.defaultSafetyQty ?? "")], ["Default max sellable qty", String(channel.settings?.defaultMaxSellableQty ?? "")], ["Default shipping profile", String(channel.settings?.defaultShippingProfile || "")], ["Default shipping service", String(channel.settings?.defaultShippingService || "")]]
  return <>{section(`${name} channel record`, "Channel configuration and any marketplace-specific SKU record available for this product.", values(channelRows))}{section(`${name} SKU records`, "Marketplace shadows created for this product.", <ProductShadows rows={shadowRows} />)}</>
}

function ProductIdentifiersTable({ rows }: { rows: Array<Record<string, unknown>> }) { return rows.length ? <div className="overflow-hidden rounded-md border"><Table><TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Value</TableHead><TableHead>Source</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader><TableBody>{rows.map((row, index) => { const type = row.type || row.kind || row.name || row.key || "Identifier"; const value = row.value || row.identifier || row.code || row.id || "-"; const source = row.source || row.provider || row.channel || "-"; const updatedAt = row.updatedAt || row.createdAt || row.updated_at; return <TableRow key={`${String(type)}-${String(value)}-${index}`}><TableCell className="font-medium">{String(type)}</TableCell><TableCell className="font-mono text-xs">{String(value)}</TableCell><TableCell>{String(source)}</TableCell><TableCell>{updatedAt ? dateLabel(String(updatedAt)) : "-"}</TableCell></TableRow> })}</TableBody></Table></div> : <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">No additional identifiers are stored for this product.</p> }
function ProductVariantsTable({ rows }: { rows: Array<Record<string, unknown>> }) { return rows.length ? <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Variant SKU</TableHead><TableHead>Option</TableHead><TableHead>UOM / quantity</TableHead><TableHead>Unit cost</TableHead><TableHead>System price</TableHead><TableHead>Shopify variant ID</TableHead><TableHead>Live price</TableHead><TableHead>Live inventory</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{rows.map((row, index) => <TableRow key={`${String(row.shopifyVariantSku || row.sku || "variant")}-${index}`}><TableCell className="font-mono text-xs">{String(row.shopifyVariantSku || row.sku || "-")}</TableCell><TableCell>{[row.optionName, row.optionValue].filter(Boolean).join(": ") || "Default"}</TableCell><TableCell>{String(row.uomDisplay || row.uomQty || "Each")}</TableCell><TableCell>{moneyLabel((row.unitCost ?? row.cost) as number)}</TableCell><TableCell>{moneyLabel(row.price as number)}</TableCell><TableCell className="font-mono text-xs">{String(row.shopifyVariantId || "-")}</TableCell><TableCell>{moneyLabel(row.shopifyLivePrice as number)}</TableCell><TableCell>{row.shopifyLiveInventoryQuantity === null || row.shopifyLiveInventoryQuantity === undefined ? "-" : numberLabel(row.shopifyLiveInventoryQuantity as number)}</TableCell><TableCell>{row.shopifyPublished ? "Published" : String(row.shopifyStatus || row.status || "Not linked")}</TableCell></TableRow>)}</TableBody></Table></div> : <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">No variants are configured.</p> }
function ProductInventoryLedger({ sku }: { sku: string }) { const [rows, setRows] = useState<Array<{ createdAt?: string; type?: string; warehouseName?: string; quantityChange?: number; qtyBefore?: number; qtyAfter?: number; reason?: string }>>([]); const [loading, setLoading] = useState(true); useEffect(() => { let cancelled = false; setLoading(true); api<{ rows?: typeof rows }>(`/api/inventory/${encodeURIComponent(sku)}/ledger`).then((result) => { if (!cancelled) setRows(result.rows || []) }).catch(() => { if (!cancelled) setRows([]) }).finally(() => { if (!cancelled) setLoading(false) }); return () => { cancelled = true } }, [sku]); if (loading) return <div className="grid gap-2"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>; return rows.length ? <div className="overflow-hidden rounded-md border"><Table><TableHeader><TableRow><TableHead>When</TableHead><TableHead>Type</TableHead><TableHead>Warehouse</TableHead><TableHead>Change</TableHead><TableHead>On hand</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader><TableBody>{rows.map((row, index) => <TableRow key={`${row.createdAt}-${index}`}><TableCell>{row.createdAt ? new Date(row.createdAt).toLocaleString() : "-"}</TableCell><TableCell>{row.type || "adjustment"}</TableCell><TableCell>{row.warehouseName || "Global"}</TableCell><TableCell>{Number(row.quantityChange || 0) > 0 ? "+" : ""}{numberLabel(row.quantityChange)}</TableCell><TableCell>{numberLabel(row.qtyBefore)} to {numberLabel(row.qtyAfter)}</TableCell><TableCell>{row.reason || "-"}</TableCell></TableRow>)}</TableBody></Table></div> : <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">No inventory movement has been recorded for this SKU.</p> }
function ProductWarehouseTable({ rows }: { rows: ProductItem["warehouseStock"] }) { return rows?.length ? <div className="overflow-hidden rounded-md border"><Table><TableHeader><TableRow><TableHead>Warehouse</TableHead><TableHead>Bin</TableHead><TableHead>On hand</TableHead><TableHead>Reserved</TableHead><TableHead>Available</TableHead><TableHead>Reorder</TableHead></TableRow></TableHeader><TableBody>{rows.map((row, index) => <TableRow key={`${row.warehouseName || row.warehouse}-${index}`}><TableCell>{row.warehouseName || row.warehouse || "-"}</TableCell><TableCell>{row.locationBin || "-"}</TableCell><TableCell>{numberLabel(row.qty)}</TableCell><TableCell>{numberLabel(row.reserved)}</TableCell><TableCell>{numberLabel(row.available ?? Math.max(0, Number(row.qty || 0) - Number(row.reserved || 0)))}</TableCell><TableCell>{numberLabel(row.reorderPoint)}</TableCell></TableRow>)}</TableBody></Table></div> : <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">No warehouse stock records are available.</p> }
function ProductChangesTable({ rows }: { rows: ProductItem["recentChanges"] }) { return rows?.length ? <div className="overflow-hidden rounded-md border"><Table><TableHeader><TableRow><TableHead>When</TableHead><TableHead>Field</TableHead><TableHead>Previous</TableHead><TableHead>Current</TableHead></TableRow></TableHeader><TableBody>{rows.slice(0, 25).map((row, index) => <TableRow key={`${row.field}-${index}`}><TableCell>{row.updatedAt || row.createdAt || "-"}</TableCell><TableCell>{row.field || "-"}</TableCell><TableCell>{row.previousValue || "-"}</TableCell><TableCell>{row.nextValue || "-"}</TableCell></TableRow>)}</TableBody></Table></div> : <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">No changes have been recorded yet.</p> }
function ProductAliases({ rows }: { rows: NonNullable<ProductItem["aliases"]> }) { return <div className="rounded-md border p-3"><p className="mb-2 text-sm font-medium">Aliases</p>{rows.length ? rows.map((row, index) => <div key={`${row.aliasSku || row.sku}-${index}`} className="flex justify-between border-t py-2 text-sm"><span>{row.aliasSku || row.sku}</span><span className="text-muted-foreground">{row.active === false ? "Inactive" : row.source || "Active"}</span></div>) : <p className="text-sm text-muted-foreground">No aliases.</p>}</div> }
function ProductShadows({ rows }: { rows: NonNullable<ProductItem["shadowSkus"]> }) { return <div className="rounded-md border p-3"><p className="mb-2 text-sm font-medium">Marketplace shadows</p>{rows.length ? rows.map((row, index) => <div key={`${row.shadowSku}-${index}`} className="flex justify-between border-t py-2 text-sm"><span>{row.marketplace || row.company || "Channel"}: {row.shadowSku || "-"}</span><span className="text-muted-foreground">{row.status || "Draft"}</span></div>) : <p className="text-sm text-muted-foreground">No shadow SKUs.</p>}</div> }
function ProductOffers({ rows }: { rows: NonNullable<ProductItem["vendorOffers"]> }) { return rows.length ? <div className="overflow-hidden rounded-md border"><Table><TableHeader><TableRow><TableHead>Supplier</TableHead><TableHead>Vendor SKU</TableHead><TableHead>Cost</TableHead><TableHead>Stock</TableHead></TableRow></TableHeader><TableBody>{rows.map((row, index) => <TableRow key={`${row.sku || row.vendorSku}-${index}`}><TableCell>{row.supplier || row.vendor || "-"}</TableCell><TableCell>{row.vendorSku || row.sku || "-"}</TableCell><TableCell>{moneyLabel(row.cost)}</TableCell><TableCell>{numberLabel(row.stockQty ?? row.qty)}</TableCell></TableRow>)}</TableBody></Table></div> : <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">No alternate offers are currently attached.</p> }
function ProductEditorDialog({ open, onOpenChange, initialTab, draft, setDraft, saving, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; initialTab: "basics" | "content" | "pricing" | "shipping" | "audit"; draft: Record<string, string | boolean>; setDraft: React.Dispatch<React.SetStateAction<Record<string, string | boolean>>>; saving: boolean; onSave: () => void }) {
  const [editorTab, setEditorTab] = useState(initialTab)
  useEffect(() => { if (open) setEditorTab(initialTab) }, [open, initialTab])
  const set = (key: string, value: string | boolean) => setDraft((current) => ({ ...current, [key]: value }))
  const input = (label: string, key: string, type = "text") => <div className="grid gap-1.5"><Label>{label}</Label><Input type={type} value={String(draft[key] ?? "")} onChange={(event) => set(key, event.target.value)} /></div>
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="flex max-h-[92vh] min-h-[620px] flex-col overflow-hidden sm:max-w-5xl"><DialogHeader><DialogTitle>Edit product</DialogTitle><DialogDescription>Update the catalog record in focused sections. Channel-specific values remain in their channel tabs.</DialogDescription></DialogHeader><Tabs value={editorTab} onValueChange={(value) => setEditorTab(value as typeof editorTab)} className="flex min-h-0 flex-1 flex-col"><div className="overflow-x-auto border-y bg-muted/20 px-1"><TabsList className="h-auto min-w-max bg-transparent p-1"><TabsTrigger value="basics">Basics</TabsTrigger><TabsTrigger value="content">Content</TabsTrigger><TabsTrigger value="pricing">Pricing & inventory</TabsTrigger><TabsTrigger value="shipping">Shipping</TabsTrigger><TabsTrigger value="media">Media</TabsTrigger><TabsTrigger value="audit">Audit fields</TabsTrigger></TabsList></div><div className="min-h-0 flex-1 overflow-y-auto py-5 pr-2"><TabsContent value="basics" className="m-0 grid gap-5"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{input("Product title", "marketplaceTitle")}{input("Brand", "brand")}{input("Manufacturer", "manufacturer")}{input("Manufacturer part number", "mfrPartNumber")}{input("Supplier", "supplier")}{input("Supplier code", "supplierCode")}{input("Vendor SKU", "vendorSku")}{input("Main category", "mainCategory")}{input("Source category", "sourceCategory")}{input("Vendor category", "vendorCategory")}{input("Condition", "condition")}{input("Status", "status")}</div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{input("UPC / barcode", "barcode")}{input("External ID", "externalId")}{input("UNSPSC", "unspsc")}{input("UOM", "uom")}{input("UOM quantity", "uomQty", "number")}{input("Tags (comma separated)", "tags")}</div><div className="grid gap-4 rounded-md border p-4 sm:grid-cols-2"><ToggleRow label="Product active" description="Controls whether the catalog record is active." checked={Boolean(draft.active)} disabled={false} onCheckedChange={(checked) => set("active", checked)} /><ToggleRow label="Category verified" description="Confirms this product uses the assigned main category." checked={Boolean(draft.categoryVerified)} disabled={false} onCheckedChange={(checked) => set("categoryVerified", checked)} /></div></TabsContent><TabsContent value="content" className="m-0 grid gap-5"><div className="grid gap-1.5"><Label>Short description</Label><Textarea rows={4} value={String(draft.shortDescription ?? "")} onChange={(event) => set("shortDescription", event.target.value)} /></div><div className="grid gap-1.5"><Label>Long description</Label><Textarea rows={10} value={String(draft.longDescription ?? "")} onChange={(event) => set("longDescription", event.target.value)} /></div><div className="grid gap-1.5"><Label>Bullet points (one per line)</Label><Textarea rows={6} value={String(draft.bulletPoints ?? "")} onChange={(event) => set("bulletPoints", event.target.value)} /></div><div className="grid gap-3 sm:grid-cols-2">{input("SEO keywords", "seoKeywords")}{input("Wildcard search", "wildcardSearch")}</div></TabsContent><TabsContent value="pricing" className="m-0 grid gap-5"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{input("Website price", "websitePrice", "number")}{input("Source cost", "cost", "number")}{input("FOB price", "fobPrice", "number")}{input("List / MSRP", "listPrice", "number")}</div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{input("On-hand quantity", "qty", "number")}{input("Reserved quantity", "reserved", "number")}{input("Reorder point", "reorderPoint", "number")}{input("Minimum quantity", "minQuantity", "number")}{input("Quantity increments", "quantityIncrements", "number")}{input("Lead time", "leadTime", "number")}</div><p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">Vendor and channel pricing rules still determine calculated channel prices. Manual values here update the catalog inputs used by those rules.</p></TabsContent><TabsContent value="shipping" className="m-0 grid gap-5"><div className="grid gap-3"><p className="text-sm font-medium">Item dimensions</p><div className="grid gap-3 sm:grid-cols-4">{input("Length (in)", "itemLength", "number")}{input("Width (in)", "itemWidth", "number")}{input("Height (in)", "itemHeight", "number")}{input("Weight (lb)", "itemWeight", "number")}</div></div><div className="grid gap-3"><p className="text-sm font-medium">Package dimensions</p><div className="grid gap-3 sm:grid-cols-4">{input("Length (in)", "packageLength", "number")}{input("Width (in)", "packageWidth", "number")}{input("Height (in)", "packageHeight", "number")}{input("Weight (lb)", "packageWeight", "number")}</div></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{input("Dimensional weight (lb)", "dimensionalWeight", "number")}{input("Country of origin", "countryOfOrigin")}{input("SDS URL", "sdsUrl")}</div><ToggleRow label="Hazardous product" description="Marks this record for shipping and compliance review." checked={Boolean(draft.hazardous)} disabled={false} onCheckedChange={(checked) => set("hazardous", checked)} /></TabsContent><TabsContent value="media" className="m-0 grid gap-5"><div className="grid gap-1.5">{input("Default image URL", "defaultImage")}<Label>Image URLs (one per line)</Label><Textarea rows={10} value={String(draft.images ?? "")} onChange={(event) => set("images", event.target.value)} placeholder="https://..." /></div></TabsContent><TabsContent value="audit" className="m-0 grid gap-5"><p className="text-sm text-muted-foreground">These fields preserve the latest supplier feed and price audit details when they need correction.</p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{input("Stock status", "stockStatus")}{input("Stock updated at", "stockUpdatedAt")}{input("Last price update at", "lastPricesUpdateAt")}{input("Last price updated by", "lastPricesUpdateBy")}</div></TabsContent></div></Tabs><DialogFooter className="border-t pt-4"><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={onSave} disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save product</Button></DialogFooter></DialogContent></Dialog>
}

function MeasurementInputs({ prefix, draft, disabled, onChange }: { prefix: "item" | "package"; draft: Record<string, string | number | boolean>; disabled: boolean; onChange: (key: string, value: string) => void }) {
  const fields = [["Length", `${prefix}Length`], ["Width", `${prefix}Width`], ["Height", `${prefix}Height`], ["Weight", `${prefix}Weight`]]
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{fields.map(([label, key]) => <div key={key} className="grid gap-1.5"><Label>{label}{label === "Weight" ? " (lb)" : " (in)"}</Label><Input disabled={disabled} type="number" min="0" step="0.001" value={String(draft[key] ?? 0)} onChange={(event) => onChange(key, event.target.value)} /></div>)}</div>
}

function ToggleRow({ label, description, checked, disabled, onCheckedChange }: { label: string; description: string; checked: boolean; disabled: boolean; onCheckedChange: (checked: boolean) => void }) {
  return <div className="flex items-start justify-between gap-4"><div><p className="text-sm font-medium">{label}</p><p className="text-xs text-muted-foreground">{description}</p></div><Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} /></div>
}

type CatalogWorkspaceTab = "products" | "source" | "review" | "changes" | "categories" | "mappings" | "attributes" | "groups" | "inventory" | "templates" | "readiness"

const catalogWorkspaceTabs: Array<{ id: CatalogWorkspaceTab; label: string }> = [
  { id: "products", label: "Products" },
  { id: "source", label: "Source Catalog" },
  { id: "review", label: "Import Review" },
  { id: "changes", label: "SKU Changes" },
  { id: "categories", label: "Categories" },
  { id: "mappings", label: "Vendor Mappings" },
  { id: "attributes", label: "Attributes" },
  { id: "groups", label: "Groups" },
  { id: "inventory", label: "Inventory" },
  { id: "templates", label: "Templates" },
  { id: "readiness", label: "Readiness" },
]

function catalogWorkspaceTabFromPath() {
  const path = window.location.pathname.toLowerCase()
  if (path.startsWith("/source-catalog") || path === "/source") return "source"
  if (path.startsWith("/import-review")) return "review"
  if (path.startsWith("/sku-changes")) return "changes"
  if (path.startsWith("/categories")) return "categories"
  if (path.startsWith("/vendor-category-mappings")) return "mappings"
  if (path.startsWith("/attributes")) return "attributes"
  if (path.startsWith("/groups")) return "groups"
  if (path.startsWith("/inventory")) return "inventory"
  if (path.startsWith("/templates")) return "templates"
  if (path.startsWith("/readiness")) return "readiness"
  return "products"
}

function catalogCellValue(value: unknown) {
  if (value === undefined || value === null || value === "") return "-"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString() : "-"
  if (Array.isArray(value)) return value.slice(0, 3).join(", ") || "-"
  if (typeof value === "object") return "Configured"
  return String(value)
}

function CatalogRecordsTable({ rows, columns, empty }: { rows: Array<Record<string, unknown>>; columns: Array<[string, string]>; empty: string }) {
  if (!rows.length) return <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{empty}</div>
  return <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow>{columns.map(([key, label]) => <TableHead key={key}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((row, index) => <TableRow key={String(row.id || row.sku || row.categoryId || row.vendorCategory || index)}>{columns.map(([key]) => <TableCell key={key} className="max-w-80"><span className="block truncate" title={catalogCellValue(row[key])}>{catalogCellValue(row[key])}</span></TableCell>)}</TableRow>)}</TableBody></Table></div>
}

const catalogResourceConfig: Record<Exclude<CatalogWorkspaceTab, "products" | "source" | "inventory" | "templates">, { endpoint: string; title: string; description: string; rows: string; columns: Array<[string, string]> }> = {
  review: { endpoint: "/api/data-quality/products?limit=100", title: "Import Review", description: "Review products that need attention before they move through catalog and channel workflows.", rows: "rows", columns: [["sku", "SKU"], ["title", "Product"], ["issues", "Issues"], ["status", "Status"], ["updatedAt", "Updated"]] },
  changes: { endpoint: "/api/catalog/changes?limit=100", title: "SKU Changes", description: "Recent source changes detected across cost, inventory, status, and catalog data.", rows: "rows", columns: [["sku", "SKU"], ["field", "Field"], ["previousValue", "Previous"], ["nextValue", "Current"], ["createdAt", "Detected"]] },
  categories: { endpoint: "/api/categories?scope=main", title: "Categories", description: "Main category structure built from True Value and approved catalog mappings.", rows: "categories", columns: [["name", "Category"], ["productCount", "Products"], ["status", "Status"], ["updatedAt", "Updated"]] },
  mappings: { endpoint: "/api/vendor-category-mappings?limit=100", title: "Vendor Category Mappings", description: "Supplier categories mapped into the main catalog. Unmapped rows stay visible for review.", rows: "rows", columns: [["supplier", "Supplier"], ["vendorCategory", "Vendor category"], ["mainCategory", "Main category"], ["matchCount", "SKUs"], ["mapped", "Mapped"]] },
  attributes: { endpoint: "/api/categories/attributes", title: "Attributes", description: "Marketplace attribute requirements and the source fields that fulfill them.", rows: "rows", columns: [["Category", "Category"], ["Channel", "Channel"], ["Attribute", "Attribute"], ["Mapped Source Field", "Source field"], ["Required", "Required"]] },
  groups: { endpoint: "/api/categories/attribute-groups", title: "Attribute Groups", description: "Reusable attribute groups that keep category requirements consistent.", rows: "groups", columns: [["label", "Group"], ["aliases", "Aliases"], ["updatedAt", "Updated"]] },
  readiness: { endpoint: "/api/data-quality/products?limit=100", title: "Readiness", description: "Product readiness queue for missing content, dimensions, category, or marketplace requirements.", rows: "rows", columns: [["sku", "SKU"], ["title", "Product"], ["issues", "Missing or invalid"], ["channel", "Channel"], ["status", "Status"]] },
}

function CatalogResourcePage({ tab }: { tab: Exclude<CatalogWorkspaceTab, "products" | "source" | "inventory" | "templates"> }) {
  const config = catalogResourceConfig[tab]
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  async function load(force = false) {
    force ? setRefreshing(true) : setLoading(true)
    try {
      const result = await api<Record<string, unknown>>(config.endpoint)
      const values = result[config.rows]
      setRows(Array.isArray(values) ? values as Array<Record<string, unknown>> : [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Unable to load ${config.title.toLowerCase()}.`)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { load() }, [tab])

  const rebuildCategories = async () => {
    try {
      await api("/api/categories/summary-index/rebuild", { method: "POST", body: JSON.stringify({ scope: "both" }) })
      toast.success("Category summary index rebuilt.")
      load(true)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to rebuild category index.") }
  }

  return <div className="grid gap-5"><PageHeader eyebrow="Catalog" title={config.title} description={config.description} action={<div className="flex gap-2">{tab === "categories" && <Button variant="outline" onClick={rebuildCategories}>Rebuild index</Button>}<Button variant="outline" onClick={() => load(true)} disabled={refreshing}>{refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh</Button></div>} /><Card><CardHeader className="border-b"><CardTitle className="text-sm">{numberLabel(rows.length)} loaded</CardTitle><CardDescription>{tab === "mappings" ? "Use the vendor profile to edit individual mapping rules and add missing main categories." : "Data loads only when this tab is opened."}</CardDescription></CardHeader><CardContent className="p-4">{loading ? <div className="grid gap-2"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div> : <CatalogRecordsTable rows={rows} columns={config.columns} empty={`No ${config.title.toLowerCase()} records are available.`} />}</CardContent></Card></div>
}

function MainCatalogPage({ inventoryOnly = false, totalSkuCount = 0 }: { inventoryOnly?: boolean; totalSkuCount?: number }) {
  const [query, setQuery] = useState("")
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [facets, setFacets] = useState<{ suppliers?: string[]; brands?: string[]; manufacturers?: string[]; categories?: string[] }>({})
  const [rows, setRows] = useState<ProductItem[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<CatalogItem | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterField, setFilterField] = useState("supplier")
  const [filterSearch, setFilterSearch] = useState("")
  const [filterSelection, setFilterSelection] = useState<string[]>([])
  const pageSize = 25

  async function load(nextPage = page, nextFilters = filters) {
    setLoading(true)
    try {
      const params = new URLSearchParams({ q: query, page: String(nextPage), limit: String(pageSize), fastPage: "true" })
      Object.entries(nextFilters).forEach(([key, value]) => { if (value) params.set(key, value) })
      const result = await api<{ inventory?: ProductItem[]; total?: number; page?: number; hasMore?: boolean }>(`/api/inventory?${params}`)
      setRows(result.inventory || [])
      setTotal(Number(result.total || 0))
      setHasMore(Boolean(result.hasMore))
      setPage(Number(result.page || nextPage))
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load main catalog products.") } finally { setLoading(false) }
  }

  useEffect(() => {
    api<{ facets?: { suppliers?: string[]; brands?: string[]; manufacturers?: string[] } }>("/api/inventory/facets")
      .then((result) => setFacets(result.facets || {}))
      .catch(() => {})
    load(1, {})
  }, [])

  const title = inventoryOnly ? "Inventory" : "Products"
  const description = inventoryOnly ? "Main catalog stock, replenishable overrides, and channel inventory state." : "Approved SKUs managed for Shopify and every connected sales channel. Product results are cached briefly for fast repeat access."
  const filterCount = Object.values(filters).filter(Boolean).length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const filterDefinitions: Record<string, { label: string; values: string[]; display: (value: string) => string }> = {
    channelStatus: { label: "Shopify", values: ["shopify-live", "shopify-linked", "shopify-missing", "shopify-ready", "shopify-not-ready", "shopify-unpublished"], display: (value) => value.replace(/^shopify-/, "").replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) },
    hasStock: { label: "Inventory", values: ["true", "false"], display: (value) => value === "true" ? "In stock" : "Out of stock" },
    supplier: { label: "Supplier", values: facets.suppliers || [], display: (value) => value },
    brand: { label: "Brand", values: facets.brands || [], display: (value) => value },
    manufacturer: { label: "Manufacturer", values: facets.manufacturers || [], display: (value) => value },
    active: { label: "Status", values: ["true", "false"], display: (value) => value === "true" ? "Active" : "Inactive" },
  }
  const activeDefinition = filterDefinitions[filterField]
  const matchingValues = activeDefinition.values.filter((value) => activeDefinition.display(value).toLowerCase().includes(filterSearch.toLowerCase())).slice(0, 250)
  const resetFilters = () => { setFilters({}); setQuery(""); load(1, {}) }
  const toggleSelection = (value: string) => setFilterSelection((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])
  const applyFilter = () => {
    if (!filterSelection.length) return
    const next = { ...filters, [filterField]: filterSelection.join("|") }
    setFilters(next)
    setFilterOpen(false)
    setFilterSelection([])
    setFilterSearch("")
    load(1, next)
  }
  const removeFilter = (key: string) => { const next = { ...filters }; delete next[key]; setFilters(next); load(1, next) }
  const applySavedFilter = (next: Record<string, string>) => { setFilters(next); load(1, next) }
  return <div className="grid gap-5"><PageHeader eyebrow="Catalog" title={title} description={description} action={<Button variant="outline" onClick={() => load()} disabled={loading}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh</Button>} /><Card><CardHeader className="grid gap-3 border-b"><div className="flex flex-wrap items-center gap-2"><div className="relative"><Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" /><Input className="w-[360px] max-w-[70vw] pl-8" placeholder="Search SKU, title, brand, category" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") load(1) }} /></div><DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="outline">Saved filters</Button></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuItem onSelect={() => applySavedFilter({ channelStatus: "shopify-live" })}>Shopify live</DropdownMenuItem><DropdownMenuItem onSelect={() => applySavedFilter({ hasStock: "true" })}>In stock</DropdownMenuItem><DropdownMenuItem onSelect={() => applySavedFilter({ channelStatus: "shopify-missing" })}>Missing from Shopify</DropdownMenuItem></DropdownMenuContent></DropdownMenu><DropdownMenu open={filterOpen} onOpenChange={setFilterOpen}><DropdownMenuTrigger asChild><Button size="sm" variant="outline">+ Filter</Button></DropdownMenuTrigger><DropdownMenuContent align="start" className="w-[380px] p-3"><div className="grid gap-3"><p className="text-xs font-semibold uppercase text-muted-foreground">Add product filter</p><div className="grid gap-1"><Label className="text-xs">Field</Label><Select value={filterField} onValueChange={(value) => { setFilterField(value); setFilterSelection([]); setFilterSearch("") }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(filterDefinitions).map(([key, definition]) => <SelectItem key={key} value={key}>{definition.label}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-1"><Label className="text-xs">Operator</Label><Input value="Is any of" disabled /></div><div className="grid gap-1"><Label className="text-xs">Value</Label><div className="relative"><Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" /><Input className="pl-8" placeholder="Search values" value={filterSearch} onChange={(event) => setFilterSearch(event.target.value)} /></div></div><div className="max-h-52 overflow-y-auto rounded-md border">{matchingValues.map((value) => <label key={value} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted"><Checkbox checked={filterSelection.includes(value)} onCheckedChange={() => toggleSelection(value)} />{activeDefinition.display(value)}</label>)}{!matchingValues.length && <p className="p-3 text-sm text-muted-foreground">No values found.</p>}</div><div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setFilterOpen(false)}>Cancel</Button><Button size="sm" onClick={applyFilter} disabled={!filterSelection.length}>Apply filter</Button></div></div></DropdownMenuContent></DropdownMenu><Button size="sm" variant="ghost" onClick={resetFilters} disabled={!filterCount && !query}>Clear</Button>{Object.entries(filters).map(([key, value]) => <Badge key={key} variant="outline" className="gap-1 border-primary/35 bg-primary/5 text-primary">{filterDefinitions[key]?.label || key} is {value.split("|").map((item) => filterDefinitions[key]?.display(item) || item).join(", ")}<button className="ml-1" onClick={() => removeFilter(key)} aria-label={`Remove ${filterDefinitions[key]?.label || key} filter`}>x</button></Badge>)}</div></CardHeader><CardContent className="p-4">{loading ? <div className="grid gap-2"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div> : <><div className="mb-3 text-xs text-muted-foreground">{totalSkuCount ? `${numberLabel(totalSkuCount)} total SKUs` : total ? `${numberLabel(total)} approved SKUs` : `${numberLabel(rows.length)} shown`} / page {page}</div><div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Product</TableHead><TableHead>Supplier</TableHead><TableHead>Brand</TableHead><TableHead>Category</TableHead><TableHead>Stock</TableHead><TableHead>Price</TableHead><TableHead>Shopify</TableHead><TableHead /></TableRow></TableHeader><TableBody>{rows.map((item) => <TableRow key={item.sku}><TableCell className="font-medium">{item.sku}</TableCell><TableCell className="max-w-80"><p className="truncate">{item.title || "Untitled"}</p></TableCell><TableCell>{item.supplier || item.vendor || "-"}</TableCell><TableCell>{item.brand || "-"}</TableCell><TableCell className="max-w-64"><p className="truncate">{item.mainCategory || item.category || "Uncategorized"}</p></TableCell><TableCell>{numberLabel(item.qty ?? item.stockQty)}</TableCell><TableCell>{moneyLabel(item.websitePrice ?? item.price)}</TableCell><TableCell><Badge variant={item.shopifyId ? "default" : "outline"}>{item.shopifyId ? (item.shopifyPublished ? "Live" : "Linked") : "Not linked"}</Badge></TableCell><TableCell><Button size="icon" variant="ghost" onClick={() => setSelected(item)} title="Open SKU"><MoreHorizontal className="size-4" /></Button></TableCell></TableRow>)}{!rows.length && <TableRow><TableCell colSpan={9} className="py-10 text-center text-muted-foreground">No approved products match these filters.</TableCell></TableRow>}</TableBody></Table></div><div className="mt-3 flex items-center justify-end gap-2"><Button size="sm" variant="outline" disabled={loading || page <= 1} onClick={() => load(page - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={loading || (total ? page >= totalPages : !hasMore)} onClick={() => load(page + 1)}>Next</Button></div></>}</CardContent></Card><ProductDetailSheet sourceItem={selected} open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null) }} /></div>
}

function AdvancedMainCatalogPage({ totalSkuCount = 0 }: { totalSkuCount?: number }) {
  const [query, setQuery] = useState("")
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [facets, setFacets] = useState<{ suppliers?: string[]; brands?: string[]; manufacturers?: string[]; categories?: string[] }>({})
  const [rows, setRows] = useState<ProductItem[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<CatalogItem | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [allFiltered, setAllFiltered] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterField, setFilterField] = useState("supplier")
  const [filterSearch, setFilterSearch] = useState("")
  const [filterSelection, setFilterSelection] = useState<string[]>([])
  const [pageSize, setPageSize] = useState(() => Number(window.localStorage.getItem("dataplus-products-page-size") || 25))
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" }>({ key: "", direction: "asc" })
  const [alternateCounts, setAlternateCounts] = useState<Record<string, number>>({})
  const [loadingAlternates, setLoadingAlternates] = useState(false)
  const [autoAlternates, setAutoAlternates] = useState(() => window.localStorage.getItem("dataplus-products-auto-alternates") === "true")
  const [compact, setCompact] = useState(() => window.localStorage.getItem("dataplus-products-density") === "compact")
  const [visible, setVisible] = useState<Record<string, boolean>>(() => {
    const defaults = { readiness: true, stock: true, price: true, brand: true, category: true, shopify: true, ebay: true, images: true, updated: true, alternates: false, manufacturer: false, vendorSku: false, status: false, shadows: false, uom: false, shipping: true }
    try { return { ...defaults, ...JSON.parse(window.localStorage.getItem("dataplus-products-columns") || "{}") } } catch { return defaults }
  })
  const columns = [
    ["readiness", "Readiness"], ["stock", "Stock"], ["price", "Price"], ["brand", "Brand"], ["category", "Category"], ["shopify", "Shopify"], ["ebay", "eBay"], ["images", "Images"], ["updated", "Updated"], ["alternates", "Alternates"], ["manufacturer", "Manufacturer"], ["vendorSku", "Vendor SKU"], ["status", "Status"], ["shadows", "Shadows"], ["uom", "UOM"], ["shipping", "Shipping"],
  ] as const
  const filterDefinitions: Record<string, { label: string; values: string[]; display: (value: string) => string }> = {
    channelStatus: { label: "Channel", values: ["shopify-live", "shopify-linked", "shopify-missing", "shopify-ready", "shopify-not-ready", "shopify-unpublished", "shopify-price-mismatch", "ebay-live", "ebay-offer", "ebay-ready", "ebay-not-ready", "ebay-missing"], display: (value) => value.replace(/^(shopify|ebay)-/, "$1 ").replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) },
    hasStock: { label: "Inventory", values: ["true", "false"], display: (value) => value === "true" ? "In stock" : "Out of stock" },
    supplier: { label: "Supplier", values: facets.suppliers || [], display: (value) => value },
    brand: { label: "Brand", values: facets.brands || [], display: (value) => value },
    manufacturer: { label: "Manufacturer", values: facets.manufacturers || [], display: (value) => value },
    category: { label: "Category", values: facets.categories || [], display: (value) => value },
    active: { label: "Status", values: ["true", "false"], display: (value) => value === "true" ? "Active" : "Inactive" },
    toBeDiscontinued: { label: "Closeout", values: ["true", "false"], display: (value) => value === "true" ? "Discontinued" : "Not discontinued" },
  }

  async function load(nextPage = page, nextFilters = filters, nextSort = sort, nextPageSize = pageSize) {
    setLoading(true)
    try {
      const params = new URLSearchParams({ q: query, page: String(nextPage), limit: String(nextPageSize), fastPage: "true", includeTotal: "true", sort: nextSort.key, sortDirection: nextSort.direction })
      Object.entries(nextFilters).forEach(([key, value]) => { if (value) params.set(key, value) })
      const result = await api<{ inventory?: ProductItem[]; total?: number; page?: number; hasMore?: boolean }>(`/api/inventory?${params}`)
      setRows(result.inventory || [])
      setTotal(Number(result.total || 0))
      setHasMore(Boolean(result.hasMore))
      setPage(Number(result.page || nextPage))
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load products.") } finally { setLoading(false) }
  }

  useEffect(() => {
    api<{ facets?: { suppliers?: string[]; brands?: string[]; manufacturers?: string[]; categories?: string[] } }>("/api/inventory/facets").then((result) => setFacets(result.facets || {})).catch(() => {})
    load(1, {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeDefinition = filterDefinitions[filterField]
  const matchingValues = activeDefinition.values.filter((value) => activeDefinition.display(value).toLowerCase().includes(filterSearch.toLowerCase())).slice(0, 250)
  const selectionCount = allFiltered ? total : selectedIds.size
  const pageIds = rows.map((row) => String(row.id || row.sku || "")).filter(Boolean)
  const pageSelected = pageIds.length > 0 && pageIds.every((id) => allFiltered || selectedIds.has(id))
  const setDensity = (next: boolean) => { setCompact(next); window.localStorage.setItem("dataplus-products-density", next ? "compact" : "regular") }
  const toggleColumn = (key: string) => setVisible((current) => { const next = { ...current, [key]: !current[key] }; window.localStorage.setItem("dataplus-products-columns", JSON.stringify(next)); return next })
  const resetColumns = () => {
    const defaults = { readiness: true, stock: true, price: true, brand: true, category: true, shopify: true, ebay: true, images: true, updated: true, alternates: false, manufacturer: false, vendorSku: false, status: false, shadows: false, uom: false, shipping: true }
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
  const loadAlternates = async () => {
    const skus = rows.map((row) => row.sku).filter(Boolean).slice(0, 100)
    if (!skus.length) return
    setLoadingAlternates(true)
    try {
      const result = await api<{ alternates?: Record<string, CatalogItem[]> }>(`/api/catalog/alternates?skus=${encodeURIComponent(skus.join(","))}`)
      const counts = Object.fromEntries(skus.map((sku) => [String(sku).toLowerCase(), Number(result.alternates?.[String(sku).toLowerCase()]?.length || 0)]))
      setAlternateCounts(counts)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load alternate offers.") } finally { setLoadingAlternates(false) }
  }
  const toggleAutoAlternates = (checked: boolean) => {
    setAutoAlternates(checked)
    window.localStorage.setItem("dataplus-products-auto-alternates", String(checked))
  }
  const applyFilter = () => {
    if (!filterSelection.length) return
    const next = { ...filters, [filterField]: filterSelection.join("|") }
    setFilters(next); setFilterOpen(false); setFilterSelection([]); setFilterSearch(""); setAllFiltered(false); setSelectedIds(new Set()); load(1, next)
  }
  const removeFilter = (key: string) => { const next = { ...filters }; delete next[key]; setFilters(next); setAllFiltered(false); setSelectedIds(new Set()); load(1, next) }
  const resetFilters = () => { setFilters({}); setQuery(""); setAllFiltered(false); setSelectedIds(new Set()); load(1, {}) }
  const toggleRow = (id: string, checked: boolean) => { setAllFiltered(false); setSelectedIds((current) => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next }) }
  const togglePage = (checked: boolean) => { setAllFiltered(false); setSelectedIds((current) => { const next = new Set(current); pageIds.forEach((id) => checked ? next.add(id) : next.delete(id)); return next }) }
  const applySavedFilter = (next: Record<string, string>) => { setFilters(next); setAllFiltered(false); setSelectedIds(new Set()); load(1, next) }
  async function runBulk(action: "set-active" | "set-inactive" | "set-discontinued" | "delete") {
    if (!selectionCount) return
    if ((action === "delete" || action === "set-discontinued") && !window.confirm(`${action === "delete" ? "Delete" : "Discontinue"} ${numberLabel(selectionCount)} selected product${selectionCount === 1 ? "" : "s"}?`)) return
    try {
      const result = await api<{ changed?: number; limited?: boolean }>("/api/inventory/bulk", { method: "POST", body: JSON.stringify({ ids: [...selectedIds], allFiltered, query, filters, action }) })
      toast.success(`${numberLabel(result.changed || 0)} product${result.changed === 1 ? "" : "s"} updated.${result.limited ? " Limited to the first 25,000 filtered rows." : ""}`)
      setSelectedIds(new Set()); setAllFiltered(false); load(1)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update selected products.") }
  }
  async function runEbayLaunch(ids = [...selectedIds]) {
    let launchIds = ids
    if (allFiltered) {
      try {
        const params = new URLSearchParams({ q: query, page: "1", limit: "200", fastPage: "true", includeTotal: "true", sort: sort.key, sortDirection: sort.direction })
        Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value) })
        const result = await api<{ inventory?: ProductItem[] }>(`/api/inventory?${params}`)
        launchIds = (result.inventory || []).map((item) => String(item.id || item.sku || "")).filter(Boolean)
      } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to prepare the eBay batch."); return }
    }
    if (!launchIds.length) return
    const label = allFiltered ? `the first ${numberLabel(launchIds.length)} matching products` : `${numberLabel(launchIds.length)} selected products`
    if (!window.confirm(`Launch ${label} to eBay using channel pricing? Products that are not eBay-ready will be skipped.`)) return
    try {
      const result = await api<{ launched?: number; skipped?: number; failed?: number }>("/api/inventory/ebay/bulk-launch", { method: "POST", body: JSON.stringify({ ids: launchIds.slice(0, 200), useChannelPricing: true }) })
      toast.success(`eBay: ${numberLabel(result.launched || 0)} launched, ${numberLabel(result.skipped || 0)} skipped, ${numberLabel(result.failed || 0)} failed.`)
      setSelectedIds(new Set()); setAllFiltered(false); load(1)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to launch eBay listings.") }
  }
  const readiness = (item: ProductItem) => {
    const checks = [Boolean(item.title || item.marketplaceTitle), Boolean(item.mainCategory || item.category), Number(item.websitePrice || item.price || 0) > 0, Boolean(item.defaultImage), Number(item.qty ?? item.stockQty ?? 0) > 0]
    const score = Math.round((checks.filter(Boolean).length / checks.length) * 100)
    return { score, missing: [!checks[0] && "title", !checks[1] && "category", !checks[2] && "price", !checks[3] && "image", !checks[4] && "stock"].filter(Boolean).join(", ") }
  }
  const cellCount = 3 + columns.filter(([key]) => visible[key]).length

  useEffect(() => { if (autoAlternates && rows.length) loadAlternates() }, [autoAlternates, rows])
  useEffect(() => {
    const skuButtons = document.querySelectorAll<HTMLButtonElement>("button.truncate.text-left.font-semibold.hover\\:underline")
    skuButtons.forEach((button) => {
      const sku = button.textContent?.trim()
      const container = button.parentElement
      if (!sku || !container) return
      container.classList.add("group")
      button.onclick = (event) => {
        event.preventDefault()
        event.stopPropagation()
        window.history.pushState({}, "", `/products/${encodeURIComponent(sku)}`)
        window.dispatchEvent(new PopStateEvent("popstate"))
      }
      let quickView = container.querySelector<HTMLButtonElement>("[data-product-quick-view]")
      if (!quickView) {
        quickView = document.createElement("button")
        quickView.type = "button"
        quickView.dataset.productQuickView = "true"
        quickView.className = "ml-1 hidden rounded border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted group-hover:inline-flex"
        quickView.textContent = "View"
        quickView.title = "Quick view"
        container.appendChild(quickView)
      }
      quickView.onclick = (event) => {
        event.preventDefault()
        event.stopPropagation()
        setSelected(rows.find((item) => item.sku === sku) || null)
      }
    })
  }, [compact, rows])

  return <div className="grid gap-5">
    <PageHeader eyebrow="Catalog" title="Products" description="Approved SKUs for Shopify and connected channels. Fast paged results with legacy table controls restored." />
    <Card>
      <CardHeader className="grid gap-3 border-b">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative"><Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" /><Input className="w-[360px] max-w-[70vw] pl-8" placeholder="Search SKU, title, brand, category" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { setAllFiltered(false); setSelectedIds(new Set()); load(1) } }} /></div>
          <DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="outline">Saved filters</Button></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuItem onSelect={() => applySavedFilter({ channelStatus: "shopify-live" })}>Shopify live</DropdownMenuItem><DropdownMenuItem onSelect={() => applySavedFilter({ hasStock: "true" })}>In stock</DropdownMenuItem><DropdownMenuItem onSelect={() => applySavedFilter({ channelStatus: "shopify-missing" })}>Missing from Shopify</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
          <DropdownMenu open={filterOpen} onOpenChange={setFilterOpen}><DropdownMenuTrigger asChild><Button size="sm" variant="outline">+ Filter</Button></DropdownMenuTrigger><DropdownMenuContent align="start" className="w-[380px] p-3"><div className="grid gap-3"><p className="text-xs font-semibold uppercase text-muted-foreground">Add product filter</p><Select value={filterField} onValueChange={(value) => { setFilterField(value); setFilterSelection([]); setFilterSearch("") }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(filterDefinitions).map(([key, definition]) => <SelectItem key={key} value={key}>{definition.label}</SelectItem>)}</SelectContent></Select><Input value="Is any of" disabled /><div className="relative"><Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" /><Input className="pl-8" placeholder="Search values" value={filterSearch} onChange={(event) => setFilterSearch(event.target.value)} /></div><div className="max-h-52 overflow-y-auto rounded-md border">{matchingValues.map((value) => <label key={value} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted"><Checkbox checked={filterSelection.includes(value)} onCheckedChange={() => setFilterSelection((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])} />{activeDefinition.display(value)}</label>)}</div><div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setFilterOpen(false)}>Cancel</Button><Button size="sm" onClick={applyFilter} disabled={!filterSelection.length}>Apply filter</Button></div></div></DropdownMenuContent></DropdownMenu>
          <Button size="sm" variant="ghost" onClick={resetFilters} disabled={!Object.keys(filters).length && !query}>Clear</Button>
          <Button size="sm" variant="outline" onClick={loadAlternates} disabled={loadingAlternates || !rows.length}>{loadingAlternates ? "Loading alternates" : "Load alternates"}</Button>
          <label className="flex items-center gap-2 text-xs text-muted-foreground"><Switch checked={autoAlternates} onCheckedChange={toggleAutoAlternates} /> Auto alternates</label>
          <DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="outline">Columns</Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-52">{columns.map(([key, label]) => <DropdownMenuItem key={key} onSelect={(event) => { event.preventDefault(); toggleColumn(key) }}><Checkbox checked={visible[key]} /> {label}</DropdownMenuItem>)}<DropdownMenuSeparator /><DropdownMenuItem onSelect={resetColumns}>Reset default columns</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
          <div className="ml-auto flex items-center gap-1 rounded-md border p-1"><Button size="sm" variant={!compact ? "secondary" : "ghost"} onClick={() => setDensity(false)}>Regular</Button><Button size="sm" variant={compact ? "secondary" : "ghost"} onClick={() => setDensity(true)}>Compact</Button></div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{numberLabel(total || totalSkuCount)} filtered | {rows.length ? `${numberLabel((page - 1) * pageSize + 1)}-${numberLabel((page - 1) * pageSize + rows.length)}` : "0"} shown | page {page}</span>{Object.entries(filters).map(([key, value]) => <Badge key={key} variant="outline" className="gap-1 border-primary/35 bg-primary/5 text-primary">{filterDefinitions[key]?.label || key} is {value.split("|").map((item) => filterDefinitions[key]?.display(item) || item).join(", ")}<button className="ml-1" onClick={() => removeFilter(key)}>x</button></Badge>)}</div>
        {selectionCount > 0 && <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2"><p className="mr-auto text-sm font-medium">{allFiltered ? `${numberLabel(selectionCount)} filtered products selected` : `${numberLabel(selectionCount)} selected`}</p><Button size="sm" variant="ghost" onClick={() => { setSelectedIds(new Set()); setAllFiltered(false) }}>Clear</Button><Button size="sm" variant="outline" onClick={() => runBulk("set-active")}>Set active</Button><Button size="sm" variant="outline" onClick={() => runBulk("set-inactive")}>Set inactive</Button><Button size="sm" variant="outline" onClick={() => runBulk("set-discontinued")}>Discontinue</Button><Button size="sm" variant="outline" onClick={() => runEbayLaunch()}>Launch eBay</Button><Button size="sm" variant="destructive" onClick={() => runBulk("delete")}>Delete</Button></div>}
      </CardHeader>
      <CardContent className="p-0">
        {loading ? <div className="grid gap-2 p-4"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div> : <div className="overflow-x-auto"><Table className={compact ? "text-xs" : ""}><TableHeader><TableRow><TableHead className="w-10"><Checkbox aria-label="Select current page" checked={pageSelected} onCheckedChange={(checked) => togglePage(checked === true)} /></TableHead><TableHead><Button variant="ghost" size="sm" onClick={() => changeSort("sku")}>Product</Button></TableHead>{visible.readiness && <TableHead>Readiness</TableHead>}{visible.stock && <TableHead><Button variant="ghost" size="sm" onClick={() => changeSort("stock")}>Stock</Button></TableHead>}{visible.price && <TableHead><Button variant="ghost" size="sm" onClick={() => changeSort("price")}>Price</Button></TableHead>}{visible.brand && <TableHead><Button variant="ghost" size="sm" onClick={() => changeSort("brand")}>Brand</Button></TableHead>}{visible.category && <TableHead><Button variant="ghost" size="sm" onClick={() => changeSort("category")}>Category</Button></TableHead>}{visible.shopify && <TableHead>Shopify</TableHead>}{visible.ebay && <TableHead>eBay</TableHead>}{visible.images && <TableHead>Images</TableHead>}{visible.updated && <TableHead><Button variant="ghost" size="sm" onClick={() => changeSort("updated")}>Updated</Button></TableHead>}{visible.alternates && <TableHead>Alts</TableHead>}{visible.manufacturer && <TableHead><Button variant="ghost" size="sm" onClick={() => changeSort("manufacturer")}>Manufacturer</Button></TableHead>}{visible.vendorSku && <TableHead><Button variant="ghost" size="sm" onClick={() => changeSort("vendorSku")}>Vendor SKU</Button></TableHead>}{visible.status && <TableHead><Button variant="ghost" size="sm" onClick={() => changeSort("status")}>Status</Button></TableHead>}{visible.shadows && <TableHead>Shadows</TableHead>}{visible.uom && <TableHead>UOM</TableHead>}{visible.shipping && <TableHead>Shipping</TableHead>}<TableHead /></TableRow></TableHeader><TableBody>{rows.map((item) => { const id = String(item.id || item.sku || ""); const ready = readiness(item); const imageCount = Number(item.imageCount || (item.defaultImage ? 1 : 0)); const alternateCount = alternateCounts[String(item.sku || "").toLowerCase()] ?? Number(item.alternateVendorCount || 0); const ebay = item.ebayListing?.listingId ? "Live" : item.ebayListing?.offerId ? "Offer" : item.ebayListing?.status || "Not listed"; return <TableRow key={id} className={compact ? "h-10" : ""}><TableCell><Checkbox aria-label={`Select ${item.sku}`} checked={allFiltered || selectedIds.has(id)} onCheckedChange={(checked) => toggleRow(id, checked === true)} /></TableCell><TableCell className="min-w-64"><div className="flex items-center gap-2"><div className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted">{item.defaultImage ? <img src={item.defaultImage} alt="" className="max-h-full max-w-full object-contain" /> : <Boxes className="size-4 text-muted-foreground" />}</div><div className="min-w-0"><button className="truncate text-left font-semibold hover:underline" onClick={() => setSelected(item)}>{item.sku}</button>{!compact && <p className="line-clamp-1 text-xs text-muted-foreground">{item.marketplaceTitle || item.title || "Untitled product"}</p>}</div></div></TableCell>{visible.readiness && <TableCell><Badge variant={ready.score === 100 ? "default" : "outline"}>{ready.score}%</Badge>{!compact && ready.missing && <p className="mt-1 max-w-28 truncate text-xs text-muted-foreground">{ready.missing}</p>}</TableCell>}{visible.stock && <TableCell className="font-medium">{numberLabel(item.qty ?? item.stockQty)}</TableCell>}{visible.price && <TableCell className="font-medium">{moneyLabel(item.websitePrice ?? item.price)}</TableCell>}{visible.brand && <TableCell>{item.brand || "No brand"}</TableCell>}{visible.category && <TableCell className="max-w-64"><p className="truncate" title={item.mainCategory || item.category || ""}>{item.mainCategory || item.category || "Uncategorized"}</p>{!compact && <p className="truncate text-xs text-muted-foreground">{item.vendorCategory || item.sourceCategory || "No vendor category"}</p>}</TableCell>}{visible.shopify && <TableCell><Badge variant={item.shopifyId && item.shopifyPublished ? "default" : "outline"}>{item.shopifyId ? (item.shopifyPublished ? "Live" : item.shopifyStatus || "Linked") : "Not linked"}</Badge></TableCell>}{visible.ebay && <TableCell><Badge variant={ebay === "Live" ? "default" : "outline"}>{ebay}</Badge></TableCell>}{visible.images && <TableCell>{imageCount}</TableCell>}{visible.updated && <TableCell>{item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : "-"}</TableCell>}{visible.alternates && <TableCell>{numberLabel(alternateCount)}</TableCell>}{visible.manufacturer && <TableCell>{item.manufacturer || "-"}</TableCell>}{visible.vendorSku && <TableCell>{item.vendorSku || "-"}</TableCell>}{visible.status && <TableCell><Badge variant={item.active === false ? "outline" : "secondary"}>{item.status || (item.active === false ? "Inactive" : "Active")}</Badge></TableCell>}{visible.shadows && <TableCell>{numberLabel(item.shadowSkuCount)}</TableCell>}{visible.uom && <TableCell>{item.uomDisplay || [item.uomQty, item.uom].filter(Boolean).join(" ") || "Each"}</TableCell>}{visible.shipping && <TableCell><Badge variant={item.shippingClass === "ltl" ? "destructive" : "outline"}>{item.shippingMethod || item.shippingClass || "Unclassified"}</Badge></TableCell>}<TableCell><DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="ghost" title="Product actions"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => setSelected(item)}>Preview and edit</DropdownMenuItem><DropdownMenuItem onClick={() => runEbayLaunch([id])}>Launch eBay</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onClick={() => runBulkRow(id, "set-active")}>Set active</DropdownMenuItem><DropdownMenuItem onClick={() => runBulkRow(id, "set-inactive")}>Set inactive</DropdownMenuItem><DropdownMenuItem onClick={() => runBulkRow(id, "set-discontinued")}>Discontinue</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onClick={() => window.open(`/legacy/products?sku=${encodeURIComponent(item.sku || "")}`, "_blank")}>Open legacy product</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell></TableRow> })}{!rows.length && <TableRow><TableCell colSpan={cellCount} className="h-28 text-center text-muted-foreground">No approved products match these filters.</TableCell></TableRow>}</TableBody></Table></div>}
      </CardContent>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t p-3"><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => togglePage(true)} disabled={!pageIds.length}>Select page</Button><Button size="sm" variant="outline" onClick={() => { setSelectedIds(new Set()); setAllFiltered(true) }} disabled={!total}>Select all filtered</Button></div><div className="flex flex-wrap items-center justify-end gap-2"><Select value={String(pageSize)} onValueChange={setPageLimit}><SelectTrigger className="h-8 w-20 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="25">25</SelectItem><SelectItem value="50">50</SelectItem><SelectItem value="100">100</SelectItem></SelectContent></Select><Button size="sm" variant="outline" disabled={loading || page <= 1} onClick={() => load(page - 1)}>Previous</Button>{total > 0 && Array.from({ length: Math.min(5, Math.ceil(total / pageSize)) }, (_, index) => { const totalPages = Math.ceil(total / pageSize); const start = Math.min(Math.max(1, page - 2), Math.max(1, totalPages - 4)); const number = start + index; return <Button key={number} size="sm" variant={number === page ? "secondary" : "outline"} onClick={() => load(number)}>{number}</Button> })}{total > 0 && Math.ceil(total / pageSize) > 5 && <span className="text-xs text-muted-foreground">of {numberLabel(Math.ceil(total / pageSize))}</span>}<Button size="sm" variant="outline" disabled={loading || (total ? page >= Math.ceil(total / pageSize) : !hasMore)} onClick={() => load(page + 1)}>Next</Button></div></div>
    </Card>
    <ProductDetailSheet sourceItem={selected} open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null) }} />
  </div>

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

function CatalogPage() {
  const [tab, setTab] = useState<CatalogWorkspaceTab>(catalogWorkspaceTabFromPath)
  const [workspaceCounts, setWorkspaceCounts] = useState<Record<string, number>>({})
  useEffect(() => {
    api<{ counts?: Record<string, number> }>("/api/catalog/workspace-summary")
      .then((result) => setWorkspaceCounts(result.counts || {}))
      .catch(() => {})
  }, [])
  const selectTab = (next: string) => {
    const selected = next as CatalogWorkspaceTab
    setTab(selected)
    const paths: Record<CatalogWorkspaceTab, string> = { products: "/products", source: "/source-catalog", review: "/import-review", changes: "/sku-changes", categories: "/categories", mappings: "/vendor-category-mappings", attributes: "/attributes", groups: "/groups", inventory: "/inventory", templates: "/templates", readiness: "/readiness" }
    window.history.replaceState({}, "", paths[selected])
  }
  return <div className="grid gap-5"><Tabs value={tab} onValueChange={selectTab}><div className="overflow-x-auto rounded-md border bg-card p-1"><TabsList className="h-auto min-w-max justify-start bg-transparent p-0">{catalogWorkspaceTabs.map((item) => <TabsTrigger key={item.id} value={item.id} className="text-xs">{item.label}</TabsTrigger>)}</TabsList></div></Tabs>{tab === "products" && <AdvancedMainCatalogPage totalSkuCount={workspaceCounts.products} />}{tab === "source" && <SourceCatalogPage />}{tab === "inventory" && <MainCatalogPage inventoryOnly totalSkuCount={workspaceCounts.inventory} />}{tab === "templates" && <CatalogTemplatesPage />}{(["review", "changes", "categories", "mappings", "attributes", "groups", "readiness"] as CatalogWorkspaceTab[]).includes(tab) && <CatalogResourcePage tab={tab as Exclude<CatalogWorkspaceTab, "products" | "source" | "inventory" | "templates">} />}</div>
}

function SourceCatalogPage() {
  const [query, setQuery] = useState("")
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [response, setResponse] = useState<CatalogResponse>({})
  const [selectedItem, setSelectedItem] = useState<CatalogItem | null>(null)
  const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set())
  const [promoting, setPromoting] = useState(false)
  const [latestCursorStack, setLatestCursorStack] = useState<string[]>([""])

  async function loadCatalog(nextPage = page, cursor = "") {
    setLoading(true)
    try {
      const params = new URLSearchParams({ q: query, page: String(nextPage), limit: String(pageSize) })
      if (!query.trim()) {
        params.set("sort", "latest")
        if (cursor) params.set("cursor", cursor)
      }
      const result = await api<CatalogResponse>(`/api/catalog/products?${params}`)
      setResponse(result)
      setPage(nextPage)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load catalog products.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLatestCursorStack([""])
    loadCatalog(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize])

  const rows = response.items || []
  const total = Number(response.totalMatches || rows.length || 0)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const latestMode = !query.trim()
  const pageSkus = rows.map((item) => item.sku || "").filter(Boolean)
  const pageSelected = pageSkus.length > 0 && pageSkus.every((sku) => selectedSkus.has(sku))

  function toggleSku(sku: string, checked: boolean) {
    setSelectedSkus((current) => {
      const next = new Set(current)
      if (checked) next.add(sku)
      else next.delete(sku)
      return next
    })
  }

  async function promoteSelected() {
    const skus = [...selectedSkus]
    if (!skus.length) return
    setPromoting(true)
    try {
      const result = await api<{ changed?: number }>("/api/catalog/promote-bulk", { method: "POST", body: JSON.stringify({ skus }) })
      toast.success(`${numberLabel(result.changed || skus.length)} SKU${(result.changed || skus.length) === 1 ? "" : "s"} added to the main catalog.`)
      setSelectedSkus(new Set())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to add selected SKUs to the main catalog.")
    } finally {
      setPromoting(false)
    }
  }

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="Catalog"
        title="Products"
        description="Latest source SKUs first, with compact product, price, stock, and category columns."
        action={<Button asChild variant="outline"><a href="/legacy/products" target="_blank" rel="noreferrer"><ExternalLink className="size-4" /> Advanced table</a></Button>}
      />
      <Card>
        <CardHeader className="border-b">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
              <Input
                className="w-[420px] max-w-[75vw] pl-8"
                placeholder="Search SKU, title, brand, supplier, category"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") loadCatalog(1) }}
              />
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => { setLatestCursorStack([""]); loadCatalog(1) }} disabled={loading}>{loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Search</Button>
              <Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10 rows</SelectItem>
                  <SelectItem value="25">25 rows</SelectItem>
                  <SelectItem value="50">50 rows</SelectItem>
                  <SelectItem value="100">100 rows</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <CardDescription>
            {query.trim()
              ? `${numberLabel(total)} matched. Source: ${response.database || response.manifest?.source || "catalog"} ${response.partial ? "/ partial search" : ""}`
              : `${numberLabel(total)} newest source SKUs. Search SKU, title, brand, supplier, or category to narrow the list.`}
          </CardDescription>
          {!!selectedSkus.size && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/40 p-2"><p className="text-sm font-medium">{numberLabel(selectedSkus.size)} selected</p><div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => setSelectedSkus(new Set())}>Clear</Button><Button size="sm" onClick={promoteSelected} disabled={promoting}>{promoting && <Loader2 className="size-4 animate-spin" />} Add to main catalog</Button></div></div>}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"><Checkbox aria-label="Select page" checked={pageSelected} onCheckedChange={(checked) => { const next = new Set(selectedSkus); for (const sku of pageSkus) { if (checked) next.add(sku); else next.delete(sku) } setSelectedSkus(next) }} /></TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((item) => (
                <TableRow key={item.id || item.sku}>
                  <TableCell><Checkbox aria-label={`Select ${item.sku}`} checked={Boolean(item.sku && selectedSkus.has(item.sku))} onCheckedChange={(checked) => item.sku && toggleSku(item.sku, checked === true)} /></TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="grid size-10 place-items-center overflow-hidden rounded-md border bg-muted">
                        {item.defaultImage ? <img src={item.defaultImage} alt="" className="max-h-full max-w-full object-contain" /> : <Boxes className="size-4 text-muted-foreground" />}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{item.sku}</p>
                        <p className="line-clamp-1 text-xs text-muted-foreground">{item.title}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{item.supplier || item.supplierCode || "Unknown"}</p>
                    <p className="text-xs text-muted-foreground">{item.brand || "No brand"}</p>
                  </TableCell>
                  <TableCell className="max-w-[320px]">
                    <p className="line-clamp-2 text-sm">{item.mainCategory || item.sourceCategory || "Uncategorized"}</p>
                    <Badge variant={item.categoryVerified ? "default" : "outline"}>{item.categoryVerified ? "Verified" : "Needs map"}</Badge>
                  </TableCell>
                  <TableCell>{numberLabel(item.stockQty)}</TableCell>
                  <TableCell>{moneyLabel(item.cost)}</TableCell>
                  <TableCell>{moneyLabel(item.websitePrice || item.price)}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <Badge variant={item.active === false ? "outline" : "default"}>{item.active === false ? "Inactive" : "Active"}</Badge>
                      {item.toBeDiscontinued && <Badge variant="destructive">Discontinued</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setSelectedItem(item)}>Open product</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => window.open(`/legacy/products?sku=${encodeURIComponent(item.sku || "")}`, "_blank")}>Open legacy product</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
              {!rows.length && (
                <TableRow><TableCell colSpan={9} className="h-28 text-center text-muted-foreground">{query.trim() ? "No products found." : "No recently added source SKUs found."}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{latestMode ? `Page ${page}` : `Page ${page} of ${totalPages}`}</p>
        <div className="flex gap-2">
          <Button variant="outline" disabled={page <= 1 || loading} onClick={() => {
            const previousCursor = latestMode ? (latestCursorStack[page - 2] || "") : ""
            if (latestMode) setLatestCursorStack((current) => current.slice(0, Math.max(1, page - 1)))
            loadCatalog(Math.max(1, page - 1), previousCursor)
          }}>Previous</Button>
          <Button variant="outline" disabled={loading || (latestMode ? !response.nextCursor : page >= totalPages)} onClick={() => {
            if (latestMode) {
              const nextCursor = response.nextCursor || ""
              setLatestCursorStack((current) => [...current.slice(0, page), nextCursor])
              loadCatalog(page + 1, nextCursor)
              return
            }
            loadCatalog(Math.min(totalPages, page + 1))
          }}>Next</Button>
        </div>
      </div>
      <ProductDetailSheet sourceItem={selectedItem} open={Boolean(selectedItem)} onOpenChange={(nextOpen) => { if (!nextOpen) setSelectedItem(null) }} />
    </div>
  )
}

function VendorsPage({ vendors, onSaveVendor }: { vendors: Vendor[]; onSaveVendor: (id: string, patch: Record<string, unknown>) => Promise<void> }) {
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState("")
  const filtered = vendors.filter((vendor) => `${vendor.name} ${vendor.code || ""} ${vendor.email || ""}`.toLowerCase().includes(query.toLowerCase()))
  const selected = vendors.find((vendor) => vendor.id === selectedId) || filtered[0] || vendors[0]

  useEffect(() => {
    if (!selectedId && selected?.id) setSelectedId(selected.id)
  }, [selected?.id, selectedId])

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="Suppliers"
        title="Vendor Settings"
        description="Contacts, payment terms, pricing rules, variation rules, replenishable inventory, and category mapping entry points."
        action={<Button asChild variant="outline"><a href="/legacy/vendors" target="_blank" rel="noreferrer"><ExternalLink className="size-4" /> Advanced vendors</a></Button>}
      />
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Vendors</CardTitle>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search vendors" value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
          </CardHeader>
          <CardContent className="grid max-h-[680px] gap-2 overflow-auto">
            {filtered.map((vendor) => (
              <Button
                key={vendor.id}
                variant={selected?.id === vendor.id ? "secondary" : "ghost"}
                className="h-auto justify-between gap-3 py-3"
                onClick={() => setSelectedId(vendor.id)}
              >
                <span className="min-w-0 text-left">
                  <span className="block truncate font-medium">{vendor.name}</span>
                  <span className="block text-xs text-muted-foreground">{vendor.code || vendor.type || "Supplier"}</span>
                </span>
                <Badge variant={String(vendor.status || "active").toLowerCase() === "active" ? "default" : "outline"}>{vendor.status || "active"}</Badge>
              </Button>
            ))}
          </CardContent>
        </Card>
        {selected ? <VendorDetail vendor={selected} onSave={onSaveVendor} /> : <Card><CardContent className="p-6 text-muted-foreground">No vendors found.</CardContent></Card>}
      </div>
    </div>
  )
}

function VendorDetail({ vendor, onSave }: { vendor: Vendor; onSave: (id: string, patch: Record<string, unknown>) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const value = (field: string, fallback = "") => String(draft[field] ?? (vendor as unknown as Record<string, unknown>)[field] ?? fallback)
  const addressValue = (field: string, fallback = "") => String(draft[`address.${field}`] ?? vendor.address?.[field as keyof NonNullable<Vendor["address"]>] ?? fallback)

  useEffect(() => {
    setEditing(false)
    setDraft({})
  }, [vendor.id])

  function update(field: string, next: unknown) {
    setDraft((current) => ({ ...current, [field]: next }))
  }

  function updateAddress(field: string, next: unknown) {
    setDraft((current) => ({ ...current, [`address.${field}`]: next }))
  }

  async function save() {
    await onSave(vendor.id, draft)
    setDraft({})
    setEditing(false)
  }

  const inventoryRules = vendor.inventoryRules || {}
  const pricingRules = vendor.pricingRules || {}
  const variationRules = vendor.variationRules || {}

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Vendor profile</p>
            <CardTitle>{vendor.name}</CardTitle>
            <CardDescription>{vendor.code || vendor.type || "Supplier"} / {vendor.status || "active"}</CardDescription>
          </div>
          <div className="flex gap-2">
            {editing ? (
              <>
                <Button variant="outline" onClick={() => { setEditing(false); setDraft({}) }}>Cancel</Button>
                <Button onClick={save}>Save changes</Button>
              </>
            ) : <Button onClick={() => setEditing(true)}>Edit</Button>}
          </div>
        </CardHeader>
      </Card>

      <Tabs defaultValue="summary">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="contact">Contact</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>
        <TabsContent value="summary" className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-4">
            <MetricCard label="Open POs" value={vendor.openPOs || 0} icon={FileWarning} />
            <MetricCard label="Total POs" value={vendor.totalPOs || 0} icon={History} />
            <MetricCard label="Total spend" value={moneyLabel(vendor.totalSpend || 0)} icon={Database} />
            <MetricCard label="Lead time" value={`${vendor.leadTimeDays || 0} days`} icon={Truck} />
          </div>
          <Card>
            <CardHeader><CardTitle className="text-base">Notes</CardTitle></CardHeader>
            <CardContent>
              <Textarea disabled={!editing} value={value("notes")} onChange={(event) => update("notes", event.target.value)} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="contact">
          <Card>
            <CardHeader><CardTitle className="text-base">Primary contact and address</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="Vendor name"><Input disabled={!editing} value={value("name")} onChange={(event) => update("name", event.target.value)} /></Field>
              <Field label="Payment terms">
                <Select disabled={!editing} value={value("paymentTerms", "TBD")} onValueChange={(next) => update("paymentTerms", next)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TBD">TBD</SelectItem>
                    <SelectItem value="Due on receipt">Due on receipt</SelectItem>
                    <SelectItem value="Net 15">Net 15</SelectItem>
                    <SelectItem value="Net 30">Net 30</SelectItem>
                    <SelectItem value="Net 45">Net 45</SelectItem>
                    <SelectItem value="Net 60">Net 60</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="POC"><Input disabled={!editing} value={value("contactName")} onChange={(event) => update("contactName", event.target.value)} /></Field>
              <Field label="Email"><Input disabled={!editing} value={value("email")} onChange={(event) => update("email", event.target.value)} /></Field>
              <Field label="Phone"><Input disabled={!editing} value={value("phone")} onChange={(event) => update("phone", event.target.value)} /></Field>
              <Field label="Website"><Input disabled={!editing} value={value("website")} onChange={(event) => update("website", event.target.value)} /></Field>
              <Field label="Address line 1"><Input disabled={!editing} value={addressValue("line1")} onChange={(event) => updateAddress("line1", event.target.value)} /></Field>
              <Field label="Address line 2"><Input disabled={!editing} value={addressValue("line2")} onChange={(event) => updateAddress("line2", event.target.value)} /></Field>
              <Field label="City"><Input disabled={!editing} value={addressValue("city")} onChange={(event) => updateAddress("city", event.target.value)} /></Field>
              <Field label="State"><Input disabled={!editing} value={addressValue("state")} onChange={(event) => updateAddress("state", event.target.value)} /></Field>
              <Field label="Postal code"><Input disabled={!editing} value={addressValue("postalCode")} onChange={(event) => updateAddress("postalCode", event.target.value)} /></Field>
              <Field label="Country"><Input disabled={!editing} value={addressValue("country", "US")} onChange={(event) => updateAddress("country", event.target.value)} /></Field>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="rules">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pricing and variation rules</CardTitle>
              <CardDescription>Saved at vendor level so imports and Shopify pushes can reuse the rules.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Detail label="Cost basis" value={String(pricingRules.costBasis || "standard")} />
              <Detail label="Min allowed price" value={String(pricingRules.enforceMinimumAllowedPrice ?? true)} />
              <Detail label="Variant mode" value={String(variationRules.shopifyVariantMode || "standard")} />
              <Detail label="Allow variations" value={String(variationRules.allowShopifyVariations ?? true)} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="inventory">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Replenishable inventory</CardTitle>
              <CardDescription>Vendor defaults. SKU-level overrides still decide whether a product follows these defaults.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <Detail label="Enabled" value={String(inventoryRules.replenishableEnabled ?? false)} />
              <Detail label="Default qty" value={String(inventoryRules.replenishableQty ?? 0)} />
              <Detail label="Warehouse" value="Staten Island" />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="categories">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Vendor category mappings</CardTitle>
              <CardDescription>Heavy mapping data loads only when opened in the mapping workspace.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild variant="outline"><a href={`/legacy/vendors/${encodeURIComponent(vendor.id)}?tab=categories`} target="_blank" rel="noreferrer">Open mapping workspace</a></Button>
              <Button asChild variant="outline"><a href="/legacy/categories" target="_blank" rel="noreferrer">Main categories</a></Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function SettingsPage({
  settings,
  workerStatus,
  onSaveSettings,
}: {
  settings: SystemSettings
  workerStatus: WorkerStatus
  onSaveSettings: (patch: Record<string, unknown>) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const value = (field: string) => draft[field] ?? settings[field]
  const boolValue = (field: string) => Boolean(value(field))

  function update(field: string, next: unknown) {
    setDraft((current) => ({ ...current, [field]: next }))
  }

  async function save() {
    await onSaveSettings(draft)
    setDraft({})
    setEditing(false)
  }

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="Admin"
        title="System Settings"
        description="Operations, workers, backups, retention, and safety rules in compact editable tabs."
        action={editing ? (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setEditing(false); setDraft({}) }}>Cancel</Button>
            <Button onClick={save}>Save changes</Button>
          </div>
        ) : <Button onClick={() => setEditing(true)}>Edit</Button>}
      />

      <Tabs defaultValue="operations">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="operations">Operations</TabsTrigger>
          <TabsTrigger value="worker">Worker</TabsTrigger>
          <TabsTrigger value="backups">Backups</TabsTrigger>
          <TabsTrigger value="catalog">Catalog</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
        </TabsList>
        <TabsContent value="operations">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Operations</CardTitle>
              <CardDescription>Controls background work and job history behavior.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Background jobs mode">
                <Select disabled={!editing} value={String(value("backgroundJobsMode") || "inline")} onValueChange={(next) => update("backgroundJobsMode", next)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inline">Inline</SelectItem>
                    <SelectItem value="worker">External worker</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <ToggleField label="Auto quality scan after imports" checked={boolValue("autoDataQualityScanAfterImports")} disabled={!editing} onCheckedChange={(next) => update("autoDataQualityScanAfterImports", next)} />
              <ToggleField label="Clean expired job files" checked={boolValue("jobsRetentionAutoCleanupEnabled")} disabled={!editing} onCheckedChange={(next) => update("jobsRetentionAutoCleanupEnabled", next)} />
              <Field label="Jobs retention days">
                <Input disabled={!editing} type="number" value={String(value("jobsRetentionDays") || 60)} onChange={(event) => update("jobsRetentionDays", Number(event.target.value || 0))} />
              </Field>
              <ToggleField label="Admin confirmation for deletes" checked={boolValue("requireAdminConfirmationForDeletes")} disabled={!editing} onCheckedChange={(next) => update("requireAdminConfirmationForDeletes", next)} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="worker">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Worker health</CardTitle>
              <CardDescription>Current external worker state.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-4">
              <Detail label="Status" value={workerStatus.online ? "online" : "offline"} />
              <Detail label="Worker ID" value={workerStatus.workerId || "n/a"} />
              <Detail label="Current task" value={workerStatus.currentTask || "idle"} />
              <Detail label="Last seen" value={dateLabel(workerStatus.lastSeenAt)} />
              <ToggleField label="Quality scans on worker" checked={boolValue("dataQualityWorkerEnabled")} disabled={!editing} onCheckedChange={(next) => update("dataQualityWorkerEnabled", next)} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="backups">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Backups and retention</CardTitle>
              <CardDescription>Retention should stay long enough for job review and file downloads.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <ToggleField label="Include source catalog" checked={boolValue("backupIncludeSourceCatalog")} disabled={!editing} onCheckedChange={(next) => update("backupIncludeSourceCatalog", next)} />
              <Field label="Backup retention days"><Input disabled={!editing} type="number" value={String(value("backupRetentionDays") || 30)} onChange={(event) => update("backupRetentionDays", Number(event.target.value || 0))} /></Field>
              <Button variant="outline" onClick={() => api("/api/system/backup", { method: "POST", body: JSON.stringify({}) }).then(() => toast.success("Backup queued.")).catch((error) => toast.error(error.message))}>Run backup</Button>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="catalog">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Catalog behavior</CardTitle>
              <CardDescription>True Value source categories can seed the main category list.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <ToggleField label="True Value source category as main category" checked={boolValue("trueValueSourceCategoryAsMainCategory")} disabled={!editing} onCheckedChange={(next) => update("trueValueSourceCategoryAsMainCategory", next)} />
              <Button variant="outline" onClick={() => api("/api/categories/summary-index/rebuild", { method: "POST", body: JSON.stringify({ scope: "both" }) }).then(() => toast.success("Category summary index rebuild queued/completed.")).catch((error) => toast.error(error.message))}>Rebuild category index</Button>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="users">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Users and permissions</CardTitle>
              <CardDescription>Advanced user management is still available in the legacy screen while this tab is migrated.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline"><a href="/legacy/settings" target="_blank" rel="noreferrer">Open legacy user settings</a></Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{eyebrow}</p>
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background p-2">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate font-medium">{value}</p>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs font-bold text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

function ToggleField({
  label,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border bg-background p-3">
      <Label className="text-sm font-medium">{label}</Label>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  )
}

export default App
