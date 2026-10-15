import { useEffect, useMemo, useState } from "react"
import { Activity, Download, Loader2, LogOut, MonitorSmartphone, RefreshCw, ShieldCheck, Users } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api, dateLabel, numberLabel } from "../lib/client-api"

type ActivityEvent = {
  id: string
  actorId?: string
  actorName?: string
  eventType?: string
  action?: string
  path?: string
  ipAddress?: string
  createdAt?: string
}

type FeatureSetting = {
  key: string
  label: string
  description?: string
  enabled: boolean
  audience: "superuser" | "admins"
}

type ActivityResponse = {
  events: ActivityEvent[]
  total: number
  summary: { pageViews: number; exports: number; signIns: number; activeUsers: number }
}

type AuthSession = {
  id: string
  current: boolean
  device: string
  ipAddress?: string
  createdAt?: string
  lastSeenAt?: string
  expiresAt?: string
}

type AuthSessionsResponse = { sessions: AuthSession[]; total: number; otherCount: number }

export function SuperuserActivity({ isSuperuser }: { isSuperuser: boolean }) {
  const [data, setData] = useState<ActivityResponse>({ events: [], total: 0, summary: { pageViews: 0, exports: 0, signIns: 0, activeUsers: 0 } })
  const [features, setFeatures] = useState<FeatureSetting[]>([])
  const [authSessions, setAuthSessions] = useState<AuthSessionsResponse>({ sessions: [], total: 0, otherCount: 0 })
  const [query, setQuery] = useState("")
  const [eventType, setEventType] = useState("all")
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: "150", type: eventType })
      if (query.trim()) params.set("q", query.trim())
      const [activity, featureData, sessionData] = await Promise.all([
        api<ActivityResponse>(`/api/superuser/activity?${params}`),
        isSuperuser ? api<{ features: FeatureSetting[] }>("/api/superuser/features") : Promise.resolve({ features: [] }),
        api<AuthSessionsResponse>("/api/auth/sessions")
      ])
      setData(activity)
      setFeatures(featureData.features || [])
      setAuthSessions(sessionData)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load user activity.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [eventType])

  const actors = useMemo(() => new Map(data.events.map((event) => [event.actorId || event.actorName || "", event.actorName || "User"])), [data.events])

  const updateAudience = async (feature: FeatureSetting, audience: "superuser" | "admins") => {
    try {
      const result = await api<{ feature: FeatureSetting }>("/api/superuser/features", { method: "PATCH", body: JSON.stringify({ featureKey: feature.key, enabled: feature.enabled, audience }) })
      setFeatures((current) => current.map((item) => item.key === feature.key ? result.feature : item))
      toast.success(audience === "admins" ? "This workspace is now available to admins." : "This workspace is restricted to the superuser.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update feature access.")
    }
  }

  const revokeSession = async (session: AuthSession) => {
    try {
      await api(`/api/auth/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" })
      setAuthSessions((current) => ({ sessions: current.sessions.filter((item) => item.id !== session.id), total: Math.max(0, current.total - 1), otherCount: Math.max(0, current.otherCount - (session.current ? 0 : 1)) }))
      toast.success(`${session.device} was signed out.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to sign out this device.")
    }
  }

  return <div className="grid gap-4">
    {isSuperuser && <Card className="border-primary/30">
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="size-4" /> Superuser controls</CardTitle><CardDescription>Only Luis can see and change these controls. Admins receive a workspace only after it is explicitly promoted here.</CardDescription></CardHeader>
      <CardContent className="grid gap-3">{features.map((feature) => <div key={feature.key} className="flex flex-col gap-3 rounded-md border bg-background p-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1"><p className="font-medium">{feature.label}</p><p className="text-sm text-muted-foreground">{feature.description}</p></div>
        <Select value={feature.audience} onValueChange={(value: "superuser" | "admins") => void updateAudience(feature, value)}><SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="superuser">Superuser only</SelectItem><SelectItem value="admins">Superuser + admins</SelectItem></SelectContent></Select>
      </div>)}</CardContent>
    </Card>}

    <Card>
      <CardHeader className="border-b"><CardTitle className="flex items-center gap-2 text-base"><MonitorSmartphone className="size-4" /> Signed-in devices</CardTitle><CardDescription>{authSessions.otherCount ? `${numberLabel(authSessions.otherCount)} other ${authSessions.otherCount === 1 ? "device is" : "devices are"} signed in with your username.` : "No other devices are signed in with your username."} A browser profile or app session counts as one device.</CardDescription></CardHeader>
      <CardContent className="grid gap-2 p-4">{authSessions.sessions.map((session) => <div key={session.id} className="flex flex-col gap-3 rounded-md border bg-background p-3 sm:flex-row sm:items-center">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/40"><MonitorSmartphone className="size-4" /></span>
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{session.device}</p>{session.current && <Badge>Current device</Badge>}</div><p className="mt-1 text-xs text-muted-foreground">Last active {dateLabel(session.lastSeenAt)} · Signed in {dateLabel(session.createdAt)}{session.ipAddress ? ` · ${session.ipAddress}` : ""}</p></div>
        {!session.current && <Button size="sm" variant="outline" className="shrink-0 text-destructive hover:text-destructive" onClick={() => void revokeSession(session)}><LogOut className="size-4" /> Sign out</Button>}
      </div>)}{!authSessions.sessions.length && <p className="py-6 text-center text-sm text-muted-foreground">No active sessions were found.</p>}</CardContent>
    </Card>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[{ label: "Page views", value: data.summary.pageViews, icon: Activity }, { label: "Exports", value: data.summary.exports, icon: Download }, { label: "Sign-ins", value: data.summary.signIns, icon: ShieldCheck }, { label: "Active users", value: data.summary.activeUsers, icon: Users }].map((metric) => { const Icon = metric.icon; return <Card key={metric.label}><CardContent className="flex items-center gap-3 p-4"><span className="flex size-9 items-center justify-center rounded-md border bg-muted/40"><Icon className="size-4" /></span><div><p className="text-xs font-medium uppercase text-muted-foreground">{metric.label}</p><p className="text-xl font-semibold">{numberLabel(metric.value)}</p></div></CardContent></Card> })}
    </div>

    <Card>
      <CardHeader className="gap-3 border-b lg:flex-row lg:items-end lg:justify-between"><div><CardTitle className="text-base">User activity and audit</CardTitle><CardDescription>Tenant and company scoped. Totals cover the last 30 days; the table shows the latest matching events.</CardDescription></div><div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto"><Input className="sm:w-72" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load() }} placeholder="Search user, page, or action" /><Select value={eventType} onValueChange={setEventType}><SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All activity</SelectItem><SelectItem value="page_view">Page views</SelectItem><SelectItem value="export">Exports</SelectItem><SelectItem value="sign_in">Sign-ins</SelectItem><SelectItem value="sign_out">Sign-outs</SelectItem><SelectItem value="security">Security</SelectItem></SelectContent></Select><Button variant="outline" onClick={() => void load()} disabled={loading}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh</Button></div></CardHeader>
      <CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>When</TableHead><TableHead>User</TableHead><TableHead>Activity</TableHead><TableHead>Page / record</TableHead><TableHead>IP address</TableHead></TableRow></TableHeader><TableBody>{data.events.map((event) => <TableRow key={event.id}><TableCell className="whitespace-nowrap text-xs">{dateLabel(event.createdAt)}</TableCell><TableCell><p className="font-medium">{event.actorName || "System"}</p>{event.actorId && <p className="text-xs text-muted-foreground">{event.actorId}</p>}</TableCell><TableCell><Badge variant="outline">{String(event.eventType || "activity").replaceAll("_", " ")}</Badge><p className="mt-1 text-xs text-muted-foreground">{event.action || "Recorded"}</p></TableCell><TableCell className="max-w-md truncate font-mono text-xs" title={event.path}>{event.path || "-"}</TableCell><TableCell className="whitespace-nowrap text-xs text-muted-foreground">{event.ipAddress || "-"}</TableCell></TableRow>)}{!data.events.length && <TableRow><TableCell colSpan={5} className="h-28 text-center text-muted-foreground">{loading ? "Loading activity..." : "No activity matches these filters."}</TableCell></TableRow>}</TableBody></Table></div><div className="border-t px-4 py-3 text-xs text-muted-foreground">Showing {numberLabel(data.events.length)} of {numberLabel(data.total)} matching events. {numberLabel(actors.size)} users appear in this result.</div></CardContent>
    </Card>
  </div>
}
