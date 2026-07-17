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

type AppView = "overview" | "jobs" | "channels" | "catalog" | "vendors" | "settings"

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
  shopifyShippingProfiles?: Array<{ id?: string; name?: string; default?: boolean }>
  shopifyShippingProfilesSyncedAt?: string
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
  shopifyId?: string
  shopifyVariantId?: string
  shopifyStatus?: string
  shopifyPublished?: boolean
  shopifyLivePrice?: number
  shopifyLiveInventoryQuantity?: number
  shopifyOnlineStoreUrl?: string
  replenishable?: boolean
  replenishableUseVendorRules?: boolean
  replenishableQtyUseVendorDefault?: boolean
  replenishableQty?: number
  effectiveReplenishableQty?: number
  tags?: string[]
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
  vendors: "/vendors",
  settings: "/settings",
}

function viewFromPath(pathname = "/"): AppView {
  const path = pathname.replace(/\/+$/, "") || "/"
  if (path.startsWith("/jobs")) return "jobs"
  if (path.startsWith("/channels")) return "channels"
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

function App() {
  const [view, setView] = useState<AppView>(() => viewFromPath(window.location.pathname))
  const [state, setState] = useState<LiteState>({})
  const [jobs, setJobs] = useState<ImportJob[]>([])
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
      setJobs((current) => current.map((row) => row.id === result.job.id ? result.job : row))
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
      toast.success(success)
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
  const activeJobs = jobs.filter(isActiveJob)
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
        <MetricCard label="Active" value={jobs.filter(isActiveJob).length} icon={Play} />
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
        successMessage: "Shopify SKU map sync queued.",
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline"><MoreHorizontal className="size-4" /> Actions</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isShopify && <DropdownMenuItem onClick={onCheckShopify}>Check connection</DropdownMenuItem>}
                {isShopify && <DropdownMenuItem onClick={onRefreshShopifyToken}>Request new token</DropdownMenuItem>}
                {isShopify && <DropdownMenuItem onClick={syncShippingProfiles}>Import shipping profiles</DropdownMenuItem>}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => window.open(`/legacy/channels/${encodeURIComponent(channel.id)}`, "_blank")}>Open legacy channel</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
                  <Button variant="outline" onClick={() => queueShopifyAction("skuMap")}>Sync SKU map</Button>
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
              <Field label="Inventory schedule times">
                <Input disabled={!editing} value={String(settings.inventoryScheduleTimes || "03:00,13:00")} onChange={(event) => update("inventoryScheduleTimes", event.target.value)} />
              </Field>
              <ToggleField label="Inventory push" checked={Boolean(settings.shopifyInventoryPushEnabled)} disabled={!editing} onCheckedChange={(value) => update("shopifyInventoryPushEnabled", value)} />
              <ToggleField label="Scheduled inventory updates" checked={Boolean(settings.inventoryScheduleEnabled)} disabled={!editing} onCheckedChange={(value) => update("inventoryScheduleEnabled", value)} />
              <ToggleField label="Require successful dump" checked={Boolean(settings.inventoryScheduleRequireSuccessfulDump)} disabled={!editing} onCheckedChange={(value) => update("inventoryScheduleRequireSuccessfulDump", value)} />
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
}: {
  sourceItem: CatalogItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-3xl">
        <SheetHeader className="border-b pr-12">
          <div className="flex items-start gap-3">
            <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted">
              {sourceItem?.defaultImage ? <img src={sourceItem.defaultImage} alt="" className="max-h-full max-w-full object-contain" /> : <Boxes className="size-5 text-muted-foreground" />}
            </div>
            <div className="min-w-0">
              <SheetTitle className="truncate">{sku || "Product"}</SheetTitle>
              <SheetDescription className="line-clamp-2">{product?.title || sourceItem?.title || "Source catalog product"}</SheetDescription>
            </div>
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
                <TabsTrigger value="commerce">Commerce</TabsTrigger>
                <TabsTrigger value="shipping">Shipping</TabsTrigger>
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
      </SheetContent>
    </Sheet>
  )
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

function MainCatalogPage({ inventoryOnly = false }: { inventoryOnly?: boolean }) {
  const [query, setQuery] = useState("")
  const [rows, setRows] = useState<ProductItem[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<CatalogItem | null>(null)

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ q: query, page: "1", limit: "100" })
      const result = await api<{ inventory?: ProductItem[] }>(`/api/inventory?${params}`)
      setRows(result.inventory || [])
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load main catalog products.") } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])
  const title = inventoryOnly ? "Inventory" : "Products"
  const description = inventoryOnly ? "Main catalog stock, replenishable overrides, and channel inventory state." : "Products already promoted into the main catalog and ready for SKU-level management."
  return <div className="grid gap-5"><PageHeader eyebrow="Catalog" title={title} description={description} action={<Button variant="outline" onClick={load} disabled={loading}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh</Button>} /><Card><CardHeader className="border-b"><div className="flex flex-wrap gap-2"><div className="relative"><Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" /><Input className="w-[380px] max-w-[70vw] pl-8" placeholder="Search main catalog" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") load() }} /></div><Button onClick={load} disabled={loading}>Search</Button></div></CardHeader><CardContent className="p-4">{loading ? <div className="grid gap-2"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div> : <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Product</TableHead><TableHead>Supplier</TableHead><TableHead>Category</TableHead><TableHead>Stock</TableHead><TableHead>Price</TableHead><TableHead>Shopify</TableHead><TableHead /></TableRow></TableHeader><TableBody>{rows.map((item) => <TableRow key={item.sku}><TableCell className="font-medium">{item.sku}</TableCell><TableCell className="max-w-80"><p className="truncate">{item.title || "Untitled"}</p></TableCell><TableCell>{item.supplier || item.vendor || "-"}</TableCell><TableCell className="max-w-64"><p className="truncate">{item.mainCategory || item.category || "Uncategorized"}</p></TableCell><TableCell>{numberLabel(item.qty ?? item.stockQty)}</TableCell><TableCell>{moneyLabel(item.websitePrice ?? item.price)}</TableCell><TableCell><Badge variant={item.shopifyId ? "default" : "outline"}>{item.shopifyId ? (item.shopifyPublished ? "Live" : "Linked") : "Not linked"}</Badge></TableCell><TableCell><Button size="icon" variant="ghost" onClick={() => setSelected(item)} title="Open SKU"><MoreHorizontal className="size-4" /></Button></TableCell></TableRow>)}{!rows.length && <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground">No main catalog products found.</TableCell></TableRow>}</TableBody></Table></div>}</CardContent></Card><ProductDetailSheet sourceItem={selected} open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null) }} /></div>
}

function CatalogTemplatesPage() {
  const templates = [["SKU category import", "/api/categories/templates/sku-categories.csv", "Assign main categories to specific SKUs."], ["Category mapping import", "/api/categories/templates/category-mapping.csv", "Map category structures to sales channels."], ["SKU changes export", "/api/catalog/changes.csv", "Export tracked source catalog changes."], ["Closeouts export", "/api/catalog/closeouts.csv", "Review supplier closeout and discontinued SKUs."]]
  return <div className="grid gap-5"><PageHeader eyebrow="Catalog" title="Templates" description="Download structured templates for category maintenance and catalog review." /><div className="grid gap-3 sm:grid-cols-2">{templates.map(([title, href, description]) => <Card key={href}><CardHeader><CardTitle className="text-sm">{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent><Button variant="outline" size="sm" asChild><a href={href}><FileDown className="size-4" /> Download CSV</a></Button></CardContent></Card>)}</div></div>
}

function CatalogPage() {
  const [tab, setTab] = useState<CatalogWorkspaceTab>(catalogWorkspaceTabFromPath)
  const selectTab = (next: string) => {
    const selected = next as CatalogWorkspaceTab
    setTab(selected)
    const paths: Record<CatalogWorkspaceTab, string> = { products: "/products", source: "/source-catalog", review: "/import-review", changes: "/sku-changes", categories: "/categories", mappings: "/vendor-category-mappings", attributes: "/attributes", groups: "/groups", inventory: "/inventory", templates: "/templates", readiness: "/readiness" }
    window.history.replaceState({}, "", paths[selected])
  }
  return <div className="grid gap-5"><Tabs value={tab} onValueChange={selectTab}><div className="overflow-x-auto rounded-md border bg-card p-1"><TabsList className="h-auto min-w-max justify-start bg-transparent p-0">{catalogWorkspaceTabs.map((item) => <TabsTrigger key={item.id} value={item.id} className="text-xs">{item.label}</TabsTrigger>)}</TabsList></div></Tabs>{tab === "products" && <MainCatalogPage />}{tab === "source" && <SourceCatalogPage />}{tab === "inventory" && <MainCatalogPage inventoryOnly />}{tab === "templates" && <CatalogTemplatesPage />}{(["review", "changes", "categories", "mappings", "attributes", "groups", "readiness"] as CatalogWorkspaceTab[]).includes(tab) && <CatalogResourcePage tab={tab as Exclude<CatalogWorkspaceTab, "products" | "source" | "inventory" | "templates">} />}</div>
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline"><MoreHorizontal className="size-4" /> Actions</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditing(true)}>Edit profile</DropdownMenuItem>
                <DropdownMenuItem onClick={() => window.open(`/legacy/vendors/${encodeURIComponent(vendor.id)}`, "_blank")}>Open legacy vendor</DropdownMenuItem>
                <DropdownMenuItem onClick={() => window.open(`/legacy/vendors/${encodeURIComponent(vendor.id)}?tab=categories`, "_blank")}>Category mappings</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
