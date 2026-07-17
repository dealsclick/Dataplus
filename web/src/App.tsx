import { useEffect, useMemo, useState } from "react"
import {
  Activity,
  Boxes,
  CheckCircle2,
  Database,
  ExternalLink,
  FileWarning,
  History,
  Home,
  Loader2,
  MoreHorizontal,
  PackageSearch,
  RefreshCw,
  Settings,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Truck,
  Warehouse,
} from "lucide-react"
import { Toaster, toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TooltipProvider } from "@/components/ui/tooltip"

type AppView = "overview" | "jobs" | "shopify" | "catalog" | "settings"

type ImportJob = {
  id: string
  section?: string
  operation?: string
  direction?: string
  status?: string
  fileName?: string
  message?: string
  errors?: string[]
  totalRows?: number
  processedRows?: number
  progressPercent?: number
  changed?: number
  missingCount?: number
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

type ChannelConnection = {
  id: string
  name: string
  connected?: boolean
  status?: string
  settings?: Record<string, unknown>
  shopifyConfig?: {
    shop?: string
    apiVersion?: string
    hasAccessToken?: boolean
    hasClientCredentials?: boolean
    configured?: boolean
  }
}

type LiteState = {
  connections?: ChannelConnection[]
  warehouses?: Array<Record<string, unknown>>
}

type ImportJobsResponse = {
  importJobs?: ImportJob[]
  workerStatus?: WorkerStatus
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
  { id: "shopify", label: "Shopify", icon: ShoppingBag },
  { id: "catalog", label: "Catalog", icon: PackageSearch },
  { id: "settings", label: "Settings", icon: Settings },
]

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
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function numberLabel(value?: number) {
  return Number(value || 0).toLocaleString()
}

function jobStatusTone(status?: string) {
  const value = String(status || "").toLowerCase()
  if (value === "failed") return "destructive"
  if (value === "warning" || value === "queued" || value === "running") return "secondary"
  if (value === "stopped") return "outline"
  return "default"
}

function jobProgress(job: ImportJob) {
  if (["success", "warning"].includes(String(job.status || "").toLowerCase())) return 100
  if (Number(job.progressPercent || 0) > 0) return Math.max(0, Math.min(100, Number(job.progressPercent)))
  if (Number(job.totalRows || 0) > 0) {
    return Math.round((Number(job.processedRows || 0) / Number(job.totalRows || 1)) * 100)
  }
  return 0
}

function isShopifyInventoryJob(job: ImportJob) {
  return `${job.operation || ""} ${job.fileName || ""} ${job.workerTask || ""}`.toLowerCase().includes("shopify")
    && `${job.operation || ""} ${job.fileName || ""} ${job.workerTask || ""}`.toLowerCase().includes("inventory")
}

function isAttentionJob(job: ImportJob) {
  return ["failed", "warning", "stopped"].includes(String(job.status || "").toLowerCase())
}

function App() {
  const [view, setView] = useState<AppView>("overview")
  const [state, setState] = useState<LiteState>({})
  const [jobs, setJobs] = useState<ImportJob[]>([])
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus>({})
  const [loading, setLoading] = useState(true)
  const [checkingShopify, setCheckingShopify] = useState(false)
  const [shopifyAuth, setShopifyAuth] = useState<ShopifyAuthCheck | null>(null)
  const [selectedJobId, setSelectedJobId] = useState<string>("")

  async function refreshData({ quiet = false } = {}) {
    if (!quiet) setLoading(true)
    try {
      const [nextState, jobResponse] = await Promise.all([
        api<LiteState>("/api/state?lite=1"),
        api<ImportJobsResponse>("/api/import-jobs"),
      ])
      setState(nextState)
      setJobs(jobResponse.importJobs || [])
      setWorkerStatus(jobResponse.workerStatus || {})
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load DataPlus.")
    } finally {
      setLoading(false)
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

  useEffect(() => {
    refreshData()
    const timer = window.setInterval(() => refreshData({ quiet: true }), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const shopify = useMemo(
    () => (state.connections || []).find((connection) => connection.name?.toLowerCase() === "shopify"),
    [state.connections],
  )
  const activeJobs = jobs.filter((job) => ["queued", "running"].includes(String(job.status || "").toLowerCase()))
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
                  onClick={() => setView(item.id)}
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
                <h1 className="text-xl font-semibold tracking-tight">DataPlus React Console</h1>
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
                    shopifyAuth={shopifyAuth}
                    onOpenJobs={() => setView("jobs")}
                    onOpenShopify={() => setView("shopify")}
                  />
                )}
                {view === "jobs" && (
                  <JobsPage
                    jobs={jobs}
                    attentionJobs={attentionJobs}
                    selectedJob={selectedJob}
                    onSelectJob={(job) => setSelectedJobId(job.id)}
                    onOpenLegacy={(job) => window.open(`/legacy/jobs?job=${encodeURIComponent(job.id)}`, "_blank")}
                  />
                )}
                {view === "shopify" && (
                  <ShopifyPage
                    shopify={shopify}
                    jobs={shopifyInventoryJobs}
                    auth={shopifyAuth}
                    checking={checkingShopify}
                    onCheck={checkShopifyConnection}
                    onRefreshToken={refreshShopifyToken}
                  />
                )}
                {view === "catalog" && <MigrationPlaceholder title="Catalog" oldPath="/legacy/products" icon={Boxes} />}
                {view === "settings" && <SettingsPage />}
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
  shopifyAuth,
  onOpenJobs,
  onOpenShopify,
}: {
  jobs: ImportJob[]
  activeJobs: ImportJob[]
  attentionJobs: ImportJob[]
  shopify?: ChannelConnection
  shopifyAuth: ShopifyAuthCheck | null
  onOpenJobs: () => void
  onOpenShopify: () => void
}) {
  const failedJobs = attentionJobs.filter((job) => String(job.status).toLowerCase() === "failed")
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
        <MetricCard label="Needs attention" value={attentionJobs.length} icon={FileWarning} />
        <MetricCard label="Shopify" value={shopify?.shopifyConfig?.configured ? "Connected" : "Review"} icon={ShoppingBag} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>What to do next</CardTitle>
              <CardDescription>Plain-English priorities from the current system state.</CardDescription>
            </div>
            <Button onClick={onOpenJobs}>Open jobs</Button>
          </CardHeader>
          <CardContent className="grid gap-3">
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
            <CardDescription>Admin API health for inventory and product updates.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="flex items-center gap-2">
              {shopifyAuth?.ok ? <CheckCircle2 className="size-5 text-emerald-600" /> : <ShieldCheck className="size-5 text-muted-foreground" />}
              <div>
                <p className="text-sm font-semibold">{shopifyAuth?.message || "Connection has not been checked in React yet."}</p>
                <p className="text-xs text-muted-foreground">
                  Store: {shopify?.shopifyConfig?.shop || shopifyAuth?.shop?.myshopifyDomain || "Missing"}
                </p>
              </div>
            </div>
            <Button variant="outline" onClick={onOpenShopify}>
              Open Shopify setup
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
  attentionJobs,
  selectedJob,
  onSelectJob,
  onOpenLegacy,
}: {
  jobs: ImportJob[]
  attentionJobs: ImportJob[]
  selectedJob?: ImportJob
  onSelectJob: (job: ImportJob) => void
  onOpenLegacy: (job: ImportJob) => void
}) {
  const [pageSize, setPageSize] = useState(10)
  const [page, setPage] = useState(1)
  const visibleJobs = jobs.slice((page - 1) * pageSize, page * pageSize)
  const totalPages = Math.max(1, Math.ceil(jobs.length / pageSize))

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Job History</h2>
          <p className="text-sm text-muted-foreground">
            {numberLabel(jobs.length)} jobs, {numberLabel(attentionJobs.length)} need attention.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {[10, 25, 50, 100].map((size) => (
            <Button
              key={size}
              size="sm"
              variant={pageSize === size ? "default" : "outline"}
              onClick={() => {
                setPageSize(size)
                setPage(1)
              }}
            >
              {size}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Job</TableHead>
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
                    <TableCell>
                      <p className="font-medium">{job.operation || "Job"}</p>
                      <p className="line-clamp-1 text-xs text-muted-foreground">{job.fileName || job.message || job.id}</p>
                    </TableCell>
                    <TableCell className="min-w-36">
                      <div className="flex items-center gap-2">
                        <Progress value={jobProgress(job)} className="h-1.5" />
                        <span className="w-10 text-xs text-muted-foreground">{jobProgress(job)}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{numberLabel(job.processedRows)} / {numberLabel(job.totalRows)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{dateLabel(job.startedAt || job.createdAt)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{job.workerId || job.workerTask || "n/a"}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" onClick={(event) => event.stopPropagation()}>
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onOpenLegacy(job)}>Open in old UI</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <JobDetail job={selectedJob} />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Page {page} of {totalPages}</p>
        <div className="flex gap-2">
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button>
          <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next</Button>
        </div>
      </div>
    </div>
  )
}

function JobDetail({ job }: { job?: ImportJob }) {
  if (!job) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">Select a job to inspect details.</CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{job.operation || "Job detail"}</CardTitle>
        <CardDescription>{job.id}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <div className="grid grid-cols-2 gap-2">
          <Detail label="Status" value={job.status || "done"} />
          <Detail label="Type" value={job.direction || "sync"} />
          <Detail label="Started" value={dateLabel(job.startedAt || job.createdAt)} />
          <Detail label="Finished" value={dateLabel(job.finishedAt)} />
          <Detail label="Rows" value={numberLabel(job.totalRows)} />
          <Detail label="Processed" value={numberLabel(job.processedRows)} />
        </div>
        {job.message && (
          <div className="rounded-md border bg-muted/45 p-3">
            <p className="font-medium">Status message</p>
            <p className="mt-1 text-muted-foreground">{job.message}</p>
          </div>
        )}
        {!!job.errors?.length && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <p className="font-medium text-destructive">Error preview</p>
            <p className="mt-1 text-muted-foreground">{job.errors[0]}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate font-medium">{value}</p>
    </div>
  )
}

function ShopifyPage({
  shopify,
  jobs,
  auth,
  checking,
  onCheck,
  onRefreshToken,
}: {
  shopify?: ChannelConnection
  jobs: ImportJob[]
  auth: ShopifyAuthCheck | null
  checking: boolean
  onCheck: () => void
  onRefreshToken: () => void
}) {
  const authFailures = jobs.filter(isAttentionJob)
  return (
    <div className="grid gap-5">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Shopify Setup</h2>
        <p className="text-sm text-muted-foreground">Connection health, inventory job status, and migration-safe actions.</p>
      </div>

      <Card className={auth?.ok ? "border-emerald-300" : authFailures.length ? "border-destructive/40" : ""}>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              {auth?.ok ? <CheckCircle2 className="size-5 text-emerald-600" /> : <ShieldCheck className="size-5" />}
              Connection Health
            </CardTitle>
            <CardDescription>
              {auth?.message || "Check whether the current Admin API credentials can create a token and call Shopify."}
            </CardDescription>
          </div>
          <Badge variant={auth?.ok ? "default" : authFailures.length ? "destructive" : "secondary"}>
            {auth?.ok ? "Working" : authFailures.length ? "Review" : "Unchecked"}
          </Badge>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            <Button onClick={onCheck} disabled={checking}>
              {checking ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Check connection
            </Button>
            <Button variant="outline" onClick={onRefreshToken}>Request new token</Button>
            <Button asChild variant="outline">
              <a href={`https://admin.shopify.com/store/${encodeURIComponent((shopify?.shopifyConfig?.shop || "").replace(".myshopify.com", ""))}/settings/apps/development`} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" />
                Shopify app settings
              </a>
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <Detail label="Store" value={shopify?.shopifyConfig?.shop || auth?.shop?.myshopifyDomain || "Missing"} />
            <Detail label="API version" value={shopify?.shopifyConfig?.apiVersion || "2026-04"} />
            <Detail label="Token source" value={auth?.tokenSource || (shopify?.shopifyConfig?.hasClientCredentials ? "Client credentials" : "Unknown")} />
            <Detail label="read_shipping" value={auth?.hasReadShipping ? "Active" : auth ? "Missing" : "Unchecked"} />
          </div>
          {auth?.scope && <p className="text-xs text-muted-foreground">Scopes: {auth.scope}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Shopify inventory jobs</CardTitle>
          <CardDescription>Use this to separate old failed jobs from current connection status.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {jobs.slice(0, 8).map((job) => (
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
    </div>
  )
}

function SettingsPage() {
  return (
    <div className="grid gap-5">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Settings</h2>
        <p className="text-sm text-muted-foreground">The React settings surface will use compact tabs and annotated settings sections.</p>
      </div>
      <Tabs defaultValue="operations">
        <TabsList>
          <TabsTrigger value="operations">Operations</TabsTrigger>
          <TabsTrigger value="channels">Channels</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
        </TabsList>
        <TabsContent value="operations">
          <MigrationPlaceholder title="Operations Settings" oldPath="/legacy/settings/operations" icon={SlidersHorizontal} />
        </TabsContent>
        <TabsContent value="channels">
          <MigrationPlaceholder title="Channel Settings" oldPath="/legacy/channels" icon={Truck} />
        </TabsContent>
        <TabsContent value="users">
          <MigrationPlaceholder title="User Profiles" oldPath="/legacy/settings" icon={Warehouse} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function MigrationPlaceholder({
  title,
  oldPath,
  icon: Icon,
}: {
  title: string
  oldPath: string
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-5" />
          {title}
        </CardTitle>
        <CardDescription>This screen is queued for React/shadcn migration.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          The existing workflow is still available while we migrate the screen with shadcn components.
        </p>
        <Button asChild variant="outline">
          <a href={oldPath} target="_blank" rel="noreferrer">
            <ExternalLink className="size-4" />
            Open old screen
          </a>
        </Button>
      </CardContent>
    </Card>
  )
}

export default App
