import { useEffect, useState } from "react"
import { AlertCircle, CalendarDays, ChevronDown, Copy, Eye, FileDown, FileText, FileUp, FileWarning, History, MoreHorizontal, Play, RefreshCw, RotateCcw, Search, Settings, Square, Store, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { JobChannelFeeds } from "./job-channel-feeds"
import { ImportDashboard, ImportProgressSummary } from "./import-dashboard"
import { ContextActions, Detail, Field, HistoryBackButton, MetricCard, PageHeader } from "./app-ui"
import { api, dateLabel, numberLabel } from "../lib/client-api"
import {
  JobContextBadges, isActiveJob, isAttentionJob,
  isEbayLaunchPreflight, isWalmartFeedStatusCheck, jobCategory, jobChannelLabel, jobImportMode,
  jobImportModeDescription, jobOperationLabel, jobProgress, jobRunType, jobStatusLabel, jobStatusTone,
  openJobSettings, scheduleDescription,
} from "../App"
import { ChannelLogsPanel, VendorFeedScheduleManager, channelLogStatusLabel } from "./product-workspaces"
import type { ChannelConnection, ChannelLogEntry, ImportJob, SystemSettings, Vendor, VendorFeedSchedule, WorkerStatus } from "../App"

export function JobsPage({
  jobs,
  activeJobs,
  workerStatus,
  channels,
  vendors,
  systemSettings,
  totalJobs,
  page,
  pageSize,
  selectedJob,
  onSelectJob,
  onOpenJobDetail,
  onLoadJobs,
  onStopJob,
  onRetryJob,
  onCleanup,
  onRefresh,
}: {
  jobs: ImportJob[]
  activeJobs: ImportJob[]
  workerStatus: WorkerStatus
  channels: ChannelConnection[]
  vendors: Vendor[]
  systemSettings: SystemSettings
  totalJobs: number
  page: number
  pageSize: number
  selectedJob?: ImportJob
  onSelectJob: (job: ImportJob) => void
  onOpenJobDetail: (job: ImportJob) => void
  onLoadJobs: (next: { page?: number; limit?: number; status?: string; query?: string; runType?: string; channel?: string }) => void
  onStopJob: (job: ImportJob) => void
  onRetryJob: (job: ImportJob) => void
  onCleanup: () => void
  onRefresh: () => void
}) {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("all")
  const [tab, setTab] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get("tab") || "all"
    return ["all", "manual", "automated", "active", "review", "completed", "logs", "scheduled", "imports"].includes(requested) ? requested : "all"
  })
  const [channelFilter, setChannelFilter] = useState("all")
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false)
  const [quickFilterOpen, setQuickFilterOpen] = useState(false)
  const [startedAfter, setStartedAfter] = useState("")
  const [startedBefore, setStartedBefore] = useState("")
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false)
  const [dataSourceFeeds, setDataSourceFeeds] = useState<VendorFeedSchedule[]>([])
  const shopify = channels.find((channel) => String(channel.name || "").toLowerCase() === "shopify")
  const shopifySettings = shopify?.settings || {}
  const ebay = channels.find((channel) => String(channel.name || "").toLowerCase() === "ebay")
  const ebaySettings = ebay?.settings || {}
  const temu = channels.find((channel) => String(channel.name || "").toLowerCase() === "temu")
  const temuSettings = temu?.settings || {}
  const walmartSettings = channels.find(channel => channel.name === 'Walmart')?.settings || {}
  useEffect(() => {
    if (tab !== "scheduled") return
    let cancelled = false
    void api<{ feeds?: VendorFeedSchedule[] }>("/api/data-source-feeds")
      .then((result) => {
        if (!cancelled) setDataSourceFeeds(result.feeds || [])
      })
      .catch(() => {
        if (!cancelled) setDataSourceFeeds([])
      })
    return () => { cancelled = true }
  }, [tab])

  const dataWarehouseScheduleRows = dataSourceFeeds.flatMap((feed) => [
    {
      name: `${feed.name || "DataWarehouse"} refresh`,
      owner: feed.vendorName || "DataWarehouse",
      enabled: Boolean(feed.refreshEnabled ?? feed.enabled),
      timing: scheduleDescription(feed.refreshScheduleType || feed.scheduleType, feed.refreshScheduleTimes || feed.scheduleTimes, feed.refreshScheduleEveryHours || feed.scheduleEveryHours, "02:00"),
      behavior: "Refreshes existing SKUs for changed inventory, pricing, availability, and discontinuation fields.",
      location: "/settings?tab=data-sources",
      managed: true,
    },
    {
      name: `${feed.name || "DataWarehouse"} full import`,
      owner: feed.vendorName || "DataWarehouse",
      enabled: Boolean(feed.fullImportEnabled),
      timing: scheduleDescription(feed.fullImportScheduleType, feed.fullImportScheduleTimes, feed.fullImportScheduleEveryHours, "01:00"),
      behavior: "Discovers new SKUs and applies approved changed source records across the catalog.",
      location: "/settings?tab=data-sources",
      managed: true,
    },
  ])

  const scheduleRows = [
    { name: "Walmart order reconciliation", owner: "Walmart", enabled: walmartSettings.channelEnabled === true && walmartSettings.walmartOrdersEnabled === true && walmartSettings.walmartOrderScheduleEnabled === true && walmartSettings.walmartEnvironment !== 'sandbox', timing: `Every ${Number(walmartSettings.walmartOrderScheduleHours || 1)} hour(s)`, behavior: `Rechecks seller-fulfilled orders created in the last ${Number(walmartSettings.walmartOrderLookbackDays || 30)} days`, location: "/channels?channel=Walmart", managed: true },
    ...dataWarehouseScheduleRows,
    { name: "Shopify inventory update", owner: "Shopify", enabled: Boolean(shopifySettings.inventoryScheduleEnabled), timing: scheduleDescription(shopifySettings.inventoryScheduleType, shopifySettings.inventoryScheduleTimes, shopifySettings.inventoryScheduleEveryHours, "03:00, 13:00"), behavior: String(shopifySettings.inventoryScheduleMode || "dry-run") === "apply" ? "Pushes inventory to Shopify" : "Runs a Shopify inventory dry run", location: "/channels?tab=setup#shopify-schedules", managed: true },
    { name: "Shopify SKU pair audit", owner: "Shopify", enabled: Boolean(shopifySettings.shopifySkuMapScheduleEnabled), timing: `Daily at ${String(shopifySettings.shopifySkuMapScheduleTime || "02:00")}`, behavior: "Checks the Shopify product and variant pair for every mapped SKU", location: "/channels?tab=setup#shopify-schedules", managed: true },
    { name: "Shopify order reconciliation", owner: "Shopify", enabled: Boolean(shopifySettings.shopifyOrderImportEnabled) && Boolean(shopifySettings.shopifyOrderImportScheduleEnabled), timing: scheduleDescription(shopifySettings.shopifyOrderImportScheduleType, shopifySettings.shopifyOrderImportScheduleTimes, shopifySettings.shopifyOrderImportScheduleEveryHours, "04:00, 16:00"), behavior: `Imports allowed sources: ${String(shopifySettings.shopifyOrderImportSources || "Native Shopify sources")}`, location: "/channels?tab=setup#shopify-order-import", managed: true },
    { name: "eBay order import", owner: "eBay", enabled: Boolean(ebaySettings.ebayOrderImportEnabled) && Boolean(ebaySettings.ebayOrderImportScheduleEnabled), timing: scheduleDescription(ebaySettings.ebayOrderImportScheduleType, ebaySettings.ebayOrderImportScheduleTimes, ebaySettings.ebayOrderImportScheduleEveryHours, "05:00, 17:00"), behavior: `Imports up to ${numberLabel(Number(ebaySettings.ebayOrderImportLimit || 250))} changed orders`, location: "/channels?tab=setup", managed: true },
    { name: "eBay offers and live-status sync", owner: "eBay", enabled: ebaySettings.ebayCatalogSyncEnabled !== false && ebaySettings.ebayCatalogSyncScheduleEnabled !== false, timing: scheduleDescription(ebaySettings.ebayCatalogSyncScheduleType, ebaySettings.ebayCatalogSyncScheduleTimes, ebaySettings.ebayCatalogSyncScheduleEveryHours, "02:00"), behavior: "Imports eBay offers and verifies live status from the active-listing feed; only a complete feed can demote missing listings", location: "/channels?tab=setup", managed: true },
    { name: "Temu order import", owner: "Temu", enabled: Boolean(temuSettings.temuOrderImportEnabled) && Boolean(temuSettings.temuOrderImportScheduleEnabled), timing: scheduleDescription(temuSettings.temuOrderImportScheduleType, temuSettings.temuOrderImportScheduleTimes, temuSettings.temuOrderImportScheduleEveryHours, "05:00, 17:00"), behavior: `Imports up to ${numberLabel(Number(temuSettings.temuOrderImportLimit || 250))} changed orders`, location: "/channels?tab=setup", managed: true },
    { name: "Overdue PO reminders", owner: "System", enabled: Boolean(systemSettings.smtpReminderScheduleEnabled), timing: `Daily at ${String(systemSettings.smtpReminderScheduleTime || "08:00")}`, behavior: "Emails enabled supplier reminders for overdue purchase orders", location: "/settings#email-schedule", managed: true },
    { name: "Shopify price sync", owner: "Shopify", enabled: false, timing: "Manual only", behavior: "Pushes approved calculated prices to linked Shopify variants.", location: "/channels?tab=actions", managed: false },
    { name: "Shopify product/status/taxonomy sync", owner: "Shopify", enabled: false, timing: "Manual only", behavior: "Creates products and pushes status or taxonomy changes after review.", location: "/channels?tab=actions", managed: false },
  ]

  const visibleJobs = jobs.filter((job) => {
    const isChannelLog = String(job.direction || job.type || "").toLowerCase().includes("api") || /shopify|ebay|temu|tiktok|walmart|api/i.test(`${job.operation || ""} ${job.fileName || ""}`)
    const normalizedStatus = String(job.status || "").toLowerCase()
    const started = String(job.startedAt || job.createdAt || "").slice(0, 10)
    if (tab === "manual" && jobRunType(job) !== "manual") return false
    if (tab === "automated" && jobRunType(job) !== "automated") return false
    if (tab === "active" && !isActiveJob(job)) return false
    if (tab === "review" && !isAttentionJob(job)) return false
    if (tab === "completed" && !["success", "done", "ok", "warning"].includes(normalizedStatus)) return false
    if (tab === "logs" && !isChannelLog) return false
    if (startedAfter && (!started || started < startedAfter)) return false
    if (startedBefore && (!started || started > startedBefore)) return false
    return true
  })
  const runTypeForTab = (value: string) => value === "manual" || value === "automated" ? value : "all"
  const jobTableTitle = tab === "manual" ? "Manual jobs" : tab === "automated" ? "Automated jobs" : tab === "active" ? "Active jobs" : tab === "review" ? "Jobs needing review" : tab === "completed" ? "Completed jobs" : "All jobs"
  const totalPages = Math.max(1, Math.ceil(totalJobs / pageSize))
  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="Operations"
        title="Jobs"
        description="Manual and automated runs, channel ownership, history, artifacts, and worker health in one workspace."
        action={<ContextActions actions={[
          { id: "refresh", label: "Refresh jobs", description: "Reload current queue, history, and worker state.", icon: <RefreshCw className="size-4" />, onSelect: onRefresh },
          { id: "scheduled", label: "View scheduled work", description: "Open the register of automated jobs and feed schedules.", icon: <CalendarDays className="size-4" />, onSelect: () => setTab("scheduled") },
          { id: "clean-stale", label: "Clean stale records", description: "Remove retention-eligible job artifacts and history.", icon: <Trash2 className="size-4" />, group: "Danger zone", destructive: true, onSelect: () => setCleanupConfirmOpen(true) },
        ]} />}
      />

      {tab !== "imports" && <div className="grid gap-3 lg:grid-cols-4">
        <MetricCard label="Jobs found" value={totalJobs} icon={History} />
        <MetricCard label="Needs review" value={jobs.filter(isAttentionJob).length} icon={AlertCircle} />
        <MetricCard label="Active" value={activeJobs.length} icon={Play} />
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Worker</p>
            <div className="mt-2 flex items-center gap-2">
              <Badge variant={workerStatus.online ? "success" : "secondary"}>{workerStatus.online ? "online" : "idle"}</Badge>
              <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {workerStatus.workers?.length ? workerStatus.workers.map(worker => (
                  <span key={worker.workerId || worker.lane} className="min-w-0 break-words">
                    <strong className="text-foreground">{worker.name || worker.workerId}</strong>
                    {" · "}{worker.lane === "orders" ? "Orders & returns" : worker.lane === "background" ? "Scheduled jobs" : "Manual jobs"}
                    {" · "}{worker.online ? worker.currentTask || "Idle" : "Offline"}
                  </span>
                )) : workerStatus.currentTask || workerStatus.workerId || "No task"}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      }
      <Tabs value={tab} onValueChange={(value) => { setTab(value); window.history.replaceState({}, "", `/jobs?tab=${value}`); onLoadJobs({ page: 1, runType: runTypeForTab(value), channel: channelFilter }) }}>
        <div className="grid gap-3">
          <div className="overflow-x-auto pb-1">
          <TabsList className="w-max">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="manual"><Play className="size-3.5" /> Manual</TabsTrigger>
            <TabsTrigger value="automated"><CalendarDays className="size-3.5" /> Automated</TabsTrigger>
            <TabsTrigger value="active">Active <Badge variant={activeJobs.length ? "info" : "secondary"} className="ml-1 px-1.5 py-0 text-[10px]">{activeJobs.length}</Badge></TabsTrigger>
            <TabsTrigger value="review">Needs review <Badge variant={jobs.filter(isAttentionJob).length ? "destructive" : "secondary"} className="ml-1 px-1.5 py-0 text-[10px]">{jobs.filter(isAttentionJob).length}</Badge></TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
            <TabsTrigger value="logs">Channel logs</TabsTrigger>
            <TabsTrigger value="scheduled">Scheduled</TabsTrigger>
            <TabsTrigger value="imports">Imports</TabsTrigger>
          </TabsList>
          </div>
          {!['logs', 'scheduled', 'imports'].includes(tab) && <div className="flex w-full flex-wrap items-center gap-2">
            <InputGroup className="min-w-0 flex-1 basis-64">
              <InputGroupAddon><Search className="size-4" /></InputGroupAddon>
              <InputGroupInput placeholder="Search jobs, files, messages" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onLoadJobs({ page: 1, query, status }) }} />
            </InputGroup>
            <Button size="sm" variant="outline" onClick={() => onLoadJobs({ page: 1, query, status })}>Search</Button>
            <Popover open={quickFilterOpen} onOpenChange={setQuickFilterOpen}>
              <PopoverTrigger asChild><Button size="sm" variant="outline">Quick filter</Button></PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-0">
                <Command>
                  <CommandInput placeholder="Find a job view..." />
                  <CommandList>
                    <CommandEmpty>No view found.</CommandEmpty>
                    <CommandGroup heading="Job views">
                      <CommandItem onSelect={() => { setTab("all"); onLoadJobs({ page: 1, runType: "all", channel: channelFilter }); setQuickFilterOpen(false) }}>All jobs</CommandItem>
                      <CommandItem onSelect={() => { setTab("manual"); onLoadJobs({ page: 1, runType: "manual", channel: channelFilter }); setQuickFilterOpen(false) }}>Manual jobs</CommandItem>
                      <CommandItem onSelect={() => { setTab("automated"); onLoadJobs({ page: 1, runType: "automated", channel: channelFilter }); setQuickFilterOpen(false) }}>Automated jobs</CommandItem>
                      <CommandItem onSelect={() => { setTab("active"); onLoadJobs({ page: 1, runType: "all", channel: channelFilter }); setQuickFilterOpen(false) }}>Active jobs</CommandItem>
                      <CommandItem onSelect={() => { setTab("review"); setStatus("failed"); onLoadJobs({ page: 1, query, status: "failed", runType: "all", channel: channelFilter }); setQuickFilterOpen(false) }}>Failed jobs</CommandItem>
                      <CommandItem onSelect={() => { setTab("review"); setStatus("warning"); onLoadJobs({ page: 1, query, status: "warning", runType: "all", channel: channelFilter }); setQuickFilterOpen(false) }}>Warnings</CommandItem>
                      <CommandItem onSelect={() => { setTab("logs"); setQuickFilterOpen(false) }}>Channel activity</CommandItem>
                      <CommandItem onSelect={() => { setTab("scheduled"); setQuickFilterOpen(false) }}>Schedules</CommandItem>
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
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
            <Select value={channelFilter} onValueChange={(value) => { setChannelFilter(value); onLoadJobs({ page: 1, query, status, runType: runTypeForTab(tab), channel: value }) }}>
              <SelectTrigger className="w-44"><Store className="size-4" /><SelectValue placeholder="All channels" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All channels</SelectItem>
                <SelectItem value="ebay">eBay</SelectItem>
                <SelectItem value="walmart">Walmart</SelectItem>
                <SelectItem value="shopify">Shopify</SelectItem>
                <SelectItem value="temu">Temu</SelectItem>
                <SelectItem value="tiktok">TikTok Shop</SelectItem>
                <SelectItem value="whatnot">Whatnot</SelectItem>
                <SelectItem value="amazon">Amazon</SelectItem>
                <SelectItem value="internal">Internal</SelectItem>
              </SelectContent>
            </Select>
            <Collapsible open={advancedFiltersOpen} onOpenChange={setAdvancedFiltersOpen}>
              <CollapsibleTrigger asChild><Button size="sm" variant={advancedFiltersOpen || startedAfter || startedBefore ? "secondary" : "outline"}>Date range</Button></CollapsibleTrigger>
              <CollapsibleContent className="absolute right-0 z-20 mt-2 w-[min(30rem,calc(100vw-2rem))] rounded-md border bg-popover p-3 shadow-md">
                <div className="grid gap-3 sm:grid-cols-2"><Field label="Started on or after"><Input type="date" value={startedAfter} onChange={(event) => setStartedAfter(event.target.value)} /></Field><Field label="Started on or before"><Input type="date" value={startedBefore} onChange={(event) => setStartedBefore(event.target.value)} /></Field></div>
                <div className="mt-3 flex justify-end"><Button size="sm" variant="ghost" onClick={() => { setStartedAfter(""); setStartedBefore("") }}>Clear dates</Button></div>
              </CollapsibleContent>
            </Collapsible>
          </div>}
        </div>

        <TabsContent value="logs" className="mt-4">
          <ChannelLogsPanel />
        </TabsContent>
        <TabsContent value="imports" className="mt-4"><ImportDashboard /></TabsContent>

        <TabsContent value="scheduled" className="mt-4">
          <div className="mb-4"><VendorFeedScheduleManager vendors={[]} dataSource jobs={jobs} onSelectJob={onSelectJob} /></div>
          <div className="mb-4"><VendorFeedScheduleManager vendors={vendors} jobs={jobs} onSelectJob={onSelectJob} /></div>
          <Card>
            <CardHeader className="border-b py-3"><CardTitle className="text-base">Scheduled task register</CardTitle><CardDescription>One place to see every automated workflow, including manual-only jobs that are not yet scheduled.</CardDescription></CardHeader>
            <CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Task</TableHead><TableHead>Owner</TableHead><TableHead>Schedule</TableHead><TableHead>Behavior</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader><TableBody>{scheduleRows.map((schedule) => <TableRow key={schedule.name}><TableCell className="font-medium">{schedule.name}</TableCell><TableCell>{schedule.owner}</TableCell><TableCell>{schedule.timing}</TableCell><TableCell className="max-w-96 text-sm text-muted-foreground">{schedule.behavior}</TableCell><TableCell><Badge variant={schedule.enabled ? "default" : "outline"}>{schedule.enabled ? "Enabled" : schedule.managed ? "Disabled" : "Manual"}</Badge></TableCell><TableCell><Button asChild size="sm" variant="outline"><a href={schedule.location}>Open {schedule.managed ? "setting" : "job"}</a></Button></TableCell></TableRow>)}</TableBody></Table></div></CardContent>
          </Card>
        </TabsContent>

        {!['logs', 'scheduled', 'imports'].includes(tab) && <div className="mt-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <Card>
              <CardHeader className="border-b py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{jobTableTitle}</CardTitle>
                    <CardDescription>{totalJobs ? `${numberLabel(visibleJobs.length)} shown on this page · ${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, totalJobs)} of ${numberLabel(totalJobs)} jobs` : "No jobs found"}</CardDescription>
                  </div>
                  <ButtonGroup>
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
                  </ButtonGroup>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y md:hidden">
                  {visibleJobs.map((job) => (
                    <button key={job.id} type="button" className="grid w-full gap-3 p-4 text-left hover:bg-muted/45" onClick={() => onOpenJobDetail(job)}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold">{jobReference(job)}</p>
                          <p className="break-words text-sm">{jobOperationLabel(job)}</p>
                          <JobContextBadges job={job} />
                        </div>
                        <Badge variant={jobStatusTone(job.status)}>{jobStatusLabel(job.status)}</Badge>
                      </div>
                      <p className="break-words text-xs text-muted-foreground">{job.message || job.fileName || "No job message recorded."}</p>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                        <span className="text-muted-foreground">Category</span><span className="text-right">{jobCategory(job)}</span>
                        <span className="text-muted-foreground">Channel</span><span className="text-right">{jobChannelLabel(job)}</span>
                        <span className="text-muted-foreground">Started by</span><span className="text-right">{jobRunType(job) === "automated" ? "Automation" : "User"}</span>
                        <span className="text-muted-foreground">Rows</span><span className="text-right">{numberLabel(job.processedRows)} / {numberLabel(job.totalRows)}</span>
                        <span className="text-muted-foreground">Started</span><span className="text-right">{dateLabel(job.startedAt || job.createdAt)}</span>
                      </div>
                      <div className="flex items-center gap-2"><Progress value={jobProgress(job)} className="h-1.5" /><span className="w-10 text-right text-xs text-muted-foreground">{jobProgress(job)}%</span></div>
                    </button>
                  ))}
                  {!visibleJobs.length && <div className="p-8 text-center text-sm text-muted-foreground">No jobs match these filters.</div>}
                </div>
                <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Job</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Started by</TableHead>
                      <TableHead>Channel</TableHead>
                      <TableHead>Progress</TableHead>
                      <TableHead>Rows</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead>Worker</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleJobs.map((job) => (
                      <TableRow key={job.id}>
                        <TableCell><HoverCard><HoverCardTrigger asChild><Badge variant={jobStatusTone(job.status)}>{jobStatusLabel(job.status)}</Badge></HoverCardTrigger><HoverCardContent className="w-72"><p className="font-medium">{jobStatusLabel(job.status)}</p><p className="mt-1 text-xs text-muted-foreground">{job.message || job.details || "No additional status detail was recorded."}</p></HoverCardContent></HoverCard></TableCell>
                        <TableCell className="max-w-[360px]">
                          <div className="flex min-w-0 items-center gap-2">
                            <button type="button" className="min-w-0 truncate text-left font-medium hover:underline" onClick={() => onSelectJob(job)} title={`Open ${jobReference(job)}`}>{jobOperationLabel(job)}</button>
                            {isWalmartFeedStatusCheck(job) ? <Badge variant="outline" className="shrink-0 text-[10px]">Status only</Badge> : null}
                            {isEbayLaunchPreflight(job) ? <Badge variant="outline" className="shrink-0 text-[10px]">No publish</Badge> : null}
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="truncate font-mono text-[11px] text-muted-foreground">{jobReference(job)}</span>
                            {jobImportMode(job) ? <Badge variant="outline" className="shrink-0 text-[10px]">{jobImportMode(job)}</Badge> : null}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-5 shrink-0"
                              title="Copy internal job ID"
                              onClick={(event) => {
                                event.stopPropagation()
                                void navigator.clipboard.writeText(job.id).then(
                                  () => toast.success("Internal job ID copied."),
                                  () => toast.error("Unable to copy the job ID."),
                                )
                              }}
                            >
                              <Copy className="size-3" />
                            </Button>
                          </div>
                          <p className="truncate text-xs text-muted-foreground">{job.message || job.fileName || "No status update recorded."}</p>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{jobCategory(job)}</TableCell>
                        <TableCell><Badge variant={jobRunType(job) === "automated" ? "info" : "outline"} className="whitespace-nowrap" title={jobRunType(job) === "automated" ? "Started by a schedule, webhook, or system process" : "Started by a user"}>{jobRunType(job) === "automated" ? <CalendarDays className="size-3" /> : <Play className="size-3" />}{jobRunType(job) === "automated" ? "Automation" : "User"}</Badge></TableCell>
                        <TableCell><Badge variant={jobChannelLabel(job) === "Internal" ? "secondary" : "outline"} className="whitespace-nowrap"><Store className="size-3" />{jobChannelLabel(job)}</Badge></TableCell>
                        <TableCell className="min-w-36">
                          <div className="flex items-center gap-2">
                            <Progress value={jobProgress(job)} className="h-1.5" />
                            <span className="w-10 text-xs text-muted-foreground">{jobProgress(job)}%</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{numberLabel(job.processedRows)} / {numberLabel(job.totalRows)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{dateLabel(job.startedAt || job.createdAt)}</TableCell>
                        <TableCell className="max-w-40 truncate text-sm text-muted-foreground" title={job.workerId}>
                          {workerStatus.workers?.find(worker => worker.workerId === job.workerId || (job.workerLane && worker.lane === job.workerLane))?.name || job.workerId || job.workerTask || "n/a"}
                        </TableCell>
                        <TableCell>
                          <JobActionMenu job={job} onStop={onStopJob} onRetry={onRetryJob} onOpenFull={onOpenJobDetail} />
                        </TableCell>
                      </TableRow>
                    ))}
                    {!visibleJobs.length && (
                      <TableRow>
                        <TableCell colSpan={10} className="h-28 text-center text-muted-foreground">No jobs match these filters.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                </div>
              </CardContent>
            </Card>
            <div className="hidden xl:block"><JobDetail job={selectedJob} onRetry={onRetryJob} onStop={onStopJob} onUpdate={onSelectJob} /></div>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Page {page} of {totalPages}</p>
            <div className="flex gap-2">
              <Button variant="outline" disabled={page <= 1} onClick={() => onLoadJobs({ page: Math.max(1, page - 1), query, status })}>Previous</Button>
              <Button variant="outline" disabled={page >= totalPages} onClick={() => onLoadJobs({ page: Math.min(totalPages, page + 1), query, status })}>Next</Button>
            </div>
          </div>
        </div>}
      </Tabs>
      <AlertDialog open={cleanupConfirmOpen} onOpenChange={setCleanupConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Clean stale job records?</AlertDialogTitle><AlertDialogDescription>This removes expired job artifacts and retention-eligible history. Active jobs and their current worker output are not affected.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Keep records</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { onCleanup(); setCleanupConfirmOpen(false) }}>Clean stale records</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function JobActionMenu({ job, onStop, onRetry, onOpenFull }: { job: ImportJob; onStop: (job: ImportJob) => void; onRetry: (job: ImportJob) => void; onOpenFull: (job: ImportJob) => void }) {
  const artifacts = job.artifacts || []
  const hasPrimaryFile = Boolean(job.originalFileName || artifacts.some((artifact) => String(artifact.kind || "") === "original"))
  const hasErrors = Boolean(job.errorFileName || job.errors?.length || artifacts.some((artifact) => String(artifact.kind || "") === "errors"))
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" onClick={(event) => event.stopPropagation()}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onOpenFull(job)}><Eye className="size-4" /> Open full detail</DropdownMenuItem>
        <DropdownMenuItem onClick={() => openJobSettings(job)}><Settings className="size-4" /> Open job settings</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onRetry(job)} disabled={!job.workerTask || job.workerTask === 'pricing-deployment-hold' || isActiveJob(job)}>
          <RotateCcw className="size-4" />
          Retry
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onStop(job)} disabled={!isActiveJob(job)}>
          <Square className="size-4" />
          Stop job
        </DropdownMenuItem>
        {(hasPrimaryFile || hasErrors) ? <DropdownMenuSeparator /> : null}
        {hasPrimaryFile ? <DropdownMenuItem onClick={() => window.open(`/api/import-jobs/${encodeURIComponent(job.id)}/original?inline=1`, "_blank")}>
          <FileDown className="size-4" />
          {jobPrimaryFileActionLabel(job)}
        </DropdownMenuItem> : null}
        {hasErrors ? <DropdownMenuItem onClick={() => window.open(`/api/import-jobs/${encodeURIComponent(job.id)}/errors.csv?inline=1`, "_blank")}>
          <FileWarning className="size-4" />
          Download errors
        </DropdownMenuItem> : null}
        {(job.artifacts || []).some((artifact) => !["original", "errors", "manifest"].includes(String(artifact.kind || ""))) && <>
          <DropdownMenuSeparator />
          {(job.artifacts || []).map((artifact, index) => ({ artifact, index })).filter(({ artifact }) => !["original", "errors", "manifest"].includes(String(artifact.kind || ""))).map(({ artifact, index }) => <DropdownMenuItem key={`${artifact.kind}-${artifact.fileName}-${index}`} onClick={() => window.open(`/api/import-jobs/${encodeURIComponent(job.id)}/artifacts/${index}`, "_blank")}>
            <FileDown className="size-4" />
            {jobArtifactTitle(artifact.kind, artifact.fileName)}
          </DropdownMenuItem>)}
        </>}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function JobDetailPage({ job, onRetry, onStop, onUpdate }: { job?: ImportJob; onRetry: (job: ImportJob) => void; onStop: (job: ImportJob) => void; onUpdate: (job: ImportJob) => void }) {
  return (
    <div className="mx-auto grid max-w-7xl gap-5">
      <PageHeader
        eyebrow="Operations / Job"
        title={job?.operation || "Job detail"}
        description={job ? `${jobReference(job)} · ${jobChannelLabel(job)} · ${jobStatusLabel(job.status)}` : "Loading job details..."}
        action={<HistoryBackButton fallback="/jobs" label="Back to Jobs" size="default" />}
      />
      <JobDetail job={job} onRetry={onRetry} onStop={onStop} onUpdate={onUpdate} fullPage />
    </div>
  )
}

function jobReference(job: ImportJob) {
  return job.jobNumber ? `JOB-${job.jobNumber}` : `Job ${job.id.slice(0, 8)}`
}

function normalizedJobDirection(job: ImportJob) {
  return String(job.direction || job.type || "").trim().toLowerCase()
}

function isExportJob(job: ImportJob) {
  return normalizedJobDirection(job) === "export" || /\bexport\b/i.test(String(job.operation || ""))
}

function isImportJob(job: ImportJob) {
  return normalizedJobDirection(job) === "import"
}

function jobPrimaryFileTitle(job: ImportJob) {
  if (isExportJob(job)) return "Exported report"
  if (isImportJob(job)) return "Uploaded source file"
  if (/result|review|outcome|report/i.test(String(job.originalFileName || job.fileName || ""))) return "Job result"
  return "Job file"
}

function jobPrimaryFileDescription(job: ImportJob) {
  if (isExportJob(job)) return "Generated by this job and ready to download."
  if (isImportJob(job)) return "The source file used to start this job."
  return "The primary file saved with this job."
}

function jobPrimaryFileActionLabel(job: ImportJob) {
  if (isExportJob(job)) return "Download report"
  if (isImportJob(job)) return "Download source file"
  return "Download job file"
}

function jobArtifactTitle(kind?: string, fileName?: string) {
  const labels: Record<string, string> = {
    approved: "Approved records",
    mapped: "Matched records",
    review: "Records needing review",
    skipped: "Skipped records",
    summary: "Reconciliation summary",
    "shipping-eligibility-results": "Shipping eligibility results",
    "shopify-created-skus": "Created Shopify SKUs",
    "shopify-skipped-skus": "Skipped Shopify SKUs",
    "shopify-api-errors": "Shopify API errors",
  }
  const key = String(kind || "").trim().toLowerCase()
  if (labels[key]) return labels[key]
  if (key) return key.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
  return fileName ? "Generated file" : "Job result"
}

function jobFileSizeLabel(byteSize?: number) {
  const bytes = Number(byteSize || 0)
  if (!bytes) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

function jobArtifactMetadata(artifact?: NonNullable<ImportJob["artifacts"]>[number]) {
  if (!artifact) return ""
  const parts: string[] = []
  if (artifact.rowCount != null) parts.push(`${numberLabel(artifact.rowCount)} row${Number(artifact.rowCount) === 1 ? "" : "s"}`)
  const size = jobFileSizeLabel(artifact.byteSize)
  if (size) parts.push(size)
  return parts.join(" · ")
}

function jobTypeLabel(job: ImportJob) {
  const value = normalizedJobDirection(job) || "sync"
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function jobCurrentFileLabel(job: ImportJob) {
  const status = String(job.status || "").toLowerCase()
  if (isActiveJob(job)) return "File being processed"
  if (status === "failed") return "File at failure"
  if (isExportJob(job)) return "Generated file"
  if (isImportJob(job)) return "Imported file"
  return "Job file"
}

function JobArtifactDownloads({ job }: { job: ImportJob }) {
  const artifacts = job.artifacts || []
  const customArtifacts = artifacts.map((artifact, index) => ({ artifact, index })).filter(({ artifact }) => !["original", "errors", "manifest"].includes(String(artifact.kind || "")))
  const download = (path: string) => window.open(path, "_blank", "noreferrer")
  const hasOriginal = Boolean(job.originalFileName || artifacts.some((artifact) => String(artifact.kind || "") === "original"))
  const hasErrors = Boolean(job.errorFileName || job.errors?.length || artifacts.some((artifact) => String(artifact.kind || "") === "errors"))
  const originalArtifact = artifacts.find((artifact) => String(artifact.kind || "") === "original")
  const errorArtifact = artifacts.find((artifact) => String(artifact.kind || "") === "errors")
  const primaryFileName = originalArtifact?.fileName || job.originalFileName || job.fileName || "Saved job file"
  const errorFileName = errorArtifact?.fileName || job.errorFileName || "errors.csv"
  const availableCount = Number(hasOriginal) + Number(hasErrors) + customArtifacts.length
  const downloads = [
    ...(hasOriginal ? [{
      key: "primary",
      title: jobPrimaryFileTitle(job),
      description: jobPrimaryFileDescription(job),
      fileName: primaryFileName,
      metadata: jobArtifactMetadata(originalArtifact),
      href: `/api/import-jobs/${encodeURIComponent(job.id)}/original?inline=1`,
      kind: isImportJob(job) ? "source" : "result",
    }] : []),
    ...(hasErrors ? [{
      key: "errors",
      title: "Errors to review",
      description: "Records or messages that need operator attention.",
      fileName: errorFileName,
      metadata: jobArtifactMetadata(errorArtifact) || (job.errors?.length ? `${numberLabel(job.errors.length)} issue${job.errors.length === 1 ? "" : "s"}` : ""),
      href: `/api/import-jobs/${encodeURIComponent(job.id)}/errors.csv?inline=1`,
      kind: "errors",
    }] : []),
    ...customArtifacts.map(({ artifact, index }) => ({
      key: `${artifact.kind}-${artifact.fileName}-${index}`,
      title: jobArtifactTitle(artifact.kind, artifact.fileName),
      description: "Generated by this job.",
      fileName: artifact.fileName || "Saved result",
      metadata: jobArtifactMetadata(artifact),
      href: `/api/import-jobs/${encodeURIComponent(job.id)}/artifacts/${index}`,
      kind: "result",
    })),
  ]
  return (
    <section className="grid gap-3" aria-label="Job downloads">
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="font-medium">Downloads</p><p className="text-xs text-muted-foreground">Files are labeled by their purpose in this job.</p></div><Badge variant="outline" className="shrink-0">{numberLabel(availableCount)} available</Badge></div>
      {downloads.length ? <div className="overflow-hidden rounded-md border">
        {downloads.map((item) => (
          <div key={item.key} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b p-3 last:border-b-0">
            <div className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
              {item.kind === "errors" ? <FileWarning className="size-4" /> : item.kind === "source" ? <FileUp className="size-4" /> : <FileText className="size-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{item.title}</p>
              <p className="truncate text-xs text-muted-foreground" title={item.fileName}>{item.fileName}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{item.description}{item.metadata ? ` · ${item.metadata}` : ""}</p>
            </div>
            <Button size="icon" variant="ghost" className="shrink-0" title={`Download ${item.title}`} aria-label={`Download ${item.title}`} onClick={() => download(item.href)}><FileDown className="size-4" /></Button>
          </div>
        ))}
      </div> : <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">This job did not create or retain a downloadable file.</div>}
    </section>
  )
}

function JobIssueSummary({ job }: { job: ImportJob }) {
  const issues = (job.errors || []).filter(Boolean)
  if (!issues.length) return null
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Recorded issue{issues.length === 1 ? "" : "s"}</p>
        <Badge variant="outline" className="border-amber-400/70 bg-amber-100/70 text-amber-950 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-100">{numberLabel(issues.length)}</Badge>
      </div>
      <ul className="mt-2 grid gap-1 text-xs">
        {issues.slice(0, 8).map((issue, index) => <li key={`${issue}-${index}`} className="break-words">{issue}</li>)}
      </ul>
      {issues.length > 8 ? <p className="mt-2 text-xs">Download the error report for the remaining {numberLabel(issues.length - 8)} issue{issues.length - 8 === 1 ? "" : "s"}.</p> : null}
    </div>
  )
}

function jobChannelName(job: ImportJob) {
  const source = String((job as Record<string, unknown>).source || "")
  const identity = `${job.workerTask || ""} ${job.fileName || ""} ${job.currentFile || ""}`.toLowerCase()
  const context = `${job.operation || ""} ${source}`.toLowerCase()
  const channelFrom = (text: string) => {
    if (text.includes("ebay")) return "eBay"
    if (text.includes("shopify")) return "Shopify"
    if (text.includes("walmart")) return "Walmart"
    if (text.includes("temu")) return "Temu"
    if (text.includes("whatnot")) return "Whatnot"
    if (text.includes("tiktok")) return "TikTok Shop"
    return ""
  }
  const identified = channelFrom(identity)
  if (identified) return identified
  const contextual = channelFrom(context)
  if (contextual) return contextual
  return ""
}

function JobChannelActivity({ job }: { job: ImportJob }) {
  const [logs, setLogs] = useState<ChannelLogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const channel = jobChannelName(job)

  useEffect(() => {
    if (!job.id || !channel) return
    setLoading(true)
    setError("")
    const params = new URLSearchParams({ days: "365", limit: "25", jobId: job.id, channel })
    api<{ logs?: ChannelLogEntry[] }>(`/api/channel-api-logs?${params.toString()}`)
      .then((result) => setLogs(result.logs || []))
      .catch((loadError) => {
        setLogs([])
        setError(loadError instanceof Error ? loadError.message : "Unable to load channel activity for this job.")
      })
      .finally(() => setLoading(false))
  }, [job.id, channel])

  if (!channel) return null
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{channel} activity for this job</p>
          <p className="text-xs text-muted-foreground">API calls and channel job events recorded with this job ID.</p>
        </div>
        <Badge variant="outline">{loading ? "Loading" : `${numberLabel(logs.length)} event${logs.length === 1 ? "" : "s"}`}</Badge>
      </div>
      {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
      {!loading && !error && !logs.length ? <p className="mt-3 text-xs text-muted-foreground">No channel activity was found for this job ID.</p> : null}
      {logs.length ? (
        <div className="mt-3 grid gap-2">
          {logs.slice(0, 6).map((entry) => (
            <div key={String(entry.id || `${entry.createdAt}-${entry.operation}`)} className="rounded-md border bg-background p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{entry.operation || "Channel event"}</p>
                <Badge variant={entry.ok === false ? "destructive" : entry.ok === true ? "default" : "outline"}>{channelLogStatusLabel(entry)}</Badge>
              </div>
              <p className="mt-1 break-words text-xs text-muted-foreground">{entry.message || entry.path || "No message recorded."}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{dateLabel(entry.createdAt)}{entry.requestId ? ` / request ${entry.requestId}` : ""}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function JobDetail({ job, onRetry, onStop, onUpdate, fullPage = false }: { job?: ImportJob; onRetry: (job: ImportJob) => void; onStop: (job: ImportJob) => void; onUpdate: (job: ImportJob) => void; fullPage?: boolean }) {
  const [notes, setNotes] = useState("")
  const [savingNotes, setSavingNotes] = useState(false)
  useEffect(() => { setNotes(job?.operatorNotes || "") }, [job?.id, job?.operatorNotes])

  const saveNotes = async () => {
    if (!job) return
    setSavingNotes(true)
    try {
      const result = await api<{ job: ImportJob; message?: string }>(`/api/import-jobs/${encodeURIComponent(job.id)}/notes`, { method: "PATCH", body: JSON.stringify({ notes }) })
      toast.success(result.message || "Job notes saved.")
      onUpdate(result.job)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save job notes.")
    } finally { setSavingNotes(false) }
  }

  if (!job) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">Select a job to inspect details.</CardContent>
      </Card>
    )
  }

  return (
    <Card className={`min-w-0 ${fullPage ? "" : "xl:sticky xl:top-20"}`}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{jobOperationLabel(job)}</CardTitle>
            <div className="flex flex-wrap items-center gap-1">
              <CardDescription>{jobReference(job)}</CardDescription>
              {jobImportMode(job) ? <Badge variant="outline" className="text-[10px]">{jobImportMode(job)}</Badge> : null}
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0"
                title="Copy internal job ID"
                onClick={() => void navigator.clipboard.writeText(job.id).then(
                  () => toast.success("Internal job ID copied."),
                  () => toast.error("Unable to copy the job ID."),
                )}
              >
                <Copy className="size-3.5" />
              </Button>
            </div>
            <div className="mt-2"><JobContextBadges job={job} /></div>
          </div>
          <Badge variant={jobStatusTone(job.status)}>{jobStatusLabel(job.status)}</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-4 text-sm">
        {isWalmartFeedStatusCheck(job) ? (
          <div className="rounded-md border border-blue-300 bg-blue-50 p-3 text-blue-950 dark:border-blue-900/70 dark:bg-blue-950/30 dark:text-blue-100">
            <p className="font-medium">Status check only</p>
            <p className="mt-1 text-xs">This job checks an existing Walmart feed ID. It does not submit products or create a new feed.</p>
          </div>
        ) : null}
        {isEbayLaunchPreflight(job) ? (
          <div className="rounded-md border border-blue-300 bg-blue-50 p-3 text-blue-950 dark:border-blue-900/70 dark:bg-blue-950/30 dark:text-blue-100">
            <p className="font-medium">Preflight only</p>
            <p className="mt-1 text-xs">This job validates eBay launch readiness in checkpoints. It does not publish listings.</p>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => onRetry(job)} disabled={!job.workerTask || job.workerTask === 'pricing-deployment-hold' || isActiveJob(job)}>
            <RotateCcw className="size-4" /> Retry
          </Button>
          <Button size="sm" variant="outline" onClick={() => onStop(job)} disabled={!isActiveJob(job)}>
            <Square className="size-4" /> Stop
          </Button>
          {!fullPage && <Button size="sm" variant="outline" onClick={() => { window.history.pushState({}, "", `/jobs/${encodeURIComponent(job.id)}`); window.dispatchEvent(new PopStateEvent("popstate")) }}><Eye className="size-4" /> Full detail</Button>}
        </div>
        <JobChannelFeeds jobId={job.id} />
        {job.importProgress ? <ImportProgressSummary value={job.importProgress} /> : <Progress value={jobProgress(job)} />}
        <div className="grid grid-cols-2 gap-2">
          <Detail label="Category" value={jobCategory(job)} />
          <Detail label="Type" value={jobTypeLabel(job)} />
          <Detail label="Channel" value={jobChannelLabel(job)} />
          <Detail label="Started by" value={jobRunType(job) === "automated" ? "Automation" : "User"} />
          {jobImportMode(job) ? <Detail label="Import mode" value={jobImportMode(job)} /> : null}
          <Detail label="Started" value={dateLabel(job.startedAt || job.createdAt)} />
          <Detail label="Finished" value={dateLabel(job.finishedAt)} />
          <Detail label="Total records" value={numberLabel(job.totalRows)} />
          <Detail label="Processed" value={numberLabel(job.processedRows)} />
          <Detail label={isExportJob(job) ? "Output rows" : "Changed"} value={numberLabel(job.changed)} />
          <Detail label="Missing / failed" value={numberLabel(job.missingCount)} />
          <Detail label="Stage" value={String(job.phase || "pending").replace(/_/g, " ")} />
        </div>
        {jobImportModeDescription(job) ? (
          <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
            <p className="font-medium">What this run does</p>
            <p className="mt-1 text-muted-foreground">{jobImportModeDescription(job)}</p>
          </div>
        ) : null}
        {job.message && (
          <div className="rounded-md border bg-muted/45 p-3">
            <p className="font-medium">Latest update</p>
            <p className="mt-1 text-muted-foreground">{job.message}</p>
          </div>
        )}
        {job.details && (
          <div className="rounded-md border bg-muted/45 p-3">
            <p className="font-medium">Run summary</p>
            <p className="mt-1 line-clamp-6 text-muted-foreground">{job.details}</p>
          </div>
        )}
        <JobArtifactDownloads job={job} />
        <JobIssueSummary job={job} />
        <JobChannelActivity job={job} />
        <Collapsible>
          <div className="overflow-hidden rounded-md border">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="h-auto w-full justify-between rounded-none px-3 py-3 text-left whitespace-normal">
                <span className="min-w-0 flex-1"><span className="block font-medium">Technical details</span><span className="block break-words text-xs font-normal text-muted-foreground">Internal IDs, worker state, filenames, and diagnostic output.</span></span>
                <ChevronDown className="size-4 shrink-0" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t bg-muted/15 p-3">
              <div className="grid grid-cols-2 gap-2">
                <Detail label="Internal job ID" value={job.id} />
                <Detail label="Worker" value={job.workerId || job.workerTask || "Not assigned"} />
                {job.currentFile ? <Detail label={jobCurrentFileLabel(job)} value={job.currentFile} /> : null}
                <Detail label="Throughput" value={job.rowsPerSecond ? `${job.rowsPerSecond.toFixed(1)} rows/sec` : "Not reported"} />
                <Detail label="Worker memory" value={job.processRssMb ? `${numberLabel(job.processRssMb)} MB RSS` : "Not reported"} />
                <Detail label="Retry source" value={job.retryOfJobId ? `Job ${job.retryOfJobId.slice(0, 8)}` : "Original run"} />
              </div>
              <div className="mt-3 overflow-hidden rounded-md bg-zinc-950 text-zinc-100">
                <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
                  <p className="text-xs font-medium">Worker output</p>
                  <span className="text-[11px] text-zinc-400">Latest {Math.min(400, job.workerOutput?.length || 0)} lines</span>
                </div>
                <div className="max-h-64 overflow-auto p-3 font-mono text-[11px] leading-5">
                  {job.workerOutput?.length ? job.workerOutput.map((entry, index) => (
                    <p key={`${entry.timestamp || ""}-${index}`} className={entry.stream === "stderr" ? "text-amber-300" : "text-zinc-200"}>
                      <span className="mr-2 text-zinc-500">{entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : "--:--:--"}</span>
                      {entry.line}
                    </p>
                  )) : <p className="text-zinc-400">No worker output was captured for this job.</p>}
                </div>
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
        <div className="rounded-md border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3"><p className="font-medium">Operator notes</p>{job.notesUpdatedAt ? <span className="text-xs text-muted-foreground">{job.notesUpdatedBy || "Operator"} · {dateLabel(job.notesUpdatedAt)}</span> : null}</div>
          <Textarea className="mt-2 min-h-24" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Explain what this job does, its purpose, assumptions, or follow-up instructions." />
          <div className="mt-2 flex justify-end"><Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => void saveNotes()} disabled={savingNotes}>{savingNotes ? "Saving..." : "Save notes"}</Button></div>
        </div>
      </CardContent>
    </Card>
  )
}
