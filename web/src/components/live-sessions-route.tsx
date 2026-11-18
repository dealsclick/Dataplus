import { useEffect, useMemo, useState } from "react"
import { AlertCircle, ArrowLeft, Boxes, CalendarDays, Loader2, PackagePlus, RadioTower, ScanBarcode, Warehouse } from "lucide-react"
import { toast } from "sonner"
import { Field, MetricCard, PageHeader } from "./app-ui"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { MobileTables, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { api, dateLabel, numberLabel } from "../lib/client-api"

type WarehouseReference = {
  id?: string
  name?: string
  code?: string
  isPhysical?: boolean
  allowAudits?: boolean
  inventorySourceType?: string
}

type LiveSessionAudit = {
  id?: string
  auditNumber?: string
  status?: string
  url?: string
  mobileUrl?: string
  lines?: Array<Record<string, unknown>>
  unknownBarcodes?: Array<Record<string, unknown>>
}

type LiveSession = {
  id: string
  sessionNumber?: string
  title?: string
  status?: string
  sourceLabel?: string
  channelLabel?: string
  warehouseName?: string
  scannedSkus?: number
  scannedUnits?: number
  unknownBarcodes?: number
  notes?: string
  createdAt?: string
  createdBy?: string
  updatedAt?: string
  audit?: LiveSessionAudit | null
}

const liveDestinations = [
  { value: "unassigned", label: "Not assigned yet" },
  { value: "ebay_live", label: "eBay Live" },
  { value: "tiktok_live", label: "TikTok Live" },
  { value: "whatnot_live", label: "Whatnot" },
]

function statusLabel(status = "") {
  if (status === "counting") return "Counting"
  if (status === "review") return "Review"
  if (status === "ready") return "Ready"
  if (status === "live") return "Live"
  if (status === "completed") return "Completed"
  return "Draft"
}

function statusClass(status = "") {
  if (status === "ready" || status === "live" || status === "completed") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
  if (status === "review") return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
  if (status === "counting") return "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300"
  return ""
}

function liveSessionKeyFromPath() {
  const match = window.location.pathname.match(/^\/live-sessions\/([^/]+)\/?$/)
  return match ? decodeURIComponent(match[1]) : ""
}

function auditScanUrl(session: LiveSession) {
  const audit = session.audit
  if (!audit) return ""
  return window.matchMedia("(max-width: 767px)").matches
    ? String(audit.mobileUrl || audit.url || "")
    : String(audit.url || audit.mobileUrl || "")
}

function SessionDetail({ session, loading, error }: { session: LiveSession | null; loading: boolean; error: string }) {
  if (loading) return <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading live session...</div>
  if (!session || error) return <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Live session not found</AlertTitle><AlertDescription>{error || "This session could not be loaded."}</AlertDescription></Alert>
  const scanUrl = auditScanUrl(session)
  const knownLines = session.audit?.lines || []
  const unknownLines = session.audit?.unknownBarcodes || []
  const itemRows: Array<Record<string, unknown> & { itemType: string }> = [
    ...knownLines.map((line) => ({ ...line, itemType: "known" })),
    ...unknownLines.map((line) => ({ ...line, itemType: "unknown" })),
  ]
  return <div className="grid gap-5">
    <PageHeader
      eyebrow="Live sessions"
      title={`${session.sessionNumber || "Session"} · ${session.title || "Extra items"}`}
      description="Scanned warehouse evidence for inventory being prepared for a live selling session."
      action={<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => window.location.assign("/live-sessions")}><ArrowLeft className="size-4" /> Sessions</Button>{scanUrl && <Button onClick={() => window.location.assign(scanUrl)}><ScanBarcode className="size-4" /> Scan items</Button>}</div>}
    />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Status" value={statusLabel(session.status)} icon={RadioTower} />
      <MetricCard label="Scanned units" value={numberLabel(session.scannedUnits)} icon={ScanBarcode} />
      <MetricCard label="Catalog SKUs" value={numberLabel(session.scannedSkus)} icon={Boxes} />
      <MetricCard label="Destination" value={session.channelLabel || "Not assigned"} icon={CalendarDays} />
    </div>
    <Card>
      <CardHeader className="border-b"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-base">Session inventory</CardTitle><CardDescription>{session.sourceLabel || "Scanned extra items"} · {session.warehouseName || "Warehouse"}</CardDescription></div><div className="flex flex-wrap gap-2"><Badge variant="outline" className={statusClass(session.status)}>{statusLabel(session.status)}</Badge>{session.audit?.url && <Button asChild size="sm" variant="outline"><a href={session.audit.url}>Audit {session.audit.auditNumber || "record"}</a></Button>}</div></div></CardHeader>
      <CardContent className="p-0">
        {itemRows.length ? <MobileTables><Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Identifier</TableHead><TableHead>Bin</TableHead><TableHead className="text-right">Scanned</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{itemRows.map((line, index) => {
          const identifier = String(line.sku || line.barcode || "Unknown barcode")
          return <TableRow key={String(line.id || `${identifier}-${index}`)}><TableCell><div className="min-w-0"><p className="font-medium whitespace-normal">{String(line.title || line.description || (line.itemType === "unknown" ? "Unrecognized item" : identifier))}</p>{line.itemType === "unknown" && <p className="text-xs text-amber-600 dark:text-amber-300">Catalog match needed</p>}</div></TableCell><TableCell className="font-mono text-xs">{identifier}</TableCell><TableCell>{String(line.locationBin || "Not assigned")}</TableCell><TableCell className="text-right font-medium">{numberLabel(line.countedQty ?? line.count ?? 0)}</TableCell><TableCell><Badge variant="outline">{line.itemType === "unknown" ? "Unknown" : "Recorded"}</Badge></TableCell></TableRow>
        })}</TableBody></Table></MobileTables> : <div className="flex min-h-48 flex-col items-center justify-center gap-3 px-5 py-10 text-center"><div className="grid size-12 place-items-center rounded-md bg-muted"><ScanBarcode className="size-6 text-muted-foreground" /></div><div><p className="font-medium">No items scanned yet</p><p className="mt-1 text-sm text-muted-foreground">Open the linked inventory audit and scan each extra item.</p></div>{scanUrl && <Button onClick={() => window.location.assign(scanUrl)}><ScanBarcode className="size-4" /> Start scanning</Button>}</div>}
      </CardContent>
    </Card>
  </div>
}

export function LiveSessionsRoute({ warehouses = [], operatorName = "Warehouse user" }: { warehouses?: WarehouseReference[]; operatorName?: string }) {
  const detailKey = liveSessionKeyFromPath()
  const [sessions, setSessions] = useState<LiveSession[]>([])
  const [selectedSession, setSelectedSession] = useState<LiveSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const physicalWarehouses = useMemo(() => warehouses.filter((warehouse) => warehouse.isPhysical !== false && warehouse.inventorySourceType !== "supplier_feed" && warehouse.allowAudits !== false), [warehouses])
  const [draft, setDraft] = useState({ title: "", warehouseId: "", channel: "unassigned", notes: "" })

  useEffect(() => {
    if (!draft.warehouseId && physicalWarehouses[0]?.id) setDraft((current) => ({ ...current, warehouseId: String(physicalWarehouses[0]?.id || "") }))
  }, [physicalWarehouses, draft.warehouseId])

  const load = async () => {
    setLoading(true)
    setError("")
    try {
      if (detailKey) {
        const result = await api<{ session?: LiveSession }>(`/api/live-sessions/${encodeURIComponent(detailKey)}`)
        setSelectedSession(result.session || null)
      } else {
        const result = await api<{ sessions?: LiveSession[] }>("/api/live-sessions")
        setSessions(result.sessions || [])
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load live sessions.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [detailKey])

  const create = async () => {
    if (!draft.warehouseId || creating) return
    setCreating(true)
    try {
      const result = await api<{ message?: string; auditUrl?: string; mobileAuditUrl?: string }>("/api/live-sessions", {
        method: "POST",
        body: JSON.stringify({
          sourceType: "extra_items",
          title: draft.title,
          warehouseId: draft.warehouseId,
          channel: draft.channel === "unassigned" ? "" : draft.channel,
          notes: draft.notes,
          user: operatorName,
        }),
      })
      toast.success(result.message || "Live session created.")
      const scannerUrl = window.matchMedia("(max-width: 767px)").matches ? result.mobileAuditUrl : result.auditUrl
      window.location.assign(scannerUrl || "/live-sessions")
    } catch (createError) {
      toast.error(createError instanceof Error ? createError.message : "Unable to create the live session.")
    } finally {
      setCreating(false)
    }
  }

  if (detailKey) return <SessionDetail session={selectedSession} loading={loading} error={error} />

  const counting = sessions.filter((session) => session.status === "counting").length
  const ready = sessions.filter((session) => session.status === "ready").length
  const totalUnits = sessions.reduce((sum, session) => sum + Number(session.scannedUnits || 0), 0)
  return <div className="grid gap-5">
    <PageHeader eyebrow="Warehouse / Live sessions" title="Live Sessions" description="Build reusable live inventory pools from purchase orders, warehouse counts, or scanned extra items, then assign a selling destination when the team is ready." action={<Button onClick={() => setCreateOpen(true)}><PackagePlus className="size-4" /> Create session</Button>} />
    <div className="grid gap-3 sm:grid-cols-3">
      <MetricCard label="Counting" value={counting} icon={ScanBarcode} />
      <MetricCard label="Ready" value={ready} icon={RadioTower} />
      <MetricCard label="Scanned units" value={totalUnits} icon={Boxes} />
    </div>
    {error && <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Live sessions could not load</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    <Card>
      <CardHeader className="border-b"><CardTitle className="text-base">Sessions</CardTitle><CardDescription>Each extra-items session is backed by a linked warehouse audit, so scanning remains reviewable and inventory is not added until the count is posted.</CardDescription></CardHeader>
      <CardContent className="p-0">
        {loading ? <div className="flex min-h-52 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading live sessions...</div> : sessions.length ? <MobileTables><Table><TableHeader><TableRow><TableHead>Session</TableHead><TableHead>Source</TableHead><TableHead>Warehouse</TableHead><TableHead>Destination</TableHead><TableHead className="text-right">Units</TableHead><TableHead>Status</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader><TableBody>{sessions.map((session) => <TableRow key={session.id}><TableCell><a className="font-medium text-primary hover:underline" href={`/live-sessions/${encodeURIComponent(String(session.sessionNumber || session.id))}`}>{session.sessionNumber || "Session"}</a><p className="max-w-72 truncate text-xs text-muted-foreground">{session.title || "Extra items"}</p></TableCell><TableCell>{session.sourceLabel || "Scanned extra items"}</TableCell><TableCell>{session.warehouseName || "-"}</TableCell><TableCell>{session.channelLabel || "Not assigned"}</TableCell><TableCell className="text-right font-medium">{numberLabel(session.scannedUnits)}</TableCell><TableCell><Badge variant="outline" className={statusClass(session.status)}>{statusLabel(session.status)}</Badge></TableCell><TableCell>{dateLabel(session.updatedAt || session.createdAt)}</TableCell></TableRow>)}</TableBody></Table></MobileTables> : <div className="flex min-h-52 flex-col items-center justify-center gap-3 px-5 py-10 text-center"><div className="grid size-12 place-items-center rounded-md bg-muted"><RadioTower className="size-6 text-muted-foreground" /></div><div><p className="font-medium">No live sessions yet</p><p className="mt-1 max-w-md text-sm text-muted-foreground">Create a session from extra items to open a linked inventory audit and start scanning.</p></div><Button onClick={() => setCreateOpen(true)}><PackagePlus className="size-4" /> Create session</Button></div>}
      </CardContent>
    </Card>

    <Dialog open={createOpen} onOpenChange={setCreateOpen}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Create session from extra items</DialogTitle><DialogDescription>Start a linked inventory audit, scan the available items, and keep the resulting quantities attached to this live session.</DialogDescription></DialogHeader>
        <Alert className="border-blue-500/30 bg-blue-500/10"><ScanBarcode className="size-4" /><AlertTitle>Scanning is the source of truth</AlertTitle><AlertDescription>Creating the session does not add inventory. Counts become physical stock only when the linked audit is reviewed and posted.</AlertDescription></Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Session name"><Input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Friday tool launch" /></Field>
          <Field label="Warehouse"><Select value={draft.warehouseId} onValueChange={(warehouseId) => setDraft((current) => ({ ...current, warehouseId }))}><SelectTrigger><SelectValue placeholder="Select a physical warehouse" /></SelectTrigger><SelectContent>{physicalWarehouses.map((warehouse) => <SelectItem key={String(warehouse.id || warehouse.name)} value={String(warehouse.id || "")}>{String(warehouse.name || "Warehouse")}{warehouse.code ? ` (${warehouse.code})` : ""}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Live destination"><Select value={draft.channel} onValueChange={(channel) => setDraft((current) => ({ ...current, channel }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{liveDestinations.map((destination) => <SelectItem key={destination.value} value={destination.value}>{destination.label}</SelectItem>)}</SelectContent></Select></Field>
          <div className="rounded-md border bg-muted/30 p-3 text-sm"><p className="font-medium">Source: Extra items audit</p><p className="mt-1 text-xs text-muted-foreground">You will be taken directly to the warehouse scanner after creation.</p></div>
          <div className="sm:col-span-2"><Field label="Notes"><Textarea value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Optional handling or launch notes" /></Field></div>
        </div>
        {!physicalWarehouses.length && <Alert variant="destructive"><Warehouse className="size-4" /><AlertTitle>No audit-ready warehouse</AlertTitle><AlertDescription>Configure a physical warehouse that allows audits before creating this session.</AlertDescription></Alert>}
        <DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button disabled={creating || !draft.warehouseId} onClick={() => void create()}>{creating ? <Loader2 className="size-4 animate-spin" /> : <ScanBarcode className="size-4" />} Create and scan</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
}
