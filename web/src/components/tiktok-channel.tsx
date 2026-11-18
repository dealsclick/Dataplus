import { useEffect, useMemo, useState } from "react"
import { BarChart3, Boxes, CheckCircle2, Circle, ExternalLink, History, ListChecks, Loader2, MoreHorizontal, Play, Plus, Radio, RefreshCw, Save, ShieldCheck, Trash2, Webhook } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { dateLabel, moneyLabel, numberLabel } from "@/lib/client-api"

type Json = Record<string, any>

async function request(path: string, body?: Json): Promise<Json> {
  const response = await fetch(`/api/tiktok/${path}`, {
    credentials: "same-origin",
    ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`)
  return data
}

const features = [
  ["tiktokOrdersEnabled", "Orders", "Import and refresh seller orders without changing another channel's checkpoint."],
  ["tiktokOrderScheduleEnabled", "Scheduled orders", "Run order imports in the dedicated TikTok worker lane."],
  ["tiktokReturnsEnabled", "Returns and refunds", "Import reverse orders and map them to order lines."],
  ["tiktokReturnScheduleEnabled", "Scheduled returns", "Reconcile returns on a separate recurring interval."],
  ["tiktokSettlementImportEnabled", "Statements and fees", "Post TikTok statement components to the shared accounting ledger."],
  ["tiktokSettlementScheduleEnabled", "Scheduled statements", "Check for new statements without duplicating prior imports."],
  ["tiktokCatalogEnabled", "Catalog reconciliation", "Download TikTok products and link exact seller SKUs."],
  ["tiktokLiveAnalyticsEnabled", "LIVE analytics", "Import LIVE sessions, sales, traffic, engagement, and product performance."],
  ["tiktokLiveScheduleEnabled", "Scheduled LIVE sync", "Refresh LIVE reporting in its own background job."],
  ["tiktokLiveOrderAttributionEnabled", "LIVE order attribution", "Use approved Affiliate Seller access to mark LIVE and pre-LIVE order lines."],
  ["tiktokMessagesEnabled", "Buyer conversations", "Synchronize conversation metadata for support review."],
  ["tiktokMessageScheduleEnabled", "Scheduled conversations", "Refresh the customer service inbox every configured interval."],
  ["tiktokAnalyticsEnabled", "Commerce analytics", "Import shop, product, SKU, video, and LIVE performance."],
  ["tiktokAnalyticsScheduleEnabled", "Scheduled analytics", "Refresh commerce reporting in the background."],
  ["tiktokAffiliateEnabled", "Affiliate and creators", "Read collaboration, creator, sample, and affiliate-order data when approved."],
  ["tiktokPromotionsEnabled", "Promotions", "Read promotion activities, coupons, and engagement templates."],
  ["tiktokCustomerEngagementEnabled", "Customer engagement", "Enable approved customer engagement tools."],
  ["tiktokLaunchEnabled", "Product launch", "Check and submit eligible unlinked catalog products."],
  ["tiktokInventoryEnabled", "Inventory updates", "Submit only linked SKUs whose computed quantity changed."],
  ["tiktokPriceEnabled", "Price updates", "Submit only linked SKUs whose TikTok price changed."],
  ["tiktokWebhooksEnabled", "Webhooks", "Receive signed order, return, product, inventory, and message events."],
  ["tiktokFulfillmentEnabled", "Fulfillment", "Enable TikTok shipping-service and package workflows."],
  ["tiktokLabelPurchaseEnabled", "TikTok Shipping labels", "Allow an explicit preview and confirmation before package creation."],
] as const

const defaultStart = () => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
const defaultEnd = () => new Date().toISOString().slice(0, 10)
const setupHistoryStart = (mode: string, operationalStartDate: string, customStartDate: string) => {
  if (mode === "none") return ""
  if (mode === "custom") return customStartDate
  const operational = new Date(`${operationalStartDate}T00:00:00Z`)
  if (!Number.isFinite(operational.getTime())) return ""
  if (mode === "year_to_date") return `${operational.getUTCFullYear()}-01-01`
  return new Date(operational.getTime() - 30 * 86_400_000).toISOString().slice(0, 10)
}

export function TikTokChannel({
  channel,
  onSave,
  onRefresh,
}: {
  channel: { id: string; settings?: Json }
  onSave: (id: string, patch: Json) => Promise<void>
  onRefresh?: () => void
}) {
  const [status, setStatus] = useState<Json>({})
  const [statusLoading, setStatusLoading] = useState(true)
  const [liveStatus, setLiveStatus] = useState<Json>({ metrics: {}, sessions: [], analytics: {}, attribution: {} })
  const [liveLoading, setLiveLoading] = useState(false)
  const [workspace, setWorkspace] = useState<Json>({ commerce: [], affiliate: [], promotions: [], engagement: [], webhooks: {} })
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [edits, setEdits] = useState<Json>({})
  const [tab, setTab] = useState("connection")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [job, setJob] = useState<Json | null>(null)
  const [setupRun, setSetupRun] = useState<Json | null>(null)
  const [dateRange, setDateRange] = useState({ startDate: defaultStart(), endDate: defaultEnd() })
  const [historicalBackfill, setHistoricalBackfill] = useState(true)
  const [credentials, setCredentials] = useState({ appKey: "", appSecret: "", serviceId: "" })
  const [skuText, setSkuText] = useState("")
  const [disconnectTarget, setDisconnectTarget] = useState<Json | null>(null)
  const [initialSetup, setInitialSetup] = useState({
    historyMode: "last_30_days",
    customHistoryStartDate: defaultStart(),
    operationalStartDate: defaultEnd(),
    reconcileCatalog: true,
    enableOperationalSync: true,
    configureWebhooks: true,
  })
  const rules = useMemo(() => ({ ...(channel.settings || {}), ...edits }), [channel.settings, edits])

  const refresh = async () => {
    const next = await request("status")
    setStatus(next)
    setCredentials(current => ({ ...current, appKey: next.appKey || "", appSecret: "", serviceId: next.serviceId || "" }))
    return next
  }

  const refreshLive = async () => {
    setLiveLoading(true)
    try {
      const next = await request("live")
      setLiveStatus(next)
      return next
    } finally {
      setLiveLoading(false)
    }
  }

  const refreshWorkspace = async () => {
    setWorkspaceLoading(true)
    try {
      const next = await request("workspace")
      setWorkspace(next)
      return next
    } finally {
      setWorkspaceLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    request("status").then(next => {
      if (!active) return
      setStatus(next)
      setCredentials({ appKey: next.appKey || "", appSecret: "", serviceId: next.serviceId || "" })
    }).catch(reason => active && setError(reason instanceof Error ? reason.message : "TikTok status could not load."))
      .finally(() => active && setStatusLoading(false))
    return () => { active = false }
  }, [channel.id, channel.settings?.tiktokEnvironment])

  useEffect(() => {
    const receiveAuthorization = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type === "dataplus:tiktok-authorized") {
        setError("")
        setMessage(event.data.message || "TikTok Shop connected.")
        void refresh().then(() => onRefresh?.()).catch(reason => setError(reason instanceof Error ? reason.message : "TikTok status could not refresh."))
      }
      if (event.data?.type === "dataplus:tiktok-authorization-error") {
        setMessage("")
        setError(event.data.message || "TikTok Shop authorization failed.")
        void refresh().catch(() => {})
      }
    }
    window.addEventListener("message", receiveAuthorization)
    return () => window.removeEventListener("message", receiveAuthorization)
  }, [channel.id])

  const run = async (action: () => Promise<Json>) => {
    setBusy(true)
    setError("")
    setMessage("")
    try {
      const result = await action()
      setMessage(result.message || "Done.")
      setJob(result.job || null)
      return result
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "TikTok Shop request failed.")
      return null
    } finally {
      setBusy(false)
    }
  }

  const update = (key: string, value: unknown) => setEdits(current => ({ ...current, [key]: value }))
  const saveSettings = async () => {
    await onSave(channel.id, edits)
    setEdits({})
    onRefresh?.()
    await refresh()
    return { message: "TikTok Shop settings saved." }
  }

  const saveCredentials = async () => {
    const environment = rules.tiktokEnvironment === "development" ? "development" : "production"
    const result = await request("credentials", { environment, ...credentials })
    await onSave(channel.id, { tiktokEnvironment: environment })
    setEdits(current => {
      const next = { ...current }
      delete next.tiktokEnvironment
      return next
    })
    onRefresh?.()
    await refresh()
    return result
  }

  const connectSeller = async (accountId = "") => {
    const popup = window.open("", "dataplus-tiktok-auth", "popup,width=860,height=820")
    setBusy(true)
    setError("")
    setMessage("")
    try {
      const environment = rules.tiktokEnvironment === "development" ? "development" : "production"
      await request("credentials", { environment, ...credentials })
      await onSave(channel.id, { ...edits, channelEnabled: true, tiktokEnvironment: environment })
      setEdits({})
      onRefresh?.()
      const returnTo = `${window.location.pathname}${window.location.search}`
      const accountQuery = accountId ? `&accountId=${encodeURIComponent(accountId)}` : ""
      const authPath = `/auth/tiktok/start?environment=${encodeURIComponent(environment)}&returnTo=${encodeURIComponent(returnTo)}${accountQuery}`
      if (popup) popup.location.href = authPath
      else window.location.assign(authPath)
      setMessage("App credentials saved. Complete seller authorization in the TikTok Shop window.")
      await refresh()
    } catch (reason) {
      popup?.close()
      setError(reason instanceof Error ? reason.message : "TikTok Shop connection could not start.")
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    if (rules.channelEnabled !== true) {
      await onSave(channel.id, { channelEnabled: true })
      setEdits(current => ({ ...current, channelEnabled: true }))
    }
    const result = await request("connection/verify", { accountId: status.activeAccountId || "" })
    await refresh()
    onRefresh?.()
    return result
  }

  const startInitialSetup = async () => {
    const importHistory = initialSetup.historyMode !== "none"
    const historyStartDate = setupHistoryStart(initialSetup.historyMode, initialSetup.operationalStartDate, initialSetup.customHistoryStartDate)
    const settingsPatch = {
      ...edits,
      channelEnabled: true,
      tiktokOrdersEnabled: importHistory || initialSetup.enableOperationalSync,
      tiktokOrderScheduleEnabled: initialSetup.enableOperationalSync,
      tiktokCatalogEnabled: initialSetup.reconcileCatalog || rules.tiktokCatalogEnabled === true,
      tiktokWebhooksEnabled: initialSetup.enableOperationalSync && initialSetup.configureWebhooks,
    }
    await onSave(channel.id, settingsPatch)
    setEdits({})
    const result = await request("setup/initial", {
      accountId: status.activeAccountId || "",
      importHistory,
      historyStartDate,
      operationalStartDate: initialSetup.operationalStartDate,
      reconcileCatalog: initialSetup.reconcileCatalog,
      enableOperationalSync: initialSetup.enableOperationalSync,
      configureWebhooks: initialSetup.enableOperationalSync && initialSetup.configureWebhooks,
    })
    setSetupRun(result)
    await refresh()
    onRefresh?.()
    return result
  }

  const queue = async (operation: string, extra: Json = {}) => request(`jobs/${operation}`, {
    accountId: status.activeAccountId || "",
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    historicalBackfill: operation === "orders" && historicalBackfill,
    ...extra,
  })
  const selectedSkus = () => [...new Set(skuText.split(/[\s,]+/).map(value => value.trim()).filter(Boolean))]

  const configured = status.configured === true
  const appConfigured = status.appConfigured === true
  const verified = status.connection?.verified === true
  const accounts = Array.isArray(status.accounts) ? status.accounts : []
  const activeAccount = accounts.find((account: Json) => String(account.id || "") === String(status.activeAccountId || "")) || null
  const activeShopName = activeAccount?.shopName || status.connection?.accountName || "this TikTok shop"
  const onboarding = status.onboarding || activeAccount?.onboarding || null
  const activeJobs = (status.recentJobs || []).filter((row: Json) => String(row.accountId || "") === String(status.activeAccountId || ""))
  const catalogSetupJob = activeJobs.find((row: Json) => row.task === "tiktok-products")
  const historySetupJob = activeJobs.find((row: Json) => row.task === "tiktok-orders" && row.historicalBackfill === true)
  const operationalSetupJob = activeJobs.find((row: Json) => row.task === "tiktok-orders" && row.historicalBackfill !== true)
  const jobCompleted = (row: Json | undefined) => ["success", "warning"].includes(String(row?.status || "").toLowerCase())
  const selectedHistoryStart = setupHistoryStart(initialSetup.historyMode, initialSetup.operationalStartDate, initialSetup.customHistoryStartDate)
  const setupDatesValid = initialSetup.historyMode === "none" || Boolean(selectedHistoryStart && selectedHistoryStart < initialSetup.operationalStartDate)
  const ongoingSyncReady = rules.tiktokOrdersEnabled === true && rules.tiktokOrderScheduleEnabled === true
  const setupStatus = onboarding?.startedAt && ongoingSyncReady ? "Ongoing sync active" : onboarding?.startedAt ? "Setup started" : "Setup needed"
  const setupJobsRunning = activeJobs.some((row: Json) => ["tiktok-products", "tiktok-orders", "tiktok-webhook-setup"].includes(String(row.task || ""))
    && ["queued", "pending", "running", "processing", "stopping"].includes(String(row.status || "").toLowerCase()))
  const dirty = Object.keys(edits).length > 0
  const keysSaved = Boolean(status.appKey) && status.appSecretConfigured === true
  const canSaveCredentials = status.encryptedStorageReady === true
    && Boolean(credentials.appKey.trim())
    && (Boolean(credentials.appSecret.trim()) || status.appSecretConfigured === true)
  const canConnect = canSaveCredentials && Boolean(credentials.serviceId.trim())
  const callbackUrl = typeof window === "undefined" ? "/auth/tiktok/callback" : `${window.location.origin}/auth/tiktok/callback`
  const missingShopScope = /seller\.authorization\.info|Shop Authorized Information/i.test(error)

  useEffect(() => {
    if (!setupJobsRunning) return
    const timer = window.setInterval(() => {
      void refresh().catch(() => {})
    }, 4000)
    return () => window.clearInterval(timer)
  }, [setupJobsRunning, status.activeAccountId])

  const changeTab = (value: string) => {
    setTab(value)
    if (value === "live" && !liveStatus.syncedAt && !liveLoading) void refreshLive().catch(() => {})
    if (["analytics", "webhooks", "fulfillment"].includes(value) && !workspaceLoading) void refreshWorkspace().catch(() => {})
  }

  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 border-b">
        <div className="min-w-0">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">TikTok Shop <Badge variant={rules.channelEnabled ? "default" : "outline"}>{rules.channelEnabled ? "Enabled" : "Disabled"}</Badge></CardTitle>
          <CardDescription className="mt-1">Seller authorization, orders, LIVE commerce, returns, accounting, catalog reconciliation, buyer messages, and TikTok Shipping.</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(refresh)}><RefreshCw className="size-4" /> Refresh</Button>
          <Button size="sm" variant="outline" asChild><a href="/jobs">Jobs</a></Button>
        </div>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4 pt-4">
        {error && <Alert variant="destructive"><AlertTitle>{missingShopScope ? "TikTok API permission required" : "TikTok Shop action failed"}</AlertTitle><AlertDescription>{error}{missingShopScope && <span className="mt-2 block">After TikTok approves or saves the permission, use the seller account Actions menu and choose <strong>Reconnect</strong>. <a className="underline" href="https://partner.tiktokshop.com/docv2/page/6507ead7b99d5302be949ba9" target="_blank" rel="noreferrer">View TikTok's required scope</a>.</span>}</AlertDescription></Alert>}
        {message && <Alert><CheckCircle2 className="size-4" /><AlertTitle>Update</AlertTitle><AlertDescription>{message}</AlertDescription></Alert>}
        {job && <p className="text-sm"><a className="font-medium underline" href="/jobs">Job #{job.jobNumber || job.id}</a> is {job.status}. Progress and row-level evidence are available in Jobs.</p>}
        {setupRun && <Alert>
          <ListChecks className="size-4" />
          <AlertTitle>Shop setup submitted</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{setupRun.message || "The selected setup plan was submitted."}</p>
            {Array.isArray(setupRun.steps) && setupRun.steps.length > 0 && <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">{setupRun.steps.map((step: Json, index: number) => <div key={`${String(step.label || "step")}-${index}`} className="rounded-md border bg-background/60 px-3 py-2">
              <div className="flex items-center justify-between gap-2"><span className="font-medium">{step.label || "Setup step"}</span><Badge variant={step.status === "failed" ? "destructive" : step.status === "already_running" ? "secondary" : "outline"}>{String(step.status || "queued").replaceAll("_", " ")}</Badge></div>
              {step.jobNumber && <a className="mt-1 block underline" href="/jobs">Job #{step.jobNumber}</a>}
            </div>)}</div>}
            {Array.isArray(setupRun.warnings) && setupRun.warnings.length > 0 && <p className="text-amber-700 dark:text-amber-300">{setupRun.warnings.join(" ")}</p>}
          </AlertDescription>
        </Alert>}
        {dirty && <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"><span>Feature changes are not saved yet.</span><div className="flex gap-2"><Button size="sm" disabled={busy} onClick={() => void run(saveSettings)}><Save className="size-4" /> Save</Button><Button size="sm" variant="outline" onClick={() => setEdits({})}>Discard</Button></div></div>}

        <Tabs value={tab} onValueChange={changeTab}>
          <div className="overflow-x-auto"><TabsList className="h-auto min-w-max justify-start"><TabsTrigger value="connection">Connection</TabsTrigger><TabsTrigger value="features">Features</TabsTrigger><TabsTrigger value="sync">Sync</TabsTrigger><TabsTrigger value="catalog">Catalog</TabsTrigger><TabsTrigger value="analytics">Analytics</TabsTrigger><TabsTrigger value="live">LIVE</TabsTrigger><TabsTrigger value="webhooks">Webhooks</TabsTrigger><TabsTrigger value="fulfillment">Shipping</TabsTrigger><TabsTrigger value="capabilities">API access</TabsTrigger></TabsList></div>

          <TabsContent value="connection" className="space-y-4">
            {statusLoading ? <div className="flex items-center gap-3" role="status"><Loader2 className="size-4 animate-spin" /><Skeleton className="h-6 w-72 max-w-full" /><span className="sr-only">Loading connected TikTok shops</span></div> : <div className="flex flex-wrap items-center gap-2"><Badge variant={verified ? "default" : "outline"}>{verified ? "Verified" : configured ? "Authorized - verify connection" : appConfigured ? "App saved - authorization needed" : keysSaved ? "Keys saved - Service ID needed" : "Not configured"}</Badge><span className="text-sm text-muted-foreground">{status.environment || "production"} · {status.shopName || (status.activeAccountId ? "Seller authorized - shop selection pending" : "No seller account")}</span></div>}
            {verified && <section className="overflow-hidden rounded-md border" aria-labelledby="tiktok-initial-setup-heading">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-muted/20 px-4 py-3">
                <div className="min-w-0">
                  <p id="tiktok-initial-setup-heading" className="flex items-center gap-2 text-sm font-medium"><ListChecks className="size-4" /> Finish setup for {activeShopName}</p>
                  <p className="mt-1 max-w-3xl text-xs text-muted-foreground">Connecting a shop does not automatically download every order. Choose what DataPlus should reconcile, where reporting history begins, and the date operational fulfillment should start.</p>
                </div>
                <Badge variant={ongoingSyncReady ? "default" : onboarding?.startedAt ? "secondary" : "outline"}>{setupStatus}</Badge>
              </div>
              <div className="grid border-b sm:grid-cols-2 xl:grid-cols-4">
                {[
                  ["Connection", "Verified", true],
                  ["Catalog matching", catalogSetupJob ? String(catalogSetupJob.status || "Queued") : "Not run", jobCompleted(catalogSetupJob)],
                  ["Historical sales", historySetupJob ? String(historySetupJob.status || "Queued") : onboarding?.importHistory ? "Planned" : "Not run", jobCompleted(historySetupJob)],
                  ["Operational orders", ongoingSyncReady ? "Hourly with checkpoint" : operationalSetupJob ? String(operationalSetupJob.status || "Queued") : "Not started", ongoingSyncReady],
                ].map(([label, value, complete], index) => <div key={String(label)} className={`flex min-w-0 items-start gap-2 px-4 py-3 ${index > 0 ? "border-t sm:border-t-0 sm:border-l" : ""}`}>
                  {complete ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                  <div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className="truncate text-sm font-medium capitalize">{value}</p></div>
                </div>)}
              </div>
              {onboarding?.startedAt && <div className="border-b bg-muted/10 px-4 py-2 text-xs text-muted-foreground">Last submitted {dateLabel(onboarding.startedAt)}. {onboarding.importHistory ? `Historical range ${String(onboarding.historyStartDate || "").slice(0, 10)} through ${String(onboarding.historyEndDate || "").slice(0, 10)}.` : "No historical range selected."} Operational orders begin {String(onboarding.operationalStartDate || "").slice(0, 10)}.</div>}
              <div className="space-y-4 p-4">
                <div className="grid gap-3 lg:grid-cols-3">
                  <label className="flex min-w-0 items-center justify-between gap-4 rounded-md border p-3"><span className="min-w-0"><span className="block text-sm font-medium">Match existing listings</span><span className="block text-xs text-muted-foreground">Download TikTok products and link exact seller SKUs. Unmatched listings remain visible for review.</span></span><Switch checked={initialSetup.reconcileCatalog} onCheckedChange={value => setInitialSetup(current => ({ ...current, reconcileCatalog: value }))} /></label>
                  <label className="grid gap-1.5 text-sm">Historical sales<Select value={initialSetup.historyMode} onValueChange={value => setInitialSetup(current => ({ ...current, historyMode: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="last_30_days">Last 30 days</SelectItem><SelectItem value="year_to_date">Year to date</SelectItem><SelectItem value="custom">Choose a date</SelectItem><SelectItem value="none">Do not import history</SelectItem></SelectContent></Select><span className="text-xs text-muted-foreground">History is reporting-only and never reserves stock or enters fulfillment.</span></label>
                  <label className="grid gap-1.5 text-sm">Operational orders begin<Input type="date" value={initialSetup.operationalStartDate} max={defaultEnd()} onChange={event => setInitialSetup(current => ({ ...current, operationalStartDate: event.target.value }))} /><span className="text-xs text-muted-foreground">Orders updated from this date forward can enter normal fulfillment.</span></label>
                  {initialSetup.historyMode === "custom" && <label className="grid gap-1.5 text-sm">Historical sales begin<Input type="date" value={initialSetup.customHistoryStartDate} max={initialSetup.operationalStartDate} onChange={event => setInitialSetup(current => ({ ...current, customHistoryStartDate: event.target.value }))} /><span className="text-xs text-muted-foreground">The historical range ends before operational orders begin.</span></label>}
                  <label className="flex min-w-0 items-center justify-between gap-4 rounded-md border p-3"><span className="min-w-0"><span className="block text-sm font-medium">Start ongoing order sync</span><span className="block text-xs text-muted-foreground">Run hourly using the last completed per-shop checkpoint with a one-hour overlap.</span></span><Switch checked={initialSetup.enableOperationalSync} onCheckedChange={value => setInitialSetup(current => ({ ...current, enableOperationalSync: value }))} /></label>
                  <label className="flex min-w-0 items-center justify-between gap-4 rounded-md border p-3"><span className="min-w-0"><span className="block text-sm font-medium">Configure webhooks</span><span className="block text-xs text-muted-foreground">Use signed TikTok events as the primary trigger while polling remains the recovery sweep.</span></span><Switch disabled={!initialSetup.enableOperationalSync} checked={initialSetup.enableOperationalSync && initialSetup.configureWebhooks} onCheckedChange={value => setInitialSetup(current => ({ ...current, configureWebhooks: value }))} /></label>
                </div>
                {initialSetup.historyMode !== "none" && <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${setupDatesValid ? "text-muted-foreground" : "border-destructive/50 text-destructive"}`}><History className="mt-0.5 size-4 shrink-0" /><span>{setupDatesValid ? `Reporting history: ${selectedHistoryStart} through the day before ${initialSetup.operationalStartDate}. Operational order handling starts ${initialSetup.operationalStartDate}.` : "Choose a historical start date before the operational order date."}</span></div>}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">Each shop keeps its own setup record, checkpoint, and jobs. Repeating a wider history range checks the same TikTok order IDs and imports only missing history.</p>
                  <Button disabled={busy || setupJobsRunning || !setupDatesValid || (!initialSetup.reconcileCatalog && initialSetup.historyMode === "none" && !initialSetup.enableOperationalSync)} onClick={() => void run(startInitialSetup)}>{busy || setupJobsRunning ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} {setupJobsRunning ? "Setup running" : onboarding?.startedAt ? "Run setup again" : "Start shop setup"}</Button>
                </div>
              </div>
            </section>}
            {!status.encryptedStorageReady && <Alert variant="destructive"><ShieldCheck className="size-4" /><AlertTitle>Credential encryption key required</AlertTitle><AlertDescription>Set <code>DATAPLUS_CREDENTIALS_ENCRYPTION_KEY</code> in the deployment secret store before saving credentials.</AlertDescription></Alert>}
            <section className="rounded-md border" aria-labelledby="tiktok-seller-accounts-heading">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-3">
                <div className="min-w-0">
                  <p id="tiktok-seller-accounts-heading" className="text-sm font-medium">Seller accounts</p>
                  <p className="text-xs text-muted-foreground">{accounts.length ? `${accounts.length} connected · choose which shop DataPlus should use.` : "No TikTok seller account is connected."}</p>
                </div>
                <Button disabled={busy || !canConnect} onClick={() => void connectSeller()}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  {accounts.length ? "Add another TikTok account" : "Add TikTok account"}
                </Button>
              </div>
              {!canConnect && <p className="px-3 py-3 text-xs text-muted-foreground">Save the app key, app secret, and Service ID below before adding a seller account.</p>}
              {accounts.length > 0 && <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Shop</TableHead><TableHead>Region</TableHead><TableHead>Connection</TableHead><TableHead>Token</TableHead><TableHead className="w-14 text-right">Actions</TableHead></TableRow></TableHeader>
                  <TableBody>{accounts.map((account: Json) => {
                    const shops = Array.isArray(account.shops) ? account.shops : []
                    const selectableShops = shops.filter((shop: Json) => Boolean(shop.cipher))
                    const selectedShop = shops.find((shop: Json) => String(shop.id || "") === String(account.shopId || ""))
                    const displayedShop = selectedShop || (shops.length === 1 ? shops[0] : null)
                    const shopName = account.shopName || displayedShop?.name || account.label || "Shop selection needed"
                    const shopId = account.shopId || displayedShop?.id || ""
                    const shopCode = account.shopCode || displayedShop?.code || ""
                    return <TableRow key={account.id}>
                      <TableCell className="min-w-72 align-top">
                        <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{shopName}</span>{account.active && <Badge variant="secondary">Selected</Badge>}</div>
                        {shopId && <p className="mt-1 text-xs text-muted-foreground">Shop ID <span className="font-mono text-foreground">{shopId}</span></p>}
                        {shopCode && <p className="text-xs text-muted-foreground">Shop code <span className="font-mono text-foreground">{shopCode}</span></p>}
                        <p className="max-w-96 truncate text-xs text-muted-foreground">Seller account <span className="font-mono">{account.id}</span></p>
                        {selectableShops.length > 1 && <Select value={selectedShop?.cipher || ""} onValueChange={shopCipher => void run(async () => {
                          await request("shops/select", { accountId: account.id, shopCipher })
                          const result = await request("connection/verify", { accountId: account.id })
                          await refresh()
                          return result
                        })}><SelectTrigger className="mt-2 max-w-md"><SelectValue placeholder="Choose an authorized shop" /></SelectTrigger><SelectContent>{selectableShops.map((shop: Json) => <SelectItem key={shop.cipher} value={shop.cipher}>{shop.name || shop.code || shop.id} · {shop.id || "No shop ID"}</SelectItem>)}</SelectContent></Select>}
                      </TableCell>
                      <TableCell className="align-top">{account.region || displayedShop?.region || "US"}</TableCell>
                      <TableCell className="align-top"><Badge variant={account.verified ? "default" : account.shopSelected ? "outline" : shops.length ? "secondary" : "destructive"}>{account.verified ? "Verified" : account.shopSelected ? "Verify" : shops.length ? "Choose shop" : "Shop needed"}</Badge></TableCell>
                      <TableCell className="whitespace-nowrap align-top text-xs text-muted-foreground">{account.accessTokenExpiresAt ? new Date(account.accessTokenExpiresAt).toLocaleDateString() : "Not available"}</TableCell>
                      <TableCell className="align-top text-right"><DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="ghost" disabled={busy} aria-label={`Actions for ${shopName}`}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{!account.active && <DropdownMenuItem onSelect={() => void run(async () => { const result = await request("accounts/select", { accountId: account.id }); await refresh(); await Promise.all([refreshLive(), refreshWorkspace()]); return result })}>Use account</DropdownMenuItem>}<DropdownMenuItem disabled={!canConnect} onSelect={() => void connectSeller(String(account.id))}><RefreshCw className="size-4" /> Reconnect</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onSelect={() => setDisconnectTarget({ ...account, displayName: shopName })}><Trash2 className="size-4" /> Disconnect</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell>
                    </TableRow>
                  })}</TableBody>
                </Table>
              </div>}
            </section>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Shared TikTok app credentials</p>
                <p className="text-xs text-muted-foreground">The app key, Service ID, and approved API permissions apply to every seller account above. The developer enables permissions in Partner Center; each seller then authorizes or reconnects their shop. The saved app secret is encrypted and never displayed.</p>
              </div>
              <Badge variant="secondary">Shared across seller accounts</Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm">Environment<Select value={String(rules.tiktokEnvironment || "production")} onValueChange={value => update("tiktokEnvironment", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="production">Production</SelectItem><SelectItem value="development">Development shop</SelectItem></SelectContent></Select></label>
              <label className="grid gap-1.5 text-sm">App key<Input autoComplete="off" value={credentials.appKey} onChange={event => setCredentials(current => ({ ...current, appKey: event.target.value }))} /></label>
              <label className="grid gap-1.5 text-sm"><span className="flex items-center gap-2">App secret{status.appSecretConfigured && <Badge variant="outline">Saved securely</Badge>}</span><Input type="password" autoComplete="new-password" value={credentials.appSecret} onChange={event => setCredentials(current => ({ ...current, appSecret: event.target.value }))} placeholder={status.appSecretConfigured ? "Leave blank to keep the saved secret" : "Required"} /></label>
              <label className="grid gap-1.5 text-sm">Service ID<Input autoComplete="off" value={credentials.serviceId} onChange={event => setCredentials(current => ({ ...current, serviceId: event.target.value }))} placeholder="Required for seller authorization" /><span className="text-xs text-muted-foreground">Use the Service ID shown for this app in TikTok Shop Partner Center.</span></label>
              <label className="grid gap-1.5 text-sm">Authorization redirect URL<Input readOnly value={callbackUrl} /><span className="text-xs text-muted-foreground">Add this exact URL to the app configuration in Partner Center.</span></label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy || !canSaveCredentials} onClick={() => void run(saveCredentials)}><Save className="size-4" /> Save app credentials</Button>
              {configured && <Button variant="outline" disabled={busy || dirty} onClick={() => void run(verify)}><ShieldCheck className="size-4" /> Verify connection</Button>}
            </div>
            {status.accessTokenExpiresAt && <p className="text-xs text-muted-foreground">Access token expires {new Date(status.accessTokenExpiresAt).toLocaleString()}. DataPlus securely renews it with the generated refresh token.</p>}
            <a className="inline-flex items-center gap-1 text-sm underline" href="https://partner.tiktokshop.com/docv2/page/authorization-overview" target="_blank" rel="noreferrer">TikTok Shop authorization guide <ExternalLink className="size-3.5" /></a>
          </TabsContent>

          <TabsContent value="features" className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex min-w-0 items-center justify-between gap-4 rounded-md border p-3"><span><span className="block text-sm font-medium">Enable TikTok Shop</span><span className="block text-xs text-muted-foreground">Master switch for every TikTok operation.</span></span><Switch checked={rules.channelEnabled === true} onCheckedChange={value => update("channelEnabled", value)} /></label>
              {features.map(([key, label, description]) => <label key={key} className="flex min-w-0 items-center justify-between gap-4 rounded-md border p-3"><span className="min-w-0"><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-muted-foreground">{description}</span></span><Switch checked={rules[key] === true} onCheckedChange={value => update(key, value)} /></label>)}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="grid gap-1.5 text-sm">Order interval (hours)<Input type="number" min="1" max="24" value={rules.tiktokOrderScheduleHours ?? 1} onChange={event => update("tiktokOrderScheduleHours", Number(event.target.value))} /></label>
              <label className="grid gap-1.5 text-sm">Return interval (hours)<Input type="number" min="1" max="24" value={rules.tiktokReturnScheduleHours ?? 2} onChange={event => update("tiktokReturnScheduleHours", Number(event.target.value))} /></label>
              <label className="grid gap-1.5 text-sm">Statement interval (hours)<Input type="number" min="1" max="24" value={rules.tiktokSettlementScheduleHours ?? 24} onChange={event => update("tiktokSettlementScheduleHours", Number(event.target.value))} /></label>
              <label className="grid gap-1.5 text-sm">LIVE interval (hours)<Input type="number" min="1" max="24" value={rules.tiktokLiveScheduleHours ?? 24} onChange={event => update("tiktokLiveScheduleHours", Number(event.target.value))} /></label>
              <label className="grid gap-1.5 text-sm">Message interval (hours)<Input type="number" min="1" max="24" value={rules.tiktokMessageScheduleHours ?? 1} onChange={event => update("tiktokMessageScheduleHours", Number(event.target.value))} /></label>
              <label className="grid gap-1.5 text-sm">Analytics interval (hours)<Input type="number" min="1" max="24" value={rules.tiktokAnalyticsScheduleHours ?? 24} onChange={event => update("tiktokAnalyticsScheduleHours", Number(event.target.value))} /></label>
            </div>
          </TabsContent>

          <TabsContent value="sync" className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-sm">From<Input type="date" value={dateRange.startDate} max={dateRange.endDate} onChange={event => setDateRange(current => ({ ...current, startDate: event.target.value }))} /></label><label className="grid gap-1.5 text-sm">Through<Input type="date" value={dateRange.endDate} min={dateRange.startDate} onChange={event => setDateRange(current => ({ ...current, endDate: event.target.value }))} /></label></div>
            <label className="flex max-w-2xl items-center justify-between gap-4 rounded-md border p-3"><span className="min-w-0"><span className="block text-sm font-medium">Historical order backfill</span><span className="block text-xs text-muted-foreground">New orders in this manual range are saved for reporting only. They will not route fulfillment, reserve inventory, create purchase demand, or buy labels.</span></span><Switch checked={historicalBackfill} onCheckedChange={setHistoricalBackfill} /></label>
            <div className="flex flex-wrap gap-2"><Button disabled={busy || !verified || rules.tiktokOrdersEnabled !== true} onClick={() => void run(() => queue("orders"))}><Play className="size-4" /> Import orders</Button><Button variant="outline" disabled={busy || !verified || rules.tiktokReturnsEnabled !== true} onClick={() => void run(() => queue("returns"))}>Import returns</Button><Button variant="outline" disabled={busy || !verified || rules.tiktokSettlementImportEnabled !== true} onClick={() => void run(() => queue("settlements"))}>Import statements</Button><Button variant="outline" disabled={busy || !verified || rules.tiktokCatalogEnabled !== true} onClick={() => void run(() => queue("products"))}>Reconcile products</Button><Button variant="outline" disabled={busy || !verified || rules.tiktokMessagesEnabled !== true} onClick={() => void run(() => queue("messages"))}>Sync conversations</Button><Button variant="outline" disabled={busy || !verified || rules.tiktokCatalogEnabled !== true} onClick={() => void run(() => queue("commerce"))}>Sync commerce setup</Button></div>
            <p className="text-xs text-muted-foreground">Scheduled order sync remains operational. Historical imports skip existing orders and are marked as non-operational.</p>
            <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Job</TableHead><TableHead>Shop</TableHead><TableHead>Operation</TableHead><TableHead>Status</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader><TableBody>{(status.recentJobs || []).map((row: Json) => <TableRow key={row.id}><TableCell><a className="underline" href="/jobs">#{row.jobNumber || row.id}</a></TableCell><TableCell>{row.accountName || "Legacy account"}</TableCell><TableCell>{row.operation}</TableCell><TableCell><Badge variant={row.status === "success" ? "default" : row.status === "failed" ? "destructive" : "outline"}>{row.status}</Badge></TableCell><TableCell className="whitespace-nowrap text-muted-foreground">{row.at ? new Date(row.at).toLocaleString() : "-"}</TableCell></TableRow>)}{!status.recentJobs?.length && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No TikTok jobs yet.</TableCell></TableRow>}</TableBody></Table></div>
          </TabsContent>

          <TabsContent value="catalog" className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <label className="grid gap-1.5 text-sm sm:col-span-2">Default TikTok warehouse ID<Input value={rules.tiktokWarehouseId || ""} onChange={event => update("tiktokWarehouseId", event.target.value)} /></label>
              <label className="grid gap-1.5 text-sm sm:col-span-2">Shipping template ID<Input value={rules.tiktokShippingTemplateId || ""} onChange={event => update("tiktokShippingTemplateId", event.target.value)} /></label>
              <label className="grid gap-1.5 text-sm">Safety quantity<Input type="number" min="0" value={rules.tiktokInventorySafetyQty ?? 0} onChange={event => update("tiktokInventorySafetyQty", Number(event.target.value))} /></label>
              <label className="grid gap-1.5 text-sm">Currency<Select value={rules.tiktokCurrency || "USD"} onValueChange={value => update("tiktokCurrency", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="USD">USD</SelectItem></SelectContent></Select></label>
            </div>
            <label className="grid gap-1.5 text-sm">SKUs<Textarea className="min-h-24 font-mono text-xs" value={skuText} onChange={event => setSkuText(event.target.value)} placeholder="Enter SKUs separated by spaces, commas, or new lines. Leave blank to use the bounded job selection." /></label>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || !verified || rules.tiktokLaunchEnabled !== true} onClick={() => void run(() => queue("launch", { skus: selectedSkus() }))}><Boxes className="size-4" /> Launch eligible products</Button>
              <Button variant="outline" disabled={busy || !verified || rules.tiktokInventoryEnabled !== true} onClick={() => void run(() => queue("inventory", { skus: selectedSkus() }))}>Update changed inventory</Button>
              <Button variant="outline" disabled={busy || !verified || rules.tiktokPriceEnabled !== true} onClick={() => void run(() => queue("price", { skus: selectedSkus() }))}>Update changed prices</Button>
            </div>
            <Alert><ShieldCheck className="size-4" /><AlertTitle>Launch validates each SKU</AlertTitle><AlertDescription>Eligible products are submitted independently. Existing linked products are skipped, and every missing field or TikTok rejection is retained in the job artifact for correction.</AlertDescription></Alert>
          </TabsContent>

          <TabsContent value="analytics" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium">Commerce, affiliate, and promotion data</p><p className="text-xs text-muted-foreground">Each optional TikTok scope is checked independently so one unavailable API does not stop the others.</p></div><Button size="sm" variant="outline" disabled={workspaceLoading} onClick={() => void run(refreshWorkspace)}>{workspaceLoading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh results</Button></div>
            <div className="flex flex-wrap gap-2"><Button disabled={busy || !verified || rules.tiktokAnalyticsEnabled !== true} onClick={() => void run(() => queue("analytics"))}><BarChart3 className="size-4" /> Sync analytics</Button><Button variant="outline" disabled={busy || !verified || rules.tiktokAffiliateEnabled !== true} onClick={() => void run(() => queue("affiliate"))}>Sync affiliate data</Button><Button variant="outline" disabled={busy || !verified || rules.tiktokPromotionsEnabled !== true} onClick={() => void run(() => queue("promotions"))}>Sync promotions</Button><Button variant="outline" disabled={busy || !verified || rules.tiktokCustomerEngagementEnabled !== true} onClick={() => void run(() => queue("engagement"))}>Sync engagement setup</Button></div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {[["Analytics responses", workspace.analytics?.snapshots?.length], ["Commerce sources", workspace.commerce?.length], ["Affiliate sources", workspace.affiliate?.length], ["Promotion sources", workspace.promotions?.length], ["Engagement sources", workspace.engagement?.length]].map(([label, value]) => <div key={String(label)} className="rounded-md border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold">{numberLabel(Number(value || 0))}</p></div>)}
            </div>
            <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Source</TableHead><TableHead>Area</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader><TableBody>{([...(workspace.commerce || []).map((row: Json) => ({ ...row, area: "Commerce" })), ...(workspace.affiliate || []).map((row: Json) => ({ ...row, area: "Affiliate" })), ...(workspace.promotions || []).map((row: Json) => ({ ...row, area: "Promotions" })), ...(workspace.engagement || []).map((row: Json) => ({ ...row, area: "Engagement" }))]).map((row: Json) => <TableRow key={row.key}><TableCell className="font-medium">{String(row.key || "").split(".").pop()?.replaceAll("-", " ")}</TableCell><TableCell>{row.area}</TableCell><TableCell className="whitespace-nowrap text-muted-foreground">{row.updatedAt ? dateLabel(String(row.updatedAt)) : "-"}</TableCell></TableRow>)}{!(workspace.commerce?.length || workspace.affiliate?.length || workspace.promotions?.length || workspace.engagement?.length) && <TableRow><TableCell colSpan={3} className="h-24 text-center text-muted-foreground">Run a sync to load available TikTok data.</TableCell></TableRow>}</TableBody></Table></div>
          </TabsContent>

          <TabsContent value="live" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><p className="text-sm font-medium">TikTok Shop LIVE</p><p className="text-xs text-muted-foreground">Session analytics and order attribution use separate TikTok scopes and report their access independently.</p></div>
              <div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy || liveLoading} onClick={() => void run(refreshLive)}>{liveLoading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh</Button><Button size="sm" disabled={busy || !verified || rules.tiktokLiveAnalyticsEnabled !== true} onClick={() => void run(async () => { const result = await queue("live"); await refreshLive(); return result })}><Radio className="size-4" /> Sync LIVE</Button></div>
            </div>
            {liveStatus.analytics?.available === false && <Alert variant="destructive"><AlertTitle>LIVE analytics scope unavailable</AlertTitle><AlertDescription>{liveStatus.analytics?.warning || "Authorize the TikTok Shop Analytics scope, verify the connection, and run the LIVE sync again."}</AlertDescription></Alert>}
            {liveStatus.attribution?.enabled && liveStatus.attribution?.available === false && <Alert><AlertTitle>LIVE order attribution needs approval</AlertTitle><AlertDescription>{liveStatus.attribution?.warning || "TikTok must approve Affiliate API access and the Read Seller Affiliate Collaboration scope. Ordinary TikTok order imports are not affected."}</AlertDescription></Alert>}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
              {[
                ["Sessions", numberLabel(Number(liveStatus.metrics?.sessionCount || 0))],
                ["LIVE GMV", moneyLabel(Number(liveStatus.metrics?.gmv || 0))],
                ["SKU orders", numberLabel(Number(liveStatus.metrics?.skuOrders || 0))],
                ["Items sold", numberLabel(Number(liveStatus.metrics?.itemsSold || 0))],
                ["Views", numberLabel(Number(liveStatus.metrics?.views || 0))],
                ["LIVE orders", numberLabel(Number(liveStatus.attribution?.liveOrders || 0))],
                ["Orders matched", numberLabel(Number(liveStatus.attribution?.matched || 0))],
              ].map(([label, value]) => <div key={label} className="min-w-0 rounded-md border bg-muted/20 px-3 py-2"><p className="truncate text-xs text-muted-foreground">{label}</p><p className="mt-1 truncate text-sm font-semibold">{value}</p></div>)}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>Last synchronized: {liveStatus.syncedAt ? dateLabel(String(liveStatus.syncedAt)) : "Never"}</span><span>Affiliate orders checked: {numberLabel(Number(liveStatus.attribution?.checked || 0))}</span><span>Unmatched LIVE orders: {numberLabel(Number(liveStatus.attribution?.unmatched || 0))}</span></div>
            <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>LIVE session</TableHead><TableHead>Creator</TableHead><TableHead>Started</TableHead><TableHead className="text-right">GMV</TableHead><TableHead className="text-right">SKU orders</TableHead><TableHead className="text-right">Items</TableHead><TableHead className="text-right">Products</TableHead><TableHead className="text-right">Views</TableHead></TableRow></TableHeader><TableBody>{(liveStatus.sessions || []).map((session: Json) => <TableRow key={session.liveId}><TableCell className="min-w-56"><p className="max-w-80 truncate font-medium">{session.title || "Untitled LIVE"}</p><code className="text-xs text-muted-foreground">{session.liveId}</code></TableCell><TableCell><p>{session.creatorUsername || "Not reported"}</p><p className="text-xs text-muted-foreground">{String(session.accountType || "").replaceAll("_", " ")}</p></TableCell><TableCell className="whitespace-nowrap">{session.startTime ? dateLabel(String(session.startTime)) : "-"}</TableCell><TableCell className="text-right">{moneyLabel(Number(session.gmv || 0))}</TableCell><TableCell className="text-right">{numberLabel(Number(session.skuOrders || 0))}</TableCell><TableCell className="text-right">{numberLabel(Number(session.itemsSold || 0))}</TableCell><TableCell className="text-right">{numberLabel(Array.isArray(session.products) ? session.products.length : 0)}</TableCell><TableCell className="text-right">{numberLabel(Number(session.views || 0))}</TableCell></TableRow>)}{!(liveStatus.sessions || []).length && <TableRow><TableCell colSpan={8} className="h-28 text-center text-muted-foreground">{liveLoading ? "Loading LIVE data..." : "No LIVE sessions have been synchronized for this date range."}</TableCell></TableRow>}</TableBody></Table></div>
            <p className="text-xs text-muted-foreground">DataPlus identifies LIVE orders only from TikTok's documented affiliate content type and content ID. It does not infer LIVE sales from SKU text, buyer names, or combined-shipping groups.</p>
          </TabsContent>

          <TabsContent value="webhooks" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium">Signed TikTok events</p><p className="text-xs text-muted-foreground">Events are deduplicated before targeted order, return, product, inventory, or conversation reconciliation.</p></div><div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy || !verified || rules.tiktokWebhooksEnabled !== true} onClick={() => void run(refreshWorkspace)}><RefreshCw className="size-4" /> Refresh</Button><Button size="sm" disabled={busy || !verified || rules.tiktokWebhooksEnabled !== true} onClick={() => void run(async () => { const result = await request("webhooks/setup", {}); await refreshWorkspace(); return result })}><Webhook className="size-4" /> Configure subscriptions</Button></div></div>
            <div className="rounded-md border p-3"><p className="text-xs font-medium text-muted-foreground">Callback URL</p><p className="mt-1 break-all font-mono text-sm">{workspace.webhooks?.callbackUrl || "Load webhook status to view the public callback URL."}</p></div>
            {workspace.webhooks?.warning && <Alert variant="destructive"><AlertTitle>Webhook status needs attention</AlertTitle><AlertDescription>{workspace.webhooks.warning}</AlertDescription></Alert>}
            <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-md border p-3"><p className="text-sm font-medium">Subscribed</p><p className="mt-1 text-2xl font-semibold">{numberLabel(Number(workspace.webhooks?.configuredTopics?.length || 0))}</p></div><div className="rounded-md border p-3"><p className="text-sm font-medium">Missing</p><p className="mt-1 text-2xl font-semibold">{numberLabel(Number(workspace.webhooks?.missingTopics?.length || 0))}</p></div></div>
            <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Event</TableHead><TableHead>Status</TableHead><TableHead>Received</TableHead><TableHead>Reference</TableHead></TableRow></TableHeader><TableBody>{(workspace.webhooks?.recentEvents || []).map((row: Json) => <TableRow key={row.eventId}><TableCell className="font-medium">{row.topic}</TableCell><TableCell><Badge variant={row.state === "failed" ? "destructive" : row.state === "processed" ? "default" : "outline"}>{row.state}</Badge></TableCell><TableCell className="whitespace-nowrap">{row.receivedAt ? dateLabel(String(row.receivedAt)) : "-"}</TableCell><TableCell className="max-w-56 truncate font-mono text-xs">{row.entity?.orderId || row.entity?.returnId || row.entity?.productId || row.entity?.conversationId || row.eventId}</TableCell></TableRow>)}{!workspace.webhooks?.recentEvents?.length && <TableRow><TableCell colSpan={4} className="h-24 text-center text-muted-foreground">No TikTok webhook events received yet.</TableCell></TableRow>}</TableBody></Table></div>
          </TabsContent>

          <TabsContent value="fulfillment" className="space-y-3">
            <Alert><ShieldCheck className="size-4" /><AlertTitle>Reviewed label workflow</AlertTitle><AlertDescription>DataPlus first queries TikTok shipping services, then stores a user-owned 15-minute preview. Package creation requires a separate confirmation, and ambiguous write failures are never replayed automatically.</AlertDescription></Alert>
            <p className="text-sm text-muted-foreground">Shipping service quotes and package documents are available to order fulfillment once TikTok Shipping labels is enabled. Label purchase is not performed by imports, schedules, or catalog jobs.</p>
          </TabsContent>

          <TabsContent value="capabilities" className="space-y-3">
            <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Area</TableHead><TableHead>State</TableHead><TableHead>API</TableHead><TableHead>Notes</TableHead></TableRow></TableHeader><TableBody>{(status.capabilities || []).map((row: Json) => <TableRow key={row.key}><TableCell className="font-medium">{row.label}</TableCell><TableCell><Badge variant={row.state === "ready" ? "default" : "outline"}>{row.state === "ready" ? "Available" : "Guarded foundation"}</Badge></TableCell><TableCell className="whitespace-nowrap text-sm">{row.api}</TableCell><TableCell className="min-w-72 text-sm text-muted-foreground">{row.note || "Available after authorization and its feature gate are enabled."}</TableCell></TableRow>)}</TableBody></Table></div>
          </TabsContent>
        </Tabs>
        <AlertDialog open={Boolean(disconnectTarget)} onOpenChange={open => { if (!open) setDisconnectTarget(null) }}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>Disconnect TikTok account?</AlertDialogTitle><AlertDialogDescription>DataPlus will remove the saved access and refresh tokens for {String(disconnectTarget?.displayName || "this shop")}. Imported orders, jobs, and historical evidence will remain available.</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { const target = disconnectTarget; setDisconnectTarget(null); if (!target) return; void run(async () => { const result = await request("accounts/remove", { accountId: target.id }); await refresh(); await Promise.all([refreshLive(), refreshWorkspace()]); onRefresh?.(); return result }) }}>Disconnect</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}
