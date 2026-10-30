import { Alert,AlertDescription,AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card"
import { Collapsible,CollapsibleContent,CollapsibleTrigger } from "@/components/ui/collapsible"
import { Empty,EmptyDescription,EmptyHeader,EmptyMedia,EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs,TabsList,TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileText,
  History,
  Loader2,
  RefreshCw,
  Search
} from "lucide-react"
import { useEffect,useState } from "react"
import { toast } from "sonner"
import type {
  ImportJob,
  ReleaseChange,
  ReleaseHistoryResponse,
  SystemSettings
} from "../App"
import { api,dateLabel,numberLabel } from "../lib/client-api"

import { Detail, Field, MetricCard, PageHeader, ToggleField } from "./app-ui"

const releaseTypeLabels: Record<string, string> = {
  data: "Data",
  deployment: "Deployment",
  documentation: "Documentation",
  feature: "Feature",
  fix: "Fix",
  interface: "Interface",
  maintenance: "Maintenance",
  performance: "Performance",
  security: "Security",
}

function releaseBadgeClass(type: string) {
  if (type === "feature") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
  if (type === "fix") return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
  if (type === "interface") return "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300"
  if (type === "performance") return "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300"
  if (type === "data") return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
  if (type === "deployment") return "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
  if (type === "security") return "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300"
  return "border-border bg-muted text-muted-foreground"
}

export function ReleaseHistorySettings({ active }: { active: boolean }) {
  const [history, setHistory] = useState<ReleaseHistoryResponse | null>(null)
  const [releases, setReleases] = useState<ReleaseChange[]>([])
  const [query, setQuery] = useState("")
  const [type, setType] = useState("all")
  const [view, setView] = useState<"releases" | "changes">("releases")
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState("")
  const [lastSeen, setLastSeen] = useState(() => window.localStorage.getItem("dataplus:last-seen-release") || "")

  async function load(reset = true) {
    const offset = reset ? 0 : releases.length
    if (reset) setLoading(true)
    else setLoadingMore(true)
    setError("")
    try {
      const params = new URLSearchParams({ limit: "30", offset: String(offset), type })
      if (query.trim()) params.set("q", query.trim())
      const result = await api<ReleaseHistoryResponse>(`/api/system/releases?${params.toString()}`)
      setHistory(result)
      setReleases((current) => reset ? result.releases : [...current, ...result.releases])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load release history.")
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    if (!active) return
    const timer = window.setTimeout(() => void load(true), 250)
    return () => window.clearTimeout(timer)
  }, [active, query, type])

  const viewingFilteredHistory = Boolean(query.trim() || type !== "all")
  const lastSeenIndex = lastSeen ? releases.findIndex((release) => release.id === lastSeen) : -1
  const newCount = viewingFilteredHistory || !lastSeen
    ? 0
    : lastSeenIndex >= 0
      ? lastSeenIndex
      : Math.min(releases.length, history?.total || releases.length)
  const hasMore = Boolean(history && releases.length < history.filteredTotal)
  const deploymentStatus = String(history?.deployment?.status || "unknown").toLowerCase()
  const deploymentHealthy = deploymentStatus === "healthy" && history?.deployment?.revisionMatchesHistory !== false

  function markViewed() {
    const revision = history?.current?.id
    if (!revision) return
    window.localStorage.setItem("dataplus:last-seen-release", revision)
    setLastSeen(revision)
    toast.success("Release history marked as viewed.")
  }

  return <div className="grid gap-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Current release" value={history?.currentGroup?.version || history?.current?.shortId || "Loading"} icon={History} />
      <MetricCard label="Changes recorded" value={numberLabel(history?.total || 0)} icon={FileText} />
      <MetricCard label="Production" value={history?.deployment ? (deploymentHealthy ? "Healthy" : deploymentStatus) : "Not reported"} icon={deploymentHealthy ? CheckCircle2 : AlertTriangle} />
      <MetricCard label="Deployed" value={history?.deployment?.deployedAt ? dateLabel(history.deployment.deployedAt) : "Not reported"} icon={RefreshCw} />
    </div>

    {history?.deployment && <Alert className={deploymentHealthy ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"}>
      {deploymentHealthy ? <CheckCircle2 className="size-4 text-emerald-600" /> : <AlertTriangle className="size-4 text-amber-600" />}
      <AlertTitle>{deploymentHealthy ? "Production deployment is healthy" : `Production deployment is ${deploymentStatus}`}</AlertTitle>
      <AlertDescription className="flex flex-wrap gap-x-4 gap-y-1">
        <span>Revision #{history.deployment.shortRevision || history.deployment.revision?.slice(0, 7) || "unknown"}</span>
        <span>Environment: {history.deployment.environment || "production"}</span>
        {history.deployment.durationSeconds !== null && history.deployment.durationSeconds !== undefined && <span>Duration: {numberLabel(history.deployment.durationSeconds)} seconds</span>}
        {history.deployment.revisionMatchesHistory === false && <span className="font-medium text-amber-700 dark:text-amber-300">A newer repository revision is waiting to deploy.</span>}
        {history.deployment.serviceUrl && <a className="font-medium text-primary hover:underline" href={history.deployment.serviceUrl} target="_blank" rel="noreferrer">Open production</a>}
      </AlertDescription>
    </Alert>}

    <Card>
      <CardHeader className="gap-4 border-b lg:flex-row lg:items-center lg:justify-between">
        <div>
          <CardTitle className="text-base">Releases and changes</CardTitle>
          <CardDescription>Deployment-aware history generated from Git. New commits are added automatically during every production deployment.</CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={loading}><RefreshCw className={cn("size-4", loading && "animate-spin")} /> Refresh</Button>
          <Button variant="outline" size="sm" onClick={markViewed} disabled={!history?.current || newCount === 0}>Mark viewed</Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 p-4">
        <Tabs value={view} onValueChange={(value) => setView(value as "releases" | "changes")}>
          <TabsList><TabsTrigger value="releases">Named releases</TabsTrigger><TabsTrigger value="changes">All changes</TabsTrigger></TabsList>
        </Tabs>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
          <div className="relative"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search releases, files, areas, or commit ID" /></div>
          <Select value={type} onValueChange={setType}><SelectTrigger><SelectValue placeholder="All change types" /></SelectTrigger><SelectContent><SelectItem value="all">All change types</SelectItem>{Object.entries(releaseTypeLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
        </div>

        {error && <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Release history unavailable</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
        {loading && <div className="grid gap-2">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-20 w-full" />)}</div>}
        {!loading && !error && view === "releases" && <div className="grid gap-3">
          {(history?.releaseGroups || []).map((group) => <Collapsible key={group.id} className="overflow-hidden rounded-lg border bg-card">
            <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2"><Badge variant={group.current ? "default" : "secondary"}>{group.current ? "Current" : "Release"}</Badge><Badge variant="outline" className={releaseBadgeClass(group.primaryType)}>{releaseTypeLabels[group.primaryType] || "Maintenance"}</Badge><span className="font-mono text-xs font-semibold text-foreground">v{group.version}</span></div>
                <div><p className="font-semibold text-foreground">{group.name}</p><p className="mt-1 text-sm text-muted-foreground">{numberLabel(group.changeCount)} changes across {(group.areas || []).join(", ") || "the application"}.</p></div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>Revision #{group.shortRevision || "unknown"}</span><span>{numberLabel(group.fileCount)} files changed</span><span>{dateLabel(group.publishedAt)}</span></div>
              </div>
              <CollapsibleTrigger asChild><Button variant="outline" size="sm">View release notes</Button></CollapsibleTrigger>
            </div>
            <CollapsibleContent className="border-t bg-muted/20">
              <div className="divide-y">{group.changes.map((release) => <div key={release.id} className="grid gap-2 p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start"><Badge variant="outline" className={releaseBadgeClass(release.type)}>{releaseTypeLabels[release.type] || release.type}</Badge><div className="min-w-0"><p className="text-sm font-medium text-foreground">{release.title}</p><p className="mt-1 text-xs text-muted-foreground">{release.author || "Unknown author"} / {(release.areas || []).join(" / ") || "Repository"}</p></div>{release.commitUrl && <Button variant="ghost" size="icon" asChild title="View commit"><a href={release.commitUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-4" /></a></Button>}</div>)}</div>
            </CollapsibleContent>
          </Collapsible>)}
          {!(history?.releaseGroups || []).length && <Empty className="rounded-lg border py-12"><EmptyHeader><EmptyMedia variant="icon"><History /></EmptyMedia><EmptyTitle>No matching releases</EmptyTitle><EmptyDescription>Adjust the search or change-type filter.</EmptyDescription></EmptyHeader></Empty>}
        </div>}
        {!loading && !error && view === "changes" && <div className="overflow-hidden rounded-lg border">
          {releases.map((release, index) => {
            const isNew = Boolean(!viewingFilteredHistory && lastSeen && (lastSeenIndex === -1 || index < lastSeenIndex))
            return <Collapsible key={release.id} className="border-b last:border-b-0">
              <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className={releaseBadgeClass(release.type)}>{releaseTypeLabels[release.type] || release.type || "Change"}</Badge>{isNew && <Badge variant="info">New</Badge>}<span className="font-mono text-xs text-muted-foreground">#{release.shortId}</span>{(release.tags || []).map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}</div>
                  <p className="font-medium text-foreground">{release.title}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>{release.author || "Unknown author"}</span><span>{dateLabel(release.committedAt)}</span><span>{numberLabel(release.fileCount || release.files?.length || 0)} files</span><span>{(release.areas || []).join(" / ") || "Repository"}</span></div>
                </div>
                <div className="flex shrink-0 gap-2"><CollapsibleTrigger asChild><Button variant="outline" size="sm">Details</Button></CollapsibleTrigger>{release.commitUrl && <Button variant="outline" size="icon" asChild title="View commit"><a href={release.commitUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-4" /></a></Button>}</div>
              </div>
              <CollapsibleContent className="border-t bg-muted/20 px-4 py-3">
                {release.notes && <p className="mb-3 whitespace-pre-wrap text-sm text-muted-foreground">{release.notes}</p>}
                <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Changed files</p>
                <div className="grid gap-1 font-mono text-xs text-muted-foreground sm:grid-cols-2">{(release.files || []).map((file) => <span key={file} className="truncate" title={file}>{file}</span>)}{!(release.files || []).length && <span>No file list recorded.</span>}</div>
              </CollapsibleContent>
            </Collapsible>
          })}
          {!releases.length && <Empty className="py-12"><EmptyHeader><EmptyMedia variant="icon"><History /></EmptyMedia><EmptyTitle>No matching releases</EmptyTitle><EmptyDescription>Adjust the search or change-type filter.</EmptyDescription></EmptyHeader></Empty>}
        </div>}

        {view === "changes" && hasMore && <Button variant="outline" onClick={() => void load(false)} disabled={loadingMore}>{loadingMore && <Loader2 className="size-4 animate-spin" />} Load more changes</Button>}
        {history && <p className="text-xs text-muted-foreground">{view === "releases" ? `Showing ${numberLabel(history.releaseGroups?.length || 0)} of ${numberLabel(history.releaseGroupTotal || history.releaseGroups?.length || 0)} named releases` : `Showing ${numberLabel(releases.length)} of ${numberLabel(history.filteredTotal)} matching changes`}. Source: {history.source === "git" ? "live repository history" : "deployment manifest"}. {numberLabel(newCount)} new since last viewed.</p>}
      </CardContent>
    </Card>
  </div>
}

export type SupplierIndexStatus = {
  enabled?: boolean
  totalProducts?: number
  totalLinks?: number
  linkedProducts?: number
  multiSupplierProducts?: number
  unmatchedProducts?: number
  pendingReviews?: number
  lastRebuiltAt?: string
  methodCounts?: Array<{ matchType?: string; productCount?: number; linkCount?: number }>
  activeJobId?: string
  activeJob?: ImportJob | null
}

type WikiHealthResult = {
  ready?: boolean
  checkedAt?: string
  message?: string
  apiConfigured?: boolean
  systemSettings?: SystemSettings
}

export function WikiWorkspace({
  settings,
  onSaveSettings,
}: {
  settings: SystemSettings
  onSaveSettings: (patch: Record<string, unknown>) => Promise<void>
}) {
  const [draft, setDraft] = useState(() => ({
    wikiEnabled: settings.wikiEnabled !== false,
    wikiAutomationEnabled: settings.wikiAutomationEnabled === true,
    wikiRequireReview: settings.wikiRequireReview !== false,
    wikiHandbookShelf: String(settings.wikiHandbookShelf || "DataPlus Operations Handbook"),
    wikiDefaultOwner: String(settings.wikiDefaultOwner || "DataPlus Operations"),
  }))
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [health, setHealth] = useState<WikiHealthResult | null>(null)
  const wikiUrl = String(settings.wikiBaseUrl || "https://dataplusapp.duckdns.org/wiki").replace(/\/+$/, "")
  const effectiveHealthStatus = health?.ready === true ? "ready" : health?.ready === false ? "failed" : String(settings.wikiLastHealthStatus || "not_checked")
  const healthMessage = health?.message || String(settings.wikiLastHealthMessage || "No connection check has been run yet.")
  const healthAt = health?.checkedAt || String(settings.wikiLastHealthCheckAt || "")

  useEffect(() => {
    setDraft({
      wikiEnabled: settings.wikiEnabled !== false,
      wikiAutomationEnabled: settings.wikiAutomationEnabled === true,
      wikiRequireReview: settings.wikiRequireReview !== false,
      wikiHandbookShelf: String(settings.wikiHandbookShelf || "DataPlus Operations Handbook"),
      wikiDefaultOwner: String(settings.wikiDefaultOwner || "DataPlus Operations"),
    })
  }, [settings.wikiEnabled, settings.wikiAutomationEnabled, settings.wikiRequireReview, settings.wikiHandbookShelf, settings.wikiDefaultOwner])

  async function save() {
    setSaving(true)
    try {
      await onSaveSettings({
        wikiEnabled: draft.wikiEnabled,
        wikiAutomationEnabled: draft.wikiAutomationEnabled,
        wikiRequireReview: draft.wikiRequireReview,
        wikiHandbookShelf: draft.wikiHandbookShelf.trim() || "DataPlus Operations Handbook",
        wikiDefaultOwner: draft.wikiDefaultOwner.trim() || "DataPlus Operations",
      })
    } finally {
      setSaving(false)
    }
  }

  async function checkHealth() {
    setChecking(true)
    try {
      const result = await api<WikiHealthResult>("/api/wiki/health", { method: "POST", body: JSON.stringify({}) })
      setHealth(result)
      toast.success(result.message || "Wiki connection verified.")
    } catch (error) {
      setHealth({ ready: false, message: error instanceof Error ? error.message : "Unable to reach the wiki." })
      toast.error(error instanceof Error ? error.message : "Unable to reach the wiki.")
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="Workspace / Wiki"
        title="Operations Wiki"
        description="Control how DataPlus connects to the shared operating handbook. BookStack holds the documents and its own user permissions; DataPlus controls the operating policy."
        action={<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void checkHealth()} disabled={checking}>{checking ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Test connection</Button><Button asChild><a href={`${wikiUrl}/`} target="_blank" rel="noreferrer"><ExternalLink className="size-4" /> Open wiki</a></Button></div>}
      />

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Connection</CardTitle>
            <CardDescription>The documentation service is hosted alongside DataPlus but has its own login and permissions.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Detail label="Service" value="BookStack" />
              <Detail label="API credential" value={(health?.apiConfigured ?? Boolean(settings.wikiApiConfigured)) ? "Configured on server" : "Not configured"} />
              <Detail label="Last check" value={healthAt ? dateLabel(healthAt) : "Not checked"} />
              <Detail label="Status" value={effectiveHealthStatus === "ready" ? "Ready" : effectiveHealthStatus === "failed" ? "Needs attention" : "Not checked"} />
            </div>
            <div className={cn("rounded-md border p-3 text-sm", effectiveHealthStatus === "ready" ? "border-emerald-500/30 bg-emerald-500/5" : effectiveHealthStatus === "failed" ? "border-destructive/30 bg-destructive/5" : "bg-muted/30")}>
              <div className="flex flex-wrap items-center gap-2"><Badge variant={effectiveHealthStatus === "ready" ? "default" : effectiveHealthStatus === "failed" ? "destructive" : "secondary"}>{effectiveHealthStatus === "ready" ? "Connected" : effectiveHealthStatus === "failed" ? "Connection issue" : "Not checked"}</Badge><span className="text-muted-foreground">{healthMessage}</span></div>
            </div>
            <Field label="Wiki address"><Input value={wikiUrl} disabled readOnly /><p className="text-xs text-muted-foreground">The application address is fixed to the protected DataPlus wiki path.</p></Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Publishing safeguards</CardTitle>
            <CardDescription>Keep operational knowledge organized without letting background automation publish unchecked changes.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <ToggleField label="Enable wiki workspace" description="Makes the Operations Wiki available from the DataPlus workspace navigation." checked={draft.wikiEnabled} onCheckedChange={(value) => setDraft((current) => ({ ...current, wikiEnabled: value }))} />
            <ToggleField label="Enable automated publishing" description="Allows approved future DataPlus automations to create or update handbook drafts through the BookStack API." checked={draft.wikiAutomationEnabled} onCheckedChange={(value) => setDraft((current) => ({ ...current, wikiAutomationEnabled: value }))} />
            <ToggleField label="Require review before publishing" description="Keeps generated or revised handbook content in review until an owner approves it." checked={draft.wikiRequireReview} onCheckedChange={(value) => setDraft((current) => ({ ...current, wikiRequireReview: value }))} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Handbook organization</CardTitle>
          <CardDescription>These names tell future automation where to place operational documentation. They do not alter existing BookStack pages.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Handbook shelf"><Input value={draft.wikiHandbookShelf} onChange={(event) => setDraft((current) => ({ ...current, wikiHandbookShelf: event.target.value }))} placeholder="DataPlus Operations Handbook" /></Field>
          <Field label="Default owner"><Input value={draft.wikiDefaultOwner} onChange={(event) => setDraft((current) => ({ ...current, wikiDefaultOwner: event.target.value }))} placeholder="DataPlus Operations" /></Field>
          <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/25 p-3">
            <p className="text-sm text-muted-foreground">BookStack administrators manage users and API tokens in BookStack. DataPlus only reports whether a server-managed automation credential exists; secrets are never sent back to the browser.</p>
            <Button onClick={() => void save()} disabled={saving}>{saving && <Loader2 className="size-4 animate-spin" />} Save controls</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
