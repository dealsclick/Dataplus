import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, ExternalLink, Loader2, Play, Radio, RefreshCw, Save, ShieldCheck } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
  ["tiktokFulfillmentEnabled", "Fulfillment", "Enable TikTok shipping-service and package workflows."],
  ["tiktokLabelPurchaseEnabled", "TikTok Shipping labels", "Allow an explicit preview and confirmation before package creation."],
] as const

const defaultStart = () => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
const defaultEnd = () => new Date().toISOString().slice(0, 10)

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
  const [liveStatus, setLiveStatus] = useState<Json>({ metrics: {}, sessions: [], analytics: {}, attribution: {} })
  const [liveLoading, setLiveLoading] = useState(false)
  const [edits, setEdits] = useState<Json>({})
  const [tab, setTab] = useState("connection")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [job, setJob] = useState<Json | null>(null)
  const [dateRange, setDateRange] = useState({ startDate: defaultStart(), endDate: defaultEnd() })
  const [historicalBackfill, setHistoricalBackfill] = useState(true)
  const [credentials, setCredentials] = useState({ appKey: "", appSecret: "", accessToken: "", refreshToken: "" })
  const rules = useMemo(() => ({ ...(channel.settings || {}), ...edits }), [channel.settings, edits])

  const refresh = async () => {
    const next = await request("status")
    setStatus(next)
    setCredentials(current => ({ ...current, appKey: next.appKey || "", appSecret: "", accessToken: "", refreshToken: "" }))
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

  useEffect(() => {
    let active = true
    request("status").then(next => {
      if (!active) return
      setStatus(next)
      setCredentials({ appKey: next.appKey || "", appSecret: "", accessToken: "", refreshToken: "" })
    }).catch(reason => active && setError(reason instanceof Error ? reason.message : "TikTok status could not load."))
    return () => { active = false }
  }, [channel.id, channel.settings?.tiktokEnvironment])

  useEffect(() => {
    let active = true
    request("live").then(next => active && setLiveStatus(next)).catch(() => {})
    return () => { active = false }
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
    await onSave(channel.id, { settings: edits })
    setEdits({})
    onRefresh?.()
    await refresh()
    return { message: "TikTok Shop settings saved." }
  }

  const saveCredentials = async () => {
    const result = await request("credentials", {
      environment: rules.tiktokEnvironment || "production",
      ...credentials,
    })
    await refresh()
    return result
  }

  const verify = async () => {
    if (rules.channelEnabled !== true) {
      await onSave(channel.id, { settings: { channelEnabled: true } })
      setEdits(current => ({ ...current, channelEnabled: true }))
    }
    const result = await request("connection/verify", {})
    await refresh()
    onRefresh?.()
    return result
  }

  const queue = async (operation: string) => request(`jobs/${operation}`, {
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    historicalBackfill: operation === "orders" && historicalBackfill,
  })

  const configured = status.configured === true
  const verified = status.connection?.verified === true
  const dirty = Object.keys(edits).length > 0

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
        {error && <Alert variant="destructive"><AlertTitle>TikTok Shop action failed</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
        {message && <Alert><CheckCircle2 className="size-4" /><AlertTitle>Update</AlertTitle><AlertDescription>{message}</AlertDescription></Alert>}
        {job && <p className="text-sm"><a className="font-medium underline" href="/jobs">Job #{job.jobNumber || job.id}</a> is {job.status}. Progress and row-level evidence are available in Jobs.</p>}
        {dirty && <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"><span>Feature changes are not saved yet.</span><div className="flex gap-2"><Button size="sm" disabled={busy} onClick={() => void run(saveSettings)}><Save className="size-4" /> Save</Button><Button size="sm" variant="outline" onClick={() => setEdits({})}>Discard</Button></div></div>}

        <Tabs value={tab} onValueChange={setTab}>
          <div className="overflow-x-auto"><TabsList className="h-auto min-w-max justify-start"><TabsTrigger value="connection">Connection</TabsTrigger><TabsTrigger value="features">Features</TabsTrigger><TabsTrigger value="sync">Sync</TabsTrigger><TabsTrigger value="live">LIVE</TabsTrigger><TabsTrigger value="fulfillment">Shipping</TabsTrigger><TabsTrigger value="capabilities">API access</TabsTrigger></TabsList></div>

          <TabsContent value="connection" className="space-y-4">
            <div className="flex flex-wrap items-center gap-2"><Badge variant={verified ? "default" : "outline"}>{verified ? "Verified" : configured ? "Ready to verify" : "Not configured"}</Badge><span className="text-sm text-muted-foreground">{status.environment || "production"} · {status.shopName || "No shop selected"}</span></div>
            {!status.encryptedStorageReady && <Alert variant="destructive"><ShieldCheck className="size-4" /><AlertTitle>Credential encryption key required</AlertTitle><AlertDescription>Set <code>DATAPLUS_CREDENTIALS_ENCRYPTION_KEY</code> in the deployment secret store before saving credentials.</AlertDescription></Alert>}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm">Environment<Select value={String(rules.tiktokEnvironment || "production")} onValueChange={value => update("tiktokEnvironment", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="production">Production</SelectItem><SelectItem value="development">Development shop</SelectItem></SelectContent></Select></label>
              <label className="grid gap-1.5 text-sm">App key<Input autoComplete="off" value={credentials.appKey} onChange={event => setCredentials(current => ({ ...current, appKey: event.target.value }))} /></label>
              <label className="grid gap-1.5 text-sm">App secret<Input type="password" autoComplete="new-password" value={credentials.appSecret} onChange={event => setCredentials(current => ({ ...current, appSecret: event.target.value }))} placeholder={status.appSecretConfigured ? "Saved - leave blank to keep" : "Required"} /></label>
              <label className="grid gap-1.5 text-sm">Seller access token<Input type="password" autoComplete="new-password" value={credentials.accessToken} onChange={event => setCredentials(current => ({ ...current, accessToken: event.target.value }))} placeholder={status.accessTokenConfigured ? "Saved - leave blank to keep" : "Required"} /></label>
              <label className="grid gap-1.5 text-sm">Refresh token<Input type="password" autoComplete="new-password" value={credentials.refreshToken} onChange={event => setCredentials(current => ({ ...current, refreshToken: event.target.value }))} placeholder={status.refreshTokenConfigured ? "Saved - leave blank to keep" : "Recommended for automatic renewal"} /></label>
            </div>
            <div className="flex flex-wrap gap-2"><Button disabled={busy || !status.encryptedStorageReady || !credentials.appKey.trim()} onClick={() => void run(saveCredentials)}><Save className="size-4" /> Save credentials</Button><Button variant="outline" disabled={busy || !configured || dirty} onClick={() => void run(verify)}>{busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} {rules.channelEnabled ? "Verify connection" : "Enable and verify"}</Button></div>
            {Array.isArray(status.connection?.shops) && status.connection.shops.length > 1 && <label className="grid max-w-lg gap-1.5 text-sm">Authorized shop<Select value={status.shopCipher || ""} onValueChange={shopCipher => void run(async () => { const result = await request("shops/select", { shopCipher }); await refresh(); return result })}><SelectTrigger><SelectValue placeholder="Choose a shop" /></SelectTrigger><SelectContent>{status.connection.shops.map((shop: Json) => <SelectItem key={shop.cipher} value={shop.cipher}>{shop.name || shop.code || shop.id}</SelectItem>)}</SelectContent></Select></label>}
            {status.accessTokenExpiresAt && <p className="text-xs text-muted-foreground">Access token expires {new Date(status.accessTokenExpiresAt).toLocaleString()}. DataPlus refreshes it automatically when a refresh token is saved.</p>}
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
            </div>
          </TabsContent>

          <TabsContent value="sync" className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-sm">From<Input type="date" value={dateRange.startDate} max={dateRange.endDate} onChange={event => setDateRange(current => ({ ...current, startDate: event.target.value }))} /></label><label className="grid gap-1.5 text-sm">Through<Input type="date" value={dateRange.endDate} min={dateRange.startDate} onChange={event => setDateRange(current => ({ ...current, endDate: event.target.value }))} /></label></div>
            <label className="flex max-w-2xl items-center justify-between gap-4 rounded-md border p-3"><span className="min-w-0"><span className="block text-sm font-medium">Historical order backfill</span><span className="block text-xs text-muted-foreground">New orders in this manual range are saved for reporting only. They will not route fulfillment, reserve inventory, create purchase demand, or buy labels.</span></span><Switch checked={historicalBackfill} onCheckedChange={setHistoricalBackfill} /></label>
            <div className="flex flex-wrap gap-2"><Button disabled={busy || !verified || rules.tiktokOrdersEnabled !== true} onClick={() => void run(() => queue("orders"))}><Play className="size-4" /> Import orders</Button><Button variant="outline" disabled={busy || !verified || rules.tiktokReturnsEnabled !== true} onClick={() => void run(() => queue("returns"))}>Import returns</Button><Button variant="outline" disabled={busy || !verified || rules.tiktokSettlementImportEnabled !== true} onClick={() => void run(() => queue("settlements"))}>Import statements</Button><Button variant="outline" disabled={busy || !verified || rules.tiktokCatalogEnabled !== true} onClick={() => void run(() => queue("products"))}>Reconcile products</Button><Button variant="outline" disabled={busy || !verified || rules.tiktokMessagesEnabled !== true} onClick={() => void run(() => queue("messages"))}>Sync conversations</Button></div>
            <p className="text-xs text-muted-foreground">Scheduled order sync remains operational. Historical imports skip existing orders and are marked as non-operational.</p>
            <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Job</TableHead><TableHead>Operation</TableHead><TableHead>Status</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader><TableBody>{(status.recentJobs || []).map((row: Json) => <TableRow key={row.id}><TableCell><a className="underline" href="/jobs">#{row.jobNumber || row.id}</a></TableCell><TableCell>{row.operation}</TableCell><TableCell><Badge variant={row.status === "success" ? "default" : row.status === "failed" ? "destructive" : "outline"}>{row.status}</Badge></TableCell><TableCell className="whitespace-nowrap text-muted-foreground">{row.at ? new Date(row.at).toLocaleString() : "-"}</TableCell></TableRow>)}{!status.recentJobs?.length && <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">No TikTok jobs yet.</TableCell></TableRow>}</TableBody></Table></div>
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

          <TabsContent value="fulfillment" className="space-y-3">
            <Alert><ShieldCheck className="size-4" /><AlertTitle>Reviewed label workflow</AlertTitle><AlertDescription>DataPlus first queries TikTok shipping services, then stores a user-owned 15-minute preview. Package creation requires a separate confirmation, and ambiguous write failures are never replayed automatically.</AlertDescription></Alert>
            <p className="text-sm text-muted-foreground">Shipping service quotes and package documents are available to order fulfillment once TikTok Shipping labels is enabled. Label purchase is not performed by imports, schedules, or catalog jobs.</p>
          </TabsContent>

          <TabsContent value="capabilities" className="space-y-3">
            <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Area</TableHead><TableHead>State</TableHead><TableHead>API</TableHead><TableHead>Notes</TableHead></TableRow></TableHeader><TableBody>{(status.capabilities || []).map((row: Json) => <TableRow key={row.key}><TableCell className="font-medium">{row.label}</TableCell><TableCell><Badge variant={row.state === "ready" ? "default" : "outline"}>{row.state === "ready" ? "Available" : "Guarded foundation"}</Badge></TableCell><TableCell className="whitespace-nowrap text-sm">{row.api}</TableCell><TableCell className="min-w-72 text-sm text-muted-foreground">{row.note || "Available after authorization and its feature gate are enabled."}</TableCell></TableRow>)}</TableBody></Table></div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
